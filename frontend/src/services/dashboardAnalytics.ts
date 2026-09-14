import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";
import { saveWorkbookToDispatchFolder, type ExportProgress } from "./desktopExport";

interface SapFact {
  invoice_no: string; invoice_date: string | null; dispatch_date: string | null; driver_name: string; customer_name: string;
  facility_type: string; area: string; division_desc: string; vehicle_type: string; vehicle_num: string; vehicle_key?: string; boxes: number; normal_boxes: number;
  freezer_boxes: number; not_supplied_reason: string; salesman: string;
}
interface LmFact { driver_name: string; customer_name: string; vehicle_key: string; vehicle_raw: string; arrival: string; departure: string; duration: string; minutes: number; is_delivery: boolean; is_passthrough: boolean; is_depot: boolean }

function values(params: URLSearchParams, key: string): string[] { return (params.get(key) || "").split(",").map((x) => x.trim()).filter(Boolean); }
function dayDiff(a: string | null, b: string | null): number | null { if (!a || !b) return null; const n = Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000); return Number.isFinite(n) ? n : null; }
function leadBand(days: number): string { if (days <= 0) return "0 Days"; if (days === 1) return "1 Day"; if (days <= 5) return `${days} Days`; return "More than 5 Days"; }
function isUnknownDimension(value: unknown): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return !v || ["unknown", "unclassified", "n/a", "na", "not available", "not available/unknown"].includes(v);
}
function classification(r: SapFact): string {
  if (!isUnknownDimension(r.facility_type)) return r.facility_type.trim();
  if (!isUnknownDimension(r.division_desc)) return r.division_desc.trim();
  return "";
}

type AsyncCacheEntry<T> = { value?: T; promise?: Promise<T>; expires: number };
const analyticsCache = new Map<string, AsyncCacheEntry<any>>();
const ANALYTICS_CACHE_MS = 30_000;

async function cachedAnalytics<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = analyticsCache.get(key) as AsyncCacheEntry<T> | undefined;
  if (hit && hit.expires > now) {
    if (hit.value !== undefined) return hit.value;
    if (hit.promise) return hit.promise;
  }
  const promise = loader();
  analyticsCache.set(key, { promise, expires: now + 60_000 });
  try {
    const value = await promise;
    analyticsCache.set(key, { value, expires: Date.now() + ANALYTICS_CACHE_MS });
    return value;
  } catch (e) {
    analyticsCache.delete(key);
    throw e;
  }
}

