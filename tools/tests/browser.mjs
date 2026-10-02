/* ============================================================
   browser.mjs — launch Chromium wherever the suite is being run.

   THE PROBLEM THIS SOLVES. Every test file used to begin with two absolute
   paths from the machine the tests were written on:

     import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
     chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

   Both are real on a Linux container and neither exists on a Windows
   laptop, so the whole suite failed on the first line with a
   module-not-found — on the very first thing somebody tries after cloning
   the repo. A test suite that only runs in one place is a test suite most
   people never run.

   WHAT IT DOES. Asks for Playwright the ordinary way first — a local
   `npm install` puts it where `import 'playwright'` finds it — and falls
   back to the container's copy. The browser binary is left to Playwright
   to find unless PW_CHROMIUM says otherwise, because Playwright knows
   where its own download went and a hard-coded path only ever gets it
   wrong somewhere else.
   ============================================================ */

let _chromium = null;

async function resolveChromium() {
  if (_chromium) return _chromium;
  const tried = [];
  for (const spec of ['playwright', 'playwright-core',
    '/opt/node22/lib/node_modules/playwright/index.mjs']) {
    try {
      const mod = await import(spec);
      if (mod?.chromium) { _chromium = mod.chromium; return _chromium; }
    } catch (e) { tried.push(`${spec} (${e.code || e.message})`); }
  }
  throw new Error(
    'Playwright is not installed. Run `npm install` in the repository root.\n' +
    '  tried: ' + tried.join(', '));
}

/**
 * Launch a browser for a test. Takes the same options as
 * `chromium.launch`; anything passed wins over what is worked out here.
 */
export async function launch(opts = {}) {
  const chromium = await resolveChromium();
  const o = { ...opts };
  /* Only pin the binary when the environment names one. On a developer's
     own machine Playwright has downloaded its browser and knows where it
     is; naming a path there is how this broke in the first place. */
  if (!o.executablePath && process.env.PW_CHROMIUM) o.executablePath = process.env.PW_CHROMIUM;
  if (!o.executablePath && process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers') {
    o.executablePath = '/opt/pw-browsers/chromium';
  }
  return chromium.launch(o);
}

export default { launch };
