/* t127 — Phase 6: a group has somebody in charge of it.

   v124 gave every member of a group identical powers, and the two halves
   of that were both wrong in the same direction. ANY member could add
   ANYBODY — so being let into a study group was being handed the guest
   list. And NOBODY could be removed but themselves, so a person added by
   mistake, or who left the course, stayed in the group reading its wall
   for ever. There was no way to rename a group and no way to clear up
   somebody else's post on its wall.

   A ROLE, NOT A SECOND TABLE. The admin of a group is a member with a
   different role on the row that already says they are a member. One
   place that knows who is in the group, one helper that answers it.

   §1 IS THE MIGRATION, which is where the danger is. Adding the column
   with a default of 'member' leaves every group that already exists with
   NO admin — frozen, nobody able to add anyone ever again. The creator is
   promoted, and a room whose creator is gone hands it to whoever joined
   first. Same shape as v123's.

   §3 IS THE RELEASE. A member who is not an admin asks the database
   directly — not through a hidden button — to add somebody, remove
   somebody, rename the group and promote themselves. All four are refused.
   The panel hides those controls from them, but hiding is a courtesy and
   §3 is the lock.

   §5 IS THE INVARIANT NOBODY WOULD THINK OF. A group with members and no
   admin can never gain one: nobody can add, rename or moderate it again.
   So the last admin leaving is refused with the remedy in the message —
   and if it happens anyway, by a path the app does not drive, the group is
   handed to the next member rather than left broken. It is REPAIRED rather
   than REFUSED in the database on purpose: a trigger that raised would
   also fire on the cascade from closing an account, and a rule about study
   groups may not hold somebody's account hostage. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'http://127.0.0.1:8907';
const bad = [];
let fails = 0;
const say = (w, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + w + (x !== undefined ? ' — ' + x : '')); if (!c) fails++; };
const sec = t => console.log('\n======== ' + t + ' ========');

/* ---------------------------------------------------------------- */
sec('1. THE MIGRATION LEAVES NO GROUP WITHOUT AN ADMIN');

const sql = readFileSync('supabase/schema.sql', 'utf8');
say('membership carries a role',
  /alter table public\.chat_members add column if not exists role text not null default 'member'/.test(sql));
/* THE STEP THAT SAVES EVERY EXISTING GROUP. */
say('  and the creator of every existing room is promoted by the migration',
  /update public\.chat_members m set role = 'admin'\s*\n\s*from public\.chat_rooms c/.test(sql));
/* The creator may be gone, or predate created_by. A room cannot be left
   with nobody able to administer it. */
say('  with the earliest member taking it where the creator is gone',
  /not exists \(select 1 from public\.chat_members a\s*\n\s*where a\.room_id = m\.room_id and a\.role = 'admin'\)/.test(sql));
say('an admin can be asked about without recursion',
  /create or replace function public\.is_room_admin\(r uuid\)[\s\S]{0,200}security definer/.test(sql));

sec('   AND THE POLICIES ASK FOR ONE');
say('only an admin adds members',
  /create policy "members insert" on public\.chat_members for insert\s*\n\s*with check \(public\.is_room_admin\(room_id\) or public\.is_room_creator\(room_id\)\)/.test(sql));
/* The creator's own first row exists before any membership does. */
say('  with the creator covered, because their own row does not exist yet',
  /is_room_creator\(room_id\)/.test(sql));
say('you may leave, and an admin may remove anybody',
  /create policy "members delete" on public\.chat_members for delete\s*\n\s*using \(auth\.uid\(\) = user_id or public\.is_room_admin\(room_id\)\)/.test(sql));
/* THE SELF-PROMOTION HOLE. The update policy has to let you write your own
   row — last_read_at lives on it — so the ROLE on that row needs its own
   guard or every member can make themselves an admin. */
say('and your own row is writable without the role on it being yours to set',
  /create or replace function public\.protect_member_role\(\)/.test(sql)
  && /new\.role is distinct from old\.role and not public\.is_room_admin\(old\.room_id\)/.test(sql));
