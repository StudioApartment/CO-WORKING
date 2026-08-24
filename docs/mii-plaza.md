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

## Customisation

Every option lives as data in the style catalogue near the top of `mii.html`,
and both the renderers and the UI build themselves from those lists. Adding a
frame shape or a jersey means adding one object — no new markup, no new
event wiring.

The picker is one **stepper per category**: it names what is currently chosen,
and a tap moves to the next value. Shift-click, or a right-click, steps back.
An earlier version listed every option as its own chip behind a row of
category tabs, which put around 34 controls on screen at once for what is
really eleven decisions.

Hair and headwear share a slot, so the hair stepper reports the cut
remembered *under* a hat rather than the hat itself, and the first tap on it
only takes the hat off — nothing gets skipped on the way in.

| Category | Options |
|---|---|
| Eyewear | 19 across plastic, metal, sunglasses and wrap-around baseball shades |
| Hair | 27 real cuts: buzz, crew, French crop, waves, pixie, bowl, comb over, side part, quiff, pompadour, swoop, slick back, swept, spiky, curtains, afro, afro fade, locs, bob, shag, wolf cut, mullet, flow, long, bun, ponytail, bald |
| Headwear | 13 including flat-brim, dad hat, bucket, cowboy, beanie, paisley bandanas in red / blue / green |
| Facial hair | Stubble, lineup, full, goatee, moustache, handlebar |
| Piercings | Nose stud, double nostril, septum |
| Ink | Hands, jaw, both |
| Outfits | 11: t-shirt, cutoff, no shirt, button-up, flannel, hoodie, suit, plus two football and two basketball shirts |

### Where each layer is rendered

Three surfaces, chosen by what the feature needs:

- **Face texture** (512px canvas on the head patch) — eyewear, facial hair,
  piercings, blush, freckles. Cheap, and it deforms with the head.
- **Meshes** — hair and hats. Anything that has to break the
  silhouette has to be geometry.
- **Torso texture** (256px canvas) — garments. Jersey numbers and pocket
  details are painted, then hoods and open plackets are added as geometry.

  Two things govern where detail can go. Horizontally the chest is at u=0.25
  and the back at u=0.75, not 0.5. Vertically the head is wider than the chest
  everywhere above y≈0.58, so the top third of the texture is never seen: only
  v 0.36–1.0 is visible, which is what `vy()` maps into. Squad numbers were
  originally centred at v 0.44–0.50 and sat entirely behind the head.

  Kit shirts carry their own colourway and number rather than borrowing a
  shared random palette, because a jersey only looks right in its own colours.

### Working in head space

Hair and headwear are positioned in the head's local space, where the skull is
a superellipsoid of radius 1. Three numbers matter, and getting them wrong is
what produced every geometry bug so far:

| Landmark | y |
|---|---|
| Top of the skull | 1.0 |
| Brow line | 0.29 |
| Eye line | 0.12 |
| Mouth | −0.28 |

- **Nothing opaque may cross y ≈ 0.29.** A beanie cuff placed at 0.06 spanned
  −0.04 to 0.16 and sat straight across the eyes.
- **`CylinderGeometry(1,1,1)` is centred**, so `scale.y` is the *total* height.
  A crown must be centred half its height above the brim or it floats — the
  cowboy hat and the original top hat both did.
- **A crown must be wider than the hair shell at r=1.022.** The cowboy crown
  was r=0.92 and vanished inside it. The skull is only 0.57 wide at y=0.9, so
  r≈1.05 encloses it the way a real hat does.
- **Long styles need the cap's back to reach the nape.** Stopping at the
  hairline leaves a wedge you can see through from behind.

Hair is built from open shells, so all hair and hat materials are
`DoubleSide`. With backface culling on, any shell edge turning away from the
camera shows straight through.

### Things the rig cannot do

**No forearm or sleeve tattoos.** A Wii Mii has floating hands and no arms —
that is the silhouette, not an omission. There is no forearm to ink, so the
brief's sleeve tattoos are not implementable without abandoning the base
aesthetic.

**And no neck tattoos either, strictly speaking.** The head is between 0.33
and 0.54 wide across the neck's entire height while the neck is only 0.115, so
the head hides that mesh completely and the collar covers what is left — ink
painted there was invisible at every angle. The "Jaw" option paints it into
the face texture along the jawline instead, which is visible, and a beard
grows over it because the ink is drawn first.

Hand ink also has to fight for space: the hands are spheres about a tenth of
the body tall, so the motif is heavy bars at full opacity rather than line
art, repeated around the sphere so it reads whichever way the hand drifts.

**Fades are implied, not shaded.** A character carries one hair colour, so
`crop`, `dreads` and `afrofade` fake the taper by capping the sides short and
massing the top. It reads correctly in silhouette, which is what this style
leans on anyway.

### No team marks

Team looks are shape and colourway only, and the cap crests are abstract
monograms. Real club and franchise logos are trademarks; shipping them on a
public site is not ours to do. The palettes evoke the right cities without
reproducing anything.

### The dropped ID badge overlay

The brief asked for a 3D badge on the character showing the wearer's email.
That was built and then removed at the client's request — it is not the same
thing as the actual badge, which is still very much here: the QR, the Google
Wallet pass and the email all remain.

Worth recording why the overlay was awkward regardless. Rendering an address
above someone's head would have undone the privacy design: the API never
sends anyone else's email to the browser, and the Realtime publication is
column-filtered to keep it out of change events. So it could only ever have
shown text on your own character, and a mark for everyone else.

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
