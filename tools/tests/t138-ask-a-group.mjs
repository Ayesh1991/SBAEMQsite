/* t138 — asking the right room.

   Groups have existed since v127 and a question could not be asked in
   one. "Discuss with friends" under a rationale called TeaRoom.share(),
   which called post(), which took the room FROM THE OPEN WALL — a rule
   written for the wall's own composer, where it is exactly right: taking
   the room from what you are looking at is what makes it impossible to
   read one group and post to another.

   THAT RULE NEEDS A VIEW. Sitting a paper there is no wall on screen, so
   the question went wherever the wall happened to have been left — from
   a paper, invisibly, and in practice always "everyone". Somebody in four
   groups could not ask one of them. §1 is the picker that asks.

   §3 IS THE OTHER HALF. If the wall only ever shows one room at a time,
   a question asked in a group is somewhere you have to go and look. The
   wall is now a FEED by default: the shared wall plus every group you are
   in, each post badged with where it came from. Three states, not two —
   and "everyone" must still mean room_id is null exactly, or a member of
   three groups finds all three mixed into the wall they thought was
   everybody's.

   §5 IS A BUG FOUND ON THE WAY. Two local rooms made in the same
   millisecond shared an id, and with it their members, posts, chat and
   files. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1300 } });
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
await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1800);

/* Two groups, because the whole point is choosing BETWEEN them. */
const ids = await page.evaluate(async () => {
  const a = await Backend.createChatRoom({ title: 'MD 2026 group', kind: 'group', memberIds: [], myName: 'Didula' });
  const b = await Backend.createChatRoom({ title: 'OSCE crammers', kind: 'group', memberIds: [], myName: 'Didula' });
  await TeaRoom.init?.();
  return { a: a.id, b: b.id };
});

/* ---------------------------------------------------------------- */
sec('1. A QUESTION IS ASKED OF SOMEBODY IN PARTICULAR');

const routed = await page.evaluate(async (ids) => {
  const ask = (n, topic, room) => TeaRoom.share(
    { questionKey: 'p:SBA:' + n, paperTitle: 'Paper', answerText: 'C', rationale: 'r' }, topic, room);
  await ask(1, 'Asked MD 2026', ids.a);
  await ask(2, 'Asked OSCE crammers', ids.b);
  await ask(3, 'Asked everyone', null);
  const titles = l => l.map(p => p.topic).sort().join(' | ');
  return {
    a: titles(await Backend.listDiscussions({ limit: 50, roomId: ids.a })),
    b: titles(await Backend.listDiscussions({ limit: 50, roomId: ids.b })),
    everyone: titles(await Backend.listDiscussions({ limit: 50 })),
    feed: titles(await Backend.listDiscussions({ limit: 50, feed: true }))
  };
}, ids);
say('a question asked of one group reaches that group', routed.a === 'Asked MD 2026', routed.a);
say('  and not the other', routed.b === 'Asked OSCE crammers', routed.b);
/* THE RULE THAT MUST NOT LOOSEN. */
say('"everyone" still means the posts nobody filed into a group',
  routed.everyone === 'Asked everyone', routed.everyone);
say('  while the feed carries all three',
  routed.feed === 'Asked MD 2026 | Asked OSCE crammers | Asked everyone', routed.feed);

/* ---------------------------------------------------------------- */
sec('2. AND THE PICKER IS THERE TO ASK WITH');

const qe = readFileSync('js/qedit.js', 'utf8');
say('the Discuss box offers a destination', /id="qe-dest"/.test(qe) && /shareTargets\(\)/.test(qe));
/* With no groups there is one option and nothing to decide. */
say('  shown only when there is a choice to make',
  /if \(!groups\.length\) return;/.test(qe) && /id="qe-dest-row" hidden/.test(qe));
say('  the choice is passed through, not inferred',
  /TeaRoom\.share\(payload, topic, roomId\)/.test(qe));
/* The fallback path must carry it too, or an app without TeaRoom loaded
   silently posts a group's question to everyone. */
say('  including when the tea room module is absent',
  /Backend\.addDiscussion\(\{ \.\.\.payload, topic, roomId \}\)/.test(qe));
say('  and the last group asked is remembered',
  /aureum-ask-dest/.test(qe) && /rememberDest\(roomId\)/.test(qe));
/* "Posted to the tea room" was true of four different places. */
say('the confirmation says which of them it went to',
  /Asked \$\{esc\(where\)\}/.test(qe));

const tr = readFileSync('js/tearoom.js', 'utf8');
/* The rule it is an exception to, written where it is broken. */
say('share() takes a room and says why the wall cannot supply one',
  /async function share\(ctx, topic, roomId\)/.test(tr)
  && /THAT RULE NEEDS A VIEW/.test(tr));
say('  and an absent argument still means the open wall',
  /roomId === undefined \? \(wallIsFeed\(\) \? null : wallRoom\) : roomId/.test(tr));
/* One list of destinations, or the two pickers drift. */
say('the composer and the picker share one idea of where a post can go',
  /function destOptionsHTML\(selected\)/.test(tr) && /shareTargets/.test(tr));

/* ---------------------------------------------------------------- */
sec('3. THE WALL IS A FEED, SO AN ANSWER IS NOT SOMEWHERE YOU GO AND LOOK');

