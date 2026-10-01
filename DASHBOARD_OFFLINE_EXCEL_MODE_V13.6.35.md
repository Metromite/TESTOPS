# DispatchOPS V13.6.35 — Dashboard Excel/Offline Mode

- Dashboard preloads the latest SAP month immediately after authentication.
- Raw dashboard rows with boxes <= 0 are excluded at preload time.
- Dataset is persisted in IndexedDB for instant reopen after refresh/navigation.
- Driver, vehicle, area, division, facility and salesman filters operate on the browser-resident dataset.
- Dynamic driver slicer no longer calls `dispatchops_dashboard_driver_options_dynamic` when the local dataset exists.
- Dashboard KPI/detail calculations use the local dataset when available.
- Network RPC remains only as a fallback for a missing/unsupported cached dataset.
- Fleet driver names and Fleet vehicle type remain authoritative.
- Vehicle types are normalized to exactly Van / Pickup for dashboard use.
- No Bulk Organizer changes.
