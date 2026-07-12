# Paper file format — `ogr-paper-v1`

Every question paper is a single JSON file that carries **both SBA and EMQ**
content for one topic. This is the format your study group already produces and
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
  "emq": [ … ]
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
| `sba` | one of sba/emq | Array of single-best-answer questions. |
| `emq` | one of sba/emq | Array of extended-matching **themes**. |

A file may contain only `sba`, only `emq`, or both. The library marks each paper
with an <kbd>SBA n</kbd> badge and, when present, an <kbd>EMQ n</kbd> badge.

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

## Gotchas

- `answer` is **0-based**. If your key says "C", write `2`.
- JSON forbids trailing commas and comments — the validator will flag these.
- Keep one topic per file. 8–12 SBAs and a handful of EMQ themes is a good size.
- Give `folderTag` a value from the OG Revise tag list so the paper lands in the
  right place automatically when you import it.

## Backwards compatibility

The older sample format (`mode` + `questions` for SBA, `themes` for EMQ) is still
accepted, so any legacy files keep working.
