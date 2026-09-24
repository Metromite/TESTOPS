# DispatchOPS KPI / Bulk Organizer Fix V3

## KPI drill-down
- KPI tiles that have details are now real native `<button>` elements, so the click handler cannot be lost in the visual glass-card wrapper.
- Detail modal is rendered through a body portal with a dedicated z-index of 10000, independent of Radix/Framer stacking contexts.
- Clicking a KPI opens the modal shell immediately and then loads detail rows.
- Total Boxes now uses `total_boxes` detail semantics instead of the old `valid_invoices` metric mapping.

## Bulk Organizer defaults
- Monthly defaults now use the existing `bulk_organizer_month_defaults` table created by migration 0047.
- Defaults are loaded/saved by `month_key`.
- A daily plan with an empty vehicle list no longer erases/inhibits monthly default vehicles; it inherits the monthly defaults.
- Added migration 0049 as an idempotent safety migration for the monthly defaults table/RLS.

## Bulk Organizer visual hierarchy
- Today's Schedule / Alerts no longer have nested glass cards, shadows, or blur layers.
- Main Fleet and Customer surfaces remain the same material level as the rest of the page.
- Desktop allocation keeps the schedule rail and right content aligned without the old uneven card treatment.

## Build note
The source was checked after patching. A production build could not be run because this environment cannot complete `npm install`; `npm run build` therefore reports missing React dependencies rather than an application TypeScript error.
