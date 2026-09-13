# Tests

These run against the site served locally, in **local mode** — the browser
is given an empty Supabase config, so nothing here can reach the real
database, the real wallet or the real AI. Every test signs itself up, seeds
whatever data it needs, and works from that.

```bash
python3 -m http.server 8907 --directory .      # from the repository root
node tools/tests/smoke.mjs                     # every route draws, nothing throws
node tools/tests/t99-stars-marks-drive.mjs     # the v99 changes, in detail
```

Playwright drives a real Chromium. The path in the import at the top of
each file is the one on the build machine; change it if yours differs.

## Why they are in here

Until v99 the detailed tests for each release lived in a scratch directory
next to the working copy rather than in the repository. That directory is
not the project, and when the machine holding it went away so did every one
of them — about fifty files of proven coverage that could no longer be run
against the next change.

**A test that is not committed is a test you have only once.** Anything
worth writing to prove a release is worth keeping to protect the release
after it.

## The two kinds

`smoke.mjs` is shallow and wide: it opens every route the router knows and
asserts only that the page rendered and that nothing was thrown or logged
as an error. That is a low bar, and it is the bar that catches the failures
which are easiest to introduce and worst to ship — a typo in a template
string, a `const` read above its declaration, a renamed export one caller
still asks for. Each of those turns a page white, and a white page is worse
than a wrong number because nothing on it says what happened.

Add a route to its list whenever you add one to the router. A route that is
not in the list is a route nobody is watching.

`t99-…` is the other kind: narrow and deep, one file per release, asserting
the specific promises that release made. Name new ones after their version
and what they cover.

## Running them

Serve the working copy and point each file at it:

```
python3 -m http.server 8907 --directory .
node tools/tests/smoke.mjs
node tools/tests/t107-marker.mjs          # or any other release file
```

Each prints `fails=0` and exits non-zero if anything failed.

## One warning, learned the hard way

`Annotate._marks()` — and any accessor like it — hands back the module's
own array, not a copy. Reading the last entry with `pop()` REMOVES the
mark you were about to assert about, and the assertion then fails while
the code is perfectly correct. Use `slice()`, `filter()` or an index.
