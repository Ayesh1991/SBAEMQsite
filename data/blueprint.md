---
blueprint: pgim-mrcog-part2
version: 2
updated: 2026-07-16
source_papers:
  - "PGIM MD Part 2 SBA/EMQ 2022 (recall)"
  - "PGIM MD Part 2 SBA 2023 (full recall paper)"
  - "PGIM MD Part 2 SBA/EMQ 2024 (recall)"
  - "PGIM MD Part 2 SBA/EMQ 2025 (recall)"
paper:
  sba_count: 30
  emq_count: 30
  duration_min: 120
  sba_mark_each: 3
  emq_mark_each: 3
  negative_marking: false

# ─────────────────────────────────────────────────────────────
# SBA BLUEPRINT
# Weight = share of the 30-question SBA paper (weights sum to ~100).
# `category` = top-level bank category. `subcategory` = specific bank tag.
# Keys MUST match the `category` / `subcategory` fields in your JSON question bank.
# ─────────────────────────────────────────────────────────────
blueprint_sba:
  # ---------------- OBSTETRICS (≈52) ----------------
  - category: "Obstetrics"
    subcategory: "Intrapartum care & labour management"
    weight: 9
    specific_areas:
      - "Meconium-stained liquor decision-making (grade, dilatation, parity)"
      - "Intrapartum CTG interpretation & escalation (late decels, reduced variability)"
      - "Delayed second stage: instrumental vs LSCS vs review (station, moulding, caput, OP position)"
      - "Acute intrapartum events post-ARM (cord compression vs rupture vs abruption)"
      - "Operative delivery complications (subgaleal haemorrhage post-ventouse)"
      - "VBAC / previous scar decision-making in labour"

  - category: "Obstetrics"
    subcategory: "Medical & surgical disorders in pregnancy"
    weight: 13
    specific_areas:
      - "Cardiac disease in labour (mitral stenosis, NYHA class, mode of delivery)"
      - "Mitral stenosis postpartum pulmonary oedema: first-line management (O2, frusemide, prop up)"
      - "Epilepsy: seizure in labour on lamotrigine (lorazepam vs MgSO4, PET exclusion)"
      - "Thyroid: subclinical hypothyroidism dosing after IVF-positive test"
      - "Hyperemesis with electrolyte derangement / thyrotoxicosis overlap"
      - "Hypertriglyceridaemia in pregnancy (defaulted treatment, next action)"
      - "Renal failure (Stage 4/5) in pregnancy: timing of delivery"
      - "Influenza A / respiratory infection: supportive vs delivery decision"
      - "Diabetic ketoacidosis in pregnancy: immediate management sequence"
      - "Asthma with hypertension: antihypertensive drug of choice (avoid beta-blocker)"
      - "Lactation suppression in pre-eclampsia (cabergoline vs bromocriptine — avoid bromocriptine)"

  - category: "Obstetrics"
    subcategory: "Infections in pregnancy"
    weight: 6
    specific_areas:
      - "CMV serology interpretation (IgG+/IgM−, avidity testing)"
      - "Chlamydia at term: neonatal prophylaxis (ophthalmic gentamicin)"
      - "Gonorrhoea NAAT window period in vaginal swab"
      - "Group B Strep / chorioamnionitis intrapartum decision-making"
      - "HSV in pregnancy: transplacental transmission effects on fetus"

  - category: "Obstetrics"
    subcategory: "Obstetric haemorrhage & emergencies"
    weight: 8
    specific_areas:
      - "PPH stepwise management after atony treated (explore tears in precipitate labour)"
      - "PPH blood-loss volume estimation (% of EBV by booking weight)"
      - "PASD / morbidly adherent placenta at delivery"
      - "Labial / vulval haematoma management (LR vs theatre vs conservative)"
      - "Institutional PPH investigation: RCA vs audit vs process mapping"

  - category: "Obstetrics"
    subcategory: "Fetal medicine & feto-maternal"
    weight: 6
    specific_areas:
      - "Rh isoimmunisation: MCA-PSV as screen for fetal anaemia (not Liley)"
      - "FGR surveillance & delivery timing (early vs late onset, Doppler)"
      - "Early-onset FGR delivery indication (STV on cCTG, ductus venosus, growth velocity)"
      - "PPROM diagnosis: best confirmatory test (PAMG-1 / IGFBP-1 vs ferning/nitrazine)"
      - "Prenatal screening / NIPT interpretation"

  - category: "Obstetrics"
    subcategory: "Early pregnancy & ectopic"
    weight: 4
    specific_areas:
      - "Ectopic pregnancy: methotrexate eligibility & dosing (hCG threshold, mass size)"
      - "Methotrexate follow-up protocol (day 4/7 hCG, single vs multi-dose)"
      - "Pregnancy of unknown location: hCG trend interpretation"
      - "Miscarriage / early pregnancy loss management"

  - category: "Obstetrics"
    subcategory: "Perinatal mental health"
    weight: 3
    specific_areas:
      - "Postpartum psychosis: MBU admission vs psychiatric ward vs postnatal ward"
      - "Antipsychotic-related endocrine effects & pregnancy"

  - category: "Obstetrics"
    subcategory: "Antenatal care & booking"
    weight: 3
    specific_areas:
      - "Booking investigations & risk stratification"
      - "Travel / air travel advice with anaemia or thromboembolic risk"
      - "Screening-programme quality measures (cervical/antenatal)"

  # ---------------- GYNAECOLOGY (≈40) ----------------
  - category: "Gynaecology"
    subcategory: "Gynaecological oncology"
    weight: 11
    specific_areas:
      - "Cervical cancer staging investigations (MRI pelvis + CT CAP; FIGO 2018)"
      - "Cervical microinvasion / LSIL + HrHPV next step (colposcopy + LLETZ)"
      - "Recurrent/advanced cervical cancer with bladder involvement (anterior exenteration)"
      - "Endometrial carcinoma incidental at TAH: completion BSO route"
      - "Borderline ovarian tumour vs invasive (stromal invasion, implants)"
      - "Paediatric/adolescent ovarian tumours: germ-cell vs granulosa (CA125, AFP, hCG, LDH markers)"
      - "Ovarian cancer risk reduction (opportunistic bilateral salpingectomy — quantified benefit)"
      - "Vulval SCC management by size/site/nodes (WLE, sentinel node, radical)"
      - "Vulval lesion / ulcer in prolapse: biopsy before intervention"
      - "Postmenopausal & postcoital bleeding work-up (colposcopy referral)"

  - category: "Gynaecology"
    subcategory: "Reproductive endocrinology & subfertility"
    weight: 8
    specific_areas:
      - "PCOS diagnostic criteria (Rotterdam, what extra evidence needed)"
      - "Hyperandrogenism differential (CAH vs PCOS vs Sertoli-Leydig vs Cushing; 17-OHP)"
      - "Hyperprolactinaemia from antipsychotics (change drug vs cabergoline)"
      - "Premature ovarian insufficiency diagnosis (repeat FSH)"
      - "Endometriosis + subfertility management (ablation vs expectant vs medical)"
      - "Male subfertility: hypogonadotropic hypogonadism (post-pituitary surgery, low FSH/LH/T → gonadotropins)"
      - "Fertility preservation before chemotherapy (oocyte cryo vs GnRH agonist)"

  - category: "Gynaecology"
    subcategory: "Urogynaecology & pelvic floor"
    weight: 6
    specific_areas:
      - "Stress urinary incontinence definitive management (BMI, autologous sling, Burch)"
      - "Overactive bladder stepped therapy (anticholinergic → mirabegron → botulinum)"
      - "Urodynamics principles & interpretation (provocation phase, medium, indications)"
      - "Vault prolapse in sexually active woman (laparoscopic sacrocolpopexy vs sacrospinous)"
      - "Voiding dysfunction / large residual (self-catheterisation, MS)"
      - "Post-surgical urinary fistula recognition (uretero-peritoneal, VVF)"

  - category: "Gynaecology"
    subcategory: "Benign gynaecology & menstrual disorders"
    weight: 6
    specific_areas:
      - "AUB / HMB management pathways"
      - "Severe PMS/PMDD most effective treatment (GnRH analogue, SSRI, COCP hierarchy)"
      - "Contraception with medical comorbidity (implant bleeding → oestrogen; epilepsy; valproate)"
      - "Fibroid / adenomyosis management decisions"
      - "GSM / menopause treatment individualised by cancer history"

  - category: "Gynaecology"
    subcategory: "Surgical principles & complications"
    weight: 7
    specific_areas:
      - "Diathermy bowel injury mechanism (capacitative coupling vs insulation failure vs direct)"
      - "Laparoscopic primary trocar entry: supine vs Trendelenburg (aortic injury risk)"
      - "Post-laparoscopy day-14 acute abdomen (bowel injury vs ileus vs fistula)"
      - "Hysteroscopy fluid overload prevention (distension pressure, media)"
      - "Difficult hysteroscopic entry / cervical stenosis (misoprostol priming)"
      - "Pelvic space anatomy for safe dissection & node biopsy"

  - category: "Gynaecology"
    subcategory: "Paediatric & adolescent gynaecology"
    weight: 4
    specific_areas:
      - "Prepubertal vaginal discharge next step (swabs before treatment / safeguarding)"
      - "Precocious puberty work-up (bone age, gonadotropins, 17-OHP)"
      - "Adolescent PCOS diagnosis nuance"
      - "DSD / CAIS presentation (Tanner mismatch, karyotype)"

  # ---------------- CROSS-CUTTING (≈8) ----------------
  - category: "Professional practice"
    subcategory: "Ethics, consent & law (Sri Lanka context)"
    weight: 4
    specific_areas:
      - "Gillick/Fraser competence for adolescent contraception (SL context, Mithuru Piyasa)"
      - "Consent dispute / procedure without consent (risk management pathway)"
      - "Capacity assessment (psychiatric comorbidity)"

  - category: "Professional practice"
    subcategory: "Research methods, audit & QI"
    weight: 2
    specific_areas:
      - "Study design selection for a stated research question"
      - "Audit vs root cause analysis vs process mapping"
      - "Qualitative screening-programme quality measures"

