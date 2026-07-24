-- ============================================================
-- AUREUM · Pathway to MD — Supabase schema (v2)
-- Safe to run repeatedly: every statement is idempotent
-- (IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS).
-- Run the whole file in the Supabase SQL Editor.
--
-- If you set this up earlier, just run it again — it only ADDS the
-- new columns/tables (exam_date, notes, sessions, curriculum,
-- AI cache & usage) without touching existing data.
-- ============================================================

-- ---------- 1) PROFILES ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  email text,
  position text default 'Registrar',
  xp integer default 0,
  streak_count integer default 0,
  streak_last_day date,
  exam_date date,                       -- NEW: per-user exam date (persists across devices)
  created_at timestamptz default now()
);
-- add exam_date if the table already existed
alter table public.profiles add column if not exists exam_date date;

-- feature_flags: developer-granted per-user access to advanced features
-- (e.g. {"gemini": true, "gemini_advanced": true, "ai_flashcards": true}).
-- Empty = defaults only. Protected by the trigger below so ONLY the
-- developer can change it — users cannot self-grant AI access.
alter table public.profiles add column if not exists feature_flags jsonb default '{}'::jsonb;

-- prefs: the user's OWN self-service switches (e.g. {"simulator": true,
-- "flashcards": true}) — toggled from their Profile tab, no grant needed.
alter table public.profiles add column if not exists prefs jsonb default '{}'::jsonb;

-- status: registration approval — 'pending' (new sign-ups wait for the
-- developer), 'approved' (full access), 'denied'. The column is added with
-- default 'approved' so EXISTING users keep access, then the default flips
-- to 'pending' so every future sign-up awaits approval.
alter table public.profiles add column if not exists status text not null default 'approved';
alter table public.profiles alter column status set default 'pending';

-- Users may update their own profile row (name, position, prefs…) but any
-- attempt to change feature_flags OR status by a non-developer is silently
-- reverted — those columns are the developer's alone.
create or replace function public.protect_feature_flags()
returns trigger language plpgsql security definer as $$
begin
  if coalesce(auth.jwt() ->> 'email', '') <> 'ayeshmantha@gmail.com' then
    if new.feature_flags is distinct from old.feature_flags then new.feature_flags := old.feature_flags; end if;
    if new.status is distinct from old.status then new.status := old.status; end if;
  end if;
  return new;
end $$;
drop trigger if exists protect_feature_flags on public.profiles;
create trigger protect_feature_flags before update on public.profiles
  for each row execute function public.protect_feature_flags();

