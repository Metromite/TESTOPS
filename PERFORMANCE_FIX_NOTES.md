DispatchOPS Performance + Hidden Console Fix

Changes in this package:
1. Windows release builds use the GUI subsystem so the black terminal/console window is hidden while DispatchOPS runs normally.
2. Dashboard analytics now share in-flight and short-lived cached data across tabs, preventing six tabs from repeatedly downloading the same SAP rows.
3. SAP and V-Zone/landmark pagination is performed independently per Supabase project so Primary + Secondary data are both fully retrieved without cross-project offset problems.
4. Driver Performance V-Zone data is now filtered by the selected Dispatch Date range. Previously it loaded all historical landmark rows regardless of the dashboard date filter, which was the main cause of statement timeouts.
5. Driver filters are applied to V-Zone data through matched SAP vehicle keys where available.
6. Route Type is now applied to analytics tabs through the Areas database mapping.
7. Lead Time Band and Classification are included in the shared dashboard query dependency list so changing them refreshes the relevant dashboard data correctly.
8. When a filter changes, stale cached data is not displayed as the new filter result; an exact cached result is shown immediately when available.
9. Dashboard tabs are warmed in the background for the active date/filter state so switching to another tab is normally immediate.
10. Added database indexes for Dispatch Date + common SAP filters and V-Zone visit date/vehicle lookups in both Supabase projects.

Important: a first-ever filter/date combination still requires the initial cloud query; after that the shared cache makes repeated tab switches and the same filter state immediate. The fix removes the unnecessary full-history V-Zone query and duplicate concurrent SAP downloads, which were causing the timeout behavior.

### Timeout elimination pass
- Removed automatic all-tab background warm-up because it launched several heavy RPCs concurrently.
- Driver Performance now scopes Landmark reads by the filtered SAP vehicle set using `(vehicle_key, visit_date)`.
- Lead Time and Order Summary RPCs use targeted aggregation and a 55-second function-level safety timeout.
- Live primary and secondary databases were updated and 3-month tests completed successfully.

- Driver Performance charts are grouped by resolved Driver Name across all vehicles; Route Detail remains vehicle-level for audit/detail.
