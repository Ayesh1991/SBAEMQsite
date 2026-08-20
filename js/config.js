/* ============================================================
   config.js — single place to tune the deployment.
   Safe to commit: the Supabase anon key and Google API key are
   *public* client keys (Row-Level Security and Drive sharing are
   what actually protect data). Leave Supabase blank to run in
   local (single-device) mode.
   ============================================================ */

window.AUREUM_CONFIG = {
  /* Branding */
  brandName: 'AUREUM',
  brandTag: 'Pathway to MD',

  /* The exam the countdown targets. Update after each sitting. */
  exam: {
    name: 'PGIM MD (Obstetrics & Gynaecology) — Part 2',
    // ISO date (local midnight). Change this to the next paper date.
    date: '2026-11-21'
  },

  /* Developer console access — either the email OR the code unlocks it. */
  developer: {
    email: 'ayeshmantha@gmail.com',
    code: 'AUREUM-DEV-2026'
  },

  /* Google Drive source for the question pipeline.
     folderId is the shared folder holding the group's JSON papers.
     apiBase points at the Cloudflare Pages Function (functions/api/drive.js).
     If the function is unreachable, the console falls back to the bundled
     data/drive-index.json snapshot. */
  drive: {
    folderId: '13SFKM0Cn_lNAhOHb8Laikvj4Xc5zXT5x',
    // Flashcard decks live in OGR-Common (flat folders consolidated by the
    // AUREUM Bridge app: Flashcards/, Infographics/, DOCx/). Keep this folder
    // link-shared as "Anyone with the link — Viewer".
    flashcardFolderId: '1ksGV_wYzWemBDFMCtiQwZdiYnDr2OI1Y',
    // Essay mock papers (ogr-essay-paper-v1) AND corrected-feedback JSONs
    // (ogr-essay-feedback-v1) share this folder — the importer routes each
    // file by its schema. Share as "Anyone with the link — Viewer".
    essayFolderId: '1EwsaTMnAcHbStoINKdhTq7ig87qBUiK8',
    // spoken OSCE stations (ogr-osce-v1)
    osceFolderId: '1hiX96x0MzbNvCyvohBsB4tpIiHj7ZKhK',
    // TOG CPD volumes (ogr-cpd-v1). Share as "Anyone with the link — Viewer".
    cpdFolderId: '1tayp7wrVQfW8NLUsrkf0npEMknCbyn-Z',
    apiBase: '/api/drive'
  },

  /* Supabase (multi-device accounts + cloud progress + published papers).
     Fill these in from your Supabase project → Settings → API.
     Both blank ⇒ the app runs fully in this browser's localStorage. */
  supabase: {
    url: 'https://bhemrozypoglbcvkhpzk.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZW1yb3p5cG9nbGJjdmtocHprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2NzUzNTcsImV4cCI6MjA5OTI1MTM1N30.ZRFvD3TJ_8qaRV_oUW8SMOtb-2yy4oMQAn9LLnd3A_Q'
  },

  /* Explore-with-AI. The API keys themselves are NOT here — they live as
     secret environment variables in Cloudflare (GEMINI_API_KEY, and
     optionally ANTHROPIC_API_KEY). This block only tunes behaviour.
       enabled        turn the whole feature on/off
       apiBase        the Cloudflare Pages Function (functions/api/explain.js)
       dailyLimit     max AI calls per user per day (keeps Gemini free-tier safe)
       followUpLimit  max follow-up chat messages per question per user
       geminiModel    the free Flash model everyone uses
       claudeModel    developer-only model (needs ANTHROPIC_API_KEY) */
  /* Prepaid balance in Sri Lankan rupees. `enforce` is the switch: with it
     off nothing changes for anyone, with it on a user whose balance reaches
     zero loses the AI features until they top up. The live values (rate,
     suggested amounts, enforce) come from the developer's Rates & settings
     panel; these are only the fallbacks. */
  wallet: {
    enforce: false,
    usdRate: 340,                // LKR per USD
    packs: [300, 500, 1000, 2000],
    /* The account users pay into. A slip that names THIS account, an amount,
       a date and the payer's own user number is credited immediately and
       flagged for the developer to confirm against the bank later. Banks
       print the number with and without its leading zeros, so both forms
       match — the comparison is on digits only, ignoring leading zeros. */
    beneficiary: {
      account: '0087612781',
      name: 'TMTGS Thennakoon',
      bank: 'BOC — Kandy'
    },
    instantActivation: true,     // credit a fully-matching slip without waiting
    instantHours: 24,            // how long that provisional credit stands unconfirmed
    /* Limits on what may be credited without a person looking. The amount
       ceiling is the one that matters: no forged slip can ever be worth more
       than this, whatever else it gets past. The rest are set from the
       developer's Rates & settings panel; these are the fallbacks. */
    autoMax: 5000,               // LKR — larger slips always wait for approval
    autoDayMax: 10000,           // LKR a user may auto-credit in 24 hours
    autoPerDay: 3,               // auto-credits a user may take in 24 hours
    maxAgeDays: 7,               // a slip older than this is not credited on sight
    pdfProducer: ''              // e.g. 'iText' — pin the library the bank generates with
  },

  /* OSCE collections — the bins a station belongs to. The developer can add
     more from the OSCE importer; these ship with every deployment. Stations
     published before collections existed have no `collection` and are shown
     as unfiled until they are moved. */
  osce: {
    collections: [
      { id: 'common',    label: 'Common bank' },
      { id: 'pera',      label: 'Pera OSCE' },
      { id: 'galle',     label: 'Galle OSCE' },
      { id: 'slcog',     label: 'SLCOG OSCE' },
      { id: 'examiners', label: "Examiners' OSCE" }
    ],
    defaultCollection: 'common'
  },

  ai: {
    enabled: true,
    apiBase: '/api/explain',
    dailyLimit: 40,
    followUpLimit: 6,            // Claude (and default) — follow-up chats per question
    geminiFollowUpLimit: 20,     // Gemini — higher, since you pay for Gemini now
    // Baseline Gemini model everyone gets. Google retired the whole 2.x
    // line for new API keys (2.0 in June 2026, 2.5 announced "no longer
    // available to new users" in July 2026) — the current generation is
    // 3.1 Flash-Lite / 3.5 Flash / 3.1 Pro, and Flash-Lite is both the
    // cheapest and ideal for high-volume classification.
    geminiModel: 'gemini-3.1-flash-lite',
    // Gemini model picker — shown to the developer AND to any user granted
    // the `gemini_advanced` flag in Users & access. The server re-checks the
    // flag, so the picker is a convenience, not the security boundary.
    /* `audio` says whether the model can be sent the OSCE recording itself
       rather than a typed transcript. It is a property of the model, not a
       preference:
         • Gemini takes compressed audio (webm/opus) inline — the cheapest
           and most accurate route, and the reason it is the default.
         • GPT accepts audio, but only as uncompressed WAV or MP3, so the
           browser re-encodes the recording first (see OSCE.toWav). That is
           heavier to upload; `audioFormat` is what triggers it.
         • Claude's Messages API takes text, images and PDFs — not audio. It
           is not a flag we can turn on, so those entries stay false and the
           OSCE tab says why instead of just greying the option out.
       If a provider adds audio to a model, set the flag here — nothing in the
       code hard-codes which provider can listen. */
    geminiModels: [
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', audio: true },
      { id: 'gemini-3.5-flash',      label: 'Gemini 3.5 Flash',      audio: true },
      { id: 'gemini-3.1-pro',        label: 'Gemini 3.1 Pro',        audio: true }
    ],
    claudeModel: 'claude-haiku-4-5-20251001',
    claudeModels: [
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',  audio: false },
      { id: 'claude-sonnet-4-5',         label: 'Claude Sonnet 4.5', audio: false }
    ],
    // OpenAI GPT — granted per user with the `gpt` flag in Users & access.
    // NOTE: confirm this id against OpenAI's model list before going live; the
    // server also accepts an OPENAI_DEFAULT_MODEL env override so the exact
    // string can be corrected without a redeploy of the client.
    gptModel: 'gpt-5.6-luna',
    /* Tried and measured, not assumed: sending an input_audio part to
       gpt-5.6-luna returns
         400 Invalid 'messages[1]'. Content blocks are expected to be
             either text or image_url type.
       so this model id takes text and images and nothing else. The flag is
       therefore off and the OSCE tab does not offer it the recording.

       If OpenAI ships an audio-capable id (the ones that do take audio accept
       WAV or MP3 only), add it here with audio: true and audioFormat: 'wav' —
       the browser re-encoding and the server path are both already written
       and will start working the moment the flag is set. */
    /* Groq — a free tier used for the mechanical jobs only: turning a
       recording into words, and reading a question aloud. Never marking,
       never clinical reasoning. Off for everyone except the developer until
       granted per user in Users & access, and every use falls back to the
       browser's own recogniser and synthesiser when the quota runs out.
       The API key is a Cloudflare secret (GROQ_API_KEY), never here. */
    groq: {
      enabled: true,
      whisper: true,             // transcribe the station recording
      voice: true,               // read the questions aloud in a real voice
      voiceName: 'Fritz-PlayAI'  // GROQ_TTS_VOICE overrides this server-side
    },
    gptModels: [
      { id: 'gpt-5.6-luna', label: 'GPT 5.6 Luna', audio: false,
        why: 'This GPT model takes text and images only — it rejects an audio attachment outright.' }
    ],
    // USD per 1,000,000 tokens — the invoice engine (js/billing.js) matches
    // each metered model id against these by longest prefix. Update here when
    // Google/Anthropic change list prices; historical rows are re-priced at
    // the current table (simple + predictable for a small study group).
    // Retired models stay listed so old metered rows still price correctly.
    pricing: {
      'gemini-2.0-flash':      { in: 0.10, out: 0.40,  label: 'Gemini 2.0 Flash (retired)' },
      'gemini-2.5-flash-lite': { in: 0.10, out: 0.40,  label: 'Gemini 2.5 Flash-Lite (retired)' },
      'gemini-2.5-flash':      { in: 0.30, out: 2.50,  label: 'Gemini 2.5 Flash (retired)' },
      'gemini-3-flash':        { in: 0.50, out: 3.00,  label: 'Gemini 3 Flash (retired)' },
      'gemini-3.1-flash-lite': { in: 0.25, out: 1.50,  label: 'Gemini 3.1 Flash-Lite' },
      'gemini-3.1-pro':        { in: 2.00, out: 12.00, label: 'Gemini 3.1 Pro' },
      'gemini-3.5-flash':      { in: 1.50, out: 9.00,  label: 'Gemini 3.5 Flash' },
      'gemini':                { in: 1.50, out: 9.00,  label: 'Gemini (other)' },
      'claude-haiku-4-5':      { in: 1.00, out: 5.00,  label: 'Claude Haiku 4.5' },
      'claude-sonnet-4-5':     { in: 3.00, out: 15.00, label: 'Claude Sonnet 4.5' },
      'claude':                { in: 1.00, out: 5.00,  label: 'Claude (other)' },
      'gpt-5.6-luna':          { in: 0.20, out: 1.20,  label: 'GPT 5.6 Luna' },
      /* Groq's free tier costs nothing, so these price at zero — the calls
         still appear in the usage breakdown, which is the point: you can see
         how much work is being done for free, and what the bill would become
         if the free tier ever went away. */
      'whisper':               { in: 0,    out: 0,     label: 'Whisper transcription (Groq, free)' },
      'playai-tts':            { in: 0,    out: 0,     label: 'Examiner voice (Groq, free)' },
      'llama':                 { in: 0,    out: 0,     label: 'Llama (Groq, free)' },
      'gpt':                   { in: 0.20, out: 1.20,  label: 'GPT (other)' }
    }
  }
};
