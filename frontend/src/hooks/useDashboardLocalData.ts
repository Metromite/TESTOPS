import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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

  // Driver Performance only: if the local reconstruction returns zero for an
  // explicitly selected driver, ask the existing proven Driver Performance
  // RPC for that driver. This is deliberately NOT used for the unfiltered
  // dashboard and NOT used by any other tab, so normal local/offline behavior
  // remains unchanged. The request is guarded by a key so stale responses can
  // never replace a newer driver selection.
  const [driverFallback, setDriverFallback] = useState<T | null>(null);
  const driverFallbackSeq = useRef(0);
  const selectedDriverKey = String(gf.drivers || driver || "").trim();
  const localDriverIsEmpty = endpoint.includes("driver-performance") && !!selectedDriverKey && !!data && Number((data as any)?.kpis?.gps_vehicles || 0) === 0 && Array.isArray((data as any)?.route_cards) && (data as any).route_cards.length === 0;

  useEffect(() => {
    if (!endpoint.includes("driver-performance") || !selectedDriverKey || !localDriverIsEmpty) {
      setDriverFallback(null);
      return;
    }
    const seq = ++driverFallbackSeq.current;
    const params = new URLSearchParams();
    params.set("start_date", gf.start_date || "");
    params.set("end_date", gf.end_date || "");
    params.set("drivers", selectedDriverKey);
    params.set("areas", gf.areas || "");
    params.set("division", gf.division || "");
    params.set("route_type", gf.route_type || "");
    params.set("vehicle_type", gf.vehicle_type || "");
    params.set("facility_type", gf.facility_type || "");
    params.set("salesman", gf.salesman || "");
    void import("../services/dashboardAnalytics").then(({ fetchDashboardEndpoint }) => fetchDashboardEndpoint<T>(`/dashboard/driver-performance?${params.toString()}`))
      .then((remote) => {
        if (seq !== driverFallbackSeq.current) return;
        if (Number((remote as any)?.kpis?.gps_vehicles || 0) > 0 || Array.isArray((remote as any)?.route_cards) && (remote as any).route_cards.length > 0) {
          setDriverFallback(remote);
        }
      })
      .catch(() => {
        if (seq === driverFallbackSeq.current) setDriverFallback(null);
      });
    return () => {
      if (seq === driverFallbackSeq.current) driverFallbackSeq.current += 1;
    };
  }, [endpoint, selectedDriverKey, localDriverIsEmpty, gf.start_date, gf.end_date, gf.areas, gf.division, gf.route_type, gf.vehicle_type, gf.facility_type, gf.salesman]);

  return { data: (driverFallback || data), error: "" };
}
