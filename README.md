# ✦ AUREUM · Pathway to MD

A cinematic SBA & EMQ practice platform for **O&G Registrars and Senior
Registrars** preparing for the **PGIM MD (Obstetrics & Gynaecology) Part 2**
examination — and equally suited to **MRCOG Part 2 & 3**.

Questions are written by the study group from articles and guidelines in the
`ogr-paper-v1` JSON format (each file carries both SBA and EMQ), uploaded to a
shared Google Drive folder, and imported into the site by the developer. The rest
is a Three.js + GSAP experience with two practice modes, a curriculum-mapped
searchable library, and cross-device progress.


## Highlights

- **Two practice modes** — *Exam mode* (timed, feedback at the end, question
  navigator + flagging) and *Study mode* (answer, rationale and memory hook appear
  the instant you choose, no timer).
- **Exam countdown** on the landing page and dashboard, set from `js/config.js`.
- **Curriculum library** — a collapsible Obstetrics / Gynaecology / Clinical
  Governance / TOG tree derived from the OG Revise tag set, with instant
  topic/paper search. Every paper shows its SBA and EMQ counts.
- **Accounts with a position** — candidates register with name, email, password
  and their grade (**Registrar / Senior Registrar**). Progress, XP, streaks and
  analytics **sync across devices** when Supabase is configured.
- **Mastery tiers** (Foundation → Distinction), daily streaks, score-trend and
  per-category accuracy charts, full history, data export. Any set is repeatable.
- **Developer console** (`/#/dev`, owner-only) — scans the Google Drive folder
  (including subfolders), shows only papers not yet published, auto-classifies each
  by its `folderTag`, and publishes on approval. Manual JSON paste also supported.

## Run it

```bash
python3 -m http.server 8000   # open http://localhost:8000
```
It works immediately in **local mode** (accounts/progress in the browser). To add
multi-device accounts and live Drive import, follow **[`docs/SETUP.md`](docs/SETUP.md)**.

## Project layout

```
index.html                 App shell (single-page app, hash routing)
css/styles.css             Design system
js/
  config.js                ← exam date, developer access, Drive folder, Supabase keys
  backend.js               Pluggable data layer: Supabase (cloud) OR localStorage (local)
  data.js                  Syllabus + manifest + ogr-paper-v1 parsing/validation
  quiz.js                  SBA/EMQ engine — exam & study modes
  dev-console.js           Owner-only Drive import + publishing
  progression.js           XP, mastery tiers, streaks, analytics
  charts.js                Hand-rolled SVG charts (CVD-validated palette)
  fx.js / three-bg.js      GSAP motion + Three.js DNA-helix backdrop (graceful fallbacks)
  app.js                   Router + all views
data/
  syllabus.json            The curriculum tree (categories → sections → topics)
  manifest.json            Bundled published papers
  papers/*.json            Seed papers (ogr-paper-v1)
  drive-index.json         Offline snapshot of the Drive folder (import fallback/demo)
functions/api/drive.js     Cloudflare Pages Function: reads the Drive folder
supabase/schema.sql        Cloud database + Row-Level Security
admin/validator.html       Standalone paper validator
docs/JSON_FORMAT.md        The ogr-paper-v1 format
docs/SETUP.md              Cloudflare + Supabase + Google Drive setup
```

## The content pipeline (developer only)

1. The group writes papers in `ogr-paper-v1` (see
   [`docs/JSON_FORMAT.md`](docs/JSON_FORMAT.md)) and drops them in the shared Drive
   folder — each file has both SBA and EMQ.
2. You open **`/#/dev`** (unlocked by your email or the developer code), hit
   **Scan Drive**, and see only the *new* files, each pre-classified to a syllabus
   topic by its `folderTag`.
3. Adjust the Category / Section / Topic if needed and **Approve** — the paper
   appears in everyone's library. Candidates never upload anything.

## Modes at a glance

| | Local (default) | + Supabase | + Google Drive API |
|---|:--:|:--:|:--:|
| Practise, both modes | ✅ | ✅ | ✅ |
| Accounts & progress | this browser | all devices | — |
| Publish (manual paste) | this browser | everyone | — |
| Scan & import from Drive | snapshot | snapshot | ✅ live |

## Notes

- GSAP and Three.js load from CDN with full graceful fallbacks — the site remains
  completely functional (and honours `prefers-reduced-motion`) without them.
- Sample papers reference NICE / RCOG / SLCOG guidance for educational practice.
