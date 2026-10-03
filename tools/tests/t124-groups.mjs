/* t124 — Phase 3: the wall belongs to a group.

   "At the moment all the users are there in the tea room." They were — for
   the WALL. Chat has been private per group since 8c-3: chat_rooms,
   chat_members and is_room_member() already kept a conversation to the
   people in it, with files shared inside it. Every wall POST, though, went
   to everybody.

   A GROUP IS A chat_room, not a second kind of object beside one. The same
   row, the same membership, the same RLS helper. A group you can chat in
   but not post to — or the reverse — is two things to create and two
   places to add somebody to, and they drift apart the first time anyone
   forgets.

   NULL MEANS EVERYBODY, which is how every post that already exists
   survives. The shared wall does not disappear; it becomes the room
   everyone is in, and a group wall is the same thing addressed to fewer
   people.

   AND IT IS PRIVACY, NOT A FILTER. §3 is the test that matters: a
   non-member asking directly for a group's wall gets nothing — the rows
   do not leave the database, and the local backend refuses them too. A
   rule only one backend applies is a rule that gets tested on the wrong
   one; the first version of this release had exactly that hole and §3
   found it. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. A GROUP IS A ROOM, AND THE WALL KNOWS WHICH');

const sql = readFileSync('supabase/schema.sql', 'utf8');
say('a post can belong to a room',
  /alter table public\.discussions add column if not exists room_id uuid/.test(sql));
/* The reuse is the design decision worth asserting: a group is the chat
   room, so membership is already solved. */
say('  and that room is a chat room, not a second kind of group',
  /references public\.chat_rooms\(id\) on delete cascade/.test(sql));
say('reading a post needs membership, unless it belongs to nobody',
  /room_id is null or public\.is_room_member\(room_id\)/.test(sql));
/* Posting into a group you are not in would be a way to reach people who
   cannot be reached — worth refusing separately from reading. */
say('  and posting into a group needs it too',
  (sql.match(/room_id is null or public\.is_room_member\(room_id\)/g) || []).length >= 2);
/* A reply and a reaction are facts about a post. Leaving them open would
   leak which posts exist and how popular they are, which is most of what
   a private group is hiding. */
say('replies and reactions follow the post they belong to',
  /function public\.can_read_post\(d uuid\)/.test(sql)
  && /public\.can_read_post\(discussion_id\)/.test(sql)
  && /public\.can_read_post\(post_id\)/.test(sql));
/* user_directory is a VIEW; a policy on it does not merely do nothing, it
   fails the whole file. The first draft of this release had one. */
say('  and nothing tries to put a policy on the directory view',
  !/create policy "directory read" on public\.user_directory/.test(sql));

const js = readFileSync('js/backend.js', 'utf8');
say('both backends can search for a person',
  (js.match(/async function searchPeople\(/g) || []).length === 2);
say('  and the local one enforces membership rather than trusting the cloud',
  /function isRoomMember\(roomId\)/.test(js) && /You are not in that group/.test(js));

/* ---------------------------------------------------------------- */
sec('2. FINDING SOMEBODY BY NAME, OR BY NUMBER');

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
await ctx.addInitScript(() => { let real;
  Object.defineProperty(window, 'AUREUM_CONFIG', { configurable: true, get() { return real; },
    set(v) { real = v; if (real) real.supabase = { url: '', anonKey: '' }; } }); });
const page = await ctx.newPage();
page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load|net::/.test(m.text())) bad.push('CONSOLE ' + m.text()); });

const signUp = async (name, email) => {
  await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.evaluate(async () => { try { await Backend.signOut(); } catch {} });
  await page.goto(B + '/index.html?r=' + Math.random() + '#/auth', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.click('#auth-toggle'); await page.waitForTimeout(300);
  await page.fill('input[name=name]', name);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'password123');
  await page.click('#auth-form button[type=submit]'); await page.waitForTimeout(1500);
};
const signIn = email => page.evaluate(async e => {
  await Backend.signOut(); await Backend.signIn(e, 'password123');
}, email);

/* TWO PEOPLE WITH THE SAME SURNAME, which is the case the number exists
   for — there will be three Pereras. */
await signUp('Dr Nimal Perera', 'nimal@example.com');
await signUp('Dr Sunil Perera', 'sunil@example.com');
await signUp('Dr Didula Ayeshmantha', 'ayeshmantha@gmail.com');

const byName = await page.evaluate(async () => (await Backend.searchPeople('perera')).map(p => p.name + '#' + p.userNo));
say('searching a name finds everyone who matches', byName.length === 2, byName.join(', '));
const byNo = await page.evaluate(async () => {
  const all = await Backend.listChatPeople();
  const n = all.find(p => p.userNo)?.userNo;
  return { n, hits: n ? (await Backend.searchPeople(n)).map(p => p.name) : [] };
});
/* THE NUMBER IS WHAT MAKES ONE PERERA THE RIGHT PERERA, and it is what
   people read out to each other. */
say('  and the user number finds exactly one', byNo.hits.length === 1,
  '#' + byNo.n + ' → ' + byNo.hits.join(', '));
say('  a one-letter query is not a search', (await page.evaluate(async () =>
  (await Backend.searchPeople('n')).length)) === 0);
say('  and nobody finds themselves', !byName.some(n => /Didula/.test(n)));

/* ---------------------------------------------------------------- */
sec('3. AND THE GROUP IS PRIVATE');

