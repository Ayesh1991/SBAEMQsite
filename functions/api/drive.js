/**
 * Cloudflare Pages Function — Google Drive read proxy.
 * Route: /api/drive
 *
 *   GET /api/drive?action=list&folderId=<id>
 *       → { files: [ { key, id, title, folder, counts?, paper? } ], truncated? }
 *       Recursively lists every .json file in the folder and its
 *       subfolders. For SMALL folders the file contents are inlined
 *       (with SBA/EMQ counts); for large folders only metadata is
 *       returned and the console fetches content on demand — this is
 *       essential because Cloudflare allows ~50 outbound subrequests
 *       per invocation, and a folder with hundreds of topic subfolders
 *       would otherwise fail with a generic error.
 *
 *   GET /api/drive?action=file&id=<fileId>
 *       → the raw file JSON (paper or flashcard deck).
 *
 * Setup (see docs/SETUP.md):
 *   • Share the Drive folder as "Anyone with the link – Viewer".
 *   • Create a Google API key restricted to the Drive API.
 *   • Cloudflare Pages → Settings → Variables and secrets:
 *       GOOGLE_API_KEY = <your key>
 *
 * Only reads are performed; the key cannot modify Drive.
 */

const DRIVE = 'https://www.googleapis.com/drive/v3';
const MAX_QUERIES = 38;        // stay safely under the ~50 subrequest cap
const PARENTS_PER_QUERY = 12;  // folders OR-ed into one Drive query
const INLINE_CONTENT_MAX = 20; // inline file contents only for small folders

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'list';
  const key = env.GOOGLE_API_KEY;

  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  };
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

  if (!key) return json({ error: 'GOOGLE_API_KEY is not configured on the server. Add it in Cloudflare Pages → Settings → Variables and secrets, then retry the deployment.' }, 500);

  try {
    if (action === 'file') {
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'Missing id.' }, 400);
      return json(await fetchFileJSON(id, key));
    }

    // action === 'list'
    const folderId = url.searchParams.get('folderId');
    if (!folderId) return json({ error: 'Missing folderId.' }, 400);

    const { files: found, truncated, queries } = await listJSONFilesBatched(folderId, key);

    // Inline content + counts only when the folder is small enough to
    // stay inside the subrequest budget; otherwise return metadata and
    // let the console fetch each file on approve.
    const inline = found.length > 0 && found.length <= INLINE_CONTENT_MAX && (queries + found.length) < MAX_QUERIES + INLINE_CONTENT_MAX;
    const files = [];
    for (const f of found) {
      let paper = null, counts = null;
      if (inline) {
        try {
          paper = await fetchFileJSON(f.id, key);
          counts = { sba: countSBA(paper), emq: countEMQ(paper) };
        } catch { /* metadata-only for this file */ }
      }
      files.push({ key: f.id, id: f.id, title: f.name, folder: f.folder, owner: f.owner, counts, paper });
    }
    return json({ folderId, files, truncated: truncated || undefined });
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}

/**
 * Breadth-first folder walk that batches many parent folders into a
 * single Drive query ('a' in parents or 'b' in parents …) so even a
 * folder tree with hundreds of subfolders fits in a handful of requests.
 */
async function listJSONFilesBatched(rootId, key) {
  const files = [];
  const folderName = { [rootId]: '' };
  let frontier = [rootId];
  let queries = 0;
  let truncated = false;

  for (let depth = 0; depth <= 6 && frontier.length; depth++) {
    const nextFrontier = [];
    for (let i = 0; i < frontier.length; i += PARENTS_PER_QUERY) {
      if (queries >= MAX_QUERIES) { truncated = true; break; }
      const batch = frontier.slice(i, i + PARENTS_PER_QUERY);
      const parentQ = batch.map(id => `'${id}' in parents`).join(' or ');
      let pageToken = '';
      do {
        if (queries >= MAX_QUERIES) { truncated = true; break; }
        queries++;
        const q = encodeURIComponent(`(${parentQ}) and trashed = false`);
        const fields = encodeURIComponent('nextPageToken, files(id,name,mimeType,parents,owners(emailAddress))');
        const u = `${DRIVE}/files?q=${q}&fields=${fields}&pageSize=1000&key=${key}` + (pageToken ? `&pageToken=${pageToken}` : '');
        const res = await fetch(u);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(`Drive list failed (HTTP ${res.status}): ${body.error?.message || 'is the folder shared as "Anyone with the link"?'}`);
        }
        const data = await res.json();
        for (const f of (data.files || [])) {
          const parent = (f.parents || [])[0];
          const path = folderName[parent] || '';
          if (f.mimeType === 'application/vnd.google-apps.folder') {
            folderName[f.id] = path ? `${path} / ${f.name}` : f.name;
            nextFrontier.push(f.id);
          } else if (/\.json$/i.test(f.name) || f.mimeType === 'application/json') {
            files.push({ id: f.id, name: f.name, folder: path || 'root', owner: f.owners?.[0]?.emailAddress || '' });
          }
        }
        pageToken = data.nextPageToken || '';
      } while (pageToken);
    }
    frontier = nextFrontier;
    if (truncated) break;
  }
  return { files, truncated, queries };
}

async function fetchFileJSON(id, key) {
  const res = await fetch(`${DRIVE}/files/${id}?alt=media&key=${key}`);
  if (!res.ok) throw new Error(`Drive fetch failed (HTTP ${res.status}).`);
  return JSON.parse(await res.text());
}

function countSBA(p) { return (p.sba || p.questions || []).length; }
function countEMQ(p) { return (p.emq || p.themes || []).reduce((n, b) => n + ((b.stems || []).length), 0); }
