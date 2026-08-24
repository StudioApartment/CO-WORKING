/* GET /api/badge/verify?t=<signed token>   (or ?id=<legacy id>)
 *
 * Where a scanned badge QR lands. Phone cameras open this in a browser, so it
 * answers in HTML for people and JSON for anything asking for it.
 */

import { send, sendText, methodNotAllowed } from '../_lib/http.js';
import { verifyBadgeToken } from '../_lib/badge.js';
import * as store from '../_lib/store.js';
import { previewUrlFor } from '../_lib/supabase.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function page({ ok, name, since, previewUrl, reason }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ok ? 'Badge verified' : 'Badge not valid'} · CO—WORKING</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box;margin:0}
  body{min-height:100dvh;display:grid;place-items:center;padding:24px;
    background:radial-gradient(125% 95% at 50% 20%,#fff,#eef4f8 60%,#d7e4ee);
    font-family:"Avenir Next Rounded","Nunito","Varela Round",system-ui,sans-serif;color:#3d4d58}
  .card{width:100%;max-width:360px;background:#fff;border-radius:22px;padding:30px 26px;text-align:center;
    box-shadow:0 2px 12px rgba(90,115,135,.16),0 0 0 3px #fff,0 0 0 4px #d2dde4}
  .mark{width:62px;height:62px;border-radius:50%;display:grid;place-items:center;margin:0 auto 16px;
    font-size:30px;font-weight:800;color:#fff}
  .ok .mark{background:linear-gradient(#5ed39a,#2fae76)}
  .no .mark{background:linear-gradient(#f08b84,#d0453c)}
  h1{font-size:20px;margin-bottom:6px}
  p{font-size:13px;color:#7d8f9c;line-height:1.6}
  img{width:150px;height:150px;object-fit:contain;border-radius:14px;background:#f3f8fa;margin:14px auto 0;display:block}
  .name{font-size:23px;font-weight:800;margin-top:14px}
  .eyebrow{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#a4b6c2;font-weight:800;margin-bottom:10px}
  a{display:inline-block;margin-top:20px;font-size:12px;font-weight:800;color:#1b7fbc;text-decoration:none}
</style></head>
<body>
  <div class="card ${ok ? 'ok' : 'no'}">
    <p class="eyebrow">CO—WORKING</p>
    <div class="mark">${ok ? '&check;' : '&times;'}</div>
    ${ok ? `
      <h1>Badge verified</h1>
      ${previewUrl ? `<img src="${esc(previewUrl)}" alt="${esc(name)}'s Mii">` : ''}
      <p class="name">${esc(name)}</p>
      <p>Coworker${since ? ` · since ${esc(since)}` : ''}</p>
    ` : `
      <h1>Badge not valid</h1>
      <p>${esc(reason || 'We could not verify this badge.')}</p>
    `}
    <a href="/mii">Go to the plaza &rarr;</a>
  </div>
</body></html>`;
}

const wantsJson = (req) => {
  const a = String(req.headers.accept || '');
  return a.includes('application/json') && !a.includes('text/html');
};

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

    const q = req.query || {};
    const token = String(q.t || q.token || '');
    const claims = token ? verifyBadgeToken(token) : null;
    const id = claims?.sub || String(q.id || '');

    const fail = (reason) => wantsJson(req)
      ? send(res, 404, { valid: false, reason })
      : sendText(res, 404, page({ ok: false, reason }), 'text/html; charset=utf-8');

    if (token && !claims) return fail('This badge signature did not check out.');
    if (!id) return fail('No badge in that link.');

    const record = await store.getById(id);
    if (!record) return fail('That badge is no longer active.');

    const since = record.created_at
      ? new Date(record.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      : '';

    if (wantsJson(req)) {
      return send(res, 200, {
        valid: true,
        id: record.id,
        name: record.name,
        since,
        signed: Boolean(claims)
      });
    }

    res.setHeader('cache-control', 'no-store');
    return sendText(
      res, 200,
      page({ ok: true, name: record.name, since, previewUrl: previewUrlFor(record.id) }),
      'text/html; charset=utf-8'
    );
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}
