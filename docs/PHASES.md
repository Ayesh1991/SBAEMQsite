# Roadmap — the editor panel, groups, and group mocks

Where the platform is, and the order the next work should go in. One phase
per release, each shippable on its own.

## Done

| v | What |
|---|---|
| 114 | Roles — student / editor / admin, enforced in the database |
| 115 | Courses and enrolments; content tagged by course |
| 116 | Course picker, profile switcher, OSCE bank filtered |
| 117 | Every publish tags its course; "filed nowhere" warning |
| 118 | Course admin console; grades belong to the course |
| 119 | One syllabus per course |
| 120 | True/false as a real paper question type |
| 121 | One blueprint per course; papers/essays/cases filtered |
| 122 | **Phase 1** — the Editor panel, gated on the role |
| 123 | **Phase 2** — question review, and the gate |
| 124 | **Phase 3** — groups: the wall belongs to one |
| 125 | **Phase 4** — a paper the group sits together |
| 126 | **Phase 5** — true/false in the adaptive mock |
| 127 | **Phase 6** — groups have somebody in charge of them |
| 128 | **Phase 7** — one place for a group |
| 129 | **Phase 8** — a course splits into its subjects |
| 130 | A course is filled before it is opened |
| 131 | Flashcard decks belong to a course too |
| 132 | Every bank, the same two questions |
| 133 | An admin can stand in any course |
| 134 | Flashcards are revision, not part of the exam |
| 135 | A candidate's history belongs to its course |

Three exams are now fully separable: course, enrolment, syllabus,
blueprint, question types, and all five banks. The editor/groups/group-mocks
roadmap is shipped, and groups now have owners.

---

## Phase 1 — The Editor panel — DONE in v122

**Renamed "Peer review" to "Editor", shown only to editors.**

Shipped: route `#/editor` (+ `/flagged`), gated on `isEditor` with admins
counting as editors; `#/peer` redirects so no bookmark breaks; a candidate
who follows an old link gets an explanation that points them back at
flagging rather than a silent bounce; a flag count on the tab, hidden when
there is nothing waiting; a sub-navigation drawn with one tab, ready for
Question review.

Deliberately NOT moved: the admin's power to approve a proposal stays in
the developer console. v114 drew that line — an editor writes content and
sees nothing else — and an editor who could approve their own proposal
would make the approval a formality.

The original note follows, for the reasoning.

---

**Rename "Peer review" to "Editor", and show it only to editors.**

Today `#/peer` is in the nav for *everyone* and the page says "open to
everyone". Roles have existed since v114 (`user.isEditor`), so the gate is
one condition — but the page's whole premise changes with it: a public
"propose a correction, the owner approves" flow becomes an editor's
workbench.

The Editor panel holds two sections to begin with:

- **Flagged** — what `#/peer` and the console's *Question review* section
  do today, in one place. There are currently two views of the same flags,
  one at `#/peer` and one at `#/dev/review`; they should become one.
- **Question review** — Phase 2.

Smallest honest version: route `#/editor`, gated on `isEditor`, flags moved
in, `#/peer` redirecting so nobody's bookmark breaks. The existing
proposal machinery (`submitProposal`, `listProposals`, `setProposalStatus`)
and the two correction layers in `js/qedit.js` are reused, not replaced.

## Phase 2 — Question review, and the gate — DONE in v123

Shipped: `review_status` on `papers` and `osce_stations`, with the column
added as `published` so nothing already in the bank moved and the default
changed to `draft` afterwards; a trigger so a non-editor's update cannot
move it; the read policies gated, with editors exempt because content they
cannot see is content they cannot review; a `question_reviews` table keyed
on (question, editor), so the per-editor tally is a consequence of the work
and not a number anybody can type; the review queue and the one-question
editing surface at `#/editor/review`.

A typo fix does NOT send a reviewed set back to the queue — nothing writes
the status on publish, so an upsert that does not name the column leaves it
alone.

Still to come here: essays, cases, CPD and flashcards have no review state;
only the three kinds that were asked for (SBA, EMQ, OSCE) are gated.

The original note follows, for the reasoning.

---

## Phase 2 — Question review, and the gate

**The big one, and the one that changes behaviour for people already using
the site.**

A newly imported SBA/EMQ/OSCE set appears as a card in *Question review*.
An editor opens it, works through the questions, and submits. **Only then
can candidates reach it.**

Three distinct pieces, and they are worth separating because the risk is
all in the third:

