-- ITER AI - Document production usage_events table (observed in Supabase exports)
-- Safe to run in SQL Editor. Does NOT alter existing production data.

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  email text not null,
  category_slug text,
  action_type text not null, -- tool_generation, category_chat, specialist_chat
  tool_slug text,
  specialist_slug text,
  chat_session_id text,
  idempotency_key text not null,
  consumed_amount integer not null default 0,
  was_consumed boolean not null default false,
  free_generations_before integer,
  free_generations_after integer,
  access_type text, -- premium, paid_category, free_trial
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists usage_events_idempotency_key_idx
  on public.usage_events (idempotency_key);

create index if not exists usage_events_email_idx
  on public.usage_events (email);

create index if not exists usage_events_profile_id_idx
  on public.usage_events (profile_id);

create index if not exists usage_events_action_type_idx
  on public.usage_events (action_type);

create index if not exists usage_events_created_at_idx
  on public.usage_events (created_at desc);

alter table public.usage_events enable row level security;

-- No public policies in Phase 1. Vercel uses SUPABASE_SERVICE_ROLE_KEY server-side.
