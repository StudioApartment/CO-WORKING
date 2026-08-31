/* Stamp known office locations onto existing plaza rows.
 *
 * Gage → New York City, NY
 * James Acklin → Pittsburgh, PA
 *
 * Usage: node scripts/backfill-locations.mjs
 * Needs .env.local with Supabase service-role credentials.
 * Talks to PostgREST directly so we do not need node_modules.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ENV_FILE = join(ROOT, '.env.local');
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (v && !process.env[m[1]]) process.env[m[1]] = v;
  }
}

const NYC = { label: 'New York City, NY', city: 'New York City', region: 'NY', country: 'US', zip: '' };
const PGH = { label: 'Pittsburgh, PA', city: 'Pittsburgh', region: 'PA', country: 'US', zip: '' };

function placeFor(name) {
  const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (n === 'gage' || n === 'gage salzano') return NYC;
  if (n === 'james' || n === 'james acklin') return PGH;
  return null;
}

const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('No Supabase service role in the environment — skipping.');
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: 'Bearer ' + key,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal'
};

const listRes = await fetch(url + '/rest/v1/miis?select=id,name,mii_data', { headers });
if (!listRes.ok) {
  console.error('list failed', listRes.status, await listRes.text());
  process.exit(1);
}
const rows = await listRes.json();

let wrote = 0;
for (const row of rows || []) {
  const want = placeFor(row.name) || placeFor(row.mii_data && row.mii_data.name);
  if (!want) continue;
  if (row.mii_data && row.mii_data.location && row.mii_data.location.label === want.label) {
    console.log('= already', row.name, want.label);
    continue;
  }
  const dna = { ...(row.mii_data || {}), location: want };
  const up = await fetch(url + '/rest/v1/miis?id=eq.' + encodeURIComponent(row.id), {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ mii_data: dna })
  });
  if (!up.ok) {
    console.error('✗', row.name, up.status, await up.text());
    continue;
  }
  wrote += 1;
  console.log('✓', row.name, '→', want.label);
}

console.log(wrote ? `\nUpdated ${wrote} row(s)\n` : '\nNothing to update\n');
