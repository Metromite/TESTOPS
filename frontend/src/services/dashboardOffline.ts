import { getFederatedSupabaseClients } from "@/lib/supabase";

export interface OfflineSapRow {
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
}

export interface OfflineDashboardDataset {
  month: string;
  rows: OfflineSapRow[];
  drivers: Array<{ code: string; name: string }>;
  vehicles: Array<{ number: string; type: string }>;
  savedAt: number;
}

const DB_NAME = "dispatchops-dashboard-offline";
const DB_VERSION = 1;
const STORE = "datasets";
const KEY = "latest";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function readOfflineDashboardDataset(): Promise<OfflineDashboardDataset | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as OfflineDashboardDataset | undefined) || null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function writeOfflineDashboardDataset(value: OfflineDashboardDataset): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}

function normalizeVehicle(v: unknown): string {
  return String(v ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function latestMonth(dates: Array<string | null>): string | null {
  const valid = dates.filter(Boolean).map((x) => String(x).slice(0, 7)).filter(Boolean).sort();
  return valid.length ? valid[valid.length - 1] : null;
}

async function latestMonthFromClients(clients: any[]): Promise<string | null> {
  const results = await Promise.all(clients.map(async (client) => {
    try {
      const { data } = await client.from("sap_invoice_facts").select("dispatch_date").not("dispatch_date", "is", null).order("dispatch_date", { ascending: false }).limit(1);
      return data?.[0]?.dispatch_date ? String(data[0].dispatch_date).slice(0, 7) : null;
    } catch { return null; }
  }));
  return latestMonth(results);
}

async function fetchAllMonthRows(client: any, month: string): Promise<OfflineSapRow[]> {
  const PAGE = 1000;
  const start = `${month}-01`;
  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;
  const fields = "invoice_no,invoice_date,dispatch_date,driver_name,helper_name,vehicle_num,vehicle_key,vehicle_type,customer_name,area,division_desc,facility_type,salesman,boxes,normal_boxes,freezer_boxes,not_supplied_reason";
  const out: OfflineSapRow[] = [];
  // PostgREST pages are fetched in small parallel waves. This makes the one
  // initial warm-up fast without creating the DB contention that caused the
  // old per-filter RPCs to hit statement_timeout.
  for (let base = 0; ; base += PAGE * 8) {
    const pages = await Promise.all(Array.from({ length: 8 }, (_, i) => base + i * PAGE).map(async (from) => {
      const { data, error } = await client.from("sap_invoice_facts").select(fields).gte("dispatch_date", start).lte("dispatch_date", end).gt("boxes", 0).range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      return (data || []) as OfflineSapRow[];
    }));
    let stop = false;
    for (const page of pages) { out.push(...page); if (page.length < PAGE) stop = true; }
    if (stop) break;
  }
  return out;
}

export async function preloadDashboardDataset(force = false): Promise<OfflineDashboardDataset | null> {
  const cached = await readOfflineDashboardDataset();
  const clients = getFederatedSupabaseClients();
  const month = await latestMonthFromClients(clients);
  if (!month) return cached;
  if (!force && cached && cached.month === month && cached.rows.length) return cached;

  const chunks = await Promise.all(clients.map(async (client) => {
    try { return await fetchAllMonthRows(client, month); } catch { return []; }
  }));
  const rows = chunks.flat();

  // Fleet is authoritative for driver names/codes and vehicle type. Keep the
  // dataset self-contained so slicers never need a DB round-trip.
  const driverResults = await Promise.all(clients.map(async (client) => {
    try { const { data } = await client.from("drivers").select("code,name"); return data || []; } catch { return []; }
  }));
  const vehicleResults = await Promise.all(clients.map(async (client) => {
    try { const { data } = await client.from("vehicles").select("number,type"); return data || []; } catch { return []; }
  }));
  const driverMap = new Map<string, { code: string; name: string }>();
  for (const d of driverResults.flat()) {
    const code = String(d?.code || "").trim(); const name = String(d?.name || "").trim();
    if (code && name) driverMap.set(code.toLowerCase(), { code, name });
  }
  const drivers = [...driverMap.values()].sort((a,b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
  const vehicleMap = new Map<string, { number: string; type: string }>();
  for (const v of vehicleResults.flat()) {
    const number = String(v?.number || "").trim(); const type = String(v?.type || "").trim();
    const key = normalizeVehicle(number);
    if (key) vehicleMap.set(key, { number, type });
  }
  const vehicles = [...vehicleMap.values()];
  const fleetByNumber = new Map(vehicles.map((v) => [normalizeVehicle(v.number), v]));
  const fleetDriverNames = new Set(drivers.map((d) => d.name));

  const normalizedRows = rows
    .filter((r) => Number(r.boxes || 0) > 0)
    .filter((r) => {
      const div = String(r.division_desc || "").trim().toLowerCase();
      return !!div && !["unknown", "unclassified", "n/a", "na", "not available", "not available/unknown"].includes(div);
    })
    .filter((r) => !fleetDriverNames.size || fleetDriverNames.has(String(r.driver_name || "")))
    .map((r) => {
      const fleet = fleetByNumber.get(normalizeVehicle(r.vehicle_num || r.vehicle_key));
      return fleet ? { ...r, vehicle_num: fleet.number, vehicle_key: normalizeVehicle(fleet.number), vehicle_type: /pickup/i.test(String(fleet.type || "")) ? "Pickup" : "Van" } : { ...r, vehicle_type: /pickup/i.test(String(r.vehicle_type || "")) ? "Pickup" : "Van" };
    });

  const value: OfflineDashboardDataset = { month, rows: normalizedRows, drivers, vehicles, savedAt: Date.now() };
  await writeOfflineDashboardDataset(value);
  return value;
}