1. **A review state on content.** `review_status` on the seven content
   tables — `draft` → `in_review` → `published` — plus who reviewed it and
   when. Database-enforced, like everything else that matters.

2. **The editing surface.** This is the part asked to be "award-worthy",
   and the way to earn that is *not* more features. It is: one question on
   screen at a time, the answer and explanation editable in place, keyboard
   movement between questions (`j`/`k`, `1-5` to set the answer, `Enter` to
   accept), a running count of how many are left, and no save button —
   every change saved as it is made. The reviewer should be able to clear a
   set of forty without touching the mouse. `js/quickedit.js` already does
   in-place editing of a marking point and is the model.

3. **The gate.** Existing content must be `published` on migration or the
   whole bank vanishes for everyone. New imports start `draft`. This is the
   step to be most careful with — a mistake here empties the site.

**Review counts per editor** fall out of (1): a `reviewed_by` and
`reviewed_at` per question gives the per-editor tally directly, which is
what a payment model will need. Store the count as a consequence of the
work, never as a number somebody can edit.

## Phase 3 — Groups in the Tea room — DONE in v124

Found on opening it up: **chat was already private per group**. `chat_rooms`,
`chat_members` and `is_room_member()` have kept conversations and their
files to their members since 8c-3. Only the WALL was global.

So a group IS a chat room — not a second object beside one. Shipped:
`discussions.room_id` (null = the wall everyone shares, which is how every
existing post survives); read and insert policies requiring membership;
`can_read_post()` so replies and reactions follow the post they belong to,
because leaking which posts exist and how popular they are is most of what
a private group hides; a strip on the wall to switch between everybody's
and each group's; and a member picker that SEARCHES by name or user number
instead of listing everyone with a tick-box, which stops working somewhere
around thirty people.

The original note follows, for the reasoning.

---

## Phase 3 — Groups in the Tea room

Today the Tea room is one room with everybody in it. Groups make it a set
of rooms: create a group, add people by name or user number, and the wall,
the chat and the files belong to the group.

- `groups`, `group_members` tables, RLS so a non-member cannot read a
  group's content at all — this is real privacy, not a filter.
- Member search by name or user number. User numbers already exist
  (`userNo`, assigned at sign-up) and are the reliable way to find somebody
  — names collide.
- The existing Tea room becomes the default group everybody is in, so
  nothing is lost on the day this ships.

## Phase 4 — Group mock exams — DONE in v125

Shipped: `group_papers` (name, time, length — the invitation, readable by
members), `group_paper_plan` in its OWN table so a row-level policy can
compare the clock to the start time, and `group_paper_attempts` with no
update policy at all.

The plan is sealed until the start — for the person who set it too. Asking
early does not return an empty list to be filtered; the rows never leave
the database. A countdown in the browser is a countdown anybody can skip
with a console open.

A mark is submitted once. A leaderboard that can be improved by trying
again measures persistence rather than knowledge.

The marks are readable by the whole group while the questions are not,
because a score is not an answer: knowing somebody got 72% tells you
nothing about which ones they got right.

The original note follows, for the reasoning.

---

## Phase 4 — Group mock exams

A group designs a paper from the blueprint, sets a time, and the members
sit it individually at that time; afterwards the group sees everyone's
marks together.

Built on what already exists: `js/simulator.js` builds a paper from the
blueprint, `js/quiz.js` sits it, mock results are already stored. What is
new is the *scheduling* and the *shared result*:

- a group paper: the plan, fixed, so every member sits the same questions;
- a start time and a window;
- a leaderboard over that one paper, visible to the group only.

The honest difficulty is fairness — a paper that can be opened early is not
an assessment. The question plan must not be readable before the start
time, which makes it a database rule rather than a client one.

## Phase 5 — True/false in the adaptive mock — DONE in v126

Shipped as a **mechanism with the weights left empty**. `tf_count` defaults
to zero and `blueprint_tf` to nothing, so every blueprint that exists today
produces exactly the paper it produced yesterday. The planner draws a
true/false section only when a count AND buckets both exist — either alone
would fall through to the top-up and hand out arbitrary statements dressed
as a blueprint-shaped section.

Threaded through all of it: the index, the plan, the preview, the mock
record, `bySection`, the result page, the coverage map, the history table,
and the readiness gate on the home page. The 120-minute cap lifts for a
three-section paper — that number is the length of the two-hour PGIM
SBA+EMQ paper and capping a longer blueprint there would hand a candidate
three sections in the time written for two.

Three bugs found on the way, none of which throws:

