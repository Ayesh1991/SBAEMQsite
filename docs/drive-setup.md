# Saving OSCE recordings to your own Google Drive

This is the once-only setup on Google's side. It takes about twenty minutes.
Nothing is paid, and because the app only ever asks for the `drive.file`
scope you do **not** enter Google's security assessment.

You can stay in **Testing** mode throughout — with eight users that is the
right choice. The trade is that Google ends each person's permission after
about **seven days**, so the connection has to be re-made roughly weekly.
The app shows its connection state so a lapse is obvious rather than
discovered when a recording has gone.

---

## What AUREUM will and will not be able to see

The scope is `https://www.googleapis.com/auth/drive.file`.

| | |
|---|---|
| **Can** | Create files in the folder you choose, and read back files it created |
| **Cannot** | See any other file, folder, document or photo in your Drive |
| **Cannot** | See files *you* put into that folder by hand afterwards |

That last row is worth knowing: this is a folder AUREUM **writes to**, never
one it reads wholesale.

---

## Step 1 — Use the Cloud project you already have

You already have one for the Drive question pipeline (the API key in
`js/config.js` → `drive.apiKey`). Use the same project.

1. Go to <https://console.cloud.google.com/>
2. Top-left project picker → choose that project.
3. Note the **project number** (Cloud overview → Project info). You need it
   later as `appId`.

## Step 2 — Turn on the two APIs

**APIs & Services → Library**, search for and **Enable** each:

- **Google Drive API**
- **Google Picker API**

## Step 3 — The consent screen

> **Google moved this in 2025.** It used to be one wizard at *APIs &
> Services → OAuth consent screen*. It is now a section of its own called
> **Google Auth Platform**, split into Branding / Audience / Data access /
> Clients. Both layouts are below — use whichever matches your screen.

### 3a. If you see "Google Auth Platform" (current)

Find it at **APIs & Services → OAuth consent screen** (which now redirects)
or search the console for **Google Auth Platform**.

**If it says "Google Auth Platform not configured yet", press *Get
started*.** That short wizard asks four things:

1. **App information** — App name `AUREUM`, User support email: your address.
2. **Audience** — **External**.
   (Internal is only offered on Google Workspace; a personal Gmail cannot
   use it.)
3. **Contact information** — your email address.
4. **Finish** — tick the Google API Services User Data Policy, then
   **Create**.

Then complete the two pages the wizard does not cover:

**→ Data access** (left menu)

- Press **Add or remove scopes**.
- Filter for `drive.file`, tick:
  ```
  https://www.googleapis.com/auth/drive.file
  ```
- It appears under **"Your non-sensitive scopes"** — confirm that, because
  it is the whole reason this setup is free. Do **not** add any other Drive
  scope; a broader one moves you into the sensitive/restricted tiers and
  the paid assessment.
- **Save**.

**→ Audience** (left menu)

- Publishing status will read **Testing**. Leave it there.
- Under **Test users**, press **Add users** and enter the Gmail address of
  every person who will use this — yourself first, others as they ask. Up
  to 100.
- **Save**.

**Only addresses in that list can connect while the app is in Testing.** If
you add a user later, they can connect immediately — no re-verification.

### 3b. If you see the old single wizard (legacy projects)

**APIs & Services → OAuth consent screen**

1. User type: **External** → Create.
2. App name: `AUREUM`. User support email: your address.
3. App logo: optional in Testing — skip it.
4. Developer contact email: your address. **Save and Continue.**
5. **Scopes:** *Add or Remove Scopes* → filter `drive.file` → tick
   `https://www.googleapis.com/auth/drive.file`. Confirm it is
   **non-sensitive**. **Save and Continue.**
6. **Test users:** *Add Users* → your Gmail, and anyone else's.
   **Save and Continue.**
7. Leave *Publishing status* as **Testing**.

### What "Testing" costs you

Nothing in money, two things in convenience:

- a **100-user cap** (you have eight, so this never bites)
- each person's permission **expires after about seven days**, so the
  connection is re-made weekly. The app shows an amber *Drive — reconnect*
  badge when that happens, so it is visible rather than discovered when a
  recording has gone.

## Step 4 — The OAuth client ID

**APIs & Services → Credentials → Create Credentials → OAuth client ID**

