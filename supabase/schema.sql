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

-- Avatar + cross-device notification state. `notif_seen` holds the last-seen
-- timestamps ({wall, chat}) so reading on the iPad clears the laptop too.
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists notif_seen jsonb default '{}'::jsonb;
-- every signed-in member may read another member's public card (name + avatar)
-- so the wall and chat can show who is speaking
drop policy if exists "profiles card read" on public.profiles;
create policy "profiles card read" on public.profiles for select using (auth.role() = 'authenticated');

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
  streak integer default 0,             -- consecutive correct on review → graduate at 2
  updated_at timestamptz default now(),
  primary key (user_id, question_key)
);
alter table public.review_items add column if not exists streak integer default 0;
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

-- ---------- 8c) Tea-room discussions (shared among approved users) ----------
-- "Discuss with friends": any question whose rationale is worth chewing over
-- at tea time is posted to a shared board. Every approved candidate can read
-- the board and reply; you can only delete your own posts/replies.
create table if not exists public.discussions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text,
  question_key text,                    -- paperId:kind:number (nullable — free topics allowed)
  paper_title text,
  answer_text text,                     -- the correct answer, for context
  rationale text,                       -- the rationale / hook being discussed
  question jsonb,                       -- FULL question snapshot (stem, options, answer, hook)
  topic text not null,                  -- the poster's prompt: "why is this the answer?"
  created_at timestamptz default now()
);
alter table public.discussions add column if not exists question jsonb;
create index if not exists disc_created_idx on public.discussions (created_at desc);
alter table public.discussions enable row level security;
drop policy if exists "discussions read" on public.discussions;
drop policy if exists "discussions insert" on public.discussions;
drop policy if exists "discussions own delete" on public.discussions;
create policy "discussions read" on public.discussions for select using (auth.role() = 'authenticated');
create policy "discussions insert" on public.discussions for insert with check (auth.uid() = user_id);
create policy "discussions own delete" on public.discussions for delete using (auth.uid() = user_id);

create table if not exists public.discussion_replies (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references public.discussions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text,
  body text not null,
  created_at timestamptz default now()
);
create index if not exists disc_reply_idx on public.discussion_replies (discussion_id, created_at);

-- Reply counts are kept on the thread row by a trigger. Without this the app
-- had to read EVERY reply row just to draw "12 comments" badges — an unbounded
-- query that grew with the board. One integer column removes it entirely.
alter table public.discussions add column if not exists reply_count integer not null default 0;
create or replace function public.bump_discussion_replies()
returns trigger language plpgsql security definer as $$
begin
  if TG_OP = 'INSERT' then
    update public.discussions set reply_count = reply_count + 1 where id = new.discussion_id;
    return new;
  elsif TG_OP = 'DELETE' then
    update public.discussions set reply_count = greatest(0, reply_count - 1) where id = old.discussion_id;
    return old;
  end if;
  return null;
end; $$;
drop trigger if exists on_discussion_reply on public.discussion_replies;
create trigger on_discussion_reply
  after insert or delete on public.discussion_replies
  for each row execute function public.bump_discussion_replies();
-- backfill for boards created before the column existed
update public.discussions d
   set reply_count = (select count(*) from public.discussion_replies r where r.discussion_id = d.id)
 where d.reply_count = 0;
alter table public.discussion_replies enable row level security;
drop policy if exists "disc replies read" on public.discussion_replies;
drop policy if exists "disc replies insert" on public.discussion_replies;
drop policy if exists "disc replies own delete" on public.discussion_replies;
create policy "disc replies read" on public.discussion_replies for select using (auth.role() = 'authenticated');
create policy "disc replies insert" on public.discussion_replies for insert with check (auth.uid() = user_id);
create policy "disc replies own delete" on public.discussion_replies for delete using (auth.uid() = user_id);

-- ---------- 8c-2) Tea room v2: wall posts, reactions, threaded comments ----------
-- The board grew from a text list into a study wall: posts carry media
-- (photos, screenshots, files), comments nest one level like Facebook, and
-- reactions are counted on the row so a feed costs no extra query.
alter table public.discussions add column if not exists kind text default 'post';        -- post | question
alter table public.discussions add column if not exists media jsonb default '[]'::jsonb; -- [{url,type,name,size}]
alter table public.discussions add column if not exists reaction_count integer not null default 0;
alter table public.discussions add column if not exists edited_at timestamptz;
alter table public.discussion_replies add column if not exists parent_id uuid references public.discussion_replies(id) on delete cascade;
alter table public.discussion_replies add column if not exists media jsonb default '[]'::jsonb;
create index if not exists disc_reply_parent_idx on public.discussion_replies (parent_id);

