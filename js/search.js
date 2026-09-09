/* ============================================================
   search.js — finding the right station, not merely a matching one.

   THE COMPLAINT THIS ANSWERS

   "Searching the OSCE topic is a bit difficult — it shows unrelated
   OSCEs also." Both halves of that are true, and they have the same
   single cause: the old search asked one question, "does this string
   appear anywhere in this station", and every station that could say yes
   was equally a result. So a station whose entire subject is postpartum
   haemorrhage came back in the same undifferentiated list as one that
   mentions PPH once in the fourth marking point of an unrelated scheme.
   Nothing was wrong; nothing was ranked either. A list where the right
   answer is fourteenth is a list that has failed.

   THREE THINGS FIX IT, IN ORDER OF HOW MUCH THEY MATTER

   1. WHERE it matched decides how much it counts. A word in the topic is
      what the station IS. A word in the scenario is what the station is
      about. A word buried in a marking point is a passing mention, and
      passing mentions are exactly the unrelated results being complained
      about. Same word, three very different claims — so topic scores
      many times what the scheme does.

   2. HOW it matched decides too. "sepsis" as a whole word is a match;
      "sepsis" inside "sepsist" would not be one, and "sep" as the start
      of a word is a weaker claim than either. Bare substring matching is
      what makes "para" find "comparative" and "pre" find "pregnancy",
      "prescribe" and "preterm" all at once.

   3. Doctors do not type what the bank wrote. They type PPH, PET, LSCS,
      CTG. They type "hemorrhage" as often as "haemorrhage", "fetal" as
      often as "foetal". A search that only finds the spelling the author
      happened to use is a search you learn to distrust and stop using.

   AND ONE THING THAT MATTERS AS MUCH AS RANKING

   Ranking alone still SHOWS the passing mentions, just further down.
   When a query has a clear winner, the tail is noise, and noise on a
   screen is not free — it is the thing being complained about. So a
   result far below the best result is dropped rather than ranked last.
   The count of what was dropped is shown, and one press brings it back:
   hiding something is only honest if you say you did it.

   WHY IT IS NOT A LIBRARY, AND NOT ON THE SERVER

   The bank is a few hundred stations and the cards are already in the
   browser. Scoring all of them takes under a millisecond, needs no
   index to keep in step with the data, no build step, and no request.
   A server-side search would be a query per keystroke — for a corpus
   that fits in a fraction of the memory this page already uses.
   ============================================================ */