- **The Studio would have deleted the weights.** It rebuilds the blueprint
  field by field and saves it whole, so a field it does not know about is
  gone — silently, and by somebody who came to change one weight. Carried
  through now, and the panel says so.
- **The export would have deleted them too.** `toMarkdown` is offered as
  the file to paste back into `data/blueprint.md`; a section it cannot
  write disappears through the button it is documented with.
- **`bucketDefs` was keyed by name alone.** A true/false bucket is named
  the way an SBA bucket is — subcategory, then category — so one key had
  two kinds fighting over it and an SBA slot in the preview would have been
  offered the true/false bucket's specific areas. Keyed by kind and name.

The weights themselves are still a judgement about a real exam nobody on
this project has sat. They go in when Final MBBS has content, decided by
somebody holding a paper.

The original note follows, for the reasoning.

---

## Phase 5 — True/false in the adaptive mock

Deferred from v120/v121. The blueprint has no true/false weights, and
adding them means a third section threaded through the plan, the mock
record, the post-mock analysis and the coverage map. Worth doing once
Final MBBS has real content in it, and not before — the shape of the
weights should be decided by a real paper, not guessed.

## Phase 6 — Groups have somebody in charge — DONE in v127

v124 gave every member of a group identical powers, and both halves of
that were wrong in the same direction. **Any** member could add **anybody**
— being let into a study group was being handed the guest list. And nobody
could be removed but themselves, so a person added by mistake, or who left
the course, stayed reading the group's wall for ever.

Shipped: `chat_members.role`, so an admin is a member with a different role
on the row that already says they are a member — one place that knows who
is in the group, one helper that answers it. The maker of a group is its
admin. Only an admin adds, removes, renames, promotes, or clears up
somebody else's post. A member may always leave.

**Setting a group paper stayed with every member**, deliberately — asked
for and decided that way. A group that has to wait for one person to
schedule the mock is a group that does not sit one.

Three things worth keeping:

- **The migration is where the danger was.** Adding the column with a
  default of `'member'` leaves every group that already exists with NO
  admin — frozen, nobody able to add anyone ever again. The creator is
  promoted, and a room whose creator is gone hands it to whoever joined
  first. Same shape as v123's.
- **Your own membership row has to stay writable** — `last_read_at` lives
  on it — so the policy cannot be the guard on the `role` column or every
  member could promote themselves. A trigger is, exactly as in v123.
- **The last admin leaving is repaired, not refused.** A trigger that
  raised would also fire on the cascade from closing an account, and a rule
  about study groups may not hold somebody's account hostage. So the group
  is handed to the next member. The app refuses first, with the remedy in
  the message, so the repair only ever fires on paths the UI does not
  drive.

And the reason the release existed at all: **none of this was findable.**
Creating a group was a `＋` inside the chat dock — a place you go to chat.
Somebody looking at the wall, where groups are read, had no way to make
one. The wall strip now always draws, carrying `＋ New group` and, on the
group you are reading, `👥 Members`.

Not built, deliberately: invite links and request-to-join. Groups are
**closed** — an admin adds you by name or user number, or you are not in.
There is no code to leak and no pending queue for somebody to forget.

---

## Phase 7 — One place for a group — DONE in v128

A group was spread over three surfaces that did not mention each other.
Its chat was in a dock you opened from a button. Its wall was a strip on
the Studio wall. Its papers were at `#/group/<id>`.

And the strip — the only way to reach a group's wall — was drawn by
`paintWallRooms`, which **`renderPanel` never called**. `renderPanel` is
the full-page Studio wall: the one almost everybody actually reads. So on
that page there was no way to open a group's wall, and after v127 no way
to make a group either. Both features existed; neither was reachable from
where people were standing. That is the shape worth remembering — not a
function that threw, but a surface that was never given one.

Shipped: `js/group.js` (`Group`, **not** `GroupPaper`), a page per group
with five tabs — Wall, Chat, Files, Papers, Members — plus `#/groups`
listing the groups you are in, and a Studio tile pointing at it.

**Nothing here is a second implementation.** Each tab mounts whoever
already owned that job: `renderPanel` for the wall (now taking a room),
`renderChatPanel` for the chat, `GroupPaper.renderList` for the papers.
A second copy of the wall would be a second thing to keep in step with the
first, and the first is the one with four releases of fixes in it.

Three things that had to change underneath:

- **`renderPanel` takes a `roomId`.** Same posts, same composer, addressed
  to the group. Switching wall drops what was loaded rather than filtering
  it — a post left over from the last wall appearing in this one is the
  bug v124 was about.