async function fetchAllFromProjects<T>(table: string, columns: string, filters: (q: any) => any): Promise<T[]> {
  const { getFederatedSupabaseClients } = await import("@/lib/supabase");
  const clients = getFederatedSupabaseClients();
  const pageSize = 1000;
  const fetchOne = async (client: any): Promise<T[]> => {
    const out: T[] = [];
    for (let from = 0; ; from += pageSize) {
      let q = client.from(table).select(columns);
      q = filters(q);
      const { data, error } = await q.range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const page = (data || []) as T[];
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  };
  const chunks = await Promise.all(clients.map(fetchOne));
  return chunks.flat();
}

async function getRouteAreaNames(selectedRouteTypes: string[]): Promise<Set<string> | null> {
  if (!selectedRouteTypes.length) return null;
  const key = `route-areas:${selectedRouteTypes.slice().sort().join("|")}`;
  return cachedAnalytics(key, async () => {
    const { getFederatedSupabaseClients } = await import("@/lib/supabase");
    const rows: any[] = [];
    for (const client of getFederatedSupabaseClients()) {
      const { data, error } = await client.from("areas").select("code,name,route_type");
      if (error) throw new Error(error.message);
      rows.push(...(data || []));
    }
    const wanted = new Set(selectedRouteTypes);
    return new Set(rows.filter(r => wanted.has(String(r.route_type || ""))).flatMap(r => [r.code, r.name]).filter(Boolean).map(String));
  });
}

async function sapRows(params: URLSearchParams): Promise<SapFact[]> {
  const start = params.get("start_date") || "";
  const end = params.get("end_date") || "";
  const driver = params.get("driver") || "";
  const drivers = values(params, "drivers");
  const areas = values(params, "areas");
  const divisions = values(params, "division");
  const vehicleTypes = values(params, "vehicle_type");
  const facilities = values(params, "facility_type");
  const salesmen = values(params, "salesman");
  const routeTypes = values(params, "route_type");
  const key = [start,end,driver,drivers.join("|"),areas.join("|"),divisions.join("|"),routeTypes.join("|"),vehicleTypes.join("|"),facilities.join("|"),salesmen.join("|")].join("::");
  return cachedAnalytics(`sap:${key}`, async () => {
    const raw = await fetchAllFromProjects<SapFact>("sap_invoice_facts", "invoice_no,invoice_date,dispatch_date,driver_name,customer_name,facility_type,area,division_desc,vehicle_type,vehicle_num,vehicle_key,boxes,normal_boxes,freezer_boxes,not_supplied_reason,salesman", (q) => {
      if (start) q = q.gte("dispatch_date", start);
      if (end) q = q.lte("dispatch_date", end);
      if (driver) q = q.eq("driver_name", driver);
      return q;
    });
    let rows = raw.filter(r => !isUnknownDimension(r.division_desc) && !isUnknownDimension(classification(r)));
    const match = (selected: string[], field: keyof SapFact) => { if (selected.length) rows = rows.filter(r => selected.includes(String(r[field] || ""))); };
    match(drivers, "driver_name"); match(areas, "area"); match(divisions, "division_desc"); match(vehicleTypes, "vehicle_type"); match(facilities, "facility_type"); match(salesmen, "salesman");
    const routeAreaNames = await getRouteAreaNames(routeTypes);
    if (routeAreaNames) rows = rows.filter(r => routeAreaNames.has(String(r.area || "")));
    return rows;
  });
}

async function landmarkRows(params: URLSearchParams, sap: SapFact[]): Promise<LmFact[]> {
  const start = params.get("start_date") || "";
  const end = params.get("end_date") || "";
  const selectedDrivers = new Set(values(params, "drivers"));
  const singleDriver = params.get("driver") || "";
  const key = [start,end,singleDriver,[...selectedDrivers].sort().join("|")].join("::");
  return cachedAnalytics(`landmarks:${key}`, async () => {
    const raw = await fetchAllFromProjects<LmFact>("landmark_visit_facts", "driver_name,customer_name,vehicle_key,vehicle_raw,arrival,departure,duration,minutes,is_delivery,is_passthrough,is_depot", (q) => {
      if (start) q = q.gte("visit_date", start);
      if (end) q = q.lte("visit_date", end);
      return q;
    });
    if (!selectedDrivers.size && !singleDriver) return raw;
    const allowedDrivers = new Set<string>(selectedDrivers);
    if (singleDriver) allowedDrivers.add(singleDriver);
    const allowedVehicles = new Set(sap.filter(r => allowedDrivers.has(String(r.driver_name || ""))).map(r => String(r.vehicle_key || "")).filter(Boolean));
    return raw.filter(r => allowedVehicles.has(String(r.vehicle_key || "")) || allowedDrivers.has(String(r.driver_name || "")));
  });
}

type DashboardSnapshot = {
  lead_time: any;
  order_summary: any;
  area_analytics: any;
  not_supplied: any;
  driver_performance: any;
};

function leadTimeFilterJson(params: URLSearchParams): Record<string, unknown> {
  return { driver: params.get("driver") || "", drivers: values(params,"drivers"), areas: values(params,"areas"), division: values(params,"division"), route_type: values(params,"route_type"), vehicle_type: values(params,"vehicle_type"), facility_type: values(params,"facility_type"), salesman: values(params,"salesman"), lead_time_band: params.get("lead_time_band") || "", classification: params.get("classification") || "" };
}

function snapshotKey(params: URLSearchParams): string {
  const keys = ["start_date","end_date","driver","drivers","areas","division","route_type","vehicle_type","facility_type","salesman","lead_time_band","classification"];
  return `dashboard-snapshot:${keys.map(k=>`${k}=${params.get(k)||""}`).join("&")}`;
}

async function fetchSnapshotFromClient(client: any, params: URLSearchParams): Promise<DashboardSnapshot> {
  const start = params.get("start_date") || null;
  const end = params.get("end_date") || null;
  const filters = leadTimeFilterJson(params);
  const { data, error } = await client.rpc("dispatchops_dashboard_snapshot", {
    p_start: start,
    p_end: end,
    p_filters: filters,
  });
  if (error) throw new Error(error.message);
  return (data || { lead_time: {}, order_summary: {}, area_analytics: {}, not_supplied: {}, driver_performance: {} }) as DashboardSnapshot;
}

function mergeSnapshot(a: DashboardSnapshot, b: DashboardSnapshot): DashboardSnapshot {
  // The SQL snapshot is already aggregated. Merge the small result sets here;
  // raw SAP/GPS rows never cross the desktop boundary for dashboard rendering.
  const num = (x:any) => Number(x||0);
  const leadA=a.lead_time||{}, leadB=b.lead_time||{};
  const leadRows = new Map<string, any>();
  for (const r of [...(leadA.by_classification||[]),...(leadB.by_classification||[])]) {
    const k=String(r.name||"Unclassified"); const old=leadRows.get(k);
    if(!old) leadRows.set(k,{...r}); else { const oldOrders=num(old.orders); const newOrders=num(r.orders); const orders=oldOrders+newOrders; old.orders=orders; old.avg_days=orders?Math.round(((num(old.avg_days)*oldOrders+num(r.avg_days)*newOrders)/orders)*100)/100:0; old.min_days=Math.min(num(old.min_days),num(r.min_days)); old.max_days=Math.max(num(old.max_days),num(r.max_days)); }
  }
  const bands=["0 Days","1 Day","2 Days","3 Days","4 Days","5 Days","More than 5 Days"];
  const counts=bands.map((_,i)=>num(leadA.distribution?.counts?.[i])+num(leadB.distribution?.counts?.[i]));
  const leadTotal=num(leadA.kpis?.total_invoices)+num(leadB.kpis?.total_invoices);
  const leadAvg=leadTotal?Math.round(((num(leadA.kpis?.overall_avg_days)*num(leadA.kpis?.total_invoices)+num(leadB.kpis?.overall_avg_days)*num(leadB.kpis?.total_invoices))/leadTotal)*100)/100:null;
  const classes=[...new Set([...(leadA.band_classification_matrix?.classifications||[]),...(leadB.band_classification_matrix?.classifications||[])])].sort();
  const matrixRows=bands.map((band)=>{const countsObj:any={};let total=0;for(const cls of classes){const get=(x:any)=>{const row=(x.band_classification_matrix?.rows||[]).find((z:any)=>z.band===band);return num(row?.counts?.[cls]);};const n=get(leadA)+get(leadB);countsObj[cls]=n;total+=n;}return{band,counts:countsObj,total};});
  const lead={kpis:{total_invoices:leadTotal,overall_avg_days:leadAvg,fastest_days:[leadA.kpis?.fastest_days,leadB.kpis?.fastest_days].filter((x:any)=>x!==null&&x!==undefined).reduce((m:any,x:any)=>Math.min(m,num(x)),Infinity),longest_days:[leadA.kpis?.longest_days,leadB.kpis?.longest_days].filter((x:any)=>x!==null&&x!==undefined).reduce((m:any,x:any)=>Math.max(m,num(x)),-Infinity)},by_classification:[...leadRows.values()],distribution:{bins:bands,counts},fastest_detail:[...(leadA.fastest_detail||[]),...(leadB.fastest_detail||[])].slice(0,100),longest_detail:[...(leadA.longest_detail||[]),...(leadB.longest_detail||[])].slice(0,100),band_classification_matrix:{classifications:classes,rows:matrixRows,col_totals:Object.fromEntries(classes.map(c=>[c,matrixRows.reduce((n,r)=>n+num(r.counts[c]),0)])),grand_total:leadTotal},available_bands:bands.filter((_,i)=>counts[i]>0),available_classifications:classes};
  if (lead.kpis.fastest_days===Infinity) lead.kpis.fastest_days=null;
  if (lead.kpis.longest_days===-Infinity) lead.kpis.longest_days=null;

  const orderMap=new Map<string,any>();
  for(const r of [...(a.order_summary?.rows||[]),...(b.order_summary?.rows||[])]){const k=String(r.driver||"Unknown");const old=orderMap.get(k);if(!old)orderMap.set(k,{...r,by_facility:[...(r.by_facility||[])]});else {old.total=num(old.total)+num(r.total);old.by_facility=(old.by_facility||[]).map((x:number,i:number)=>x+num(r.by_facility?.[i]));}}
  const facilities=[...new Set([...(a.order_summary?.facility_types||[]),...(b.order_summary?.facility_types||[])])];
  const areaMap=new Map<string,any>();
  for(const r of [...(a.area_analytics?.table||[]),...(b.area_analytics?.table||[])]){const k=String(r.area||"Unknown");const old=areaMap.get(k);if(!old)areaMap.set(k,{...r});else {old.orders=num(old.orders)+num(r.orders);old.boxes=num(old.boxes)+num(r.boxes);old.freezer=num(old.freezer)+num(r.freezer);old.returns=num(old.returns)+num(r.returns);old.drivers=Math.max(num(old.drivers),num(r.drivers));old.success_pct=old.orders?Math.round((old.orders-old.returns)/old.orders*10000)/100:0;}}
  // Merge weekly Area Analytics by area NAME, not array position. Once the
  // secondary project starts receiving imports its area set/order may differ
  // from Primary; positional merging would silently put counts under the wrong
  // area column.
  const allAreaNames=[...new Set([...(a.area_analytics?.area_names||[]),...(b.area_analytics?.area_names||[]),...areaMap.keys()])].map(String).sort();
  const weeklyNamed=new Map<string,Map<string,number>>();
  const addWeeks=(snap:any)=>{const names=(snap?.area_names||[]).map(String);for(const r of (snap?.weekly_table||[])){const week=String(r.week);const m=weeklyNamed.get(week)||new Map<string,number>();for(let i=0;i<names.length;i++)m.set(names[i],(m.get(names[i])||0)+num(r.by_area?.[i]));weeklyNamed.set(week,m);}};
  addWeeks(a.area_analytics); addWeeks(b.area_analytics);
  const areaTable=[...areaMap.values()];
  const areaTotals={orders:areaTable.reduce((n,r)=>n+num(r.orders),0),boxes:areaTable.reduce((n,r)=>n+num(r.boxes),0),freezer:areaTable.reduce((n,r)=>n+num(r.freezer),0),returns:areaTable.reduce((n,r)=>n+num(r.returns),0),drivers:new Set(areaTable.flatMap((r:any)=>[r.area])).size,success_pct:0};
  areaTotals.drivers=Math.max(num(a.area_analytics?.totals?.drivers),num(b.area_analytics?.totals?.drivers));
  areaTotals.success_pct=areaTotals.orders?Math.round((areaTotals.orders-areaTotals.returns)/areaTotals.orders*10000)/100:0;
  const weeklyTable=[...weeklyNamed.entries()].sort((x,y)=>x[0].localeCompare(y[0])).map(([week,m])=>({week,by_area:allAreaNames.map(n=>m.get(n)||0)}));
  const area={table:areaTable,totals:areaTotals,area_names:allAreaNames,weekly_table:weeklyTable,chart:{labels:[...areaTable].sort((x,y)=>num(y.orders)-num(x.orders)).slice(0,15).map(r=>r.area),values:[...areaTable].sort((x,y)=>num(y.orders)-num(x.orders)).slice(0,15).map(r=>r.orders)}};

  const ns=[...(a.not_supplied?.not_supplied||[]),...(b.not_supplied?.not_supplied||[])];
  const zero=[...(a.not_supplied?.zero_box_excluded_from_kpis||[]),...(b.not_supplied?.zero_box_excluded_from_kpis||[])];
  const perfCards=[...(a.driver_performance?.route_cards||[]),...(b.driver_performance?.route_cards||[])];
  // Route detail remains vehicle-level, but all performance charts are DRIVER-level.
  // A driver can use multiple vehicles during the selected period, so aggregate all
  // vehicle cards under the resolved driver name before building chart series.
  const driverChartMap=new Map<string,{stops:number;hours:number}>();
  for(const r of perfCards){
    const driver=String(r.display_driver||r.driver_name||'Unknown').trim()||'Unknown';
    const old=driverChartMap.get(driver)||{stops:0,hours:0};
    old.stops+=num(r.stops);
    old.hours+=num(r._hours);
    driverChartMap.set(driver,old);
  }
  const driverChartRows=[...driverChartMap.entries()].map(([driver,v])=>({driver,stops:v.stops,hours:Math.round(v.hours*100)/100})).sort((x,y)=>y.stops-x.stops);
  const perf={...a.driver_performance,kpis:{...a.driver_performance?.kpis},route_cards:perfCards,chart_stops:{labels:driverChartRows.map(r=>r.driver),values:driverChartRows.map(r=>r.stops)},chart_route_hours:{labels:driverChartRows.map(r=>r.driver),values:driverChartRows.map(r=>r.hours)}};
  if(perf.kpis){perf.kpis.gps_vehicles=num(a.driver_performance?.kpis?.gps_vehicles)+num(b.driver_performance?.kpis?.gps_vehicles);perf.kpis.total_gps_stops=num(a.driver_performance?.kpis?.total_gps_stops)+num(b.driver_performance?.kpis?.total_gps_stops);perf.kpis.sap_orders=num(a.driver_performance?.kpis?.sap_orders)+num(b.driver_performance?.kpis?.sap_orders);perf.kpis.sap_total_boxes=num(a.driver_performance?.kpis?.sap_total_boxes)+num(b.driver_performance?.kpis?.sap_total_boxes);}
  return {lead_time:lead,order_summary:{facility_types:facilities,rows:[...orderMap.values()],facility_totals:facilities.map((_,i)=>[...orderMap.values()].reduce((n,r)=>n+num(r.by_facility?.[i]),0)),grand_total:[...orderMap.values()].reduce((n,r)=>n+num(r.total),0)},area_analytics:area,not_supplied:{not_supplied:ns,zero_box_excluded_from_kpis:zero},driver_performance:perf};
}

async function getDashboardSnapshot<T>(params: URLSearchParams): Promise<DashboardSnapshot> {
  return cachedAnalytics(snapshotKey(params), async()=>{
    const { getFederatedSupabaseClients } = await import("@/lib/supabase");
    const clients=getFederatedSupabaseClients();
    const parts=await Promise.all(clients.map(c=>fetchSnapshotFromClient(c,params)));
    return parts.reduce((acc:any,part:any)=>acc?mergeSnapshot(acc,part):part,null) as DashboardSnapshot;
  });
}

async function fetchTargetedRpcFromProjects(rpc: string, params: URLSearchParams, key: keyof DashboardSnapshot): Promise<any> {
  const cacheKey = `targeted:${rpc}:${snapshotKey(params)}`;
  return cachedAnalytics(cacheKey, async () => {
    const { getFederatedSupabaseClients } = await import("@/lib/supabase");
    const start = params.get("start_date") || null;
    const end = params.get("end_date") || null;
    const filters = leadTimeFilterJson(params);
    const parts = await Promise.all(getFederatedSupabaseClients().map(async (client:any) => {
      const { data, error } = await client.rpc(rpc, { p_start: start, p_end: end, p_filters: filters });
      if (error) throw new Error(error.message);
      return { lead_time:{}, order_summary:{}, area_analytics:{}, not_supplied:{}, driver_performance:{}, [key]: data || {} } as DashboardSnapshot;
    }));
    if (parts.length === 1) return parts[0][key];
    return parts.reduce((acc:any,part:any)=>acc?mergeSnapshot(acc,part):part,null)[key];
  });
}
export async function getLeadTimeData<T>(params: URLSearchParams): Promise<T> { return fetchTargetedRpcFromProjects("dispatchops_dashboard_lead_time_snapshot", params, "lead_time") as Promise<T>; }
async function getLeadTimeDataClient<T>(params: URLSearchParams): Promise<T> { return getLeadTimeData<T>(params); }
async function orderSummary<T>(params: URLSearchParams): Promise<T> { return fetchTargetedRpcFromProjects("dispatchops_dashboard_order_summary_snapshot", params, "order_summary") as Promise<T>; }
async function areaAnalytics<T>(params: URLSearchParams): Promise<T> { return fetchTargetedRpcFromProjects("dispatchops_dashboard_area_snapshot", params, "area_analytics") as Promise<T>; }
async function notSupplied<T>(params: URLSearchParams): Promise<T> { return fetchTargetedRpcFromProjects("dispatchops_dashboard_not_supplied_snapshot", params, "not_supplied") as Promise<T>; }
async function driverPerformance<T>(params: URLSearchParams): Promise<T> { return fetchTargetedRpcFromProjects("dispatchops_dashboard_driver_performance_snapshot", params, "driver_performance") as Promise<T>; }

export function invalidateDashboardAnalyticsCache(): void { analyticsCache.clear(); }

export async function fetchDashboardEndpoint<T>(endpoint: string): Promise<T> { const [path,query=""]=endpoint.split("?"); const params=new URLSearchParams(query); if(path==="/dashboard/lead-time")return getLeadTimeDataClient<T>(params); if(path==="/dashboard/order-summary")return orderSummary<T>(params); if(path==="/dashboard/area-analytics")return areaAnalytics<T>(params); if(path==="/dashboard/not-supplied")return notSupplied<T>(params); if(path==="/dashboard/driver-performance")return driverPerformance<T>(params); throw new Error(`Unsupported Supabase dashboard endpoint: ${path}`); }


export type DashboardExportView = "full" | "dashboard" | "driverperf" | "leadtime" | "order" | "area" | "notsupplied";

function appendJsonSheet(wb: XLSX.WorkBook, name: string, rows: unknown[]) {
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows as any[]), name);
}

