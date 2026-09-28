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
  // Tertiary is the canonical Bulk Organizer store. Primary is only a fallback
  // for older days that were never copied to the department database. Do not
  // merge two full plans: that can re-introduce stale/null assignment maps and
  // make one database overwrite the other during autosave.
  const tertiary = getTertiarySupabaseClient();
  const primary = getPrimarySupabaseClient() || supabase;

  const readPlan = async (db: any) => db
    .from("bulk_organizer_plans")
    .select("*")
    .eq("plan_date", planDate)
    .maybeSingle();

  const first = tertiary ? await readPlan(tertiary) : { data: null, error: null } as any;
  if (!first.error && first.data) {
    const plan = first.data as BulkOrganizerPlan;
    // Keep only actual loaded assignments. Null slots are not state and should
    // never be allowed to balloon the React state for a large invoice.
    plan.pallet_assignments = Object.fromEntries(
      Object.entries(plan.pallet_assignments || {}).filter(([, value]) => !!value)
    );
    return plan;
  }

  const fallback = await readPlan(primary);
  if (fallback.error) throw new Error(first.error?.message || fallback.error.message);
  if (!fallback.data) return null;
  const plan = fallback.data as BulkOrganizerPlan;
  plan.pallet_assignments = Object.fromEntries(
    Object.entries(plan.pallet_assignments || {}).filter(([, value]) => !!value)
  );
  return plan;
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
  const db = getTertiarySupabaseClient() || supabase;
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
