/* Render a creative in ads/src/*.html to numbered frames, deterministically.

   WHY NOT A TEXT-TO-VIDEO MODEL. Veo, Sora, Runway and Kling all still
   garble short strings, and "FEROCIA 200mg" coming out as "FERDCIA
   20Omg" on a drug advertisement is a regulatory problem, not a
   cosmetic one. Here the text is DOM text: it is exactly what you typed,
   at any size, in any language, and it costs nothing to change a dose.

   Every frame is a pure function of t — the page exposes setFrame(t) and
   this steps it — so there is no wall clock, no dropped frames, and the
   same bytes come out on any machine.

   Run from the repository root:
     node ads/src/render.mjs ferocia
   then the ffmpeg line it prints. */
import { launch } from '../../tools/tests/browser.mjs';
import { mkdirSync } from 'node:fs';

const NAME = process.argv[2] || 'ferocia';
const FPS = 30, SECS = 5;
const OUT = `ads/src/frames-${NAME}`;

mkdirSync(OUT, { recursive: true });
const br = await launch();
const page = await (await br.newContext({
  viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
await page.goto(`file://${process.cwd()}/ads/src/${NAME}.html`, { waitUntil: 'load' });
await page.waitForTimeout(400);

const n = FPS * SECS;
for (let i = 0; i < n; i++) {
  await page.evaluate(t => window.setFrame(t), i / FPS);
  await page.screenshot({ path: `${OUT}/f${String(i).padStart(4, '0')}.png` });
}
await br.close();

console.log(`${n} frames (${SECS}s at ${FPS}fps) in ${OUT}

Now encode. MP4 is what a sponsor gets — every browser plays H.264:
  ffmpeg -y -framerate ${FPS} -i ${OUT}/f%04d.png -an \\
    -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p \\
    -movflags +faststart ads/${NAME}-5s.mp4

A poster frame, so the box is never blank while it loads:
  ffmpeg -y -i ads/${NAME}-5s.mp4 -vf "select=eq(n\\,78)" -frames:v 1 -q:v 3 ads/${NAME}-5s.jpg

Keep the MP4 under ~600 KB. Check with: du -h ads/${NAME}-5s.mp4`);
