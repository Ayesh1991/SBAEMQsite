# AUREUM · Pathway to MD — working notes for Claude

Read this before touching anything. It is the short version of what took
twenty releases to learn, and most of it is counter-intuitive.

## What this is

A static single-page app for Sri Lankan postgraduate and undergraduate
medical exam preparation. **No build step.** The files in `js/` are served
exactly as they are committed; `index.html` loads 51 `<script>` tags in a
fixed order. Cloudflare Pages serves it, Pages Functions in `functions/api/`
are the only server code, Supabase is the database.

- **Branch:** all work goes to `claude/mrcog-sba-emq-platform-a23hqb`.
  `main` is production. Never push to `main` without being asked.
- **Deploys:** Cloudflare builds the feature branch as a Preview and `main`
  as Production. Pushing is enough; there is nothing to run.

## The five rules that are easy to break

1. **One global per module.** Every file in `js/` declares one top-level
   `const` — `Backend`, `Data`, `Quiz`, `Course`, `Track`… There is no
   bundler and no module system. Two files claiming one name does not fail
   loudly: the second one throws at load, or a whole subsystem silently
   stops existing. **Grep for the name before creating a module.**

2. **Both backends must export the same list.** `js/backend.js` holds two
   implementations — `Local` (localStorage) and `Cloud` (Supabase). A
   function added to one and not the other works in testing and throws in
   production, or the reverse. The tests assert the lists match.

3. **The version stamp is in three places.** `index.html` (`?v=N`, 51
   occurrences), `sw.js` (`VERSION = 'aureum-vN'`), and the newest test
   file. Bump all three together — see `/release`.

4. **A filter in the browser is never the security.** Row-level security in
   `supabase/schema.sql` decides what may be *read*. The filters in the app
   decide what is worth *showing*. They deliberately disagree about
   untagged content: the database hides it, the browser shows it. Do not
   "fix" that.

5. **Question keys are `paperId:KIND:number`**, where `number` is the
   position within that kind. Every mark, note, flag and review item is
   filed under one. Changing how questions are enumerated silently detaches
   a candidate's whole history from the questions it belongs to, with
   nothing thrown. `Data.flatten()` is the only place this is decided.

## The course model (v115–v121)

Everything a candidate sees is scoped to the **course** they are on.

| Thing | Where it lives | Keyed by course since |
|---|---|---|
| Courses, enrolments | `tracks`, `enrolments` | v115 |
| Roles (student/editor/admin) | `profiles.role` | v114 |
| Content tags | `tracks[]`, `subject` on 7 tables | v115/v117 |
| Syllabus | `curriculum` row per course | v119 |
| Blueprint | `app_config` `blueprint:<course>` | v121 |
| Banks (papers, essays, cases, OSCE) | filtered in the client | v116/v121 |

- `js/course.js` is the module (`Course`, **not** `Track` — that name is
  the interaction logger in `js/track.js`).
- `Course.fits(row)` is the relevance filter. **Untagged content is shown**
  — unfiled is not irrelevant.
- The three bundled files — `data/syllabus.json`, `data/manifest.json`,
  `data/blueprint.md` — each name their course in a `track` field. They
  belong to `pgim-og-2` and must not follow a candidate to another course.
- A course switch has to drop six caches. They are one function:
  `forgetCourseScoped()` in `js/course.js`. Add new course-scoped caches
  there.

## Testing

```bash
python3 -m http.server 8907 --directory .      # leave running
node tools/tests/t121-blueprint-and-banks.mjs  # one release file
node tools/tests/smoke.mjs                     # every route renders
```

Each file prints `fails=0` and exits non-zero on failure. `/suite` runs
them all. **Full details and the hard-won gotchas are in
`tools/tests/README.md` — read it before writing a test.** The short list:

- An accessor like `Annotate._marks()` returns the module's **own** array.
  `pop()` destroys the evidence you were about to assert on.
- `page.goto(...?r=random)` reloads and destroys any stubs.
- Signing in via `Backend.signIn()` does not repaint the nav — reload first.
- The developer console sits behind a passkey; set
  `sessionStorage['aureum-passkey'] = '1'` rather than trying to type it.
- Only the **newest** release test carries the version literal. Older ones
  assert that every asset agrees with the service worker instead.

## Releasing

Use `/release` — it does the whole ritual. By hand it is: bump the three
version places, run the full suite, commit with a message that explains
*why*, push, and build the zip with `git archive`.

**Commit messages carry the reasoning, not the diff.** The diff is already
in the commit. Say what was wrong, what rule it broke, and what was decided
— that is the only record of why the code is shaped this way.

## Secrets

Public and safe to commit, deliberately in `js/config.js`: the Supabase
anon key, the Google client ID and API key. Everything else —
`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`,
`SUPABASE_SERVICE_KEY`, `PASS_KEY` — lives **only** as a Cloudflare secret
and must never appear in the repo.

## Where things are

| Area | File |
|---|---|
| Router, pages, nav, auth, profile, library | `js/app.js` |
| Both backends + RLS-facing calls | `js/backend.js` |
| Developer console (all sections) | `js/dev-console.js` |
| Papers, syllabus, flatten/validate | `js/data.js` |
| Sitting a paper | `js/quiz.js` |
| Adaptive mocks | `js/simulator.js`, `js/blueprint.js` |
| OSCE bank and stations | `js/osce.js` |
| Course scoping | `js/course.js` |
| Schema, RLS, migrations | `supabase/schema.sql` |

The roadmap and phase plan: `docs/PHASES.md`.
