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
  deleted_invoice_ids?: string[];
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

export async function loadBulkOrganizerPlan(planDate: string): Promise<BulkOrganizerPlan | null> {
  // Bulk Organizer daily plans have ONE source of truth: Tertiary.
  // Primary is intentionally not consulted here; mixing two writers/readers was
  // causing shell rows and realtime updates to overwrite the actual planner.
  const db = getTertiarySupabaseClient();
  if (!db) throw new Error("Bulk Organizer storage is not connected to the Tertiary database.");
  const { data, error } = await db.from("bulk_organizer_plans").select("*").eq("plan_date", planDate).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const canonicalDate = (value:any) => {
    const s = String(value ?? "").trim();
    return s ? s.slice(0, 10) : null;
  };
  const normalizeInvoice = (x:any) => ({
    ...x,
    scheduled_date: canonicalDate(x?.scheduled_date ?? x?.schedule_date),
  });
  const uniq = (list:any[]) => Array.from(new Map((Array.isArray(list)?list:[]).map((x:any)=>[String(x?.id ?? x?.invoice_no ?? JSON.stringify(x)),x])).values());
  const invoices = uniq(data.invoices).map(normalizeInvoice);
  const pallets = uniq(data.pallets).map(normalizeInvoice);
  return {
    ...data,
    plan_date: planDate,
    invoices,
    pallets: invoices.length ? invoices : pallets,
    customers: Array.isArray(data.customers) ? data.customers : [],
    buildings: Array.isArray(data.buildings) ? data.buildings : [],
    vehicles: Array.isArray(data.vehicles) ? data.vehicles : [],
    customer_schedules: Array.isArray(data.customer_schedules) ? data.customer_schedules : [],
    pallet_assignments: data.pallet_assignments || {},
    vehicle_meta: data.vehicle_meta || {},
    deleted_invoice_ids: Array.isArray(data.deleted_invoice_ids) ? data.deleted_invoice_ids : [],
  } as BulkOrganizerPlan;
}

export async function saveBulkOrganizerPlan(plan: BulkOrganizerPlan): Promise<BulkOrganizerPlan> {
  const preserveEmpty = (plan as any).__preserveExistingWhenEmpty !== false;
  const db = getTertiarySupabaseClient();
  if (!db) throw new Error("Bulk Organizer storage is not connected to the Tertiary database.");
  const existingResult = await db.from("bulk_organizer_plans").select("id,invoices,pallets").eq("plan_date",plan.plan_date).maybeSingle();
  if (existingResult.error) throw new Error(existingResult.error.message);
  const existing = existingResult.data;
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
    deleted_invoice_ids: plan.deleted_invoice_ids || [],
    updated_at: new Date().toISOString(),
  };
  if (preserveEmpty && Array.isArray(existing?.invoices) && existing.invoices.length > 0 && payload.invoices.length === 0) {
    payload.invoices = existing.invoices;
    payload.pallets = Array.isArray(existing.pallets) && existing.pallets.length ? existing.pallets : existing.invoices;
  }
  const { data, error } = await db.from("bulk_organizer_plans").upsert(payload,{onConflict:"plan_date"}).select("*").single();
  if (error) throw new Error(error.message);
  return data as BulkOrganizerPlan;
}

export async function loadBulkOrganizerDefaults(monthKey?: string): Promise<BulkOrganizerDefaults | null> {
  const mk = monthKey || new Date().toISOString().slice(0, 7) + "-01";
  const clients = [getPrimarySupabaseClient(), getTertiarySupabaseClient()].filter(Boolean) as any[];
  for (const db of clients) {
    const { data, error } = await db.from("bulk_organizer_month_defaults").select("*").eq("month_key", mk).maybeSingle();
    if (!error && data) return { ...data, id: String(data.id), month_key: mk } as BulkOrganizerDefaults;
  }
  try {
    const raw = localStorage.getItem(`dispatchops.bulkOrganizer.defaults.${mk}`) || localStorage.getItem("dispatchops.bulkOrganizer.defaults");
    return raw ? JSON.parse(raw) as BulkOrganizerDefaults : null;
  } catch { return null; }
}

export async function saveBulkOrganizerDefaults(value: BulkOrganizerDefaults): Promise<BulkOrganizerDefaults> {
  const mk = value.month_key || new Date().toISOString().slice(0, 7) + "-01";
  const payload = { month_key: mk, buildings: value.buildings || [], vehicles: value.vehicles || [], customer_schedules: value.customer_schedules || [], updated_at: new Date().toISOString() };
  const db = getPrimarySupabaseClient() || getTertiarySupabaseClient() || supabase;
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
