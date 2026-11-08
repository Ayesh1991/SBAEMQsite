# Handover — generating an exam blueprint for AUREUM

For the Claude project that holds knowledge of an exam's shape from its
past papers. This is everything that project needs to produce a
**blueprint** AUREUM can upload. It assumes no access to the AUREUM
repository.

Companion document: `CURRICULUM-HANDOVER.md`, which covers the *topic
tree*. The two are different things and both are needed — see §2.

---

## 1. What a blueprint is, and what it does

A blueprint is **the shape of one exam**: how many questions of each kind,
how long, and what share of the paper each topic is worth.

AUREUM uses it to build the **daily adaptive mock**. Every morning it
turns the weights into target counts, picks that many questions from the
live bank for each topic, avoids anything the candidate has already seen,
and tilts towards their weak areas. Without a blueprint there is no mock
at all — the page says so rather than inventing one, because a mock built
from no weights is thirty arbitrary questions wearing the word
"blueprint".

**One blueprint per course.** A final MBBS mock sampled from Part 2
weights is a Part 2 paper under another name.

---

## 2. It is not the curriculum, and it must agree with it

| | Curriculum | Blueprint |
|---|---|---|
| Answers | *What topics exist?* | *How much is each worth?* |
| Shape | category → section → topic | a flat list of weighted buckets |
| Used by | the library, filing papers | the mock generator |

**The link between them is the bucket name.** A blueprint bucket's
`subcategory` (SBA, T/F) or `theme` (EMQ) is matched against the bank, so
it must name something the questions actually carry. Write the blueprint
*after* the curriculum, using the same words.

---

## 3. The file

A Markdown file with a YAML front-matter block between `---` lines.
Everything below the closing `---` is free prose and ignored by the
parser, so notes and workings may be kept there.

```markdown
---
blueprint: mbbs-final-obgyn
track: mbbs-final
version: 1
updated: 2026-10-12
source_papers:
  - "Final MBBS O&G 2023 (recall)"
  - "Final MBBS O&G 2024 (recall)"
paper:
  sba_count: 40
  tf_count: 20
  duration_min: 150
  sba_mark_each: 1
  tf_mark_each: 1
  negative_marking: false

blueprint_sba:
  - category: "Obstetrics"
    subcategory: "Antenatal care"
    weight: 12
    specific_areas:
      - "Booking visit and routine screening"
      - "Anaemia in pregnancy"
  - category: "Gynaecology"
    subcategory: "Abnormal uterine bleeding"
    weight: 8
    specific_areas:
      - "Heavy menstrual bleeding in the perimenopause"

blueprint_tf:
  - category: "Obstetrics"
    subcategory: "Hypertensive disorders"
    weight: 25
    specific_areas:
      - "Pre-eclampsia definition and screening"
      - "Eclampsia management"

priority_topics:
  - match: "pre-eclampsia"
    boost: 1.4
---

Free notes below the front matter. Anything here is ignored by the parser.
```

### `track` — get this right

`track` is the course id. **The blueprint is the fallback only for the
course it names**; given to any other course it is ignored. For final
MBBS this is `mbbs-final` — confirm the exact id in AUREUM under
**Developer → Courses → Short code** before generating.

### `paper` — the shape

| Key | Meaning | Default if omitted |
|---|---|---|
| `sba_count` | SBAs in one mock | 30 |
| `emq_count` | EMQ stems in one mock | 30 |
| `tf_count` | true/false statements in one mock | **0** |
| `duration_min` | minutes allowed | 180 |
| `sba_mark_each` / `emq_mark_each` / `tf_mark_each` | marks per question | 3 / 3 / 1 |
| `negative_marking` | `true` or `false` | false |

**A section appears only if it has BOTH a count above zero and at least
one bucket.** The bucket list is the part that really decides it, and
this is worth being precise about:

- Omitting `emq_count` does **not** give you zero — it defaults to **30**.
- Omitting **`blueprint_emq`** does remove the section, because a count
  with no buckets draws nothing.

