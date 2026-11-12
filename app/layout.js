import { GeistSans } from 'geist/font/sans';
import Providers from '../components/Providers';
import './globals.css';

export const metadata = { title: 'CodeBox', description: 'Collaborative code rooms with a real terminal' };

const themeScript = `try{var t=localStorage.getItem('theme')||'dark';document.documentElement.classList.toggle('dark',t==='dark')}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${GeistSans.variable} dark`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
