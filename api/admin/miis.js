/* GET    /api/admin/miis        -> every Mii, emails included
 * DELETE /api/admin/miis?id=... -> remove one
 *
 * Gated on ADMIN_SECRET_KEY presented per request. Deleting here also fires the
 * Supabase Realtime DELETE event, so open plazas animate the character out
 * without anyone refreshing.
 */

import { send, methodNotAllowed } from '../_lib/http.js';
import { requireAdmin } from '../_lib/session.js';
import * as store from '../_lib/store.js';
import { previewUrlFor } from '../_lib/supabase.js';

export default async function handler(req, res) {
  try {
    if (!requireAdmin(req, res, send)) return;

    if (req.method === 'GET') {
      const rows = await store.listAllAdmin();
      return send(res, 200, {
        total: rows.length,
        storage: store.usingSupabase ? 'supabase' : 'legacy',
        miis: rows.map((r) => ({
          id: r.id,
          name: r.name,
          email: r.email,
          created_at: r.created_at,
          updated_at: r.updated_at,
          previewUrl: previewUrlFor(r.id)
        }))
      });
    }

    if (req.method === 'DELETE') {
      const id = String((req.query && req.query.id) || '').slice(0, 64);
      if (!id) return send(res, 400, { error: 'missing id' });

      const record = await store.getById(id);
      if (!record) return send(res, 404, { error: 'not found' });

      await store.remove(id);
      return send(res, 200, { ok: true, id });
    }

    return methodNotAllowed(res, ['GET', 'DELETE']);
  } catch (e) {
    if (e instanceof store.StoreError) return send(res, e.status, { error: e.message });
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}
