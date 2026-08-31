/* Local dev server: static files plus the /api routes.
 *
 * `vercel dev` needs a linked project and a login, which is friction for
 * someone who just cloned this. This serves the same tree with the same
 * routing rules (clean URLs, [id] params) so the whole badge flow can be
 * exercised offline.
 *
 * Usage: npm run dev:local  [--port 4444]
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const argPort = process.argv.indexOf('--port');
const PORT = Number(process.env.PORT || (argPort > -1 ? process.argv[argPort + 1] : 4444));

/* .env.local, so the local run can talk to a real Supabase if one exists. */
const ENV_FILE = join(ROOT, '.env.local');
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (v && !process.env[m[1]]) process.env[m[1]] = v;
  }
  console.log('· loaded .env.local');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
};

/* Mirrors Vercel's filesystem routing: exact file, then [param] segment. */
async function resolveApi(segments) {
  const base = join(ROOT, 'api');
  const direct = join(base, ...segments) + '.js';
  if (existsSync(direct)) return { file: direct, params: {} };

  const asIndex = join(base, ...segments, 'index.js');
  if (existsSync(asIndex)) return { file: asIndex, params: {} };

  // Try the last segment as a dynamic param, e.g. api/qr/[id].js
  if (segments.length) {
    const head = segments.slice(0, -1);
    const tail = segments[segments.length - 1];
    const { readdirSync } = await import('node:fs');
    const dir = join(base, ...head);
    if (existsSync(dir)) {
      const dyn = readdirSync(dir).find((f) => /^\[.+\]\.js$/.test(f));
      if (dyn) {
        const key = dyn.slice(1, -4).replace(/\]$/, '');
        return { file: join(dir, dyn), params: { [key]: tail } };
      }
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);

  // ------------------------------------------------------------------ api --
  if (pathname === '/api/places' || pathname === '/api/places/') {
    url.searchParams.set('__route', 'places');
    pathname = '/api/config';
  }

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    const segments = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const hit = await resolveApi(segments);
    if (!hit) {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ error: 'no such route', path: pathname }));
    }
    try {
      const mod = await import(pathToFileURL(hit.file).href + '?t=' + Date.now());
      req.query = { ...Object.fromEntries(url.searchParams), ...hit.params };
      await mod.default(req, res);
      if (!res.writableEnded) res.end();
    } catch (e) {
      console.error(`  ! ${req.method} ${pathname}`, e);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
      }
      if (!res.writableEnded) res.end(JSON.stringify({ error: String(e.message || e) }));
    }
    console.log(`  ${res.statusCode} ${req.method} ${pathname}`);
    return;
  }

  // --------------------------------------------------------------- static --
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const candidates = [];
  if (safe === '/' || safe === '') candidates.push('index.html');
  else {
    candidates.push(safe.slice(1));
    if (!extname(safe)) candidates.push(safe.slice(1) + '.html', join(safe.slice(1), 'index.html'));
  }

  for (const rel of candidates) {
    const file = join(ROOT, rel);
    if (!file.startsWith(ROOT)) continue;
    try {
      const st = await stat(file);
      if (!st.isFile()) continue;
      const body = await readFile(file);
      res.statusCode = 200;
      res.setHeader('content-type', MIME[extname(file).toLowerCase()] || 'application/octet-stream');
      res.setHeader('cache-control', 'no-store');
      return res.end(body);
    } catch { /* try the next candidate */ }
  }

  res.statusCode = 404;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end('404 ' + pathname);
});

server.listen(PORT, () => {
  console.log(`\n  Mii Plaza dev server`);
  console.log(`  http://localhost:${PORT}/mii`);
  console.log(`  http://localhost:${PORT}/admin\n`);
});