const Search = (() => {

  /* ---------------- normalising ----------------

     Both sides of every comparison go through this, which is what makes
     the spelling differences disappear instead of having to be listed:

       haemorrhage → hemorrhage      oestrogen → estrogen
       foetal      → fetal           labour    → labor
       anaemia     → anemia          caesarean → cesarean

     `ae`/`oe` → `e` and `our` → `or` covers essentially all of British
     versus American medical spelling in one rule each. Doing it by a
     dictionary would mean a dictionary that is always one word short. */
  function norm(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // é → e
      .replace(/æ/g, 'ae').replace(/œ/g, 'oe')
      .replace(/\bcaesar/g, 'cesar')
      .replace(/ae/g, 'e').replace(/oe/g, 'e')
      .replace(/our\b/g, 'or')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /* A crude singular. Enough for "sections"/"section" and
     "haemorrhages"/"haemorrhage"; deliberately not a stemmer, because a
     stemmer would also collapse words a clinician means to distinguish. */
  const stem = w => (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) ? w.slice(0, -1) : w;

  const words = s => norm(s).split(' ').filter(Boolean).map(stem);

  /* ---------------- what doctors actually type ----------------

     Each line is a set of things that mean the same. Typing any member
     finds every member — in both directions, so "PPH" finds a station
     called "Postpartum haemorrhage" and "postpartum haemorrhage" finds
     one called "PPH". Everything here is already normalised by the rules
     above, so these are written in the normalised spelling.

     This list is meant to be added to. It costs one line per pair of
     words that a candidate and an author might not spell the same. */
  const GROUPS = [
    ['pph', 'postpartum hemorrhage', 'post partum hemorrhage'],
    ['aph', 'antepartum hemorrhage', 'ante partum hemorrhage'],
    ['pet', 'pre eclampsia', 'preeclampsia', 'pre eclamptic toxemia'],
    ['eclampsia', 'fitting'],
    ['hellp', 'hellp syndrome'],
    ['gdm', 'gestational diabetes'],
    ['dm', 'diabetes', 'diabetes mellitus'],
    ['iugr', 'fgr', 'growth restriction', 'small for gestational age', 'sga'],
    ['prom', 'rupture of membranes'],
    ['pprom', 'preterm rupture of membranes', 'preterm prelabor rupture'],
    ['lscs', 'cesarean', 'cesarean section', 'c section', 'caesar'],
    ['vbac', 'vaginal birth after cesarean'],
    ['ctg', 'cardiotocograph', 'cardiotocography', 'fetal heart trace'],
    ['ecv', 'external cephalic version'],
    ['iol', 'induction of labor', 'induction'],
    ['pcos', 'polycystic ovary', 'polycystic ovarian'],
    ['pid', 'pelvic inflammatory disease'],
    ['dub', 'aub', 'abnormal uterine bleeding', 'dysfunctional uterine bleeding'],
    ['hmb', 'heavy menstrual bleeding', 'menorrhagia'],
    ['mtp', 'termination of pregnancy', 'top', 'abortion'],
    ['erpc', 'evacuation of retained products'],
    ['iui', 'intrauterine insemination'],
    ['ivf', 'in vitro fertilization'],
    ['lng ius', 'mirena', 'levonorgestrel intrauterine system', 'ius'],
    ['ocp', 'combined oral contraceptive', 'coc', 'oral contraceptive'],
    ['hrt', 'mht', 'hormone replacement', 'menopausal hormone therapy'],
    ['dvt', 'vte', 'deep vein thrombosis', 'venous thromboembolism'],
    ['pe', 'pulmonary embolism'],
    ['uti', 'urinary tract infection'],
    ['sui', 'stress urinary incontinence', 'stress incontinence'],
    ['pop', 'pelvic organ prolapse', 'prolapse'],
    ['usg', 'uss', 'ultrasound', 'scan'],
    ['edd', 'expected date of delivery'],
    ['ppd', 'postnatal depression', 'postpartum depression'],
    ['shoulder dystocia', 'dystocia'],
    ['ohss', 'ovarian hyperstimulation'],
    ['obstetric cholestasis', 'icp', 'intrahepatic cholestasis'],
    ['ncd', 'neural tube defect', 'ntd'],
    ['anc', 'antenatal care', 'antenatal clinic'],
    ['pgim', 'md og', 'md obstetrics']
  ].map(g => g.map(x => words(x).join(' ')));

  /* term → every phrase that means the same, including itself. Built
     once. A multi-word member is indexed under its whole normalised
     phrase, so looking one up is a plain map read. */
  const SYN = (() => {
    const m = new Map();
    GROUPS.forEach(g => g.forEach(k => {
      const have = m.get(k) || new Set([k]);
      g.forEach(x => have.add(x));
      m.set(k, have);
    }));
    return m;
  })();

  /* ---------------- one field, one term ----------------

     Returns how strong the claim is, 0 when there is none. A whole word
     is the real thing; a prefix is a plausible half-typed word; a
     substring is a last resort and is not offered at all for short
     terms, because that is precisely where "para" finds "comparative". */
  const WHOLE = 1, PREFIX = 0.55, INSIDE = 0.25;

  function strength(fieldWords, fieldText, term) {
    if (!term) return 0;
    /* A multi-word synonym ("postpartum hemorrhage" for "pph") can only
       be looked for as a phrase. */
    if (term.includes(' ')) return fieldText.includes(term) ? WHOLE : 0;
    let best = 0;
    for (let i = 0; i < fieldWords.length; i++) {
      const w = fieldWords[i];
      if (w === term) return WHOLE;
      if (w.length > term.length && w.startsWith(term) && term.length >= 3) best = Math.max(best, PREFIX);
      else if (term.length >= 5 && w.includes(term)) best = Math.max(best, INSIDE);
    }
    return best;
  }

  /** The best any of a term's synonyms can claim about this field. */
  function claim(field, term) {
    const alts = SYN.get(term);
    let best = strength(field.words, field.text, term);
    if (alts) for (const a of alts) {
      if (a === term) continue;
      best = Math.max(best, strength(field.words, field.text, a));
      if (best === WHOLE) break;
    }
    return best;
  }

  const field = s => { const t = norm(s); return { text: t, words: t.split(' ').filter(Boolean).map(stem) }; };

  /* ---------------- the weights ----------------

     The whole argument of this module, in four numbers. A word in the
     topic is worth six of the same word in a marking point, because the
     topic says what the station IS and a marking point says only that
     the words were in the room. */
  const W = { topic: 12, scenario: 4, prompt: 2.5, scheme: 2 };

  /**
   * Score one record against a parsed query.
   *
   * `rec` is { topic, scenario, deep } — `deep` being whatever blob of
   * prompts and marking points the caller has, which may be empty until
   * the deep index has been fetched. Missing fields simply score zero;
   * nothing here requires the caller to have everything.
   *
   * Returns { score, hit, where } — `where` being the strongest field
   * that matched, so the list can say WHY a station is in it.
   */
  function score(rec, q) {
    if (!q.terms.length) return { score: 0, hit: true, where: '' };
    const topic = rec._f_topic || (rec._f_topic = field(rec.topic));
    const scen = rec._f_scen || (rec._f_scen = field(rec.scenario));
    const deep = rec._f_deep || (rec._f_deep = field(rec.deep));

    let total = 0, matched = 0, allInTopic = true, where = '', bestField = 0;
    for (const term of q.terms) {
      const t = claim(topic, term);
      const s = claim(scen, term);
      const d = claim(deep, term);
      const best = Math.max(t * W.topic, s * W.scenario, d * W.scheme);
      if (best <= 0) { allInTopic = false; continue; }
      matched++;
      total += best;
      if (!t) allInTopic = false;
      const src = (t * W.topic >= s * W.scenario && t * W.topic >= d * W.scheme) ? 'topic'
        : (s * W.scenario >= d * W.scheme) ? 'scenario' : 'scheme';
      const rank = src === 'topic' ? 3 : src === 'scenario' ? 2 : 1;
      if (rank > bestField) { bestField = rank; where = src; }
    }

    if (!matched) return { score: 0, hit: false, where: '' };

    /* THE BONUSES ARE WHAT PUT THE OBVIOUS ANSWER FIRST.

       Three words of a query scattered across three different marking
       points is a much weaker claim than the same three words together
       in the title, and a plain sum cannot tell those apart. */
    if (q.phrase && topic.text.includes(q.phrase)) total += 25;      // the query, verbatim, in the title
    else if (q.phrase && scen.text.includes(q.phrase)) total += 6;
    if (allInTopic && q.terms.length > 1) total += 10;               // every word of it, in the title
    if (topic.text === q.phrase) total += 40;                        // it IS this station

    /* A short title that is mostly the query beats a long one that
       merely contains it — "Sepsis" over "Sepsis, DKA and the collapsed
       postnatal woman" when the query is "sepsis". */
    if (topic.words.length) total += Math.min(6, (q.terms.length / topic.words.length) * 6);

    return { score: total, hit: matched === q.terms.length, matched, where };
  }

  /** Parse once per keystroke, not once per station. */
  function parse(raw) {
    const terms = words(raw);
    return { raw: String(raw || ''), terms, phrase: terms.join(' ') };
  }

  /* ---------------- the cut ----------------

     Everything scoring below a fraction of the best is not a worse
     answer, it is a different subject that happens to share a word. The
     fraction is deliberately generous — a genuine near-miss survives —
     and the cut only applies when there is a clear leader to measure
     against, so a vague query that matches everything weakly still shows
     everything. */
  const FLOOR = 0.14;
  const STRONG = W.topic * 0.5;      // below this nothing is confident enough to cut by

  /**
   * Rank a list of records. Returns
   *   { rows, cut, loose }
   * `rows` newest-relevance-first, `cut` how many were dropped as noise,
   * `loose` true when nothing matched every word and this fell back to
   * matching some of them.
   */
  function rank(recs, raw, opts) {
    const q = parse(raw);
    if (!q.terms.length) return { rows: (recs || []).map(r => ({ rec: r, score: 0, where: '' })), cut: 0, loose: false, q };

    const all = (recs || []).map(r => Object.assign({ rec: r }, score(r, q))).filter(x => x.score > 0);
    let kept = all.filter(x => x.hit);
    let loose = false;
    /* NOTHING MATCHING EVERY WORD IS NOT NOTHING.
       "postpartum haemorrhage management" finds no station containing all
       three; a blank page is a worse answer than the PPH station. */
    if (!kept.length && all.length) { kept = all; loose = true; }

    kept.sort((a, b) => b.score - a.score || String(a.rec.topic || '').localeCompare(String(b.rec.topic || '')));

    let cut = 0;
    if (kept.length > 1) {
      /* TWO DIFFERENT CUTS, AND THE FIRST IS THE ONE THAT MATTERS.

         A ratio can only say "much less relevant". The real distinction
         is of KIND: if any station is actually ABOUT what was typed —
         the words are in its title — then a station that merely mentions
         those words somewhere in its marking scheme is not a weaker
         answer to the same question, it is an answer to a different one.
         That is precisely the "unrelated OSCEs" being complained about,
         and no amount of ranking removes it, because it is not at the
         bottom of the list by accident: it belongs off it.

         When NOTHING matches by title, the scheme mentions are all there
         is and every one of them is shown. */
      const anyTitle = kept.some(x => x.where === 'topic');
      let keepFn = anyTitle ? (x => x.where !== 'scheme') : (() => true);
      let n = kept.filter(keepFn);
      /* And then the ordinary floor, for a tail that survived the first
         cut but is still far below the leader. */
      if (n.length > 1 && n[0].score >= STRONG) {
        const floor = n[0].score * FLOOR;
        n = n.filter(x => x.score >= floor);
      }
      cut = kept.length - n.length;
      /* The count is reported whether or not the cut is applied, so the
         control that reverses it can still say how many it is about —
         "Hide 6 weaker matches" has to know there are six while they are
         on screen. */
      if (!opts?.showAll) kept = n;
    }
    return { rows: kept, cut, loose, q };
  }

  /** A record's fields are cached on it; call this if the text changes. */
  const bust = rec => { delete rec._f_topic; delete rec._f_scen; delete rec._f_deep; };

  return { norm, words, stem, parse, score, rank, bust, W, GROUPS, SYN, _strength: strength, _claim: claim, _field: field };
})();
