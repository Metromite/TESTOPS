# DispatchOPS Dashboard – Instant Slicers / Zero-Timeout Architecture

## Root causes fixed

1. Overview downloaded and paginated SAP rows to the desktop and calculated KPIs/charts in TypeScript.
2. Overview also downloaded the Landmark table for route timing.
3. Previously visited dashboard tabs stayed mounted while hidden, so one slicer change refreshed several tabs concurrently.
4. Area Analytics and Not Supplied still called the old all-tabs snapshot RPC, which unnecessarily ran Driver Performance and other analytics.
5. Fast tab RPCs were not consistently sharing identical in-flight requests.
6. Rapid multi-select slicer changes could leave superseded database requests running concurrently.
7. Landmark `arrival` / `departure` text was populated while native timestamp columns were empty, forcing timing parsing work at query time or returning N/A.
8. Dual-Supabase weekly Area Analytics merging assumed both projects had the same area array positions.

## Repairs included

- Overview now uses `dispatchops_dashboard_home_snapshot` and receives only compact aggregates.
- Area Analytics now uses `dispatchops_dashboard_area_snapshot` only.
- Not Supplied now uses `dispatchops_dashboard_not_supplied_snapshot` only.
- Driver Performance remains targeted and its SAP vehicle scope is applied before Landmark reads.
- Only the currently visible dashboard tab stays mounted. Exact-filter cache entries make revisits instant without hidden-tab database traffic.
- Dashboard requests use in-flight promise sharing and a 120 ms query debounce for rapid slicer changes.
- Removed Overview's 30-second hidden polling and its duplicate parallel KPI request.
- Added driver/date, area/date, division/date, vehicle/date and native Landmark timestamp indexes.
- Backfilled Landmark native timestamps and added an ingest trigger so future imports populate them automatically.
- Route timing now uses native indexed timestamps and daily route aggregation.
- Area weekly merge is keyed by area name across Primary + Secondary, not by array position.
- Full SQL is included in migrations 0018–0020 and appended to `supabase/RUN_ALL_MIGRATIONS.sql` for reproducibility.

## Live validation performed on Primary

Representative filter: 2026-06-01 through 2026-08-31, driver `Nasar`.

- Overview warm execution: ~108 ms.
- Area Analytics: ~166 ms in the earlier same three-month driver test.
- Driver Performance after native timestamp cache: ~143 ms.
- Overview returned 2,538 valid invoices and populated route timing.
- Landmark native timestamps: 251,185 / 251,185 existing rows populated.

Both Supabase projects contain the new RPCs/timestamp ingest support.

## Build note

Source-level TypeScript syntax checks for all modified files pass. The container could not complete dependency installation from npm, so the Windows/Tauri executable itself is still built on the normal Windows build environment using the included project/build files.

- Driver Performance charts are grouped by resolved Driver Name across all vehicles; Route Detail remains vehicle-level for audit/detail.
