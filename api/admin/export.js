/* GET /api/admin/export -> CSV of every registered coworker
 *
 * Intended for seeding campaigns, so it leads with name and email.
 */

import { sendText, send, methodNotAllowed } from '../_lib/http.js';
import { requireAdmin } from '../_lib/session.js';
import * as store from '../_lib/store.js';

/* RFC 4180 quoting, plus a guard against spreadsheet formula injection: a cell
 * starting with =, +, - or @ is executed by Excel and Sheets on open. */
function cell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export default async function handler(req, res) {
  try {
    if (!requireAdmin(req, res, send)) return;
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

    const rows = await store.listAllAdmin();
    const header = ['name', 'email', 'created_at', 'updated_at', 'id'];
    const lines = [header.join(',')];

    for (const r of rows) {
      lines.push([
        cell(r.name),
        cell(r.email),
        cell(r.created_at),
        cell(r.updated_at),
        cell(r.id)
      ].join(','));
    }

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('content-disposition', `attachment; filename="coworking-miis-${stamp}.csv"`);
    // BOM so Excel reads UTF-8 names correctly.
    return sendText(res, 200, '\uFEFF' + lines.join('\r\n') + '\r\n', 'text/csv; charset=utf-8');
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}
