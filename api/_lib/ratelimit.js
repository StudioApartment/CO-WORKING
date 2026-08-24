/* Fixed-window rate limiting.
 *
 * Backed by a Postgres function that increments and expires in one statement,
 * so concurrent requests cannot both read "0" and both be allowed. Without
 * Supabase configured it degrades to a per-instance memory counter, which is
 * weaker across lambdas but still stops a naive loop in local dev.
 */

import { supabaseAdmin } from './supabase.js';
import { hashIp } from './http.js';
import { JWT_SECRET } from './env.js';

export const CREATE_LIMIT = Number(process.env.MII_CREATE_LIMIT || 3);
export const CREATE_WINDOW_SECONDS = Number(process.env.MII_CREATE_WINDOW || 3600);

export const WRITE_LIMIT = Number(process.env.MII_WRITE_LIMIT || 30);
export const WRITE_WINDOW_SECONDS = Number(process.env.MII_WRITE_WINDOW || 3600);

export const MAGIC_LIMIT = Number(process.env.MII_MAGIC_LIMIT || 5);
export const MAGIC_WINDOW_SECONDS = Number(process.env.MII_MAGIC_WINDOW || 3600);

const memory = new Map();

function memoryBump(bucket, windowSecs) {
  const now = Date.now();
  const row = memory.get(bucket);
  if (!row || row.expires < now) {
    memory.set(bucket, { hits: 1, expires: now + windowSecs * 1000 });
    return 1;
  }
  row.hits += 1;
  return row.hits;
}

/**
 * @returns {Promise<{allowed: boolean, hits: number, limit: number, retryAfter: number}>}
 */
export async function consume(scope, ip, { limit, windowSeconds }) {
  const bucket = `${scope}:${hashIp(ip, JWT_SECRET || 'mii-plaza')}`;
  const db = supabaseAdmin();

  let hits;
  if (db) {
    const { data, error } = await db.rpc('bump_rate_limit', {
      p_bucket: bucket,
      p_window_secs: windowSeconds
    });
    // A missing migration should not become an outage; fail open to memory.
    hits = error || typeof data !== 'number' ? memoryBump(bucket, windowSeconds) : data;
  } else {
    hits = memoryBump(bucket, windowSeconds);
  }

  return {
    allowed: hits <= limit,
    hits,
    limit,
    retryAfter: windowSeconds
  };
}

export const limitCreate = (ip) =>
  consume('create', ip, { limit: CREATE_LIMIT, windowSeconds: CREATE_WINDOW_SECONDS });

export const limitWrite = (ip) =>
  consume('write', ip, { limit: WRITE_LIMIT, windowSeconds: WRITE_WINDOW_SECONDS });

export const limitMagic = (ip) =>
  consume('magic', ip, { limit: MAGIC_LIMIT, windowSeconds: MAGIC_WINDOW_SECONDS });

export function tooMany(res, send, result, message) {
  res.setHeader('retry-after', String(result.retryAfter));
  return send(res, 429, {
    error: message || 'Too many attempts for now — try again later.',
    retryAfter: result.retryAfter
  });
}
