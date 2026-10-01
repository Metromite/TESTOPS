import { useEffect, useMemo, useSyncExternalStore } from "react";
import { EMPTY_GLOBAL_FILTERS, type GlobalFilters } from "../types/dashboardFilters";
import {
  buildLocalForEndpoint,
  getDashboardLocalDataset,
  preloadDashboardLocalDataset,
  subscribeDashboardLocal,
} from "../services/dashboardLocalStore";

export function useDashboardLocalData<T>(endpoint: string, globalFilters?: GlobalFilters, driver = ""): { data: T | null; error: string } {
  const baseFilters = globalFilters || EMPTY_GLOBAL_FILTERS;
  const gf = useMemo<GlobalFilters>(() => {
    if (!driver) return baseFilters;
    const current = String(baseFilters.drivers || "").split(",").map((x) => x.trim()).filter(Boolean);
    return { ...baseFilters, drivers: [...new Set([driver.trim(), ...current])].join(",") };
  }, [driver, baseFilters.drivers, baseFilters.areas, baseFilters.division, baseFilters.route_type, baseFilters.vehicle_type, baseFilters.facility_type, baseFilters.salesman, baseFilters.start_date, baseFilters.end_date, baseFilters.lead_time_band, baseFilters.classification]);
  const start = gf.start_date || "";
  const end = gf.end_date || "";
  const dataset = useSyncExternalStore(subscribeDashboardLocal, getDashboardLocalDataset, getDashboardLocalDataset);

  useEffect(() => {
    if (dataset?.key === "ALL") return;
    if (!start && !end) return;
    void preloadDashboardLocalDataset(start, end).catch(() => {});
  }, [dataset?.key, start, end]);

  const data = useMemo(() => {
    if (!dataset || dataset.key !== "ALL") return null;
    return buildLocalForEndpoint(endpoint, dataset, gf) as T;
  }, [dataset, endpoint, driver, gf.drivers, gf.areas, gf.division, gf.route_type, gf.vehicle_type, gf.facility_type, gf.salesman, gf.start_date, gf.end_date, gf.lead_time_band, gf.classification]);

  return { data, error: "" };
}