So the safe way to describe an exam with no EMQ is to omit **both**:
no `emq_count` *and* no `blueprint_emq`. The mock is then SBA +
true/false, and nothing anywhere asks for an EMQ or reports a shortage
of one.

> **The final MBBS paper is SBA + true/false, with no EMQ section.** So
> its blueprint has `sba_count`, `tf_count`, `blueprint_sba` and
> `blueprint_tf`, and no EMQ keys at all.

### The three bucket lists

- **`blueprint_sba`** — `category`, `subcategory`, `weight`, optional
  `specific_areas`.
- **`blueprint_emq`** — `theme`, `weight`, optional `specific_areas`.
  (Omit entirely for an exam with no EMQ.)
- **`blueprint_tf`** — same shape as SBA: `category`, `subcategory`,
  `weight`, optional `specific_areas`.

**A bucket with `weight: 0` is dropped on load.** There is no way to
write "this topic exists but is worth nothing" — leave it out.

### Weights

Weights are **shares of their own section**, and each list is normalised
independently. Make each list sum to **100** — not because the parser
demands it (it divides by the total either way) but because a list that
sums to 100 can be read as percentages, and the editing Studio shows the
sum against 100 so somebody can see at a glance what is missing.

With `sba_count: 40` and a bucket at `weight: 12`, that bucket supplies
about 5 of the 40 SBAs.

### `specific_areas`

The named things inside a bucket. They do real work: the engine prefers a
question from an area the candidate has not been examined on, so a paper
walks the whole bucket over successive mocks instead of returning to the
same corner.

- **4–10 per bucket.** Fewer and the rotation has nothing to work with.
- Write them as the examinable thing, the way a question would be about
  it: *"Delayed second stage: instrumental vs caesarean"*, not *"Labour"*.
- They are matched loosely against question text, so the clinical words
  matter more than the phrasing.

### `priority_topics` — optional

```yaml
priority_topics:
  - match: "pre-eclampsia"
    boost: 1.4
```

A question whose text contains `match` is weighted up by `boost` when the
engine chooses. Use sparingly — three or four at most. This is for
"examiners keep coming back to this", not for general importance, which
is what the bucket weight already says.

---

## 4. How many buckets

For scale: AUREUM's PGIM MD O&G Part 2 blueprint has **16 SBA buckets and
13 EMQ themes** across a 30+30 paper, each bucket carrying 4–10 specific
areas.

Aim for enough buckets that each contributes 1–4 questions. A bucket
worth less than one question in the whole paper is noise in the weights;
a bucket worth ten is too coarse to steer anything.

---

## 5. Loading it

**Developer → Exam blueprint.** Choose the course first, then upload the
`.md` file. The Studio on the same page shows each bucket, its weight and
the running sum against 100, and the coverage map shows how many real
questions back each bucket — which is the quickest way to find a weight
that nothing in the bank can supply.

A blueprint can be uploaded before the questions exist. It will report
buckets with no questions behind them, which is useful: it is a list of
what to write next.

> **One warning about the Studio.** True/false weights are authored in
> this file, not in the Studio, and the Studio carries them through
> untouched — but its **Export .md** is the file to paste back if you
> edit there. Export after editing rather than re-generating from the
> original, or Studio edits are lost.

---

## 6. A checklist before handing a blueprint over

- [ ] `track` is the exact course short code from Developer → Courses.
- [ ] `paper` names only the sections this exam has, and the unwanted
      sections have **no bucket list** — omitting the count alone is not
      enough, it defaults to 30.
- [ ] Each bucket list sums to 100.
- [ ] No bucket has `weight: 0` (leave it out instead).
- [ ] Bucket names match the words the question bank actually uses.
- [ ] 4–10 `specific_areas` per bucket, written as examinable things.
- [ ] At most three or four `priority_topics`.
- [ ] The front matter is between two `---` lines and is valid YAML.