# ─────────────────────────────────────────────────────────────
# EMQ BLUEPRINT
# Weight = share of the 30-question EMQ paper (weights sum to ~100).
# `theme` MUST match the EMQ `theme` field in your JSON bank.
# EMQ items come in themed sets (one option list, 2–5 scenarios each).
# ─────────────────────────────────────────────────────────────
blueprint_emq:
  - theme: "Fetal & feto-maternal medicine (FGR / surveillance)"
    weight: 10
    specific_areas:
      - "Early vs late onset FGR management steps"
      - "Doppler interpretation (uterine artery, umbilical artery, ductus venosus, CPR)"
      - "Anhydramnios / renal agenesis prognosis counselling"
      - "Computerised CTG short-term variability, timing of delivery"

  - theme: "Medical disease differentials in pregnancy"
    weight: 10
    specific_areas:
      - "Chest pain / SOB: PE vs pancreatitis vs MI vs severe asthma vs anxiety"
      - "Epigastric pain + proteinuria (pre-eclampsia vs pancreatitis)"
      - "Twin pregnancy with SOB after hyperemesis"

  - theme: "Headache in pregnancy & postpartum"
    weight: 8
    specific_areas:
      - "CVT (post-LSCS, high BMI, confusion)"
      - "Idiopathic intracranial hypertension (papilloedema, worse on coughing)"
      - "Migraine vs pre-eclampsia vs meningitis vs dehydration"

  - theme: "Infections in pregnancy (organisms & management)"
    weight: 10
    specific_areas:
      - "Match organism to scenario (Strep pyogenes, Chlamydia, GBS, E. coli, HSV)"
      - "Bacterial vaginosis regimens (symptomatic, asymptomatic, pre-termination)"
      - "Varicella exposure pathways (VZIG, IgG testing, acyclovir, vaccination timing)"

  - theme: "Paediatric & adolescent gynaecology investigations"
    weight: 10
    specific_areas:
      - "Central (GnRH-dependent) precocious puberty → bone age, gonadotropins"
      - "Peripheral precocious puberty (prepubertal gonadotropins) → USS, 17-OHP"
      - "CAIS / Tanner mismatch → karyotype"
      - "Adolescent PCOS diagnostic pathway"

  - theme: "Gynaecological oncology (staging, surgery, biopsy)"
    weight: 10
    specific_areas:
      - "Cervical cancer surgical type by stage (Piver-Rutledge / Querleu-Morrow)"
      - "Fertility-sparing options (trachelectomy) by depth/size"
      - "Vulval CA biopsy & definitive surgery by size/site/nodes"

  - theme: "Urogynaecology management"
    weight: 9
    specific_areas:
      - "Voiding dysfunction (MS, low flow, large residual)"
      - "Refractory OAB (post anticholinergic + mirabegron → botulinum toxin)"
      - "Postpartum stress incontinence"
      - "Investigation choice (multichannel cystometry, uroflowmetry)"

  - theme: "Surgical anatomy & complications"
    weight: 9
    specific_areas:
      - "Pelvic spaces (Retzius/corona mortis, Okabayashi/Yabuki nerve-sparing, node biopsy)"
      - "Nerve injuries (common peroneal from lithotomy, pudendal from sacrospinous fixation)"
      - "Bowel injury management (serosal, monopolar sigmoid, Ogilvie syndrome)"

  - theme: "Menopause & GSM"
    weight: 6
    specific_areas:
      - "GSM management individualised by cancer type (breast, radiotherapy, hormone-sensitive)"
      - "Local oestrogen vs moisturisers vs tibolone selection"

  - theme: "Contraception & preconception counselling"
    weight: 6
    specific_areas:
      - "Method choice with comorbidity (epilepsy, HMB, BMI, previous chlamydia)"
      - "Teratogen preconception counselling (sodium valproate)"
      - "Postpartum contraception timing"

  - theme: "Reproductive endocrinology (biochemical profiles)"
    weight: 6
    specific_areas:
      - "PCOS biochemical picture (↑LH, ↑AMH, hyperinsulinaemia, acanthosis)"
      - "Hyperandrogenism source (adrenal vs ovarian vs tumour)"

  - theme: "Vulval conditions & dermatoses"
    weight: 4
    specific_areas:
      - "Vulval dermatoses (lichen sclerosus, lichen planus, pemphigoid)"
      - "Vulval ulcers (Behcet, LGV, chancroid, syphilitic chancre)"
      - "Pregnancy dermatoses (PEP, pemphigoid gestationis, striae, atopic eruption)"

  - theme: "Research methodology & study design"
    weight: 2
    specific_areas:
      - "Match research question to design (case-control, cohort, RCT, systematic review, descriptive)"

