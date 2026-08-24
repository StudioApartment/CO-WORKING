/* GET /api/wallet/apple/:id -> .pkpass
 *
 * iOS Safari offers Add to Wallet when this is served with the pkpass MIME
 * type. The same file is attached to the badge email so Mail on iPhone can
 * add it without opening the site.
 */

import { send, methodNotAllowed, preflight } from '../../_lib/http.js';
import * as store from '../../_lib/store.js';
import { badgeUrl } from '../../_lib/badge.js';
import { buildApplePass, passFileName, hasAppleWallet } from '../../_lib/appleWallet.js';
import { originFrom } from '../../_lib/env.js';

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  try {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

    const id = String((req.query && req.query.id) || '').replace(/\.pkpass$/i, '').slice(0, 64);
    if (!id) return send(res, 400, { error: 'missing id' });

    if (!hasAppleWallet) {
      return send(res, 503, {
        error: 'Apple Wallet is not configured for this deployment.',
        code: 'wallet_not_configured'
      });
    }

    const record = await store.getById(id);
    if (!record) return send(res, 404, { error: 'not found' });

    const origin = originFrom(req);
    const buf = await buildApplePass({
      id: record.id,
      name: record.name,
      email: record.email,
      badgeValue: badgeUrl({ id: record.id }, origin),
      origin
    });

    if (!buf) {
      return send(res, 503, {
        error: 'Could not sign an Apple Wallet pass.',
        code: 'wallet_sign_failed'
      });
    }

    const filename = passFileName(record.name);
    res.statusCode = 200;
    res.setHeader('content-type', 'application/vnd.apple.pkpass');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('content-length', String(buf.length));
    res.setHeader('cache-control', 'no-store');
    return res.end(buf);
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}

export { hasAppleWallet };