alter table public.profiles enable row level security;
drop policy if exists "own profile read"   on public.profiles;
drop policy if exists "own profile insert" on public.profiles;
drop policy if exists "own profile update" on public.profiles;
drop policy if exists "profiles dev read"   on public.profiles;
drop policy if exists "profiles dev update" on public.profiles;
create policy "own profile read"   on public.profiles for select using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);
-- the developer can list every profile (Users panel) and grant feature flags
create policy "profiles dev read" on public.profiles for select
  using (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');
create policy "profiles dev update" on public.profiles for update
  using  (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com')
  with check (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

-- ---------- 2) ATTEMPTS (completed runs) ----------
create table if not exists public.attempts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz default now()
);
create index if not exists attempts_user_idx on public.attempts (user_id, created_at desc);
alter table public.attempts enable row level security;
drop policy if exists "own attempts read"   on public.attempts;
drop policy if exists "own attempts insert" on public.attempts;
drop policy if exists "own attempts delete" on public.attempts;
create policy "own attempts read"   on public.attempts for select using (auth.uid() = user_id);
create policy "own attempts insert" on public.attempts for insert with check (auth.uid() = user_id);
create policy "own attempts delete" on public.attempts for delete using (auth.uid() = user_id);

-- ---------- 3) PAPERS (published content) ----------
create table if not exists public.papers (
  id text primary key,
  meta jsonb not null,
  updated_at timestamptz default now()
);
alter table public.papers enable row level security;
drop policy if exists "papers public read" on public.papers;
drop policy if exists "papers dev write"   on public.papers;
create policy "papers public read" on public.papers for select using (true);
create policy "papers dev write" on public.papers for all
  using  (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com')
  with check (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

-- ---------- 4) IN-PROGRESS SESSIONS (resume half-finished papers) ----------
create table if not exists public.sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,                    -- paperId:kind:mode
  state jsonb not null,                 -- answers, index, flags, etc.
  updated_at timestamptz default now(),
  primary key (user_id, key)
);
alter table public.sessions enable row level security;
drop policy if exists "own sessions all" on public.sessions;
create policy "own sessions all" on public.sessions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 5) NOTES (per-question personal notes) ----------
create table if not exists public.notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_key text not null,           -- paperId:kind:number
  body text not null,
  updated_at timestamptz default now(),
  primary key (user_id, question_key)
);
alter table public.notes enable row level security;
drop policy if exists "own notes all" on public.notes;
create policy "own notes all" on public.notes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 6) CUSTOM CURRICULUM (developer-added categories/sections/topics) ----------
-- A single row (id = 'default') holding the developer's additions, merged
-- on top of the static data/syllabus.json in the app.
create table if not exists public.curriculum (
  id text primary key default 'default',
  data jsonb not null default '{"categories":[]}'::jsonb,
  updated_at timestamptz default now()
);
alter table public.curriculum enable row level security;
drop policy if exists "curriculum public read" on public.curriculum;
drop policy if exists "curriculum dev write"   on public.curriculum;
create policy "curriculum public read" on public.curriculum for select using (true);
create policy "curriculum dev write" on public.curriculum for all
  using  (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com')
  with check (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

-- ---------- 7) AI EXPLANATION CACHE (generated once, reused by everyone) ----------
create table if not exists public.ai_explanations (
  question_key text primary key,        -- paperId:kind:number
  provider text,
  body text not null,
  created_at timestamptz default now()
);
alter table public.ai_explanations enable row level security;
drop policy if exists "ai cache read"  on public.ai_explanations;
drop policy if exists "ai cache write" on public.ai_explanations;
-- any signed-in user may read/write the shared cache (the function guards content)
create policy "ai cache read"  on public.ai_explanations for select using (auth.role() = 'authenticated');
create policy "ai cache write" on public.ai_explanations for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---------- 8) AI USAGE (per-user daily counter for free-tier safety) ----------
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
drop policy if exists "own usage all" on public.ai_usage;
drop policy if exists "usage dev read" on public.ai_usage;
create policy "own usage all" on public.ai_usage for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- the developer can read everyone's AI usage (Users panel analytics)
create policy "usage dev read" on public.ai_usage for select
  using (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

-- atomically increment today's counter and return the new value
create or replace function public.bump_ai_usage(p_limit integer)
returns integer language plpgsql security definer as $$
declare v_count integer;
begin
  insert into public.ai_usage (user_id, day, count)
  values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count into v_count;
  return v_count;
end; $$;

-- ---------- 8b) AI SAVES (per-user saved chats, charts, infographics, mind maps, summaries) ----------
create table if not exists public.ai_saves (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_key text,                    -- paperId:kind:number (null for loose items)
  paper_title text,
  kind text not null,                   -- chat | chart | infographic | tree | mindmap | summary
  title text,
  content text,                         -- markdown / svg / html / json transcript
  mime text,
  created_at timestamptz default now()
);
create index if not exists ai_saves_user_idx on public.ai_saves (user_id, created_at desc);
create index if not exists ai_saves_q_idx on public.ai_saves (user_id, question_key);
alter table public.ai_saves enable row level security;
drop policy if exists "own ai_saves all" on public.ai_saves;
create policy "own ai_saves all" on public.ai_saves for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 8c) QUESTION EDITS (developer flag + explanation override, shown to everyone) ----------
create table if not exists public.question_edits (
  question_key text primary key,        -- paperId:kind:number
  flagged boolean default false,
  flag_note text,
  explanation text,                     -- editor's correction / override
  updated_by text,
  updated_at timestamptz default now()
);
alter table public.question_edits enable row level security;
drop policy if exists "qedits public read" on public.question_edits;
drop policy if exists "qedits dev write"   on public.question_edits;
create policy "qedits public read" on public.question_edits for select using (true);
create policy "qedits dev write" on public.question_edits for all
  using  (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com')
  with check (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

-- ---------- 8d) USER QUESTION EDITS (each user's personal flag / note + simulator exclusion) ----------
-- Everyone can flag an answer they think is wrong and add a private note,
-- without touching the developer's global question_edits. The `excluded`
-- flag also tells the adaptive exam simulator to disregard a question when
-- scoring that user's performance. `resolved` is set by the developer in
-- the Question review workshop once the flag has been dealt with.
create table if not exists public.user_question_edits (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_key text not null,           -- paperId:kind:number
  flagged boolean default false,
  flag_note text,
  explanation text,
  excluded boolean default false,       -- simulator: don't count this question for me
  resolved boolean default false,       -- developer has reviewed/fixed this flag
  updated_at timestamptz default now(),
  primary key (user_id, question_key)
);
alter table public.user_question_edits add column if not exists resolved boolean default false;
create index if not exists uqe_excluded_idx on public.user_question_edits (user_id) where excluded;
create index if not exists uqe_flagged_idx on public.user_question_edits (question_key) where flagged and not resolved;
alter table public.user_question_edits enable row level security;
drop policy if exists "own uqe all" on public.user_question_edits;
drop policy if exists "uqe dev read"   on public.user_question_edits;
drop policy if exists "uqe dev update" on public.user_question_edits;
create policy "own uqe all" on public.user_question_edits for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- the developer sees every user's flags (Question review workshop) and can
-- mark them resolved after fixing the question
create policy "uqe dev read" on public.user_question_edits for select
  using (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');
create policy "uqe dev update" on public.user_question_edits for update
  using  (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com')
  with check (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

-- Any signed-in user can fetch the set of question keys currently flagged
-- as wrong by ANY user and not yet resolved — the simulator keeps these out
-- of new mocks until the developer fixes them. security definer so users
-- don't need read access to each other's rows; only keys are exposed.
create or replace function public.list_flagged_keys()
returns setof text language sql security definer stable as $$
  select distinct question_key from public.user_question_edits
  where flagged and not resolved
$$;

-- ---------- 8e) FLASHCARD DECKS (developer-published, everyone reads) ----------
create table if not exists public.flashcard_decks (
  id text primary key,
  meta jsonb not null,                  -- { id, title, source, cardCount, content:{topic,cards[]} }
  updated_at timestamptz default now()
);
alter table public.flashcard_decks enable row level security;
drop policy if exists "decks public read" on public.flashcard_decks;
drop policy if exists "decks dev write"   on public.flashcard_decks;
create policy "decks public read" on public.flashcard_decks for select using (true);
create policy "decks dev write" on public.flashcard_decks for all
  using  (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com')
  with check (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

-- ---------- 8f) FLASHCARD PROGRESS (per-user SM-2 schedule, saved card-by-card) ----------
create table if not exists public.flashcard_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_id text not null,
  card_id text not null,
  due date,
  interval integer default 0,           -- days
  ease real default 2.5,                -- SM-2 ease factor
  reps integer default 0,
  lapses integer default 0,
  updated_at timestamptz default now(),
  primary key (user_id, deck_id, card_id)
);
create index if not exists fcp_due_idx on public.flashcard_progress (user_id, due);
alter table public.flashcard_progress enable row level security;
drop policy if exists "own fcp all" on public.flashcard_progress;
create policy "own fcp all" on public.flashcard_progress for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 8g) APP CONFIG (single-row docs: the exam blueprint, etc.) ----------
create table if not exists public.app_config (
  id text primary key,                  -- e.g. 'blueprint'
  data jsonb not null,
  updated_at timestamptz default now()
);
alter table public.app_config enable row level security;
drop policy if exists "config public read" on public.app_config;
drop policy if exists "config dev write"   on public.app_config;
create policy "config public read" on public.app_config for select using (true);
create policy "config dev write" on public.app_config for all
  using  (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com')
  with check (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

-- ---------- 8h) MOCK RESULTS (adaptive simulator runs, per-user) ----------
create table if not exists public.mock_results (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,               -- score, per-bucket accuracy, question keys used, excluded keys
  created_at timestamptz default now()
);
create index if not exists mock_user_idx on public.mock_results (user_id, created_at desc);
alter table public.mock_results enable row level security;
drop policy if exists "own mock all"    on public.mock_results;
drop policy if exists "own mock read"   on public.mock_results;
drop policy if exists "own mock insert" on public.mock_results;
drop policy if exists "own mock delete" on public.mock_results;
create policy "own mock read"   on public.mock_results for select using (auth.uid() = user_id);
create policy "own mock insert" on public.mock_results for insert with check (auth.uid() = user_id);
create policy "own mock delete" on public.mock_results for delete using (auth.uid() = user_id);

-- ---------- 8i) REVIEW ITEMS (wrong SBA/EMQ auto-converted into spaced review, per-user) ----------
create table if not exists public.review_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_key text not null,           -- paperId:kind:number
  paper_title text,
  due date,
  interval integer default 0,           -- days
  ease real default 2.5,
  reps integer default 0,
  lapses integer default 0,
  wrong_count integer default 1,
  updated_at timestamptz default now(),
  primary key (user_id, question_key)
);
create index if not exists review_due_idx on public.review_items (user_id, due);
alter table public.review_items enable row level security;
drop policy if exists "own review all" on public.review_items;
create policy "own review all" on public.review_items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 8j) AI TOKEN USAGE (true token metering → per-user billing) ----------
-- One row per user × day × provider × model × feature, incremented by the
-- server with the EXACT token counts each API reported (Gemini
-- usageMetadata / Anthropic usage). This is the billing source of truth.
-- `feature` records WHICH mechanism spent it (tutor / coach / flashcards /
-- study_aids) so a user can see their own spend broken down by activity.
create table if not exists public.ai_token_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  provider text not null,               -- 'gemini' | 'claude'
  model text not null,                  -- exact model id that answered
  calls integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  updated_at timestamptz default now(),
  primary key (user_id, day, provider, model)
);
-- add the feature column + fold it into the primary key (safe on existing
-- data: every current row gets feature='tutor', so the wider key stays
-- unique). Guarded so re-running the whole file is idempotent.
alter table public.ai_token_usage add column if not exists feature text not null default 'tutor';
do $$
begin
  if not exists (
    select 1 from information_schema.key_column_usage
    where table_schema = 'public' and constraint_name = 'ai_token_usage_pkey' and column_name = 'feature'
  ) then
    alter table public.ai_token_usage drop constraint if exists ai_token_usage_pkey;
    alter table public.ai_token_usage add primary key (user_id, day, provider, model, feature);
  end if;
