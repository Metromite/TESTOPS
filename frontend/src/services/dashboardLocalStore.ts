/**
 * Dashboard local interaction engine.
 *
 * The dashboard's selected date range is loaded once into memory. Subsequent
 * slicer changes are pure JavaScript over that dataset - no Supabase round
 * trip, no per-tab RPC fan-out, and no loading state between filter clicks.
 *
 * SAP facts are federated across all configured projects and merged by invoice,
 * not by dispatch date. Landmark/GPS facts are paged for the selected period,
 * then joined locally by normalized vehicle aliases and daily driver ownership.
 */
import { getFederatedSupabaseClients, getPrimarySupabaseClient } from "../lib/supabase";
import { fetchDashboardEndpoint } from "./dashboardAnalytics";
import type { GlobalFilters } from "../types/dashboardFilters";
import type { HomeDashboard } from "../hooks/useHomeData";
import type { PerfData, RouteCard } from "../widgets/driverPerformanceWidgets";
import type { LeadTimeData } from "../widgets/leadTimeWidgets";
import type { OrderSummaryData } from "../widgets/orderSummaryWidgets";
import type { AreaData, AreaRow } from "../widgets/areaAnalyticsWidgets";
import type { NotSuppliedData, NsRow, ZeroRow } from "../widgets/notSuppliedWidgets";

export interface LocalSapRow {
  invoice_no: string;
  invoice_date: string | null;
  dispatch_date: string | null;
  driver_name: string;
  helper_name: string;
  customer_name: string;
  facility_type: string;
  area: string;
  division_desc: string;
  vehicle_type: string;
  vehicle_num: string;
  vehicle_key: string;
  boxes: number;
  normal_boxes: number;
  freezer_boxes: number;
  not_supplied_reason: string;
  salesman: string;
}

export interface DashboardLocalDataset {
  key: string;
  rows: LocalSapRow[];
  routeCards: RouteCard[];
  loadedAt: number;
  datasetVersion?: number;
}

export interface DashboardLocalFilterOptions {
  divisions: string[];
  facility_types: string[];
  salesmen: string[];
  areas: string[];
  drivers: string[];
  vehicle_types: string[];
}

type Listener = () => void;
const listeners = new Set<Listener>();
const progressListeners = new Set<(pct: number) => void>();
let current: DashboardLocalDataset | null = null;
let baseRouteCards: RouteCard[] = [];
let loading: Promise<DashboardLocalDataset> | null = null;
let loadingProgress = 0;
let lastLiveDatasetRefreshAt = 0;
const LOCAL_DB_NAME = "dispatchops-dashboard-local-v3";
const LOCAL_DB_STORE = "dataset";
const LOCAL_DB_KEY = "all-history";
const LOCAL_DATASET_VERSION = 5;

function openLocalDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(LOCAL_DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(LOCAL_DB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function readPersistentDataset(): Promise<DashboardLocalDataset | null> {
  const db = await openLocalDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(LOCAL_DB_STORE, "readonly");
      const req = tx.objectStore(LOCAL_DB_STORE).get(LOCAL_DB_KEY);
      req.onsuccess = () => {
        const value = req.result as DashboardLocalDataset | undefined;
        db.close();
        if (!value || !Array.isArray(value.rows) || Number(value.datasetVersion || 0) < LOCAL_DATASET_VERSION) return resolve(null);
        resolve(value);
      };
      req.onerror = () => { db.close(); resolve(null); };
    } catch { db.close(); resolve(null); }
  });
}

async function writePersistentDataset(value: DashboardLocalDataset): Promise<void> {
  const db = await openLocalDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(LOCAL_DB_STORE, "readwrite");
      tx.objectStore(LOCAL_DB_STORE).put(value, LOCAL_DB_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = tx.onabort = () => { db.close(); resolve(); };
    } catch { db.close(); resolve(); }
  });
}

/** Invalidate the persisted all-history snapshot after a successful source import. */
export async function invalidateDashboardLocalDataset(): Promise<void> {
  current = null;
  lastLiveDatasetRefreshAt = 0;
  baseRouteCards = [];
  completedVehicleHydrationKeys.clear();
  vehicleHydrationPromises.clear();
  const db = await openLocalDb();
  if (!db) { emit(); return; }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(LOCAL_DB_STORE, "readwrite");
      tx.objectStore(LOCAL_DB_STORE).delete(LOCAL_DB_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = tx.onabort = () => { db.close(); resolve(); };
    } catch { db.close(); resolve(); }
  });
  emit();
}

const UNKNOWN = new Set(["", "unknown", "unclassified", "n/a", "na", "not available", "not available/unknown"]);
const EMPTY: GlobalFilters = {
  drivers: "", areas: "", division: "", route_type: "", vehicle_type: "", facility_type: "", salesman: "",
  start_date: "", end_date: "", lead_time_band: "", classification: "",
};

