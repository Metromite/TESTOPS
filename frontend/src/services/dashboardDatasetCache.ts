export interface DashboardDatasetRow {
  invoice_no: string;
  invoice_date: string | null;
  dispatch_date: string | null;
  driver_name: string;
  driver_code?: string;
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

const memory = new Map<string, DashboardDatasetRow[]>();
const DB_NAME = "dispatchops-dashboard-dataset-v1";
const STORE = "datasets";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function getDashboardDataset(key: string): Promise<DashboardDatasetRow[] | null> {
  const hit = memory.get(key);
  if (hit) return hit;
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => {
        const value = Array.isArray(req.result) ? req.result as DashboardDatasetRow[] : null;
        if (value) memory.set(key, value);
        resolve(value);
      };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function setDashboardDataset(key: string, rows: DashboardDatasetRow[]): Promise<void> {
  memory.set(key, rows);
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(rows, key);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch { resolve(); }
  });
}

export function dashboardDatasetKey(start?: string, end?: string): string {
  return `${start || ""}|${end || ""}`;
}