say('renaming is an admin’s job, not any member’s',
  /create policy "rooms update" on public\.chat_rooms for update\s*\n\s*using \(public\.is_room_admin\(id\)\)/.test(sql));
say('an admin can clear up anybody’s post, reply and message in their group',
  /create policy "discussions own delete"[\s\S]{0,160}is_room_admin\(room_id\)/.test(sql)
  && /create policy "disc replies own delete"[\s\S]{0,260}is_room_admin\(d\.room_id\)/.test(sql)
  && /create policy "messages own delete"[\s\S]{0,120}is_room_admin\(room_id\)/.test(sql));
/* REPAIRED, NOT REFUSED — and the comment says why, because the next
   person to read it will want to "fix" it into a raise. */
say('the last admin leaving is repaired rather than refused',
  /create or replace function public\.heir_to_the_group\(\)/.test(sql)
  && /after delete on public\.chat_members/.test(sql)
  && /not allowed to hold somebody's account hostage/.test(sql));
say('  and a room being deleted outright is let go',
  /if not exists \(select 1 from public\.chat_rooms c where c\.id = old\.room_id\) then/.test(sql));

const js = readFileSync('js/backend.js', 'utf8');
say('both backends can read, add, remove, promote, rename and leave',
  ['listRoomMembers', 'addRoomMembers', 'removeRoomMember', 'setRoomMemberRole', 'renameRoom', 'leaveRoom']
    .every(f => (js.match(new RegExp('async function ' + f + '\\(', 'g')) || []).length === 2));
say('  and the local one enforces the same rule rather than trusting the cloud',
  /function isRoomAdmin\(roomId\)/.test(js) && /Only a group admin can add members\./.test(js));

/* ---------------------------------------------------------------- */
sec('2. THE MAKER OF A GROUP RUNS IT');

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
const signIn = email => page.evaluate(async e => { await Backend.signOut(); await Backend.signIn(e, 'password123'); }, email);

await signUp('Dr Nimal Perera', 'nimal@example.com');
await signUp('Dr Sunil Perera', 'sunil@example.com');
await signUp('Dr Kamala Silva', 'kamala@example.com');
await signUp('Dr Didula Ayeshmantha', 'ayeshmantha@gmail.com');

const made = await page.evaluate(async () => {
  const n = (await Backend.searchPeople('Nimal'))[0];
  const room = await Backend.createChatRoom({ title: 'Revision crew', kind: 'group',
    memberIds: [n.id], myName: 'Dr Didula Ayeshmantha' });
  const mem = await Backend.listRoomMembers(room.id);
  return { room: room.id, nimal: n.id,
    roles: mem.map(m => m.name + '=' + m.role).sort().join(' | '), n: mem.length };
});
say('the group has both people in it', made.n === 2, made.n + ' members');
/* A group whose creator is an ordinary member is a group nobody can add
   to — the insert policy asks for an admin and there would not be one. */
say('  and the one who made it is the admin',
  /Didula Ayeshmantha=admin/.test(made.roles) && /Nimal Perera=member/.test(made.roles), made.roles);

const added = await page.evaluate(async o => {
  const k = (await Backend.searchPeople('Kamala'))[0];
  await Backend.addRoomMembers(o.room, [k.id]);
  const mem = await Backend.listRoomMembers(o.room);
  return { n: mem.length, kamala: mem.find(m => /Kamala/.test(m.name))?.role };
}, made);
/* THE THING v124 COULD NOT DO AT ALL: add somebody after the group exists. */
say('an admin can add somebody after the group was made', added.n === 3, added.n + ' members');
say('  and they come in as a member, not an admin', added.kamala === 'member', added.kamala);

/* ---------------------------------------------------------------- */
sec('3. AND AN ORDINARY MEMBER DOES NOT');

/* ASKED OF THE BACKEND DIRECTLY, not through a hidden button. The panel
   hides these controls from a member; hiding is the courtesy and this is
   the lock. */
const member = await page.evaluate(async o => {
  await Backend.signOut(); await Backend.signIn('nimal@example.com', 'password123');
  const out = {};
  const s = (await Backend.searchPeople('Sunil'))[0];
  try { await Backend.addRoomMembers(o.room, [s.id]); out.add = 'let in'; }
  catch (e) { out.add = e.message; }
  /* SOMEBODY ELSE, deliberately. Removing your OWN row is leaving, which
     every member may do — asking a member to remove themselves would have
     tested the wrong rule and passed. */
  const other = (await Backend.listRoomMembers(o.room)).find(m => !m.me && /Kamala/.test(m.name));
  try { await Backend.removeRoomMember(o.room, other.id); out.kick = 'removed'; }
  catch (e) { out.kick = e.message; }
  try { await Backend.renameRoom(o.room, 'Hijacked'); out.rename = 'renamed'; }
  catch (e) { out.rename = e.message; }
  const me = (await Backend.listRoomMembers(o.room)).find(m => m.me);
  try { await Backend.setRoomMemberRole(o.room, me.id, 'admin'); out.promote = 'promoted themselves'; }
  catch (e) { out.promote = e.message; }
  out.stillMember = (await Backend.listRoomMembers(o.room)).find(m => m.me)?.role;
  out.n = (await Backend.listRoomMembers(o.room)).length;
  return out;
}, { room: made.room });
say('a member cannot add anybody', /only a group admin/i.test(member.add), member.add);
say('  cannot remove anybody', /only a group admin/i.test(member.kick), member.kick);
say('  cannot rename the group', /only a group admin/i.test(member.rename), member.rename);
/* THE SELF-PROMOTION HOLE, asked directly. */
say('  and cannot make themselves an admin', /only a group admin/i.test(member.promote), member.promote);
say('  so they are still just a member', member.stillMember === 'member', member.stillMember);
say('  and the group is the size it was', member.n === 3, member.n + ' members');

/* A member may always leave — that is their own row. */
const left = await page.evaluate(async o => {
  await Backend.leaveRoom(o.room);
  return { rooms: (await Backend.listChatRooms()).length,
    wall: (await Backend.listDiscussions({ roomId: o.room })).length };
}, made);
say('but a member may always leave', left.rooms === 0, left.rooms + ' groups');
/* Leaving is not a filter on the client: the wall stops being readable. */
say('  and the group’s wall closes behind them', left.wall === 0, left.wall + ' posts');

/* ---------------------------------------------------------------- */
sec('4. AN ADMIN CAN HAND IT OVER, AND CLEAR UP');

const handover = await page.evaluate(async o => {
  await Backend.signOut(); await Backend.signIn('ayeshmantha@gmail.com', 'password123');
  const k = (await Backend.listRoomMembers(o.room)).find(m => /Kamala/.test(m.name));
  await Backend.setRoomMemberRole(o.room, k.id, 'admin');
  await Backend.renameRoom(o.room, 'Part 2 crew');
  const mem = await Backend.listRoomMembers(o.room);
  return { roles: mem.map(m => m.name + '=' + m.role).sort().join(' | '),
    title: (await Backend.listChatRooms()).find(r => r.id === o.room)?.title };
}, made);
say('an admin can promote somebody else', /Kamala Silva=admin/.test(handover.roles), handover.roles);
say('  and rename the group', handover.title === 'Part 2 crew', handover.title);

/* The new admin's powers are real, not cosmetic. */
const newAdmin = await page.evaluate(async o => {
  await Backend.signOut(); await Backend.signIn('kamala@example.com', 'password123');
  const s = (await Backend.searchPeople('Sunil'))[0];
  await Backend.addRoomMembers(o.room, [s.id]);
  return (await Backend.listRoomMembers(o.room)).length;
}, made);
say('  and the person promoted can actually use them', newAdmin === 3, newAdmin + ' members');

/* ---------------------------------------------------------------- */
sec('5. AND A GROUP IS NEVER LEFT WITHOUT ONE');

const lastOne = await page.evaluate(async o => {
  await Backend.signOut(); await Backend.signIn('ayeshmantha@gmail.com', 'password123');
  const out = {};
  /* Two admins: leaving is fine, somebody is still in charge. */
  try { await Backend.leaveRoom(o.room); out.first = 'left'; } catch (e) { out.first = e.message; }
  await Backend.signOut(); await Backend.signIn('kamala@example.com', 'password123');
  /* Now the only admin, with people still in the group. */
  try { await Backend.leaveRoom(o.room); out.only = 'left'; } catch (e) { out.only = e.message; }
  out.roles = (await Backend.listRoomMembers(o.room)).map(m => m.role).sort().join(',');
  return out;
}, made);
say('an admin may leave while another one remains', lastOne.first === 'left', lastOne.first);
/* THE REMEDY IS IN THE MESSAGE — "you cannot" without "do this instead" is
   a dead end. */
say('  but the ONLY admin is told to hand it over first',
  /only admin/i.test(lastOne.only) && /make somebody else an admin/i.test(lastOne.only), lastOne.only);
say('  so the group still has one', /admin/.test(lastOne.roles), lastOne.roles);

/* THE SAFETY NET, on a path the app does not drive. Removing the last
   admin straight through the membership call must not leave the group
   headless. */
const repaired = await page.evaluate(async o => {
  const me = (await Backend.listRoomMembers(o.room)).find(m => m.me);
  await Backend.removeRoomMember(o.room, me.id);          // no leaveRoom guard
  await Backend.signOut(); await Backend.signIn('sunil@example.com', 'password123');
  return (await Backend.listRoomMembers(o.room)).map(m => m.role).join(',');
}, made);
say('and if the last admin goes anyway, the group is handed on, not broken',
  /admin/.test(repaired), repaired || 'nobody left');

/* ---------------------------------------------------------------- */
sec('6. AND YOU CAN FIND ANY OF THIS WITHOUT KNOWING IT IS THERE');

/* THE REASON THIS RELEASE EXISTS AT ALL. Everything above was reachable in
   v124 only through a ＋ inside the chat dock — a place you go to chat. A
   person looking at the wall, where groups are READ, had no way to make
   one. */
const tr = readFileSync('js/tearoom.js', 'utf8');
say('the wall offers a way to make a group', /data-act="newgroup"/.test(tr));
say('  and the strip draws even for somebody with no groups at all',
  /ONE WAY IN, WHERE GROUPS ARE ACTUALLY USED/.test(tr));
say('  with a members panel on the group you are reading', /data-act="members"/.test(tr));

await page.evaluate(async () => { await Backend.signOut(); await Backend.signIn('sunil@example.com', 'password123'); });
await page.goto(B + '/index.html?r=' + Math.random() + '#/studio', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2400);
await page.evaluate(() => TeaRoom.openWall?.());
await page.waitForTimeout(1800);
const strip = await page.evaluate(() => [...document.querySelectorAll('.tw-room')].map(b => b.textContent.trim()));
say('the strip is on screen with the group and the way to make another',
  strip.some(s => /New group/.test(s)), strip.join(' | '));

/* The members panel opens and shows who is in it. */
const panel = await page.evaluate(async () => {
  [...document.querySelectorAll('.tw-room')].find(b => /Part 2 crew/.test(b.textContent))?.click();
  await new Promise(r => setTimeout(r, 1500));
  document.querySelector('[data-act="members"]')?.click();
  await new Promise(r => setTimeout(r, 1500));
  return {
    open: !!document.querySelector('#gm-body'),
    rows: [...document.querySelectorAll('.gm-row')].length,
    roles: [...document.querySelectorAll('.gm-role')].map(r => r.textContent.trim()).join(','),
    canLeave: !!document.querySelector('#gm-leave')
  };
});
say('the members panel opens', panel.open);
say('  listing everybody and what they are', panel.rows >= 1, panel.rows + ' rows — ' + panel.roles);
say('  and anybody can leave from it', panel.canLeave);

/* ---------------------------------------------------------------- */
sec('7. STAMPS');
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
