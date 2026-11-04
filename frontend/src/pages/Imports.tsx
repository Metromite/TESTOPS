import { useRef, useState, useEffect } from "react";
import { getRole } from "../api/client";
import { deleteImportedData, getImportBatchRows, getImportBatchesForUi, labelImportBatch, previewImportFile, processImportFile, type ImportPreview, type ImportDeleteProgress } from "../services/importEngine";
import { useOperationalRealtime } from "../hooks/useOperationalRealtime";
import Modal from "../components/Modal";
import { formatBytes, getDispatchopsStorageStats, getDispatchopsDatabaseStats, type StorageStats, type DatabaseStats } from "../services/storageStats";

interface JobSnap {
  status: string; progress_pct: number; current_step: string;
  processed_units: number; total_units: number;
  estimated_seconds_remaining: number; log: string; error: string;
}
interface Batch {
  batch_id: string; source_type: string; filename: string; imported_by: string;
  label: string; imported_at: string; raw_row_count: number | null; parsed_fact_count: number | null;
  reported_raw_row_count?: number; reported_fact_count?: number; verification_error?: string; count_mismatch?: boolean;
  status?: string; error_message?: string; storage_project?: string; file_size_bytes?: number | null;
}
interface BatchRowsResponse { rows: { row_index: number; data: string }[] }