function emit() { listeners.forEach((fn) => fn()); }
export function subscribeDashboardLocal(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function getDashboardLocalDataset() { return current; }
export function getDashboardLocalLoading() { return loading; }
export function getDashboardLocalLoadingProgress() { return loadingProgress; }
export function subscribeDashboardLocalProgress(listener: (pct: number) => void) {
  progressListeners.add(listener);
  listener(loadingProgress);
  return () => { progressListeners.delete(listener); };
}
function setLoadingProgress(pct: number) {
  loadingProgress = Math.max(loadingProgress, Math.max(0, Math.min(100, Math.round(pct))));
  progressListeners.forEach((fn) => fn(loadingProgress));
}
function resetLoadingProgress(pct = 0) {
  loadingProgress = Math.max(0, Math.min(100, Math.round(pct)));
  progressListeners.forEach((fn) => fn(loadingProgress));
}

function list(v: string | undefined): string[] {
  return String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
}
function selectedSet(v: string | undefined) { return new Set(list(v)); }
function isUnknown(v: unknown) { return UNKNOWN.has(String(v ?? "").trim().toLowerCase()); }
function classification(row: LocalSapRow): string {
  if (!isUnknown(row.facility_type)) return row.facility_type.trim();
  if (!isUnknown(row.division_desc)) return row.division_desc.trim();
  return "";
}

function normalizeVehicleNumber(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function canonicalFleetVehicleType(value: unknown): string {
  const t = String(value ?? "").trim().toLowerCase();
  if (t.includes("pick")) return "Pickup";
  if (t.includes("van")) return "Van";
  return "";
}

function applyFleetVehicleTypes(rows: LocalSapRow[], vehicles: any[]): LocalSapRow[] {
  const byNumber = new Map<string, string>();
  for (const vehicle of vehicles || []) {
    const number = normalizeVehicleNumber(vehicle?.number ?? vehicle?.vehicle_number);
    const type = canonicalFleetVehicleType(vehicle?.type ?? vehicle?.vehicle_type);
    if (number && type) byNumber.set(number, type);
  }
  return rows.map((row) => {
    const fleetType = byNumber.get(normalizeVehicleNumber(row.vehicle_num));
    return fleetType ? { ...row, vehicle_type: fleetType } : { ...row, vehicle_type: canonicalFleetVehicleType(row.vehicle_type) || row.vehicle_type };
  });
}

function normalizeRow(r: any): LocalSapRow {
  return {
    invoice_no: String(r.invoice_no || ""), invoice_date: r.invoice_date || null, dispatch_date: r.dispatch_date || null,
    driver_name: String(r.driver_name || "").trim(), helper_name: String(r.helper_name || "").trim(),
    customer_name: String(r.customer_name || "").trim(), facility_type: String(r.facility_type || "").trim(),
    area: String(r.area || "").trim(), division_desc: String(r.division_desc || "").trim(),
    vehicle_type: String(r.vehicle_type || "").trim(), vehicle_num: String(r.vehicle_num || "").trim(),
    vehicle_key: String(r.vehicle_key || "").trim(), boxes: Number(r.boxes || 0), normal_boxes: Number(r.normal_boxes || 0),
    freezer_boxes: Number(r.freezer_boxes || 0), not_supplied_reason: String(r.not_supplied_reason || "").trim(),
    salesman: String(r.salesman || "").trim(),
  };
}

async function fetchRowsForClient(client: any, start = "", end = "", onPage?: (rows: number) => void): Promise<LocalSapRow[]> {
  const PAGE = 1000;
  const out: LocalSapRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let data: any[] | null = null;
    let error: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      let q = client.from("sap_invoice_facts").select(
        "id,invoice_no,invoice_date,dispatch_date,driver_name,helper_name,customer_name,facility_type,area,division_desc,vehicle_type,vehicle_num,vehicle_key,boxes,normal_boxes,freezer_boxes,not_supplied_reason,salesman"
      ).order("id", { ascending: true });
      if (start) q = q.gte("dispatch_date", start);
      if (end) q = q.lte("dispatch_date", end);
      const result = await q.range(from, from + PAGE - 1);
      data = result.data;
      error = result.error;
      if (!error) break;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
    if (error) {
      // Never present a partial project read as a complete SAP month. The caller
      // can still use other healthy projects, but this source is marked failed.
      throw new Error(`SAP facts page ${from}-${from + PAGE - 1}: ${error.message}`);
    }
    const page = (data || []).map(normalizeRow);
    out.push(...page);
    onPage?.(page.length);
    if (page.length < PAGE) break;
  }
  return out;
}

/**
 * Load one persistent all-history analytical dataset. Date/month selection is
 * deliberately NOT part of the network key: it is a pure local filter after
 * this dataset is available. Primary, Secondary and Tertiary can all contain
 * different invoices for the same dispatch date, so all sources are merged.
 */
export async function preloadDashboardLocalDataset(_start = "", _end = "", force = false): Promise<DashboardLocalDataset> {
  const key = "ALL";
  if (!force && current?.key === key && current.rows.length && Date.now() - lastLiveDatasetRefreshAt < 60_000) {
    current.routeCards = [...baseRouteCards];
    completedVehicleHydrationKeys.clear();
    void hydrateSharedVehicleDriverCards(current, _start, _end);
    setLoadingProgress(100);
    return current;
  }
  if (loading) return loading;

  loading = (async () => {
    resetLoadingProgress(3);
    if (!force) {
      // IndexedDB is a paint-first snapshot, never the authority for the current
      // fleet. Normal and Private browser profiles have different storage, and
      // import-batch timestamps can be delayed or unavailable on one project.
      // Paint any saved snapshot immediately, then always continue to the live
      // federated reads below and replace it with the current SAP/GPS data.
      const persisted = await readPersistentDataset();
      if (persisted && persisted.rows.length) {
        current = { ...persisted, key };
        baseRouteCards = [...(persisted.routeCards || [])];
        setLoadingProgress(18);
        emit();
      }
    }

    const clients = getFederatedSupabaseClients();
    const primary = clients[0];
    const secondary = clients[1];
    const tertiary = clients[2];
    let primaryRowsLoaded = 0;
    let overflowRowsLoaded = 0;
    const primaryPromise = fetchRowsForClient(primary, "", "", (n) => {
      primaryRowsLoaded += n;
      setLoadingProgress(Math.min(45, 5 + Math.round(Math.log10(primaryRowsLoaded + 1) * 18)));
    });
    const secondaryPromise = secondary
      ? fetchRowsForClient(secondary, "", "", (n) => {
          overflowRowsLoaded += n;
          setLoadingProgress(Math.min(62, 25 + Math.round(Math.log10(primaryRowsLoaded + overflowRowsLoaded + 1) * 20)));
        })
      : Promise.resolve([] as LocalSapRow[]);
    const tertiaryPromise = tertiary
      ? fetchRowsForClient(tertiary, "", "", (n) => {
          overflowRowsLoaded += n;
          setLoadingProgress(Math.min(72, 35 + Math.round(Math.log10(primaryRowsLoaded + overflowRowsLoaded + 1) * 20)));
        })
      : Promise.resolve([] as LocalSapRow[]);
    const routePromise = fetchDashboardEndpoint<PerfData>(`/dashboard/driver-performance`);
    const fleetPromise = primary.from("vehicles").select("number,type,status");
    // A failed overflow project must not cancel valid rows from the other
    // projects (a common difference between normal and Private browser
    // profiles). Keep every successful source and retain the last good local
    // snapshot if all SAP sources are temporarily unavailable.
    const settled = await Promise.allSettled([
      primaryPromise, secondaryPromise, tertiaryPromise, routePromise, fleetPromise,
    ]);
    const valueAt = <T,>(index: number, fallback: T): T => {
      const item = settled[index];
      return item.status === "fulfilled" ? item.value as T : fallback;
    };
    const primaryRows = valueAt(0, [] as LocalSapRow[]);
    const secondaryRows = valueAt(1, [] as LocalSapRow[]);
    const tertiaryRows = valueAt(2, [] as LocalSapRow[]);
    const routeResult = valueAt(3, {
      standalone_mode: false,
      validation_results: [],
      kpis: {
        gps_vehicles: 0,
        total_gps_stops: 0,
        avg_stops_per_vehicle: 0,
        avg_route_duration_hrs: null,
        avg_stop_duration: "N/A",
        sap_orders: 0,
        sap_total_boxes: 0,
      },
      chart_stops: { labels: [], values: [] },
      chart_route_hours: { labels: [], values: [] },
      route_cards: [],
    } satisfies PerfData);
    const fleetVehicles = valueAt(4, { data: [], error: null } as any);
    const sapSourceResults = [settled[0], ...(secondary ? [settled[1]] : []), ...(tertiary ? [settled[2]] : [])];
    if (sapSourceResults.every((item) => item.status === "rejected")) {
      throw new Error("Unable to read SAP facts from any configured DispatchOPS data project.");
    }
    setLoadingProgress(82);
    // Fleet vehicle metadata is used only to canonicalize Pickup/Van. If the
    // master table is temporarily unavailable, keep the analytical dataset
    // usable and fall back to the SAP vehicle type already present on each row.
    const fleetVehicleRows = fleetVehicles.error ? [] : (fleetVehicles.data || []);

    // Imports can be split across Primary/Secondary on the SAME dispatch day.
    // Date-level fallback discarded every Secondary invoice whenever Primary
    // had even one row for that date; this is why October could show only a
    // subset of vehicles/drivers while September (owned by one project) looked
    // correct. Merge all projects and suppress only true duplicate invoices.
    // Primary wins only when the same invoice is genuinely present twice.
    const typedPrimaryRows = primaryRows as LocalSapRow[];
    const typedSecondaryRows = secondaryRows as LocalSapRow[];
    const typedTertiaryRows = tertiaryRows as LocalSapRow[];
    const seenInvoices = new Set<string>();
    const rowsRaw: LocalSapRow[] = [];
    for (const row of [...typedPrimaryRows, ...typedSecondaryRows, ...typedTertiaryRows]) {
      const invoice = String(row.invoice_no || "").trim().toLowerCase();
      const dispatch = String(row.dispatch_date || "").slice(0, 10);
      const customer = normalizeMatchKey(row.customer_name);
      const dedupeKey = invoice ? `${dispatch}::${invoice}::${customer}` : `row::${JSON.stringify(row)}`;
      if (seenInvoices.has(dedupeKey)) continue;
      seenInvoices.add(dedupeKey);
      rowsRaw.push(row);
    }

    // Keep every real SAP driver/area represented in the analytical dataset.
    // The master tables are still loaded for the existing app architecture, but
    // exact-name matching here was dropping valid SAP drivers when Fleet
    // Database and SAP used slightly different spellings. That made the
    // Dashboard Driver slicer show only a small subset (sometimes one driver)
    // even though the selected month contained many drivers.
    const rows = applyFleetVehicleTypes(rowsRaw.filter((r: LocalSapRow) =>
      !isUnknown(r.division_desc) && !isUnknown(classification(r))
    ), fleetVehicleRows);

    setLoadingProgress(94);
    baseRouteCards = [...(routeResult.route_cards || [])];
    current = { key, rows, routeCards: [...baseRouteCards], loadedAt: Date.now(), datasetVersion: LOCAL_DATASET_VERSION };
    lastLiveDatasetRefreshAt = Date.now();
    setLoadingProgress(100);
    loading = null;
    emit();

    // Driver Performance exception: the existing RPC remains the fast base
    // snapshot, then the app rebuilds the selected period from paged Landmark
    // facts using all SAP vehicle aliases. This recovers vehicles the SQL join
    // misses when vehicle_key is blank/stale, and resolves shared vehicles by
    // daily driver. This is application-side only; no RPC, table, schema, or
    // database data is modified. It runs after the main dataset is ready.
    void hydrateSharedVehicleDriverCards(current, _start, _end);

    void writePersistentDataset(current);
    return current;
  })().catch((e) => { loading = null; resetLoadingProgress(0); throw e; });
  return loading;
}

export function useDashboardLocalSnapshot(start: string, end: string): DashboardLocalDataset | null {
  // This function intentionally has no React dependency. Consumers subscribe
  // to the store and call getDashboardLocalDataset() from their component.
  return current?.key === `${start || ""}:${end || ""}` ? current : null;
}

function matches(row: LocalSapRow, gf: GlobalFilters): boolean {
  const drivers = selectedSet(gf.drivers), areas = selectedSet(gf.areas), divisions = selectedSet(gf.division);
  const vehicleTypes = selectedSet(gf.vehicle_type), facilities = selectedSet(gf.facility_type), salesmen = selectedSet(gf.salesman);
  if (drivers.size && !drivers.has(row.driver_name)) return false;
  if (areas.size && !areas.has(row.area)) return false;
  if (divisions.size && !divisions.has(row.division_desc)) return false;
  if (vehicleTypes.size && !vehicleTypes.has(row.vehicle_type)) return false;
  if (facilities.size && !facilities.has(row.facility_type)) return false;
  if (salesmen.size && !salesmen.has(row.salesman)) return false;
  return true;
}

export function filterDashboardRows(dataset: DashboardLocalDataset, globalFilters?: GlobalFilters): LocalSapRow[] {
  const gf = globalFilters || EMPTY;
  const start = String(gf.start_date || "");
  const end = String(gf.end_date || "");
  return dataset.rows.filter((r) => {
    const d = String(r.dispatch_date || "");
    if (start && (!d || d < start)) return false;
    if (end && (!d || d > end)) return false;
    if (!isValidInvoiceRow(r)) return false;
    return matches(r, gf);
  });
}

/**
 * Power-BI style slicer options: every list is derived from the local dataset
 * and respects the OTHER active slicers. The dimension itself is intentionally
 * ignored while calculating its own list so users can still change it.
 */
export function getLocalFilterOptions(dataset: DashboardLocalDataset, globalFilters?: GlobalFilters): DashboardLocalFilterOptions {
  const gf = globalFilters || EMPTY;
  // Calculate all six slicer option lists in ONE pass. The previous implementation
  // scanned the full local dataset six times and cloned the filter object for every
  // row. On a large historical dataset that made every slicer click feel heavy.
  // A row can contribute to a slicer when it passes every OTHER active slicer;
  // therefore we only need to identify which active dimensions (if any) reject it.
  const drivers = selectedSet(gf.drivers);
  const areas = selectedSet(gf.areas);
  const divisions = selectedSet(gf.division);
  const vehicleTypes = selectedSet(gf.vehicle_type);
  const facilities = selectedSet(gf.facility_type);
  const salesmen = selectedSet(gf.salesman);
  const divisionOptions = new Set<string>();
  const facilityOptions = new Set<string>();
  const salesmanOptions = new Set<string>();
  const areaOptions = new Set<string>();
  const driverOptions = new Set<string>();
  const vehicleOptions = new Set<string>();

  for (const r of dataset.rows) {
    if (!isValidInvoiceRow(r)) continue;
    const d = String(r.dispatch_date || "");
    if (gf.start_date && (!d || d < gf.start_date)) continue;
    if (gf.end_date && (!d || d > gf.end_date)) continue;

    const division = String(r.division_desc || "").trim();
    const facility = String(r.facility_type || "").trim();
    const salesman = String(r.salesman || "").trim();
    const area = String(r.area || "").trim();
    const driver = String(r.driver_name || "").trim();
    const vehicle = String(r.vehicle_type || "").trim();

    const failDivision = divisions.size > 0 && !divisions.has(r.division_desc);
    const failFacility = facilities.size > 0 && !facilities.has(r.facility_type);
    const failSalesman = salesmen.size > 0 && !salesmen.has(r.salesman);
    const failArea = areas.size > 0 && !areas.has(r.area);
    const failDriver = drivers.size > 0 && !drivers.has(r.driver_name);
    const failVehicle = vehicleTypes.size > 0 && !vehicleTypes.has(r.vehicle_type);
    const failures = Number(failDivision) + Number(failFacility) + Number(failSalesman) + Number(failArea) + Number(failDriver) + Number(failVehicle);

    if (failures === 0) {
      if (division) divisionOptions.add(division);
      if (facility) facilityOptions.add(facility);
      if (salesman) salesmanOptions.add(salesman);
      if (area) areaOptions.add(area);
      if (driver) driverOptions.add(driver);
      if (vehicle) vehicleOptions.add(vehicle);
    } else if (failures === 1) {
      if (failDivision && division) divisionOptions.add(division);
      if (failFacility && facility) facilityOptions.add(facility);
      if (failSalesman && salesman) salesmanOptions.add(salesman);
      if (failArea && area) areaOptions.add(area);
      if (failDriver && driver) driverOptions.add(driver);
      if (failVehicle && vehicle) vehicleOptions.add(vehicle);
    }
  }

  return {
    divisions: [...divisionOptions].sort((a, b) => a.localeCompare(b)),
    facility_types: [...facilityOptions].sort((a, b) => a.localeCompare(b)),
    salesmen: [...salesmanOptions].sort((a, b) => a.localeCompare(b)),
    areas: [...areaOptions].sort((a, b) => a.localeCompare(b)),
    drivers: [...driverOptions].sort((a, b) => a.localeCompare(b)),
    vehicle_types: [...vehicleOptions].sort((a, b) => a.localeCompare(b)),
  };
}

function dayDiff(invoiceDate: string | null, dispatchDate: string | null): number | null {
  if (!invoiceDate || !dispatchDate) return null;
  const n = Math.round((new Date(`${dispatchDate}T00:00:00`).getTime() - new Date(`${invoiceDate}T00:00:00`).getTime()) / 86400000);
  return Number.isFinite(n) ? n : null;
}
function leadBand(days: number): string {
  if (days <= 0) return "0 Days";
  if (days === 1) return "1 Day";
  if (days <= 5) return `${days} Days`;
  return "More than 5 Days";
}
function round(n: number, places = 2) { const p = 10 ** places; return Math.round(n * p) / p; }
function isValidInvoiceRow(row: LocalSapRow): boolean {
  return Number(row.boxes || 0) > 0 || Number(row.freezer_boxes || 0) > 0;
}
function routeInDateRange(route: RouteCard, start?: string, end?: string): boolean {
  const d = String(route.route_start || route.route_end || "").slice(0, 10);
  if (!d) return true;
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

export function buildLocalHome(rows: LocalSapRow[], routeCards: RouteCard[], vehicleRows: LocalSapRow[] = rows): HomeDashboard {
  const drivers = new Map<string, { driver_name: string; vehicle_num: string; vehicle_type: string; orders: number; boxes: number; freezer: number; not_supplied: number }>();
  const facilities = new Map<string, number>();
  const vehicleTypes = new Map<string, { normal: number; freezer: number }>();
  const customers = new Set<string>();
  // Active vehicles are counted from every SAP dispatch row in the selected
  // period, not only rows that pass the invoice-box KPI validity test.
  const vehicles = new Set(vehicleRows.map((r) => normalizeMatchKey(r.vehicle_num || r.vehicle_key)).filter(Boolean));
  let boxes = 0, normal = 0, freezer = 0, notSupplied = 0, leadTotal = 0, leadCount = 0;
  for (const r of rows) {
    boxes += r.boxes; normal += r.normal_boxes; freezer += r.freezer_boxes;
    if (r.not_supplied_reason) notSupplied++;
    if (r.customer_name) customers.add(r.customer_name);
    if (r.facility_type) facilities.set(r.facility_type, (facilities.get(r.facility_type) || 0) + 1);
    if (r.vehicle_type) { const v = vehicleTypes.get(r.vehicle_type) || { normal: 0, freezer: 0 }; v.normal += r.normal_boxes; v.freezer += r.freezer_boxes; vehicleTypes.set(r.vehicle_type, v); }
    if (r.driver_name) {
      const d = drivers.get(r.driver_name) || { driver_name: r.driver_name, vehicle_num: r.vehicle_num || "-", vehicle_type: r.vehicle_type, orders: 0, boxes: 0, freezer: 0, not_supplied: 0 };
      d.orders++; d.boxes += r.boxes; d.freezer += r.freezer_boxes;
      if ((d.vehicle_num === "-" || !d.vehicle_num) && r.vehicle_num) d.vehicle_num = r.vehicle_num;
      if (!d.vehicle_type && r.vehicle_type) d.vehicle_type = r.vehicle_type;
      if (r.not_supplied_reason) d.not_supplied++;
      drivers.set(r.driver_name, d);
    }
    const days = dayDiff(r.invoice_date, r.dispatch_date); if (days !== null && days >= 0) { leadTotal += days; leadCount++; }
  }
  const driverRows = [...drivers.values()].sort((a, b) => b.boxes - a.boxes);
  const selectedVehicles = new Set(rows.flatMap((r) => [r.vehicle_key, r.vehicle_num].map(normalizeMatchKey).filter(Boolean)));
  const rowDates = rows.map((r) => String(r.dispatch_date || "")).filter(Boolean).sort();
  const perf = routeCards.filter((r) => {
    const aliases = [r.vehicle_key, r.vehicle_num].map(normalizeMatchKey).filter(Boolean);
    return aliases.some((alias) => selectedVehicles.has(alias)) && routeInDateRange(r, rowDates[0], rowDates[rowDates.length - 1]);
  });
  const routeHours = perf.map((r) => {
    const h = String(r.route_duration_hm || "").match(/(\d+)h\s+(\d+)m/); return h ? Number(h[1]) + Number(h[2]) / 60 : 0;
  }).filter((n) => n > 0);
  const activeDrivers = driverRows.length;
  const validInvoiceCount = rows.filter(isValidInvoiceRow).length;
  return {
    kpis: {
      valid_invoices: validInvoiceCount, total_boxes: boxes, freezer_boxes: freezer, normal_boxes: normal,
      active_drivers: activeDrivers, avg_boxes_per_driver: activeDrivers ? round(boxes / activeDrivers, 1) : 0,
      not_supplied: notSupplied, avg_lead_time_days: leadCount ? round(leadTotal / leadCount, 1) : null,
      unique_customers: customers.size, avg_route_hours: routeHours.length ? round(routeHours.reduce((a, b) => a + b, 0) / routeHours.length, 1) : null,
      orders_per_driver: activeDrivers ? round(validInvoiceCount / activeDrivers, 1) : 0, active_vehicles: vehicles.size,
    },
    driver_overview: driverRows,
    charts: {
      driver_boxes: { labels: driverRows.map((d) => d.driver_name), values: driverRows.map((d) => d.boxes) },
      facility: { labels: [...facilities.keys()].sort(), values: [...facilities.keys()].sort().map((k) => facilities.get(k) || 0) },
      vantype: { labels: [...vehicleTypes.keys()].sort(), normal: [...vehicleTypes.keys()].sort().map((k) => vehicleTypes.get(k)?.normal || 0), freezer: [...vehicleTypes.keys()].sort().map((k) => vehicleTypes.get(k)?.freezer || 0) },
      returns: { delivered: rows.length, not_supplied: notSupplied },
    },
  };
}

export function buildLocalLeadTimeDetails(
  rows: LocalSapRow[],
  globalFilters: GlobalFilters | undefined,
  kind: "fastest" | "longest",
  offset = 0,
  limit = 100
): { rows: Array<{ invoice_no: string; driver_name: string; customer_name: string; invoice_date: string; dispatch_date: string; days: number }>; total: number; truncated: boolean } {
  const gf = globalFilters || EMPTY;
  const lead = rows
    .map((r) => ({ r, days: dayDiff(r.invoice_date, r.dispatch_date) }))
    .filter((x) =>
      x.days !== null &&
      (x.days as number) >= 0 &&
      (!gf.lead_time_band || leadBand(x.days as number) === gf.lead_time_band) &&
      (!gf.classification || classification(x.r) === gf.classification)
    ) as Array<{ r: LocalSapRow; days: number }>;

  lead.sort((a, b) => {
    const daysCmp = kind === "fastest" ? a.days - b.days : b.days - a.days;
    if (daysCmp !== 0) return daysCmp;
    return kind === "fastest"
      ? String(a.r.dispatch_date).localeCompare(String(b.r.dispatch_date))
      : String(b.r.dispatch_date).localeCompare(String(a.r.dispatch_date));
  });

  const page = lead.slice(offset, offset + limit).map((x) => ({
    invoice_no: x.r.invoice_no,
    driver_name: x.r.driver_name,
    customer_name: x.r.customer_name,
    invoice_date: x.r.invoice_date || "",
    dispatch_date: x.r.dispatch_date || "",
    days: x.days,
  }));

  return { rows: page, total: lead.length, truncated: offset + page.length < lead.length };
}

export function buildLocalLeadTime(rows: LocalSapRow[], globalFilters?: GlobalFilters): LeadTimeData {
  const gf = globalFilters || EMPTY;
  const lead = rows.map((r) => ({ r, days: dayDiff(r.invoice_date, r.dispatch_date) })).filter((x) => x.days !== null && (x.days as number) >= 0 && (!gf.lead_time_band || leadBand(x.days as number) === gf.lead_time_band) && (!gf.classification || classification(x.r) === gf.classification)) as Array<{r: LocalSapRow; days: number}>;
  const byClass = new Map<string, number[]>();
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const x of lead) {
    const c = classification(x.r) || ""; if (c) { const a = byClass.get(c) || []; a.push(x.days); byClass.set(c, a); }
    const b = leadBand(x.days); const i = ["0 Days","1 Day","2 Days","3 Days","4 Days","5 Days","More than 5 Days"].indexOf(b); if (i >= 0) counts[i]++;
  }
  const rowsByClass = [...byClass.entries()].map(([name, ds]) => ({ name, orders: ds.length, avg_days: round(ds.reduce((a,b)=>a+b,0)/ds.length), min_days: Math.min(...ds), max_days: Math.max(...ds) })).sort((a,b)=>a.name.localeCompare(b.name));
  const classes = rowsByClass.map((x) => x.name);
  const bands = ["0 Days","1 Day","2 Days","3 Days","4 Days","5 Days","More than 5 Days"];
  const matrixRows = bands.map((band) => { const obj: Record<string,number> = {}; let total=0; for (const c of classes) { const n=lead.filter(x=>leadBand(x.days)===band && classification(x.r)===c).length; obj[c]=n; total+=n; } return { band, counts: obj, total }; });
  const fastest = [...lead].sort((a,b)=>a.days-b.days || String(a.r.dispatch_date).localeCompare(String(b.r.dispatch_date))).slice(0,100).map(x=>({invoice_no:x.r.invoice_no,driver_name:x.r.driver_name,customer_name:x.r.customer_name,invoice_date:x.r.invoice_date || "",dispatch_date:x.r.dispatch_date || "",days:x.days}));
  const longest = [...lead].sort((a,b)=>b.days-a.days || String(b.r.dispatch_date).localeCompare(String(a.r.dispatch_date))).slice(0,100).map(x=>({invoice_no:x.r.invoice_no,driver_name:x.r.driver_name,customer_name:x.r.customer_name,invoice_date:x.r.invoice_date || "",dispatch_date:x.r.dispatch_date || "",days:x.days}));
  return {
    kpis:{total_invoices:rows.length,overall_avg_days:lead.length?round(lead.reduce((a,x)=>a+x.days,0)/lead.length):null,fastest_days:lead.length?Math.min(...lead.map(x=>x.days)):null,longest_days:lead.length?Math.max(...lead.map(x=>x.days)):null},
    by_classification:rowsByClass,distribution:{bins:bands,counts},fastest_detail:fastest,longest_detail:longest,
    band_classification_matrix:{classifications:classes,rows:matrixRows,col_totals:Object.fromEntries(classes.map(c=>[c,matrixRows.reduce((n,r)=>n+(r.counts[c]||0),0)])),grand_total:lead.length},
    available_bands:bands.filter((_,i)=>counts[i]>0),available_classifications:classes,
  };
}

export function buildLocalOrderSummary(rows: LocalSapRow[]): OrderSummaryData {
  const facilities = [...new Set(rows.map((r)=>classification(r)).filter(Boolean))].sort();
  const byDriver = new Map<string, number[]>();
  for (const r of rows) { const d=r.driver_name||"Unknown"; const arr=byDriver.get(d)||facilities.map(()=>0); const f=classification(r); const i=facilities.indexOf(f); if(i>=0)arr[i]++; byDriver.set(d,arr); }
  const outRows=[...byDriver.entries()].map(([driver,arr])=>({driver,by_facility:arr,total:arr.reduce((a,b)=>a+b,0)})).sort((a,b)=>a.driver.localeCompare(b.driver));
  return {facility_types:facilities,rows:outRows,facility_totals:facilities.map((_,i)=>outRows.reduce((n,r)=>n+(r.by_facility[i]||0),0)),grand_total:rows.length};
}

export function buildLocalArea(rows: LocalSapRow[]): AreaData {
  const map=new Map<string,AreaRow>();
  for(const r of rows){const area=r.area||"";const x=map.get(area)||{area,orders:0,boxes:0,freezer:0,returns:0,drivers:0,success_pct:0};x.orders++;x.boxes+=r.boxes;x.freezer+=r.freezer_boxes;if(r.not_supplied_reason)x.returns++;map.set(area,x);}
  const driverSets=new Map<string,Set<string>>(); for(const r of rows){const s=driverSets.get(r.area)||new Set<string>();if(r.driver_name)s.add(r.driver_name);driverSets.set(r.area,s);}
  const table=[...map.values()].map(x=>({...x,drivers:driverSets.get(x.area)?.size||0,success_pct:x.orders?round((x.orders-x.returns)/x.orders*100,2):0})).sort((a,b)=>a.area.localeCompare(b.area));
  const names=table.map(x=>x.area); const weeks=new Map<string,number[]>();
  for(const r of rows){if(!r.dispatch_date||!r.area)continue;const d=new Date(`${r.dispatch_date}T00:00:00`);const day=(d.getDay()+6)%7;d.setDate(d.getDate()-day);const week=d.toISOString().slice(0,10);const arr=weeks.get(week)||names.map(()=>0);const i=names.indexOf(r.area);if(i>=0)arr[i]++;weeks.set(week,arr);}
  const totals=table.reduce((a,r)=>({orders:a.orders+r.orders,boxes:a.boxes+r.boxes,freezer:a.freezer+r.freezer,returns:a.returns+r.returns}),{orders:0,boxes:0,freezer:0,returns:0});
  return {table,totals:{...totals,drivers:new Set(rows.map(r=>r.driver_name).filter(Boolean)).size,success_pct:totals.orders?round((totals.orders-totals.returns)/totals.orders*100,2):0},area_names:names,weekly_table:[...weeks.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([week,by_area])=>({week,by_area})),chart:{labels:[...table].sort((a,b)=>b.orders-a.orders).slice(0,15).map(x=>x.area),values:[...table].sort((a,b)=>b.orders-a.orders).slice(0,15).map(x=>x.orders)}};
}

export function buildLocalNotSupplied(rows: LocalSapRow[]): NotSuppliedData {
  const not_supplied: NsRow[] = rows.filter(r=>!!r.not_supplied_reason).sort((a,b)=>String(b.dispatch_date).localeCompare(String(a.dispatch_date))).map(r=>({driver_name:r.driver_name,customer_name:r.customer_name,facility_type:r.facility_type,reason:r.not_supplied_reason,boxes:r.boxes,invoice_date:r.invoice_date||"",dispatch_date:r.dispatch_date||"",invoice_no:r.invoice_no||""}));
  const zero_box_excluded_from_kpis: ZeroRow[] = rows.filter(r=>r.boxes<=0).sort((a,b)=>String(b.dispatch_date).localeCompare(String(a.dispatch_date))).map(r=>({driver_name:r.driver_name,customer_name:r.customer_name,invoice_date:r.invoice_date||"",dispatch_date:r.dispatch_date||""}));
  const summary = new Map<string, { driver_name: string; total_orders: number; delivered: number; not_supplied: number }>();
  for (const row of rows) {
    const driver = row.driver_name || "Unknown";
    const item = summary.get(driver) || { driver_name: driver, total_orders: 0, delivered: 0, not_supplied: 0 };
    item.total_orders += 1;
    if (row.not_supplied_reason) item.not_supplied += 1; else item.delivered += 1;
    summary.set(driver, item);
  }
  const driver_summary = [...summary.values()].sort((a,b) => b.total_orders - a.total_orders || a.driver_name.localeCompare(b.driver_name));
  return {not_supplied,zero_box_excluded_from_kpis:zero_box_excluded_from_kpis.slice(0,2000),driver_summary};
}

function normalizeDriverIdentity(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeMatchKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function routeMonth(value: unknown): string {
  return String(value ?? "").slice(0, 7);
}


function tokenEditSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

function driverNameSimilarity(a: string, b: string): number {
  const left = normalizeDriverIdentity(a);
  const right = normalizeDriverIdentity(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const lt = left.split(/[^a-z0-9]+/i).filter(Boolean);
  const rt = right.split(/[^a-z0-9]+/i).filter(Boolean);
  if (!lt.length || !rt.length) return 0;
  const source = lt.length <= rt.length ? lt : rt;
  const target = lt.length <= rt.length ? rt : lt;
  const scores = source.map(token => Math.max(...target.map(other => tokenEditSimilarity(token, other))));
  const score = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const compactLeft = normalizeMatchKey(left);
  const compactRight = normalizeMatchKey(right);
  if (compactLeft && compactRight && (compactLeft.startsWith(compactRight) || compactRight.startsWith(compactLeft))) {
    return Math.max(0.92, score);
  }
  return score;
}

function resolveDriverName(candidate: string, preferred: Map<string, { display: string }>, global: Map<string, { display: string }>): { display: string; score: number } | null {
  const normalized = normalizeDriverIdentity(candidate);
  if (!normalized || normalized === "unknown" || normalized === "[ unknown ]") return null;
  const exact = preferred.get(normalized);
  if (exact) return { display: exact.display, score: 1 };

  const pickBest = (items: { display: string }[]) => {
    let best: { display: string; score: number } | null = null;
    let second = 0;
    for (const item of items) {
      const score = driverNameSimilarity(candidate, item.display);
      if (score > (best?.score || 0)) {
        second = best?.score || 0;
        best = { display: item.display, score };
      } else if (score > second) {
        second = score;
      }
    }
    const singleToken = normalized.split(/[^a-z0-9]+/i).filter(Boolean).length === 1;
    const threshold = singleToken ? 0.78 : 0.82;
    return best && best.score >= threshold && (best.score - second >= 0.12 || best.score >= 0.92) ? best : null;
  };

  // When SAP has exactly one owner for this vehicle/day, that owner is the
  // authoritative delivery driver even if Landmark's text contains a short or
  // stale name. This is what prevents a real SAP driver from becoming zero.
  if (preferred.size === 1) return { display: [...preferred.values()][0].display, score: 1 };
  // With multiple SAP owners on the same day, require GPS to distinguish them;
  // never let a different-day/global driver steal the route.
  if (preferred.size > 1) return pickBest([...preferred.values()]);
  return pickBest([...global.values()]);
}

const completedVehicleHydrationKeys = new Set<string>();
const vehicleHydrationPromises = new Map<string, Promise<void>>();

async function hydrateSharedVehicleDriverCards(dataset: DashboardLocalDataset, start: string, end: string): Promise<void> {
  const periodStart = String(start || "");
  const periodEnd = String(end || "");
  if (!periodStart && !periodEnd) return;
  const key = `${periodStart}::${periodEnd}`;
  if (completedVehicleHydrationKeys.has(key)) return;
  const existingHydration = vehicleHydrationPromises.get(key);
  if (existingHydration) return existingHydration;

  // SAP is the order/driver roster and Landmark is the actual GPS route stream.
  // Build ownership by vehicle + day, but never collapse a vehicle to one driver.
  type Owner = { display: string; identity: string; invoices: number; boxes: number; freezer: number };
  const ownersByVehicleDay = new Map<string, Map<string, Map<string, Owner>>>();
  const globalDrivers = new Map<string, { display: string }>();
  const sapByVehicleDayDriver = new Map<string, { invoices: number; boxes: number; freezer: number }>();

  // Keep the Fleet master roster in the identity index as well as SAP.
  // Some Landmark drivers are abbreviated (for example "Jamseer") while the
  // Fleet/SAP identity is the full name ("Jamseer PV Ibrahim"). Using the
  // canonical driver directory here prevents a real GPS driver from being
  // dropped merely because his SAP rows were excluded by another dashboard
  // dimension. This is read-only and scoped to Driver Performance matching.
  try {
    const { data: fleetDrivers, error: fleetDriverError } = await getPrimarySupabaseClient()
      .from("drivers").select("code,name").order("name");
    if (!fleetDriverError) {
      for (const driver of fleetDrivers || []) {
        const display = String(driver?.name || "").trim();
        const identity = normalizeDriverIdentity(display);
        if (identity) globalDrivers.set(identity, { display });
      }
    }
  } catch {
    // SAP remains the fallback identity roster if Fleet master data is unavailable.
  }

  for (const row of dataset.rows) {
    const date = String(row.dispatch_date || "").slice(0, 10);
    const vehicles = [...new Set([row.vehicle_key, row.vehicle_num].map(normalizeMatchKey).filter(Boolean))];
    const identity = normalizeDriverIdentity(row.driver_name);
    if (!date || !vehicles.length || !identity || (periodStart && date < periodStart) || (periodEnd && date > periodEnd)) continue;
    const display = String(row.driver_name || identity).trim() || identity;
    globalDrivers.set(identity, { display });
    for (const vehicle of vehicles) {
      const byDate = ownersByVehicleDay.get(vehicle) || new Map<string, Map<string, Owner>>();
      const byDriver = byDate.get(date) || new Map<string, Owner>();
      const owner = byDriver.get(identity) || { display, identity, invoices: 0, boxes: 0, freezer: 0 };
      owner.invoices += 1;
      owner.boxes += Number(row.boxes || 0);
      owner.freezer += Number(row.freezer_boxes || 0);
      byDriver.set(identity, owner);
      byDate.set(date, byDriver);
      ownersByVehicleDay.set(vehicle, byDate);

      const sapKey = `${vehicle}::${date}::${identity}`;
      const sap = sapByVehicleDayDriver.get(sapKey) || { invoices: 0, boxes: 0, freezer: 0 };
      sap.invoices += 1;
      sap.boxes += Number(row.boxes || 0);
      sap.freezer += Number(row.freezer_boxes || 0);
      sapByVehicleDayDriver.set(sapKey, sap);
    }
  }

  // Rebuild driver-aware GPS for EVERY SAP vehicle in the selected period.
  // The old version only hydrated vehicles it classified as shared. That left
  // a driver such as Jamseer with zero whenever the vehicle had been aggregated
  // into one period-level RPC card and his particular route day was not the
  // card's representative date. This is application-side only: no database
  // query/function/schema is changed.
  const hydratedVehicles = [...ownersByVehicleDay.keys()];
  if (!hydratedVehicles.length) { completedVehicleHydrationKeys.add(key); return; }

  // IMPORTANT: `hydratedVehicles` is an internal normalized key (lowercase,
  // punctuation removed). Supabase equality on vehicle_key is case-sensitive.
  // Always query the original database values so `o72506` still matches `O72506`.
  const hydratedVehicleSet = new Set(hydratedVehicles);

  let hydrationPromise!: Promise<void>;
  hydrationPromise = (async () => {
    try {
      const clients = getFederatedSupabaseClients();
      const lmRows: any[] = [];
      let landmarkReadIncomplete = false;
      // Fetch the selected GPS period in pages, then join in JavaScript using
      // normalized aliases. Filtering by raw SAP vehicle_key alone was brittle:
      // October exports may carry vehicle_num while vehicle_key is a legacy or
      // differently formatted value. The former single-page `.in()` query also
      // silently stopped at PostgREST's 1,000-row default.
      for (const client of clients) {
        for (let from = 0; ; from += 1000) {
          let data: any[] | null = null;
          let error: any = null;
          try {
            for (let attempt = 0; attempt < 3; attempt++) {
              let q = client.from("landmark_visit_facts")
                .select("id,vehicle_key,vehicle_raw,driver_name,customer_name,visit_date,arrival,departure,minutes,is_passthrough,is_depot")
                .order("id", { ascending: true });
              if (periodStart) q = q.gte("visit_date", periodStart);
              if (periodEnd) q = q.lte("visit_date", periodEnd);
              const result = await q.range(from, from + 999);
              data = result.data;
              error = result.error;
              if (!error) break;
              if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
            }
            if (error) {
              landmarkReadIncomplete = true;
              break;
            }
            const page = data || [];
            lmRows.push(...page.filter((row: any) =>
              [row.vehicle_key, row.vehicle_raw].some((alias: unknown) => hydratedVehicleSet.has(normalizeMatchKey(alias)))
            ));
            if (page.length < 1000) break;
          } catch {
            landmarkReadIncomplete = true;
            break;
          }
        }
      }
      if (landmarkReadIncomplete) {
        // A partial read is not evidence that a driver had zero GPS activity.
        // Leave the hydration key open so a later dashboard refresh can retry.
        throw new Error("Landmark GPS read was incomplete; retry required.");
      }

      const parseTime = (value: unknown) => {
        const t = Date.parse(String(value || ""));
        return Number.isFinite(t) ? t : null;
      };
      type GpsBucket = {
        vehicle: string; date: string; rawDriver: string; vehicle_raw: string;
        stops: number; passthru: number; stopMinutes: number;
        routeStart: number | null; routeEnd: number | null;
      };
      const gps = new Map<string, GpsBucket>();
      for (const row of lmRows) {
        const vehicleAliases = [...new Set([row.vehicle_key, row.vehicle_raw].map(normalizeMatchKey).filter(Boolean))];
        const date = String(row.visit_date || "").slice(0, 10);
        if (!vehicleAliases.length || !date) continue;
        const rawDriver = normalizeDriverIdentity(row.driver_name) || "unknown";
        // vehicle_key can be blank or stale in a Landmark export; vehicle_raw
        // often contains the actual vehicle number. Match either alias to SAP.
        const vehicle = vehicleAliases.find((alias) => ownersByVehicleDay.has(alias)) || vehicleAliases[0];
        const k = `${vehicle}::${date}::${rawDriver}`;
        const item = gps.get(k) || {
          vehicle, date, rawDriver, vehicle_raw: String(row.vehicle_raw || ""),
          stops: 0, passthru: 0, stopMinutes: 0, routeStart: null, routeEnd: null,
        };
        const isPass = Boolean(row.is_passthrough);
        const isDepot = Boolean(row.is_depot);
        const minutes = Number(row.minutes || 0);
        if (isPass) item.passthru += 1;
        if (!isPass && !isDepot) {
          item.stops += 1;
          item.stopMinutes += Number.isFinite(minutes) ? minutes : 0;
        }
        const ts = parseTime(row.departure || row.arrival);
        if (ts !== null && isDepot) item.routeStart = item.routeStart === null ? ts : Math.min(item.routeStart, ts);
        if (ts !== null && !isPass && !isDepot) item.routeEnd = item.routeEnd === null ? ts : Math.max(item.routeEnd, ts);
        gps.set(k, item);
      }

      // Resolve every GPS driver/day independently. This is the key fix:
      // vehicle identity is no longer the driver identity. A shared vehicle can
      // therefore produce multiple route cards on the same day when GPS names
      // identify different drivers/times.
      const resolved = new Map<string, RouteCard>();
      for (const item of gps.values()) {
        const owners = ownersByVehicleDay.get(item.vehicle)?.get(item.date) || new Map<string, Owner>();
        const preferred = new Map<string, { display: string }>();
        for (const owner of owners.values()) preferred.set(owner.identity, { display: owner.display });
        // Landmark's driver name is a direct GPS identity signal. When it
        // matches a known SAP/Fleet driver (including shortened names such as
        // "Jamseer" -> "Jamseer PV Ibrahim"), prefer that identity even if
        // the same vehicle has a different SAP owner on that calendar day.
        // This is important for real shared-vehicle cases: GPS must not be
        // discarded merely because SAP assignment was stale or delayed.
        const globalMatch = resolveDriverName(item.rawDriver, new Map(), globalDrivers);
        const match = globalMatch && globalMatch.score >= 0.9
          ? globalMatch
          : resolveDriverName(item.rawDriver, preferred, globalDrivers);
        let displayDriver = match?.display || "";
        if (!displayDriver && owners.size === 1 && (item.rawDriver === "unknown" || item.rawDriver === "[ unknown ]")) {
          displayDriver = [...owners.values()][0].display;
        }
        if (!displayDriver) continue;

        const displayIdentity = normalizeDriverIdentity(displayDriver);
        const sap = sapByVehicleDayDriver.get(`${item.vehicle}::${item.date}::${displayIdentity}`) || { invoices: 0, boxes: 0, freezer: 0 };
        const hours = item.routeStart !== null && item.routeEnd !== null && item.routeEnd >= item.routeStart
          ? (item.routeEnd - item.routeStart) / 3600000 : 0;
        const avgStop = item.stops ? item.stopMinutes / item.stops : 0;
        const cardKey = `${item.vehicle}::${item.date}::${displayIdentity}`;
        const existing = resolved.get(cardKey);
        if (existing) {
          const existingHours = (() => {
            const m = String(existing.route_duration_hm || "").match(/(\d+)h\s+(\d+)m/);
            return m ? Number(m[1]) + Number(m[2]) / 60 : 0;
          })();
          const mergedStops = Number(existing.stops || 0) + item.stops;
          const mergedMinutes = Number(existing.avg_stop_hm?.match?.(/(\d+)h\s+(\d+)m/)?.[1] || 0) * 60 + Number(existing.avg_stop_hm?.match?.(/(\d+)h\s+(\d+)m/)?.[2] || 0);
          const totalStopMinutes = mergedStops ? (mergedMinutes * Number(existing.stops || 0) + item.stopMinutes) / mergedStops : 0;
          resolved.set(cardKey, {
            ...existing,
            route_start: existing.route_start && item.routeStart !== null ? new Date(Math.min(Date.parse(existing.route_start), item.routeStart)).toISOString() : existing.route_start,
            route_end: existing.route_end && item.routeEnd !== null ? new Date(Math.max(Date.parse(existing.route_end), item.routeEnd)).toISOString() : existing.route_end,
            route_duration_hm: `${Math.floor(existingHours + hours)}h ${Math.floor(((existingHours + hours) * 60) % 60)}m`,
            stops: mergedStops,
            avg_stop_hm: `${Math.floor(totalStopMinutes / 60)}h ${Math.floor(totalStopMinutes % 60)}m`,
            passthru_count: Number(existing.passthru_count || 0) + item.passthru,
            sap_orders: sap,
          });
        } else {
          resolved.set(cardKey, {
            vehicle_key: item.vehicle,
            vehicle_num: item.vehicle_raw || item.vehicle,
            vehicle_model: "",
            display_driver: displayDriver,
            match_method: "vehicle",
            match_confidence: match && match.score >= 0.9 ? "daily-driver" : "gps-driver",
            route_start: item.routeStart !== null ? new Date(item.routeStart).toISOString() : `${item.date}T00:00:00.000Z`,
            route_end: item.routeEnd !== null ? new Date(item.routeEnd).toISOString() : `${item.date}T00:00:00.000Z`,
            route_duration_hm: `${Math.floor(hours)}h ${Math.floor((hours * 60) % 60)}m`,
            stops: item.stops,
            avg_stop_hm: `${Math.floor(avgStop / 60)}h ${Math.floor(avgStop % 60)}m`,
            passthru_count: item.passthru,
            sap_orders: sap,
          });
        }
      }

      // Do not manufacture GPS cards for drivers that were not actually
      // resolved from Landmark. A fabricated vehicle-level fallback was the
      // reason the KPI rose from the real fleet count to 48 cards and it hid
      // the underlying driver-matching problem. A zero now remains a truthful
      // signal that still needs an evidence-backed match.

      // Replace vehicle-level cards only for shared vehicles/days for which we
      // have a driver-aware GPS reconstruction. All unrelated cards stay intact.
      const covered = new Set([...resolved.values()].map((card) => `${normalizeMatchKey(card.vehicle_key)}::${String(card.route_start || card.route_end).slice(0, 10)}`));
      // Do not let an older in-flight month overwrite a newly loaded dataset.
      if (!current || current.loadedAt !== dataset.loadedAt) return;
      const latestCards = current.routeCards;
      const next: RouteCard[] = [];
      for (const base of latestCards) {
        const vehicle = normalizeMatchKey(base.vehicle_key || base.vehicle_num);
        const date = String(base.route_start || base.route_end || "").slice(0, 10);
        if (vehicle && date && hydratedVehicles.includes(vehicle) && covered.has(`${vehicle}::${date}`)) continue;
        next.push(base);
      }
      next.push(...resolved.values());
      next.sort((a, b) => String(b.route_start || "").localeCompare(String(a.route_start || "")));
      // IMPORTANT: useSyncExternalStore compares snapshots by identity. The
      // previous code mutated `dataset.routeCards` in place and emitted the
      // same object, so React could keep rendering the old zero-result snapshot
      // even though GPS hydration had already produced the correct cards.
      // Publish a NEW dataset object and keep baseRouteCards immutable.
      current = { ...dataset, routeCards: next };
      completedVehicleHydrationKeys.add(key);
      emit();
    } catch {
      // Optional driver-aware enrichment must never break the working Dashboard.
      // Do not mark failed hydration complete; a later refresh can retry it.
    } finally {
      if (vehicleHydrationPromises.get(key) === hydrationPromise) vehicleHydrationPromises.delete(key);
    }
  })();
  vehicleHydrationPromises.set(key, hydrationPromise);
  await hydrationPromise;
}

export function buildLocalDriverPerformance(rows: LocalSapRow[], routeCards: RouteCard[], gf?: GlobalFilters, ownershipRows: LocalSapRow[] = rows): PerfData {
  // Keep the important fix from V13.6.63: GPS is NEVER allowed to fall back
  // into another month. The matching below is simply more tolerant INSIDE the
  // selected period so SAP/Overview and GPS can still be joined when their
  // vehicle_key, vehicle number, driver spelling, or exact route day differs.
  //
  // We index SAP ownership by both vehicle_key and vehicle_num, then by exact
  // date and by month. Exact date is preferred; month is the safe fallback when
  // the GPS route date and SAP dispatch date are not the same day.
  type Owner = { identity: string; display: string };
  // Simpler secondary index: vehicle alias -> date -> unique driver owners.
  const ownership = new Map<string, Map<string, Map<string, Owner>>>();
  const addOwnership = (vehicleAlias: string, date: string, owner: Owner) => {
    const alias = normalizeMatchKey(vehicleAlias);
    if (!alias || !date || !owner.identity) return;
    const byDate = ownership.get(alias) || new Map<string, Map<string, Owner>>();
    const byDriver = byDate.get(date) || new Map<string, Owner>();
    byDriver.set(owner.identity, owner);
    byDate.set(date, byDriver);
    ownership.set(alias, byDate);
  };

  for (const row of ownershipRows) {
    const date = String(row.dispatch_date || "").slice(0, 10);
    const identity = normalizeDriverIdentity(row.driver_name);
    if (!date || !identity) continue;
    const owner = { identity, display: String(row.driver_name || "").trim() || identity };
    addOwnership(row.vehicle_key, date, owner);
    addOwnership(row.vehicle_num, date, owner);
  }

  const selectedStart = String(gf?.start_date || "");
  const selectedEnd = String(gf?.end_date || "");

  const inSelectedPeriod = (date: string) => {
    if (!date) return false;
    if (selectedStart && date < selectedStart) return false;
    if (selectedEnd && date > selectedEnd) return false;
    return true;
  };

  const getOwners = (aliases: string[], date: string): Map<string, Owner> => {
    // First try the exact GPS route day across all known vehicle aliases.
    const exact = new Map<string, Owner>();
    for (const alias of aliases) {
      const byDate = ownership.get(alias);
      const dayOwners = byDate?.get(date);
      if (dayOwners) for (const [id, owner] of dayOwners) exact.set(id, owner);
    }
    if (exact.size) return exact;

    // Safe fallback: same vehicle + same calendar month only. This handles
    // dispatch-vs-route day differences while still making August GPS
    // impossible to appear in a September selection.
    // SAP dispatch and GPS route dates can differ by a small calendar offset.
    // Do not fall back to the whole month: when a vehicle has Driver A on one
    // day and Driver B on another, a month-wide owner set becomes ambiguous and
    // the old code dropped the route card entirely. Prefer the nearest SAP day
    // (within +/- 2 days) and only accept a driver when that nearest day is
    // unambiguous. This keeps the driver's real daily ownership intact.
    const targetMs = Date.parse(`${date}T00:00:00Z`);
    let bestDistance = Infinity;
    const nearest = new Map<string, Owner>();
    for (const alias of aliases) {
      const byDate = ownership.get(alias);
      if (!byDate) continue;
      for (const [ownerDate, dayOwners] of byDate) {
        const ownerMs = Date.parse(`${ownerDate}T00:00:00Z`);
        if (!Number.isFinite(ownerMs) || !Number.isFinite(targetMs)) continue;
        const distance = Math.abs(ownerMs - targetMs) / 86400000;
        if (distance > 2) continue;
        if (distance < bestDistance) {
          bestDistance = distance;
          nearest.clear();
          for (const [id, owner] of dayOwners) nearest.set(id, owner);
        } else if (distance === bestDistance) {
          for (const [id, owner] of dayOwners) nearest.set(id, owner);
        }
      }
    }
    return nearest;
  };

  const driverMatches = (a: string, b: string) => {
    const left = normalizeDriverIdentity(a);
    const right = normalizeDriverIdentity(b);
    if (!left || !right) return false;
    if (left === right) return true;
    const compactLeft = normalizeMatchKey(left);
    const compactRight = normalizeMatchKey(right);
    return !!compactLeft && !!compactRight && compactLeft === compactRight;
  };

  const selectedDrivers = new Set(
    String(gf?.drivers || "")
      .split(",")
      .map((value) => normalizeDriverIdentity(value))
      .filter(Boolean)
  );

  const selectedDriverMatches = (cardDriver: string, selected: Set<string>) => {
    if (!selected.size) return true;
    const candidate = normalizeDriverIdentity(cardDriver);
    if (!candidate) return false;
    for (const wanted of selected) {
      if (candidate === wanted) return true;
      const score = driverNameSimilarity(candidate, wanted);
      if (score >= 0.82) return true;
      const left = normalizeMatchKey(candidate);
      const right = normalizeMatchKey(wanted);
      if (left && right && (left.startsWith(right) || right.startsWith(left)) && Math.min(left.length, right.length) >= 5) return true;
    }
    return false;
  };

  const cards = routeCards
    .filter((card) => {
      const date = String(card.route_start || card.route_end || "").slice(0, 10);
      return inSelectedPeriod(date);
    })
    .map((card) => {
      const date = String(card.route_start || card.route_end || "").slice(0, 10);
      const aliases = [card.vehicle_key, card.vehicle_num]
        .map(normalizeMatchKey)
        .filter(Boolean);
      if (!date || !aliases.length) return null;

      const allowedDrivers = getOwners(aliases, date);
      const gpsDriver = String(card.display_driver || "").trim();

      // Cards produced by the Landmark hydration pass already carry an
      // evidence-backed GPS identity. Never remap those cards back to a
      // different SAP owner just because the same vehicle had another driver
      // on another day. That re-mapping was one of the paths that turned real
      // drivers into zero after the shared-vehicle reconstruction.
      if (card.match_confidence === "daily-driver" || card.match_confidence === "gps-driver") {
        return { ...card };
      }

      // Exact/fuzzy daily ownership wins for the original vehicle-level cards.
      const direct = [...allowedDrivers.entries()]
        .map(([id, owner]) => ({ id, owner, score: driverNameSimilarity(gpsDriver, owner.display) }))
        .sort((a, b) => b.score - a.score)[0];
      if (direct && direct.score >= 0.5) return { ...card, display_driver: direct.owner.display };

      // If GPS carries a short/variant name, resolve it against the complete
      // SAP roster rather than dropping the card just because the spelling is
      // different (e.g. "Shabeer Ali" vs "Shabeer Ali A.Rahman").
      if (gpsDriver) {
        const roster = new Map<string, Owner>();
        for (const row of ownershipRows) {
          const id = normalizeDriverIdentity(row.driver_name);
          if (!id || roster.has(id)) continue;
          roster.set(id, { identity: id, display: String(row.driver_name || id).trim() || id });
        }
        const resolved = resolveDriverName(gpsDriver, new Map(), new Map([...roster.entries()].map(([id, owner]) => [id, { display: owner.display }])));
        if (resolved) return { ...card, display_driver: resolved.display };
      }

      // A single daily SAP owner is still a safe fallback for GPS rows whose
      // driver field is blank/unknown. Never borrow a driver from another day.
      if (allowedDrivers.size === 1) {
        const owner = [...allowedDrivers.values()][0];
        return { ...card, display_driver: owner.display };
      }

      // Do not throw away a real GPS route card. Keeping it visible is safer
      // than turning a real driver's performance into a false zero.
      return { ...card };
    })
    .filter((card): card is RouteCard => Boolean(card))
    // Apply the Driver slicer only after the GPS/SAP driver identity has been
    // resolved. Otherwise a valid GPS alias can be filtered out before it gets
    // mapped to the selected SAP driver name.
    .filter((card) => selectedDriverMatches(card.display_driver, selectedDrivers));

  const stops=cards.reduce((n,r)=>n+Number(r.stops||0),0);
  const hours=cards.map(r=>{const m=String(r.route_duration_hm||"").match(/(\d+)h\s+(\d+)m/);return m?Number(m[1])+Number(m[2])/60:0;}).filter(n=>n>0);
  const gpsVehicleCount=new Set(cards.map(r=>normalizeMatchKey(r.vehicle_key||r.vehicle_num)).filter(Boolean)).size;

  // Keep a truthful SAP dispatch view available when Landmark/GPS has not
  // been imported for the selected month. The old page exposed only GPS KPIs,
  // so a valid October SAP dataset looked like an entirely empty page.
  // Build this summary from all SAP rows (including zero-box/not-supplied
  // invoices), while respecting the same date and active slicer selections.
  const sapRowsForPeriod = ownershipRows.filter((row) => {
    const date = String(row.dispatch_date || "").slice(0, 10);
    if (!date || (selectedStart && date < selectedStart) || (selectedEnd && date > selectedEnd)) return false;
    return matches(row, gf || EMPTY);
  });
  const sapDriverMap = new Map<string, { invoices: number; boxes: number; vehicles: Set<string>; days: Set<string> }>();
  const sapVehicles = new Set<string>();
  for (const row of sapRowsForPeriod) {
    const name = String(row.driver_name || "").trim() || "Unknown";
    const item = sapDriverMap.get(name) || { invoices: 0, boxes: 0, vehicles: new Set<string>(), days: new Set<string>() };
    item.invoices += 1;
    item.boxes += Number(row.boxes || 0);
    const vehicle = String(row.vehicle_num || row.vehicle_key || "").trim();
    if (vehicle) { item.vehicles.add(vehicle); sapVehicles.add(vehicle); }
    const day = String(row.dispatch_date || "").slice(0, 10);
    if (day) item.days.add(day);
    sapDriverMap.set(name, item);
  }
  const sapDriverSummary = [...sapDriverMap.entries()]
    .map(([driver, item]) => ({ driver, invoices: item.invoices, boxes: item.boxes, vehicles: item.vehicles.size, dispatch_days: item.days.size }))
    .sort((a, b) => b.invoices - a.invoices || a.driver.localeCompare(b.driver));

  const driverMap=new Map<string,{stops:number;hours:number}>();
  for(const r of cards){const d=String(r.display_driver||"Unknown").trim()||"Unknown";const x=driverMap.get(d)||{stops:0,hours:0};x.stops+=Number(r.stops||0);const m=String(r.route_duration_hm||"").match(/(\d+)h\s+(\d+)m/);if(m)x.hours+=Number(m[1])+Number(m[2])/60;driverMap.set(d,x);}
  const chart=[...driverMap.entries()].map(([driver,v])=>({driver,stops:v.stops,hours:round(v.hours)})).sort((a,b)=>b.stops-a.stops);
  return {standalone_mode:false,validation_results:[],kpis:{gps_vehicles:gpsVehicleCount,total_gps_stops:stops,avg_stops_per_vehicle:gpsVehicleCount?round(stops/gpsVehicleCount):0,avg_route_duration_hrs:hours.length?round(hours.reduce((a,b)=>a+b,0)/hours.length):null,avg_stop_duration:"",sap_orders:sapRowsForPeriod.length,sap_total_boxes:sapRowsForPeriod.reduce((n,r)=>n+Number(r.boxes||0),0)},chart_stops:{labels:chart.map(x=>x.driver),values:chart.map(x=>x.stops)},chart_route_hours:{labels:chart.map(x=>x.driver),values:chart.map(x=>x.hours)},route_cards:cards,sap_vehicles:sapVehicles.size,sap_driver_summary:sapDriverSummary};
}

export function buildLocalForEndpoint(endpoint: string, dataset: DashboardLocalDataset, gf?: GlobalFilters): any {
  const rows=filterDashboardRows(dataset,gf); const e=endpoint.replace(/^\//,"");
  if(e.includes("driver-performance")) return buildLocalDriverPerformance(rows,dataset.routeCards,gf,dataset.rows);
  if(e.includes("lead-time")) return buildLocalLeadTime(rows, gf);
  if(e.includes("order-summary")) return buildLocalOrderSummary(rows);
  if(e.includes("area-analytics")) return buildLocalArea(rows);
  if(e.includes("not-supplied")) return buildLocalNotSupplied(rows);
  const filters = gf || EMPTY;
  const allDispatchRows = dataset.rows.filter((r) => {
    const date = String(r.dispatch_date || "");
    if (filters.start_date && (!date || date < filters.start_date)) return false;
    if (filters.end_date && (!date || date > filters.end_date)) return false;
    return matches(r, filters);
  });
  return buildLocalHome(rows,dataset.routeCards,allDispatchRows);
}
