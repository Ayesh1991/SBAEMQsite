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
    followUpLimit: 6,
    geminiModel: 'gemini-2.0-flash',
    claudeModel: 'claude-haiku-4-5-20251001'
  }
};