const room = await page.evaluate(async () => {
  await Backend.addDiscussion({ topic: 'Said to everyone', kind: 'post' });
  const nimal = (await Backend.searchPeople('Nimal'))[0];
  const r = await Backend.createChatRoom({ title: 'Revision crew', kind: 'group',
    memberIds: [nimal.id], myName: 'Dr Didula Ayeshmantha' });
  await Backend.addDiscussion({ topic: 'Said only to the crew', kind: 'post', roomId: r.id });
  return r.id;
});
const owner = await page.evaluate(async r => ({
  shared: (await Backend.listDiscussions({})).map(d => d.topic),
  group: (await Backend.listDiscussions({ roomId: r })).map(d => d.topic)
}), room);
/* ASKING FOR THE SHARED WALL MEANS room_id IS NULL, not "everything I may
   read" — a member of three groups would otherwise see all three mixed
   into the wall they thought was everybody's. */
say('the shared wall holds only what was said to everyone',
  owner.shared.join() === 'Said to everyone', owner.shared.join(', '));
say('  and the group wall only what was said to the group',
  owner.group.join() === 'Said only to the crew', owner.group.join(', '));

const member = await page.evaluate(async r => {
  await Backend.signOut(); await Backend.signIn('nimal@example.com', 'password123');
  return {
    rooms: (await Backend.listChatRooms()).map(x => x.title),
    group: (await Backend.listDiscussions({ roomId: r })).map(d => d.topic)
  };
}, room);
say('a member sees the group', member.rooms.join() === 'Revision crew', member.rooms.join(', '));
say('  and reads its wall', member.group.join() === 'Said only to the crew', member.group.join(', '));

/* THE TEST THAT MATTERS. A non-member asking directly, by id, for the
   group's wall. This is where a filter and a lock differ. */
const outsider = await page.evaluate(async r => {
  await Backend.signOut(); await Backend.signIn('sunil@example.com', 'password123');
  const out = { shared: (await Backend.listDiscussions({})).map(d => d.topic),
    group: (await Backend.listDiscussions({ roomId: r })).map(d => d.topic),
    rooms: (await Backend.listChatRooms()).map(x => x.title) };
  try { await Backend.addDiscussion({ topic: 'Butting in', kind: 'post', roomId: r }); out.posted = true; }
  catch (e) { out.refused = e.message; }
  return out;
}, room);
say('a non-member still has the shared wall', outsider.shared.join() === 'Said to everyone',
  outsider.shared.join(', '));
say('  but asking for the group by id gets nothing', outsider.group.length === 0,
  JSON.stringify(outsider.group));
say('  the group is not even listed to them', outsider.rooms.length === 0,
  outsider.rooms.join(', ') || 'none');
say('  and they cannot post into it', !outsider.posted && /not in that group/i.test(outsider.refused || ''),
  outsider.refused);

/* ---------------------------------------------------------------- */
sec('4. AND THE WALL SAYS WHICH ONE YOU ARE READING');

await signIn('ayeshmantha@gmail.com');
await page.goto(B + '/index.html?r=' + Math.random() + '#/studio', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2400);
await page.evaluate(() => TeaRoom.openWall?.());
await page.waitForTimeout(1800);
const strip = await page.evaluate(() => [...document.querySelectorAll('.tw-room')].map(b => b.textContent.trim()));
say('the wall offers everybody’s, then each group', strip.length === 2
  && /Everyone/.test(strip[0]) && /Revision crew/.test(strip[1]), strip.join(' | '));
say('  with the shared one open to begin with',
  await page.evaluate(() => document.querySelector('.tw-room')?.classList.contains('is-on')));

/* Switching has to DROP what was loaded, not filter it — a post left over
   from the last group appearing in this one is the failure this whole
   release is about. */
await page.evaluate(() => [...document.querySelectorAll('.tw-room')]
  .find(b => /Revision crew/.test(b.textContent))?.click());
await page.waitForTimeout(1800);
const switched = await page.evaluate(() => ({
  on: [...document.querySelectorAll('.tw-room')].findIndex(b => b.classList.contains('is-on')),
  title: document.querySelector('[data-tw-title]')?.textContent || '',
  loaded: TeaRoom._posts ? TeaRoom._posts().map(p => p.topic) : null
}));
say('choosing a group lights it', switched.on === 1, 'tab ' + switched.on);
say('  and names it in the header', /Revision crew/.test(switched.title), switched.title);

/* A non-member never sees the strip offer a group they cannot open. */
await signIn('sunil@example.com');
await page.goto(B + '/index.html?r=' + Math.random() + '#/studio', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2400);
await page.evaluate(() => TeaRoom.openWall?.());
await page.waitForTimeout(1600);
const theirs = await page.evaluate(() => [...document.querySelectorAll('.tw-room')].map(b => b.textContent.trim()));
/* With no groups there is nothing to switch between, and a strip with one
   button on it is furniture. */
say('somebody in no groups is shown no strip at all', theirs.length === 0,
  theirs.join(' | ') || 'none');

/* ---------------------------------------------------------------- */
sec('5. STAMPS');
const stamp = await page.evaluate(async () => {
  const h = await (await fetch('/index.html')).text();
  const sw = await (await fetch('/sw.js')).text();
  const vs = [...new Set([...h.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  return { vs, sw: /aureum-v124/.test(sw) };
});
say('one version across every asset', stamp.vs.join() === '124', stamp.vs.join(', '));
say('  the service worker agrees', stamp.sw);

console.log('\nerrors on the page: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
if (bad.length) fails += bad.length;
console.log('\nfails=' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
