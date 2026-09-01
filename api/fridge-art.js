/* GET  /api/fridge-art  -> shared fridge magnet PNG (404 if never saved)
 * PUT  /api/fridge-art  -> save raw image/png body (collaborative canvas)
 * POST /api/fridge-art  -> save { image: "data:image/png;base64,..." }
 */

import { preflight, methodNotAllowed, clientIp } from './_lib/http.js';
import { allowWrite } from './_store.js';
import { getFridgeArt, putFridgeArt, MAX_BYTES } from './_lib/fridge-art-store.js';

const DATA_URL_RE = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/i;

function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (req.body instanceof Uint8Array) return Promise.resolve(Buffer.from(req.body));
  return new Promise((resolve) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > MAX_BYTES) { req.destroy(); resolve(null); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0)));
    req.on('error', () => resolve(null));
  });
}

function sendPng(res, code, bytes, updated = 0) {
  res.statusCode = code;
  res.setHeader('content-type', 'image/png');
  res.setHeader('cache-control', 'no-store');
  if (updated) res.setHeader('x-fridge-updated', String(updated));
  res.end(bytes);
}

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

async function parseBody(req) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('image/png') || ct.includes('application/octet-stream')) {
    const raw = await readRawBody(req);
    if (!raw || !raw.length) return { error: 'empty body' };
    if (raw.length > MAX_BYTES) return { error: 'image too large' };
    return { bytes: raw };
  }
  if (ct.includes('application/json')) {
    let body = req.body;
    if (!body || typeof body === 'string') {
      const raw = await readRawBody(req);
      try { body = raw && raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch { body = {}; }
    }
    const image = body && body.image;
    if (typeof image !== 'string') return { error: 'expected { image: data URL }' };
    const m = DATA_URL_RE.exec(image.trim());
    if (!m) return { error: 'image must be a PNG data URL' };
    const bytes = Buffer.from(m[1].replace(/\s/g, ''), 'base64');
    if (!bytes.length || bytes.length > MAX_BYTES) return { error: 'image too large' };
    return { bytes };
  }
  return { error: 'send image/png or application/json' };
}

export default async function handler(req, res) {
  if (preflight(req, res)) return;

  if (req.method === 'GET') {
    const row = await getFridgeArt();
    if (!row) return sendJson(res, 404, { error: 'no artwork yet' });
    return sendPng(res, 200, row.bytes, row.updated);
  }

  if (req.method !== 'PUT' && req.method !== 'POST') {
    return methodNotAllowed(res, ['GET', 'PUT', 'POST', 'OPTIONS']);
  }

  if (!(await allowWrite(clientIp(req)))) {
    return sendJson(res, 429, { error: 'too many saves — try again later' });
  }

  const parsed = await parseBody(req);
  if (parsed.error) return sendJson(res, 400, { error: parsed.error });

  try {
    const updated = await putFridgeArt(parsed.bytes);
    return sendJson(res, 200, { ok: true, updated });
  } catch (e) {
    return sendJson(res, 400, { error: String(e.message || e) });
  }
}