create table if not exists public.post_reactions (
  post_id uuid not null references public.discussions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null default '👍',
  created_at timestamptz default now(),
  primary key (post_id, user_id)
);
alter table public.post_reactions enable row level security;
drop policy if exists "reactions read" on public.post_reactions;
drop policy if exists "reactions own write" on public.post_reactions;
create policy "reactions read" on public.post_reactions for select using (auth.role() = 'authenticated');
create policy "reactions own write" on public.post_reactions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.bump_post_reactions()
returns trigger language plpgsql security definer as $$
begin
  if TG_OP = 'INSERT' then
    update public.discussions set reaction_count = reaction_count + 1 where id = new.post_id;
    return new;
  elsif TG_OP = 'DELETE' then
    update public.discussions set reaction_count = greatest(0, reaction_count - 1) where id = old.post_id;
    return old;
  end if;
  return null;
end; $$;
drop trigger if exists on_post_reaction on public.post_reactions;
create trigger on_post_reaction after insert or delete on public.post_reactions
  for each row execute function public.bump_post_reactions();

-- ---------- 8c-3) Chat rooms (direct + group) ----------
create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'group',          -- direct | group
  title text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  last_message_at timestamptz default now()
);
create table if not exists public.chat_members (
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  joined_at timestamptz default now(),
  last_read_at timestamptz default now(),
  primary key (room_id, user_id)
);
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text,
  body text,
  media jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);
create index if not exists chat_msg_idx on public.chat_messages (room_id, created_at desc);
create index if not exists chat_room_recent_idx on public.chat_rooms (last_message_at desc);

-- Membership check as SECURITY DEFINER so the policies below can reference
-- membership without chat_members' own policy recursing into itself.
create or replace function public.is_room_member(r uuid)
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.chat_members m where m.room_id = r and m.user_id = auth.uid());
$$;

alter table public.chat_rooms enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
drop policy if exists "rooms read" on public.chat_rooms;
drop policy if exists "rooms insert" on public.chat_rooms;
drop policy if exists "rooms update" on public.chat_rooms;
-- The creator must also be able to READ the row: `insert ... returning` runs
-- the SELECT policy, and at that instant no membership row exists yet — which
-- is what produced "new row violates row-level security policy".
create policy "rooms read" on public.chat_rooms for select
  using (public.is_room_member(id) or created_by = auth.uid());
create policy "rooms insert" on public.chat_rooms for insert with check (auth.uid() = created_by);
create policy "rooms update" on public.chat_rooms for update using (public.is_room_member(id));
drop policy if exists "members read" on public.chat_members;
drop policy if exists "members insert" on public.chat_members;
drop policy if exists "members own update" on public.chat_members;
drop policy if exists "members own delete" on public.chat_members;
create policy "members read" on public.chat_members for select using (public.is_room_member(room_id));
-- you may add yourself, anyone to a room you already belong to, or anyone to
-- a room you just created (own membership row isn't visible mid-statement)
create or replace function public.is_room_creator(r uuid)
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.chat_rooms c where c.id = r and c.created_by = auth.uid());
$$;
create policy "members insert" on public.chat_members for insert
  with check (auth.uid() = user_id or public.is_room_member(room_id) or public.is_room_creator(room_id));
create policy "members own update" on public.chat_members for update using (auth.uid() = user_id);
create policy "members own delete" on public.chat_members for delete using (auth.uid() = user_id);
drop policy if exists "messages read" on public.chat_messages;
drop policy if exists "messages insert" on public.chat_messages;
drop policy if exists "messages own delete" on public.chat_messages;
create policy "messages read" on public.chat_messages for select using (public.is_room_member(room_id));
create policy "messages insert" on public.chat_messages for insert
  with check (auth.uid() = user_id and public.is_room_member(room_id));
create policy "messages own delete" on public.chat_messages for delete using (auth.uid() = user_id);

