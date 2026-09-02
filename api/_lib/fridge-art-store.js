/* Shared fridge magnet artwork — one PNG for the whole office.
 *
 * Redis (Upstash) when configured, otherwise a local PNG on disk.
 * Same fallback pattern as api/_store.js for MII records.
 */
import fs from 'node:fs';
import path from 'node:path';

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const usingRedis = Boolean(REST_URL && REST_TOKEN);

const REDIS_KEY = 'plaza:fridge-art';
const REDIS_TS_KEY = 'plaza:fridge-art:updated';

const FILE = process.env.FRIDGE_ART_FILE
  || (process.env.VERCEL ? '/tmp/fridge-art.png' : path.join(process.cwd(), 'fridge-art.png'));
const TS_FILE = FILE + '.meta.json';

const MAX_BYTES = 2 * 1024 * 1024;

async function redis(...cmd) {
  const r = await fetch(REST_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${REST_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error('redis ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return (await r.json()).result;
}

function readTsFile() {
  try {
    const row = JSON.parse(fs.readFileSync(TS_FILE, 'utf8'));
    return Number(row.updated) || 0;
  } catch {
    return 0;
  }
}

function writeTsFile(ts) {
  const tmp = TS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ updated: ts }));
  fs.renameSync(tmp, TS_FILE);
}

/** @returns {Promise<{ bytes: Buffer, updated: number } | null>} */
export async function getFridgeArt() {
  if (usingRedis) {
    try {
      const b64 = await redis('GET', REDIS_KEY);
      if (b64 && typeof b64 === 'string') {
        const bytes = Buffer.from(b64, 'base64');
        if (bytes.length) {
          const tsRaw = await redis('GET', REDIS_TS_KEY);
          return { bytes, updated: Number(tsRaw) || 0 };
        }
      }
      return null;
    } catch { /* Redis unavailable — fall through to file */ }
  }
  try {
    const bytes = fs.readFileSync(FILE);
    if (!bytes.length) return null;
    const st = fs.statSync(FILE);
    const updated = readTsFile() || Math.floor(st.mtimeMs);
    return { bytes, updated };
  } catch {
    return null;
  }
}

/** @returns {Promise<number>} updated timestamp (ms) */
export async function putFridgeArt(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) {
    throw new Error('invalid image');
  }
  const updated = Date.now();
  if (usingRedis) {
    try {
      await redis('SET', REDIS_KEY, bytes.toString('base64'));
      await redis('SET', REDIS_TS_KEY, String(updated));
      return updated;
    } catch { /* Redis unavailable — fall through to file */ }
  }
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, FILE);
  writeTsFile(updated);
  return updated;
}

export { MAX_BYTES };
