/* t126 — Phase 5: true/false in the adaptive mock.

   v120 made true/false a real question type in a paper. The mock could not
   draw from it, because the blueprint has no true/false weights — and how
   many statements a final MBBS paper carries, and from which topics, is a
   judgement about a real exam that nobody on this project has sat yet.

   SO THE MECHANISM SHIPS AND THE WEIGHTS DO NOT. tf_count defaults to zero
   and blueprint_tf to nothing, which means EVERY BLUEPRINT THAT EXISTS
   TODAY PRODUCES EXACTLY THE PAPER IT PRODUCED YESTERDAY. §1 and §2 are
   that promise, and they are the half of this file that matters most: a
   feature nobody has asked for yet must not change the exam somebody is
   sitting tomorrow morning.

   §4 IS THE BUG THIS RELEASE NEARLY SHIPPED. The Studio rebuilds the
   blueprint field by field and saves it whole, so a field it does not know
   about is deleted by the act of opening the Studio and pressing save — no
   error, no warning, and by somebody who came to change a weight. The
   export button has the same shape: it is offered as the file to paste
   back into data/blueprint.md, so a section it cannot write is a section
   that disappears through the button it is documented with. Both are
   tested here because neither throws.

   §3 also holds a quieter one. A true/false bucket is named the way an SBA
   bucket is — subcategory, then category — so a map keyed by name alone let
   the last kind inserted win, and an SBA slot in the preview would have
   been offered the true/false bucket's specific areas. The paper would have
   been planned from the wrong list and nothing would have said so. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. THE DEFAULT IS NO TRUE/FALSE AT ALL');

const bpJs = readFileSync('js/blueprint.js', 'utf8');
const simJs = readFileSync('js/simulator.js', 'utf8');
const covJs = readFileSync('js/coverage.js', 'utf8');
const devJs = readFileSync('js/dev-console.js', 'utf8');

say('the blueprint can carry a true/false section',
  /tfCount: num\(paper\.tf_count, 0\)/.test(bpJs) && /tf: \(doc\.blueprint_tf \|\| \[\]\)/.test(bpJs));
/* ZERO, not thirty. The number in this line is the whole safety of the
   release. */
say('  and it asks for none unless somebody writes a number',
  /tfCount: num\(paper\.tf_count, 0\)/.test(bpJs));
