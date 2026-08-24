# Mii Plaza — badge ecosystem

An accountless badge system living at `coworking.fyi/mii`. Someone points a
camera at their face, gets a character in a shared 3D plaza, and receives a
scannable badge by email that they can add to Google Wallet. There is no
sign-up, no password, and no session to manage.

---

## How identity works

There are no user accounts. Three ideas carry the whole thing:

| Concern | Mechanism |
|---|---|
| Who are you? | A signed JWT in an HTTP-only cookie naming exactly one row |
| One badge per person | A unique index on `lower(btrim(email))` |
| Lost your cookie? | A single-use magic link sent to that email |

The cookie is `HttpOnly`, `Secure`, `SameSite=Lax`. Page scripts cannot read
it, so the client discovers its own identity by calling `/api/me` rather than
by inspecting storage. The token grants nothing except the ability to edit or
delete the row it names.

Email is a uniqueness key and a recovery channel. It is never a credential.

### Why not just a capability token

The original implementation handed the browser a random token at create time
and stored only its hash. That works, but the token lived in `localStorage`,
which means any script on the page could read it and clearing site data was
unrecoverable. Moving to an HTTP-only cookie plus email recovery fixes both
without introducing a login.

Characters created under the old scheme still work: `PUT`/`DELETE` continue to
accept the legacy `x-token` header when a cookie is absent.

---

## Architecture

```
browser (mii.html, static)
  │
  ├── GET  /api/config          publishable keys + feature flags
  ├── GET  /api/miis            the plaza, no emails
  ├── POST /api/miis            claim a badge → sets cookie, sends email
  ├── GET  /api/me              who this browser is
  ├── PUT/DELETE /api/miis/:id  edit or remove your own
  ├── POST /api/auth/magic-link request a recovery link
  └── Supabase Realtime  ◄──────── postgres changes, public columns only
```

Everything server-side is a Vercel function. There is no build step: the
publishable Supabase keys are fetched at runtime from `/api/config` rather than
inlined at compile time.

### Files

| Path | Role |
|---|---|
| `mii.html` | The plaza: Three.js world, character builder, badge modal |
| `admin.html` | Operator console at `/admin` |
| `supabase/schema.sql` | Tables, RLS, column grants, Realtime publication |
| `api/_lib/env.js` | Environment access and feature detection |
| `api/_lib/store.js` | Data access; Supabase primary, legacy fallback |
| `api/_lib/session.js` | Cookie sessions, admin auth, magic tokens |
| `api/_lib/badge.js` | Badge signatures and QR rendering |
| `api/_lib/googleWallet.js` | Wallet save-JWT construction |
| `api/_lib/email.js` | Resend templates |
| `api/_lib/ratelimit.js` | Fixed-window limits |
| `api/_lib/validation.js` | Zod schemas |

---

## Setup

### 1. Supabase

Create a project, then run `supabase/schema.sql` in the SQL editor. It is
idempotent, so re-running is safe.

The schema does three things worth knowing about:

**Column grants, not just RLS.** RLS filters rows, not columns. A policy that
lets anyone read the plaza would also expose `email`. So the anon role is
granted `SELECT` on `(id, name, mii_data, created_at, updated_at)` only —
`email` is never granted, and a crafted query for it fails.

**A column-filtered Realtime publication.** Realtime payloads carry whatever
the publication carries, so the table is published with the same column list.
Email never rides along in a change event.

**An atomic rate limiter.** `bump_rate_limit()` increments and expires in a
single statement, so two concurrent lambdas cannot both read `0` and both
allow the request.

### 2. Environment variables

Copy `.env.example` to `.env.local` for local work, and add the same keys in
Vercel → Settings → Environment Variables for deploys.

Every integration degrades independently. Nothing here is required to render a
plaza:

| Missing | Effect |
|---|---|
| `SUPABASE_*` | Falls back to the legacy file/Upstash store; no Realtime, no magic links |
| `JWT_SECRET` | No sessions, so no editing across reloads and no badge signatures |
| `RESEND_API_KEY` | Badges still issue, just not emailed |
| `GOOGLE_*` | Badge shows its QR; no Add to Google Wallet button |
| `ADMIN_SECRET_KEY` | `/admin` stays locked |

`JWT_SECRET` must be at least 16 characters. Rotating it signs everyone out
and invalidates every issued badge QR.

### 3. Google Wallet

From the Google Pay & Wallet Console you need an issuer ID and a service
account with the Wallet Objects API enabled.

The pass is built as a save-JWT with the class and object defined inline, so
there is no provisioning call and no SDK dependency. Re-saving updates the
same pass rather than stacking duplicates, because the object id is derived
from the row id.

### 4. Resend

Verify a sending domain, then set `RESEND_API_KEY` and `RESEND_FROM`. Badge
emails reference the QR by URL rather than embedding it, because email clients
routinely strip data URIs.

---

## Running locally

```bash
npm install

# static only — no API, plaza runs on localStorage
npm run dev

# full stack, including the /api routes
JWT_SECRET=dev-secret-at-least-16 ADMIN_SECRET_KEY=dev-admin npm run dev:local
```

`npm run dev:local` is a small Node server that mirrors Vercel's filesystem
routing, including `[id]` params and clean URLs. It exists because `vercel dev`
needs a linked project and a login, which is friction for a fresh clone. It
reads `.env.local` if present, so it can talk to a real Supabase project.

Then open <http://localhost:4444/mii> and <http://localhost:4444/admin>.

---

## Tests

```bash
npm run check          # every route imports and exports a handler
npm run smoke          # 69 assertions against the handlers, no network
npm run check:browser  # loads the pages in headless Chrome, fails on console errors
node scripts/flow-check.mjs   # drives the real UI end to end
node scripts/shots.mjs        # screenshots of every state
```

`smoke.mjs` runs with no credentials at all, which is the path a fresh clone
takes — so it proves the degraded mode works, and that validation, ownership,
rate limiting and the one-badge-per-email rule hold on their own.

The browser checks need Chrome and pass `--use-angle=swiftshader`, since CI
boxes have no GPU and Three.js would otherwise fail to get a context.

---

## Decisions worth knowing

**Validation runs before rate limiting.** Otherwise three mistyped emails
would burn an hour of someone's quota. Bodies are size-capped before parsing,
so this is not a way to make expensive work cheap for an attacker.

**The QR encodes a truncated HMAC, not a JWT.** A signed JWT pushed the payload
past 300 characters, which forces a dense version-20-plus symbol that scans
badly from a phone at door-sign size. `id` plus a 16-character HMAC keeps the
URL near 80 characters — a version 5–6 symbol — while still being unforgeable
without the secret. There is no expiry, because a badge should work as long as
the row exists; revocation is deleting the row.

**Badge artwork is rendered on the client.** The plaza already draws a
turntable preview of the character, so the browser captures that canvas and
uploads it. A function has no WebGL, and standing up a render service for a
badge thumbnail is not worth it.

**Unrenderable characters are skipped, not thrown.** `mii_data` is stored
opaquely so the art can evolve without a migration. That means a row written
by an older schema can be missing a field the builder expects, so builds are
wrapped and failures logged — one bad row must not empty the plaza.

**Magic links are consumed before the session is issued.** A double-click on
the email link cannot mint two sessions.

**Enumeration is not possible through recovery.** `POST /api/auth/magic-link`
returns the same vague success whether or not the address is registered.

**CSV export neutralises leading `=`, `+`, `-` and `@`.** Excel and Sheets
execute those as formulas on open, and the export contains user-supplied names.
