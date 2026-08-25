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
  ['mii.html', ['camEmailRow', 'camBanner', 'camBadge', 'badgeWallet', 'badgeAppleWallet', 'badgeMii', 'badgeEmail', 'badgeSince', 'camRecover', 'mineChip']],
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
    const listBlock = src.match(/async list\(\) \{[\s\S]*?\n  \},\n\n  \/\*\*/);
    if (!listBlock) {
      note('✗', 'mii.html — could not find Store.list()');
      failures++;
    } else if (listBlock[0].includes('_head(') || !listBlock[0].includes("credentials: 'omit'")) {
      note('✗', 'mii.html — list() must be a simple GET (credentials omit, no x-token)');
      failures++;
    } else {
      note('✓', 'mii.html pins API calls at /api/ and keys claiming off Config');
    }
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("key: 'hat', label: 'Hat'") || !src.includes("key: 'apparel', label: 'Top'")) {
    note('✗', 'mii.html — tray should say Hat and Top, not Headwear / Outfit');
    failures++;
  } else if (!src.includes("closest('#camPalette')")) {
    note('✗', 'mii.html — colour palette must close when tapping outside it');
    failures++;
  } else {
    note('✓', 'mii.html labels Hat / Top and dismisses the colour overlay');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const accept = src.match(/async accept\(\) \{[\s\S]*?this\.showBadge\(rec/);
  if (!accept) {
    note('✗', 'mii.html — could not find Cam.accept() → showBadge');
    failures++;
  } else if (/if\s*\(\s*res\.local\s*\)/.test(accept[0]) && accept[0].includes('this.close()')) {
    note('✗', 'mii.html — a local save must still show the badge card');
    failures++;
  } else {
    note('✓', 'mii.html shows the badge card after a local or server claim');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes('function trayIsOff') || !src.includes('cyc-clear')) {
    note('✗', 'mii.html — style tray should step linearly and offer a clear control');
    failures++;
  } else if (!src.includes('(i + 1) % options.length')) {
    note('✗', 'mii.html — style tray should cycle options in order');
    failures++;
  } else {
    note('✓', 'mii.html style tray steps in order with a clear button');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes('afro: (r) => geoCache') || src.includes("add(G.ball(), 0, 0.74, -0.08")) {
    note('✗', 'mii.html — afro should wrap the head, not sit as a top ball');
    failures++;
  } else if (!src.includes('function hairFrame') || !src.includes('applySideburnsNape')) {
    note('✗', 'mii.html — volumetric hair should shape sideburns and the nape');
    failures++;
  } else {
    note('✓', 'mii.html afro wraps the whole head with sideburns and nape');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("geoCache(`shcurl${r}`") || !src.includes("'shortcurl'")) {
    note('✗', 'mii.html — short curly hair style is missing');
    failures++;
  } else {
    note('✓', 'mii.html includes short curly hair');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("st === 'bald'") || src.includes("st === 'bald'") && /st === 'bald'[\s\S]{0,80}hairBand/.test(src)) {
    note('✗', 'mii.html — bald should render with no hair geometry');
    failures++;
  } else {
    note('✓', 'mii.html bald is fully hairless');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("geoCache(`fadeW${r}`") || !src.includes("'fade'")) {
    note('✗', 'mii.html — fade cut should be a waved crown with tapered sides');
    failures++;
  } else {
    note('✓', 'mii.html includes a shaved fade style');
  }
}

/* The furry buckets are the only hats built from a pile displacement, and the
   fur only reads if the texture, the noise and both shells are all present —
   dropping any one of them silently turns them back into felt. */
{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ['makeFurTexture', 'G._furn', 'G.furCrown(', 'G.furBrim()',
                 "'furry'", "'furrysage'", 'fur: true']
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — furry bucket hats need a pile texture, noise and both fur shells');
    failures++;
  } else {
    note('✓', 'mii.html includes furry bucket hats with a fur pile');
  }
}

/* The plastic pilot's signature is the double bridge — a brow bar plus the
   vented block under it. Without both it is just a big round frame, and the
   tortoiseshell has to stay a real pattern rather than a flat brown. */
{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ["label: 'Tortoise pilot'", "frame: 'pilot'", 'browBar: true',
                 'slats: 3', 'tortoise: true', 'tortoisePattern', 'createPattern',
                 "case 'pilot': {", 'if (spec.browBar) {']
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — tortoise pilot needs a double bridge and a patterned rim');
    failures++;
  } else {
    note('✓', 'mii.html offers a tortoiseshell plastic pilot frame');
  }
}

