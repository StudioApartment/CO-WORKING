/* PUT    /api/miis/:id  -> { dna }   requires x-token (or x-admin)
 * DELETE /api/miis/:id              requires x-token (or x-admin)
 */
import {
  getOne, putOne, delOne, allowWrite, tokenMatches, isAdmin,
  cleanDna, clientIp, readJson, send, publicView
} from '../_store.js';

export default async function handler(req, res) {
  try {
    const id = String((req.query && req.query.id) || '').slice(0, 64);
    if (!id) return send(res, 400, { error: 'missing id' });

    const rec = await getOne(id);
    if (!rec) return send(res, 404, { error: 'not found' });

    const token = String(req.headers['x-token'] || '');
    if (!isAdmin(req) && !tokenMatches(rec, token)) {
      return send(res, 403, { error: 'not yours' });
    }
    if (!(await allowWrite(clientIp(req)))) {
      return send(res, 429, { error: 'Too many for now — try again later.' });
    }

    if (req.method === 'DELETE') {
      await delOne(id);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'PUT') {
      const body = await readJson(req);
      const dna = cleanDna(body.dna);
      if (!dna) return send(res, 400, { error: 'bad dna' });
      rec.dna = dna;
      await putOne(rec);
      return send(res, 200, publicView(rec));
    }

    res.setHeader('allow', 'PUT, DELETE');
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}
