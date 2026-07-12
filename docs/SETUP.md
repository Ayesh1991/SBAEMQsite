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

---

## 6. Explore with AI (Gemini Flash + optional Claude)

This adds a **✨ Explore with AI** button under each question's explanation
(study mode + results review). Everyone gets **Gemini Flash**; only the developer
email gets a **Claude** toggle and downloadable study aids (summary, chart,
infographic, tree). The keys live **only** in Cloudflare — never in the browser.

### 6.1 Run the updated database script
Re-run [`supabase/schema.sql`](../supabase/schema.sql) in the Supabase SQL Editor.
It adds the AI cache + usage tables and the `bump_ai_usage` function (and is safe
to run again — it only adds what's missing).

### 6.2 Get a Gemini API key (free)
1. Go to **https://aistudio.google.com/apikey** (sign in with your Google account).
2. Click **Create API key** → **Create API key in new project** (or pick your
   existing "aureum" project).
3. Copy the key (starts with `AIza…`).

> The Gemini **free tier** is generous (Flash models allow a high daily request
> count). The app also **caches** each question's first explanation and
> **rate-limits** per user per day (`ai.dailyLimit` in `js/config.js`, default 40),
> so a 7-person group stays comfortably inside the free tier.

### 6.3 (Optional, developer-only) Get a Claude key
1. Go to **https://console.anthropic.com** → **API Keys** → **Create Key**.
2. Copy it (starts with `sk-ant-…`). This is **paid**, but only *you* can trigger
   Claude, so the cost is tiny.

### 6.4 Paste the keys into Cloudflare
Cloudflare → **Workers & Pages → sbaemqsite → Settings → Variables and secrets**
→ **Add**. Add each of these as **Secret** (type = Secret), Production:

| Variable name | Value |
|---|---|
| `GEMINI_API_KEY` | your `AIza…` key |
| `SUPABASE_URL` | `https://bhemrozypoglbcvkhpzk.supabase.co` |
| `SUPABASE_ANON_KEY` | your Supabase anon public key (same one in `js/config.js`) |
| `DEV_EMAIL` | `ayeshmantha@gmail.com` |
| `ANTHROPIC_API_KEY` | *(optional)* your `sk-ant-…` key — only if you want Claude |

(You already added `GOOGLE_API_KEY` for Drive — leave it; it's separate.)

Then **Deployments → ⋯ → Retry deployment** so the new variables load.

### 6.5 Verify
1. Sign in on the site, do a question in **Study mode**.
2. Under the explanation, click **✨ Explore with AI** → an explanation should
   stream in, with a follow-up box.
3. As the developer you'll also see the **Gemini / Claude** toggle and the
   **Study aids** buttons (Summary / Chart / Infographic / Tree) that download files.

### How the developer-only gate is enforced
The browser sends your Supabase login token to the function; the function asks
Supabase who you are and compares your email to `DEV_EMAIL`. So a candidate
**cannot** flip a switch to spend your Claude credits — non-developers are always
served Gemini, and study aids return "developer only".

### Tuning
`js/config.js` → `ai` block:
- `enabled` — master on/off.
- `dailyLimit` — AI calls per user per day (free-tier guard).
- `followUpLimit` — follow-up chat messages per question per user.
- `geminiModel` / `claudeModel` — model ids.