function kpiRows(rows: SapFact[], lead: any, perf: any) {
  const totalBoxes = rows.reduce((s, r) => s + (r.boxes || 0), 0);
  const freezer = rows.reduce((s, r) => s + (r.freezer_boxes || 0), 0);
  const normal = rows.reduce((s, r) => s + (r.normal_boxes || 0), 0);
  const drivers = new Set(rows.map(r => r.driver_name).filter(Boolean)).size;
  const customers = new Set(rows.map(r => r.customer_name).filter(Boolean)).size;
  const notSup = rows.filter(r => r.not_supplied_reason).length;
  return [
    { KPI: "Total Valid Invoices", Value: rows.length },
    { KPI: "Total Boxes", Value: totalBoxes },
    { KPI: "Freezer Boxes", Value: freezer },
    { KPI: "Normal Boxes", Value: normal },
    { KPI: "Active Drivers", Value: drivers },
    { KPI: "Not Supplied Lines", Value: notSup },
    { KPI: "Orders per Driver", Value: drivers ? Number((rows.length / drivers).toFixed(1)) : 0 },
    { KPI: "Avg Lead Time (Invoice→Dispatch)", Value: lead?.kpis?.overall_avg_days ?? 0 },
    { KPI: "Avg Route Duration (hrs)", Value: perf?.kpis?.avg_route_duration_hrs ?? 0 },
    { KPI: "GPS Vehicles", Value: perf?.kpis?.gps_vehicles ?? 0 },
    { KPI: "Total GPS Stops", Value: perf?.kpis?.total_gps_stops ?? 0 },
    { KPI: "Unique Customers", Value: customers },
  ];
}

