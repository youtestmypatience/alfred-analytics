-- Alfred Analytics — Data Vault Knowledge Base
-- Authenticated users can access only their own study progress.
-- All training material remains publicly accessible without Supabase.
-- Execute in the selected Supabase project's SQL Editor (or as a reviewed migration).

-- One row per topic prevents unrelated updates from overwriting each other.
create table if not exists public.study_topic_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id text not null check (char_length(topic_id) between 1 and 120),
  completed boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);

-- One row per module preserves independent reading positions.
create table if not exists public.study_reading_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  module_num smallint not null check (module_num between 1 and 12),
  topic_id text,
  percent smallint not null check (percent between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, module_num)
);

-- Ensure modification time is always set by the database on updates.
create or replace function public.study_progress_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.study_progress_touch_updated_at() from public;
revoke all on function public.study_progress_touch_updated_at() from anon;
grant execute on function public.study_progress_touch_updated_at() to authenticated;

drop trigger if exists study_topic_touch_updated_at on public.study_topic_progress;
create trigger study_topic_touch_updated_at
  before update on public.study_topic_progress
  for each row execute function public.study_progress_touch_updated_at();

drop trigger if exists study_reading_touch_updated_at on public.study_reading_progress;
create trigger study_reading_touch_updated_at
  before update on public.study_reading_progress
  for each row execute function public.study_progress_touch_updated_at();

-- Explicit grants plus RLS are required; neither can substitute for the other.
alter table public.study_topic_progress enable row level security;
alter table public.study_reading_progress enable row level security;

revoke all on public.study_topic_progress from anon, authenticated;
revoke all on public.study_reading_progress from anon, authenticated;
grant select, insert, update on public.study_topic_progress to authenticated;
grant select, insert, update on public.study_reading_progress to authenticated;

create policy study_topic_select_own on public.study_topic_progress
  for select to authenticated using ((select auth.uid()) = user_id);
create policy study_topic_insert_own on public.study_topic_progress
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy study_topic_update_own on public.study_topic_progress
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy study_reading_select_own on public.study_reading_progress
  for select to authenticated using ((select auth.uid()) = user_id);
create policy study_reading_insert_own on public.study_reading_progress
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy study_reading_update_own on public.study_reading_progress
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

comment on table public.study_topic_progress is 'A per-topic completion flag for a single authenticated learner.';
comment on table public.study_reading_progress is 'Latest reading position for each training module.';
