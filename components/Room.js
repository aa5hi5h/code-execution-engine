'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import Editor, { loader } from '@monaco-editor/react';
import { Check, Copy, Play, Plus, Square, SquareTerminal, X, ScrollText } from 'lucide-react';
import dynamic from 'next/dynamic';
import langs from '../lib/languages';
import { bindMonaco } from '../lib/monacoBinding';
import { Logo, ThemeToggle, useIsDark } from './Theme';
const Term = dynamic(() => import('./Terminal'), { ssr: false });
const { LANGS, LANG_IDS } = langs;

loader.config({ paths: { vs: '/monaco/vs' } });   // served locally, works offline

const COLORS = ['#ef4444', '#f97316', '#d97706', '#16a34a', '#0d9488', '#0284c7', '#4f46e5', '#9333ea', '#db2777'];
const colorFor = (s) => COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const isTemplate = (s) => !s.trim() || Object.values(LANGS).some((l) => l.template.trim() === s.trim());
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

function defineThemes(monaco) {
  monaco.editor.defineTheme('cb-dark', { base: 'vs-dark', inherit: true, rules: [], colors: {
    'editor.background': '#09090b', 'editorGutter.background': '#09090b', 'editor.lineHighlightBackground': '#18181b',
    'editorLineNumber.foreground': '#52525b', 'editorLineNumber.activeForeground': '#a1a1aa', 'editor.selectionBackground': '#3f3f4680' } });
  monaco.editor.defineTheme('cb-light', { base: 'vs', inherit: true, rules: [], colors: {
    'editor.background': '#ffffff', 'editorGutter.background': '#ffffff', 'editor.lineHighlightBackground': '#f4f4f5',
    'editorLineNumber.foreground': '#a1a1aa', 'editorLineNumber.activeForeground': '#52525b' } });
}

