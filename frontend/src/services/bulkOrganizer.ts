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
  if (primary) {
    const { data, error } = await primary.from("bulk_organizer_plans").select("*").eq("plan_date", planDate).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as BulkOrganizerPlan;
  }
  if (tertiary) {
    const { data, error } = await tertiary.from("bulk_organizer_plans").select("*").eq("plan_date", planDate).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as BulkOrganizerPlan;
  }
  return null;
}

export async function saveBulkOrganizerPlan(plan: BulkOrganizerPlan): Promise<BulkOrganizerPlan> {
  const payload = {
    plan_date: plan.plan_date, vehicles: plan.vehicles || [], pallets: plan.pallets || [],
    customers: plan.customers || [], invoices: plan.invoices || [],
    pallet_assignments: Object.fromEntries(Object.entries(plan.pallet_assignments || {}).filter(([, value]) => !!value)), buildings: plan.buildings || [],
    vehicle_meta: plan.vehicle_meta || {}, customer_schedules: plan.customer_schedules || [],
    updated_at: new Date().toISOString(),
  };
  const primary = getPrimarySupabaseClient();
  const tertiary = getTertiarySupabaseClient();
  let db: any = primary || tertiary || supabase;
  if (primary && tertiary) {
    const p = await primary.from("bulk_organizer_plans").select("id").eq("plan_date", plan.plan_date).maybeSingle();
    if (p.error) throw new Error(p.error.message);
    if (!p.data) {
      const t = await tertiary.from("bulk_organizer_plans").select("id").eq("plan_date", plan.plan_date).maybeSingle();
      if (t.error) throw new Error(t.error.message);
      db = t.data ? tertiary : primary;
    }
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
