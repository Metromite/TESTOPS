import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseProfile {
  id: string;
  name: string;
  url: string;
  publishableKey: string;
}

const PROFILE_KEY = "dispatchops.supabase.profiles.v2";
const ACTIVE_KEY = "dispatchops.supabase.active-profile.v2";

const ENV_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "https://chrokbnrlvrfejckmzuz.supabase.co";
const ENV_KEY = ((import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined) ?? "sb_publishable_kZAj4WW0l3skIibmjyR3zQ_83aCAjmY";

// Secondary project configured for the current DispatchOPS deployment.
const SECONDARY_URL = (import.meta.env.VITE_SUPABASE_SECONDARY_URL as string | undefined) ?? "https://vyqyrcqrdsyrxywglqbh.supabase.co";
const SECONDARY_KEY = (import.meta.env.VITE_SUPABASE_SECONDARY_PUBLISHABLE_KEY as string | undefined) ?? "sb_publishable_CreQOVJ9ZYkp6PGBqWHlVA_q1CSur1n";
const TERTIARY_URL = (import.meta.env.VITE_SUPABASE_TERTIARY_URL as string | undefined) ?? "https://ptmbtveernkglmubrtdw.supabase.co";
const TERTIARY_KEY = (import.meta.env.VITE_SUPABASE_TERTIARY_PUBLISHABLE_KEY as string | undefined) ?? "sb_publishable_dX0pnn8--xI_WJtqweaWGA_8yh8ec5U";

function envProfile(): SupabaseProfile | null {
  if (!ENV_URL || !ENV_KEY) return null;
  return { id: "default", name: "DispatchOPS Primary", url: ENV_URL, publishableKey: ENV_KEY };
}

function secondaryProfile(): SupabaseProfile {
  return { id: "secondary", name: "DispatchOPS Secondary", url: SECONDARY_URL, publishableKey: SECONDARY_KEY };
}
function tertiaryProfile(): SupabaseProfile {
  return { id: "tertiary", name: "DispatchOPS Tertiary", url: TERTIARY_URL, publishableKey: TERTIARY_KEY };
}

export function getSupabaseProfiles(): SupabaseProfile[] {
  try {
    const stored = JSON.parse(localStorage.getItem(PROFILE_KEY) || "[]") as SupabaseProfile[];
    const valid = Array.isArray(stored)
      ? stored.filter((p) => p && p.id && p.name && p.url && p.publishableKey)
      : [];
    const primary = envProfile();
    if (primary && !valid.some((p) => p.id === primary.id)) valid.unshift(primary);
    const secondary = secondaryProfile();
    if (!valid.some((p) => p.id === secondary.id)) valid.push(secondary);
    const tertiary = tertiaryProfile();
    if (!valid.some((p) => p.id === tertiary.id)) valid.push(tertiary);
    return valid;
  } catch {
    const out: SupabaseProfile[] = [];
    const primary = envProfile();
    if (primary) out.push(primary);
    out.push(secondaryProfile());
    out.push(tertiaryProfile());
    return out;
  }
}

export function getActiveSupabaseProfile(): SupabaseProfile | null {
  const profiles = getSupabaseProfiles();
  if (!profiles.length) return null;
  const activeId = localStorage.getItem(ACTIVE_KEY) || "default";
  return profiles.find((p) => p.id === activeId) ?? profiles[0];
}

export function saveSupabaseProfiles(profiles: SupabaseProfile[]): void {
  const cleaned = profiles
    .map((p) => ({ ...p, name: p.name.trim(), url: p.url.trim().replace(/\/$/, ""), publishableKey: p.publishableKey.trim() }))
    .filter((p) => p.id && p.name && p.url && p.publishableKey);
  localStorage.setItem(PROFILE_KEY, JSON.stringify(cleaned));
}

export function activateSupabaseProfile(id: string): void {
  // The federated application always uses Primary + Secondary together.
  // Keep this API for backwards compatibility with the existing Settings UI,
  // but never let it disable the primary/secondary federation.
  localStorage.setItem(ACTIVE_KEY, id);
}

function buildClient(profile: SupabaseProfile | null): SupabaseClient {
  const url = profile?.url || "http://127.0.0.1:9";
  const key = profile?.publishableKey || "not-configured";
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
}

const profilesAtStart = getSupabaseProfiles();
const primaryProfile = profilesAtStart.find((p) => p.id === "default") ?? profilesAtStart[0] ?? null;
const secondaryProfileAtStart = profilesAtStart.find((p) => p.id === "secondary") ?? null;
const tertiaryProfileAtStart = profilesAtStart.find((p) => p.id === "tertiary") ?? null;
const primaryClient = buildClient(primaryProfile);
const secondaryClient = secondaryProfileAtStart ? buildClient(secondaryProfileAtStart) : null;
const tertiaryClient = tertiaryProfileAtStart ? buildClient(tertiaryProfileAtStart) : null;
let activeClient = buildClient(getActiveSupabaseProfile());

const READ_METHODS = new Set([
  "select","eq","neq","gt","gte","lt","lte","like","ilike","is","in","or","filter","match",
  "not","order","limit","range","contains","containedBy","overlaps","textSearch","filter",
  "csv","maybeSingle","single","throwOnError"
]);

class MultiReadQueryState {
  builders: any[];
  singleMode: "single" | "maybeSingle" | null = null;
  constructor(table: string) {
    this.builders = [primaryClient.from(table)];
    if (secondaryClient) this.builders.push(secondaryClient.from(table));
    if (tertiaryClient) this.builders.push(tertiaryClient.from(table));
  }
  async resolve(): Promise<any> {
    const results = await Promise.all(this.builders.map((b) => Promise.resolve(b)));
    const errors = results.map((r) => r?.error).filter(Boolean);
    if (errors.length) return { data: null, error: errors[0], count: null, status: results[0]?.status, statusText: results[0]?.statusText };
    if (this.singleMode) {
      const rows = results.flatMap((r) => r?.data == null ? [] : [r.data]).filter(Boolean);
      if (this.singleMode === "maybeSingle") {
        return { ...results.find((r) => r?.data != null) ?? results[0], data: rows[0] ?? null, count: results.reduce((s,r)=>s+(r?.count ?? 0),0) || null };
      }
      return { ...results[0], data: rows[0] ?? null, count: results.reduce((s,r)=>s+(r?.count ?? 0),0) || null };
    }
    const rawData = results.flatMap((r) => Array.isArray(r?.data) ? r.data : []);
    const seen = new Set<string>();
    const data = rawData.filter((row: any) => {
      if (!row || typeof row !== "object") return true;
      const key = row.id ?? row.code ?? row.driver_code ?? row.helper_code ?? row.vehicle_number ?? row.number ?? row.area_code ?? row.key;
      if (key == null) return true;
      const k = String(key);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const count = results.some((r) => typeof r?.count === "number") ? results.reduce((s,r)=>s+(typeof r?.count === "number" ? r.count : 0),0) : null;
    return { ...results[0], data, count };
  }
}

function createMultiReadQuery(table: string): any {
  const state = new MultiReadQueryState(table);
  const readMethods = new Set([
    "select","eq","neq","gt","gte","lt","lte","like","ilike","is","in","or","filter","match",
    "not","order","limit","range","contains","containedBy","overlaps","textSearch","csv","throwOnError"
  ]);
  const proxy: any = new Proxy(state as any, {
    get(target, prop: string | symbol) {
      if (prop === "then") return (onfulfilled: any, onrejected: any) => target.resolve().then(onfulfilled, onrejected);
      if (prop === "catch") return (onrejected: any) => target.resolve().catch(onrejected);
      if (prop === "finally") return (onfinally: any) => target.resolve().finally(onfinally);
      if (prop === "maybeSingle" || prop === "single") return (...args: any[]) => {
        target.singleMode = prop as "single" | "maybeSingle";
        target.builders = target.builders.map((b: any) => b[prop](...args));
        return proxy;
      };
      if (readMethods.has(String(prop))) return (...args: any[]) => {
        target.builders = target.builders.map((b: any) => b[String(prop)](...args));
        return proxy;
      };
      if (["insert","upsert","update","delete"].includes(String(prop))) {
        return (...args: any[]) => (target.builders[0] as any)[String(prop)](...args);
      }
      const first = target.builders[0];
      const value = first[prop as any];
      return typeof value === "function" ? value.bind(first) : value;
    }
  });
  return proxy;
}
/**
 * Stable proxy used by the existing application services.
 * SELECT/read chains are transparently federated across both projects.
 * Mutations remain on the active/primary project; import-specific writes use
 * getSupabaseClientForImport() so an entire import stays in one project.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (prop === "from") return (table: string) => createMultiReadQuery(table);
    if (prop === "storage") return (activeClient as any).storage;
    if (prop === "auth") return (activeClient as any).auth;
    if (prop === "realtime") return (activeClient as any).realtime;
    const value = (activeClient as any)[prop];
    return typeof value === "function" ? value.bind(activeClient) : value;
  },
});

export const isSupabaseConfigured = Boolean(primaryProfile?.url && primaryProfile?.publishableKey);

export function getPrimarySupabaseClient(): SupabaseClient {
  return primaryClient;
}

export function getSecondarySupabaseClient(): SupabaseClient | null { return secondaryClient; }
export function getTertiarySupabaseClient(): SupabaseClient | null { return tertiaryClient; }
export function getFederatedSupabaseClients(): SupabaseClient[] {
  return [primaryClient, ...(secondaryClient ? [secondaryClient] : []), ...(tertiaryClient ? [tertiaryClient] : [])];
}
export type SupabaseProject = "primary" | "secondary" | "tertiary";
export function getSupabaseClientByProject(project: SupabaseProject): SupabaseClient {
  if (project === "tertiary" && tertiaryClient) return tertiaryClient;
  if (project === "secondary" && secondaryClient) return secondaryClient;
  return primaryClient;
}

async function storageUsageBytes(client: SupabaseClient): Promise<number> {
  let total = 0;
  async function walk(prefix = ""): Promise<void> {
    let offset = 0;
    while (true) {
      const { data, error } = await client.storage.from("dispatchops-files").list(prefix, {
        limit: 1000, offset, sortBy: { column: "name", order: "asc" },
      });
      if (error) return;
      const items = data ?? [];
      for (const item of items) {
        if (item.id) total += Number(item.metadata?.size ?? 0);
        else if (item.name && item.name !== ".emptyFolderPlaceholder") await walk(prefix ? `${prefix}/${item.name}` : item.name);
      }
      if (items.length < 1000) break;
      offset += 1000;
    }
  }
  await walk();
  return total;
}

/**
 * Chooses the owning project for a NEW import. Primary is used until its
 * configured threshold is reached, then Secondary receives the whole import.
 * A single import is never split between projects, preventing broken
 * batch/fact relationships.
 */
export async function chooseImportProject(fileSizeBytes = 0): Promise<SupabaseProject> {
  const clients: Array<{project: SupabaseProject; client: SupabaseClient}> = [
    {project:"primary",client:primaryClient},
    ...(secondaryClient ? [{project:"secondary" as const,client:secondaryClient}] : []),
    ...(tertiaryClient ? [{project:"tertiary" as const,client:tertiaryClient}] : []),
  ];
  // Supabase's database quota is the hard limit that can make a project read-only.
  // Never use Storage usage as a proxy for database capacity. Keep a safety headroom
  // on every project except the final overflow project, and keep each import atomic.
  const DATABASE_LIMIT = 500 * 1024 * 1024;
  const SAFETY_THRESHOLD = 0.85;
  const projectedGrowth = Math.max(0, Number(fileSizeBytes || 0));
  const usages = await Promise.all(clients.map(async x => {
    const { data, error } = await x.client.rpc("dispatchops_database_size");
    if (error) throw new Error(`${x.project} database capacity check failed: ${error.message}`);
    return { ...x, used: Math.max(0, Number(data?.used_bytes ?? data ?? 0)) };
  }));
  for (let i = 0; i < usages.length; i++) {
    const x = usages[i];
    const ceiling = i < usages.length - 1 ? DATABASE_LIMIT * SAFETY_THRESHOLD : DATABASE_LIMIT;
    if (x.used + projectedGrowth <= ceiling) return x.project;
  }
  throw new Error("All DispatchOPS Supabase database projects are at capacity. No import was started.");
}

export async function getSupabaseClientForImport(fileSizeBytes = 0): Promise<{ project: SupabaseProject; client: SupabaseClient }> {
  const project = await chooseImportProject(fileSizeBytes);
  return { project, client: getSupabaseClientByProject(project) };
}

const MIRRORED_TABLES = [
  "areas","drivers","helpers","vehicles","vacations","consumer_salesmen","feature_flags",
  "dashboard_config_rules","control_center_config","route_sheet_layout","area_groups","area_group_members",
  "driver_anchored_areas","driver_anchored_area_groups","vehicle_permitted_areas",
  "vehicle_permitted_area_groups","area_anchored_vehicles","vehicle_driver_manual_mappings","appearance_config"
] as const;

async function readAllRows(client: SupabaseClient, table: string): Promise<any[]> {
  const out: any[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client.from(table).select("*").range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

/**
 * One-way bootstrap of master/configuration data from the existing primary
 * project into the new secondary project. Operational fact history is NOT
 * copied: it stays in the primary and the federated read layer combines it
 * with future secondary imports.
 */
export async function syncPrimaryConfigurationToSecondary(): Promise<{ tables: number; rows: number }> {
  if (!secondaryClient) return { tables: 0, rows: 0 };
  let rowsCopied = 0;
  let tablesCopied = 0;
  for (const table of MIRRORED_TABLES) {
    const rows = await readAllRows(primaryClient, table);
    if (!rows.length) {
      const secondaryRows = await readAllRows(secondaryClient, table);
      for (let i = 0; i < secondaryRows.length; i += 100) {
        const ids = secondaryRows.slice(i, i + 100).map((r: any) => r.id).filter(Boolean);
        if (ids.length) {
          const { error } = await secondaryClient.from(table).delete().in("id", ids);
          if (error) throw new Error(`Sync delete ${table}: ${error.message}`);
        }
      }
      tablesCopied++;
      continue;
    }
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await secondaryClient.from(table).upsert(rows.slice(i, i + 100), { onConflict: "id" });
      if (error) throw new Error(`Sync ${table}: ${error.message}`);
    }
    // Mirror deletions for configuration/master rows. This keeps a removed
    // driver/vehicle/area/rule from resurfacing from the secondary copy.
    const ids = new Set(rows.map((r: any) => String(r.id)));
    const secondaryRows = await readAllRows(secondaryClient, table);
    for (let i = 0; i < secondaryRows.length; i += 100) {
      const stale = secondaryRows.slice(i, i + 100).filter((r: any) => r?.id && !ids.has(String(r.id))).map((r: any) => r.id);
      if (stale.length) {
        const { error } = await secondaryClient.from(table).delete().in("id", stale);
        if (error) throw new Error(`Sync delete ${table}: ${error.message}`);
      }
    }
    rowsCopied += rows.length;
    tablesCopied++;
  }

  // Copy the shared appearance images so the secondary project can serve the
  // same live wallpaper paths.
  const { data: appearance } = await primaryClient.from("appearance_config").select("*").limit(1).maybeSingle();
  if (appearance && (appearance.light_bg_path || appearance.dark_bg_path)) {
    for (const [mode, path] of [["light", appearance.light_bg_path], ["dark", appearance.dark_bg_path] as const]) {
      if (!path) continue;
      const { data: signed } = await primaryClient.storage.from("wallpaper").createSignedUrl(path, 600);
      if (!signed?.signedUrl) continue;
      try {
        const response = await fetch(signed.signedUrl);
        if (!response.ok) continue;
        const blob = await response.blob();
        await secondaryClient.storage.from("wallpaper").upload(path, blob, { upsert: true, contentType: blob.type || undefined });
      } catch {
        // Configuration data remains synchronized even if an old wallpaper
        // object cannot be copied.
      }
    }
  }
  return { tables: tablesCopied, rows: rowsCopied };
}


export async function syncPrimaryConfigurationToAllClouds(): Promise<{ tables: number; rows: number }> {
  const targets = [secondaryClient, tertiaryClient].filter(Boolean) as SupabaseClient[];
  if (!targets.length) return {tables:0,rows:0};
  let rowsCopied=0,tablesCopied=0;
  for (const table of MIRRORED_TABLES) {
    const rows=await readAllRows(primaryClient,table);
    for (const target of targets) {
      for(let i=0;i<rows.length;i+=100){ const {error}=await target.from(table).upsert(rows.slice(i,i+100),{onConflict:"id"}); if(error) throw new Error(`Sync ${table}: ${error.message}`); }
      const ids=new Set(rows.map((r:any)=>String(r.id)));
      const existing=await readAllRows(target,table);
      const stale=existing.filter((r:any)=>r?.id&&!ids.has(String(r.id))).map((r:any)=>r.id);
      for(let i=0;i<stale.length;i+=100){ if(stale.slice(i,i+100).length){const {error}=await target.from(table).delete().in("id",stale.slice(i,i+100)); if(error) throw new Error(`Sync delete ${table}: ${error.message}`);}}
    }
    rowsCopied+=rows.length; tablesCopied++;
  }
  return {tables:tablesCopied,rows:rowsCopied};
}

export async function testSupabaseProfile(profile: Pick<SupabaseProfile, "url" | "publishableKey">): Promise<{ ok: boolean; message: string }> {
  try {
    if (!/^https:\/\//i.test(profile.url.trim())) return { ok: false, message: "Supabase URL must start with https://" };
    if (!profile.publishableKey.trim()) return { ok: false, message: "Publishable key is required." };
    if (/service[_-]?role/i.test(profile.publishableKey) || profile.publishableKey.trim().startsWith("sb_secret_")) return { ok: false, message: "Secret/service-role keys are not allowed in the desktop app." };
    const client = buildClient({ id: "test", name: "Test", url: profile.url.trim(), publishableKey: profile.publishableKey.trim() });
    const { error } = await client.from("sap_invoice_facts").select("invoice_number", { head: true, count: "exact" }).limit(1);
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: "Connection successful." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