/* The bold frame's browline is heavier than the rest of its rim, which is what
   separates it from the thick square already in the list. Lose spec.brow and
   the two become near-duplicates. */
{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ["label: 'Big frames'", "frame: 'bold'", 'brow: 2.0',
                 'if (spec.brow) {', "case 'bold': {"]
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — big frames need a bold lens shape and a heavier browline');
    failures++;
  } else {
    note('✓', 'mii.html offers big bold-framed glasses');
  }
}

/* Sideburns only read if they run to the outer edge of the face patch. Held
   inboard they render as dark stripes flanking the eyes, so the back edge
   sitting at x=0 is the load-bearing part of both shapes. */
{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const listed = /id: 'sideburns'/.test(src) && /id: 'mutton'/.test(src);
  const outer = /st === 'sideburns'[\s\S]{0,400}g\.moveTo\(0, 14 \* U\)/.test(src)
    && /st === 'mutton'[\s\S]{0,500}g\.moveTo\(0, 13 \* U\)/.test(src);
  if (!listed || !outer || !src.includes('bothSides')) {
    note('✗', 'mii.html — sideburns and mutton chops must sit at the outer edge of the face patch');
    failures++;
  } else {
    note('✓', 'mii.html offers sideburns and mutton chops');
  }
}

/* The club cap's script has to stay arched — set straight it reads as a label
   stuck on the panel — and its lower band has to take the bill's colour, or
   the two-tone leaves a pale ring between crown and bill. */
{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ['makeScriptPatch', 'twoTone: true', "script: 'Co-Working'",
                 'H.twoTone ? accMat : hatMat', 'Math.sin(ang) * arcR']
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — club cap needs an arched script and a two-tone lower band');
    failures++;
  } else {
    note('✓', 'mii.html includes a two-tone club cap with an arched script');
  }
}

/* The dad cap's patch has to carry its own pale border: that cap takes the
   wearer's shirt colour, so without one the globe disappears on a blue hat. */
{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes('makeCapEmblem') || !src.includes('emblem: true')
      || !/satin\(disc\(R \* 1\.17\)/.test(src)) {
    note('✗', 'mii.html — dad hat needs an embroidered emblem with a pale satin border');
    failures++;
  } else {
    note('✓', 'mii.html puts an embroidered globe patch on the dad hat');
  }
}

/* The western hat's whole read is the cattleman crease on the crown and the
   upswept sides of the brim. Both are geometry, and losing either drops it
   back to the bowler-with-a-tray it used to be. */
{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ['G._cattle', 'G.cowboyWall(', 'G.cowboyTop()', 'G.cowboyBrim(',
                 'cattleman: true']
    .every((s) => src.includes(s));
  if (!wired || /st === 'cowboy'\)/.test(src)) {
    note('✗', 'mii.html — cowboy hat needs a creased cattleman crown and a swept brim');
    failures++;
  } else {
    note('✓', 'mii.html shapes the cowboy hat with a cattleman crease');
  }
}

/* The conical hat's weave is an interlace, not a crosshatch. The diamond
   lattice in makeStrawTexture is what makes it read as basketwork, and the
   style must stay under a descriptive name rather than the slur. */
{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ['makeStrawTexture', 'G.strawCone()', 'G.hoop(', "'conical'", 'straw: true']
    .every((s) => src.includes(s));
  const named = /conical:\s*'Straw conical hat'/.test(src);
  if (!wired || !named) {
    note('✗', 'mii.html — conical hat needs a plaited straw weave under a descriptive label');
    failures++;
  } else if (/coolie/i.test(src)) {
    note('✗', 'mii.html — the conical hat must not be labelled with the slur');
    failures++;
  } else {
    note('✓', 'mii.html includes a woven conical straw hat');
  }
}