# ─────────────────────────────────────────────────────────────
# PRIORITY / HIGH-YIELD BOOST
# Multiplier applied AFTER weighting to nudge selection toward
# repeatedly-tested, high-discrimination topics from the 4-year recall.
# ─────────────────────────────────────────────────────────────
priority_topics:
  - match: "Meconium-stained liquor"
    boost: 1.5
  - match: "PPH stepwise management"
    boost: 1.5
  - match: "FGR surveillance"
    boost: 1.5
  - match: "Cervical cancer staging"
    boost: 1.4
  - match: "Diathermy bowel injury"
    boost: 1.4
  - match: "Gillick competence"
    boost: 1.4
  - match: "Mitral stenosis in pregnancy"
    boost: 1.4
  - match: "Vulval haematoma management"
    boost: 1.35
  - match: "PCOS diagnosis"
    boost: 1.3
  - match: "Rh isoimmunisation MCA-PSV"
    boost: 1.3
  - match: "Vulval SCC management"
    boost: 1.3
  - match: "Ectopic pregnancy methotrexate"
    boost: 1.3
  - match: "Ovarian tumour markers"
    boost: 1.25
  - match: "DKA in pregnancy"
    boost: 1.2
  - match: "Postpartum psychosis"
    boost: 1.2
  - match: "Precocious puberty work-up"
    boost: 1.2
  - match: "Nerve injuries in gynaecological surgery"
    boost: 1.2
  - match: "Study design selection"
    boost: 1.2
  - match: "PPROM diagnosis"
    boost: 1.15
  - match: "CMV serology avidity"
    boost: 1.15
  - match: "Vault prolapse surgical choice"
    boost: 1.15
