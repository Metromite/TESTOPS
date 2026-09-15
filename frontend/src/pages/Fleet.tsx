import { useEffect, useState, FormEvent, ReactNode } from "react";
import { getRole } from "../api/client";
import { supabase } from "@/lib/supabase";
import { driversService } from "../services/drivers";
import { helpersService } from "../services/helpers";
import {
  vehiclesService,
  setPermittedAreas as setVehiclePermittedAreas,
  setPermittedAreaGroups as setVehiclePermittedAreaGroups,
  setAnchoredVehicles,
} from "../services/vehicles";
import {
  areasService,
  areaGroupsService,
  setAreaGroupMembers,
  setDriverAnchoredAreas,
  setDriverAnchoredAreaGroups,
} from "../services/areas";
import DashboardTabs from "../components/DashboardTabs";
import TableImportExport from "../components/TableImportExport";
import AutocompleteInput from "../components/AutocompleteInput";
import AreaGroupMultiSelect from "../components/AreaGroupMultiSelect";

// SUPABASE PORT of Fleet.tsx (was entirely backed by the old FastAPI
// `/drivers`, `/helpers`, `/vehicles`, `/areas`, `/area-groups` REST
// endpoints - see MIGRATION_STATUS.md). Every panel below now reads and
// writes Supabase directly through `src/services/*.ts`. Relations
// (anchored areas/groups, permitted areas/groups, anchored vehicles, group
// members) are fetched with Supabase's nested-select joins and written
// with the paired set*() helpers in those services, which replace-in-full
// (delete then insert) on every save - same effective behavior as the old
// backend's *_ids payload fields.
//
// ids are UUID strings now (Supabase `uuid` PKs), not the old integer
// autoincrement ids - every local interface below reflects that.

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

// No `/meta/options` backend endpoint exists anymore - these were always
// static business constants in the old app (not user-editable), so they're
// kept here as plain constants rather than fetched.
const META: MetaOptions = {
  vehicle_types: ["Pick-Up", "Van", "2-8 Van", "2-8 Pick-Up", "Bus"],
  divisions: ["Pharma", "Consumer"],
  division_restrictions: ["", "Pharma", "Consumer", "Both"],
  requirement_levels: ["Mandatory", "Optional"],
  route_types: ["Main Route", "Second Trip", "Urgent & Government", "Fleet"],
};

