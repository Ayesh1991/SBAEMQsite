# Deployment & setup guide

AUREUM runs as a **static site** and works with **zero configuration** the moment
you open it (accounts and progress are stored in the browser). To get the two
"grown-up" features — **multi-device accounts** and **one-click Google Drive
import** — you wire up two free services. Everything is controlled from
`js/config.js`.

---

## 0. Run it locally

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```
(Opening `index.html` from `file://` won't work — browsers block loading the JSON
over `file://`. Always use a server.)

---

## 1. Host on Cloudflare Pages

1. Push this folder to a GitHub repo (or upload directly).
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Build settings: **Framework preset = None**, **Build command = (empty)**,
   **Build output directory = `/`** (the repo root). There is no build step.
4. Deploy. Your site is live at `https://<project>.pages.dev` (add a custom
   domain if you like).

The `functions/` folder is picked up automatically by Cloudflare Pages Functions
— that's what powers the Drive import at `/api/drive`.

---

## 2. Multi-device accounts & cloud progress (Supabase)

Without this, each browser keeps its own accounts. With it, a candidate signs in
on any device and sees the same profile, XP, streaks and history.

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor** → paste and run [`supabase/schema.sql`](../supabase/schema.sql).
   (Edit the developer email inside it first — it controls who may publish papers.)
3. **Authentication → Providers → Email**: enable it. For a small study group you
   may want to turn **"Confirm email" off** so sign-ups are instant.
4. **Project Settings → API**: copy the **Project URL** and the **anon public key**.
5. Paste them into `js/config.js`:

   ```js
   supabase: {
     url: 'https://xxxxxxxx.supabase.co',
     anonKey: 'eyJhbGciOi...'   // the anon PUBLIC key — safe to commit
   }
   ```

That's it — the app detects the keys and switches from local to cloud mode
(the sign-in screen and Profile page will say "synced across devices").

> The anon key is *designed* to be public; Row-Level Security in the schema is
> what actually protects data. Never paste the **service_role** key here.

---

## 3. One-click import from Google Drive

Lets you (the developer) pull new papers straight from the shared Drive folder
instead of downloading and re-uploading them.

### a. Share the folder

Open the folder → **Share → General access → "Anyone with the link" → Viewer**.
(Read-only link sharing is all the API key needs.)

### b. Create a Google API key

1. [Google Cloud Console](https://console.cloud.google.com) → create/pick a project.
2. **APIs & Services → Library → enable "Google Drive API"**.
3. **APIs & Services → Credentials → Create credentials → API key**.
4. **Restrict** the key: *API restrictions → Google Drive API only*. (Optionally
   restrict by HTTP referrer to your Pages domain.)

### c. Give the key to Cloudflare

Cloudflare Pages → your project → **Settings → Environment variables** →
add `GOOGLE_API_KEY = <your key>` (Production + Preview) → redeploy.

### d. Confirm the folder id

`js/config.js` already points at your folder:

```js
drive: { folderId: '13SFKM0Cn_lNAhOHb8Laikvj4Xc5zXT5x', apiBase: '/api/drive' }
```

Change `folderId` if you ever move to a different folder.

### How it behaves

- **With the key + function deployed:** the developer console's **"Scan Drive"**
  button lists every `.json` paper in the folder *and its subfolders*, parses each,
  and shows only the ones **not already published**.
- **Without it (e.g. local testing):** the console falls back to the bundled
  `data/drive-index.json` snapshot so you can still see the workflow, plus the
  **manual paste** box always works.

---

## 4. Developer access

The developer console lives at `/#/dev` and is unlocked by **either**:

- signing in with the developer email (`AUREUM_CONFIG.developer.email`), **or**
- entering the developer code (`AUREUM_CONFIG.developer.code`).

Change both in `js/config.js`. In cloud mode, the Supabase RLS policy is the real
guard on who can *publish* — the code just reveals the UI.

---

## 5. Updating the exam countdown

After each sitting, bump the date in `js/config.js`:

```js
exam: { name: 'PGIM MD (Obstetrics & Gynaecology) — Part 2', date: '2026-11-21' }
```

The landing-page countdown and the dashboard chip update automatically.

---

## What works in which mode

| Feature | Local (no setup) | + Supabase | + Drive API |
|---|:--:|:--:|:--:|
| Practise SBA/EMQ, both modes | ✅ | ✅ | ✅ |
| Accounts & progress | ✅ (this browser) | ✅ (all devices) | — |
| Publish via manual paste | ✅ (this browser) | ✅ (everyone) | — |
| Scan & import from Drive | snapshot only | snapshot only | ✅ live |
