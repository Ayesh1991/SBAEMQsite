/* ============================================================
   aiosce.js — OSCE in AI.

   WHAT THIS IS

   A station, sat out loud, against a chat model acting as the examiner —
   on the other half of a split-screen iPad. AUREUM does not talk to the
   model here. It hands you the prompt, holds the clock, records the room,
   and takes the verdict back afterwards.

   WHY IT IS BUILT THAT WAY, AND NOT AS AN API CALL

   The site already has a live examiner that speaks through the server, so
   the obvious move is another server action. It would be worse. What is
   wanted is a fifteen-minute spoken conversation with a model that pushes
   back, follows an answer where it goes, and teaches at the end — and the
   thing that does that best is the chat application itself, with its own
   voice mode, its own memory of the conversation, and no round trip
   through us on every turn. Trying to reimplement that through a text
   endpoint would produce a worse examiner at a higher cost.

   So the split is honest about who does what:

     · the model runs the examination      (in its own app, from our prompt)
     · AUREUM runs the clock and the tape  (the two things the model cannot do)
     · the model marks it                  (it has the scheme; it was there)
     · AUREUM keeps the result             (beside every other attempt)

   THE PROMPT IS THE PRODUCT

   Everything that makes this a PGIM Part II station rather than a chat
   about obstetrics lives in the prompt: ask the written questions and no
   others, one at a time; reveal what is meant to be revealed when it is
   meant to be revealed; prompt only as much as the level says; and say
   NOTHING evaluative until the candidate calls time. That last rule is
   the one a model breaks by instinct — it wants to be helpful after every
   answer — so it is stated three times, in three places, deliberately.

   THE RECORDING IS OURS

   Whatever happens in the other app, the tape belongs here: the same
   recorder as every other station, the same 24-hour server copy, the same
   Drive copy, and the same route into AI marking. So even a session whose
   JSON never comes back is not a session that vanished.

   MARKED BY CLAUDE IS AN ORDINARY ATTEMPT

   The imported verdict becomes an attempt with source:'claude' and the
   same shape the manual sheet and the AI marker produce. Which means the
   report page, the printout, the progress tab and the blueprint coverage
   all work on it without knowing it exists — the same rule the Created
   OSCE bank follows, for the same reason.
   ============================================================ */

