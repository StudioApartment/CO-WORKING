/* Pre-deploy sanity check.
 *
 * Vercel functions are only exercised at request time, so a typo in an import
 * would otherwise surface as a 500 in production. This loads every route the
 * way the runtime does and asserts it exports a handler.
 *
 * Run with: npm run check
 */

import { readdirSync, statSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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

/* A doubled comma in an object literal (`),` then another `,`) is a
 * SyntaxError in the browser. The plaza then boots with Coworkers 0 and a
 * blank canvas. `node --check` on the extracted module also catches an
 * unclosed brace from a bad merge — HTML script-tag balance does not. */
{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (/\)\s*,\s*,/.test(src)) {
    note('✗', 'mii.html — stray comma in an object literal will crash the plaza');
    failures++;
  } else {
    note('✓', 'mii.html object literals do not have a doubled comma');
  }
  const open = src.indexOf('<script type="module">');
  const close = src.lastIndexOf('</script>');
  if (open < 0 || close < open) {
    note('✗', 'mii.html — could not extract the plaza module');
    failures++;
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'plaza-mod-'));
    const file = join(dir, 'plaza-module.mjs');
    writeFileSync(file, src.slice(open + '<script type="module">'.length, close));
    const out = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    rmSync(dir, { recursive: true, force: true });
    if (out.status !== 0) {
      const err = (out.stderr || out.stdout || '').trim().split('\n')[0];
      note('✗', `mii.html module does not parse — ${err || 'node --check failed'}`);
      failures++;
    } else {
      note('✓', 'mii.html plaza module parses');
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
  const css = src.slice(src.indexOf('.tray-cell{'), src.indexOf('.cyc-clear:hover'));
  const clearCss = src.slice(src.indexOf('.cyc-clear{'), src.indexOf('.tray-cell.on .cyc-clear'));
  const ownBox = /0 0 0 3px/.test(clearCss) || /linear-gradient/.test(clearCss);
  const sharedBox = /0 0 0 3px/.test(css);
  if (!src.includes('function trayIsOff') || !src.includes('cyc-clear')) {
    note('✗', 'mii.html — style tray should step linearly and offer a clear control');
    failures++;
  } else if (!src.includes('(i + 1) % options.length')) {
    note('✗', 'mii.html — style tray should cycle options in order');
    failures++;
  } else if (ownBox || !sharedBox) {
    note('✗', 'mii.html — the × should sit in the category pill, not in its own box');
    failures++;
  } else {
    note('✓', 'mii.html style tray steps in order with a clear button');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("geoCache(`afroI${r}`") || src.includes("add(G.ball(), 0, 0.74, -0.08")
      || !src.includes('cloud-like puff') || src.includes('const tl = 2.88')) {
    note('✗', 'mii.html — afro should be a round cloud-like puff, not an inverted teardrop');
    failures++;
  } else {
    note('✓', 'mii.html afro is a round cloud-like puff');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("geoCache(`shcurlB${r}`") || !src.includes("'shortcurl'")) {
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

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ["label: 'Cat-eye'", "frame: 'cateye'", "label: 'Hex'",
                 "frame: 'hex'", "label: 'Jelly'", 'jelly: true',
                 "label: 'Colorblock'", 'rim2: \'#f0c400\'',
                 "case 'cateye': {", "case 'hex': {", 'if (spec.rim2)']
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — loud plastic frames need cat-eye, hex, jelly and colourblock');
    failures++;
  } else {
    note('✓', 'mii.html offers loud stylish plastic frames');
  }
}

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

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const specs = ["label: 'Amber wrap'", 'w: 70, h: 38, lw: 5.2'];
  const shape = ['W * 0.07, H * 0.10', 'W * 0.60, H * 0.20',
                 'spec.lw * U * 1.85', 'lineJoin = \'miter\''];
  if (!specs.every((s) => src.includes(s)) || !shape.every((s) => src.includes(s))) {
    note('✗', 'mii.html — wrap shades should be a big chunky shield with a nose cutout');
    failures++;
  } else {
    note('✓', 'mii.html wrap shades are a big chunky Pit Viper-style shield');
  }
}

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

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const listed = /id: 'sideburns'/.test(src) || /id: 'mutton'/.test(src);
  const draws = /st === 'sideburns'/.test(src) || /st === 'mutton'/.test(src);
  const aliased = /sideburns:\s*'none'/.test(src) && /mutton:\s*'none'/.test(src);
  if (listed || draws || !aliased) {
    note('✗', 'mii.html — sideburns and mutton chops should be removed and aliased to none');
    failures++;
  } else {
    note('✓', 'mii.html drops the sideburns and mutton chops options');
  }
}

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
  if (!src.includes("geoCache(`mopB${r}`") || !src.includes('G.medium(1.07)')
      || !src.includes("bowl: 'Mop-top'")
      || !src.includes('mixed tapered points')) {
    note('✗', 'mii.html — bowl should render as a mop-top with tapered edges');
    failures++;
  } else {
    note('✓', 'mii.html bowl is a mop-top with tapered edges');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = src.includes('G.locFade(1.04)') && src.includes('sculptHair(`locFadeA${r}`');
  const hanging = src.includes('add(G.neck()');
  if (!wired || hanging) {
    note('✗', 'mii.html — locs should use a shaved fade shell, not hanging loc tubes');
    failures++;
  } else {
    note('✓', 'mii.html locs use a clean shaved fade on the sides and back');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const shells = [
    'G.frenchCrop(1.05)', "G.pixieCut(1.05)", 'G.waves360(1.04)',
    'G.crewCut(1.04)', "G.partedTop(1.05, 'combover')", 'G.bedHead(1.06)',
    'G.swoopCurl(1.05)', 'G.slickBack(1.05)', 'G.sweptHair(1.05)',
    'G.spikes(1.05)', 'G.pomp(1.05)', 'sculptHair('
  ];
  const extras = [
    'add(G.ball(), 0.62, 0.28, 0.42',
    'add(G.ball(), 0, 0.56, 0.66'
  ];
  if (!shells.every((s) => src.includes(s))) {
    note('✗', 'mii.html — barbershop cuts should be one photo-matched shell each');
    failures++;
  } else if (extras.some((s) => src.includes(s))) {
    note('✗', 'mii.html — crop/pixie still attach extra balls that read as buns');
    failures++;
  } else {
    note('✓', 'mii.html barbershop cuts are single photo-matched shells');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("geoCache(`bobC${r}`") || !src.includes('Undercurl')
      || !src.includes('ux + 0.22') || !src.includes('Side part at ux')) {
    note('✗', 'mii.html — bob should be a jaw-length cut with a side part and an undercurl');
    failures++;
  } else {
    note('✓', 'mii.html bob is shaped as a short jaw-length cut');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("geoCache(`shagF${r}`") || !src.includes('Side-parted shag')
      || !src.includes('napeTh = 2.40') || src.includes("geoCache(`shagE${r}`")) {
    note('✗', 'mii.html — shag should have a side part, shaggy top, and longer back');
    failures++;
  } else {
    note('✓', 'mii.html shag has a side part, shaggy top, and longer nape');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("geoCache(`hitopA${r}`") || !src.includes("wolf: 'Hi-top'")
      || !src.includes('G.wolf(1.05)') || src.includes("geoCache(`wolfD${r}`")
      || src.includes('add(G.wolf(1.09)')) {
    note('✗', 'mii.html — wolf should render as a vertical hi-top with a flat hairline');
    failures++;
  } else {
    note('✓', 'mii.html wolf is a vertical hi-top with a flat front');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("geoCache(`mohawkA${r}`") || !src.includes("mullet: 'Mohawk'")
      || !src.includes("mohawk: 'mullet'") || src.includes("geoCache(`mulletA${r}`")
      || src.includes("mohawk: 'spiky'")) {
    note('✗', 'mii.html — mullet should render as a mohawk crest, not a skullcap');
    failures++;
  } else {
    note('✓', 'mii.html mullet is a mohawk with a spiky centre crest');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("geoCache(`layersB${r}`") || !src.includes('tucked behind the ears')
      || src.includes("geoCache(`layersA${r}`") || src.includes('left-of-centre part sweeps')) {
    note('✗', 'mii.html — long layers should have a centre part tucked behind the ears');
    failures++;
  } else {
    note('✓', 'mii.html long layers are a centre part tucked behind the ears');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes('longHair') || !src.includes("'longmiddle'") || !src.includes("'longwavy'")) {
    note('✗', 'mii.html — long hair should offer bangs, middle part, side part, and wavy');
    failures++;
  } else if (src.includes('taper = 1 - hang * 0.24') || !src.includes('layered ? -1.18 : -1.50')
             || src.includes('geoCache(`longI') || !src.includes('Math.sin(phi * 2.5)')
             || !src.includes('SphereGeometry(r, 88, 72')
             || !src.includes('part === \'middle\' || part === \'side\'')
             || !src.includes('cover one eye')
             || src.includes("long: 'Long bangs'")
             || src.includes("long: 'Long middle layers'")
             || !src.includes("long: 'Side-swept bangs'")
             || src.includes("longside: 'Long side part'")
             || !src.includes("part === 'side'")
             || !src.includes("longHair(1.07, 'middle', 0, 'feet'")
             || src.includes('add(G.ball(), 0, 0.86, -0.62')) {
    note('✗', 'mii.html — long bangs should cover one eye with a side part');
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

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ["id: 'argyle'", "label: 'Argyle sweater'", "case 'argyle': {",
                 'for (const ox of [-W, 0, W])', "g.setLineDash([5, 5])"]
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — argyle sweater needs wrap-aware diamonds and dashed overlays');
    failures++;
  } else if (/CELINE|Triomphe|Celine/i.test(src)) {
    note('✗', 'mii.html — argyle must not reprint a licensed house mark');
    failures++;
  } else {
    note('✓', 'mii.html offers an argyle knit sweater');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ["id: 'tribal'", "label: 'Tribal'", 'function inkTribalSpiral',
                 'function inkTribalTeeth', 'function inkTribalClaws',
                 "kind === 'tribal'", 'destination-out']
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — tribal ink needs jaw and hand painters with a punched spiral');
    failures++;
  } else {
    note('✓', 'mii.html offers tribal tattoos on the jaw and hands');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ["id: 'hipster'", "label: 'Hipster'", 'function inkWatch',
                 'function inkCandle', 'function inkPlus', 'function drawHipsterFace',
                 'ey + sz * 0.72', "kind === 'hipster'"]
    .every((s) => src.includes(s));
  const hipster = src.slice(src.indexOf('function inkPlus'), src.indexOf('function drawNeckInk'));
  if (!wired) {
    note('✗', 'mii.html — hipster ink needs a watch, a candle, and under-eye marks');
    failures++;
  } else if (/LOVED|1 Cor|fillText/.test(hipster) || hipster.includes('777')) {
    note('✗', 'mii.html — hipster ink must not reprint words, verses, or dates');
    failures++;
  } else {
    note('✓', 'mii.html offers hipster tattoos on the face and hands');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ["id: 'minimal'", "label: 'Minimal'", 'function inkTwinTriangles',
                 'function inkCelestial', 'function drawMinimalFace',
                 "kind === 'minimal'", 'Math.max(4.2, s * 0.10)']
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — minimal ink needs stacked triangles and a celestial column');
    failures++;
  } else {
    note('✓', 'mii.html offers minimal tattoos on the jaw and hands');
  }
}

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

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("geoCache(`flowD${r}`") || !src.includes('stubble-short sides')
      || src.includes("geoCache(`flowC${r}`") || src.includes('add(G.flow(1.09)')) {
    note('✗', 'mii.html — flow should have a natural hairline and stubble-short sides');
    failures++;
  } else {
    note('✓', 'mii.html flow has a natural hairline and stubble-short sides');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`spkD${r}`") || !src.includes('Spiky front')
      || src.includes("sculptHair(`spkC${r}`")) {
    note('✗', 'mii.html — spiky should have a natural hairline, side hair, and a spiked front');
    failures++;
  } else {
    note('✓', 'mii.html spiky has a natural hairline, side hair, and a spiked front');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("geoCache(`shcurlB${r}`") || !src.includes("'shortcurl'")
      || src.includes("geoCache(`shcurl${r}`") || src.includes('bumpy curl silhouette')) {
    note('✗', 'mii.html — short curls should be a curly crown with shaved sides, not two bumps');
    failures++;
  } else {
    note('✓', 'mii.html short curls are a curly crown with shaved sides');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`bedA${r}`") || !src.includes('G.bedHead(1.06)')
      || !src.includes('function applyFrostedTips')
      || !src.includes('function frostTipHex')
      || !src.includes('Short shaggy bed head')
      || src.includes("G.partedTop(1.05, 'side')")
      || src.includes("sidepart: 'Side part'")
      || !src.includes("sidepart: 'Frosted tips'")) {
    note('✗', 'mii.html — side part should be a short shaggy bed head with frosted tips');
    failures++;
  } else {
    note('✓', 'mii.html side part is a short shaggy bed head with frosted tips');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const fn = src.match(/function buildHair\([\s\S]*?\nfunction buildMii\(/);
  if (!fn || !/\n  return out;\n}\n\nfunction buildMii\(/.test(fn[0])) {
    note('✗', 'mii.html — buildHair must return the hair meshes or the plaza stays bald');
    failures++;
  } else {
    note('✓', 'mii.html buildHair returns its meshes');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`sweptC${r}`") || !src.includes('G.sweptHair(1.05)')
      || !src.includes('Taper out')
      || src.includes("sculptHair(`sweptB${r}`")
      || src.includes('still a full cap')) {
    note('✗', 'mii.html — swept hair should drop down the sides and taper out');
    failures++;
  } else {
    note('✓', 'mii.html swept hair drops down the sides and tapers out');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`wavC${r}`") || !src.includes('G.waves360(1.04)')
      || !src.includes('G.longPony()')
      || !src.includes("waves: 'Long ponytail'")
      || src.includes("sculptHair(`wavB${r}`")
      || src.includes("waves: 'Waves'")) {
    note('✗', 'mii.html — waves should be a long ponytail with a natural hairline');
    failures++;
  } else {
    note('✓', 'mii.html waves is a long ponytail with a natural hairline');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (src.includes("sculptHair(`fadeY${r}`") || src.includes("st === 'fade'")
      || src.includes("fade: 'Fade'") || src.includes("'waves','fade','pixie'")
      || !src.includes("fade: 'taper'")) {
    note('✗', 'mii.html — the fade helmet should be removed from the picker');
    failures++;
  } else {
    note('✓', 'mii.html drops the fade helmet from the picker');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("st === 'pigtails'")
      || src.includes('sx * 0.46, 0.88, -0.22, 0.17, 0.17, 0.17')
      || !src.includes('cap(1.045, 1.68, 1.08)')
      || !src.includes('G.pigtailBangs(1.05)')
      || !src.includes('sx * 0.78, 0.78, -0.16, 0.20, 0.20, 0.20')
      || !src.includes('High twin-tails')) {
    note('✗', 'mii.html — pigtails should hang off the back of the head');
    failures++;
  } else {
    note('✓', 'mii.html pigtails hang off the back of the head');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes('G.highPonyScalp(1.05)') || !src.includes('G.smoothPony()')
      || !src.includes('U-shaped nape')
      || !src.includes('side-swept S-bang')
      || src.includes('add(G.ball(), 0, 0.94, -0.42, 0.26, 0.26, 0.26)')
      || src.includes('add(G.ball(), 0, -0.58, -1.18, 0.20, 0.40, 0.22)')) {
    note('✗', 'mii.html — high ponytail should be one smooth tail with a curved nape');
    failures++;
  } else {
    note('✓', 'mii.html high ponytail is one smooth tail with a curved nape');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const pickers = src.match(/const PICKERS = \[[\s\S]*?\n\];/);
  const hair = src.match(/const HAIRSTYLES = \[[\s\S]*?\];/);
  const hats = src.match(/const HATS = \{[\s\S]*?\n\};/);
  const hatPicker = pickers && pickers[0].includes("key: 'hat'")
    && pickers[0].includes('d.hatColor');
  const oneBandana = hair && /\bbandana\b/.test(hair[0])
    && !/\bbandanablue\b/.test(hair[0])
    && !/\bbandanagreen\b/.test(hair[0]);
  const hatsOne = hats && hats[0].includes('paisley: true')
    && !hats[0].includes('bandanablue')
    && !hats[0].includes('bandanagreen');
  const aliased = src.includes("bandanablue: 'bandana'")
    && src.includes("bandanagreen: 'bandana'");
  const labelled = src.includes("bandana: 'Bandana'");
  if (!hatPicker) {
    note('✗', 'mii.html — colour pickers need a Hat chip bound to hatColor');
    failures++;
  } else if (!oneBandana || !hatsOne || !labelled) {
    note('✗', 'mii.html — bandana should be one hat, recolored from the Hat chip');
    failures++;
  } else if (!aliased) {
    note('✗', 'mii.html — saved blue/green bandanas must alias onto bandana');
    failures++;
  } else {
    note('✓', 'mii.html has a Hat colour chip and a single bandana');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ["id: 'techvest'", "label: 'Tech vest'", "kind: 'techvest'",
                 'mock: true', "case 'techvest':", 'const zipH = vy(0.48)',
                 'scoopAt(W * 0.5)', 'apparel.mock']
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — tech vest needs a mock collar, quarter zip and polo armholes');
    failures++;
  } else {
    note('✓', 'mii.html offers a quarter-zip tech vest over a polo');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ["id: 'vintage'", "label: 'Vintage tee'", "kind: 'vintage'",
                 "sleeves: 'raglan'", "case 'vintage':", 'paintPlazaTourPrint',
                 "const cream = '#ebe0cc'", "const word = 'PLAZA'",
                 "apparel.sleeves === 'raglan'"]
    .every((s) => src.includes(s));
  const licensed = /ROLLING STONES|Mick Jagger|tongue and lips/i.test(src);
  if (!wired) {
    note('✗', 'mii.html — vintage tee needs a raglan cut and an original plaza poster');
    failures++;
  } else if (licensed) {
    note('✗', 'mii.html — vintage tee must not reprint a licensed tour shirt');
    failures++;
  } else {
    note('✓', 'mii.html offers a raglan vintage tee with an original plaza print');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ["id: 'bubble'", "label: 'Bubble jacket'", "kind: 'bubble'",
                 "hood: 'fur'", "sleeves: 'puffer'", "case 'bubble':",
                 'const baffles = 6', "apparel.hood === 'fur'",
                 "apparel.sleeves === 'puffer'", 'makeFurTexture(dna.shirt)']
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — bubble jacket needs quilted baffles, a fur hood and puffy sleeves');
    failures++;
  } else {
    note('✓', 'mii.html offers a quilted bubble jacket with a fur-trimmed hood');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ["id: 'tank'", "label: 'Tank top'", "kind: 'tank', nocollar: true",
                 "case 'tank':", 'const strapW = 12', 'g.lineTo(front, vy(0.38))',
                 'arm(W * 0.5)']
    .every((s) => src.includes(s));
  const tankBlock = src.match(/case 'tank': \{[\s\S]*?break;\n    \}/);
  const frayed = tankBlock && tankBlock[0].includes('raw edge');
  if (!wired || frayed) {
    note('✗', 'mii.html — tank top needs a V-neck, medium straps and a clean hem');
    failures++;
  } else {
    note('✓', 'mii.html offers a bodycon tank with a V-neck');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ["id: 'protector'", "label: 'Pocket protector'", "kind: 'protector'",
                 "case 'protector':", 'const pens = [', 'py - p.h * 0.52',
                 'rgba(186, 220, 228, 0.72)']
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — pocket protector shirt needs pens sticking out of the plastic');
    failures++;
  } else {
    note('✓', 'mii.html offers a button-up with a pocket protector');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ["id: 'boxhoodie'", "label: 'Box hoodie'", "kind: 'boxhoodie'",
                 "case 'boxhoodie':", "const boxWord = 'Co-Working'",
                 "g.fillStyle = '#e11b22'", 'italic 900']
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — box hoodie needs a red chest box with our own word');
    failures++;
  } else if (/Supreme/i.test(src)) {
    note('✗', 'mii.html — box hoodie must not reprint a licensed box logo');
    failures++;
  } else {
    note('✓', 'mii.html offers a box hoodie with a Co-Working chest mark');
  }
}

console.log(
  failures ? `\n${failures} problem(s) found\n` : '\nAll clear\n'
);
process.exit(failures ? 1 : 0);
