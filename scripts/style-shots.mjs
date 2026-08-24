/* Contact sheets of the customisation options.
 *
 * Renders every value of a given category through the real Mii builder and
 * tiles the results, which is the only practical way to eyeball whether a
 * frame shape or a hat actually reads at Mii scale.
 *
 * Usage: node scripts/style-shots.mjs [origin] [outDir]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = process.argv[2] || 'http://localhost:4444';
const OUT = process.argv[3] || '/opt/cursor/artifacts/screenshots';
const CHROME = '/usr/local/bin/google-chrome';

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'mii-styles-'));
let port = 0;

function launch() {
  const child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'
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
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
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
      }
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
  close() { try { this.ws.close(); } catch {} }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let chrome, cdp, targetId;

async function ev(expression) {
  const out = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true
  });
  if (out.exceptionDetails) {
    throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text);
  }
  return out.result.value;
}

/* Renders one contact sheet inside the page: builds each variant with the
 * real buildMii(), photographs it on an offscreen renderer, and tiles the
 * frames onto a labelled canvas. Returns a PNG data URL. */
const SHEET_FN = `
window.__styleSheet = async function (opts) {
  const { field, values, labels, title, cols = 6, cell = 190, base = {} } = opts;
  const THREE = window.MiiPlaza.THREE;

  const rt = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  rt.setPixelRatio(2);
  rt.setSize(cell, cell, false);
  rt.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc8d6e0, 1.05));
  const key = new THREE.DirectionalLight(0xfff6ea, 1.15); key.position.set(3, 6, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xcfe4f7, 0.42); fill.position.set(-4, 3, -3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.28); rim.position.set(0, 2, -6); scene.add(rim);

  const cam = new THREE.PerspectiveCamera(30, 1, 0.5, 40);
  const holder = new THREE.Group(); scene.add(holder);

  const rows = Math.ceil(values.length / cols);
  const HEAD = 54, LABEL = 26;
  const out = document.createElement('canvas');
  out.width = cols * cell;
  out.height = HEAD + rows * (cell + LABEL);
  const g = out.getContext('2d');
  g.fillStyle = '#eef4f8'; g.fillRect(0, 0, out.width, out.height);
  g.fillStyle = '#3d4d58';
  g.font = '700 24px system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(title, 18, HEAD / 2);

  for (let i = 0; i < values.length; i++) {
    const dna = window.MiiPlaza.randomDNA(Object.assign({ name: 'Mii' }, base.opts || {}));
    Object.assign(dna, base.dna || {});
    // field may be dotted, e.g. hair.style
    const parts = field.split('.');
    let target = dna;
    for (let p = 0; p < parts.length - 1; p++) target = target[parts[p]];
    target[parts[parts.length - 1]] = values[i];

    const built = window.MiiPlaza.buildMii(dna);
    built.root.position.y = 0;
    built.tag.visible = false;
    built.hit.visible = false;
    holder.add(built.root);

    // 30 degree fov gives a visible half-height of 0.268*distance, so the
    // distance has to clear the tallest hat rather than just the skull.
    const framing = base.framing || 'head';
    // A slight turn is essential for judging headwear and hair: dead-on hides
    // brim depth, crown height and anything happening at the back.
    holder.rotation.y = base.turn != null ? base.turn : 0;
    if (framing === 'head') {
      cam.position.set(0, 1.5, 3.5); cam.lookAt(0, 1.34, 0);
    } else if (framing === 'torso') {
      // Close on the chest — a garment's detail is a few dozen pixels at
      // full-body framing, which is too small to judge.
      cam.position.set(0, 0.62, 1.9); cam.lookAt(0, 0.52, 0);
    } else {
      cam.position.set(0, 1.05, 5.0); cam.lookAt(0, 0.86, 0);
    }
    cam.updateProjectionMatrix();
    rt.render(scene, cam);

    const col = i % cols, row = Math.floor(i / cols);
    const x = col * cell, y = HEAD + row * (cell + LABEL);
    g.fillStyle = '#ffffff';
    g.fillRect(x + 4, y + 4, cell - 8, cell - 8);
    g.drawImage(rt.domElement, x, y, cell, cell);
    g.fillStyle = '#7d8f9c';
    g.font = '600 15px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(String(labels[i]), x + cell / 2, y + cell + LABEL / 2);
    g.textAlign = 'left';

    holder.remove(built.root);
    // buildMii() hands back raw materials and textures; the Mii class owns
    // teardown normally, so release them by hand here.
    for (const m of built.mats) {
      if (m.map && m.map.userData && m.map.userData.own) m.map.dispose();
      m.dispose();
    }
    for (const k in built.faces) built.faces[k].dispose();
    built.nameTex.dispose(); built.nameMat.dispose();
    built.hit.material.dispose();
  }

  rt.dispose();
  return out.toDataURL('image/png');
};
`;

