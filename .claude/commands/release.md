---
description: Cut a release — bump the version everywhere, run the full suite, commit, push, build the zip.
---

Cut release **v$ARGUMENTS** (if no number was given, read the current one
from `sw.js` and use the next).

Do it in this order and stop at the first thing that fails:

1. **Bump the version in all three places.** They must agree or the service
   worker serves a mix of old and new files:
   - `index.html` — every `?v=N` (there are 51)
   - `sw.js` — `const VERSION = 'aureum-vN'`
   - the previous release's test file — convert its version *literal* into
     the consistency check the older files use (`vs.length === 1` plus the
     service worker agreeing). Only the newest test names the number; an
     older one that does fails on every release after it, which teaches you
     to ignore a failing test.

2. **Write the new release test** as `tools/tests/t<N>-<slug>.mjs`, modelled
   on the previous one. It carries the version literal. Read
   `tools/tests/README.md` first — the gotchas there are all real failures
   that cost an afternoon each.

3. **Run the whole suite**, not just the new file:

   ```bash
   python3 -m http.server 8907 --directory . &
   for f in tools/tests/smoke.mjs tools/tests/t*.mjs; do
     echo "##### $f"; node "$f" 2>&1 | grep -E "^  ✗|^fails="
   done
   ```

   Every file must print `fails=0`. **If an older test fails, read it before
   changing it.** Usually it has caught a real regression. When it has
   genuinely gone stale — it asserted a literal that moved for a good reason
   — update it to assert the thing it actually cares about, and say so in
   the commit. Never relax a test until it passes.

4. **Commit.** The message explains *why*, not what — the diff already says
   what. State what was wrong, which rule it broke, and what was decided.
   Note anything deliberately left out and the reason.

5. **Push** to `claude/mrcog-sba-emq-platform-a23hqb`. Never to `main`.

6. **Build the zip** for hand-off and send it:
   ```bash
   git archive --format=zip -o aureum-v<N>.zip HEAD
   ```

7. **Report**: what changed, anything found on the way, and what is still
   outstanding. If `supabase/schema.sql` changed, say so plainly — it has to
   be run by hand before the release does anything.
