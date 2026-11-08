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

## The two sample files

`sample-5s.mp4` is the shape of a real creative — H.264, what every
browser plays.

`sample-5s.webm` exists **only for the test suite.** Playwright's
Chromium ships without H.264, which is a licensed codec, so the MP4
cannot be decoded there and the suite could never drive real playback.
VP9 WebM it always supports. Do not send a sponsor a WebM: Safari's
support is patchy and MP4 is the one that works everywhere.

That gap is worth knowing about for another reason — it is how t139
tests the failure path. A creative the browser cannot decode must let
the candidate straight into the app and count nothing, and the MP4 in
this very container is a genuine example of one.
