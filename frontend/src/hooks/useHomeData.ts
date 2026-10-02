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
import { computeHomeKpisFast, type FilterParams } from "../services/dashboardKpis";
import { GlobalFilters, EMPTY_GLOBAL_FILTERS } from "../types/dashboardFilters";
import { DetailColumn } from "../components/DetailWindow";
import { subscribeDashboardRefresh } from "./dashboardRefreshBus";
import { useDashboardLocalData } from "./useDashboardLocalData";
import { filterDashboardRows, getDashboardLocalDataset, type LocalSapRow } from "../services/dashboardLocalStore";
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
interface HomeDetailResponse { rows: Record<string, any>[]; truncated: boolean; total_matching: number; }

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
  const local = useDashboardLocalData<HomeDashboard>("/dashboard/home", gf, driver);
  const data = local.data;
  const error = local.error;
  const [detailMetric, setDetailMetric] = useState<string | null>(null);
  const [detailTitle, setDetailTitle] = useState("");
  const [detailRows, setDetailRows] = useState<Record<string, any>[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTruncated, setDetailTruncated] = useState(false);
  const [detailTotal, setDetailTotal] = useState(0);
  const [detailOffset, setDetailOffset] = useState(0);
  const [detailSearch, setDetailSearch] = useState("");
  const [detailLoadingMore, setDetailLoadingMore] = useState(false);

  useEffect(() => {
    if (!driver && data && onDriverListLoaded) onDriverListLoaded(data.driver_overview.map((r: DriverRow) => r.driver_name));
  }, [driver, data, onDriverListLoaded]);

  function buildLocalDetail(metric: string, driverOverride?: string, offset = 0, search = ""): HomeDetailResponse {
    const dataset = getDashboardLocalDataset();
    if (!dataset) return { rows: [], truncated: false, total_matching: 0 };
    const overrideFilters = driverOverride ? { ...gf, drivers: driverOverride } : gf;
    const baseRows = filterDashboardRows(dataset, overrideFilters);
    const q = search.trim().toLowerCase();
    const matchesSearch = (r: Record<string, any>) => !q || Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q));
    let all: Record<string, any>[] = [];

    if (["valid_invoices", "total_boxes", "freezer_boxes", "normal_boxes", "not_supplied"].includes(metric)) {
      const validInvoiceRows = baseRows.filter((r: LocalSapRow) => Number(r.boxes || 0) > 0 || Number(r.freezer_boxes || 0) > 0);
      all = (metric === "valid_invoices" ? validInvoiceRows : baseRows).map((r: LocalSapRow) => ({ ...r }));
    } else if (["active_drivers", "unique_customers", "active_vehicles"].includes(metric)) {
      const field = metric === "active_drivers" ? "driver_name" : metric === "unique_customers" ? "customer_name" : "vehicle_num";
      const map = new Map<string, { name: string; invoices: number; boxes: number; not_supplied: number }>();
      for (const r of baseRows) {
        const name = String((r as any)[field] || "Unknown").trim() || "Unknown";
        const x = map.get(name) || { name, invoices: 0, boxes: 0, not_supplied: 0 };
        x.invoices += 1; x.boxes += Number(r.boxes || 0); if (r.not_supplied_reason) x.not_supplied += 1;
        map.set(name, x);
      }
      all = [...map.values()].sort((a, b) => b.boxes - a.boxes || a.name.localeCompare(b.name));
    } else {
      all = baseRows.map((r: LocalSapRow) => ({ ...r }));
    }

    const searched = all.filter(matchesSearch);
    const PAGE_SIZE = 100;
    const pageRows = searched.slice(offset, offset + PAGE_SIZE);
    return { rows: pageRows, truncated: searched.length > offset + pageRows.length, total_matching: searched.length };
  }

  async function loadDetailBatch(metric: string, title: string, driverOverride?: string, offset = 0, search = "", append = false) {
    if (append) setDetailLoadingMore(true); else setDetailLoading(true);
    try {
      // Detail data is already inside the persistent Dashboard analytical
      // dataset. Keep KPI popups local too, so single-month and multi-month
      // selections behave identically and opening a KPI never waits on RPCs.
      const res = buildLocalDetail(metric, driverOverride, offset, search);
      setDetailRows(prev => append ? [...prev, ...res.rows] : res.rows);
      setDetailOffset(offset + res.rows.length);
      setDetailTruncated(res.truncated);
      setDetailTotal(res.total_matching);
    } catch {
      if (!append) setDetailRows([]);
    } finally {
      if (append) setDetailLoadingMore(false); else setDetailLoading(false);
    }
  }

  async function openDetail(metric: string, title: string, driverOverride?: string) {
    setDetailMetric(metric); setDetailTitle(title); setDetailRows([]); setDetailTruncated(false); setDetailTotal(0); setDetailOffset(0); setDetailSearch("");
    await loadDetailBatch(metric, title, driverOverride, 0, "", false);
  }
  async function loadMoreDetail() {
    if (!detailMetric || detailLoading || detailLoadingMore || !detailTruncated) return;
    await loadDetailBatch(detailMetric, detailTitle, undefined, detailOffset, detailSearch, true);
  }
  async function searchDetail(search: string) {
    if (!detailMetric) return;
    setDetailSearch(search); setDetailRows([]); setDetailOffset(0);
    await loadDetailBatch(detailMetric, detailTitle, undefined, 0, search, false);
  }
  function closeDetail() { setDetailMetric(null); setDetailRows([]); setDetailOffset(0); }

  return { data, error, openDetail, closeDetail, detailMetric, detailTitle, detailRows, detailLoading, detailLoadingMore, detailTruncated, detailTotal, loadMoreDetail, searchDetail };
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

  const requestSeq = useRef(0);

  async function load() {
    const seq = ++requestSeq.current;
    try {
      const params: FilterParams = { driver, ...gf };
      const k: Kpis | null = await computeHomeKpisFast(params);
      if (!k) return;
      if (seq !== requestSeq.current) return;
      setKpis(k);
      setCached(cacheKey, k);
      setError("");
    } catch (e: any) {
      if (seq === requestSeq.current) setError(e.message);
    }
  }

  useEffect(() => {
    // Never leave the previous date/filter KPI values on screen while the new
    // selection is being calculated. Use an exact-key cache immediately when
    // available; otherwise show the tile skeleton for the brief RPC round-trip.
    setKpis(getCached<Kpis>(cacheKey) ?? null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => subscribeDashboardRefresh(() => loadRef.current()), []);

  return { kpis, error };
}
