/* Loads the pages in headless Chrome and fails on any console error or
 * unhandled rejection. The plaza is a single 3.5k-line module — a syntax slip
 * or a bad element id would otherwise only show up as a blank canvas.
 *
 * Usage: node scripts/browser-check.mjs [origin]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = process.argv[2] || 'http://localhost:4444';
const CHROME = '/usr/local/bin/google-chrome';

const profile = mkdtempSync(join(tmpdir(), 'mii-chrome-'));
let port = 0;

function launch() {
  const child = spawn(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    // This VM has no GPU. SwiftShader gives Three.js a real WebGL context so
    // the check exercises the renderer instead of just the parse.
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank'
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
    child.on('exit', (c) => reject(new Error('chrome exited ' + c + '\n' + buf)));
    setTimeout(() => reject(new Error('chrome did not start\n' + buf)), 20000);
  });
}

async function wsUrlFor(targetId) {
  return `ws://127.0.0.1:${port}/devtools/page/${targetId}`;
}

async function newTab(url) {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT'
  });
  return r.json();
}

/* Minimal CDP client over the WebSocket that ships with Node 22. */
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
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { resolve, reject } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        for (const fn of c.listeners) fn(msg);
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
  on(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch {} }
}

const problems = [];
const logs = [];
const failedRequests = [];

async function checkPage(path, { expectIds = [], settle = 4000 } = {}) {
  const target = await newTab('about:blank');
  const cdp = await CDP.connect(await wsUrlFor(target.id));

  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') {
      const type = msg.params.type;
      const text = (msg.params.args || [])
        .map((a) => a.value ?? a.description ?? a.unserializableValue ?? '')
        .join(' ');
      logs.push(`[${path}] ${type}: ${text}`);
      // WebGL/audio warnings in headless are expected; only errors matter.
      if (type === 'error') problems.push(`${path} console.error: ${text}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      const text = d.exception?.description || d.text;
      problems.push(`${path} uncaught: ${text}`);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const e = msg.params.entry;
      // The browser probes /favicon.ico regardless of the declared icons, and
      // a blocked CDN is a network condition rather than a code fault.
      const where = `${e.text} ${e.url || ''}`;
      if (/favicon|net::ERR_/.test(where)) return;
      problems.push(`${path} log: ${e.text}${e.url ? ` (${e.url})` : ''}`);
    }
    if (msg.method === 'Network.responseReceived') {
      const { url, status } = msg.params.response;
      if (status >= 400) failedRequests.push(`${status} ${url}`);
    }
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');

  await cdp.send('Page.navigate', { url: ORIGIN + path });
  await new Promise((r) => setTimeout(r, settle));

  for (const id of expectIds) {
    const out = await cdp.send('Runtime.evaluate', {
      expression: `!!document.getElementById(${JSON.stringify(id)})`,
      returnByValue: true
    });
    if (out.result.value !== true) problems.push(`${path} missing #${id} at runtime`);
  }

  const ready = await cdp.send('Runtime.evaluate', {
    expression: 'document.readyState',
    returnByValue: true
  });
  if (ready.result.value !== 'complete') {
    problems.push(`${path} never finished loading (${ready.result.value})`);
  }

  cdp.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
  return true;
}

let chrome;
try {
  chrome = await launch();

  console.log(`\nLoading pages from ${ORIGIN}\n`);

  await checkPage('/mii.html', {
    expectIds: ['scene', 'camEmailRow', 'camBadge', 'badgeWallet', 'badgeAppleWallet', 'camRecover', 'mineChip'],
    settle: 5000
  });
  console.log('  mii.html   loaded');

  await checkPage('/admin.html', { expectIds: ['gateForm', 'rows', 'btnExport'], settle: 1500 });
  console.log('  admin.html loaded');

} catch (e) {
  problems.push('harness: ' + e.message);
} finally {
  if (chrome) chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

if (logs.length) {
  console.log('\nConsole output:');
  for (const l of logs) console.log('  ' + l);
}

if (failedRequests.length) {
  console.log('\nFailed requests:');
  for (const f of new Set(failedRequests)) console.log('  ' + f);
}

if (problems.length) {
  console.log('\nProblems:');
  for (const p of problems) console.log('  ✗ ' + p);
  console.log(`\n${problems.length} problem(s)\n`);
  process.exit(1);
}
console.log('\nNo console errors or uncaught exceptions\n');
