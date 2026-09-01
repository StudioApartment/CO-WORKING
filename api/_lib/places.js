/* Places autocomplete (GET /api/places via /api/config rewrite)?q=
 *
 * City / ZIP autocomplete for the badge form. The browser never talks to
 * geocoders directly (CORS + usage policies). Zippopotam covers US ZIPs;
 * Photon covers typed city names.
 */

import { send, methodNotAllowed, preflight } from './http.js';

const UA = 'CO-WORKING office locations (https://www.coworking.fyi)';
const ZIP = /^\d{5}(?:-\d{4})?$/;
const PLACE_KIND = new Set([
  'city', 'town', 'village', 'hamlet', 'suburb', 'municipality',
  'neighbourhood', 'county'
]);

const USPS = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS',
  Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI',
  Wyoming: 'WY', 'District of Columbia': 'DC'
};

function regionAbbr(state) {
  const s = String(state || '').trim();
  if (!s) return '';
  if (/^[A-Z]{2}$/.test(s)) return s;
  return USPS[s] || s;
}

async function fetchJson(url, ms = 3500) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ac.signal
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function pack({ label, city, region = '', country = '', zip = '' }) {
  const loc = {
    label: String(label || '').slice(0, 80),
    city: String(city || '').slice(0, 60),
    region: String(region || '').slice(0, 40),
    country: String(country || '').slice(0, 8),
    zip: String(zip || '').slice(0, 10)
  };
  return loc.label ? loc : null;
}

async function fromZip(zip) {
  const five = String(zip).slice(0, 5);
  const data = await fetchJson(`https://api.zippopotam.us/us/${five}`);
  const p = data && Array.isArray(data.places) ? data.places[0] : null;
  if (!p) return [];
  const city = p['place name'];
  const region = p['state abbreviation'] || regionAbbr(p.state);
  return [pack({
    label: region ? `${city}, ${region}` : city,
    city, region, country: 'US', zip: five
  })].filter(Boolean);
}

async function fromPhoton(q) {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '10');
  url.searchParams.set('lang', 'en');
  const data = await fetchJson(url);
  const out = [];
  const seen = new Set();
  for (const f of (data && data.features) || []) {
    const p = f.properties || {};
    const kind = p.osm_value || '';
    if (p.osm_key && p.osm_key !== 'place' && p.osm_key !== 'boundary') continue;
    if (kind && !PLACE_KIND.has(kind) && kind !== 'state') continue;
    const city = p.name;
    if (!city) continue;
    const cc = String(p.countrycode || '').toUpperCase();
    const region = regionAbbr(p.state);
    const label = region
      ? `${city}, ${region}`
      : (cc && cc !== 'US' ? `${city}, ${cc}` : city);
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const loc = pack({
      label, city, region, country: cc,
      zip: String(p.postcode || '').replace(/\s+/g, '').slice(0, 10)
    });
    if (loc) out.push(loc);
  }
  out.sort((a, b) => Number(b.country === 'US') - Number(a.country === 'US'));
  return out.slice(0, 6);
}

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const q = String((req.query && req.query.q) || new URL(req.url, 'http://x').searchParams.get('q') || '')
    .trim()
    .slice(0, 80);

  if (q.length < 2 && !ZIP.test(q)) {
    res.setHeader('cache-control', 'public, max-age=30');
    return send(res, 200, { places: [] });
  }

  const places = ZIP.test(q) ? await fromZip(q) : await fromPhoton(q);
  res.setHeader('cache-control', 'public, max-age=120');
  return send(res, 200, { places });
}
