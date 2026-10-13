import { useRef, useState, useEffect } from "react";
import { deleteImportedData, getImportBatchRows, getImportBatchesForUi, labelImportBatch, previewImportFile, processImportFile, type ImportPreview } from "../services/importEngine";
import { useOperationalRealtime } from "../hooks/useOperationalRealtime";
import Modal from "../components/Modal";
import { formatBytes, getDispatchopsStorageStats, type StorageStats } from "../services/storageStats";

interface JobSnap {
  status: string; progress_pct: number; current_step: string;
  processed_units: number; total_units: number;
  estimated_seconds_remaining: number; log: string; error: string;
}
interface Batch {
  batch_id: string; source_type: string; filename: string; imported_by: string;
  label: string; imported_at: string; raw_row_count: number; parsed_fact_count: number;
}
interface BatchRowsResponse { rows: { row_index: number; data: string }[] }

export default function Imports() {
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
        <input type="file" ref={fileRef} accept=".csv,.xlsx,.xls" onChange={handleFileSelected} />
        <button className="btn" onClick={handleUpload} disabled={uploading}>
          {uploading ? "Uploading..." : "Upload & Process"}
        </button>
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

      <BatchManager refreshKey={job?.status} />
    </div>
  );
}

function BatchManager({ refreshKey }: { refreshKey?: string }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<Batch | null>(null);
  const [rows, setRows] = useState<{ row_index: number; data: string }[]>([]);
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState("");
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);

  async function load() {
    try {
      const [batchRows, stats] = await Promise.all([getImportBatchesForUi(), getDispatchopsStorageStats()]);
      setBatches(batchRows);
      setStorageStats(stats);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
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
    if (!confirm("Delete this imported database batch (raw rows + parsed facts)? The original uploaded source file will stay in Supabase Storage.")) return;
    try {
      await deleteImportedData(batchId);
      load();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 14 }}>
        <div className="glass-card kpi-card"><div className="value">{storageStats?.fileCount ?? "—"}</div><div className="label">Files in Supabase Storage</div></div>
        <div className="glass-card kpi-card"><div className="value">{storageStats ? formatBytes(storageStats.bytesUsed) : "—"}</div><div className="label">File Storage Used</div></div>
        <div className="glass-card kpi-card"><div className="value">{batches.length}</div><div className="label">Uploaded Import Batches</div></div>
      </div>
      <div className="glass-card" style={{padding:14, marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:10}}>
          <div><strong>Supabase Storage Pool</strong><div style={{fontSize:11,color:"var(--muted)",marginTop:3}}>Live object storage usage. New imports stay whole in one cloud and move to the next cloud at 85% usage.</div></div>
          <span className="badge ok">3 CLOUDS</span>
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
      <table className="data-table" style={{ marginTop: 10 }}>
        <thead><tr><th>Type</th><th>Filename</th><th>Label</th><th>Uploaded</th><th>By</th><th>Raw Rows</th><th>Parsed Facts</th><th></th></tr></thead>
        <tbody>
          {batches.length === 0 && (
            <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No uploads yet</td></tr>
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
              <td>{b.raw_row_count}</td>
              <td>{b.parsed_fact_count}</td>
              <td style={{ display: "flex", gap: 6 }}>
                <button className="btn" onClick={() => viewBatch(b)}>View</button>
                <button className="btn" style={{ background: "var(--red)" }} onClick={() => deleteBatch(b.batch_id)}>Delete</button>
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
