/* Supabase clients.
 *
 * Every write goes through the service-role client, which bypasses RLS. The
 * browser never gets that key: it reads the plaza with the anon key under the
 * public-select policy, and column grants keep `email` out of reach.
 */

import { createClient } from '@supabase/supabase-js';
import {
  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, hasSupabase
} from './env.js';

let admin = null;

export function supabaseAdmin() {
  if (!hasSupabase) return null;
  if (!admin) {
    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'mii-plaza' } }
    });
  }
  return admin;
}

export const PREVIEW_BUCKET = 'mii-previews';

/* Public columns only. Anything that reaches the browser goes through here so
 * a new column cannot leak by being added to a `select('*')` somewhere. */
export const PUBLIC_COLUMNS = 'id, name, mii_data, created_at, updated_at';
export const ADMIN_COLUMNS = 'id, email, name, mii_data, created_at, updated_at';

export const publicView = (row) => ({
  id: row.id,
  dna: row.mii_data,
  name: row.name,
  created: row.created_at ? new Date(row.created_at).getTime() : Date.now()
});

export const clientConfig = () => ({
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY
});

/* ------------------------------------------------------------- previews --- */

const DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$/;

/* The plaza already renders a turntable preview of the Mii in the badge modal,
 * so the client hands us that canvas as a data URL rather than us trying to
 * run WebGL in a function. Failure is non-fatal: the badge simply ships
 * without artwork. */
export async function uploadPreview(id, dataUrl) {
  const db = supabaseAdmin();
  if (!db || typeof dataUrl !== 'string') return null;

  const m = DATA_URL_RE.exec(dataUrl.trim());
  if (!m) return null;

  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const bytes = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
  if (!bytes.length || bytes.length > 1_500_000) return null;

  const path = `${id}.${ext}`;
  const { error } = await db.storage.from(PREVIEW_BUCKET).upload(path, bytes, {
    contentType: `image/${m[1]}`,
    upsert: true,
    cacheControl: '3600'
  });
  if (error) return null;

  const { data } = db.storage.from(PREVIEW_BUCKET).getPublicUrl(path);
  return data?.publicUrl || null;
}

export async function deletePreview(id) {
  const db = supabaseAdmin();
  if (!db) return;
  await db.storage
    .from(PREVIEW_BUCKET)
    .remove([`${id}.png`, `${id}.jpg`, `${id}.webp`])
    .catch(() => {});
}

export function previewUrlFor(id) {
  const db = supabaseAdmin();
  if (!db) return null;
  const { data } = db.storage.from(PREVIEW_BUCKET).getPublicUrl(`${id}.png`);
  return data?.publicUrl || null;
}
