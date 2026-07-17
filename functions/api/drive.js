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
const MAX_QUERIES = 45;        // stay under the ~50 subrequest cap per invocation
const PARENTS_PER_QUERY = 28;  // folders OR-ed into one Drive query (bigger = fewer
                               // queries; a huge library of topic folders — like an
                               // infographics folder with a JSON sprinkled in each —
                               // then walks in a handful of requests, no truncation)
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

    const { files: found, truncated, queries, skipped } = await listJSONFilesBatched(folderId, key);

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
    return json({ folderId, files, truncated: truncated || undefined, skipped: skipped || undefined });
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}

/**
 * Breadth-first folder walk that batches many parent folders into a
 * single Drive query ('a' in parents or 'b' in parents …) so even a
 * folder tree with hundreds of subfolders fits in a handful of requests.
 *
 * Resilience: if a batch 403s (one restricted subfolder poisons the OR
 * query), it splits and retries each parent alone, skipping only the
 * ones that are individually restricted — so a few inherited-Restricted
 * subfolders don't kill the whole scan. If the ROOT folder itself is
 * unreadable, that's a real sharing problem and we say so plainly.
 */
async function listChildren(parentIds, key, budget) {
  const out = { folders: [], files: [], failed: 0 };
  const parentQ = parentIds.map(id => `'${id}' in parents`).join(' or ');
  let pageToken = '';
  do {
    if (budget.used >= MAX_QUERIES) { out.truncated = true; break; }
    budget.used++;
    // Server-side filter: only folders and JSON-ish files come back, so a
    // library holding thousands of images/docs never inflates the listing
    // (that inflation is what caused "list truncated" on big folders).
    const q = encodeURIComponent(`(${parentQ}) and trashed = false and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'application/json' or name contains '.json')`);
    const fields = encodeURIComponent('nextPageToken, files(id,name,mimeType,parents,owners(emailAddress))');
    const u = `${DRIVE}/files?q=${q}&fields=${fields}&pageSize=1000&key=${key}` + (pageToken ? `&pageToken=${pageToken}` : '');
    const res = await fetch(u);
    if (!res.ok) {
      if (parentIds.length === 1) {                 // this single folder is inaccessible
        const body = await res.json().catch(() => ({}));
        out.failed = 1; out.status = res.status; out.message = body.error?.message || `HTTP ${res.status}`;
        return out;
      }
      for (const id of parentIds) {                 // split the poisoned batch, skip only the bad ones
        const sub = await listChildren([id], key, budget);
        out.folders.push(...sub.folders); out.files.push(...sub.files);
        out.failed += sub.failed; if (sub.truncated) out.truncated = true;
      }
      return out;
    }
    const data = await res.json();
    for (const f of (data.files || [])) {
      const parent = (f.parents || [])[0];
      if (f.mimeType === 'application/vnd.google-apps.folder') out.folders.push({ id: f.id, name: f.name, parent });
      else if (/\.json$/i.test(f.name) || f.mimeType === 'application/json') out.files.push({ id: f.id, name: f.name, parent, owner: f.owners?.[0]?.emailAddress || '' });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

async function listJSONFilesBatched(rootId, key) {
  const files = [];
  const folderName = { [rootId]: '' };
  let frontier = [rootId];
  let truncated = false, skipped = 0;
  const budget = { used: 0 };

  for (let depth = 0; depth <= 6 && frontier.length; depth++) {
    const nextFrontier = [];
    for (let i = 0; i < frontier.length; i += PARENTS_PER_QUERY) {
      if (budget.used >= MAX_QUERIES) { truncated = true; break; }
      const batch = frontier.slice(i, i + PARENTS_PER_QUERY);
      const r = await listChildren(batch, key, budget);
      if (depth === 0 && r.failed) {
        // the root folder itself can't be read — this is the sharing problem
        throw new Error(`the flashcard folder isn't readable (${r.message || 'HTTP 403'}). Set its sharing to "Anyone with the link — Viewer" (NOT Restricted; Editor is not needed), then rescan. Tip: open the folder link in a private/incognito window — if it asks you to sign in, it isn't link-shared yet.`);
      }
      skipped += r.failed;
      if (r.truncated) truncated = true;
      for (const f of r.folders) { const path = folderName[f.parent] || ''; folderName[f.id] = path ? `${path} / ${f.name}` : f.name; nextFrontier.push(f.id); }
      for (const f of r.files) { const path = folderName[f.parent] || ''; files.push({ id: f.id, name: f.name, folder: path || 'root', owner: f.owner }); }
    }
    frontier = nextFrontier;
    if (truncated) break;
  }
  return { files, truncated, queries: budget.used, skipped };
}

async function fetchFileJSON(id, key) {
  const res = await fetch(`${DRIVE}/files/${id}?alt=media&key=${key}`);
  if (!res.ok) throw new Error(`Drive fetch failed (HTTP ${res.status}).`);
  return JSON.parse(await res.text());
}

function countSBA(p) { return (p.sba || p.questions || []).length; }
function countEMQ(p) { return (p.emq || p.themes || []).reduce((n, b) => n + ((b.stems || []).length), 0); }
