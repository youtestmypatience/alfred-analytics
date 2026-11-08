-- Выполняется в SQL Editor собственного проекта Supabase.
-- Внимание: эта таблица хранит исключительно отметки и положение в учебном материале.
create table if not exists public.study_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint payload_is_object check (jsonb_typeof(payload) = 'object')
);
alter table public.study_progress enable row level security;
revoke all on public.study_progress from anon, authenticated;
grant select, insert, update on public.study_progress to authenticated;
drop policy if exists "study_progress_select_own" on public.study_progress;
drop policy if exists "study_progress_insert_own" on public.study_progress;
drop policy if exists "study_progress_update_own" on public.study_progress;
create policy "study_progress_select_own" on public.study_progress
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "study_progress_insert_own" on public.study_progress
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "study_progress_update_own" on public.study_progress
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