- **`paintChat` walked one element.** It now walks every live host, so the
  same conversation can be in the dock and inside a page at once.
- **Files had nowhere to be seen together.** They were already on the
  posts and the messages; `groupFiles()` gathers both, each source guarded
  so one failing does not empty the other.

A page is a nicer way to reach a group. It is **not** a way in — the
database still answers that, and §3 of the test is the proof a page did
not quietly become a door.

---

## Phase 8 — A course splits into its subjects — DONE in v129

A final MBBS bank is five banks. Obstetrics, medicine, surgery,
paediatrics and psychiatry all belong to one course, and a candidate
revising O&G has no use for the other four in the same list.

v115 put a `subjects` list on a course. v116 gave the OSCE bank a subject
bar. Then it stopped — and what was missing was the middle, in the way
that is hardest to see: **every piece existed and nothing joined them.**
`subject` was a column on seven tables, `Course.fitsSubject` was written
and exported, `Course.subjectBar` drew the chips — and **nothing wrote the
column** for a course with more than one subject. `contentTags()` infers
it only when a course has exactly one speciality, which is precisely the
case where it does not matter. A final MBBS paper reached the database
with `subject = null`.

Same failure as v117's: a filter cannot filter on what nothing ever wrote.

Shipped: a subject picker in the papers, OSCE and essay importers, shown
only when the chosen course has more than one subject and redrawn when the
course changes; one `stampCourse()` that writes both tags, because four
importers each doing it by hand is four chances to forget; and the subject
chips on the question bank and the essay bank, which only the OSCE bank
had.

The essay importer had **neither** picker — not even the course one — so
an essay paper could reach the database filed nowhere at all.

**Unfiled is still shown.** A paper whose subject somebody forgot appears
under every subject, the same rule as `Course.fits` and for the same
reason: hiding it would lose it from its own author's bank with nothing to
say why.

Also shipped: `data/samples/` — four import files in the exact shapes the
importers accept, and a README saying what the validator will stop you on.
t129 imports the sample paper through the real validator, so a sample that
would not import fails the suite.

Still to do here: **cases** have no subject picker, and the subject is not
editable after import — a paper filed under the wrong subject has to be
re-imported. Both are small and neither blocks the pipeline.

---

## v130 — A course is filled before it is opened

Not a phase: a bug found the first time somebody tried to use v129 for
real.

The course admin page makes a promise in as many words: *"A course can be
built and filled long before it is opened — until Open is ticked nobody
can choose it and nothing tagged to it reaches anybody."* The importer's
course picker offered `Course.live()` — the courses a **candidate** may
choose. So the course you were filling was the one course you could not
select.

And it compounded. One live course is not a choice, so the picker hid
itself; with the picker hidden `pickedCourse()` returns nothing; and
`contentTags()` then stamps the **editor's own** course on the import. The
questions went somewhere real and plausible and wrong, with nothing
thrown — and the published-papers table never showed a paper's course, so
there was nothing to notice afterwards either.

Three things in one failure, each defensible alone: the wrong **list**, a
control that **hides itself** when the list comes back short, and a
**fallback that always succeeds**.

Fixed: both pickers (the importer's and the "filed nowhere" panel's) list
every course that exists, marking the ones not open yet. And the
published-papers table now shows each paper's course and subject, with a
**move** that re-files it in place through the same `fileUnder()` the
unfiled panel uses — content mis-filed by a bug has to be fixable by the
person who hit it, without unpublishing and importing again.

---

## v131 — Flashcard decks belong to a course too

The fourth bank, and the one that was never joined up. v116 filtered the
OSCE bank by course, v121 did papers, essays and cases, v129 added the
subject below that. **Flashcard decks were in none of it** — every
published deck reached every candidate, whichever exam they were sitting.

And the read is why, for the third time:
`getFlashcardDecks` asked for `id,meta` — neither tag — and then mapped
straight to `r.meta`, so the columns could not have survived even if they
had been selected. `publishFlashcardDeck` has stamped `tracks` and
`subject` since v117. *A filter cannot filter on what the read never
returned.*

Shipped: the read brings both tags back and keeps them on the deck; the
deck list filters by course and subject and draws the subject chips; the
flashcard importer gained the course and subject pickers it never had.

Two details worth keeping:

- **A personal deck is never filtered.** Cards made from your own wrong
  answers are yours, and hiding them because nobody tagged them with a
  course would be taking your own notes away from you.
- **An empty list has two causes and they need different sentences.** "No
  decks published yet" is a lie when there are decks and a chip is hiding
  them, and it sends somebody to the importer to fix a filter.

