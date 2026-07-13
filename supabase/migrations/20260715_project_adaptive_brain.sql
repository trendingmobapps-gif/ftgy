-- ITER AI Projects Phase 1C.4 — Adaptive Project Brain
-- Resource registry, project memory, workflow evolution log.
-- Safe to run in Supabase SQL Editor. Does NOT deploy to Production automatically.

create table if not exists public.project_resources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  step_id uuid references public.project_steps(id) on delete set null,
  action_id uuid references public.project_step_actions(id) on delete set null,
  result_id uuid references public.project_action_results(id) on delete set null,
  resource_type text not null default 'markdown'
    check (resource_type in (
      'markdown', 'text', 'pdf', 'word', 'excel', 'image', 'checklist',
      'study_notes', 'flashcards', 'business_plan', 'strategy', 'spreadsheet',
      'timeline', 'questionnaire', 'test', 'summary', 'document'
    )),
  title text not null,
  preview text not null default '',
  content text,
  mime_type text,
  file_extension text,
  metadata jsonb not null default '{}'::jsonb,
  source_strategy text not null default 'generate_resource'
    check (source_strategy in (
      'reuse_resource', 'use_tool', 'generate_resource', 'web_then_generate', 'project_brain'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_resources_project_idx
  on public.project_resources (project_id, user_id, created_at desc);

create unique index if not exists project_resources_step_unique_idx
  on public.project_resources (project_id, step_id)
  where step_id is not null;

create table if not exists public.project_memory (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  memory_key text not null,
  memory_value text not null,
  source text not null default 'session'
    check (source in ('session', 'resource', 'upload', 'workflow', 'system')),
  confidence numeric(4,3) not null default 1.000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, user_id, memory_key)
);

create index if not exists project_memory_project_idx
  on public.project_memory (project_id, user_id);

create table if not exists public.project_workflow_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  workflow_id uuid references public.project_workflows(id) on delete set null,
  step_id uuid references public.project_steps(id) on delete set null,
  event_type text not null
    check (event_type in ('skip_step', 'merge_step', 'split_step', 'insert_step', 'remove_step', 'reorder_step')),
  reason text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists project_workflow_events_project_idx
  on public.project_workflow_events (project_id, user_id, created_at desc);

alter table public.project_resources enable row level security;
alter table public.project_memory enable row level security;
alter table public.project_workflow_events enable row level security;