end $$;
create index if not exists atu_day_idx on public.ai_token_usage (day);
alter table public.ai_token_usage enable row level security;
drop policy if exists "own tokens read" on public.ai_token_usage;
drop policy if exists "tokens dev read" on public.ai_token_usage;
create policy "own tokens read" on public.ai_token_usage for select using (auth.uid() = user_id);
-- the developer reads everyone's metered tokens (Users panel + invoices)
create policy "tokens dev read" on public.ai_token_usage for select
  using (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

-- Writes happen ONLY through this RPC (no insert/update policies above), so
-- a client can never inflate or shrink its own meter. security definer +
-- auth.uid() ties the row to the verified caller. Two signatures: the
-- 5-arg one carries the feature; the old 4-arg one delegates as 'tutor'
-- so an un-migrated deployment keeps working.
create or replace function public.log_ai_tokens(p_provider text, p_model text, p_input integer, p_output integer, p_feature text)
returns void language plpgsql security definer as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.ai_token_usage (user_id, day, provider, model, feature, calls, input_tokens, output_tokens)
  values (auth.uid(), current_date, p_provider, p_model, coalesce(nullif(p_feature, ''), 'tutor'), 1,
          greatest(coalesce(p_input, 0), 0), greatest(coalesce(p_output, 0), 0))
  on conflict (user_id, day, provider, model, feature) do update
    set calls         = public.ai_token_usage.calls + 1,
        input_tokens  = public.ai_token_usage.input_tokens  + excluded.input_tokens,
        output_tokens = public.ai_token_usage.output_tokens + excluded.output_tokens,
        updated_at    = now();
end; $$;
create or replace function public.log_ai_tokens(p_provider text, p_model text, p_input integer, p_output integer)
returns void language plpgsql security definer as $$
begin
  perform public.log_ai_tokens(p_provider, p_model, p_input, p_output, 'tutor');
end; $$;

-- Eligible-user COUNTS per shared-cost split policy, so a normal user can
-- compute their 1/N share of a shared pool WITHOUT reading anyone else's
-- profile (returns only counts — no PII). security definer + stable.
create or replace function public.ai_eligible_counts()
returns jsonb language sql security definer stable as $$
  select jsonb_build_object(
    'all', greatest((select count(*) from public.profiles), 1),
    'simulator', greatest((select count(*) from public.profiles
        where coalesce((feature_flags ->> 'simulator')::boolean, false)
           or lower(email) = 'ayeshmantha@gmail.com'), 1),
    'dev', 1
  );
$$;

-- ---------- 8k) QUESTION STATS (empirical difficulty — every answer, all users) ----------
-- One row per question. Every scored answer anywhere (study, exam, simulator)
-- increments these via the RPC below, so difficulty stops being a text
-- heuristic and becomes measured cohort performance.
create table if not exists public.question_stats (
  question_key text primary key,        -- paperId:kind:number
  attempts integer not null default 0,
  correct integer not null default 0,
  total_time_sec bigint not null default 0,   -- summed answering time (pacing norm)
  updated_at timestamptz default now()
);
alter table public.question_stats enable row level security;
drop policy if exists "qstats read" on public.question_stats;
create policy "qstats read" on public.question_stats for select using (auth.role() = 'authenticated');
-- Batched write path: one call per finished paper, an array of
-- {k, ok, t} objects. security definer — no direct insert/update policy.
create or replace function public.bump_question_stats(p_rows jsonb)
returns void language plpgsql security definer as $$
declare r jsonb;
begin
  if auth.uid() is null then return; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    insert into public.question_stats (question_key, attempts, correct, total_time_sec)
    values (r->>'k', 1, case when (r->>'ok')::boolean then 1 else 0 end,
            greatest(least(coalesce((r->>'t')::int, 0), 600), 0))
    on conflict (question_key) do update
      set attempts = public.question_stats.attempts + 1,
          correct  = public.question_stats.correct + excluded.correct,
          total_time_sec = public.question_stats.total_time_sec + excluded.total_time_sec,
          updated_at = now();
  end loop;
