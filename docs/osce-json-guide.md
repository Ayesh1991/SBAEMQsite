# Instructions: Converting PDF/Word Files into Aureum-Compatible OSCE Station JSON

Paste this whole document into a Claude.ai conversation (or a Claude project's custom
instructions), along with the PDF/Word/other source file(s) you want turned into an OSCE
station, and ask Claude to build the station JSON. Claude should follow these instructions
exactly so the output file imports cleanly into the Aureum website.

---

## 1. What this is for

Aureum is an OSCE practice website. It imports station files in a specific JSON format, then
runs them as a mock oral exam: it reads out a scenario, asks the candidate questions one at a
time by voice, and scores the candidate's spoken answers against a marking scheme. Your job
is to take a source document (a guideline, a teaching script, a counselling script, a past
paper, a textbook OSCE task, a recall, etc.) and turn it into ONE station JSON file that fits
this mechanism.

The website's format is **examiner asks → candidate answers out loud**. It is not a
role-play simulator. So even if your source material is written as a face-to-face
role-play, a counselling script, or a "things to say to the patient" teaching note, it must be
restructured into direct examiner questions with a marking scheme — not left as a script to
act out.

## 2. The exact JSON schema

Every station is a single JSON file with this structure:

```json
{
  "topic": "Short descriptive title of the station",
  "source_file": "original_filename.pdf",
  "source_meta": {
    "origin": "Where this came from — e.g. 'RCOG Green-top Guideline No. 37a', 'PGIM 2019 exam recall', 'MRCOG textbook Chapter 12 Task 3'",
    "marking_scheme": "State whether the marking scheme is REAL (taken directly from the source) or NOMINAL (invented by you to fit a numeric total, because the source had no numeric scheme). Be explicit either way.",
    "fabrication_note": "State plainly what, if anything, was invented. E.g. 'No fabrication — scenario and marks taken directly from source' or 'Minimal fabrication — only the numeric mark values were invented; all clinical content is from the source.'"
  },
  "station_time_min": 15,
  "reading_time_min": 1,
  "total_marks": 100,
  "pass_mark_percent": 70,
  "pass_mark": 70,
  "scenario": "The full clinical scenario/vignette read aloud to the candidate before questioning begins. Should stand alone and give the candidate everything they need to start answering.",
  "questions": [
    {
      "id": "Q1",
      "prompt": "The exact question the examiner asks aloud.",
      "marks": 20,
      "marking_points": [
        "Specific point 1 the candidate should mention to earn marks",
        "Specific point 2",
        "Specific point 3"
      ]
    },
    {
      "id": "Q2",
      "reveal_before": "Optional: new information given to the candidate immediately before this question — e.g. a scan result, a complication, a lab value. Omit this field entirely if there is nothing new to reveal at this point.",
      "prompt": "The next question.",
      "marks": 15,
      "marking_points": [
        "Point 1",
        "Point 2"
      ]
    }
  ]
}
```

### Field-by-field rules

- **topic**: short, specific, describes the clinical content (not just "Station 1").
- **source_file**: the original file name you converted from.
- **source_meta**: always include all three sub-fields (`origin`, `marking_scheme`,
  `fabrication_note`). This is what lets anyone check later how trustworthy the content is.
- **station_time_min**: use `15` unless the source explicitly states a different station
  length — then use the source's own value.
- **reading_time_min**: use `1` unless the source states otherwise.
- **total_marks**: a whole number, always greater than 0. See §4 for how to choose it.
- **pass_mark_percent**: use `70` (the SLCOG/PGIM/MRCOG standard) unless told otherwise.
- **pass_mark**: `total_marks × pass_mark_percent / 100`, rounded to a whole number.
- **scenario**: written in full prose, third person, everything the candidate needs to begin.
  If the source scenario is thin, you may add ordinary clinical detail (age, gestation,
  presenting complaint) to make it readable, but do not invent marking-relevant clinical
  facts that aren't in the source.
- **questions**: an array of 6–10 questions of increasing difficulty, each with a unique `id`
  (`Q1`, `Q2`, … — or `reveal-1` style ids for pure information-reveal steps with no separate
  question of their own).
