import { useEffect, useState } from "react";
import { api, subscribeJobEvents } from "../api/client";

interface BackupFile { filename: string; size_bytes: number | null; sha256: string | null; error: string | null; }
interface BackupManifest { backup_id: string; created_at: string; label: string; files: BackupFile[]; }
interface Stats { total_backups: number; most_recent: string | null; total_size_mb: number; retention_limit: number; }

export default function Backup() {
  const [backups, setBackups] = useState<BackupManifest[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [label, setLabel] = useState("");
  const [job, setJob] = useState<any>(null);
  const [error, setError] = useState("");
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  async function load() {
    try {
      const [b, s] = await Promise.all([api.get("/backup/list"), api.get("/backup/stats")]);
      setBackups(b);
      setStats(s);
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function createBackup() {
    setError("");
    try {
      const data = await api.post(`/backup/create?label=${encodeURIComponent(label)}`);
      setLabel("");
      subscribeJobEvents(data.job_id, (snap) => {
        setJob(snap);
        if (snap.status === "completed" || snap.status === "failed") load();
      });
    } catch (e: any) { setError(e.message); }
  }

  async function restore(backupId: string) {
    setError("");
    try {
      const data = await api.post("/backup/restore", { backup_id: backupId, confirm: true });
      setConfirmRestore(null);
      subscribeJobEvents(data.job_id, (snap) => setJob(snap));
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="page">
      <h2>Backup &amp; Restore</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -8 }}>
        Every backup is a full database snapshot (pg_dump), checksummed. Restoring anything
        automatically creates a fresh safety-checkpoint backup first, so a mistaken restore
        can always be undone.
      </p>

      {stats && (
        <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, minmax(150px,1fr))" }}>
          <div className="glass-card kpi-card"><div className="value">{stats.total_backups}</div><div className="label">Total Backups</div></div>
          <div className="glass-card kpi-card"><div className="value">{stats.total_size_mb} MB</div><div className="label">Total Size</div></div>
          <div className="glass-card kpi-card"><div className="value">{stats.retention_limit}</div><div className="label">Retention Limit</div></div>
          <div className="glass-card kpi-card"><div className="value" style={{ fontSize: 13 }}>{stats.most_recent ? new Date(stats.most_recent).toLocaleString() : "—"}</div><div className="label">Most Recent</div></div>
        </div>
      )}

      <div className="glass-card" style={{ marginBottom: 20, display: "flex", gap: 10, alignItems: "center" }}>
        <input placeholder="Optional label (e.g. 'before SAP import')" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: 1 }} />
        <button className="btn" onClick={createBackup}>Create Backup Now</button>
      </div>

      {job && (
        <div className="glass-card" style={{ marginBottom: 20 }}>
          <strong>{job.current_step}</strong> — <span className={"badge " + (job.status === "failed" ? "excluded" : "ok")}>{job.status}</span>
          {job.log && <pre style={{ fontSize: 11, color: "var(--muted)", marginTop: 8, maxHeight: 120, overflow: "auto" }}>{job.log}</pre>}
        </div>
      )}

      {error && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{error}</div>}

      <div className="glass-card table-scroll">
        <strong>Backup History</strong>
        <table className="data-table" style={{ marginTop: 10 }}>
          <thead><tr><th>Created</th><th>Label</th><th>Size</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {backups.map((b) => {
              const okFile = b.files.find((f) => !f.error);
              const failed = b.files.some((f) => f.error);
              return (
                <tr key={b.backup_id}>
                  <td>{new Date(b.created_at).toLocaleString()}</td>
                  <td>{b.label || "—"}</td>
                  <td>{okFile?.size_bytes ? (okFile.size_bytes / (1024 * 1024)).toFixed(1) + " MB" : "—"}</td>
                  <td><span className={"badge " + (failed ? "excluded" : "ok")}>{failed ? "Failed" : "OK"}</span></td>
                  <td>
                    {confirmRestore === b.backup_id ? (
                      <>
                        <button className="btn" style={{ background: "var(--red)", marginRight: 6 }} onClick={() => restore(b.backup_id)}>Confirm Restore</button>
                        <button className="btn" onClick={() => setConfirmRestore(null)}>Cancel</button>
                      </>
                    ) : (
                      <button className="btn" disabled={failed} onClick={() => setConfirmRestore(b.backup_id)}>Restore</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
