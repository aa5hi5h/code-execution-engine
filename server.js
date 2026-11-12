// Custom server: Next.js + WebSockets in one process
//   /ws/yjs/<code>  real-time collaborative editing (Yjs, persisted to Postgres)
//   /ws/term        docker-backed interactive terminal
//   /ws/run         one-shot "Run" button (compile + execute inside the user's sandbox)
const { createServer } = require('http');
const { execFileSync, spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const crypto = require('crypto');
const next = require('next');
const { WebSocketServer } = require('ws');
const { decode } = require('next-auth/jwt');
const pty = require('node-pty');
const Y = require('yjs');
const { setupWSConnection, setPersistence, getYDoc } = require('y-websocket/bin/utils');
const { PrismaClient } = require('@prisma/client');
const { LANGS } = require('./lib/languages');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();
const prisma = new PrismaClient();
const wss = new WebSocketServer({ noServer: true });

const MAX_PER_ROOM = 20;
const MAX_TERMS_PER_USER = 3;
const MAX_RUNS_PER_USER = 2;
const MAX_OUTPUT = 256 * 1024;
const IMAGE = process.env.SANDBOX_IMAGE || 'codebox-sandbox';
const MEMORY = process.env.SANDBOX_MEMORY || '512m';
const CPUS = process.env.SANDBOX_CPUS || '1';
const NETWORK = process.env.SANDBOX_NETWORK || 'bridge';
const IDLE_MS = (Number(process.env.SANDBOX_IDLE_MINUTES) || 30) * 60 * 1000;
const RUN_TIMEOUT = Number(process.env.RUN_TIMEOUT_SECONDS) || 20;

const termCount = new Map();   // userId -> open terminals
const runCount = new Map();    // userId -> runs in flight
const userTerms = new Map();   // userId -> Set<{ ws }>
const lastActive = new Map();  // userId -> timestamp of last input / run
const touch = (uid) => lastActive.set(uid, Date.now());
const docker = (...args) => execFileSync('docker', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

// ---------- auth ----------
async function auth(req) {
  const m = (req.headers.cookie || '').match(/(?:__Secure-)?next-auth\.session-token=([^;]+)/);
  if (!m) return null;
  try {
    const t = await decode({ token: decodeURIComponent(m[1]), secret: process.env.NEXTAUTH_SECRET });
    return t?.id ? { id: t.id, name: t.name || t.email } : null;
  } catch { return null; }
}
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === (req.headers['x-forwarded-host'] || req.headers.host); } catch { return false; }
}

// ---------- Yjs persistence (Postgres) ----------
async function loadDoc(code, doc) {
  const row = await prisma.room.findUnique({ where: { code } });
  if (!row) return;
  const ytext = doc.getText('monaco');
  const meta = doc.getMap('meta');
  if (row.ydoc && row.ydoc.length) Y.applyUpdate(doc, new Uint8Array(row.ydoc));
  else doc.transact(() => { ytext.insert(0, row.content || ''); meta.set('lang', row.language); }, 'seed');
  if (!meta.get('lang')) meta.set('lang', row.language);

  let timer = null;
  const save = () => prisma.room.update({
    where: { id: row.id },
    data: { ydoc: Buffer.from(Y.encodeStateAsUpdate(doc)), content: ytext.toString(), language: meta.get('lang') || row.language },
  }).catch((e) => console.error('save failed', e.message));
  doc.on('update', () => { clearTimeout(timer); timer = setTimeout(save, 2000); });
  doc.flush = () => { clearTimeout(timer); return save(); };
}
setPersistence({
  provider: prisma,
  bindState: (code, doc) => { doc.whenLoaded = loadDoc(code, doc); },
  writeState: async (_code, doc) => { await doc.whenLoaded; await doc.flush?.(); },
});

function onYjs(ws, req, code) {
  // the document is already fully loaded here (see the upgrade handler)
  if (getYDoc(code).conns.size >= MAX_PER_ROOM) return ws.close(1013, 'Room is full');
  setupWSConnection(ws, req, { docName: code });
}

