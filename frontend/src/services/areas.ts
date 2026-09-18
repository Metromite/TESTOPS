import { supabase } from "@/lib/supabase";
import { makeCrudService } from "./crud";
import type { Area, AreaGroup, DriverAnchoredArea, DriverAnchoredAreaGroup } from "./types";

export const areasService = makeCrudService<Area>("areas");
export const areaGroupsService = makeCrudService<AreaGroup>("area_groups");

export async function getAreaGroupMembers(groupId: string): Promise<Area[]> {
  const { data, error } = await supabase
    .from("area_group_members")
    .select("area_id, areas(*)")
    .eq("group_id", groupId);
  if (error) throw new Error(`Failed to fetch members of area group ${groupId}: ${error.message}`);
  return (data ?? []).map((row: any) => row.areas as Area);
}

export async function setAreaGroupMembers(groupId: string, areaIds: string[]): Promise<void> {
  const { error: delErr } = await supabase.from("area_group_members").delete().eq("group_id", groupId);
  if (delErr) throw new Error(`Failed to clear members of area group ${groupId}: ${delErr.message}`);
  if (areaIds.length === 0) return;
  const { error: insErr } = await supabase
    .from("area_group_members")
    .insert(areaIds.map((area_id) => ({ group_id: groupId, area_id })));
  if (insErr) throw new Error(`Failed to set members of area group ${groupId}: ${insErr.message}`);
}

/** A driver's full effective anchored-area set is the UNION of individual
 * areas and every area in any anchored group — matching the original
 * app's expand_permitted_area_ids()/driver-anchor logic (see
 * area_groups.py's module docstring). Groups are expanded here at read
 * time, never flattened into individual rows. */
export async function getDriverAnchoredAreas(
  driverId: string
): Promise<{ individual: DriverAnchoredArea[]; groups: DriverAnchoredAreaGroup[] }> {
  const [individual, groups] = await Promise.all([
    supabase.from("driver_anchored_areas").select("*").eq("driver_id", driverId).order("sort_order"),
    supabase.from("driver_anchored_area_groups").select("*").eq("driver_id", driverId).order("sort_order"),
  ]);
  if (individual.error)
    throw new Error(`Failed to fetch anchored areas for driver ${driverId}: ${individual.error.message}`);
  if (groups.error)
    throw new Error(`Failed to fetch anchored area groups for driver ${driverId}: ${groups.error.message}`);
  return { individual: individual.data ?? [], groups: groups.data ?? [] };
}

export async function setDriverAnchoredAreas(driverId: string, areaIds: string[]): Promise<void> {
  const { error: delErr } = await supabase.from("driver_anchored_areas").delete().eq("driver_id", driverId);
  if (delErr) throw new Error(`Failed to clear anchored areas for driver ${driverId}: ${delErr.message}`);
  if (areaIds.length === 0) return;
  const { error: insErr } = await supabase
    .from("driver_anchored_areas")
    .insert(areaIds.map((area_id, sort_order) => ({ driver_id: driverId, area_id, sort_order })));
  if (insErr) throw new Error(`Failed to set anchored areas for driver ${driverId}: ${insErr.message}`);
}

export async function setDriverAnchoredAreaGroups(driverId: string, groupIds: string[]): Promise<void> {
  const { error: delErr } = await supabase.from("driver_anchored_area_groups").delete().eq("driver_id", driverId);
  if (delErr) throw new Error(`Failed to clear anchored area groups for driver ${driverId}: ${delErr.message}`);
  if (groupIds.length === 0) return;
  const { error: insErr } = await supabase
    .from("driver_anchored_area_groups")
    .insert(groupIds.map((group_id, sort_order) => ({ driver_id: driverId, group_id, sort_order })));
  if (insErr) throw new Error(`Failed to set anchored area groups for driver ${driverId}: ${insErr.message}`);
}
