// ============================================================================
// Import files service.
//
// FILE-STORAGE ARCHITECTURE (see supabase/migrations/0006 and the
// file-storage brief this implements):
//   - The ORIGINAL uploaded file (SAP/V-Zone/Excel/CSV) always goes to
//     the `dispatchops-files` Storage bucket. It is never stored as a
//     binary column in Postgres.
//   - Postgres (import_batches) holds only the metadata record: which
//     bucket/path it's at, filename, size, source type, and the
//     row-level import results (row_count/success_count/failed_count/
//     validation_errors) once parsing finishes.
//   - Every upload gets a unique, collision-proof path
//     (imports/<SOURCE_TYPE>/<yyyy>/<mm>/<dd>/<uuid>_<original filename>)
//     so re-uploading a file with the same name NEVER overwrites the
//     previous one.
//   - NOTHING here ever deletes or replaces a previous file
//     automatically. deleteImportFile() below is the ONLY delete path
//     in this service, and it must only ever be called from an explicit,
//     user-confirmed "Delete file" action — never from an upload flow,
//     a retention job, or a scheduled task. Do not add one.
// ============================================================================

import { supabase, getSupabaseClientForImport, getSupabaseClientByProject } from "@/lib/supabase";
import { makeCrudService } from "./crud";
import type { ImportBatch, RawImportRow } from "./types";

const BUCKET = "dispatchops-files";

export const importBatchesService = makeCrudService<ImportBatch>("import_batches");

function buildStoragePath(sourceType: string, filename: string): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const uniqueId = crypto.randomUUID();
  // sanitize the folder segment only — the original filename is kept
  // exactly as-is at the end of the path and separately in
  // original_filename for display, per the brief's "preserve the
  // original filename as metadata/display information" requirement.
  const safeSourceType = sourceType.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `imports/${safeSourceType}/${yyyy}/${mm}/${dd}/${uniqueId}_${filename}`;
}

/**
 * Uploads the original source file to Storage FIRST, then creates the
 * owning import_batches metadata row pointing at it — matching the
 * brief's flow (upload original -> parse -> validate -> save structured
 * data -> save import metadata -> Realtime notifies other PCs). Returns
 * the created batch; go on to parse `file` and write the resulting rows
 * against `batch.id`, then call finalizeImportBatch().
 */
export async function startImportBatch(
  file: File,
  input: { source_type: string; imported_by?: string; imported_by_device?: string }
): Promise<ImportBatch> {
  const storagePath = buildStoragePath(input.source_type, file.name);
  const owner = await getSupabaseClientForImport(file.size);
  const client = owner.client;

  // upsert: false (the default) is intentional — a unique path should
  // never collide, and if it somehow did, silently overwriting would
  // violate the "never automatically delete/overwrite" rule. Let it
  // fail loudly instead.
  const { error: uploadErr } = await client.storage.from(BUCKET).upload(storagePath, file);
  if (uploadErr) throw new Error(`Failed to upload ${file.name} to Storage: ${uploadErr.message}`);

  const { data, error } = await client.from("import_batches").insert({
    source_type: input.source_type,
    original_filename: file.name,
    imported_by: input.imported_by ?? "",
    imported_by_device: input.imported_by_device ?? "",
    status: "processing",
    storage_bucket: BUCKET,
    storage_path: storagePath,
    file_size_bytes: file.size,
    storage_project: owner.project,
  }).select("*").single();
  if (error || !data) throw new Error(`Failed to create import batch: ${error?.message || "No batch returned"}`);
  return data as ImportBatch;
}

export async function finalizeImportBatch(
  batchId: string,
  result: { row_count: number; success_count: number; failed_count: number; validation_errors?: unknown[] }
): Promise<ImportBatch> {
  const status = result.failed_count === 0 ? "completed" : result.success_count === 0 ? "failed" : "partial";
  const { data: batch, error: findError } = await supabase.from("import_batches").select("storage_project").eq("id", batchId).maybeSingle();
  if (findError) throw new Error(`Failed to find import owner: ${findError.message}`);
  const client = getSupabaseClientByProject(batch?.storage_project === "secondary" ? "secondary" : "primary");
  const { data, error } = await client.from("import_batches").update({ ...result, status }).eq("id", batchId).select("*").single();
  if (error || !data) throw new Error(`Failed to finalize import batch: ${error?.message || "No batch returned"}`);
  return data as ImportBatch;
}

