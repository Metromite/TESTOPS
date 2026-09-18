# DispatchOPS v35.26 — V5 root-cause fixes

## Dashboard KPI cards
The KPI tiles were visually clickable through `GlassCard`, but the redesigned glass/card layer introduced too many styling/stacking abstractions. V5 uses a native `<button>` for every KPI that has a detail action. The detail window is rendered with `createPortal(..., document.body)` and a very high fixed stacking level, independent of Radix/glass page stacking contexts.

The click now always opens the detail shell first; the data request runs after the shell is mounted. Valid Invoices uses the same `valid_invoices` detail metric and the same invoice detail row builder as the original implementation.

## Today's Schedule / Alerts
The schedule panel remains one glass surface. Alert entries are plain rows with separators and no nested glass/background/shadow treatment. The KPI footer is also flat.

## Monthly default vehicles
The previous save path had two independent bugs:
1. The fleet picker changed `plan.vehicles`, but the "Save selected as monthly defaults" action persisted the stale `defaults.vehicles` state instead of the currently selected daily vehicles.
2. After saving, it assigned `result.vehicles` back into `plan.vehicles`, replacing the current daily fleet with the stale/default result and making already-added vehicles disappear.

V5 saves a snapshot of the current day's `plan.vehicles` into the monthly defaults table and deliberately leaves the current day's vehicle selection untouched. Monthly defaults are saved explicitly rather than through an autosave effect, so hydration/transient picker state cannot overwrite them.
