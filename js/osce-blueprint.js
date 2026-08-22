/* ============================================================
   osce-blueprint.js — the OSCE exam blueprint, and what it is for.

   The PGIM MD Part II OSCE is nine stations. The blueprint lists
   thirteen modules and far more topics than nine, and that is the
   point: any nine of them could turn up on the day. The blueprint is
   therefore not a syllabus to finish — it is a SAMPLING FRAME, and
   everything here follows from that.

   Four jobs:

     1. HOLD the blueprint. Shipped as the default below, editable by
        the developer, stored in app_config so an edit reaches every
        device without a release.

     2. TAG each station to a module + topic. Deterministically first —
        the syllabus map gives explicit synonyms, and a rule that can be
        read is a rule that can be corrected. AI is asked only about the
        stations the rules could not place, and never overrides a tag a
        human has set.

     3. BALANCE a circuit. Nine stations should span nine modules; a
        circuit of four should span four the candidate has seen least,
        so four today plus four tomorrow covers eight rather than the
        same four twice.

     4. MEASURE coverage — which modules have been sat, how well, and
        which have never been touched.

   A topic with no station is normal and is not an error: not every
   topic on the blueprint can be examined as an OSCE. The coverage map
   says so out loud rather than showing a permanent gap.
   ============================================================ */

