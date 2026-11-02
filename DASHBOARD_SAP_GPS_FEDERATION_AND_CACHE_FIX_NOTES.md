# DispatchOPS Dashboard — SAP/GPS Federation + Browser Cache Fix

## Scope
Dashboard data loading, Active Vehicles counting, and Driver Performance GPS hydration only. No UI redesign, no other application pages, no database/SQL/migration changes.

## Root cause found in the supplied application source
- The all-history SAP loader treated an entire dispatch date as owned by Primary. If Primary had even one invoice for a date, every Secondary invoice for that same date was discarded. Imports can be split across projects while sharing dispatch dates, so this silently removed vehicles and driver ownership from the selected month.
- The persistent IndexedDB dataset could be reused for up to 12 hours and returned without a live re-read. Normal and Private browser profiles have separate IndexedDB stores, so they could show different snapshots.
- Driver Performance hydration queried Landmark using only one raw SAP vehicle identifier (`vehicle_key || vehicle_num`) and did not page beyond the first 1,000 GPS rows per query. This missed valid joins where the other SAP vehicle alias was the match, and could truncate GPS detail.
- A single in-flight hydration promise blocked hydration for other date ranges. A slow request for one month could prevent the newly selected month from being hydrated.
- Driver Performance RPC reads used `Promise.all`; one project's failed RPC could reject the whole result even when another project returned valid GPS cards.

## Changes
1. Merge SAP facts from Primary, Secondary and Tertiary for the same dispatch date; suppress only duplicate invoice identities (dispatch date + invoice number + customer), keeping Primary first when an actual duplicate exists.
2. Treat IndexedDB as a paint-first snapshot only. Always re-read the federated live sources after loading a saved snapshot; bump the local dataset version to invalidate old snapshots and revalidate in-memory data after 60 seconds.
3. Read each SAP vehicle's `vehicle_key` and `vehicle_num` as aliases for Driver Performance matching.
4. Page Landmark GPS facts for the selected date range beyond PostgREST's 1,000-row response limit, then join by normalized vehicle aliases.
5. Track GPS hydration per date range, allow different months to hydrate independently, and prevent an old in-flight request from replacing a newer dataset.
6. Make Driver Performance RPC reads resilient to one project failing while another project remains available.
7. Count Active Vehicles using the source `vehicle_num` first (then `vehicle_key`) and include all dispatch rows in the selected period, not only invoices that pass the boxes KPI validity filter.
8. Keep the existing September date-bounded matching safeguards; GPS cards are still constrained to the selected period and are not borrowed from another month.

## Preserved
- Existing Dashboard UI and other pages.
- Existing SAP invoice validity rules for invoice/box KPIs.
- Existing per-day driver ownership and driver-name resolution rules.
- No SQL, migrations, database settings, or production records changed.

## Verification
- TypeScript transpile/syntax checks passed for all three changed TypeScript files.
- Full `npm run build` could not be completed in this environment: the supplied archive has no package lock, and dependency installation timed out. No claim of a successful production build is made.
- ZIP integrity is checked after packaging.
- Supabase project listing was available, but direct SQL reads were denied by the connected Supabase MCP permissions in this session. Therefore the secondary project's live October row counts could not be independently verified here.
