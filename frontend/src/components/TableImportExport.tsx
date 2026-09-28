import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase, getSecondarySupabaseClient, getTertiarySupabaseClient } from "@/lib/supabase";
import { saveWorkbookToDispatchFolder, type ExportProgress } from "../services/desktopExport";
import ExportStatus from "./ExportStatus";

/**
 * SUPABASE PORT of the old Fleet Database "Export Excel / Import Excel /
 * Undo Last Change" toolbar (was `${endpointPrefix}/export-excel`,
 * `/import-excel`, `/undo-last` on the now-deleted FastAPI backend).
 *
 * Export/import now happen entirely client-side against Supabase:
 *   - Export: SELECT * from `table`, write straight to an .xlsx via SheetJS.
 *   - Import: parse the uploaded sheet with SheetJS, upsert rows into
 *     `table` on `naturalKey` (e.g. "code" for drivers/helpers, "number"
 *     for vehicles). The sheet's column headers must match the table's
 *     column names exactly (code, name, veh_type, ...) - there is no
 *     server-side column-mapping/fuzzy-header step anymore (that lived in
 *     the old backend's import_jobs.py/analytics_parsers.py, which is a
 *     separate, not-yet-ported piece of business logic - see the
 *     migration status notes for that file).
 *   - Undo: this component keeps an in-memory snapshot of exactly what
 *     each row looked like *before* the import that just ran (or `null`
 *     for a row that didn't exist yet, i.e. was newly created). "Undo
 *     Last Change" restores those rows or deletes the newly-created ones.
 *     This is scoped to this browser tab's last import only - it is not
 *     a durable server-side undo log, so it doesn't survive a page
 *     reload and won't know about edits made on another PC in the
 *     meantime.
 */
interface Props {
  table: string; // Supabase table name, e.g. "drivers"
  naturalKey: string; // unique business column used for upsert, e.g. "code"
  onImported: () => void;
  canWrite: boolean;
}

interface UndoEntry {
  id: string;
  before: Record<string, unknown> | null; // null = row was newly created by the import
}

