import { makeCrudService } from "./crud";
import type { Driver } from "./types";

export const driversService = makeCrudService<Driver>("drivers");

/** Convenience lookup by the business code (matches old app's /drivers/{code} usage). */
export async function getDriverByCode(code: string): Promise<Driver | null> {
  const { supabase } = await import("@/lib/supabase");
  const { data, error } = await supabase.from("drivers").select("*").eq("code", code).maybeSingle();
  if (error) throw new Error(`Failed to fetch driver ${code}: ${error.message}`);
  return (data as Driver) ?? null;
}
