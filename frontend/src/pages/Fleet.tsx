import { useEffect, useState, FormEvent, ReactNode } from "react";
import { api, getRole } from "../api/client";
import DashboardTabs from "../components/DashboardTabs";
import TableImportExport from "../components/TableImportExport";
import AutocompleteInput from "../components/AutocompleteInput";
import AreaGroupMultiSelect from "../components/AreaGroupMultiSelect";

const TABS = [
  { key: "drivers", label: "Drivers" },
  { key: "helpers", label: "Helpers" },
  { key: "vehicles", label: "Vehicles" },
  { key: "areas", label: "Areas" },
  { key: "area-groups", label: "Area Groups" },
];

const VEH_TYPES = ["VAN", "PICK-UP", "BUS", "2-8 VAN", "2-8 PICK-UP"];

interface MetaOptions {
  vehicle_types: string[];
  divisions: string[];
  division_restrictions: string[];
  requirement_levels: string[];
  route_types: string[];
}

export default function Fleet() {
  const [tab, setTab] = useState("drivers");
  const [helperOptions, setHelperOptions] = useState<{ code: string; name: string }[]>([]);
  const [meta, setMeta] = useState<MetaOptions>({
    vehicle_types: ["Pick-Up", "Van", "2-8 Van", "2-8 Pick-Up", "Bus"],
    divisions: ["Pharma", "Consumer"],
    division_restrictions: ["", "Pharma", "Consumer", "Both"],
    requirement_levels: ["Mandatory", "Optional"],
    route_types: ["Main Route", "Second Trip", "Urgent & Government", "Fleet"],
  });

  useEffect(() => {
    api.get("/helpers").then((rows) => setHelperOptions(rows.map((h: any) => ({ code: h.code, name: h.name })))).catch(() => {});
    api.get("/meta/options").then(setMeta).catch(() => {}); // falls back to the defaults above if this endpoint isn't reachable yet
  }, [tab]);

  return (
    <div className="page">
      <h2 style={{ marginBottom: 20 }}>Fleet Database</h2>
      <DashboardTabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === "drivers" && <DriversPanel helperOptions={helperOptions} />}
      {tab === "helpers" && <HelpersPanel />}
      {tab === "vehicles" && <VehiclesPanel meta={meta} />}
      {tab === "areas" && <AreasPanel meta={meta} />}
      {tab === "area-groups" && <AreaGroupsPanel />}
    </div>
  );
}

function DivisionSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— None —</option>
      <option value="Pharma">Pharma</option>
      <option value="Consumer">Consumer</option>
    </select>
  );
}

