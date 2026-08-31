/* Apple Wallet generic pass (.pkpass).
 *
 * Built on demand and either attached to the badge email or served from
 * /api/wallet/apple/:id. Mail on iPhone treats the attachment as a pass;
 * Safari follows the link and offers Add to Wallet.
 *
 * Signing needs a Pass Type ID cert from Apple Developer. Without it this
 * module returns null and the plaza still emails the QR. The WWDR
 * intermediate is vendored so operators only paste their own signer.
 *
 * https://developer.apple.com/documentation/walletpasses
 */

import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import QRCode from 'qrcode';
import {
  APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, APPLE_PASS_CERT, APPLE_PASS_KEY,
  APPLE_PASS_KEY_PASSPHRASE, APPLE_WWDR_CERT,
  hasAppleWallet, PUBLIC_ORIGIN
} from './env.js';

const BRAND = { r: 63, g: 169, b: 224 }; // #3fa9e0, same as Google Wallet

const bundledWwdr = () =>
  readFileSync(new URL('./certs/AppleWWDRCAG4.pem', import.meta.url));

/* ------------------------------------------------------------------ PNG -- */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function pngFill(width, height, { r, g, b }) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 3;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

const ICON = pngFill(87, 87, BRAND);
const LOGO = pngFill(320, 50, BRAND);

/* -------------------------------------------------------------- payload -- */

export function passPayload({ id, name, email, badgeValue, origin }) {
  const site = String(origin || PUBLIC_ORIGIN).replace(/\/$/, '');
  const who = String(name || 'Coworker').slice(0, 40);
  const qr = String(badgeValue || `${site}/mii`);
  return {
    formatVersion: 1,
    passTypeIdentifier: APPLE_PASS_TYPE_ID,
    teamIdentifier: APPLE_TEAM_ID,
    serialNumber: String(id).slice(0, 64),
    organizationName: 'CO—WORKING',
    description: `${who}'s coworker badge`,
    logoText: 'CO—WORKING',
    backgroundColor: 'rgb(63, 169, 224)',
    foregroundColor: 'rgb(255, 255, 255)',
    labelColor: 'rgb(230, 244, 252)',
    generic: {
      primaryFields: [{ key: 'name', label: 'Coworker', value: who }],
      secondaryFields: [{ key: 'role', label: 'Role', value: 'Coworker' }],
      backFields: [
        ...(email ? [{ key: 'email', label: 'Email', value: String(email) }] : []),
        { key: 'manage', label: 'Manage your Mii', value: `${site}/mii` },
        { key: 'id', label: 'Badge ID', value: String(id).slice(0, 8) }
      ]
    },
    barcodes: [{
      format: 'PKBarcodeFormatQR',
      message: qr,
      messageEncoding: 'iso-8859-1',
      altText: 'Scan at the door'
    }],
    barcode: {
      format: 'PKBarcodeFormatQR',
      message: qr,
      messageEncoding: 'iso-8859-1',
      altText: 'Scan at the door'
    }
  };
}

export function applePassUrl(id, origin) {
  if (!hasAppleWallet || !id) return null;
  const site = String(origin || PUBLIC_ORIGIN).replace(/\/$/, '');
  return `${site}/api/wallet/apple/${encodeURIComponent(id)}`;
}

export function passFileName(name) {
  const slug = String(name || 'coworker')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'coworker';
  return `${slug}-badge.pkpass`;
}

/**
 * Signed .pkpass buffer, or null when Wallet is not configured / signing fails.
 * Callers must not fail the badge create if this returns null.
 */
export async function buildApplePass(args) {
  if (!hasAppleWallet) return null;
  try {
    /* passkit-generator (via joi) blocks the event loop on first import, which
       used to freeze the whole local server as soon as /mii asked /api/miis.
       Load it only when we actually sign a pass. */
    const { PKPass } = await import('passkit-generator');
    const thumb = await QRCode.toBuffer(String(args.badgeValue || args.id), {
      type: 'png',
      width: 180,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#1b2a33ff', light: '#ffffffff' }
    });

    const pass = new PKPass(
      {
        'pass.json': Buffer.from(JSON.stringify(passPayload(args))),
        'icon.png': ICON,
        'icon@2x.png': ICON,
        'icon@3x.png': ICON,
        'logo.png': LOGO,
        'logo@2x.png': LOGO,
        'thumbnail.png': thumb,
        'thumbnail@2x.png': thumb
      },
      {
        wwdr: APPLE_WWDR_CERT || bundledWwdr(),
        signerCert: APPLE_PASS_CERT,
        signerKey: APPLE_PASS_KEY,
        signerKeyPassphrase: APPLE_PASS_KEY_PASSPHRASE || undefined
      }
    );
    return pass.getAsBuffer();
  } catch (e) {
    console.error('[apple wallet] could not sign pass', e && e.message || e);
    return null;
  }
}

export { hasAppleWallet };
