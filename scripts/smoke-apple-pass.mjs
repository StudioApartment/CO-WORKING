/* Proves we can pack a signed .pkpass. The signer is a throwaway cert —
 * Apple devices would reject it — so this only checks the zip shape, not
 * that Wallet would accept the pass. Real signing uses the Pass Type ID
 * cert from env.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'mii-pkpass-'));
const key = join(dir, 'key.pem');
const cert = join(dir, 'cert.pem');

const openssl = spawnSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048',
  '-keyout', key, '-out', cert, '-days', '1', '-nodes',
  '-subj', '/CN=pass.test.badge/O=Test/C=US'
], { encoding: 'utf8' });

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
};

check('openssl issued a throwaway signer', openssl.status === 0, openssl.stderr);

process.env.APPLE_PASS_TYPE_ID = 'pass.test.badge';
process.env.APPLE_TEAM_ID = 'TEAMID12';
process.env.APPLE_PASS_CERT = readFileSync(cert, 'utf8');
process.env.APPLE_PASS_KEY = readFileSync(key, 'utf8');
delete process.env.APPLE_WWDR_CERT;

const { buildApplePass, hasAppleWallet } = await import('../api/_lib/appleWallet.js');
check('Apple Wallet flag is on with certs', hasAppleWallet === true);

const buf = await buildApplePass({
  id: 'abc-123',
  name: 'Gage',
  email: 'gage@example.com',
  badgeValue: 'https://example.test/api/badge/verify?id=abc-123&s=sig',
  origin: 'https://example.test'
});

check('signed a pkpass buffer', Boolean(buf && buf.length > 100), buf && buf.length);
check('buffer looks like a zip', Boolean(buf && buf[0] === 0x50 && buf[1] === 0x4b));

const listing = buf ? buf.toString('binary') : '';
check('contains pass.json', listing.includes('pass.json'));
check('contains a signature', listing.includes('signature'));
check('contains an icon', listing.includes('icon.png'));
check('QR is in the pass', listing.includes('/api/badge/verify'));

try { rmSync(dir, { recursive: true, force: true }); } catch {}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