Also: a generated deck file carries `due`, `interval`, `easeFactor` and
`reps`. Those describe **one person's** schedule and must not enter a
shared deck. `buildDeckMeta` drops them by naming the four fields it
keeps, and t131 is the test that it still does.

Still to do: **cases** remain the one bank with no subject picker, and
the `move` control added in v130 covers papers only.

---

## v132 — Every bank, the same two questions

Five banks, five importers, and they were never done at once. Papers,
OSCE and essays got the course and subject pickers in v129; flashcard
decks in v131; **cases had neither until now**, so a case could only ever
be filed under whichever course the editor happened to be on. And the
repair added in v130 — change a published row's course without
unpublishing it — existed **for papers alone**, leaving the other four
fixable only by importing them again.

The pattern worth naming is not any one of those gaps. It is that each
was closed on its own, in a different release, and the one left out was
never the same one twice. So t132 asks the **same question of all five**,
in a shape that fails for whichever is missing next time.

Shipped: the cases importer gained both pickers and a subject filter on
the case bank; every published list shows a Course column and a move
control; and all five importers now write their tags through the one
`stampCourse()`. **Papers and OSCE did not** — papers spread the two tags
inline, OSCE set them a third way — which is exactly how an importer ends
up being the one nobody updates. t132 caught that in its first run.

### The one nobody would have found

`getPublishedPapers` and `getOsceStations` ask the server to project
fields out of JSON and **fall back to reading whole rows** if it will not.
The fallback said `select('id,meta')` — no `tracks`, no `subject`.

It is a path that only runs when something is already wrong, and on it
every filter would have silently opened: untagged content is *shown*, so a
candidate would have been handed another course's bank with nothing to say
so. A fallback may be slower. It may not be looser.

---

## v133 — An admin can stand in any course

The developer could reach every course's **content** and look at none of
it. The console lists all courses and files into any of them (v130), and
the database has always agreed — `can_read_tracks()` begins
`public.is_editor()`. But the site *outside* the console shows one course:
the one you are on. The only way to change that, the profile picker,
offered `Course.live()` — so the course being built, precisely the one
worth looking at, was the one that could not be chosen.

**v130 fixed this exact mistake twice already** (the importer's picker and
the "filed nowhere" panel). It was in a third place.

The half that was not a display problem: opening the picker is no use if
choosing is refused, and local `enrol()` threw on any course that is not
live — admins included. The cloud does not: `enrolments own insert`
requires `is_live` and `enrolments admin all` overrides it. So the admin's
own switch worked in production and failed in testing, which is the wrong
way round.

**Admin, not editor.** The database permits this through `is_admin()` and
nothing weaker, so offering it to an editor would be offering a control
that refuses them.

Shipped: `Course.picker(id, name, {all:true})`; the profile offering every
course to an admin, marked *being built*; a stand-in switch on the console
hub, where the work happens; and local `enrol()` saying what the cloud
says.

Also `docs/CURRICULUM-HANDOVER.md` — a self-contained brief for the
separate project that writes questions from past papers, so it can
generate a curriculum tree this app imports. §4 of t133 asserts the
document still matches the importer: the id prefixes, the merge-never-
delete promise, the tags default, and the two-pass matcher. **A document
that drifts from the code is worse than none, because it is believed.**

---

## v134 — Flashcards are revision, not part of the exam

Theory is the exam: the question bank, the mocks, the essays, the
mistakes a paper produces. Spaced repetition is done on a different day
for a different reason, and sitting it in Theory's sub-nav — between
Essay and My mistakes — said it was one more component of a paper. It is
a tab of its own now, and `#/cards` no longer lights Theory.

**And the decks built from a candidate's own mistakes do not go with it.**
They were merged in at the top of the deck library, which put *"Mock 7 —
what you got wrong"* beside the published revision decks and made the
library a mixture of somebody's study material and their errors. They
belong to the paper that produced them, so they stay on **My mistakes**,
under Theory, with the rest of that work.

`Flashcards.mine()` is the one definition of which decks those are — the
Mistakes page had its own copy of the same filter and now asks for it.

### The half that would have broken quietly

A deck is **sat** the same way wherever it was opened from, and
`renderDeck` looked it up in the library list. Removing the personal
decks from that list without touching `renderDeck` would have made every
mistake deck answer *"that deck is no longer published"* — from a link on
a page that had just counted it. It searches both lists now, and §3 of
t134 is that link.

---

