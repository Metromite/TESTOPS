import { supabase, getPrimarySupabaseClient, getTertiarySupabaseClient } from "../lib/supabase";

export type BulkOrganizerPlan = {
  id?: string;
  plan_date: string;
  vehicles: Array<{ vehicle_id: string; capacity: number; driver?: string; helper?: string; building_id?: string | null }>;
  pallets: any[];
  customers?: any[];
  invoices?: any[];
  pallet_assignments?: Record<string, string | null>;
  buildings?: any[];
  vehicle_meta?: Record<string, { driver?: string; helper?: string; building_id?: string | null }>;
  customer_schedules?: any[];
  updated_at?: string;
};

export type BulkOrganizerDefaults = {
  id?: string | number;
  month_key?: string;
  buildings: any[];
  vehicles: any[];
  customer_schedules: any[];
  updated_at?: string;
};

const hasItems = (v: any) => Array.isArray(v) && v.length > 0;
const hasObject = (v: any) => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0;

const mergePalletAssignments = (
  base: Record<string, string | null> = {},
  extra?: Record<string, string | null>,
): Record<string, string | null> => {
  if (!extra || typeof extra !== "object") return { ...base };
  const merged: Record<string, string | null> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (!(key in merged)) merged[key] = value;
  }
  return merged;
};

// Merge federated invoice arrays instead of letting the first non-empty array
// hide invoices that exist in the other project. Primary wins when the same
// invoice identity exists in both projects; Tertiary only contributes missing
// invoices.
const mergeInvoices = (primaryRows: any[] = [], secondaryRows: any[] = []) => {
  const out = [...primaryRows];
  const seenIds = new Set(out.map((x: any) => String(x?.id || "").trim()).filter(Boolean));
  const seenNos = new Set(out.map((x: any) => String(x?.invoice_no || "").trim().toUpperCase()).filter(Boolean));
  for (const row of secondaryRows) {
    const id = String(row?.id || "").trim();
    const no = String(row?.invoice_no || "").trim().toUpperCase();
    if ((id && seenIds.has(id)) || (no && seenNos.has(no))) continue;
    out.push(row);
    if (id) seenIds.add(id);
    if (no) seenNos.add(no);
  }
  return out;
};

/**
 * Bulk Organizer is federated across the legacy Primary and newer Tertiary
 * projects. Never let an empty row in one project hide a populated row in the
 * other project. For the planner structure we also recover the nearest
 * populated plan in the same month when a particular date has an empty shell.
 * Date-specific invoices/assignments are NEVER copied by this fallback.
 */
export async function loadBulkOrganizerPlan(planDate: string): Promise<BulkOrganizerPlan | null> {
  const primary = getPrimarySupabaseClient();
  const tertiary = getTertiarySupabaseClient();
  // Primary contains the legacy/canonical planner data currently in use.
  // Read it first and only fall back to Tertiary when Primary has no row.
  // Never merge an empty shell over a populated daily plan.
  if (primary) {
    const { data, error } = await primary
      .from("bulk_organizer_plans")
      .select("*")
      .eq("plan_date", planDate)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as BulkOrganizerPlan;
  }
  if (tertiary) {
    const { data, error } = await tertiary
      .from("bulk_organizer_plans")
      .select("*")
      .eq("plan_date", planDate)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as BulkOrganizerPlan;
  }
  return null;
}

export async function loadBulkOrganizerMonthPlans(monthKey: string, nextMonth: string): Promise<BulkOrganizerPlan[]> {
  const clients = [getPrimarySupabaseClient(), getTertiarySupabaseClient()].filter(Boolean) as any[];
  const merged = new Map<string, BulkOrganizerPlan>();
  for (const db of clients) {
    const { data, error } = await db.from("bulk_organizer_plans").select("*").gte("plan_date", monthKey).lt("plan_date", nextMonth);
    if (error) continue;
    for (const row of data || []) {
      const key = String(row.plan_date);
      const current = merged.get(key);
      if (!current) { merged.set(key, row as BulkOrganizerPlan); continue; }
      for (const field of ["vehicles", "buildings", "customer_schedules", "customers"] as const) {
        if (!hasItems((current as any)[field]) && hasItems((row as any)[field])) (current as any)[field] = (row as any)[field];
      }
      if (hasItems((row as any).invoices)) current.invoices = mergeInvoices(current.invoices || [], (row as any).invoices);
      if (hasItems((row as any).pallets)) current.pallets = mergeInvoices(current.pallets || [], (row as any).pallets);
      if (!hasObject(current.vehicle_meta) && hasObject(row.vehicle_meta)) current.vehicle_meta = row.vehicle_meta;
      if (hasObject(row.pallet_assignments)) current.pallet_assignments = mergePalletAssignments(current.pallet_assignments, row.pallet_assignments);
    }
  }
  return [...merged.values()].sort((a, b) => String(a.plan_date).localeCompare(String(b.plan_date)));
}

