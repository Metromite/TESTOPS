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
  // Bulk Organizer has historically been written to both Primary and Tertiary.
  // Read both and merge instead of allowing either project's partial copy to hide
  // invoices, stores, vehicles, or assignments that exist in the other project.
  const primary = getPrimarySupabaseClient() || supabase;
  const tertiary = getTertiarySupabaseClient();
  const reads = await Promise.all([
    primary.from("bulk_organizer_plans").select("*").eq("plan_date", planDate).maybeSingle(),
    tertiary ? tertiary.from("bulk_organizer_plans").select("*").eq("plan_date", planDate).maybeSingle() : Promise.resolve({ data: null, error: null } as any),
  ]);
  const [p, t] = reads as any[];
  if (p.error && t.error) throw new Error(p.error.message || t.error.message);
  const primaryPlan = p.data as BulkOrganizerPlan | null;
  const tertiaryPlan = t.data as BulkOrganizerPlan | null;
  if (!primaryPlan && !tertiaryPlan) return null;
  if (!primaryPlan) return tertiaryPlan;
  if (!tertiaryPlan) return primaryPlan;

  const uniqueMerge = (a: any[] = [], b: any[] = [], keyFn: (x:any)=>string) => {
    const map = new Map<string, any>();
    for (const x of b) map.set(keyFn(x), x);
    for (const x of a) map.set(keyFn(x), { ...map.get(keyFn(x)), ...x });
    return Array.from(map.values());
  };
  const invoices = uniqueMerge(
    primaryPlan.invoices || [],
    tertiaryPlan.invoices || [],
    x => String(x?.id || `invoice:${x?.invoice_no || ""}:${x?.scheduled_date || planDate}`)
  );
  const pallets = uniqueMerge(
    primaryPlan.pallets || [],
    tertiaryPlan.pallets || [],
    x => String(x?.id || `invoice:${x?.invoice_no || ""}:${x?.scheduled_date || planDate}`)
  );
  const buildings = uniqueMerge(primaryPlan.buildings || [], tertiaryPlan.buildings || [], x => String(x?.id || `building:${x?.name || ""}`));
  const vehicles = uniqueMerge(primaryPlan.vehicles || [], tertiaryPlan.vehicles || [], x => String(x?.vehicle_id || ""));
  const schedules = uniqueMerge(primaryPlan.customer_schedules || [], tertiaryPlan.customer_schedules || [], x => String(x?.id || `schedule:${x?.customer_name || ""}`));
  const customers = uniqueMerge(primaryPlan.customers || [], tertiaryPlan.customers || [], x => String(x?.id || `customer:${x?.name || x?.customer_name || ""}`));
  return {
    ...tertiaryPlan,
    ...primaryPlan,
    plan_date: planDate,
    vehicles,
    pallets,
    invoices,
    customers,
    buildings,
    customer_schedules: schedules,
    pallet_assignments: { ...(tertiaryPlan.pallet_assignments || {}), ...(primaryPlan.pallet_assignments || {}) },
    vehicle_meta: { ...(tertiaryPlan.vehicle_meta || {}), ...(primaryPlan.vehicle_meta || {}) },
  } as BulkOrganizerPlan;
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
