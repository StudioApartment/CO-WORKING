/* GET  /api/miis  -> public list (no tokens, no owner ids)
 * POST /api/miis  -> { dna } -> { id, dna, created, token }   token is shown once
 */
import {
  listAll, putOne, countFor, allowWrite, makeToken, hashToken,
  cleanDna, clientIp, readJson, send, MAX_PER_TOKEN, publicView
} from './_store.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      // the caller's token decides which records come back flagged as theirs,
      // so the browser never has to keep its own list of what it owns
      const token = String(req.headers['x-token'] || '');
      const mineHash = token ? hashToken(token) : null;
      const list = await listAll();
      list.sort((a, b) => (a.created || 0) - (b.created || 0));
      return send(res, 200, list.map((r) => ({
        ...publicView(r),
        mine: Boolean(mineHash && r.tokenHash === mineHash)
      })));
    }

    if (req.method === 'POST') {
      if (!(await allowWrite(clientIp(req)))) {
        return send(res, 429, { error: 'Too many for now — try again later.' });
      }
      const body = await readJson(req);
      const dna = cleanDna(body.dna);
      if (!dna) return send(res, 400, { error: 'bad dna' });

      // an existing token may only hold a few Miis, so nobody can flood the plaza
      const token = typeof body.token === 'string' && body.token ? body.token : makeToken();
      const tokenHash = hashToken(token);
      if (await countFor(tokenHash) >= MAX_PER_TOKEN) {
        return send(res, 409, { error: `You already have ${MAX_PER_TOKEN} Miis here.` });
      }

      const rec = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        dna, created: Date.now(), tokenHash
      };
      await putOne(rec);
      return send(res, 201, { ...publicView(rec), token });
    }

    res.setHeader('allow', 'GET, POST');
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}
