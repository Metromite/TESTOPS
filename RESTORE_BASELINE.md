# DispatchOPS — Restored Known-Good Dashboard Baseline

This package is based on `DispatchOPS-V13-FULL-DASHBOARD-TWO-FIXES-SUPABASE-ALIGNED`.

Only the following are intended in this restore:
- Keep Facility Distribution hiding zero-data facilities/divisions.
- Keep the known-good Dashboard loading pipeline: Primary + Secondary + Driver Performance + Fleet start together.
- Restore Driver Performance to the pre-0075 vehicle-level grouping behavior.
- Remove the later 0075 split-by-vehicle/day/driver migration so it cannot be reapplied accidentally.
- No other application pages, UI, database tables, schema, or functionality are changed.
