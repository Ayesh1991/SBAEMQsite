# Paper file format — `ogr-paper-v1`

Every question paper is a single JSON file that can carry **SBA, EMQ and
true/false** content for one topic. This is the format your study group already produces and
uploads to Google Drive; the site reads it directly — no conversion needed.

## Top-level shape

```json
{
  "schema": "ogr-paper-v1",
  "topic": "Postmenopausal ovarian cysts",
  "folderTag": "Postmenopausal ovarian cysts",
  "category": "Gynaecology",
  "subcategory": "Oncology",
  "source": "RCOG Green-top Guideline No. 34",
  "description": "Diagnosis, risk stratification and management …",
  "created": "2026-06-30",
  "sba": [ … ],
  "emq": [ … ],
  "tf":  [ … ]
}
```

| Field | Required | Used for |
|---|---|---|
| `schema` | recommended | Should be `"ogr-paper-v1"`. |
| `topic` | **yes** | Paper title shown everywhere. |
| `folderTag` | recommended | Auto-maps the paper to a syllabus topic in the developer console. |
| `category` / `subcategory` | optional | Human hints; the console still lets you set the exact section/topic. |
| `source` | optional | Guideline / article citation shown under the title. |
| `description` | optional | Blurb on the paper detail page. |
| `sba` | one of sba/emq/tf | Array of single-best-answer questions. |
| `emq` | one of sba/emq/tf | Array of extended-matching **themes**. |
| `tf` | one of sba/emq/tf | Array of true/false **blocks** (a lead-in with statements). |

A file may contain any one of `sba`, `emq` and `tf`, or all three. The library
badges each paper with <kbd>SBA n</kbd>, <kbd>EMQ n</kbd> and <kbd>T/F n</kbd>
for whichever it has, and the paper page offers one run card per kind — so a
final MBBS paper of true/false plus SBA is sat as two sections of one paper,
each marked on its own.

## SBA questions

```json
{
  "id": "sba1",
  "stem": "A 58-year-old woman has an incidental 2.4 cm simple, unilocular cyst …",
  "lead": "What is the most appropriate NEXT step?",
  "options": [
    "No follow-up is required",
    "Refer for CA125 and RMI calculation",
    "Repeat ultrasound in 12 months",
    "Repeat ultrasound in 4 to 6 months",
    "Refer to the gynaecological oncology MDT"
  ],
  "answer": 0,
  "rationale": "Simple, unilocular cysts of 3 cm or less need no follow-up …",
  "hook": "Simple, unilocular, <=3 cm -> no follow-up."
}
```

- `stem` — the clinical vignette. `lead` — the actual question (optional but
  recommended); shown in bold under the stem.
- `options` — plain answer texts (the app adds the A–E letters).
- **`answer` is a 0-based index** into `options` (0 = A, 1 = B, …).
- `rationale` — the teaching explanation (shown in study mode immediately, and in
  the exam-mode review). `hook` — a one-line memory aid, shown with a 💡.

## EMQ themes

Each EMQ entry is a **theme** with one option list (A, B, C …) answered by
several stems.

```json
{
  "id": "emq1",
  "theme": "Initial management of postmenopausal ovarian cysts",
  "instruction": "For each woman, select the SINGLE most appropriate management. Each option may be used once, more than once, or not at all.",
  "options": [
    "A. No follow-up required",
    "B. Repeat CA125 and ultrasound in 4 to 6 months",
    "C. Discharge from follow-up after 1 year if stable"
  ],
  "stems": [
    { "stem": "A 60-year-old woman with a simple 2.1 cm cyst.", "answer": 0, "rationale": "…", "hook": "…" }
  ]
}
```

- `options` here **already carry their "A. " letter** — the app detects this and
  does **not** add a second letter. (Plain options without letters also work; the
  app will add them.)
- **`answer` is a 0-based index** into that theme's `options` (0 = "A. …").
- `instruction` is the classic "used once, more than once, or not at all" line.

## True/false statements

A final MBBS paper is usually true/false **and** SBA. The true/false half reads
as a lead-in followed by several statements, each marked true or false, so that
is how it is written:

```json
"tf": [
  {
    "lead": "Regarding pre-eclampsia:",
    "statements": [
      { "stem": "Proteinuria is required for the diagnosis",
        "answer": false,
        "explanation": "Not since the 2013 ISSHP revision — end-organ dysfunction is enough.",
        "hook": "No protein needed" },
      { "stem": "Magnesium sulphate reduces the risk of eclampsia",
        "answer": true,
        "explanation": "MAGPIE: roughly halved." }
    ]
  },
  { "stem": "A statement that stands on its own needs no lead-in", "answer": true }
]
```

- **`answer` is `true` or `false`** — a boolean, not a number. The words
  `"true"`/`"false"`, `"T"`/`"F"` and `"yes"`/`"no"` are accepted too.
- **A number is rejected, on purpose.** `0` reads as both "the first option,
  True" and "the value false", and the two are opposites — so accepting it
  would invert the mark on every statement in the file and look exactly like a
  candidate who got them all wrong. The validator says so rather than guessing.
- `lead` is shown **above** each statement in the block, because it is the
  sentence the statement completes. On the fifth statement of a block it is the
  only thing saying what the question is about.
- A block may be written as a bare statement with no `lead` and no
  `statements` array, as in the last entry above.
- `explanation` (or `rationale`) and `hook` work exactly as they do for SBA:
  the explanation is shown after answering, and the hook feeds the memory-hooks
  page.

Everything else follows: a true/false statement is marked, flagged, noted,
queued for review and counted towards progress like any other question, because
under the surface it is a single-best-answer with two options.

## Gotchas

- `answer` is **0-based** for SBA and EMQ. If your key says "C", write `2`.
- For `tf`, `answer` is a **boolean**, never an index — see above.
- JSON forbids trailing commas and comments — the validator will flag these.
- Keep one topic per file. 8–12 SBAs and a handful of EMQ themes is a good size.
- Give `folderTag` a value from the OG Revise tag list so the paper lands in the
  right place automatically when you import it.

## Backwards compatibility

The older sample format (`mode` + `questions` for SBA, `themes` for EMQ) is still
accepted, so any legacy files keep working.
