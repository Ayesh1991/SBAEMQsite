# Handover — generating a curriculum for AUREUM

For the Claude project that writes SBA / true-false / EMQ questions from
past papers. This is everything that project needs to produce a
**curriculum tree** AUREUM can import, and to file its questions against
it correctly. It assumes no access to the AUREUM repository.

---

## 1. Why AUREUM needs a curriculum at all

AUREUM is a question bank for Sri Lankan medical exams. Every paper it
holds is **filed under one topic**, and the library is a browsable tree of
those topics. Three consequences follow, and they are the reason this
document exists:

- **A course with no curriculum can hold no papers.** The import screen
  asks for a category, a section and a topic, and if the tree is empty
  there is nothing to choose. The curriculum must be loaded **before** any
  question paper is imported.
- **The tree is per exam.** Anatomy and Physiology are a Part 1
  candidate's categories and nobody else's. One tree per course, never
  shared.
- **Topic `tags` are how papers get classified automatically.** A topic's
  tags are the phrases the importer looks for when it suggests where a
  paper belongs. Bad tags mean every paper is filed by hand.

---

## 2. The shape of the file

Three levels, always: **category → section → topic**. Nothing deeper,
nothing shallower.

```json
{
  "categories": [
    {
      "id": "obgyn",
      "title": "Obstetrics & Gynaecology",
      "sections": [
        {
          "id": "obs-antenatal",
          "title": "Antenatal care",
          "topics": [
            {
              "id": "t-preconception",
              "title": "Pre-conceptional counselling",
              "tags": ["Pre-conceptional counselling", "pre-pregnancy counselling", "folic acid"]
            },
            {
              "id": "t-routine-anc",
              "title": "Routine antenatal care",
              "tags": ["Routine antenatal care", "booking visit", "antenatal schedule"]
            }
          ]
        }
      ]
    }
  ]
}
```

### What is required and what is not

| Field | Level | Required | If left out |
|---|---|---|---|
| `title` | all three | **yes** | the import is refused, naming the offender |
| `id` | all three | no | generated from the title (`"Antenatal care"` → `sec-antenatal-care`) |
| `tags` | topic | no | defaults to `[title]` |
| `sections` | category | no | a category with no sections is allowed but useless |
| `topics` | section | no | same |

**Prefer leaving `id` out.** Inventing a slug for each of eighty topics is
how a tree ends up with typos in its keys, and the ids are not shown to
anyone. Supply an `id` only when you are *re-generating* a tree that is
already loaded and the ids must line up — see §6.

A bare array of categories is also accepted:
`[ { "title": "...", "sections": [...] }, ... ]`

---

## 3. How to write good `tags`

This is the field that does real work and the easiest to do badly.

When a paper is imported, AUREUM takes **one string** — the paper's
`folderTag` if it has one, else its `topic`, else the Drive folder name or
the file name — and looks for a topic whose tags match it.

It matches in two passes:

1. **Exact** — a tag equal to the string, ignoring case.
2. **Loose** — a tag that *contains* the string, or is *contained by* it.

**The first match wins. There is no scoring and no best-match.** Whichever
topic the tree reaches first is the one chosen, so two topics sharing a
tag is resolved by position, not by quality.

```json
"tags": [
  "Postpartum haemorrhage",        // the topic's own words
  "primary postpartum haemorrhage",
  "atonic uterus"                  // a phrase a paper on this would use
]
```

- **3–6 tags per topic** is the useful range. One is thin; fifteen starts
  matching other topics' papers.
- **Do not include generic words** — "management", "diagnosis",
  "obstetrics", "approach". They match everything and so decide nothing.
- **Be careful with short abbreviations.** Because of the loose pass, a
  three-letter tag matches anything containing those letters: `PET` also
  matches *pethidine* and *competency*, and the first topic reached wins.
  Use the abbreviation only inside a longer phrase — `"PET pre-eclampsia"`
  — or leave it out and rely on the full term.
- Case and punctuation do not matter.
- Tags are **not** shown to candidates. Write them for matching, not for
  reading.

**The reliable way to classify automatically** is to make the generator
emit a `folderTag` on each paper that is *exactly* one of the topic's
tags. Then the first pass hits, the loose pass never runs, and no paper is
filed by guesswork.

---

## 4. How deep, and how wide

