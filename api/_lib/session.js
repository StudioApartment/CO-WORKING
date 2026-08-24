/* Accountless sessions.
 *
 * A session is a signed statement that the bearer owns one Mii row. It lives
 * in an HTTP-only cookie, so page scripts cannot read or forge it, and it
 * carries no privileges beyond that single id. Losing the cookie is recovered
 * by email (see api/auth/magic-link.js), never by a password.
 */

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, hasSessions, ADMIN_SECRET_KEY, hasAdmin } from './env.js';
import { parseCookies, appendCookie, serializeCookie, timingSafeEqualStr } from './http.js';

export const SESSION_COOKIE = 'mii_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 365; // a badge should outlive a laptop reboot
export const MAGIC_LINK_TTL_SECONDS = 60 * 15;

export function issueSession(res, { miiId, email }) {
  if (!hasSessions) return null;
  const token = jwt.sign(
    { sub: miiId, email },
    JWT_SECRET,
    { expiresIn: SESSION_TTL_SECONDS, issuer: 'mii-plaza' }
  );
  appendCookie(res, serializeCookie(SESSION_COOKIE, token, {
    maxAge: SESSION_TTL_SECONDS,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax'
  }));
  return token;
}

export function clearSession(res) {
  appendCookie(res, serializeCookie(SESSION_COOKIE, '', {
    maxAge: 0,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax'
  }));
}

export function readSession(req) {
  if (!hasSessions) return null;
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw) return null;
  try {
    const claims = jwt.verify(raw, JWT_SECRET, { issuer: 'mii-plaza' });
    if (!claims || typeof claims.sub !== 'string') return null;
    return { miiId: claims.sub, email: typeof claims.email === 'string' ? claims.email : null };
  } catch {
    return null;
  }
}

/* Admin is a shared secret presented per request, not a session — there is no
 * admin cookie to steal from a browser that merely visited /admin. */
export function isAdmin(req) {
  if (!hasAdmin) return false;
  const header = req.headers['x-admin-key'] || req.headers['x-admin'] || '';
  if (header && timingSafeEqualStr(header, ADMIN_SECRET_KEY)) return true;

  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const pass = decoded.slice(decoded.indexOf(':') + 1);
      if (timingSafeEqualStr(pass, ADMIN_SECRET_KEY)) return true;
    } catch { /* fall through to deny */ }
  }
  return false;
}

export function requireAdmin(req, res, send) {
  if (isAdmin(req)) return true;
  res.setHeader('www-authenticate', 'Basic realm="Mii Plaza admin", charset="UTF-8"');
  send(res, 401, { error: 'admin key required' });
  return false;
}

/* ---------------------------------------------------------- magic tokens -- */

export const makeMagicToken = () => crypto.randomBytes(32).toString('base64url');
export const hashMagicToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
