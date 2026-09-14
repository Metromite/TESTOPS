/**
 * services/dashboardKpis.ts
 * ---------------------------
 * SUPABASE PORT of the old FastAPI backend's `services/dashboard_kpis.py`
 * (Home tab only - see that file's own module docstring for why the other
 * dashboard tabs, e.g. Lead Time, Order Summary, Area Analytics, were
 * never in scope for this file even in the OLD version). Every function
 * below is a line-for-line port of its Python counterpart, kept under the
 * SAME function name (translated to camelCase) specifically so this file
 * can be diffed against dashboard_kpis.py to verify nothing was
 * reinterpreted along the way.
 *
 * ARCHITECTURE NOTE: the old backend did `db.query(...).filter(...)` (SQL)
 * for the cheap, static parts (date range, single-driver match) and then
 * almost everything else - Global Filters, Dashboard Configuration
 * exclusions, driver/area/vehicle authoritative-list restriction, all KPI
 * arithmetic, chart bucketing - in plain Python over the already-fetched
 * rows. This port keeps that same split: a narrow Supabase query for the
 * date range (the one thing worth pushing to the database), then the rest
 * in TypeScript over the returned rows, in the same order the Python
 * did it, computing the same numbers.
 *
 * PERFORMANCE NOTE: like the original, this pulls every matching
 * sap_invoice_facts / landmark_visit_facts row across the wire before
 * computing anything - there is no server-side aggregation. That was true
 * of the old backend too (it just did the same fetch-then-aggregate one
 * network hop closer to the database). For a dataset that's grown large
 * enough for this to matter, the fix is a Postgres materialized view or
 * RPC that pre-aggregates - deliberately not attempted here, since doing
 * that correctly needs the same care and real-data verification as the
 * rest of this port, not a rewrite bolted on top of an already-large
 * change.
 */
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilterParams {
  driver: string;
  drivers: string; // comma-separated
  areas: string;
  division: string;
  route_type: string;
  vehicle_type: string;
  facility_type: string;
  salesman: string;
  start_date: string;
  end_date: string;
}

interface SapRow {
  invoice_no: string;
  invoice_date: string | null;
  dispatch_date: string | null;
  driver_name: string;
  helper_name: string;
  vehicle_num: string;
  vehicle_key: string;
  vehicle_type: string;
  customer_name: string;
  area: string;
  division_desc: string;
  facility_type: string;
  salesman: string;
  boxes: number;
  normal_boxes: number;
  freezer_boxes: number;
  not_supplied_reason: string;
  [key: string]: unknown;
}

interface LandmarkRow {
  vehicle_key: string;
  customer_name: string;
  arrival: string;
  departure: string;
  is_passthrough: boolean;
  is_depot: boolean;
}

interface ConfigRule {
  rule_type: string;
  value: string;
  operator: string; // contains|starts_with|ends_with|exact|regex
  negate: boolean;
  logic: string; // AND|OR
}

interface AreaRow {
  name: string;
  sector: string;
  route_type: string;
  vehicle_type: string;
}

export interface Kpis {
  valid_invoices: number;
  total_boxes: number;
  freezer_boxes: number;
  normal_boxes: number;
  active_drivers: number;
  avg_boxes_per_driver: number;
  not_supplied: number;
  avg_lead_time_days: number | null;
  unique_customers: number;
  avg_route_hours: number | null;
  orders_per_driver: number;
  active_vehicles: number;
}
export interface DriverRow {
  driver_name: string;
  vehicle_num: string;
  vehicle_type: string;
  orders: number;
  boxes: number;
  freezer: number;
  not_supplied: number;
}
export interface Charts {
  driver_boxes: { labels: string[]; values: number[] };
  facility: { labels: string[]; values: number[] };
  vantype: { labels: string[]; normal: number[]; freezer: number[] };
  returns: { delivered: number; not_supplied: number };
}
export interface HomeDashboard {
  kpis: Kpis;
  driver_overview: DriverRow[];
  charts: Charts;
}
export interface HomeDetailResponse {
  metric: string;
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  total_matching: number;
}

type HomeRpcCacheEntry = { value?: HomeDashboard; promise?: Promise<HomeDashboard>; expires: number };
const homeRpcCache = new Map<string, HomeRpcCacheEntry>();
const HOME_RPC_CACHE_MS = 30_000;

function homeFilterJson(f: FilterParams): Record<string, unknown> {
  const list = (v: string) => String(v || "").split(",").map(x => x.trim()).filter(Boolean);
  return {
    driver: f.driver || "", drivers: list(f.drivers), areas: list(f.areas), division: list(f.division),
    route_type: list(f.route_type), vehicle_type: list(f.vehicle_type), facility_type: list(f.facility_type),
    salesman: list(f.salesman), lead_time_band: "", classification: "",
  };
}

function homeRpcKey(f: FilterParams): string {
  return JSON.stringify([f.start_date,f.end_date,f.driver,f.drivers,f.areas,f.division,f.route_type,f.vehicle_type,f.facility_type,f.salesman]);
}

