/* End-to-end smoke test against the route handlers.
 *
 * Runs with no Supabase, Resend or Wallet credentials, which is the degraded
 * path a fresh clone hits — so it proves the plaza still works before anything
 * is provisioned, and that validation, rate limiting, ownership and the
 * one-badge-per-email rule hold on their own.
 *
 * Run with: node scripts/smoke.mjs
 */

import { rmSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';

process.env.JWT_SECRET = 'smoke-test-secret-value-0123456789';
process.env.ADMIN_SECRET_KEY = 'smoke-admin-key';
process.env.MII_CREATE_LIMIT = '3';
process.env.PUBLIC_ORIGIN = 'https://example.test';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.RESEND_API_KEY;

const STORE_FILE = new URL('../miis.json', import.meta.url);
try { rmSync(STORE_FILE, { force: true }); } catch {}

const miis = (await import('../api/miis.js')).default;
const miiById = (await import('../api/miis/[id].js')).default;
const me = (await import('../api/me.js')).default;
const config = (await import('../api/config.js')).default;
const adminList = (await import('../api/admin/miis.js')).default;
const adminExport = (await import('../api/admin/export.js')).default;
const magicLink = (await import('../api/auth/magic-link.js')).default;
const walletGoogle = (await import('../api/wallet/google.js')).default;

/* ------------------------------------------------------------- harness --- */

function mockRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.body = '';
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  res.end = (chunk) => {
    if (chunk) res.body = Buffer.isBuffer(chunk) ? chunk : String(chunk);
    res.done = true;
    return res;
  };
  res.json = () => { try { return JSON.parse(res.body); } catch { return null; } };
  return res;
}

function mockReq({ method = 'GET', query = {}, body = null, headers = {}, cookies = null } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.query = query;
  req.headers = { ...headers };
  if (cookies) req.headers.cookie = cookies;
  req.socket = { remoteAddress: headers['x-forwarded-for'] || '203.0.113.9' };
  if (body != null) req.body = body;
  return req;
}

const call = async (handler, opts) => {
  const res = mockRes();
  await handler(mockReq(opts), res);
  return res;
};

const cookieFrom = (res) => {
  const set = res.getHeader('set-cookie');
  if (!set) return null;
  const list = Array.isArray(set) ? set : [set];
  const hit = list.find((c) => c.startsWith('mii_session='));
  return hit ? hit.split(';')[0] : null;
};

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

const DNA = { name: 'Gage', skin: '#f3c9a8', height: 1, hair: { color: '#2b1d15' } };

/* ---------------------------------------------------------------- tests --- */

console.log('\nconfig');
{
  const res = await call(config, {});
  const b = res.json();
  check('reports legacy storage with no Supabase', b.storage === 'legacy', b.storage);
  check('realtime off', b.realtime === false);
  check('never leaks a supabase key', b.supabaseAnonKey === null);
  check('sessions on (JWT_SECRET set)', b.features.sessions === true);
}

console.log('\nvalidation');
{
  const bad = await call(miis, { method: 'POST', body: { email: 'nope', name: 'X', dna: DNA } });
  check('rejects malformed email', bad.statusCode === 400, `got ${bad.statusCode}`);

  const noName = await call(miis, { method: 'POST', body: { email: 'a@b.co', name: '', dna: DNA } });
  check('rejects empty name', noName.statusCode === 400, `got ${noName.statusCode}`);

  const longName = await call(miis, {
    method: 'POST', body: { email: 'a@b.co', name: 'x'.repeat(40), dna: DNA }
  });
  check('rejects over-long name', longName.statusCode === 400, `got ${longName.statusCode}`);

  const badDna = await call(miis, {
    method: 'POST', body: { email: 'a@b.co', name: 'Ok', dna: { blob: 'x'.repeat(9000) } }
  });
  check('rejects oversized mii_data', badDna.statusCode === 400, `got ${badDna.statusCode}`);

  const noDna = await call(miis, { method: 'POST', body: { email: 'a@b.co', name: 'Ok' } });
  check('rejects a missing character', noDna.statusCode === 400, `got ${noDna.statusCode}`);

  // Four bad requests in a row above: the quota must still be untouched, or a
  // typo would cost someone their hourly allowance.
  const after = await call(miis, {
    method: 'POST', body: { email: 'typo-recovery@example.com', name: 'Fixed', dna: DNA }
  });
  check('bad input does not consume the create quota', after.statusCode === 201, `got ${after.statusCode}`);
}

