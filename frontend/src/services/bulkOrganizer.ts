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
  const tertiary = getTertiarySupabaseClient();
  const primary = getPrimarySupabaseClient();
  const candidates = [tertiary, primary].filter(Boolean) as any[];
  let lastError: any = null;
  for (const db of candidates) {
    const { data, error } = await db.from("bulk_organizer_plans").select("*").eq("plan_date", planDate).maybeSingle();
    if (!error && data) return data as BulkOrganizerPlan;
    if (error) lastError = error;
  }
  if (lastError && candidates.length === 1) throw new Error(lastError.message);
  return null;
}

export async function loadBulkOrganizerMonthPlans(monthKey: string, nextMonth: string): Promise<BulkOrganizerPlan[]> {
  const clients = [getTertiarySupabaseClient(), getPrimarySupabaseClient()].filter(Boolean) as any[];
  const merged = new Map<string, BulkOrganizerPlan>();
  for (const db of clients) {
    const { data, error } = await db.from("bulk_organizer_plans").select("plan_date,invoices").gte("plan_date", monthKey).lt("plan_date", nextMonth);
    if (error) continue;
    for (const row of data || []) {
      if (!merged.has(String(row.plan_date))) merged.set(String(row.plan_date), row as BulkOrganizerPlan);
    }
  }
  return [...merged.values()];
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
  const tertiary = getTertiarySupabaseClient();
  const primary = getPrimarySupabaseClient();
  // Preserve the database that already owns this date. Existing DispatchOPS
  // installs contain historical Bulk Organizer plans in Primary, while newer
  // Department installs may contain them in Tertiary.
  let db: any = tertiary || primary || supabase;
  if (primary && tertiary) {
    const [t, p] = await Promise.all([
      tertiary.from("bulk_organizer_plans").select("id").eq("plan_date", plan.plan_date).maybeSingle(),
      primary.from("bulk_organizer_plans").select("id").eq("plan_date", plan.plan_date).maybeSingle(),
    ]);
    db = p?.data ? primary : (t?.data ? tertiary : primary);
  }
  const { data, error } = await db.from("bulk_organizer_plans").upsert(payload, { onConflict: "plan_date" }).select("*").single();
  if (error) throw new Error(error.message);
  return data as BulkOrganizerPlan;
}

export async function loadBulkOrganizerDefaults(monthKey?: string): Promise<BulkOrganizerDefaults | null> {
  const mk = monthKey || new Date().toISOString().slice(0, 7) + "-01";
  const db = getTertiarySupabaseClient() || supabase;
  const { data, error } = await db
    .from("bulk_organizer_month_defaults")
    .select("*")
    .eq("month_key", mk)
    .maybeSingle();
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
  const payload = {
    month_key: mk,
    buildings: value.buildings || [],
    vehicles: value.vehicles || [],
    customer_schedules: value.customer_schedules || [],
    updated_at: new Date().toISOString(),
  };
  const db = getTertiarySupabaseClient() || supabase;
  const { data, error } = await db
    .from("bulk_organizer_month_defaults")
    .upsert(payload, { onConflict: "month_key" })
    .select("*")
    .single();
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