function mergeHomeSnapshots(parts: any[]): HomeDashboard {
  if (parts.length === 1) return parts[0] as HomeDashboard;
  const num = (v: unknown) => Number(v || 0);
  const driverMap = new Map<string, any>();
  for (const p of parts) for (const r of (p?.driver_overview || [])) {
    const k = String(r.driver_name || "");
    if (!k) continue;
    const old = driverMap.get(k);
    if (!old) driverMap.set(k, { ...r });
    else { old.orders=num(old.orders)+num(r.orders); old.boxes=num(old.boxes)+num(r.boxes); old.freezer=num(old.freezer)+num(r.freezer); old.not_supplied=num(old.not_supplied)+num(r.not_supplied); if ((!old.vehicle_num || old.vehicle_num==='-') && r.vehicle_num) old.vehicle_num=r.vehicle_num; }
  }
  const drivers=[...driverMap.values()].sort((a,b)=>num(b.boxes)-num(a.boxes));
  const facilityMap=new Map<string,number>();
  const vtMap=new Map<string,{normal:number;freezer:number}>();
  let valid=0,totalBoxes=0,freezer=0,normal=0,notSup=0,customers=0,activeVehicles=0;
  let leadWeighted=0,leadWeight=0,routeWeighted=0,routeWeight=0;
  for(const p of parts){
    const k=p?.kpis||{}; valid+=num(k.valid_invoices); totalBoxes+=num(k.total_boxes); freezer+=num(k.freezer_boxes); normal+=num(k.normal_boxes); notSup+=num(k.not_supplied); customers+=num(k.unique_customers); activeVehicles+=num(k.active_vehicles);
    if(k.avg_lead_time_days!==null&&k.avg_lead_time_days!==undefined){leadWeighted+=num(k.avg_lead_time_days)*num(k.valid_invoices); leadWeight+=num(k.valid_invoices);}
    if(k.avg_route_hours!==null&&k.avg_route_hours!==undefined){routeWeighted+=num(k.avg_route_hours); routeWeight+=1;}
    const fc=p?.charts?.facility; for(let i=0;i<(fc?.labels||[]).length;i++){const label=String(fc.labels[i]);facilityMap.set(label,(facilityMap.get(label)||0)+num(fc.values?.[i]));}
    const vc=p?.charts?.vantype; for(let i=0;i<(vc?.labels||[]).length;i++){const label=String(vc.labels[i]);const x=vtMap.get(label)||{normal:0,freezer:0};x.normal+=num(vc.normal?.[i]);x.freezer+=num(vc.freezer?.[i]);vtMap.set(label,x);}
  }
  const activeDrivers=drivers.length;
  const facilityLabels=[...facilityMap.keys()].sort(); const vtLabels=[...vtMap.keys()].sort();
  return {
    kpis:{valid_invoices:valid,total_boxes:totalBoxes,freezer_boxes:freezer,normal_boxes:normal,active_drivers:activeDrivers,avg_boxes_per_driver:activeDrivers?Math.round(totalBoxes/activeDrivers*10)/10:0,not_supplied:notSup,avg_lead_time_days:leadWeight?Math.round(leadWeighted/leadWeight*10)/10:null,unique_customers:customers,avg_route_hours:routeWeight?Math.round(routeWeighted/routeWeight*10)/10:null,orders_per_driver:activeDrivers?Math.round(valid/activeDrivers*10)/10:0,active_vehicles:activeVehicles},
    driver_overview:drivers,
    charts:{driver_boxes:{labels:drivers.map(r=>r.driver_name),values:drivers.map(r=>num(r.boxes))},facility:{labels:facilityLabels,values:facilityLabels.map(x=>facilityMap.get(x)||0)},vantype:{labels:vtLabels,normal:vtLabels.map(x=>vtMap.get(x)?.normal||0),freezer:vtLabels.map(x=>vtMap.get(x)?.freezer||0)},returns:{delivered:valid-notSup,not_supplied:notSup}}
  };
}

async function fetchHomeDashboardRpc(f: FilterParams): Promise<HomeDashboard> {
  const key=homeRpcKey(f); const now=Date.now(); const hit=homeRpcCache.get(key);
  if(hit && hit.expires>now){if(hit.value)return hit.value;if(hit.promise)return hit.promise;}
  const promise=(async()=>{
    const { getFederatedSupabaseClients } = await import("@/lib/supabase");
    const filters=homeFilterJson(f);
    const parts=await Promise.all(getFederatedSupabaseClients().map(async(client:any)=>{
      const {data,error}=await client.rpc("dispatchops_dashboard_home_snapshot",{p_start:f.start_date||null,p_end:f.end_date||null,p_filters:filters});
      if(error) throw new Error(error.message); return data||{};
    }));
    return mergeHomeSnapshots(parts);
  })();
  homeRpcCache.set(key,{promise,expires:now+60_000});
  try{const value=await promise;homeRpcCache.set(key,{value,expires:Date.now()+HOME_RPC_CACHE_MS});return value;}catch(e){homeRpcCache.delete(key);throw e;}
}

// ---------------------------------------------------------------------------
// Small helpers - direct ports of the Python module's private helpers
// ---------------------------------------------------------------------------

