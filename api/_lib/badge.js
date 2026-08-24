/* Badge signatures and QR codes.
 *
 * The QR carries the row id plus a short keyed signature rather than a full
 * JWT. A JWT pushed the payload past 300 characters, which forces a dense
 * version-20-plus symbol — unreliable to scan from a phone at door-sign size.
 * A truncated HMAC keeps the URL near 80 characters while still being
 * unforgeable without JWT_SECRET, so a guessed id is not a valid badge.
 *
 * There is deliberately no expiry: a badge should keep working as long as the
 * row exists, and revocation is deleting the row.
 */

import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { JWT_SECRET, hasSessions, PUBLIC_ORIGIN } from './env.js';

/* 16 base64url chars ≈ 96 bits, far beyond guessing, and cheap to encode. */
const SIG_LENGTH = 16;

export function badgeSignature(id) {
  if (!hasSessions) return null;
  return crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`badge:${id}`)
    .digest('base64url')
    .slice(0, SIG_LENGTH);
}

export function verifyBadgeSignature(id, sig) {
  const expected = badgeSignature(id);
  if (!expected || !sig) return false;
  const a = Buffer.from(String(sig), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* Where a scanned badge lands: a human-readable confirmation page. */
export function badgeUrl({ id }, origin = PUBLIC_ORIGIN) {
  const base = `${String(origin).replace(/\/$/, '')}/api/badge/verify`;
  const sig = badgeSignature(id);
  return sig
    ? `${base}?id=${encodeURIComponent(id)}&s=${sig}`
    : `${base}?id=${encodeURIComponent(id)}`;
}

/* Medium correction is the usual choice for a URL this short: it still
 * tolerates a scuffed lanyard card without inflating the module count. */
export const QR_OPTIONS = {
  errorCorrectionLevel: 'M',
  margin: 2,
  width: 1024,
  color: { dark: '#1b2a33ff', light: '#ffffffff' }
};

export const qrPngBuffer = (text) => QRCode.toBuffer(text, { ...QR_OPTIONS, type: 'png' });
export const qrDataUrl = (text) => QRCode.toDataURL(text, QR_OPTIONS);

/* Email clients routinely strip data URIs, and Google Wallet fetches artwork
 * over HTTPS, so both are pointed at this endpoint instead. */
export const qrImageUrl = (id, origin = PUBLIC_ORIGIN) =>
  `${String(origin).replace(/\/$/, '')}/api/qr/${encodeURIComponent(id)}`;
