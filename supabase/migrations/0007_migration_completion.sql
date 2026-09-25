-- DispatchOPS migration completion: import labels, portable backups, and realtime-friendly metadata.
alter table import_batches add column if not exists label text not null default '';

create table if not exists app_backups (
  id uuid primary key default gen_random_uuid(),
  label text not null default '',
  created_at timestamptz not null default now(),
  created_by text not null default '',
  payload jsonb not null default '{}'::jsonb,
  row_count integer not null default 0
);

create index if not exists ix_app_backups_created_at on app_backups(created_at desc);

-- Realtime is intentionally limited to shared operational tables only.
do $$ begin
  alter publication supabase_realtime add table route_assignments;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table vacations;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table drivers;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table helpers;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table vehicles;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table import_batches;
exception when duplicate_object then null; end $$;
