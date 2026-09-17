import { useEffect, useState, FormEvent } from "react";
import { getRole } from "../api/client";
import { supabase } from "@/lib/supabase";
import { vacationsService } from "../services/vacations";
import TableImportExport from "../components/TableImportExport";
import AutocompleteInput from "../components/AutocompleteInput";

// SUPABASE PORT of Vacations.tsx (was `/vacations` + per-person
// `/route-plan/vacation-status/{code}` REST calls on the old backend).
// CRUD now goes through `vacationsService` (the `vacations` table).
// The "days left / back N days / upcoming in N days" status line is a
// direct client-side port of the old backend's get_vac_status() in
// services/route_planner.py - simple date math with no dependency on the
// (not yet ported) route planner engine itself, so it's safe to compute
// here rather than leave as a placeholder.
interface Vacation { id: string; person_code: string; person_name: string; person_type: PersonType; start_date: string; end_date: string; status?: string; }
type PersonType = "Driver" | "Helper";
interface VacationForm { person_code: string; person_name: string; person_type: PersonType; start_date: string; end_date: string; }
const empty: VacationForm = { person_code: "", person_name: "", person_type: "Driver", start_date: "", end_date: "" };

function statusBadgeClass(status?: string): string {
  if (!status) return "";
  if (status.startsWith("On leave")) return "excluded";
  if (status.startsWith("Upcoming")) return "";
  if (status.startsWith("Back")) return "ok";
  return "";
}

/** Direct port of the old backend's get_vac_status() - takes every vacation
 * row for one person (there can be several over time) and reports which of
 * "on leave now / most recently back / next upcoming / never" applies. */
function vacStatus(personVacs: Vacation[], today: Date): string {
  if (personVacs.length === 0) return "Never";
  const todayStr = today.toISOString().slice(0, 10);
  const current = personVacs.find((v) => v.start_date <= todayStr && todayStr <= v.end_date);
  if (current) {
    const daysLeft = Math.round((new Date(current.end_date).getTime() - today.getTime()) / 86400000);
    return `On leave (${daysLeft} days left)`;
  }
  const pastEnds = personVacs.map((v) => v.end_date).filter((e) => e < todayStr).sort().reverse();
  if (pastEnds.length > 0) {
    const daysSince = Math.round((today.getTime() - new Date(pastEnds[0]).getTime()) / 86400000);
    return `Back (${daysSince} days ago)`;
  }
  const futureStarts = personVacs.map((v) => v.start_date).filter((s) => s > todayStr).sort();
  if (futureStarts.length > 0) {
    const daysUntil = Math.round((new Date(futureStarts[0]).getTime() - today.getTime()) / 86400000);
    return `Upcoming (in ${daysUntil} days)`;
  }
  return "Never";
}

export default function Vacations() {
  const [rows, setRows] = useState<Vacation[]>([]);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const canWrite = getRole() === "admin" || getRole() === "dispatcher";

  async function load() {
    try {
      const { data, error } = await supabase.from("vacations").select("*").order("start_date", { ascending: false });
      if (error) throw new Error(error.message);
      const all = (data ?? []) as Vacation[];
      const today = new Date();
      const byCode = new Map<string, Vacation[]>();
      for (const v of all) byCode.set(v.person_code, [...(byCode.get(v.person_code) ?? []), v]);
      setRows(all.map((r) => ({ ...r, status: vacStatus(byCode.get(r.person_code) ?? [], today) })));
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await vacationsService.create(form);
      setForm(empty);
      load();
    } catch (e: any) { setError(e.message); }
  }

  async function handleDelete(id: string) {
    try { await vacationsService.remove(id); load(); } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="page">
      <h2>Vacations</h2>
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <TableImportExport table="vacations" naturalKey="person_code" onImported={load} canWrite={canWrite} />
      </div>
      {canWrite && (
        <form className="glass-card" onSubmit={handleAdd} style={{ marginBottom: 20, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>Type</label>
            <select
              value={form.person_type}
              onChange={(e) => setForm({ ...form, person_type: e.target.value as PersonType, person_code: "", person_name: "" })}
            >
              <option value="Driver">Driver</option>
              <option value="Helper">Helper</option>
            </select>
          </div>
          <div style={{ minWidth: 200 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>Employee Code / Name</label>
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
