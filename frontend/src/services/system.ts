import { supabase } from "@/lib/supabase";
import type { AuditLogEntry, FeatureFlag, Job } from "./types";

export const featureFlagsService = {
  async list(): Promise<FeatureFlag[]> {
    const { data, error } = await supabase.from("feature_flags").select("*").order("name");
    if (error) throw new Error(`Failed to list feature flags: ${error.message}`);
    return data ?? [];
  },
  /** Unknown/unset defaults to OFF — matching the original app's
   * fail-safe convention (feature_flags.py docstring). */
  async isEnabled(name: string): Promise<boolean> {
    const { data, error } = await supabase.from("feature_flags").select("enabled").eq("name", name).maybeSingle();
    if (error) throw new Error(`Failed to check feature flag ${name}: ${error.message}`);
    return data?.enabled ?? false;
  },
  async set(name: string, enabled: boolean, updatedBy: string, description?: string): Promise<FeatureFlag> {
    const { data, error } = await supabase
      .from("feature_flags")
      .upsert({ name, enabled, updated_by: updatedBy, ...(description ? { description } : {}) }, { onConflict: "name" })
      .select()
      .single();
    if (error) throw new Error(`Failed to set feature flag ${name}: ${error.message}`);
    return data;
  },
};

export const auditLogService = {
  async list(opts?: { entityType?: string; limit?: number }): Promise<AuditLogEntry[]> {
    let query = supabase.from("audit_log").select("*").order("timestamp", { ascending: false });
    if (opts?.entityType) query = query.eq("entity_type", opts.entityType);
    if (opts?.limit) query = query.limit(opts.limit);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to list audit log: ${error.message}`);
    return data ?? [];
  },
  async record(entry: Omit<AuditLogEntry, "id" | "timestamp">): Promise<void> {
    const { error } = await supabase.from("audit_log").insert(entry);
    if (error) throw new Error(`Failed to write audit log entry: ${error.message}`);
  },
};

export const jobsService = {
  async get(id: string): Promise<Job | null> {
    const { data, error } = await supabase.from("jobs").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`Failed to fetch job ${id}: ${error.message}`);
    return data ?? null;
  },
  async create(jobType: string, createdBy: string): Promise<Job> {
    const { data, error } = await supabase
      .from("jobs")
      .insert({ job_type: jobType, created_by: createdBy, status: "queued" })
      .select()
      .single();
    if (error) throw new Error(`Failed to create job: ${error.message}`);
    return data;
  },
  async update(id: string, patch: Partial<Job>): Promise<Job> {
    const { data, error } = await supabase.from("jobs").update(patch).eq("id", id).select().single();
    if (error) throw new Error(`Failed to update job ${id}: ${error.message}`);
    return data;
  },
};
