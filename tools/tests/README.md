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

## The version stamp

Only the NEWEST release file should name the version as a literal. An
older one that asserts its own number fails on every release after it,
which teaches you to ignore a failing test — the worst thing a suite can
teach. Older files assert instead that every asset agrees with every
other and with the service worker.

## One global, one module

Every module in `js/` is a top-level `const` on the same global object —
there are forty-nine of them and no bundler to keep them apart. Two files
declaring the same name is not a merge conflict and not a build error: the
second one throws at load, or, if the file was overwritten rather than
added, a whole subsystem simply stops existing and nothing appears on the
console.

v116 nearly shipped `Course` as `Track`, on top of the interaction logger
that `quiz.js` and `ai.js` call on every answer. Before naming a new
module, grep for the name — and if a release adds one, assert in that
release's test file that BOTH modules are still there and still do their
own job (`t116` §1 is the pattern).

## When a release makes an old fixture impossible

v117 made it impossible to publish content without a course tag. Two older
files broke — not because either release was wrong, but because they had
built their fixtures through the very path that changed: t116 created its
"unfiled" station with `publishOsceStation()`, which now stamps a course on
anything that arrives without one, and t115 counted seven tagging statements
in the schema where there are now six.

That is the suite working. When a release closes off a state, the files that
depended on that state must say how the state is reached NOW — t116 writes
its untagged row straight into storage, which is the only way one can exist
any more, and says so — rather than being relaxed until they pass.

## Do not pin the layout of a source file

Several tests read a `.js` file and match a pattern against it — a fair way
to assert that a rule is written down, when the rule has no visible
behaviour to drive. The trap is matching across a line break, or pinning
the indentation:

```js
/bpEdit = null;\n      view\.querySelector\('#bp-studio'\)/   // passes on Linux only
```

Git for Windows checks files out with CRLF, so `\n` is not there and the
test fails on a laptop while passing in the container. `.gitattributes` now
normalises the tree to LF, but do not rely on that: find the block you care
about with `indexOf`, slice it, and ask what it contains.

```js
const at = src.indexOf("'#bp-course')?.addEventListener");
const block = at < 0 ? '' : src.slice(at, at + 700);
ok(/bpEdit = null/.test(block) && /#bp-studio/.test(block));
```

The same instinct applies to the whole suite: a test that only passes on
the machine it was written on is worse than no test, because it is believed
until somebody else runs it.
