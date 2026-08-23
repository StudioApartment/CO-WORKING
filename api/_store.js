/* Storage + capability tokens for Mii Plaza.
 *
 * Uses Upstash Redis over its REST API when configured (no npm dependency —
 * it is plain fetch), and falls back to a local JSON file so `node server.js`
 * works with nothing provisioned.
 *
 * Ownership is a capability, not an identity: creating a Mii returns a random
 * token exactly once, and only the SHA-256 of it is ever stored. Editing or
 * deleting requires presenting the token. Nothing in any response reveals it,
 * so it cannot be lifted from the network tab the way an owner id could.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
export const usingRedis = Boolean(REST_URL && REST_TOKEN);

const HASH_KEY = 'plaza:miis';
const FILE = path.join(process.cwd(), 'miis.json');

export const MAX_PER_TOKEN = Number(process.env.MAX_PER_OWNER || 3);
export const WRITE_LIMIT = Number(process.env.WRITE_LIMIT || 12);      // writes per window, per IP
export const WRITE_WINDOW = Number(process.env.WRITE_WINDOW || 3600);  // seconds

async function redis(...cmd) {
  const r = await fetch(REST_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${REST_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error('redis ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return (await r.json()).result;
}

/* ---------- file fallback ---------- */
function fileRead() {
  try { const v = JSON.parse(fs.readFileSync(FILE, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  catch { return {}; }
}
function fileWrite(obj) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, FILE);          // atomic: a crash mid-write cannot truncate the store
}

/* ---------- records ---------- */
export async function listAll() {
  if (usingRedis) {
    const flat = await redis('HGETALL', HASH_KEY);
    const out = [];
    if (Array.isArray(flat)) {
      for (let i = 1; i < flat.length; i += 2) { try { out.push(JSON.parse(flat[i])); } catch {} }
    } else if (flat && typeof flat === 'object') {
      for (const v of Object.values(flat)) { try { out.push(typeof v === 'string' ? JSON.parse(v) : v); } catch {} }
    }
    return out;
  }
  return Object.values(fileRead());
}
export async function getOne(id) {
  if (usingRedis) {
    const v = await redis('HGET', HASH_KEY, id);
    if (!v) return null;
    try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
  }
  return fileRead()[id] || null;
}
export async function putOne(rec) {
  if (usingRedis) { await redis('HSET', HASH_KEY, rec.id, JSON.stringify(rec)); return rec; }
  const all = fileRead(); all[rec.id] = rec; fileWrite(all); return rec;
}
export async function delOne(id) {
  if (usingRedis) { await redis('HDEL', HASH_KEY, id); return; }
  const all = fileRead(); delete all[id]; fileWrite(all);
}
export async function countFor(tokenHash) {
  return (await listAll()).filter((r) => r.tokenHash === tokenHash).length;
}

/* ---------- rate limiting ---------- */
const memHits = new Map();
export async function allowWrite(ip) {
  const key = 'plaza:rl:' + (ip || 'unknown');
  if (usingRedis) {
    const n = await redis('INCR', key);
    if (n === 1) await redis('EXPIRE', key, WRITE_WINDOW);
    return n <= WRITE_LIMIT;
  }
  const now = Date.now(), row = memHits.get(key);
  if (!row || now > row.until) { memHits.set(key, { n: 1, until: now + WRITE_WINDOW * 1000 }); return true; }
  row.n++;
  return row.n <= WRITE_LIMIT;
}

/* ---------- tokens ---------- */
export const makeToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
export function tokenMatches(rec, token) {
  if (!rec || !rec.tokenHash || !token) return false;
  const a = Buffer.from(rec.tokenHash, 'utf8');
  const b = Buffer.from(hashToken(token), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);   // constant time
}
export function isAdmin(req) {
  const key = process.env.ADMIN_KEY;
  return Boolean(key) && String(req.headers['x-admin'] || '') === key;
}

/* ---------- misc ---------- */
export const publicView = (r) => ({ id: r.id, dna: r.dna, created: r.created });
export function cleanDna(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const s = JSON.stringify(d);
  if (!s || s.length > 8000) return null;
  try { return JSON.parse(s); } catch { return null; }
}
export function clientIp(req) {
  const f = req.headers['x-forwarded-for'];
  if (typeof f === 'string' && f) return f.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
export function readJson(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') { try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve({}); } }
  return new Promise((resolve) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 262144) { req.destroy(); resolve({}); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
export const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};
