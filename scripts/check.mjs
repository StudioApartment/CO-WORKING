/* Pre-deploy sanity check.
 *
 * Vercel functions are only exercised at request time, so a typo in an import
 * would otherwise surface as a 500 in production. This loads every route the
 * way the runtime does and asserts it exports a handler.
 *
 * Run with: npm run check
 */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const API = join(ROOT, 'api');

let failures = 0;
const note = (icon, msg) => console.log(`${icon} ${msg}`);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = walk(API).sort();
const routes = files.filter((f) => !relative(API, f).split(/[/\\]/).some((p) => p.startsWith('_')));

console.log(`\nChecking ${files.length} modules (${routes.length} routes)\n`);

for (const file of files) {
  const rel = relative(ROOT, file);
  try {
    const mod = await import(pathToFileURL(file).href);
    const isRoute = routes.includes(file);
    if (isRoute && typeof mod.default !== 'function') {
      note('✗', `${rel} — route has no default export function`);
      failures++;
    } else {
      note('✓', rel);
    }
  } catch (e) {
    note('✗', `${rel} — ${e.message}`);
    failures++;
  }
}

/* The client is a single HTML file with an inline module; node cannot import it,
 * so check the balance of the script block and a few required hooks instead. */
console.log('\nChecking client\n');

for (const page of ['mii.html', 'admin.html']) {
  try {
    const src = readFileSync(join(ROOT, page), 'utf8');
    const opens = (src.match(/<script/g) || []).length;
    const closes = (src.match(/<\/script>/g) || []).length;
    if (opens !== closes) {
      note('✗', `${page} — ${opens} <script> vs ${closes} </script>`);
      failures++;
      continue;
    }
    note('✓', `${page} (${opens} script blocks)`);
  } catch (e) {
    note('✗', `${page} — ${e.message}`);
    failures++;
  }
}

const required = [
  ['mii.html', ['camEmailRow', 'camBanner', 'camBadge', 'badgeWallet', 'badgeAppleWallet', 'camRecover', 'mineChip']],
  ['admin.html', ['gateForm', 'rows', 'btnExport']]
];
for (const [page, ids] of required) {
  const src = readFileSync(join(ROOT, page), 'utf8');
  for (const id of ids) {
    if (!src.includes(`id="${id}"`)) {
      note('✗', `${page} — missing #${id}`);
      failures++;
    }
  }
}

/* Relative `api/miis` from a nested path 404s, the plaza falls back to
 * localStorage, and the "Office is offline" toast fires even when the
 * functions are healthy. The client must pin every route at /api/. */
{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (src.includes("fetch('api/") || src.includes('fetch("api/')) {
    note('✗', 'mii.html — relative api/ fetch would 404 from a nested path');
    failures++;
  } else if (!src.includes("fetch('/api/config'") || !src.includes("expectsCloud()")) {
    note('✗', 'mii.html — missing root-absolute /api/config fetch or expectsCloud()');
    failures++;
  } else if (!src.includes("location.hostname === 'coworking.fyi'")) {
    note('✗', 'mii.html — missing apex→www bounce (phones otherwise see the office as offline)');
    failures++;
  } else {
    note('✓', 'mii.html pins API calls at /api/ and keys claiming off Config');
  }
}

console.log(
  failures ? `\n${failures} problem(s) found\n` : '\nAll clear\n'
);
process.exit(failures ? 1 : 0);