export default function TableImportExport({ table, naturalKey, onImported, canWrite }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [lastImport, setLastImport] = useState<UndoEntry[] | null>(null);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);

  async function handleExport() {
    setMsg("");
    try {
      const { data, error } = await supabase.from(table).select("*");
      if (error) throw new Error(error.message);
      const ws = XLSX.utils.json_to_sheet(data ?? []);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, table);
      await saveWorkbookToDispatchFolder(wb, `${table}_${new Date().toISOString().slice(0,10)}.xlsx`, setExportProgress);
    } catch (e: any) {
      setMsg(e.message);
      setExportProgress({ pct: 100, status: "error", message: e.message });
    }
  }

  async function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg("");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const importRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });

      // Fleet Excel files often use business-facing headers (e.g. "Helper Code",
      // "Helper Name") while Supabase's compatibility table uses both legacy
      // code/name and canonical helper_code/helper_name columns. Normalize the
      // uploaded spreadsheet to the actual legacy key/required fields before
      // upsert so NOT NULL columns are never left empty just because the Excel
      // header uses a different label.
      const normalizedRows = importRows
        .map((raw) => {
          const r: Record<string, any> = { ...raw };
          // Excel headers are not always identical (extra spaces, underscores,
          // hyphens, punctuation, or different casing). Resolve them by a
          // canonical header key so "Helper Name", "helper_name", "Helper-Name",
          // and "HELPER NAME" all map to the same field.
          const headerKey = (value: unknown) => String(value ?? "")
            .trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
          const normalizedHeaders = new Map<string, unknown>();
          Object.entries(r).forEach(([key, value]) => {
            const k = headerKey(key);
            if (k && !normalizedHeaders.has(k)) normalizedHeaders.set(k, value);
          });
          const pick = (...names: string[]) => {
            for (const name of names) {
              const direct = r[name];
              if (direct !== undefined && String(direct).trim() !== "") return String(direct).trim();
              const value = normalizedHeaders.get(headerKey(name));
              if (value !== undefined && String(value).trim() !== "") return String(value).trim();
            }
            return "";
          };
          if (table === "helpers") {
            const code = pick("code", "Helper Code", "HelperCode", "helper_code", "Employee Code", "EmployeeCode", "Staff Code", "StaffCode").toUpperCase();
            const name = pick("name", "Helper Name", "HelperName", "helper_name", "Employee Name", "EmployeeName", "Staff Name", "StaffName", "Full Name", "FullName", "Name of Helper", "Helper");
            r.code = code;
            r.name = name;
            r.helper_code = code;
            r.helper_name = name;
            r.anchor_area = pick("anchor_area", "Anchor Area", "Area");
            r.health_card = pick("health_card", "Health Card") || "No";
            r.division = pick("division", "Division");
            r.status = pick("status", "Status") || "Active";
          } else if (table === "drivers") {
            const code = pick("code", "Driver Code", "DriverCode", "driver_code", "Employee Code", "EmployeeCode").toUpperCase();
            const name = pick("name", "Driver Name", "DriverName", "driver_name", "Employee Name", "EmployeeName");
            r.code = code; r.name = name; r.driver_code = code; r.driver_name = name;
            r.status = pick("status", "Status") || "Active";
          } else if (table === "vehicles") {
            const number = pick("number", "Vehicle Number", "VehicleNumber", "vehicle_number");
            const type = pick("type", "Vehicle Type", "VehicleType", "vehicle_type");
            r.number = number; r.type = type; r.vehicle_number = number; r.vehicle_type = type;
            r.status = pick("status", "Status") || "Active";
          } else if (table === "areas") {
            const code = pick("code", "Area Code", "AreaCode", "area_code");
            const name = pick("name", "Area Name", "AreaName", "area_name");
            r.code = code; r.name = name; r.area_code = code; r.area_name = name;
            r.status = pick("status", "Status") || "Active";
          }
          return r;
        })
        .map((r) => ({ ...r, [naturalKey]: String(r[naturalKey] ?? "").trim() }))
        .filter((r) => r[naturalKey]);

      if (table === "helpers") {
        const invalid = normalizedRows.findIndex((r) => !String(r.helper_name || r.name || "").trim());
        if (invalid >= 0) throw new Error(`Helper import: row ${invalid + 2} is missing Helper Name. Please check the Helper Name column.`);
      }

      const keys = normalizedRows.map((r) => String(r[naturalKey] ?? "").trim()).filter(Boolean);
      const skippedBlankKey = importRows.length - keys.length;
      if (keys.length === 0) throw new Error(`No rows had a value in the "${naturalKey}" column.`);

      // Snapshot existing rows for the keys we're about to touch, so we can undo.
      const { data: existing, error: fetchErr } = await supabase.from(table).select("*").in(naturalKey, keys);
      if (fetchErr) throw new Error(fetchErr.message);
      const existingByKey = new Map((existing ?? []).map((r: any) => [String(r[naturalKey]), r]));

      // Prevent duplicate natural keys inside the same Excel file from causing
      // Postgres ON CONFLICT cardinality errors. Last occurrence wins, which is
      // also what users normally expect when correcting a row in Excel.
      const byKey = new Map<string, Record<string, any>>();
      normalizedRows.forEach((r) => byKey.set(String(r[naturalKey]), r));
      const rowsToUpsert = [...byKey.values()];

      // Keep Fleet imports reliable for large workbooks as well.
      const upserted: any[] = [];
      const BATCH_SIZE = 100;
      for (let start = 0; start < rowsToUpsert.length; start += BATCH_SIZE) {
        const batch = rowsToUpsert.slice(start, start + BATCH_SIZE);
        let { data, error: upsertErr } = await supabase
          .from(table)
          .upsert(batch, { onConflict: naturalKey })
          .select();
        if (upsertErr && /statement timeout|canceling statement/i.test(upsertErr.message) && batch.length > 20) {
          data = [];
          for (let i = 0; i < batch.length; i += 20) {
            const result = await supabase.from(table).upsert(batch.slice(i, i + 20), { onConflict: naturalKey }).select();
            if (result.error) throw new Error(result.error.message);
            data.push(...(result.data ?? []));
          }
        } else if (upsertErr) {
          throw new Error(upsertErr.message);
        }
        const secondary = getSecondarySupabaseClient();
        const tertiary = getTertiarySupabaseClient();
        if (secondary && data?.length) {
          const { error: mirrorErr } = await secondary.from(table).upsert(data as object[], { onConflict: "id" });
          if (mirrorErr) throw new Error(`Secondary Supabase mirror failed: ${mirrorErr.message}`);
        }
        upserted.push(...(data ?? []));
      }

      const undoEntries: UndoEntry[] = upserted.map((row: any) => ({
        id: row.id,
        before: existingByKey.get(String(row[naturalKey])) ?? null,
      }));
      setLastImport(undoEntries);

      const created = undoEntries.filter((e) => e.before === null).length;
      const updated = undoEntries.length - created;
      setMsg(`Imported: ${created} created, ${updated} updated${skippedBlankKey ? `, ${skippedBlankKey} skipped (blank ${naturalKey})` : ""}.`);
      if (fileRef.current) fileRef.current.value = "";
      onImported();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUndo() {
    if (!lastImport || lastImport.length === 0) {
      setMsg("Nothing to undo.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const toRestore = lastImport.filter((e) => e.before !== null);
      const toDelete = lastImport.filter((e) => e.before === null).map((e) => e.id);
      if (toRestore.length > 0) {
        const { data: restored, error } = await supabase.from(table).upsert(toRestore.map((e) => e.before as object)).select();
        if (error) throw new Error(error.message);
        const secondary = getSecondarySupabaseClient();
        const tertiary = getTertiarySupabaseClient();
        if (secondary && restored?.length) {
          const { error: mirrorErr } = await secondary.from(table).upsert(restored as object[], { onConflict: "id" });
          if (mirrorErr) throw new Error(mirrorErr.message);
        }
      }
      if (toDelete.length > 0) {
        const { error } = await supabase.from(table).delete().in("id", toDelete);
        if (error) throw new Error(error.message);
        const secondary = getSecondarySupabaseClient();
        const tertiary = getTertiarySupabaseClient();
        if (secondary) {
          const { error: mirrorErr } = await secondary.from(table).delete().in("id", toDelete);
          if (mirrorErr) throw new Error(mirrorErr.message);
        }
      }
      setMsg(`Undid last import: restored ${toRestore.length}, removed ${toDelete.length} newly-created row(s).`);
      setLastImport(null);
      onImported();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn" style={{ background: "var(--navy3)", color: "var(--muted)" }} onClick={handleExport}>
        📥 Export Excel
      </button>
      {canWrite && (
        <>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ maxWidth: 180, fontSize: 12 }} />
          <button className="btn" onClick={handleImport} disabled={busy}>
            {busy ? "Importing..." : "📤 Import Excel"}
          </button>
          <button className="btn" style={{ background: "var(--amber)" }} onClick={handleUndo} disabled={busy || !lastImport}>
            ↩ Undo Last Change
          </button>
        </>
      )}
        {msg && <span style={{ fontSize: 12, color: "var(--muted)" }}>{msg}</span>}
      </div>
      <ExportStatus state={exportProgress} />
    </div>
  );
}
