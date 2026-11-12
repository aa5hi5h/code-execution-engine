// Serve Monaco from our own server (works offline, no CDN needed on presentation day)
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'node_modules', 'monaco-editor', 'min', 'vs');
const dst = path.join(__dirname, '..', 'public', 'monaco', 'vs');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.cpSync(src, dst, { recursive: true });
console.log('Monaco copied to public/monaco/vs');
