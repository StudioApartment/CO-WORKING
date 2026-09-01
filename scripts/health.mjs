/* Office health gate — static checks + API smoke.
 *
 * Run before deploy or on a schedule:
 *   npm run health
 *
 * Optional live browser check (needs Chrome + running dev server):
 *   npm run health:browser
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let failures = 0;
const note = (icon, msg) => console.log(`${icon} ${msg}`);

function run(cmd, args, label) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: false });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) {
    note('✗', `${label} failed (exit ${r.status})`);
    if (out.trim()) console.log(out.trim());
    failures++;
    return false;
  }
  note('✓', label);
  return true;
}

console.log('\nCo-Working health check\n');

const strict = process.argv.includes('--strict');
if (strict) {
  run('node', ['scripts/check.mjs'], 'static check (index.html + API routes)');
} else {
  note('·', 'skipping full check (use npm run health:strict for style regressions)');
}

run('node', ['scripts/smoke.mjs'], 'API smoke (degraded path)');

{
  const miiPath = join(ROOT, 'index.html');
  const bytes = statSync(miiPath).size;
  const kb = Math.round(bytes / 1024);
  /* The plaza is one self-contained page; 800KB leaves headroom for small edits. */
  if (bytes > 800 * 1024) {
    note('✗', `index.html is ${kb}KB — consider splitting assets or lazy-loading review mode`);
    failures++;
  } else {
    note('✓', `index.html size ${kb}KB (under 800KB budget)`);
  }
}

{
  const src = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const hasPause = src.includes('if (document.hidden) return;')
    && src.includes('renderer.setAnimationLoop');
  if (!hasPause) {
    note('✗', 'index.html — animation loop should pause when tab is hidden');
    failures++;
  } else {
    note('✓', 'index.html pauses the render loop when the tab is hidden');
  }
}

console.log(
  failures ? `\n${failures} problem(s) — fix before shipping\n` : '\nHealth check passed\n'
);
process.exit(failures ? 1 : 0);
