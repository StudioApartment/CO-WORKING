# Performance & agent notes

Quick reference for keeping The Office fast and catching regressions early.

---

## Size budget

`mii.html` is one large module (~640KB). That is intentional for now; the health script warns if it grows past 750KB.

## Local dev

```bash
npm run dev:local      # static + API (localhost:4444/mii)
npm run check          # mii.html hooks + API route imports
```

**After office UI changes:** `npm run health:strict` (full mii.html regression suite) and `npm run check:browser`

---

## Smoke checks (no credentials)

| Check | What |
|---|---|
| **Action** | Fetch `https://www.coworking.fyi/api/config` and `/mii` — expect 200, no HTML error pages |

---

## Production monitoring

- **Vercel:** watch function errors on `/api/miis`, `/api/me`, wallet routes
- **Browser:** first load is dominated by `mii.html` parse + Three.js; repeat visits benefit from asset cache headers

## If The Office feels slow

1. Check Co-Worker count — crowd widens bounds and adds draw calls
2. Confirm Realtime is not reconnecting in a loop (check console)
3. Profile on a mid-tier phone — GPU fill is usually the bottleneck
4. Style review (`?review=hair`) builds many characters — dev-only, not the main office path
