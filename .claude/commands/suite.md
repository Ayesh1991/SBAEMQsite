---
description: Run the whole test suite against a local server and report only the failures.
---

Run every test file and report the result.

```bash
curl -s -o /dev/null http://127.0.0.1:8907/index.html \
  || (python3 -m http.server 8907 --directory . >/dev/null 2>&1 &)
sleep 2
for f in tools/tests/smoke.mjs tools/tests/t*.mjs; do
  echo "##### $f"
  node "$f" 2>&1 | grep -E "^  ✗|^fails="
done
```

The suite takes a few minutes — run it in the background and keep working
rather than waiting on it.

Report the count of green files and quote every `✗` line in full. For each
failure, say whether it is a real regression or a stale assertion, and why
you think so. **Do not change a failing test before reading what it was
protecting** — in this repo they have caught a privilege-escalation bug, a
silent renumbering of every question key, and a filter that could not
filter. If a test is genuinely stale, make it assert the thing it cares
about rather than the literal that moved.
