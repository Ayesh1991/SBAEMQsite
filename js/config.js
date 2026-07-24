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
    geminiModels: [
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
      { id: 'gemini-3.5-flash',      label: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.1-pro',        label: 'Gemini 3.1 Pro' }
    ],
    claudeModel: 'claude-haiku-4-5-20251001',
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
      'claude':                { in: 1.00, out: 5.00,  label: 'Claude (other)' }
    }
  }
};
