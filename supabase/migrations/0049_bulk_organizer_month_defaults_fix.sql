-- Ensure monthly Bulk Organizer defaults are stored per calendar month.
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
drop policy if exists bulk_organizer_month_defaults_access on public.bulk_organizer_month_defaults;
create policy bulk_organizer_month_defaults_access on public.bulk_organizer_month_defaults for all to anon, authenticated using (true) with check (true);
notify pgrst, 'reload schema';