export default function Room({ code }) {
  const { data: session, status } = useSession();
  const dark = useIsDark();
  const [state, setState] = useState('loading');           // loading | ok | missing
  const [lang, setLang] = useState('python');
  const [collab, setCollab] = useState(null);              // { doc, provider }
  const [conn, setConn] = useState('connecting');
  const [peers, setPeers] = useState([]);
  const [ed, setEd] = useState(null);                      // { editor, monaco }
  const [copied, setCopied] = useState(false);

  const [tab, setTab] = useState('output');                // 'output' | terminal id
  const [terms, setTerms] = useState([]);
  const nextId = useRef(1);
  const [panelH, setPanelH] = useState(300);
  const [drag, setDrag] = useState(false);

  const [lines, setLines] = useState([]);
  const [running, setRunning] = useState(false);
  const runWs = useRef(null);
  const outRef = useRef(null);
  const runRef = useRef(() => {});

  // validate room
  useEffect(() => {
    if (status === 'unauthenticated') location.href = '/';
    if (status !== 'authenticated') return;
    fetch('/api/rooms/' + code).then(async (r) => {
      if (!r.ok) return setState('missing');
      setLang((await r.json()).language || 'python');
      setState('ok');
    }).catch(() => setState('missing'));
  }, [status, code]);

  // realtime connection (Yjs)
  useEffect(() => {
    if (state !== 'ok') return;
    const doc = new Y.Doc();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const provider = new WebsocketProvider(`${proto}://${location.host}/ws/yjs`, code, doc);
    const name = session.user.name || 'Guest';
    provider.awareness.setLocalStateField('user', { name, color: colorFor(name) });
    provider.on('status', (e) => setConn(e.status));
    const meta = doc.getMap('meta');
    const onMeta = () => meta.get('lang') && setLang(meta.get('lang'));
    meta.observe(onMeta);
    const onAware = () => {
      const seen = new Map();
      provider.awareness.getStates().forEach((s) => s.user && !seen.has(s.user.name) && seen.set(s.user.name, s.user));
      setPeers([...seen.values()]);
    };
    provider.awareness.on('change', onAware);
    onAware();
    setCollab({ doc, provider });
    return () => { provider.awareness.off('change', onAware); provider.destroy(); doc.destroy(); setCollab(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, code]);

  // bind Monaco <-> Yjs once both exist
  useEffect(() => {
    if (!ed || !collab) return;
    return bindMonaco({ Y, monaco: ed.monaco, editor: ed.editor, ytext: collab.doc.getText('monaco'), awareness: collab.provider.awareness });
  }, [ed, collab]);

  function changeLang(next) {
    if (!collab) return;
    const ytext = collab.doc.getText('monaco');
    collab.doc.transact(() => {
      collab.doc.getMap('meta').set('lang', next);
      if (isTemplate(ytext.toString())) { ytext.delete(0, ytext.length); ytext.insert(0, LANGS[next].template); }
    });
  }

  // run
  const run = useCallback(() => {
    if (!collab || running) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/run`);
    runWs.current = ws;
    setTab('output'); setRunning(true);
    setLines([{ k: 'sys', d: `$ ${LANGS[lang].run}\n` }]);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'run', lang, code: collab.doc.getText('monaco').toString() }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'out') setLines((l) => [...l, { k: m.kind, d: m.data }]);
      if (m.type === 'exit') {
        const t = (m.ms / 1000).toFixed(2) + 's';
        const msg = m.reason === 'timeout' ? `\nTimed out after ${m.limit}s`
          : m.reason === 'stopped' ? `\nStopped after ${t}`
          : m.code === 0 ? `\nFinished in ${t}` : m.code == null ? '' : `\nExited with code ${m.code} in ${t}`;
        setLines((l) => [...l, { k: m.code === 0 ? 'ok' : 'sys', d: msg + '\n' }]);
        setRunning(false);
      }
    };
    ws.onclose = () => setRunning(false);
    ws.onerror = () => { setLines((l) => [...l, { k: 'err', d: 'Connection to the runner failed.\n' }]); setRunning(false); };
  }, [collab, lang, running]);
  runRef.current = run;
  const stop = () => runWs.current?.readyState === 1 && runWs.current.send(JSON.stringify({ type: 'stop' }));
  useEffect(() => { outRef.current && (outRef.current.scrollTop = outRef.current.scrollHeight); }, [lines]);
  useEffect(() => () => runWs.current?.close(), []);

  // terminals
  const addTerm = () => { const id = nextId.current++; setTerms((t) => [...t, id]); setTab(id); };
  const closeTerm = (id) => { setTerms((t) => t.filter((x) => x !== id)); if (tab === id) setTab('output'); };

  // resizable panel
  useEffect(() => {
    if (!drag) return;
    const move = (e) => setPanelH(Math.min(window.innerHeight - 220, Math.max(100, window.innerHeight - e.clientY)));
    const up = () => setDrag(false);
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [drag]);

  const copy = () => {
    navigator.clipboard?.writeText(location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };

  if (state === 'missing') return (
    <main className="center-screen"><div className="card" style={{ width: 360 }}>
      <div className="card-header"><h1 className="card-title">Room not found</h1>
        <p className="card-desc">There is no room with the code <span className="mono">{code}</span>. Check the code and try again.</p></div>
      <div className="card-content"><a className="btn btn-primary" href="/">Back to home</a></div>
    </div></main>
  );

  return (
    <div className="room">
      <header className="topbar">
        <Logo />
        <span className="sep" />
        <button className="code-chip" onClick={copy} title="Copy invite link">
          {code} {copied ? <Check /> : <Copy />}
        </button>
        <span className="dot" data-on={conn === 'connected'} title={conn} />
        <span className="spacer" />
        <div className="avatars hide-sm">
          {peers.slice(0, 6).map((p) => (
            <span key={p.name} className="avatar" style={{ background: p.color }} title={p.name}>{p.name.slice(0, 1).toUpperCase()}</span>
          ))}
          {peers.length > 6 && <span className="avatar" style={{ background: '#71717a' }}>+{peers.length - 6}</span>}
        </div>
        <select className="select select-sm" value={lang} onChange={(e) => changeLang(e.target.value)} aria-label="Language">
          {LANG_IDS.map((id) => <option key={id} value={id}>{LANGS[id].label}</option>)}
        </select>
        {running
          ? <button className="btn btn-outline btn-sm" onClick={stop}><Square /> Stop</button>
          : <button className="btn btn-primary btn-sm" onClick={run} disabled={!collab}><Play /> Run</button>}
        <ThemeToggle />
      </header>

      <div className="workspace">
        <div className="editor-wrap">
          <Editor
            height="100%" language={LANGS[lang]?.monaco} theme={dark ? 'cb-dark' : 'cb-light'}
            beforeMount={defineThemes}
            onMount={(editor, monaco) => {
              editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
              setEd({ editor, monaco });
            }}
            loading={<span className="muted">Loading editor…</span>}
            options={{ fontSize: 14, fontFamily: MONO, minimap: { enabled: false }, padding: { top: 14 }, scrollBeyondLastLine: false,
              automaticLayout: true, tabSize: 4, renderLineHighlight: 'line', smoothScrolling: true, fixedOverflowWidgets: true }}
          />
        </div>

        <div className="resizer" data-drag={drag} onMouseDown={(e) => { e.preventDefault(); setDrag(true); }} />
        <section className="panel" style={{ height: panelH, userSelect: drag ? 'none' : undefined }}>
          <div className="tabbar">
            <button className="tab" data-active={tab === 'output'} onClick={() => setTab('output')}><ScrollText /> Output</button>
            {terms.map((id, i) => (
              <button key={id} className="tab" data-active={tab === id} onClick={() => setTab(id)}>
                <SquareTerminal /> Terminal {i + 1}
                <span className="x" role="button" aria-label="Close terminal" onClick={(e) => { e.stopPropagation(); closeTerm(id); }}><X /></span>
              </button>
            ))}
            <button className="btn btn-ghost btn-icon" style={{ width: 28, height: 28 }} onClick={addTerm} disabled={terms.length >= 3} title="New terminal" aria-label="New terminal"><Plus /></button>
            <span className="hint hide-sm">Ctrl/Cmd + Enter to run</span>
          </div>
          <div className="panel-body">
            <pre className="output" ref={outRef} style={{ display: tab === 'output' ? 'block' : 'none' }}>
              {lines.length === 0
                ? <span className="sys">Press Run to execute {LANGS[lang]?.label} code. Output shows up here.</span>
                : lines.map((l, i) => <span key={i} className={l.k === 'out' ? undefined : l.k}>{l.d}</span>)}
            </pre>
            {terms.map((id) => <Term key={id} visible={tab === id} dark={dark} />)}
          </div>
        </section>
      </div>
    </div>
  );
}