1. Application type: **Web application**
2. Name: `AUREUM web`
3. **Authorised JavaScript origins** — add every address the site is served
   from. No trailing slash, no path:
   ```
   https://your-site.pages.dev
   https://aureum.example            (if you have a custom domain)
   http://localhost:8907             (only if you test locally)
   ```
4. **Authorised redirect URIs** — leave empty. The browser token client does
   not use a redirect.
5. **Create**, then copy the **Client ID** (`…apps.googleusercontent.com`).

> If you later move to a custom domain, come back and add it here. A missing
> origin is the single most common cause of "the popup opened and closed".

## Step 5 — A browser API key for the Picker

You may reuse the existing Drive key if it is unrestricted enough, but a
separate one is cleaner.

**Credentials → Create Credentials → API key**

1. Copy the key.
2. **Edit API key → Application restrictions → Websites**, and add the same
   origins as above.
3. **API restrictions → Restrict key →** tick **Google Picker API** and
   **Google Drive API**.

This key is public — it lives in the browser, like the one already in
`config.js`. The restrictions are what protect it.

## Step 6 — Put the three values into AUREUM

In `js/config.js`, fill in the **`driveSave`** block (not `drive` — that one
belongs to the question importer):

```js
driveSave: {
  clientId: '000000000000-xxxxxxxx.apps.googleusercontent.com',
  apiKey:   'AIzaSy……',
  appId:    '000000000000'          // the project NUMBER from step 1
},
```

Deploy. Leaving `clientId` empty keeps the whole feature invisible — no
Google script is loaded and no button appears.

## Step 7 — Connect, once per person

In AUREUM: **Profile → Billing & balance → Open billing & top up →** then
scroll to **Recordings in your Drive → Connect a Drive folder**.

> The panel is on the billing PAGE, not the Profile summary — Profile only
> shows the balance and the button that opens it.
>
> **If you cannot see the panel at all:** as the developer you now get a
> checklist there instead, ticking off which of `clientId`, `apiKey` and
> `appId` the *deployed* config actually has. Editing `js/config.js` on
> your own machine changes nothing until that file is live on the site —
> that is the usual reason step 6 looks done and nothing appears. Everyone
> else sees no panel at all until it is configured, which is deliberate.

1. Google asks you to sign in and consent.
2. You will see **"Google hasn't verified this app"** — expected in Testing.
   Click *Advanced* → *Go to AUREUM (unsafe)*. It says that for every
   unverified app; it is your own project.
3. The folder picker opens. Choose an existing folder or create one
   (e.g. `AUREUM OSCE recordings`).

From then on, every marked station uploads its recording there, named
`2026-08-23 2205 — HELLP Syndrome.webm` so a year of them still sorts.

---

## Watching the connection

The panel shows one of three states, and the same badge appears beside it:

| State | What it means |
|---|---|
| **Drive** (green) | Connected. Shows the folder, how many recordings, and the last date. |
| **Drive — reconnect** (amber) | The grant lapsed, or an upload was refused. Nothing has been copied since. Two taps to fix. |
| **Drive off** (grey) | Never connected, or you disconnected. |

**The amber state is the one to watch for.** In Testing, Google expires the
permission after about seven days, so expect it weekly. Recordings are never
lost by this — the 24-hour server copy is untouched — they simply stop being
copied until you reconnect.

---

## If something does not work

| Symptom | Cause |
|---|---|
| Popup opens then closes immediately | The site's origin is not in **Authorised JavaScript origins** (step 4.3). Check for a trailing slash. |
| "Access blocked: this app's request is invalid" | Same as above, or the consent screen was never saved. |
| "AUREUM has not completed the Google verification process" with no *Advanced* link | Your address is not in **Test users** (step 3). |
| The folder picker never appears | Picker API not enabled, or the API key is restricted away from it (steps 2 and 5). |
| Connects, then stops working days later | Normal. Testing-mode grants expire in ~7 days. Reconnect. |

---

## Going to Production later

Only worth it if others start using it. You would need a privacy policy and
terms hosted on a domain you can verify in Search Console — which means a
real domain, not `*.pages.dev`. Google charges nothing for the review, and
with `drive.file` alone there is no security assessment. The gain is that
the 100-user cap and the 7-day expiry both disappear.
