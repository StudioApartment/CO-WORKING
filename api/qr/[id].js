/* GET /api/qr/:id -> PNG
 *
 * A stable image URL for the badge QR. Email clients strip data URIs and
 * Google Wallet needs to fetch artwork over HTTPS, so both point here.
 */

import { send, methodNotAllowed } from '../_lib/http.js';
import * as store from '../_lib/store.js';
import { badgeUrl, qrPngBuffer } from '../_lib/badge.js';
import { originFrom } from '../_lib/env.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

    const id = String((req.query && req.query.id) || '').replace(/\.png$/i, '').slice(0, 64);
    if (!id) return send(res, 400, { error: 'missing id' });

    const record = await store.getById(id);
    if (!record) return send(res, 404, { error: 'not found' });

    const png = await qrPngBuffer(
      badgeUrl({ id: record.id }, originFrom(req))
    );

    res.statusCode = 200;
    res.setHeader('content-type', 'image/png');
    res.setHeader('content-length', String(png.length));
    // Immutable per badge: the encoded token is derived from a stable id.
    res.setHeader('cache-control', 'public, max-age=86400, immutable');
    return res.end(png);
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}
