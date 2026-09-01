/* Ownership when no session cookie can be signed.
 *
 * A deploy can land before JWT_SECRET does. With no secret there is no cookie,
 * so creation has to fall back to the original capability token — otherwise a
 * character is orphaned the moment it is made and nobody, including its
 * author, can ever edit or delete it.
 *
 * This lives in its own process because ES modules cache their imports: the
 * env module reads process.env once, so the absence of JWT_SECRET has to be
 * true from the very first import. smoke.mjs spawns this file.
 *
 * Run directly with: node scripts/smoke-nosession.mjs
 */

import { EventEmitter } from 'node:events';
import { rmSync } from 'node:fs';

delete process.env.JWT_SECRET;
process.env.MII_CREATE_LIMIT = '20';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.RESEND_API_KEY;

// Keep this run's records away from the other suite's store file.
const STORE = '/tmp/mii-nosession-store.json';
process.env.MII_STORE_FILE = STORE;
try { rmSync(STORE, { force: true }); } catch {}

const miis = (await import('../api/miis.js')).default;
const byId = (await import('../api/miis/[id].js')).default;
const { hasSessions } = await import('../api/_lib/env.js');

function mockRes() {
  const res = new EventEmitter();
  res.statusCode = 200; res.headers = {}; res.body = '';
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  res.end = (c) => { if (c) res.body = String(c); };
  res.json = () => { try { return JSON.parse(res.body); } catch { return null; } };
  return res;
}
function mockReq({ method = 'GET', query = {}, body = null, headers = {} } = {}) {
  const req = new EventEmitter();
  req.method = method; req.query = query; req.headers = { ...headers };
  req.socket = { remoteAddress: '203.0.113.55' };
  if (body != null) req.body = body;
  return req;
}
const call = async (handler, opts) => {
  const res = mockRes();
  await handler(mockReq(opts), res);
  return res;
};

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail !== undefined ? ` — ${detail}` : ''}`); }
};

const DNA = { name: 'Solo', skin: '#f3c9a8', height: 1 };

console.log('\nownership without sessions');

check('sessions really are disabled in this process', hasSessions === false);

const made = await call(miis, {
  method: 'POST',
  body: { email: 'nosession@example.com', name: 'Solo', dna: DNA }
});
const body = made.json();
check('still creates with no signing secret', made.statusCode === 201, `${made.statusCode} ${made.body}`);
check('issues a capability token instead', typeof body.token === 'string' && body.token.length > 20);
check('reports that sessions are off', body.sessioned === false);
check('sets no cookie it cannot sign', !made.getHeader('set-cookie'));

const tok = body.token, id = body.id;

const edit = await call(byId, {
  method: 'PUT', query: { id }, headers: { 'x-token': tok },
  body: { dna: { ...DNA, name: 'Solo II' }, name: 'Solo II' }
});
check('the token authorises an edit', edit.statusCode === 200, `${edit.statusCode} ${edit.body}`);

const wrong = await call(byId, {
  method: 'PUT', query: { id }, headers: { 'x-token': 'not-the-token' }, body: { dna: DNA }
});
check('a wrong token is refused', wrong.statusCode === 403, `got ${wrong.statusCode}`);

const bare = await call(byId, { method: 'PUT', query: { id }, body: { dna: DNA } });
check('no token at all is refused', bare.statusCode === 403, `got ${bare.statusCode}`);

const listed = await call(miis, { method: 'GET', headers: { 'x-token': tok } });
const ours = listed.json().find((m) => m.id === id);
check('the list flags it as ours', Boolean(ours && ours.mine === true));
check('the list still carries no email', Boolean(ours && !('email' in ours)));

const stranger = await call(miis, { method: 'GET' });
check('a stranger still sees mine=false', stranger.json().every((m) => m.mine === false));

const gone = await call(byId, { method: 'DELETE', query: { id }, headers: { 'x-token': tok } });
check('the token authorises a delete', gone.statusCode === 200, `got ${gone.statusCode}`);

try { rmSync(STORE, { force: true }); } catch {}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
