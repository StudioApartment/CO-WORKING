/* GET  /api/miis  -> the plaza, without emails
 * POST /api/miis  -> claim a badge: one per email, sets an HTTP-only session
 *                    cookie, mails the pass
 */

import { send, readJson, clientIp, methodNotAllowed, preflight } from './_lib/http.js';
import { createMiiSchema, parseOr400 } from './_lib/validation.js';
import { limitCreate, tooMany } from './_lib/ratelimit.js';
import * as store from './_lib/store.js';
import { uploadPreview } from './_lib/supabase.js';
import { issueSession, readSession } from './_lib/session.js';
import { badgeUrl, qrImageUrl } from './_lib/badge.js';
import { walletSaveUrl } from './_lib/googleWallet.js';
import { applePassUrl, buildApplePass } from './_lib/appleWallet.js';
import { sendBadgeEmail } from './_lib/email.js';
import { originFrom, hasSessions } from './_lib/env.js';
import { makeToken, hashToken } from './_store.js';

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  try {
    if (req.method === 'GET') {
      const session = readSession(req);
      const token = String(req.headers['x-token'] || '');
      return send(res, 200, await store.listPublic({
        sessionId: session ? session.miiId : null,
        tokenHash: token ? hashToken(token) : null
      }));
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

    /* Ownership has to come from somewhere. Normally that is the signed
     * session cookie, but a deploy without JWT_SECRET cannot sign one — and a
     * character nobody can edit is worse than a slightly weaker proof. So in
     * that case fall back to the original capability token: random, returned
     * exactly once, and only its hash is stored. */
    const fallbackToken = hasSessions ? null : makeToken();

    let record;
    try {
      record = await store.create({
        email, name, dna: { ...dna, name },
        tokenHash: fallbackToken ? hashToken(fallbackToken) : null
      });
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
    const badgeValue = badgeUrl({ id: record.id }, origin);
    const walletUrl = walletSaveUrl({
      id: record.id, name, email, previewUrl, qrUrl, badgeValue, origin
    });
    const appleWalletUrl = applePassUrl(record.id, origin);
    const applePass = await buildApplePass({
      id: record.id, name, email, badgeValue, origin
    });

    const mail = await sendBadgeEmail({
      to: email,
      name,
      miiId: record.id,
      previewUrl,
      qrUrl,
      walletUrl,
      appleWalletUrl,
      applePass,
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
      // Shown once, only when there is no cookie to rely on.
      token: fallbackToken || undefined,
      previewUrl,
      qrUrl,
      walletUrl,
      appleWalletUrl,
      emailed: mail.sent
    });
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}
