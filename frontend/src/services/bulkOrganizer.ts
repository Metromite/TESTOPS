import { supabase } from "../lib/supabase";

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
  id?: string;
  buildings: any[];
  vehicles: any[];
  customer_schedules: any[];
  updated_at?: string;
};

export async function loadBulkOrganizerPlan(planDate: string): Promise<BulkOrganizerPlan | null> {
  const { data, error } = await supabase.from("bulk_organizer_plans").select("*").eq("plan_date", planDate).maybeSingle();
  if (error) throw new Error(error.message);
  return data as BulkOrganizerPlan | null;
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
  const { data, error } = await supabase.from("bulk_organizer_plans").upsert(payload, { onConflict: "plan_date" }).select("*").single();
  if (error) throw new Error(error.message);
  return data as BulkOrganizerPlan;
}

export async function loadBulkOrganizerDefaults(_monthKey?: string): Promise<BulkOrganizerDefaults | null> {
  const { data, error } = await supabase.from("bulk_organizer_defaults").select("*").eq("id", 1).maybeSingle();
  if (error) {
    // Older deployments may not have the optional defaults table in PostgREST's schema cache.
    // Keep the organizer usable and recover defaults from this browser until the migration is applied.
    if (error.code === "PGRST205" || /bulk_organizer_defaults/i.test(error.message)) {
      try { const raw = localStorage.getItem("dispatchops.bulkOrganizer.defaults"); return raw ? JSON.parse(raw) as BulkOrganizerDefaults : null; } catch { return null; }
    }
    throw new Error(error.message);
  }
  return data as BulkOrganizerDefaults | null;
}

export async function saveBulkOrganizerDefaults(value: BulkOrganizerDefaults): Promise<BulkOrganizerDefaults> {
  const payload = { id: 1, buildings: value.buildings || [], vehicles: value.vehicles || [], customer_schedules: value.customer_schedules || [], updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from("bulk_organizer_defaults").upsert(payload, { onConflict: "id" }).select("*").single();
  if (error) {
    if (error.code === "PGRST205" || /bulk_organizer_defaults/i.test(error.message)) {
      localStorage.setItem("dispatchops.bulkOrganizer.defaults", JSON.stringify(payload));
      return payload as BulkOrganizerDefaults;
    }
    throw new Error(error.message);
  }
  localStorage.setItem("dispatchops.bulkOrganizer.defaults", JSON.stringify(data));
  return data as BulkOrganizerDefaults;
}