// ---------------- Drivers ----------------
function DriversPanel({ helperOptions }: { helperOptions: { code: string; name: string }[] }) {
  interface Driver {
    id: number; code: string; name: string; veh_type: string; anchor_area: string;
    health_card: string; division: string; preferred_helper: string; status: string;
    anchored_areas: { id: number; code: string; name: string }[];
    anchored_groups: { id: number; name: string }[];
  }
  const empty = { code: "", name: "", veh_type: "", anchor_area: "", health_card: "No", division: "", preferred_helper: "", status: "Active" };
  const [rows, setRows] = useState<Driver[]>([]);
  const [form, setForm] = useState(empty);
  const [vehTypeSel, setVehTypeSel] = useState<string[]>([]);
  const [anchoredAreas, setAnchoredAreas] = useState<{ id: number; code: string; name: string }[]>([]);
  const [anchoredGroups, setAnchoredGroups] = useState<{ id: number; name: string }[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const canWrite = getRole() === "admin" || getRole() === "dispatcher";

  async function load() { try { setRows(await api.get("/drivers")); } catch (e: any) { setError(e.message); } }
  useEffect(() => { load(); }, []);

  function startEdit(d: Driver) {
    setEditingId(d.id);
    setForm({ code: d.code, name: d.name, veh_type: d.veh_type, anchor_area: d.anchor_area,
              health_card: d.health_card, division: d.division, preferred_helper: d.preferred_helper, status: d.status });
    setVehTypeSel(d.veh_type ? d.veh_type.split(" / ").map((s) => s.trim()) : []);
    setAnchoredAreas(d.anchored_areas || []);
    setAnchoredGroups(d.anchored_groups || []);
  }
  function cancelEdit() { setEditingId(null); setForm(empty); setVehTypeSel([]); setAnchoredAreas([]); setAnchoredGroups([]); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError("");
    const payload = {
      ...form, veh_type: vehTypeSel.join(" / "),
      anchored_area_ids: anchoredAreas.map((a) => a.id),
      anchored_area_group_ids: anchoredGroups.map((g) => g.id),
    };
    try {
      if (editingId) await api.put(`/drivers/${editingId}`, payload);
      else await api.post("/drivers", payload);
      cancelEdit(); load();
    } catch (e: any) { setError(e.message); }
  }
  async function handleDelete(id: number) {
    try { await api.del(`/drivers/${id}`); load(); } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <TableImportExport endpointPrefix="/drivers" onImported={load} canWrite={canWrite} />
      </div>
      {canWrite && (
        <form className="glass-card" onSubmit={handleSubmit} style={{ marginBottom: 20, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Code"><input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={!!editingId} /></Field>
          <Field label="Name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Vehicle Type(s) - optional">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", maxWidth: 240 }}>
              {VEH_TYPES.map((vt) => (
                <label key={vt} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={vehTypeSel.includes(vt)}
                    onChange={(e) => setVehTypeSel(e.target.checked ? [...vehTypeSel, vt] : vehTypeSel.filter((v) => v !== vt))}
                  />
                  {vt}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Anchored Areas - search Area/Group, drag to reorder, optional">
            <AreaGroupMultiSelect
              selectedAreas={anchoredAreas} selectedGroups={anchoredGroups}
              onChange={(a, g) => { setAnchoredAreas(a); setAnchoredGroups(g); }}
              emptyHint="No Anchored Areas - can be assigned anywhere"
            />
          </Field>
          <Field label="Legacy Anchor Area (free text - only needed for bulk Excel import)">
            <AutocompleteInput field="area_name" value={form.anchor_area} onChange={(v) => setForm({ ...form, anchor_area: v })} placeholder="e.g. JA, MIRDIF" />
          </Field>
          <Field label="Division - optional"><DivisionSelect value={form.division} onChange={(v) => setForm({ ...form, division: v })} /></Field>
          <Field label="Health Card">
            <select value={form.health_card} onChange={(e) => setForm({ ...form, health_card: e.target.value })}>
              <option>No</option><option>Yes</option>
            </select>
          </Field>
          <Field label="Preferred Helper - optional">
            <select value={form.preferred_helper} onChange={(e) => setForm({ ...form, preferred_helper: e.target.value })}>
              <option value="">— None —</option>
              {helperOptions.map((h) => <option key={h.code} value={h.code}>{h.name} ({h.code})</option>)}
            </select>
          </Field>
          <button className="btn" type="submit">{editingId ? "Save Changes" : "Add Driver"}</button>
          {editingId && <button type="button" className="btn" style={{ background: "var(--navy3)", color: "var(--muted)" }} onClick={cancelEdit}>Cancel</button>}
        </form>
      )}
      {error && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{error}</div>}
      <div className="glass-card table-scroll">
        <table className="data-table">
          <thead><tr><th>Code</th><th>Name</th><th>Vehicle(s)</th><th>Anchored Areas</th><th>Division</th><th>HC</th><th>Pref. Helper</th><th>Status</th>{canWrite && <th></th>}</tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>{d.code}</td><td>{d.name}</td><td>{d.veh_type || "—"}</td>
                <td>
                  {(d.anchored_groups?.length || d.anchored_areas?.length)
                    ? [...(d.anchored_groups || []).map((g) => `📁 ${g.name}`), ...(d.anchored_areas || []).map((a) => a.code)].join(", ")
                    : (d.anchor_area || "—")}
                </td>
                <td>{d.division || "—"}</td><td>{d.health_card}</td>
                <td>{d.preferred_helper || "—"}</td><td>{d.status}</td>
                {canWrite && <td style={{ display: "flex", gap: 6 }}>
                  <button className="btn" onClick={() => startEdit(d)}>Edit</button>
                  <button className="btn" style={{ background: "var(--red)" }} onClick={() => handleDelete(d.id)}>Delete</button>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- Helpers ----------------
function HelpersPanel() {
  interface Helper { id: number; code: string; name: string; anchor_area: string; health_card: string; division: string; status: string; }
  const empty = { code: "", name: "", anchor_area: "", health_card: "No", division: "", status: "Active" };
  const [rows, setRows] = useState<Helper[]>([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const canWrite = getRole() === "admin" || getRole() === "dispatcher";
  const anchorAreaOptions = Array.from(new Set(rows.map((r) => r.anchor_area).filter(Boolean)));

  async function load() { try { setRows(await api.get("/helpers")); } catch (e: any) { setError(e.message); } }
  useEffect(() => { load(); }, []);

  function startEdit(h: Helper) { setEditingId(h.id); setForm({ code: h.code, name: h.name, anchor_area: h.anchor_area, health_card: h.health_card, division: h.division, status: h.status }); }
  function cancelEdit() { setEditingId(null); setForm(empty); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError("");
    try {
      if (editingId) await api.put(`/helpers/${editingId}`, form);
      else await api.post("/helpers", form);
      cancelEdit(); load();
    } catch (e: any) { setError(e.message); }
  }
  async function handleDelete(id: number) {
    try { await api.del(`/helpers/${id}`); load(); } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <TableImportExport endpointPrefix="/helpers" onImported={load} canWrite={canWrite} />
      </div>
      {canWrite && (
        <form className="glass-card" onSubmit={handleSubmit} style={{ marginBottom: 20, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Code"><input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={!!editingId} /></Field>
          <Field label="Name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Anchor Area(s) - optional">
            <input list="helper-anchor-areas" value={form.anchor_area} onChange={(e) => setForm({ ...form, anchor_area: e.target.value })} />
            <datalist id="helper-anchor-areas">{anchorAreaOptions.map((a) => <option key={a} value={a} />)}</datalist>
          </Field>
          <Field label="Division - optional"><DivisionSelect value={form.division} onChange={(v) => setForm({ ...form, division: v })} /></Field>
          <Field label="Health Card">
            <select value={form.health_card} onChange={(e) => setForm({ ...form, health_card: e.target.value })}>
              <option>No</option><option>Yes</option>
            </select>
          </Field>
          <button className="btn" type="submit">{editingId ? "Save Changes" : "Add Helper"}</button>
          {editingId && <button type="button" className="btn" style={{ background: "var(--navy3)", color: "var(--muted)" }} onClick={cancelEdit}>Cancel</button>}
        </form>
      )}
      {error && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{error}</div>}
      <div className="glass-card table-scroll">
        <table className="data-table">
          <thead><tr><th>Code</th><th>Name</th><th>Anchor Area</th><th>Division</th><th>HC</th><th>Status</th>{canWrite && <th></th>}</tr></thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.id}>
                <td>{h.code}</td><td>{h.name}</td><td>{h.anchor_area || "—"}</td>
                <td>{h.division || "—"}</td><td>{h.health_card}</td><td>{h.status}</td>
                {canWrite && <td style={{ display: "flex", gap: 6 }}>
                  <button className="btn" onClick={() => startEdit(h)}>Edit</button>
                  <button className="btn" style={{ background: "var(--red)" }} onClick={() => handleDelete(h.id)}>Delete</button>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- Vehicles ----------------
interface AreaRef { id: number; code: string; name: string; sector?: string }

function AreaMultiPicker({ selected, onChange }: {
  selected: AreaRef[]; onChange: (v: AreaRef[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AreaRef[]>([]);

  useEffect(() => {
    if (!query.trim()) { setSuggestions([]); return; }
    const handle = setTimeout(() => {
      api.get(`/areas/search?q=${encodeURIComponent(query)}`).then(setSuggestions).catch(() => {});
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  function addArea(a: AreaRef) {
    if (!selected.some((s) => s.id === a.id)) onChange([...selected, a]);
    setQuery(""); setSuggestions([]);
  }
  function removeArea(id: number) { onChange(selected.filter((s) => s.id !== id)); }

  return (
    <div style={{ position: "relative", minWidth: 260 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
        {selected.map((a) => (
          <span key={a.id} className="badge" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {a.code} - {a.name}
            <button type="button" onClick={() => removeArea(a.id)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, fontWeight: 700 }}>×</button>
          </span>
        ))}
        {selected.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>No restriction - usable in any Area</span>}
      </div>
      <input placeholder="Search Area code or name…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {suggestions.length > 0 && (
        <div className="glass-card" style={{ position: "absolute", zIndex: 9999, marginTop: 4, padding: 4, maxHeight: 180, overflowY: "auto" }}>
          {suggestions.map((a) => (
            <div key={a.id} onClick={() => addArea(a)} style={{ padding: "4px 8px", cursor: "pointer", fontSize: 13 }}>
              {a.code} — {a.name} ({a.sector})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VehiclesPanel({ meta }: { meta: MetaOptions }) {
  interface Vehicle {
    id: number; number: string; type: string; division: string; status: string;
    permitted_areas: AreaRef[]; permitted_area_groups: { id: number; name: string }[];
  }
  const empty = { number: "", type: meta.vehicle_types[0] || "Van", division: "", status: "Active" };
  const [rows, setRows] = useState<Vehicle[]>([]);
  const [form, setForm] = useState(empty);
  const [permittedAreas, setPermittedAreas] = useState<AreaRef[]>([]);
  const [permittedGroups, setPermittedGroups] = useState<{ id: number; name: string }[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const canWrite = getRole() === "admin" || getRole() === "dispatcher";

  async function load() { try { setRows(await api.get("/vehicles")); } catch (e: any) { setError(e.message); } }
  useEffect(() => { load(); }, []);

  function startEdit(v: Vehicle) {
    setEditingId(v.id);
    setForm({ number: v.number, type: v.type, division: v.division, status: v.status });
    setPermittedAreas(v.permitted_areas || []);
    setPermittedGroups(v.permitted_area_groups || []);
  }
  function cancelEdit() { setEditingId(null); setForm(empty); setPermittedAreas([]); setPermittedGroups([]); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError("");
    const payload = {
      ...form,
      permitted_area_ids: permittedAreas.map((a) => a.id),
      permitted_area_group_ids: permittedGroups.map((g) => g.id),
    };
    try {
      if (editingId) await api.put(`/vehicles/${editingId}`, payload);
      else await api.post("/vehicles", payload);
      cancelEdit(); load();
    } catch (e: any) { setError(e.message); }
  }
  async function handleDelete(id: number) {
    try { await api.del(`/vehicles/${id}`); load(); } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <TableImportExport endpointPrefix="/vehicles" onImported={load} canWrite={canWrite} />
      </div>
      {canWrite && (
        <form className="glass-card" onSubmit={handleSubmit} style={{ marginBottom: 20, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Vehicle Number"><input required value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} disabled={!!editingId} /></Field>
          <Field label="Type">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {meta.vehicle_types.map((vt) => <option key={vt}>{vt}</option>)}
            </select>
          </Field>
          <Field label="Division Restriction (optional)">
            <select value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })}>
              {meta.division_restrictions.map((d) => <option key={d} value={d}>{d || "— None (any division) —"}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option>Active</option><option>Under Service</option>
            </select>
          </Field>
          <Field label="Permitted Areas (search Area/Group, drag to reorder - blank = no restriction)">
            <AreaGroupMultiSelect
              selectedAreas={permittedAreas} selectedGroups={permittedGroups}
              onChange={(a, g) => { setPermittedAreas(a); setPermittedGroups(g); }}
              emptyHint="No restriction - usable in any Area"
            />
          </Field>
          <button className="btn" type="submit">{editingId ? "Save Changes" : "Add Vehicle"}</button>
          {editingId && <button type="button" className="btn" style={{ background: "var(--navy3)", color: "var(--muted)" }} onClick={cancelEdit}>Cancel</button>}
        </form>
      )}
      {error && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{error}</div>}
      <div className="glass-card table-scroll">
        <table className="data-table">
          <thead><tr><th>Number</th><th>Type</th><th>Division Restriction</th><th>Status</th><th>Permitted Areas</th>{canWrite && <th></th>}</tr></thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td>{v.number}</td><td>{v.type}</td><td>{v.division || "Any"}</td><td>{v.status}</td>
                <td>
                  {(v.permitted_area_groups?.length || v.permitted_areas?.length)
                    ? [...(v.permitted_area_groups || []).map((g) => `📁 ${g.name}`), ...(v.permitted_areas || []).map((a) => a.code)].join(", ")
                    : "Any"}
                </td>
                {canWrite && <td style={{ display: "flex", gap: 6 }}>
                  <button className="btn" onClick={() => startEdit(v)}>Edit</button>
                  <button className="btn" style={{ background: "var(--red)" }} onClick={() => handleDelete(v.id)}>Delete</button>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- Areas ----------------
interface AnchoredVehicleRef { id: number; number: string; type: string }

function AnchoredVehiclePicker({ selected, onChange }: {
  selected: AnchoredVehicleRef[]; onChange: (v: AnchoredVehicleRef[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AnchoredVehicleRef[]>([]);

  useEffect(() => {
    if (!query.trim()) { setSuggestions([]); return; }
    const handle = setTimeout(() => {
      api.get(`/vehicles/search?q=${encodeURIComponent(query)}`).then(setSuggestions).catch(() => {});
    }, 200); // debounced predictive autocomplete against the Vehicle Database
    return () => clearTimeout(handle);
  }, [query]);

  function addVehicle(v: AnchoredVehicleRef) {
    if (!selected.some((s) => s.id === v.id)) onChange([...selected, v]);
    setQuery("");
    setSuggestions([]);
  }
  function removeVehicle(id: number) {
    onChange(selected.filter((s) => s.id !== id));
  }

  return (
    <div style={{ position: "relative", minWidth: 220 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
        {selected.map((v) => (
          <span key={v.id} className="badge" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {v.number} ({v.type})
            <button type="button" onClick={() => removeVehicle(v.id)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, fontWeight: 700 }}>
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        placeholder="Type a vehicle number…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {suggestions.length > 0 && (
        <div className="glass-card" style={{ position: "absolute", zIndex: 9999, marginTop: 4, padding: 4, maxHeight: 180, overflowY: "auto" }}>
          {suggestions.map((v) => (
            <div key={v.id} onClick={() => addVehicle(v)}
              style={{ padding: "4px 8px", cursor: "pointer", fontSize: 13 }}>
              {v.number} — {v.type}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AreasPanel({ meta }: { meta: MetaOptions }) {
  interface Area {
    id: number; code: string; name: string; sector: string;
    needs_driver: string; needs_helper: string; route_type: string; vehicle_type: string;
    anchored_vehicles: AnchoredVehicleRef[];
  }
  const empty = {
    code: "", name: "", sector: meta.divisions[0] || "Pharma",
    needs_driver: "Mandatory", needs_helper: "Optional",
    route_type: meta.route_types[0] || "Main Route", vehicle_type: meta.vehicle_types[0] || "Van",
  };
  const [rows, setRows] = useState<Area[]>([]);
  const [form, setForm] = useState(empty);
  const [anchoredVehicles, setAnchoredVehicles] = useState<AnchoredVehicleRef[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const canWrite = getRole() === "admin" || getRole() === "dispatcher";

  async function load() { try { setRows(await api.get("/areas")); } catch (e: any) { setError(e.message); } }
  useEffect(() => { load(); }, []);

  function startEdit(a: Area) {
    setEditingId(a.id);
    setForm({
      code: a.code, name: a.name, sector: a.sector,
      needs_driver: a.needs_driver, needs_helper: a.needs_helper,
      route_type: a.route_type, vehicle_type: a.vehicle_type,
    });
    setAnchoredVehicles(a.anchored_vehicles || []);
  }
  function cancelEdit() { setEditingId(null); setForm(empty); setAnchoredVehicles([]); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError("");
    const payload = { ...form, anchored_vehicle_ids: anchoredVehicles.map((v) => v.id) };
    try {
      if (editingId) await api.put(`/areas/${editingId}`, payload);
      else await api.post("/areas", payload);
      cancelEdit(); load();
    } catch (e: any) { setError(e.message); }
  }
  async function handleDelete(id: number) {
    try { await api.del(`/areas/${id}`); load(); } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <TableImportExport endpointPrefix="/areas" onImported={load} canWrite={canWrite} />
      </div>
      {canWrite && (
        <form className="glass-card" onSubmit={handleSubmit} style={{ marginBottom: 20, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Area Code"><AutocompleteInput field="area_code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} /></Field>
          <Field label="Area Name"><AutocompleteInput field="area_name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} /></Field>
          <Field label="Division">
            <select value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })}>
              {meta.divisions.map((d) => <option key={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Driver Requirement">
            <select value={form.needs_driver} onChange={(e) => setForm({ ...form, needs_driver: e.target.value })}>
              {meta.requirement_levels.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Helper Requirement">
            <select value={form.needs_helper} onChange={(e) => setForm({ ...form, needs_helper: e.target.value })}>
              {meta.requirement_levels.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Vehicle Type">
            <select value={form.vehicle_type} onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })}>
              {meta.vehicle_types.map((vt) => <option key={vt}>{vt}</option>)}
            </select>
          </Field>
          <Field label="Route Type">
            <select value={form.route_type} onChange={(e) => setForm({ ...form, route_type: e.target.value })}
              title="Main Route is covered first if there's a driver/vehicle shortage">
              {meta.route_types.map((rt) => <option key={rt}>{rt}</option>)}
            </select>
          </Field>
          <Field label="Anchored Vehicle(s) - the normal assigned vehicle(s) for this area">
            <AnchoredVehiclePicker selected={anchoredVehicles} onChange={setAnchoredVehicles} />
          </Field>
          <button className="btn" type="submit">{editingId ? "Save Changes" : "Add Area"}</button>
          {editingId && <button type="button" className="btn" style={{ background: "var(--navy3)", color: "var(--muted)" }} onClick={cancelEdit}>Cancel</button>}
        </form>
      )}
      {error && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{error}</div>}
      <div className="glass-card table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th><th>Name</th><th>Division</th><th>Driver Req.</th><th>Helper Req.</th>
              <th>Vehicle Type</th><th>Anchored Vehicle(s)</th><th>Route Type</th>{canWrite && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>{a.code}</td><td>{a.name}</td><td>{a.sector}</td>
                <td><span className={"badge " + (a.needs_driver === "Mandatory" ? "ok" : "")}>{a.needs_driver}</span></td>
                <td><span className={"badge " + (a.needs_helper === "Mandatory" ? "ok" : "")}>{a.needs_helper}</span></td>
                <td>{a.vehicle_type}</td>
                <td>{a.anchored_vehicles?.length ? a.anchored_vehicles.map((v) => v.number).join(", ") : "—"}</td>
                <td><span className={"badge " + (a.route_type === "Main Route" ? "ok" : "")}>{a.route_type}</span></td>
                {canWrite && <td style={{ display: "flex", gap: 6 }}>
                  <button className="btn" onClick={() => startEdit(a)}>Edit</button>
                  <button className="btn" style={{ background: "var(--red)" }} onClick={() => handleDelete(a.id)}>Delete</button>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{label}</label>
      {children}
    </div>
  );
}

// ---------------- Area Groups ----------------
function AreaGroupsPanel() {
  interface AreaGroup { id: number; name: string; areas: AreaRef[] }
  const empty = { name: "" };
  const [rows, setRows] = useState<AreaGroup[]>([]);
  const [form, setForm] = useState(empty);
  const [memberAreas, setMemberAreas] = useState<AreaRef[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const canWrite = getRole() === "admin" || getRole() === "dispatcher";

  async function load() { try { setRows(await api.get("/area-groups")); } catch (e: any) { setError(e.message); } }
  useEffect(() => { load(); }, []);

  function startEdit(g: AreaGroup) {
    setEditingId(g.id);
    setForm({ name: g.name });
    setMemberAreas(g.areas || []);
  }
  function cancelEdit() { setEditingId(null); setForm(empty); setMemberAreas([]); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError("");
    const payload = { name: form.name, area_ids: memberAreas.map((a) => a.id) };
    try {
      if (editingId) await api.put(`/area-groups/${editingId}`, payload);
      else await api.post("/area-groups", payload);
      cancelEdit(); load();
    } catch (e: any) { setError(e.message); }
  }
  async function handleDelete(id: number) {
    if (!confirm("Delete this Area Group? Vehicles/Drivers referencing it will lose that group (their individual Areas, if any, are unaffected).")) return;
    try { await api.del(`/area-groups/${id}`); load(); } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      <div className="glass-card" style={{ marginBottom: 20, fontSize: 13, color: "var(--muted)" }}>
        Group multiple Areas under one logical name (e.g. "Dubai" containing Jabal Ali, Al Quoz, Mirdif…). Groups can then be
        selected as a single unit in Vehicle Permitted Areas and Driver Anchored Areas - editing a group here updates everywhere it's used.
      </div>
      {canWrite && (
        <form className="glass-card" onSubmit={handleSubmit} style={{ marginBottom: 20, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Group Name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Dubai" /></Field>
          <Field label="Areas in this Group">
            <AreaMultiPicker selected={memberAreas} onChange={setMemberAreas} />
          </Field>
          <button className="btn" type="submit">{editingId ? "Save Changes" : "Add Area Group"}</button>
          {editingId && <button type="button" className="btn" style={{ background: "var(--navy3)", color: "var(--muted)" }} onClick={cancelEdit}>Cancel</button>}
        </form>
      )}
      {error && <div className="glass-card error-text" style={{ marginBottom: 20 }}>{error}</div>}
      <div className="glass-card table-scroll">
        <table className="data-table">
          <thead><tr><th>Group Name</th><th>Areas</th>{canWrite && <th></th>}</tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id}>
                <td>{g.name}</td>
                <td>{g.areas?.length ? g.areas.map((a) => a.code).join(", ") : "—"}</td>
                {canWrite && <td style={{ display: "flex", gap: 6 }}>
                  <button className="btn" onClick={() => startEdit(g)}>Edit</button>
                  <button className="btn" style={{ background: "var(--red)" }} onClick={() => handleDelete(g.id)}>Delete</button>
                </td>}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={3} style={{ color: "var(--muted)" }}>No Area Groups yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