// ---------- sandboxes ----------
function ensureSandbox(uid) {
  const name = 'sb-' + uid;
  try {
    const want = docker('image', 'inspect', '-f', '{{.Id}}', IMAGE);
    const have = docker('inspect', '-f', '{{.Image}}', name);
    if (have !== want) { docker('rm', '-f', name); throw new Error('stale image'); }  // rebuilt image => fresh container
    docker('start', name);
  } catch {
    docker('run', '-d', '--name', name, '--label', 'codebox=1',
      '--memory', MEMORY, '--cpus', CPUS, '--pids-limit', '256', '--network', NETWORK,
      '--security-opt', 'no-new-privileges',
      '-v', `sbv-${uid}:/workspace`,           // files survive container removal
      IMAGE, 'sleep', 'infinity');
  }
  return name;
}

// Idle cleanup: remove sandbox containers nobody has typed into for SANDBOX_IDLE_MINUTES.
// The /workspace volume is kept, so files are still there next time.
function reapIdle() {
  const now = Date.now();
  for (const [uid, t] of [...lastActive]) {
    if (now - t < IDLE_MS || (runCount.get(uid) || 0) > 0) continue;
    for (const s of userTerms.get(uid) || []) { try { s.ws.send('\r\n[sandbox stopped after idle timeout - open a new terminal]\r\n'); s.ws.close(); } catch {} }
    try { docker('rm', '-f', 'sb-' + uid); } catch {}
    lastActive.delete(uid);
    console.log('reaped idle sandbox', uid);
  }
}
function adoptExistingSandboxes() {   // after a restart, make leftovers eligible for cleanup
  try {
    docker('ps', '-a', '--filter', 'name=^sb-', '--format', '{{.Names}}').split('\n').filter(Boolean)
      .forEach((n) => touch(n.slice(3)));
  } catch {}
}

// ---------- terminal ----------
function onTerm(ws, user) {
  const n = termCount.get(user.id) || 0;
  if (n >= MAX_TERMS_PER_USER) { ws.send('\r\n[max 3 terminals per user]\r\n'); return ws.close(); }
  let p;
  try {
    const name = ensureSandbox(user.id);
    p = pty.spawn('docker', ['exec', '-it', '-w', '/workspace', name, 'bash'], { name: 'xterm-256color', cols: 80, rows: 24 });
  } catch (e) { ws.send('\r\n[failed to start sandbox: ' + e.message + ']\r\n'); return ws.close(); }
  termCount.set(user.id, n + 1);
  touch(user.id);
  const handle_ = { ws };
  if (!userTerms.has(user.id)) userTerms.set(user.id, new Set());
  userTerms.get(user.id).add(handle_);
  p.onData((d) => ws.readyState === 1 && ws.send(d));
  p.onExit(() => ws.close());
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'input') { touch(user.id); p.write(m.data); }
    if (m.type === 'resize' && m.cols > 0 && m.rows > 0) { try { p.resize(m.cols, m.rows); } catch {} }
  });
  ws.on('close', () => {
    try { p.kill(); } catch {}
    userTerms.get(user.id)?.delete(handle_);
    termCount.set(user.id, Math.max(0, (termCount.get(user.id) || 1) - 1));
  });
}

