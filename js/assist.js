/* ============================================================
   assist.js — the assistant that would rather not ask a model.

   THE IDEA, WHICH IS THE OPPOSITE OF THE USUAL ONE

   The normal way to build a chatbot is: take every question, send it to
   a model, print what comes back. It is one afternoon of work and it is
   wrong here, for three reasons that all have the same shape.

     • ARITHMETIC. "How many weeks is she on 12 June?" is a subtraction.
       A model can get it wrong — v99 exists because one wrote 20/20 over
       a scheme it had itself marked 8/20 — and a wrong gestational age
       said confidently is worse than no answer at all.

     • THE APP ITSELF. "How do I start a circuit?" has a true answer that
       lives in this repository. A model asked that question will invent
       a plausible AUREUM with menus it does not have, and the person
       will go looking for them.

     • WHAT IS IN THE BANK. "Find me a PPH station" is a search. We built
       a ranking engine for exactly this in v100, and it knows what is
       actually published; a model does not.

   So this asks a model LAST, not first. Every question is routed:

       a calculation      → js/calc.js, on this device, free, exact
       about AUREUM       → a written index in this file, free, true
       find something     → js/search.js over the real bank, free
       anything else      → the AI, and only then

   Most questions never reach the network. That is not a cost trick — it
   is the reason the answers can be trusted. A calculator cannot
   hallucinate a due date and a search cannot invent a station.

   AND IT SAYS WHICH KIND OF ANSWER IT GAVE

   Every answer carries a badge: worked out here, from AUREUM's own
   pages, from the station bank, or asked the AI — and when it was the
   AI, what it cost. A person who can see that the due date was
   ARITHMETIC and the essay advice was a MODEL knows exactly how much to
   trust each, which no amount of hedging in the prose achieves.

   WHERE IT LIVES

   In the corner fan with chat, the wall and the code scanner — see
   tearoom.js — because a fifth permanent bubble is one too many, and
   because this is the same kind of thing: a small window you open, use
   and dismiss without leaving the page you were on.
   ============================================================ */

