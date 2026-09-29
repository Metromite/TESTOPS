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

export async function loadBulkOrganizerPlan(planDate: string): Promise<BulkOrganizerPlan | null> {
  const primary = getPrimarySupabaseClient();
  const tertiary = getTertiarySupabaseClient();
  const reads: Array<{ source: "primary" | "tertiary"; data: any }> = [];

  // Historical Bulk Organizer plans may still live in Tertiary. A Primary shell
  // row must never hide a populated historical Tertiary plan.
  if (primary) {
    const { data, error } = await primary.from("bulk_organizer_plans").select("*").eq("plan_date", planDate).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) reads.push({ source: "primary", data });
  }
  if (tertiary) {
    const { data, error } = await tertiary.from("bulk_organizer_plans").select("*").eq("plan_date", planDate).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) reads.push({ source: "tertiary", data });
  }

  if (!reads.length) return null;
  const primaryRow = reads.find(r => r.source === "primary")?.data;
  const tertiaryRow = reads.find(r => r.source === "tertiary")?.data;
  const primaryInvoices = Array.isArray(primaryRow?.invoices) ? primaryRow.invoices : [];
  const tertiaryInvoices = Array.isArray(tertiaryRow?.invoices) ? tertiaryRow.invoices : [];

  // Primary wins when it has a populated planner. If it is only an empty shell,
  // preserve the populated Tertiary plan so invoices and vehicle assignments stay visible.
  if (primaryRow && primaryInvoices.length > 0) return primaryRow as BulkOrganizerPlan;
  if (tertiaryRow && tertiaryInvoices.length > 0) return tertiaryRow as BulkOrganizerPlan;
  if (primaryRow) return primaryRow as BulkOrganizerPlan;
  return tertiaryRow as BulkOrganizerPlan;
}

export async function saveBulkOrganizerPlan(plan: BulkOrganizerPlan): Promise<BulkOrganizerPlan> {
  const payload = {
    plan_date: plan.plan_date, vehicles: plan.vehicles || [], pallets: plan.pallets || [],
    customers: plan.customers || [], invoices: plan.invoices || [],
    pallet_assignments: plan.pallet_assignments || {}, buildings: plan.buildings || [],
    vehicle_meta: plan.vehicle_meta || {}, customer_schedules: plan.customer_schedules || [],
    updated_at: new Date().toISOString(),
  };
  const primary = getPrimarySupabaseClient();
  const tertiary = getTertiarySupabaseClient();
  let db: any = primary || tertiary || supabase;
  if (primary && tertiary) {
    const [p, t] = await Promise.all([
      primary.from("bulk_organizer_plans").select("id,invoices").eq("plan_date", plan.plan_date).maybeSingle(),
      tertiary.from("bulk_organizer_plans").select("id,invoices").eq("plan_date", plan.plan_date).maybeSingle(),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (t.error) throw new Error(t.error.message);
    const primaryHasInvoices = Array.isArray(p.data?.invoices) && p.data.invoices.length > 0;
    const tertiaryHasInvoices = Array.isArray(t.data?.invoices) && t.data.invoices.length > 0;
    // Keep saving on the database that owns the existing populated plan. This
    // preserves older Tertiary data while allowing new dates to live on Primary.
    if (primaryHasInvoices) db = primary;
    else if (tertiaryHasInvoices) db = tertiary;
    else if (p.data) db = primary;
    else if (t.data) db = tertiary;
    else db = primary;
  }
  const { data, error } = await db.from("bulk_organizer_plans").upsert(payload, { onConflict: "plan_date" }).select("*").single();
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
