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

     `ask` is the part that makes it work in practice. Matching on the
     bag of words alone was not enough — "how to write essay and get
     marked" scored no better against the essay entry than against six
     others, and the router fell through to a search that returned three
     hundred stations. The example questions are matched as PHRASES and
     weigh far more than any single word, because the way somebody asks
     a thing is more distinctive than the words they happen to use. */
  const HELP = [
    { id: 'circuit', title: 'Sitting a circuit of stations',
      ask: ['how do i start a circuit', 'how to do a circuit', 'sit several stations', 'mock exam',
        'practice osce', 'how to do osce', 'how do i do an osce', 'how to sit a station', 'exam simulator'],
      words: 'circuit simulator stations back to back nine round exam start mock osce practice sit station',
      route: '#/osce/sim', go: 'Open the circuit builder',
      body: `A circuit is several stations back to back, the way the real exam runs — the PGIM sits nine of fifteen
        minutes. Go to <strong>OSCE → Exam simulator</strong>, choose how many and how they are picked, and press
        Start. You are not told the topic while you are sitting it: the scenario is all the real room gives you.
        You can pause mid-station, leave and come back later, end the round early and still have what you sat
        marked, or skip a station before its clock starts. For a single station instead, open any card in
        <strong>OSCE → Station bank</strong> and press Start.` },
    { id: 'aiosce', title: 'Sitting a station against a chat model (OSCE in AI)',
      ask: ['how can we do a osce in ai', 'how do i do osce in ai', 'osce in ai', 'sit a station against claude',
        'use chatgpt as examiner', 'gemini examiner', 'role player'],
      words: 'osce in ai claude chatgpt gemini chat model examiner role player copy prompt import paste',
      route: '#/osce', go: 'Open the station bank',
      body: `Open any station and press <strong>✦ Sit this one against a chat model</strong>. AUREUM hands you a
        prompt to paste into Claude, ChatGPT or Gemini on another screen; that model plays the examiner and the
        role player, while AUREUM holds the clock and the recording. When you finish, paste its marking back in and
        it becomes a report like any other. The QR code at the foot of the dialog opens the same station on a phone,
        so you can run it on an iPad and record on the phone.` },
    { id: 'essay', title: 'Writing an essay and having it marked',
      ask: ['how to write essay and get marked', 'how do i get my essay marked', 'essay marking',
        'photograph my answer', 'seq marking', 'how to do essay', 'submit an essay', 'written paper'],
      words: 'essay seq saq write written paper photograph photo picture scan handwriting ocr transcript mark marked marking',
      route: '#/library/essay', go: 'Open the essay papers',
      body: `<strong>Theory → Essay papers</strong> holds the written papers. Open one, pick a question and press
        Write — you get the stem, the parts and a thirty-minute clock. Write the answer on paper as you would in the
        exam. When you have finished, press <strong>📸 Photograph my answer</strong> on the same page: AUREUM reads
        the pages, shows you the transcript to correct (anything it could not read for certain is marked
        <code>[?]</code> and never guessed), then marks the corrected answer against the scheme point by point.
        About LKR 3 for a typical essay.` },
    { id: 'sba', title: 'SBA and EMQ practice',
      ask: ['how do i do sba', 'practice mcq', 'single best answer', 'emq practice', 'do a paper',
        'design a paper', 'mock paper', 'question bank'],
      words: 'sba emq mcq question paper practice quiz single best answer extended matching exam simulator mock design',
      route: '#/simulator', go: 'Open the paper simulator',
      body: `Whole past papers are in <strong>Theory → Papers</strong>; sit one in exam mode or study mode.
        <strong>Simulator</strong> builds a fresh paper for you, balanced across the blueprint and weighted towards
        what you have not covered — or design one yourself from chosen topics. Everything you get wrong goes into
        Mistakes and comes back later.` },
    { id: 'star', title: 'Starring a station for revision',
      ask: ['how do i star a station', 'bookmark a station', 'save for later', 'my starred stations',
        'what does the down arrow do', 'revision list'],
      words: 'star starred bookmark save favourite revision list mark important later lower skip less',
      route: '#/osce', go: 'Open the station bank',
      body: `Every station card has a <strong>★</strong> in its corner, and so does the station page. Starring one
        puts it in the <strong>★ Starred</strong> bin at the top of the bank, where you can see them together and
        print every marking scheme as one booklet for the last week. Marks are stored against your account, not this
        device, so they follow you to your phone. The <strong>↓</strong> beside it does the opposite: a station
        marked less important is left out of circuits, and can be skipped before its clock starts.` },
    { id: 'balance', title: 'Your balance, and what things cost',
      ask: ['how do i top up', 'how much does it cost', 'my balance', 'why is ai not working',
        'payment', 'upload a slip'],
      words: 'balance money cost price top up topup payment prepaid rupees lkr slip bank pay credit paused',
      route: '#/billing', go: 'Open billing & balance',
      body: `AUREUM runs prepaid. <strong>Profile → Billing &amp; balance</strong> shows what you have, what each
        thing has cost, and how to top up: transfer to the account shown and upload the slip — a slip that matches is
        credited immediately. When the balance reaches zero the AI features pause and everything else keeps working;
        they come back the moment you top up.` },
    { id: 'record', title: 'Recordings, and keeping them',
      ask: ['where are my recordings', 'how do i save recordings', 'connect google drive',
        'listen to myself', 'is it recorded'],
      words: 'recording record audio tape microphone drive google save keep listen playback hear',
      route: '#/billing', go: 'Connect a Drive folder',
      body: `Every station you sit is recorded so you can hear yourself back. The recording stays on the AUREUM
        server for 24 hours and is then deleted. Connect a Google Drive folder in <strong>Billing &amp; balance</strong>
        and a copy of every recording is saved there too: yours, for as long as you keep it. AUREUM can only see the
        folder you choose.` },
    { id: 'hand', title: 'Marking somebody by hand',
      ask: ['how do i mark someone', 'examine a colleague', 'mark by hand', 'be the examiner',
        'mark my friend', 'mark a colleague', 'mark another person', 'examine somebody'],
      words: 'mark marking hand manual examiner sheet tick scheme someone somebody else person friend colleague marksheet',
      route: '#/osce', go: 'Open the station bank',
      body: `Open any station and choose <strong>✍️ Mark somebody with it</strong>. You get the scenario, the
        questions, the reveals and the whole scheme with a tick box on every point, a countdown that stays on screen
        as you scroll, and a report at the end in exactly the same shape an AI-marked one has.` },
    { id: 'print', title: 'Printing a scheme, a report or a revision pack',
      ask: ['is there a way to print the marking scheme', 'print the scheme', 'save as pdf', 'print my report',
        'print out', 'pdf of the station'],
      words: 'print pdf paper printout save booklet scheme report revision pack hard copy',
      route: '#/osce', go: 'Open the station bank',
      body: `Open a station and press <strong>View the marking scheme</strong> — the dialog has
        <strong>🖨 Print / Save as PDF</strong>, which gives you the whole scheme with a tick box on every point.
        A finished report prints the same way, and you choose which sections go on it. In the
        <strong>★ Starred</strong> bin you can print every starred scheme at once as a single booklet.` },
    { id: 'recall', title: 'Recall — the points you missed',
      ask: ['what is recall', 'spaced repetition', 'what is due today', 'revise missed points'],
      words: 'recall spaced repetition revision due cards missed points forget review',
      route: '#/osce/recall', go: 'Open Recall',
      body: `Every marking point you miss goes into <strong>OSCE → Recall</strong> and comes back at widening
        intervals until you have it. The number on the tab is how many are due today.` },
    { id: 'progress', title: 'What you have covered, and what you have not',
      ask: ['how am i doing', 'my progress', 'what have i covered', 'my weak areas', 'blueprint'],
      words: 'progress blueprint coverage modules gap weak areas topics done statistics average score history',
      route: '#/osce/progress', go: 'Open Progress',
      body: `<strong>OSCE → Progress</strong> maps everything you have sat onto the blueprint: which modules you have
        covered, which you have never touched, and where your marks are weakest. The untouched ones are the hidden
        risk, and it says so plainly rather than showing a flattering average.` },
    { id: 'voice', title: 'The examiner’s voice',
      ask: ['change the examiner voice', 'turn off the voice', 'the voice is bad', 'browser voice',
        'disable groq voice', 'robot voice'],
      words: 'voice speak speech examiner read aloud groq browser sound mute silent tts',
      route: '#/osce/sim', go: 'Open the circuit builder',
      body: `The examiner reads each question aloud. Two voices are available and you choose on the brief screen
        before a station starts: <strong>this device’s own voice</strong>, which is instant, free and works offline,
        or the <strong>studio voice</strong>, which sounds more like a person and is the only one that reaches the
        recording directly. You can also turn the voice off altogether.` },
    { id: 'tools', title: 'The clinical calculators',
      ask: ['calculate the edd', 'how many weeks', 'bishop score', 'magnesium dose', 'work out the dates'],
      words: 'calculator calculate tool edd bishop score shock index magnesium iron bmi apgar dates gestational',
      route: '#/tools', go: 'Open the calculators',
      body: `Gestational age and EDD, Bishop score, shock index and blood loss, magnesium sulphate volumes, the
        Ganzoni iron deficit, BMI and Apgar — in <strong>#/tools</strong> and inside this window. They run on this
        device, so they cost nothing and work with no signal, and every one shows its working.` }
  ];

  /* ================= reading the question =================

     WHAT WENT WRONG BEFORE, AND WHY IT IS A CLASSIFIER NOW.

     The first version tried the station bank before the help index and
     fired on any topic match at all. So "how to write essay and get
     marked" — a question about a FEATURE — was answered with three
     hundred and nineteen stations, and "how can we do a osce in AI" with
     two hundred and thirty-eight. Both are the same mistake: a question
     about how to use the application was read as a request to search it.

     So intent is decided first and deliberately, and the order is now
     the other way round: how-to beats find, because somebody who says
     "how do I…" is asking to be shown WHERE, not handed a list.

     And a weak local match no longer wins. A bad canned answer is worse
     than a model answer — it looks authoritative and is off the point —
     so anything below the confidence bar goes to the model instead, with
     everything retrieved here in front of it. */

  const RE = {
    howto: /\b(how (do|can|could|should|would|to)|how i|where (is|are|do|can)|what happens|can i|is there a way|is it possible|show me how|teach me|explain how|enable|disable|turn (on|off)|set up|change the)\b/i,
    find:  /\b(find|search|look for|looking for|give me|list|any|some|show me|do you have|got any|which|recommend|suggest|i want|i need|open the)\b/i,
    calc:  /\b(calculat|work out|how many weeks|gestational age|due date|edd|bishop|shock index|blood loss|magnesium|mgso4|ganzoni|iron deficit|bmi|apgar|what.{0,12}dose)\b/i,
    /* Which bank they mean, when they say. */
    osce:  /\b(osce|station|viva|spoken|circuit)\b/i,
    /* Named outright. "question", "paper" and "quiz" are NOT here: they
       are what somebody calls an essay question and a past paper too,
       and letting them name the SBA bank meant "any essay question on
       pre-eclampsia" searched the MCQs and answered with one. */
    sba:   /\b(sba|emq|mcq|single best|extended matching)\b/i,
    sbaish:/\b(question|paper|quiz|mcqs)\b/i,
    essay: /\b(essay|seq|saq|written|long answer)\b/i,
    case:  /\b(case|case discussion|case file)\b/i,
    /* A clinical question is one about medicine rather than about the
       app or its contents — the only kind a model is genuinely the best
       answer to. */
    clinical: /\b(management|manage|treat|treatment|diagnos|cause|risk factor|complication|indication|contraindicat|guideline|rcog|nice|who|dose of|side effect|mechanism|differential|investigat|criteria|classification|define|what is|what are|why does|stands? for|pathophysiolog)\b/i
  };

  /** What kind of question is this, and how sure are we? */
  function classify(q) {
    const t = ' ' + String(q || '').toLowerCase().trim() + ' ';
    /* IN THE ORDER THEY NAMED THEM, because the first thing somebody
       says is the thing they want: "any essay question on X" is a
       request for an essay, and the word "question" after it does not
       change that. */
    const banks = [];
    const at = k => { const m = RE[k].exec(t); return m ? m.index : Infinity; };
    [['osce', RE.osce], ['essay', RE.essay], ['sba', RE.sba], ['case', RE.case]]
      .filter(([, re]) => re.test(t))
      .sort((a, b) => at(a[0]) - at(b[0]))
      .forEach(([k]) => banks.push(k));
    /* A loose word for questions only names the SBA bank when nothing
       else has been named. */
    if (!banks.length && RE.sbaish.test(t)) banks.push('sba');
    return {
      howto: RE.howto.test(t),
      find: RE.find.test(t),
      calc: RE.calc.test(t),
      clinical: RE.clinical.test(t),
      banks,
      /* A bare phrase with no verb at all — "shoulder dystocia" — is a
         search, and the commonest thing anybody types. */
      bare: !RE.howto.test(t) && !RE.clinical.test(t) && String(q || '').trim().split(/\s+/).length <= 4
    };
  }

  /* ---------------- the help index, scored properly ----------------

     An example question matched as a phrase is worth five words, because
     it is five words of evidence about what they meant rather than one.
     The winner has to clear a bar AND beat the runner-up, so a question
     that fits two entries equally badly goes to the model rather than
     being answered by whichever happened to sort first. */
  function bestHelp(text) {
    const raw = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
    const terms = (typeof Search !== 'undefined') ? Search.terms(text) : raw.split(' ').filter(Boolean);
    const scored = HELP.map(entry => {
      let score = 0;
      (entry.ask || []).forEach(a => {
        const phrase = ' ' + a.toLowerCase() + ' ';
        if (raw.includes(phrase.trim())) score += 6;
        else {
          /* Most of an example question is still strong evidence — but
             only its MEANINGFUL words. Counting "how", "do" and "in"
             towards the similarity made every how-to question look like
             every other one: "how to do osce in aureum" scored as well
             against "how do i do osce in ai" as against "how to do osce",
             and was answered with the wrong feature. */
          const aw = (typeof Search !== 'undefined') ? Search.terms(a).filter(w => w.length > 2)
            : a.toLowerCase().split(/\s+/).filter(w => w.length > 2);
          const hit = aw.filter(w => raw.includes(' ' + w + ' ')).length;
          /* Two meaningful words at least. An example question whose
             only real word is "osce" is not evidence of anything — every
             OSCE entry has one — and treating it as a near-miss on the
             whole phrase is how "how to do osce in aureum" came back as
             the chat-model feature. */
          if (aw.length >= 2 && hit / aw.length >= 0.6) score += 3;
        }
      });
      const bag = entry.words.split(/\s+/);
      score += terms.filter(w => bag.includes(w)).length;
      /* The title is what the entry IS, so a word from it counts twice. */
      const title = entry.title.toLowerCase();
      score += terms.filter(w => title.includes(w)).length;
      return { entry, score };
    }).sort((a, b) => b.score - a.score);
    const top = scored[0], next = scored[1];
    if (!top || !top.score) return null;
    return { entry: top.entry, score: top.score, margin: top.score - (next?.score || 0) };
  }

  /* ================= retrieval =================

     Everything AUREUM holds that could be relevant, in one place, for
     every question — because it costs nothing (it is all in the browser
     already) and because the model answers far better with it than
     without. This is what makes the difference between a chatbot that
     talks about obstetrics and one that knows what is in YOUR bank. */

  const banks = { osce: null, essay: null, sba: null, cases: null };

  async function loadBank(kind) {
    if (banks[kind]) return banks[kind];
    try {
      if (kind === 'osce') {
        const list = await OSCE.stations();
        banks.osce = (list || []).map(s => ({
          kind: 'osce', id: s.id, topic: s.topic || '', scenario: s.scenario || '', deep: '',
          route: '#/osce/station/' + encodeURIComponent(s.id),
          meta: `${s.q_count || 0} questions · ${s.total_marks || 0} marks` }));
      } else if (kind === 'essay') {
        const papers = await Backend.getEssayPapers();
        const out = [];
        (papers || []).forEach(p => {
          const qs = [];
          (p.sections || []).forEach(sec => (sec.questions || []).forEach(q => qs.push(q)));
          (p.questions || []).forEach(q => qs.push(q));
          qs.forEach(q => out.push({
            kind: 'essay', id: q.code || p.id, topic: q.code || p.id,
            scenario: String(q.stem || '').slice(0, 220),
            deep: [(q.parts || []).map(x => `${x.label} ${x.text}`).join(' '), p.examTitle].join(' '),
            route: '#/library/essay/' + encodeURIComponent(p.id),
            meta: `${p.examTitle || 'Essay paper'} · ${q.type || 'SEQ'} · ${q.totalMarks || ''} marks` }));
        });
        banks.essay = out;
      } else if (kind === 'cases') {
        const list = await Backend.getCases();
        banks.cases = (list || []).map(c => ({
          kind: 'case', id: c.id, topic: c.topic || c.id, scenario: String(c.summary || c.scenario || '').slice(0, 200),
          deep: '', route: '#/cases/case/' + encodeURIComponent(c.id), meta: 'Case discussion' }));
      } else if (kind === 'sba') {
        /* The heaviest of the four — it pulls every paper's content — so
           it is loaded ONLY when somebody actually asks for questions,
           and never on the off-chance. */
        const rows = await Coverage.buildIndex();
        banks.sba = (rows || []).map(r => ({
          kind: 'sba', id: r.qkey, topic: r.tagTopic || r.category || 'Question',
          scenario: String(r.text || '').slice(0, 200), deep: r.text || '',
          route: '#/paper/' + encodeURIComponent(r.paperId),
          meta: `${r.kind} · ${r.category || ''}`.trim() }));
      }
    } catch { banks[kind] = banks[kind] || []; }
    return banks[kind] || [];
  }

  /**
   * The best few things AUREUM holds for this question. `want` names the
   * banks to look in; SBA is only ever included when it was asked for by
   * name, because loading it is the one expensive thing here.
   */
  async function retrieve(q, want) {
    if (typeof Search === 'undefined') return [];
    const kinds = want && want.length ? want : ['osce', 'essay', 'cases'];
    const pool = [];
    for (const k of kinds) pool.push(...await loadBank(k === 'case' ? 'cases' : k));
    if (!pool.length) return [];
    const res = Search.rank(pool, q, { showAll: false });
    return res.rows.slice(0, 8).map(r => Object.assign({}, r.rec, { score: r.score, where: r.where }));
  }

  /* ================= the router =================

     One pass, in confidence order. Anything it is not sure about goes to
     the model WITH what was retrieved, which is both the honest answer
     and the better one. */

  const HELP_BAR = 6, HELP_MARGIN = 2;
  /* The entry that answers "how do I do X" for each bank. */
  const CANON = { osce: 'circuit', essay: 'essay', sba: 'sba', case: 'circuit' };
  const RE_AIWAY = /\b(ai|chatgpt|gpt|claude|gemini|chat ?model|copilot|llm)\b/i;
  const RE_HELLO = /^\s*(hi|hey|hello|yo|good (morning|afternoon|evening)|thanks?|thank you|ok(ay)?|cheers|bye)\b/i;

  async function route(q) {
    const text = String(q || '').trim();
    if (!text) return null;
    const c = classify(text);

    /* 0. HELLO. Not worth a model, and a model's answer to it is worse
          than this one anyway: what somebody wants after "hi" is to know
          what they can ask for. */
    if (RE_HELLO.test(text) && text.length <= 30) {
      return { kind: 'hello', title: /thank/i.test(text) ? 'Any time' : 'Hello' };
    }

    /* 1. ARITHMETIC. Never a model — see calc.js. */
    const tool = (typeof Calc !== 'undefined') ? Calc.toolFor(text) : '';
    if (tool && c.calc) {
      const meta = Calc.TOOLS.find(t => t.id === tool);
      return { kind: 'calc', tool, title: meta.full,
        say: `That is arithmetic, so it is done here rather than asked of anything — exactly, instantly, and with the
              working shown.` };
    }

    /* 2. HOW DO I. Before the search, which was the bug: somebody asking
          how to do something wants to be shown where, not handed a list.
          Only a confident match answers; a vague one falls through. */
    const help = bestHelp(text);
    /* A confident match is not overruled by the clinical test. "What is
       due in recall today" contains "what is" and is not a clinical
       question at all; blocking on that sent it to a model to be told
       about a feature it has never seen. Confidence is the gate. */
    if (help && help.score >= HELP_BAR && help.margin >= HELP_MARGIN) {
      return { kind: 'help', entry: help.entry, title: help.entry.title };
    }

    /* 2b. NAMING A THING IS ASKING ABOUT THAT THING.

          "How do I do an OSCE in AUREUM" scores almost nothing against
          any single entry — it is four words, three of them stopwords —
          and yet what it wants could not be more obvious. So a how-to
          that names one of the banks gets that bank's own entry, unless
          something above already matched with confidence.

          OSCE has two: the ordinary way and against a chat model. The
          second is a specific way of doing it, so it only wins when that
          way is actually named. */
    if (c.howto && c.banks.length) {
      const id = c.banks[0] === 'osce'
        ? (RE_AIWAY.test(text) ? 'aiosce' : 'circuit')
        : CANON[c.banks[0]];
      const entry = HELP.find(h => h.id === id);
      if (entry) return { kind: 'help', entry, title: entry.title };
    }

    /* 3. FIND ME SOMETHING. An explicit request, or a bare topic phrase,
          and only when there is genuinely something to show. */
    if ((c.find || c.bare || c.banks.length) && !c.clinical) {
      const hits = await retrieve(text, c.banks);
      if (hits.length) return { kind: 'find', hits, title: titleFor(hits, c.banks) };
    }

    /* 4. A weaker how-to, now that nothing else has claimed it. */
    if (help && help.score >= 4 && c.howto) {
      return { kind: 'help', entry: help.entry, title: help.entry.title };
    }

    return null;                       // the model, with context
  }

  function titleFor(hits, banks) {
    const n = hits.length;
    const kinds = [...new Set(hits.map(h => h.kind))];
    const name = { osce: 'station', essay: 'essay question', sba: 'question', case: 'case' };
    if (kinds.length === 1) {
      const w = name[kinds[0]] || 'item';
      return `${n} ${w}${n === 1 ? '' : 's'} in the bank`;
    }
    return `${n} things in AUREUM`;
  }

  /* ================= the window ================= */

  let el = null, open = false, msgs = [], busy = false;

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
    /* The banks are warmed quietly while the window opens, so the first
       question is answered without a wait. The SBA index is deliberately
       NOT among them — it pulls every paper's content, and is loaded only
       when somebody actually asks for questions. */
    if (typeof OSCE !== 'undefined') { loadBank('osce'); loadBank('essay'); }
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

    let local = null;
    try { local = await route(q); } catch { local = null; }
    if (local) {
      msgs.pop();
      msgs.push(Object.assign({ who: 'it' }, local));
      busy = false; paint();
      return;
    }

    /* THE MODEL, WITH EVERYTHING WE FOUND IN FRONT OF IT.

       This is what separates an assistant that talks about obstetrics
       from one that knows what is in YOUR bank. The retrieval has
       already happened and cost nothing; handing it over means the
       answer can say "there is a station on this — here it is" instead
       of a paragraph of general advice. The same items are shown under
       the answer as sources, so nothing it refers to is unreachable. */
    let found = [];
    try { found = await retrieve(q, classify(q).banks); } catch {}
    try {
      const r = await askModel(q, found);
      msgs.pop();
      msgs.push({ who: 'it', kind: 'ai', text: r.text, cost: r.cost, model: r.model, free: r.free,
        hits: found.slice(0, 4) });
    } catch (e) {
      msgs.pop();
      /* A model that could not be reached is not the end of the answer:
         whatever was retrieved is still real, and still useful. */
      msgs.push({ who: 'it', kind: 'error', text: e?.message || String(e), hits: found.slice(0, 4) });
    }
    busy = false; paint();
  }

  /**
   * The last resort. Carries the same context the local routes had, so
   * the model is answering about THIS application with the real page
   * list in front of it rather than from an idea of what a study site
   * probably looks like.
   */
  async function askModel(q, found) {
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
        /* And what AUREUM actually holds on this subject. */
        found: (found || []).slice(0, 6).map(h => ({
          kind: h.kind, title: h.topic, about: String(h.scenario || '').slice(0, 160), route: h.route })),
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
    'How do I get my essay marked?',
    'Find me a postpartum haemorrhage station',
    'How many weeks on 12 June if her period was 1 January?',
    'Any SBA questions on pre-eclampsia?',
    'How can I do an OSCE against ChatGPT?'
  ];

  function paint() {
    const body = el?.querySelector('[data-as-body]');
    if (!body) return;
    if (!msgs.length) {
      body.innerHTML = `
        <div class="as-hello">
          <div class="as-hello-ico">${ICON}</div>
          <h4>Ask about AUREUM, the bank, or the arithmetic.</h4>
          <p class="muted tiny">Ask how to do something, ask for a station, an essay question or an SBA, or ask a
            clinical question. Most answers come from AUREUM itself — free, and true because they are read from what
            is actually here. The badge on every answer says which kind it was.</p>
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
    hello: ['✦', 'AUREUM · free', 'is-help'],
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
    if (m.kind === 'hello') {
      inner = `<p class="as-say">${esc(m.title === 'Any time' ? 'Any time.' : 'Hello.')} Ask me how to do something in
        AUREUM, ask for a station, an essay question or an SBA on a topic, or ask a clinical question and I will
        answer it with whatever AUREUM already holds on it.</p>
        <div class="as-openers">${OPENERS.slice(0, 3).map(o => `<button data-as-suggest="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
    } else if (m.kind === 'calc') {
      inner = `<p class="as-say">${esc(m.say)}</p><div class="as-calc" data-as-calc="${i}"></div>
        <a class="as-go" href="#/tools" data-as-close>Open all the calculators →</a>`;
    } else if (m.kind === 'help') {
      inner = `<h5 class="as-t">${esc(m.entry.title)}</h5><div class="as-rich">${m.entry.body}</div>
        <a class="as-go" href="${esc(m.entry.route)}" data-as-close>${esc(m.entry.go)} →</a>`;
    } else if (m.kind === 'find') {
      inner = `<h5 class="as-t">${esc(m.title)}</h5>${hitsHtml(m.hits)}`;
    } else if (m.kind === 'error') {
      inner = `<div class="as-rich">${rich(m.text)}</div>${
        (m.hits || []).length ? `<p class="as-srcs-h">What AUREUM holds on this:</p>${hitsHtml(m.hits)}` : ''}`;
    } else {
      inner = `<div class="as-rich">${rich(m.text)}</div>${
        (m.hits || []).length ? `<p class="as-srcs-h">In AUREUM:</p>${hitsHtml(m.hits)}` : ''}`;
    }
    return `<div class="as-msg is-it"><div class="as-b">${badge}${inner}</div></div>`;
  }

  /* WHAT WAS FOUND, LABELLED BY WHAT IT IS.

     A list of results that does not say whether a thing is a station, an
     essay question or an SBA is a list you have to open to understand.
     The tag is the first thing on the row for that reason. */
  const KIND = {
    osce:  ['OSCE', 'is-osce'],
    essay: ['ESSAY', 'is-essay'],
    sba:   ['SBA / EMQ', 'is-sba'],
    case:  ['CASE', 'is-case']
  };
  function hitsHtml(hits) {
    if (!(hits || []).length) return '';
    return `<div class="as-hits">${hits.map(h => {
      const [label, cls] = KIND[h.kind] || ['', ''];
      return `<a class="as-hit" href="${esc(h.route)}" data-as-close>
        <span class="as-hit-top">
          <span class="as-kind ${cls}">${esc(label)}</span>
          <strong>${esc(h.topic || h.id)}</strong>
        </span>
        ${h.scenario ? `<span>${esc(String(h.scenario).slice(0, 110))}</span>` : ''}
        ${h.meta ? `<em>${esc(h.meta)}</em>` : ''}
      </a>`;
    }).join('')}</div>`;
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

  function reset() {
    msgs = []; busy = false;
    banks.osce = banks.essay = banks.sba = banks.cases = null;
  }
  function unmount() { close(); el?.remove(); el = null; reset(); }

  return { ICON, HELP, route, bestHelp, show, close, toggle, askAbout, isOpen: () => open,
    onChange, unmount, reset, _paint: paint, _msgs: () => msgs };
})();
