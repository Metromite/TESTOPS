# Bulk Organizer V37 — Build Fix

## Fix
- Fixed `BulkOrganizer.tsx` `editInvoice()` state hydration so the invoice form includes the new `fridge_boxes` and `schedule_mode` fields required by the form state type.
- Existing Any Day and Fridge Boxes behavior is preserved.
- No other application pages or files were intentionally changed.

## Build note
The source fix is targeted at the reported TypeScript error at `BulkOrganizer.tsx(1573,20)`.
The local environment used for verification did not contain `node_modules`, and dependency installation timed out, so a complete Vite production build could not be completed in this environment.
