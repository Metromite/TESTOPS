-- Bulk Organizer v31 ("game view"): admin-curated defaults.
--
-- Previously every active Van/Pick-Up from the fleet was auto-selected for
-- every day, and customers were derived only from that day's SAP invoice
-- facts. The requested behaviour is the opposite: the day starts EMPTY and
-- the admin explicitly picks which vehicles and which customers are the
-- "default" set applied to every day (of every month), then adds/removes on
-- top of that per specific day. These two tables hold that curated default
-- set; the existing bulk_organizer_plans.vehicles / .customers JSON columns
-- (migrations 0045/0046) still hold the per-day override, unchanged.

create table if not exists public.bulk_organizer_default_vehicles (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  capacity int not null default 20,
  driver_name text,
  helper_name text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vehicle_id)
);

create table if not exists public.bulk_organizer_default_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  area text,
  division text,
  -- Drives which isometric building shape renders for this customer.
  building_type text not null default 'store'
    check (building_type in ('store', 'hospital', 'warehouse')),
  -- 0=Sunday .. 6=Saturday. Empty array = no recurring schedule (manual only).
  weekdays int[] not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

alter table public.bulk_organizer_default_vehicles enable row level security;
alter table public.bulk_organizer_default_customers enable row level security;

drop policy if exists allow_app_access_bulk_organizer_default_vehicles on public.bulk_organizer_default_vehicles;
create policy allow_app_access_bulk_organizer_default_vehicles
on public.bulk_organizer_default_vehicles for all to anon, authenticated
using (true) with check (true);

drop policy if exists allow_app_access_bulk_organizer_default_customers on public.bulk_organizer_default_customers;
create policy allow_app_access_bulk_organizer_default_customers
on public.bulk_organizer_default_customers for all to anon, authenticated
using (true) with check (true);

create index if not exists ix_bulk_organizer_default_vehicles_sort on public.bulk_organizer_default_vehicles(sort_order);
create index if not exists ix_bulk_organizer_default_customers_sort on public.bulk_organizer_default_customers(sort_order);

-- Same reasoning as migration 0004: an Admin editing defaults on one PC
-- should push live to every other open DispatchOPS window.
alter publication supabase_realtime add table
  bulk_organizer_default_vehicles,
  bulk_organizer_default_customers;

notify pgrst, 'reload schema';
