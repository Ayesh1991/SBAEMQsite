# AUREUM Bridge · Drive consolidator

A tiny, self-contained PWA that copies **flashcards (.json)**, **infographics
(images)** and **documents (.docx)** out of a large Google Drive library
(e.g. `OG-Revise-Infographics`, with hundreds of topic subfolders) into
clean, **flat** subfolders of a destination folder (e.g. `OGR-Common`):

```
OGR-Common/
  Flashcards/     ← every .json found anywhere in the source tree
  Infographics/   ← every image
  DOCx/           ← every Word document
```

Re-running a copy only copies files that aren't already in the destination
(matched by name) — so it works as a daily "sync new ones" button too.

Everything runs **in your browser** with your own Google sign-in. Credentials
and folder IDs are stored only in localStorage. No server ever sees your files.

## Deploy (GitHub Pages)

1. Create a new GitHub repository (e.g. `aureum-bridge`).
2. Upload these three files to its root: `index.html`, `manifest.webmanifest`, `sw.js`.
3. Repo → Settings → Pages → Source: `main` branch, `/ (root)` → Save.
4. Your app is at `https://<username>.github.io/aureum-bridge/`.

## One-time Google setup (same "aureum" Cloud project as the website)

The website's **API key** stays as-is (it reads public files). Copying is a
*write*, so this app needs an **OAuth 2.0 Client ID**:

1. [Cloud Console → APIs & Services → OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent):
   - User type **External** → fill the app name/email → add **your own email under Test users** → Save.
   - (Staying in "Testing" mode is fine — only you use this.)
2. [Credentials](https://console.cloud.google.com/apis/credentials) → **Create credentials → OAuth client ID → Web application**:
   - **Authorized JavaScript origins**: add `https://<username>.github.io`
     (exactly the origin the app shows on its page).
   - Create → copy the **Client ID** (ends in `.apps.googleusercontent.com`).
     No client secret is needed.
3. Open the app, paste: Client ID, source folder ID, destination folder ID → **Sign in with Google** → use the three copy buttons.

## Notes

- The destination folder does **not** need "anyone with the link can edit" —
  you sign in as the owner. Keep the destination link-shared as **Viewer**
  so the AUREUM website (API key) can read it.
- The AUREUM website's flashcard import should point at the destination
  folder (or its `Flashcards/` subfolder) — flat folders list in a couple of
  requests, so nothing gets truncated.
