/* Drives the badge flow through the real UI in headless Chrome.
 *
 * The API is covered by scripts/smoke.mjs; this covers the parts only a
 * browser can prove: that the modal wires up, that a character built from an
 * uploaded image reaches the server, that the session cookie survives a
 * reload, and that the duplicate-email banner appears where a user would see
 * it.
 *
 * Usage: node scripts/flow-check.mjs [origin]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = process.argv[2] || 'http://localhost:4444';
const CHROME = '/usr/local/bin/google-chrome';
const profile = mkdtempSync(join(tmpdir(), 'mii-flow-'));
let port = 0;

function launch() {
  const child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (d) => {
      buf += d.toString();
      const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(buf);
      if (m) { port = Number(m[1]); resolve(child); }
    };
    child.stderr.on('data', onData);
    child.stdout.on('data', onData);
    child.on('exit', (c) => reject(new Error('chrome exited ' + c)));
    setTimeout(() => reject(new Error('chrome did not start')), 20000);
  });
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const c = new CDP(ws);
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pending.has(m.id)) {
        const { resolve, reject } = c.pending.get(m.id);
        c.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method) for (const fn of c.listeners) fn(m);
    });
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch {} }
}

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail !== undefined ? ` — ${detail}` : ''}`); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let chrome, cdp, targetId;

async function evaluate(expression) {
  const out = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true
  });
  if (out.exceptionDetails) {
    throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text);
  }
  return out.result.value;
}

async function openPage(path = '/mii') {
  await cdp.send('Page.navigate', { url: ORIGIN + path });
  await sleep(3500);
}

try {
  chrome = await launch();
  const target = await (await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' }
  )).json();
  targetId = target.id;
  cdp = await CDP.connect(`ws://127.0.0.1:${port}/devtools/page/${targetId}`);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const EMAIL = `flow-${Date.now()}@example.com`;

  console.log('\nplaza boots');
  await openPage('/mii');
  check('three.js scene is live', await evaluate('!!window.MiiPlaza && !!MiiPlaza.World.renderer'));
  check('config reached the client', await evaluate('MiiPlaza.Config.loaded === true'));
  check('talking to the API', await evaluate("MiiPlaza.Store.mode === 'server'"), await evaluate('MiiPlaza.Store.mode'));
  check('no session yet', await evaluate('MiiPlaza.Store.session === null'));
  check('badge chip hidden', await evaluate("!document.getElementById('mineChip').classList.contains('show')"));

  console.log('\nbadge modal');
  await evaluate("document.getElementById('btnCamera').click()");
  await sleep(600);
  check('modal opens', await evaluate("document.getElementById('modal').classList.contains('open')"));
  check('email field hidden before a photo',
    await evaluate("getComputedStyle(document.getElementById('camEmailRow')).display === 'none'"));

  // A dismiss control has to be present and reachable in every state, not
  // just the ones that happen to carry a Cancel button.
  check('close button is visible on open', await evaluate(`(() => {
    const x = document.getElementById('camX');
    const r = x.getBoundingClientRect();
    return r.width >= 30 && r.height >= 30 && getComputedStyle(x).visibility === 'visible';
  })()`));
  check('close button is labelled for screen readers',
    await evaluate("document.getElementById('camX').getAttribute('aria-label') === 'Close'"));
  check('the dialog announces itself',
    await evaluate("document.getElementById('modal').getAttribute('role') === 'dialog'"));
  check('close button dismisses the modal', await evaluate(`(() => {
    document.getElementById('camX').click();
    return !document.getElementById('modal').classList.contains('open');
  })()`));
  await evaluate("document.getElementById('btnCamera').click()");
  await sleep(500);
  check('and the modal reopens cleanly',
    await evaluate("document.getElementById('modal').classList.contains('open')"));

  // A photo is normally captured from a webcam; a synthetic face-ish canvas
  // exercises the same analyze -> DNA -> preview path headlessly.
  await evaluate(`(async () => {
    const c = document.createElement('canvas');
    c.width = 300; c.height = 300;
    const g = c.getContext('2d');
    g.fillStyle = '#8899aa'; g.fillRect(0, 0, 300, 300);
    g.fillStyle = '#f0c9a4'; g.beginPath(); g.ellipse(150, 150, 78, 96, 0, 0, 7); g.fill();
    g.fillStyle = '#3b2415'; g.fillRect(60, 42, 180, 52);
    g.fillStyle = '#2a2a2a'; g.beginPath(); g.arc(122, 142, 9, 0, 7); g.fill();
    g.beginPath(); g.arc(178, 142, 9, 0, 7); g.fill();
    g.fillStyle = '#a5474a'; g.fillRect(128, 196, 44, 11);
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = c.toDataURL('image/png'); });
    MiiPlaza.Cam.capture(img);
  })()`);
  await sleep(1200);

  check('character built from the photo', await evaluate('!!MiiPlaza.Cam.dna'));
  check('email field now required',
    await evaluate("getComputedStyle(document.getElementById('camEmailRow')).display !== 'none'"));
  check('email field is labelled Email',
    await evaluate("document.querySelector('label[for=\"miiEmail\"]').textContent.trim() === 'Email'"));
  check('name and email sit one under the other at half width', await evaluate(`(() => {
    const emailRow = document.getElementById('camEmailRow');
    const was = emailRow.style.display;
    emailRow.style.display = 'flex';
    const card = document.querySelector('#modal .card').getBoundingClientRect();
    const name = document.getElementById('miiName').getBoundingClientRect();
    const email = document.getElementById('miiEmail').getBoundingClientRect();
    emailRow.style.display = was;
    const half = card.width * 0.5;
    const nearHalf = (w) => Math.abs(w - half) < card.width * 0.14;
    return nearHalf(name.width) && nearHalf(email.width) && email.top > name.bottom - 1;
  })()`));
  check('preview renders to a PNG',
    await evaluate("(MiiPlaza.Preview.snapshot() || '').startsWith('data:image/png')"));

  console.log('\ncustomisation');
  {
    const cats = await evaluate(
      `[...document.querySelectorAll('.tray-cell .cat')].map(b => b.textContent)`);
    check('one stepper per category', cats.length >= 7, `got ${cats.length}: ${cats}`);
    check('headwear is labelled Hat', cats.includes('Hat') && !cats.includes('Headwear'), cats.join(', '));
    check('outfit is labelled Top', cats.includes('Top') && !cats.includes('Outfit'), cats.join(', '));
    check('ear jewellery is gone', !cats.includes('Ears'), cats.join(', '));
    // Kit colour and squad number are baked into each shirt now, so those two
    // steppers should be gone rather than sitting there doing nothing.
    check('kit colour and number steppers are gone',
      !cats.includes('Kit colours') && !cats.includes('Number'), cats.join(', '));
    // The 3D ID badge overlay on the character was removed. The real badge —
    // the QR, the Wallet pass, the email — is a separate thing and must stay.
    check('the character ID badge overlay is gone', !cats.includes('ID badge'), cats.join(', '));
    check('option names stay off the buttons', await evaluate(`
      [...document.querySelectorAll('.cyc .val')].length === 0
      && ![...document.querySelectorAll('#camTray button')]
        .some(b => /crop|afro|locs|bowl|pompadour/i.test(b.textContent))`));

    // The whole point of the rewrite: far fewer controls on screen than a
    // tab row plus a grid of every option.
    const controls = await evaluate(`document.querySelectorAll('#camTray .tray-cell').length`);
    check('the tray stays compact', controls <= 7, `${controls} categories`);
    check('style tray steps in a fixed order', await evaluate(`(() => {
      const main = () => document.querySelector('.tray-cell[data-tray="hat"] .cyc-main');
      const clear = () => document.querySelector('.tray-cell[data-tray="hat"] .cyc-clear');
      if (clear()) clear().click();
      const seq = [];
      for (let n = 0; n < 3; n++) {
        main().click();
        seq.push(MiiPlaza.Cam.dna.hair.style);
      }
      clear().click();
      const again = [];
      for (let n = 0; n < 3; n++) {
        main().click();
        again.push(MiiPlaza.Cam.dna.hair.style);
      }
      return seq.length === 3 && JSON.stringify(seq) === JSON.stringify(again);
    })()`));
    check('× clears an active modifier', await evaluate(`(() => {
      const main = () => document.querySelector('.tray-cell[data-tray="hat"] .cyc-main');
      const clear = () => document.querySelector('.tray-cell[data-tray="hat"] .cyc-clear');
      main().click();
      if (!clear()) return false;
      clear().click();
      return !clear();
    })()`));
    check('a colour chip closes when you tap elsewhere', await evaluate(`(() => {
      const pick = document.querySelector('#camPickers .pick');
      const pal = document.getElementById('camPalette');
      if (!pick || !pal) return false;
      pick.click();
      if (!pal.classList.contains('open')) return false;
      document.getElementById('camTitle').dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true })
      );
      return !pal.classList.contains('open');
    })()`));
    check('steppers sit in one row', await evaluate(`(() => {
      const tops = [...document.querySelectorAll('.tray-cell')]
        .map(b => Math.round(b.getBoundingClientRect().top));
      return tops.length >= 7 && tops.every(t => t === tops[0]);
    })()`));

    // Stepping must actually change the character and not throw. Catalogues
    // are data; a bad entry would only surface as an unrenderable mesh.
    const sweep = await evaluate(`(() => {
      const failures = [];
      let clicks = 0;
      const snap = () => JSON.stringify({
        h: MiiPlaza.Cam.dna.hair.style, u: MiiPlaza.Cam.dna._hairUnder,
        g: MiiPlaza.Cam.dna.glasses, f: MiiPlaza.Cam.dna.facialHair,
        p: MiiPlaza.Cam.dna.piercing, t: MiiPlaza.Cam.dna.tattoo,
        a: MiiPlaza.Cam.dna.apparel
      });
      const cats = [...document.querySelectorAll('.tray-cell .cat')].map(c => c.textContent);
      for (const name of cats) {
        const before = snap();
        let changed = false;
        for (let i = 0; i < 12; i++) {
          const btn = [...document.querySelectorAll('.tray-cell')]
            .find(c => c.querySelector('.cat')?.textContent === name)
            ?.querySelector('.cyc-main');
          if (!btn) { failures.push(name + ': button vanished'); break; }
          try { btn.click(); clicks++; }
          catch (e) { failures.push(name + ': ' + e.message); break; }
          if (snap() !== before) changed = true;
        }
        if (!changed) failures.push(name + ': never changed');
      }
      return { clicks, failures };
    })()`);
    check('every stepper runs without throwing', sweep.failures.length === 0,
      sweep.failures.slice(0, 3).join(' | '));
    check('tapped every stepper', sweep.clicks === cats.length * 12,
      `${sweep.clicks} steps across ${cats.length} buttons`);

    // Hair and headwear share one slot. The first tap on Hair has to take
    // the hat off rather than also skipping the cut underneath.
    const slot = await evaluate(`(() => {
      const hats = MiiPlaza.catalog.HAT_STYLES;
      const byCat = (n) => [...document.querySelectorAll('.tray-cell')]
        .find(c => c.querySelector('.cat')?.textContent === n)
        ?.querySelector('.cyc-main');
      let guard = 0;
      while (!hats.includes(MiiPlaza.Cam.dna.hair.style) && guard++ < 40) {
        byCat('Hat').click();
      }
      const hatOn = MiiPlaza.Cam.dna.hair.style;
      const hairUnder = MiiPlaza.Cam.dna._hairUnder;
      byCat('Hair').click();
      return {
        hatOn, hairUnder,
        afterClaim: MiiPlaza.Cam.dna.hair.style,
        hatAfter: hats.includes(MiiPlaza.Cam.dna.hair.style)
      };
    })()`);
    check('a hat can be stepped on', Boolean(slot.hatOn) && slot.hatOn !== slot.hairUnder,
      JSON.stringify(slot));
    check('tapping hair reveals that same cut', slot.afterClaim === slot.hairUnder, JSON.stringify(slot));
    check('and takes the hat off', slot.hatAfter === false, JSON.stringify(slot));

    // Hair and hats share one slot, and volume has to stay above the brow
    // line or it starts covering the eyes.
    const cuts = await evaluate(`(() => {
      const cat = MiiPlaza.catalog;
      const hats = cat.HAT_STYLES;
      const cutList = cat.HAIRSTYLES.filter(s => !hats.includes(s));
      return { cuts: cutList.length, hats: hats.length,
               overlap: cutList.filter(s => hats.includes(s)).length };
    })()`);
    check('haircuts and headwear are distinct sets', cuts.overlap === 0);
    check('offers a real range of cuts', cuts.cuts >= 20, `${cuts.cuts} cuts`);
    // A style with no label entry falls through to its raw lowercase id,
    // which is how "combover" would reach the picker.
    const unlabelled = await evaluate(`
      MiiPlaza.catalog.HAIRSTYLES.filter(s => !/^[A-Z]/.test(MiiPlaza.styleLabel(s)))`);
    check('every style has a display label', unlabelled.length === 0, unlabelled.join(', '));

    const extras = await evaluate(`(() => {
      const cat = MiiPlaza.catalog;
      const cuts = cat.HAIRSTYLES.filter(s => !cat.HAT_STYLES.includes(s));
      const glasses = cat.EYEWEAR;
      return {
        hasSwoop: cuts.includes('swoop'),
        hasFlow: cuts.includes('flow'),
        hasMullet: cuts.includes('mullet'),
        hasWolf: cuts.includes('wolf'),
        hasHighpony: cuts.includes('highpony'),
        hasPigtails: cuts.includes('pigtails'),
        hasLayers: cuts.includes('layers'),
        hasSpacebuns: cuts.includes('spacebuns'),
        outfits: cat.APPAREL.map(a => a.id),
        tattoos: cat.TATTOOS.map(t => t.id),
        bandanas: cat.HAT_STYLES.filter(s => s.startsWith('bandana')),
        wedge: glasses.filter(e => e.frame === 'wedge').map(e => e.id),
        wrap: glasses.filter(e => e.frame === 'wrap').map(e => e.label),
        tints: glasses.filter(e => e.tint).map(e => e.tint)
      };
    })()`);
    check('James Dean swoop is in the list', extras.hasSwoop);
    check('new characters start without piercings',
      await evaluate(`Array.from({length: 16}, () => MiiPlaza.randomDNA().piercing)
        .every(p => p === 'none')`));
    check('flowy mens cuts are in the list', extras.hasFlow && extras.hasMullet && extras.hasWolf);
    check('long hair parts are in the list', await evaluate(`(() => {
      const cuts = MiiPlaza.catalog.HAIRSTYLES;
      return ['long','longmiddle','longside','longwavy'].every(s => cuts.includes(s));
    })()`));
    check('women\'s cuts are in the list',
      extras.hasHighpony && extras.hasPigtails && extras.hasLayers && extras.hasSpacebuns,
      JSON.stringify({
        highpony: extras.hasHighpony, pigtails: extras.hasPigtails,
        layers: extras.hasLayers, spacebuns: extras.hasSpacebuns
      }));
    check('women\'s outfits are in the list',
      ['dress','sundress','skirt','cardigan'].every((id) => extras.outfits.includes(id)),
      extras.outfits.join(', '));
    check('argyle sweater is in the list', extras.outfits.includes('argyle'),
      extras.outfits.join(', '));
    check('tribal ink is in the list', extras.tattoos.includes('tribal'),
      extras.tattoos.join(', '));
    check('bandanas come in red, blue and green',
      extras.bandanas.includes('bandana') && extras.bandanas.includes('bandanablue')
        && extras.bandanas.includes('bandanagreen'),
      JSON.stringify(extras.bandanas));
    check('no triangular wedge frames', extras.wedge.length === 0, extras.wedge.join(','));
    check('wrap-around baseball shades are in the list', extras.wrap.length >= 3, extras.wrap.join(', '));
    check('tinted lenses are actually tinted', extras.tints.every((t) => {
      const m = /,\s*([0-9.]+)\)/.exec(t);
      return m && Number(m[1]) >= 0.85;
    }), extras.tints.join(', '));

    // Retired novelty styles must not leave a stored character bald.
    const aliased = await evaluate(`(() => {
      const out = {};
      for (const old of ['mohawk', 'buzzline', 'topknot', 'tails', 'undercut']) {
        const d = MiiPlaza.normalizeDNA({ hair: { style: old, color: '#333' } });
        out[old] = d.hair.style;
      }
      return out;
    })()`);
    check('retired styles map onto real cuts',
      Object.values(aliased).every((v) => !['mohawk','buzzline','topknot','tails','undercut'].includes(v)),
      JSON.stringify(aliased));

    // Legacy rows predate these fields; they must still render.
    const legacy = await evaluate(`(() => {
      try {
        const old = { name: 'Old', skin: '#f3c9a8', hair: { color: '#2b1d15', style: 'bowl' },
          eyes: { color: '#333', style: 0, size: 13, spacing: 16, y: 40 },
          brows: { color: '#222', style: 0, w: 13, h: 3, gap: 12, angle: 0 },
          mouth: { style: 0, w: 16, h: 3, y: 68 }, nose: { size: 0.12, y: -0.08 },
          shirt: '#3fa9e0', headSize: 1, height: 1, girth: 1,
          glasses: 2, stache: true, beard: false };
        const m = MiiPlaza.buildMii(old);
        return { ok: true, facialHair: old.facialHair, apparel: old.apparel };
      } catch (e) { return { ok: false, error: e.message }; }
    })()`);
    check('a pre-update character still builds', legacy.ok === true, legacy.error);
    check('old stache boolean carries over', legacy.facialHair === 'stache', legacy.facialHair);
    check('missing outfit defaults to a tee', legacy.apparel === 'tee', legacy.apparel);

    // Retired piercings and ear jewellery must not leave a stored character
    // asking for a piece that no longer renders.
    const retired = await evaluate(`(() => {
      const out = {};
      for (const p of ['brow', 'lip', 'nose']) {
        out[p] = MiiPlaza.normalizeDNA({ hair: { style: 'bowl', color: '#333' }, piercing: p }).piercing;
      }
      const withEars = MiiPlaza.normalizeDNA({
        hair: { style: 'bowl', color: '#333' }, ears: 'stacked'
      });
      out.earsDropped = withEars.ears === undefined;
      try {
        MiiPlaza.buildMii({ name: 'Old', skin: '#f3c9a8',
          hair: { color: '#2b1d15', style: 'bowl' },
          eyes: { color: '#333', style: 0, size: 13, spacing: 16, y: 40 },
          brows: { color: '#222', style: 0, w: 13, h: 3, gap: 12, angle: 0 },
          mouth: { style: 0, w: 16, h: 3, y: 68 }, nose: { size: 0.12, y: -0.08 },
          shirt: '#3fa9e0', headSize: 1, height: 1, girth: 1,
          piercing: 'lip', ears: 'hoop' });
        out.builds = true;
      } catch (e) { out.builds = false; out.error = e.message; }
      return out;
    })()`);
    // Outfits that were removed should land on the nearest survivor rather
    // than silently resetting someone to a plain tee.
    const outfits = await evaluate(`(() => {
      const out = {};
      for (const o of ['washed', 'crop', 'denim', 'techwear', 'hoops', 'hoopsretro',
                       'soccer', 'soccerfed', 'kit-pink', 'kit-claret', 'kit-blue', 'kit-white']) {
        out[o] = MiiPlaza.normalizeDNA({ hair: { style: 'bowl', color: '#333' }, apparel: o }).apparel;
      }
      out.ids = MiiPlaza.catalog.APPAREL.map(a => a.id);
      return out;
    })()`);
    check('retired outfits map onto current ones',
      ['washed','crop','denim','techwear','hoops','hoopsretro','soccer','soccerfed',
       'kit-pink','kit-claret','kit-blue','kit-white']
        .every((o) => outfits.ids.includes(outfits[o])),
      JSON.stringify(outfits));
    check('old kits land on the one jersey',
      outfits.hoops === 'jersey' && outfits.soccer === 'jersey' && outfits['kit-pink'] === 'jersey',
      `${outfits.hoops}, ${outfits.soccer}, ${outfits['kit-pink']}`);
    check('the outfit list has a single jersey',
      outfits.ids.filter((id) => id === 'jersey' || id.startsWith('kit-')).length === 1,
      outfits.ids.join(', '));

    check('retired piercings fall back to none', retired.brow === 'none' && retired.lip === 'none',
      JSON.stringify(retired));
    check('nose piercings are untouched', retired.nose === 'nose', retired.nose);
    check('stored ear jewellery is dropped', retired.earsDropped === true);
    check('a character with retired pieces still builds', retired.builds === true, retired.error);
  }

  console.log('\nvalidation in the UI');
  const beforeClaim = await evaluate('MiiPlaza.World.miis.length');
  await evaluate("document.getElementById('miiEmail').value = 'not-an-email'");
  await evaluate("document.getElementById('btnAccept').click()");
  await sleep(500);
  check('blocks a malformed email inline',
    await evaluate("document.getElementById('camBanner').classList.contains('show')"));
  check('nobody was added', await evaluate(`MiiPlaza.World.miis.length === ${beforeClaim}`));

  await evaluate("document.getElementById('miiEmail').value = ''");
  await evaluate("document.getElementById('btnAccept').click()");
  await sleep(400);
  check('blocks a missing email',
    await evaluate("document.getElementById('camBanner').textContent.length > 0"));

  await evaluate("document.getElementById('miiName').value = 'fuck';");
  await evaluate("document.getElementById('miiEmail').value = 'clean@example.com';");
  await evaluate("document.getElementById('btnAccept').click()");
  await sleep(400);
  check('blocks offensive names inline',
    await evaluate("document.getElementById('camBanner').textContent.includes('not allowed')"));
  check('offensive name did not join',
    await evaluate(`MiiPlaza.World.miis.length === ${beforeClaim}`));

  console.log('\nclaiming a badge');
  await evaluate(`document.getElementById('miiName').value = 'Flow';
    document.getElementById('miiEmail').value = ${JSON.stringify(EMAIL)};`);
  await evaluate("document.getElementById('btnAccept').click()");
  await sleep(2500);

  check('character joined the plaza',
    await evaluate(`MiiPlaza.World.miis.length === ${beforeClaim + 1}`));
  check('session established', await evaluate('!!MiiPlaza.Store.session'));
  check('badge panel shown',
    await evaluate("document.getElementById('camBadge').classList.contains('show')"));
  check('badge names the holder above the QR',
    await evaluate("document.getElementById('badgeWho').textContent === 'Flow'"));
  check('badge shows the email',
    await evaluate("document.getElementById('badgeEmail').textContent === " + JSON.stringify(EMAIL)));
  check('badge shows days at CO—WORKING',
    await evaluate("/CO—WORKING/.test(document.getElementById('badgeSince').textContent)"));
  check('badge shows the Mii next to the QR',
    await evaluate(`(() => {
      const mii = document.getElementById('badgeMii');
      const qr = document.getElementById('badgeQr');
      if (!mii.getAttribute('src') || getComputedStyle(mii).display === 'none') return false;
      const a = mii.getBoundingClientRect();
      const b = qr.getBoundingClientRect();
      const beside = Math.abs(a.top - b.top) < 48 && a.left < b.left;
      const stacked = a.bottom <= b.top + 12;
      return beside || stacked;
    })()`));
  check('QR image is pointed at our endpoint',
    await evaluate("(document.getElementById('badgeQr').src || '').includes('/api/qr/')"));
  check('wallet button hidden without credentials',
    await evaluate("getComputedStyle(document.getElementById('badgeWallet')).display === 'none'"));
  check('explains why wallet is missing',
    await evaluate("document.getElementById('badgeNote').textContent.includes('Wallet')"));
  check('badge chip now visible',
    await evaluate("document.getElementById('mineChip').classList.contains('show')"));
  // The badge screen only carries a Done button, so the X is the other way out.
  check('close button still reachable on the badge screen', await evaluate(`(() => {
    const x = document.getElementById('camX');
    return x.getBoundingClientRect().width >= 30 && x.offsetParent !== null;
  })()`));
  check('chip shows the name',
    await evaluate("document.getElementById('mineName').textContent === 'Flow'"));

  const qrOk = await evaluate(`(async () => {
    const r = await fetch(document.getElementById('badgeQr').src);
    return r.ok && (r.headers.get('content-type') || '').includes('image/png');
  })()`);
  check('QR endpoint actually serves a PNG', qrOk === true);

  console.log('\nsession survives a reload');
  await openPage('/mii');
  await sleep(1200);
  check('cookie restored the session', await evaluate('!!MiiPlaza.Store.session'));
  check('our character is marked mine',
    await evaluate("MiiPlaza.World.miis.some(m => m.mine === true)"));
  check('chip is back on load',
    await evaluate("document.getElementById('mineChip').classList.contains('show')"));
  check('badge reachable from the chip', await evaluate(`(() => {
    document.getElementById('mineManage').click();
    return document.getElementById('camBadge').classList.contains('show');
  })()`));

  console.log('\nduplicate email');
  const dupe = await evaluate(`(async () => {
    const r = await fetch('/api/miis', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email: ${JSON.stringify(EMAIL)}, name: 'Copy', dna: { name: 'Copy' } })
    });
    return { status: r.status, body: await r.json() };
  })()`);
  check('server refuses a second badge', dupe.status === 409, `got ${dupe.status}`);
  check('duplicate is flagged for the UI', dupe.body.code === 'email_taken');

  console.log('\nrecovery panel');
  await openPage('/mii');
  await evaluate("document.getElementById('btnCamera').click()");
  await sleep(500);
  await evaluate("document.getElementById('btnRecover').click()");
  await sleep(400);
  check('recovery panel opens',
    await evaluate("document.getElementById('camRecover').classList.contains('show')"));
  await evaluate("document.getElementById('recoverEmail').value = 'bad'");
  await evaluate("document.getElementById('btnRecoverSend').click()");
  await sleep(400);
  check('recovery validates the address',
    await evaluate("document.getElementById('recoverBanner').classList.contains('bad')"));

  console.log('\nlocal save still shows the badge card');
  await evaluate(`(() => {
    MiiPlaza.Config.storage = 'legacy';
    MiiPlaza.Config.features.sessions = false;
  })()`);
  await evaluate("document.getElementById('camX') && document.getElementById('camX').click()");
  await sleep(300);
  await evaluate("document.getElementById('btnCamera').click()");
  await sleep(500);
  await evaluate(`(async () => {
    const c = document.createElement('canvas');
    c.width = 300; c.height = 300;
    const g = c.getContext('2d');
    g.fillStyle = '#8899aa'; g.fillRect(0, 0, 300, 300);
    g.fillStyle = '#f0c9a4'; g.beginPath(); g.ellipse(150, 150, 78, 96, 0, 0, 7); g.fill();
    g.fillStyle = '#3b2415'; g.fillRect(60, 42, 180, 52);
    g.fillStyle = '#2a2a2a'; g.beginPath(); g.arc(122, 142, 9, 0, 7); g.fill();
    g.beginPath(); g.arc(178, 142, 9, 0, 7); g.fill();
    g.fillStyle = '#a5474a'; g.fillRect(128, 196, 44, 11);
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = c.toDataURL('image/png'); });
    MiiPlaza.Cam.capture(img);
  })()`);
  await sleep(800);
  await evaluate("document.getElementById('miiName').value = 'Local';");
  await evaluate("document.getElementById('btnAccept').click()");
  await sleep(800);
  check('local claim still opens the badge panel',
    await evaluate("document.getElementById('camBadge').classList.contains('show')"));
  check('local badge names the holder',
    await evaluate("document.getElementById('badgeWho').textContent === 'Local'"));
  check('local badge shows days at CO—WORKING',
    await evaluate("/CO—WORKING/.test(document.getElementById('badgeSince').textContent)"));
  check('local badge shows the Mii',
    await evaluate(`(() => {
      const mii = document.getElementById('badgeMii');
      return !!(mii.getAttribute('src') && getComputedStyle(mii).display !== 'none');
    })()`));

  console.log('\nadmin portal');
  await openPage('/admin');
  check('gate is shown first', await evaluate("!document.getElementById('gate').hidden"));
  check('console is hidden', await evaluate("document.getElementById('console').hidden === true"));
  await evaluate(`document.getElementById('key').value = 'local-admin';
    document.getElementById('gateForm').dispatchEvent(new Event('submit', { cancelable: true }));`);
  await sleep(1400);
  check('unlocks with the key', await evaluate("document.getElementById('console').hidden === false"));
  const rows = await evaluate("document.querySelectorAll('#rows tr').length");
  check('lists registered coworkers', rows >= 1, `rows: ${rows}`);
  check('shows the email column',
    await evaluate("document.querySelector('#rows td.email').textContent.includes('@')"));

} catch (e) {
  fail++;
  console.log('  ✗ harness — ' + e.message);
} finally {
  if (cdp) cdp.close();
  if (targetId) await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`).catch(() => {});
  if (chrome) chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