console.log('\ncreate + session');
let cookie = null;
let createdId = null;
{
  const res = await call(miis, {
    method: 'POST',
    headers: { 'x-forwarded-for': '198.51.100.1' },
    body: { email: 'Gage@Example.com', name: 'Gage', dna: DNA }
  });
  const b = res.json();
  check('creates a badge', res.statusCode === 201, `${res.statusCode} ${res.body}`);
  createdId = b && b.id;
  check('returns the row id', Boolean(createdId));
  check('name persisted into dna', b && b.dna && b.dna.name === 'Gage');
  check('qr url points at our endpoint', Boolean(b && b.qrUrl && b.qrUrl.includes('/api/qr/')));
  check('no wallet url without credentials', b && b.walletUrl === null, String(b && b.walletUrl));
  check('reports it could not email', b && b.emailed === false);

  cookie = cookieFrom(res);
  check('sets a session cookie', Boolean(cookie));
  const raw = Array.isArray(res.getHeader('set-cookie')) ? res.getHeader('set-cookie')[0] : res.getHeader('set-cookie');
  check('cookie is HttpOnly', /HttpOnly/i.test(raw || ''));
  check('cookie is Secure', /Secure/i.test(raw || ''));
  check('cookie is SameSite=Lax', /SameSite=Lax/i.test(raw || ''));
}

console.log('\none badge per email');
{
  const dupe = await call(miis, {
    method: 'POST',
    headers: { 'x-forwarded-for': '198.51.100.2' },
    body: { email: 'gage@example.com', name: 'Impostor', dna: DNA }
  });
  const b = dupe.json();
  check('blocks a second badge on the same email', dupe.statusCode === 409, `got ${dupe.statusCode}`);
  check('flags it as email_taken', b && b.code === 'email_taken');
  check('offers a manage link', Boolean(b && b.manageUrl));

  const upper = await call(miis, {
    method: 'POST',
    headers: { 'x-forwarded-for': '198.51.100.3' },
    body: { email: '  GAGE@EXAMPLE.COM ', name: 'Impostor', dna: DNA }
  });
  check('email match ignores case and padding', upper.statusCode === 409, `got ${upper.statusCode}`);
}

console.log('\nlisting');
{
  const res = await call(miis, { method: 'GET', cookies: cookie });
  const list = res.json();
  const ours = Array.isArray(list) ? list.find((m) => m.id === createdId) : null;

  check('lists the plaza', Array.isArray(list) && list.length >= 1, JSON.stringify(list));
  check('includes our row', Boolean(ours));
  check('marks our own row as mine', ours && ours.mine === true);
  check('marks other rows as not mine',
    list.filter((m) => m.id !== createdId).every((m) => m.mine === false));
  check('list carries no email', list.every((m) => !('email' in m)));

  const anon = await call(miis, { method: 'GET' });
  check('a stranger sees mine=false everywhere', anon.json().every((m) => m.mine === false));
}

console.log('\nme');
{
  const res = await call(me, { method: 'GET', cookies: cookie });
  const b = res.json();
  check('resolves the session', b.signedIn === true);
  check('returns our mii', b.mii && b.mii.id === createdId);
  check('returns our email to us', b.email === 'gage@example.com');

  const anon = await call(me, { method: 'GET' });
  check('no cookie means not signed in', anon.json().signedIn === false);
}