/** Direct port of normalize_vehicle() (services/identity_engine.py). */
function normalizeVehicle(v: string | null | undefined): string {
  if (!v) return "";
  return String(v).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

/** Direct port of _parse_arrival_datetime(). */
function parseArrivalDatetime(arrivalStr: string | null | undefined): Date | null {
  if (!arrivalStr) return null;
  const s = String(arrivalStr).trim();
  let y: number | null = null, mo: number | null = null, d: number | null = null;

  let m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})/);
  if (m) {
    const mon = MONTHS[m[2].toUpperCase().slice(0, 3)];
    if (mon) { d = parseInt(m[1], 10); mo = mon; y = parseInt(m[3], 10); }
  }
  if (y === null) {
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) { d = parseInt(m[1], 10); mo = parseInt(m[2], 10); y = parseInt(m[3], 10); }
  }
  if (y === null) {
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) { y = parseInt(m[1], 10); mo = parseInt(m[2], 10); d = parseInt(m[3], 10); }
  }
  if (y === null || mo === null || d === null) return null;

  const tm = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/);
  const h = tm ? parseInt(tm[1], 10) : 0;
  const mi = tm ? parseInt(tm[2], 10) : 0;
  const se = tm && tm[3] ? parseInt(tm[3], 10) : 0;
  const dt = new Date(y, mo - 1, d, h, mi, se);
  return isNaN(dt.getTime()) ? null : dt;
}

/** Direct port of _is_depot_landmark() - the depot-detection keyword is a
 * literal piece of this company's business data (their own depot's name
 * in the Landmark GPS system), copied exactly, not a generic algorithm. */
function isDepotLandmark(customerName: string | null | undefined): boolean {
  const up = (customerName || "").toUpperCase();
  return up.includes("CITY PHARMACY") && up.includes("IND");
}

/** Direct port of _build_driver_perf(). */
function buildDriverPerf(sapRows: SapRow[]) {
  const driverMap = new Map<string, { driver_name: string; helper_name: string; vehicle_num: string; vehicle_key: string; vehicle_type: string; invoices: number; boxes: number; normal: number; freezer: number }>();
  for (const r of sapRows) {
    const name = r.driver_name || "Unknown";
    let d = driverMap.get(name);
    if (!d) {
      d = { driver_name: name, helper_name: r.helper_name, vehicle_num: r.vehicle_num, vehicle_key: r.vehicle_key, vehicle_type: r.vehicle_type, invoices: 0, boxes: 0, normal: 0, freezer: 0 };
      driverMap.set(name, d);
    }
    d.invoices += 1;
    d.boxes += r.boxes || 0;
    d.normal += r.normal_boxes || 0;
    d.freezer += r.freezer_boxes || 0;
  }
  return driverMap;
}

/** Direct port of _build_lm_route_map() - per-vehicle route start (depot
 * departure) to end (last delivery stop departure), for Avg Route Hours. */
function buildLmRouteMap(lmRows: LandmarkRow[]) {
  const byVehicle = new Map<string, LandmarkRow[]>();
  for (const r of lmRows) {
    if (!r.vehicle_key) continue;
    if (!byVehicle.has(r.vehicle_key)) byVehicle.set(r.vehicle_key, []);
    byVehicle.get(r.vehicle_key)!.push(r);
  }

  const routeMap = new Map<string, { route_duration_minutes: number; stops: number }>();
  for (const [vkey, rows] of byVehicle) {
    const rowsSorted = [...rows].sort((a, b) => {
      const da = parseArrivalDatetime(a.arrival)?.getTime() ?? -Infinity;
      const db_ = parseArrivalDatetime(b.arrival)?.getTime() ?? -Infinity;
      return da - db_;
    });
    const depotRows = rowsSorted.filter((r) => isDepotLandmark(r.customer_name));
    const stopRows = rowsSorted.filter((r) => !r.is_passthrough && !r.is_depot && !isDepotLandmark(r.customer_name));

    let routeStart: Date | null = null;
    const departingDepot = depotRows.find((r) => r.departure && r.departure !== "-");
    if (departingDepot) routeStart = parseArrivalDatetime(departingDepot.departure);

    const routeEnd = stopRows.length ? parseArrivalDatetime(stopRows[stopRows.length - 1].departure) : null;

    const routeDuration =
      routeStart && routeEnd && routeEnd.getTime() > routeStart.getTime()
        ? Math.round((routeEnd.getTime() - routeStart.getTime()) / 60000)
        : 0;
    routeMap.set(vkey, { route_duration_minutes: routeDuration, stops: stopRows.length });
  }
  return routeMap;
}

// ---------------------------------------------------------------------------
// Authoritative reference lists (Fleet Database Drivers / Areas / Vehicles)
// ---------------------------------------------------------------------------

async function fetchFleetDriverNames(): Promise<Set<string>> {
  const { data, error } = await supabase.from("drivers").select("name");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((d: any) => d.name).filter(Boolean));
}

async function fetchValidAreas(): Promise<AreaRow[]> {
  const { data, error } = await supabase.from("areas").select("name,sector,route_type,vehicle_type");
  if (error) throw new Error(error.message);
  return (data ?? []) as AreaRow[];
}

