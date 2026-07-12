/* ── DRONE·I·FY local dev server ──
   Serves the static site AND bridges POST /api/plan to the Vercel-style
   handler, with ANTHROPIC_API_KEY loaded from .env — so the Claude
   planner runs locally without the Vercel CLI.
     npm install && node dev.mjs   →   http://localhost:8124 */
import { createServer } from 'node:http';
import { readFile, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

/* .env first — api/plan.js constructs its client at import time */
try {
  for (const line of readFileSync(new URL('.env', import.meta.url), 'utf8').split('\n')){
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch (e) { /* no .env — the UI will use the onboard planner */ }

const { default: plan } = await import('./api/plan.js');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

const root = new URL('.', import.meta.url).pathname;
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8124);

createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/plan'){
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try { req.body = JSON.parse(body || '{}'); } catch (e) { req.body = {}; }
      /* minimal Vercel-style res shim (with streaming) */
      const shim = {
        setHeader: (k, v) => res.setHeader(k, v),
        status(code){ res.statusCode = code; return this; },
        json(obj){ res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); },
        write: (c) => res.write(c),
        end: (c) => res.end(c),
      };
      plan(req, shim).catch(() => { res.statusCode = 500; res.end('{"error":"dev server"}'); });
    });
    return;
  }

  const path = normalize(decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]));
  const file = join(root, path === '/' ? 'index.html' : path);
  if (!file.startsWith(root)){ res.statusCode = 403; res.end(); return; }
  readFile(file, (err, data) => {
    if (err){ res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');
    res.end(data);
  });
}).listen(PORT, HOST, () => {
  console.log(`DRONE·I·FY dev server → http://${HOST}:${PORT}` +
    (process.env.ANTHROPIC_API_KEY ? '  (Claude planner ON)' : '  (no key: onboard planner)'));
});
