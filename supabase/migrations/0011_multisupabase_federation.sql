-- DispatchOPS dual-Supabase federation.
-- Primary remains the historical source. Secondary receives whole new imports
-- after the Primary Storage threshold and is read together with Primary.
alter table public.import_batches add column if not exists storage_project text not null default 'primary';

create table if not exists public.dispatchops_data_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  project_ref text not null,
  project_url text not null,
  role text not null default 'secondary',
  enabled boolean not null default true,
  write_priority integer not null default 100,
  storage_threshold_percent numeric not null default 85,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_learned_values_category_value
  on public.learned_values(category,value);

alter table public.dispatchops_data_sources enable row level security;
drop policy if exists "DispatchOPS public access" on public.dispatchops_data_sources;
create policy "DispatchOPS public access"
  on public.dispatchops_data_sources for all to anon,authenticated
  using (true) with check (true);
