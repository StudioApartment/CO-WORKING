/* GET    /api/me  -> who this browser is, according to its cookie
 * DELETE /api/me  -> forget this browser (keeps the Mii, drops the cookie)
 *
 * The session cookie is HTTP-only, so page scripts cannot inspect it. This is
 * how the client discovers on load that it already owns a character.
 */

import { send, methodNotAllowed, preflight } from './_lib/http.js';
import { readSession, clearSession } from './_lib/session.js';
import * as store from './_lib/store.js';
import { previewUrlFor } from './_lib/supabase.js';
import { qrImageUrl, badgeUrl } from './_lib/badge.js';
import { walletSaveUrl } from './_lib/googleWallet.js';
import { originFrom, hasSessions } from './_lib/env.js';

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  try {
    if (req.method === 'DELETE') {
      clearSession(res);
      return send(res, 200, { ok: true });
    }
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET', 'DELETE']);

    if (!hasSessions) return send(res, 200, { signedIn: false, reason: 'sessions_disabled' });

    const session = readSession(req);
    if (!session) return send(res, 200, { signedIn: false });

    const record = await store.getById(session.miiId);
    // Deleted from under us (or wiped by an admin): drop the stale cookie.
    if (!record) {
      clearSession(res);
      return send(res, 200, { signedIn: false, reason: 'mii_missing' });
    }

    const origin = originFrom(req);
    const previewUrl = previewUrlFor(record.id);
    const qrUrl = qrImageUrl(record.id, origin);
    const walletUrl = walletSaveUrl({
      id: record.id,
      name: record.name,
      email: record.email,
      previewUrl,
      qrUrl,
      badgeValue: badgeUrl({ id: record.id }, origin),
      origin
    });

    return send(res, 200, {
      signedIn: true,
      mii: {
        id: record.id,
        dna: record.mii_data,
        name: record.name,
        created: new Date(record.created_at).getTime(),
        mine: true
      },
      email: record.email,
      previewUrl,
      qrUrl,
      walletUrl
    });
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}
