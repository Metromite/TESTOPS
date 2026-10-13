import { useEffect, useRef, useState, FormEvent, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { getRole } from "../api/client";
import { supabase, getPrimarySupabaseClient } from "@/lib/supabase";
import { vacationsService } from "../services/vacations";
import TableImportExport from "../components/TableImportExport";

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

function VacationEmployeeAutocomplete({
  type,
  value,
  onChange,
  onSelect,
}: {
  type: PersonType;
  value: string;
  onChange: (value: string) => void;
  onSelect: (code: string, name: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const table = type === "Helper" ? "helpers" : "drivers";

  async function lookup(needle: string) {
    const q = needle.trim();
    const client = getPrimarySupabaseClient();
    const query = client.from(table).select("code,name");
    const result = q
      ? await query.or(`code.ilike.%${q}%,name.ilike.%${q}%`).limit(10)
      : await query.limit(10);
    if (!result.error && result.data) {
      setItems((result.data as any[]).map((r) => `${r.code} - ${r.name}`));
    } else {
      setItems([]);
    }
  }

  function openList() {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) setPos({ left: rect.left, top: rect.bottom + 6, width: rect.width });
    setOpen(true);
    void lookup(value);
  }

  useEffect(() => {
    if (!open) return;
    const onMove = () => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (rect) setPos({ left: rect.left, top: rect.bottom + 6, width: rect.width });
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  function choose(raw: string) {
    const [code, ...rest] = raw.split(" - ");
    const name = rest.join(" - ");
    onChange(code);
    onSelect(code, name);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") setOpen(false);
    if (e.key === "Enter" && items[0]) {
      e.preventDefault();
      choose(items[0]);
    }
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); void lookup(e.target.value); }}
        onFocus={openList}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        onKeyDown={onKeyDown}
        placeholder={`Search ${type.toLowerCase()} code or name…`}
        autoComplete="off"
        style={{ width: "100%" }}
      />
      {open && items.length > 0 && pos && createPortal(
        <div
          style={{
            position: "fixed", left: pos.left, top: pos.top, width: pos.width,
            zIndex: 2147483000, maxHeight: 220, overflowY: "auto",
            padding: 5, borderRadius: 12, border: "1px solid var(--glass-border)",
            background: "var(--dispatch-surface)", color: "var(--dispatch-text)",
            boxShadow: "0 18px 55px rgba(0,0,0,.24)",
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {items.map((item) => (
            <div
              key={item}
              onMouseDown={() => choose(item)}
              style={{ cursor: "pointer", padding: "8px 10px", borderRadius: 8, fontSize: 13 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--row-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {item}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const canWrite = Boolean(getRole());
  const canImport = getRole() === "admin";

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
      if (editingId) await vacationsService.update(editingId, form as any);
      else await vacationsService.create(form);
      setForm(empty);
      setEditingId(null);
      load();
    } catch (e: any) { setError(e.message); }
  }

  function startEdit(row: Vacation) {
    setEditingId(row.id);
    setForm({ person_code: row.person_code, person_name: row.person_name, person_type: row.person_type, start_date: row.start_date, end_date: row.end_date });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteVacation(row: Vacation) {
    if (!window.confirm(`Delete vacation for ${row.person_name || row.person_code}?`)) return;
    setError("");
    try {
      if (editingId === row.id) {
        setEditingId(null);
        setForm(empty);
      }
      await vacationsService.remove(row.id);
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to delete vacation");
    }
  }



  return (
    <div className="page">
      <h2>Vacations</h2>
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <TableImportExport table="vacations" naturalKey="person_code" onImported={load} canWrite={canWrite} canImport={canImport} />
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
            <VacationEmployeeAutocomplete
              type={form.person_type}
              value={form.person_code}
              onChange={(v) => setForm({ ...form, person_code: v, person_name: "" })}
              onSelect={(code, name) => setForm((f) => ({ ...f, person_code: code, person_name: name }))}
            />
          </div>
          <div><label style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>Start</label>
            <input type="date" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
          <div><label style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>End</label>
            <input type="date" required value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
          <button className="btn" type="submit">{editingId ? "Save Vacation" : "Add Vacation"}</button>{editingId && <button className="btn" type="button" onClick={() => { setEditingId(null); setForm(empty); }}>Cancel</button>}
        </form>
      )}
      {error && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{error}</div>}
      <div className="glass-card table-scroll">
        <table className="data-table">
          <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Start</th><th>End</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.person_code}</td><td>{r.person_name}</td><td>{r.person_type || "Driver"}</td><td>{r.start_date}</td><td>{r.end_date}</td>
                <td>{r.status ? <span className={"badge " + statusBadgeClass(r.status)}>{r.status}</span> : "—"}</td>
                <td>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button className="btn" type="button" onClick={() => startEdit(r)}>Edit</button>
                    {canWrite && (
                      <button className="btn" type="button" onClick={() => deleteVacation(r)}>Delete</button>
                    )}
                  </div>
                </td>
                
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
