/* GET /api/auth/verify?token=...
 *
 * Landing point for a magic link. Burns the token, sets the session cookie and
 * bounces to the plaza, so the user's next paint already shows their Mii as
 * editable.
 */

import { redirect, send, methodNotAllowed } from '../_lib/http.js';
import { supabaseAdmin } from '../_lib/supabase.js';
import { hashMagicToken, issueSession } from '../_lib/session.js';
import * as store from '../_lib/store.js';
import { originFrom, hasSessions } from '../_lib/env.js';
import { usingSupabase } from '../_lib/store.js';

const bounce = (req, res, status) =>
  redirect(res, `${originFrom(req)}/mii?auth=${status}`);

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

    if (!hasSessions || !usingSupabase) return bounce(req, res, 'unavailable');

    const token = String((req.query && req.query.token) || '');
    if (!token) return bounce(req, res, 'missing');

    const db = supabaseAdmin();
    const hash = hashMagicToken(token);

    const { data: link, error } = await db
      .from('mii_magic_links')
      .select('token_hash, mii_id, email, expires_at, used_at')
      .eq('token_hash', hash)
      .maybeSingle();

    if (error) return bounce(req, res, 'error');
    if (!link) return bounce(req, res, 'invalid');
    if (link.used_at) return bounce(req, res, 'used');
    if (new Date(link.expires_at).getTime() < Date.now()) return bounce(req, res, 'expired');

    const record = await store.getById(link.mii_id);
    if (!record) {
      await db.from('mii_magic_links').delete().eq('token_hash', hash);
      return bounce(req, res, 'invalid');
    }

    // Single use: consume before issuing, so a double-click cannot mint two
    // sessions from one email.
    const { error: burnErr } = await db
      .from('mii_magic_links')
      .update({ used_at: new Date().toISOString() })
      .eq('token_hash', hash)
      .is('used_at', null);
    if (burnErr) return bounce(req, res, 'error');

    issueSession(res, { miiId: record.id, email: record.email });
    return bounce(req, res, 'ok');
  } catch {
    return bounce(req, res, 'error');
  }
}