---

# PGIM MD Part 2 (O&G) — Exam Blueprint · 4-Year Recall Synthesis (2022–2025)

> **v2 (2026-07-16):** now incorporates the **full 2023 SBA paper** (previously 2023 was OSCE-only). Changes: added *Early pregnancy & ectopic* SBA bucket; enriched oncology (germ-cell tumours, exenteration, salpingectomy risk-reduction), medical disorders (DKA, asthma+HTN, lactation suppression in PET, mitral stenosis pulmonary oedema), fetal medicine (PPROM diagnosis, early-FGR delivery criteria), subfertility (male hypogonadotropic), benign gynae (PMS/PMDD), and surgical principles (laparoscopic entry, cervical stenosis). Weights rebalanced; both sections still sum to 100.

> Free-text context for the AI coach. **Not** used for selection — only the YAML header drives question sampling. Use this to explain answers, frame stems in the house style, and coach candidates on examiner tendencies.

## 1. Paper anatomy & marking
- **SBA:** 30 questions × +3 = 90 marks. Single lead stem, **5 options**, one best answer. No negative marking.
- **EMQ:** 30 scored items × +3 = 90 marks. Delivered as **themed sets**: one option list (8–10 options) followed by **2–5 vignettes**, each scored as one question. Options may be used once, more than once, or not at all.
- **Combined C1.2 theory** is reported out of 600 after conversion. Duration for the SBA+EMQ paper is **2 hours** in the real exam; this simulator uses the exam-realistic 120-min envelope (adjust `duration_min` as needed).
- **Style:** clinical vignette led, management-decision heavy ("**next best step**", "**most appropriate**", "**best investigation**"), frequently anchored in **Sri Lankan service context** (Mithuru Piyasa, FHB pathways, resource-aware choices).

