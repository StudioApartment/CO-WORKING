/* POST /api/auth/magic-link  { email }
 *
 * Recovery for a browser that has no cookie — a new laptop, a cleared profile,
 * a different phone. We mail a single-use link that restores the session.
 *
 * The response never reveals whether the address is registered, so this cannot
 * be used to enumerate who has a badge.
 */

import { send, readJson, clientIp, methodNotAllowed, preflight } from '../_lib/http.js';
import { magicLinkSchema, parseOr400 } from '../_lib/validation.js';
import { limitMagic, tooMany } from '../_lib/ratelimit.js';
import * as store from '../_lib/store.js';
import { supabaseAdmin } from '../_lib/supabase.js';
import { makeMagicToken, hashMagicToken, MAGIC_LINK_TTL_SECONDS } from '../_lib/session.js';
import { sendMagicLinkEmail, emailSendError } from '../_lib/email.js';
import { originFrom, hasResend, hasSessions } from '../_lib/env.js';
import { usingSupabase } from '../_lib/store.js';

const VAGUE_OK = {
  ok: true,
  message: 'If that email has a Co-Worker, a sign-in link is on its way.'
};

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  try {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    if (!hasSessions || !usingSupabase) {
      return send(res, 503, {
        error: 'Co-Worker recovery is not switched on for this deployment yet.',
        code: 'not_configured'
      });
    }
    if (!hasResend) {
      return send(res, 503, {
        error: 'Email delivery is not configured, so we cannot send a link.',
        code: 'email_not_configured'
      });
    }

    const limit = await limitMagic(clientIp(req));
    if (!limit.allowed) {
      return tooMany(res, send, limit, 'Too many link requests. Try again later.');
    }

    const parsed = parseOr400(magicLinkSchema, await readJson(req));
    if (!parsed.ok) return send(res, 400, { error: parsed.error });
    const { email } = parsed.data;

    const record = await store.findByEmail(email);
    if (!record) return send(res, 200, VAGUE_OK);

    const token = makeMagicToken();
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1000);

    const db = supabaseAdmin();
    // Supersede anything outstanding so an older email in the inbox cannot be
    // replayed after a newer one is requested.
    await db.from('mii_magic_links').delete().eq('mii_id', record.id);
    const { error } = await db.from('mii_magic_links').insert({
      token_hash: hashMagicToken(token),
      mii_id: record.id,
      email: record.email,
      expires_at: expiresAt.toISOString()
    });
    if (error) return send(res, 502, { error: 'Could not create a link just now.' });

    const origin = originFrom(req);
    const sent = await sendMagicLinkEmail({
      to: record.email,
      name: record.name,
      link: `${origin}/api/auth/verify?token=${encodeURIComponent(token)}`,
      minutes: Math.round(MAGIC_LINK_TTL_SECONDS / 60),
      origin
    });
    if (!sent.sent) {
      console.error('[magic-link] resend failed:', sent.reason);
      return send(res, 502, {
        error: emailSendError(sent.reason),
        code: 'email_send_failed'
      });
    }

    return send(res, 200, VAGUE_OK);
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}
