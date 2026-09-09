/* ocr.js — AUREUM reads your handwriting.

   WHY THIS EXISTS, AND WHY IT IS TWO PASSES

   Everything in AUREUM that marks written work has, until now, needed the
   candidate to leave: photograph the pages, open somebody else's chat,
   paste, wait, copy the JSON back. Every step is a place to lose the work
   and, as the OSCE side proved at length, a place for a model to mark a
   remembered scheme instead of the real one.

   Reading the pages here removes all of that. But it introduces a failure
   the OSCE side never had, and it is worth being exact about it:

   A TRANSCRIBER THAT GUESSES IS WORSE THAN NO TRANSCRIBER.

   Handwriting under exam conditions is hard to read. Asked to read it, a
   model will produce a clean, fluent page with a dozen words silently
   invented — and the marking that follows is then against words the
   candidate never wrote, with nothing on screen to say so. The damage
   lands precisely on the words that carry marks: a drug name, a
   gestation, "day 3 to day 14", "80%".

   So this is deliberately TWO PASSES with a person in the middle:

     1. TRANSCRIBE, never guessing. An unreadable word comes back as [?],
        a half-read one as [?likely]. The instruction is on the server.
     2. The writer READS THEIR OWN TRANSCRIPT, with every [?] highlighted
        and counted, and fixes them. It is their handwriting; each one
        takes about three seconds.
     3. Only the corrected text goes for marking.

   The second pass costs about one rupee and is the whole difference
   between a marking you can defend and one you cannot. It also produces
   something worth having on its own: a typed copy of an answer that
   existed only on paper.

   WHAT THIS MODULE IS

   A general engine, not an essay feature. It takes pages of anything
   handwritten and hands back corrected text; the essay flow is its first
   caller, and case notes, a marking sheet photographed after a round, or
   a page of revision notes would all use it unchanged. */