/** Direct port of _valid_vehicle_keys() - restricts which vehicle
 * identities count as "active"/listed to real, currently-registered
 * Fleet Database vehicles (see that function's docstring in the Python
 * original for why this is scoped to just the active_vehicles KPI rather
 * than a row-level filter on every query). */
async function fetchValidVehicleKeys(): Promise<Set<string>> {
  const { data, error } = await supabase.from("vehicles").select("number");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((v: any) => normalizeVehicle(v.number)).filter(Boolean));
}

async function fetchFleetVehicleMap(): Promise<Map<string, { number: string; type: string }>> {
  const { data, error } = await supabase.from("vehicles").select("number,type");
  if (error) throw new Error(error.message);
  const map = new Map<string, { number: string; type: string }>();
  for (const v of data ?? []) {
    const key = normalizeVehicle(v.number);
    if (!key) continue;
    map.set(key, { number: String(v.number || "").trim(), type: String(v.type || "").trim() });
  }
  return map;
}

async function fetchConfigRules(): Promise<ConfigRule[]> {
  const { data, error } = await supabase
    .from("dashboard_config_rules")
    .select("rule_type,value,operator,negate,logic")
    .neq("rule_type", "setting");
  if (error) throw new Error(error.message);
  return (data ?? []) as ConfigRule[];
}

// ---------------------------------------------------------------------------
// Global Filters + Dashboard Configuration exclusions
// (direct ports of apply_global_filters() / apply_dashboard_config_exclusions())
// ---------------------------------------------------------------------------

function csvList(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Dashboard-only data-quality rule: placeholder/unknown dimensions must never
 * appear in KPI cards, charts, slicers, or dashboard totals. Raw imported data
 * is intentionally preserved; this only excludes it from dashboard calculations. */
function isUnknownDimension(value: unknown): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return !v || ["unknown", "unclassified", "n/a", "na", "not available", "not available/unknown"].includes(v);
}

function hasValidDashboardClassification(r: SapRow): boolean {
  return !isUnknownDimension(r.facility_type) || !isUnknownDimension(r.division_desc);
}

/** Direct port of apply_global_filters() - Power-BI-style slicers. */
function applyGlobalFilters(rows: SapRow[], f: FilterParams, areas: AreaRow[]): SapRow[] {
  let out = rows.filter((r) => !isUnknownDimension(r.division_desc) && hasValidDashboardClassification(r));
  const driverList = csvList(f.drivers);
  if (driverList.length) out = out.filter((r) => driverList.includes(r.driver_name));
  const areaList = csvList(f.areas);
  if (areaList.length) out = out.filter((r) => areaList.includes(r.area));
  const divisionList = csvList(f.division);
  if (divisionList.length) out = out.filter((r) => divisionList.includes(r.division_desc));
  const facilityList = csvList(f.facility_type);
  if (facilityList.length) out = out.filter((r) => facilityList.includes(r.facility_type));
  const salesmanList = csvList(f.salesman);
  if (salesmanList.length) out = out.filter((r) => salesmanList.includes(r.salesman));

  const routeTypes = new Set(csvList(f.route_type));
  const vehicleTypes = new Set(csvList(f.vehicle_type));
  if (routeTypes.size || vehicleTypes.size) {
    const matchingAreaNames = new Set(
      areas
        .filter((a) => (routeTypes.size === 0 || routeTypes.has(a.route_type)) && (vehicleTypes.size === 0 || vehicleTypes.has(a.vehicle_type)))
        .map((a) => a.name)
    );
    out = matchingAreaNames.size ? out.filter((r) => matchingAreaNames.has(r.area)) : [];
  }
  return out;
}

/** One rule -> does `value` match it (before `negate` is applied).
 * Direct port of _condition()/_python_match(). */
function ruleMatches(value: string, rule: ConfigRule): boolean {
  const v = value ?? "";
  const needle = rule.value;
  switch (rule.operator) {
    case "starts_with": return v.startsWith(needle);
    case "ends_with": return v.endsWith(needle);
    case "exact": return v === needle;
    case "regex":
      try { return new RegExp(needle).test(v); } catch { return false; }
    default: return v.includes(needle); // "contains"
  }
}

function ruleMatchesSigned(value: string, rule: ConfigRule): boolean {
  const m = ruleMatches(value, rule);
  return rule.negate ? !m : m;
}

/** One rule_type's worth of rules -> true if the row should be EXCLUDED,
 * combining AND-logic rules together and OR-logic rules together, same as
 * _apply()'s and_rows/or_rows split. */
function typeExcludes(value: string, rulesOfType: ConfigRule[]): boolean {
  if (rulesOfType.length === 0) return false;
  const andRows = rulesOfType.filter((r) => r.logic === "AND");
  const orRows = rulesOfType.filter((r) => r.logic !== "AND");
  const clauses: boolean[] = [];
  if (andRows.length) clauses.push(andRows.every((r) => ruleMatchesSigned(value, r)));
  for (const r of orRows) clauses.push(ruleMatchesSigned(value, r));
  const matchExpr = clauses.some(Boolean);
  return matchExpr;
}