export default function Imports() {
  const isAdmin = getRole() === "admin";
  const [sourceType, setSourceType] = useState<"sap" | "landmark">("sap");
  const [job, setJob] = useState<JobSnap | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFileSelected() {
    const file = fileRef.current?.files?.[0];
    setPreview(null); setPreviewError("");
    if (!file) return;
    try { setPreview(await previewImportFile(file)); }
    catch (error) { setPreviewError(error instanceof Error ? error.message : String(error)); }
  }

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setJob(null);
    try {
      await processImportFile(file, sourceType, (snap) => setJob(snap));
      if (fileRef.current) fileRef.current.value = "";
      setPreview(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setJob((current) => current ?? { status: "failed", progress_pct: 0, current_step: "Import failed", processed_units: 0, total_units: 0, estimated_seconds_remaining: 0, log: "", error: message });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="page">
      <h2>SAP / Landmark Imports</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -8 }}>
        Only Admins upload files. Once processed, every Dispatcher and Viewer
        sees the same updated data immediately - no one else uploads.
      </p>

      <div className="glass-card" style={{ marginBottom: 20, display: "flex", gap: 12, alignItems: "center" }}>
        <select value={sourceType} onChange={(e) => setSourceType(e.target.value === "landmark" ? "landmark" : "sap")}>
          <option value="sap">SAP Export</option>
          <option value="landmark">Landmark Export</option>
        </select>
        {isAdmin && <><input type="file" ref={fileRef} accept=".csv,.xlsx,.xls" onChange={handleFileSelected} />
        <button className="btn" onClick={handleUpload} disabled={uploading}>
          {uploading ? "Uploading..." : "Upload & Process"}
        </button></>}
      </div>

      {previewError && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{previewError}</div>}
      {preview && (
        <div className="glass-card" style={{ marginBottom: 20 }}>
          <strong>Import Preview</strong>
          <div style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 10px" }}>
            {preview.totalRows} data row(s) detected · automatic column mapping from the original workbook headers
          </div>
          <div className="table-scroll" style={{ maxHeight: 280 }}>
            <table className="data-table"><thead><tr>{preview.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{preview.rows.slice(0, 10).map((row, i) => <tr key={i}>{preview.headers.map((h) => <td key={h}>{String(row[h] ?? "")}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      )}

      {job && (
        <div className="glass-card" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong>{job.current_step || "Working..."}</strong>
            <span className={"badge " + (job.status === "failed" ? "excluded" : "ok")}>{job.status}</span>
          </div>
          <div style={{ background: "var(--navy3)", borderRadius: 999, height: 8, overflow: "hidden", marginBottom: 8 }}>
            <div style={{ width: `${job.progress_pct}%`, background: "var(--teal)", height: "100%", transition: "width 0.3s" }} />
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            {job.processed_units}/{job.total_units} rows
            {job.estimated_seconds_remaining > 0 && ` · ~${job.estimated_seconds_remaining}s remaining`}
          </div>
          {job.error && <div className="error-text">{job.error}</div>}
          <pre style={{ fontSize: 11, color: "var(--muted)", maxHeight: 160, overflow: "auto", background: "var(--navy3)", padding: 10, borderRadius: 8 }}>
            {job.log}
          </pre>
        </div>
      )}

      <BatchManager refreshKey={job?.status} isAdmin={isAdmin} />
    </div>
  );
}

function BatchManager({ refreshKey, isAdmin }: { refreshKey?: string; isAdmin: boolean }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<Batch | null>(null);
  const [rows, setRows] = useState<{ row_index: number; data: string }[]>([]);
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState("");
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [databaseStats, setDatabaseStats] = useState<{ primary: DatabaseStats | null; secondary: DatabaseStats | null; tertiary: DatabaseStats | null }>({ primary: null, secondary: null, tertiary: null });
  const [deletingBatch, setDeletingBatch] = useState<string | null>(null);
  const [deleteProgress, setDeleteProgress] = useState<ImportDeleteProgress | null>(null);

  async function load() {
    const [batchResult, storageResult, databaseResult] = await Promise.allSettled([
      getImportBatchesForUi(), getDispatchopsStorageStats(), getDispatchopsDatabaseStats(),
    ]);
    if (batchResult.status === "fulfilled") setBatches(batchResult.value);
    if (storageResult.status === "fulfilled") setStorageStats(storageResult.value);
    if (databaseResult.status === "fulfilled") setDatabaseStats(databaseResult.value);
    const failed = [batchResult, storageResult, databaseResult].find(r => r.status === "rejected") as PromiseRejectedResult | undefined;
    setError(failed ? (failed.reason instanceof Error ? failed.reason.message : String(failed.reason)) : "");
  }
  useEffect(() => { load(); }, [refreshKey]);
  useOperationalRealtime("imports", ["import_batches"], load);

  async function viewBatch(b: Batch) {
    setViewing(b);
    try {
      const data: BatchRowsResponse = await getImportBatchRows(b.batch_id, 25);
      setRows(data.rows);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }

  async function saveLabel(batchId: string) {
    try {
      await labelImportBatch(batchId, labelInput);
      setEditingLabel(null);
      load();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }

  async function deleteBatch(batchId: string) {
    if (deletingBatch) return;
    if (!confirm("Delete this import batch, its raw rows, parsed facts, and the original uploaded source file? This cannot be undone.")) return;
    setDeletingBatch(batchId);
    setDeleteProgress({ progress_pct: 1, current_step: "Starting deletion…", removed_rows: 0 });
    setError("");
    try {
      await deleteImportedData(batchId, setDeleteProgress);
      await new Promise(resolve => setTimeout(resolve, 650));
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      await load();
    } finally {
      setDeletingBatch(null);
      setDeleteProgress(null);
    }
  }

  return (
    <div>
      <div className="glass-card" style={{padding:14, marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:10}}>
          <div><strong>Database Usage</strong><div style={{fontSize:11,color:"var(--muted)",marginTop:3}}>Actual PostgreSQL database size per project · 500 MB reference capacity per cloud. This is where SAP and Landmark parsed records are stored.</div></div>
          <span className="badge ok">DATABASE · 500 MB EACH</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:10}}>
          {[{name:"Primary",stats:databaseStats.primary},{name:"Secondary",stats:databaseStats.secondary},{name:"Tertiary",stats:databaseStats.tertiary}].map(x=><div key={x.name} className="glass-card" style={{padding:12}}>
            <strong>{x.name}</strong>
            <div style={{fontSize:12,color:"var(--muted)",marginTop:6}}>Used: {x.stats?formatBytes(x.stats.usedBytes):"Not available"}</div>
            <div style={{fontSize:12,color:"var(--muted)",marginTop:3}}>Remaining: {x.stats?formatBytes(x.stats.remainingBytes):"—"}</div>
            <div style={{background:"var(--navy3)",borderRadius:999,height:7,marginTop:8,overflow:"hidden"}}><div style={{width:`${Math.min(100,x.stats?.percentUsed??0)}%`,background:"var(--teal)",height:"100%"}}/></div>
            <div style={{fontSize:11,color:"var(--muted)",marginTop:4}}>{x.stats?`${x.stats.percentUsed.toFixed(1)}% of 500 MB`:"Database size RPC unavailable"}</div>
          </div>)}
        </div>
      </div>
      <div className="glass-card" style={{padding:14, marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:10}}>
          <div><strong>Original File Storage Pool</strong><div style={{fontSize:11,color:"var(--muted)",marginTop:3}}>Separate object storage for the original uploaded Excel/CSV files. These GB figures are not the PostgreSQL database size.</div></div>
          <span className="badge ok">FILE STORAGE</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:10}}>
          {[
            {name:"Primary",used:storageStats?.primaryBytesUsed,cap:storageStats?.primaryCapacityBytes,pct:storageStats?.primaryPercentUsed},
            {name:"Secondary",used:storageStats?.secondaryBytesUsed,cap:storageStats?.secondaryCapacityBytes,pct:storageStats?.secondaryPercentUsed},
            {name:"Tertiary",used:storageStats?.tertiaryBytesUsed,cap:storageStats?.tertiaryCapacityBytes,pct:storageStats?.tertiaryPercentUsed},
          ].map(x=><div key={x.name} className="glass-card" style={{padding:12}}>
            <strong>{x.name}</strong>
            <div style={{fontSize:12,color:"var(--muted)",marginTop:6}}>Used: {x.used!=null?formatBytes(x.used):"—"}</div>
            <div style={{fontSize:12,color:"var(--muted)",marginTop:3}}>Remaining: {x.used!=null&&x.cap!=null?formatBytes(Math.max(0,x.cap-x.used)):"—"}</div>
            <div style={{background:"var(--navy3)",borderRadius:999,height:7,marginTop:8,overflow:"hidden"}}><div style={{width:`${Math.min(100,x.pct??0)}%`,background:"var(--teal)",height:"100%"}}/></div>
            <div style={{fontSize:11,color:"var(--muted)",marginTop:4}}>{x.pct!=null?`${x.pct.toFixed(1)}% used`:"Not available"}</div>
          </div>)}
        </div>
        <div style={{fontSize:11,color:"var(--muted)",marginTop:10}}>Total pool: {storageStats?formatBytes(storageStats.totalCapacityBytes):"—"} · Used: {storageStats?formatBytes(storageStats.bytesUsed):"—"} · Overall: {storageStats?`${storageStats.totalPercentUsed.toFixed(1)}%`:"—"}</div>
      </div>
      <div className="glass-card table-scroll">
      <strong>Uploaded Batches</strong>
      {error && <div className="error-text" style={{ fontSize: 12, marginTop: 8 }}>{error}</div>}
      {deletingBatch && deleteProgress && <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "var(--navy3)", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
          <strong style={{ fontSize: 13 }}>{deleteProgress.current_step}</strong>
          <strong style={{ fontSize: 13 }}>{deleteProgress.progress_pct}%</strong>
        </div>
        <div style={{ background: "var(--navy2)", borderRadius: 999, height: 10, overflow: "hidden" }}>
          <div style={{ width: `${deleteProgress.progress_pct}%`, height: "100%", background: "var(--teal)", transition: "width .25s ease" }} />
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 7 }}>{deleteProgress.removed_rows.toLocaleString()} rows deleted so far. The batch stays visible until deletion succeeds.</div>
      </div>}
      <table className="data-table" style={{ marginTop: 10 }}>
        <thead><tr><th>Type</th><th>Filename</th><th>Label</th><th>Uploaded</th><th>By</th><th>Raw Rows</th><th>Parsed Facts</th><th>Original File</th><th>Database</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {batches.length === 0 && (
            <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No uploads yet</td></tr>
          )}
          {batches.map((b) => (
            <tr key={b.batch_id}>
              <td><span className="badge ok">{b.source_type}</span></td>
              <td>{b.filename.split(/[\\/]/).pop()}</td>
              <td>
                {editingLabel === b.batch_id ? (
                  <div style={{ display: "flex", gap: 4 }}>
                    <input value={labelInput} onChange={(e) => setLabelInput(e.target.value)} style={{ width: 100, fontSize: 12 }} autoFocus />
                    <button className="btn" style={{ padding: "2px 8px" }} onClick={() => saveLabel(b.batch_id)}>✓</button>
                  </div>
                ) : (
                  <span onClick={() => { setEditingLabel(b.batch_id); setLabelInput(b.label); }} style={{ cursor: "pointer" }}>
                    {b.label || <span style={{ color: "var(--muted)" }}>+ add label</span>}
                  </span>
                )}
              </td>
              <td>{new Date(b.imported_at).toLocaleString()}</td>
              <td>{b.imported_by}</td>
              <td>{b.raw_row_count == null ? "—" : b.raw_row_count.toLocaleString()}</td>
              <td>{b.parsed_fact_count == null ? "—" : b.parsed_fact_count.toLocaleString()}</td>
              <td>{b.file_size_bytes != null ? formatBytes(b.file_size_bytes) : "—"}</td>
              <td>{b.storage_project ? b.storage_project.charAt(0).toUpperCase() + b.storage_project.slice(1) : "—"}</td>
              <td><span className={"badge " + (b.status === "failed" || b.count_mismatch || b.verification_error ? "excluded" : b.status === "processing" ? "" : "ok")}>{b.status || "completed"}</span>
                {b.count_mismatch && <div className="error-text" style={{fontSize:10,marginTop:4,maxWidth:220}}>Metadata says {b.reported_raw_row_count?.toLocaleString()} raw / {b.reported_fact_count?.toLocaleString()} facts; actual stored counts differ.</div>}
                {b.verification_error && <div className="error-text" style={{fontSize:10,marginTop:4,maxWidth:220}}>Count verification failed: {b.verification_error}</div>}
                {b.error_message && <div className="error-text" style={{fontSize:10,marginTop:4,maxWidth:220}}>{b.error_message}</div>}
              </td>
              <td style={{ display: "flex", gap: 6 }}>
                <button className="btn" onClick={() => viewBatch(b)} disabled={b.raw_row_count == null || b.raw_row_count === 0}>View</button>
                {isAdmin && <button className="btn" style={{background:"var(--red)"}} disabled={!!deletingBatch} onClick={() => void deleteBatch(b.batch_id)}>{deletingBatch === b.batch_id ? "Deleting…" : "Delete"}</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {viewing && (
        <Modal title={`Batch: ${viewing.filename}`} onClose={() => setViewing(null)}>
          <div style={{ fontSize: 11, maxHeight: 400, overflow: "auto" }}>
            {rows.map((r) => (
              <pre key={r.row_index} style={{ background: "var(--navy3)", padding: 8, borderRadius: 6, marginBottom: 6 }}>
                {JSON.stringify(JSON.parse(r.data), null, 2)}
              </pre>
            ))}
          </div>
        </Modal>
      )}
      </div>
    </div>
  );
}