// ---------- Run button ----------
function onRun(ws, user) {
  let child = null, container = null, runId = null, stopped = false, finished = false, started = 0, truncated = false;
  const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
  const finish = (extra) => {
    if (finished) return;
    finished = true;
    runCount.set(user.id, Math.max(0, (runCount.get(user.id) || 1) - 1));
    send({ type: 'exit', ms: started ? Date.now() - started : 0, ...extra });
    setTimeout(() => ws.close(), 50);
  };
  const stop = () => {
    stopped = true;
    if (runId && container) {
      // `timeout` forwards SIGTERM to the whole process group it started
      spawn('docker', ['exec', container, 'pkill', '-TERM', '-f', 'timeout -s KILL.*' + runId], { stdio: 'ignore' });
      setTimeout(() => { try { child && child.kill(); } catch {} }, 2000);
    }
  };

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'stop') return stop();
    if (m.type !== 'run' || child || runId !== null) return;
    const L = LANGS[m.lang];
    if (!L || typeof m.code !== 'string' || m.code.length > 200000) return send({ type: 'exit', code: -1, reason: 'invalid' });
    if ((runCount.get(user.id) || 0) >= MAX_RUNS_PER_USER) {
      send({ type: 'out', kind: 'err', data: 'Too many runs in progress. Wait for one to finish.\n' });
      return send({ type: 'exit', code: -1, reason: 'busy' });
    }
    runCount.set(user.id, (runCount.get(user.id) || 0) + 1);
    touch(user.id);
    runId = 'cbrun' + crypto.randomBytes(6).toString('hex');
    try { container = ensureSandbox(user.id); }
    catch (e) { send({ type: 'out', kind: 'err', data: 'Could not start sandbox: ' + e.message + '\n' }); return finish({ code: -1, reason: 'sandbox' }); }

    // 1) write the file into /workspace (same place the terminal sees)
    const w = spawn('docker', ['exec', '-i', container, 'sh', '-c', `cat > /workspace/${L.file}`]);
    w.on('error', () => finish({ code: -1, reason: 'sandbox' }));
    w.stdin.on('error', () => {});
    w.stdin.end(m.code);
    w.on('close', (c) => {
      if (c !== 0) { send({ type: 'out', kind: 'err', data: 'Could not write file into sandbox.\n' }); return finish({ code: -1, reason: 'sandbox' }); }
      if (stopped) return finish({ code: null, reason: 'stopped' });
      // 2) compile + run, hard time limit
      started = Date.now();
      child = spawn('docker', ['exec', '-w', '/workspace', container, 'timeout', '-s', 'KILL', String(RUN_TIMEOUT), 'sh', '-c', L.run, runId]);
      let size = 0;
      const pipe = (kind) => { const dec = new StringDecoder('utf8'); return (d) => {
        size += d.length;
        if (size > MAX_OUTPUT) { if (!truncated) { truncated = true; send({ type: 'out', kind: 'err', data: '\n[output limit reached - stopping]\n' }); stop(); } return; }
        send({ type: 'out', kind, data: dec.write(d) });
      }; };
      child.stdout.on('data', pipe('out'));
      child.stderr.on('data', pipe('err'));
      child.on('error', (e) => { send({ type: 'out', kind: 'err', data: e.message + '\n' }); finish({ code: -1 }); });
      child.on('close', (code) => finish({ code, reason: stopped ? 'stopped' : (code === 124 || code === 137) ? 'timeout' : null, limit: RUN_TIMEOUT }));
    });
  });
  ws.on('close', () => { if (!finished) { stop(); if (!child) { finished = true; if (runId) runCount.set(user.id, Math.max(0, (runCount.get(user.id) || 1) - 1)); } } });
}

// ---------- boot ----------
app.prepare().then(() => {
  const server = createServer((req, res) => handle(req, res));
  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const isYjs = p.startsWith('/ws/yjs/');
    if (!isYjs && p !== '/ws/term' && p !== '/ws/run') return;   // leave Next's dev HMR socket alone
    if (!sameOrigin(req)) return socket.destroy();
    const user = await auth(req);
    if (!user) return socket.destroy();
    let code = null;
    if (isYjs) {
      code = decodeURIComponent(p.slice('/ws/yjs/'.length));
      const room = await prisma.room.findUnique({ where: { code }, select: { id: true } }).catch(() => null);
      if (!room) return socket.destroy();
      // Load the doc BEFORE completing the handshake: otherwise the client's first sync
      // message can arrive while we are still loading and get dropped.
      try { await getYDoc(code).whenLoaded; } catch (e) { console.error(e); return socket.destroy(); }
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (isYjs) onYjs(ws, req, code);
      else if (p === '/ws/term') onTerm(ws, user);
      else onRun(ws, user);
    });
  });
  adoptExistingSandboxes();
  setInterval(reapIdle, 60 * 1000).unref();
  server.listen(3000, () => console.log('CodeBox running on http://localhost:3000'));
});
