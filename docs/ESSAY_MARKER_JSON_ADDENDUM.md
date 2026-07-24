# OG REVISE — ESSAY MARKER · JSON REPORT ADDENDUM

Paste **one** of the two blocks below into the *Project Instructions* of your **OG Revise
Essay Marker** Claude project, immediately after the existing `## 3 — DOCX REPORT` section.
It adds a machine-readable JSON report so the AUREUM website can display the feedback
natively (richer than the DOCX, with an AI tutor and weakness analysis on top).

- **Block A** — for candidates/friends (no Drive access): the project produces the JSON
  as a **downloadable file** which they upload on the website.
- **Block B** — for the developer (Drive auto-upload): the project **saves the JSON into
  the shared Drive feedback folder**, and the website auto-imports it.

Everything else in the existing instructions (scheme lookup, marking, DOCX) stays exactly
as is — this only ADDS a `## 3b — JSON REPORT` step. Build the DOCX first, then the JSON
from the *same* marked data (never re-mark), then the chat summary.

---

## The JSON schema — `ogr-essay-feedback-v1`

Emit one object per marked question, valid JSON, keys exactly as below. All content comes
from the **same marking** used for the DOCX — do not regenerate or re-score.

```json
{
  "schema": "ogr-essay-feedback-v1",
  "code": "M03-Q5",
  "paper": "M03",
  "topic": "Shoulder dystocia",
  "subject": "OBS",                     // OBS | GYN, exactly as the scheme states
  "questionType": "SEQ",                // SEQ | SAQ
  "schemeVersion": "1.0",
  "markedOn": "2026-07-09",             // real current date, YYYY-MM-DD
  "questionStem": "full stem text…",
  "subQuestions": [
    { "label": "5.1", "text": "Define shoulder dystocia…", "maxMarks": 20 }
  ],
  "score": {
    "raw": 59.5, "rawMax": 100,
    "scaled": 11.9, "scaledMax": 20,
    "percent": 60,                      // round(scaled/scaledMax*100); MUST agree with band
    "band": "Borderline"                // Distinction | Clear Pass | Borderline | Fail
  },
  "breakdown": [
    { "section": "5.1 — Definition and risk factors", "raw": 9, "max": 20 }
  ],
  "examinerComment": "3–6 sentences: strongest/weakest parts, marks lost, any scheme disagreement.",
  "markScheme": [
    {
      "section": "5.1 — Definition and risk factors",
      "raw": 9, "max": 20,
      "points": [
        {
          "point": "the scheme mark-point text, verbatim",
          "guideline": "RCOG GTG42",
          "status": "Covered",          // Covered | Partial | Missed  (exactly these words)
          "note": "why this status — quote wrong figures inline, e.g. 'wrote 160mg, max is 300mg'"
        }
      ]
    }
  ],
  "improvementAdvice": [
    { "label": "5.1", "points": ["concrete content to add/cut, correct figures missed, sequencing…"] }
  ],
  "writingImprovement": [
    {
      "label": "5.2",
      "quotes": [ { "original": "candidate's own weak sentence", "rewrite": "clean rewrite" } ],
      "proTips": ["2–4 transferable tips tied to what they actually wrote"]
    }
  ],
  "guidelines": [
    { "guideline": "RCOG Green-top Guideline No. 42", "year": 2012, "relevance": "…from the scheme" }
  ],
  "keyLearningPoints": [
    "BIGGEST mark-loser first",
    "then the next highest-yield points…"
  ],
  "modelAnswer": "flowing exam prose, **bold** sub-headers, writable by hand in 20–25 min; from the scheme's points only"
}
```

**Rules:** `status` is only `Covered`/`Partial`/`Missed`. `percent` and `band` must agree
(≥75 Distinction · 65–74 Clear Pass · 50–64 Borderline · <50 Fail). Every field is drawn
from the marking you already did for the DOCX — the JSON and DOCX must be identical in
substance. `writingImprovement` is required per sub-question. Validate that it is strict,
parseable JSON (no trailing commas, no comments in the actual output) before you ship it.

---

## BLOCK A — candidates (download the JSON; upload on the website)

```
## 3b — JSON REPORT (candidate build)
After the DOCX (§3) is built and validated, produce a second file: the machine-readable
feedback report, schema `ogr-essay-feedback-v1` (see schema block your group maintains).

- Build it from the SAME marked data as the DOCX — never re-mark or re-score; the two must
  agree exactly.
- Write it to a file named `EssayFeedback_<CODE>_<TOPIC>.json` (e.g.
  `EssayFeedback_M03-Q5_ShoulderDystocia.json`) using the code tool, and offer it for
  download alongside the DOCX.
- It must be strict, parseable JSON: no trailing commas, no comments, `status` values
  exactly Covered/Partial/Missed, `percent` and `band` internally consistent.
- Then output exactly:
  > "Download BOTH files → save the DOCX to your essay folder, and upload the .json to
  >  AUREUM → Library → Essay → Upload report."
```

---

## BLOCK B — developer (auto-upload the JSON to the Drive feedback folder)

```
## 3b — JSON REPORT (developer build, Drive auto-upload)
After the DOCX (§3) is built and validated, produce the machine-readable feedback report,
schema `ogr-essay-feedback-v1`, from the SAME marked data (never re-mark).

- Write `EssayFeedback_<CODE>_<TOPIC>.json` with the code tool (strict parseable JSON;
  status exactly Covered/Partial/Missed; percent and band consistent).
- Upload it to the shared Drive feedback folder
  (folder id 1EwsaTMnAcHbStoINKdhTq7ig87qBUiK8) using the Google Drive tool, so the AUREUM
  website auto-imports it on the next "Auto-import from Drive" in Library → Essay.
  If the Drive tool is unavailable in this session, fall back to offering the .json for
  download and note that it must be placed in the feedback folder manually.
- Then output exactly:
  > "Report saved. DOCX ready to download; the JSON has been placed in the essay feedback
  >  folder and will auto-import into AUREUM."
```

---

### Where each file goes on the website
- **Papers** (the question papers, `ogr-essay-paper-v1`) are imported by the developer in
  **Developer → Essay importer** (Scan Drive) and appear in **Library → Essay**.
- **Feedback** (`ogr-essay-feedback-v1`) is uploaded by each candidate in **Library →
  Essay → Upload report**, or auto-imported by the developer from the same Drive folder.
- The website routes each Drive file by its `schema`/shape, so papers and feedback can live
  in the same folder.