end; $$;

-- ---------- 8l) COHORT SCORES (anonymous mock percentages → percentile curve) ----------
create table if not exists public.cohort_scores (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  percent integer not null,
  day date not null default current_date
);
create index if not exists cohort_day_idx on public.cohort_scores (day);
alter table public.cohort_scores enable row level security;
drop policy if exists "cohort read"   on public.cohort_scores;
drop policy if exists "cohort insert" on public.cohort_scores;
-- every signed-in user reads the whole (anonymous in the UI) distribution
create policy "cohort read" on public.cohort_scores for select using (auth.role() = 'authenticated');
create policy "cohort insert" on public.cohort_scores for insert with check (auth.uid() = user_id);

-- ---------- 8m) QUESTION EVENTS (full interaction tracking — cohort consented) ----------
-- Batched behavioural events: views, answer changes, strike-throughs,
-- time-on-question, AI questions asked. Feeds the behaviour-insights AI
-- analysis and the empirical difficulty picture.
create table if not exists public.question_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_key text,
  mode text,                            -- study | exam | simulator | review
  event text not null,                  -- view | answer | change | strike | flag | ai_ask | reveal
  data jsonb,
  created_at timestamptz default now()
);
create index if not exists qev_q_idx on public.question_events (question_key, created_at desc);
create index if not exists qev_user_idx on public.question_events (user_id, created_at desc);
alter table public.question_events enable row level security;
drop policy if exists "own events insert" on public.question_events;
drop policy if exists "events dev read"   on public.question_events;
create policy "own events insert" on public.question_events for insert with check (auth.uid() = user_id);
create policy "events dev read" on public.question_events for select
  using (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

-- ---------- 8n) QUESTION TAGS (AI-assigned topic tags → precise selection) ----------
create table if not exists public.question_tags (
  question_key text primary key,        -- paperId:kind:number
  topic text,                           -- canonical blueprint topic / theme
  category text,
  guideline text,                       -- e.g. "GTG 72", "NICE NG201"
  tags jsonb default '[]'::jsonb,       -- extra keywords
  difficulty_est real,                  -- AI's 0-1 estimate (cold-start only)
  tagged_by text,                       -- model that produced the tag
  updated_at timestamptz default now()
);
alter table public.question_tags enable row level security;
drop policy if exists "qtags read"      on public.question_tags;
drop policy if exists "qtags dev write" on public.question_tags;
create policy "qtags read" on public.question_tags for select using (auth.role() = 'authenticated');
create policy "qtags dev write" on public.question_tags for all
  using  (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com')
  with check (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

-- ---------- 8o) USER DECKS (personal flashcard decks, e.g. AI cards from wrong answers) ----------
create table if not exists public.user_decks (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  meta jsonb not null,                  -- same shape as flashcard_decks.meta
  updated_at timestamptz default now(),
  primary key (user_id, id)
);
alter table public.user_decks enable row level security;
drop policy if exists "own user_decks all" on public.user_decks;
create policy "own user_decks all" on public.user_decks for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 8p) AI SHARED USAGE (platform AI jobs billed as a shared pool) ----------
-- Batch jobs the developer runs for everyone (question tagging, behaviour
-- insights, audits) are metered here per feature × day × model, then the
-- invoice engine splits each pool's cost across the eligible users
-- (all users, or simulator users only — chosen per feature in the AI panel).
create table if not exists public.ai_shared_usage (
  feature text not null,                -- e.g. question_tagger | behaviour_insights
  day date not null,
  provider text not null,
  model text not null,
  calls integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  updated_at timestamptz default now(),
  primary key (feature, day, provider, model)
);
alter table public.ai_shared_usage enable row level security;
drop policy if exists "shared usage read" on public.ai_shared_usage;
-- all signed-in users may read (their invoice shows their share transparently)
create policy "shared usage read" on public.ai_shared_usage for select using (auth.role() = 'authenticated');
-- writes only through the RPC, and only for the developer's account
create or replace function public.log_ai_shared(p_feature text, p_provider text, p_model text, p_input integer, p_output integer)
returns void language plpgsql security definer as $$
begin
  if auth.jwt() ->> 'email' <> 'ayeshmantha@gmail.com' then return; end if;
  insert into public.ai_shared_usage (feature, day, provider, model, calls, input_tokens, output_tokens)
  values (p_feature, current_date, p_provider, p_model, 1,
          greatest(coalesce(p_input, 0), 0), greatest(coalesce(p_output, 0), 0))
  on conflict (feature, day, provider, model) do update
    set calls         = public.ai_shared_usage.calls + 1,
        input_tokens  = public.ai_shared_usage.input_tokens  + excluded.input_tokens,
        output_tokens = public.ai_shared_usage.output_tokens + excluded.output_tokens,
        updated_at    = now();
