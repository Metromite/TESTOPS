import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { EMPTY_GLOBAL_FILTERS, type GlobalFilters } from "../types/dashboardFilters";
import {
  buildLocalForEndpoint,
  buildLocalDriverPerformance,
  filterDashboardRows,
  getLocalFilterOptions,
  getDashboardLocalDataset,
  preloadDashboardLocalDataset,
  subscribeDashboardLocal,
} from "../services/dashboardLocalStore";


function readDriverPerformanceCache<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - Number(parsed.savedAt || 0) > 7 * 24 * 60 * 60 * 1000) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed.value as T;
  } catch { return null; }
}

function isFreshDriverPerformanceCache(key: string): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return !!parsed?.value && Date.now() - Number(parsed.savedAt || 0) < 30 * 60 * 1000;
  } catch { return false; }
}

function writeDriverPerformanceCache<T>(key: string, value: T) {
  try { window.localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value })); } catch { /* storage may be unavailable or full */ }
}

export function useDashboardLocalData<T>(endpoint: string, globalFilters?: GlobalFilters, driver = "", driverSlicerValues: string[] = []): { data: T | null; error: string } {
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

    // Preserve the known-good unfiltered Driver Performance reconstruction
    // exactly. The resilient path below is used only when a real slicer value
    // is selected, so an empty/default filter state cannot turn the page to 0.
    const hasSelectedValue = (value: unknown) =>
      String(value || "").split(",").map((item) => item.trim().toLowerCase())
        .some((item) => item && item !== "all" && item !== "(all)" && item !== "select all");
    const hasDriverPerformanceFilter = endpoint.includes("driver-performance") &&
      [gf.drivers, gf.areas, gf.division, gf.route_type, gf.vehicle_type, gf.facility_type, gf.salesman]
        .some(hasSelectedValue);

    if (hasDriverPerformanceFilter) {
      // Keep the established local dataset and date filtering, but apply the
      // Driver Performance slicers with normalized comparisons. Other tabs
      // continue using their original shared filter implementation.
      const baseRows = filterDashboardRows(dataset, {
        ...gf, drivers: "", areas: "", division: "", route_type: "",
        vehicle_type: "", facility_type: "", salesman: "",
      });
      const selected = [...new Set([...String(gf.drivers || "").split(","), ...driverSlicerValues].map((value) => value.trim()).filter(Boolean))];
      const normalize = (value: unknown) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      const compact = (value: unknown) => normalize(value).replace(/\s+/g, "");
      const selectedValues = (value: unknown) => String(value || "").split(",").map((item) => normalize(item)).filter((item) => item && item !== "all" && item !== "(all)" && item !== "select all");
      const matchesValue = (candidate: unknown, wantedValues: string[]) => {
        if (!wantedValues.length) return true;
        const candidateNorm = normalize(candidate);
        const candidateCompact = compact(candidate);
        return wantedValues.some((wanted) => candidateNorm === wanted || (!!candidateCompact && candidateCompact === wanted.replace(/\s+/g, "")));
      };
      const matchesDriver = (candidate: string, wanted: string) => {
        const a = normalize(candidate), b = normalize(wanted);
        if (!a || !b) return false;
        if (a === b) return true;
        const ca = compact(a), cb = compact(b);
        if (Math.min(ca.length, cb.length) >= 5 && (ca.startsWith(cb) || cb.startsWith(ca))) return true;
        const at = new Set(a.split(" ").filter((part) => part.length > 1));
        const bt = b.split(" ").filter((part) => part.length > 1);
        return bt.length > 0 && bt.filter((part) => at.has(part)).length / bt.length >= 0.8;
      };
      const areaValues = selectedValues(gf.areas);
      const divisionValues = selectedValues(gf.division);
      const vehicleValues = selectedValues(gf.vehicle_type);
      const facilityValues = selectedValues(gf.facility_type);
      const salesmanValues = selectedValues(gf.salesman);
      const routeValues = selectedValues(gf.route_type);
      const dimensionRows = baseRows.filter((row) =>
        matchesValue(row.area, areaValues) &&
        matchesValue(row.division_desc, divisionValues) &&
        matchesValue(row.vehicle_type, vehicleValues) &&
        matchesValue(row.facility_type, facilityValues) &&
        matchesValue(row.salesman, salesmanValues) &&
        matchesValue((row as any).route_type, routeValues)
      );
      const driverRows = selected.length
        ? dimensionRows.filter((row) => selected.some((wanted) => matchesDriver(row.driver_name, wanted)))
        : dimensionRows;
      const resolvedDrivers = [...new Set(driverRows.map((row) => row.driver_name).filter(Boolean))];
      const performanceFilters = { ...gf, drivers: selected.length ? resolvedDrivers.join(",") : "" };
      return buildLocalDriverPerformance(driverRows, dataset.routeCards, performanceFilters, dataset.rows) as T;
    }

    // This is the exact pre-filter-fix path that previously displayed the full
    // Driver Performance data correctly when no slicer was selected.
    return buildLocalForEndpoint(endpoint, dataset, gf) as T;
  }, [dataset, endpoint, driver, driverSlicerValues, gf.drivers, gf.areas, gf.division, gf.route_type, gf.vehicle_type, gf.facility_type, gf.salesman, gf.start_date, gf.end_date, gf.lead_time_band, gf.classification]);

  // Driver Performance only: if the local reconstruction returns zero for an
  // explicitly selected driver, ask the existing proven Driver Performance
  // RPC for that driver. This is deliberately NOT used for the unfiltered
  // dashboard and NOT used by any other tab, so normal local/offline behavior
  // remains unchanged. The request is guarded by a key so stale responses can
  // never replace a newer driver selection.
  const selectedDriverKey = String(gf.drivers || driver || "").trim();
  const driverPerformanceCacheKey = useMemo(() => {
    if (!endpoint.includes("driver-performance")) return "";
    const cacheFilters = {
      endpoint, driver: selectedDriverKey,
      start: gf.start_date || "", end: gf.end_date || "",
      drivers: gf.drivers || "", areas: gf.areas || "", division: gf.division || "",
      route_type: gf.route_type || "", vehicle_type: gf.vehicle_type || "",
      facility_type: gf.facility_type || "", salesman: gf.salesman || "",
      lead_time_band: gf.lead_time_band || "", classification: gf.classification || "",
    };
    return `dispatchops:driver-performance:v1:${encodeURIComponent(JSON.stringify(cacheFilters))}`;
  }, [endpoint, selectedDriverKey, gf.start_date, gf.end_date, gf.drivers, gf.areas, gf.division, gf.route_type, gf.vehicle_type, gf.facility_type, gf.salesman, gf.lead_time_band, gf.classification]);
  const [driverFallback, setDriverFallback] = useState<T | null>(() => driverPerformanceCacheKey ? readDriverPerformanceCache<T>(driverPerformanceCacheKey) : null);
  const driverFallbackSeq = useRef(0);
  const updateDriverFallback = (value: T | null) => {
    setDriverFallback(value);
    if (value && driverPerformanceCacheKey) writeDriverPerformanceCache(driverPerformanceCacheKey, value);
  };
  useEffect(() => {
    if (driverPerformanceCacheKey) setDriverFallback(readDriverPerformanceCache<T>(driverPerformanceCacheKey));
    else setDriverFallback(null);
  }, [driverPerformanceCacheKey]);
  const selectedDriverKeys = selectedDriverKey.split(",").map((x) => x.trim()).filter(Boolean);
  const localDriverIsEmpty = endpoint.includes("driver-performance") && !!selectedDriverKey && !!data && Number((data as any)?.kpis?.gps_vehicles || 0) === 0 && Array.isArray((data as any)?.route_cards) && (data as any).route_cards.length === 0;

  useEffect(() => {
    if (!endpoint.includes("driver-performance")) {
      updateDriverFallback(null);
      return;
    }

    const seq = ++driverFallbackSeq.current;

    // The two Driver Performance charts are intentionally allowed to hydrate
    // their missing driver labels from the full endpoint result. This is chart
    // data only: KPI values, route cards, the slicer, and the rest of the page
    // remain on the existing local path. Some local snapshots contain only 25
    // chart drivers while the same drivers are available individually through
    // the endpoint.
    if (!selectedDriverKey) {
      if (!data || !dataset || dataset.key !== "ALL") {
        // Keep the matching hydrated snapshot while the shared local dataset
        // is momentarily unavailable or being refreshed.
        return;
      }

      // IMPORTANT: the two charts need the complete driver roster by default.
      // The unfiltered Driver Performance endpoint can intentionally return a
      // limited chart list, while the Driver slicer already knows the complete
      // roster. Hydrate only the missing chart labels one-by-one, and merge
      // them into the chart arrays. Nothing else in Driver Performance is
      // changed: slicer state, KPI values, route cards, and Route Detail remain
      // exactly on the existing local path.
      const localStops = Array.isArray((data as any)?.chart_stops?.labels)
        ? (data as any).chart_stops
        : { labels: [], values: [] };
      const localHours = Array.isArray((data as any)?.chart_route_hours?.labels)
        ? (data as any).chart_route_hours
        : { labels: [], values: [] };
      const normalize = (value: unknown) =>
        String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

      const roster = getLocalFilterOptions(dataset, gf).drivers || [];
      const present = new Set(
        [...(localStops.labels || []), ...(localHours.labels || [])]
          .map((label: unknown) => normalize(label))
          .filter(Boolean)
      );
      const missingDrivers = roster.filter((driverName) => !present.has(normalize(driverName)));

      if (!missingDrivers.length) {
        // Keep any matching cached/hydrated result. The local snapshot may be
        // intentionally smaller than the previously hydrated full result.
        return;
      }
      // A recent browser snapshot already contains the hydrated Driver Performance
      // result. Reuse it instead of repeating the same federated requests whenever
      // the user leaves and reopens this tab.
      if (driverPerformanceCacheKey && isFreshDriverPerformanceCache(driverPerformanceCacheKey)) return;

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

        const remoteStops: { labels: string[]; values: number[] } = { labels: [], values: [] };
        const remoteHours: { labels: string[]; values: number[] } = { labels: [], values: [] };
        const remoteCards: any[] = [];
        for (const remote of remotes) {
          if (!remote) continue;
          const stops = (remote as any)?.chart_stops;
          const hours = (remote as any)?.chart_route_hours;
          if (Array.isArray(stops?.labels)) {
            remoteStops.labels.push(...stops.labels);
            remoteStops.values.push(...(Array.isArray(stops.values) ? stops.values : []));
          }
          if (Array.isArray(hours?.labels)) {
            remoteHours.labels.push(...hours.labels);
            remoteHours.values.push(...(Array.isArray(hours.values) ? hours.values : []));
          }
          if (Array.isArray((remote as any)?.route_cards)) remoteCards.push(...(remote as any).route_cards);
        }

        const mergeChart = (local: any, remoteChart: any) => {
          const labels = [...(local.labels || [])];
          const values = [...(local.values || [])];
          const seen = new Set(labels.map((label: unknown) => normalize(label)).filter(Boolean));
          for (let i = 0; i < (remoteChart.labels || []).length; i++) {
            const label = remoteChart.labels[i];
            const key = normalize(label);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            labels.push(label);
            values.push(remoteChart.values?.[i] ?? 0);
          }
          return { labels, values };
        };

        // The previous fallback enriched chart labels only, leaving KPI tiles
        // and Route Detail empty even when the same remote driver RPC returned
        // real route cards. Merge those cards into the canonical result so all
        // four KPI tiles, both charts and the detail table describe one dataset.
        const localCards = Array.isArray((data as any)?.route_cards) ? (data as any).route_cards : [];
        const routeKey = (card: any) => `${normalize(card?.vehicle_key || card?.vehicle_num)}::${String(card?.route_start || card?.route_end || "").slice(0, 10)}::${normalize(card?.display_driver || card?.driver_name)}`;
        const mergedCards = [...localCards];
        const seenCards = new Set(localCards.map(routeKey));
        for (const card of remoteCards) {
          const key = routeKey(card);
          if (key.replace(/:/g, "") && !seenCards.has(key)) {
            seenCards.add(key);
            mergedCards.push(card);
          }
        }

        if (mergedCards.length > localCards.length) {
          const stopsTotal = mergedCards.reduce((sum, card) => sum + Number(card?.stops || 0), 0);
          const gpsVehicles = new Set(mergedCards.map((card) => normalize(card?.vehicle_key || card?.vehicle_num)).filter(Boolean)).size;
          const routeHours = mergedCards.map((card) => {
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
          const chartRows = [...byDriver.entries()].map(([name, value]) => ({ name, ...value })).sort((x, y) => y.stops - x.stops);
          updateDriverFallback({
            ...(data as any),
            route_cards: mergedCards,
            kpis: {
              ...(data as any).kpis,
              gps_vehicles: gpsVehicles,
              total_gps_stops: stopsTotal,
              avg_stops_per_vehicle: gpsVehicles ? Math.round(stopsTotal / gpsVehicles * 100) / 100 : 0,
              avg_route_duration_hrs: routeHours.length ? Math.round(routeHours.reduce((sum, value) => sum + value, 0) / routeHours.length * 100) / 100 : null,
            },
            chart_stops: { labels: chartRows.map((row) => row.name), values: chartRows.map((row) => row.stops) },
            chart_route_hours: { labels: chartRows.map((row) => row.name), values: chartRows.map((row) => row.hours) },
          } as T);
          return;
        }

        const mergedStops = mergeChart(localStops, remoteStops);
        const mergedHours = mergeChart(localHours, remoteHours);
        if (mergedStops.labels.length <= localStops.labels.length && mergedHours.labels.length <= localHours.labels.length) {
          // No new remote rows is not a reason to erase a valid cached result.
          return;
        }
        updateDriverFallback({ ...(data as any), chart_stops: mergedStops, chart_route_hours: mergedHours } as T);
      });
      return () => {
        if (seq === driverFallbackSeq.current) driverFallbackSeq.current += 1;
      };
    }

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
      // Preserve the matching cached/hydrated result; local cards can be a
      // partial reconstruction even when the selected driver appears locally.
      return;
    }
    if (!localDriverIsEmpty && selectedDriverKeys.length === 1 && missingDrivers.length === 1) {
      // handled below as one additive card set; do not use the old whole-result replacement.
    }
    if (!missingDrivers.length) {
      // Do not replace a complete cached result with a smaller local result.
      return;
    }
    if (driverPerformanceCacheKey && isFreshDriverPerformanceCache(driverPerformanceCacheKey)) return;

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
        // An empty fallback response must never erase already valid cached data.
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
      updateDriverFallback(base as T);
    });

    return () => {
      if (seq === driverFallbackSeq.current) driverFallbackSeq.current += 1;
    };
  }, [endpoint, selectedDriverKey, localDriverIsEmpty, gf.start_date, gf.end_date, gf.areas, gf.division, gf.route_type, gf.vehicle_type, gf.facility_type, gf.salesman, data, driverPerformanceCacheKey]);

  return { data: (driverFallback || data), error: "" };
}