const OsceBlueprint = (() => {

  /* ---------------- the shipped blueprint ----------------
     Transcribed from the examination blueprint document. `syn` are the
     extra words a station might use for the same thing; they exist so
     the matcher can be deterministic. Editing happens in Developer →
     OSCE stations → Blueprint, which overrides all of this. */
  const DEFAULT = [
    { id: 'hands', name: 'Hands on', topics: [
      { id: 'instruments', name: 'Instruments (vacuum / forceps / rotational forceps)',
        syn: ['ventouse', 'kiwi', 'keillands', 'kielland', 'operative vaginal delivery', 'assisted vaginal delivery', 'forceps', 'vacuum'] },
      { id: 'iliac', name: 'Internal iliac artery ligation', syn: ['iliac artery ligation', 'internal iliac'] },
      { id: 'bakri', name: 'Bakri balloon', syn: ['balloon tamponade', 'uterine balloon', 'bakri'] },
      { id: 'iucd-insert', name: 'IUCD insertion', syn: ['coil insertion', 'iud insertion', 'intrauterine device insertion'] }
    ] },
    { id: 'matmed', name: 'Maternal Medicine', topics: [
      { id: 'hiv', name: 'HIV in pregnancy', syn: ['hiv', 'antiretroviral', 'art in pregnancy'] },
      { id: 'liver', name: 'Liver disease (AFLP / HELLP)', syn: ['acute fatty liver', 'aflp', 'hellp', 'obstetric cholestasis', 'cholestasis', 'jaundice in pregnancy'] },
      { id: 'thrombocytopenia', name: 'Thrombocytopenia', syn: ['low platelets', 'itp', 'platelet'] },
      { id: 'breastca', name: 'Breast cancer in pregnancy', syn: ['breast ca', 'breast carcinoma', 'breast lump'] },
      { id: 'dm', name: 'Diabetes in pregnancy', syn: ['gdm', 'gestational diabetes', 'diabetes', 'insulin'] },
      { id: 'thyroid', name: 'Thyroid disorders', syn: ['hypothyroid', 'hyperthyroid', 'graves', 'thyrotoxicosis', 'thyroid'] },
      { id: 'headache', name: 'Headache', syn: ['migraine', 'headache'] },
      { id: 'cardiac', name: 'Cardiac disease', syn: ['heart disease', 'valvular', 'mitral', 'aortic', 'cardiomyopathy', 'marfan', 'congenital heart'] },
      { id: 'infection', name: 'Other infection (CMV, chickenpox, STI)',
        syn: ['cmv', 'cytomegalovirus', 'chickenpox', 'varicella', 'rubella', 'hepatitis', 'syphilis', 'toxoplasm', 'parvovirus', 'group b strep', 'gbs'] },
      { id: 'epilepsy', name: 'Epilepsy and neurology', syn: ['epilepsy', 'seizure', 'anticonvulsant', 'valproate', 'levetiracetam', 'lamotrigine'] },
      { id: 'vte', name: 'VTE and thrombophilia', syn: ['thromboembolism', 'dvt', 'pulmonary embolism', 'thromboprophylaxis', 'lmwh', 'apls', 'antiphospholipid'] },
      /* The findings, not only the name. A scenario reading "168/112 with
         proteinuria and a headache" is pre-eclampsia, but the only word on
         it that matched anything was "headache" — and it filed the station
         under Headache. Naming the signs is what stops that. */
      { id: 'htn', name: 'Hypertension in pregnancy',
        syn: ['pre-eclampsia', 'preeclampsia', 'pre eclampsia', 'eclampsia', 'pih', 'gestational hypertension',
          'hypertension', 'proteinuria', 'blood pressure', 'labetalol', 'nifedipine', 'magnesium sulphate', 'mgso4',
          'antihypertensive', 'severe hypertension'] },
      { id: 'renal', name: 'Renal disease', syn: ['renal', 'pyelonephritis', 'uti', 'nephropathy'] },
      { id: 'asthma', name: 'Respiratory disease', syn: ['asthma', 'respiratory', 'pneumonia', 'tuberculosis'] },
      { id: 'mental', name: 'Perinatal mental health', syn: ['mental health', 'depression', 'psychosis', 'puerperal psychosis', 'postnatal depression'] },
      { id: 'anaemia-mm', name: 'Haematology (anaemia, haemoglobinopathy)', syn: ['sickle', 'thalassaem', 'haemophilia', 'von willebrand', 'transfusion'] }
    ] },
    { id: 'antenatal', name: 'Antenatal', topics: [
      { id: 'ptl', name: 'Preterm labour', syn: ['preterm labour', 'preterm birth', 'ptl', 'tocolysis', 'cervical cerclage', 'pprom', 'prom'] },
      { id: 'iufd', name: 'Intrauterine death', syn: ['iud', 'iufd', 'stillbirth', 'intrauterine death', 'fetal demise'] },
      { id: 'anc', name: 'Routine antenatal care', syn: ['booking visit', 'antenatal care', 'preconception', 'pre-conception', 'pre conception counselling'] },
      { id: 'rhesus', name: 'Rhesus and alloimmunisation', syn: ['anti-d', 'anti d', 'rhesus', 'rh negative', 'kell', 'alloimmun'] }
    ] },
    { id: 'early', name: 'Early Pregnancy', topics: [
      { id: 'hyperemesis', name: 'Hyperemesis', syn: ['hyperemesis', 'nvp', 'vomiting in pregnancy', 'morning sickness'] },
      { id: 'rpl', name: 'Recurrent pregnancy loss', syn: ['recurrent miscarriage', 'rpl', 'habitual abortion', 'miscarriage'] },
      { id: 'ectopic', name: 'Ectopic pregnancy', syn: ['ectopic', 'tubal pregnancy', 'methotrexate'] },
      { id: 'gtd', name: 'Gestational trophoblastic disease', syn: ['molar pregnancy', 'hydatidiform', 'gtd'] }
    ] },
    { id: 'fetal', name: 'Fetal Medicine', topics: [
      { id: 'prenatal', name: 'Prenatal diagnosis', syn: ['prenatal diagnosis', 'amniocentesis', 'cvs', 'chorionic villus', 'nipt', 'screening test', 'down syndrome', 'nuchal'] },
      { id: 'fgr', name: 'FGR', syn: ['fgr', 'iugr', 'growth restriction', 'small for gestational age', 'sga', 'doppler'] },
      { id: 'hydrops', name: 'Fetal hydrops', syn: ['hydrops', 'fetal anaemia', 'mca doppler'] },
      { id: 'twins', name: 'Twins and MCDA', syn: ['twin', 'multiple pregnancy', 'ttts', 'mcda', 'dcda', 'monochorionic'] },
      { id: 'anomaly', name: 'Fetal anomalies and ultrasound', syn: ['anomaly scan', 'fetal anomaly', 'ultrasound', 'scan finding', 'ventriculomegaly', 'spina bifida'] },
      { id: 'rfm', name: 'Reduced fetal movements and surveillance', syn: ['reduced fetal movement', 'fetal movement', 'ctg', 'cardiotocograph', 'fetal surveillance', 'biophysical'] }
    ] },
    { id: 'intrapartum', name: 'Intrapartum / Obstetric Emergencies', topics: [
      { id: 'shoulder', name: 'Shoulder dystocia', syn: ['shoulder dystocia', 'mcroberts'] },
      { id: 'collapse', name: 'Maternal collapse', syn: ['maternal collapse', 'cardiac arrest', 'amniotic fluid embolism', 'perimortem'] },
      { id: 'sepsis', name: 'Sepsis', syn: ['sepsis', 'septic shock', 'chorioamnionitis'] },
      { id: 'rpoc', name: 'RPOC / retained placenta', syn: ['retained placenta', 'rpoc', 'retained products', 'manual removal'] },
      { id: 'cs', name: 'Difficult / second stage caesarean', syn: ['caesarean', 'lscs', 'c-section', 'second stage cs', 'classical caesarean'] },
      { id: 'labour', name: 'Mechanism of labour', syn: ['mechanism of labour', 'partogram', 'dysfunctional labour', 'induction of labour', 'augmentation', 'malposition', 'malpresentation'] },
      { id: 'twin2', name: 'Second twin delivery', syn: ['second twin', 'internal podalic'] },
      { id: 'breech', name: 'Breech', syn: ['breech', 'ecv', 'external cephalic version'] },
      { id: 'pph', name: 'PPH', syn: ['postpartum haemorrhage', 'pph', 'atonic uterus', 'uterine atony'] },
      { id: 'aph', name: 'APH and placental problems', syn: ['antepartum haemorrhage', 'aph', 'abruption', 'placenta praevia', 'praevia', 'accreta', 'vasa praevia'] },
      { id: 'tears', name: 'Perineal trauma', syn: ['perineal tear', 'obasi', 'oasis', 'episiotomy', 'sphincter injury'] },
      { id: 'rupture', name: 'Uterine rupture and inversion', syn: ['uterine rupture', 'uterine inversion', 'cord prolapse'] }
    ] },
    { id: 'benign', name: 'Benign Gynaecology', topics: [
      { id: 'pms', name: 'PMS', syn: ['premenstrual', 'pms'] },
      { id: 'fibroid', name: 'Fibroid', syn: ['fibroid', 'leiomyoma', 'myomectomy', 'uterine artery embolisation'] },
      { id: 'aub', name: 'Abnormal uterine bleeding', syn: ['abnormal uterine bleeding', 'aub', 'heavy menstrual bleeding', 'hmb', 'menorrhagia', 'adenomyosis', 'polyp'] },
      { id: 'sti', name: 'STI and vaginal discharge', syn: ['vaginal discharge', 'candidiasis', 'bacterial vaginosis', 'trichomonas', 'chlamydia', 'gonorrh', 'pid', 'pelvic inflammatory'] },
      { id: 'menopause', name: 'Menopause and HRT', syn: ['menopause', 'hrt', 'premature ovarian', 'osteoporosis'] },
      { id: 'prolapse', name: 'Prolapse and urogynaecology', syn: ['prolapse', 'pop-q', 'incontinence', 'overactive bladder', 'urodynamic', 'fistula'] }
    ] },
    { id: 'onco', name: 'Gynaecological Oncology', topics: [
      { id: 'gtn', name: 'GTN / choriocarcinoma', syn: ['gtn', 'choriocarcinoma', 'trophoblastic neoplasia'] },
      { id: 'cervical', name: 'Cervical cancer', syn: ['cervical cancer', 'cervical carcinoma', 'cin', 'cervical intraepithelial', 'smear'] },
      { id: 'ovarian', name: 'Ovarian cancer', syn: ['ovarian cancer', 'ovarian carcinoma', 'ovarian cyst', 'adnexal mass', 'ca125', 'rmi'] },
      { id: 'endometrial', name: 'Endometrial cancer', syn: ['endometrial cancer', 'endometrial carcinoma', 'endometrial hyperplasia', 'postmenopausal bleeding'] },
      { id: 'vulval', name: 'Vulval cancer', syn: ['vulval cancer', 'vin', 'vulval carcinoma', 'lichen sclerosus'] },
      { id: 'colposcopy', name: 'Colposcopy', syn: ['colposcopy', 'lletz', 'cone biopsy'] }
    ] },
    { id: 'subfertility', name: 'Subfertility', topics: [
      { id: 'ohss', name: 'OHSS', syn: ['ohss', 'hyperstimulation'] },
      { id: 'endometriosis', name: 'Endometriosis', syn: ['endometriosis', 'chronic pelvic pain', 'dysmenorrhoea'] },
      { id: 'pcos', name: 'PCOS', syn: ['pcos', 'polycystic', 'ovulation induction', 'clomifene', 'letrozole'] },
      { id: 'art', name: 'Subfertility and ART', syn: ['infertility', 'subfertility', 'ivf', 'icsi', 'semen analysis', 'fertility preservation'] }
    ] },
    { id: 'surgical', name: 'Core Surgical Skills', topics: [
      { id: 'hysteroscopy', name: 'Hysteroscopy', syn: ['hysteroscopy', 'hysteroscopic'] },
      { id: 'laparoscopy', name: 'Laparoscopy', syn: ['laparoscopy', 'laparoscopic', 'entry technique', 'veress'] },
      { id: 'electro', name: 'Electrosurgery', syn: ['electrosurgery', 'diathermy', 'monopolar', 'bipolar'] },
      { id: 'periop', name: 'Perioperative care', syn: ['postoperative', 'enhanced recovery', 'consent for surgery', 'wound', 'venous thromboprophylaxis'] }
    ] },
    { id: 'sexual', name: 'Sexual Health (contraception / infections)', topics: [
      { id: 'iucd', name: 'IUCD / Mirena', syn: ['mirena', 'lng-ius', 'ius', 'copper coil', 'iucd', 'intrauterine system'] },
      { id: 'ec', name: 'Emergency contraception', syn: ['emergency contraception', 'ulipristal', 'levonorgestrel', 'morning after'] },
      { id: 'missedpill', name: 'Missed pill', syn: ['missed pill', 'ocp', 'combined pill', 'progestogen only', 'pop'] },
      { id: 'difficult-removal', name: 'Difficult removal', syn: ['difficult removal', 'lost threads', 'implant removal', 'nexplanon'] },
      { id: 'sterilisation', name: 'Sterilisation and UKMEC', syn: ['sterilisation', 'vasectomy', 'ukmec', 'tubal occlusion'] }
    ] },
    { id: 'nonclinical', name: 'Non-clinical Skills', topics: [
      { id: 'appraisal', name: 'Critical appraisal', syn: ['critical appraisal', 'journal', 'randomised controlled trial', 'forest plot', 'statistics', 'p value', 'confidence interval'] },
      { id: 'guideline', name: 'Guideline development', syn: ['guideline development', 'guideline', 'evidence level', 'grade of recommendation'] },
      { id: 'prioritisation', name: 'Labour ward / surgical list prioritisation', syn: ['prioritisation', 'prioritization', 'labour ward', 'triage', 'theatre list', 'surgical list'] },
      { id: 'governance', name: 'Clinical governance, audit and risk', syn: ['audit', 'risk management', 'clinical governance', 'incident', 'serious untoward', 'root cause', 'maternity dashboard'] },
      { id: 'consent', name: 'Consent and ethics', syn: ['valid consent', 'consent', 'capacity', 'confidentiality', 'domestic violence', 'fgm', 'sexual assault'] }
    ] },
    { id: 'counselling', name: 'Counselling', topics: [
      { id: 'c-iud', name: 'Counselling after intrauterine death', syn: ['bereavement', 'breaking bad news', 'counselling after'] },
      { id: 'c-hyperplasia', name: 'Endometrial hyperplasia / cancer with fertility wishes', syn: ['fertility sparing', 'fertility wishes', 'hyperplasia counselling'] },
      { id: 'c-endometriosis', name: 'Subfertility and endometriosis counselling', syn: ['endometriosis counselling'] },
      { id: 'c-perforation', name: 'Uterine perforation', syn: ['uterine perforation', 'perforation', 'complication disclosure', 'duty of candour'] }
    ] }
  ];

  /* Collections that are NOT the common bank. The common bank is the 197
     stations written in one pass; the others were curated, so a circuit
     prefers them and falls back only when a module has nothing else. */
  const COMMON = 'common';

  /* ---------------- storage ---------------- */

  let cached = null;
  /** The blueprint in force: the developer's edit, or the shipped default. */
  async function get(force) {
    if (cached && !force) return cached;
    let saved = null;
    try { saved = await Backend.getOsceBlueprint(); } catch { saved = null; }
    cached = (saved && Array.isArray(saved.modules) && saved.modules.length) ? saved.modules : clone(DEFAULT);
    return cached;
  }
  async function save(modules) {
    cached = modules;
    return Backend.saveOsceBlueprint({ modules, updated: Date.now() });
  }
  function bust() { cached = null; }
  const clone = x => JSON.parse(JSON.stringify(x));
  const shipped = () => clone(DEFAULT);

  /* ---------------- matching ----------------
     One normalised haystack per station (topic + scenario + every question
     prompt), and a score per topic. A synonym is worth more than the topic's
     own words because synonyms were written FOR this job; the module name
     itself is worth least, since "Antenatal" appears in half the bank. */

  const norm = s => String(s || '').toLowerCase()
    .replace(/[‐-―]/g, '-').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

  function hayOf(st) {
    const qs = st.questions || [];
    return norm([st.topic, st.topic, st.topic,            // the title counts thrice: it is the strongest signal
      st.scenario, ...qs.map(q => q.prompt)].join(' '));
  }

  /** Does `needle` appear as a whole phrase in the normalised haystack? */
  function hasPhrase(hay, needle) {
    const n = norm(needle);
    if (!n) return false;
    return (' ' + hay + ' ').includes(' ' + n + ' ');
  }

  /**
   * Score every topic against one station and return the best few.
   * Returns [{ module, topic, score, why }] sorted best first.
   */
  function rank(st, modules) {
    const hay = hayOf(st);
    const title = norm(st.topic || '');
    const out = [];
    for (const m of modules) {
      for (const t of m.topics || []) {
        let score = 0; const why = [];
        for (const s of (t.syn || [])) {
          if (hasPhrase(title, s)) { score += 10; why.push(s); }
          else if (hasPhrase(hay, s)) { score += 4; why.push(s); }
        }
        if (hasPhrase(title, t.name)) { score += 8; why.push(t.name); }
        else if (hasPhrase(hay, t.name)) { score += 3; why.push(t.name); }
        // the module's own name is weak evidence, and only from the title
        if (hasPhrase(title, m.name)) score += 1;
        if (score > 0) out.push({ module: m.id, topic: t.id, score, why: [...new Set(why)].slice(0, 4) });
      }
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /* A match is trusted when it is both strong ENOUGH and clearly ahead of
     the runner-up. Two topics scoring 10 and 9 is a coin toss, and a coin
     toss belongs in the "needs a look" pile, not in the blueprint. */
  const CONFIDENT = 10;
  function suggest(st, modules) {
    const r = rank(st, modules);
    if (!r.length) return { tag: null, ranked: r, confident: false };
    const top = r[0], next = r[1];
    const clear = !next || top.score - next.score >= 4;
    return { tag: { module: top.module, topic: top.topic }, ranked: r.slice(0, 5),
      confident: top.score >= CONFIDENT && clear, why: top.why };
  }

  /* ---------------- reading a tag off a station ---------------- */

  /** `meta.bp` is { module, topic, by: 'rule'|'ai'|'hand', at }. */
  const tagOf = st => (st && st.bp && st.bp.module) ? st.bp : null;
  const isCommon = st => String(st?.collection || COMMON) === COMMON;

  function moduleName(modules, id) { return (modules.find(m => m.id === id) || {}).name || id || 'Untagged'; }
  function topicName(modules, mid, tid) {
    const m = modules.find(x => x.id === mid);
    return ((m?.topics || []).find(t => t.id === tid) || {}).name || tid || '';
  }

  /* ---------------- choosing a circuit ----------------
     The exam samples nine modules, so a circuit does too. Modules the
     candidate has sat least come first, which is what makes four stations
     today and four tomorrow cover eight modules rather than the same four.
     Within a module the curated banks win; the common bank is the reserve.

     History is per module, counted from attempts already stored — no new
     bookkeeping, and it survives a cleared browser. */

  function shuffle(a) {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    return b;
  }

  /**
   * @param {Array}  stations  station cards (need id, topic, collection, bp)
   * @param {Object} history   { [moduleId]: timesSat }
   * @param {number} want      how many stations
   * @param {Object} opts      { avoid:Set of station ids to prefer not to repeat }
   * @returns {Array} chosen station cards, one per module wherever possible
   */
  function buildCircuit(stations, history, want, opts = {}) {
    const avoid = opts.avoid || new Set();
    const byModule = new Map();
    for (const st of stations) {
      const t = tagOf(st);
      if (!t) continue;                        // untagged stations never enter a blueprint circuit
      if (!byModule.has(t.module)) byModule.set(t.module, []);
      byModule.get(t.module).push(st);
    }
    /* Least-sat first, ties broken at random so two circuits in a row are
       not identical. A module with no station at all simply is not here. */
    const order = shuffle([...byModule.keys()])
      .sort((a, b) => (history[a] || 0) - (history[b] || 0));

    const chosen = [];
    const pickFrom = list => {
      const fresh = list.filter(s => !avoid.has(s.id));
      const pool = fresh.length ? fresh : list;
      const curated = pool.filter(s => !isCommon(s));
      const from = curated.length ? curated : pool;     // curated first, common as reserve
      return shuffle(from)[0];
    };
    // one per module, in least-sat order
    for (const mod of order) {
      if (chosen.length >= want) break;
      const st = pickFrom(byModule.get(mod));
      if (st) chosen.push(st);
    }
    /* Still short — more modules were wanted than exist with stations. Go
       round again, allowing a second station from a module rather than
       returning a circuit shorter than asked for. */
    if (chosen.length < want) {
      const taken = new Set(chosen.map(s => s.id));
      for (const mod of order) {
        if (chosen.length >= want) break;
        const rest = byModule.get(mod).filter(s => !taken.has(s.id));
        if (!rest.length) continue;
        const st = pickFrom(rest);
        if (st) { chosen.push(st); taken.add(st.id); }
      }
    }
    return shuffle(chosen).slice(0, want);
  }

  /** How many times each module has been sat, from stored attempts. */
  function historyOf(attempts, byId) {
    const h = {};
    for (const a of attempts || []) {
      const st = byId[a.station_id];
      const t = tagOf(st) || a.bp;
      if (t?.module) h[t.module] = (h[t.module] || 0) + 1;
    }
    return h;
  }

  /* ---------------- coverage ----------------
     Same arithmetic as the SBA maps, and for the same reason: a MODULE's
     percentage is the mean of its topics, not the pooled station count, so
     one heavily-stationed topic cannot paint a module green while its
     neighbours have never been touched. */

  function coverage(modules, stations, attempts) {
    const byId = {}; stations.forEach(s => byId[s.id] = s);
    // stations available per topic
    const avail = new Map();
    for (const st of stations) {
      const t = tagOf(st); if (!t) continue;
      const k = t.module + '/' + t.topic;
      if (!avail.has(k)) avail.set(k, []);
      avail.get(k).push(st);
    }
    // attempts per topic, best percent kept
    const sat = new Map();
    for (const a of attempts || []) {
      const st = byId[a.station_id];
      const t = tagOf(st) || a.bp; if (!t?.module) continue;
      const k = t.module + '/' + t.topic;
      const pct = a.result?.percent;
      if (!sat.has(k)) sat.set(k, { n: 0, best: null, last: 0, ids: new Set() });
      const e = sat.get(k);
      e.n++; e.ids.add(a.station_id);
      if (pct != null) e.best = e.best == null ? pct : Math.max(e.best, pct);
      e.last = Math.max(e.last, a.created || 0);
    }
    const mods = modules.map(m => {
      const topics = (m.topics || []).map(t => {
        const k = m.id + '/' + t.id;
        const have = (avail.get(k) || []).length;
        const e = sat.get(k);
        return { id: t.id, name: t.name, stations: have, attempts: e?.n || 0,
          done: e ? e.ids.size : 0, best: e?.best ?? null, last: e?.last || 0,
          // a topic nobody can sit is not a gap in the candidate's revision
          examinable: have > 0 };
      });
      const real = topics.filter(t => t.examinable);
      const touched = real.filter(t => t.attempts > 0);
      const pct = real.length ? Math.round(touched.length / real.length * 100) : null;
      const scored = touched.filter(t => t.best != null);
      const mean = scored.length ? Math.round(scored.reduce((s, t) => s + t.best, 0) / scored.length) : null;
      return { id: m.id, name: m.name, topics, examinable: real.length,
        touched: touched.length, percent: pct, mean, stations: real.reduce((n, t) => n + t.stations, 0) };
    });
    const withStations = mods.filter(m => m.examinable > 0);
    const overall = withStations.length
      ? Math.round(withStations.reduce((s, m) => s + (m.percent || 0), 0) / withStations.length) : 0;
    const untagged = stations.filter(s => !tagOf(s)).length;
    return { modules: mods, overall, untagged, totalStations: stations.length };
  }

  return { get, save, bust, shipped, DEFAULT, COMMON,
    rank, suggest, tagOf, isCommon, moduleName, topicName,
    buildCircuit, historyOf, coverage, norm, hayOf };
})();
