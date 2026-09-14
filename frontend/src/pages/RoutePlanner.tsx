import { useEffect, useState, FormEvent, DragEvent } from "react";
import { api } from "../api/client";
import AutocompleteInput from "../components/AutocompleteInput";

interface RankedCandidate { code: string; name: string; score: number; reason: string; vac_status?: string; }
interface BreakdownRow { factor: string; points: number | null; }
interface AreaResult {
  area_code: string; area_name: string; sector: string; route_type: string;
  required_vehicle: string; ranked_drivers: RankedCandidate[]; ranked_helpers: RankedCandidate[];
  top_driver_breakdown: BreakdownRow[]; top_helper_breakdown: BreakdownRow[];
}
interface PlanResponse { fleet_errors: string[]; areas: AreaResult[]; }

function CandidateTable({ title, candidates }: { title: string; candidates: RankedCandidate[] }) {
  if (candidates.length === 0) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{title}</div>
      <table className="data-table">
        <thead><tr><th>Candidate</th><th>Score</th><th>Reason</th><th>Vacation</th></tr></thead>
        <tbody>
          {candidates.map((d) => (
            <tr key={d.code}>
              <td>{d.name} ({d.code})</td>
              <td>{d.score}</td>
              <td style={{ fontSize: 12, color: "var(--muted)" }}>{d.reason}</td>
              <td style={{ fontSize: 12 }}>
                {d.vac_status && d.vac_status !== "Never" ? (
                  <span className={"badge " + (d.vac_status.startsWith("Upcoming") ? "excluded" : "")}>{d.vac_status}</span>
                ) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WhyBreakdown({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, color: "var(--teal)", marginBottom: 4 }}>Why: {title}</div>
      <table className="data-table">
        <thead><tr><th>Factor</th><th>Points</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ fontSize: 12 }}>{r.factor}</td>
              <td style={{ fontSize: 12, color: r.points != null && r.points < 0 ? "var(--red)" : "var(--green)" }}>
                {r.points != null ? (r.points > 0 ? `+${r.points}` : r.points) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CandidateReviewPanel({ syncDate }: { syncDate?: string | null }) {
  const [targetDate, setTargetDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generate(dateOverride?: string) {
    setLoading(true);
    setError("");
    try {
      const data: PlanResponse = await api.post("/route-plan/generate", { target_date: dateOverride ?? targetDate });
      // Attach vacation countdown per candidate so a Dispatcher can see
      // "upcoming vacation in N days" context, not just the score.
      const codes = new Set<string>();
      data.areas.forEach((a) => {
        a.ranked_drivers.forEach((d) => codes.add(d.code));
        a.ranked_helpers.forEach((d) => codes.add(d.code));
      });
      const statuses: Record<string, string> = {};
      await Promise.all([...codes].map(async (code) => {
        try {
          const s = await api.get(`/route-plan/vacation-status/${encodeURIComponent(code)}`);
          statuses[code] = s.status;
        } catch { /* ignore - vacation status is supplementary context */ }
      }));
      data.areas.forEach((a) => {
        a.ranked_drivers.forEach((d) => { d.vac_status = statuses[d.code]; });
        a.ranked_helpers.forEach((d) => { d.vac_status = statuses[d.code]; });
      });
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // ROUTE PLANNER INTEGRATION FIX: Candidate Review must always show the
  // latest generated assignments - so whenever a Driver or Helper plan is
  // generated (elsewhere in this page), we get told via syncDate and
  // automatically re-run candidate scoring for that same date, rather
  // than requiring the dispatcher to separately come here and click
  // "Generate" again with a matching date.
  useEffect(() => {
    if (syncDate) {
      setTargetDate(syncDate);
      generate(syncDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncDate]);

  return (
    <div className="page">
      <h2>Route Planner</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -8 }}>
        Runs the ported V1 scoring engine exactly - same candidate scoring,
        anchor-area rules, and pharma/consumer health-card logic as the
        original 3-month route planner. Results are for review, not
        auto-committed. Main routes (★) are listed first and get priority
        if there's a fleet shortage.
      </p>

      <div className="glass-card" style={{ marginBottom: 20, display: "flex", gap: 12, alignItems: "flex-end" }}>
        <div>
          <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>
            Target start date
          </label>
          <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </div>
        <button className="btn" onClick={() => generate()} disabled={loading}>
          {loading ? "Scoring candidates..." : "Generate Route Plan"}
        </button>
      </div>

      {error && <div className="glass-card error-text">{error}</div>}

      {result && (
        <>
          {result.fleet_errors.length > 0 && (
            <div className="glass-card" style={{ marginBottom: 20, borderColor: "var(--red)" }}>
              <strong style={{ color: "var(--red)" }}>Fleet requirement issues</strong>
              <ul>
                {result.fleet_errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          {result.areas.map((area) => (
            // BUGFIX: same Area Code+Name can legitimately exist under two
            // different Divisions (e.g. "JA" for Pharma AND "JA" for
            // Consumer - see models/fleet.py's Area uniqueness note). This
            // list is keyed by area_code alone before this fix, which is
            // NOT unique across divisions - React silently drops/misrenders
            // duplicate-keyed siblings, so only one of the two "JA" cards
            // ever actually showed up even though the backend was already
            // returning both (confirmed in services/route_planner.py -
            // results is a plain list with one entry per Area row, sector
            // included on every entry). Keying by code+sector together
            // restores both.
            <div className="glass-card table-scroll" key={`${area.area_code}-${area.sector}`} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <strong>
                  {area.route_type === "Main" && <span style={{ color: "var(--teal)" }}>★ </span>}
                  {area.area_name} ({area.area_code})
                </strong>
                <span style={{ display: "flex", gap: 6 }}>
                  <span className={"badge " + (area.route_type === "Main" ? "ok" : "excluded")}>{area.route_type}</span>
                  <span className="badge ok">{area.sector} · {area.required_vehicle}</span>
                </span>
              </div>

              <CandidateTable title="Driver candidates" candidates={area.ranked_drivers} />
              {area.ranked_helpers.length > 0 && <CandidateTable title="Helper candidates" candidates={area.ranked_helpers} />}
              {area.ranked_drivers.length === 0 && area.ranked_helpers.length === 0 && (
                <div style={{ color: "var(--muted)", fontSize: 13 }}>No eligible candidates</div>
              )}

              <WhyBreakdown title={area.ranked_drivers[0] ? `${area.ranked_drivers[0].name} (top driver)` : ""} rows={area.top_driver_breakdown} />
              <WhyBreakdown title={area.ranked_helpers[0] ? `${area.ranked_helpers[0].name} (top helper)` : ""} rows={area.top_helper_breakdown} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Persisted, editable Driver/Helper Route Plan (ROUND 3) - independent per
// role: generating one never touches the other's saved rows. Persists
// across refresh/reopen since it's a plain DB read (GET /route-plan/{role}).
// ---------------------------------------------------------------------------

interface RouteAssignmentRow {
  id: number; plan_role: string;
  area_code: string; area_name: string; sector: string; route_type: string;
  driver_requirement: string; helper_requirement: string;
  driver_code: string; driver_name: string; helper_code: string; helper_name: string;
  vehicle_number: string; vehicle_type: string; anchored_vehicle_number: string; vehicle_assignment_reason: string;
  start_date: string; end_date: string;
  driver_score: number; driver_reason: string; helper_score: number; helper_reason: string;
  assignment_reason: string; restrictions_considered: string;
  is_vacation_replacement: boolean; original_person_code: string; original_person_name: string;
  vacation_start_date: string; vacation_end_date: string; vacation_replacement_reason: string;
  is_manually_edited: boolean; status: string;
}

function EditRowModal({ row, onClose, onSaved }: { row: RouteAssignmentRow; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    driver_code: row.driver_code, driver_name: row.driver_name,
    helper_code: row.helper_code, helper_name: row.helper_name,
    vehicle_number: row.vehicle_number, vehicle_type: row.vehicle_type,
    sector: row.sector, route_type: row.route_type,
    start_date: row.start_date, end_date: row.end_date,
    driver_requirement: row.driver_requirement, helper_requirement: row.helper_requirement,
  });
  const [error, setError] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api.put(`/route-plan/row/${row.id}`, form);
      onSaved();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={onClose}>
      <form className="glass-card" onSubmit={save} onClick={(e) => e.stopPropagation()}
        style={{ width: "fit-content", minWidth: 320, maxWidth: "92vw", maxHeight: "88vh", overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 10 }}>
        <strong>Edit {row.area_name} ({row.area_code})</strong>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field label="Driver Code"><AutocompleteInput field="driver" value={form.driver_code} onChange={(v) => setForm({ ...form, driver_code: v.split(" - ")[0] })} /></Field>
          <Field label="Driver Name"><input value={form.driver_name} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} /></Field>
          <Field label="Helper Code"><AutocompleteInput field="helper" value={form.helper_code} onChange={(v) => setForm({ ...form, helper_code: v.split(" - ")[0] })} /></Field>
          <Field label="Helper Name"><input value={form.helper_name} onChange={(e) => setForm({ ...form, helper_name: e.target.value })} /></Field>
          <Field label="Vehicle Number"><AutocompleteInput field="vehicle_number" value={form.vehicle_number} onChange={(v) => setForm({ ...form, vehicle_number: v })} /></Field>
          <Field label="Vehicle Type"><AutocompleteInput field="vehicle_type" value={form.vehicle_type} onChange={(v) => setForm({ ...form, vehicle_type: v })} /></Field>
          <Field label="Division"><AutocompleteInput field="division" value={form.sector} onChange={(v) => setForm({ ...form, sector: v })} /></Field>
          <Field label="Route Type"><AutocompleteInput field="route_type" value={form.route_type} onChange={(v) => setForm({ ...form, route_type: v })} /></Field>
          <Field label="Driver Requirement"><input value={form.driver_requirement} onChange={(e) => setForm({ ...form, driver_requirement: e.target.value })} /></Field>
          <Field label="Helper Requirement"><input value={form.helper_requirement} onChange={(e) => setForm({ ...form, helper_requirement: e.target.value })} /></Field>
          <Field label="Start Date"><input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
          <Field label="End Date"><input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
        </div>
        {error && <div className="error-text">{error}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" type="submit">Save Changes</button>
          <button className="btn" type="button" style={{ background: "var(--navy3)", color: "var(--muted)" }} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)", flex: "1 1 160px" }}>
      {label}
      {children}
    </label>
  );
}

function PersistedPlanPanel({ role, onGenerated, onDataChanged }: {
  role: "driver" | "helper"; onGenerated?: (date: string) => void; onDataChanged?: () => void;
}) {
  const [rows, setRows] = useState<RouteAssignmentRow[]>([]);
  const [targetDate, setTargetDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<RouteAssignmentRow | null>(null);

  async function load() {
    try { setRows(await api.get(`/route-plan/${role}`)); } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { load(); }, [role]);

  async function generate() {
    if (rows.length > 0 && !window.confirm(
      `This replaces the current saved ${role} Route Plan with a newly generated one. ` +
      `Manual edits are preserved; everything else is recalculated. Continue?`
    )) return;
    setLoading(true); setError("");
    try {
      await api.post(`/route-plan/${role}/generate`, { target_date: targetDate });
      await load();
      // ROUTE PLANNER INTEGRATION FIX: tell the parent so it can refresh
      // Candidate Review and the combined Route Plan Sheet automatically -
      // no manual refresh required anywhere else in the workflow.
      onGenerated?.(targetDate);
      onDataChanged?.();
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  function downloadExcel() {
    window.open(`/api/route-plan/export/excel?plan_role=${role}`, "_blank");
  }

  const roleLabel = role === "driver" ? "Driver" : "Helper";

  return (
    <div>
      <div className="glass-card" style={{ marginBottom: 20, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>Plan start date</label>
          <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </div>
        <button className="btn" onClick={() => generate()} disabled={loading}>
          {loading ? "Generating..." : `Generate New ${roleLabel} Route Plan`}
        </button>
        <button className="btn" style={{ background: "var(--navy3)", color: "var(--muted)" }} onClick={load}>Refresh</button>
        <button className="btn" style={{ background: "var(--teal)" }} onClick={downloadExcel}>Download Excel</button>
        <button className="btn" style={{ background: "var(--navy3)", color: "var(--muted)" }} onClick={() => window.print()}>Print</button>
      </div>

      {error && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{error}</div>}

      {rows.length === 0 ? (
        <div className="glass-card" style={{ color: "var(--muted)" }}>
          No saved {roleLabel} Route Plan yet - click "Generate New {roleLabel} Route Plan" above.
          {role === "helper" && (
            <div style={{ marginTop: 6, fontSize: 12 }}>
              Reminder: Helpers usually stay on the previous Driver assignments for ~1 month to help new
              Drivers learn the area - generating the Driver plan never overwrites this Helper plan.
            </div>
          )}
        </div>
      ) : (
        <div className="glass-card table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Area Code</th><th>Area Name</th><th>Division</th><th>Route Type</th>
                <th>Vehicle Type</th><th>Anchored Veh.</th><th>Assigned Veh.</th>
                <th>Driver Req.</th><th>Helper Req.</th><th>Driver</th><th>Helper</th>
                <th>Dates</th><th>Reason</th><th>Score</th><th>Vacation Info</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={r.is_vacation_replacement ? { background: "rgba(245,158,11,0.08)" } : undefined}>
                  <td>{r.area_code}</td><td>{r.area_name}</td><td>{r.sector}</td><td>{r.route_type}</td>
                  <td>{r.vehicle_type}</td><td>{r.anchored_vehicle_number || "—"}</td>
                  <td title={r.vehicle_assignment_reason}>{r.vehicle_number || <span className="badge excluded">SHORTAGE</span>}</td>
                  <td><span className={"badge " + (r.driver_requirement === "Mandatory" ? "ok" : "")}>{r.driver_requirement}</span></td>
                  <td><span className={"badge " + (r.helper_requirement === "Mandatory" ? "ok" : "")}>{r.helper_requirement}</span></td>
                  <td>{r.driver_code ? `${r.driver_name} (${r.driver_code})` : "—"}</td>
                  <td>{r.helper_code ? `${r.helper_name} (${r.helper_code})` : "—"}</td>
                  <td style={{ fontSize: 12 }}>{r.start_date} → {r.end_date}</td>
                  <td style={{ fontSize: 12, color: "var(--muted)", maxWidth: 220 }}>
                    {r.assignment_reason}
                    {r.is_manually_edited && <span className="badge" style={{ marginLeft: 6 }}>Manual</span>}
                  </td>
                  <td>{role === "driver" ? r.driver_score : r.helper_score}</td>
                  <td style={{ fontSize: 12, color: "var(--amber)" }}>
                    {r.is_vacation_replacement ? `${r.original_person_name} on leave ${r.vacation_start_date}→${r.vacation_end_date}` : "—"}
                  </td>
                  <td><span className={"badge " + (r.status === "Confirmed" ? "ok" : r.status === "Shortage" ? "excluded" : "")}>{r.status}</span></td>
                  <td><button className="btn" onClick={() => setEditing(r)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditRowModal row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); onDataChanged?.(); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ROUTE PLAN LAYOUT + REARRANGEMENT - the unified Route Plan Sheet: one row
// per area merging the current Driver + Helper plans (see backend's
// get_combined_route_plan_sheet). Fixed column widths + wrapping on
// Assignment Reason fixes the overlap issue; native HTML5 drag-and-drop
// lets a dispatcher reorder rows, saved permanently via PUT /reorder.
// ---------------------------------------------------------------------------

interface CombinedSheetRow {
  sn: number; area_code: string; area_name: string; sector: string; route_type: string;
  driver_code: string; driver_name: string; helper_code: string; helper_name: string;
  vehicle_type: string; vehicle_number: string; assignment_reason: string; score: number; status: string;
}

// ---------------------------------------------------------------------------
// COLUMN CUSTOMIZATION - the layout (order/visibility/width) is persisted
// permanently server-side via GET/PUT /route-plan/sheet-layout (Postgres,
// not localStorage - survives refresh, closing the browser, and restarting
// the server). The backend's DEFAULT_SHEET_COLUMNS (route_planner.py) is
// the single source of truth for the default order; this cellValue map is
// the only thing that has to stay in sync with it (one entry per key).
// ---------------------------------------------------------------------------

interface SheetColumnDef { key: string; label: string; width: number }

const CELL_RENDERERS: Record<string, (r: CombinedSheetRow) => React.ReactNode> = {
  sn: (r) => r.sn,
  sector: (r) => r.sector,
  driver_code: (r) => r.driver_code || "—",
  driver_name: (r) => r.driver_name || "—",
  area_name: (r) => r.area_name,
  helper_code: (r) => r.helper_code || "—",
  helper_name: (r) => r.helper_name || "—",
  vehicle_type: (r) => r.vehicle_type,
  vehicle_number: (r) => r.vehicle_number || <span className="badge excluded">SHORTAGE</span>,
  route_type: (r) => r.route_type,
  assignment_reason: (r) => r.assignment_reason,
  score: (r) => r.score,
};

const MIN_COL_WIDTH = 50;

function CombinedSheetPanel({ refreshToken }: { refreshToken: number }) {
  const [rows, setRows] = useState<CombinedSheetRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [columns, setColumns] = useState<SheetColumnDef[]>([]); // full order, including hidden
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showColumnPanel, setShowColumnPanel] = useState(false);
  const dragRowIndex = useState<{ current: number | null }>({ current: null })[0];
  const dragColKey = useState<{ current: string | null }>({ current: null })[0];
  const resizing = useState<{ current: { key: string; startX: number; startWidth: number } | null }>({ current: null })[0];

  async function load() {
    setLoading(true);
    try { setRows(await api.get("/route-plan/combined-sheet")); } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }
  async function loadLayout() {
    try {
      const layout = await api.get("/route-plan/sheet-layout");
      setColumns(layout.columns.map((c: any) => ({ key: c.key, label: c.label, width: c.width })));
      setHidden(new Set<string>(layout.hidden_columns));
    } catch (e: any) { /* fall back to whatever's already in state - non-fatal */ }
  }
  useEffect(() => { load(); loadLayout(); }, [refreshToken]);

  async function persistLayout(cols: SheetColumnDef[], hiddenSet: Set<string>) {
    try {
      await api.put("/route-plan/sheet-layout", {
        column_order: cols.map((c) => c.key),
        hidden_columns: [...hiddenSet],
        column_widths: Object.fromEntries(cols.map((c) => [c.key, Math.round(c.width)])),
      });
    } catch (e: any) { setError(e.message); }
  }

  const visibleColumns = columns.filter((c) => !hidden.has(c.key));

  // -- Row drag-and-drop reordering (persisted via existing /reorder) --
  function handleRowDragStart(i: number) { dragRowIndex.current = i; }
  function handleRowDragOver(e: DragEvent) { e.preventDefault(); }
  async function handleRowDrop(dropIndex: number) {
    if (dragRowIndex.current === null || dragRowIndex.current === dropIndex) return;
    const next = [...rows];
    const [moved] = next.splice(dragRowIndex.current, 1);
    next.splice(dropIndex, 0, moved);
    dragRowIndex.current = null;
    setRows(next.map((r, i) => ({ ...r, sn: i + 1 })));
    try {
      await api.put("/route-plan/reorder", { area_codes: next.map((r) => r.area_code) });
    } catch (e: any) { setError(e.message); }
  }

  // -- Column drag-and-drop reordering (visible columns; hidden columns
  // stay appended at the end of the stored order until re-shown) --
  function handleColDragStart(key: string) { dragColKey.current = key; }
  function handleColDragOver(e: DragEvent) { e.preventDefault(); }
  function handleColDrop(targetKey: string) {
    const from = dragColKey.current;
    dragColKey.current = null;
    if (!from || from === targetKey) return;
    const visibleKeys = visibleColumns.map((c) => c.key);
    const fromIdx = visibleKeys.indexOf(from);
    const toIdx = visibleKeys.indexOf(targetKey);
    if (fromIdx === -1 || toIdx === -1) return;
    const reorderedVisible = [...visibleKeys];
    const [moved] = reorderedVisible.splice(fromIdx, 1);
    reorderedVisible.splice(toIdx, 0, moved);
    const hiddenKeys = columns.filter((c) => hidden.has(c.key)).map((c) => c.key);
    const byKey = Object.fromEntries(columns.map((c) => [c.key, c]));
    const next = [...reorderedVisible, ...hiddenKeys].map((k) => byKey[k]);
    setColumns(next);
    persistLayout(next, hidden);
  }

  // -- Column resize (drag the right edge of a header cell) --
  function handleResizeStart(e: React.MouseEvent, key: string) {
    e.preventDefault();
    e.stopPropagation();
    const col = columns.find((c) => c.key === key);
    if (!col) return;
    resizing.current = { key, startX: e.clientX, startWidth: col.width };
    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", handleResizeEnd);
  }
  function handleResizeMove(e: MouseEvent) {
    if (!resizing.current) return;
    const { key, startX, startWidth } = resizing.current;
    const newWidth = Math.max(MIN_COL_WIDTH, Math.round(startWidth + (e.clientX - startX)));
    setColumns((cur) => cur.map((c) => (c.key === key ? { ...c, width: newWidth } : c)));
  }
  function handleResizeEnd() {
    window.removeEventListener("mousemove", handleResizeMove);
    window.removeEventListener("mouseup", handleResizeEnd);
    if (!resizing.current) return;
    resizing.current = null;
    setColumns((cur) => { persistLayout(cur, hidden); return cur; });
  }

  // -- Show/hide columns --
  function toggleColumn(key: string) {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    setHidden(next);
    persistLayout(columns, next);
  }

  async function restoreDefaults() {
    try {
      // Sending an empty order/widths tells the backend to fall back to its
      // own DEFAULT_SHEET_COLUMNS (route_planner.py) - the single source of
      // truth for the default layout, so this never has to duplicate it.
      const layout = await api.put("/route-plan/sheet-layout", { column_order: [], hidden_columns: [], column_widths: {} });
      setColumns(layout.columns.map((c: any) => ({ key: c.key, label: c.label, width: c.width })));
      setHidden(new Set<string>(layout.hidden_columns));
    } catch (e: any) { setError(e.message); }
  }

  function downloadExcel() { window.open("/api/route-plan/export/excel?plan_role=combined", "_blank"); }

  return (
    <div>
      <div className="glass-card" style={{ marginBottom: 20, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <strong>Route Plan Sheet</strong>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          Combines the current Driver and Helper Route Plans into one operational view. Drag the ⠿ handle to reorder rows,
          drag column headers to rearrange them, drag a header's right edge to resize - everything saves automatically.
        </span>
        <button className="btn" onClick={load} disabled={loading}>{loading ? "Loading..." : "Refresh"}</button>
        <div style={{ position: "relative" }}>
          <button className="btn" style={{ background: "var(--navy3)", color: "var(--muted)" }} onClick={() => setShowColumnPanel((s) => !s)}>
            Columns
          </button>
          {showColumnPanel && (
            <div className="glass-card" style={{
              // DROPDOWN AUDIT: z-index raised 50 -> 9999 to match the
              // app-wide convention (MultiSelectSlicer/AutocompleteInput) -
              // low z-index dropdowns render behind neighboring glass
              // panels depending on stacking context.
              position: "absolute", top: "110%", left: 0, zIndex: 9999, minWidth: 220,
              maxHeight: 320, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 6,
            }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Show / hide columns</div>
              {columns.map((c) => (
                <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggleColumn(c.key)} />
                  {c.label}
                </label>
              ))}
              <button className="btn" style={{ marginTop: 8, background: "var(--navy3)", color: "var(--muted)" }} onClick={restoreDefaults}>
                Restore Default Layout
              </button>
            </div>
          )}
        </div>
        <button className="btn" style={{ background: "var(--teal)" }} onClick={downloadExcel}>Download Excel</button>
        <button className="btn" style={{ background: "var(--navy3)", color: "var(--muted)" }} onClick={() => window.print()}>Print</button>
      </div>

      {error && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{error}</div>}

      {rows.length === 0 ? (
        <div className="glass-card" style={{ color: "var(--muted)" }}>
          No Route Plan generated yet - generate a Driver or Helper Route Plan first, and it'll appear here automatically.
        </div>
      ) : (
        <div className="glass-card" style={{ overflowX: "auto" }} onClick={() => showColumnPanel && setShowColumnPanel(false)}>
          <table className="data-table" style={{ tableLayout: "fixed", width: "100%", minWidth: 1300 }}>
            <colgroup>
              <col style={{ width: "32px" }} />
              {visibleColumns.map((c) => <col key={c.key} style={{ width: `${c.width}px` }} />)}
            </colgroup>
            <thead>
              <tr>
                <th></th>
                {visibleColumns.map((c) => (
                  <th key={c.key}
                      draggable
                      onDragStart={() => handleColDragStart(c.key)}
                      onDragOver={handleColDragOver}
                      onDrop={() => handleColDrop(c.key)}
                      style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "grab", position: "relative", userSelect: "none" }}>
                    {c.label}
                    <span
                      onMouseDown={(e) => handleResizeStart(e, c.key)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 6, cursor: "col-resize" }}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                // Same key fix as the Candidate Review cards above - area_code
                // alone isn't unique across Divisions.
                <tr key={`${r.area_code}-${r.sector}`} draggable onDragStart={() => handleRowDragStart(i)} onDragOver={handleRowDragOver} onDrop={() => handleRowDrop(i)}>
                  <td style={{ cursor: "grab", textAlign: "center", color: "var(--muted)" }}>⠿</td>
                  {visibleColumns.map((c) => (
                    <td key={c.key} style={c.key === "assignment_reason"
                      ? { whiteSpace: "normal", wordBreak: "break-word", fontSize: 12, color: "var(--muted)" }
                      : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: c.key === "score" ? "center" : undefined }}>
                      {CELL_RENDERERS[c.key] ? CELL_RENDERERS[c.key](r) : (r as any)[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function RoutePlanner({ initialTab = "candidates" }: { initialTab?: string }) {
  const [tab] = useState(initialTab);
  const [syncDate, setSyncDate] = useState<string | null>(null);
  const [sheetRefreshToken, setSheetRefreshToken] = useState(0);
  const bumpSheet = () => setSheetRefreshToken((t) => t + 1);

  // NAV REDESIGN: Candidate Review/Driver Route Plan/Helper Route Plan/
  // Route Plan Sheet used to switch via an internal DashboardTabs bar
  // inside this component. They're now four separate top-level entries
  // in the persistent Route Planning toolbar (see RoutePlanningToolbar.tsx
  // and DriverRoutePlan.tsx/HelperRoutePlan.tsx/RoutePlanSheet.tsx, each
  // a thin wrapper passing a different `initialTab`) - having both that
  // toolbar AND this component's own internal tab row switching between
  // the same four things was exactly the confusing double-navigation
  // layer being fixed. `tab` is still driven by the `initialTab` prop
  // (React Router remounts this component fresh on each of those
  // routes, since they're distinct <Route> entries), so all the
  // existing per-tab logic/state below is unchanged.
  return (
    <div className="page">
      {tab === "candidates" && <CandidateReviewPanel syncDate={syncDate} />}
      {tab === "driver" && <PersistedPlanPanel role="driver" onGenerated={setSyncDate} onDataChanged={bumpSheet} />}
      {tab === "helper" && <PersistedPlanPanel role="helper" onGenerated={setSyncDate} onDataChanged={bumpSheet} />}
      {tab === "sheet" && <CombinedSheetPanel refreshToken={sheetRefreshToken} />}
    </div>
  );
}
