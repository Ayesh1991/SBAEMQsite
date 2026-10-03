/* ============================================================
   run-all.mjs — run every test file and summarise.

   `npm test` on any machine. Starts nothing and assumes nothing: if the
   site is not being served on 8907 it says so and stops, rather than
   producing twenty-two identical failures that all mean "no server".

   WHY THE FILES ARE RUN ONE AT A TIME. Each one drives a real browser
   against real localStorage, and several sign accounts in and out. Run
   together they would fight over the same stored session and fail in ways
   that depend on the order they happened to finish in — the worst kind of
   flake, because it looks like a bug in the code under test.
   ============================================================ */
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://127.0.0.1:8907';

const alive = await fetch(BASE + '/index.html').then(r => r.ok).catch(() => false);
if (!alive) {
  /* Name the right script. This message used to advertise `serve:node`,
     which stopped existing when `serve` became the Node one — so the
     instruction printed at the moment somebody is already stuck pointed
     them at a command that errors. A help string is code: it goes stale
     like any other. */
  console.error(`\nNothing is serving ${BASE}.\n\n` +
    `  The tests drive a real browser against a running site, so the site\n` +
    `  has to be running. In a SECOND terminal, from this folder:\n\n` +
    `      npm run serve\n\n` +
    `  Leave that one running, then run \`npm test\` again in this one.\n`);
  process.exit(2);
}

/* smoke first — it is the one that says "every page still renders at all",
   and if it fails the release files will fail for the same reason with
   twenty-two times the output. */
const files = readdirSync(here)
  .filter(f => f.endsWith('.mjs') && !['browser.mjs', 'run-all.mjs'].includes(f))
  .sort((a, b) => (a === 'smoke.mjs' ? -1 : b === 'smoke.mjs' ? 1 : a.localeCompare(b, 'en', { numeric: true })));

const run = file => new Promise(resolve => {
  const p = spawn(process.execPath, [join(here, file), BASE], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  p.on('close', code => resolve({ file, code, out }));
});

const failed = [];
for (const file of files) {
  process.stdout.write(`  ${file.padEnd(34)}`);
  const r = await run(file);
  const bad = r.out.split('\n').filter(l => l.startsWith('  ✗'));
  if (r.code === 0) console.log('ok');
  else { console.log(`FAILED (${bad.length || '?'})`); failed.push({ ...r, bad }); }
}

console.log('');
if (!failed.length) { console.log(`${files.length}/${files.length} green.`); process.exit(0); }

/* Quote the failures in full. A summary that says "3 failed" sends you
   back to run them one at a time, which is the thing this script is for. */
for (const f of failed) {
  console.log(`----- ${f.file} -----`);
  console.log(f.bad.length ? f.bad.join('\n') : f.out.trim().split('\n').slice(-12).join('\n'));
  console.log('');
}
console.log(`${files.length - failed.length}/${files.length} green, ${failed.length} failing.`);
console.log('Read a failing test before changing it — in this repo they have caught real bugs.');
process.exit(1);