const feed = await page.evaluate(async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await TeaRoom.renderPanel(host);          // no room: the Studio's tile
  await new Promise(r => setTimeout(r, 1400));
  const txt = host.textContent || '';
  return { isFeed: TeaRoom.wallIsFeed(),
    rooms: [...host.querySelectorAll('[data-wall-room]')].map(b => b.textContent.trim()),
    badges: [...host.querySelectorAll('.tw-where')].map(b => b.textContent.trim()),
    posts: (txt.match(/Asked /g) || []).length,
    hasDest: !!host.querySelector('#tw-dest') };
});
say('the Studio wall opens on the feed', feed.isFeed);
say('  with every group and Everyone to switch to',
  feed.rooms.some(r => /All/.test(r)) && feed.rooms.some(r => /Everyone/.test(r))
  && feed.rooms.some(r => /MD 2026/.test(r)), feed.rooms.join(' · '));
say('  showing all three questions at once', feed.posts === 3, feed.posts + ' posts');
/* Without this the feed is a pile of posts and somebody answers in the
   wrong place. */
say('  each badged with the wall it came from',
  feed.badges.length === 3 && feed.badges.some(b => /MD 2026/.test(b))
  && feed.badges.some(b => /Everyone/.test(b)), feed.badges.join(' · '));
/* On the feed there is no single open wall, so the composer must ask. */
say('  and the composer asks where a new post goes', feed.hasDest);

const scoped = await page.evaluate(async (ids) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await TeaRoom.renderPanel(host, ids.a);   // a group's own page
  await new Promise(r => setTimeout(r, 1400));
  const txt = host.textContent || '';
  return { isFeed: TeaRoom.wallIsFeed(), posts: (txt.match(/Asked /g) || []).length,
    badges: host.querySelectorAll('.tw-where').length,
    hasDest: !!host.querySelector('#tw-dest'),
    leaked: /Asked OSCE crammers|Asked everyone/.test(txt) };
}, ids);
say("a group's own page is that group, not the feed", !scoped.isFeed);
say('  showing only its own posts', scoped.posts === 1 && !scoped.leaked, scoped.posts + ' posts');
/* On one wall every post is from it; the badge would be noise, and the
   composer has nothing to ask. */
say('  with no badge and no destination to choose',
  scoped.badges === 0 && !scoped.hasDest);

/* ---------------------------------------------------------------- */
sec('4. THE READ AND THE POLL ASK THE SAME QUESTION');

/* If the list merges and the poll does not, a group's new post appears on
   reload and never live — which looks like the group being quiet. */
say('one definition of what the open wall wants',
  /const wallQuery = \(\) => \(\{ roomId: wallIsFeed\(\) \? null : wallRoom, feed: wallIsFeed\(\) \}\)/.test(tr));
say('  used by the first read, the poll and load-older alike',
  (tr.match(/\.\.\.wallQuery\(\)/g) || []).length === 2
  && /pollDiscussions\?\.\(lastPoll, wallQuery\(\)\)/.test(tr));

const be = readFileSync('js/backend.js', 'utf8');
say('both backends know the three modes',
  /opts\?\.feed && !want/.test(be) && /opts\?\.feed && !opts\?\.roomId/.test(be));
say('  and the cloud poll scopes the same way as its list',
  /const scoped = \(opts\?\.feed && !opts\?\.roomId\)/.test(be));
say('  with the feed the only thing that mixes rooms',
  /the only\s*\n?\s*(\*\s*)?mode that mixes rooms|only\s+thing\s+that\s+mixes/.test(be)
  || /MY FEED \(v138\)/.test(be));

const live = await page.evaluate(async (ids) => {
  /* A post made elsewhere while the feed is open must arrive by poll. */
  const host = document.createElement('div');
  document.body.appendChild(host);
  await TeaRoom.renderPanel(host);
  await new Promise(r => setTimeout(r, 1200));
  await Backend.addDiscussion({ topic: 'Late group post', roomId: ids.b, kind: 'post' });
  await TeaRoom._pollNow?.();
  await new Promise(r => setTimeout(r, 900));
  return /Late group post/.test(host.textContent || '');
}, ids);
say('a group post made while the feed is open arrives on it', live);

/* ---------------------------------------------------------------- */
sec('5. AND TWO GROUPS ARE TWO GROUPS');

/* 'r' + Date.now() with no suffix: two rooms made in the same
   millisecond shared an id, and with it their members, posts, chat and
   files. Every other id in that file already added a random suffix. */
say('rooms made in the same millisecond get different ids', ids.a !== ids.b,
  ids.a + ' vs ' + ids.b);
const many = await page.evaluate(async () => {
  const made = [];
  for (let i = 0; i < 8; i++) made.push((await Backend.createChatRoom(
    { title: 'burst ' + i, kind: 'group', memberIds: [], myName: 'D' })).id);
  return { n: made.length, unique: new Set(made).size };
});
say('  and eight made in a burst are eight rooms',
  many.unique === many.n, many.unique + ' of ' + many.n);
say('no local id is minted from the clock alone',
  !/'[a-z]' \+ Date\.now\(\),/.test(be));

/* ---------------------------------------------------------------- */
sec('6. STAMPS');
const stamp = await page.evaluate(async () => {
  const h = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...h.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  return { vs, sw: /aureum-v138/.test(sw) };
});
say('one version across every asset', stamp.vs.join() === '138', stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