- **reveal_before**: use this whenever the real OSCE would disclose new information partway
  through (a result comes back, the patient discloses something, a complication develops).
  Omit the field entirely on questions where nothing new is revealed — do not set it to null
  or an empty string.
- **marking_points**: bullet list of the specific things a real examiner would be listening
  for. Prefer the source's own wording where a real scheme exists.

## 3. Step-by-step process

1. **Extract the source content.** Read the whole PDF/Word file. Note whether it already
   contains: (a) a clinical scenario, (b) a role-player or patient brief, (c) a marking
   scheme with actual marks or pass/borderline/fail domains.

2. **Decide: convert or skip.**
   - **Convert** if there is a clinical scenario (even a brief one) that can be turned into
     questions.
   - **Skip** if the file is a bare generic educational article or framework with no scenario
     at all (e.g. a general "how to break bad news" article, a general "how to handle an
     angry patient" article with no named patient or case). Converting these would require
     inventing an entire scenario from nothing, which is not allowed — flag it as skipped
     and say why, rather than fabricating a case.
   - **Skip** if the content is a near-duplicate of a station you (or a colleague) already
     converted from a different source file — note the duplicate and which station it
     matches instead of creating a second copy.
   - **Skip** if the source is a textbook chapter or reference material with no scenario or
     testable content at all (e.g. pure anatomy reference, a glossary).

3. **Restructure role-play/counselling scripts into Q&A.** If the source is written as a
   dialogue, a "things to say to the patient" script, or a simulated-patient brief, do not
   preserve it as a script. Instead, break it into a scenario paragraph plus a sequence of
   direct examiner questions such as "How would you counsel her about X?", "What would you
   include in the history?", "State the key risks you would discuss." Fold any role-player
   emotional reactions or disclosures into `scenario` text or into `reveal_before` fields at
   the point they would naturally occur.

4. **Build the marking scheme (see §4 below for real vs nominal marks).**

5. **Validate before finishing** — see §5. Do not skip this step.

6. **Name the file** using a short descriptive filename in Title_Case_With_Underscores.json,
   matching the `topic`.

## 4. Marking scheme: real marks vs nominal marks

- **If the source gives an actual numeric marking scheme** (marks per section, or a stated
  total like "/20"), use it as closely as possible. Keep the source's own total if it has
  one, even if it isn't a round number (e.g. 20, 150, 180 are all fine). Set
  `source_meta.marking_scheme` to say this is a real scheme from the source.

- **If the source gives Pass/Borderline/Fail domains instead of numbers** (common in MRCOG
  textbook tasks — e.g. "Patient safety: Pass/Borderline/Fail"), you may convert these into
  numeric marks: split the real domain bullet-points across your questions and allocate
  marks that sum to a clean total (100 is the usual default). Clearly state in
  `source_meta.marking_scheme` and `source_meta.fabrication_note` that the numeric values are
  an editorial allocation, not from the source, while the marking-point content itself is
  real and taken from the source.

- **If the source has no marking scheme at all** (just a scenario or referral letter), you
  may construct a reasonable marking scheme from standard clinical knowledge of the
  condition, allocating marks to sum to a clean total (100 is the usual default). This is
  more-than-minimal fabrication and must be labelled clearly as such in
  `source_meta.fabrication_note` — never hide it.

- **Never fabricate more than necessary.** The guiding rule throughout is: minimal
  fabrication, and always disclose exactly what was fabricated in `source_meta`.

## 5. Validation — do this for every file before delivering it

Three rules must hold, with zero exceptions, or the file will not import correctly:

1. No `total_marks`, `pass_mark`, or any individual question's `marks` may be `null`.
2. No `total_marks`, `pass_mark`, or any individual question's `marks` may be `0`. Every
   mark value must be a positive number.
3. The sum of every question's `marks` must equal `total_marks` **exactly**.

Check this programmatically rather than by eye. If you have access to a code-execution tool,
run something equivalent to:

```python
import json
d = json.load(open("your_file.json"))
assert d["total_marks"] not in (None, 0)
assert d["pass_mark"] not in (None, 0)
assert all(q["marks"] not in (None, 0) for q in d["questions"])
assert sum(q["marks"] for q in d["questions"]) == d["total_marks"]
print("OK")
```

If you don't have code execution available, add up the marks by hand twice before finishing.

## 6. Multiple stations from one document

If a single source document contains more than one distinct scenario (e.g. two separate
counselling cases, or a multi-task textbook page), create a **separate JSON file per
station** — do not merge unrelated scenarios into one file, and do not split one scenario
across multiple files.

## 7. What to hand back

For each source file, produce exactly one of:
- a station `.json` file (for convertible content), or
- a short note saying it was skipped and why (generic framework / duplicate / no
  testable content).

If you're processing many files at once, it's helpful to also produce a short README/summary
listing what was converted and what was skipped, so it's easy to check later — but the
station `.json` files are the only thing Aureum actually imports.

## 8. Importing the finished file into Aureum

Open **OSCE → Station bank → Created OSCE** and use either button:

- **Import a file** — pick one or several `.json` files at once.
- **Paste JSON** — paste a single station object, or an array `[ {...}, {...} ]`
  of several stations, and press *Check and add*.

Aureum checks every file against §5 before it saves anything, and tells you
exactly which rule failed and in which question if one does not pass. Nothing
half-imports: a file either goes in whole or is rejected whole.

Three fields you do **not** need to write — Aureum fills them in itself:

- the station's `id` (made from the topic),
- `collection` (always `created` for anything imported here),
- the author's name and the date, which appear on the station card so the
  round knows whose station it is.

Everything else in the bank works on a created station exactly as it does on
the curated ones: the spoken runner, the live examiner, AI marking, marking by
hand with the tick-sheet, the exam simulator, progress and the printed PDF.

---

### Worked example (short station)

```json
{
  "topic": "Emergency Contraception Counselling",
  "source_file": "Emergency contraception.pdf",
  "source_meta": {
    "origin": "MRCOG revision textbook, Circuit A Station 9",
    "marking_scheme": "Real scheme taken directly from source, stated total /20",
    "fabrication_note": "No fabrication — scenario and marks taken directly from source"
  },
  "station_time_min": 15,
  "reading_time_min": 1,
  "total_marks": 20,
  "pass_mark_percent": 70,
  "pass_mark": 14,
  "scenario": "Ruth Hale, a 24-year-old woman, attends the emergency clinic requesting emergency contraception after unprotected intercourse two days ago. She is otherwise fit and well.",
  "questions": [
    {
      "id": "Q1",
      "prompt": "What history would you take from Ruth before advising on emergency contraception?",
      "marks": 6,
      "marking_points": [
        "Timing of unprotected intercourse",
        "LMP and cycle regularity",
        "Any contraindications to hormonal methods",
        "Current contraceptive use"
      ]
    },
    {
      "id": "Q2",
      "prompt": "What emergency contraception options would you discuss with her, and how would you counsel her on choosing between them?",
      "marks": 8,
      "marking_points": [
        "Copper IUD as most effective option, mechanism, window up to 5 days",
        "Ulipristal acetate — mechanism, timing window, caveats",
        "Levonorgestrel — mechanism, timing window, lower efficacy",
        "Effect of BMI on oral methods"
      ]
    },
    {
      "id": "Q3",
      "prompt": "What follow-up and ongoing contraception advice would you give?",
      "marks": 4,
      "marking_points": [
        "Advise pregnancy test if period delayed/lighter",
        "Discuss ongoing regular contraception",
        "Safety-net advice"
      ]
    },
    {
      "id": "Q4",
      "prompt": "How would you close this consultation?",
      "marks": 2,
      "marking_points": [
        "Checks understanding, answers questions, professional manner"
      ]
    }
  ]
}
```

---

**End of instructions.** Follow this document exactly when converting any new source file so
that all stations — whoever creates them — stay consistent and import cleanly into Aureum.