## v135 — A candidate's history belongs to the course it was made on

Content has been course-tagged since v115. A candidate's **own history**
never was. So standing in final MBBS showed twenty-four Part 2 mocks, a
last score of 78% earned on another exam, and mistake decks full of O&G.

That is the mild half. **The weakness profile is computed from that
history** — `loadHistory()` decays every mock by age and aggregates per
bucket, and `select()` up-weights the buckets the candidate is weak in.
With the wrong exam's history in it, the wrong exam was steering the
right one, and since the bucket names of one exam do not appear in the
other's blueprint the steering was not merely wrong but noise.

Mocks and mistake decks are now stamped with the course on write and
filtered by it on read, in both backends. **A row with no track was
written when `pgim-og-2` was the only course there was** — a fact about
this deployment's history, not a guess, and the same reasoning the v119
curriculum and v121 blueprint migrations used. A mock asked for *by id*
is never hidden: a review link should open the mock it names.

### Why the MBBS mock could not start

The readiness gate demanded ten unseen EMQs of **every** course. The
final MBBS paper has no EMQ section — it is SBA and true/false — so the
button stayed disabled and the reason given was *"not enough unseen
questions, EMQ unseen: 0"*: a shortage of something nobody had asked for.

Each section is now required only if the blueprint wants it, by the same
test the planner uses to decide whether to draw one. A blueprint that
asks for **nothing** is refused separately, or the gate passes vacuously
and `select()` falls to the top-up — arbitrary questions dressed as a
blueprint-shaped mock, which v121 §4 exists to refuse.

**Three states needed three sentences.** "Not enough unseen questions"
sends somebody to import more papers; importing cannot fix an empty
blueprint. That case now says so, and names the course.

Also `docs/BLUEPRINT-HANDOVER.md`, the companion to the curriculum brief,
for the project that knows the exam's shape. §5 of t135 asserts it still
matches the parser — including the trap that omitting `emq_count` leaves
it at **30**, so a section is removed by dropping its **bucket list**.

---

## v136 — A second edition, and archiving that keeps the history

The O&G Part 2 bank holds **8000+ SBAs and EMQs written before the review
flow existed**. They are being re-made from the sources and reviewed; the
question was how to run the new bank and the old one at once without the
candidate seeing both, and without the bank emptying for a year while the
work is done.

**`edition` is a property of a paper, not a category in the curriculum.**
Putting the two generations in separate curriculum branches was the
obvious move and the wrong one: topic browsing, the blueprint's bucket
names and every question key would all have forked — and since
`Data.flatten()` decides question keys, a candidate's whole history would
have detached from the questions it belongs to.

**It is not `review_status` either.** That column answers *has a human
checked this*; edition answers *which generation is it*. A second-edition
paper still goes draft → in_review → published, and most of the new work
sits at "2nd edition, not yet reviewed" for months — a state one column
cannot express.

**The migration keeps v123's shape:** add the column with the default the
rows that already exist need (`1`), *then* move the default to `2` for
everything imported from now on. Either half alone is wrong, and
re-running the file is safe.

### Newest per topic, not a switch

A global "show 2nd edition" toggle would hide every topic nobody has
re-made yet — which is most topics, for most of the year. So the rule is
**the newest edition of each topic**: a topic improves the day its
replacement is live, and nothing else moves. `Course.newestEdition()` is
the one place that decides it, and all five banks ask it.

Untagged content follows the rule it follows everywhere else: **two papers
with no topic are not two editions of one thing.** Unfiled is not
irrelevant.

### Archiving is not deleting

`unpublishPaper()` removes the row — and `js/review.js` loads the paper to
render the questions of an attempt somebody already sat. Deleting the old
bank would have kept every mark and destroyed every candidate's ability to
see what they answered.

So archiving is a **timestamp on the row**. Nothing in section 38 narrows
what may be *read*: an archived row is readable by exactly the people it
was readable by before. What changes is whether it is worth **showing**,
and that is the client's filter — rule 4, again. A future release will be
tempted to tidy this up by adding `archived_at is null` to a read policy;
t136 §1 refuses that.

### What this release found in the last one

v132 put a move control on all five published lists and **wired four of
them.** The OSCE list rendered the button and listened for nothing, so it
did nothing and said nothing either. t132 asserted the button *exists*,
then drove a deck to prove moving works — which is exactly the hole left
by testing markup instead of behaviour. t136 §5 drives the OSCE button.

