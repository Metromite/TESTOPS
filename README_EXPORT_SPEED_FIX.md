# PriceChangePortal — Excel Export Speed/Progress Fix

Replacement file:
- `frontend/index.html`

What it fixes:
1. The Excel export progress UI starts immediately when Export to Excel is clicked.
2. It no longer waits until the server has finished generating the workbook before showing progress.
3. When the browser provides a response size, the download portion uses real byte progress.
4. The generated XLSX is cached locally by its exact export URL, so repeating the same export can download almost immediately.
5. Existing dashboard filters and the existing `/api/dashboard/export-excel?...` URL are preserved; no dashboard filtering logic is changed.

Install:
Replace the repository's `frontend/index.html` with the included file, then rebuild/deploy the frontend.