/** Direct port of apply_dashboard_config_exclusions(). */
function applyDashboardConfigExclusions(rows: SapRow[], rules: ConfigRule[], areas: AreaRow[]): SapRow[] {
  const byType = (t: string) => rules.filter((r) => r.rule_type === t);

  let out = rows.filter((r) => !typeExcludes(r.invoice_no, byType("invoice_prefix")));
  out = out.filter((r) => !typeExcludes(r.area, byType("area")));
  out = out.filter((r) => !typeExcludes(r.customer_name, byType("customer")));
  out = out.filter((r) => !typeExcludes(r.facility_type, byType("facility")));
  out = out.filter((r) => !typeExcludes(r.salesman, byType("salesman")));
  out = out.filter((r) => !typeExcludes(r.driver_name, byType("driver")));

  // invoice_range: numeric range on invoice_no, value "START-END", only
  // ever matches rows whose invoice_no is purely numeric.
  const rangeRows = byType("invoice_range");
  if (rangeRows.length) {
    const ranges = rangeRows
      .map((r) => {
        const parts = r.value.split("-");
        if (parts.length !== 2) return null;
        const lo = parseInt(parts[0].trim(), 10);
        const hi = parseInt(parts[1].trim(), 10);
        if (isNaN(lo) || isNaN(hi)) return null;
        return { lo, hi, negate: r.negate };
      })
      .filter((x): x is { lo: number; hi: number; negate: boolean } => x !== null);
    if (ranges.length) {
      out = out.filter((r) => {
        if (!/^\d+$/.test(r.invoice_no || "")) return true; // non-numeric, never matched
        const n = parseInt(r.invoice_no, 10);
        const matches = ranges.map((rg) => {
          const inRange = n >= rg.lo && n <= rg.hi;
          return rg.negate ? !inRange : inRange;
        });
        return !matches.some(Boolean);
      });
    }
  }

  // vehicle_type / route_type: resolved via the current Areas Database,
  // same join apply_global_filters uses.
  const vtRows = byType("vehicle_type");
  const rtRows = byType("route_type");
  if (vtRows.length || rtRows.length) {
    const allAreaNames = new Set(areas.map((a) => a.name));
    const excludedAreaNames = new Set<string>();
    for (const r of vtRows) {
      const hit = new Set(areas.filter((a) => ruleMatches(a.vehicle_type || "", r)).map((a) => a.name));
      if (r.negate) { for (const n of allAreaNames) if (!hit.has(n)) excludedAreaNames.add(n); }
      else { for (const n of hit) excludedAreaNames.add(n); }
    }
    for (const r of rtRows) {
      const hit = new Set(areas.filter((a) => ruleMatches(a.route_type || "", r)).map((a) => a.name));
      if (r.negate) { for (const n of allAreaNames) if (!hit.has(n)) excludedAreaNames.add(n); }
      else { for (const n of hit) excludedAreaNames.add(n); }
    }
    if (excludedAreaNames.size) out = out.filter((r) => !excludedAreaNames.has(r.area));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Shared filtered-rows builder - direct port of build_filtered_sap_query()
// ---------------------------------------------------------------------------

/** Fetches sap_invoice_facts for the date range / single-driver match at
 * the database level (the one thing worth pushing to SQL - see file
 * header), then applies every other rule from build_filtered_sap_query()
 * in the same order the Python did: Global Filters, Dashboard
 * Configuration exclusions, Fleet-Database-authoritative driver
 * restriction, Area-Database-authoritative area restriction. */
async function buildFilteredSapRows(f: FilterParams): Promise<SapRow[]> {
  // Supabase/PostgREST returns at most 1,000 rows per select by default.
  // Dashboard months are much larger than that, so a single select silently
  // under-counted KPIs and charts. Page through the entire filtered range.
  const PAGE = 1000;
  const allRows: SapRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("sap_invoice_facts").select("*");
    if (f.start_date) q = q.gte("dispatch_date", f.start_date);
    if (f.end_date) q = q.lte("dispatch_date", f.end_date);
    if (f.driver) q = q.eq("driver_name", f.driver);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as SapRow[];
    allRows.push(...page);
    if (page.length < PAGE) break;
  }
  let rows = allRows;

  const [areas, fleetDriverNames, configRules, fleetVehicles] = await Promise.all([
    fetchValidAreas(),
    fetchFleetDriverNames(),
    fetchConfigRules(),
    fetchFleetVehicleMap(),
  ]);

  // Fleet Database is authoritative for vehicle identity/type whenever the
  // imported SAP vehicle number matches a registered fleet vehicle.
  rows = rows.map((r) => {
    const fleetKey = normalizeVehicle(r.vehicle_num || r.vehicle_key);
    const fleet = fleetVehicles.get(fleetKey);
    return fleet
      ? { ...r, vehicle_num: fleet.number, vehicle_key: fleetKey, vehicle_type: fleet.type || r.vehicle_type }
      : r;
  });

  rows = applyGlobalFilters(rows, f, areas);
  rows = applyDashboardConfigExclusions(rows, configRules, areas);

  // item 1/4/5/6: Fleet Database Drivers table is the single authoritative
  // driver list for every Dashboard driver-level computation - mandatory,
  // not optional (see build_filtered_sap_query()'s own comment).
  if (fleetDriverNames.size) rows = rows.filter((r) => fleetDriverNames.has(r.driver_name));

  // item 8: Area Database is likewise authoritative for area.
  const validAreaNames = new Set(areas.map((a) => a.name));
  if (validAreaNames.size) rows = rows.filter((r) => validAreaNames.has(r.area));

  return rows;
}

// ---------------------------------------------------------------------------
// KPI computation - direct ports of compute_home_kpis_fast() / compute_home_dashboard()
// ---------------------------------------------------------------------------

function computeLeadTimeDays(rows: SapRow[]): number | null {
  const diffs: number[] = [];
  for (const r of rows) {
    if (r.invoice_date && r.dispatch_date) {
      const d1 = new Date(r.invoice_date);
      const d2 = new Date(r.dispatch_date);
      if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
        const diff = Math.round((d2.getTime() - d1.getTime()) / 86400000);
        // item 7: negative lead time (dispatch before invoice date) is a
        // bad/invalid record and must never enter any lead time average.
        if (diff >= 0) diffs.push(diff);
      }
    }
  }
  return diffs.length ? Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 10) / 10 : null;
}

