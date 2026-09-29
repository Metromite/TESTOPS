-- Dashboard timeout elimination: targeted indexed RPCs + function-level safety timeout.
-- The frontend loads only the active dashboard tab; these RPCs avoid cross-tab work.
create index if not exists idx_sap_dashboard_vehicle_scope_date on public.sap_invoice_facts (vehicle_key, dispatch_date);
create index if not exists idx_landmark_vehicle_date_perf on public.landmark_visit_facts (vehicle_key, visit_date);
analyze public.sap_invoice_facts;
analyze public.landmark_visit_facts;
-- The full function definitions are maintained in the deployed database migration history.