## 2. Examiner tendencies (recurring across 2022–2025)
- **"Next best step" dominates.** Most SBAs test *sequencing* of management, not recall of a fact. The distractors are usually all *plausible later steps* — the key is what comes **first/now**.
- **Guideline-anchored.** Answers map to RCOG Green-top, NICE NG, FIGO 2018 (oncology staging), FSRH UKMEC (contraception), ESHRE (PCOS/POI/endometriosis), BASHH (STI).
- **Sri Lanka framing.** Adolescent SRH → Gillick/Fraser + Mithuru Piyasa; audit/governance → RCA vs audit; resource-aware delivery decisions.
- **Basic-science applied.** Diathermy physics (capacitative coupling), pelvic-space anatomy, nerve-injury mapping, blood-loss volume by EBV — pure applied anatomy/physics appears every year.
- **Serology & numbers.** CMV avidity, NAAT window, anti-D titres, TG thresholds, thyroxine dosing — expect one or two "interpret the number" items.

## 3. Recurring high-yield stems (must-master)
These appeared (in varying dress) in ≥2 of the four years:

| Stem family | Canonical answer / teaching point |
|---|---|
| Ward has ↑PPH → first step | **Root cause analysis** (not audit; audit compares to a set standard, RCA finds the cause of a sentinel signal) |
| Monopolar bowel injury, good insulator | **Capacitative coupling** (current induced despite intact insulation) |
| Precipitate labour PPH on oxytocin, next step | **Explore for genital tract tears** (Tone done → Trauma) |
| Cervical SCC staging | **MRI pelvis + CT chest/abdomen** (FIGO 2018; imaging-based, not EUA-only) |
| 15-yr-old wants contraception, competent | **Provide after confirming competence** (Gillick/Fraser; SL context) |
| Subdermal implant irregular bleeding | **Oestrogen (patch/COC) supplement** — do not remove implant for bleeding alone |
| Postpartum psychosis | **MBU admission + antipsychotics** (preserve mother–baby dyad) |
| Rh isoimmunisation, screen fetal anaemia | **MCA-PSV Doppler** (Liley/Queenan curves are for amniotic bilirubin, superseded) |
| Prepubertal vaginal discharge | **Swabs for culture first** — do not empirically treat or presume abuse |
| Mitral stenosis in labour, stable | **Vaginal delivery with assisted/short second stage** (avoid pushing-related decompensation) |
| Seizure on lamotrigine, PET excluded | **IV lorazepam + continue labour** (epileptic, not eclamptic → not MgSO4) |
| Borderline ovarian tumour hallmark | **No stromal invasion** (± non-invasive implants) |
| Vulval/labial haematoma after delivery (<4–5 cm, stable) | **Ice pack + observe/review**; explore in theatre if enlarging/large/unstable (asked 2023, 2024) |
| Mitral stenosis, postpartum pulmonary oedema | **Sit up + high-flow O2 + IV frusemide** (first-line for acute decompensation) |
| Ectopic, hCG ~7000 + adnexal mass, no IUP | **IM methotrexate 50 mg/m² with hCG follow-up** (day 4 & 7); check eligibility thresholds |
| DKA in pregnancy | **IV fluids (normal saline) + insulin + K⁺ replacement** — resuscitate mother first |
| Early-onset FGR, when to deliver | **Reduced short-term variability on computerised CTG** / abnormal ductus venosus (not UA PI alone) |
| PPROM confirmation, equivocal speculum/USS | **PAMG-1 (or IGFBP-1)** — more accurate than ferning/nitrazine |
| Painful vulval ulcer + inguinal lymphadenopathy | ***Haemophilus ducreyi*** (chancroid) — painful ulcer + painful nodes |
| Severe PMS, most effective treatment | **GnRH analogue** (most effective; SSRI and COCP are earlier-line) |
| Male infertility, low FSH/LH/testosterone post-pituitary surgery | **Gonadotropins (FSH/hCG)** — hypogonadotropic hypogonadism |
| Opportunistic bilateral salpingectomy | Meaningful **ovarian cancer risk reduction** — counsel at benign pelvic surgery |
| Recurrent cervical cancer, isolated bladder involvement, no metastasis | **Anterior exenteration** (curative intent when central recurrence only) |