t136 §2b came out of a mistake in its own first draft: the fixture used
topic `t-pph`, which is a **real** topic in `data/manifest.json`, so the
shipped PPH paper became a genuine earlier edition of the fixture and the
test failed — correctly. That is now asserted on purpose: a 2nd edition
stands down the paper the site actually ships, the bank does not grow, and
withdrawing the re-make brings the original back.

---

## v137 — The re-make backlog

v136 made two editions able to coexist. It did not answer the question an
editor actually has: of 8000+ questions, how far through am I, what is
next, and what is safe to put away. `#/dev/remake` answers it.

**The bar counts questions, not topics.** The topics are wildly uneven —
one holds 400 questions and the next holds 12 — so a topic count flatters
the work. In the test's fixture, three small finished topics and one big
untouched one read as **75% done by topics and 3% by questions**. Both
numbers are shown; the question one is the bar.

### Five states, because four of them want different actions

| State | Means | What to do |
|---|---|---|
| no paper yet | in the syllabus, nothing imported | import — not a re-make |
| not started | 1st edition only | the work |
| in review | a 2nd edition written, not yet published | wait |
| **ready to put away** | 2nd edition live, 1st still live | **archive it** |
| done | 2nd live, 1st archived | nothing |

**The page exists for the fourth row.** When a 2nd edition goes live the
1st is superseded but still live, so it is still offered under "also show
the earlier questions". *Nothing looks broken from any other screen* — the
candidate's bank already shows the newest — so those papers sit there
indefinitely unless something counts them. Every other state is
information; that one is a job, and it has a one-click bulk control.

### Two bugs this release found

**A "put away" control on a not-started topic.** The first draft returned
every first-edition paper as archivable, so a topic nobody had touched was
offered the control — and taking it would have archived the only edition
that topic had, leaving the candidate no questions and no replacement
coming. `archivable` now means **superseded**, which is only ever true
once a replacement is live. t137 §3 asks all three states directly, rather
than noticing by accident as the first run did.

**A console section the router did not list.** `renderRemakeSection`
existed, the hub card pointed at it, and `#/dev/remake` rendered the hub —
because `js/app.js` matches dev sections against an explicit list and the
new name was not in it. Nothing failed and nothing said why the link went
nowhere. The route list now carries a comment saying it must be added in
both places.

### And the read that must carry the topic — the sixth time

"In review" can only be told from "nobody has started" by reading the
**topic** of a paper awaiting review, and `listForReview()`'s projection
did not select it — in either backend. A filter cannot filter on what the
read never returned: v117, v121, v129, v131, v132, and here. The
difference this time is that the page would not have failed, it would have
shown the wrong state.

---

## v138 — Asking the right room

Groups have existed since v127 and a question could not be asked in one.
"Discuss with friends" under a rationale called `TeaRoom.share()`, which
called `post()`, which took the room **from the open wall**.

That rule is right where it was written. On the wall's own composer,
taking the destination from what you are looking at is exactly what makes
it impossible to read one group and post to another, and the comment
saying so has been there since v127.

**But the rule needs a view.** Sitting a paper there is no wall on
screen, so the question went wherever the wall had last been left —
invisibly, and in practice always "everyone". Somebody in four groups
could not ask one of them. So the Discuss box now asks, at the only
moment the asker knows the answer, and remembers the group asked last
because a candidate works through a paper one question at a time.

`share(ctx, topic, roomId)` takes the room explicitly; `undefined` still
means "the wall I am looking at", so every older caller behaves as it
did. The confirmation names the destination — "Posted to the tea room"
was true of four different places and said which of them none.

### The wall is a feed

A picker alone would have made a group's question somewhere you have to
go and look. The wall is now **three states, not two**:

| | shows |
|---|---|
| `'feed'` | the shared wall **plus every group I am in** — the default |
| `null` | the shared wall exactly (`room_id is null`) |
| `'<id>'` | one group |

Only the feed mixes rooms. Asking for the shared wall still means
`room_id is null` exactly, because a member of three groups must not find
all three mixed into the wall they thought was everybody's — the same
rule, and the same comment, that v127 wrote.

Each post on the feed is badged with where it came from; on a single wall
that badge would be noise, so it is not drawn. On the feed the composer
has no single destination to infer, so it asks; on a single wall it does
not. `wallQuery()` is the one definition of what the open wall wants, and
the first read, the poll and "load older" all use it — **a list that
merges while the poll does not would show a group's new post on reload
and never live**, which reads as the group being quiet.

