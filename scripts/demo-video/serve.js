// Static server mimicking Vercel cleanUrls + demo media rewrites.
// Usage: node serve.js <rootDir> <port>
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3] || 4173);
const HERO = '13f869c5-3d3a-442c-b652-c14fb98b6ba1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain', '.webp': 'image/webp', '.ico': 'image/x-icon' };

function send(res, file) {
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}
const isFile = (f) => f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile();

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/api/media') {
    const id = url.searchParams.get('id') || (url.searchParams.get('slot') === 'hero' ? HERO : null);
    const f = path.join(root, 'demo/media', `${id}.jpg`);
    if (id && isFile(f)) return send(res, f);
  }
  if (p.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end('{"error":"not_found"}');
  }
  const candidates = [path.join(root, p), path.join(root, p + '.html'), path.join(root, p, 'index.html')];
  for (const c of candidates) if (isFile(c)) return send(res, c);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}).listen(port, () => console.log(`serving ${root} on :${port}`));
