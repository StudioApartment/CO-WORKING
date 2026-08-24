/* Central environment access.
 *
 * The brief was written against a Next.js app, so the canonical names carry
 * the NEXT_PUBLIC_ prefix. This project is a static site with Vercel
 * functions, where that prefix means nothing — so both spellings are accepted
 * and the unprefixed one wins when set. That keeps a .env.local copied from
 * the brief working untouched.
 */

const pick = (...names) => {
  for (const n of names) {
    const v = process.env[n];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
};

export const SUPABASE_URL = pick('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
export const SUPABASE_ANON_KEY = pick('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
export const SUPABASE_SERVICE_ROLE_KEY = pick('SUPABASE_SERVICE_ROLE_KEY');

export const RESEND_API_KEY = pick('RESEND_API_KEY');
export const RESEND_FROM = pick('RESEND_FROM') || 'CO—WORKING <badges@coworking.fyi>';

export const GOOGLE_ISSUER_ID = pick('GOOGLE_ISSUER_ID');
export const GOOGLE_SERVICE_ACCOUNT_EMAIL = pick('GOOGLE_SERVICE_ACCOUNT_EMAIL');
// Vercel's UI stores newlines escaped; restore them so the PEM parses.
export const GOOGLE_PRIVATE_KEY = pick('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n');

export const ADMIN_SECRET_KEY = pick('ADMIN_SECRET_KEY', 'ADMIN_KEY');
export const JWT_SECRET = pick('JWT_SECRET');

export const PUBLIC_ORIGIN =
  pick('PUBLIC_ORIGIN', 'SITE_ORIGIN') ||
  (pick('VERCEL_PROJECT_PRODUCTION_URL') && `https://${pick('VERCEL_PROJECT_PRODUCTION_URL')}`) ||
  (pick('VERCEL_URL') && `https://${pick('VERCEL_URL')}`) ||
  'https://coworking.fyi';

/* Feature flags — every integration degrades on its own rather than taking
 * the page down with it. An unprovisioned deploy still renders a plaza. */
export const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
export const hasRealtime = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const hasResend = Boolean(RESEND_API_KEY);
export const hasGoogleWallet = Boolean(
  GOOGLE_ISSUER_ID && GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_PRIVATE_KEY
);
export const hasAdmin = Boolean(ADMIN_SECRET_KEY);

/* Sessions are signed, so a missing secret must not silently downgrade to an
 * unsigned or predictable one. Callers check `hasSessions` first. */
export const hasSessions = Boolean(JWT_SECRET && JWT_SECRET.length >= 16);

export function originFrom(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) return PUBLIC_ORIGIN;
  return `${proto || 'https'}://${host}`;
}
