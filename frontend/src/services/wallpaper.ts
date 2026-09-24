import { supabase, getFederatedSupabaseClients } from "@/lib/supabase";
import { SETTINGS_SINGLETON_ID } from "./types";
import type { AppearanceConfig } from "./types";

const BUCKET = "wallpaper";

export async function getAppearanceConfig(): Promise<AppearanceConfig | null> {
  const { data, error } = await supabase
    .from("appearance_config")
    .select("*")
    .eq("id", SETTINGS_SINGLETON_ID)
    .maybeSingle();
  if (error) throw new Error(`Failed to load appearance config: ${error.message}`);
  return (data as AppearanceConfig) ?? null;
}

/** Resolves a stored Storage path to a URL the <img>/CSS background can
 * actually load. The bucket is private (see migration 0005), so this is
 * a short-lived signed URL, not a public one. */
export async function getWallpaperUrl(storagePath: string, expiresInSeconds = 3600): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw new Error(`Failed to sign wallpaper URL: ${error.message}`);
  return data?.signedUrl ?? null;
}

/** Uploads a new wallpaper image and updates the shared appearance config
 * so every other open DispatchOPS window picks it up via Realtime
 * (architecture brief section 11). */
export async function setWallpaper(mode: "light" | "dark", file: File, updatedBy: string): Promise<AppearanceConfig> {
  const path = `${mode}/${Date.now()}-${file.name}`;
  const uploadResults = await Promise.all(getFederatedSupabaseClients().map((client) => client.storage.from(BUCKET).upload(path, file, { upsert: true })));
  const uploadErr = uploadResults.find((r) => r.error)?.error;
  if (uploadErr) throw new Error(`Failed to upload wallpaper: ${uploadErr.message}`);

  const column = mode === "light" ? "light_bg_path" : "dark_bg_path";
  const current = await getAppearanceConfig();
  const { data, error } = await supabase
    .from("appearance_config")
    .upsert({ id: SETTINGS_SINGLETON_ID, ...(current ?? {}), [column]: path, updated_by: updatedBy })
    .select()
    .single();
  if (error) throw new Error(`Failed to save wallpaper setting: ${error.message}`);
  if (current?.[column as keyof AppearanceConfig] && current[column as keyof AppearanceConfig] !== path) {
    await Promise.all(getFederatedSupabaseClients().map((client) => client.storage.from(BUCKET).remove([current[column as keyof AppearanceConfig] as string])));
  }
  return data as AppearanceConfig;
}

export async function resetWallpaper(mode: "light" | "dark"): Promise<void> {
  const column = mode === "light" ? "light_bg_path" : "dark_bg_path";
  const current = await getAppearanceConfig();
  const oldPath = mode === "light" ? current?.light_bg_path : current?.dark_bg_path;
  const payload = { id: SETTINGS_SINGLETON_ID, ...(current ?? {}), [column]: null, updated_by: "dispatchops" };
  const { error } = await supabase.from("appearance_config").upsert(payload);
  if (error) throw new Error(`Failed to reset wallpaper: ${error.message}`);
  if (oldPath) await Promise.all(getFederatedSupabaseClients().map((client) => client.storage.from(BUCKET).remove([oldPath])));
}
