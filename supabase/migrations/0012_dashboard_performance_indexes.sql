-- Dashboard performance indexes.
-- These support the date/driver/area filters used by all dashboard tabs
-- and the date-scoped V-Zone/Driver Performance query.
create index if not exists idx_sap_facts_dispatch_driver on public.sap_invoice_facts (dispatch_date, driver_name);
create index if not exists idx_sap_facts_dispatch_area on public.sap_invoice_facts (dispatch_date, area);
create index if not exists idx_sap_facts_dispatch_division on public.sap_invoice_facts (dispatch_date, division_desc);
create index if not exists idx_sap_facts_dispatch_vehicle_type on public.sap_invoice_facts (dispatch_date, vehicle_type);
create index if not exists idx_sap_facts_dispatch_facility on public.sap_invoice_facts (dispatch_date, facility_type);
create index if not exists idx_sap_facts_dispatch_salesman on public.sap_invoice_facts (dispatch_date, salesman);
create index if not exists idx_landmark_visit_date on public.landmark_visit_facts (visit_date);
create index if not exists idx_landmark_visit_vehicle_date on public.landmark_visit_facts (visit_date, vehicle_key);
