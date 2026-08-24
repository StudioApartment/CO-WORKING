/* GET  /api/miis  -> the plaza, without emails
 * POST /api/miis  -> claim a badge: one per email, sets an HTTP-only session
 *                    cookie, mails the pass
 */

import { send, readJson, clientIp, methodNotAllowed } from './_lib/http.js';
import { createMiiSchema, parseOr400 } from './_lib/validation.js';
import { limitCreate, tooMany } from './_lib/ratelimit.js';
import * as store from './_lib/store.js';
import { uploadPreview } from './_lib/supabase.js';
import { issueSession, readSession } from './_lib/session.js';
import { badgeUrl, qrImageUrl } from './_lib/badge.js';
import { walletSaveUrl } from './_lib/googleWallet.js';
import { sendBadgeEmail } from './_lib/email.js';
import { originFrom, hasSessions } from './_lib/env.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const list = await store.listPublic();
      const session = readSession(req);
      return send(res, 200, list.map((r) => ({
        ...r,
        mine: Boolean(session && session.miiId === r.id)
      })));
    }

    if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST']);

    // Shape is checked before the quota so a mistyped email costs nothing —
    // otherwise three fumbled attempts would lock someone out for an hour.
    // The body is already size-capped by readJson, so parsing first is cheap.
    const parsed = parseOr400(createMiiSchema, await readJson(req));
    if (!parsed.ok) return send(res, 400, { error: parsed.error });
    const { email, name, dna, preview } = parsed.data;

    const limit = await limitCreate(clientIp(req));
    if (!limit.allowed) {
      return tooMany(res, send, limit, 'That is a lot of new characters from one place. Try again in a bit.');
    }

    // Checked up front so the common case gets the friendly banner copy, not a
    // constraint error. The unique index is still the real guarantee.
    const existing = await store.findByEmail(email);
    if (existing) {
      return send(res, 409, {
        error: 'An account with this email already exists.',
        code: 'email_taken',
        manageUrl: `${originFrom(req)}/mii`
      });
    }

    let record;
    try {
      record = await store.create({ email, name, dna: { ...dna, name } });
    } catch (e) {
      if (e instanceof store.StoreError) {
        return send(res, e.status, { error: e.message, code: e.code || undefined });
      }
      throw e;
    }

    // From here the badge exists. Nothing below is allowed to fail the request.
    const origin = originFrom(req);
    issueSession(res, { miiId: record.id, email });

    const previewUrl = preview ? await uploadPreview(record.id, preview) : null;
    const qrUrl = qrImageUrl(record.id, origin);
    const badgeValue = badgeUrl({ id: record.id, name, email }, origin);
    const walletUrl = walletSaveUrl({
      id: record.id, name, email, previewUrl, qrUrl, badgeValue, origin
    });

    const mail = await sendBadgeEmail({
      to: email,
      name,
      miiId: record.id,
      previewUrl,
      qrUrl,
      walletUrl,
      manageUrl: `${origin}/mii`,
      origin
    });

    return send(res, 201, {
      id: record.id,
      dna: record.mii_data,
      name: record.name,
      created: new Date(record.created_at).getTime(),
      mine: true,
      sessioned: hasSessions,
      previewUrl,
      qrUrl,
      walletUrl,
      emailed: mail.sent
    });
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}
