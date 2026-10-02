/**
 * Dashboard local interaction engine.
 *
 * The dashboard's selected date range is loaded once into memory. Subsequent
 * slicer changes are pure JavaScript over that dataset - no Supabase round
 * trip, no per-tab RPC fan-out, and no loading state between filter clicks.
 *
 * Landmark/GPS data stays server-side because it is much larger; the base
 * Driver Performance snapshot is loaded once and its already-aggregated route
 * cards are filtered locally by the SAP vehicles affected by the slicers.
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
let loading: Promise<DashboardLocalDataset> | null = null;
let loadingProgress = 0;
const LOCAL_DB_NAME = "dispatchops-dashboard-local-v3";
const LOCAL_DB_STORE = "dataset";
const LOCAL_DB_KEY = "all-history";
const LOCAL_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const LOCAL_DATASET_VERSION = 2;

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
    let q = client.from("sap_invoice_facts").select(
      "invoice_no,invoice_date,dispatch_date,driver_name,helper_name,customer_name,facility_type,area,division_desc,vehicle_type,vehicle_num,vehicle_key,boxes,normal_boxes,freezer_boxes,not_supplied_reason,salesman"
    );
    if (start) q = q.gte("dispatch_date", start);
    if (end) q = q.lte("dispatch_date", end);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
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
 * this dataset is available. Primary is authoritative for any dispatch date
 * it contains; Secondary is fallback for dates that Primary does not own.
 */
