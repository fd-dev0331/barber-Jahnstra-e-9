/* Lokaler Entwicklungsserver: statische Dateien aus /public plus die Handler
   aus /api unter denselben Pfaden wie auf Vercel. Kein Ersatz für Vercel, aber
   nah genug, um den Buchungsablauf end-to-end zu testen. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from './env.js';

loadEnv();

const PORT = Number(process.env.PORT) || 3210;
const PUBLIC_DIR = path.resolve('public');
const API_DIR = path.resolve('api');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/** Express-ähnliche Hilfen, damit die Handler unverändert auf Vercel laufen. */
function decorate(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.send = (body) => { res.end(body); return res; };
  return res;
}

async function handleApi(req, res, name) {
  const file = path.join(API_DIR, `${name}.js`);
  if (!fs.existsSync(file)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'not_found', message: 'Endpunkt nicht gefunden.' }));
  }
  // Cache-Busting, damit Änderungen ohne Neustart greifen.
  const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  return mod.default(req, decorate(res));
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  // Verzeichniswechsel nach oben ist ausgeschlossen.
  const full = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }

  let file = full;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // cleanUrls wie in vercel.json: /preise -> /preise.html
    if (fs.existsSync(`${full}.html`)) file = `${full}.html`;
    else {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end('<!doctype html><html lang="de"><body style="background:#0E0D0C;color:#D6D3D1;font-family:sans-serif;padding:40px"><h1>404</h1><p>Seite nicht gefunden. <a style="color:#D4AF37" href="/">Zur Startseite</a></p></body></html>');
    }
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const urlPath = new URL(req.url, `http://localhost:${PORT}`).pathname;
  try {
    if (urlPath.startsWith('/api/')) {
      const name = urlPath.slice(5).replace(/\/+$/, '');
      return await handleApi(req, res, name);
    }
    return serveStatic(req, res, urlPath);
  } catch (err) {
    console.error('[dev-api]', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify({ error: 'server_error', message: 'Interner Fehler.' }));
  }
});

server.listen(PORT, () => {
  console.log(`▸ http://localhost:${PORT}  (statisch: public/, API: api/)`);
  if (!process.env.DATABASE_URL) {
    console.warn('⚠ DATABASE_URL fehlt — die API antwortet mit 500. .env aus .env.example anlegen.');
  }
});