> **2023 note:** the 2023 SBA was heavily weighted to **gynae-oncology** (≈6/21 stems) and **medical disorders in pregnancy** (cardiac, DKA, asthma+HTN, lactation suppression in PET). This confirmed the top-two SBA buckets and added the standalone **early pregnancy / ectopic** area.

## 4. EMQ theme mechanics (how the paper builds sets)
- **Investigation-selection sets** (paediatric gynae, feto-maternal): one long list of tests → pick the single most informative next test per vignette.
- **Management-selection sets** (labour, urogynae, infections, GSM): list of interventions → match to the specific clinical nuance.
- **Diagnosis/classification sets** (headache, medical disease differentials, vulval conditions, nerve injuries, pelvic spaces): list of conditions/structures → match to the discriminating clue.
- The **discriminator is always a single detail** (gonadotropin level, Tanner mismatch, timing, laterality, BMI, day postpartum). Coach candidates to hunt that detail.

## 5. Must-know guideline anchors (for answer explanations)
- **RCOG GTG:** PPH (52), PASD (27), FGR/SGA (31), Rh D prophylaxis (22), operative vaginal delivery (26), epilepsy (68), thromboprophylaxis (37a/b).
- **NICE:** NG133 (hypertension in pregnancy), NG3 (diabetes), NG23 (menopause), NG88 (HMB), CG171/NG123 (urinary incontinence & prolapse).
- **FIGO 2018** cervical staging; **Querleu-Morrow / Piver-Rutledge** radical hysterectomy classes.
- **ESHRE:** PCOS (2023), POI, endometriosis (2022).
- **FSRH UKMEC** for contraception with comorbidity; **BASHH** for STI/NAAT.
- **Sri Lanka:** FHB maternal care pathways, Mithuru Piyasa, national anti-D and thalassaemia programmes.

## 6. Simulator usage notes
- Selection is driven **only** by the YAML weights + `priority_topics` boosts. Keep `category`/`subcategory`/`theme` strings in the question bank **exactly** matching the keys above.
- `specific_areas` are **advisory tags** for authors/AI to ensure sub-topic spread inside each weight bucket — surface them to the tagging model when importing JSON so each bucket is populated across its listed areas, not clustered on one.
- Target per mock: 30 SBA sampled across the SBA buckets (weights ≈100) and 30 EMQ items sampled across EMQ themes (weights ≈100), then apply boosts. Aim for ≥1 item from every bucket over any 2 consecutive mocks so nothing is starved.
- All four years (2022–2025) now contribute full SBA data; the EMQ blueprint is anchored on 2022, 2024, and 2025 (2023 recall captured SBA only). Weights reflect the blended 4-year frequency and do not over-fit any single year.
