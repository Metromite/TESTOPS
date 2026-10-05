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
  const selectedDriverKeys = selectedDriverKey.split(",").map((x) => x.trim()).filter(Boolean);
  const localDriverIsEmpty = endpoint.includes("driver-performance") && !!selectedDriverKey && !!data && Number((data as any)?.kpis?.gps_vehicles || 0) === 0 && Array.isArray((data as any)?.route_cards) && (data as any).route_cards.length === 0;

  useEffect(() => {
    if (!endpoint.includes("driver-performance") || !selectedDriverKey) {
      setDriverFallback(null);
      return;
    }

    const seq = ++driverFallbackSeq.current;
    const localCards = Array.isArray((data as any)?.route_cards) ? (data as any).route_cards : [];

    // Multi-select must never be sent as one fallback request and then used
    // as a replacement for the local result. Some existing Driver Performance
    // paths resolve a combined `drivers=A,B,C` request as one driver's view.
    // That is exactly how adding one driver could make the previously selected
    // drivers disappear. Fetch only the individual drivers that are missing
    // from the current local card set, then UNION those cards with the local
    // result. Existing local cards are never replaced.
    const normalize = (value: unknown) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    const similar = (a: string, b: string) => {
      const left = normalize(a);
      const right = normalize(b);
      if (!left || !right) return false;
      if (left === right) return true;
      const compactLeft = left.replace(/[^a-z0-9]/g, "");
      const compactRight = right.replace(/[^a-z0-9]/g, "");
      return !!compactLeft && !!compactRight && (compactLeft.startsWith(compactRight) || compactRight.startsWith(compactLeft));
    };

    const missingDrivers = selectedDriverKeys.filter((wanted) => {
      if (!localCards.length) return true;
      return !localCards.some((card: any) => similar(String(card?.display_driver || card?.driver_name || ""), wanted));
    });

    // Preserve the existing single-driver fallback behavior. For multi-select,
    // only request the missing drivers individually. This keeps the fast local
    // path intact and makes the fallback additive rather than destructive.
    if (!localDriverIsEmpty && selectedDriverKeys.length === 1 && missingDrivers.length === 0) {
      setDriverFallback(null);
      return;
    }
    if (!localDriverIsEmpty && selectedDriverKeys.length === 1 && missingDrivers.length === 1) {
      // handled below as one additive card set; do not use the old whole-result replacement.
    }
    if (!missingDrivers.length) {
      setDriverFallback(null);
      return;
    }

    const loadOne = async (wanted: string) => {
      const params = new URLSearchParams();
      params.set("start_date", gf.start_date || "");
      params.set("end_date", gf.end_date || "");
      params.set("drivers", wanted);
      params.set("areas", gf.areas || "");
      params.set("division", gf.division || "");
      params.set("route_type", gf.route_type || "");
      params.set("vehicle_type", gf.vehicle_type || "");
      params.set("facility_type", gf.facility_type || "");
      params.set("salesman", gf.salesman || "");
      try {
        const { fetchDashboardEndpoint } = await import("../services/dashboardAnalytics");
        return await fetchDashboardEndpoint<T>(`/dashboard/driver-performance?${params.toString()}`);
      } catch {
        return null;
      }
    };

    void Promise.all(missingDrivers.map(loadOne)).then((remotes) => {
      if (seq !== driverFallbackSeq.current) return;
      const valid = remotes.filter((remote) => !!remote && (Number((remote as any)?.kpis?.gps_vehicles || 0) > 0 || (Array.isArray((remote as any)?.route_cards) && (remote as any).route_cards.length > 0)));
      if (!valid.length) {
        setDriverFallback(null);
        return;
      }

      const base: any = data ? { ...(data as any) } : {
        standalone_mode: false,
        validation_results: [],
        kpis: { gps_vehicles: 0, total_gps_stops: 0, avg_stops_per_vehicle: 0, avg_route_duration_hrs: null, avg_stop_duration: "", sap_orders: 0, sap_total_boxes: 0 },
        chart_stops: { labels: [], values: [] },
        chart_route_hours: { labels: [], values: [] },
        route_cards: [],
      };

      const mergedCards = [...(Array.isArray(base.route_cards) ? base.route_cards : [])];
      const cardKey = (card: any) => `${normalize(card?.vehicle_key || card?.vehicle_num)}::${String(card?.route_start || card?.route_end || "").slice(0, 10)}::${normalize(card?.display_driver || card?.driver_name)}`;
      const seen = new Set(mergedCards.map(cardKey));
      for (const remote of valid) {
        for (const card of ((remote as any).route_cards || [])) {
          const key = cardKey(card);
          if (!seen.has(key)) {
            seen.add(key);
            mergedCards.push(card);
          }
        }
      }

      const stops = mergedCards.reduce((sum, card) => sum + Number(card?.stops || 0), 0);
      const gpsVehicles = new Set(mergedCards.map((card) => normalize(card?.vehicle_key || card?.vehicle_num)).filter(Boolean)).size;
      const hours = mergedCards.map((card) => {
        const m = String(card?.route_duration_hm || "").match(/(\d+)h\s+(\d+)m/);
        return m ? Number(m[1]) + Number(m[2]) / 60 : 0;
      }).filter((value) => value > 0);
      const byDriver = new Map<string, { stops: number; hours: number }>();
      for (const card of mergedCards) {
        const name = String(card?.display_driver || card?.driver_name || "Unknown").trim() || "Unknown";
        const item = byDriver.get(name) || { stops: 0, hours: 0 };
        item.stops += Number(card?.stops || 0);
        const m = String(card?.route_duration_hm || "").match(/(\d+)h\s+(\d+)m/);
        if (m) item.hours += Number(m[1]) + Number(m[2]) / 60;
        byDriver.set(name, item);
      }
      const chartRows = [...byDriver.entries()].map(([name, value]) => ({ driver: name, stops: value.stops, hours: Math.round(value.hours * 100) / 100 })).sort((a, b) => b.stops - a.stops);

      base.route_cards = mergedCards;
      base.kpis = { ...(base.kpis || {}), gps_vehicles: gpsVehicles, total_gps_stops: stops, avg_stops_per_vehicle: gpsVehicles ? Math.round((stops / gpsVehicles) * 100) / 100 : 0, avg_route_duration_hrs: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 100) / 100 : null };
      base.chart_stops = { labels: chartRows.map((row) => row.driver), values: chartRows.map((row) => row.stops) };
      base.chart_route_hours = { labels: chartRows.map((row) => row.driver), values: chartRows.map((row) => row.hours) };
      setDriverFallback(base as T);
    });

    return () => {
      if (seq === driverFallbackSeq.current) driverFallbackSeq.current += 1;
    };
  }, [endpoint, selectedDriverKey, localDriverIsEmpty, gf.start_date, gf.end_date, gf.areas, gf.division, gf.route_type, gf.vehicle_type, gf.facility_type, gf.salesman, data]);

  return { data: (driverFallback || data), error: "" };
}
