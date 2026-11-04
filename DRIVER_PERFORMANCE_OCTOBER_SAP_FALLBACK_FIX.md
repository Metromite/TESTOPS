# Driver Performance October SAP fallback

## Why October displayed all zeros

Read-only checks across all three configured Supabase projects found:
- Secondary (`vyqyrcqrdsyrxywglqbh`) contains 14,832 October SAP invoice facts, 39 distinct drivers, and 39 distinct vehicles (2026-10-01 through 2026-10-29).
- The October Landmark import batch (`184198b0-9691-4def-a3d0-fd98a1256c40`) is marked `completed` with metadata reporting 90,175 rows / 90,125 successful facts, but the actual October raw import row count and Landmark fact count are both zero.
- No October Landmark source file object was found in the configured storage buckets, and October Landmark facts are zero across Primary, Secondary, and Tertiary.
- The Driver Performance page's four KPI tiles and charts were GPS/Landmark-only. Therefore, valid SAP data existed but the page rendered only zero GPS metrics.

## Application-only changes

- When GPS route cards exist, Driver Performance continues to use the existing GPS view unchanged.
- When GPS route cards are absent but SAP dispatch rows exist, Driver Performance now switches to an explicitly labelled SAP-only view with SAP drivers, invoices, boxes, vehicles, and per-driver dispatch activity (invoices, boxes, vehicles, dispatch days).
- The view explicitly states that stops and route duration cannot be calculated without Landmark visit records; it does not invent GPS metrics.
- SAP and Landmark paginated reads now use stable `id` ordering and retry transient page errors up to three attempts.

## Scope and verification

- No database tables, rows, functions, migrations, policies, or storage objects were changed.
- No other Dashboard tabs or September GPS presentation were changed.
- The three modified source files passed TypeScript/TSX syntax transpilation.
- Full application build was not verified: dependency installation timed out in this environment.
