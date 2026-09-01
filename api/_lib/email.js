/* Transactional email via Resend.
 *
 * Sending is always best-effort: a badge is already saved and visible in the
 * The Office before we try to email it, so a Resend outage must not fail the
 * create request. Callers log the outcome and move on.
 */

import { Resend } from 'resend';
import { RESEND_API_KEY, RESEND_FROM, hasResend, PUBLIC_ORIGIN } from './env.js';

let client = null;
const resend = () => {
  if (!hasResend) return null;
  if (!client) client = new Resend(RESEND_API_KEY);
  return client;
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function resendReason(error) {
  if (!error) return 'resend_error';
  if (typeof error === 'string') return error;
  if (error.message) return error.message;
  try { return JSON.stringify(error); } catch { return 'resend_error'; }
}

/** Map Resend failures to something actionable in the UI / logs. */
export function emailSendError(reason) {
  const r = String(reason || '').toLowerCase();
  if (r.includes('domain') && (r.includes('verify') || r.includes('not verified')))
    return 'The coworking.fyi domain is not verified in Resend yet — add the DNS records in your Resend dashboard.';
  if (r.includes('only send') || r.includes('testing') || r.includes('verified email'))
    return 'Resend is still in test mode — verify coworking.fyi, or use the email address on your Resend account.';
  if (r.includes('invalid') && (r.includes('from') || r.includes('sender')))
    return 'The sender address is not allowed — set RESEND_FROM to a verified address like badges@coworking.fyi.';
  if (r.includes('api key') || r.includes('unauthorized') || r.includes('401'))
    return 'The Resend API key was rejected — check RESEND_API_KEY in Vercel.';
  return 'Could not send that email just now. Try again in a minute.';
}

const INK = '#3d4d58';
const MUTED = '#7d8f9c';
const BLUE = '#3fa9e0';
const BLUE_DK = '#1b7fbc';

function shell(bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your CO—WORKING badge</title>
</head>
<body style="margin:0;padding:0;background:#eef4f8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef4f8;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 2px 10px rgba(90,115,135,.14);font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
        ${bodyHtml}
      </table>
      <p style="max-width:560px;margin:16px auto 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:#9db0bd;text-align:center;">
        CO—WORKING · enterprise solutions for creative people
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(href, label) {
  return `<a href="${esc(href)}" style="display:inline-block;background:${BLUE};background-image:linear-gradient(${BLUE},${BLUE_DK});color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 26px;border-radius:999px;">${esc(label)}</a>`;
}

function darkButton(href, label) {
  return `<a href="${esc(href)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 26px;border-radius:999px;">${esc(label)}</a>`;
}

/**
 * Badge delivery — sent when a badge is claimed, not when someone later
 * changes their hair. The QR is the row id, so a new look does not need a
 * new pass.
 */
export async function sendBadgeEmail({
  to, name, miiId, previewUrl, qrUrl, walletUrl, appleWalletUrl, applePass,
  manageUrl, origin, isUpdate = false
}) {
  const api = resend();
  if (!api) return { sent: false, reason: 'resend_not_configured' };

  const site = (origin || PUBLIC_ORIGIN).replace(/\/$/, '');
  const manage = manageUrl || `${site}/`;

  const heading = isUpdate ? 'Your badge has been updated' : 'Your Coworking Badge is ready!';
  const intro = isUpdate
    ? 'You just changed your character, so here is a fresh badge. The old QR still works — add the new pass to replace the one in Apple Wallet.'
    : 'You are officially on the floor. Here is your badge and QR — add the pass to Apple Wallet so you never have to look for it.';

  const walletButtons = [
    appleWalletUrl ? darkButton(appleWalletUrl, 'Add to Apple Wallet') : '',
    walletUrl ? button(walletUrl, 'Add to Google Wallet') : ''
  ].filter(Boolean).join('&nbsp;&nbsp;');

  const html = shell(`
    <tr>
      <td style="padding:30px 32px 8px;">
        <p style="margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};font-weight:700;">CO—WORKING</p>
        <h1 style="margin:0;font-size:24px;line-height:1.25;color:${INK};">${esc(heading)}</h1>
        <p style="margin:12px 0 0;font-size:14px;line-height:1.65;color:${MUTED};">${esc(intro)}</p>
      </td>
    </tr>
    ${previewUrl ? `
    <tr>
      <td align="center" style="padding:22px 32px 0;">
        <img src="${esc(previewUrl)}" width="200" alt="${esc(name)}'s Co-Worker" style="display:block;width:200px;max-width:60%;height:auto;border:0;border-radius:14px;background:#f3f8fa;">
      </td>
    </tr>` : ''}
    <tr>
      <td align="center" style="padding:18px 32px 0;">
        <p style="margin:0;font-size:19px;font-weight:700;color:${INK};">${esc(name)}</p>
        <p style="margin:4px 0 0;font-size:12px;color:${MUTED};">Coworker</p>
      </td>
    </tr>
    ${qrUrl ? `
    <tr>
      <td align="center" style="padding:20px 32px 0;">
        <img src="${esc(qrUrl)}" width="168" height="168" alt="Badge QR code" style="display:block;width:168px;height:168px;border:0;border-radius:12px;border:1px solid #e2eaef;">
        <p style="margin:10px 0 0;font-size:11px;color:${MUTED};">Scan at the door</p>
      </td>
    </tr>` : ''}
    <tr>
      <td align="center" style="padding:26px 32px 0;">
        ${walletButtons
          || `<p style="margin:0;font-size:13px;color:${MUTED};">Wallet passes are not switched on yet — your QR above works in the meantime.</p>`}
      </td>
    </tr>
    ${applePass ? `
    <tr>
      <td align="center" style="padding:12px 32px 0;">
        <p style="margin:0;font-size:12px;color:${MUTED};">A Wallet pass is attached to this email. On iPhone, tap it to Add to Apple Wallet.</p>
      </td>
    </tr>` : ''}
    <tr>
      <td style="padding:26px 32px 30px;">
        <hr style="border:0;border-top:1px solid #e9eff3;margin:0 0 16px;">
        <p style="margin:0;font-size:12px;line-height:1.7;color:${MUTED};">
          Need to change your character or take it down?
          <a href="${esc(manage)}" style="color:${BLUE_DK};font-weight:700;text-decoration:none;">Manage your Co-Worker</a>.
          On a new device, use <strong>Load my Co-Worker</strong> there and we will email you a sign-in link.
        </p>
        <p style="margin:10px 0 0;font-size:11px;color:#a4b6c2;">Badge ID ${esc(String(miiId).slice(0, 8))}</p>
      </td>
    </tr>
  `);

  const text = [
    heading,
    '',
    intro,
    '',
    `Name: ${name}`,
    appleWalletUrl ? `Add to Apple Wallet: ${appleWalletUrl}` : '',
    walletUrl ? `Add to Google Wallet: ${walletUrl}` : '',
    qrUrl ? `Badge QR: ${qrUrl}` : '',
    '',
    `Manage your Co-Worker: ${manage}`
  ].filter(Boolean).join('\n');

  const attachments = [];
  if (applePass && Buffer.isBuffer(applePass)) {
    attachments.push({
      filename: `${String(name || 'coworker').replace(/[^\w.-]+/g, '-').slice(0, 24) || 'coworker'}-badge.pkpass`,
      content: applePass,
      contentType: 'application/vnd.apple.pkpass'
    });
  }

  try {
    const { data, error } = await api.emails.send({
      from: RESEND_FROM,
      to: [to],
      subject: isUpdate ? 'Your Coworking Badge was updated' : 'Your Coworking Badge is ready!',
      html,
      text,
      ...(attachments.length ? { attachments } : {})
    });
    if (error) return { sent: false, reason: resendReason(error) };
    return { sent: true, id: data?.id || null };
  } catch (e) {
    return { sent: false, reason: String((e && e.message) || e) };
  }
}

/** Magic link — the only way back in from a new device. */
export async function sendMagicLinkEmail({ to, name, link, minutes, origin }) {
  const api = resend();
  if (!api) return { sent: false, reason: 'resend_not_configured' };

  const site = (origin || PUBLIC_ORIGIN).replace(/\/$/, '');

  const html = shell(`
    <tr>
      <td style="padding:30px 32px 8px;">
        <p style="margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};font-weight:700;">CO—WORKING</p>
        <h1 style="margin:0;font-size:23px;line-height:1.25;color:${INK};">Load your Co-Worker</h1>
        <p style="margin:12px 0 0;font-size:14px;line-height:1.65;color:${MUTED};">
          ${name ? `Welcome back, ${esc(name)}. ` : ''}Tap the button to reconnect this browser to your character. The link works once and expires in ${esc(String(minutes))} minutes.
        </p>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:26px 32px 4px;">
        ${button(link, 'Load my Co-Worker')}
      </td>
    </tr>
    <tr>
      <td style="padding:22px 32px 30px;">
        <p style="margin:0;font-size:12px;line-height:1.7;color:${MUTED};">
          If the button does not work, paste this into your browser:<br>
          <span style="word-break:break-all;color:${BLUE_DK};">${esc(link)}</span>
        </p>
        <p style="margin:14px 0 0;font-size:11px;color:#a4b6c2;">
          Did not ask for this? Ignore it — nothing changes until the link is opened. ${esc(site)}
        </p>
      </td>
    </tr>
  `);

  const text = [
    'Load your Co-Worker',
    '',
    `Open this link to reconnect your browser (expires in ${minutes} minutes, single use):`,
    link
  ].join('\n');

  try {
    const { data, error } = await api.emails.send({
      from: RESEND_FROM,
      to: [to],
      subject: 'Load your Co-Worker',
      html,
      text
    });
    if (error) return { sent: false, reason: resendReason(error) };
    return { sent: true, id: data?.id || null };
  } catch (e) {
    return { sent: false, reason: String((e && e.message) || e) };
  }
}

export { hasResend };