const AiOsce = (() => {
  'use strict';

  const cfg = () => window.AUREUM_CONFIG || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rid = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* Developer-only today, with a flag so it can be handed to others from
     user management later without touching this file. */
  function allowed(user) {
    if (!user) return false;
    if (user.email && cfg().developer && user.email === cfg().developer.email) return true;
    if (sessionStorage.getItem('aureum-dev') === '1') return true;
    return !!user.featureFlags?.aiosce;
  }

  /* ---------------- the three marks ----------------
     Drawn rather than fetched: an <img> to a logo on somebody else's CDN is
     a request that can fail, a layout that can jump, and a file to keep. */
  const LOGOS = {
    claude: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.4c.36 0 .66.28.7.64l.42 4.2 2.5-3.05a.71.71 0 0 1 1.22.7l-1.72 3.86 3.66-2.1a.71.71 0 0 1 .86 1.1l-3.05 2.5 4.2.42a.71.71 0 0 1 0 1.4l-4.2.42 3.05 2.5a.71.71 0 0 1-.86 1.1l-3.66-2.1 1.72 3.86a.71.71 0 0 1-1.22.7l-2.5-3.05-.42 4.2a.71.71 0 0 1-1.4 0l-.42-4.2-2.5 3.05a.71.71 0 0 1-1.22-.7l1.72-3.86-3.66 2.1a.71.71 0 0 1-.86-1.1l3.05-2.5-4.2-.42a.71.71 0 0 1 0-1.4l4.2-.42-3.05-2.5a.71.71 0 0 1 .86-1.1l3.66 2.1-1.72-3.86a.71.71 0 0 1 1.22-.7l2.5 3.05.42-4.2c.04-.36.34-.64.7-.64Z"/></svg>`,
    gpt: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" d="M12 3.6 17.2 6.6v6l-5.2 3-5.2-3v-6z"/><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" d="M6.8 12.6 12 9.6l5.2 3M12 9.6V3.6M12 15.6v4.8"/></svg>`,
    gemini: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2c.3 4.9 5.1 9.7 10 10-4.9.3-9.7 5.1-10 10-.3-4.9-5.1-9.7-10-10 4.9-.3 9.7-5.1 10-10Z"/></svg>`
  };
  const MODELS = [
    { id: 'claude', name: 'Claude', where: 'claude.ai', voice: true,
      note: 'Voice mode, and a project whose instructions hold the examiner rules for every station.' },
    { id: 'gpt', name: 'ChatGPT', where: 'chatgpt.com', voice: true,
      note: 'Voice mode works; paste the prompt into a new chat each time.' },
    { id: 'gemini', name: 'Gemini', where: 'gemini.google.com', voice: true,
      note: 'Live voice works; paste the prompt into a new chat each time.' }
  ];

  /* ---------------- prompting level ----------------
     The same 0–100 dial the built-in examiner uses, so "35" means the same
     thing wherever you are sitting. Expressed to the model as behaviour,
     not as a number — a number it would interpret freely. */
  const LEVEL_KEY = 'aureum.osce.aiprompt';
  const levelOf = () => {
    const raw = localStorage.getItem(LEVEL_KEY);
    if (raw == null || raw === '') return 35;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 35;
  };
  const setLevel = n => { try { localStorage.setItem(LEVEL_KEY, String(n)); } catch {} };

  function levelText(n) {
    if (n <= 5) return 'NEVER prompt. Ask the question, then wait in silence however long the candidate takes. If they stop, say only "Anything else?" once, and accept whatever follows. This is the real exam.';
    if (n <= 25) return 'Prompt very rarely. Only after a full 8–10 seconds of silence, and only with a neutral opener such as "Anything else?" or "Go on." Never name a topic the candidate has not raised.';
    if (n <= 50) return 'Prompt sparingly. After about 5 seconds of silence you may give ONE neutral nudge, and if a whole area of the scheme is untouched you may point at the AREA — "What about the investigations?" — but never at the answer itself.';
    if (n <= 75) return 'Prompt helpfully. Nudge after a few seconds of silence, name the area that is missing, and if the candidate is clearly stuck rephrase the question once. Still never state a marking point for them.';
    return 'Prompt generously — this is a teaching run, not an exam. Nudge freely, name the missing areas, rephrase, and offer the first half of a point to see whether they can finish it. Say clearly at the start that this is a coached run.';
  }

  /* ================= the prompt =================

     Written to be pasted whole into a new chat, or kept once in a project's
     instructions with only the station changing. Both are supported because
     both are how it will really be used: a project for the rules, a paste
     for the case. */

  function rulesBlock(level) {
    return `You are an examiner in the PGIM (Sri Lanka) MD Part II OSCE in Obstetrics and
Gynaecology. You are not a tutor, a chatbot or an assistant during the examination.
You are a senior examiner sitting opposite a candidate for fifteen minutes.

THE ONLY SOURCE OF QUESTIONS

Every question you ask, word for word, must come from the most recently pasted
STATION block in this conversation. Not from training knowledge of what a
"typical" question on this topic sounds like. Not from a station discussed
earlier in the same chat. If you are about to ask a question and you did not
just re-read it character-by-character from the pasted block IN THIS TURN,
stop and re-read the block first.

A NEW STATION BLOCK FULLY REPLACES ANY EARLIER ONE in this conversation. If a
second or third block is pasted, discard everything from the previous one —
scenario, questions, marking scheme, all of it — and work only from the latest
paste. Never blend two pastes together.

PRE-FLIGHT VERIFICATION (mandatory, before the clock starts)

1. Confirm you have the block: say back the topic, the number of questions and
   the total marks from its header lines — and, if the header carries a
   role_player line, say back the character's name and role too, so the
   candidate knows you will be playing them. If no station block has arrived,
   say "I have not received the station block" and stop there. NEVER invent
   questions to fill the gap — fifteen minutes of plausible invented questions
   is far worse than a session that stops in the first ten seconds, because it
   is only discovered at the very end.
2. Immediately after that, and BEFORE reading the scenario, output the question
   stems VERBATIM, numbered, exactly as they appear in the block's
   "QUESTION STEMS, VERBATIM" section. Stems only — never the marking points,
   never the mark breakdown.
3. Then say exactly: "Confirm these match before I read the scenario."
4. Wait for the candidate's explicit "confirmed" before reading the scenario or
   starting the clock.
5. If the candidate says anything does not match, do not correct it from
   memory. Say "Please re-paste the station block" and stop there.

This costs under a minute, happens once, and sits outside the fifteen minutes.
It exists so a mismatch is caught before the examination rather than mid-answer,
which is when it currently costs the candidate their exam time.

HOW THE STATION RUNS (after verification is confirmed)

1. Read the SCENARIO out loud, word for word, then say
   "Take a moment, then tell me when you are ready."
2. Ask the verified questions, in order, ONE AT A TIME, in the wording just
   verified. You may shorten a long question for speech, but you must not
   change what it asks — and you must not reconstruct it from memory, since
   it was quoted verbatim two steps ago.
3. NEVER invent a question that is not in the list. If the candidate finishes
   every question with time left, go deeper on answers they gave — "you
   mentioned X, take me through that" — using the marking points as the map.
   Deeper is allowed. New is not.
4. Where a question carries a REVEAL line, say that information out loud
   immediately before asking that question, and not one moment earlier.
5. Keep to the clock. Divide the fifteen minutes roughly in proportion to the
   marks. If a question is running long, say "Let us move on" and move on.
6. MID-SESSION SELF-CHECK: immediately before asking Q2, re-read Q2 from the
   pasted block in that turn. Immediately before asking Q3, re-read Q3. Do not
   let the pre-flight verification carry you through the whole session —
   re-verify at the point of use, every time.

WHEN THE BLOCK CARRIES A ROLE PLAYER

Some stations are not a viva. Somebody plays the patient, and what is being
examined is as much the talking as the knowledge. Where the block has a
ROLE PLAYER section you play that character as well as examining — and the two
voices must never blend into one line.

· As EXAMINER you set the scene, ask the scored questions, keep time and mark.
· As the CHARACTER you say only what the character says, plus — where it helps —
  a short physical action in *asterisks*: *she looks down, twisting her hands*.
  Posture, expression, small actions only. Never narration, never inner
  thoughts, never a restatement of what the candidate just said.
· Reveal a reveal_only_if_asked fact ONLY when the candidate's approach
  genuinely triggers it. Respect do_not_volunteer at all times, even when the
  candidate asks something adjacent but not quite right. Eliciting it is the
  station; handing it over is marking the candidate's work for them.
· Follow emotional_arc and tone_and_manner as written rather than defaulting to
  a generic distressed patient. The specificity is why the brief was written.
· The character never marks. Marks come from the scheme, and the candidate's
  manner is scored only where the scheme has a section for it.

Where the block has NO role-player section, the station is a straight examiner
viva. Do not invent a patient to talk to.

PROMPTING — the level for this run is ${level}/100

${levelText(level)}

SILENCE IS NOT AN EMERGENCY. A candidate who is thinking is working. Do not
fill the gap because it feels awkward.

WHAT YOU MUST NOT DO DURING THE FIFTEEN MINUTES

· Do not say whether an answer is right, wrong, good, partial or complete.
· Do not say "correct", "exactly", "not quite", "hmm", "good", or any other
  evaluative word. Acknowledge with "Thank you" or "Right" and move on.
· Do not teach, correct, add or supply information.
· Do not reveal or read out the marking scheme.
· Do not give marks, running totals, or hints about how it is going.

You will want to be encouraging. Do not. An examiner who signals approval
tells the candidate which answers were the good ones, and the whole point of
this is that they find out afterwards instead.

HOW IT ENDS

The candidate will say "fifteen minutes over" (or you will see the time is up).
At that moment the examination stops and you change role completely: from
examiner to teacher. Only then do you give:

  1. The marks, question by question, against the marking scheme.
  2. What they said well — specifically, quoting them.
  3. What they missed — every marking point they did not reach, in full.
  4. The corrections: anything they said that was wrong or out of date.
  5. The teaching: the underlying knowledge, properly explained, so the gaps
     close rather than merely being listed.
  6. Their examination technique — structure, signposting, pace, whether they
     answered the question that was asked.
  7. A revision summary of the topic — what a candidate should be able to say
     about it cold, in a few tight paragraphs.
  8. Memory aids: mnemonics, orderings, numbers worth learning as numbers.
     Invent one if no standard aid exists, and say what it expands to.
  9. The traps: what candidates typically say here that loses marks, and what
     to say instead.
 10. What to read: the guideline, chapter or paper that settles each gap, with
     one line on why that one.

Give all ten generously — this is the half of the session with no clock on it,
and it is the half the candidate keeps. Items 7 to 10 go into the JSON as well,
so they survive the chat being closed.

Be exacting on the marks. A comfortable mark helps nobody sitting a real exam.

PROCESS NOTE. If pre-flight verification caught a mismatch, or if a drift
happened anyway and the candidate caught it mid-session, say so plainly in this
feedback and record it in the JSON. A process failure must never disappear
silently into the marking — see the JSON rules.`;
  }

  function jsonBlock(st) {
    return `AFTER the teaching, produce ONE JSON file so the result can be imported
back into AUREUM and kept beside their other attempts. Output it in a single
fenced code block, valid JSON, nothing after it.

{
  "schema": "aureum-osce-claude-v1",
  "station_id": ${JSON.stringify(st.id || '')},
  "topic": ${JSON.stringify(st.topic || '')},
  "sat_on": "YYYY-MM-DD",
  "examiner": "Claude",
  "result": {
    "total": 0, "max": ${OSCE.marksOf(st)}, "percent": 0, "pass": false,
    "examinerComment": "Two or three sentences, as an examiner would write them.",
    "processIntegrity": {
      "preflightConfirmed": true,
      "driftDetected": false,
      "driftNotes": ""
    },
    "questions": [
      { "id": "Q1", "prompt": "the question, copied verbatim from the station block",
        "awarded": 0, "max": 0,
        "transcript": "What the candidate actually said, in brief.",
        "comment": "Your comment on this answer.",
        "points": [
          { "point": "the marking point, copied exactly from the scheme",
            "status": "covered | partial | missed",
            "note": "what they said about it, or what was missing" }
        ] }
    ],
    "strengths": ["specific, quoting them"],
    "improvements": [{ "action": "what to do differently", "marks": 0 }],
    "keyLearning": ["the facts to take away"],
    "teaching": [{ "heading": "topic", "body": "the explanation you gave" }],
    "summary": "The revision summary of this topic, in a few tight paragraphs.",
    "mnemonics": [{ "aid": "the mnemonic or ordering", "expands": "what each letter stands for", "use": "when to reach for it" }],
    "pitfalls": [{ "trap": "what candidates say here that loses marks", "instead": "what to say" }],
    "reading": [{ "source": "the guideline, chapter or paper", "why": "one line on what it settles" }],
    "language": [{ "said": "what they said", "correct": "what to say", "why": "why" }],
    "coaching": { "structure": "", "articulation": "", "pronunciation": "", "technique": "" }${OSCE.hasRole(st) ? `,
    "conversation": {
      "character": "who you played",
      "rapport": "How the conversation actually went, from inside the character.",
      "elicited": ["what they got out of you, and how"],
      "missed": [{ "cue": "the cue the character gave", "wanted": "what would have opened it", "cost": "what stayed hidden" }],
      "phrasing": [{ "said": "what they said to you", "better": "how to put it", "why": "why it lands better" }]
    }` : ''}
  }
}

RULES FOR THE JSON

· "id" AND "prompt" on every question. The id alone is not enough — a
  station whose questions are numbered 1,2,3 cannot be matched to a marking
  that calls them Q1,Q2,Q3, and the report then shows bare question numbers
  with no questions on them.
· One object per marking point, for EVERY point in the scheme, in scheme order.
· "point" must be the scheme's own wording, not a paraphrase.
· "awarded" per question must sum to "total", and "max" per question to the
  station's ${OSCE.marksOf(st)}.
· "percent" is round(total / max × 100). "pass" is total ≥ ${OSCE.passOf(st)}.
· Never leave a marks field null or 0-by-omission — if a point was missed,
  status is "missed" and the marks reflect it.
· "processIntegrity" is not optional. "preflightConfirmed" is true ONLY if the
  candidate explicitly confirmed the verified stems before the scenario was
  read. "driftDetected" is true if an invented or altered question was asked at
  any point and had to be corrected — log it even though the session otherwise
  went ahead, so the pattern stays visible across sessions instead of being
  lost with the chat.
· "summary", "mnemonics", "pitfalls" and "reading" are where the teaching you
  just gave is kept. Everything said in the chat disappears when the chat is
  closed; only what is in this JSON is still there in a fortnight, which is
  when it is actually revised from. Fill them properly — they are not padding.${OSCE.hasRole(st) ? `
· "conversation" is written FROM INSIDE THE CHARACTER, not as the examiner —
  what it felt like to be spoken to that way. "missed" is the valuable half:
  every cue the character gave that the candidate did not pick up, what would
  have opened it, and what stayed hidden as a result. Nothing in this block
  carries marks unless the scheme has a communication section; it is teaching.` : ''}`;
  }

  /* ================= the station block, v2 =================

     WHY THE QUESTION STEMS NOW HAVE A SECTION OF THEIR OWN

     v1 wrote each question as `Q2 (70 marks): Describe in detail and
     demonstrate…` with the marking points indented underneath. Across at
     least four real sessions — FGR, HRT counselling, breech, internal
     iliac artery ligation — the examiner asked plausible invented
     questions instead of these. Reading the sessions back, the failure
     is not defiance: the exact wording was buried on a line that also
     carried a mark weighting and a sub-point count, and a model parsing
     the marks skims the wording.

     So the wording now sits alone. `── QUESTION STEMS, VERBATIM ──`
     contains the question text and NOTHING else: no marks, no
     sub-detail, no scheme. It is short enough to take in at a glance and
     it is what the examiner quotes back during pre-flight verification,
     which means a paste that half-arrived is caught in five seconds
     rather than at the debrief.

     The stems appear twice — once alone, once at the head of their
     marking scheme — and both come from the SAME `q.prompt`, so they are
     character-identical by construction rather than by discipline. If
     they ever diverge, that is a bug here, not something for the
     candidate to patch over mid-station.

     ONE STATION, ONE PASTE. Nothing precedes this block and nothing
     follows it. The rules live permanently in the project; re-pasting
     them beside a station is how two stations came to be blended in one
     conversation. `buildPrompt` is the exception and is for a bare chat
     with no project at all. */
  function stationBlock(st) {
    const qs = OSCE.qsOf(st);
    const reveals = qs.map((q, i) => ({ n: i + 1, text: q.reveal_before })).filter(r => r.text);
    const lines = [
      '═══ AUREUM OSCE STATION ═══',
      `station_id: ${st.id || ''}`,
      `topic: ${st.topic || ''}`,
      `time_minutes: ${OSCE.minsOf(st)}`,
      `total_marks: ${OSCE.marksOf(st)}`,
      `pass_mark: ${OSCE.passOf(st)}`,
      `question_count: ${qs.length}`,
      /* Declared in the header, not left to be discovered halfway down.
         The examiner says this line back during pre-flight, so "it never
         played the character" is caught in the first ten seconds rather
         than at the debrief. */
      ...(OSCE.hasRole(st) ? [`role_player: yes — ${OSCE.roleLabel(st)}`] : []),
      '',
      '── SCENARIO (read aloud word for word) ──',
      st.scenario || '',
      '',
      '── QUESTION STEMS, VERBATIM (no marks, no sub-detail — exact wording only) ──',
      ...qs.map((q, i) => `Q${i + 1}: ${q.prompt || ''}`)
    ];

    /* Reveals get their own short section rather than sitting inside the
       marking scheme, because the scheme is marked "never read aloud"
       and a reveal is the one thing in this block that MUST be. Each
       line names the question it belongs to, so it cannot float free. */
    if (reveals.length) {
      lines.push('',
        '── REVEALS (say each one out loud immediately before its question, and not before) ──',
        ...reveals.map(r => `Q${r.n} REVEAL (say before asking): ${r.text}`));
    }

    /* THE ACTOR BRIEF, WHERE A STATION HAS ONE.

       This is the section that makes a chat model worth more than a
       viva partner: it can be the examiner AND the woman in the chair,
       switching cleanly, without a second person in the room. It sits
       after the reveals and before the scheme because that is the order
       it is needed in, and it carries its own instruction about how to
       speak — a model handed a character with no direction defaults to
       a generic distressed patient, and the specificity is the whole
       point of having written the brief. */
    if (OSCE.hasRole(st)) {
      lines.push('',
        '── ROLE PLAYER (you play this character in scene; never read this section aloud) ──',
        OSCE.roleText(st).replace(/^═══ ROLE PLAYER ═══\n/, ''),
        '',
        'HOW TO PLAY IT',
        '  · Switch cleanly between EXAMINER (questions, timing, marking) and CHARACTER',
        '    (in-scene dialogue). Never blend the two in one line.',
        '  · In character, say only what the character says, plus — where it helps — a short',
        '    physical action in *asterisks* (e.g. *she looks down, twisting her hands*).',
        '    Posture, expression, small actions only: never narration, never inner thoughts,',
        '    never a restatement of what was just said.',
        '  · Reveal a reveal_only_if_asked fact ONLY when the candidate genuinely triggers it.',
        '    Respect do_not_volunteer even when the candidate asks something adjacent.',
        '  · Follow emotional_arc and tone_and_manner as written. Do not default to a generic',
        '    distressed patient — the specificity is the point.',
        '  · The character is never the marker. Marks come from the scheme below, and the',
        '    candidate\'s manner is marked only if the scheme has a section for it.');
    }

    lines.push('', '── MARKING SCHEME (examiner\'s eyes only — never read aloud) ──');
    qs.forEach((q, i) => {
      const pts = OSCE.scorable(q.marking_points);
      const heads = (q.marking_points || []).filter(p => OSCE.isHeading(p));
      if (i) lines.push('');
      lines.push(`Q${i + 1} (${q.marks} marks): ${q.prompt || ''}`);
      if ((q.images || []).length) {
        lines.push(`  ON SCREEN (examiner note): the candidate is looking at ${
          (q.images || []).map(im => im.caption || 'an image').join(', ')}. Ask them to describe it.`);
      }
      if (heads.length) lines.push(`  Sections: ${heads.map(h => OSCE.headText(h)).join(' · ')}`);
      pts.forEach((p, j) => lines.push(`  ${j + 1}. ${p}`));
    });

    lines.push('', `═══ END OF STATION — ${qs.length} questions, ${OSCE.marksOf(st)} marks ═══`);
    return lines.join('\n');
  }

  /** The whole thing, for pasting into a fresh chat with no project. */
  function buildPrompt(st, level) {
    return [
      rulesBlock(level),
      '',
      stationBlock(st),
      '',
      jsonBlock(st),
      '',
      `BEGIN NOW with PRE-FLIGHT VERIFICATION: say back the station line, then quote the`,
      `${OSCE.qsOf(st).length} question stems verbatim from the QUESTION STEMS section, then ask the`,
      `candidate to confirm. Read nothing else until they do.`
    ].join('\n');
  }

  /** The rules alone, as a project instruction file — the station is pasted per run. */
  function buildInstructions(level) {
    const folder = cfg().drive?.claudeMarkFolderId
      ? `https://drive.google.com/drive/folders/${cfg().drive.claudeMarkFolderId}`
      : '';
    return `# AUREUM — PGIM Part II OSCE examiner (v2 — drift-corrected)

Paste this whole document into the **instructions** of a Claude project (or
a custom GPT, or a Gem). Then, for each station, paste only the STATION
block that AUREUM gives you, and the examination begins.

This file is self-contained: the rules, the JSON schema and where the file
goes are all here. You should not need anything else.

**What changed in v2:** a mandatory pre-flight verification step, because
the examiner was repeatedly asking invented questions instead of the pasted
scheme — observed across at least four sessions (FGR, HRT counselling,
breech, internal iliac artery ligation). Nothing forced a re-read of the
pasted block at the moment each question was asked, so the model
pattern-matched to a plausible-sounding question instead. v2 fixes that with
a checkable step rather than a politer instruction, and AUREUM now emits the
question stems in a section of their own so there is nothing to skim past.

---

${rulesBlock(level)}

---

## The station block

Each run begins with the candidate pasting a block headed
\`═══ AUREUM OSCE STATION ═══\`. It carries, in this order: header lines
(\`station_id\`, \`topic\`, \`time_minutes\`, \`total_marks\`, \`pass_mark\`,
\`question_count\`), the scenario, a section headed
**QUESTION STEMS, VERBATIM** containing the exact question wording and
nothing else, any REVEALS, and then the marking scheme — which is yours
alone and is never read out.

The verbatim stems section exists for one purpose: it is what you quote back
during pre-flight verification. Copy those lines out of it exactly. Do not
summarise them, do not merge them with the marking scheme's copy of the same
questions, and do not reword them for speech until after they have been
confirmed.

Some blocks also carry a **ROLE PLAYER** section, and the header says so on a
\`role_player:\` line. Where it is present you are the examiner *and* the
character — see "When the block carries a role player" above. Where it is
absent the station is a straight viva and you must not invent a patient to
talk to.

**Confirm you have it before you start.** Say back the topic, the number of
questions and the total marks. If no station block has arrived, say
"I have not received the station block" and stop. **Never invent questions
to fill the gap** — fifteen minutes of plausible invented questions is far
worse than a session that stops in the first ten seconds, because it is
only discovered at the very end.

**One station is one paste.** Do not accept the general rules and a station
in the same message — these instructions are already loaded here
permanently, and re-pasting them beside a station is how two stations come
to be blended into one conversation. If a station has to be re-issued, it
arrives as a whole new block, and that block replaces the previous one
entirely.

---

## The JSON at the end

After the teaching, produce ONE JSON file in a single fenced code block,
valid JSON, nothing after it. This is what AUREUM imports.

\`\`\`json
{
  "schema": "aureum-osce-claude-v1",
  "station_id": "the id given in the station block",
  "topic": "the topic given in the station block",
  "sat_on": "YYYY-MM-DD",
  "examiner": "Claude",
  "result": {
    "total": 0, "max": 100, "percent": 0, "pass": false,
    "examinerComment": "Two or three sentences, as an examiner would write them. If a process failure occurred (drift, mismatch, skipped question), state it here explicitly.",
    "processIntegrity": {
      "preflightConfirmed": true,
      "driftDetected": false,
      "driftNotes": ""
    },
    "questions": [
      { "id": "Q1", "prompt": "the question, copied verbatim from the station block",
        "awarded": 0, "max": 0,
        "transcript": "What the candidate actually said, in brief.",
        "comment": "Your comment on this answer.",
        "points": [
          { "point": "the marking point, copied exactly from the scheme",
            "status": "covered | partial | missed",
            "note": "what they said about it, or what was missing" }
        ] }
    ],
    "strengths": ["specific, quoting them"],
    "improvements": [{ "action": "what to do differently", "marks": 0 }],
    "keyLearning": ["the facts to take away"],
    "teaching": [{ "heading": "topic", "body": "the explanation you gave" }],
    "summary": "The revision summary of this topic, in a few tight paragraphs.",
    "mnemonics": [{ "aid": "the mnemonic or ordering", "expands": "what each letter stands for", "use": "when to reach for it" }],
    "pitfalls": [{ "trap": "what candidates say here that loses marks", "instead": "what to say" }],
    "reading": [{ "source": "the guideline, chapter or paper", "why": "one line on what it settles" }],
    "language": [{ "said": "what they said", "correct": "what to say", "why": "why" }],
    "coaching": { "structure": "", "articulation": "", "pronunciation": "", "technique": "" },
    "conversation": {
      "character": "who you played — include this block ONLY if the station had a role player",
      "rapport": "How the conversation actually went, from inside the character.",
      "elicited": ["what they got out of you, and how"],
      "missed": [{ "cue": "the cue the character gave", "wanted": "what would have opened it", "cost": "what stayed hidden" }],
      "phrasing": [{ "said": "what they said to you", "better": "how to put it", "why": "why it lands better" }]
    }
  }
}
\`\`\`

### Rules for the JSON

- \`processIntegrity\` is new in v2. \`preflightConfirmed\` is \`true\` only
  if the candidate explicitly confirmed the verified question list before
  the scenario was read. \`driftDetected\` is \`true\` if at any point an
  invented or altered question was asked and had to be corrected — log it
  even though the examination otherwise proceeded, so the pattern stays
  visible across sessions in AUREUM rather than being lost with the chat.
- Every question carries both \`id\` **and** \`prompt\`, the prompt copied
  from the station block. The id alone is not enough: a station whose
  questions are numbered 1, 2, 3 cannot be matched to a marking that calls
  them Q1, Q2, Q3, and the report then shows bare question numbers with no
  questions on them.
- One object per marking point, for **every** point in the scheme, in
  scheme order. Include the ones that were missed — those are the ones
  worth revising from.
- \`point\` must be the scheme's own wording, not a paraphrase. AUREUM
  matches on it.
- \`station_id\` and \`max\` must be copied from the station block. A
  verdict whose \`station_id\` does not match is refused on import, which
  is deliberate — it would otherwise attach itself silently to the wrong
  station.
- The per-question \`awarded\` must sum to \`total\`, and the per-question
  \`max\` to the station's total marks.
- \`percent\` is round(total ÷ max × 100).
- Never leave a marks field null. A missed point is status \`missed\` with
  the marks to match, not an omission.

### The teaching fields are the point of the whole exercise

\`summary\`, \`mnemonics\`, \`pitfalls\` and \`reading\` are where everything
you explained after the clock stopped is kept. Everything said in the chat
disappears when the chat is closed; only what is in this JSON is still there
in a fortnight, which is when it is actually revised from. So:

- **\`summary\`** — what a candidate should be able to say about this topic
  cold. Not a recap of their answer; the topic itself, properly.
- **\`mnemonics\`** — the memory aids, orderings and numbers worth learning
  as numbers. If no standard aid exists, make one and say what it expands
  to. This is the part candidates ask for most and the part that is most
  often lost.
- **\`pitfalls\`** — the things candidates typically say here that lose
  marks, each paired with what to say instead.
- **\`reading\`** — the guideline, chapter or paper that settles each gap,
  with one line on why that one. Name it precisely enough to find.

Fill them generously. They are not padding, and they cost the candidate
nothing but the paste.

### And when you played a character

\`conversation\` is written **from inside the character**, not as the examiner:
what it was like to be spoken to that way. Include it only when the station
actually had a role player; leave it out entirely otherwise.

\`missed\` is the valuable half. Every cue the character gave that the
candidate did not pick up, what would have opened it, and what stayed hidden
as a result. A candidate who never learns that the pause after "my husband
doesn't know yet" was an invitation will make the same omission in the real
room, where it is the difference between a pass and a fail.

Nothing in this block carries marks unless the marking scheme itself has a
communication section. It is teaching, and it is teaching that no viva-only
station can give.

---

## Where the file goes

Two ways back into AUREUM, and either is fine:

1. **Paste it.** Open **OSCE → My attempts → Bring back an AI-marked
   station**, and paste the JSON block. Quickest, and needs no Drive.
2. **Drop the file in Drive.**${folder ? `

   ${folder}

   Then use **Scan the Drive folder** on the same panel.` : ' Then use **Scan the Drive folder** on the same panel.'}

Either way it lands in **Marked by Claude** beside the stations marked by
AUREUM's own marker and the ones marked in person — the three are kept
apart on purpose, because averaging different examiners together makes the
average mean nothing.
`;
  }

  /* ================= the button and the dialog ================= */

  function buttonHtml() {
    return `<button class="btn btn-ai" id="os-aiosce" type="button">
      <span class="ai-marks">${LOGOS.claude}${LOGOS.gpt}${LOGOS.gemini}</span>
      <span>OSCE in AI</span>
    </button>`;
  }

  function openDialog(st, opts) {
    document.querySelector('.ai-modal')?.remove();
    const level = levelOf();
    const wrap = document.createElement('div');
    wrap.className = 'ai-modal';
    wrap.innerHTML = `
      <div class="ai-modal-back" data-close></div>
      <div class="ai-modal-box" role="dialog" aria-modal="true" aria-label="OSCE in AI">
        <div class="ai-modal-head">
          <div>
            <p class="kicker">OSCE IN AI</p>
            <h3>${esc(st.topic || '')}</h3>
          </div>
          <button class="os-modal-x" data-close aria-label="Close">✕</button>
        </div>

        <div class="ai-modal-body">
          <p class="muted">The model examines you in its own app on the other half of the screen. AUREUM holds the
            clock and records the room, then takes the marking back. Nothing is sent from here — you carry the prompt
            across yourself.</p>

          <div class="ai-pick" id="ai-pick">
            ${MODELS.map((m, i) => `
              <button class="ai-pick-b ${i === 0 ? 'active' : ''}" data-model="${m.id}">
                <span class="ai-mark">${LOGOS[m.id]}</span>
                <b>${m.name}</b>
                <span class="muted tiny">${esc(m.where)}</span>
              </button>`).join('')}
          </div>
          <p class="muted tiny" id="ai-note">${esc(MODELS[0].note)}</p>

          <label class="ai-lvl">
            <span>How much should it prompt you? <b id="ai-lvl-n">${level}</b></span>
            <input type="range" id="ai-lvl" min="0" max="100" step="5" value="${level}">
            <span class="muted tiny" id="ai-lvl-t">${esc(levelText(level))}</span>
          </label>

          <div class="ai-acts">
            <button class="btn btn-gold" id="ai-copy">📋 Copy the prompt</button>
            <button class="btn btn-ghost" id="ai-md">⬇ Project instructions (.md)</button>
            <button class="btn btn-ghost" id="ai-station">📄 Station block only</button>
          </div>
          <p class="muted tiny">Use <strong>Copy the prompt</strong> for a one-off chat with no project. Otherwise put
            the <strong>.md</strong> into a Claude project's instructions once, and from then on paste only the
            <strong>station block</strong> — on its own, as the whole message, with nothing before or after it.</p>
          <p class="muted tiny">The block now carries the question wording in a section of its own, and the examiner
            reads those lines back to you before the clock starts. If what it reads back is not what is on the
            station, the paste did not land — re-paste the whole block rather than correcting it, and never let two
            stations share one conversation.</p>
          <div id="ai-msg" class="ai-msg"></div>
        </div>

        <div class="ai-modal-foot">
          <span class="muted tiny">Paste it, start voice mode, then come back and start the clock.</span>
          <button class="btn btn-primary" id="ai-go">Start the clock and record →</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    let picked = MODELS[0].id;
    let lvl = level;
    const msg = wrap.querySelector('#ai-msg');
    const say = (t, cls) => { msg.innerHTML = `<span class="${cls || 'good'}">${esc(t)}</span>`; };

    const shut = () => { wrap.remove(); window.removeEventListener('hashchange', shut); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') shut(); };
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', shut));
    window.addEventListener('hashchange', shut);
    document.addEventListener('keydown', onKey);

    wrap.querySelector('#ai-pick').addEventListener('click', e => {
      const b = e.target.closest('[data-model]'); if (!b) return;
      picked = b.dataset.model;
      wrap.querySelectorAll('.ai-pick-b').forEach(x => x.classList.toggle('active', x === b));
      wrap.querySelector('#ai-note').textContent = MODELS.find(m => m.id === picked).note;
    });

    const slider = wrap.querySelector('#ai-lvl');
    slider.addEventListener('input', () => {
      lvl = Number(slider.value); setLevel(lvl);
      wrap.querySelector('#ai-lvl-n').textContent = lvl;
      wrap.querySelector('#ai-lvl-t').textContent = levelText(lvl);
    });

    const copy = async (text, what) => {
      try { await navigator.clipboard.writeText(text); say('✓ ' + what + ' copied — paste it into ' + MODELS.find(m => m.id === picked).where); }
      catch { say('This browser would not let the page copy. Long-press the prompt in the box that just opened.', 'bad'); showFallback(wrap, text); }
    };
    wrap.querySelector('#ai-copy').addEventListener('click', () => copy(buildPrompt(st, lvl), 'The whole prompt'));
    /* THE BLOCK ALONE — nothing appended.
       This used to copy the station block plus the JSON schema. The
       schema is already in the project's instructions, and pasting it
       again beside a station is one of the two things that produced the
       blending the v2 format exists to stop: every extra paragraph in
       the message is another chance for an earlier station's questions
       to be the ones the model reaches for. One station, one paste. */
    wrap.querySelector('#ai-station').addEventListener('click', () => copy(stationBlock(st), 'The station block'));
    wrap.querySelector('#ai-md').addEventListener('click', () => {
      const md = buildInstructions(lvl);
      const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = 'AUREUM_OSCE_examiner_instructions.md';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      say('✓ Downloaded — paste it into the project’s instructions once, and use “Station block only” from then on.');
    });

    wrap.querySelector('#ai-go').addEventListener('click', () => {
      shut();
      location.hash = '#/osce/ai/' + encodeURIComponent(st.id) + (opts?.sid ? '?s=' + encodeURIComponent(opts.sid) : '');
    });
  }

  /* Clipboard access is refused in more situations than people expect —
     an iPad in a saved-to-home-screen window being one. A textarea the
     reader can select from is not elegant, but it always works. */
  function showFallback(wrap, text) {
    const host = wrap.querySelector('#ai-msg');
    const ta = document.createElement('textarea');
    ta.className = 'ai-fallback'; ta.rows = 8; ta.value = text;
    host.appendChild(ta); ta.focus(); ta.select();
  }

  /* ================= the live session (#/osce/ai/:id) =================

     AUREUM's half of the split screen. Deliberately almost empty: a clock,
     a recording light, and one button. Anything else here is something to
     look at instead of the examiner.

     The clock counts DOWN, unlike the station runner's, because the thing
     you need to know while talking to another app is how long is left, and
     because the candidate is the one who has to call time — the model
     cannot see a timer. */

  async function session(view, id, user, sid) {
    if (!allowed(user)) {
      view.innerHTML = `<section class="page"><div class="card"><h3 class="card-title">Not turned on for this account</h3>
        <p class="muted">OSCE in AI is being tried out before it is offered to everyone.</p>
        <a class="link" href="#/osce">← Back to the stations</a></div></section>`;
      return;
    }
    view.innerHTML = `<section class="page"><p class="muted">Loading the station…</p></section>`;
    let st = null;
    try { st = await Backend.getOsceStation(id); } catch {}
    if (!st) { view.innerHTML = `<section class="page"><p class="muted">That station is not here. <a class="link" href="#/osce">Back</a></p></section>`; return; }

    const total = OSCE.minsOf(st) * 60;
    let left = total, running = false, timer = null, live = null, tape = null, recFailed = false;

    view.innerHTML = `
      <section class="page ai-run">
        <a class="link muted dev-back" href="${sid ? '#/osce/run/' + encodeURIComponent(sid) : '#/osce/station/' + encodeURIComponent(st.id)}">← Leave without recording</a>
        <header data-animate>
          <p class="kicker">OSCE IN AI · ${OSCE.minsOf(st)} MINUTES · ${OSCE.marksOf(st)} MARKS${
            sid ? ' · IN A CIRCUIT' : ''}</p>
          <!-- NO TOPIC.

               A station's title is the answer to its first question, and in
               a circuit it is a spoiler the runner deliberately withholds
               until the end. It was printed here in letters an inch high.
               The scenario is what a candidate is actually given, so the
               scenario is what this page leads with. -->
          <h1 class="page-title ai-scen">${esc(st.scenario || 'This station has no scenario recorded.')}</h1>
          ${/* WHO, AND NOT ONE WORD MORE.
                The candidate is looking at this screen for the whole
                fifteen minutes. Knowing a character is being played is
                fair and useful — it is on the door of the real station.
                The brief itself is the answer sheet for the conversation
                and never appears here, only in the block that goes to the
                model and on the examiner's own sheet. */
            OSCE.hasRole(st) ? `<p class="ai-rp-flag">
            <span class="os-rp-tag">🎭 Role player</span>
            The examiner is also playing <strong>${esc(OSCE.roleLabel(st))}</strong>. Talk to them, do not
            talk about them — and if it answers you like a viva instead of like a person, the block did not land.</p>` : ''}
        </header>

        <!-- The questions, without their marking points.

             The model is examining from a block pasted into another app,
             and the failure that costs a whole fifteen minutes is that it
             never received it and invented eight plausible questions
             instead. Having the real list on this half turns that into
             something noticed in seconds. It is what the examiner asks,
             never what earns marks — the scheme is not here. -->
        <details class="card ai-qs" id="ai-qs" open>
          <summary><span>📋 The ${OSCE.qsOf(st).length} questions this station really has</span>
            <i>check the examiner against them</i></summary>
          <ol class="ai-qs-list">
            ${OSCE.qsOf(st).map(q => `<li>
              ${q.reveal_before ? `<em class="ai-qs-rev">First: ${esc(q.reveal_before)}</em>` : ''}
              <span>${esc(q.prompt || '')}</span>
              <b>${Number(q.marks) || 0}</b>
            </li>`).join('')}
          </ol>
          <p class="muted tiny">If it asks something that is not on this list, it never received the station —
            paste the block again rather than sitting fifteen minutes of invented questions.</p>
        </details>

        <div class="card ai-clock-card" data-animate>
          <div class="ai-clock" id="ai-clock">${fmt(total)}</div>
          <div class="ai-bar"><i id="ai-bar" style="width:0%"></i></div>
          <div id="ai-mic" class="ai-mic"></div>

          <div class="ai-nomic" id="ai-nomic" hidden>
            <b>The microphone is busy — the clock is running anyway.</b>
            <p>iPadOS gives the microphone to <strong>one app at a time</strong>. If the model's voice mode has it,
              AUREUM cannot also record, and taking it would cut the examination off mid-sentence. Nothing is lost:
              the model is the examiner <em>and</em> the marker, so its verdict does not depend on our tape.</p>
            <p class="muted tiny">If you want the audio as well, either turn on <strong>iPad screen recording</strong>
              from Control Centre before you start — it captures both voices in one file — or record on a second
              device. Either way you can attach the file below when you finish.</p>
          </div>

          <div id="ai-drive"></div>

          <div class="ai-run-acts">
            <button class="btn btn-gold btn-lg" id="ai-start">● Start the clock and record</button>
            <button class="btn btn-ghost" id="ai-pause" hidden>⏸ Pause</button>
            <button class="btn btn-primary" id="ai-stop" hidden>■ Stop — fifteen minutes over</button>
          </div>
          <p class="muted tiny" id="ai-tip">Paste the station into the model first and start its voice mode. Then
            press start here. When the clock reaches zero, say <strong>“fifteen minutes over”</strong> out loud so the
            examiner switches to teaching.</p>

          <details class="ai-note">
            <summary>About recording on one iPad</summary>
            <p>iPadOS gives the microphone to one app at a time, so if the model's voice mode is running, AUREUM
              usually cannot record as well — and it must not fight for it, because losing the microphone mid-answer
              would end the examination. <strong>The clock always runs.</strong> Three ways to keep the audio too:</p>
            <ol>
              <li><strong>Screen recording</strong> — start it from Control Centre before you begin. It captures the
                model's voice and yours in one file. Attach it here when you finish.</li>
              <li><strong>A second device</strong> — a phone recording the room, attached here afterwards.</li>
              <li><strong>No audio at all</strong> — perfectly reasonable here. The model examined you and marks you;
                the tape was only ever for <em>our</em> marker.</li>
            </ol>
          </details>
        </div>

        <div id="ai-after"></div>
      </section>`;
    FX.viewIn(view);

    const clockEl = view.querySelector('#ai-clock');
    const barEl = view.querySelector('#ai-bar');
    const startB = view.querySelector('#ai-start');
    const pauseB = view.querySelector('#ai-pause');
    const stopB = view.querySelector('#ai-stop');
    const after = view.querySelector('#ai-after');

    /* Checked before the clock starts, for the same reason as on the
       station brief: a Drive that has lapsed costs two taps to fix now
       and a recording to fix later. */
    const dvBox = view.querySelector('#ai-drive');
    if (dvBox && typeof Drive !== 'undefined') {
      const paintDv = () => { if (dvBox.isConnected) dvBox.innerHTML = Drive.warnHtml('before'); };
      paintDv();
      Drive.onChange(paintDv);
      Drive.probe();
    }

    function paint() {
      clockEl.textContent = fmt(left);
      clockEl.classList.toggle('is-out', left <= 0);
      clockEl.classList.toggle('is-low', left > 0 && left <= 60);
      barEl.style.width = Math.min(100, ((total - left) / total) * 100) + '%';
    }

    /* THE CLOCK DOES NOT DEPEND ON THE MICROPHONE.

       The first version started the recorder and returned early unless it
       said it had worked — and makeCapture.start() returned undefined on
       success, so it ALWAYS returned early. The microphone opened, the
       strip said "Listening", and the countdown never moved.

       That bug is fixed (start() now answers truthfully), but the shape
       was wrong underneath it too. On this screen the recording is the
       optional half: the model is the examiner AND the marker, so it has
       the whole conversation whatever we capture. The clock is the half
       that cannot fail, because it is the only thing telling you when to
       call time.

       So the clock starts first and unconditionally. The microphone is
       then attempted, and whatever it says is reported beside the clock —
       never in front of it. */
    startB.addEventListener('click', async () => {
      startB.disabled = true;
      running = true;
      startB.hidden = true; pauseB.hidden = false; stopB.hidden = false;
      view.querySelector('#ai-tip').innerHTML =
        'The clock is running. Switch to the other app and answer out loud — this half only has to stay open.';
      paint();

      /* wantMix: the model is talking through the iPad speaker, so the tape
         only carries the examiner if echo cancellation can be relaxed. It
         is a preference — a tape of one voice still marks. */
      live = OSCE.makeCapture(view.querySelector('#ai-mic'), true);
      let ok = false;
      try { ok = await live.start(); } catch { ok = false; }
      if (!ok) {
        /* iPadOS gives the microphone to ONE app. If the model's voice mode
           has it, we cannot also have it — and taking it would break the
           examination, which is the more important of the two. So this is
           stated as a fact of the platform rather than as our failure, with
           the ways round it. */
        recFailed = true;
        view.querySelector('#ai-nomic').hidden = false;
        try { live.stop(); } catch {}
        live = null;
      }

      timer = setInterval(() => {
        if (!running) return;
        left--;
        paint();
        /* At zero the recording keeps running, because the teaching that
           follows is the part worth keeping most. */
        if (left === 0) {
          clockEl.classList.add('is-out');
          view.querySelector('#ai-tip').innerHTML =
            '<strong>Time. Say “fifteen minutes over” out loud now.</strong>' + (recFailed ? ''
              : ' Keep recording through the feedback — that is the part you will want to hear again.');
          try { navigator.vibrate?.([200, 100, 200]); } catch {}
        }
        if (left <= -20 * 60) finish();      // a session nobody stopped
      }, 1000);
    });

    pauseB.addEventListener('click', () => {
      running = !running;
      pauseB.textContent = running ? '⏸ Pause' : '▶ Resume';
      try { running ? live?.resume() : live?.pause(); } catch {}
    });

    stopB.addEventListener('click', finish);

    async function finish() {
      if (!live) return;
      running = false; clearInterval(timer); timer = null;
      stopB.disabled = true; pauseB.hidden = true;
      stopB.textContent = 'Saving the recording…';
      try { tape = await live.stop(); } catch { tape = null; }
      live = null;
      await keep(st, tape, user, after, sid);
      stopB.hidden = true;
    }

    window.addEventListener('hashchange', function off() {
      window.removeEventListener('hashchange', off);
      clearInterval(timer);
      try { live?.stop(); } catch {}
    });
  }

  const fmt = n => {
    const neg = n < 0, a = Math.abs(n);
    return (neg ? '+' : '') + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0');
  };

  /* ---------------- what happens to the tape ----------------

     The same two destinations as every other recording — 24 hours on the
     server, and Drive if it is connected — reached through the same code,
     so nothing here can drift from the station runner. Then the three
     things worth offering: send it to be marked by our own marker, keep
     the audio, or paste back what the model said. */

  async function keep(st, tape, user, host, sid) {
    host.innerHTML = `<div class="card" data-animate><p class="muted">Storing the recording…</p></div>`;
    let stored = null;
    /* The id is minted BEFORE the upload, because the storage path is built
       from it — the tape and the attempt it belongs to have to agree on a
       name before either exists. */
    const attemptId = rid('oc');
    let toDrive = null;
    if (tape?.blob) {
      try { stored = await Backend.uploadOsceAudio(attemptId, tape.blob); } catch {}
      /* `deposit`, not `upload`: it records a miss in the outbox instead
         of swallowing it, which is how several of these sessions came to
         be recorded and never copied without anyone being told. */
      if (typeof Drive !== 'undefined') {
        toDrive = await Drive.deposit(tape.blob,
          Drive.nameFor('AI OSCE — ' + (st.topic || ''), Date.now(), tape.ext || 'webm'),
          { description: `AUREUM OSCE in AI — ${st.topic || ''}`, properties: { attempt: attemptId, station: st.id } },
          { kind: 'osce', id: attemptId, topic: st.topic || '', path: stored?.path || '', when: Date.now() });
      }
    }
    host.innerHTML = `
      <div class="card" data-animate>
        <h3 class="card-title">${tape?.blob ? '✓ The session is recorded' : 'No recording from this device'}</h3>
        ${tape?.blob ? `<audio controls src="${esc(tape.url)}" class="ai-audio"></audio>
          <p class="muted tiny">${stored ? 'Kept on the server for 24 hours' : 'Kept in this browser only — the upload did not go through'}${
            toDrive ? ', and copied to your Drive folder' : ''}.
            ${tape.bothVoices === false ? 'Only your voice is on it — this device would not let go of echo cancellation.' : ''}</p>
          ${toDrive ? '' : (typeof Drive !== 'undefined' ? Drive.warnHtml('after') : '')}
          <p><a class="btn btn-ghost btn-sm" href="${esc(tape.url)}" download="${esc((st.topic || 'osce').replace(/[^\w -]/g, '')) }.${esc(tape.ext || 'webm')}">⬇ Download the audio</a></p>`
          : `<p class="muted">The microphone was not available — almost always because the model's voice mode had it.
             That costs you nothing here: the model examined you and marks you.</p>
           <p class="muted tiny">If you made a screen recording, or recorded on another device, attach it and it is
             kept beside this session exactly as one made here would be.</p>
           <div class="ai-imp-acts">
             <button class="btn btn-ghost btn-sm" id="ai-attach">🎧 Attach a recording</button>
             <input type="file" id="ai-attach-in" accept="audio/*,video/*" hidden>
             <span id="ai-attach-msg" class="muted tiny"></span>
           </div>`}
      </div>

      ${tape?.blob ? `<div class="card os-markbox" data-animate>
        <h3 class="card-title">✨ Have AUREUM mark it as well</h3>
        <p class="muted">The model that examined you will mark it in its own words, and that verdict is the better
          teaching. This is the <em>other</em> reading: our marker, listening to the same tape, scoring against the
          same scheme in the same way as every station you sit here — so the two are directly comparable and the
          numbers sit on one scale.</p>
        <p class="muted tiny">It lands in <strong>Marked by AI</strong>. The model's own verdict lands in
          <strong>Marked by Claude</strong>. Neither replaces the other; that is the point.</p>
        <div class="os-src" id="os-src"></div>
        <div id="os-coach-box"></div>
        <div class="os-mark-acts">
          <div class="os-prov" id="os-prov"></div>
          <button class="btn btn-gold btn-lg" id="os-mark">Mark this station</button>
        </div>
        <p class="os-est" id="os-est"></p>
        <div id="os-mark-out"></div>
      </div>` : ''}

      ${sid ? `<div class="card ai-circ" data-animate id="ai-circ">
        <h3 class="card-title">↩ The circuit is waiting</h3>
        <p class="muted">This station was sat outside the runner, so the circuit does not know it is over until you
          say so. Bring the marking back first if you want it scored — then carry on.</p>
        <div class="ai-circ-acts">
          <button class="btn btn-gold" id="ai-circ-next">Next station →</button>
          <span class="muted tiny" id="ai-circ-msg"></span>
        </div>
      </div>` : ''}

      <div class="card" data-animate>
        <h3 class="card-title">Bring the marking back</h3>
        <p class="muted">The examiner ends by printing a JSON block. Paste it here — or drop the file in your Drive
          folder and scan — and it becomes an attempt like any other, in <strong>Marked by Claude</strong>.</p>
        <div id="ai-import"></div>
      </div>`;
    /* A file from Control Centre's screen recording, or from a phone. It
       goes to exactly the same two places as a tape made here, so nothing
       downstream can tell the difference — including the AI marker. */
    const attach = host.querySelector('#ai-attach');
    if (attach) {
      const inp = host.querySelector('#ai-attach-in');
      const amsg = host.querySelector('#ai-attach-msg');
      attach.addEventListener('click', () => inp.click());
      inp.addEventListener('change', async () => {
        const f = (inp.files || [])[0]; inp.value = '';
        if (!f) return;
        attach.disabled = true; amsg.textContent = 'Storing…';
        try {
          stored = await Backend.uploadOsceAudio(attemptId, f);
          let up = null;
          if (typeof Drive !== 'undefined') {
            up = await Drive.deposit(f, Drive.nameFor('AI OSCE — ' + (st.topic || ''), Date.now(),
              (f.name.split('.').pop() || 'm4a')),
              { description: `AUREUM OSCE in AI — ${st.topic || ''}` },
              { kind: 'osce', id: attemptId, topic: st.topic || '', path: stored?.path || '', when: Date.now() });
          }
          amsg.innerHTML = `<span class="good">✓ ${esc(f.name)} kept for 24 hours${
            up ? ', and copied to Drive' : ''}.</span>`
            + (up || typeof Drive === 'undefined' ? '' : Drive.warnHtml('after'));
        } catch (err) { amsg.innerHTML = `<span class="bad">${esc(err.message || err)}</span>`; attach.disabled = false; }
      });
    }

    /* THE SAME MARKING PATH, NOT A SECOND ONE.

       wireMarkControls draws the source toggle, the model list with its
       prices, the coaching picker and the running cost estimate, and its
       button calls the same markCore every station here uses — the same
       upload, the same pending queue, the same retry, the same attempt
       shape. Reproducing any of that would be reproducing every fix made
       to it since v63.

       `ans` is empty and that is correct: this tape is one unbroken
       fifteen minutes with no per-question segmentation, which is exactly
       the case audio marking already handles — the model listens and
       works out who said what. */
    if (tape?.blob && host.querySelector('#os-mark')) {
      const rec = Object.assign({}, tape, { secs: tape.secs || Math.round((tape.size || 0) / 3000) });
      const ans = {};
      /* [] not '':  is the recogniser's list of {id,t}. Nothing was
         transcribed here — the model listens to the tape instead. */
      OSCE.wireMarkControls(host, st, ans, [], rec,
        { elapsed: OSCE.minsOf(st) * 60, aiExaminer: true },
        /* already uploaded by keep() — do not send it twice */
        stored ? { path: stored.path, expires: stored.expires } : null);

    }

    /* Back into the circuit. The attempt — from either marker — is handed
       over so the station is SCORED in the circuit rather than merely
       marked as sat; whichever arrives first wins, and if neither does the
       circuit still moves on and says the station was not scored. */
    let scored = null;
    if (sid) noteCircuit(sid, st.id);
    const circB = host.querySelector('#ai-circ-next');
    if (circB) {
      const msg = host.querySelector('#ai-circ-msg');
      circB.addEventListener('click', async () => {
        circB.disabled = true; circB.textContent = 'Moving on…';
        try {
          const r = await OSCE.circuitNext(sid, st.id, scored);
          if (!r) { msg.textContent = 'That circuit is no longer stored.'; circB.disabled = false; return; }
          clearCircuit();
          location.hash = r.hash;
        } catch (err) {
          circB.disabled = false; circB.textContent = 'Next station →';
          msg.textContent = err.message || String(err);
        }
      });
    }

    importPanel(host.querySelector('#ai-import'), st, user, sid, {
      id: attemptId,
      get audio() { return stored; },
      onSaved: a => { scored = a; markCircuitScored(host, a); }
    });
  }

  /* ================= marked by Claude =================

     The model has the scheme, it was present for the answers, and it has
     just spent five minutes teaching from them — so its verdict is worth
     keeping. It arrives as JSON and becomes an attempt with
     source:'claude'. Everything downstream — the report, the printout,
     progress, the blueprint — then works on it unchanged, because it is
     the same shape as every other attempt. */

  const SCHEMA = 'aureum-osce-claude-v1';

  function validate(d, st) {
    const e = [];
    if (!d || typeof d !== 'object') return ['That is not a JSON object.'];
    if (d.schema && d.schema !== SCHEMA) e.push(`This says schema "${d.schema}" — expected "${SCHEMA}".`);
    const r = d.result;
    if (!r || typeof r !== 'object') { e.push('There is no "result" block.'); return e; }
    if (!Array.isArray(r.questions) || !r.questions.length) e.push('"result.questions" is missing or empty.');
    const n = v => (v == null || v === '' ? NaN : Number(v));
    if (!Number.isFinite(n(r.total))) e.push('"result.total" is missing or is not a number.');
    if (!Number.isFinite(n(r.max)) || n(r.max) <= 0) e.push('"result.max" is missing, zero or not a number.');
    (r.questions || []).forEach((q, i) => {
      if (!Number.isFinite(n(q.awarded))) e.push(`Question ${i + 1}: "awarded" is missing or is not a number.`);
      if (!Array.isArray(q.points)) e.push(`Question ${i + 1}: "points" is missing.`);
    });
    /* A verdict for a different station is the failure most worth catching:
       it would import cleanly and quietly attach itself to the wrong topic. */
    if (st && d.station_id && String(d.station_id) !== String(st.id))
      e.push(`This marking is for station "${d.station_id}", not "${st.id}".`);
    return e;
  }

  /* The report matches a marking to a question loosely (OSCE.questionFor),
     but it can only show a prompt that exists somewhere. If the model named
     its questions and the station's ids do not line up, take the model's
     wording rather than leaving the report blank. */
  function mergeQuestions(stationQs, markedQs) {
    const out = (stationQs || []).map(q => Object.assign({}, q));
    (markedQs || []).forEach((mq, i) => {
      const q = OSCE.questionFor(out, mq.id, i);
      if (!q || !Object.keys(q).length) return;
      if (!String(q.prompt || '').trim() && String(mq.prompt || mq.q || '').trim()) q.prompt = mq.prompt || mq.q;
    });
    /* A marking with MORE questions than the station knows about still has
       to be readable, so the extras are carried as questions of their own. */
    (markedQs || []).forEach((mq, i) => {
      if (i < out.length) return;
      out.push({ id: mq.id, prompt: mq.prompt || mq.q || '', marks: mq.max || 0, marking_points: [] });
    });
    return out;
  }

  function toAttempt(d, st, user, audio, id) {
    const r = d.result || {};
    const num = v => Number(v) || 0;
    const max = num(r.max) || OSCE.marksOf(st);
    const total = num(r.total);
    return {
      id: id || rid('oc'),
      station_id: st.id,
      station: { topic: st.topic, scenario: st.scenario,
        total_marks: OSCE.marksOf(st), pass_mark: OSCE.passOf(st),
        // the character as it was when this was sat, not as it may be edited later
        role_player: OSCE.roleOf(st) || undefined },
      bp: (typeof OsceBlueprint !== 'undefined') ? (OsceBlueprint.tagOf(st) || null) : null,
      /* The station's own questions, but with any prompt the marking supplied
         filled in where the station has none to offer — a verdict that named
         its questions should never produce a report that cannot. */
      questions: mergeQuestions(OSCE.qsOf(st), r.questions),
      answers: (r.questions || []).map(q => ({ id: q.id, transcript: q.transcript || '' })),
      created: Date.now(),
      /* Not 'ai': that word already means our own marker, and the billing
         and the averages both split on it. This one costs us nothing and
         was marked somewhere else. */
      source: 'claude',
      examiner: { name: d.examiner || 'Claude', email: '' },
      candidate: { name: user?.name || '', userNo: user?.userNo || '' },
      audioPath: audio?.path || null,
      audioExpires: audio?.expires || null,
      satOn: d.sat_on || null,
      result: Object.assign({}, r, {
        max, total,
        percent: r.percent != null ? num(r.percent) : Math.round((total / Math.max(1, max)) * 100),
        pass: r.pass != null ? !!r.pass : total >= OSCE.passOf(st)
      })
    };
  }

  /* WHERE THE CIRCUIT IS WAITING.

     Our own marker navigates straight to the report the moment it
     finishes, so the circuit card on this page is gone before it can be
     pressed. Rather than intercepting the write — which would leave a
     wrapper on Backend for the rest of the session — the pending
     hand-over is written down here, and the report page picks it up. One
     small fact in one place, read by whichever page the reader ends up on.

     Cleared when it is used, and when a different circuit starts. */
  const PEND_KEY = 'aureum.osce.aicircuit';
  function noteCircuit(sid, stationId) {
    try { localStorage.setItem(PEND_KEY, JSON.stringify({ sid, stationId, at: Date.now() })); } catch {}
  }
  function pendingCircuit(stationId) {
    try {
      const p = JSON.parse(localStorage.getItem(PEND_KEY) || 'null');
      if (!p || (stationId && p.stationId !== stationId)) return null;
      /* A circuit nobody came back to within the day is not a circuit. */
      if (Date.now() - (p.at || 0) > 24 * 3600 * 1000) { clearCircuit(); return null; }
      return p;
    } catch { return null; }
  }
  function clearCircuit() { try { localStorage.removeItem(PEND_KEY); } catch {} }

  /* Say, on the circuit card, that there is now something to score with. */
  function markCircuitScored(host, a) {
    const msg = host.querySelector('#ai-circ-msg');
    if (msg) msg.innerHTML = `<span class="good">✓ ${a.result?.percent ?? '—'}% will be carried into the circuit.</span>`;
  }

  function importPanel(host, st, user, sid, ctx) {
    if (!host) return;
    host.innerHTML = `
      <div class="ai-imp-acts">
        <button class="btn btn-gold btn-sm" id="ai-imp-paste">📋 Paste the JSON</button>
        <button class="btn btn-ghost btn-sm" id="ai-imp-file">📄 From a file</button>
        ${cfg().drive?.claudeMarkFolderId && cfg().drive?.apiBase
          ? `<button class="btn btn-ghost btn-sm" id="ai-imp-scan">🔍 Scan the Drive folder</button>` : ''}
        <input type="file" id="ai-imp-input" accept=".json,application/json" hidden>
      </div>
      <div class="ai-imp-box" id="ai-imp-box" hidden>
        <textarea id="ai-imp-text" rows="8" spellcheck="false"
          placeholder='Paste the whole JSON block the examiner printed'></textarea>
        <button class="btn btn-gold btn-sm" id="ai-imp-add">Check and keep it</button>
      </div>
      <div id="ai-imp-out"></div>`;

    const out = host.querySelector('#ai-imp-out');
    const box = host.querySelector('#ai-imp-box');
    const say = h => { out.innerHTML = h; };
    let drivePicked = [];

    async function take(raw, where) {
      let d;
      try { d = typeof raw === 'string' ? JSON.parse(stripFence(raw)) : raw; }
      catch (err) { say(`<p class="bad">${esc(where)}: that is not valid JSON — ${esc(err.message || err)}</p>`); return; }

      /* Opened from a station, the station is known and a verdict for a
         different one is refused. Opened from My attempts it is not, so the
         JSON's own station_id is looked up — which is also what makes the
         check meaningful there: a verdict naming a station that is not in
         the bank is a verdict nothing can be scored against. */
      let target = st;
      if (!target) {
        const wanted = String(d?.station_id || '').trim();
        if (!wanted) { say(`<p class="bad">This JSON has no "station_id", so there is nothing to attach it to.</p>`); return; }
        try { target = await Backend.getOsceStation(wanted); } catch {}
        if (!target) {
          say(`<p class="bad">No station in the bank has the id <code>${esc(wanted)}</code>.
            The examiner may have altered it — it must be copied from the station block exactly.</p>`); return;
        }
      }

      const errs = validate(d, target);
      if (errs.length) { say(`<div class="os-made-bad"><p class="bad"><b>Not imported.</b></p>
        <ul>${errs.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`); return; }
      say('<p class="muted">Keeping it…</p>');
      try {
        const a = toAttempt(d, target, user, ctx?.audio, ctx?.id);
        await Backend.saveOsceAttempt(a);
        OSCE.bustAttempts?.();
        say(`<p class="good">✓ Kept — <strong>${esc(target.topic || '')}</strong>, ${a.result.total}/${a.result.max}
          (${a.result.percent}%). <a class="link" href="#/osce/result/${encodeURIComponent(a.id)}">Open the report →</a></p>`);
        /* The refresh waits. Redrawing the page immediately takes this
           message down with it, and the message is the only place the score
           and the link to the report appear. */
        if (ctx?.onSaved) setTimeout(() => { try { ctx.onSaved(a); } catch {} }, 2500);
      } catch (err) { say(`<p class="bad">${esc(err.message || err)}</p>`); }
    }

    host.querySelector('#ai-imp-paste').addEventListener('click', () => {
      box.hidden = !box.hidden; if (!box.hidden) host.querySelector('#ai-imp-text').focus();
    });
    host.querySelector('#ai-imp-add').addEventListener('click', () =>
      take(host.querySelector('#ai-imp-text').value, 'Pasted JSON'));
    const input = host.querySelector('#ai-imp-input');
    host.querySelector('#ai-imp-file').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const f = (input.files || [])[0]; input.value = '';
      if (f) await take(await f.text(), f.name);
    });

    /* THE FOLDER WAS NEVER EMPTY.

       /api/drive returns each file as { key, id, title, folder, owner,
       counts, paper } — the NAME is `title`. This filtered on `f.name`,
       which is undefined on every row, so every file was thrown away and
       the panel reported an empty folder while two files sat in it.

       The server already lists only .json and, for a small folder, inlines
       the parsed content as `paper` — so there is usually nothing left to
       fetch. An error from the server is shown as an error rather than as
       "no files", which is the other half of why this was hard to see. */
    host.querySelector('#ai-imp-scan')?.addEventListener('click', async e => {
      const b = e.currentTarget; b.disabled = true; say('<p class="muted">Reading the folder…</p>');
      try {
        const fid = cfg().drive.claudeMarkFolderId;
        const res = await fetch(`${cfg().drive.apiBase}?action=list&folderId=${encodeURIComponent(fid)}`, { cache: 'no-cache' });
        const list = await res.json();
        if (list.error) { say(`<p class="bad">Drive said: ${esc(list.error)}</p>`); return; }
        const files = list.files || [];
        if (!files.length) {
          say(`<p class="muted">Nothing in that folder yet. It must also be shared as
            <strong>Anyone with the link — Viewer</strong>, or the server cannot see inside it.</p>`);
          return;
        }
        drivePicked = files;
        say(`<p class="muted tiny">${files.length} file${files.length === 1 ? '' : 's'} — pick one:</p>
          <div class="ai-imp-files">${files.map((f, i) =>
            `<button class="btn btn-ghost btn-sm" data-fidx="${i}">${esc(f.title || f.id)}</button>`).join('')}</div>`);
      } catch (err) { say(`<p class="bad">${esc(err.message || err)}</p>`); }
      finally { b.disabled = false; }
    });

    /* Delegated once, on the panel — binding inside the scan handler added
       a fresh listener on every scan, so the third scan imported three
       times. */
    out.addEventListener('click', async ev => {
      const fb = ev.target.closest('[data-fidx]'); if (!fb) return;
      const f = drivePicked[Number(fb.dataset.fidx)];
      if (!f) return;
      const was = fb.textContent; fb.disabled = true; fb.textContent = 'Reading…';
      try {
        if (f.paper) { await take(f.paper, f.title || f.id); return; }
        const r = await fetch(`${cfg().drive.apiBase}?action=file&id=${encodeURIComponent(f.id)}`);
        await take(await r.text(), f.title || f.id);
      } catch (err) { say(`<p class="bad">${esc(err.message || err)}</p>`); }
      finally { fb.disabled = false; fb.textContent = was; }
    });
  }

  /* The same offer, on the report page — because our own marker takes you
     straight there and the circuit card never gets pressed. */
  function resumeStrip(host, attempt) {
    if (!host || !attempt) return;
    const p = pendingCircuit(attempt.station_id);
    if (!p) return;
    host.innerHTML = `
      <div class="card ai-circ" data-animate>
        <h3 class="card-title">↩ The circuit is waiting</h3>
        <p class="muted">You sat this one against a chat model, so the circuit stopped where it was. This result is
          carried across with you.</p>
        <div class="ai-circ-acts">
          <button class="btn btn-gold" id="ai-res-next">Next station →</button>
          <button class="btn btn-ghost btn-sm" id="ai-res-drop">Not now</button>
          <span class="muted tiny" id="ai-res-msg"></span>
        </div>
      </div>`;
    host.querySelector('#ai-res-next').addEventListener('click', async e => {
      e.currentTarget.disabled = true; e.currentTarget.textContent = 'Moving on…';
      try {
        const r = await OSCE.circuitNext(p.sid, p.stationId, attempt);
        clearCircuit();
        location.hash = r ? r.hash : '#/osce/sim';
      } catch (err) { host.querySelector('#ai-res-msg').textContent = err.message || String(err); }
    });
    host.querySelector('#ai-res-drop').addEventListener('click', () => { clearCircuit(); host.innerHTML = ''; });
  }

  /* Models fence their JSON. Taking the first fenced block, or failing that
     the first {...}, saves the reader from trimming it by hand on an iPad. */
  function stripFence(raw) {
    const t = String(raw || '');
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) return fence[1];
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    return (a >= 0 && b > a) ? t.slice(a, b + 1) : t;
  }

  /* ---------------- the way back in, at any time ----------------

     The importer used to exist only on the session screen, immediately
     after a recording finished. So a session whose microphone never opened
     had no route at all, and neither did coming back the next day with the
     JSON in a file. That is the same class of mistake as hiding the Created
     OSCE chip while its bin was empty: the panel you need is the one you
     reach in order to PUT something in.

     It is drawn on My attempts, always, whether or not anything has been
     imported yet — which also answers "where is the Marked by Claude
     section", since an empty section is not drawn. */
  function attemptsPanel(host, user, onSaved) {
    if (!host || !allowed(user)) return;
    const folder = cfg().drive?.claudeMarkFolderId
      ? `https://drive.google.com/drive/folders/${cfg().drive.claudeMarkFolderId}` : '';
    host.innerHTML = `
      <!-- NOT .os-att-fold: that class means "a section of attempts", and the
           attempts page counts them. Borrowing it for styling made the
           importer look like a fourth category. -->
      <details class="card ai-bring" data-animate>
        <summary>
          <h3 class="card-title">✦ Bring back an AI-marked station</h3>
          <span class="ai-bring-sum">paste · file · Drive</span>
          <span class="dc-caret">▾</span>
        </summary>
        <p class="muted tiny">The JSON an examining model prints at the end of an
          <strong>OSCE in AI</strong> session. It is checked against the station it names, and lands in
          <strong>Marked by Claude</strong> below.${folder ? ` Drive folder:
          <a class="link" href="${esc(folder)}" target="_blank" rel="noopener">the marked-JSON folder</a>.` : ''}</p>
        <div id="ai-att-imp"></div>
      </details>`;
    importPanel(host.querySelector('#ai-att-imp'), null, user, null, { onSaved });
  }

  return {
    allowed, buttonHtml, openDialog, buildPrompt, buildInstructions,
    stationBlock, rulesBlock, jsonBlock, levelOf, setLevel, levelText, LOGOS, MODELS,
    session, validate, toAttempt, importPanel, attemptsPanel, stripFence, SCHEMA,
    noteCircuit, pendingCircuit, clearCircuit, resumeStrip
  };
})();
