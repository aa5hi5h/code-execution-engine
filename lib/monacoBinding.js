// Minimal Yjs <-> Monaco binding (no dependency on the monaco-editor npm bundle).
// Text edits sync both ways; remote cursors/selections are drawn from Yjs awareness.
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#71717a');
const safeName = (n) => String(n || 'Guest').replace(/[^\w .-]/g, '').slice(0, 24);

export function bindMonaco({ Y, monaco, editor, ytext, awareness }) {
  const model = editor.getModel();
  const ORIGIN = { local: true };
  let applying = false;

  model.setEOL(monaco.editor.EndOfLineSequence.LF);
  applying = true;
  model.setValue(ytext.toString());
  applying = false;

  // Yjs -> Monaco
  const onRemote = (event, tr) => {
    if (tr.origin === ORIGIN) return;
    applying = true;
    let index = 0;
    const edits = [];
    for (const op of event.delta) {
      if (op.retain != null) index += op.retain;
      else if (op.insert != null) {
        const p = model.getPositionAt(index);
        edits.push({ range: new monaco.Range(p.lineNumber, p.column, p.lineNumber, p.column), text: op.insert, forceMoveMarkers: true });
      } else if (op.delete != null) {
        const s = model.getPositionAt(index), e = model.getPositionAt(index + op.delete);
        edits.push({ range: new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column), text: '' });
        index += op.delete;
      }
    }
    model.applyEdits(edits);
    applying = false;
  };
  ytext.observe(onRemote);

  // Monaco -> Yjs
  const sub = model.onDidChangeContent((e) => {
    if (applying) return;
    ytext.doc.transact(() => {
      [...e.changes].sort((a, b) => b.rangeOffset - a.rangeOffset).forEach((c) => {
        if (c.rangeLength) ytext.delete(c.rangeOffset, c.rangeLength);
        if (c.text) ytext.insert(c.rangeOffset, c.text);
      });
    }, ORIGIN);
  });

  // awareness: send my selection, draw everyone else's
  const rel = (i) => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, i));
  const sendCursor = () => {
    const sel = editor.getSelection();
    if (!sel) return awareness.setLocalStateField('cursor', null);
    const a = model.getOffsetAt(sel.getStartPosition()), b = model.getOffsetAt(sel.getEndPosition());
    const ltr = sel.getDirection() === monaco.SelectionDirection.LTR;
    awareness.setLocalStateField('cursor', { anchor: rel(ltr ? a : b), head: rel(ltr ? b : a) });
  };
  const curSub = editor.onDidChangeCursorSelection(sendCursor);

  const style = document.createElement('style');
  document.head.appendChild(style);
  const decos = editor.createDecorationsCollection([]);
  const abs = (j) => Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(j), ytext.doc);
  const render = () => {
    const out = []; let css = '';
    awareness.getStates().forEach((st, id) => {
      if (id === awareness.clientID || !st.cursor || !st.user) return;
      const a = abs(st.cursor.anchor), h = abs(st.cursor.head);
      if (!a || !h || a.type !== ytext || h.type !== ytext) return;
      const color = safeColor(st.user.color), name = safeName(st.user.name);
      const pa = model.getPositionAt(a.index), ph = model.getPositionAt(h.index);
      const [s, e] = a.index <= h.index ? [pa, ph] : [ph, pa];
      css += `.yr-sel-${id}{background:${color}40}`
        + `.yr-cur-${id}{position:absolute;border-left:2px solid ${color};height:100%;box-sizing:border-box}`
        + `.yr-cur-${id}::after{content:"${name}";position:absolute;top:-15px;left:-2px;font:600 10px/1 system-ui,sans-serif;padding:2px 5px;`
        + `background:${color};color:#fff;border-radius:3px 3px 3px 0;white-space:nowrap;z-index:5;pointer-events:none}`;
      if (a.index !== h.index) out.push({ range: new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column), options: { className: `yr-sel-${id}` } });
      out.push({ range: new monaco.Range(ph.lineNumber, ph.column, ph.lineNumber, ph.column), options: { afterContentClassName: `yr-cur-${id}`, stickiness: 1 } });
    });
    style.textContent = css;
    decos.set(out);
  };
  awareness.on('change', render);
  ytext.observe(render);   // registered after onRemote, so the model is already updated
  sendCursor();
  render();

  return () => {
    ytext.unobserve(onRemote); ytext.unobserve(render);
    awareness.off('change', render);
    sub.dispose(); curSub.dispose(); decos.clear(); style.remove();
    awareness.setLocalStateField('cursor', null);
  };
}
