/* ============================================================
   ads.js — the sponsored pre-roll, and an impression that can be
   defended to the company paying for it.

   WHY THIS EXISTS. Supabase costs $25–40 a month and the candidates are
   mostly registrars on a registrar's salary. A five-second pre-roll from
   a pharmaceutical sponsor covers the bill without charging them.

   THE FIRST RULE IS THAT IT NEVER STOPS SOMEBODY STUDYING. Every path
   through this module ends with the app opening: no campaign, no
   network, a video that will not decode, a browser that blocks
   autoplay, an exception anywhere — all of them resolve, none of them
   throw, and none of them leave a candidate looking at a black box at
   2am the night before Part 2. The ad is the thing that gives way.

   WHAT AN IMPRESSION MEANS, AND WHAT IT CANNOT MEAN. A browser can
   always lie about having watched a video; that is not fixable in a
   static app and pretending otherwise would be the dishonest part. So
   the claim sold to a sponsor is deliberately a modest one — "N
   distinct doctors, once each per day" — and the database is what keeps
   it: a unique index on (campaign, user, day), an insert policy that
   files it under the viewer's own id, and the server's clock. See
   section 39 of supabase/schema.sql.

   WATCHED TIME IS PLAYBACK TIME, not wall-clock time. Accumulated from
   `timeupdate` while actually playing, so a backgrounded tab, a paused
   video and a device left on the desk earn nothing.

   WHO SEES IT: a free account. The flag exists before the paid tier
   does, because a candidate who has paid and is still advertised to is
   the complaint that follows one. Editors and admins are exempt too —
   they are staff, not the audience, and this would be in their way all
   day.
   ============================================================ */
