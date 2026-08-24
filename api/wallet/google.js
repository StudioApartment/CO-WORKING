/* POST /api/wallet/google  { id, name?, email? }
 * GET  /api/wallet/google?id=...       -> 302 straight to the save flow
 *
 * Returns the official Google Wallet save link for a badge. The name and email
 * in the request are advisory only: whatever the row says wins, so a caller
 * cannot mint a pass with someone else's details.
 */

import { send, readJson, redirect, methodNotAllowed } from '../_lib/http.js';
import { walletSchema, parseOr400 } from '../_lib/validation.js';
import * as store from '../_lib/store.js';
import { previewUrlFor } from '../_lib/supabase.js';
import { badgeUrl, qrImageUrl } from '../_lib/badge.js';
import { walletSaveUrl, hasGoogleWallet } from '../_lib/googleWallet.js';
import { originFrom } from '../_lib/env.js';

async function build(req, rawId) {
  const id = String(rawId || '').slice(0, 64);
  if (!id) return { status: 400, body: { error: 'missing id' } };

  const record = await store.getById(id);
  if (!record) return { status: 404, body: { error: 'not found' } };

  const origin = originFrom(req);
  const previewUrl = previewUrlFor(record.id);
  const qrUrl = qrImageUrl(record.id, origin);
  const badgeValue = badgeUrl(
    { id: record.id, name: record.name, email: record.email },
    origin
  );

  const saveUrl = walletSaveUrl({
    id: record.id,
    name: record.name,
    email: record.email,
    previewUrl,
    qrUrl,
    badgeValue,
    origin
  });

  if (!saveUrl) {
    return {
      status: 503,
      body: {
        error: 'Google Wallet is not configured for this deployment.',
        code: 'wallet_not_configured',
        qrUrl
      }
    };
  }

  return { status: 200, body: { saveUrl, qrUrl, previewUrl, name: record.name } };
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const out = await build(req, req.query && req.query.id);
      if (out.status === 200) return redirect(res, out.body.saveUrl);
      return send(res, out.status, out.body);
    }

    if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST']);

    const parsed = parseOr400(walletSchema, await readJson(req));
    // A legacy (non-UUID) id should still resolve rather than fail validation.
    const id = parsed.ok ? parsed.data.id : String((await readJson(req)).id || '');
    const out = await build(req, id);
    return send(res, out.status, out.body);
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}

export { hasGoogleWallet };
