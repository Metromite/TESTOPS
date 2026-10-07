# Bulk Organizer V36 — Expand / Fridge / Any Day

Baseline: DispatchOPS-FULL-BULK-ORGANIZER-V5-MINIMIZE-UI-BUILD-FIX.zip

Only `frontend/src/pages/BulkOrganizer.tsx` was changed.

Changes:
- Removed per-card duplicate Open Details / Expand Details controls; clicking the vehicle/store card toggles expansion.
- Vehicle/store expansion stays in the same grid position and uses Framer Motion layout + spring animation.
- Expanded content grows only as needed; it does not take over the full screen.
- Popup/modal interaction no longer collapses a store card behind the popup.
- Invoice number inputs accept digits only.
- Added informational Fridge boxes field; it is persisted/displayed but excluded from loading/capacity calculations.
- Added Any day to Add Multiple Invoices and persists `schedule_mode: "any_day"`.
- Minimized store/vehicle cards show Any day and fridge counts where space allows.
- Existing global section Expand/Minimize controls remain unchanged.

Validation:
- TypeScript/TSX transpile syntax check: passed.
- Full dependency build could not be run in this environment because the uploaded ZIP does not contain node_modules and dependency installation timed out.