export async function exportDashboardExcel(params: URLSearchParams, filename = "dashboard_export.xlsx", onProgress?: (p: ExportProgress) => void): Promise<void> {
  onProgress?.({ pct: 15, status: "preparing", message: "Loading dashboard data…" });
  const [rows, lead, orders, areas, notSuppliedData, perf] = await Promise.all([
    sapRows(params), getLeadTimeDataClient<any>(params), orderSummary<any>(params), areaAnalytics<any>(params), notSupplied<any>(params), driverPerformance<any>(params),
  ]);
  onProgress?.({ pct: 50, status: "preparing", message: "Building Full Dashboard workbook…" });
  const wb = XLSX.utils.book_new();
  appendJsonSheet(wb, "KPI Summary", kpiRows(rows, lead, perf));
  appendJsonSheet(wb, "Filtered Data", rows);
  appendJsonSheet(wb, "Lead Time by Class", lead.by_classification || []);
  appendJsonSheet(wb, "Lead Time Distribution", (lead.distribution?.bins || []).map((b: string, i: number) => ({ band: b, orders: lead.distribution.counts?.[i] || 0 })));
  appendJsonSheet(wb, "Lead Time Order Details", [...(lead.fastest_detail || []), ...(lead.longest_detail || [])]);
  appendJsonSheet(wb, "Order Summary", orders.rows || []);
  appendJsonSheet(wb, "Area Analytics", areas.table || []);
  appendJsonSheet(wb, "Weekly Area", areas.weekly_table || []);
  appendJsonSheet(wb, "Not Supplied", notSuppliedData.not_supplied || []);
  appendJsonSheet(wb, "Zero Boxes", notSuppliedData.zero_box_excluded_from_kpis || []);
  appendJsonSheet(wb, "Driver Performance", perf.route_cards || []);
  appendJsonSheet(wb, "GPS Stop Detail", (perf.route_cards || []).map((r: any) => ({ Driver: r.display_driver, Vehicle: r.vehicle_num, "Route Start": r.route_start, "Route End": r.route_end, "Route Duration": r.route_duration_hm, Stops: r.stops, "Avg Stop": r.avg_stop_hm, Passthrough: r.passthru_count })));
  appendJsonSheet(wb, "Master Data", rows.map(r => ({ "Invoice Date": r.invoice_date, "Dispatch Date": r.dispatch_date, "Invoice No": r.invoice_no, "Driver Name": r.driver_name, "Vehicle": r.vehicle_num, "Customer Name": r.customer_name, Area: r.area, Division: r.division_desc, Boxes: r.boxes, Normal: r.normal_boxes, Freezer: r.freezer_boxes, "Facility Type": r.facility_type, "Not Supplied Reason": r.not_supplied_reason })));
  await saveWorkbookToDispatchFolder(wb, filename, (p) => onProgress?.({ ...p, pct: Math.min(95, p.pct) }));
  onProgress?.({ pct: 100, status: "success", message: "Full Dashboard Excel export saved successfully." });
}