console.log('\nownership');
{
  const stranger = await call(miiById, {
    method: 'PUT', query: { id: createdId }, body: { dna: DNA, name: 'Hijack' }
  });
  check('rejects edits without the cookie', stranger.statusCode === 403, `got ${stranger.statusCode}`);

  const delStranger = await call(miiById, { method: 'DELETE', query: { id: createdId } });
  check('rejects deletes without the cookie', delStranger.statusCode === 403, `got ${delStranger.statusCode}`);

  const mine = await call(miiById, {
    method: 'PUT', query: { id: createdId }, cookies: cookie,
    body: { dna: { ...DNA, name: 'Gage II' }, name: 'Gage II' }
  });
  check('owner may edit', mine.statusCode === 200, `${mine.statusCode} ${mine.body}`);
  check('edit renames', mine.json().name === 'Gage II', mine.json().name);

  const missing = await call(miiById, { method: 'PUT', query: { id: 'nope' }, cookies: cookie });
  check('unknown id is 404', missing.statusCode === 404, `got ${missing.statusCode}`);
}

console.log('\nrate limiting');
{
  const ip = '198.51.100.77';
  const codes = [];
  for (let i = 0; i < 5; i++) {
    const r = await call(miis, {
      method: 'POST',
      headers: { 'x-forwarded-for': ip },
      body: { email: `rl${i}@example.com`, name: `RL${i}`, dna: DNA }
    });
    codes.push(r.statusCode);
  }
  const limited = codes.filter((c) => c === 429).length;
  check('caps creations per IP', limited >= 2, `codes: ${codes.join(',')}`);
  check('allows exactly the limit through', codes.filter((c) => c === 201).length === 3, codes.join(','));

  const other = await call(miis, {
    method: 'POST',
    headers: { 'x-forwarded-for': '198.51.100.88' },
    body: { email: 'fresh@example.com', name: 'Fresh', dna: DNA }
  });
  check('limit is per IP, not global', other.statusCode === 201, `got ${other.statusCode}`);
}

console.log('\nbadge signature');
{
  const { badgeUrl, badgeSignature, verifyBadgeSignature } = await import('../api/_lib/badge.js');
  const badgeVerify = (await import('../api/badge/verify.js')).default;

  const url = badgeUrl({ id: createdId }, 'https://example.test');
  check('badge url stays short enough to scan', url.length < 140, `${url.length} chars`);
  check('badge url carries a signature', /[?&]s=/.test(url));

  const sig = badgeSignature(createdId);
  check('signature verifies', verifyBadgeSignature(createdId, sig) === true);
  check('signature is bound to the id', verifyBadgeSignature('someone-else', sig) === false);
  check('tampered signature fails', verifyBadgeSignature(createdId, sig.slice(0, -1) + 'A') === false);

  const good = await call(badgeVerify, {
    method: 'GET', query: { id: createdId, s: sig }, headers: { accept: 'application/json' }
  });
  check('signed badge verifies over HTTP', good.statusCode === 200 && good.json().signed === true,
    JSON.stringify(good.json()));

  const forged = await call(badgeVerify, {
    method: 'GET', query: { id: createdId, s: 'AAAAAAAAAAAAAAAA' }, headers: { accept: 'application/json' }
  });
  check('forged signature is refused', forged.statusCode === 404, `got ${forged.statusCode}`);

  const unsigned = await call(badgeVerify, {
    method: 'GET', query: { id: createdId }, headers: { accept: 'application/json' }
  });
  check('unsigned legacy link still resolves', unsigned.statusCode === 200);
  check('but is reported as unsigned', unsigned.json().signed === false);

  const html = await call(badgeVerify, { method: 'GET', query: { id: createdId, s: sig } });
  check('serves HTML to a phone camera', /text\/html/.test(html.getHeader('content-type')));
  check('HTML names the holder', String(html.body).includes('Gage II'));
}

console.log('\nwallet');
{
  const res = await call(walletGoogle, { method: 'GET', query: { id: createdId } });
  const b = res.json();
  check('reports wallet unconfigured rather than crashing', res.statusCode === 503, `got ${res.statusCode}`);
  check('still hands back a QR fallback', Boolean(b && b.qrUrl));
}

console.log('\nmagic link');
{
  const res = await call(magicLink, { method: 'POST', body: { email: 'gage@example.com' } });
  check('degrades cleanly without Supabase/Resend', res.statusCode === 503, `got ${res.statusCode}`);
  check('says why', Boolean(res.json().code));
}

