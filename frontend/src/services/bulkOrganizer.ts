import { supabase } from "../lib/supabase";

export type BulkOrganizerPlan = {
  customers?: Array<{ id: string; name: string; area: string; division: string; enabled: boolean }>;
  invoices?: Array<{ id: string; invoice_no: string; customer_id: string; customer_name: string; area: string; division: string; pallets: number; invoice_date: string | null; scheduled_date: string; vehicle_id: string | null }>;
  pallet_assignments?: Record<string, string | null>;
  id?: string;
  plan_date: string;
  // driver_name/helper_name are per-day (a driver can change day to day even
  // on the same default vehicle), so they live here, not on the default row.
  vehicles: Array<{ vehicle_id: string; capacity: number; driver_name?: string; helper_name?: string }>;
  pallets: Array<{
    id: string;
    invoice_no: string;
    customer_name: string;
    area: string;
    division: string;
    pallets: number;
    invoice_date: string | null;
    scheduled_date: string;
    vehicle_id: string | null;
  }>;
  updated_at?: string;
};

export async function loadBulkOrganizerPlan(planDate: string): Promise<BulkOrganizerPlan | null> {
  const { data, error } = await supabase
    .from("bulk_organizer_plans")
    .select("*")
    .eq("plan_date", planDate)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? (data as BulkOrganizerPlan) : null;
}

export async function saveBulkOrganizerPlan(plan: BulkOrganizerPlan): Promise<BulkOrganizerPlan> {
  const payload = {
    plan_date: plan.plan_date,
    vehicles: plan.vehicles,
    pallets: plan.pallets,
    customers: plan.customers || [],
    invoices: plan.invoices || [],
    pallet_assignments: plan.pallet_assignments || {},
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("bulk_organizer_plans")
    .upsert(payload, { onConflict: "plan_date" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as BulkOrganizerPlan;
}

// ============================================================================
// Bulk Organizer v31 defaults (migration 0047). These are the admin-curated
// "every day starts with this" sets — separate from the per-day plan above,
// which only ever holds add/remove overrides on top of these.
// ============================================================================

export type BulkOrganizerDefaultVehicle = {
  id: string;
  vehicle_id: string;
  capacity: number;
  driver_name: string | null;
  helper_name: string | null;
  sort_order: number;
};

export type BulkOrganizerDefaultCustomer = {
  id: string;
  name: string;
  area: string | null;
  division: string | null;
  building_type: "store" | "hospital" | "warehouse";
  weekdays: number[]; // 0=Sun..6=Sat
  sort_order: number;
};

export async function listDefaultVehicles(): Promise<BulkOrganizerDefaultVehicle[]> {
  const { data, error } = await supabase
    .from("bulk_organizer_default_vehicles")
    .select("*")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data || []) as BulkOrganizerDefaultVehicle[];
}

export async function upsertDefaultVehicle(row: Partial<BulkOrganizerDefaultVehicle> & { vehicle_id: string }): Promise<BulkOrganizerDefaultVehicle> {
  const { data, error } = await supabase
    .from("bulk_organizer_default_vehicles")
    .upsert(row, { onConflict: "vehicle_id" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as BulkOrganizerDefaultVehicle;
}

export async function deleteDefaultVehicle(id: string): Promise<void> {
  const { error } = await supabase.from("bulk_organizer_default_vehicles").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listDefaultCustomers(): Promise<BulkOrganizerDefaultCustomer[]> {
  const { data, error } = await supabase
    .from("bulk_organizer_default_customers")
    .select("*")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data || []) as BulkOrganizerDefaultCustomer[];
}

export async function upsertDefaultCustomer(row: Partial<BulkOrganizerDefaultCustomer> & { name: string }): Promise<BulkOrganizerDefaultCustomer> {
  const { data, error } = await supabase
    .from("bulk_organizer_default_customers")
    .upsert(row, { onConflict: "name" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as BulkOrganizerDefaultCustomer;
}

export async function deleteDefaultCustomer(id: string): Promise<void> {
  const { error } = await supabase.from("bulk_organizer_default_customers").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