try {
  chrome = await launch();
  const t = await (await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' }
  )).json();
  targetId = t.id;
  cdp = await CDP.connect(`ws://127.0.0.1:${port}/devtools/page/${targetId}`);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: ORIGIN + '/mii' });
  await sleep(4500);

  await ev(SHEET_FN);

  const sheets = [
    {
      file: 'style-01-eyewear',
      title: 'Eyewear — plastic, metal, sunglasses',
      field: 'glasses',
      pick: `MiiPlaza.catalog.EYEWEAR.filter(e => e.id).map(e => e.id)`,
      labelExpr: `MiiPlaza.catalog.EYEWEAR.filter(e => e.id).map(e => e.label)`,
      cols: 8,
      base: { dna: { hair: undefined }, framing: 'head' }
    },
    {
      file: 'style-02-haircuts',
      title: 'Haircuts',
      field: 'hair.style',
      pick: `MiiPlaza.catalog.HAIRSTYLES.filter(s => !MiiPlaza.catalog.HAT_STYLES.includes(s))`,
      labelExpr: `MiiPlaza.catalog.HAIRSTYLES
        .filter(s => !MiiPlaza.catalog.HAT_STYLES.includes(s))
        .map(s => MiiPlaza.styleLabel(s))`,
      cols: 8,
      base: { framing: 'head', turn: -0.42 }
    },
    {
      file: 'style-02b-headwear',
      title: 'Headwear',
      field: 'hair.style',
      pick: `MiiPlaza.catalog.HAT_STYLES`,
      labelExpr: `MiiPlaza.catalog.HAT_STYLES.map(s => MiiPlaza.styleLabel(s))`,
      cols: 6,
      base: { framing: 'head', turn: -0.42 }
    },
    {
      // Rear three-quarter: open hair shells show their inside face here, so
      // this is where see-through would appear if backface culling were on.
      file: 'style-02c-haircuts-back',
      title: 'Haircuts from behind — checking for see-through shells',
      field: 'hair.style',
      pick: `MiiPlaza.catalog.HAIRSTYLES.filter(s => !MiiPlaza.catalog.HAT_STYLES.includes(s))`,
      labelExpr: `MiiPlaza.catalog.HAIRSTYLES
        .filter(s => !MiiPlaza.catalog.HAT_STYLES.includes(s))
        .map(s => MiiPlaza.styleLabel(s))`,
      cols: 8,
      base: { framing: 'head', turn: 2.5 }
    },
    {
      file: 'style-03-facial-hair',
      title: 'Facial hair',
      field: 'facialHair',
      pick: `MiiPlaza.catalog.FACIAL_HAIR.map(f => f.id)`,
      labelExpr: `MiiPlaza.catalog.FACIAL_HAIR.map(f => f.label)`,
      cols: 7,
      base: { framing: 'head' }
    },
    {
      file: 'style-04-piercings',
      title: 'Nose rings',
      field: 'piercing',
      pick: `MiiPlaza.catalog.PIERCINGS.map(p => p.id)`,
      labelExpr: `MiiPlaza.catalog.PIERCINGS.map(p => p.label)`,
      cols: 6,
      base: { framing: 'head' }
    },
    {
      file: 'style-04b-tattoos',
      title: 'Ink',
      field: 'tattoo',
      pick: `MiiPlaza.catalog.TATTOOS.map(t => t.id)`,
      labelExpr: `MiiPlaza.catalog.TATTOOS.map(t => t.label)`,
      cols: 4,
      // no hat or beard in the way, and close enough to judge the jaw
      base: { framing: 'head', turn: -0.3,
              dna: { tattoo: 'none', facialHair: 'none', hair: { style: 'buzz', color: '#2b1d15' } } }
    },
    {
      file: 'style-04c-tattoos-body',
      title: 'Ink — full body, to check the hands',
      field: 'tattoo',
      pick: `MiiPlaza.catalog.TATTOOS.map(t => t.id)`,
      labelExpr: `MiiPlaza.catalog.TATTOOS.map(t => t.label)`,
      cols: 4,
      base: { framing: 'body', turn: -0.2,
              dna: { tattoo: 'none', facialHair: 'none', apparel: 'tee',
                     hair: { style: 'buzz', color: '#2b1d15' } } }
    },
    {
      file: 'style-05b-apparel-close',
      title: 'Apparel — chest detail',
      field: 'apparel',
      pick: `MiiPlaza.catalog.APPAREL.map(a => a.id)`,
      labelExpr: `MiiPlaza.catalog.APPAREL.map(a => a.label)`,
      cols: 6,
      base: { framing: 'torso', turn: 0,
              dna: { hair: { style: 'crop', color: '#2b1d15' }, facialHair: 'none',
                     glasses: 0, tattoo: 'none' } }
    },
    {
      file: 'style-05-apparel',
      title: 'Apparel — streetwear and kits',
      field: 'apparel',
      pick: `MiiPlaza.catalog.APPAREL.map(a => a.id)`,
      labelExpr: `MiiPlaza.catalog.APPAREL.map(a => a.label)`,
      cols: 6,
      base: { framing: 'body', turn: -0.25,
              dna: { hair: { style: 'crop', color: '#2b1d15' }, facialHair: 'none',
                     glasses: 0, tattoo: 'none' } }
    },
    {
      file: 'style-06-badges',
      title: 'Digital ID badge',
      field: 'badge',
      pick: `MiiPlaza.catalog.BADGES.map(b => b.id)`,
      labelExpr: `MiiPlaza.catalog.BADGES.map(b => b.label)`,
      cols: 5,
      base: { framing: 'body' }
    }
  ];

  console.log('\nContact sheets:');
  for (const s of sheets) {
    const dataUrl = await ev(`(async () => {
      const values = ${s.pick};
      const labels = ${s.labelExpr};
      return await window.__styleSheet({
        field: ${JSON.stringify(s.field)},
        values, labels,
        title: ${JSON.stringify(s.title)},
        cols: ${s.cols},
        base: ${JSON.stringify(s.base)}
      });
    })()`);
    const file = join(OUT, s.file + '.png');
    writeFileSync(file, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    console.log('  ' + file);
  }
  console.log('\nDone\n');
} catch (e) {
  console.error('\nFailed: ' + e.message + '\n');
  process.exitCode = 1;
} finally {
  if (cdp) cdp.close();
  if (targetId) await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`).catch(() => {});
  if (chrome) chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