const Scribe = (() => {
  'use strict';

  const cfg = () => window.AUREUM_CONFIG || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* PAGES GO UP BIG.

     The payment-slip reader shrinks to 1100px because it is looking for
     six printed fields. Handwriting is the opposite job: the difference
     between "day 3" and "day 8" is a few pixels, and the images are only
     about a fifth of what the call costs — the model's written report is
     the rest. Saving a fifth of three rupees by sending a blurred page is
     the worst trade in the app. */
  const LONG_EDGE = 1800;
  const QUALITY = 0.86;
  const PER_CALL = 3;              // pages per request — small enough to retry cheaply
  const MAX_PAGES = 20;

  /* ---------------- getting a page into the browser ---------------- */

  function shrink(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type || '')) return reject(new Error('That file is not an image.'));
      const fr = new FileReader();
      fr.onload = () => {
        const im = new Image();
        im.onload = () => {
          const scale = Math.min(1, LONG_EDGE / Math.max(im.width, im.height));
          const c = document.createElement('canvas');
          c.width = Math.round(im.width * scale);
          c.height = Math.round(im.height * scale);
          const g = c.getContext('2d');
          /* White underneath: a photograph with transparency (rare, but a
             screenshot can have it) would otherwise transcribe as black. */
          g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
          g.drawImage(im, 0, 0, c.width, c.height);
          const url = c.toDataURL('image/jpeg', QUALITY);
          resolve({ mime: 'image/jpeg', data: url.split(',')[1], url, w: c.width, h: c.height });
        };
        im.onerror = () => reject(new Error('The browser could not open that image.'));
        im.src = String(fr.result);
      };
      fr.onerror = () => reject(new Error('Could not read that file.'));
      fr.readAsDataURL(file);
    });
  }

  /* ---------------- the transcript, and what is wrong with it ---------------- */

  /** Every [?] and [?word] in a transcript. The count IS the quality score. */
  const UNSURE = /\[\?[^\]]*\]/g;
  const unsureCount = t => (String(t || '').match(UNSURE) || []).length;
  const words = t => String(t || '').trim().split(/\s+/).filter(Boolean).length;

  /** The transcript with its uncertain words wrapped for the eye to land on. */
  function markUp(text) {
    return esc(text || '').replace(/\[\?([^\]]*)\]/g, (m, w) =>
      `<mark class="sc-unsure">${w ? '?' + esc(w) : '?'}</mark>`);
  }

  /* ---------------- talking to the server ---------------- */

  async function transcribe(pages, opts) {
    const token = await Backend.getAccessToken();
    if (!token) throw new Error('Sign in first.');
    const res = await fetch(cfg().ai.apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        action: 'ocr', provider: 'gemini',
        pages: pages.map(p => ({ page: p.page, mime: p.mime, data: p.data })),
        tail: opts?.tail || '', context: opts?.context || '',
        dailyLimit: cfg().ai?.dailyLimit
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `The pages could not be read (HTTP ${res.status}).`);
    return data;
  }

  /**
   * Read a whole stack, in batches, reporting progress.
   * Returns [{ page, text, unreadable, note }] in page order.
   */
  async function readAll(pages, opts) {
    const out = [];
    let tail = '';
    for (let i = 0; i < pages.length; i += PER_CALL) {
      const batch = pages.slice(i, i + PER_CALL);
      opts?.onProgress?.(i, pages.length);
      const r = await transcribe(batch, { tail, context: opts?.context });
      (r.pages || []).forEach(p => out.push(p));
      if (r.truncated) {
        /* Fail loudly. A transcript that stopped halfway looks exactly like
           a short answer, and would be marked as one. */
        throw new Error('The transcript was cut off part-way through. Send fewer pages at a time.');
      }
      const last = out[out.length - 1];
      tail = String(last?.text || '').slice(-600);
    }
    opts?.onProgress?.(pages.length, pages.length);
    return out.sort((a, b) => (a.page || 0) - (b.page || 0));
  }

  /* ================= the sheet =================

     One screen, three states: add the pages, read them, correct them. */

  function open(opts) {
    const o = opts || {};
    document.querySelector('.sc-veil')?.remove();
    const el = document.createElement('div');
    el.className = 'sc-veil';
    el.innerHTML = `
      <div class="sc-back" data-sc-x></div>
      <div class="sc-box" role="dialog" aria-modal="true" aria-label="Read my handwriting">
        <div class="sc-head">
          <div>
            <p class="kicker">READ MY HANDWRITING</p>
            <h3>${esc(o.title || 'Photograph your answer')}</h3>
          </div>
          <button class="os-modal-x" data-sc-x aria-label="Close">✕</button>
        </div>
        <div class="sc-body" id="sc-body"></div>
        <div class="sc-foot" id="sc-foot"></div>
      </div>`;
    document.body.appendChild(el);
    document.body.classList.add('sc-open');

    const body = el.querySelector('#sc-body');
    const foot = el.querySelector('#sc-foot');
    let pages = [];             // { page, mime, data, url }
    let done = null;            // [{ page, text, unreadable, note }]
    let busy = false;

    const shut = () => {
      el.remove();
      document.body.classList.remove('sc-open');
      window.removeEventListener('hashchange', shut);
      document.removeEventListener('keydown', key);
    };
    const key = e => { if (e.key === 'Escape' && !busy) shut(); };
    el.querySelectorAll('[data-sc-x]').forEach(b => b.addEventListener('click', () => { if (!busy) shut(); }));
    window.addEventListener('hashchange', shut);
    document.addEventListener('keydown', key);

    /* ---------------- state 1: the pages ---------------- */
    const paintPages = () => {
      body.innerHTML = `
        <p class="sc-hint">${esc(o.hint || 'One photograph per page, in order. Lay the page flat, fill the frame, and keep the light even — the sharper the picture, the fewer words come back as unreadable.')}</p>
        <div class="sc-grid">
          ${pages.map((p, i) => `
            <figure class="sc-page">
              <img src="${p.url}" alt="Page ${i + 1}">
              <figcaption>
                <span>Page ${i + 1}</span>
                <span class="sc-page-acts">
                  <button type="button" data-up="${i}" title="Move earlier" ${i === 0 ? 'disabled' : ''}>↑</button>
                  <button type="button" data-down="${i}" title="Move later" ${i === pages.length - 1 ? 'disabled' : ''}>↓</button>
                  <button type="button" data-del="${i}" title="Remove" class="is-x">✕</button>
                </span>
              </figcaption>
            </figure>`).join('')}
          <label class="sc-add ${pages.length >= MAX_PAGES ? 'is-full' : ''}">
            <input type="file" accept="image/*" capture="environment" multiple hidden id="sc-file"
              ${pages.length >= MAX_PAGES ? 'disabled' : ''}>
            <span class="sc-add-ico">＋</span>
            <span>${pages.length ? 'Add another page' : 'Add the first page'}</span>
            <span class="muted tiny">${pages.length >= MAX_PAGES ? 'That is the most this can read at once.' : 'Camera or gallery'}</span>
          </label>
        </div>
        <p class="sc-msg" id="sc-msg"></p>`;

      body.querySelector('#sc-file').addEventListener('change', async e => {
        const files = [...(e.target.files || [])];
        e.target.value = '';
        const msg = body.querySelector('#sc-msg');
        for (const f of files) {
          if (pages.length >= MAX_PAGES) break;
          try {
            const im = await shrink(f);
            pages.push(Object.assign({ page: pages.length + 1 }, im));
          } catch (err) { msg.innerHTML = `<span class="bad">${esc(err.message || err)}</span>`; }
        }
        renumber(); paintPages(); paintFoot();
      });
      body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
        pages.splice(Number(b.dataset.del), 1); renumber(); paintPages(); paintFoot();
      }));
      body.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => {
        const i = Number(b.dataset.up); [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]];
        renumber(); paintPages(); paintFoot();
      }));
      body.querySelectorAll('[data-down]').forEach(b => b.addEventListener('click', () => {
        const i = Number(b.dataset.down); [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]];
        renumber(); paintPages(); paintFoot();
      }));
    };
    const renumber = () => pages.forEach((p, i) => { p.page = i + 1; });

    const paintFoot = () => {
      foot.innerHTML = `
        <span class="muted tiny">${pages.length
          ? `${pages.length} page${pages.length === 1 ? '' : 's'} · about ${estimate(pages.length)}`
          : 'Nothing added yet'}</span>
        <button class="btn btn-gold" id="sc-go" ${pages.length ? '' : 'disabled'}>Read the pages →</button>`;
      foot.querySelector('#sc-go')?.addEventListener('click', run);
    };

    /* What this will cost, before it is spent. The rate card is the one the
       invoices use, so the figure on screen is the figure that is billed. */
    function estimate(n) {
      try {
        const M = 'gemini-3.1-flash-lite';
        const r = Billing.rateFor(M);
        /* ~1,550 image tokens a page at this resolution, ~400 words of
           transcript out. Deliberately a little over rather than under. */
        const usd = (n * 1550 + 400) / 1e6 * r.in + (n * 550) / 1e6 * r.out;
        return typeof Wallet !== 'undefined' ? Wallet.lkr(usd * Wallet.rate()) : '$' + usd.toFixed(4);
      } catch { return 'a few rupees'; }
    }

    /* ---------------- state 2: reading ---------------- */
    async function run() {
      if (typeof Wallet !== 'undefined' && !(await Wallet.guard())) return;
      busy = true;
      body.innerHTML = `<div class="sc-working">
          <div class="sc-work-ico">👁</div>
          <p id="sc-work">Reading page 1 of ${pages.length}…</p>
          <div class="sc-bar"><i id="sc-bar" style="width:4%"></i></div>
          <p class="muted tiny">Handwriting takes a moment. Anything it cannot read for certain comes back marked,
            rather than guessed at — you will fix those on the next screen.</p>
        </div>`;
      foot.innerHTML = '';
      try {
        done = await readAll(pages, {
          context: o.context,
          onProgress: (i, n) => {
            const w = body.querySelector('#sc-work'), bar = body.querySelector('#sc-bar');
            if (w) w.textContent = i >= n ? 'Nearly there…' : `Reading page ${i + 1} of ${n}…`;
            if (bar) bar.style.width = Math.max(4, Math.round(i / n * 100)) + '%';
          }
        });
        busy = false;
        paintTranscript();
      } catch (err) {
        busy = false;
        body.innerHTML = `<div class="sc-working">
          <p class="bad">${esc(err.message || err)}</p>
          <p class="muted tiny">Nothing has been lost — your pages are still here.</p>
        </div>`;
        foot.innerHTML = `<span></span><button class="btn btn-ghost" id="sc-back">← Back to the pages</button>`;
        foot.querySelector('#sc-back').addEventListener('click', () => { paintPages(); paintFoot(); });
      }
    }

    /* ---------------- state 3: correcting ---------------- */
    function paintTranscript() {
      const total = () => done.reduce((n, p) => n + unsureCount(p.text), 0);
      body.innerHTML = `
        <div class="sc-verdict ${total() ? 'is-check' : 'is-clean'}" id="sc-verdict"></div>
        <p class="sc-hint">This is what is on your pages, not a tidied version of it — spelling, abbreviations and
          all, because that is what an examiner would have read. Fix the highlighted words; everything else you can
          leave alone.</p>
        ${done.map((p, i) => `
          <div class="sc-tr" data-tr="${i}">
            <div class="sc-tr-head">
              <strong>Page ${p.page || i + 1}</strong>
              <span class="sc-tr-n" data-n="${i}"></span>
              ${p.note ? `<span class="muted tiny">${esc(p.note)}</span>` : ''}
              <button type="button" class="sc-peek" data-peek="${i}">👁 the photograph</button>
            </div>
            <div class="sc-tr-shot" hidden><img src="${(pages[i] || {}).url || ''}" alt="Page ${i + 1}"></div>
            <div class="sc-tr-view" data-view="${i}"></div>
            <textarea class="sc-tr-edit" data-edit="${i}" rows="10" spellcheck="false">${esc(p.text || '')}</textarea>
          </div>`).join('')}`;

      const paintOne = i => {
        const p = done[i];
        const n = unsureCount(p.text);
        body.querySelector(`[data-view="${i}"]`).innerHTML = markUp(p.text) || '<span class="muted">(nothing on this page)</span>';
        const tag = body.querySelector(`[data-n="${i}"]`);
        tag.className = 'sc-tr-n ' + (n ? 'is-check' : 'is-clean');
        tag.textContent = n ? `${n} to check` : '✓ read cleanly';
      };
      const paintVerdict = () => {
        const n = total(), w = done.reduce((a, p) => a + words(p.text), 0);
        const v = body.querySelector('#sc-verdict');
        v.className = 'sc-verdict ' + (n ? 'is-check' : 'is-clean');
        v.innerHTML = n
          ? `<strong>${n} word${n === 1 ? '' : 's'} could not be read for certain.</strong>
             <span>They are highlighted below. Nothing was guessed — fix them and the marking is against what you
             actually wrote.</span>`
          : `<strong>✓ Every word was read.</strong> <span>${w} words. Read it over anyway — it takes a moment and
             it is your marking that depends on it.</span>`;
        foot.querySelector('#sc-done')?.toggleAttribute('disabled', false);
      };

      done.forEach((_, i) => paintOne(i));
      paintVerdict();

      body.querySelectorAll('[data-edit]').forEach(t => t.addEventListener('input', () => {
        const i = Number(t.dataset.edit);
        done[i].text = t.value;
        paintOne(i); paintVerdict();
      }));
      body.querySelectorAll('[data-peek]').forEach(b => b.addEventListener('click', () => {
        const box = body.querySelector(`[data-tr="${b.dataset.peek}"] .sc-tr-shot`);
        box.hidden = !box.hidden;
        b.textContent = box.hidden ? '👁 the photograph' : '✕ hide the photograph';
      }));

      foot.innerHTML = `
        <button class="btn btn-ghost btn-sm" id="sc-again">← The pages</button>
        <button class="btn btn-gold" id="sc-done">${esc(o.doneLabel || 'Use this transcript →')}</button>`;
      foot.querySelector('#sc-again').addEventListener('click', () => { paintPages(); paintFoot(); });
      foot.querySelector('#sc-done').addEventListener('click', () => {
        const text = done.map(p => String(p.text || '').trim()).filter(Boolean).join('\n\n');
        const result = {
          text,
          pages: done.map((p, i) => ({ page: p.page || i + 1, text: p.text || '', note: p.note || '' })),
          words: words(text),
          unsure: total(),
          pageCount: done.length
        };
        shut();
        try { o.onDone?.(result); } catch (e) { console.error(e); }
      });
    }

    paintPages(); paintFoot();
    return shut;
  }

  return { open, readAll, shrink, unsureCount, markUp, words, LONG_EDGE, MAX_PAGES };
})();
