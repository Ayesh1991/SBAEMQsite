# Sponsor creatives

Files here are served by Cloudflare Pages from AUREUM's own domain, which
is the point: **no YouTube, no third-party ad network, no tracking
pixel.** YouTube's terms do not permit using the embedded player to serve
your own advertising, and an embed cannot be counted reliably anyway.
Self-hosting also means zero Supabase egress — the database never sees
the video.

## What to supply a sponsor with

| | |
|---|---|
| Format | **H.264 MP4** (`-c:v libx264 -pix_fmt yuv420p -movflags +faststart`) |
| Length | 5 seconds. The skip appears at 3. |
| Size | **Under ~600 KB.** This is in front of somebody on mobile data who wants to study. |
| Sound | Muted. Autoplay with sound is refused by every browser, so a creative that needs audio does not work. |
| Aspect | 16:9. It is letterboxed into a max 62vh box. |

```sh
ffmpeg -i source.mov -t 5 -an -vf "scale=1280:-2" \
  -c:v libx264 -crf 30 -pix_fmt yuv420p -movflags +faststart out.mp4
```

## Making one here, from HTML

**Do not generate a branded drug advertisement with a text-to-video
model.** Veo, Sora, Runway and Kling all still garble short strings, and
"FEROCIA 200mg" coming out as "FERDCIA 20Omg" is a regulatory problem,
not a cosmetic one. Use those models for a *background* if you want
motion, and put the words on afterwards.

`src/` builds a creative out of DOM text instead, so the type is exactly
what you typed and a dose change costs nothing:

```sh
node ads/src/render.mjs ferocia        # 150 PNGs, 5s at 30fps
# then the ffmpeg line it prints
```

Each `src/<name>.html` exposes `window.setFrame(t)` and every frame is a
pure function of `t` — no wall clock, no dropped frames, identical bytes
on any machine. Copy `ferocia.html` to start a new one. The frames are
gitignored; the MP4 beside them is what is kept.

`ferocia-5s.mp4` is 68 KB for five seconds at 1280×720.

## Uploading a creative

The deploy is git-based, so "uploading to Cloudflare" means **adding the
file to this folder and pushing.** Cloudflare Pages rebuilds and serves
it at `https://<your-domain>/ads/<file>.mp4`. There is no dashboard
upload step and no bandwidth charge.

Easiest without a local clone: on github.com open the `ads/` folder →
**Add file** → **Upload files** → drag it in → commit to `main`.

Then in AUREUM: **Developer → Sponsors → New campaign**, and put
`/ads/<file>.mp4` in the Video URL field — a path from the site root,
not a full URL.

## The sample files

`sample-5s.mp4` / `.webm` — a plain test card.

`ferocia-5s.mp4` / `.webm` / `.jpg` — a worked example of a pharmaceutical
creative, built from `src/ferocia.html`. It carries a **SAMPLE CREATIVE**
badge so it can never be mistaken for a live approved campaign.

The `.webm` copies exist **only for the test suite.** Playwright's
Chromium ships without H.264, a licensed codec, so the MP4s cannot be
decoded there and the suite could never drive real playback. Do not send
a sponsor a WebM: Safari's support is patchy and MP4 works everywhere.

That gap is also how t139 tests the failure path. A creative the browser
cannot decode must let the candidate straight into the app and count
nothing, and the MP4 in this very container is a genuine example of one.
