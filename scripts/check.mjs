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
  ['mii.html', ['camEmailRow', 'camBanner', 'camBadge', 'badgePass', 'badgeOrbitHost', 'badgeWallet', 'badgeAppleWallet', 'badgeMii', 'badgeMiiSide', 'badgeEmail', 'badgeSince', 'camRecover', 'mineChip', 'mineEdit', 'mineDelete', 'btnLost', 'camLocationRow', 'miiLocation', 'badgePlace', 'miiDock', 'btnMiiInfo', 'miiCard', 'camProfile', 'miiFullName', 'loader', 'loader-status', 'loader-count', 'logoLink']],
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

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ['id="btnLost"', 'id="helpDock"', 'Lost my Co-Worker', 'openRecover()',
                 "$('btnLost').addEventListener('click', () => Cam.openRecover())",
                 'this.showRecover(\'\')',
                 'function hasActiveMii()', 'help.hidden = has'].every((s) => src.includes(s));
  const recover = src.match(/openRecover\(\) \{[\s\S]*?\n  \},/);
  const usesCamera = recover && (recover[0].includes('getUserMedia') || recover[0].includes('this.open()'));
  if (!wired || usesCamera) {
    note('✗', 'mii.html — Lost my Co-Worker should open email recovery without the camera, and hide when a Mii is active');
    failures++;
  } else {
    note('✓', 'mii.html has a Lost my Co-Worker control that emails a reclaim link (hidden with an active Mii)');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = [
    'id="mineChip"', 'id="mineEdit"', 'id="mineDelete"', 'id="mineManage"',
    'Join the Office', '.mine-chip.show ~ #btnCamera{display:none}',
    'deleteOwnedMii', "Cam.openEdit(m)",
    "$('mineEdit').addEventListener", "$('mineDelete').addEventListener"
  ].every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — with an active Mii, Join should hide and the name chip should offer edit/delete');
    failures++;
  } else {
    note('✓', 'mii.html hides Join after claim and puts edit/delete on the name chip');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("Customize Your Co-Worker")
      || !src.includes('ID card and lanyard')
      || src.includes("'Best guess…'")
      || src.includes("'Looking good!'")) {
    note('✗', 'mii.html — after a photo the card should say Customize Your Co-Worker');
    failures++;
  } else {
    note('✓', 'mii.html titles the post-photo card Customize Your Co-Worker');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ['id="camLocationRow"', 'id="miiLocation"', 'City or ZIP',
                 'officeLocationFor', 'New York City, NY', 'Pittsburgh, PA',
                 "n === 'james'", 'james acklin', "Store._api('places?q='"].every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — Co-Workers need a city/ZIP location field with autocomplete');
    failures++;
  } else {
    note('✓', 'mii.html asks for a city or ZIP and pins Gage / James Acklin');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ['id="miiDock"', 'id="btnMiiInfo"', 'id="miiCard"', 'fillMiiCard',
                 'id="camProfile"', 'id="miiFullName"',
                 'Gage Salzano', 'James Acklin', 'contactEmail'].every((s) => src.includes(s));
  if (!wired || src.includes('id="miiUrl"') || src.includes('id="camSocialRow"')
      || src.includes('placeholder="yoursite.com"')) {
    note('✗', 'mii.html — hovering a Co-Worker should open an info card (no website/socials in creation)');
    failures++;
  } else {
    note('✓', 'mii.html shows a Co-Worker card on the info icon');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ['id="loader"', 'id="loader-status"', 'LOADING TPS REPORTS',
                 'class="logo-overlay"', 'logo-we-are', 'we are',
                 'images/logo-lockup.png', 'filter:brightness(0)',
                 'PlazaLoader', 'fromSky: false', 'renderer.compile'].every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — plaza should boot behind the index loader with the black lockup');
    failures++;
  } else {
    note('✓', 'mii.html uses the index loader and black CO—WORKING lockup');
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
  const pass = src.includes('class="wallet-pass"')
    && src.includes('employee badge')
    && src.includes('Days coworking')
    && src.includes('badgeOrbitHost')
    && src.includes('fillBadgeQr')
    && src.includes('parkPreviewCanvas');
  if (!pass) {
    note('✗', 'mii.html — badge preview should be an Apple Wallet–style pass with dual Mii + QR');
    failures++;
  } else {
    note('✓', 'mii.html badge preview is a Wallet-style pass with orbit Mii and QR');
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
  if (!src.includes("geoCache(`afroO${r}`") || src.includes("add(G.ball(), 0, 0.74, -0.08")
      || !src.includes('cloud-like afro') || src.includes('const tl = 2.88')
      || !src.includes("st !== 'afro'")
      || !src.includes('hairClumps(phi, 2.4, 4.0, 6.2)')
      || !src.includes('no V curtain')) {
    note('✗', 'mii.html — afro should be a round cloudy puff with open forehead, not a V curtain');
    failures++;
  } else {
    note('✓', 'mii.html afro is a round cloudy puff with open forehead');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`shcurlD${r}`") || !src.includes("'shortcurl'")) {
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
                 "'furry'", 'fur: true', 'co: true', 'addHatCoMark',
                 "furrysage: 'furry'"]
    .every((s) => src.includes(s));
  const furryHat = src.match(/furry:\s*\{[^}]*\}/)?.[0] || '';
  const furryCo = /co:\s*true/.test(furryHat) && !/roo:\s*true/.test(furryHat);
  const noSage = !/^\s*furrysage\s*:/m.test(src.match(/const HATS = \{[\s\S]*?\n\};/)?.[0] || 'furrysage:');
  if (!wired || !furryCo || !noSage) {
    note('✗', 'mii.html — furry bucket needs pile shells, a Co- mark, and furrysage aliased away');
    failures++;
  } else {
    note('✓', 'mii.html includes furry bucket with pile and Co- mark');
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
  const faceStart = src.indexOf('function drawFace');
  const faceChunk = faceStart < 0 ? '' : src.slice(faceStart, faceStart + 2200);
  const layered = src.includes('function drawEyewearTex')
    && src.includes('drawEyewearTex(dna)')
    && /eyewear\.renderOrder\s*=\s*5/.test(src)
    && /depthTest:\s*false,\s*depthWrite:\s*false/.test(src)
    && !faceChunk.includes('drawEyewear(g, U, dna)');
  if (!layered) {
    note('✗', 'mii.html — eyewear should be a post-hair overlay (not buried in the face shell)');
    failures++;
  } else {
    note('✓', 'mii.html layers eyewear above hair');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ["label: 'Tri shades'", "frame: 'wedge'", "case 'wedge': {",
                 'Tiny Italian luxury triangle', 'w: 14, h: 12, lw: 1.25']
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — Tri shades need tiny triangular wedge lenses');
    failures++;
  } else {
    note('✓', 'mii.html offers tiny triangular Italian-style shades');
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
  const wired = ['makeScriptPatch', 'twoTone: true',
                 'H.twoTone ? accMat : hatMat', 'H.script',
                 "creamgreen: 'White & green'", "crown: '#f7f7f4'",
                 "accent: '#1f7a45'", "script: 'Co-Working'",
                 'Horse + rider crest', 'dangling near leg', 'Cowboy hat']
    .every((s) => src.includes(s));
  const creamScript = /creamgreen:\s*\{[^}]*script:\s*'Co-Working'/.test(src);
  const creamCo = /creamgreen:\s*\{[^}]*co:\s*true/.test(src);
  const creamTone = /creamgreen:\s*\{[^}]*twoTone:\s*true/.test(src);
  if (!wired || !creamScript || creamCo || !creamTone) {
    note('✗', 'mii.html — club cap needs Co-Working script + horse-and-rider on a two-tone white/green band');
    failures++;
  } else {
    note('✓', 'mii.html includes a two-tone white & green club cap with horse-and-rider mark');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const dadBanana = /dadhat:\s*\{[^}]*banana:\s*true/.test(src);
  const dadCo = /dadhat:\s*\{[^}]*co:\s*true/.test(src);
  if (!src.includes('makeBananaPatch') || !src.includes('H.banana') || !dadBanana || dadCo) {
    note('✗', 'mii.html — dad hat needs a small banana patch, not a Co- mark');
    failures++;
  } else {
    note('✓', 'mii.html puts a small banana on the dad hat');
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
                 'drawFossilSkeleton', "'fossil'", 'knit: true',
                 "fossilblack: 'fossil'"]
    .every((s) => src.includes(s));
  const hatsBlock = src.match(/const HATS = \{[\s\S]*?\n\};/)?.[0] || '';
  const oneFossil = (hatsBlock.match(/^\s*fossil\s*:/gm) || []).length === 1
    && !/^\s*fossilblack\s*:/m.test(hatsBlock);
  if (!wired || !oneFossil) {
    note('✗', 'mii.html — one fossil beanie (black), jacquard + rib cuff, fossilblack aliased');
    failures++;
  } else {
    note('✓', 'mii.html includes one jacquard fossil knit beanie');
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
  const wired = src.includes("st !== 'dreads'")
    && src.includes('Dense hanging loc columns')
    && src.includes('No undercap shell')
    && src.includes('locsPartV2')
    && src.includes('Face-frame loc columns')
    && src.includes('not bangs over the forehead');
  const shellOnDreads = /st === 'dreads'[\s\S]{0,400}add\(G\.(locFade|scalpCover)\(/.test(src);
  const tubes = src.includes('add(G.neck()');
  const bangsStubs = src.includes('Front-dome stubs');
  if (!wired || shellOnDreads || tubes || bangsStubs || src.includes('locFade:')) {
    note('✗', 'mii.html — locs should be centre-part face frames, not bangs or a fade matte');
    failures++;
  } else {
    note('✓', 'mii.html locs are centre-part face-frame columns (no bangs)');
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
  if (!src.includes("sculptHair(`combD${r}_${kind}`") || !src.includes("G.partedTop(1.05, 'combover')")
      || !src.includes('diagonal side-swept fringe')
      || !src.includes('jagged textured nape')
      || !src.includes("st !== 'combover'")
      || src.includes("sculptHair(`partC${r}_${kind}`")
      || src.includes('Short side-part from the photo library')) {
    note('✗', 'mii.html — comb over should be a diagonal fringe with ears out and a jagged nape');
    failures++;
  } else {
    note('✓', 'mii.html comb over has a diagonal fringe, ears out, and a jagged nape');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`bobF${r}`") || !src.includes('center-part chunks flowing')
      || !src.includes('Two main panels from the crown part') || !src.includes('Flat bang hem')
      || !src.includes('nape hem that fills the occiput')
      || src.includes("sculptHair(`bobE${r}`") || src.includes("sculptHair(`bobD${r}`")
      || src.includes("geoCache(`bobC${r}`")) {
    note('✗', 'mii.html — bob should have center-part chunks and a low nape fill');
    failures++;
  } else {
    note('✓', 'mii.html bob has center-part chunks and a low nape fill');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`shagI${r}`") || !src.includes('Chunky layered shag')
      || !src.includes('larger continuous crown chunks')
      || !src.includes('Soft bang floor')
      || !src.includes('jagged pointed hem') || src.includes("geoCache(`shagH${r}`")
      || src.includes("sculptHair(`shagH${r}`") || src.includes("sculptHair(`shagG${r}`")) {
    note('✗', 'mii.html — shag should have chunky layers and a jagged hem');
    failures++;
  } else {
    note('✓', 'mii.html shag has chunky layers and a jagged hem');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`hitopH${r}`") || !src.includes("wolf: 'Hi-top'")
      || !src.includes('Hi-top fade') || !src.includes('add(G.wolf(1.07)')
      || !src.includes('aggressive high fade') || !src.includes('Vertical column')
      || src.includes("sculptHair(`wolfE${r}`") || src.includes("sculptHair(`hitopG${r}`")
      || src.includes("geoCache(`hitopA${r}`") || src.includes("wolf: 'Wolf cut'")
      || src.includes('add(G.hitopCone()')) {
    note('✗', 'mii.html — wolf should be a hi-top fade with a tall manicured crown');
    failures++;
  } else {
    note('✓', 'mii.html wolf is a hi-top fade with a tall manicured crown');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`mohawkQ${r}`") || !src.includes("mullet: 'Mohawk'")
      || !src.includes('Mohawk: stubble-tight sides') || !src.includes("mohawk: 'mullet'")
      || !src.includes('spikeChunkC') || !src.includes('five solid flat wedges')
      || src.includes("sculptHair(`mulletB${r}`") || src.includes("mullet: 'Mullet'")
      || src.includes('Business in front, party in back')
      || src.includes("sculptHair(`mohawkO${r}`") || src.includes('smoke-spiked jagged')) {
    note('✗', 'mii.html — mullet slot should be a mohawk crest with shaved sides');
    failures++;
  } else {
    note('✓', 'mii.html mullet slot is a mohawk crest with shaved sides');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("geoCache(`layersD${r}`") || !src.includes('tucked behind the ears')
      || !src.includes('wavy volume-esque chunks')
      || !src.includes('two long bang panels')
      || src.includes("geoCache(`layersC${r}`") || src.includes("geoCache(`layersB${r}`") || src.includes("geoCache(`layersA${r}`")
      || src.includes('left-of-centre part sweeps')
      || !src.includes("st !== 'layers'")) {
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
  } else if (src.includes('taper = 1 - hang * 0.24') || !src.includes('layered ? -1.02 : -1.05')
             || src.includes('geoCache(`longI') || src.includes('geoCache(`longP') || src.includes('geoCache(`longQ') || src.includes('geoCache(`longR') || src.includes('geoCache(`longS') || src.includes('geoCache(`longT') || src.includes('geoCache(`longU') || src.includes('geoCache(`longV') || src.includes('geoCache(`longW') || src.includes('geoCache(`longX') || src.includes('geoCache(`longY') || src.includes('geoCache(`longZ')
             || !src.includes('geoCache(`longAA') || !src.includes('Math.sin(phi * 2.5)')
             || !src.includes('SphereGeometry(r, 88, 72')
             || !src.includes("part === 'side'")
             || !src.includes('centered V')
             || !src.includes('even downward strands')
             || !src.includes('Math.sin(phi * 5.0 + uy * 2.6)')
             || !src.includes('Temple tuck')
             || src.includes('cover one eye')
             || !src.includes('forehead stays open')
             || !src.includes('smaller front tapers')
             || !src.includes('straighter flowy lobes')
             || !src.includes('vertical flowy strands')
             || !src.includes('One long flowing shell')
             || src.includes("long: 'Long bangs'")
             || src.includes("long: 'Long middle layers'")
             || !src.includes("long: 'Side-swept bangs'")
             || src.includes("longside: 'Long side part'")
             || !src.includes("longHair(1.07, 'middle', 0, 'feet'")
             || !src.includes("st !== 'long'")
             || src.includes('add(G.ball(), 0, 0.86, -0.62')
             || src.includes('sx * 0.88, 0.58, 0.36, 0.26, 0.38, 0.24')) {
    note('✗', 'mii.html — long bangs should part to the side with an open forehead');
    failures++;
  } else {
    note('✓', 'mii.html long hair styles include part and wave variants');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("from '/lib/profanity.js'") || !src.includes('publicNameError') || !src.includes('formPublicError')) {
    note('✗', 'mii.html — names should be checked for offensive language');
    failures++;
  } else {
    note('✓', 'mii.html blocks offensive names before save');
  }
}

{
  const { isCleanName, publicNameError, dnaPublicError, NAME_SPAM_MESSAGE } = await import(pathToFileURL(join(ROOT, 'lib/profanity.js')).href);
  if (!isCleanName('Alex') || isCleanName('fuck') || isCleanName('Sh1t')) {
    note('✗', 'lib/profanity.js — name filter should allow normal names and block slurs');
    failures++;
  } else if (!isCleanName('Dick')) {
    note('✗', 'lib/profanity.js — ordinary given names should still pass');
    failures++;
  } else if (isCleanName('aaaaaaa') || isCleanName('www.spam.com') || publicNameError('!!!!!') !== NAME_SPAM_MESSAGE) {
    note('✗', 'lib/profanity.js — spammy names should be blocked');
    failures++;
  } else if (!dnaPublicError({ fullName: 'fuck you' }) || !dnaPublicError({ socials: { instagram: 'nigger' } })) {
    note('✗', 'lib/profanity.js — full names and social handles should be filtered');
    failures++;
  } else {
    note('✓', 'lib/profanity.js filters offensive names');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ['runStyleReview', '?review=all', "id: 'top'", 'title: \'Tops\''].every((s) => src.includes(s));
  const hairTurn = ["id: 'hair'", "label: 'Front'", "label: 'Side'", "label: 'Back'", 'sec.views'].every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — style review should cover tops and the other catalogues');
    failures++;
  } else if (!hairTurn) {
    note('✗', 'mii.html — hair review should lay out front / side / back in a row');
    failures++;
  } else {
    note('✓', 'mii.html has a style review page for tops, hats, hair, and the rest');
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
                 'for (const ox of [-W, 0, W])', 'g.setLineDash(', 'const rw = 7']
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
  const fh = src.match(/const FACIAL_HAIR = \[[\s\S]*?\];/)?.[0] || '';
  const wired = ["label: 'Mustache and Goatee'", "id: 'fullbeard'",
                 "label: 'Full Beard'", "st === 'fullbeard'",
                 'True full beard']
    .every((s) => src.includes(s));
  const renamed = /id:\s*'full'[\s\S]*?label:\s*'Mustache and Goatee'/.test(fh)
    && !/label:\s*'Full beard'/.test(fh);
  if (!wired || !renamed) {
    note('✗', 'mii.html — Mustache and Goatee rename plus a real Full Beard option');
    failures++;
  } else {
    note('✓', 'mii.html has Mustache and Goatee plus a full lower-face beard');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ["id: 'tribal'", "label: 'Tribal'", 'function inkTribalSpiral',
                 'function inkTribalTeeth', 'function inkTribalClaws',
                 "kind === 'tribal'", 'destination-out',
                 'Face tribal motifs, scaled down', 'inkTribalChevron']
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — tribal ink needs jaw painters and scaled face motifs on hands');
    failures++;
  } else {
    note('✓', 'mii.html offers tribal tattoos on the jaw and hands');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ["id: 'neck'", "label: 'Traditional'", 'TATTOO_ALIASES',
                 "hand: 'neck'", "both: 'neck'", "kind === 'neck'",
                 'tattooHasShoulder', 'apparelExposesShoulders',
                 'inkSwallow', 'inkScript']
    .every((s) => src.includes(s));
  const tattoos = src.match(/const TATTOOS = \[[\s\S]*?\];/)?.[0] || '';
  const noHandsBoth = !/label:\s*'Hands'/.test(tattoos)
    && !/label:\s*'Both'/.test(tattoos)
    && !/label:\s*'Jaw'/.test(tattoos);
  if (!wired || !noHandsBoth) {
    note('✗', 'mii.html — Traditional ink should replace Hands/Jaw/Both with hand+shoulder flash');
    failures++;
  } else {
    note('✓', 'mii.html offers Traditional ink on hands and exposed shoulders');
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
                 "kind === 'minimal'", 'Math.max(4.2, s * 0.10)',
                 'tattooHasShoulder', 'apparelExposesShoulders']
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — minimal ink needs stacked triangles on hands and shoulders');
    failures++;
  } else {
    note('✓', 'mii.html offers minimal tattoos on hands and exposed shoulders');
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
  if (!src.includes("sculptHair(`flowG${r}`") || !src.includes('Natural ear cutouts and a raised nape')
      || !src.includes('Even flowy clumps')
      || src.includes("sculptHair(`flowF${r}`") || src.includes('longer swept side locks')
      || src.includes('add(G.flow(1.09)')) {
    note('✗', 'mii.html — flow should trim ears/nape and keep even flowy texture');
    failures++;
  } else {
    note('✓', 'mii.html flow trims ears/nape with even flowy texture');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`spkO${r}`")
      || src.includes("sculptHair(`spkN${r}`") || !src.includes('G.spikes(1.05)')
      || !src.includes('chunky radial spikes')
      || !src.includes('fade into the shared stubble underlayer')
      || !src.includes('fadeIntoStubble')
      || !src.includes("st === 'spiky'")
      || !src.includes("st !== 'spiky'")
      || !src.includes('applyStubbleRimFade(spikeGeo')
      || src.includes("sculptHair(`spkM${r}`")
      || src.includes("sculptHair(`spkL${r}`")
      || src.includes("sculptHair(`spkK${r}`")
      || src.includes("sculptHair(`spkJ${r}`")
      || src.includes("sculptHair(`spkI${r}`")
      || src.includes("sculptHair(`spkH${r}`")
      || src.includes("sculptHair(`spkG${r}`")
      || src.includes("sculptHair(`spkF${r}`")
      || src.includes("sculptHair(`spkE${r}`")
      || src.includes("sculptHair(`spkD${r}`")) {
    note('✗', 'mii.html — spiky should use stubble sides/back with chunky crown spikes');
    failures++;
  } else {
    note('✓', 'mii.html spiky has stubble sides/back with chunky crown spikes');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`buzzY${r}`")
      || src.includes("sculptHair(`buzzX${r}`") || !src.includes('stubble underlayer')
      || !src.includes('straight-across')
      || !src.includes('stubbleHairMat')
      || !src.includes('buzzStubbleHemY')
      || !src.includes('stubbleHemY')
      || !src.includes('lineupHemY')
      || !src.includes('templeFill')
      || !src.includes('templePad')
      || !src.includes('stubbleJoinTaper')
      || !src.includes('boxy straight-across')
      || !src.includes('no cheek dagger')
      || !src.includes('napeBand')
      || !src.includes('full occiput')
      || !src.includes('flatFront')
      || !src.includes('hardFlat')
      || !src.includes('Jittered hex grid')
      || !src.includes('dense hex dots only')
      || !src.includes('stubHairM')
      || !src.includes('hair→skin wash')
      || !src.includes('Peak density in the join band')
      || !src.includes('applyStubbleRimFade')
      || !src.includes('const step = 1.55')
      || !src.includes('m.alphaTest = 0.02')
      || !src.includes("st !== 'buzz'")
      || !src.includes('stubbleHairMat(mat, dna.hair.color, extraMats, dna.skin)')
      || !src.includes('parkAtHairline(b, rr, hem, 1.002)')
      || !src.includes('put(G.buzzCut(1.005)')
      || src.includes('stubHairL')
      || src.includes('stubHairK')
      || src.includes('stubHairJ')
      || src.includes('stubHairI')
      || src.includes('stubHairH')
      || src.includes('stubHairG')
      || src.includes('stubHairF')
      || src.includes("sculptHair(`buzzV${r}`")
      || src.includes("sculptHair(`buzzW${r}`")
      || src.includes("sculptHair(`buzzU${r}`")
      || src.includes("sculptHair(`buzzT${r}`")
      || src.includes("sculptHair(`buzzS${r}`")
      || src.includes("sculptHair(`buzzR${r}`")
      || src.includes("sculptHair(`buzzQ${r}`")
      || src.includes("sculptHair(`buzzP${r}`")
      || src.includes("sculptHair(`buzzO${r}`")
      || src.includes("sculptHair(`buzzN${r}`")
      || src.includes("sculptHair(`buzzM${r}`")
      || src.includes("sculptHair(`buzzL${r}`")
      || src.includes("sculptHair(`buzzK${r}`")
      || src.includes("sculptHair(`buzzJ${r}`")
      || src.includes("sculptHair(`buzzI${r}`")
      || src.includes("sculptHair(`buzzH${r}`")
      || src.includes("sculptHair(`buzzG${r}`")
      || src.includes("sculptHair(`buzzF${r}`")
      || src.includes("sculptHair(`buzzE${r}`")
      || src.includes("sculptHair(`buzzD${r}`")
      || src.includes("sculptHair(`buzzC${r}`")
      || src.includes("sculptHair(`buzzA${r}`")
      || src.includes('add(G.buzzCut(1.038), 0, 0, 0, 1, 1.06, 1)')) {
    note('✗', 'mii.html — buzz should be even stubble with a straight-across hairline');
    failures++;
  } else {
    note('✓', 'mii.html buzz is even stubble with a straight-across hairline');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`crewR${r}`")
      || src.includes("sculptHair(`crewQ${r}`") || !src.includes('Military crown pad')
      || !src.includes("st !== 'taper'")
      || !src.includes('stubbleHairMat(mat, dna.hair.color')
      || !src.includes('fadeIntoStubble')
      || !src.includes('stubbleJoinTaper')
      || !src.includes('lineupHemY')
      || !src.includes('faded.keep')
      || !src.includes('applyStubbleRimFade')
      || !src.includes('putStubbleFadeStack')
      || !src.includes('stubbleFadeZone')
      || !src.includes("sculptHair(`fadeBandA${level}_${r}`")
      || !src.includes('stacked mid fade bands')
      || src.includes("sculptHair(`crewO${r}`")
      || src.includes("sculptHair(`crewP${r}`")
      || src.includes("sculptHair(`crewN${r}`")
      || src.includes("sculptHair(`crewM${r}`")
      || src.includes("sculptHair(`crewL${r}`")
      || src.includes("sculptHair(`crewK${r}`")
      || src.includes("sculptHair(`crewJ${r}`")
      || src.includes("sculptHair(`crewI${r}`")
      || src.includes("sculptHair(`crewH${r}`")
      || src.includes("sculptHair(`crewG${r}`")
      || src.includes("sculptHair(`crewF${r}`")
      || src.includes("sculptHair(`crewE${r}`")
      || src.includes("sculptHair(`crewD${r}`")
      || src.includes("sculptHair(`crewC${r}`")
      || src.includes("sculptHair(`crewB${r}`")
      || src.includes('add(G.crewCut(1.04), 0, 0, 0, 1, 1.06, 1)')) {
    note('✗', 'mii.html — crew should have stubble sides and a longer shaved top');
    failures++;
  } else {
    note('✓', 'mii.html crew has stubble sides and a longer shaved top');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`fcropS${r}`")
      || src.includes("sculptHair(`fcropR${r}`") || !src.includes('gradual thickness fade into stubble')
      || !src.includes("st !== 'crop'")
      || !src.includes('lineupHemY')
      || !src.includes('fadeIntoStubble')
      || !src.includes('applyStubbleRimFade')
      || !src.includes('putStubbleFadeStack')
      || !src.includes("sculptHair(`fadeBandA${level}_${r}`")
      || src.includes("sculptHair(`fcropP${r}`")
      || src.includes("sculptHair(`fcropQ${r}`")
      || src.includes("sculptHair(`fcropO${r}`")
      || src.includes("sculptHair(`fcropN${r}`")
      || src.includes("sculptHair(`fcropM${r}`")
      || src.includes("sculptHair(`fcropL${r}`")
      || src.includes("sculptHair(`fcropK${r}`")
      || src.includes("sculptHair(`fcropJ${r}`")
      || src.includes("sculptHair(`fcropI${r}`")
      || src.includes("sculptHair(`fcropH${r}`")
      || src.includes("sculptHair(`fcropG${r}`")
      || src.includes("sculptHair(`fcropF${r}`")
      || src.includes("sculptHair(`fcropE${r}`")
      || src.includes("sculptHair(`fcropD${r}`")
      || src.includes("sculptHair(`fcropC${r}`")
      || src.includes("sculptHair(`fcropB${r}`")
      || src.includes('add(G.frenchCrop(1.05), 0, 0, 0, 1, 1.06, 1)')) {
    note('✗', 'mii.html — french crop should fade on the sides with forward bangs');
    failures++;
  } else {
    note('✓', 'mii.html french crop fades on the sides with forward bangs');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`pixG${r}`") || !src.includes('Dramatic side-V pixie')
      || !src.includes("st !== 'pixie'")
      || src.includes("sculptHair(`pixF${r}`")) {
    note('✗', 'mii.html — pixie should have a dramatic side-V and chunky raised nape');
    failures++;
  } else {
    note('✓', 'mii.html pixie has a dramatic side-V and chunky raised nape');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`quiffB${r}`") || !src.includes('G.quiff(1.05)')
      || !src.includes('straight bangs')
      || !src.includes("st !== 'quiff'")
      || src.includes("sculptHair(`quiffH${r}`")) {
    note('✗', 'mii.html — quiff should have straight bangs, ears out, and a tapered nape');
    failures++;
  } else {
    note('✓', 'mii.html quiff has straight bangs, ears out, and a tapered nape');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`pompP${r}`")
      || src.includes("sculptHair(`pompO${r}`") || src.includes("sculptHair(`pompN${r}`")
      || !src.includes('G.pomp(1.05)')
      || !src.includes('crownBridge')
      || !src.includes("st !== 'pompadour'")
      || !src.includes('stubbleHairMat')
      || !src.includes('fadeIntoStubble')
      || !src.includes('lineupHemY')
      || !src.includes('applyStubbleRimFade')
      || !src.includes('putStubbleFadeStack')
      || !src.includes("sculptHair(`fadeBandA${level}_${r}`")
      || src.includes("sculptHair(`pompL${r}`")
      || src.includes("sculptHair(`pompM${r}`")
      || src.includes("sculptHair(`pompK${r}`")
      || src.includes("sculptHair(`pompJ${r}`")
      || src.includes("sculptHair(`pompI${r}`")
      || src.includes("sculptHair(`pompH${r}`")
      || src.includes("sculptHair(`pompG${r}`")
      || src.includes("sculptHair(`pompF${r}`")
      || src.includes("sculptHair(`pompE${r}`")
      || src.includes("sculptHair(`pompD${r}`")
      || src.includes("sculptHair(`pompC${r}`")
      || src.includes("sculptHair(`pompB${r}`")
      || src.includes('add(G.pomp(1.05)')) {
    note('✗', 'mii.html — pompadour should be a continuous front→crown sweep that fades on the sides');
    failures++;
  } else {
    note('✓', 'mii.html pompadour is a continuous front→crown sweep that fades on the sides');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`curtF${r}`") || !src.includes('G.curtains(1.05)')
      || !src.includes('big smooth flowy chunks')
      || !src.includes('hairClumps(b.phi, 2.0, 3.4, 5.0)')
      || !src.includes('ear notch high')
      || !src.includes("st !== 'curtains'")
      || src.includes("sculptHair(`curtE${r}`")
      || src.includes("sculptHair(`curtD${r}`")
      || src.includes("sculptHair(`curtC${r}`")) {
    note('✗', 'mii.html — curtains should be mid-length with big smooth chunks, ears out, and a raised nape');
    failures++;
  } else {
    note('✓', 'mii.html curtains is mid-length with big smooth chunks, ears out, and a raised nape');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`slickB${r}`") || !src.includes('G.slickBack(1.05)')
      || !src.includes('modest front bump')
      || !src.includes("st !== 'slickback'")
      || src.includes("sculptHair(`slickC${r}`")) {
    note('✗', 'mii.html — slick back should have straight bangs, ears out, and a high nape fade');
    failures++;
  } else {
    note('✓', 'mii.html slick back has straight bangs, ears out, and a high nape fade');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`swoopO${r}`")
      || src.includes("sculptHair(`swoopN${r}`") || src.includes("sculptHair(`swoopM${r}`")
      || !src.includes('G.swoopCurl(1.05)')
      || !src.includes('frontChunks')
      || !src.includes('crownRidge')
      || !src.includes("st !== 'swoop'")
      || !src.includes('lineupHemY')
      || !src.includes('fadeIntoStubble')
      || !src.includes('applyStubbleRimFade')
      || !src.includes('putStubbleFadeStack')
      || !src.includes("sculptHair(`fadeBandA${level}_${r}`")
      || src.includes("sculptHair(`swoopK${r}`")
      || src.includes("sculptHair(`swoopJ${r}`")
      || src.includes("sculptHair(`swoopI${r}`")
      || src.includes("sculptHair(`swoopH${r}`")
      || src.includes("sculptHair(`swoopG${r}`")
      || src.includes("sculptHair(`swoopF${r}`")
      || src.includes("sculptHair(`swoopE${r}`")
      || src.includes("sculptHair(`swoopD${r}`")
      || src.includes("sculptHair(`swoopC${r}`")
      || src.includes("sculptHair(`swoopB${r}`")) {
    note('✗', 'mii.html — swoop should be a continuous multi-chunk side-part sweep without a deep V notch');
    failures++;
  } else {
    note('✓', 'mii.html swoop is a continuous multi-chunk side-part sweep without a deep V notch');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`shcurlD${r}`") || !src.includes("'shortcurl'")
      || !src.includes('bigger even chunks')
      || !src.includes('higher bangs')
      || !src.includes("st !== 'shortcurl'")
      || src.includes("sculptHair(`shcurlC${r}`") || src.includes("geoCache(`shcurlB${r}`")
      || src.includes("geoCache(`shcurl${r}`") || src.includes('bumpy curl silhouette')) {
    note('✗', 'mii.html — short curls should be a curly crown with shaved sides, not two bumps');
    failures++;
  } else {
    note('✓', 'mii.html short curls are a curly crown with shaved sides');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`bedC${r}`") || !src.includes('G.bedHead(1.06)')
      || !src.includes('function applyFrostedTips')
      || !src.includes('function frostTipHex')
      || !src.includes('Short shaggy bed head')
      || !src.includes("st !== 'sidepart'")
      || src.includes("sculptHair(`bedB${r}`")
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
  if (!src.includes("sculptHair(`sweptB${r}`") || !src.includes('G.sweptHair(1.05)')
      || !src.includes('dramatic V on the right forehead')
      || !src.includes('partOff = -0.24')
      || !src.includes('earWin')
      || !src.includes('hairClumps')
      || !src.includes('Taper out')
      || !src.includes("st !== 'swept'")
      || src.includes("sculptHair(`sweptC${r}`")
      || src.includes('applySideburnsNape(\n      nx, ny, nz, frame.sideburn * 0.70, frame.nape * 0.55')) {
    note('✗', 'mii.html — swept should have a high side part, ear notches, and flowing clumps');
    failures++;
  } else {
    note('✓', 'mii.html swept has a high side part, ear notches, and flowing clumps');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("sculptHair(`wavD${r}`") || !src.includes('G.waves360(1.04)')
      || !src.includes('G.longPony()')
      || !src.includes("waves: 'Long ponytail'")
      || !src.includes('a V hairline')
      || !src.includes("st !== 'waves'")
      || src.includes("sculptHair(`wavC${r}`")
      || src.includes("waves: 'Waves'")
      || src.includes("geoCache('lponyA'")) {
    note('✗', 'mii.html — waves should be a long ponytail with a natural hairline');
    failures++;
  } else {
    note('✓', 'mii.html waves is a long ponytail with a natural hairline');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes('function thinHairline') || !src.includes('function partGroove')
      || src.includes('if (ny < 0.31) ny = 0.31')
      || src.includes('a short visor across the brow')) {
    note('✗', 'mii.html — haircuts should use a curved hairline and a real part, not a hat brim');
    failures++;
  } else {
    note('✓', 'mii.html haircuts use a curved hairline and a real part');
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
      || src.includes('cap(1.045, 1.68, 1.08)')
      || !src.includes('G.gatherScalp(1.04)')
      || !src.includes('G.pigtailBangs(1.05)')
      || !src.includes("sculptHair(`ptbC${r}`")
      || src.includes("sculptHair(`ptbB${r}`")
      || !src.includes('bunched root that tapers')
      || !src.includes('Continuous bang chunks')
      || src.includes('sx * 0.78, 0.78, -0.16, 0.20, 0.20, 0.20')
      || src.includes('sx * 0.90, 0.52, 0.36, 0.32, 0.40, 0.28')
      || !src.includes('High twin-tails')
      || !src.includes("st !== 'pigtails'")) {
    note('✗', 'mii.html — pigtails should hang off the back of the head');
    failures++;
  } else {
    note('✓', 'mii.html pigtails hang off the back of the head');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes('G.highPonyScalp(1.05)') || !src.includes('G.smoothPony()')
      || !src.includes('chunky natural')
      || !src.includes('higher-up centre-part V')
      || src.includes("sculptHair(`hponyB${r}`")
      || src.includes("sculptHair(`hponyA${r}`")
      || !src.includes("sculptHair(`hponyC${r}`")
      || src.includes("geoCache('sponyA'")
      || !src.includes("geoCache('sponyB'")
      || !src.includes("st !== 'highpony'")
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
  if (!src.includes("sculptHair(`gathG${r}`") || !src.includes("sculptHair(`bunAK${r}`")
      || src.includes("sculptHair(`bunAJ${r}`")
      || !src.includes('G.gatherScalp(1.04)') || !src.includes('G.bunStubble(1.045)')
      || !src.includes("put(G.bunStubble(1.045)")
      || !src.includes('stubbleHairMat(mat, dna.hair.color, extraMats, dna.skin)')
      || !src.includes('stubbleHemY')
      || !src.includes('buzzStubbleHemY')
      || !src.includes('lineupHemY')
      || !src.includes('stubbleJoinTaper')
      || src.includes('add(G.bunStubble(1.045), 0, 0, 0)')
      || src.includes("sculptHair(`bunAH${r}`")
      || src.includes("sculptHair(`bunAI${r}`")
      || src.includes("sculptHair(`bunAG${r}`")
      || src.includes("sculptHair(`bunAF${r}`")
      || src.includes("sculptHair(`bunAE${r}`")
      || src.includes("sculptHair(`bunAD${r}`")
      || src.includes("sculptHair(`bunAC${r}`")
      || src.includes("sculptHair(`gathF${r}`")
      || src.includes("sculptHair(`gathE${r}`")
      || src.includes("sculptHair(`gathD${r}`")
      || src.includes("sculptHair(`gathC${r}`")
      || src.includes("sculptHair(`gathB${r}`")
      || src.includes("sculptHair(`gathA${r}`")
      || src.includes("sculptHair(`bunU${r}`")
      || src.includes("sculptHair(`bunT${r}`")
      || src.includes("sculptHair(`bunS${r}`")
      || src.includes("cap(1.05, 1.52, 1.06)")
      || src.includes('cap(1.038, 1.30, 1.0)')
      || !src.includes("st !== 'bun'") || !src.includes("st !== 'pony'")
      || !src.includes("st !== 'spacebuns'")
      || !src.includes('Bang chunk from crown V')
      || !src.includes('one continuous flowy back pony')
      || src.includes('sx * 0.70, 1.04, 0.04, 0.48, 0.46, 0.48')
      || src.includes('add(G.ball(), 0, 0.3, -1.02, 0.34, 0.34, 0.34)')) {
    note('✗', 'mii.html — bun / pony / spacebuns should use a gathered scalp, not a hat-brim cap');
    failures++;
  } else {
    note('✓', 'mii.html bun / pony / spacebuns use a gathered scalp with open forehead');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const hair = src.match(/const HAIRSTYLES = \[[\s\S]*?\];/);
  const hats = src.match(/const HATS = \{[\s\S]*?\n\};/);
  const noCapPicker = hair && !/\b'cap'\b/.test(hair[0]);
  const noCapHat = hats && !/^\s*cap:\s/m.test(hats[0]);
  const aliased = src.includes("cap: 'flatbrim'");
  if (!noCapPicker || !noCapHat || !aliased) {
    note('✗', 'mii.html — Cap should be removed from the hat catalogue and alias to flatbrim');
    failures++;
  } else {
    note('✓', 'mii.html Cap is parked; old DNA aliases to flat brim');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  if (!src.includes("geoCache('bktbrim4'") || !src.includes('G.bucketCrown(')
      || !src.includes('Khaki canvas fisherman')
      || !src.includes('lighter-canvas patch')
      || src.includes("geoCache('bktbrim3'")
      || src.includes("geoCache('bktbrim2'")
      || !src.includes("bucket: 'Bucket'")) {
    note('✗', 'mii.html — bucket should be a floppy canvas fisherman with a front patch');
    failures++;
  } else {
    note('✓', 'mii.html bucket is a floppy canvas fisherman with a front patch');
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
                 'open: true', "case 'techvest':", 'techvestB',
                 "const vest = '#1a1b1e'", "const shirt = '#2f6f9e'",
                 'openTop', 'scoopAt(W * 0.5)', "yBot = vy(0.82)"]
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — tech vest needs a black deep-V over a blue button-up');
    failures++;
  } else {
    note('✓', 'mii.html offers a black tech vest with a deep V over a blue shirt');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const apparel = src.match(/const APPAREL = \[[\s\S]*?\];/)?.[0] || '';
  const wired = ["id: 'vintage'", "label: 'Vintage tee'", "kind: 'vintage'",
                 "sleeves: 'raglan'", "case 'vintage':", 'paintPlazaTourPrint',
                 "const cream = '#ebe0cc'", "const word = 'PLAZA'",
                 "apparel.sleeves === 'raglan'"]
    .every((s) => src.includes(s));
  const inCatalogue = /id:\s*'vintage'/.test(apparel);
  const licensed = /ROLLING STONES|Mick Jagger|tongue and lips/i.test(src);
  if (!wired || !inCatalogue) {
    note('✗', 'mii.html — vintage tee needs a raglan cut and an original plaza poster in Tops');
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
  const wired = ["id: 'cutoff'", "label: 'Cutoff'", "kind: 'cutoff'",
                 "case 'cutoff':", 'hemBase', 'dna.skin', 'Raw frayed edge']
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — cutoff needs a crop hem with skin midriff');
    failures++;
  } else {
    note('✓', 'mii.html offers a cutoff crop with skin midriff');
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
  /* Hoodie / Bubble / Box share a folded rest-hood pouch on the upper back
     (opening rim at the collar), not a nape marble and not a cape flap. */
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const hooded = ["id: 'hoodie'", "id: 'bubble'", "id: 'boxhoodie'"]
    .every((s) => src.includes(s));
  const folded = src.includes('Folded-down rest hood')
    && src.includes("geoCache('rhoodA'")
    && src.includes('G.restHood()')
    && src.includes('Opening rim')
    && !src.includes('little nape bump');
  if (!hooded || !folded) {
    note('✗', 'mii.html — hooded tops need a small folded rest-hood on the upper back');
    failures++;
  } else {
    note('✓', 'mii.html hooded tops use a folded rest-hood pouch with a collar rim');
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

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const apparel = src.match(/const APPAREL = \[[\s\S]*?\];/)?.[0] || '';
  const block = src.match(/case 'blacktee': \{[\s\S]*?break;\n    \}/)?.[0] || '';
  const wired = ["id: 'blacktee'", "label: 'Co- pocket tee'", "kind: 'blacktee'",
                 "case 'blacktee':", 'paintCoMark', 'g.scale(0.58, 1)',
                 'front + 12']
    .every((s) => src.includes(s));
  const inCatalogue = /id:\s*'blacktee'/.test(apparel);
  const squeezed = block.includes('g.scale(0.58, 1)') && block.includes('paintCoMark');
  if (!wired || !inCatalogue || !squeezed) {
    note('✗', 'mii.html — Co- pocket tee needs an inward pocket stamp with X squeezed for sphere UVs');
    failures++;
  } else {
    note('✓', 'mii.html offers a Co- pocket tee with a narrowed chest stamp');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ['function installPlazaProps', 'userData.plazaItem',
                 'buildLeafyPlant', 'buildAloePlant', 'buildGlossySucculent',
                 'buildCactus', 'buildBamboo', 'buildTallLamp',
                 'buildCoffeeMachine', 'buildWaterCooler', 'buildDeskLaptop',
                 'buildArcadeCabinet', 'PIXEL RAID', 'World.props']
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — plaza needs clay office props with plazaItem tags');
    failures++;
  } else {
    note('✓', 'mii.html installs clay plaza props (plants, lamp, coffee, cooler, desk, arcade)');
  }
}

{
  const src = readFileSync(join(ROOT, 'mii.html'), 'utf8');
  const wired = ['const PlazaProps', 'PlazaProps.boot()', 'PlazaProps.syncTip',
                 'PlazaProps.tryActivate', 'id="plazaTip"',
                 "tagProp(g, 'plant-leafy', 'Monstera')",
                 "tagProp(g, 'lamp', 'Desk lamp')",
                 "tagProp(g, 'arcade', 'Space Invaders', true)"]
    .every((s) => src.includes(s));
  if (!wired) {
    note('✗', 'mii.html — plaza props need hover titles via PlazaProps + #plazaTip');
    failures++;
  } else {
    note('✓', 'mii.html shows hover titles on plaza props without blocking Miis');
  }
}

console.log(
  failures ? `\n${failures} problem(s) found\n` : '\nAll clear\n'
);
process.exit(failures ? 1 : 0);
