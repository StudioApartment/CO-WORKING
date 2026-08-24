/* GET /api/config
 *
 * Bootstrap for the browser. This is a static site, so there is no build step
 * to inline public keys — the client asks for them at runtime instead.
 *
 * Only publishable values appear here. The anon key is designed to be public
 * and is useless without the RLS policies and column grants in
 * supabase/schema.sql.
 */

import { send, methodNotAllowed, preflight } from './_lib/http.js';
import { clientConfig } from './_lib/supabase.js';
import { hasRealtime, hasGoogleWallet, hasResend, hasSessions, hasAdmin } from './_lib/env.js';
import { usingSupabase } from './_lib/store.js';

export default function handler(req, res) {
  if (preflight(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const { supabaseUrl, supabaseAnonKey } = clientConfig();

  res.setHeader('cache-control', 'public, max-age=60');
  return send(res, 200, {
    storage: usingSupabase ? 'supabase' : 'legacy',
    realtime: hasRealtime,
    supabaseUrl: hasRealtime ? supabaseUrl : null,
    supabaseAnonKey: hasRealtime ? supabaseAnonKey : null,
    features: {
      sessions: hasSessions,
      email: hasResend,
      googleWallet: hasGoogleWallet,
      admin: hasAdmin
    }
  });
}
