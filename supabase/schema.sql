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
-- (e.g. {"simulator": true, "flashcards": true}). Empty = defaults only.
alter table public.profiles add column if not exists feature_flags jsonb default '{}'::jsonb;

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
-- scoring that user's performance.
create table if not exists public.user_question_edits (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_key text not null,           -- paperId:kind:number
  flagged boolean default false,
  flag_note text,
  explanation text,
  excluded boolean default false,       -- simulator: don't count this question for me
  updated_at timestamptz default now(),
  primary key (user_id, question_key)
);
create index if not exists uqe_excluded_idx on public.user_question_edits (user_id) where excluded;
alter table public.user_question_edits enable row level security;
drop policy if exists "own uqe all" on public.user_question_edits;
create policy "own uqe all" on public.user_question_edits for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

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