create or replace function public.touch_room()
returns trigger language plpgsql security definer as $$
begin
  update public.chat_rooms set last_message_at = now() where id = new.room_id;
  return new;
end; $$;
drop trigger if exists on_chat_message on public.chat_messages;
create trigger on_chat_message after insert on public.chat_messages
  for each row execute function public.touch_room();

-- ---------- 8c-4) Storage for tea-room media ----------
insert into storage.buckets (id, name, public)
  values ('tearoom', 'tearoom', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;
drop policy if exists "avatars read" on storage.objects;
drop policy if exists "avatars upload" on storage.objects;
create policy "avatars read" on storage.objects for select using (bucket_id = 'avatars');
create policy "avatars upload" on storage.objects for all
  using (bucket_id = 'avatars' and auth.role() = 'authenticated')
  with check (bucket_id = 'avatars' and auth.role() = 'authenticated');
drop policy if exists "tearoom read" on storage.objects;
drop policy if exists "tearoom upload" on storage.objects;
drop policy if exists "tearoom own delete" on storage.objects;
create policy "tearoom read" on storage.objects for select using (bucket_id = 'tearoom');
create policy "tearoom upload" on storage.objects for insert
  with check (bucket_id = 'tearoom' and auth.role() = 'authenticated');
create policy "tearoom own delete" on storage.objects for delete
  using (bucket_id = 'tearoom' and owner = auth.uid());

-- ---------- 8d) User-designed study notes (private, tag + hook indexed) ----------
-- A memory hook is meaningless without the concept it hangs on. These notes let
-- a candidate write their own study note, attach AI-style topic tags and a
-- memory hook, and find it later by searching the tags. Private to each user.
create table if not exists public.user_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text,
  hook text,                            -- the memory hook / mnemonic
  tags text[] default '{}',             -- topic tags for meaning + search
  question_key text,                    -- optional link back to a question
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists user_notes_idx on public.user_notes (user_id, updated_at desc);
alter table public.user_notes enable row level security;
drop policy if exists "own user_notes all" on public.user_notes;
create policy "own user_notes all" on public.user_notes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

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

