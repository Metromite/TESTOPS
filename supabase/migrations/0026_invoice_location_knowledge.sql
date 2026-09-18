-- DispatchOPS Invoice Location Knowledge
-- Structured learning store for SAP shipment destinations. Raw monthly workbooks are never stored by this feature.

create table if not exists public.invoice_location_knowledge (
  id uuid primary key default gen_random_uuid(),
  customer_key text not null,
  customer_name text not null,
  shipment_to_key text not null default '',
  shipment_to text not null default '',
  remarks_key text not null default '',
  remarks text not null default '',
  area_code text not null,
  area_name text not null,
  latest_invoice text,
  first_seen_date date,
  last_seen_date date,
  seen_count integer not null default 1 check (seen_count >= 1),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_invoice_location_pattern unique (customer_key, shipment_to_key, remarks_key, area_code)
);

create index if not exists ix_invoice_location_customer_key on public.invoice_location_knowledge(customer_key);
create index if not exists ix_invoice_location_area_code on public.invoice_location_knowledge(area_code);
create index if not exists ix_invoice_location_last_seen on public.invoice_location_knowledge(last_seen_date desc);

alter table public.invoice_location_knowledge enable row level security;
drop policy if exists allow_app_access_invoice_location_knowledge on public.invoice_location_knowledge;
create policy allow_app_access_invoice_location_knowledge
on public.invoice_location_knowledge for all
to anon, authenticated
using (true) with check (true);

grant select, insert, update, delete on public.invoice_location_knowledge to anon, authenticated;
