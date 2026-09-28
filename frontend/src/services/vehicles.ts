import { supabase } from "@/lib/supabase";
import { makeCrudService } from "./crud";
import type { AreaAnchoredVehicle, Vehicle, VehiclePermittedArea, VehiclePermittedAreaGroup } from "./types";

export const vehiclesService = makeCrudService<Vehicle>("vehicles");

export async function getPermittedAreas(vehicleId: string): Promise<VehiclePermittedArea[]> {
  const { data, error } = await supabase.from("vehicle_permitted_areas").select("*").eq("vehicle_id", vehicleId);
  if (error) throw new Error(`Failed to fetch permitted areas for vehicle ${vehicleId}: ${error.message}`);
  return data ?? [];
}

export async function setPermittedAreas(vehicleId: string, areaIds: string[]): Promise<void> {
  const { error: delErr } = await supabase.from("vehicle_permitted_areas").delete().eq("vehicle_id", vehicleId);
  if (delErr) throw new Error(`Failed to clear permitted areas for vehicle ${vehicleId}: ${delErr.message}`);
  if (areaIds.length === 0) return;
  const { error: insErr } = await supabase
    .from("vehicle_permitted_areas")
    .insert(areaIds.map((area_id) => ({ vehicle_id: vehicleId, area_id })));
  if (insErr) throw new Error(`Failed to set permitted areas for vehicle ${vehicleId}: ${insErr.message}`);
}

export async function getPermittedAreaGroups(vehicleId: string): Promise<VehiclePermittedAreaGroup[]> {
  const { data, error } = await supabase
    .from("vehicle_permitted_area_groups")
    .select("*")
    .eq("vehicle_id", vehicleId);
  if (error) throw new Error(`Failed to fetch permitted area groups for vehicle ${vehicleId}: ${error.message}`);
  return data ?? [];
}

export async function setPermittedAreaGroups(vehicleId: string, groupIds: string[]): Promise<void> {
  const { error: delErr } = await supabase.from("vehicle_permitted_area_groups").delete().eq("vehicle_id", vehicleId);
  if (delErr) throw new Error(`Failed to clear permitted area groups for vehicle ${vehicleId}: ${delErr.message}`);
  if (groupIds.length === 0) return;
  const { error: insErr } = await supabase
    .from("vehicle_permitted_area_groups")
    .insert(groupIds.map((group_id) => ({ vehicle_id: vehicleId, group_id })));
  if (insErr) throw new Error(`Failed to set permitted area groups for vehicle ${vehicleId}: ${insErr.message}`);
}

export async function getAnchoredVehicles(areaId: string): Promise<AreaAnchoredVehicle[]> {
  const { data, error } = await supabase.from("area_anchored_vehicles").select("*").eq("area_id", areaId);
  if (error) throw new Error(`Failed to fetch anchored vehicles for area ${areaId}: ${error.message}`);
  return data ?? [];
}

export async function setAnchoredVehicles(areaId: string, vehicleIds: string[]): Promise<void> {
  const { error: delErr } = await supabase.from("area_anchored_vehicles").delete().eq("area_id", areaId);
  if (delErr) throw new Error(`Failed to clear anchored vehicles for area ${areaId}: ${delErr.message}`);
  if (vehicleIds.length === 0) return;
  const { error: insErr } = await supabase
    .from("area_anchored_vehicles")
    .insert(vehicleIds.map((vehicle_id) => ({ area_id: areaId, vehicle_id })));
  if (insErr) throw new Error(`Failed to set anchored vehicles for area ${areaId}: ${insErr.message}`);
}
