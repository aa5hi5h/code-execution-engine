'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signIn, signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';
import langs from '../lib/languages';
import { Logo, ThemeToggle } from '../components/Theme';
const { LANGS, LANG_IDS } = langs;

function AuthCard() {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      if (mode === 'register') {
        const r = await fetch('/api/register', { method: 'POST', body: JSON.stringify(f) });
        if (!r.ok) return setErr((await r.json()).error);
      }
      const r = await signIn('credentials', { email: f.email, password: f.password, redirect: false });
      if (r?.error) setErr('Email or password is incorrect.');
    } finally { setBusy(false); }
  }

  return (
    <main className="center-screen">
      <div style={{ width: 380, display: 'grid', gap: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><Logo /><ThemeToggle /></div>
        <form className="card" onSubmit={submit}>
          <div className="card-header">
            <h1 className="card-title">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
            <p className="card-desc">{mode === 'login' ? 'Log in to open your rooms.' : 'Sign up to start a coding room.'}</p>
          </div>
          <div className="card-content">
            <div className="seg">
              <button type="button" data-active={mode === 'login'} onClick={() => setMode('login')}>Log in</button>
              <button type="button" data-active={mode === 'register'} onClick={() => setMode('register')}>Sign up</button>
            </div>
            {mode === 'register' && <div className="field"><label className="label" htmlFor="n">Name</label><input id="n" className="input" value={f.name} onChange={set('name')} autoComplete="name" /></div>}
            <div className="field"><label className="label" htmlFor="e">Email</label><input id="e" className="input" type="email" value={f.email} onChange={set('email')} autoComplete="email" /></div>
            <div className="field"><label className="label" htmlFor="p">Password</label><input id="p" className="input" type="password" value={f.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></div>
            {err && <p className="error" role="alert">{err}</p>}
            <button className="btn btn-primary btn-full" disabled={busy}>{mode === 'login' ? 'Log in' : 'Create account'}</button>
          </div>
        </form>
      </div>
    </main>
  );
}

function Dashboard({ user }) {
  const router = useRouter();
  const [language, setLanguage] = useState('python');
  const [code, setCode] = useState('');
  const [rooms, setRooms] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetch('/api/rooms').then((r) => r.json()).then((d) => setRooms(d.rooms || [])).catch(() => setRooms([])); }, []);

  async function create() {
    setBusy(true);
    const r = await fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ language }) });
    router.push('/room/' + (await r.json()).code);
  }
  const join = (e) => { e.preventDefault(); code.trim() && router.push('/room/' + code.trim()); };

  return (
    <>
      <nav className="nav">
        <Logo /><span className="spacer" />
        <span className="muted hide-sm">{user.name}</span>
        <ThemeToggle />
        <button className="btn btn-outline btn-sm" onClick={() => signOut()}><LogOut /> Sign out</button>
      </nav>
      <div className="page">
        <h1>Hi {user.name}</h1>
        <div className="grid-2">
          <div className="card">
            <div className="card-header"><h2 className="card-title">New room</h2><p className="card-desc">Pick a language and invite others with the code.</p></div>
            <div className="card-content">
              <select className="select" value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
                {LANG_IDS.map((id) => <option key={id} value={id}>{LANGS[id].label}</option>)}
              </select>
              <button className="btn btn-primary" onClick={create} disabled={busy}>Create room</button>
            </div>
          </div>
          <form className="card" onSubmit={join}>
            <div className="card-header"><h2 className="card-title">Join a room</h2><p className="card-desc">Enter the code someone shared with you.</p></div>
            <div className="card-content">
              <input className="input mono" placeholder="abc123" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Room code" />
              <button className="btn btn-outline" disabled={!code.trim()}>Join room</button>
            </div>
          </form>
        </div>
        <div className="card">
          <div className="card-header" style={{ paddingBottom: 16 }}><h2 className="card-title">Your rooms</h2></div>
          {rooms === null ? <div className="empty">Loading…</div>
            : rooms.length === 0 ? <div className="empty">No rooms yet. Create one to get started.</div>
            : rooms.map((r) => (
              <div className="row" key={r.code}>
                <span className="mono">{r.code}</span>
                <span className="badge">{LANGS[r.language]?.label || r.language}</span>
                <span className="muted hide-sm">{new Date(r.createdAt).toLocaleDateString()}</span>
                <span className="spacer" />
                <a className="btn btn-outline btn-sm" href={'/room/' + r.code}>Open</a>
              </div>
            ))}
        </div>
      </div>
    </>
  );
}

export default function Home() {
  const { data: session, status } = useSession();
  if (status === 'loading') return null;
  return session ? <Dashboard user={session.user} /> : <AuthCard />;
}
