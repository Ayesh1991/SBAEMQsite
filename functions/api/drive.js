/**
 * Cloudflare Pages Function — Google Drive read proxy.
 * Route: /api/drive
 *
 *   GET /api/drive?action=list&folderId=<id>
 *       → { files: [ { key, id, title, folder, owner, counts, classification, paper } ] }
 *       Recursively lists every .json paper in the folder and its
 *       subfolders, fetches each file's content, and returns parsed
 *       metadata (SBA/EMQ counts + folderTag) so the console can index them.
 *
 *   GET /api/drive?action=file&id=<fileId>
 *       → the raw paper JSON.
 *
 * Setup (see docs/SETUP.md):
 *   • Share the Drive folder as "Anyone with the link – Viewer".
 *   • Create a Google API key restricted to the Drive API.
 *   • In Cloudflare Pages → Settings → Environment variables, set
 *       GOOGLE_API_KEY = <your key>
 *
 * Only reads are performed; the key cannot modify Drive.
 */

const DRIVE = 'https://www.googleapis.com/drive/v3';

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

  if (!key) return json({ error: 'GOOGLE_API_KEY is not configured on the server.' }, 500);

  try {
    if (action === 'file') {
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'Missing id.' }, 400);
      const paper = await fetchFileJSON(id, key);
      return json(paper);
    }

    // action === 'list'
    const folderId = url.searchParams.get('folderId');
    if (!folderId) return json({ error: 'Missing folderId.' }, 400);

    const jsonFiles = await listJSONFilesRecursive(folderId, key, '', 0);
    // fetch + parse each file's content (bounded concurrency)
    const files = [];
    for (const f of jsonFiles) {
      let paper = null, counts = null;
      try {
        paper = await fetchFileJSON(f.id, key);
        counts = { sba: countSBA(paper), emq: countEMQ(paper) };
      } catch { /* leave paper null; console can re-fetch on approve */ }
      files.push({
        key: f.id,
        id: f.id,
        title: f.name,
        folder: f.folder,
        owner: f.owner,
        counts,
        paper
      });
    }
    return json({ folderId, files });
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}

async function listJSONFilesRecursive(folderId, key, folderName, depth) {
  if (depth > 6) return [];
  const out = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const fields = encodeURIComponent('nextPageToken, files(id,name,mimeType,owners(emailAddress))');
    const u = `${DRIVE}/files?q=${q}&fields=${fields}&pageSize=200&key=${key}` +
      (pageToken ? `&pageToken=${pageToken}` : '');
    const res = await fetch(u);
    if (!res.ok) throw new Error(`Drive list failed (HTTP ${res.status}). Is the folder shared with link access?`);
    const data = await res.json();
    for (const f of (data.files || [])) {
      if (f.mimeType === 'application/vnd.google-apps.folder') {
        const nested = await listJSONFilesRecursive(f.id, key, folderName ? `${folderName} / ${f.name}` : f.name, depth + 1);
        out.push(...nested);
      } else if (/\.json$/i.test(f.name) || f.mimeType === 'application/json') {
        out.push({ id: f.id, name: f.name, folder: folderName || 'root', owner: f.owners?.[0]?.emailAddress || '' });
      }
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

async function fetchFileJSON(id, key) {
  const res = await fetch(`${DRIVE}/files/${id}?alt=media&key=${key}`);
  if (!res.ok) throw new Error(`Drive fetch failed (HTTP ${res.status}).`);
  const text = await res.text();
  return JSON.parse(text);
}

function countSBA(p) { return (p.sba || p.questions || []).length; }
function countEMQ(p) { return (p.emq || p.themes || []).reduce((n, b) => n + ((b.stems || []).length), 0); }
