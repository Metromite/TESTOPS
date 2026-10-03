# Dashboard V13.6.53 — Export + Loading Final Fix

Only two Dashboard files were changed from V13.6.52:

- `src/pages/Dashboard.tsx`
  - Added a UI-only `initialLoadComplete` gate.
  - When the existing dataset/latest-range loading is ready, the progress is allowed to visibly reach 100% first, remains at 100% briefly, and only then is the Dashboard revealed.
  - No dataset loading, filtering, Supabase, KPI, or calculation logic was changed.

- `src/services/desktopExport.ts`
  - Kept the existing workbook generation and current-filtered-data path unchanged.
  - Hardened the browser Excel save path with an explicit Blob/object-URL download and legacy `msSaveOrOpenBlob` fallback.
  - Tauri/native save path remains unchanged.

No other application files were modified.