const Ads = (() => {
  'use strict';

  /* The skip appears at 3s and the impression is counted at 3s: the
     same threshold, deliberately. A candidate who skips the moment they
     are allowed to has still watched what the sponsor is paying for, so
     there is nothing to argue about at the end of the month. */
  const COUNT_AT_MS = 3000;
  const SKIP_AT_MS = 3000;
  const SESSION_KEY = 'aureum-ad-shown';

  let showing = false;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const seenThisSession = () => { try { return !!sessionStorage.getItem(SESSION_KEY); } catch { return false; } };
  const markSeen = () => { try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* private window */ } };

  /** Is this account one we show advertising to at all? */
  async function eligible() {
    try {
      const me = await Backend.currentUser();
      if (!me) return false;                       // signed out: nothing to file an impression under
      if (me.isEditor || me.isAdmin) return false; // staff, not the audience
      const plan = await Backend.myPlan?.();
      return (plan || 'free') === 'free';
    } catch { return false; }
  }

  /** The campaign to play, or null. The database has already refused
      anything not live, not approved or out of date. */
  async function pick(track) {
    try {
      const live = (await Backend.liveAds?.()) || [];
      /* Course targeting follows the same rule as content: an untargeted
         campaign is shown to everyone, because unfiled is not
         irrelevant. Course.fits would be the obvious call here, but it
         reads `tracks` on CONTENT and a campaign is not content. */
      const fits = live.filter(c => {
        const t = (c.tracks || []).filter(Boolean);
        return !t.length || !track || t.includes(track);
      });
      if (!fits.length) return null;
      /* Even rotation, not newest-first: a sponsor paying the same money
         should not be buried under whoever uploaded last. */
      return fits[Math.floor(Math.random() * fits.length)];
    } catch { return null; }
  }

  /**
   * Play the pre-roll if there is one to play. ALWAYS resolves, and
   * resolves fast when there is nothing to show.
   * @returns {Promise<boolean>} whether an ad was actually shown
   */
  async function maybeShow(opts) {
    const o = opts || {};
    if (showing) return false;
    if (!o.force && seenThisSession()) return false;
    if (!o.force && !(await eligible())) return false;
    let track = null;
    try { track = (typeof Course !== 'undefined' && Course.currentId) ? Course.currentId() : null; } catch {}
    const campaign = await pick(track);
    if (!campaign || !campaign.mediaUrl) return false;
    markSeen();
    try { return await play(campaign); }
    catch { closeAll(); return false; }            // never block the app
  }

  function closeAll() {
    showing = false;
    document.querySelectorAll('.ad-shade').forEach(n => n.remove());
    document.body.classList.remove('ad-open');
  }

  function play(c) {
    return new Promise(resolve => {
      showing = true;
      document.body.classList.add('ad-open');
      const shade = document.createElement('div');
      shade.className = 'ad-shade';
      shade.innerHTML = `
        <div class="ad-box" role="dialog" aria-label="Sponsor message">
          <video class="ad-video" playsinline preload="auto"
            ${c.posterUrl ? `poster="${esc(c.posterUrl)}"` : ''}
            src="${esc(c.mediaUrl)}"></video>
          <div class="ad-bar">
            <span class="ad-by">Sponsored · ${esc(c.sponsor || '')}</span>
            <span class="ad-count" data-ad-count></span>
            <button class="ad-skip" data-ad-skip disabled>Skip</button>
          </div>
          <p class="ad-why">Ads from our sponsors keep AUREUM running.
            <a href="#/about-ads">Why you are seeing this</a></p>
        </div>`;
      document.body.appendChild(shade);

      const video = shade.querySelector('.ad-video');
      const skip = shade.querySelector('[data-ad-skip]');
      const count = shade.querySelector('[data-ad-count]');

      let playedMs = 0, last = 0, counted = false, done = false;

      const finish = (how) => {
        if (done) return; done = true;
        /* Recorded on the way out, whatever the way out was, so a
           candidate who skips at 3s still counts and one who closes the
           tab at 1s does not. */
        record(c, playedMs, how === 'ended');
        closeAll();
        resolve(true);
      };

      /* THE ESCAPE HATCHES, all of them. A video that never loads must
         not hold the app: if nothing has played after a generous grace
         period, give up and let them in. */
      const bail = setTimeout(() => { if (playedMs < 250) finish('stalled'); }, 6000);
      video.addEventListener('error', () => finish('error'));
      video.addEventListener('stalled', () => { if (playedMs < 250) finish('stalled'); });

      video.addEventListener('timeupdate', () => {
        const t = video.currentTime * 1000;
        /* Playback time, not wall clock: the delta between timeupdates
           while actually playing. A seek backwards would otherwise
           subtract, and a background tab would accrue. */
        if (t > last) playedMs += Math.min(t - last, 1000);
        last = t;
        if (!counted && playedMs >= COUNT_AT_MS) { counted = true; }
        if (playedMs >= SKIP_AT_MS) {
          skip.disabled = false;
          skip.textContent = 'Skip ›';
          count.textContent = '';
        } else {
          const left = Math.ceil((SKIP_AT_MS - playedMs) / 1000);
          count.textContent = `Skip in ${left}`;
        }
      });
      video.addEventListener('ended', () => { clearTimeout(bail); finish('ended'); });
      skip.addEventListener('click', () => { clearTimeout(bail); finish('skipped'); });

      /* Autoplay with sound is refused by every browser; muted is the
         only kind that starts. A sponsor video that needs sound to work
         is the wrong video. */
      video.muted = true;
      const p = video.play();
      if (p && p.catch) p.catch(() => finish('blocked'));
    });
  }

  /** Fire-and-forget: a failed count must never surface to a candidate. */
  function record(c, playedMs, completed) {
    if (playedMs < COUNT_AT_MS) return;
    try {
      Promise.resolve(Backend.recordImpression?.(c.id, Math.round(playedMs), !!completed))
        .catch(() => {});
    } catch { /* counting is the sponsor's problem, never the reader's */ }
  }

  return { maybeShow, eligible, _pick: pick, _play: play, COUNT_AT_MS, SKIP_AT_MS };
})();
