/* GET  /api/office-sync  -> { fridgeUpdated, dogName, dogUpdated }
 * PUT  /api/office-sync  -> { ok, dogName, dogUpdated }  body: { dogName }
 *
 * Routed through /api/config?__route=office-sync on Vercel.
 */

import { preflight, methodNotAllowed } from './http.js';
import { allowWrite, clientIp } from '../_store.js';
import { publicNameError } from '../../lib/profanity.js';
import { getOfficeSyncState, putDogName } from './plaza-shared-store.js';

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

export default async function handler(req, res) {
  if (preflight(req, res)) return;

  if (req.method === 'GET') {
    try {
      const state = await getOfficeSyncState();
      return sendJson(res, 200, state);
    } catch (e) {
      return sendJson(res, 500, { error: String(e.message || e) });
    }
  }

  if (req.method === 'PUT') {
    if (!(await allowWrite(clientIp(req)))) {
      return sendJson(res, 429, { error: 'too many saves — try again later' });
    }
    const body = await readJsonBody(req);
    const candidate = String(body && body.dogName != null ? body.dogName : '').trim().slice(0, 28);
    if (!candidate) return sendJson(res, 400, { error: 'name required' });
    const err = publicNameError(candidate);
    if (err) return sendJson(res, 400, { error: err });

    try {
      const row = await putDogName(candidate);
      return sendJson(res, 200, { ok: true, dogName: row.name, dogUpdated: row.updated });
    } catch (e) {
      return sendJson(res, 400, { error: String(e.message || e) });
    }
  }

  return methodNotAllowed(res, ['GET', 'PUT', 'OPTIONS']);
}
