import { supabase } from "../lib/supabase";

export type BulkOrganizerPlan = {
  id?: string;
  plan_date: string;
  vehicles: Array<{ vehicle_id: string; capacity: number }>;
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