export async function preloadDashboardLocalDataset(_start = "", _end = "", force = false): Promise<DashboardLocalDataset> {
  const key = "ALL";
  if (!force && current?.key === key && current.rows.length) {
    setLoadingProgress(100);
    return current;
  }
  if (loading) return loading;

  loading = (async () => {
    resetLoadingProgress(3);
    if (!force) {
      const persisted = await readPersistentDataset();
      if (persisted && Date.now() - Number(persisted.loadedAt || 0) < LOCAL_CACHE_TTL_MS && persisted.rows.length) {
        current = { ...persisted, key };
        setLoadingProgress(100);
        emit();
        // Return the persistent snapshot immediately. A background refresh is
        // intentionally handled by the realtime/manual Refresh path.
        loading = null;
        return current;
      }
    }

    const clients = getFederatedSupabaseClients();
    const primary = clients[0];
    const secondary = clients[1];
    let primaryRowsLoaded = 0;
    let secondaryRowsLoaded = 0;
    const primaryPromise = fetchRowsForClient(primary, "", "", (n) => {
      primaryRowsLoaded += n;
      setLoadingProgress(Math.min(55, 5 + Math.round(Math.log10(primaryRowsLoaded + 1) * 22)));
    });
    const secondaryPromise = secondary
      ? fetchRowsForClient(secondary, "", "", (n) => {
          secondaryRowsLoaded += n;
          setLoadingProgress(Math.min(65, 28 + Math.round(Math.log10(primaryRowsLoaded + secondaryRowsLoaded + 1) * 22)));
        })
      : Promise.resolve([] as LocalSapRow[]);
    const routePromise = fetchDashboardEndpoint<PerfData>(`/dashboard/driver-performance`);
    const fleetPromise = primary.from("vehicles").select("number,type,status");
    const [primaryRows, secondaryRows, routeResult, fleetVehicles] = await Promise.all([
      primaryPromise, secondaryPromise, routePromise, fleetPromise,
    ]);
    setLoadingProgress(82);
    // Fleet vehicle metadata is used only to canonicalize Pickup/Van. If the
    // master table is temporarily unavailable, keep the analytical dataset
    // usable and fall back to the SAP vehicle type already present on each row.
    const fleetVehicleRows = fleetVehicles.error ? [] : (fleetVehicles.data || []);

    // Fallback semantics: when Primary owns a dispatch date, do not double-count
    // Secondary rows from that same date. Secondary contributes dates Primary
    // does not contain. This preserves the app's Primary -> Secondary model.
    const typedPrimaryRows = primaryRows as LocalSapRow[];
    const typedSecondaryRows = secondaryRows as LocalSapRow[];
    const primaryDates = new Set(typedPrimaryRows.map((r: LocalSapRow) => String(r.dispatch_date || "")).filter(Boolean));
    const rowsRaw: LocalSapRow[] = typedPrimaryRows.concat(typedSecondaryRows.filter((r: LocalSapRow) => !primaryDates.has(String(r.dispatch_date || ""))));

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
    current = { key, rows, routeCards: routeResult.route_cards || [], loadedAt: Date.now(), datasetVersion: LOCAL_DATASET_VERSION };
    setLoadingProgress(100);
    loading = null;
    emit();
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

export function buildLocalHome(rows: LocalSapRow[], routeCards: RouteCard[]): HomeDashboard {
  const drivers = new Map<string, { driver_name: string; vehicle_num: string; vehicle_type: string; orders: number; boxes: number; freezer: number; not_supplied: number }>();
  const facilities = new Map<string, number>();
  const vehicleTypes = new Map<string, { normal: number; freezer: number }>();
  const customers = new Set<string>();
  const vehicles = new Set<string>();
  let boxes = 0, normal = 0, freezer = 0, notSupplied = 0, leadTotal = 0, leadCount = 0;
  for (const r of rows) {
    boxes += r.boxes; normal += r.normal_boxes; freezer += r.freezer_boxes;
    if (r.not_supplied_reason) notSupplied++;
    if (r.customer_name) customers.add(r.customer_name);
    if (r.vehicle_key) vehicles.add(r.vehicle_key);
    if (r.facility_type) facilities.set(r.facility_type, (facilities.get(r.facility_type) || 0) + 1);
    if (r.vehicle_type) { const v = vehicleTypes.get(r.vehicle_type) || { normal: 0, freezer: 0 }; v.normal += r.normal_boxes; v.freezer += r.freezer_boxes; vehicleTypes.set(r.vehicle_type, v); }
    if (r.driver_name) { const d = drivers.get(r.driver_name) || { driver_name: r.driver_name, vehicle_num: r.vehicle_num || "-", vehicle_type: r.vehicle_type, orders: 0, boxes: 0, freezer: 0, not_supplied: 0 }; d.orders++; d.boxes += r.boxes; d.freezer += r.freezer_boxes; if (r.not_supplied_reason) d.not_supplied++; drivers.set(r.driver_name, d); }
    const days = dayDiff(r.invoice_date, r.dispatch_date); if (days !== null && days >= 0) { leadTotal += days; leadCount++; }
  }
  const driverRows = [...drivers.values()].sort((a, b) => b.boxes - a.boxes);
  const selectedVehicles = new Set(rows.map((r) => r.vehicle_key).filter(Boolean));
  const rowDates = rows.map((r) => String(r.dispatch_date || "")).filter(Boolean).sort();
  const perf = routeCards.filter((r) => selectedVehicles.has(String(r.vehicle_key || "")) && routeInDateRange(r, rowDates[0], rowDates[rowDates.length - 1]));
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
    kpis:{total_invoices:lead.length,overall_avg_days:lead.length?round(lead.reduce((a,x)=>a+x.days,0)/lead.length):null,fastest_days:lead.length?Math.min(...lead.map(x=>x.days)):null,longest_days:lead.length?Math.max(...lead.map(x=>x.days)):null},
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

export function buildLocalDriverPerformance(rows: LocalSapRow[], routeCards: RouteCard[], gf?: GlobalFilters): PerfData {
  // Driver Performance must be date-aware. Overview/SAP rows are filtered by
  // dispatch_date, but GPS route cards are vehicle-level and can contain the
  // same vehicle/driver across many months. Matching only by vehicle lets an
  // August GPS card leak into a September driver selection, especially when a
  // second driver is selected and that vehicle is also present in the scope.
  // Build ownership at VEHICLE + DATE first, then resolve the GPS driver.
  const driversByVehicleDate = new Map<string, Map<string, Map<string, string>>>();
  for (const row of rows) {
    const vehicle = String(row.vehicle_key || "").trim();
    const date = String(row.dispatch_date || "").slice(0, 10);
    const driver = normalizeDriverIdentity(row.driver_name);
    if (!vehicle || !date || !driver) continue;
    const byDate = driversByVehicleDate.get(vehicle) || new Map<string, Map<string, string>>();
    const byDriver = byDate.get(date) || new Map<string, string>();
    if (!byDriver.has(driver)) byDriver.set(driver, String(row.driver_name || "").trim());
    byDate.set(date, byDriver);
    driversByVehicleDate.set(vehicle, byDate);
  }

  const selectedStart = String(gf?.start_date || "");
  const selectedEnd = String(gf?.end_date || "");
  const cards = routeCards
    .filter((card) => {
      const date = String(card.route_start || card.route_end || "").slice(0, 10);
      if (!date) return false;
      if (selectedStart && date < selectedStart) return false;
      if (selectedEnd && date > selectedEnd) return false;
      return true;
    })
    .map((card) => {
      const vehicle = String(card.vehicle_key || "").trim();
      const date = String(card.route_start || card.route_end || "").slice(0, 10);
      const allowedDrivers = driversByVehicleDate.get(vehicle)?.get(date);
      if (!vehicle || !date || !allowedDrivers?.size) return null;

      const gpsDriver = normalizeDriverIdentity(card.display_driver);
      if (gpsDriver && allowedDrivers.has(gpsDriver)) return card;

      // Only repair an unambiguous GPS/SAP display-name mismatch for THIS
      // vehicle on THIS date. Never fall back to another month's ownership.
      if (allowedDrivers.size !== 1) return null;
      const [driver] = [...allowedDrivers.entries()];
      return { ...card, display_driver: driver[1] };
    })
    .filter((card): card is RouteCard => Boolean(card));

  const stops=cards.reduce((n,r)=>n+Number(r.stops||0),0);
  const hours=cards.map(r=>{const m=String(r.route_duration_hm||"").match(/(\d+)h\s+(\d+)m/);return m?Number(m[1])+Number(m[2])/60:0;}).filter(n=>n>0);
  const driverMap=new Map<string,{stops:number;hours:number}>();
  for(const r of cards){const d=String(r.display_driver||"Unknown").trim()||"Unknown";const x=driverMap.get(d)||{stops:0,hours:0};x.stops+=Number(r.stops||0);const m=String(r.route_duration_hm||"").match(/(\d+)h\s+(\d+)m/);if(m)x.hours+=Number(m[1])+Number(m[2])/60;driverMap.set(d,x);}
  const chart=[...driverMap.entries()].map(([driver,v])=>({driver,stops:v.stops,hours:round(v.hours)})).sort((a,b)=>b.stops-a.stops);
  return {standalone_mode:false,validation_results:[],kpis:{gps_vehicles:cards.length,total_gps_stops:stops,avg_stops_per_vehicle:cards.length?round(stops/cards.length):0,avg_route_duration_hrs:hours.length?round(hours.reduce((a,b)=>a+b,0)/hours.length):null,avg_stop_duration:"",sap_orders:rows.length,sap_total_boxes:rows.reduce((n,r)=>n+r.boxes,0)},chart_stops:{labels:chart.map(x=>x.driver),values:chart.map(x=>x.stops)},chart_route_hours:{labels:chart.map(x=>x.driver),values:chart.map(x=>x.hours)},route_cards:cards};
}

export function buildLocalForEndpoint(endpoint: string, dataset: DashboardLocalDataset, gf?: GlobalFilters): any {
  const rows=filterDashboardRows(dataset,gf); const e=endpoint.replace(/^\//,"");
  if(e.includes("driver-performance")) return buildLocalDriverPerformance(rows,dataset.routeCards,gf);
  if(e.includes("lead-time")) return buildLocalLeadTime(rows, gf);
  if(e.includes("order-summary")) return buildLocalOrderSummary(rows);
  if(e.includes("area-analytics")) return buildLocalArea(rows);
  if(e.includes("not-supplied")) return buildLocalNotSupplied(rows);
  return buildLocalHome(rows,dataset.routeCards);
}