**The panel does not grow a second strip** — the first draft of this
release gave it one, and the suite refused it. `wallRoom` is a single
piece of module state, so two switchers over it means clicking either
leaves the other's header naming the wall you just left. v128 made that
exact mistake, t124 caught it then, and t124 caught it again now. The way
into a group from the feed is **the badge**, which already names the
group: it is a link to that group's page.

### Two groups are two groups

Found on the way: local rooms were `'r' + Date.now()` with no random
suffix, while every other id in that file has one. Two groups made in the
same millisecond shared an id — and with it their members, posts, chat
and files. Chat messages had the same flaw. Both fixed, and t138 §5 makes
eight groups in a burst and counts them.

---

## v139 — The sponsored pre-roll, and a number that can be defended

Supabase costs $25–40 a month and the candidates are registrars on a
registrar's salary. A five-second message from a pharmaceutical sponsor
pays the bill instead of charging them. This is the first feature here
whose output is read by **somebody outside the project**, which changes
what "finished" means.

### The first rule is that it never stops somebody studying

Every failure path ends with the app open: no campaign, no network, a
video that will not decode, autoplay refused, an exception anywhere.
`maybeShow()` resolves for all of them and throws for none.

The test gets this honestly rather than by mocking. **Playwright's
Chromium ships without H.264** — a licensed codec — so `ads/sample-5s.mp4`
is a genuinely undecodable video in that container. t139 §4 plays it and
asserts the candidate is in the app in milliseconds with nothing counted.
`sample-5s.webm` (VP9) exists only so the suite can drive the *working*
path; a sponsor is always sent MP4, because Safari is patchy on WebM.

### What a sponsor is actually sold

A browser can always lie about having watched a video. That is not
fixable in a static app, and claiming otherwise would be the dishonest
part — so the claim is deliberately modest and the **database** keeps it,
not the client:

- **one impression per candidate per campaign per day** — a unique index
  on `(campaign_id, user_id, day)`, so a refresh loop cannot inflate it
  and neither can a tampered client;
- dated by the **server's** clock, so a device with its clock wound back
  is not a fresh impression;
- filed under the viewer's own id by the insert policy;
- only for a campaign that is live, approved and in date.

The report therefore leads with **Doctors** — distinct accounts — and
shows *Impressions* second. Impressions is the number everyone asks for
and the weaker of the two.

Watched time is **playback time**, accumulated from `timeupdate` while
actually playing, so a backgrounded tab and a paused video earn nothing.
The skip unlocks and the impression counts at the **same** three seconds,
deliberately: somebody who skips the instant they may has still watched
what the sponsor paid for, so there is nothing to argue about at the end
of the month.

### Approval is a gate, not a note

NMRA rules restrict advertising prescription medicines to the public, so
nothing is served until a named person approves it, and the approver and
the moment are recorded. **Changing the video, title, sponsor or length
drops that approval** — a database trigger does it, not the page —
because an approval that survives a swapped creative is theatre. The
campaign falls back to draft and stops being served instantly.

### The rest of the shape

- **Free accounts only.** The `plan` column exists before the paid tier
  does, because a candidate who has paid and is still advertised to is
  the complaint that follows one. Editors and admins are exempt: staff,
  not the audience.
- **Self-hosted MP4 on Cloudflare**, never a YouTube embed — their terms
  do not allow the embedded player to serve your own advertising, and an
  embed cannot be counted. Self-hosting also means zero Supabase egress.
  The console says so where the URL is typed.
- **`#/about-ads`** tells a candidate what is recorded and, more to the
  point, what is not: no name, no e-mail, nothing they study, no
  third-party network, no cross-site cookie.

### Verified against a real Postgres

Section 39 was executed against PostgreSQL 16 with RLS enforced as an
unprivileged role, not read over. That caught the first harness being
wrong — `psql` as superuser **bypasses RLS entirely**, so the first run
"passed" a test that should have failed. As `authenticated`: recording
somebody else's impression is refused, a second impression the same day
is refused, a candidate reads zero rows of the tally, cannot approve a
campaign, and cannot create one that is already live.

---

## Not on this list, deliberately

- **A build step.** It has been proposed twice and refused twice. 54 script
  tags load in a fixed order and the site is served exactly as committed;
  that is slower for the browser and much safer for a project where one
  person's mistake is a white page for everybody. Revisit when the team is
  big enough that the load order is the problem.
- **Moodle integration.** Decided against: ten faculties means ten Moodles,
  practice has to stay private, and it drags AUREUM into the assessment
  chain.
- **A graduation gate.** Unverifiable. Course choice is the candidate's own
  statement; entitlement is granted by an admin.
