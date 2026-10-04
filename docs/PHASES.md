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

---

## Not on this list, deliberately

- **A build step.** It has been proposed twice and refused twice. 51 script
  tags load in a fixed order and the site is served exactly as committed;
  that is slower for the browser and much safer for a project where one
  person's mistake is a white page for everybody. Revisit when the team is
  big enough that the load order is the problem.
- **Moodle integration.** Decided against: ten faculties means ten Moodles,
  practice has to stay private, and it drags AUREUM into the assessment
  chain.
- **A graduation gate.** Unverifiable. Course choice is the candidate's own
  statement; entitlement is granted by an admin.
