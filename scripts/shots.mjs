/* Screenshots of the badge flow and admin portal, for review artifacts.
 *
 * Usage: node scripts/shots.mjs [origin] [outDir]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = process.argv[2] || 'http://localhost:4444';
const OUT = process.argv[3] || '/opt/cursor/artifacts/screenshots';
const CHROME = '/usr/local/bin/google-chrome';

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'mii-shots-'));
let port = 0;

function launch() {
  const child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
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
    expression, returnByValue: true, awaitPromise: true, userGesture: true
  });
  if (out.exceptionDetails) {
    throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text);
  }
  return out.result.value;
}

async function shoot(name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = join(OUT, name + '.png');
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('  ' + file);
}

async function viewport(width, height, mobile = false) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: mobile ? 2 : 1, mobile
  });
}

try {
  chrome = await launch();
  const t = await (await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' }
  )).json();
  targetId = t.id;
  cdp = await CDP.connect(`ws://127.0.0.1:${port}/devtools/page/${targetId}`);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const EMAIL = `shot-${Date.now()}@example.com`;
  console.log('\nCapturing:');

  await viewport(1280, 860);
  await cdp.send('Page.navigate', { url: ORIGIN + '/mii' });
  await sleep(4500);
  await shoot('01-plaza');

  await ev("document.getElementById('btnCamera').click()");
  await sleep(700);

  await ev(`(async () => {
    const c = document.createElement('canvas');
    c.width = 300; c.height = 300;
    const g = c.getContext('2d');
    g.fillStyle = '#8fa3b5'; g.fillRect(0, 0, 300, 300);
    g.fillStyle = '#f0c9a4'; g.beginPath(); g.ellipse(150, 152, 78, 96, 0, 0, 7); g.fill();
    g.fillStyle = '#4a2c17'; g.fillRect(62, 40, 176, 54);
    g.fillStyle = '#2a2a2a'; g.beginPath(); g.arc(122, 144, 9, 0, 7); g.fill();
    g.beginPath(); g.arc(178, 144, 9, 0, 7); g.fill();
    g.fillStyle = '#a5474a'; g.fillRect(128, 198, 44, 11);
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = c.toDataURL('image/png'); });
    MiiPlaza.Cam.capture(img);
  })()`);
  await sleep(1600);
  await ev(`document.getElementById('miiName').value = 'Gage';
    document.getElementById('miiEmail').value = ${JSON.stringify(EMAIL)};`);
  await sleep(300);
  await shoot('02-badge-form');

  // style tray, on a couple of different categories
  await viewport(1280, 980);
  await sleep(400);
  await shoot('02b-tray-hair');
  await ev(`[...document.querySelectorAll('.tray-tab')]
    .find(b => b.textContent === 'Headwear').click()`);
  await sleep(500);
  await shoot('02b2-tray-headwear');
  await ev(`[...document.querySelectorAll('.tray-tab')]
    .find(b => b.textContent === 'Eyewear').click()`);
  await sleep(500);
  await shoot('02c-tray-eyewear');
  await ev(`[...document.querySelectorAll('.tray-tab')]
    .find(b => b.textContent === 'Outfit').click()`);
  await sleep(500);
  await shoot('02d-tray-outfit');
  await viewport(1280, 860);
  await sleep(400);

  // duplicate-email banner
  await ev(`(async () => {
    await fetch('/api/miis', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ email:'taken@example.com', name:'Taken', dna:{name:'Taken'} }) });
    document.getElementById('miiEmail').value = 'taken@example.com';
  })()`);
  await ev("document.getElementById('btnAccept').click()");
  await sleep(1500);
  await shoot('03-duplicate-email');

  // recovery panel
  await ev("document.getElementById('btnRecover').click()");
  await sleep(500);
  await shoot('04-load-my-mii');
  await ev("document.getElementById('btnRecover').click()");
  await sleep(300);

  // issued badge
  await ev(`document.getElementById('miiEmail').value = ${JSON.stringify(EMAIL)};`);
  await ev("document.getElementById('btnAccept').click()");
  await sleep(2600);
  await shoot('05-badge-issued');

  await ev("document.getElementById('btnBadgeDone').click()");
  await sleep(1800);
  await shoot('06-plaza-with-chip');

  // mobile
  await viewport(414, 860, true);
  await cdp.send('Page.navigate', { url: ORIGIN + '/mii' });
  await sleep(4200);
  await ev("document.getElementById('mineManage').click()");
  await sleep(900);
  await shoot('07-badge-mobile');

  // admin
  await viewport(1280, 860);
  await cdp.send('Page.navigate', { url: ORIGIN + '/admin' });
  await sleep(1200);
  await shoot('08-admin-gate');
  await ev(`document.getElementById('key').value = 'local-admin';
    document.getElementById('gateForm').dispatchEvent(new Event('submit', { cancelable: true }));`);
  await sleep(1600);
  await shoot('09-admin-table');

  // scanned badge landing — reached the way a phone camera would, by
  // following the QR target the client was handed
  await cdp.send('Page.navigate', { url: ORIGIN + '/mii' });
  await sleep(3000);
  const badgeTarget = await ev(`(async () => {
    const me = await (await fetch('/api/me', { credentials: 'same-origin' })).json();
    if (!me.signedIn) return null;
    const png = await fetch(me.qrUrl);
    return png.ok ? me.qrUrl : null;
  })()`);
  if (badgeTarget) {
    const id = badgeTarget.split('/').pop();
    await cdp.send('Page.navigate', { url: `${ORIGIN}/api/badge/verify?id=${id}` });
    await sleep(900);
    await shoot('10-badge-verify');
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
