-- One customer + shipment + remarks pattern has one current Area Code.
-- This prevents duplicate branch rows caused only by differing area codes and
-- allows the DispatchOPS admin UI to correct the Area Code in-place.
drop index if exists public.uq_invoice_location_pattern;
alter table public.invoice_location_knowledge drop constraint if exists uq_invoice_location_pattern;
alter table public.invoice_location_knowledge add constraint uq_invoice_location_pattern unique (customer_key, shipment_to_key, remarks_key);
