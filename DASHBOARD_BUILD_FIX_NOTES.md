# Dashboard build fixes

- Replaced the incomplete Driver Performance fallback with a complete `PerfData` object matching the interface, so a failed `/dashboard/driver-performance` request can safely fall back to empty KPI/chart/card data.
- Added a definite-assignment assertion for the GPS hydration promise before its async cleanup callback references it. The promise is still registered and awaited as before.

No database, SQL, migration, environment, or unrelated page changes were made for this targeted TypeScript correction.

Build verification: the two reported `dashboardLocalStore.ts` TypeScript errors no longer appear in a global `tsc -b` run. A complete project build could not be verified in this environment because frontend dependencies (including React and its type declarations) are not installed; dependency installation did not complete.
