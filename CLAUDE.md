# AUREUM · Pathway to MD — working notes for Claude

Read this before touching anything. It is the short version of what took
twenty releases to learn, and most of it is counter-intuitive.

## What this is

A static single-page app for Sri Lankan postgraduate and undergraduate
medical exam preparation. **No build step.** The files in `js/` are served
exactly as they are committed; `index.html` loads 52 `<script>` tags in a
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

3. **The version stamp is in three places.** `index.html` (`?v=N`, 52
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

Groups are `chat_rooms` reused — one row, one membership list, one
`is_room_member()`. Since v127 a member carries a `role`, and
`is_room_admin()` is what the add/remove/rename/promote policies ask. The
maker of a group is its admin; a group is never left without one.

A group's page is `js/group.js` (`Group`, **not** `GroupPaper` — that one
sits a paper). `#/group/<id>/<tab>` for wall, chat, files, papers and
members; `#/groups` lists them. **Every tab mounts the surface that already
owned that job** — a second copy of the wall is a second thing to keep in
step. Mounting one means releasing the last: `TeaRoom.releasePanel()` and
`releaseChatPanel()`.

- `js/course.js` is the module (`Course`, **not** `Track` — that name is
  the interaction logger in `js/track.js`).
- `Course.fits(row)` is the relevance filter. **Untagged content is shown**
  — unfiled is not irrelevant. `Course.fitsSubject(row, sel)` is the same
  rule one level down, for a course with several subjects.
- **A course with >1 subject must be asked which one on import** (v129).
  `contentTags()` infers `subject` only for a one-speciality course, so a
  final MBBS paper reaches the database with `subject = null` unless the
  console's subject picker wrote it. `stampCourse()` in `js/dev-console.js`
  is the one place that writes both tags — add new importers there.
  Subject ids: `obgyn`, `medicine`, `surgery`, `paediatrics`,
  `psychiatry`, `anaesthesiology`.
- Import file formats and what the validator refuses: `data/samples/`.
- The three bundled files — `data/syllabus.json`, `data/manifest.json`,
  `data/blueprint.md` — each name their course in a `track` field. They
  belong to `pgim-og-2` and must not follow a candidate to another course.
- A course switch has to drop six caches. They are one function:
  `forgetCourseScoped()` in `js/course.js`. Add new course-scoped caches
  there.

## Testing

First time on a machine: `npm install` (Playwright only — nothing in `js/`
is built), then `npx playwright install chromium`.

```bash
npm run serve                                  # leave running (Node, no python)
npm test                                       # all 30 files, summarised
node tools/tests/t129-subject-pipeline.mjs     # one release file
```

Each file prints `fails=0` and exits non-zero on failure. `/suite` runs
them all. The files resolve Playwright through `tools/tests/browser.mjs`,
so they work on a laptop and in a container alike — never reintroduce an
absolute path to a browser or a module. **Full details and the hard-won gotchas are in
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
| A group's page (wall/chat/files/papers) | `js/group.js` |
| Schema, RLS, migrations | `supabase/schema.sql` |

The roadmap and phase plan: `docs/PHASES.md`.
