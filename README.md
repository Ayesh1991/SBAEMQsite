# ✦ Aureum MRCOG — SBA & EMQ Mastery

A cinematic practice platform for **MRCOG Part 2 & Part 3** candidates:
exam-faithful **SBA** and **EMQ** sets, guideline-referenced explanations, and a
per-candidate progression system (XP, levels from *Medical Student* to *MRCOG
Examiner*, streaks and analytics) — wrapped in a Three.js + GSAP visual
experience.

It is a **fully static site**: no build step, no framework, no backend. Upload
the files to any web server (or GitHub Pages) and it runs.

## Quick start

```bash
# serve locally (any static server works)
python3 -m http.server 8000
# then open http://localhost:8000
```

> Opening `index.html` directly from the filesystem won't work — browsers block
> `fetch()` of the question JSONs over `file://`. Always use a server.

## What's inside

```
index.html              The app shell (single-page app, hash routing)
css/styles.css          Design system
js/
  app.js                Router + views (landing, dashboard, library, results, profile)
  quiz.js               SBA/EMQ engine (timer, flagging, navigator, keyboard keys)
  auth.js               Client-side accounts (salted SHA-256 password hashes)
  store.js              localStorage persistence (users, sessions, attempts)
  data.js               Manifest + question-file loading and validation
  progression.js        XP, levels, streaks, derived analytics
  charts.js             Hand-rolled SVG charts (score trend, section bars, ring)
  fx.js                 GSAP motion design (with reduced-motion + no-CDN fallbacks)
  three-bg.js           Ambient Three.js DNA-helix particle scene
data/
  manifest.json         ← the single source of truth for published content
  part2/…, part3/…      Question JSON files (sample sets included)
admin/validator.html    Admin-only JSON validator & manifest-snippet generator
docs/JSON_FORMAT.md     Authoring & publishing guide for question files
```

## Publishing questions (admin only)

Candidates cannot inject content. You publish by:

1. Authoring a JSON file (formats in [`docs/JSON_FORMAT.md`](docs/JSON_FORMAT.md)),
2. Checking it with [`admin/validator.html`](admin/validator.html),
3. Uploading it under `data/<curriculum>/<section>/` and adding one entry to
   `data/manifest.json`.

The new set appears in the library instantly. Consider protecting `/admin/` with
server auth (e.g. `.htaccess`) — though the real control is that only you can
write to the server.

## Candidate features

- **Accounts** — name, email, password (salted & hashed with Web Crypto; never
  stored in plain text).
- **Library** — curriculum → section → topic, with best score and attempt count
  on every card.
- **Exam engine** — one question at a time, countdown timer, flagging, question
  navigator, keyboard shortcuts (`A–E` answer, `←/→` move, `F` flag). EMQ stems
  present their theme's full option list, exactly like the paper.
- **Results & review** — animated score reveal, verdict band, per-question
  explanations with guideline references, one-click **retake** (sets can be
  repeated indefinitely; every attempt is recorded).
- **Progression** — XP (10 per correct answer, +25 for a perfect set), eight
  levels themed on the O&G training ladder, daily streaks, score-trend and
  per-section accuracy charts, full attempt history and data export.

## Important limitation (by design)

This is a static site, so **accounts and progress live in the candidate's
browser** (`localStorage`) — private to their device, no server round-trips, no
GDPR-sensitive database to run. The trade-offs:

- Progress does not sync across devices/browsers.
- Clearing site data erases progress (candidates can export from the Profile
  page).
- Client-side auth is a convenience layer, not a security boundary.

If you later want cross-device sync and real authentication, the clean upgrade
path is swapping `js/store.js` + `js/auth.js` for a hosted backend (Supabase or
Firebase both work well with static hosting) — the rest of the app is already
structured around those two modules.

## Credits

- Motion: [GSAP](https://gsap.com) · 3D: [Three.js](https://threejs.org) (both
  loaded from CDN with graceful fallbacks — the site remains fully functional
  without them).
- Sample questions reference NICE and RCOG Green-top guidance for educational
  practice purposes.
