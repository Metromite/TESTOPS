/**
 * hooks/useHomeData.ts
 * ----------------------
 * Extracted verbatim from the pre-round-12 HomeTab.tsx's own load()/
 * openDetail() functions and 30s-poll useEffect - not a rewrite. This is
 * what "no calculation changes" means in practice: every line of actual
 * fetch/param/validation logic here is the same line that used to live
 * directly inside HomeTab.tsx's component body.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { GlobalFilters, EMPTY_GLOBAL_FILTERS } from "../types/dashboardFilters";
import { DetailColumn } from "../components/DetailWindow";
import { subscribeDashboardRefresh } from "./dashboardRefreshBus";
import { getCached, setCached } from "./dashboardCache";

export interface Kpis {
  valid_invoices: number; total_boxes: number; freezer_boxes: number; normal_boxes: number;
  active_drivers: number; avg_boxes_per_driver: number; not_supplied: number;
  avg_lead_time_days: number | null; unique_customers: number; avg_route_hours: number | null;
  orders_per_driver: number; active_vehicles: number;
}
export interface DriverRow {
  driver_name: string; vehicle_num: string; vehicle_type: string;
  orders: number; boxes: number; freezer: number; not_supplied: number;
}
export interface Charts {
  driver_boxes: { labels: string[]; values: number[] };
  facility: { labels: string[]; values: number[] };
  vantype: { labels: string[]; normal: number[]; freezer: number[] };
  returns: { delivered: number; not_supplied: number };
}
export interface HomeDashboard { kpis: Kpis; driver_overview: DriverRow[]; charts: Charts; }

export const METRIC_COLUMNS: Record<string, DetailColumn[]> = {
  active_drivers: [{ key: "name", label: "Driver" }, { key: "invoices", label: "Invoices" }, { key: "boxes", label: "Boxes" }, { key: "not_supplied", label: "Not Supplied" }],
  unique_customers: [{ key: "name", label: "Customer" }, { key: "invoices", label: "Invoices" }, { key: "boxes", label: "Boxes" }, { key: "not_supplied", label: "Not Supplied" }],
  active_vehicles: [{ key: "name", label: "Vehicle" }, { key: "invoices", label: "Invoices" }, { key: "boxes", label: "Boxes" }, { key: "not_supplied", label: "Not Supplied" }],
};
export const DEFAULT_COLUMNS: DetailColumn[] = [
  { key: "invoice_no", label: "Invoice #" }, { key: "dispatch_date", label: "Dispatch Date" }, { key: "invoice_date", label: "Invoice Date" },
  { key: "driver_name", label: "Driver" }, { key: "helper_name", label: "Helper" }, { key: "vehicle_num", label: "Vehicle" },
  { key: "area", label: "Area" }, { key: "division_desc", label: "Division" }, { key: "customer_name", label: "Customer" },
  { key: "boxes", label: "Boxes" }, { key: "normal_boxes", label: "Normal" }, { key: "freezer_boxes", label: "Freezer" }, { key: "not_supplied_reason", label: "Not Supplied Reason" },
];

export function useHomeData(driver: string, globalFilters: GlobalFilters | undefined, onDriverListLoaded?: (names: string[]) => void) {
  const gf = globalFilters || EMPTY_GLOBAL_FILTERS;
  const cacheKey = `/dashboard/home?${new URLSearchParams({ driver, ...gf }).toString()}`;
  // See dashboardCache.ts - same "show last-known data instantly on
  // remount" fix as useDashboardQuery, applied here too since Overview
  // has its own bespoke hook rather than going through that one.
  const [data, setData] = useState<HomeDashboard | null>(() => getCached<HomeDashboard>(cacheKey) ?? null);
  const [error, setError] = useState("");
  const [detailMetric, setDetailMetric] = useState<string | null>(null);
  const [detailTitle, setDetailTitle] = useState("");
  const [detailRows, setDetailRows] = useState<Record<string, any>[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTruncated, setDetailTruncated] = useState(false);
  const [detailTotal, setDetailTotal] = useState(0);

  async function load() {
    try {
      const params = new URLSearchParams({ driver, ...gf });
      const d: HomeDashboard | null = await api.get(`/dashboard/home?${params.toString()}`);
      if (!d || !d.driver_overview) {
        setError("Dashboard data came back empty - the server may still be starting up, or there's no data imported yet. Try refreshing.");
        return;
      }
      setData(d);
      setCached(cacheKey, d);
      setError("");
      if (!driver && onDriverListLoaded) onDriverListLoaded(d.driver_overview.map((r) => r.driver_name));
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver, gf.drivers, gf.areas, gf.division, gf.route_type, gf.vehicle_type, gf.facility_type, gf.salesman, gf.start_date, gf.end_date]);

  // ITEM 1: same "Refresh Dashboard" bus subscription as useDashboardQuery -
  // see hooks/dashboardRefreshBus.ts. Overview already had its own 30s
  // auto-poll above; this only adds the on-demand button trigger.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => subscribeDashboardRefresh(() => loadRef.current()), []);

  async function openDetail(metric: string, title: string, driverOverride?: string) {
    setDetailMetric(metric); setDetailTitle(title); setDetailLoading(true); setDetailRows([]);
    try {
      const params = new URLSearchParams({ metric, driver: driverOverride ?? driver, ...gf });
      const res = await api.get(`/dashboard/home/detail?${params.toString()}`);
      setDetailRows(res.rows); setDetailTruncated(res.truncated); setDetailTotal(res.total_matching);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() { setDetailMetric(null); }

  return { data, error, openDetail, closeDetail, detailMetric, detailTitle, detailRows, detailLoading, detailTruncated, detailTotal };
}

/**
 * ITEM PASS 6 (Dashboard Part 1 - progressive loading, "PHASE 2 - FAST
 * DATA"): a second, independent hook hitting the new fast
 * `/dashboard/home/kpis` endpoint (see dashboard.py/dashboard_kpis.py -
 * skips the expensive full-LandmarkVisitFact fetch, computes only the
 * sap_rows-derived KPI numbers). HomeTab.tsx uses this ALONGSIDE
 * useHomeData() (not instead of it) so the KPI row can paint as soon as
 * this resolves, while the full useHomeData() call (driver-overview
 * table + 4 charts + the one route-hours KPI) continues in parallel and
 * fills in the rest, including the one field this fast path omits
 * (avg_route_hours), when it lands.
 *
 * Deliberately its own cache key/cache entry (`/dashboard/home/kpis?...`)
 * distinct from `/dashboard/home?...` - both go through the same
 * getCached/setCached localStorage-backed cache from dashboardCache.ts,
 * so a repeat visit shows even THIS fast KPI row instantly from local
 * cache rather than waiting on the network at all.
 */
export function useHomeKpisFast(driver: string, globalFilters: GlobalFilters | undefined) {
  const gf = globalFilters || EMPTY_GLOBAL_FILTERS;
  const cacheKey = `/dashboard/home/kpis?${new URLSearchParams({ driver, ...gf }).toString()}`;
  const [kpis, setKpis] = useState<Kpis | null>(() => getCached<Kpis>(cacheKey) ?? null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const params = new URLSearchParams({ driver, ...gf });
      const k: Kpis | null = await api.get(`/dashboard/home/kpis?${params.toString()}`);
      if (!k) return;
      setKpis(k);
      setCached(cacheKey, k);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver, gf.drivers, gf.areas, gf.division, gf.route_type, gf.vehicle_type, gf.facility_type, gf.salesman, gf.start_date, gf.end_date]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => subscribeDashboardRefresh(() => loadRef.current()), []);

  return { kpis, error };
}