/* The fossil beanies only read as knitwear because the motif is rasterised to
   a stitch grid before it is drawn. Lose knitMask and it becomes a decal. */
{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ['makeKnitTexture', 'makeRibTexture', 'knitMask(', 'KNIT_COLS',
                 'drawFossilSkeleton', "'fossil'", "'fossilblack'", 'knit: true']
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — fossil beanies need a stitch-quantised jacquard and a ribbed cuff');
    failures++;
  } else {
    note('✓', 'mii.html includes jacquard knit fossil beanies');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("geoCache(`medM${r}`") || !src.includes('G.medium(1.07)')) {
    note('✗', 'mii.html — bowl should render as a medium-length side-swept cut');
    failures++;
  } else {
    note('✓', 'mii.html bowl is a medium-length men\'s style');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("geoCache(`bobB${r}`") || !src.includes('Undercurl')) {
    note('✗', 'mii.html — bob should be a jaw-length cut with bangs and an undercurl');
    failures++;
  } else {
    note('✓', 'mii.html bob is shaped as a short jaw-length cut');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes('longHair') || !src.includes("'longmiddle'") || !src.includes("'longwavy'")) {
    note('✗', 'mii.html — long hair should offer bangs, middle part, side part, and wavy');
    failures++;
  } else {
    note('✓', 'mii.html long hair styles include part and wave variants');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("from '/lib/profanity.js'") || !src.includes('isCleanName')) {
    note('✗', 'mii.html — names should be checked for offensive language');
    failures++;
  } else {
    note('✓', 'mii.html blocks offensive names before save');
  }
}

{
  const { isCleanName } = await import(pathToFileURL(join(ROOT, 'lib/profanity.js')).href);
  if (!isCleanName('Alex') || isCleanName('fuck') || isCleanName('Sh1t')) {
    note('✗', 'lib/profanity.js — name filter should allow normal names and block slurs');
    failures++;
  } else if (!isCleanName('Dick')) {
    note('✗', 'lib/profanity.js — ordinary given names should still pass');
    failures++;
  } else {
    note('✓', 'lib/profanity.js filters offensive names');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes('for="miiEmail">Email</label>')) {
    note('✗', 'mii.html — email field should just say Email');
    failures++;
  } else if (src.includes('where your badge goes')) {
    note('✗', 'mii.html — email label still has the long badge copy');
    failures++;
  } else if (!/max-width:\s*50%/.test(src) || !src.includes("id=\"camNameRow\"")) {
    note('✗', 'mii.html — name and email inputs should be half width');
    failures++;
  } else {
    note('✓', 'mii.html puts a half-width Email field under Name');
  }
}

/* A broken vercel.json fails the production deploy while GitHub still
   merges — the last plaza fix never reached phones because of that. */
{
  try {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
    const sources = (cfg.headers || []).map((h) => h && h.source);
    if (!sources.includes('/admin')) {
      note('✗', 'vercel.json — missing /admin header block');
      failures++;
    } else if (!sources.includes('/mii') || !sources.includes('/mii.html')) {
      note('✗', 'vercel.json — /mii must be no-store so phones do not keep a stale plaza');
      failures++;
    } else {
      const mii = (cfg.headers || []).find((h) => h && h.source === '/mii');
      const keys = (mii.headers || []).map((h) => h && h.key);
      if (!keys.includes('Vercel-CDN-Cache-Control') && !keys.includes('CDN-Cache-Control')) {
        note('✗', 'vercel.json — /mii needs a CDN no-store header (Cache-Control alone still HITs)');
        failures++;
      } else {
        note('✓', 'vercel.json parses and pins /mii off the CDN');
      }
    }
  } catch (e) {
    note('✗', `vercel.json — ${e.message}`);
    failures++;
  }
}

console.log(
  failures ? `\n${failures} problem(s) found\n` : '\nAll clear\n'
);
process.exit(failures ? 1 : 0);
