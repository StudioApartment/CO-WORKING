/* Request/response plumbing shared by every route. */

import crypto from 'node:crypto';

export const MAX_BODY_BYTES = 2 * 1024 * 1024; // previews arrive as data URLs

/* Apex ↔ www is a cross-origin redirect, and a GET that carries x-token or
 * Content-Type: application/json is not a "simple" request — the browser
 * OPTIONS first. A 405 there aborts the real call, the plaza falls back to
 * localStorage, and you get "Office is offline — this one stays on this
 * device". Echo the asking origin when we know it. */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const VERCEL_PREVIEW = /^https:\/\/[\w.-]+\.vercel\.app$/i;
const SITE_ORIGINS = new Set([
  'https://www.coworking.fyi',
  'https://coworking.fyi'
]);

export function applyCors(req, res) {
  const origin = String((req && req.headers && req.headers.origin) || '');
  if (!origin) return;
  if (!SITE_ORIGINS.has(origin) && !LOCAL_ORIGIN.test(origin) && !VERCEL_PREVIEW.test(origin)) {
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-token, x-admin-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function preflight(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('cache-control', 'no-store');
    res.end();
    return true;
  }
  return false;
}

export function send(res, code, body) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export function sendText(res, code, text, contentType = 'text/plain; charset=utf-8') {
  res.statusCode = code;
  res.setHeader('content-type', contentType);
  res.setHeader('cache-control', 'no-store');
  res.end(text);
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('allow', allowed.join(', '));
  return send(res, 405, { error: 'method not allowed' });
}

export function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === 'string') {
    try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve({}); }
  }
  return new Promise((resolve) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > MAX_BODY_BYTES) { req.destroy(); resolve({}); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/* Hashed with the session secret so the rate-limit table never holds raw IPs. */
export function hashIp(ip, salt) {
  return crypto.createHash('sha256').update(`${salt || 'mii'}:${ip}`).digest('hex').slice(0, 40);
}

/* ---------------------------------------------------------------- cookies -- */

export function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header || typeof header !== 'string') return {};
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

export function appendCookie(res, cookie) {
  const prev = res.getHeader('set-cookie');
  if (!prev) res.setHeader('set-cookie', [cookie]);
  else res.setHeader('set-cookie', Array.isArray(prev) ? [...prev, cookie] : [prev, cookie]);
}

export function serializeCookie(name, value, opts = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`];
  bits.push(`Path=${opts.path || '/'}`);
  if (opts.maxAge != null) bits.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.expires) bits.push(`Expires=${opts.expires.toUTCString()}`);
  if (opts.httpOnly !== false) bits.push('HttpOnly');
  if (opts.secure !== false) bits.push('Secure');
  bits.push(`SameSite=${opts.sameSite || 'Lax'}`);
  return bits.join('; ');
}

/* Redirects double as the magic-link landing, so they must be able to carry a
 * Set-Cookie alongside the Location. */
export function redirect(res, location, code = 302) {
  res.statusCode = code;
  res.setHeader('location', location);
  res.setHeader('cache-control', 'no-store');
  res.end();
}

export const timingSafeEqualStr = (a, b) => {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};