say('  an empty blueprint has an empty true/false list, not a missing one',
  /EMPTY = \(\) => \(\{ sba: \[\], emq: \[\], tf: \[\]/.test(bpJs));
/* Both conditions, because either alone would build a section out of
   nothing: a count with no buckets falls through to the top-up and hands
   out arbitrary statements dressed as a blueprint-shaped section. */
say('the planner draws a section only if BOTH a count and buckets exist',
  /bp\.paper\.tfCount > 0 && \(bp\.tf \|\| \[\]\)\.length/.test(simJs));
say('  and the bundled blueprint asks for neither',
  !/tf_count/.test(readFileSync('data/blueprint.md', 'utf8')));

say('the index knows true/false questions exist',
  /Data\.flatten\(paper, 'TF'\)\.forEach/.test(simJs));
say('the coverage map can hold true/false buckets',
  /build\(bp\.tf \|\| \[\], 'TF'/.test(covJs));
/* THE ONE NUMBER THIS RELEASE DELIBERATELY MOVES. True/false questions
   have been in papers since v120 and the coverage index did not count
   them, so a candidate who had answered every statement in a topic still
   saw a gap there. */
say('  and the index counts true/false questions it had been ignoring',
  /for \(const kind of \['SBA', 'EMQ', 'TF'\]\)/.test(covJs)
  && /it moves a number people look at/.test(covJs));
/* A bucket keyed by name alone is one entry two kinds fight over. */
say('bucket definitions are keyed by kind as well as name',
  /m\.set\(kind \+ '\\u0000' \+ name/.test(covJs)
  && /defs\.get\(r\.bucket, r\.kind\)/.test(simJs));

/* THE TWO WAYS THE WEIGHTS CAN BE SILENTLY DELETED. */
say('the Studio carries the true/false weights through its working copy',
  /tf: \(doc\.tf \|\| \[\]\)\.map\(b => \(\{ \.\.\.b, areas: fixAreas\(b\.areas\) \}\)\)/.test(devJs));
say('  and says in the panel that saving keeps them',
  /\$\{tfNote\}/.test(devJs) && /bp-tf-note/.test(devJs));
say('the Markdown export can write them back out',
  /L\.push\('blueprint_tf:'\)/.test(bpJs) && /L\.push\('  tf_count: '/.test(bpJs));

/* ---------------------------------------------------------------- */
sec('2. SO THE EXAM SOMEBODY SITS TOMORROW IS UNCHANGED');

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
await ctx.addInitScript(() => { let real;
  Object.defineProperty(window, 'AUREUM_CONFIG', { configurable: true, get() { return real; },
    set(v) { real = v; if (real) real.supabase = { url: '', anonKey: '' }; } }); });
const page = await ctx.newPage();
page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load|net::/.test(m.text())) bad.push('CONSOLE ' + m.text()); });

await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.click('#auth-toggle'); await page.waitForTimeout(300);
await page.fill('input[name=name]', 'Dr Didula Ayeshmantha');
await page.fill('input[name=email]', 'ayeshmantha@gmail.com');
await page.fill('input[name=password]', 'password123');
await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1700);

const before = await page.evaluate(async () => {
  const bp = await Blueprint.load();
  const index = await Simulator.buildIndex();
  const hist = await Simulator.loadHistory();
  const plan = Simulator.select(bp, index, hist, null);
  return { tfCount: bp.paper.tfCount, tf: (bp.tf || []).length,
    asksSba: bp.paper.sbaCount, asksEmq: bp.paper.emqCount,
    sba: plan.sbaRecs.length, emq: plan.emqRecs.length, tfRecs: (plan.tfRecs || []).length };
});
/* THE PROMISE, stated as the numbers it is about. */
say('the shipped blueprint asks for no true/false',
  before.tfCount === 0 && before.tf === 0, 'tf_count ' + before.tfCount + ', ' + before.tf + ' buckets');
say('  so the plan has no true/false section', before.tfRecs === 0, before.tfRecs + ' statements');
/* It still asks for a 30 + 30 paper. How many it can actually fill depends
   on what is unseen in this bank, which is why §3 compares the plan to
   THIS plan rather than to a number. */
say('  and the paper it asks for is the SBA + EMQ one it always was',
  before.asksSba === 30 && before.asksEmq === 30, before.asksSba + ' + ' + before.asksEmq);
say('  with both sections planned', before.sba > 0 && before.emq > 0,
  before.sba + ' SBA, ' + before.emq + ' EMQ drawn');

await page.goto(B + '/index.html?r=' + Math.random() + '#/simulator', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2800);
const quiet = await page.evaluate(() => ({
  kicker: document.querySelector('.sim-hero-kicker')?.textContent || '',
  ready: document.querySelector('.sim-hero-main .muted')?.textContent || ''
}));
/* A heading that mentions a section the paper does not have is a lie about
   the exam, which is the one thing this page may not be. */
say('the simulator page does not mention a section that is not there',
  !/T\/F/.test(quiet.kicker) && !/T\/F/.test(quiet.ready), quiet.kicker.trim());

/* ---------------------------------------------------------------- */
sec('3. AND WITH WEIGHTS, A THIRD SECTION APPEARS');

/* A bucket named the same as an SBA bucket, deliberately — see the header. */
const after = await page.evaluate(async () => {
  const tf = n => ({ stem: 'Statement ' + n + ' about thyroid disease in pregnancy', answer: n % 2 === 0 });
  await Backend.publishPaper({ id: 't126-tf', title: 'A true/false paper',
    categoryId: 'obstetrics', sectionId: 'obs-antenatal', topicId: 't-preconception',
    sba: 0, emq: 0, tf: 12, tracks: ['pgim-og-2'],
    content: { topic: 'Endocrine disease in pregnancy', tf: Array.from({ length: 12 }, (_, i) => tf(i + 1)) } });
  Data.bustPapers?.();

  const bp = await Blueprint.load();
  bp.paper.tfCount = 6;
  bp.paper.tfMark = 1;
  bp.paper.durationMin = 150;
  /* Named exactly like one of the SBA buckets, so a map keyed by name
     alone would hand the SBA slots these areas. */
  bp.tf = [{ category: 'Obstetrics', subcategory: bp.sba[0].subcategory || bp.sba[0].category,
             weight: 60, areas: ['thyroid disease in pregnancy'] },
           { category: 'Obstetrics', subcategory: 'Endocrine in pregnancy',
             weight: 40, areas: ['thyroid disease in pregnancy'] }];
  await Blueprint.save(bp);

  const fresh = await Blueprint.load();
  const index = await Simulator.buildIndex(true);
  const hist = await Simulator.loadHistory();
  const plan = Simulator.select(fresh, index, hist, null);
  const defs = Coverage.bucketDefs(fresh);
  const sharedName = fresh.sba[0].subcategory || fresh.sba[0].category;
  return {
    stored: (fresh.tf || []).length, storedCount: fresh.paper.tfCount,
    tfRecs: (plan.tfRecs || []).length,
    allTf: (plan.tfRecs || []).every(r => r.kind === 'TF'),
    buckets: [...new Set((plan.tfRecs || []).map(r => r.bucket))].sort(),
    sba: plan.sbaRecs.length, emq: plan.emqRecs.length,
    /* No slot may be filled twice across the three sections. */
    unique: new Set([...plan.sbaRecs, ...plan.emqRecs, ...(plan.tfRecs || [])]
      .map(r => r.qkey)).size,
    slots: plan.sbaRecs.length + plan.emqRecs.length + (plan.tfRecs || []).length,
    /* The shadowing bug, asked directly. */
    sbaDef: defs.get(sharedName, 'SBA')?.kind || null,
    tfDef: defs.get(sharedName, 'TF')?.kind || null,
    covKinds: [...new Set(Coverage.blueprintView(await Coverage.buildIndex(true),
      await Coverage.attempted(), fresh).map(b => b.kind))].sort()
  };
});
say('a blueprint can be given a true/false section', after.stored === 2 && after.storedCount === 6,
  after.stored + ' buckets, ' + after.storedCount + ' per paper');
say('  and the planner draws exactly that many', after.tfRecs === 6, after.tfRecs + ' statements');
say('  all of them true/false', after.allTf);
say('  filed under the buckets that asked for them', after.buckets.length === 2, after.buckets.join(' | '));
/* The other two sections are untouched: a third section is an ADDITION, not
   a redistribution. (Which questions, exactly, is not assertable — the
   engine mixes in Math.random so two mocks differ on purpose. The counts
   are the part that must not move.) */
say('  while the SBA and EMQ sections keep their own counts',
  after.sba === before.sba && after.emq === before.emq,
  after.sba + ' SBA, ' + after.emq + ' EMQ');
say('  and no question fills two slots', after.unique === after.slots,
  after.unique + ' of ' + after.slots + ' distinct');
/* ONE NAME, TWO KINDS, TWO DEFINITIONS. */
say('a bucket name shared with an SBA bucket does not shadow it',
  after.sbaDef === 'SBA' && after.tfDef === 'TF', after.sbaDef + ' / ' + after.tfDef);
say('  and the coverage map reports all three kinds',
  after.covKinds.join() === 'EMQ,SBA,TF', after.covKinds.join(', '));

await page.goto(B + '/index.html?r=' + Math.random() + '#/simulator', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2800);
const loud = await page.evaluate(() => ({
  kicker: document.querySelector('.sim-hero-kicker')?.textContent || '',
  ready: document.querySelector('.sim-hero-main .muted')?.textContent || ''
}));
say('now the page says there is a true/false section',
  /T\/F/.test(loud.kicker) && /T\/F/.test(loud.ready), loud.kicker.trim());
/* 120 minutes is the length of the two-hour PGIM SBA+EMQ paper. It is not
   the length of a paper with a third section in it, and capping a longer
   blueprint there would hand a candidate three sections in the time
   written for two. */
say('  and a three-section paper is not squeezed into the two-section cap',
  /tfQ\.length\s*\n?\s*\? \(bp\.paper\.durationMin \|\| 120\)/.test(simJs));

/* ---------------------------------------------------------------- */
sec('4. AND NEITHER THE STUDIO NOR THE EXPORT EATS THEM');

/* THE REAL FAILURE MODE, driven through the real buttons. Opening the
   Studio and pressing save is what somebody does to change one weight. */
await page.evaluate(() => sessionStorage.setItem('aureum-passkey', '1'));
await page.goto(B + '/index.html#/dev/blueprint', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2600);
const noteBefore = await page.evaluate(async () => {
  document.querySelector('#bp-edit')?.click();
  await new Promise(r => setTimeout(r, 1200));
  return {
    note: document.querySelector('.bp-tf-note')?.textContent.replace(/\s+/g, ' ').trim() || '',
    hasSave: !!document.querySelector('.bp-studio-actions [data-act="save"]')
  };
});
/* Said out loud, so nobody wonders whether pressing save in here threw
   them away. */
say('the Studio says the true/false weights are there and will be kept',
  /2 true\/false buckets/.test(noteBefore.note) && /6 per paper/.test(noteBefore.note)
  && /keeps them as they are/i.test(noteBefore.note), noteBefore.note);
say('  and there is a save button to press', noteBefore.hasSave);

const survived = await page.evaluate(async () => {
  /* Change a weight, exactly as a visitor to this page would. */
  const w = document.querySelector('.bp-bucket [data-field="weight"]');
  if (w) { w.value = String((Number(w.value) || 5) + 1); w.dispatchEvent(new Event('input', { bubbles: true })); }
  document.querySelector('.bp-studio-actions [data-act="save"]').click();
  await new Promise(r => setTimeout(r, 1800));
  Blueprint.bust();
  const back = await Blueprint.load();
  return { tf: (back.tf || []).length, count: back.paper.tfCount, mark: back.paper.tfMark,
    areas: (back.tf?.[0]?.areas || []).join(', ') };
});
say('changing a weight and saving leaves the true/false section alone',
  survived.tf === 2, survived.tf + ' buckets');
say('  with its per-paper count', survived.count === 6, 'tf_count ' + survived.count);
say('  its mark per statement', survived.mark === 1, 'tf_mark_each ' + survived.mark);
say('  and its specific areas', /thyroid/.test(survived.areas), survived.areas);

/* THE EXPORT IS THE ROUND TRIP — the Studio offers that file as the one to
   paste back into data/blueprint.md. */
const round = await page.evaluate(async () => {
  const doc = await Blueprint.load();
  const md = Blueprint.toMarkdown(doc);
  /* parseFrontMatter normalises on the way out — reading the exported file
     is exactly what the site does with data/blueprint.md. */
  const back = Blueprint.parseFrontMatter(md);
  return { md: /blueprint_tf:/.test(md) && /tf_count: 6/.test(md),
    tf: back.tf.length, count: back.paper.tfCount, mark: back.paper.tfMark,
    sba: back.sba.length, emq: back.emq.length,
    areas: (back.tf[0]?.areas || []).join(', ') };
});
say('the exported Markdown carries the true/false section', round.md);
say('  and parsing it back gives the same buckets', round.tf === 2, round.tf + ' buckets');
say('  the same count and mark', round.count === 6 && round.mark === 1,
  round.count + ' × ' + round.mark);
say('  the same specific areas', /thyroid/.test(round.areas), round.areas);
say('  and the SBA and EMQ sections unharmed', round.sba > 0 && round.emq > 0,
  round.sba + ' SBA, ' + round.emq + ' EMQ');

/* A blueprint with no true/false must export as it did before this
   release — an unasked-for "tf_count: 0" in every file is a diff that
   means nothing. */
const quietMd = await page.evaluate(() => {
  const md = Blueprint.toMarkdown(Blueprint.normalise({
    blueprint_sba: [{ category: 'c', subcategory: 's', weight: 100 }] }));
  return { tf: /tf_count|blueprint_tf/.test(md) };
});
say('a blueprint with no true/false exports without mentioning it', !quietMd.tf);

/* ---------------------------------------------------------------- */
sec('5. STAMPS');
const stamp = await page.evaluate(async () => {
  const h = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...h.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  /* The literal belongs to the newest release file only — see the README. */
  return { vs, sw: vs.length === 1 && sw.includes("'aureum-v" + vs[0] + "'") };
});
say('one version across every asset', stamp.vs.length === 1, stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
