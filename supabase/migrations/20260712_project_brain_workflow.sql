-- ITER AI Projects Phase 1C.2 — Project Brain workflow foundation
-- Normalized workflow tables + brain metadata on projects.
-- Safe to run in Supabase SQL Editor. Does NOT deploy to Production automatically.

-- ---------------------------------------------------------------------------
-- Brain metadata on projects
-- ---------------------------------------------------------------------------

alter table public.projects
  add column if not exists brain_status text not null default 'pending',
  add column if not exists brain_version text,
  add column if not exists brain_generated_at timestamptz,
  add column if not exists brain_failure_code text,
  add column if not exists brain_attempt_count integer not null default 0;

alter table public.projects drop constraint if exists projects_brain_status_check;
alter table public.projects
  add constraint projects_brain_status_check
  check (brain_status in ('pending', 'generating', 'ready', 'failed'));

create index if not exists projects_brain_status_idx
  on public.projects (brain_status);

-- ---------------------------------------------------------------------------
-- project_workflows
-- ---------------------------------------------------------------------------

create table if not exists public.project_workflows (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  user_id uuid not null,
  summary text not null,
  current_stage text,
  complexity text not null check (complexity in ('low', 'medium', 'high')),
  estimated_duration_label text,
  brain_version text not null,
  status text not null default 'ready' check (status in ('ready')),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_workflows_user_id_idx
  on public.project_workflows (user_id);

create index if not exists project_workflows_project_id_idx
  on public.project_workflows (project_id);

-- ---------------------------------------------------------------------------
-- project_milestones
-- ---------------------------------------------------------------------------

create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.project_workflows(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  title text not null,
  description text not null,
  position integer not null check (position >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_id, position)
);

create index if not exists project_milestones_workflow_id_idx
  on public.project_milestones (workflow_id, position);

create index if not exists project_milestones_project_id_idx
  on public.project_milestones (project_id);

-- ---------------------------------------------------------------------------
-- project_steps
-- ---------------------------------------------------------------------------

create table if not exists public.project_steps (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.project_milestones(id) on delete cascade,
  workflow_id uuid not null references public.project_workflows(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  title text not null,
  description text not null,
  expected_outcome text not null,
  rationale text,
  position integer not null check (position >= 0),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high')),
  estimated_effort_label text,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'skipped')),
  tool_id text,
  tool_slug text,
  tool_name text,
  tool_category_slug text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (milestone_id, position)
);

create index if not exists project_steps_workflow_id_idx
  on public.project_steps (workflow_id, milestone_id, position);

create index if not exists project_steps_project_id_idx
  on public.project_steps (project_id);

create index if not exists project_steps_user_id_idx
  on public.project_steps (user_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.project_workflows enable row level security;
alter table public.project_milestones enable row level security;
alter table public.project_steps enable row level security;

-- Read own workflow data
drop policy if exists project_workflows_select_own on public.project_workflows;
create policy project_workflows_select_own on public.project_workflows
  for select using (auth.uid() = user_id);

drop policy if exists project_milestones_select_own on public.project_milestones;
create policy project_milestones_select_own on public.project_milestones
  for select using (auth.uid() = user_id);

drop policy if exists project_steps_select_own on public.project_steps;
create policy project_steps_select_own on public.project_steps
  for select using (auth.uid() = user_id);

-- Users may update step status on their own projects (defense in depth; mobile uses backend API)
drop policy if exists project_steps_update_own on public.project_steps;
create policy project_steps_update_own on public.project_steps
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- No direct inserts from authenticated clients — generation writes use service role via backend
drop policy if exists project_workflows_no_client_insert on public.project_workflows;
create policy project_workflows_no_client_insert on public.project_workflows
  for insert with check (false);

drop policy if exists project_milestones_no_client_insert on public.project_milestones;
create policy project_milestones_no_client_insert on public.project_milestones
  for insert with check (false);

drop policy if exists project_steps_no_client_insert on public.project_steps;
create policy project_steps_no_client_insert on public.project_steps
  for insert with check (false);
