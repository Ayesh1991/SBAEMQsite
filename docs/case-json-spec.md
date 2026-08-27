# AUREUM case JSON — what to produce at the end of a case discussion

Paste this whole file into your Claude project's instructions (or attach it
to the conversation) and end each case with:

> Produce the AUREUM case JSON for this discussion.

Save the result as `case-<something>.json` and drop it in the **My case
discussions** Drive folder. The site imports it from there.

---

## The rule that matters most

**Everything in this file comes from the discussion that just happened.**
Where the candidate said something, quote what they actually said. Where
they missed something, say it was missed. Never write a `saidWell` entry
for a point they did not make, and never invent a terminology slip that did
not occur. The site marks and revises against this file, so a flattering
file produces flattering revision, which is worse than none.

---

## Shape

One JSON object. No markdown fence, no prose around it.

```jsonc
{
  "schema": "aureum-case-v2",
  "id": "case-hmb-adenomyosis-perimenopausal",   // lowercase, hyphens, unique
  "topic": "Heavy menstrual bleeding / adenomyosis (perimenopausal, requesting hysterectomy)",
  "vignette": "47-year-old mother of three, para 3, presenting with…",
  "minutes": 30,
  "discussedOn": "2026-08-27",        // ISO date of the conversation

  "phases":    [ … ],   // see below — unchanged from v1
  "questions": [ … ],   // see below — unchanged from v1
  "sources":   [ "NICE NG88", "FIGO PALM-COEIN", … ],

  "revision":  { … },   // NEW in v2 — the study note
  "session":   { … }    // NEW in v2 — what happened in THIS discussion
}
```

`schema`, `revision` and `session` are the only additions. A v1 file still
imports; it simply has no revision note and no session record.

---

## `phases` — the six components, in order

Use these six ids. The site labels them and shows which one you are in.

| id | label | typical minutes |
|---|---|---|
| `history` | History | 8 |
| `summary` | Summary of the history | 2 |
| `examination` | Examination | 4 |
| `problems` | Problem list and differential diagnosis | 4 |
| `discussion` | Investigations, management and follow-up | 10 |
| `viva` | Examiner's viva | 4 |

```jsonc
{ "id": "history", "minutes": 8, "ask": "Present your patient.",
  "expect": [
    "Introduction: age, parity, menstrual status, presenting complaint stated FIRST, not LMP",
    "Pattern of bleeding: frequency, heaviness, clots, flooding, protection used, duration",
    "…"
  ] }
```

**`expect` is the marking scheme for that phase.** One item per thing a
complete answer contains. Write them as *checkable statements*, not
headings — "Serum ferritin, with CRP alongside since ferritin is an acute
phase reactant" can be marked; "Investigations" cannot. Aim for 8–14 items
on `history` and `discussion`, 2–5 on the others.

The `viva` phase carries no `expect` — its marking is the questions.

---

## `questions` — the viva, with model answers

```jsonc
{ "phase": "viva",
  "q": "Her biopsy is secretory endometrium. Why still consider hysteroscopy?",
  "model": "Pipelle samples only ~4% of the cavity and has up to a 40% failed…",
  "mustHit": [
    "pipelle samples only ~4% of cavity",
    "up to 40% failed/inadequate sampling rate",
    "hysteroscopy indicated for focal lesion on scan or persistent symptoms"
  ],
  "followUp": "What ultrasound features suggest adenomyosis rather than fibroid?" }
```

`model` is the answer as it should be *spoken* — a paragraph, not bullets.
`mustHit` are the three-to-five things that must appear for full marks.
Include **numbers** wherever the exam expects them (≈50%, ≈90%, 4%, 40%).

---

## `revision` — the study note

This is what the DOCX contains. Putting it in the JSON means the site can
print the revision note without asking a model to rewrite what you already
wrote.

