import { supabase } from "@/lib/supabase";
import { SETTINGS_SINGLETON_ID } from "./types";
import type { AiProviderConfig, ControlCenterConfig, RouteSheetLayout } from "./types";

// Every settings table is a singleton row (id pinned by a check
// constraint — see migration 0003) so every PC always reads/writes the
// exact same row. get()/save() below hide that shape behind a plain
// "one config object" API, matching how the old app's Settings pages
// already treated these (single GET, single PUT, no id in the URL).

async function getSingleton<T>(table: string): Promise<T | null> {
  const { data, error } = await supabase.from(table).select("*").eq("id", SETTINGS_SINGLETON_ID).maybeSingle();
  if (error) throw new Error(`Failed to load ${table}: ${error.message}`);
  return (data as T) ?? null;
}

async function saveSingleton<T>(table: string, patch: Partial<T>): Promise<T> {
  const { data, error } = await supabase
    .from(table)
    .update(patch as object)
    .eq("id", SETTINGS_SINGLETON_ID)
    .select()
    .single();
  if (error) throw new Error(`Failed to save ${table}: ${error.message}`);
  return data as T;
}

export const aiSettings = {
  get: () => getSingleton<AiProviderConfig>("ai_provider_config"),
  /** SECRETS WARNING (see migration 0005 and lib/supabase.ts): only ever
   * pass provider/model/fallback STRUCTURE here, never a real api_key or
   * fallback_key value — those must stay in the local per-PC config file
   * (Tauri's read_local_config/write_local_config), matching the old
   * architecture's already-solved design. This function does not enforce
   * that; the caller (AiSettings.tsx) must not send key fields. */
  save: (patch: Partial<AiProviderConfig>) => saveSingleton<AiProviderConfig>("ai_provider_config", patch),
};

export const controlCenterSettings = {
  get: () => getSingleton<ControlCenterConfig>("control_center_config"),
  save: (patch: Partial<ControlCenterConfig>) =>
    saveSingleton<ControlCenterConfig>("control_center_config", patch),
};

export const sheetLayoutSettings = {
  get: () => getSingleton<RouteSheetLayout>("route_sheet_layout"),
  save: (patch: Partial<RouteSheetLayout>) => saveSingleton<RouteSheetLayout>("route_sheet_layout", patch),
};
