/* Data access for Miis.
 *
 * Supabase is the primary store. When it is not configured the routes fall
 * back to the original capability-token store (Upstash REST or a JSON file) so
 * a fresh clone, a local `vercel dev`, or a deploy whose env vars have not
 * landed yet still serves a working plaza instead of a 500.
 *
 * Degraded mode is deliberately narrower: no email uniqueness, no magic links,
 * no Realtime. Callers check `usingSupabase` before promising those.
 */

import { supabaseAdmin, PUBLIC_COLUMNS, ADMIN_COLUMNS, publicView, deletePreview } from './supabase.js';
import { hasSupabase } from './env.js';
import * as legacy from '../_store.js';

export const usingSupabase = hasSupabase;
export { publicView };

const normalizeEmail = (e) => String(e || '').trim().toLowerCase();

/* Postgres unique-violation. Surfaced as a 409 with a "manage yours" hint
 * rather than a generic failure. */
const isUniqueViolation = (error) =>
  error && (error.code === '23505' || /duplicate key|already exists/i.test(error.message || ''));

class StoreError extends Error {
  constructor(message, { status = 500, code = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export { StoreError };

/* --------------------------------------------------------------- reading -- */

/**
 * The plaza as the browser sees it. `viewer` decides which rows come back
 * flagged as theirs — either the id named by a session cookie, or the hash of
 * a capability token — so the client never has to keep its own list of what it
 * owns. Emails are never included either way.
 *
 * @param {{ sessionId?: string|null, tokenHash?: string|null }} viewer
 */
export async function listPublic(viewer = {}) {
  const { sessionId = null, tokenHash = null } = viewer;

  // token_hash is only read when a token was actually presented, so the
  // common request stays on the narrow public projection.
  const columns = tokenHash ? `${PUBLIC_COLUMNS}, token_hash` : PUBLIC_COLUMNS;

  if (usingSupabase) {
    const { data, error } = await supabaseAdmin()
      .from('miis')
      .select(columns)
      .order('created_at', { ascending: true });
    if (error) throw new StoreError(error.message, { status: 502 });
    return (data || []).map((r) => ({
      ...publicView(r),
      mine: (sessionId != null && r.id === sessionId) ||
            (tokenHash != null && r.token_hash === tokenHash)
    }));
  }

  const rows = await legacy.listAll();
  rows.sort((a, b) => (a.created || 0) - (b.created || 0));
  return rows.map((r) => ({
    id: r.id,
    dna: r.dna,
    name: r.dna?.name || r.name || '',
    created: r.created,
    mine: (sessionId != null && r.id === sessionId) ||
          (tokenHash != null && r.tokenHash === tokenHash)
  }));
}

export async function getById(id) {
  if (!id) return null;
  if (usingSupabase) {
    const { data, error } = await supabaseAdmin()
      .from('miis')
      .select(ADMIN_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new StoreError(error.message, { status: 502 });
    return data || null;
  }
  const rec = await legacy.getOne(id);
  if (!rec) return null;
  return {
    id: rec.id,
    email: rec.email || null,
    name: rec.dna?.name || rec.name || '',
    mii_data: rec.dna,
    created_at: new Date(rec.created || Date.now()).toISOString(),
    updated_at: new Date(rec.updated || rec.created || Date.now()).toISOString(),
    _legacy: rec
  };
}

export async function findByEmail(email) {
  const clean = normalizeEmail(email);
  if (!clean) return null;

  if (usingSupabase) {
    const { data, error } = await supabaseAdmin()
      .from('miis')
      .select(ADMIN_COLUMNS)
      .ilike('email', clean)
      .maybeSingle();
    if (error) throw new StoreError(error.message, { status: 502 });
    return data || null;
  }

  const rows = await legacy.listAll();
  const hit = rows.find((r) => normalizeEmail(r.email) === clean);
  return hit ? await getById(hit.id) : null;
}

export async function listAllAdmin() {
  if (usingSupabase) {
    const { data, error } = await supabaseAdmin()
      .from('miis')
      .select(ADMIN_COLUMNS)
      .order('created_at', { ascending: false });
    if (error) throw new StoreError(error.message, { status: 502 });
    return data || [];
  }

  const rows = await legacy.listAll();
  rows.sort((a, b) => (b.created || 0) - (a.created || 0));
  return rows.map((r) => ({
    id: r.id,
    email: r.email || null,
    name: r.dna?.name || r.name || '',
    mii_data: r.dna,
    created_at: new Date(r.created || Date.now()).toISOString(),
    updated_at: new Date(r.updated || r.created || Date.now()).toISOString()
  }));
}

/* --------------------------------------------------------------- writing -- */

export async function create({ email, name, dna, tokenHash = null }) {
  const clean = normalizeEmail(email);

  if (usingSupabase) {
    const row = { email: clean, name, mii_data: dna };
    if (tokenHash) row.token_hash = tokenHash;
    const { data, error } = await supabaseAdmin()
      .from('miis')
      .insert(row)
      .select(ADMIN_COLUMNS)
      .single();

    if (isUniqueViolation(error)) {
      throw new StoreError('An account with this email already exists.', {
        status: 409, code: 'email_taken'
      });
    }
    if (error) throw new StoreError(error.message, { status: 502 });
    return data;
  }

  // Degraded mode still enforces one-per-email so behaviour does not change
  // shape when Supabase is switched on later.
  const existing = await findByEmail(clean);
  if (existing) {
    throw new StoreError('An account with this email already exists.', {
      status: 409, code: 'email_taken'
    });
  }

  const now = Date.now();
  const rec = {
    id: 'l' + now.toString(36) + Math.random().toString(36).slice(2, 8),
    dna, email: clean, name, created: now, updated: now
  };
  if (tokenHash) rec.tokenHash = tokenHash;
  await legacy.putOne(rec);
  return {
    id: rec.id, email: clean, name, mii_data: dna, token_hash: tokenHash,
    created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString()
  };
}

export async function update(id, { name, dna }) {
  if (usingSupabase) {
    const patch = { mii_data: dna };
    if (name) patch.name = name;
    const { data, error } = await supabaseAdmin()
      .from('miis')
      .update(patch)
      .eq('id', id)
      .select(ADMIN_COLUMNS)
      .single();
    if (error) throw new StoreError(error.message, { status: 502 });
    return data;
  }

  const rec = await legacy.getOne(id);
  if (!rec) throw new StoreError('not found', { status: 404 });
  rec.dna = dna;
  if (name) rec.name = name;
  rec.updated = Date.now();
  await legacy.putOne(rec);
  return {
    id: rec.id, email: rec.email || null, name: rec.name || name || '',
    mii_data: rec.dna,
    created_at: new Date(rec.created || Date.now()).toISOString(),
    updated_at: new Date(rec.updated).toISOString()
  };
}

export async function remove(id) {
  if (usingSupabase) {
    const { error } = await supabaseAdmin().from('miis').delete().eq('id', id);
    if (error) throw new StoreError(error.message, { status: 502 });
    await deletePreview(id);
    return;
  }
  await legacy.delOne(id);
}
