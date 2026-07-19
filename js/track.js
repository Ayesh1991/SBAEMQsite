/* ============================================================
   track.js — full interaction tracking (cohort-consented).

   Every meaningful move a candidate makes on a question — viewing,
   answering, changing an answer, striking out options, flagging,
   what they type to the AI tutor — is buffered here and written to
   question_events in batches. This is the raw material for:
     • empirical difficulty (with question_stats)
     • the behaviour-insights AI analysis in the developer AI panel
     • pacing analytics

   Design: never blocks the UI, never throws, batches writes (max one
   network call per ~20 events / 15 s / page-hide) so Supabase egress
   and row counts stay tiny. Local mode: no-op.
   ============================================================ */

const Track = (() => {
  const MAX_BATCH = 20;
  const FLUSH_MS = 15000;
  let buffer = [];
  let timer = null;
  let enabled = null;   // resolved lazily: cloud mode + signed in

  async function canTrack() {
    if (enabled !== null) return enabled;
    try { enabled = Backend.mode === 'cloud' && !!(await Backend.currentUser()); }
    catch { enabled = false; }
    return enabled;
  }

  /** log('answer', 'paperId:SBA:4', 'exam', { chosen: 2, t: 41 }) */
  function log(event, questionKey, mode, data) {
    buffer.push({ event, question_key: questionKey || null, mode: mode || null, data: data || null });
    if (buffer.length >= MAX_BATCH) flush();
    else if (!timer) timer = setTimeout(flush, FLUSH_MS);
  }

  async function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!buffer.length) return;
    const batch = buffer.splice(0, buffer.length);
    try {
      if (await canTrack()) await Backend.logEvents(batch);
    } catch { /* tracking must never break the app */ }
  }

  // final flush when the tab hides/closes
  window.addEventListener('pagehide', () => { flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  return { log, flush };
})();
