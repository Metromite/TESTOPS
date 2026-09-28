-- Bulk Organizer game-board rebuild.
-- Daily overrides live in bulk_organizer_plans. Global defaults are reusable
-- for every month; a daily plan can override them without changing the defaults.
alter table public.bulk_organizer_plans
  add column if not exists buildings jsonb not null default '[]'::jsonb,
  add column if not exists vehicle_meta jsonb not null default '{}'::jsonb,
  add column if not exists customer_schedules jsonb not null default '[]'::jsonb;

create table if not exists public.bulk_organizer_defaults (
  id integer primary key default 1 check (id = 1),
  buildings jsonb not null default '[]'::jsonb,
  vehicles jsonb not null default '[]'::jsonb,
  customer_schedules jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.bulk_organizer_defaults enable row level security;
drop policy if exists allow_app_access_bulk_organizer_defaults on public.bulk_organizer_defaults;
create policy allow_app_access_bulk_organizer_defaults
on public.bulk_organizer_defaults for all to anon, authenticated
using (true) with check (true);

-- Keep the previously introduced month-default table compatible with v30
-- installs that already ran migration 0047.
create table if not exists public.bulk_organizer_month_defaults (
  id uuid primary key default gen_random_uuid(),
  month_key date not null unique,
  buildings jsonb not null default '[]'::jsonb,
  vehicles jsonb not null default '[]'::jsonb,
  customer_schedules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.bulk_organizer_month_defaults enable row level security;
drop policy if exists allow_app_access_bulk_organizer_month_defaults on public.bulk_organizer_month_defaults;
create policy allow_app_access_bulk_organizer_month_defaults
on public.bulk_organizer_month_defaults for all to anon, authenticated
using (true) with check (true);

-- Realtime is required for the multi-window live planner.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='bulk_organizer_plans') then
    alter publication supabase_realtime add table public.bulk_organizer_plans;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='bulk_organizer_defaults') then
    alter publication supabase_realtime add table public.bulk_organizer_defaults;
  end if;
exception when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
