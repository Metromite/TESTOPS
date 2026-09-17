# DispatchOPS fixes in this build

1. Dashboard slicers
   - Dashboard opens from cached filter metadata immediately.
   - Background refresh uses one compact `dispatchops_dashboard_filter_meta()` RPC.
   - Salesmen, areas, drivers, facility types, divisions, route types and vehicle types no longer require paging through every invoice row before the dropdowns can appear.

2. Fleet vehicle authority
   - Dashboard Home now normalizes SAP vehicle numbers and matches them to `public.vehicles.number`.
   - When matched, the Fleet Database vehicle number and `vehicles.type` are authoritative.
   - Vehicle Type slicer filters against the matched Fleet vehicle type, so Pick-Up does not depend on a stale SAP/area vehicle-type value.
   - Driver Overview also displays the exact Fleet vehicle number/type when matched.

3. Export progress
   - Progress starts at click time and gets a browser paint before network/workbook generation.
   - Additional paint points were added before SheetJS' CPU-heavy workbook write.

4. App icon / Home Screen
   - Added cache-busted favicon + Apple touch icon links.
   - Added a PWA manifest using the existing `app-icon.png`.
   - Browser caches can still require one hard refresh after deployment.

5. Required deployment step
   - Apply `supabase/migrations/0021_dashboard_fleet_vehicle_and_fast_filters.sql` to every Supabase project used by this installation.
   - Then rebuild/redeploy the frontend.
