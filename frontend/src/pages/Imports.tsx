import { useRef, useState, useEffect } from "react";
import { api, subscribeJobEvents } from "../api/client";
import Modal from "../components/Modal";

interface JobSnap {
  status: string; progress_pct: number; current_step: string;
  processed_units: number; total_units: number;
  estimated_seconds_remaining: number; log: string; error: string;
}
interface Batch {
  batch_id: string; source_type: string; filename: string; imported_by: string;
  label: string; imported_at: string; raw_row_count: number; parsed_fact_count: number;
}

export default function Imports() {
  const [sourceType, setSourceType] = useState<"sap" | "landmark">("sap");
  const [job, setJob] = useState<JobSnap | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setJob(null);

    const form = new FormData();
    form.append("file", file);
    const token = localStorage.getItem("access_token");
    const res = await fetch(`/api/imports/${sourceType}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await res.json();
    setUploading(false);
    if (!res.ok) {
      setJob({ status: "failed", progress_pct: 0, current_step: "", processed_units: 0, total_units: 0, estimated_seconds_remaining: 0, log: "", error: data.detail });
      return;
    }

    unsubRef.current?.();
    unsubRef.current = subscribeJobEvents(data.job_id, (snap: JobSnap) => setJob(snap));
  }

  return (
    <div className="page">
      <h2>SAP / Landmark Imports</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -8 }}>
        Only Admins upload files. Once processed, every Dispatcher and Viewer
        sees the same updated data immediately - no one else uploads.
      </p>

      <div className="glass-card" style={{ marginBottom: 20, display: "flex", gap: 12, alignItems: "center" }}>
        <select value={sourceType} onChange={(e) => setSourceType(e.target.value as any)}>
          <option value="sap">SAP Export</option>
          <option value="landmark">Landmark Export</option>
        </select>
        <input type="file" ref={fileRef} accept=".csv,.xlsx,.xls" />
        <button className="btn" onClick={handleUpload} disabled={uploading}>
          {uploading ? "Uploading..." : "Upload & Process"}
        </button>
      </div>

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

  async function load() {
    try { setBatches(await api.get("/imports/batches")); } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { load(); }, [refreshKey]);

  async function viewBatch(b: Batch) {
    setViewing(b);
    try {
      const data = await api.get(`/imports/batches/${b.batch_id}/rows?limit=25`);
      setRows(data.rows);
    } catch (e: any) { setError(e.message); }
  }

  async function saveLabel(batchId: string) {
    try {
      await api.put(`/imports/batches/${batchId}/label`, { label: labelInput });
      setEditingLabel(null);
      load();
    } catch (e: any) { setError(e.message); }
  }

  async function deleteBatch(batchId: string) {
    if (!confirm("Delete this entire upload (raw rows + parsed facts)? This cannot be undone.")) return;
    try {
      await api.del(`/imports/batches/${batchId}`);
      load();
    } catch (e: any) { setError(e.message); }
  }

  return (
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
  );
}