/** Direct port of compute_home_kpis_fast() - everything except
 * avg_route_hours (which needs the separate, larger landmark_visit_facts
 * fetch - see the Python docstring for why that's split out here too). */
export async function computeHomeKpisFast(f: FilterParams): Promise<Kpis> {
  // Normal path: one compact PostgreSQL RPC. Keep the legacy calculation only
  // when custom Dashboard Configuration exclusion rules are actually active,
  // so those user-defined rules remain exact.
  const rules = await fetchConfigRules();
  if (rules.length === 0) return (await fetchHomeDashboardRpc(f)).kpis;
  const sapRows = await buildFilteredSapRows(f);

  const totalInvoices = sapRows.length;
  const totalBoxes = sapRows.reduce((s, r) => s + (r.boxes || 0), 0);
  const totalNormal = sapRows.reduce((s, r) => s + (r.normal_boxes || 0), 0);
  const totalFreezer = sapRows.reduce((s, r) => s + (r.freezer_boxes || 0), 0);
  const activeDrivers = new Set(sapRows.map((r) => r.driver_name).filter(Boolean)).size;
  const notSuppliedCount = sapRows.filter((r) => r.not_supplied_reason).length;
  const uniqueCustomers = new Set(sapRows.map((r) => r.customer_name).filter(Boolean)).size;

  const validVehicleKeys = await fetchValidVehicleKeys();
  const activeVehicles = new Set(sapRows.filter((r) => r.vehicle_key && validVehicleKeys.has(r.vehicle_key)).map((r) => r.vehicle_key)).size;

  return {
    valid_invoices: totalInvoices,
    total_boxes: totalBoxes,
    freezer_boxes: totalFreezer,
    normal_boxes: totalNormal,
    active_drivers: activeDrivers,
    avg_boxes_per_driver: activeDrivers ? Math.round((totalBoxes / activeDrivers) * 10) / 10 : 0,
    not_supplied: notSuppliedCount,
    avg_lead_time_days: computeLeadTimeDays(sapRows),
    unique_customers: uniqueCustomers,
    avg_route_hours: null, // deliberately omitted - filled in by computeHomeDashboard()
    orders_per_driver: activeDrivers ? Math.round((totalInvoices / activeDrivers) * 10) / 10 : 0,
    active_vehicles: activeVehicles,
  };
}

/** Direct port of compute_home_dashboard() - full Home tab payload: KPIs
 * (including avg_route_hours), Driver Overview table, and the 4 main
 * charts. */