```jsonc
"revision": {
  "quickBox": [
    "47F, para 3, irregular HMB x 2.5 years, flooding + clots, 2 transfusions",
    "Never trialled hormonal treatment despite 2.5 years — the key gap",
    "LNG-IUS ~90% reduction at 1 year, first-line if cavity normal",
    "At 47: conserve healthy ovaries unless a strong indication to remove"
  ],
  "definition": "Heavy menstrual bleeding is defined by NICE as…",
  "pathophysiology": [
    "Disordered local endometrial haemostasis: excess PGE2/PGI2, reduced TXA2…",
    "Adenomyosis: junctional zone disruption allows basalis to invaginate…"
  ],
  "differentials": [
    { "name": "Adenomyosis", "group": "A (PALM)",
      "features": "Diffusely bulky tender uterus; dysmenorrhoea + HMB; MUSA features on USS" },
    { "name": "Leiomyoma", "group": "L (PALM)",
      "features": "Well-defined capsulated mass, circumferential vascularity on Doppler" }
  ],
  "investigations": [
    { "test": "Transvaginal + transabdominal USS",
      "why": "Endometrium (thickness, focal lesion), myometrium (MUSA features), adnexa" },
    { "test": "Endometrial sampling (pipelle)",
      "why": "First-line; only ~4% of cavity sampled, ~40% inadequate — a normal result does not exclude a focal lesion" }
  ],
  "classification": [
    "MUSA criteria: junctional zone irregularity, subendometrial lines and buds, myometrial cysts…; three or more support the diagnosis"
  ],
  "management": [
    { "heading": "Non-hormonal medical",
      "points": ["Tranexamic acid 1g QDS during menses — antifibrinolytic, ~50% reduction",
                 "Mefenamic acid 500mg TDS — ~25%, also treats dysmenorrhoea"] },
    { "heading": "Hormonal medical",
      "points": ["LNG-IUS — ~90% at 1 year, first-line when cavity and endometrium normal"] },
    { "heading": "Surgical",
      "points": ["Endometrial ablation if uterus ≤10–12 weeks, cavity normal, family complete",
                 "Hysterectomy — definitive, after an adequate medical trial"] }
  ],
  "traps": [
    "Defaulting to surgery because the patient asked for it, without a hormonal trial",
    "Removing healthy ovaries at 47 without discussing surgical menopause"
  ],
  "references": ["NICE NG88", "FIGO PALM-COEIN", "MUSA consensus statement"]
}
```

Every field is optional — include what the discussion actually covered.

---

## `session` — what happened in THIS discussion

The most valuable part, and the part nothing else can produce. It is the
record of one performance, not general teaching.

```jsonc
"session": {
  "verdict": "A well-ordered history with a genuine gap: hormonal management was never considered before surgery.",
  "score": { "awarded": 62, "max": 100 },     // optional, your judgement

  "saidWell": [
    "PALM-COEIN used to structure the differential without being asked",
    "Pipelle sampling limitations quoted with the actual figures"
  ],
  "missed": [
    { "point": "LNG-IUS not offered before hysterectomy",
      "why": "The single most examinable gap in this case — 2.5 years of symptoms and no hormonal trial",
      "phase": "discussion" }
  ],

  // The terminology table. Quote what was ACTUALLY said.
  "language": [
    { "said": "dilatation and curative", "correct": "dilatation and curettage",
      "say": "kur-EH-tazh", "why": "Common slip under pressure" },
    { "said": "people biopsy", "correct": "pipelle biopsy",
      "say": "pip-ELL", "why": "Practise this one specifically" },
    { "said": "fibroadenoma", "correct": "fibroid (leiomyoma)",
      "say": "", "why": "Fibroadenoma is a breast lesion — a different organ entirely" }
  ],

  "technique": [
    "Lead the introduction with the presenting complaint, not the LMP",
    "State each differential with its supporting feature in the same sentence",
    "Raise MDT involvement early in the management answer, not as an afterthought"
  ],

  // Anything asked that is NOT in `questions` above, with what was answered
  "extraQuestions": [
    { "q": "How would you identify and protect the ureter during this surgery?",
      "answered": "Partially — named the ureteric tunnel but not the landmarks",
      "model": "Identify it at the pelvic brim crossing the bifurcation of the common iliac…" }
  ]
}
```

---

## Checklist before you hand it over

- [ ] Valid JSON, no code fence, no commentary around it
- [ ] `id` is unique and lowercase-hyphenated
- [ ] Every phase except `viva` has an `expect` array with real, checkable items
- [ ] Every question has a `model` answer and `mustHit`
- [ ] `session.language` quotes what was **actually** said — nothing invented
- [ ] `session.missed` is honest, including where the candidate did badly
- [ ] Numbers are present where the exam expects them
