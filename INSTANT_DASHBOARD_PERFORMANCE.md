# DispatchOPS — Instant Dashboard Performance Architecture

## What changed
- Dashboard analytics now use one server-side `dispatchops_dashboard_snapshot()` RPC per Supabase project.
- SAP and Landmark detail rows are no longer downloaded to the desktop merely to calculate dashboard charts/KPIs.
- The app federates the compact snapshots from both Supabase projects and merges them in memory.
- The existing dashboard cache/in-flight promise sharing remains active, so five dashboard tabs share one snapshot request for the same filter state.
- Date, driver, area, division, route type, vehicle type, facility type, salesman, lead-time band and classification filters are applied in PostgreSQL.
- Landmark analytics use `visit_date` and indexed `(visit_date, driver_name, vehicle_key)` access.
- Lead Time, Order Summary, Area Analytics, Not Supplied and Driver Performance are returned together.
- Driver Performance uses server-side GPS route aggregation and SAP vehicle matching.

## Performance model
The UI no longer scales network transfer and JavaScript calculation with the number of imported rows. Adding more months increases database work, but the dashboard response remains a compact aggregate payload. Indexes are aligned with the date/driver/vehicle filter patterns.

## Accuracy
The snapshot uses the same selected dashboard filters and date range for all dashboard tabs. Lead Time keeps the existing rule that negative/invalid invoice-to-dispatch intervals are excluded from Lead Time calculations. Other dashboard sections retain their SAP row population.

## Important limitation
No application can guarantee literally zero milliseconds for an uncached remote query over arbitrarily large data. The design targets the correct scalable behavior: server-side indexed aggregation, tiny response payloads, shared in-flight requests, and client-side cache reuse. For very large future datasets, Supabase compute capacity and indexes remain the limiting infrastructure resources.
