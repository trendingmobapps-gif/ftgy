-- ITER AI - Phase 1 Supabase/Postgres schema
-- Scope: profiles, access, usage limits, generation history, saved generations, chat sessions, user progress, orders
-- Safe to run in a new Supabase project SQL Editor.

create extension if not exists pgcrypto;

-- 1) Central user profile, initially linked by normalized email.
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  has_account boolean not null default false,
  wix_member_id text,
  supabase_user_id uuid unique,
  full_name text,
  avatar_url text,
  created_from text not null default 'unknown', -- wix_member, purchase, import, mobile_signup, manual
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists profiles_wix_member_id_idx on public.profiles (wix_member_id);
create index if not exists profiles_supabase_user_id_idx on public.profiles (supabase_user_id);

-- 2) Paid access. Premium/all access uses access_scope='all' and category_slug=null.
create table if not exists public.user_access (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  email text not null,
  access_scope text not null default 'category', -- category, all
  category_slug text, -- business, studii, cariera, fitness, finante, comunicare, socialMedia, viataPersonala
  plan text not null, -- business, studii, premium, etc.
  status text not null default 'active', -- active, inactive, refunded, revoked, expired
  access_type text not null default 'lifetime', -- lifetime, subscription, trial, manual
  source text not null default 'wix', -- wix, import, admin, mobile, manual
  source_order_id text,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_access_email_idx on public.user_access (email);
create index if not exists user_access_profile_id_idx on public.user_access (profile_id);
create index if not exists user_access_category_idx on public.user_access (category_slug);
create index if not exists user_access_status_idx on public.user_access (status);
create index if not exists user_access_source_order_idx on public.user_access (source_order_id);

-- Prevent duplicate active access for the same email/scope/category.
create unique index if not exists user_access_unique_active_access_idx
  on public.user_access (email, access_scope, coalesce(category_slug, '__all__'))
  where status = 'active';

-- 3) Free generation limits. Rule: 3 free generations total across the platform.
create table if not exists public.usage_limits (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  email text not null unique,
  free_generations_total integer not null default 3,
  free_generations_used integer not null default 0,
  free_generations_remaining integer not null default 3,
  last_generation_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint usage_limits_non_negative check (
    free_generations_total >= 0 and
    free_generations_used >= 0 and
    free_generations_remaining >= 0
  )
);

create index if not exists usage_limits_email_idx on public.usage_limits (email);
create index if not exists usage_limits_profile_id_idx on public.usage_limits (profile_id);

-- 4) Wix / payment orders. Wix remains payment system for now.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  email text not null,
  wix_order_id text unique,
  wix_product_id text,
  plan text,
  amount numeric(10,2),
  currency text default 'RON',
  payment_status text not null default 'paid', -- paid, pending, failed, refunded
  processed boolean not null default false,
  processed_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_email_idx on public.orders (email);
create index if not exists orders_profile_id_idx on public.orders (profile_id);
create index if not exists orders_wix_order_id_idx on public.orders (wix_order_id);
create index if not exists orders_payment_status_idx on public.orders (payment_status);

-- 5) AI tool generation history.
create table if not exists public.generation_history (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  email text not null,
  wix_item_id text unique, -- optional, used when importing old Wix CMS records
  member_id text,
  tool_id text,
  tool_name text,
  tool_slug text,
  category_slug text,
  category_name text,
  user_input_json jsonb not null default '{}'::jsonb,
  result_markdown text,
  results_json jsonb,
  variant_number integer,
  source text not null default 'vercel', -- vercel, wix_import, manual
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists generation_history_email_idx on public.generation_history (email);
create index if not exists generation_history_profile_id_idx on public.generation_history (profile_id);
create index if not exists generation_history_tool_slug_idx on public.generation_history (tool_slug);
create index if not exists generation_history_category_slug_idx on public.generation_history (category_slug);
create index if not exists generation_history_created_at_idx on public.generation_history (created_at desc);

-- 6) Saved generations/favorites.
create table if not exists public.saved_generations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  email text not null,
  wix_item_id text unique, -- optional, used when importing old Wix CMS records
  generation_id uuid references public.generation_history(id) on delete set null,
  member_id text,
  title text,
  tool_id text,
  tool_name text,
  tool_slug text,
  category_slug text,
  category_name text,
  user_input_json jsonb not null default '{}'::jsonb,
  result_markdown text,
  results_json jsonb,
  variant_count integer,
  source text not null default 'vercel', -- vercel, wix_import, manual
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_generations_email_idx on public.saved_generations (email);
create index if not exists saved_generations_profile_id_idx on public.saved_generations (profile_id);
create index if not exists saved_generations_tool_slug_idx on public.saved_generations (tool_slug);
create index if not exists saved_generations_category_slug_idx on public.saved_generations (category_slug);
create index if not exists saved_generations_created_at_idx on public.saved_generations (created_at desc);