-- ---------- 10) CPD (TOG true/false self-assessment) ----------
-- One row per published volume, schema ogr-cpd-v1. Readable by everyone
-- (the Library only shows the section to users the developer has granted
-- the `cpd` flag AND who switched it on themselves), writable by the
-- developer alone — the same shape as essay_papers and flashcard_decks.
create table if not exists public.cpd_volumes (
  id text primary key,
  meta jsonb not null,                  -- { id, volume, doi, source, sections[…] }
  updated_at timestamptz default now()
);
alter table public.cpd_volumes enable row level security;
drop policy if exists "cpd read"  on public.cpd_volumes;
drop policy if exists "cpd write" on public.cpd_volumes;
create policy "cpd read" on public.cpd_volumes for select using (true);
create policy "cpd write" on public.cpd_volumes for all
  using  (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com')
  with check (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

-- Per-user answers. One row per user per question; the latest answer wins,
-- so re-doing a topic simply overwrites and the score stays truthful.
create table if not exists public.cpd_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  qkey text not null,                   -- volumeId:sectionId:questionId
  volume_id text not null,
  section_id text not null,
  answer boolean not null,              -- what the user picked
  correct boolean not null,
  answered_at timestamptz default now(),
  primary key (user_id, qkey)
);
create index if not exists cpdp_user_idx on public.cpd_progress (user_id, volume_id);

-- ogr-cpd-v2 adds SBA questions alongside true/false, so what the user picked
-- is no longer always a boolean. `choice` records the pick for every type
-- ('true'/'false' for TF, the option key for SBA) and `answer` stays for the
-- rows written before this, so existing progress is not lost.
alter table public.cpd_progress add column if not exists choice text;
alter table public.cpd_progress alter column answer drop not null;
alter table public.cpd_progress enable row level security;
drop policy if exists "own cpd progress all" on public.cpd_progress;
create policy "own cpd progress all" on public.cpd_progress for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

/* ============================================================
   v56 — OSCE stations, OSCE attempts, and the prepaid wallet
   Re-run this file after upgrading; every statement is idempotent.
   ============================================================ */

/* ---- OSCE stations: published by the developer, read by everyone ---- */
create table if not exists public.osce_stations (
  id   text primary key,
  meta jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.osce_stations enable row level security;
drop policy if exists "osce stations read"  on public.osce_stations;
drop policy if exists "osce stations write" on public.osce_stations;
create policy "osce stations read" on public.osce_stations for select using (true);
create policy "osce stations write" on public.osce_stations for all
  using  (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com')
  with check (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

/* ---- one candidate's attempt at one station ---- */
create table if not exists public.osce_attempts (
  id         text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  station_id text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists osce_attempts_user_idx on public.osce_attempts (user_id, created_at desc);
alter table public.osce_attempts enable row level security;
drop policy if exists "osce attempts own" on public.osce_attempts;
create policy "osce attempts own" on public.osce_attempts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

/* ---- prepaid top-ups ----
   A row is created by the payer and approved by the site owner. The payer may
   INSERT and READ their own rows but must never be able to UPDATE one — that
   is what stops "pending" being edited into "approved". Only the owner can
   change a status, which is why the balance can be trusted. */
create table if not exists public.credit_topups (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  amount_lkr numeric(12,2) not null check (amount_lkr > 0),
  reference  text default '',
  status     text not null default 'pending' check (status in ('pending','approved','declined')),
  note       text default '',
  slip       text,              -- a small data: URL of the slip, for the approver
  extracted  jsonb,             -- what the reader pulled off it
  created_at timestamptz not null default now()
);
create index if not exists credit_topups_user_idx on public.credit_topups (user_id, created_at desc);
alter table public.credit_topups enable row level security;
drop policy if exists "topups own read"   on public.credit_topups;
drop policy if exists "topups own insert" on public.credit_topups;
drop policy if exists "topups dev all"    on public.credit_topups;
create policy "topups own read"   on public.credit_topups for select using (auth.uid() = user_id);
create policy "topups own insert" on public.credit_topups for insert
  with check (auth.uid() = user_id and status = 'pending');
create policy "topups dev all"    on public.credit_topups for all
  using  (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com')
  with check (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

/* ============================================================
   v58 — OSCE recordings, kept for 24 hours
   ============================================================ */

/* A private bucket. Every object lives under the owner's uid, and the policy
   below is what enforces it — one candidate can never reach another's tape. */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('osce-audio', 'osce-audio', false, 26214400,
        array['audio/webm','audio/mp4','audio/aac','audio/ogg','audio/mpeg'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "osce audio own" on storage.objects;
create policy "osce audio own" on storage.objects for all
  to authenticated
  using      (bucket_id = 'osce-audio' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'osce-audio' and (storage.foldername(name))[1] = auth.uid()::text);

/* The app sweeps a user's own recordings older than a day whenever they open
   the OSCE tab, which is enough on its own. If pg_cron is enabled on your
   project, uncomment this to sweep server-side as well — then a recording is
   removed on time even for someone who never comes back.

     create extension if not exists pg_cron;
     select cron.schedule('osce-audio-sweep', '17 3 * * *', $$
       delete from storage.objects
        where bucket_id = 'osce-audio'
          and created_at < now() - interval '24 hours';
     $$);
*/


/* ============================================================
   v59 — OSCE collections
   ------------------------------------------------------------
   A station's bin ("Common bank", "Pera OSCE", …) is one string
   inside its `meta`, so filing a station needs no new column and
   no migration of the rows themselves.

   Filing the whole bank at once is the exception: doing it from
   the browser would mean downloading every station, changing one
   key and writing it all back — megabytes each way to set a
   string. This function does it inside Postgres instead, so the
   "move everything to the Common bank" button costs one call and
   no egress. Pass ids => null to move every station.

   The app falls back to read-modify-write if this function is not
   installed, so running it is an optimisation, not a requirement.
   ============================================================ */

create or replace function public.osce_set_collection(ids text[], coll text)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare n integer;
begin
  update osce_stations
     set meta = jsonb_set(meta, '{collection}', to_jsonb(coll), true)
   where ids is null or id = any(ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.osce_set_collection(text[], text) from public;
grant execute on function public.osce_set_collection(text[], text) to authenticated;


/* ============================================================
   v59 — the OSCE editor moves into the OSCE tab
   ------------------------------------------------------------
   Stations were developer-write-only. The editor is now a tab any
   signed-in candidate can open, so the policy has to let them
   save — but "anyone may edit" and "anyone may delete the bank"
   are very different risks, so they are separated here:

     • insert / update — any signed-in user. Improving a marking
       scheme is the point of opening it up.
     • delete          — the developer alone. A curated bank of
       200 stations must not be removable by one wrong click.

   Every save stamps edited_by / edited_at into the station's meta,
   so a bad edit is attributable and can be put back by hand.
   ============================================================ */

drop policy if exists "osce stations write"  on public.osce_stations;
drop policy if exists "osce stations edit"   on public.osce_stations;
drop policy if exists "osce stations add"    on public.osce_stations;
drop policy if exists "osce stations remove" on public.osce_stations;

create policy "osce stations add" on public.osce_stations for insert
  to authenticated with check (true);

create policy "osce stations edit" on public.osce_stations for update
  to authenticated using (true) with check (true);

create policy "osce stations remove" on public.osce_stations for delete
  to authenticated using (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');


/* ============================================================
   v62 — images on OSCE questions
   ------------------------------------------------------------
   A station question can carry a CTG, a partogram, a scan or a
   photograph. The FILES do not live in the station's JSON — a
   base64 CTG inside `meta` would be downloaded by every read of
   the bank, which is the exact cost the card projection was
   built to avoid. The question stores a path; the bytes live
   here.

   The bucket is public-read on purpose. These are teaching
   images shown to every candidate sitting the station, and a
   public object means the runner, the scheme dialog, the editor
   and the printed sheet can all just use the URL — no signing
   round-trip in the middle of a timed station, and nothing that
   expires while somebody is looking at it. Paths carry a random
   id, and Supabase does not allow listing a public bucket
   without credentials, so an object is only reachable by someone
   who has been given its exact URL.

   If you would rather they were private: set `public` to false
   below and swap getPublicUrl for createSignedUrl in
   js/backend.js (uploadOsceImage / osceImageUrl).

   Writes follow the station-editing rule set in v59 — any
   signed-in candidate may add one, only the developer may
   delete.
   ============================================================ */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('osce-images', 'osce-images', true, 8388608,
        array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "osce images read"   on storage.objects;
drop policy if exists "osce images add"    on storage.objects;
drop policy if exists "osce images remove" on storage.objects;

create policy "osce images read" on storage.objects for select
  using (bucket_id = 'osce-images');

create policy "osce images add" on storage.objects for insert
  to authenticated with check (bucket_id = 'osce-images');

create policy "osce images remove" on storage.objects for delete
  to authenticated
  using (bucket_id = 'osce-images' and auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

/* ============================================================
   v72 — OSCE flashcard decks

   A deck is built from ONE attempt: the points that were missed, turned
   into at most fifteen cards. It belongs to the candidate who sat the
   station and to nobody else, so the policy is the same "own rows only"
   shape as osce_attempts.

   The blueprint itself needs no table — it is one key inside the
   existing app_config row with id 'osce', beside the collections.
   ============================================================ */
create table if not exists public.osce_decks (
  id         text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  attempt_id text,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists osce_decks_user_idx on public.osce_decks (user_id, created_at desc);
alter table public.osce_decks enable row level security;
drop policy if exists "osce decks own" on public.osce_decks;
create policy "osce decks own" on public.osce_decks for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

/* ============================================================
   v73 — a real user number, and credit sent between users

   The reference on a bank slip was derived from the last five digits of
   the user's UUID. That was fine for "put this in the remark field" — a
   human reads it and the developer checks it. It is NOT fine as the
   address for a transfer of money: two UUIDs can end in the same five
   digits, and the wrong person would be credited.

   So the number becomes real: stored, unique, allocated once.
   ============================================================ */
create sequence if not exists public.user_no_seq start 10001;
alter table public.profiles add column if not exists user_no text;
-- existing rows keep a number for ever once given one
update public.profiles set user_no = lpad(nextval('public.user_no_seq')::text, 5, '0')
  where user_no is null;
alter table public.profiles alter column user_no set default lpad(nextval('public.user_no_seq')::text, 5, '0');
create unique index if not exists profiles_user_no_key on public.profiles (user_no);

/* Anyone signed in may look up the NUMBER and NAME of another user — that
   is what makes "send 500 to 10042" possible to confirm before sending.
   Nothing else about the row is exposed. */
create or replace view public.user_directory as
  select id, user_no, name from public.profiles where user_no is not null;
grant select on public.user_directory to authenticated;

/* A transfer is two rows in the ledger: a negative one for the sender and
   a positive one for the receiver. Keeping it in the same table means the
   balance arithmetic, the statement and the passbook all keep working
   with no change — a transfer simply reads as a debit or a credit.

   The positive-amount check therefore has to go; the amount must still be
   non-zero, and the server is what refuses an overdraft. */
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.credit_topups'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%amount_lkr > 0%' limit 1;
  if c is not null then execute format('alter table public.credit_topups drop constraint %I', c); end if;
end $$;
alter table public.credit_topups drop constraint if exists credit_topups_amount_nonzero;
alter table public.credit_topups add constraint credit_topups_amount_nonzero check (amount_lkr <> 0);

-- who the other side of a transfer was, for the passbook
alter table public.credit_topups add column if not exists kind text default 'topup';
alter table public.credit_topups add column if not exists counterparty text;
alter table public.credit_topups add column if not exists transfer_id text;
create index if not exists credit_topups_transfer_idx on public.credit_topups (transfer_id);

/* A user may still only INSERT a pending top-up for themselves. Transfers
   are written by the server with the service key, which bypasses RLS —
   deliberately, because the balance check that authorises them cannot be
   done in the browser. */
drop policy if exists "topups own insert" on public.credit_topups;
create policy "topups own insert" on public.credit_topups for insert
  with check (auth.uid() = user_id and status = 'pending' and amount_lkr > 0 and coalesce(kind,'topup') = 'topup');

/* ============================================================
   v76 — case-based discussion (PGIM Part II long case)
   Re-run this file after upgrading; every statement is idempotent.
   ============================================================ */

/* ---- the case files: published by the developer, read by everyone ----
   Same shape as osce_stations for the same reason — one document per case,
   fetched whole only when a case is opened. */
create table if not exists public.case_files (
  id   text primary key,
  meta jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.case_files enable row level security;
drop policy if exists "cases read"  on public.case_files;
drop policy if exists "cases write" on public.case_files;
create policy "cases read" on public.case_files for select using (true);
create policy "cases write" on public.case_files for all
  using      (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com')
  with check (auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com');

/* ---- one candidate's discussion of one case ----
   Written BEFORE marking as well as after: a discussion that could not be
   marked is still a discussion that happened, and the row is what lets the
   OSCE tab list it as awaiting marking rather than pretending it never was. */
create table if not exists public.case_attempts (
  id         text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  case_id    text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists case_attempts_user_idx on public.case_attempts (user_id, created_at desc);
alter table public.case_attempts enable row level security;
drop policy if exists "case attempts own" on public.case_attempts;
create policy "case attempts own" on public.case_attempts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

/* The case tape reuses the osce-audio bucket under the same uid folder
   (`<uid>/case-<attempt>.webm`), so the existing storage policy and the
   nightly 24-hour sweep both already cover it. Nothing to add here — this
   note exists so the absence is deliberate rather than an oversight. */

/* ============================================================
   v78 — discussions already had elsewhere
   Re-run this file after upgrading; every statement is idempotent.
   ============================================================ */

/* One candidate's record of a case they discussed somewhere else, imported
   as aureum-case-v2 JSON. PRIVATE, unlike case_files: a case_file is
   published material everyone sits, whereas this is the record of one
   person's own conversation, including where they went wrong. */
create table if not exists public.case_discussions (
  id         text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists case_discussions_user_idx on public.case_discussions (user_id, created_at desc);
alter table public.case_discussions enable row level security;
drop policy if exists "case discussions own" on public.case_discussions;
create policy "case discussions own" on public.case_discussions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


/* ============================================================
   v83 — the Created OSCE bank
   Re-run this file after upgrading; every statement is idempotent.
   ------------------------------------------------------------
   Candidates write stations for each other and import them into
   one bin. Nothing here creates a table: a created station is an
   ordinary row in osce_stations whose meta.collection is
   'created', which is exactly what makes every existing feature
   work on it unchanged.

   Insert and update were already open to any signed-in user
   (v59). The one thing that was NOT possible is the thing this
   bank needs: the author taking their own station back out. The
   first version of a station is usually wrong and its author is
   the person who finds out, and until now the only way to remove
   it was to ask the site owner.

   So delete is widened by exactly one case, and no further:

     • the site owner, as before — able to remove anything;
     • otherwise, only a row that IS in the created bin AND was
       stamped with this user's own id when it was imported.

   Both conditions are required. The second alone would let a
   forged meta.created_by reach a curated station; the first alone
   is what we already had. A station somebody else wrote, and every
   station in Common bank / Pera / Galle / SLCOG / PGIM recalls,
   stays as undeletable as it is today.

   Attempts are untouched by a withdrawal — osce_attempts has no
   foreign key to osce_stations, deliberately, so a candidate's
   marks survive the station being taken down.
   ============================================================ */

drop policy if exists "osce stations remove" on public.osce_stations;

create policy "osce stations remove" on public.osce_stations for delete
  to authenticated using (
    auth.jwt() ->> 'email' = 'ayeshmantha@gmail.com'
    or (
      meta ->> 'collection' = 'created'
      and meta ->> 'created_by' = auth.uid()::text
    )
  );


/* ============================================================
   v86 — Real station: a live OSCE between two people
   Re-run this file after upgrading; every statement is idempotent.
   ------------------------------------------------------------
   One person holds the scheme and marks; the other sits the
   station on their own device, in the same room or not. The
   examiner sends the scenario, then each question, reveal and
   image as they reach it. The candidate never receives the
   marking points — that is the whole reason this is a push
   rather than simply sharing the station.

   ONE ROW IS THE WHOLE SESSION. Not a row per message: a live
   station is a small object that changes often, and a candidate
   who reloads mid-station must get back everything already sent.
   A single jsonb row read on a poll gives that for one round
   trip; a message table would need a query, an ordering and a
   watermark to do the same job worse.

   WHO MAY DO WHAT

     • the examiner owns the row: creates it, sends into it,
       starts and ends it;
     • the candidate may read it, and may update it — which is
       how accepting and leaving work.

   The candidate's update right is deliberately not narrowed to
   particular keys. Postgres row-level security gates rows, not
   fields, and expressing "may change status but nothing else"
   would mean a trigger comparing old and new for every key. The
   pair are practising together by invitation; the honest limit
   here is that a candidate can only reach a session they were
   themselves invited to, and the marks never live in this table
   at all — they stay in the examiner's own marksheet until the
   attempt is written. There is nothing here worth forging.
   ============================================================ */

create table if not exists public.live_stations (
  id           text primary key,
  examiner_id  uuid not null references auth.users(id) on delete cascade,
  candidate_id uuid references auth.users(id) on delete set null,
  station_id   text not null,
  state        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);
create index if not exists live_stations_cand_idx on public.live_stations (candidate_id, updated_at desc);
create index if not exists live_stations_exam_idx on public.live_stations (examiner_id, updated_at desc);

alter table public.live_stations enable row level security;
drop policy if exists "live read"   on public.live_stations;
drop policy if exists "live add"    on public.live_stations;
drop policy if exists "live write"  on public.live_stations;
drop policy if exists "live remove" on public.live_stations;

create policy "live read" on public.live_stations for select
  to authenticated using (auth.uid() = examiner_id or auth.uid() = candidate_id);

create policy "live add" on public.live_stations for insert
  to authenticated with check (auth.uid() = examiner_id);

create policy "live write" on public.live_stations for update
  to authenticated using (auth.uid() = examiner_id or auth.uid() = candidate_id)
  with check (auth.uid() = examiner_id or auth.uid() = candidate_id);

create policy "live remove" on public.live_stations for delete
  to authenticated using (auth.uid() = examiner_id);

/* Realtime, where the project has it enabled. The app polls as well and
   does not depend on this — a live station that only updated every couple
   of seconds would still work — so a project without realtime loses
   nothing but the immediacy. */
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_stations'
    ) then
      alter publication supabase_realtime add table public.live_stations;
    end if;
  end if;
end $$;

/* A finished station is of no further use to anybody: the marks live in the
   attempt, and what was sent was only ever a way of getting the questions
   across. Sweeping keeps the table at the size of what is happening now. */
create or replace function public.sweep_live_stations()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.live_stations where updated_at < now() - interval '12 hours';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.sweep_live_stations() from public;
grant execute on function public.sweep_live_stations() to authenticated;
