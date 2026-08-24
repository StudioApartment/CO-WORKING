/* Badge tokens and QR codes.
 *
 * The QR encodes a signed token rather than a bare row id, so a scanner at the
 * door can verify a badge is one we issued without a database round trip, and
 * a guessed id is not a valid badge.
 */

import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { JWT_SECRET, hasSessions, PUBLIC_ORIGIN } from './env.js';

export const BADGE_AUDIENCE = 'mii-badge';

export function badgeToken({ id, name, email }) {
  if (!hasSessions) return null;
  return jwt.sign(
    { sub: id, name, email },
    JWT_SECRET,
    { issuer: 'mii-plaza', audience: BADGE_AUDIENCE, expiresIn: '365d' }
  );
}

export function verifyBadgeToken(token) {
  if (!hasSessions || !token) return null;
  try {
    return jwt.verify(token, JWT_SECRET, { issuer: 'mii-plaza', audience: BADGE_AUDIENCE });
  } catch {
    return null;
  }
}

/* What the QR actually resolves to. A phone camera lands on a human page that
 * confirms the badge; the token travels in the fragment-free query so it can
 * be verified server side. */
export function badgeUrl({ id, name, email }, origin = PUBLIC_ORIGIN) {
  const token = badgeToken({ id, name, email });
  const base = `${origin.replace(/\/$/, '')}/api/badge/verify`;
  return token ? `${base}?t=${encodeURIComponent(token)}` : `${base}?id=${encodeURIComponent(id)}`;
}

/* High-resolution so it survives being printed on a lanyard card. */
export const QR_OPTIONS = {
  errorCorrectionLevel: 'H',
  margin: 2,
  width: 1024,
  color: { dark: '#1b2a33ff', light: '#ffffffff' }
};

export const qrPngBuffer = (text) => QRCode.toBuffer(text, { ...QR_OPTIONS, type: 'png' });
export const qrDataUrl = (text) => QRCode.toDataURL(text, QR_OPTIONS);

/* Email clients routinely strip data URIs, so templates point at this instead. */
export const qrImageUrl = (id, origin = PUBLIC_ORIGIN) =>
  `${origin.replace(/\/$/, '')}/api/qr/${encodeURIComponent(id)}`;
