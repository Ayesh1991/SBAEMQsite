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

Three exams are now fully separable: course, enrolment, syllabus,
blueprint, question types, and all five banks.

---

## Phase 1 — The Editor panel

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

## Phase 5 — True/false in the adaptive mock

Deferred from v120/v121. The blueprint has no true/false weights, and
adding them means a third section threaded through the plan, the mock
record, the post-mock analysis and the coverage map. Worth doing once
Final MBBS has real content in it, and not before — the shape of the
weights should be decided by a real paper, not guessed.

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
