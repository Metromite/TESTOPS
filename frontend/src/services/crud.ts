// ============================================================================
// Generic typed CRUD helper over a single Supabase table. Every entity
// service (drivers.ts, helpers.ts, vehicles.ts, ...) is a thin, typed
// wrapper around one of these — this is the "clean data layer" the
// architecture brief asks for (section 20), so raw supabase.from() calls
// don't get scattered through page components.
//
// Every function throws a plain Error with a readable message on failure
// (Supabase client errors are PostgrestError objects with a `.message`,
// not real Error instances) so callers can use ordinary try/catch and
// existing error-toast UI without change.
// ============================================================================

import { supabase, getPrimarySupabaseClient, getSecondarySupabaseClient, getTertiarySupabaseClient } from "@/lib/supabase";
import type { PostgrestError } from "@supabase/supabase-js";

function raise(error: PostgrestError | null, context: string): never | void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

export function makeCrudService<Row extends { id: string }, Insert = Partial<Row>, Update = Partial<Row>>(
  table: string
) {
  const MIRROR_WRITES = new Set([
    "areas","drivers","helpers","vehicles","vacations","consumer_salesmen","feature_flags",
    "dashboard_config_rules","control_center_config","route_sheet_layout","area_groups",
    "area_group_members","driver_anchored_areas","driver_anchored_area_groups",
    "vehicle_permitted_areas","vehicle_permitted_area_groups","area_anchored_vehicles",
    "vehicle_driver_manual_mappings"
  ]);
  const mirror = MIRROR_WRITES.has(table);
  const primary = getPrimarySupabaseClient();
  const secondary = getSecondarySupabaseClient();
  const tertiary = getTertiarySupabaseClient();

  return {
    async list(opts?: { orderBy?: string; ascending?: boolean; limit?: number }): Promise<Row[]> {
      let query = supabase.from(table).select("*");
      if (opts?.orderBy) query = query.order(opts.orderBy, { ascending: opts.ascending ?? true });
      if (opts?.limit) query = query.limit(opts.limit);
      const { data, error } = await query;
      raise(error, `Failed to list ${table}`);
      return (data ?? []) as Row[];
    },

    async get(id: string): Promise<Row | null> {
      const { data, error } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
      raise(error, `Failed to fetch ${table}/${id}`);
      return (data as Row) ?? null;
    },

    async create(row: Insert): Promise<Row> {
      const { data, error } = await primary.from(table).insert(row as object).select().single();
      raise(error, `Failed to create ${table}`);
      if (mirror && data) {
        for (const target of [secondary, tertiary].filter(Boolean) as any[]) { const { error: mirrorError } = await target.from(table).upsert(data as object, { onConflict: "id" }); raise(mirrorError, `Failed to mirror create ${table}`); }
      }
      return data as Row;
    },

    async update(id: string, patch: Update): Promise<Row> {
      const { data, error } = await primary.from(table).update(patch as object).eq("id", id).select().single();
      raise(error, `Failed to update ${table}/${id}`);
      if (mirror && data) {
        for (const target of [secondary, tertiary].filter(Boolean) as any[]) { const { error: mirrorError } = await target.from(table).upsert(data as object, { onConflict: "id" }); raise(mirrorError, `Failed to mirror update ${table}/${id}`); }
      }
      return data as Row;
    },

    async remove(id: string): Promise<void> {
      const { error } = await primary.from(table).delete().eq("id", id);
      raise(error, `Failed to delete ${table}/${id}`);
      if (mirror) { for (const target of [secondary, tertiary].filter(Boolean) as any[]) { const { error: mirrorError } = await target.from(table).delete().eq("id", id); raise(mirrorError, `Failed to mirror delete ${table}/${id}`); } }
    },

    /** Insert-or-update by a natural-key column (e.g. "code", "number") —
     * used by imports, which must be safely re-runnable without creating
     * duplicate rows (architecture brief section 10). */
    async upsert(rows: Insert[], conflictColumn: string): Promise<Row[]> {
      const { data, error } = await primary
        .from(table)
        .upsert(rows as object[], { onConflict: conflictColumn })
        .select();
      raise(error, `Failed to upsert into ${table}`);
      if (mirror && data?.length) { for (const target of [secondary, tertiary].filter(Boolean) as any[]) { const { error: mirrorError } = await target.from(table).upsert(data as object[], { onConflict: "id" }); raise(mirrorError, `Failed to mirror upsert into ${table}`); } }
      return (data ?? []) as Row[];
    },
  };
}
