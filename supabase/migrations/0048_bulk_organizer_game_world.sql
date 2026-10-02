create table if not exists public.bulk_organizer_defaults (id integer primary key default 1 check (id=1), buildings jsonb not null default '[]'::jsonb, vehicles jsonb not null default '[]'::jsonb, customer_schedules jsonb not null default '[]'::jsonb, updated_at timestamptz not null default now());
alter table public.bulk_organizer_defaults enable row level security;
drop policy if exists bulk_organizer_defaults_access on public.bulk_organizer_defaults;
create policy bulk_organizer_defaults_access on public.bulk_organizer_defaults for all to anon, authenticated using (true) with check (true);
alter table public.bulk_organizer_defaults replica identity full;
do $$ begin if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='bulk_organizer_defaults') then alter publication supabase_realtime add table public.bulk_organizer_defaults; end if; exception when undefined_object then null; end $$;
notify pgrst, 'reload schema';
