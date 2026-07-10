# Question file format & publishing workflow

Content on Aureum MRCOG is injected **only by the site owner**, by uploading JSON
files to the `/data` directory on the server and registering them in
`data/manifest.json`. Candidates have no upload path — the app is strictly a
reader.

## Publishing a new question set (3 steps)

1. **Author the JSON** using one of the two formats below.
2. **Validate it** with the admin tool at `/admin/validator.html` (paste or load
   the file; it checks the schema and previews the questions, and generates the
   manifest entry for you).
3. **Upload** the file under `data/<curriculum>/<section>/` and add its topic
   entry to `data/manifest.json`. The set appears in the library immediately —
   no code changes needed.

> Tip: keep the `/admin/` folder out of public navigation (or protect it with
> server auth, e.g. `.htaccess`). It is a convenience tool, not a security
> boundary — real access control is your server upload permission.

## The manifest — `data/manifest.json`

The manifest is the single source of truth for what candidates can see:
curricula → sections → topics.

```json
{
  "version": 1,
  "curricula": [
    {
      "id": "part2",
      "title": "MRCOG Part 2",
      "subtitle": "Written examination — SBA & EMQ",
      "sections": [
        {
          "id": "maternal-medicine",
          "title": "Maternal Medicine",
          "topics": [
            {
              "id": "p2-mm-hypertension-sba",
              "title": "Hypertensive Disorders of Pregnancy",
              "mode": "SBA",
              "file": "part2/maternal-medicine/hypertension-sba.json"
            }
          ]
        }
      ]
    }
  ]
}
```

- `id` values must be **unique across the whole site** (they key candidates'
  saved performance — never reuse an old id for different content).
- `file` is relative to the `data/` directory.
- `mode` must be `"SBA"` or `"EMQ"` and should match the file's own `mode`.
- Removing a topic from the manifest unpublishes it; candidates keep their
  scores, but the answer review for that set becomes unavailable.

## SBA file format

```json
{
  "id": "p2-mm-hypertension-sba",
  "title": "Hypertensive Disorders of Pregnancy",
  "mode": "SBA",
  "timeLimitMinutes": 11,
  "questions": [
    {
      "stem": "A 28-year-old primigravida at 34 weeks ... first-line antihypertensive?",
      "options": [
        "Intravenous hydralazine",
        "Oral labetalol",
        "Oral methyldopa",
        "Oral nifedipine modified-release",
        "Intravenous magnesium sulphate"
      ],
      "answer": 1,
      "explanation": "NICE NG133 recommends oral labetalol first-line ...",
      "reference": "NICE NG133"
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `mode` | yes | Must be `"SBA"`. |
| `title` | yes | Shown on the topic card and in the quiz header. |
| `timeLimitMinutes` | no | Omit (or `0`) for an untimed set. MRCOG pace ≈ 1.8 min/question. |
| `questions[].stem` | yes | The clinical vignette / question. |
| `questions[].options` | yes | 2–20 options; 5 is the exam standard. |
| `questions[].answer` | yes | **0-based** index into `options` (0 = A, 1 = B, …). |
| `questions[].explanation` | no | Shown in the answer review. Strongly recommended. |
| `questions[].reference` | no | Guideline / source line, e.g. "RCOG GTG No. 42". |

## EMQ file format

An EMQ set is a list of **themes**; each theme has one option list and several
stems answered from that list.

```json
{
  "id": "p2-mm-medical-disorders-emq",
  "title": "Medical Disorders in Pregnancy",
  "mode": "EMQ",
  "timeLimitMinutes": 12,
  "themes": [
    {
      "theme": "Thyroid disease in pregnancy",
      "instructions": "For each scenario select the single most appropriate management. Each option may be used once, more than once, or not at all.",
      "options": ["Carbimazole", "Propylthiouracil", "...more options..."],
      "stems": [
        {
          "stem": "A 30-year-old woman with Graves' disease ... at 6 weeks' gestation.",
          "answer": 1,
          "explanation": "Carbimazole in the first trimester is associated with ..."
        }
      ]
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `mode` | yes | Must be `"EMQ"`. |
| `themes[].theme` | yes | The lead-in title shown above its stems. |
| `themes[].instructions` | no | The classic "once, more than once, or not at all" line. |
| `themes[].options` | yes | 3–20 options, lettered A–T in the UI. 10–14 is exam-typical. |
| `themes[].stems[].stem` | yes | The scenario. |
| `themes[].stems[].answer` | yes | **0-based** index into the theme's `options`. |
| `themes[].stems[].explanation` | no | Shown in the answer review. |

## Common pitfalls

- **`answer` is 0-based.** If your answer key says "C", write `2`.
- JSON does not allow trailing commas or comments — the validator will catch this.
- Use straight quotes `"` in JSON syntax; curly quotes inside the *text* of stems
  are fine (the site renders UTF-8).
- Keep one topic per file. Big topics are better split into "Part 1 / Part 2"
  sets of 6–15 questions — candidates finish them and come back.