console.log('\nadmin');
{
  const denied = await call(adminList, { method: 'GET' });
  check('locked without a key', denied.statusCode === 401, `got ${denied.statusCode}`);
  check('sends a WWW-Authenticate challenge', Boolean(denied.getHeader('www-authenticate')));

  const wrong = await call(adminList, { method: 'GET', headers: { 'x-admin-key': 'nope' } });
  check('rejects a wrong key', wrong.statusCode === 401, `got ${wrong.statusCode}`);

  const ok = await call(adminList, { method: 'GET', headers: { 'x-admin-key': 'smoke-admin-key' } });
  const b = ok.json();
  check('unlocks with the key', ok.statusCode === 200, `got ${ok.statusCode}`);
  check('exposes emails to admins', Boolean(b.miis[0] && b.miis[0].email));

  const basic = 'Basic ' + Buffer.from('admin:smoke-admin-key').toString('base64');
  const viaBasic = await call(adminList, { method: 'GET', headers: { authorization: basic } });
  check('accepts HTTP basic auth', viaBasic.statusCode === 200, `got ${viaBasic.statusCode}`);

  const csv = await call(adminExport, { method: 'GET', headers: { 'x-admin-key': 'smoke-admin-key' } });
  check('exports CSV', csv.statusCode === 200 && /text\/csv/.test(csv.getHeader('content-type')));
  check('CSV has a header row', String(csv.body).includes('name,email,created_at'));
  check('CSV is an attachment', /attachment/.test(csv.getHeader('content-disposition') || ''));

  const adminDel = await call(adminList, {
    method: 'DELETE', query: { id: createdId }, headers: { 'x-admin-key': 'smoke-admin-key' }
  });
  check('admin can delete', adminDel.statusCode === 200, `got ${adminDel.statusCode}`);

  const after = await call(me, { method: 'GET', cookies: cookie });
  check('stale cookie is dropped after deletion', after.json().signedIn === false);
}

console.log('\nCSV injection');
{
  await call(miis, {
    method: 'POST',
    headers: { 'x-forwarded-for': '198.51.100.99' },
    body: { email: 'formula@example.com', name: '=SUM(A1)', dna: DNA }
  });
  const csv = await call(adminExport, { method: 'GET', headers: { 'x-admin-key': 'smoke-admin-key' } });
  check('neutralises leading = in a cell', String(csv.body).includes("\"'=SUM(A1)\""), 'not escaped');
}

console.log('\nSupabase project URL');
{
  const { projectBase } = await import('../api/_lib/env.js');
  const base = 'https://abc.supabase.co';
  /* A URL pasted from the API settings page carries /rest/v1. supabase-js
     appends that itself, and the doubled path 404s every query — which the
     plaza hides by falling back to per-device storage. */
  check('strips a trailing /rest/v1', projectBase(base + '/rest/v1') === base);
  check('strips /rest/v1 with a trailing slash', projectBase(base + '/rest/v1/') === base);
  check('strips other service paths', projectBase(base + '/auth/v1') === base);
  check('leaves a bare project URL alone', projectBase(base) === base);
  check('drops a lone trailing slash', projectBase(base + '/') === base);
  check('survives an unset value', projectBase('') === '' && projectBase(undefined) === '');
}

try { rmSync(STORE_FILE, { force: true }); } catch {}

/* The no-JWT_SECRET path needs a process where the secret was never set, since
 * the env module reads it once at import. Run it as a child and fold the
 * result in here so `npm run smoke` stays a single command. */
const child = spawnSync(
  process.execPath,
  [new URL('./smoke-nosession.mjs', import.meta.url).pathname],
  { encoding: 'utf8', env: { ...process.env, JWT_SECRET: '' } }
);
process.stdout.write(child.stdout || '');
if (child.stderr) process.stderr.write(child.stderr);
const childTally = /(\d+) passed, (\d+) failed/.exec(child.stdout || '');
if (childTally) {
  pass += Number(childTally[1]);
  fail += Number(childTally[2]);
} else {
  fail++;
  console.log('  ✗ no-session suite did not report a result');
}

console.log(`${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