For scale: AUREUM's existing PGIM MD O&G Part 2 tree is **5 categories,
25 sections, 105 topics** and that has proved comfortable. Use it as the
target shape for one exam.

- **Category** — the big division a candidate thinks in. For a
  single-speciality exam these are the clinical divisions (Obstetrics,
  Gynaecology, Reproductive medicine…). **For a multi-subject exam such as
  final MBBS, make the categories the subjects themselves** — Medicine,
  Surgery, Obstetrics & Gynaecology, Paediatrics, Psychiatry — because
  that is how an undergraduate revises and how the library will read.
- **Section** — a teaching block inside it. 4–8 per category.
- **Topic** — one examinable thing, the size of a single question's
  subject. 3–8 per section.

A topic should be small enough that a paper is plainly *about* it. "Labour"
is too big; "Management of the second stage" is right.

---

## 5. Subjects are a separate tag, and both are needed

For a multi-subject course, AUREUM has a **`subject`** field on every
piece of content, used to draw the "All subjects · Medicine · Surgery · …"
chips across all five banks.

The valid subject ids are fixed and you must use exactly these strings:

```
obgyn   medicine   surgery   paediatrics   psychiatry   anaesthesiology
```

`subject` is **not** part of the curriculum file. It is chosen in the
import screen when content is loaded. But when you generate papers, keep
them consistent: a paper filed under a topic in the *Obstetrics &
Gynaecology* category should be imported with subject `obgyn`.

---

## 6. Loading it

In AUREUM: **Developer → SBA / EMQ importer → Manage curriculum**.

1. Set **"Editing the syllabus for"** to the right course. *Do this
   first* — everything below it is aimed at the chosen course, and there
   is no undo for aiming it at the wrong one.
2. Open **"Paste a whole tree"**.
3. Paste the JSON, press **Merge into this course**.
4. It reports what it added: *"Merged 5 categories, 25 sections and 105
   topics."*

**The import MERGES; it never deletes.** Running it twice adds nothing the
second time, and nothing already in the tree is removed. That is
deliberate — a syllabus accumulates and a bulk import must not be able to
wipe one.

Two consequences worth planning for:

- **Deliver the tree in parts if it is large.** Five separate pastes, one
  per subject, is easier to check than one of 500 topics — and because it
  merges, the order does not matter.
- **A wrong title cannot be fixed by re-pasting.** Merging adds the
  corrected one *beside* the mistake. Either supply explicit `id`s so a
  re-paste lines up, or fix the stray entry by hand afterwards.

---

## 7. Filing questions against the tree

Once the curriculum is loaded, each question paper is imported with three
ids naming its place:

```json
{
  "categoryId": "obgyn",
  "sectionId":  "obs-antenatal",
  "topicId":    "t-preconception"
}
```

These must be the **ids from the curriculum**, not the titles. If you let
AUREUM generate the ids (recommended), read them back from the tree before
generating papers — or simply let the import screen's three dropdowns pick
the topic, which is what they are for.

Easier still: put a `folderTag` on the paper matching one of the topic's
tags exactly, and the three dropdowns arrive already set to the right
topic.

```json
{ "topic": "Postpartum haemorrhage — Paper 3",
  "folderTag": "Postpartum haemorrhage",
  "sba": [ ... ] }
```

The question paper format itself is separate from this document; the
importer refuses a file that does not match it and says why. The one rule
worth repeating because it is silently destructive if ignored:

> **A true/false `answer` must be `true` or `false` — never a number.**
> `0` reads as both "the first option, True" and "the value false", and
> those are opposites. A number would invert the mark on every statement
> in the file and look exactly like a candidate who got them all wrong.

SBA and EMQ answers *are* numbers: a **0-based index** into that
question's `options`.

---

## 8. A checklist before handing a tree over

- [ ] Three levels everywhere: category → section → topic.
- [ ] Every category, section and topic has a `title`.
- [ ] `id` omitted throughout, unless re-generating an existing tree.
- [ ] Each topic has 3–6 `tags`: no generic words, no bare short abbreviations.
- [ ] No tag appears under two topics (the first one reached would win).
- [ ] Topics are small enough that a paper is plainly about one of them.
- [ ] For a multi-subject exam, categories are the subjects.
- [ ] Valid JSON — one object with a `categories` array.
- [ ] Split into one file per category if it is large.
