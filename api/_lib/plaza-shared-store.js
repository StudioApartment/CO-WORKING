/* Shared office props — dog name + fridge-art timestamps (Redis or local file).
 * Same fallback pattern as fridge-art-store.js / api/_store.js. */
import fs from 'node:fs';
import path from 'node:path';
import { getFridgeArt } from './fridge-art-store.js';

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const usingRedis = Boolean(REST_URL && REST_TOKEN);

const DOG_KEY = 'plaza:dog-name';
const DOG_TS_KEY = 'plaza:dog-name:updated';
export const DOG_DEFAULT_NAME = 'Roscoe';

const DOG_FILE = process.env.DOG_NAME_FILE
  || (process.env.VERCEL ? '/tmp/office-dog-name.txt' : path.join(process.cwd(), 'office-dog-name.txt'));
const DOG_TS_FILE = DOG_FILE + '.meta.json';

async function redis(...cmd) {
  const r = await fetch(REST_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${REST_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error('redis ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return (await r.json()).result;
}

function readDogTsFile() {
  try {
    const row = JSON.parse(fs.readFileSync(DOG_TS_FILE, 'utf8'));
    return Number(row.updated) || 0;
  } catch {
    return 0;
  }
}

function writeDogTsFile(ts) {
  const tmp = DOG_TS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ updated: ts }));
  fs.renameSync(tmp, DOG_TS_FILE);
}

function normalizeDogName(raw) {
  const name = String(raw || '').trim().slice(0, 28);
  return name || DOG_DEFAULT_NAME;
}

/** @returns {Promise<{ name: string, updated: number }>} */
export async function getDogName() {
  if (usingRedis) {
    const raw = await redis('GET', DOG_KEY);
    const tsRaw = await redis('GET', DOG_TS_KEY);
    return {
      name: normalizeDogName(raw),
      updated: Number(tsRaw) || 0
    };
  }
  try {
    const raw = fs.readFileSync(DOG_FILE, 'utf8');
    const st = fs.statSync(DOG_FILE);
    const updated = readDogTsFile() || Math.floor(st.mtimeMs);
    return { name: normalizeDogName(raw), updated };
  } catch {
    return { name: DOG_DEFAULT_NAME, updated: 0 };
  }
}

/** @returns {Promise<{ name: string, updated: number }>} */
export async function putDogName(raw) {
  const name = normalizeDogName(raw);
  const updated = Date.now();
  if (usingRedis) {
    await redis('SET', DOG_KEY, name);
    await redis('SET', DOG_TS_KEY, String(updated));
    return { name, updated };
  }
  const tmp = DOG_FILE + '.tmp';
  fs.writeFileSync(tmp, name, 'utf8');
  fs.renameSync(tmp, DOG_FILE);
  writeDogTsFile(updated);
  return { name, updated };
}

/** @returns {Promise<{ fridgeUpdated: number, dogName: string, dogUpdated: number }>} */
export async function getOfficeSyncState() {
  const [fridge, dog] = await Promise.all([getFridgeArt(), getDogName()]);
  return {
    fridgeUpdated: fridge ? fridge.updated : 0,
    dogName: dog.name,
    dogUpdated: dog.updated
  };
}
