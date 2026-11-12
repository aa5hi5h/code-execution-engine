'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export function useIsDark() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const read = () => setDark(document.documentElement.classList.contains('dark'));
    read();
    window.addEventListener('themechange', read);
    return () => window.removeEventListener('themechange', read);
  }, []);
  return dark;
}

export function ThemeToggle() {
  const dark = useIsDark();
  const toggle = () => {
    const next = dark ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    try { localStorage.setItem('theme', next); } catch {}
    window.dispatchEvent(new Event('themechange'));
  };
  return (
    <button className="btn btn-ghost btn-icon" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
      {dark ? <Sun /> : <Moon />}
    </button>
  );
}

export function Logo({ href = '/' }) {
  return (
    <a className="logo" href={href}>
      <span className="logo-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m16 18 6-6-6-6" /><path d="m8 6-6 6 6 6" /></svg></span>
      CodeBox
    </a>
  );
}
