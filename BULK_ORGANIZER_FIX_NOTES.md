# Bulk Organizer Historical Invoice Fix

## Root cause
The new version changed `bulk_organizer_plans` loading from the historical Tertiary owner to Primary-first. If Primary contained an empty/shell plan row for a date while Tertiary contained the populated historical plan, the Primary row hid the invoices and pallet assignments.

The new Primary realtime listener could also spread an empty invoice/pallet array over the visible plan and blank existing invoices.

## Fix
- `frontend/src/services/bulkOrganizer.ts`
  - Read Primary and Tertiary for the requested date.
  - Prefer a populated Primary plan when it actually contains invoices.
  - Fall back to a populated Tertiary plan when Primary is only an empty shell.
  - Save back to the database that owns the existing populated plan, preserving historical Tertiary plans.
- `frontend/src/pages/BulkOrganizer.tsx`
  - Primary realtime updates no longer erase existing invoices, pallets, or assignments when the incoming row has empty arrays.
  - DELETE events trigger a fresh canonical reload.

## Data check
The connected Tertiary database contains a populated plan for `2026-09-24` with 2 invoices, 6 vehicles, and 3 buildings. One stored invoice currently has `pallets: 1111`; this is an anomalous data value worth reviewing separately, but it is not part of this compatibility fix.

No database rows or migrations were changed by this patch.
