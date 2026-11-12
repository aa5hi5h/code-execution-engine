'use client';
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const themes = {
  dark: { background: '#09090b', foreground: '#fafafa', cursor: '#fafafa', selectionBackground: '#3f3f46' },
  light: { background: '#ffffff', foreground: '#09090b', cursor: '#09090b', selectionBackground: '#d4d4d8' },
};

export default function Term({ visible, dark }) {
  const ref = useRef();
  const termRef = useRef();
  useEffect(() => {
    const t = new Terminal({
      fontSize: 13, cursorBlink: true, theme: dark ? themes.dark : themes.light,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    });
    termRef.current = t;
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(ref.current);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/term`);
    const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
    const doFit = () => {
      try { if (ref.current.offsetHeight) { fit.fit(); send({ type: 'resize', cols: t.cols, rows: t.rows }); } } catch {}
    };
    ws.onopen = doFit;
    ws.onmessage = (e) => t.write(e.data);
    ws.onclose = () => t.write('\r\n[terminal closed]');
    t.onData((d) => send({ type: 'input', data: d }));
    const ro = new ResizeObserver(doFit);
    ro.observe(ref.current);
    return () => { ro.disconnect(); ws.close(); t.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (termRef.current) termRef.current.options.theme = dark ? themes.dark : themes.light; }, [dark]);
  useEffect(() => { if (visible) termRef.current?.focus(); }, [visible]);
  return <div ref={ref} style={{ position: 'absolute', inset: 0, padding: '8px 0 0 14px', display: visible ? 'block' : 'none' }} />;
}