export async function saveBulkOrganizerPlan(plan: BulkOrganizerPlan): Promise<BulkOrganizerPlan> {
  const payload = {
    plan_date: plan.plan_date,
    vehicles: plan.vehicles || [],
    pallets: plan.pallets || [],
    customers: plan.customers || [],
    invoices: plan.invoices || [],
    pallet_assignments: plan.pallet_assignments || {},
    buildings: plan.buildings || [],
    vehicle_meta: plan.vehicle_meta || {},
    customer_schedules: plan.customer_schedules || [],
    updated_at: new Date().toISOString(),
  };
  const primary = getPrimarySupabaseClient();
  const tertiary = getTertiarySupabaseClient();
  let db: any = primary || tertiary || supabase;
  if (primary && tertiary) {
    const p = await primary.from("bulk_organizer_plans").select("id,vehicles,buildings,invoices").eq("plan_date", plan.plan_date).maybeSingle();
    if (p.error) throw new Error(p.error.message);
    const pHas = !!p.data && (hasItems(p.data.vehicles) || hasItems(p.data.buildings) || hasItems(p.data.invoices));
    if (!pHas) {
      const t = await tertiary.from("bulk_organizer_plans").select("id,vehicles,buildings,invoices").eq("plan_date", plan.plan_date).maybeSingle();
      if (t.error) throw new Error(t.error.message);
      const tHas = !!t.data && (hasItems(t.data.vehicles) || hasItems(t.data.buildings) || hasItems(t.data.invoices));
      db = tHas ? tertiary : primary;
    }
  }
  const { data, error } = await db.from("bulk_organizer_plans").upsert(payload, { onConflict: "plan_date" }).select("*").single();
  if (error) throw new Error(error.message);
  return data as BulkOrganizerPlan;
}

export async function loadBulkOrganizerDefaults(monthKey?: string): Promise<BulkOrganizerDefaults | null> {
  const mk = monthKey || new Date().toISOString().slice(0, 7) + "-01";
  const db = getTertiarySupabaseClient() || getPrimarySupabaseClient() || supabase;
  const { data, error } = await db.from("bulk_organizer_month_defaults").select("*").eq("month_key", mk).maybeSingle();
  if (error) {
    try {
      const raw = localStorage.getItem(`dispatchops.bulkOrganizer.defaults.${mk}`) || localStorage.getItem("dispatchops.bulkOrganizer.defaults");
      return raw ? JSON.parse(raw) as BulkOrganizerDefaults : null;
    } catch { return null; }
  }
  return data ? { ...data, id: String(data.id), month_key: mk } as BulkOrganizerDefaults : null;
}

export async function saveBulkOrganizerDefaults(value: BulkOrganizerDefaults): Promise<BulkOrganizerDefaults> {
  const mk = value.month_key || new Date().toISOString().slice(0, 7) + "-01";
  const payload = { month_key: mk, buildings: value.buildings || [], vehicles: value.vehicles || [], customer_schedules: value.customer_schedules || [], updated_at: new Date().toISOString() };
  const db = getTertiarySupabaseClient() || getPrimarySupabaseClient() || supabase;
  const { data, error } = await db.from("bulk_organizer_month_defaults").upsert(payload, { onConflict: "month_key" }).select("*").single();
  if (error) {
    const saved = { ...payload, id: String(value.id || "local"), month_key: mk } as BulkOrganizerDefaults;
    localStorage.setItem(`dispatchops.bulkOrganizer.defaults.${mk}`, JSON.stringify(saved));
    localStorage.setItem("dispatchops.bulkOrganizer.defaults", JSON.stringify(saved));
    return saved;
  }
  const saved = { ...data, id: String(data.id), month_key: mk } as BulkOrganizerDefaults;
  localStorage.setItem(`dispatchops.bulkOrganizer.defaults.${mk}`, JSON.stringify(saved));
  localStorage.setItem("dispatchops.bulkOrganizer.defaults", JSON.stringify(saved));
  return saved;
}