-- 7) Category/specialist chat history. Phase 1 stores messages_json like Wix, to avoid breaking existing logic.
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  email text not null,
  wix_item_id text unique, -- optional, used when importing old Wix CMS records
  member_id text,
  chat_type text not null default 'category', -- category, specialist
  category_slug text,
  category_name text,
  specialist_slug text,
  chat_title text,
  messages_json jsonb not null default '[]'::jsonb,
  tools_json jsonb not null default '[]'::jsonb,
  last_message_preview text,
  source text not null default 'vercel', -- vercel, wix_import, manual
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_sessions_email_idx on public.chat_sessions (email);
create index if not exists chat_sessions_profile_id_idx on public.chat_sessions (profile_id);
create index if not exists chat_sessions_chat_type_idx on public.chat_sessions (chat_type);
create index if not exists chat_sessions_category_slug_idx on public.chat_sessions (category_slug);
create index if not exists chat_sessions_updated_at_idx on public.chat_sessions (updated_at desc);

-- 8) Flexible user progress data.
create table if not exists public.user_progress (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  email text not null,
  category_slug text,
  tool_slug text,
  progress_type text not null, -- onboarding, last_used_tool, category_usage, favorite_tool, etc.
  progress_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_progress_email_idx on public.user_progress (email);
create index if not exists user_progress_profile_id_idx on public.user_progress (profile_id);
create index if not exists user_progress_category_slug_idx on public.user_progress (category_slug);
create index if not exists user_progress_tool_slug_idx on public.user_progress (tool_slug);
create index if not exists user_progress_type_idx on public.user_progress (progress_type);

create unique index if not exists user_progress_unique_idx
  on public.user_progress (email, coalesce(category_slug, '__none__'), coalesce(tool_slug, '__none__'), progress_type);

-- 9) Updated-at trigger helper.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger user_access_set_updated_at
before update on public.user_access
for each row execute function public.set_updated_at();

create trigger usage_limits_set_updated_at
before update on public.usage_limits
for each row execute function public.set_updated_at();

create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create trigger generation_history_set_updated_at
before update on public.generation_history
for each row execute function public.set_updated_at();

create trigger saved_generations_set_updated_at
before update on public.saved_generations
for each row execute function public.set_updated_at();

create trigger chat_sessions_set_updated_at
before update on public.chat_sessions
for each row execute function public.set_updated_at();

create trigger user_progress_set_updated_at
before update on public.user_progress
for each row execute function public.set_updated_at();

-- 10) Optional but recommended: enable RLS. During Phase 1, Vercel should use SUPABASE_SERVICE_ROLE_KEY server-side.
alter table public.profiles enable row level security;
alter table public.user_access enable row level security;
alter table public.usage_limits enable row level security;
alter table public.orders enable row level security;
alter table public.generation_history enable row level security;
alter table public.saved_generations enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.user_progress enable row level security;

-- 11) Usage events audit trail (production extension — see migrations/20260712_document_usage_events.sql)
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  email text not null,
  category_slug text,
  action_type text not null,
  tool_slug text,
  specialist_slug text,
  chat_session_id text,
  idempotency_key text not null,
  consumed_amount integer not null default 0,
  was_consumed boolean not null default false,
  free_generations_before integer,
  free_generations_after integer,
  access_type text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists usage_events_idempotency_key_idx
  on public.usage_events (idempotency_key);

create index if not exists usage_events_email_idx on public.usage_events (email);
create index if not exists usage_events_profile_id_idx on public.usage_events (profile_id);
create index if not exists usage_events_action_type_idx on public.usage_events (action_type);
create index if not exists usage_events_created_at_idx on public.usage_events (created_at desc);

alter table public.usage_events enable row level security;

-- No public policies are created in Phase 1.
-- All reads/writes should go through Vercel using the Supabase service role key.
