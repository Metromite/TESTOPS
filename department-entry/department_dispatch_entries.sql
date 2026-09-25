create table if not exists public.department_dispatch_entries (
  id uuid primary key default gen_random_uuid(),
  department text not null check (department in ('Pharma','Medical','Consumer')),
  division text not null check (division in ('Pharma','Consumer')),
  invoice_no text not null,
  store_id text not null,
  store_name text not null,
  area text not null default '',
  entry_date date not null default ((current_timestamp at time zone 'Asia/Dubai')::date),
  target_date date not null,
  pallet_count integer not null default 1 check (pallet_count > 0),
  big_pallet_count integer not null default 0 check (big_pallet_count >= 0),
  small_pallet_count integer not null default 0 check (small_pallet_count >= 0),
  status text not null default 'ready' check (status in ('ready','handed_over','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null default '',
  constraint department_dispatch_pallet_sum check (big_pallet_count + small_pallet_count = pallet_count),
  constraint department_dispatch_unique_invoice unique (department, invoice_no, target_date)
);

create index if not exists department_dispatch_target_date_idx on public.department_dispatch_entries(target_date, division, status);
create index if not exists department_dispatch_store_idx on public.department_dispatch_entries(store_id, target_date);

alter table public.department_dispatch_entries enable row level security;
drop policy if exists department_dispatch_entries_access on public.department_dispatch_entries;
create policy department_dispatch_entries_access on public.department_dispatch_entries
  for all to anon, authenticated using (true) with check (true);

create or replace function public.guard_department_dispatch_entry()
returns trigger
language plpgsql
as $$
declare
  dubai_now timestamp := (current_timestamp at time zone 'Asia/Dubai');
  dubai_today date := dubai_now::date;
begin
  if dubai_now::time >= time '16:30' then
    raise exception 'Department dispatch entry is closed after 16:30 Asia/Dubai.';
  end if;
  if new.target_date < dubai_today + 1 then
    raise exception 'Department dispatch entries must be scheduled for tomorrow or a later date.';
  end if;
  if new.big_pallet_count + new.small_pallet_count <> new.pallet_count then
    raise exception 'Big + Small pallet counts must equal total pallets.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists department_dispatch_entry_guard on public.department_dispatch_entries;
create trigger department_dispatch_entry_guard
before insert or update on public.department_dispatch_entries
for each row execute function public.guard_department_dispatch_entry();

-- Enable Postgres Changes so the existing Bulk Organizer can receive entries immediately.
alter publication supabase_realtime add table public.department_dispatch_entries;
