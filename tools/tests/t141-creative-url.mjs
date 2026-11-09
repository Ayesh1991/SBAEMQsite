/* t141 — the creative URL field used to accept anything.

   THE FAILURE IS COMPLETELY SILENT, which is why it needed catching at
   the point of entry. A campaign pointing at the wrong file does not
   throw: the <video> element fails, Ads treats that as "this creative
   will not play", hands the screen back and lets the candidate into the
   app — exactly the behaviour v139 §4 exists to guarantee. So a
   mistyped URL looks, from every screen, like an ad system that is
   quietly working and simply has nothing to show.

   Both mistakes below were made on the first real attempt at using it:
   pointing at the HTML a creative was BUILT from rather than the MP4 it
   was rendered to, and leaving off the leading slash so the path
   resolves against whatever page happens to be open. */
import { launch } from './browser.mjs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
await ctx.addInitScript(() => { let real;
  Object.defineProperty(window, 'AUREUM_CONFIG', { configurable: true, get() { return real; },
    set(v) { real = v; if (real) real.supabase = { url: '', anonKey: '' }; } }); });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load|net::/.test(m.text())) bad.push('CONSOLE ' + m.text()); });

await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.click('#auth-toggle'); await page.waitForTimeout(300);
await page.fill('input[name=name]', 'Dr Didula Ayeshmantha');
await page.fill('input[name=email]', 'ayeshmantha@gmail.com');
await page.fill('input[name=password]', 'password123');
await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1700);
await page.evaluate(() => { sessionStorage['aureum-passkey'] = '1'; });
await page.goto(B + '/index.html?r=' + Math.random() + '#/dev/ads', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2800);

const submit = u => page.evaluate(async (u) => {
  const f = document.querySelector('#ad-form');
  f.closest('details').open = true;
  f.querySelector('[data-af="sponsor"]').value = 'ABC Pharmaceuticals';
  f.querySelector('[data-af="mediaUrl"]').value = u;
  f.querySelector('[data-ad-save]').click();
  await new Promise(r => setTimeout(r, 550));
  const msg = f.querySelector('[data-ad-msg]').textContent.trim();
  let saved = null;
  if (/Saved/.test(msg)) saved = (await Backend.listCampaigns())[0].media_url;
  return { msg, saved };
}, u);

/* ---------------------------------------------------------------- */
sec('1. THE TWO MISTAKES SOMEBODY ACTUALLY MAKES');

const html = await submit('ads/src/ferocia.html');
say('the HTML a creative was built from is refused', !html.saved, html.msg.slice(0, 60));
/* Saying "invalid" would leave somebody stuck: the fix is a command. */
say('  and the message says how to get the video', /render\.mjs/.test(html.msg) && /\.mp4/.test(html.msg));

const slash = await submit('ads/ferocia-5s.mp4');
/* Not refused — corrected. A missing slash is a typo, not a decision,
   and refusing it would be pedantry where a fix is obvious. */
say('a missing leading slash is corrected, not rejected',
  slash.saved === '/ads/ferocia-5s.mp4', slash.saved || slash.msg.slice(0, 50));

/* ---------------------------------------------------------------- */
sec('2. AND THE ONE THE BUSINESS CANNOT AFFORD');

const yt = await submit('https://youtu.be/dQw4w9WgXcQ');
say('a YouTube link is refused', !yt.saved);
/* Two separate reasons, and the second is the one that matters here. */
say('  saying it is their terms and that it cannot be counted',
  /terms do not allow/.test(yt.msg) && /cannot be counted/.test(yt.msg), yt.msg.slice(0, 70));
const vimeo = await submit('https://vimeo.com/12345');
say('  Vimeo too', !vimeo.saved);

const pdf = await submit('/ads/leaflet.pdf');
say('anything that is not a video is refused', !pdf.saved, pdf.msg.slice(0, 55));

/* ---------------------------------------------------------------- */
sec('3. WHAT SHOULD GO THROUGH, DOES');

for (const [u, why] of [['/ads/ferocia-5s.mp4', 'the committed sample'],
                        ['/ads/sample-5s.webm', 'a webm'],
                        ['https://cdn.example.com/spot.mp4', 'a sponsor’s own https URL']]) {
  const r = await submit(u);
  say(`${why} is accepted`, r.saved === u, r.saved || r.msg.slice(0, 50));
}

/* The committed creative is really there to point at. */
const served = await page.evaluate(async () => {
  const r = await fetch('/ads/ferocia-5s.mp4', { method: 'HEAD' });
  const p = await fetch('/ads/ferocia-5s.jpg', { method: 'HEAD' });
  return { video: r.ok && r.headers.get('content-type'), poster: p.ok && p.headers.get('content-type') };
});
say('the Ferocia creative is served', /video/.test(served.video || ''), served.video);
/* Optional, but it is the difference between a black box and a frame
   while the video loads. */
say('  and its poster frame too', /image/.test(served.poster || ''), served.poster);

/* ---------------------------------------------------------------- */
sec('4. STAMPS');
const stamp = await page.evaluate(async () => {
  const h = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...h.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  /* The literal belongs to the newest release file only — see the README. */
  return { vs, sw: vs.length === 1 && sw.includes("'aureum-v" + vs[0] + "'") };
});
say('one version across every asset', stamp.vs.length === 1, stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
