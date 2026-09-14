import { useEffect, useState } from "react";
import { api } from "../api/client";

interface Entry {
  id: number; entity_type: string; entity_key: string; action: string;
  actor: string; success: boolean; error_message: string; undone: boolean; timestamp: string;
}

const actionColor: Record<string, string> = { create: "ok", update: "", delete: "excluded" };

export default function AuditLog() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      setEntries(await api.get(`/audit?entity_type=${filter}`));
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => { load(); }, [filter]);

  return (
    <div className="page">
      <h2>Audit Log</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -8 }}>
        Every create/update/delete across Fleet tables, who did it, and whether it's since been undone.
      </p>

      <div className="glass-card" style={{ marginBottom: 20 }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All tables</option>
          <option value="driver">Drivers</option>
          <option value="helper">Helpers</option>
          <option value="vehicle">Vehicles</option>
          <option value="area">Areas</option>
          <option value="vacation">Vacations</option>
        </select>
      </div>

      {error && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{error}</div>}

      <div className="glass-card table-scroll">
        <table className="data-table">
          <thead><tr><th>Time</th><th>Table</th><th>Record</th><th>Action</th><th>By</th><th>Status</th></tr></thead>
          <tbody>
            {entries.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No activity yet</td></tr>
            )}
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.timestamp).toLocaleString()}</td>
                <td>{e.entity_type}</td>
                <td>{e.entity_key}</td>
                <td><span className={"badge " + actionColor[e.action]}>{e.action}</span></td>
                <td>{e.actor}</td>
                <td>{e.undone ? <span className="badge excluded">Undone</span> : e.success ? "✓" : "✗ Failed"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
