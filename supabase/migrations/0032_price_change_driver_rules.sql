-- Driver portal data rules. Authentication is handled by Supabase Auth; this migration only adds
-- the assignment rule used by the UI to decide whether the driver may edit Location.
alter table public.price_change_assignments
  add column if not exists location_locked boolean not null default false;

create index if not exists ix_price_change_assignments_driver_active
  on public.price_change_assignments(driver_id, active);

create index if not exists ix_price_change_visits_driver_campaign
  on public.price_change_customer_visits(driver_id, campaign_id, visited_at desc);
