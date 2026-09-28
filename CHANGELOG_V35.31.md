# DispatchOPS V35.31 — Failover + Pallet Conversion Fix

## Pallet model
- 1 Big pallet = 1.5 Small pallets.
- 1 Small pallet = 2/3 Big-equivalent capacity.
- Vehicle `pallet_capacity` remains a Big-equivalent integer.
- Department Entry keeps `pallet_count` as physical pallet count (`big + small`); Bulk Organizer converts that physical mix to Big-equivalent for vehicle capacity checks.

## Resilience
- Federated reads no longer fail just because one Supabase project is unavailable. Healthy project results continue to be returned; an error is returned only when every configured project fails.
- New imports now select storage in strict order Primary -> Secondary -> Tertiary. If a project's capacity/health RPC is unavailable, the next project is tried automatically.
- Existing module ownership is preserved: Operational data remains Primary-owned, Price Change remains Secondary-owned, Bulk Organizer / Department remains Tertiary-owned.

## Database audit notes
- Primary realtime publication was repaired for the tables used by the current operational realtime hooks.
- Tertiary realtime publication was repaired for `bulk_organizer_plans` and `department_dispatch_entries`.
- Tertiary has the import/fact tables needed for overflow imports (`import_batches`, `sap_invoice_facts`, `landmark_visit_facts`, etc.).
- Primary vehicle capacities are not populated by this release; no capacity values were invented.
- `invoice_location_knowledge` remains Primary-owned; its absence from live Tertiary is treated as intentional schema ownership rather than copied blindly.
- Existing SECURITY DEFINER / RLS advisor findings were not blindly changed because several are part of existing login/portal workflows.