export async function computeHomeDashboard(f: FilterParams): Promise<HomeDashboard> {
  // Current/default configuration uses the server-side aggregate path. This
  // removes all SAP pagination and the historical full Landmark-table download
  // from every slicer click. If custom exclusion rules are configured, preserve
  // the legacy exact rule engine as a compatibility fallback.
  const rules = await fetchConfigRules();
  if (rules.length === 0) return fetchHomeDashboardRpc(f);
  const sapRows = await buildFilteredSapRows(f);

  // V1's lmRows isn't independently date-filtered by this same range in
  // the reviewed Python code path either - fetched in full, same as there.
  const { data: lmData, error: lmErr } = await supabase
    .from("landmark_visit_facts")
    .select("vehicle_key,customer_name,arrival,departure,is_passthrough,is_depot");
  if (lmErr) throw new Error(lmErr.message);
  const lmRows = (lmData ?? []) as LandmarkRow[];

  const totalInvoices = sapRows.length;
  const totalBoxes = sapRows.reduce((s, r) => s + (r.boxes || 0), 0);
  const totalNormal = sapRows.reduce((s, r) => s + (r.normal_boxes || 0), 0);
  const totalFreezer = sapRows.reduce((s, r) => s + (r.freezer_boxes || 0), 0);
  const activeDrivers = new Set(sapRows.map((r) => r.driver_name).filter(Boolean)).size;
  const notSuppliedCount = sapRows.filter((r) => r.not_supplied_reason).length;
  const uniqueCustomers = new Set(sapRows.map((r) => r.customer_name).filter(Boolean)).size;
  const validVehicleKeys = await fetchValidVehicleKeys();
  const activeVehicles = new Set(sapRows.filter((r) => r.vehicle_key && validVehicleKeys.has(r.vehicle_key)).map((r) => r.vehicle_key)).size;
  const avgLeadTimeDays = computeLeadTimeDays(sapRows);

  const routeMap = buildLmRouteMap(lmRows);
  const durations = [...routeMap.values()].map((r) => r.route_duration_minutes).filter((m) => m > 0);
  const avgRouteHours = durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length / 60) * 10) / 10 : null;

  const kpis: Kpis = {
    valid_invoices: totalInvoices,
    total_boxes: totalBoxes,
    freezer_boxes: totalFreezer,
    normal_boxes: totalNormal,
    active_drivers: activeDrivers,
    avg_boxes_per_driver: activeDrivers ? Math.round((totalBoxes / activeDrivers) * 10) / 10 : 0,
    not_supplied: notSuppliedCount,
    avg_lead_time_days: avgLeadTimeDays,
    unique_customers: uniqueCustomers,
    avg_route_hours: avgRouteHours,
    orders_per_driver: activeDrivers ? Math.round((totalInvoices / activeDrivers) * 10) / 10 : 0,
    active_vehicles: activeVehicles,
  };

  // --- Driver Overview table ---
  const driverPerf = buildDriverPerf(sapRows);
  const nsByDriver = new Map<string, number>();
  for (const r of sapRows) if (r.not_supplied_reason) nsByDriver.set(r.driver_name, (nsByDriver.get(r.driver_name) ?? 0) + 1);

  const driverOverview: DriverRow[] = [...driverPerf.values()]
    .map((d) => ({
      driver_name: d.driver_name, vehicle_num: d.vehicle_num || "-", vehicle_type: d.vehicle_type,
      orders: d.invoices, boxes: d.boxes, freezer: d.freezer, not_supplied: nsByDriver.get(d.driver_name) ?? 0,
    }))
    .sort((a, b) => b.boxes - a.boxes);

  // --- 4 main charts --- (no top-15 cap - see the Python file's own
  // BUGFIX note on why that cap was removed)
  const topDrivers = [...driverPerf.values()].sort((a, b) => b.boxes - a.boxes);
  const driverBoxesChart = { labels: topDrivers.map((d) => d.driver_name), values: topDrivers.map((d) => d.boxes) };

  const facilityCounts = new Map<string, number>();
  for (const r of sapRows) facilityCounts.set(r.facility_type, (facilityCounts.get(r.facility_type) ?? 0) + 1);
  const facilityChart = { labels: [...facilityCounts.keys()], values: [...facilityCounts.values()] };

  const vantypeNormal = new Map<string, number>();
  const vantypeFreezer = new Map<string, number>();
  for (const r of sapRows) {
    vantypeNormal.set(r.vehicle_type, (vantypeNormal.get(r.vehicle_type) ?? 0) + (r.normal_boxes || 0));
    vantypeFreezer.set(r.vehicle_type, (vantypeFreezer.get(r.vehicle_type) ?? 0) + (r.freezer_boxes || 0));
  }
  const vanTypes = [...new Set([...vantypeNormal.keys(), ...vantypeFreezer.keys()])].sort();
  const vantypeChart = {
    labels: vanTypes,
    normal: vanTypes.map((v) => vantypeNormal.get(v) ?? 0),
    freezer: vanTypes.map((v) => vantypeFreezer.get(v) ?? 0),
  };

  const returnsChart = { delivered: totalInvoices, not_supplied: notSuppliedCount };

  return { kpis, driver_overview: driverOverview, charts: { driver_boxes: driverBoxesChart, facility: facilityChart, vantype: vantypeChart, returns: returnsChart } };
}

const DETAIL_ROW_LIMIT = 2000;