export async function exportDashboardView(view: Exclude<DashboardExportView, "full">, params: URLSearchParams, filename: string, onProgress?: (p: ExportProgress) => void): Promise<void> {
  onProgress?.({ pct: 15, status: "preparing", message: "Loading selected dashboard data…" });
  const wb = XLSX.utils.book_new();
  const [rows, lead, orders, areas, ns, perf] = await Promise.all([
    sapRows(params), getLeadTimeDataClient<any>(params), orderSummary<any>(params), areaAnalytics<any>(params), notSupplied<any>(params), driverPerformance<any>(params),
  ]);
  onProgress?.({ pct: 55, status: "preparing", message: "Building workbook…" });
  if (view === "dashboard") {
    appendJsonSheet(wb, "KPI Summary", kpiRows(rows, lead, perf));
    appendJsonSheet(wb, "Driver Overview", perf.route_cards || []);
  } else if (view === "driverperf") {
    appendJsonSheet(wb, "Driver Performance", perf.route_cards || []);
    appendJsonSheet(wb, "GPS Stop Detail", (perf.route_cards || []).map((r: any) => ({ Driver: r.display_driver, Vehicle: r.vehicle_num, "Route Start": r.route_start, "Route End": r.route_end, "Route Duration": r.route_duration_hm, Stops: r.stops, "Avg Stop": r.avg_stop_hm, Passthrough: r.passthru_count })));
  } else if (view === "leadtime") {
    appendJsonSheet(wb, "Lead Time by Class", lead.by_classification || []);
    appendJsonSheet(wb, "Lead Time Distribution", (lead.distribution?.bins || []).map((b: string, i: number) => ({ band: b, orders: lead.distribution.counts?.[i] || 0 })));
    appendJsonSheet(wb, "Order Details", [...(lead.fastest_detail || []), ...(lead.longest_detail || [])]);
  } else if (view === "order") {
    appendJsonSheet(wb, "Order Summary", orders.rows || []);
  } else if (view === "area") {
    appendJsonSheet(wb, "Area Analytics", areas.table || []);
    appendJsonSheet(wb, "Weekly Area", areas.weekly_table || []);
  } else if (view === "notsupplied") {
    appendJsonSheet(wb, "Not Supplied", ns.not_supplied || []);
    appendJsonSheet(wb, "Zero Boxes", ns.zero_box_excluded_from_kpis || []);
  }
  await saveWorkbookToDispatchFolder(wb, filename, onProgress);
}