const Assist = (() => {

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* The icon. Drawn rather than an emoji, for the reason the QR one is:
     an emoji is a different picture on every platform and this has to be
     recognisably the same button on an iPad and on a laptop. A spark
     over a rule — the thing that answers, over the thing it answers
     from. */
  const ICON = `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" aria-hidden="true">
    <path d="M12 3.2l1.35 3.6 3.6 1.35-3.6 1.35L12 13.1l-1.35-3.6L7.05 8.15l3.6-1.35L12 3.2z"
      fill="currentColor" opacity=".95"/>
    <path d="M18.4 13.6l.62 1.66 1.66.62-1.66.62-.62 1.66-.62-1.66-1.66-.62 1.66-.62.62-1.66z"
      fill="currentColor" opacity=".7"/>
    <path d="M4.4 17.6h11.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".45"/>
    <path d="M4.4 20.4h7.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".28"/>
  </svg>`;

  /* ================= what AUREUM actually does =================

     WRITTEN DOWN, NOT GENERATED.

     Every entry here is a fact about this application that somebody can
     check by pressing the link. A model asked "how do I star a station"
     would produce a confident paragraph about a menu that does not
     exist; this cannot, because it only knows what is in it.

     The cost of that honesty is that this list has to be kept up to
     date. It is the right cost: an out-of-date entry is one wrong
     sentence that a person can report, where a hallucinating model is
     wrong differently every time and nobody can report anything. */
  const HELP = [
    { id: 'circuit', title: 'Sitting a circuit of stations',
      words: 'circuit simulator several stations back to back nine round exam start mock osce practice',
      route: '#/osce/sim', go: 'Open the circuit builder',
      body: `A circuit is several stations back to back, the way the real exam runs — the PGIM sits nine of fifteen
        minutes. Go to <strong>OSCE → Exam simulator</strong>, choose how many and how they are picked, and press
        Start. You are not told the topic while you are sitting it: the scenario is all the real room gives you.
        You can pause mid-station, leave and come back to it later, end the round early and still have what you sat
        marked, or skip a station before its clock starts.` },
    { id: 'star', title: 'Starring a station for revision',
      words: 'star starred bookmark save favourite revision list mark important later',
      route: '#/osce', go: 'Open the station bank',
      body: `Every station card has a <strong>★</strong> in its corner, and so does the station page. Starring one
        puts it in the <strong>★ Starred</strong> bin at the top of the bank, where you can see them all together and
        print every marking scheme as one booklet for the last week. The marks are stored against your account, not
        this device, so they follow you to your phone. The <strong>↓</strong> beside the star does the opposite: a
        station marked less important is left out of circuits.` },
    { id: 'photo', title: 'Having a written essay marked',
      words: 'essay photograph photo picture scan handwriting ocr transcript mark seq saq paper write',
      route: '#/library/essay', go: 'Open the essay papers',
      body: `Write the answer on paper as you would in the exam, then press <strong>📸 Photograph my answer</strong>
        on the writing page. AUREUM reads the pages, shows you the transcript to correct — anything it could not read
        for certain is marked <code>[?]</code> and never guessed — and then marks the corrected answer against the
        scheme. Costs about LKR 3 for a typical essay.` },
    { id: 'balance', title: 'Your balance and what things cost',
      words: 'balance money cost price top up topup payment prepaid rupees lkr slip bank pay credit',
      route: '#/billing', go: 'Open billing & balance',
      body: `AUREUM runs prepaid. <strong>Profile → Billing &amp; balance</strong> shows what you have, what each
        thing has cost you, and how to top up: transfer to the account shown and upload the slip, and a slip that
        matches is credited immediately. When the balance reaches zero the AI features pause — everything that does
        not need AI keeps working — and they come back the moment you top up.` },
    { id: 'record', title: 'Recordings, and keeping them',
      words: 'recording record audio tape microphone drive google save keep listen playback',
      route: '#/billing', go: 'Connect a Drive folder',
      body: `Every station you sit is recorded so you can hear yourself back — the fastest way to find out that you
        ramble. The recording stays on the AUREUM server for 24 hours and is then deleted. Connect a Google Drive
        folder in <strong>Billing &amp; balance</strong> and a copy of every recording is saved there as well: yours,
        for as long as you keep it. AUREUM can only see the folder you choose.` },
    { id: 'hand', title: 'Marking somebody by hand',
      words: 'mark hand manual examiner sheet tick scheme someone else person marksheet paper',
      route: '#/osce', go: 'Open the station bank',
      body: `Open any station and choose <strong>✍️ Mark somebody with it</strong>. You get the scenario, the
        questions, the reveals and the whole scheme with a tick box on every point, a countdown that stays on screen
        as you scroll, and a report at the end in exactly the same shape an AI-marked one has.` },
    { id: 'recall', title: 'Recall — the points you missed',
      words: 'recall spaced repetition revision due cards missed points forget review',
      route: '#/osce/recall', go: 'Open Recall',
      body: `Every marking point you miss goes into <strong>OSCE → Recall</strong> and comes back at widening
        intervals until you have it. The number on the tab is how many are due today.` },
    { id: 'aiosce', title: 'Sitting a station against a chat model',
      words: 'osce in ai claude chatgpt gemini chat model examiner role player copy prompt import',
      route: '#/osce', go: 'Open the station bank',
      body: `<strong>✦ Sit this one against a chat model</strong> on any station hands you a prompt to paste into
        Claude, ChatGPT or Gemini on another screen. That model plays the examiner and the role player; AUREUM holds
        the clock and the recording, and you paste its marking back in when you are done. The QR code at the foot of
        the dialog opens the same station on a phone, so you can run it on an iPad and record on the phone.` },
    { id: 'blueprint', title: 'What you have covered, and what you have not',
      words: 'progress blueprint coverage modules gap weak areas topics done statistics average',
      route: '#/osce/progress', go: 'Open Progress',
      body: `<strong>OSCE → Progress</strong> maps everything you have sat onto the blueprint: which modules you have
        covered, which you have never touched, and where your marks are weakest. The untouched ones are the hidden
        risk, and it says so plainly rather than showing you a flattering average.` },
    { id: 'tools', title: 'The clinical calculators',
      words: 'calculator calculate tool edd bishop score shock index magnesium iron bmi apgar dates',
      route: '#/tools', go: 'Open the calculators',
      body: `Gestational age and EDD, Bishop score, shock index and blood loss, magnesium sulphate volumes, the
        Ganzoni iron deficit, BMI and Apgar. They run on this device — no AI, no cost, no signal needed — and every
        one shows its working, because you have to be able to do them on paper in a viva.` }
  ];

  /* ================= the router =================

     The order is not arbitrary. Each rule is tried before the ones that
     could answer the same question less reliably, so the most trustworthy
     answer available always wins. */

  const RE_CALC = /\b(calculat|work out|how many weeks|gestational|edd|due date|bishop|shock index|blood loss|magnesium|mgso4|ganzoni|iron deficit|bmi|apgar|what is the dose|how much)\b/i;
  const RE_FIND = /\b(find|show|which station|any station|list|search|got a|do you have|stations? (on|about|for))\b/i;
  const RE_HOWTO = /\b(how (do|can|would) i|how to|where (is|do|are)|what happens when|can i|is there a way)\b/i;

  /**
   * Decide, without asking anything of anybody, what kind of question
   * this is and answer it if we can. Returns null when only a model will
   * do, which is the case this is designed to make rare.
   */
  function route(q, ctx) {
    const text = String(q || '').trim();
    if (!text) return null;

    /* 1. Arithmetic. Offered whenever a calculator plainly covers it, so
          that the answer comes from a function and not from prose. */
    const tool = (typeof Calc !== 'undefined') ? Calc.toolFor(text) : '';
    if (tool && (RE_CALC.test(text) || Calc.TOOLS.find(t => t.id === tool && new RegExp('\\b' + t.name.replace(/[^a-z]/gi, '') + '\\b', 'i').test(text)))) {
      const meta = Calc.TOOLS.find(t => t.id === tool);
      return { kind: 'calc', tool,
        title: meta.full,
        say: `That is arithmetic, so it is done here rather than asked of anything — exactly, instantly, and with the
              working shown. Fill it in and it answers as you type.` };
    }

    /* 2. The bank. A question about what exists is answered from what
          exists, using the same ranking the search box uses. */
    if (typeof Search !== 'undefined' && (ctx?.stations || []).length) {
      const looksLikeFind = RE_FIND.test(text);
      const cleaned = text.replace(/\b(find|show|me|a|an|the|any|station|stations|about|on|for|please|search|list|do you have|got)\b/gi, ' ');
      const res = Search.rank(ctx.stations, looksLikeFind ? cleaned : text);
      const strong = res.rows.filter(r => r.where === 'topic');
      if (looksLikeFind ? res.rows.length : strong.length) {
        return { kind: 'find', rows: (looksLikeFind ? res.rows : strong).slice(0, 6), cut: res.cut,
          title: `${(looksLikeFind ? res.rows : strong).length} station${(looksLikeFind ? res.rows : strong).length === 1 ? '' : 's'} in the bank` };
      }
    }

    /* 3. AUREUM itself. Matched against the written index — never
          generated, so it cannot describe a feature that is not here. */
    const help = bestHelp(text);
    if (help && (RE_HOWTO.test(text) || help.score >= 3)) return { kind: 'help', entry: help.entry, title: help.entry.title };

    return null;
  }

  /** The written entry that best fits, scored by how many of its own words appear. */
  function bestHelp(text) {
    const t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
    let best = null;
    HELP.forEach(entry => {
      const score = entry.words.split(/\s+/)
        .filter(w => w.length > 2 && t.includes(' ' + w + ' ')).length;
      if (score && (!best || score > best.score)) best = { entry, score };
    });
    return best;
  }

  /* ================= the window ================= */

  let el = null, open = false, msgs = [], stations = null, busy = false;

  const OPEN_KEY = 'aureum.assist.open';
  /* The conversation is deliberately NOT persisted. It is a scratchpad
     for the page you are on — "what does ↓ mean", "how many weeks" —
     not a record, and a chat that remembers yesterday's half-question
     invites you to scroll instead of ask. */

  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'tr-dock as-dock';
    el.innerHTML = `<div class="tr-surface as-surface">
      <header class="tr-dock-head as-head">
        <span class="tr-dock-title"><span class="as-head-ico">${ICON}</span> Ask AUREUM</span>
        <button class="tr-icon" data-act="clear" title="Start again">↺</button>
        <button class="tr-icon" data-act="close" title="Close">✕</button>
      </header>
      <div class="as-body" data-as-body></div>
      <form class="as-ask" data-as-form>
        <input type="text" class="as-in" data-as-in autocomplete="off" spellcheck="false"
          placeholder="Ask anything — or “how many weeks on 12 June?”">
        <button class="as-send" type="submit" aria-label="Ask">➤</button>
      </form>
    </div>`;
    document.body.appendChild(el);
    el.querySelector('[data-act="close"]').addEventListener('click', close);
    el.querySelector('[data-act="clear"]').addEventListener('click', () => { msgs = []; paint(); });
    el.querySelector('[data-as-form]').addEventListener('submit', e => {
      e.preventDefault();
      const input = el.querySelector('[data-as-in]');
      const q = input.value.trim();
      if (!q || busy) return;
      input.value = '';
      ask(q);
    });
    /* Delegated, because the body is rewritten on every message. */
    el.querySelector('[data-as-body]').addEventListener('click', e => {
      const s = e.target.closest('[data-as-suggest]');
      if (s) { ask(s.dataset.asSuggest); return; }
      const c = e.target.closest('[data-as-close]');
      if (c) close();
    });
    return el;
  }

  async function show() {
    ensure(); open = true; el.classList.add('is-open');
    try { localStorage.setItem(OPEN_KEY, '1'); } catch {}
    paint();
    setTimeout(() => el.querySelector('[data-as-in]')?.focus(), 60);
    /* The bank is fetched once, quietly, so "find me a PPH station" can
       be answered from what is actually published. A failure here costs
       nothing — the other three routes still work. */
    if (!stations && typeof OSCE !== 'undefined') {
      try {
        const list = await OSCE.stations();
        stations = (list || []).map(s => ({ id: s.id, topic: s.topic || '', scenario: s.scenario || '', deep: '' }));
      } catch { stations = []; }
    }
    ping();
  }
  function close() {
    open = false; el?.classList.remove('is-open');
    try { localStorage.setItem(OPEN_KEY, '0'); } catch {}
    ping();
  }
  const toggle = () => open ? close() : show();

  /* ================= answering ================= */

  async function ask(q) {
    busy = true;
    msgs.push({ who: 'me', text: q });
    msgs.push({ who: 'it', pending: true });
    paint();

    const local = route(q, { stations });
    if (local) {
      msgs.pop();
      msgs.push(Object.assign({ who: 'it' }, local));
      busy = false; paint();
      return;
    }

    /* ONLY NOW. Everything above was free, exact and offline. */
    try {
      const r = await askModel(q);
      msgs.pop();
      msgs.push({ who: 'it', kind: 'ai', text: r.text, cost: r.cost, model: r.model, free: r.free });
    } catch (e) {
      msgs.pop();
      msgs.push({ who: 'it', kind: 'error', text: e?.message || String(e) });
    }
    busy = false; paint();
  }

  /**
   * The last resort. Carries the same context the local routes had, so
   * the model is answering about THIS application with the real page
   * list in front of it rather than from an idea of what a study site
   * probably looks like.
   */
  async function askModel(q) {
    if (typeof Wallet !== 'undefined' && !(await Wallet.guard())) throw new Error(Wallet.blockedMessage());
    const token = await Backend.getAccessToken();
    if (!token) throw new Error('Sign in first — the assistant answers the free questions either way, but this one needs the AI.');
    const cfg = window.AUREUM_CONFIG || {};
    const choice = (typeof OSCE !== 'undefined') ? OSCE.chosenModel() : null;
    const res = await fetch(cfg.ai.apiBase, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        action: 'assist',
        question: q,
        /* What the app can actually do, so it never invents a menu. */
        pages: HELP.map(h => ({ title: h.title, route: h.route })),
        history: msgs.filter(m => m.text && !m.pending).slice(-6)
          .map(m => ({ role: m.who === 'me' ? 'user' : 'assistant', text: String(m.text).slice(0, 600) })),
        provider: choice?.provider, model: choice?.model,
        dailyLimit: cfg.ai?.dailyLimit
      })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `The assistant could not answer (HTTP ${res.status}).`);
    try { if (typeof Wallet !== 'undefined') Wallet.bust(); } catch {}
    const rate = (typeof Wallet !== 'undefined') ? Wallet.rate() : 340;
    let cost = 0;
    try {
      const r = (typeof Billing !== 'undefined') ? Billing.rateFor(d.model) : { in: 0, out: 0 };
      cost = (((d.usage?.in || 0) / 1e6) * (r.in || 0) + ((d.usage?.out || 0) / 1e6) * (r.out || 0)) * rate;
    } catch {}
    return { text: d.text || '', model: d.model || '', cost, free: !!d.free };
  }

  /* ================= drawing ================= */

  const OPENERS = [
    'How do I start a circuit?',
    'How many weeks on 12 June if her period was 1 January?',
    'Find me a postpartum haemorrhage station',
    'What does the ↓ on a station do?'
  ];

  function paint() {
    const body = el?.querySelector('[data-as-body]');
    if (!body) return;
    if (!msgs.length) {
      body.innerHTML = `
        <div class="as-hello">
          <div class="as-hello-ico">${ICON}</div>
          <h4>Ask about AUREUM, the bank, or the arithmetic.</h4>
          <p class="muted tiny">Most answers are worked out on this device — no AI, no cost, no signal needed. The
            badge on every answer says which kind it was, so you know how much to trust it.</p>
          <div class="as-openers">
            ${OPENERS.map(o => `<button data-as-suggest="${esc(o)}">${esc(o)}</button>`).join('')}
          </div>
        </div>`;
      return;
    }
    body.innerHTML = msgs.map(bubble).join('');
    body.scrollTop = body.scrollHeight;
    /* A calculator is a live thing, not a picture of one, so it is mounted
       into the bubble after the HTML lands. */
    msgs.forEach((m, i) => {
      if (m.kind !== 'calc') return;
      const host = body.querySelector(`[data-as-calc="${i}"]`);
      if (host && typeof Calc !== 'undefined') Calc.panel(host, { only: m.tool, compact: true });
    });
  }

  const BADGE = {
    calc: ['⚡', 'worked out here · free', 'is-calc'],
    help: ['📖', 'from AUREUM’s own pages · free', 'is-help'],
    find: ['🔎', 'from the station bank · free', 'is-find'],
    ai:   ['✦', 'asked the AI', 'is-ai'],
    error: ['⚠', 'could not answer', 'is-err']
  };

  function bubble(m, i) {
    if (m.who === 'me') return `<div class="as-msg is-me"><div class="as-b">${esc(m.text)}</div></div>`;
    if (m.pending) return `<div class="as-msg is-it"><div class="as-b as-think"><i></i><i></i><i></i></div></div>`;
    const [ico, label, cls] = BADGE[m.kind] || BADGE.ai;
    const badge = `<span class="as-badge ${cls}">${ico} ${esc(
      m.kind === 'ai' ? (m.free ? 'asked the AI · free tier' : `asked the AI · LKR ${(m.cost || 0).toFixed(2)}`) : label)}</span>`;
    let inner = '';
    if (m.kind === 'calc') {
      inner = `<p class="as-say">${esc(m.say)}</p><div class="as-calc" data-as-calc="${i}"></div>
        <a class="as-go" href="#/tools" data-as-close>Open all the calculators →</a>`;
    } else if (m.kind === 'help') {
      inner = `<h5 class="as-t">${esc(m.entry.title)}</h5><div class="as-rich">${m.entry.body}</div>
        <a class="as-go" href="${esc(m.entry.route)}" data-as-close>${esc(m.entry.go)} →</a>`;
    } else if (m.kind === 'find') {
      inner = `<h5 class="as-t">${esc(m.title)}</h5>
        <div class="as-hits">${m.rows.map(r => `
          <a class="as-hit" href="#/osce/station/${encodeURIComponent(r.rec.id)}" data-as-close>
            <strong>${esc(r.rec.topic)}</strong>
            <span>${esc(String(r.rec.scenario || '').slice(0, 90))}</span>
          </a>`).join('')}</div>
        ${m.cut ? `<p class="muted tiny">${m.cut} weaker match${m.cut === 1 ? '' : 'es'} were left out — the
          search box in the bank can show them.</p>` : ''}`;
    } else {
      inner = `<div class="as-rich">${rich(m.text)}</div>`;
    }
    return `<div class="as-msg is-it"><div class="as-b">${badge}${inner}</div></div>`;
  }

  /* The model answers in plain text with the occasional list. Enough
     markdown to render that honestly, and no more: anything cleverer is
     a way for a model's output to become markup on this page. */
  function rich(t) {
    const lines = String(t || '').split('\n');
    let out = '', inList = false;
    lines.forEach(raw => {
      const line = raw.trim();
      const li = /^[-*•]\s+(.*)$/.exec(line);
      if (li) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${inline(li[1])}</li>`; return; }
      if (inList) { out += '</ul>'; inList = false; }
      if (line) out += `<p>${inline(line)}</p>`;
    });
    if (inList) out += '</ul>';
    return out || `<p>${inline(String(t || ''))}</p>`;
  }
  const inline = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  /* ================= the launcher ================= */

  const listeners = new Set();
  const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  const ping = () => listeners.forEach(fn => { try { fn(open); } catch {} });

  /** Open with a question already asked — used by anything that wants to hand off. */
  function askAbout(q) { show(); if (q) ask(q); }

  function reset() { msgs = []; stations = null; busy = false; }
  function unmount() { close(); el?.remove(); el = null; reset(); }

  return { ICON, HELP, route, bestHelp, show, close, toggle, askAbout, isOpen: () => open,
    onChange, unmount, reset, _paint: paint, _msgs: () => msgs };
})();
