-- Bulk Organizer: daily planning payloads only. Existing operational tables are untouched.
create table if not exists public.bulk_organizer_plans (
  id uuid primary key default gen_random_uuid(),
  plan_date date not null unique,
  vehicles jsonb not null default '[]'::jsonb,
  pallets jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bulk_organizer_plans enable row level security;
drop policy if exists allow_app_access_bulk_organizer_plans on public.bulk_organizer_plans;
create policy allow_app_access_bulk_organizer_plans
on public.bulk_organizer_plans for all to anon, authenticated
using (true) with check (true);

create index if not exists ix_bulk_organizer_plans_date on public.bulk_organizer_plans(plan_date);
notify pgrst, 'reload schema';