export async function insertRawImportRows(rows: Omit<RawImportRow, "id" | "imported_at">[], clientOverride?: import("@supabase/supabase-js").SupabaseClient): Promise<void> {
  if (rows.length === 0) return;
  const client = clientOverride ?? supabase;

  // Never send a whole large Excel file as one PostgREST INSERT. Raw rows can
  // contain sizeable JSON objects, so a single request can exceed the database
  // statement timeout even when the file itself is valid. Small batches also
  // make retries safe and keep the UI responsive.
  const BATCH_SIZE = 100;
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    let { error } = await client.from("raw_import_rows").insert(batch);

    // One smaller retry handles unusually large rows without restarting the
    // complete import. We only retry the current batch.
    if (error && /statement timeout|canceling statement/i.test(error.message) && batch.length > 20) {
      for (let i = 0; i < batch.length && !error; i += 20) {
        const mini = batch.slice(i, i + 20);
        const result = await client.from("raw_import_rows").insert(mini);
        error = result.error;
      }
    }

    if (error) throw new Error(`Failed to store raw import rows (rows ${start + 1}-${Math.min(start + BATCH_SIZE, rows.length)}): ${error.message}`);
  }
}

/** Import history list (brief section 7) — excludes manually-deleted
 * batches by default so the list matches what's actually still in
 * Storage; pass includeDeleted to audit past deletions instead. */
export async function listImportHistory(opts?: { includeDeleted?: boolean }): Promise<ImportBatch[]> {
  let query = supabase.from("import_batches").select("*").order("imported_at", { ascending: false });
  if (!opts?.includeDeleted) query = query.is("deleted_at", null);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list import history: ${error.message}`);
  return data ?? [];
}

/** A short-lived signed URL to view/download the original file — the
 * bucket is private, so there is no public URL. */
export async function getImportFileUrl(batch: ImportBatch, expiresInSeconds = 3600): Promise<string | null> {
  if (!batch.storage_path) return null;
  const client = getSupabaseClientByProject(batch.storage_project === "secondary" ? "secondary" : "primary");
  const { data, error } = await client.storage
    .from(batch.storage_bucket || BUCKET)
    .createSignedUrl(batch.storage_path, expiresInSeconds);
  if (error) throw new Error(`Failed to sign import file URL: ${error.message}`);
  return data?.signedUrl ?? null;
}

/**
 * THE ONLY DELETE PATH for an uploaded import file. Must only be wired
 * to an explicit "Delete file" button with a user confirmation step —
 * never called automatically (not on new upload, not on a schedule, not
 * based on age or import count). Removes the Storage object and marks
 * the metadata row deleted (soft-delete, so the history list can still
 * show "deleted by X on date" if includeDeleted is requested) rather
 * than hard-deleting the row.
 */
export async function deleteImportFile(batchId: string, deletedBy: string): Promise<void> {
  const batch = await importBatchesService.get(batchId);
  if (!batch) throw new Error(`Import batch ${batchId} not found`);

  const client = getSupabaseClientByProject(batch.storage_project === "secondary" ? "secondary" : "primary");
  if (batch.storage_path) {
    const { error: storageErr } = await client.storage.from(batch.storage_bucket || BUCKET).remove([batch.storage_path]);
    if (storageErr) throw new Error(`Failed to delete file from Storage: ${storageErr.message}`);
  }

  const { error } = await client
    .from("import_batches")
    .update({ deleted_at: new Date().toISOString(), deleted_by: deletedBy })
    .eq("id", batchId);
  if (error) throw new Error(`Failed to mark import batch ${batchId} deleted: ${error.message}`);
}