/** Direct port of get_home_detail_rows(). */
export async function getHomeDetailRows(metric: string, f: FilterParams): Promise<HomeDetailResponse> {
  let rows = await buildFilteredSapRows(f);

  if (metric === "not_supplied") rows = rows.filter((r) => r.not_supplied_reason);
  else if (metric === "freezer_boxes") rows = rows.filter((r) => (r.freezer_boxes || 0) > 0);
  else if (metric === "normal_boxes") rows = rows.filter((r) => (r.normal_boxes || 0) > 0);

  if (metric === "active_drivers" || metric === "unique_customers" || metric === "active_vehicles") {
    const keyFn: Record<string, (r: SapRow) => string> = {
      active_drivers: (r) => r.driver_name,
      unique_customers: (r) => r.customer_name,
      active_vehicles: (r) => r.vehicle_key,
    };
    const agg = new Map<string, { name: string; invoices: number; boxes: number; not_supplied: number }>();
    for (const r of rows) {
      const k = keyFn[metric](r);
      if (!k) continue;
      let e = agg.get(k);
      if (!e) { e = { name: k, invoices: 0, boxes: 0, not_supplied: 0 }; agg.set(k, e); }
      e.invoices += 1;
      e.boxes += r.boxes || 0;
      e.not_supplied += r.not_supplied_reason ? 1 : 0;
    }
    const entityRows = [...agg.values()].sort((a, b) => b.invoices - a.invoices).slice(0, DETAIL_ROW_LIMIT);
    return { metric, columns: ["name", "invoices", "boxes", "not_supplied"], rows: entityRows, truncated: agg.size > DETAIL_ROW_LIMIT, total_matching: agg.size };
  }

  const totalMatching = rows.length;
  const sorted = [...rows].sort((a, b) => (b.dispatch_date || "").localeCompare(a.dispatch_date || "")).slice(0, DETAIL_ROW_LIMIT);
  const columns = ["invoice_no", "dispatch_date", "invoice_date", "driver_name", "helper_name", "vehicle_num", "area", "division_desc", "customer_name", "boxes", "normal_boxes", "freezer_boxes", "not_supplied_reason"];
  const rowDicts = sorted.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]])));
  return { metric, columns, rows: rowDicts, truncated: totalMatching > DETAIL_ROW_LIMIT, total_matching: totalMatching };
}

// ---------------------------------------------------------------------------
// Filter Slicers - direct port of the /dashboard/filter-options route
// ---------------------------------------------------------------------------

export interface FilterOptions {
  divisions: string[];
  facility_types: string[];
  salesmen: string[];
  areas: string[];
  drivers: string[];
}

export interface DashboardFilterMeta extends FilterOptions {
  vehicle_types: string[];
  route_types: string[];
}

const FILTER_META_CACHE_KEY = "dispatchops-dashboard-filter-meta-v2";
const FILTER_META_CACHE_MS = 10 * 60_000;

function distinctNonEmpty(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.map((v) => (v ?? "").trim()).filter(Boolean))].sort();
}

function readFilterMetaCache(): DashboardFilterMeta | null {
  try {
    const raw = localStorage.getItem(FILTER_META_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.value || !parsed?.savedAt) return null;
    return parsed.value as DashboardFilterMeta;
  } catch {
    return null;
  }
}

function writeFilterMetaCache(value: DashboardFilterMeta) {
  try {
    localStorage.setItem(FILTER_META_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), value }));
  } catch {
    // Cache is an optimization only.
  }
}

/**
 * Fast dashboard slicer metadata.
 *
 * The old implementation paged through every SAP invoice row before the
 * dashboard could populate its dropdowns. That made the dashboard feel stuck
 * even though the actual slicer values are just distinct dimension values.
 * The v21 RPC returns all slicer lists in one small response and also makes
 * Fleet Database vehicle types authoritative.
 */
export async function getDashboardFilterMeta(): Promise<DashboardFilterMeta> {
  const cached = readFilterMetaCache();

  const { getFederatedSupabaseClients } = await import("@/lib/supabase");
  const clients = getFederatedSupabaseClients();

  // Some installations have a read-only secondary Supabase project that may
  // not have the newest metadata RPC. Never let that one project blank every
  // Dashboard slicer: use every successful project and keep the local cache.
  const results = await Promise.all(clients.map(async (client: any) => {
    try {
      const result = await client.rpc("dispatchops_dashboard_filter_meta");
      if (result.error) return { data: null, error: result.error };
      return { data: result.data || {}, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }));

  const successful = results.filter((r: any) => !r.error && r.data);
  if (!successful.length) {
    if (cached) return cached;
    const error: any = results.find((r: any) => r.error)?.error;
    throw new Error(error?.message || "Unable to load Dashboard filter metadata.");
  }

  const merged: DashboardFilterMeta = {
    divisions: [], facility_types: [], salesmen: [], areas: [], drivers: [],
    vehicle_types: [], route_types: [],
  };

  for (const result of successful) {
    const v = result.data || {};
    for (const key of Object.keys(merged) as (keyof DashboardFilterMeta)[]) {
      const current = merged[key] as string[];
      const incoming = Array.isArray(v[key]) ? v[key] : [];
      (merged as any)[key] = [...new Set([...current, ...incoming].map(String).map(x => x.trim()).filter(Boolean))].sort();
    }
  }

  writeFilterMetaCache(merged);
  return merged;
}

/** Backwards-compatible helper used by non-dashboard callers. */
export async function getFilterOptions(): Promise<FilterOptions> {
  const cached = readFilterMetaCache();
  if (cached) {
    // Return the cached list immediately. Dashboard refreshes update it in the
    // background, so opening the Dashboard never waits for metadata.
    void getDashboardFilterMeta().catch(() => {});
    return cached;
  }
  const meta = await getDashboardFilterMeta();
  return {
    divisions: meta.divisions,
    facility_types: meta.facility_types,
    salesmen: meta.salesmen,
    areas: meta.areas,
    drivers: meta.drivers,
  };
}

export function getCachedDashboardFilterMeta(): DashboardFilterMeta | null {
  return readFilterMetaCache();
}
