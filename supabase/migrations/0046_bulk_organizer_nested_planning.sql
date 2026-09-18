-- Bulk Organizer v30: persist the nested planning model without touching
-- operational Fleet/SAP tables. Customers, invoices and pallet assignments
-- are stored inside the existing daily plan JSON document.
alter table public.bulk_organizer_plans
  add column if not exists customers jsonb not null default '[]'::jsonb,
  add column if not exists invoices jsonb not null default '[]'::jsonb,
  add column if not exists pallet_assignments jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
