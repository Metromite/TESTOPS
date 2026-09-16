/**
 * Dashboard Global Filters (V2 milestone) - single shared type + helper,
 * used by every dashboard tab (HomeTab, LeadTimeTab, OrderSummaryTab,
 * AreaAnalyticsTab, NotSuppliedTab, DriverPerformanceTab) so the slicers
 * defined once in Dashboard.tsx are synchronized across every page,
 * without each tab file redefining its own copy of this shape.
 */
export interface GlobalFilters {
  drivers: string; areas: string; division: string; route_type: string; vehicle_type: string;
  facility_type: string; salesman: string; start_date: string; end_date: string;
  // FINAL CORRECTION PASS ("single source of truth" for filters, item 12):
  // Lead Time Band / Classification used to live as LeadTimeTab-local
  // `useState`, invisible to every other consumer of GlobalFilters -
  // including the Excel export, which is why "Lead Time Band = 1 Day"
  // selected on the dashboard never made it into the downloaded report.
  // Promoted here so Dashboard.tsx owns them like every other slicer, and
  // dashboardFilterParams() (below) picks them up automatically for BOTH
  // the Lead Time tab's own fetch AND the Export button - no separate
  // "LeadTimeFilters" object, per your explicit instruction not to
  // introduce one. Every other tab's endpoint simply ignores these two
  // extra params (same as it already ignores an empty string in any
  // other GlobalFilters field - harmless no-op server-side).
  lead_time_band: string; classification: string;
}

export const EMPTY_GLOBAL_FILTERS: GlobalFilters = {
  drivers: "", areas: "", division: "", route_type: "", vehicle_type: "",
  facility_type: "", salesman: "", start_date: "", end_date: "",
  lead_time_band: "", classification: "",
};

/** Builds the query-string params for a dashboard tab request: the
 * tab's own single `driver` drill-down (if any) plus every Global Filter
 * slicer. Empty values are included (harmless no-ops server-side) so the
 * resulting URLSearchParams shape - and therefore the useEffect dependency
 * array built from it - stays consistent across every tab. */
export function dashboardFilterParams(driver: string, gf: GlobalFilters): Record<string, string> {
  return { driver, ...gf };
}
