/* ============================================================
   serve.mjs — the site, on http://127.0.0.1:8907, with nothing installed.

   WHY THIS EXISTS. `npm run serve` used to shell out to `python3`, which is
   not on a stock Windows machine, so the first command somebody runs after
   cloning failed with "python3 is not recognized" — before they had seen
   the site work at all. The alternative, `npx http-server`, needs a
   download and a prompt the first time.

   Node is already required to run the tests, so the server may as well be
   Node. No dependencies, no download, works offline.

   It is a DEVELOPMENT server and says so: it serves the working tree as-is
   with caching turned off, which is exactly what you want while editing and
   exactly what you must not put on the internet. Cloudflare Pages serves
   the real thing.
   ============================================================ */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(dirnameOf(import.meta.url), '..'));
const PORT = Number(process.argv[2] || process.env.PORT || 8907);

function dirnameOf(url) { const p = fileURLToPath(url); return p.slice(0, p.lastIndexOf(sep)); }

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.webm': 'video/webm', '.mp4': 'video/mp4',
  '.pdf': 'application/pdf', '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8'
};

createServer((req, res) => {
  let path = decodeURIComponent((req.url || '/').split('?')[0]);
  if (path.endsWith('/')) path += 'index.html';

  /* Nothing above the repository root, whatever the URL says. A dev server
     on localhost is still a server, and `../../.ssh/id_rsa` is still a
     request somebody's stray fetch can make. */
  const full = normalize(join(ROOT, path));
  if (!full.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

  let st;
  try { st = statSync(full); } catch { res.writeHead(404).end('Not found: ' + path); return; }
  if (st.isDirectory()) { res.writeHead(404).end('Not found: ' + path); return; }

  res.writeHead(200, {
    'Content-Type': TYPES[extname(full).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    /* No caching at all: you are editing these files, and a cached js/
       file is twenty minutes of debugging a change that did apply. */
    'Cache-Control': 'no-store, max-age=0'
  });
  createReadStream(full).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  AUREUM — development server\n`);
  console.log(`  http://127.0.0.1:${PORT}\n`);
  console.log(`  Serving ${ROOT}`);
  console.log(`  Leave this running; press Ctrl+C to stop.\n`);
});
