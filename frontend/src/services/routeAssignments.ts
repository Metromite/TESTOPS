import { supabase } from "@/lib/supabase";
import { makeCrudService } from "./crud";
import type { RouteAssignment } from "./types";

export const routeAssignmentsService = makeCrudService<RouteAssignment>("route_assignments");

export async function getPlanRows(planBatchId: string, planRole: "driver" | "helper"): Promise<RouteAssignment[]> {
  const { data, error } = await supabase
    .from("route_assignments")
    .select("*")
    .eq("plan_batch_id", planBatchId)
    .eq("plan_role", planRole)
    .order("sort_order");
  if (error) throw new Error(`Failed to fetch route plan rows: ${error.message}`);
  return data ?? [];
}

/** Regenerating a plan replaces every non-manually-edited row for its own
 * plan_role only — matching the original app's rule that a Driver Route
 * Plan regeneration never touches Helper rows and vice versa (see
 * route_plan.py's module docstring). The actual scoring/assignment
 * computation that produces `rows` is the route-planner engine, which is
 * a separate porting effort (see MIGRATION_STATUS.md) — this function
 * only persists whatever rows that engine produces. */
export async function replaceGeneratedPlanRows(
  planBatchId: string,
  planRole: "driver" | "helper",
  rows: Partial<RouteAssignment>[]
): Promise<void> {
  const { error: delErr } = await supabase
    .from("route_assignments")
    .delete()
    .eq("plan_batch_id", planBatchId)
    .eq("plan_role", planRole)
    .eq("is_manually_edited", false);
  if (delErr) throw new Error(`Failed to clear previous ${planRole} plan rows: ${delErr.message}`);
  if (rows.length === 0) return;
  const { error: insErr } = await supabase
    .from("route_assignments")
    .insert(rows.map((r) => ({ ...r, plan_batch_id: planBatchId, plan_role: planRole })));
  if (insErr) throw new Error(`Failed to insert generated ${planRole} plan rows: ${insErr.message}`);
}

export async function reorderRows(rowIdsInOrder: string[]): Promise<void> {
  await Promise.all(
    rowIdsInOrder.map((id, index) => supabase.from("route_assignments").update({ sort_order: index }).eq("id", id))
  );
}
