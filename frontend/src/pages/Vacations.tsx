import { useEffect, useState, FormEvent } from "react";
import { api, getRole } from "../api/client";
import TableImportExport from "../components/TableImportExport";
import AutocompleteInput from "../components/AutocompleteInput";

interface Vacation { id: number; person_code: string; person_name: string; person_type: string; start_date: string; end_date: string; status?: string; }
const empty = { person_code: "", person_name: "", person_type: "Driver", start_date: "", end_date: "" };

function statusBadgeClass(status?: string): string {
  if (!status) return "";
  if (status.startsWith("On leave")) return "excluded";
  if (status.startsWith("Upcoming")) return "";
  if (status.startsWith("Back")) return "ok";
  return "";
}

export default function Vacations() {
  const [rows, setRows] = useState<Vacation[]>([]);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const canWrite = getRole() === "admin" || getRole() === "dispatcher";

  async function load() {
    try {
      const data: Vacation[] = await api.get("/vacations");
      // Fetch the days-left/until-back countdown per person - direct port
      // of V1's get_vac_status(), already built as its own endpoint.
      const withStatus = await Promise.all(
        data.map(async (r) => {
          try {
            const s = await api.get(`/route-plan/vacation-status/${encodeURIComponent(r.person_code)}`);
            return { ...r, status: s.status };
          } catch {
            return r;
          }
        })
      );
      setRows(withStatus);
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/vacations", form);
      setForm(empty);
      load();
    } catch (e: any) { setError(e.message); }
  }

  async function handleDelete(id: number) {
    try { await api.del(`/vacations/${id}`); load(); } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="page">
      <h2>Vacations</h2>
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <TableImportExport endpointPrefix="/vacations" onImported={load} canWrite={canWrite} />
      </div>
      {canWrite && (
        <form className="glass-card" onSubmit={handleAdd} style={{ marginBottom: 20, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>Type</label>
            <select
              value={form.person_type}
              onChange={(e) => setForm({ ...form, person_type: e.target.value, person_code: "", person_name: "" })}
            >
              <option value="Driver">Driver</option>
              <option value="Helper">Helper</option>
            </select>
          </div>
          <div style={{ minWidth: 200 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>Employee Code / Name</label>
            {/*
              BUGFIX: predictive autocomplete for Employee Code/Name, per
              Fleet Database - was plain free-typed text before, with no
              suggestions and no link back to an actual Driver/Helper
              record. Backed by /api/autocomplete/driver or /helper (the
              same fields Fleet Database's own forms use), which return
              "CODE - NAME" suggestions - onSelectRaw captures the name
              half too, so picking a suggestion fills both fields at once
              instead of just the code.
            */}
            <AutocompleteInput
              field={form.person_type === "Helper" ? "helper" : "driver"}
              value={form.person_code}
              onChange={(v) => setForm({ ...form, person_code: v })}
              onSelectRaw={(raw) => {
                const [code, name] = raw.includes(" - ") ? raw.split(" - ") : [raw, form.person_name];
                setForm((f) => ({ ...f, person_code: code, person_name: name || f.person_name }));
              }}
              placeholder={`Search ${form.person_type.toLowerCase()} code or name…`}
            />
          </div>
          <div><label style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>Start</label>
            <input type="date" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
          <div><label style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>End</label>
            <input type="date" required value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
          <button className="btn" type="submit">Add Vacation</button>
        </form>
      )}
      {error && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{error}</div>}
      <div className="glass-card table-scroll">
        <table className="data-table">
          <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Start</th><th>End</th><th>Status</th>{canWrite && <th></th>}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.person_code}</td><td>{r.person_name}</td><td>{r.person_type || "Driver"}</td><td>{r.start_date}</td><td>{r.end_date}</td>
                <td>{r.status ? <span className={"badge " + statusBadgeClass(r.status)}>{r.status}</span> : "—"}</td>
                {canWrite && <td><button className="btn" style={{ background: "var(--red)" }} onClick={() => handleDelete(r.id)}>Delete</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
