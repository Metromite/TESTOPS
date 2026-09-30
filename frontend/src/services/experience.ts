import { supabase } from "@/lib/supabase";
import { makeCrudService } from "./crud";
import type { ExperienceHistoryRow } from "./types";

export const experienceService = makeCrudService<ExperienceHistoryRow>("experience_history");

/** Everything build_experience_cache() (route_planner.py) reads to compute
 * last-worked-area/last-worked-sector for one person. Never mutated after
 * write, per the original app's immutable-history convention — this is a
 * read helper only, there is no update path exposed here on purpose. */
export async function getHistoryForPerson(personCode: string): Promise<ExperienceHistoryRow[]> {
  const { data, error } = await supabase
    .from("experience_history")
    .select("*")
    .eq("person_code", personCode)
    .order("date", { ascending: false });
  if (error) throw new Error(`Failed to fetch experience history for ${personCode}: ${error.message}`);
  return data ?? [];
}
