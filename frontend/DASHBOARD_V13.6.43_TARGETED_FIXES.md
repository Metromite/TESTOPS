# DispatchOPS V13.6.43 — Dashboard-only targeted fixes

Baseline: V13.6.42 Dashboard Pickup + Scroll + Filter Fix.

Only two behavioral changes were made:

1. Dashboard initial-load overlay now shows a progressive 0–100% percentage indicator and matching UI-blue circular/bar progress while the first persistent analytical dataset is downloaded. Cached repeat opens still complete immediately.
2. Vehicle Type / Pickup slicer options are recalculated when Driver slicer selection changes. Clearing Driver selection therefore restores Pickup/Van options immediately from the existing in-memory dataset, without refresh or a new dashboard data download.

No other Dashboard filtering, IndexedDB caching, KPI detail pagination, Primary→Secondary fallback, or non-Dashboard pages were intentionally changed.

Validation note: full TypeScript build was not possible in this environment because the extracted app does not contain node_modules and external npm registry access is unavailable. `tsc` was invoked and stopped on missing installed dependencies (React/HeroUI/etc.), not on a reported syntax/type error from these changes.
