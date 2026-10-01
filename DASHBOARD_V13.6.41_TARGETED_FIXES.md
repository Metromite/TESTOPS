# DispatchOPS Dashboard V13.6.41 — Targeted Dashboard-Only Fixes

This release is based directly on V13.6.40 Dashboard Excel/offline architecture. No non-Dashboard feature was intentionally changed.

## Changes
- Driver slicer: stop dropping SAP rows when SAP driver names do not exactly match Fleet master names. Drivers with real SAP data in the selected date range remain available.
- Multi-month KPI/detail behavior: KPI detail popups use the already-loaded persistent local analytical dataset, so one month and multiple months follow the same local filtering path.
- KPI detail batches are 100 rows. The popup automatically loads the next 100 when the table reaches the bottom; the manual “Load 200 more” button is removed.
- Detail footer shows progressive loading/status text while the next 100 rows are being appended.
- First Dashboard visit: when the persistent local dataset is not ready, show the Dashboard behind a blurred glass loading overlay with an animated progressive spinner and “We’re loading, hang on…” messaging.
- Removed Dashboard header Auto-refresh control and Refresh Dashboard button.
- Removed Clear All Filters button. Existing slicers/date filters remain unchanged.
- Existing IndexedDB/local analytical cache, Primary → Secondary fallback, local slicer filtering, and existing Dashboard tabs are preserved.

## Deployment
This ZIP intentionally does not contain a fake/incomplete package-lock.json. Use Cloudflare Build Root `frontend`, Build Command `npm run build`, Output Directory `dist`, and an install command that uses `npm install` when the project has no committed lockfile.