end; $$;

-- ---------- 8q) QUESTION EDIT PROPOSALS (peer review → developer approval) ----------
-- Any signed-in user can review a flagged question and PROPOSE a corrected
-- version. Nothing changes for anyone until the developer approves it in
-- the Question review workshop (which shows the flaggers' and reviewer's
-- identities). status: pending | approved | rejected.
create table if not exists public.question_edit_proposals (
  id bigint generated always as identity primary key,
  question_key text not null,           -- paperId:kind:number
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  proposed jsonb not null,              -- { stem, lead, theme, options[], answer, rationale }
  note text,                            -- reviewer's reasoning / guideline cite
  status text not null default 'pending',
  decided_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists qep_status_idx on public.question_edit_proposals (status, created_at desc);
alter table public.question_edit_proposals enable row level security;
drop policy if exists "qep own insert" on public.question_edit_proposals;
drop policy if exists "qep own read"   on public.question_edit_proposals;
drop policy if exists "qep dev read"   on public.question_edit_proposals;
drop policy if exists "qep dev update" on public.question_edit_proposals;
create policy "qep own insert" on public.question_edit_proposals for insert
  with check (auth.uid() = reviewer_id);
create policy "qep own read" on public.question_edit_proposals for select using (auth.uid() = reviewer_id);
create policy "qep dev read" on public.question_edit_proposals for select
  using (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');
create policy "qep dev update" on public.question_edit_proposals for update
  using  (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com')
  with check (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

-- Flagged questions WITH their (anonymous) reasons, for the peer-review tab:
-- keys + notes only — flaggers' identities are visible to the developer alone.
create or replace function public.list_flagged_details()
returns table (question_key text, notes text[]) language sql security definer stable as $$
  select question_key,
         array_remove(array_agg(distinct nullif(trim(flag_note), '')), null)
  from (
    select question_key, flag_note from public.user_question_edits where flagged and not resolved
    union all
    select question_key, flag_note from public.question_edits where flagged
  ) f
  group by question_key
$$;

-- ---------- 8r) ESSAY PAPERS (developer-published SAQ/SEQ mock papers) ----------
create table if not exists public.essay_papers (
  id text primary key,
  meta jsonb not null,                  -- { id, paperNumber, paperLabel, sections[…], … }
  updated_at timestamptz default now()
);
alter table public.essay_papers enable row level security;
drop policy if exists "essay papers read"  on public.essay_papers;
drop policy if exists "essay papers write" on public.essay_papers;
create policy "essay papers read" on public.essay_papers for select using (true);
create policy "essay papers write" on public.essay_papers for all
  using  (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com')
  with check (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

-- ---------- 8s) ESSAY FEEDBACK (per-user corrected-answer reports) ----------
-- The marking is done in a separate Claude project that returns a JSON
-- report (schema ogr-essay-feedback-v1); each user uploads their own here
-- (the developer's are auto-imported from Drive). One row per question code
-- per user, latest upload wins.
create table if not exists public.essay_feedback (
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,                   -- question code, e.g. M03-Q5
  data jsonb not null,                  -- the full feedback report
  paper text,                           -- derived paper id (M03)
  percent integer,                      -- quick-access score for lists/graphs
  band text,
  created_at timestamptz default now(),
  primary key (user_id, code)
);
create index if not exists ef_user_idx on public.essay_feedback (user_id, created_at desc);
alter table public.essay_feedback enable row level security;
drop policy if exists "own essay feedback all" on public.essay_feedback;
drop policy if exists "essay feedback dev read" on public.essay_feedback;
create policy "own essay feedback all" on public.essay_feedback for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "essay feedback dev read" on public.essay_feedback for select
  using (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

-- ---------- 9) Auto-create a profile row on sign-up ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, name, email, position)
  values (new.id,
          coalesce(new.raw_user_meta_data ->> 'name', new.email),
          new.email,
          coalesce(new.raw_user_meta_data ->> 'position', 'Registrar'))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