export default function Fleet() {
  const [tab, setTab] = useState("drivers");
  const [helperOptions, setHelperOptions] = useState<{ code: string; name: string }[]>([]);

  useEffect(() => {
    helpersService
      .list({ orderBy: "code" })
      .then((rows) => setHelperOptions(rows.map((h) => ({ code: h.code, name: h.name }))))
      .catch(() => {});
  }, [tab]);

  return (
    <div className="page">
      <h2 style={{ marginBottom: 20 }}>Fleet Database</h2>
      <DashboardTabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === "drivers" && <DriversPanel helperOptions={helperOptions} />}
      {tab === "helpers" && <HelpersPanel />}
      {tab === "vehicles" && <VehiclesPanel meta={META} />}
      {tab === "areas" && <AreasPanel meta={META} />}
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
interface AreaRef { id: string; code: string; name: string; sector?: string }
interface GroupRef { id: string; name: string }

interface DriverRow {
  id: string; code: string; name: string; veh_type: string; anchor_area: string;
  health_card: string; division: string; preferred_helper: string; status: string;
  anchored_areas: AreaRef[];
  anchored_groups: GroupRef[];
}

async function loadDrivers(): Promise<DriverRow[]> {
  const { data, error } = await supabase
    .from("drivers")
    .select(
      "*, driver_anchored_areas(sort_order, areas(id,code,name)), driver_anchored_area_groups(sort_order, area_groups(id,name))"
    )
    .order("code");
  if (error) throw new Error(error.message);
  return (data ?? []).map((d: any) => ({
    ...d,
    anchored_areas: (d.driver_anchored_areas ?? [])
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((r: any) => r.areas)
      .filter(Boolean),
    anchored_groups: (d.driver_anchored_area_groups ?? [])
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((r: any) => r.area_groups)
      .filter(Boolean),
  }));
}

function DriversPanel({ helperOptions }: { helperOptions: { code: string; name: string }[] }) {
  const empty = { code: "", name: "", veh_type: "", anchor_area: "", health_card: "No", division: "", preferred_helper: "", status: "Active" };
  const [rows, setRows] = useState<DriverRow[]>([]);
  const [form, setForm] = useState(empty);
  const [vehTypeSel, setVehTypeSel] = useState<string[]>([]);
  const [anchoredAreas, setAnchoredAreas] = useState<AreaRef[]>([]);
  const [anchoredGroups, setAnchoredGroups] = useState<GroupRef[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const canWrite = getRole() === "admin" || getRole() === "dispatcher";

  async function load() { try { setRows(await loadDrivers()); } catch (e: any) { setError(e.message); } }
  useEffect(() => { load(); }, []);

  function startEdit(d: DriverRow) {
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
    const payload = { ...form, veh_type: vehTypeSel.join(" / ") };
    try {
      const saved = editingId
        ? await driversService.update(editingId, payload)
        : await driversService.create(payload);
      await Promise.all([
        setDriverAnchoredAreas(saved.id, anchoredAreas.map((a) => a.id)),
        setDriverAnchoredAreaGroups(saved.id, anchoredGroups.map((g) => g.id)),
      ]);
      cancelEdit(); load();
    } catch (e: any) { setError(e.message); }
  }
  async function handleDelete(id: string) {
    try { await driversService.remove(id); load(); } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <TableImportExport table="drivers" naturalKey="code" onImported={load} canWrite={canWrite} />
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
  interface Helper { id: string; code: string; name: string; anchor_area: string; health_card: string; division: string; status: string; }
  const empty = { code: "", name: "", anchor_area: "", health_card: "No", division: "", status: "Active" };
  const [rows, setRows] = useState<Helper[]>([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const canWrite = getRole() === "admin" || getRole() === "dispatcher";
  const anchorAreaOptions = Array.from(new Set(rows.map((r) => r.anchor_area).filter(Boolean)));

  async function load() { try { setRows(await helpersService.list({ orderBy: "code" }) as Helper[]); } catch (e: any) { setError(e.message); } }
  useEffect(() => { load(); }, []);

  function startEdit(h: Helper) { setEditingId(h.id); setForm({ code: h.code, name: h.name, anchor_area: h.anchor_area, health_card: h.health_card, division: h.division, status: h.status }); }
  function cancelEdit() { setEditingId(null); setForm(empty); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError("");
    try {
      if (editingId) await helpersService.update(editingId, form);
      else await helpersService.create(form);
      cancelEdit(); load();
    } catch (e: any) { setError(e.message); }
  }
  async function handleDelete(id: string) {
    try { await helpersService.remove(id); load(); } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <TableImportExport table="helpers" naturalKey="code" onImported={load} canWrite={canWrite} />
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
function AreaMultiPicker({ selected, onChange }: {
  selected: AreaRef[]; onChange: (v: AreaRef[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AreaRef[]>([]);

  useEffect(() => {
    if (!query.trim()) { setSuggestions([]); return; }
    const handle = setTimeout(() => {
      supabase
        .from("areas")
        .select("id,code,name,sector")
        .or(`code.ilike.%${query}%,name.ilike.%${query}%`)
        .limit(10)
        .then(({ data, error }) => { if (!error) setSuggestions(data ?? []); });
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  function addArea(a: AreaRef) {
    if (!selected.some((s) => s.id === a.id)) onChange([...selected, a]);
    setQuery(""); setSuggestions([]);
  }
  function removeArea(id: string) { onChange(selected.filter((s) => s.id !== id)); }

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

interface VehicleRow {
  id: string; number: string; type: string; division: string; status: string;
  permitted_areas: AreaRef[]; permitted_area_groups: GroupRef[];
}

async function loadVehicles(): Promise<VehicleRow[]> {
  const { data, error } = await supabase
    .from("vehicles")
    .select("*, vehicle_permitted_areas(areas(id,code,name)), vehicle_permitted_area_groups(area_groups(id,name))")
    .order("number");
  if (error) throw new Error(error.message);
  return (data ?? []).map((v: any) => ({
    ...v,
    permitted_areas: (v.vehicle_permitted_areas ?? []).map((r: any) => r.areas).filter(Boolean),
    permitted_area_groups: (v.vehicle_permitted_area_groups ?? []).map((r: any) => r.area_groups).filter(Boolean),
  }));
}

function VehiclesPanel({ meta }: { meta: MetaOptions }) {
  const empty = { number: "", type: meta.vehicle_types[0] || "Van", division: "", status: "Active" };
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [form, setForm] = useState(empty);
  const [permittedAreas, setPermittedAreas] = useState<AreaRef[]>([]);
  const [permittedGroups, setPermittedGroups] = useState<GroupRef[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const canWrite = getRole() === "admin" || getRole() === "dispatcher";

  async function load() { try { setRows(await loadVehicles()); } catch (e: any) { setError(e.message); } }
  useEffect(() => { load(); }, []);

  function startEdit(v: VehicleRow) {
    setEditingId(v.id);
    setForm({ number: v.number, type: v.type, division: v.division, status: v.status });
    setPermittedAreas(v.permitted_areas || []);
    setPermittedGroups(v.permitted_area_groups || []);
  }
  function cancelEdit() { setEditingId(null); setForm(empty); setPermittedAreas([]); setPermittedGroups([]); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError("");
    try {
      const saved = editingId
        ? await vehiclesService.update(editingId, form)
        : await vehiclesService.create(form);
      await Promise.all([
        setVehiclePermittedAreas(saved.id, permittedAreas.map((a) => a.id)),
        setVehiclePermittedAreaGroups(saved.id, permittedGroups.map((g) => g.id)),
      ]);
      cancelEdit(); load();
    } catch (e: any) { setError(e.message); }
  }
  async function handleDelete(id: string) {
    try { await vehiclesService.remove(id); load(); } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <TableImportExport table="vehicles" naturalKey="number" onImported={load} canWrite={canWrite} />
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
interface AnchoredVehicleRef { id: string; number: string; type: string }

function AnchoredVehiclePicker({ selected, onChange }: {
  selected: AnchoredVehicleRef[]; onChange: (v: AnchoredVehicleRef[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AnchoredVehicleRef[]>([]);

  useEffect(() => {
    if (!query.trim()) { setSuggestions([]); return; }
    const handle = setTimeout(() => {
      supabase
        .from("vehicles")
        .select("id,number,type")
        .ilike("number", `%${query}%`)
        .limit(10)
        .then(({ data, error }) => { if (!error) setSuggestions(data ?? []); });
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  function addVehicle(v: AnchoredVehicleRef) {
    if (!selected.some((s) => s.id === v.id)) onChange([...selected, v]);
    setQuery("");
    setSuggestions([]);
  }
  function removeVehicle(id: string) {
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

interface AreaRow {
  id: string; code: string; name: string; sector: string;
  needs_driver: string; needs_helper: string; route_type: string; vehicle_type: string;
  anchored_vehicles: AnchoredVehicleRef[];
}

async function loadAreas(): Promise<AreaRow[]> {
  const { data, error } = await supabase
    .from("areas")
    .select("*, area_anchored_vehicles(vehicles(id,number,type))")
    .order("code");
  if (error) throw new Error(error.message);
  return (data ?? []).map((a: any) => ({
    ...a,
    anchored_vehicles: (a.area_anchored_vehicles ?? []).map((r: any) => r.vehicles).filter(Boolean),
  }));
}

function AreasPanel({ meta }: { meta: MetaOptions }) {
  const empty = {
    code: "", name: "", sector: meta.divisions[0] || "Pharma",
    needs_driver: "Mandatory", needs_helper: "Optional",
    route_type: meta.route_types[0] || "Main Route", vehicle_type: meta.vehicle_types[0] || "Van",
  };
  const [rows, setRows] = useState<AreaRow[]>([]);
  const [form, setForm] = useState(empty);
  const [anchoredVehicles, setAnchoredVehiclesSel] = useState<AnchoredVehicleRef[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const canWrite = getRole() === "admin" || getRole() === "dispatcher";

  async function load() { try { setRows(await loadAreas()); } catch (e: any) { setError(e.message); } }
  useEffect(() => { load(); }, []);

  function startEdit(a: AreaRow) {
    setEditingId(a.id);
    setForm({
      code: a.code, name: a.name, sector: a.sector,
      needs_driver: a.needs_driver, needs_helper: a.needs_helper,
      route_type: a.route_type, vehicle_type: a.vehicle_type,
    });
    setAnchoredVehiclesSel(a.anchored_vehicles || []);
  }
  function cancelEdit() { setEditingId(null); setForm(empty); setAnchoredVehiclesSel([]); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError("");
    try {
      const saved = editingId
        ? await areasService.update(editingId, form)
        : await areasService.create(form);
      await setAnchoredVehicles(saved.id, anchoredVehicles.map((v) => v.id));
      cancelEdit(); load();
    } catch (e: any) { setError(e.message); }
  }
  async function handleDelete(id: string) {
    try { await areasService.remove(id); load(); } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <TableImportExport table="areas" naturalKey="code" onImported={load} canWrite={canWrite} />
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
            <AnchoredVehiclePicker selected={anchoredVehicles} onChange={setAnchoredVehiclesSel} />
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
async function loadAreaGroups(): Promise<{ id: string; name: string; areas: AreaRef[] }[]> {
  const { data, error } = await supabase
    .from("area_groups")
    .select("*, area_group_members(areas(id,code,name))")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((g: any) => ({
    ...g,
    areas: (g.area_group_members ?? []).map((r: any) => r.areas).filter(Boolean),
  }));
}

function AreaGroupsPanel() {
  interface AreaGroup { id: string; name: string; areas: AreaRef[] }
  const empty = { name: "" };
  const [rows, setRows] = useState<AreaGroup[]>([]);
  const [form, setForm] = useState(empty);
  const [memberAreas, setMemberAreas] = useState<AreaRef[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const canWrite = getRole() === "admin" || getRole() === "dispatcher";

  async function load() { try { setRows(await loadAreaGroups()); } catch (e: any) { setError(e.message); } }
  useEffect(() => { load(); }, []);

  function startEdit(g: AreaGroup) {
    setEditingId(g.id);
    setForm({ name: g.name });
    setMemberAreas(g.areas || []);
  }
  function cancelEdit() { setEditingId(null); setForm(empty); setMemberAreas([]); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError("");
    try {
      const saved = editingId
        ? await areaGroupsService.update(editingId, form)
        : await areaGroupsService.create(form);
      await setAreaGroupMembers(saved.id, memberAreas.map((a) => a.id));
      cancelEdit(); load();
    } catch (e: any) { setError(e.message); }
  }
  async function handleDelete(id: string) {
    if (!confirm("Delete this Area Group? Vehicles/Drivers referencing it will lose that group (their individual Areas, if any, are unaffected).")) return;
    try { await areaGroupsService.remove(id); load(); } catch (e: any) { setError(e.message); }
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
