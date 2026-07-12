-- ITER AI Projects Phase 1C.3.1 — Project AI Sessions
-- Extends action tables with conversation state and result review.
-- Safe to run in Supabase SQL Editor. Does NOT deploy to Production automatically.

alter table public.project_step_actions
  add column if not exists session_status text not null default 'open'
    check (session_status in ('open', 'collecting', 'ready', 'generating', 'review', 'accepted', 'cancelled')),
  add column if not exists conversation jsonb not null default '[]'::jsonb,
  add column if not exists collected_input jsonb not null default '{}'::jsonb,
  add column if not exists pending_question jsonb,
  add column if not exists pending_result_id uuid references public.project_action_results(id) on delete set null;

alter table public.project_action_results
  add column if not exists acceptance_status text not null default 'pending_review'
    check (acceptance_status in ('pending_review', 'accepted', 'rejected'));

create index if not exists project_action_results_acceptance_idx
  on public.project_action_results (step_id, acceptance_status);
