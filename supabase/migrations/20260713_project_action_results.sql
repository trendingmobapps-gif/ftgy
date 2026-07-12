-- ITER AI Projects Phase 1C.3 — Project Execution Engine
-- Action preparation, execution state, and lightweight result persistence.
-- Safe to run in Supabase SQL Editor. Does NOT deploy to Production automatically.

-- ---------------------------------------------------------------------------
-- project_step_actions
-- ---------------------------------------------------------------------------

create table if not exists public.project_step_actions (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references public.project_steps(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  workflow_id uuid not null references public.project_workflows(id) on delete cascade,
  user_id uuid not null,
  status text not null default 'prepared'
    check (status in ('prepared', 'in_progress', 'completed', 'failed')),
  capability_type text not null default 'tool'
    check (capability_type in ('tool', 'project_brain')),
  capability_ref text,
  title text not null,
  explanation text not null,
  why_it_matters text,
  expected_result text not null,
  prepared_prompt text,
  prepared_input jsonb not null default '{}'::jsonb,
  missing_fields jsonb not null default '[]'::jsonb,
  estimated_effort_label text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (step_id)
);

create index if not exists project_step_actions_project_id_idx
  on public.project_step_actions (project_id);

create index if not exists project_step_actions_user_id_idx
  on public.project_step_actions (user_id);

-- ---------------------------------------------------------------------------
-- project_action_results
-- ---------------------------------------------------------------------------

create table if not exists public.project_action_results (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.project_step_actions(id) on delete cascade,
  step_id uuid not null references public.project_steps(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  result_type text not null default 'text'
    check (result_type in ('text', 'summary', 'document')),
  title text not null,
  preview text not null,
  content text,
  created_at timestamptz not null default now()
);

create index if not exists project_action_results_project_id_idx
  on public.project_action_results (project_id);

create index if not exists project_action_results_step_id_idx
  on public.project_action_results (step_id);

create index if not exists project_action_results_user_id_idx
  on public.project_action_results (user_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.project_step_actions enable row level security;
alter table public.project_action_results enable row level security;

drop policy if exists project_step_actions_select_own on public.project_step_actions;
create policy project_step_actions_select_own on public.project_step_actions
  for select using (auth.uid() = user_id);

drop policy if exists project_action_results_select_own on public.project_action_results;
create policy project_action_results_select_own on public.project_action_results
  for select using (auth.uid() = user_id);

drop policy if exists project_step_actions_no_client_insert on public.project_step_actions;
create policy project_step_actions_no_client_insert on public.project_step_actions
  for insert with check (false);

drop policy if exists project_step_actions_no_client_update on public.project_step_actions;
create policy project_step_actions_no_client_update on public.project_step_actions
  for update using (false);

drop policy if exists project_action_results_no_client_insert on public.project_action_results;
create policy project_action_results_no_client_insert on public.project_action_results
  for insert with check (false);
