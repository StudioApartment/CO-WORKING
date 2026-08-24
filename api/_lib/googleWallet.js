/* Google Wallet generic pass.
 *
 * Implemented as a signed "save" JWT rather than through the passes SDK: the
 * JWT may carry the class and object definitions inline, which means no
 * pre-provisioning call and no extra dependency for a single endpoint.
 *
 * https://developers.google.com/wallet/generic/web
 */

import jwt from 'jsonwebtoken';
import {
  GOOGLE_ISSUER_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY,
  hasGoogleWallet, PUBLIC_ORIGIN
} from './env.js';

const CLASS_SUFFIX = 'coworking_badge_v1';

export const classId = () => `${GOOGLE_ISSUER_ID}.${CLASS_SUFFIX}`;
/* Object ids must be unique per issuer and stable per holder, so the row id
 * doubles as the suffix — re-saving updates the same pass instead of stacking
 * duplicates in the wallet. */
export const objectId = (miiId) => `${GOOGLE_ISSUER_ID}.${String(miiId).replace(/[^\w.-]/g, '')}`;

const BRAND_BG = '#3fa9e0';

function genericClass() {
  return {
    id: classId(),
    classTemplateInfo: {
      cardTemplateOverride: {
        cardRowTemplateInfos: [
          {
            twoItems: {
              startItem: {
                firstValue: {
                  fields: [{ fieldPath: "object.textModulesData['member_since']" }]
                }
              },
              endItem: {
                firstValue: {
                  fields: [{ fieldPath: "object.textModulesData['role']" }]
                }
              }
            }
          }
        ]
      }
    }
  };
}

function genericObject({ id, name, email, previewUrl, qrUrl, badgeValue, origin }) {
  const site = (origin || PUBLIC_ORIGIN).replace(/\/$/, '');
  const obj = {
    id: objectId(id),
    classId: classId(),
    state: 'ACTIVE',
    hexBackgroundColor: BRAND_BG,
    cardTitle: { defaultValue: { language: 'en-US', value: 'CO—WORKING' } },
    header: { defaultValue: { language: 'en-US', value: name } },
    subheader: { defaultValue: { language: 'en-US', value: 'Coworker badge' } },
    barcode: {
      type: 'QR_CODE',
      value: badgeValue,
      alternateText: name
    },
    textModulesData: [
      { id: 'role', header: 'Role', body: 'Coworker' },
      {
        id: 'member_since',
        header: 'Member since',
        body: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      }
    ],
    linksModuleData: {
      uris: [
        { uri: `${site}/mii`, description: 'Manage my Mii', id: 'manage' },
        { uri: 'https://coworking.fyi', description: 'coworking.fyi', id: 'site' }
      ]
    }
  };

  if (previewUrl) {
    obj.imageModulesData = [{
      id: 'mii_preview',
      mainImage: {
        sourceUri: { uri: previewUrl },
        contentDescription: { defaultValue: { language: 'en-US', value: `${name}'s Mii` } }
      }
    }];
    obj.heroImage = {
      sourceUri: { uri: previewUrl },
      contentDescription: { defaultValue: { language: 'en-US', value: `${name}'s Mii` } }
    };
  }

  if (qrUrl) {
    obj.logo = {
      sourceUri: { uri: qrUrl },
      contentDescription: { defaultValue: { language: 'en-US', value: 'Badge QR code' } }
    };
  }

  if (email) obj.textModulesData.push({ id: 'email', header: 'Email', body: email });

  return obj;
}

/**
 * Returns the official save link, or null when Wallet credentials are absent.
 */
export function walletSaveUrl(args) {
  if (!hasGoogleWallet) return null;

  const claims = {
    iss: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: [(args.origin || PUBLIC_ORIGIN).replace(/\/$/, '')],
    payload: {
      genericClasses: [genericClass()],
      genericObjects: [genericObject(args)]
    }
  };

  const token = jwt.sign(claims, GOOGLE_PRIVATE_KEY, { algorithm: 'RS256' });
  return `https://pay.google.com/gp/v/save/${token}`;
}

export { hasGoogleWallet };
