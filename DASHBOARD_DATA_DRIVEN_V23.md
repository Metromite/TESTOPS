# DispatchOPS Dashboard v23

## Data-driven dashboard rules
- Fleet `vehicles.type` is authoritative for vehicle type after normalized vehicle-number matching.
- Vehicle-type filtering and chart aggregation normalize case/spacing for matching, but display the current Fleet label.
- No hard-coded vehicle-type or route-type fallback lists remain in Dashboard.tsx.
- Charts aggregate categories case-insensitively so `VAN`, `Van`, and `van` cannot become separate bars.
- The same principle is applied to dashboard dimensions: current database values drive filters and charts; the UI does not maintain a fixed enum.
