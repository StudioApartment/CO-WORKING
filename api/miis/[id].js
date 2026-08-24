/* PUT    /api/miis/:id  -> edit your own character
 * DELETE /api/miis/:id  -> take it down
 *
 * Ownership comes from the HTTP-only session cookie, or the admin key. The
 * legacy capability token is still honoured so Miis created before Supabase
 * existed stay editable by the browser that made them.
 */

import { send, readJson, clientIp, methodNotAllowed } from '../_lib/http.js';
import { updateMiiSchema, parseOr400 } from '../_lib/validation.js';
import { limitWrite, tooMany } from '../_lib/ratelimit.js';
import * as store from '../_lib/store.js';
import { uploadPreview } from '../_lib/supabase.js';
import { readSession, isAdmin, clearSession } from '../_lib/session.js';
import { badgeUrl, qrImageUrl } from '../_lib/badge.js';
import { walletSaveUrl } from '../_lib/googleWallet.js';
import { sendBadgeEmail } from '../_lib/email.js';
import { originFrom } from '../_lib/env.js';
import { tokenMatches } from '../_store.js';

function mayWrite(req, record) {
  if (isAdmin(req)) return true;

  const session = readSession(req);
  if (session && session.miiId === record.id) return true;

  // Capability token, presented as x-token. Covers characters made before the
  // cookie existed, and any made on a deploy with no JWT_SECRET to sign one.
  const token = String(req.headers['x-token'] || '');
  if (!token) return false;

  const hash = record.token_hash || (record._legacy && record._legacy.tokenHash);
  return Boolean(hash && tokenMatches({ tokenHash: hash }, token));
}

export default async function handler(req, res) {
  try {
    const id = String((req.query && req.query.id) || '').slice(0, 64);
    if (!id) return send(res, 400, { error: 'missing id' });

    if (req.method !== 'PUT' && req.method !== 'DELETE') {
      return methodNotAllowed(res, ['PUT', 'DELETE']);
    }

    const record = await store.getById(id);
    if (!record) return send(res, 404, { error: 'not found' });
    if (!mayWrite(req, record)) return send(res, 403, { error: 'not yours' });

    const limit = await limitWrite(clientIp(req));
    if (!limit.allowed) return tooMany(res, send, limit);

    if (req.method === 'DELETE') {
      await store.remove(id);
      // The cookie only ever named this row, so it is now meaningless.
      const session = readSession(req);
      if (session && session.miiId === id) clearSession(res);
      return send(res, 200, { ok: true, id });
    }

    const parsed = parseOr400(updateMiiSchema, await readJson(req));
    if (!parsed.ok) return send(res, 400, { error: parsed.error });
    const { dna, preview } = parsed.data;
    const name = parsed.data.name || dna.name || record.name;

    const updated = await store.update(id, { name, dna: { ...dna, name } });

    const origin = originFrom(req);
    const previewUrl = preview ? await uploadPreview(id, preview) : null;

    // Re-send so the pass in their inbox matches the character in the plaza.
    let emailed = false;
    const email = record.email;
    if (email) {
      const qrUrl = qrImageUrl(id, origin);
      const badgeValue = badgeUrl({ id }, origin);
      const walletUrl = walletSaveUrl({
        id, name, email, previewUrl, qrUrl, badgeValue, origin
      });
      const mail = await sendBadgeEmail({
        to: email, name, miiId: id, previewUrl, qrUrl, walletUrl,
        manageUrl: `${origin}/mii`, origin, isUpdate: true
      });
      emailed = mail.sent;
    }

    return send(res, 200, {
      id: updated.id,
      dna: updated.mii_data,
      name: updated.name,
      created: new Date(updated.created_at).getTime(),
      mine: true,
      previewUrl,
      emailed
    });
  } catch (e) {
    if (e instanceof store.StoreError) return send(res, e.status, { error: e.message });
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}
