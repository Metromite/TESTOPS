# DispatchOPS V13.6.46 — Dashboard Initial Load Fix

Targeted fix based directly on V13.6.45.

## Changes only
1. Initial Dashboard load resolves the latest imported SAP month before starting the local analytical dataset render when no cached range exists. This prevents first-open rendering against an empty current calendar month that can show all KPI values as zero.
2. Loading progress is monotonic during one dataset load, so concurrent Primary/Secondary page callbacks cannot move the displayed percentage backward (for example 55 → 50 → 55).
3. Progress can still reset to 3% for a new load and 0% on an error.

## Preserved
- Valid Invoice rule: Boxes > 0 OR Freezer Boxes > 0.
- Primary → Secondary fallback.
- Persistent IndexedDB dataset.
- Local slicer filtering and V13.6.45 performance optimization.
- Driver / Pickup / Van behavior.
- KPI detail infinite scroll.
- All existing Dashboard tabs and other application pages.

No other feature logic was intentionally changed.
