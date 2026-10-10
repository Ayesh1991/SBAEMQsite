# Sample import files

Four files, one per bank, in the exact shapes the importers accept. Copy
one, replace the content, import it from the **Developer** console.

| File | Bank | Imported at |
|---|---|---|
| `mbbs-obgyn-paper.json` | SBA · EMQ · true/false | Developer → Papers |
| `mbbs-obgyn-essay.json` | Essay / SAQ | Developer → Essays |
| `mbbs-obgyn-osce.json` | OSCE station | Developer → OSCE |
| `mbbs-obgyn-case.json` | Case file | Developer → Cases |

## The course and the subject are NOT in the file

This is the part that surprises people. A paper file carries **content**
— the questions and their answers. Which course it belongs to and which
subject it sits under are chosen **in the console at import time**, from
the two pickers above the import list, and stamped onto the row as
`tracks` and `subject`.

That is deliberate: the same question bank can be filed differently by
two deployments, and a `track` baked into the file would follow it
wherever it was copied. (The three bundled files — `syllabus.json`,
`manifest.json`, `blueprint.md` — are the exception, and they name their
course precisely so they CANNOT follow a candidate to another one.)

So to put these under **Final MBBS → Obstetrics & Gynaecology**:

1. Developer → the bank you want
2. Course picker → **Final MBBS**
3. Subject picker → **Obstetrics & Gynaecology**
4. Import

The subject ids are fixed: `obgyn`, `medicine`, `surgery`, `paediatrics`,
`psychiatry`, `anaesthesiology`.

## The rules the validator will stop you on

- **`topic` is required** on every file.
- **SBA / EMQ `answer` is a 0-based index** into that question's
  `options`. The first option is `0`, not `1`.
- **True/false `answer` must be `true` or `false`** — a boolean, or the
  words. **Never a number.** `0` reads as both "the first option, True"
  and "the value false", and those are opposites; accepting it would
  invert the mark on every statement in the file and look exactly like a
  candidate who got them all wrong. The importer refuses it by name.
- **SBA needs 2+ options; EMQ needs 3+.**
- EMQ options may carry their own `"A. "` prefix — the app notices and
  does not letter them twice.
- Everything else (`lead`, `rationale`, `hook`, `reference`, `source`,
  `id`) is optional and used where it helps.
