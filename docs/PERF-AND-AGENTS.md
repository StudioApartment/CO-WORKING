# Performance & agent loops

Quick reference for keeping the plaza fast and catching regressions early.

## What was optimized

| Area | Change |
|------|--------|
| **Load** | `preconnect` + `modulepreload` for Three.js (jsDelivr) |
| **CDN** | Long-cache headers on `images/`, `lib/`, and static assets (`vercel.json`) |
| **Runtime** | Main WebGL loop skips work when the tab is hidden |
| **Preview** | Badge orbit preview stops when hidden; resumes when tab returns |
| **Boot** | Loader still compiles the scene before reveal (unchanged) |

`mii.html` is one large module (~640KB). That is intentional for now; the health script warns if it grows past 750KB.

## Commands

```bash
npm run dev:local      # static + API (localhost:4444/mii)
npm run check          # mii.html hooks + API route imports
npm run smoke          # API handlers without cloud credentials
npm run health         # check + smoke + size/perf guards
npm run check:browser  # headless Chrome (needs local server + Chrome)
```

**Before every deploy:** `npm run health`

**After plaza UI changes:** `npm run health:strict` (full mii.html regression suite) and `npm run check:browser`

## Cursor automations to run on a loop

Use **Cursor Automations** (scheduled cloud agents) or **`/loop`** in a local agent session.

### 1. Daily health (recommended)

| | |
|---|---|
| **Trigger** | Every day at 9:00 (your timezone) |
| **Action** | Run `npm run health:strict` in this repo |
| **On failure** | Open a PR or post summary — fix before users hit prod |

**Loop prompt (local):** `/loop 24h Run npm run health in the co-working repo. If anything fails, summarize failures and suggest minimal fixes. Do not commit unless I ask.`

### 2. PR gatekeeper

| | |
|---|---|
| **Trigger** | Pull request opened or updated |
| **Action** | Run `npm run health`; comment if failing |
| **Tools** | PR comment |

GitHub Actions already runs `npm run health` on push/PR (`.github/workflows/health.yml`). Use the Autopilot skill on active PRs for comment triage.

### 3. Weekly browser smoke

| | |
|---|---|
| **Trigger** | Monday 8:00 |
| **Action** | Start `npm run dev:local`, wait for port 4444, run `npm run check:browser`, stop server |
| **Why** | Catches JS runtime errors the static checker cannot see |

**Loop prompt:** `/loop 7d Start npm run dev:local, run npm run check:browser against localhost:4444, report console errors. Stop the dev server when done.`

### 4. Post-deploy verification (production)

| | |
|---|---|
| **Trigger** | After Vercel deploy (webhook or manual) |
| **Action** | Fetch `https://www.coworking.fyi/api/config` and `/mii` — expect 200, no HTML error pages |
| **Tools** | Vercel MCP or `curl` |

### 5. Autopilot on open PRs

For merge-ready PRs: use the **Autopilot** skill — triages review comments, fixes CI, resolves conflicts in a loop.

## Monitoring in production

- **Vercel:** watch function errors on `/api/miis`, `/api/me`, wallet routes
- **Browser:** first load is dominated by `mii.html` parse + Three.js; repeat visits benefit from asset cache headers
- **Session:** returning users skip the loader animation delay (`sessionStorage`)

## If the plaza feels slow

1. Check Miis count — crowd widens bounds and adds draw calls
2. Confirm tab is not backgrounded (loop pauses intentionally)
3. Mobile: pixel ratio is capped at 2
4. Style review (`?review=hair`) builds many characters — dev-only, not the main plaza path
