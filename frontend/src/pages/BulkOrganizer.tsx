import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays, CarFront, Check, ChevronLeft, ChevronRight, Database,
  GripVertical, Package, Plus, RefreshCw, Save, Search, ShieldCheck,
  Truck, X, Pencil, Trash2, Users, MapPin, CircleAlert, Bell, Settings2,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { GlassButton } from "../design-system/GlassButton";
import { GlassCard } from "../design-system/GlassCard";
import { GlassInput } from "../design-system/GlassInput";
import { GlassModal } from "../design-system/GlassModal";
import { IsoBuilding, IsoPallet, IsoVehicle } from "../components/BulkOrganizerIso";
import {
  loadBulkOrganizerPlan, saveBulkOrganizerPlan, type BulkOrganizerPlan,
  listDefaultVehicles, upsertDefaultVehicle, deleteDefaultVehicle, type BulkOrganizerDefaultVehicle,
  listDefaultCustomers, upsertDefaultCustomer, deleteDefaultCustomer, type BulkOrganizerDefaultCustomer,
} from "../services/bulkOrganizer";

const norm = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
const isPickup = (v: unknown) => { const n = norm(v); return n === "PICKUP" || n.includes("PICK UP"); };
const isVan = (v: unknown) => norm(v).includes("VAN");
const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const dayLabel = (date: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00`));
const weekdayOf = (date: string) => new Date(`${date}T12:00:00`).getDay(); // 0=Sun..6=Sat
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function defaultCapacity(type: string) { return isVan(type) ? 20 : isPickup(type) ? 10 : 10; }
function divisionFor(row: any) {
  const d = norm(row.division_desc);
  if (d.includes("PHARMA")) return "Pharma";
  if (d.includes("CONSUMER")) return "Consumer";
  return row.division_desc || "Unknown";
}

type CustomerPlan = { id: string; name: string; area: string; division: string; enabled: boolean; building_type?: "store" | "hospital" | "warehouse" };
type InvoicePlan = {
  id: string; invoice_no: string; customer_id: string; customer_name: string; area: string;
  division: string; pallets: number; invoice_date: string | null; scheduled_date: string;
  vehicle_id: string | null;
};
type VehiclePlanRow = { vehicle_id: string; capacity: number; driver_name?: string; helper_name?: string };
type PlanV2 = Omit<BulkOrganizerPlan, "vehicles"> & { vehicles: VehiclePlanRow[]; customers?: CustomerPlan[]; invoices?: InvoicePlan[]; pallet_assignments?: Record<string, string | null> };

const emptyInvoiceForm = { invoice_no: "", customer_id: "", customer_name: "", area: "", division: "", pallets: 1, invoice_date: "", schedule_date: "" };
const emptyCustomerForm = { name: "", area: "", division: "", building_type: "store" as const };
const emptyDefVehicleForm = { vehicle_id: "", capacity: 20, driver_name: "", helper_name: "" };
const emptyDefCustomerForm = { name: "", area: "", division: "", building_type: "store" as "store" | "hospital" | "warehouse", weekdays: [] as number[] };

export default function BulkOrganizer() {
  const [date, setDate] = useState(dateKey(new Date()));
  const [fleet, setFleet] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [facts, setFacts] = useState<any[]>([]);
  const [customerLibrary, setCustomerLibrary] = useState<string[]>([]);
  const [defaultVehicles, setDefaultVehicles] = useState<BulkOrganizerDefaultVehicle[]>([]);
  const [defaultCustomers, setDefaultCustomers] = useState<BulkOrganizerDefaultCustomer[]>([]);

  const [plan, setPlan] = useState<PlanV2>({ plan_date: date, vehicles: [], pallets: [], customers: [], invoices: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [dragged, setDragged] = useState<{ type: "invoice" | "pallet"; id: string } | null>(null);
  const [showFleet, setShowFleet] = useState(false);
  const [showCustomerManager, setShowCustomerManager] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showDefaultsModal, setShowDefaultsModal] = useState(false);
  const [defaultsTab, setDefaultsTab] = useState<"vehicles" | "customers">("vehicles");
  const [editingInvoice, setEditingInvoice] = useState<InvoicePlan | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({ ...emptyInvoiceForm, schedule_date: date });
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [defVehicleForm, setDefVehicleForm] = useState(emptyDefVehicleForm);
  const [defCustomerForm, setDefCustomerForm] = useState(emptyDefCustomerForm);

  async function loadSourceData(selectedDate: string) {
    setLoading(true); setError("");
    try {
      const [v, a, p, f, allCustomers, saved, defVeh, defCust] = await Promise.all([
        supabase.from("vehicles").select("id,number,type,division,status").order("number"),
        supabase.from("areas").select("id,code,name,sector,region,route_type,vehicle_type").order("code"),
        supabase.from("vehicle_permitted_areas").select("vehicle_id,area_id,areas(id,code,name)"),
        supabase.from("sap_invoice_facts").select("id,invoice_no,invoice_date,dispatch_date,customer_name,area,boxes,division_desc,vehicle_num,vehicle_type,salesman").or(`dispatch_date.eq.${selectedDate},invoice_date.eq.${selectedDate}`).order("customer_name"),
        supabase.from("sap_invoice_facts").select("customer_name").not("customer_name", "is", null).order("customer_name").limit(5000),
        loadBulkOrganizerPlan(selectedDate),
        listDefaultVehicles(),
        listDefaultCustomers(),
      ]);
      if (v.error) throw v.error; if (a.error) throw a.error; if (p.error) throw p.error; if (f.error) throw f.error;
      const active = (v.data ?? []).filter((x: any) => String(x.status ?? "Active").toLowerCase() !== "under service");
      setFleet(active); setAreas(a.data ?? []); setPermissions(p.data ?? []); setFacts(f.data ?? []);
      setCustomerLibrary(Array.from(new Set((allCustomers.data ?? []).map((x: any) => String(x.customer_name || "").trim()).filter(Boolean))));
      setDefaultVehicles(defVeh); setDefaultCustomers(defCust);

      // Seed for a day with no saved plan yet: use the admin-curated default
      // vehicle list (NOT "every active van/pickup") and the default
      // customers whose weekday schedule matches this date. Per-day
      // add/remove on top of this still goes through the saved plan below.
      const todaysWeekday = weekdayOf(selectedDate);
      const vehicleDefaults: VehiclePlanRow[] = defVeh
        .filter((dv) => active.some((x: any) => x.id === dv.vehicle_id))
        .map((dv) => ({ vehicle_id: dv.vehicle_id, capacity: dv.capacity, driver_name: dv.driver_name || "", helper_name: dv.helper_name || "" }));
      const customerDefaultsToday: CustomerPlan[] = defCust
        .filter((dc) => (dc.weekdays || []).includes(todaysWeekday))
        .map((dc) => ({ id: `default:${dc.id}`, name: dc.name, area: dc.area || "", division: dc.division || "Unknown", enabled: true, building_type: dc.building_type }));

      const old = (saved || {}) as PlanV2;
      const sourceInvoices: InvoicePlan[] = (f.data ?? []).map((r: any, i: number) => ({
        id: `${r.invoice_no || r.id || i}`,
        invoice_no: r.invoice_no || `INV-${i + 1}`,
        customer_id: `customer:${norm(r.customer_name || "unknown")}`,
        customer_name: r.customer_name || "Unknown customer",
        area: r.area || "", division: divisionFor(r), pallets: 1,
        invoice_date: r.invoice_date || null, scheduled_date: selectedDate, vehicle_id: null,
      }));
      const sourceCustomers: CustomerPlan[] = Array.from(new Map(sourceInvoices.map(i => [i.customer_id, { id: i.customer_id, name: i.customer_name, area: i.area, division: i.division, enabled: true }])).values());
      const savedInvoices = old.invoices?.length ? old.invoices : (old.pallets || []).map((p: any) => ({
        id: p.id, invoice_no: p.invoice_no, customer_id: `customer:${norm(p.customer_name)}`, customer_name: p.customer_name,
        area: p.area, division: p.division, pallets: Number(p.pallets || 1), invoice_date: p.invoice_date || null,
        scheduled_date: selectedDate, vehicle_id: p.vehicle_id || null,
      }));
      const merged = sourceInvoices.map(src => { const s = savedInvoices.find((x: any) => x.invoice_no === src.invoice_no); return s ? { ...src, ...s, customer_name: src.customer_name, area: src.area, division: src.division, pallets: src.pallets, invoice_date: src.invoice_date, scheduled_date: selectedDate } : src; });

      const customerMap = new Map<string, CustomerPlan>();
      // Priority (low to high): default customers scheduled today, then
      // customers derived from today's SAP invoices, then whatever the user
      // already saved for this specific day (their manual add/remove wins).
      [...customerDefaultsToday, ...sourceCustomers, ...(old.customers || [])].forEach(c => customerMap.set(norm(c.name), { ...customerMap.get(norm(c.name)), ...c }));
      merged.forEach(i => { const key = norm(i.customer_name); if (!customerMap.has(key)) customerMap.set(key, { id: i.customer_id, name: i.customer_name, area: i.area, division: i.division, enabled: true }); });

      const savedVehicles = (old.vehicles || []).filter((x: any) => active.some((v: any) => v.id === x.vehicle_id));
      const assignments: Record<string, string | null> = { ...(old.pallet_assignments || {}) };
      merged.forEach(i => { for (let k = 0; k < Math.max(1, i.pallets); k++) { const key = `${i.id}::${k}`; if (!(key in assignments)) assignments[key] = i.vehicle_id || null; } });
      setPlan({
        ...old, plan_date: selectedDate,
        vehicles: savedVehicles.length ? savedVehicles : vehicleDefaults,
        customers: Array.from(customerMap.values()),
        invoices: merged, pallets: merged as any, pallet_assignments: assignments,
      });
    } catch (e: any) { setError(e?.message || "Could not load Bulk Organizer data."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadSourceData(date); }, [date]);

  const vehicleMap = useMemo(() => new Map(fleet.map(v => [v.id, v])), [fleet]);
  const areaMap = useMemo(() => new Map(areas.map(a => [norm(a.name), a])), [areas]);
  const invoices = plan.invoices || [];
  const customers = plan.customers || [];
  const selectedVehicles = plan.vehicles || [];
  const visibleInvoices = invoices.filter(i => !search || [i.invoice_no, i.customer_name, i.area, i.division].some(v => norm(v).includes(norm(search))));
  const totalPallets = invoices.reduce((n, i) => n + Number(i.pallets || 0), 0);
  const assignments = plan.pallet_assignments || {};
  const loadedPallets = Object.values(assignments).filter(Boolean).length;
  const pendingPallets = Math.max(0, totalPallets - loadedPallets);
  const todaysWeekday = weekdayOf(date);

  // Notifications: default customers scheduled for this weekday, cross
  // referenced against whether an invoice already exists for them today.
  const notifications = useMemo(() => {
    return defaultCustomers
      .filter((dc) => (dc.weekdays || []).includes(todaysWeekday))
      .map((dc) => {
        const hasInvoice = invoices.some((i) => norm(i.customer_name) === norm(dc.name) && i.pallets > 0);
        return { id: dc.id, name: dc.name, area: dc.area, pending: !hasInvoice };
      });
  }, [defaultCustomers, todaysWeekday, invoices]);
  const pendingNotifications = notifications.filter(n => n.pending).length;
  const notifiedCustomerNames = useMemo(() => new Set(notifications.filter(n => n.pending).map(n => norm(n.name))), [notifications]);
  const buildingTypeByName = useMemo(() => new Map(defaultCustomers.map(dc => [norm(dc.name), dc.building_type])), [defaultCustomers]);

  function customerForInvoice(i: InvoicePlan) { return customers.find(c => c.id === i.customer_id); }
  function vehiclePermission(invoice: InvoicePlan, vehicle: any) {
    const area = areaMap.get(norm(invoice.area));
    if (!area) return { ok: true, text: "No mapped area" };
    const expectedType = norm(area.vehicle_type), actualType = norm(vehicle.type);
    const typeOk = !expectedType || actualType.includes(expectedType) || (isPickup(expectedType) && isPickup(actualType)) || (isVan(expectedType) && isVan(actualType));
    const divisionOk = !area.sector || !vehicle.division || norm(area.sector) === norm(vehicle.division);
    const rows = permissions.filter(x => x.vehicle_id === vehicle.id);
    const permitted = rows.length === 0 || rows.some(x => x.area_id === area.id);
    return { ok: typeOk && divisionOk && permitted, text: !typeOk ? `Type: ${area.vehicle_type}` : !divisionOk ? `Division: ${area.sector}` : !permitted ? "Area not permitted" : "Permitted" };
  }

  function assignInvoice(id: string, vehicleId: string | null) {
    setPlan(x => {
      const next = { ...(x.pallet_assignments || {}) };
      const inv = (x.invoices || []).find(i => i.id === id);
      if (inv) for (let k = 0; k < Math.max(1, inv.pallets); k++) next[`${id}::${k}`] = vehicleId;
      return { ...x, pallet_assignments: next, invoices: (x.invoices || []).map(i => i.id === id ? { ...i, vehicle_id: vehicleId } : i), pallets: (x.invoices || []).map(i => i.id === id ? { ...i, vehicle_id: vehicleId } : i) as any };
    });
  }
  function assignPallet(id: string, vehicleId: string | null) {
    setPlan(x => {
      const next = { ...(x.pallet_assignments || {}), [id]: vehicleId };
      const invoiceId = id.split("::")[0];
      const inv = (x.invoices || []).find(i => i.id === invoiceId);
      const allLoaded = inv ? Array.from({ length: Math.max(1, inv.pallets) }).every((_, k) => !!next[`${invoiceId}::${k}`]) : false;
      return { ...x, pallet_assignments: next, invoices: (x.invoices || []).map(i => i.id === invoiceId ? { ...i, vehicle_id: allLoaded ? vehicleId : null } : i), pallets: (x.invoices || []).map(i => i.id === invoiceId ? { ...i, vehicle_id: allLoaded ? vehicleId : null } : i) as any };
    });
  }
  function shiftDate(days: number) { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days); setDate(dateKey(d)); }
  async function save() { setSaving(true); setError(""); try { await saveBulkOrganizerPlan({ ...plan, pallets: invoices as any } as BulkOrganizerPlan); } catch (e: any) { setError(e?.message || "Save failed"); } finally { setSaving(false); } }
  function toggleVehicle(v: any) {
    setPlan(x => x.vehicles.some(z => z.vehicle_id === v.id)
      ? { ...x, vehicles: x.vehicles.filter(z => z.vehicle_id !== v.id), invoices: (x.invoices || []).map(i => i.vehicle_id === v.id ? { ...i, vehicle_id: null } : i), pallets: (x.invoices || []).map(i => i.vehicle_id === v.id ? { ...i, vehicle_id: null } : i) as any, pallet_assignments: Object.fromEntries(Object.entries(x.pallet_assignments || {}).map(([k, val]) => [k, val === v.id ? null : val])) }
      : { ...x, vehicles: [...x.vehicles, { vehicle_id: v.id, capacity: defaultCapacity(v.type), driver_name: "", helper_name: "" }] });
  }
  function updateVehicleField(vehicleId: string, field: "capacity" | "driver_name" | "helper_name", value: string | number) {
    setPlan(x => ({ ...x, vehicles: x.vehicles.map(z => z.vehicle_id === vehicleId ? { ...z, [field]: value } : z) }));
  }
  function addCustomer() {
    const name = customerForm.name.trim(); if (!name) return;
    const id = `manual:${crypto.randomUUID()}`;
    setPlan(x => ({ ...x, customers: [...(x.customers || []), { id, name, area: customerForm.area, division: customerForm.division || "Unknown", enabled: true, building_type: customerForm.building_type }] }));
    setCustomerForm(emptyCustomerForm);
  }
  function addInvoice() {
    const name = invoiceForm.customer_name.trim(); if (!invoiceForm.invoice_no.trim() || !name) return;
    const customer = customers.find(c => c.id === invoiceForm.customer_id) || customers.find(c => norm(c.name) === norm(name));
    const customerId = customer?.id || `manual:${crypto.randomUUID()}`;
    const newCustomer = customer ? [] : [{ id: customerId, name, area: invoiceForm.area, division: invoiceForm.division || "Unknown", enabled: true }];
    const inv: InvoicePlan = { id: `manual-invoice:${crypto.randomUUID()}`, invoice_no: invoiceForm.invoice_no.trim(), customer_id: customerId, customer_name: customer?.name || name, area: invoiceForm.area, division: invoiceForm.division || customer?.division || "Unknown", pallets: Math.max(1, Number(invoiceForm.pallets || 1)), invoice_date: invoiceForm.invoice_date || null, scheduled_date: invoiceForm.schedule_date || date, vehicle_id: null };
    setPlan(x => ({ ...x, customers: [...(x.customers || []), ...newCustomer], invoices: [...(x.invoices || []), inv], pallets: [...(x.invoices || []), inv] as any }));
    setInvoiceForm({ ...emptyInvoiceForm, schedule_date: date });
    setShowInvoiceModal(false);
  }
  function editInvoice(i: InvoicePlan) { setEditingInvoice(i); setInvoiceForm({ invoice_no: i.invoice_no, customer_id: i.customer_id, customer_name: i.customer_name, area: i.area, division: i.division, pallets: i.pallets, invoice_date: i.invoice_date || "", schedule_date: i.scheduled_date || date }); setShowInvoiceModal(true); }
  function updateInvoice() {
    if (!editingInvoice) return;
    setPlan(x => ({ ...x, invoices: (x.invoices || []).map(i => i.id === editingInvoice.id ? { ...i, invoice_no: invoiceForm.invoice_no, customer_name: invoiceForm.customer_name, area: invoiceForm.area, division: invoiceForm.division, pallets: Math.max(1, Number(invoiceForm.pallets || 1)), invoice_date: invoiceForm.invoice_date || null, scheduled_date: invoiceForm.schedule_date || date } : i), pallets: (x.invoices || []).map(i => i.id === editingInvoice.id ? { ...i, invoice_no: invoiceForm.invoice_no, customer_name: invoiceForm.customer_name, area: invoiceForm.area, division: invoiceForm.division, pallets: Math.max(1, Number(invoiceForm.pallets || 1)), invoice_date: invoiceForm.invoice_date || null, scheduled_date: invoiceForm.schedule_date || date } : i) as any }));
    setEditingInvoice(null); setInvoiceForm({ ...emptyInvoiceForm, schedule_date: date }); setShowInvoiceModal(false);
  }
  function removeCustomer(id: string) { setPlan(x => { const has = (x.invoices || []).some(i => i.customer_id === id); if (has) { setError("Move or remove this customer's invoices before removing the customer."); return x; } return { ...x, customers: (x.customers || []).filter(c => c.id !== id) }; }); }
  function deleteInvoice(id: string) { setPlan(x => { const next = { ...(x.pallet_assignments || {}) }; Object.keys(next).filter(k => k.startsWith(`${id}::`)).forEach(k => delete next[k]); return { ...x, invoices: (x.invoices || []).filter(i => i.id !== id), pallets: (x.invoices || []).filter(i => i.id !== id) as any, pallet_assignments: next }; }); }

  // -------- defaults manager (admin-curated "every day starts with this") --------
  async function saveDefaultVehicle() {
    if (!defVehicleForm.vehicle_id) return;
    try {
      const row = await upsertDefaultVehicle(defVehicleForm);
      setDefaultVehicles(x => { const rest = x.filter(v => v.vehicle_id !== row.vehicle_id); return [...rest, row].sort((a, b) => a.sort_order - b.sort_order); });
      setDefVehicleForm(emptyDefVehicleForm);
    } catch (e: any) { setError(e?.message || "Could not save default vehicle."); }
  }
  async function removeDefaultVehicle(id: string) {
    try { await deleteDefaultVehicle(id); setDefaultVehicles(x => x.filter(v => v.id !== id)); }
    catch (e: any) { setError(e?.message || "Could not remove default vehicle."); }
  }
  async function saveDefaultCustomer() {
    if (!defCustomerForm.name.trim()) return;
    try {
      const row = await upsertDefaultCustomer(defCustomerForm);
      setDefaultCustomers(x => { const rest = x.filter(c => norm(c.name) !== norm(row.name)); return [...rest, row].sort((a, b) => a.sort_order - b.sort_order); });
      setDefCustomerForm(emptyDefCustomerForm);
    } catch (e: any) { setError(e?.message || "Could not save default customer."); }
  }
  async function removeDefaultCustomer(id: string) {
    try { await deleteDefaultCustomer(id); setDefaultCustomers(x => x.filter(c => c.id !== id)); }
    catch (e: any) { setError(e?.message || "Could not remove default customer."); }
  }
  function toggleDefCustomerWeekday(day: number) {
    setDefCustomerForm(x => ({ ...x, weekdays: x.weekdays.includes(day) ? x.weekdays.filter(d => d !== day) : [...x.weekdays, day].sort() }));
  }

  if (loading) return <div className="page"><GlassCard style={{ padding: 28 }}>Loading Bulk Organizer…</GlassCard></div>;

  const customerCards = customers.filter(c => c.enabled);

  return <div className="page bulk-organizer-page" style={{ paddingBottom: 90 }}>
    <div className="glass-header" style={{ marginBottom: 14 }}>
      <div>
        <div className="muted small" style={{ display: "flex", gap: 6, alignItems: "center" }}><Package size={14} /> Daily pallet arrangement — game view</div>
        <h1 style={{ margin: "4px 0 0", fontSize: 30, fontWeight: 900 }}>Bulk Organizer</h1>
        <p className="muted" style={{ margin: "5px 0 0" }}>Buildings are customers, trucks are your fleet, crates are pallets. Drag a crate onto a truck to load it.</p>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <GlassButton variant="secondary" size="sm" onClick={() => void loadSourceData(date)}><RefreshCw size={14} /> Refresh Fleet/Data</GlassButton>
        <GlassButton variant="secondary" size="sm" onClick={() => setShowDefaultsModal(true)}><Settings2 size={14} /> Manage Defaults</GlassButton>
        <GlassButton size="sm" onClick={() => { setEditingInvoice(null); setInvoiceForm({ ...emptyInvoiceForm, schedule_date: date }); setShowInvoiceModal(true); }}><Plus size={14} /> Add Invoice</GlassButton>
        <GlassButton size="sm" onClick={() => void save()} disabled={saving}><Save size={14} /> {saving ? "Saving…" : "Save Day"}</GlassButton>
      </div>
    </div>
    {error && <GlassCard style={{ border: "1px solid rgba(239,68,68,.35)", marginBottom: 14, color: "#b91c1c" }}><CircleAlert size={15} style={{ verticalAlign: "-3px", marginRight: 6 }} />{error}</GlassCard>}

    <div className="glass-card bulk-date-bar" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center", marginBottom: 14 }}>
      <button className="btn" onClick={() => shiftDate(-1)} aria-label="Previous day"><ChevronLeft size={17} /></button>
      <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, fontWeight: 900, fontSize: 17 }}><CalendarDays size={18} /><span>{dayLabel(date)}</span><input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ maxWidth: 160 }} /></label>
      <button className="btn" onClick={() => shiftDate(1)} aria-label="Next day"><ChevronRight size={17} /></button>
    </div>

    <div className="glass-card bulk-stats" style={{ marginBottom: 14, display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
      <div><span className="muted small">Customers</span><strong>{customerCards.length}</strong></div>
      <div><span className="muted small">Invoices</span><strong>{invoices.length}</strong></div>
      <div><span className="muted small">Total pallets</span><strong>{totalPallets}</strong></div>
      <div><span className="muted small">Pending pallets</span><strong>{pendingPallets}</strong></div>
      <div><span className="muted small">Scheduled today</span><strong>{notifications.length}</strong></div>
    </div>

    <div className="bulk-layout-grid" style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 14, alignItems: "start" }}>
      <div>
        <section className="bulk-section">
          <div className="bulk-section-head"><div><h2>Vehicles</h2><div className="muted small">Default fleet comes from Manage Defaults. Add/remove for this date only below.</div></div><GlassButton variant="secondary" size="sm" onClick={() => setShowFleet(x => !x)}><Database size={14} /> {showFleet ? "Hide Fleet" : "Add / Remove Vehicles"}</GlassButton></div>
          {showFleet && <GlassCard style={{ marginBottom: 10 }}><div className="bulk-vehicle-picker">{fleet.map(v => { const on = selectedVehicles.some(x => x.vehicle_id === v.id); return <button key={v.id} className={`bulk-fleet-choice ${on ? "selected" : ""}`} onClick={() => toggleVehicle(v)}><span className="bulk-icon-circle">{isPickup(v.type) ? <Truck size={16} /> : <CarFront size={16} />}</span><span><strong>{v.number}</strong><small>{v.type} · {v.division || "No division"}</small></span>{on && <Check size={15} />}</button>; })}</div></GlassCard>}

          <div className="bulk-game-scene">
            <div className="bulk-game-row">
              {selectedVehicles.map(cfg => {
                const v = vehicleMap.get(cfg.vehicle_id); if (!v) return null;
                const itemIds = new Set(Object.entries(assignments).filter(([, val]) => val === v.id).map(([key]) => key.split("::")[0]));
                const items = invoices.filter(i => itemIds.has(i.id));
                const used = Object.values(assignments).filter(val => val === v.id).length;
                const free = Math.max(0, cfg.capacity - used);
                const pct = Math.min(100, used / Math.max(1, cfg.capacity) * 100);
                const permittedNames = permissions.filter(x => x.vehicle_id === v.id).map(x => x.areas?.code || x.areas?.name).filter(Boolean);
                return <div key={v.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <IsoVehicle
                    label={v.number} subtitle={v.type} driverName={cfg.driver_name} pct={pct} used={used} capacity={cfg.capacity}
                    empty={used === 0} isPickup={isPickup(v.type)}
                    onDrop={(e) => {
                      e.preventDefault();
                      const nativePallet = e.dataTransfer.getData("text/plain");
                      const activeDrag = dragged || (nativePallet ? { type: "pallet" as const, id: nativePallet } : null);
                      if (!activeDrag) return;
                      const inv = invoices.find(i => activeDrag.type === "invoice" ? i.id === activeDrag.id : activeDrag.id.startsWith(`${i.id}::`));
                      if (inv) {
                        const check = vehiclePermission(inv, v);
                        const adding = activeDrag.type === "pallet" ? 1 : Math.max(1, inv.pallets);
                        if (check.ok && used + adding <= cfg.capacity) { if (activeDrag.type === "invoice") assignInvoice(inv.id, v.id); else assignPallet(activeDrag.id, v.id); }
                        else setError(`${v.number}: ${check.text || `capacity exceeded (${free} free)`}`);
                      }
                      setDragged(null);
                    }}
                  />
                  <div className="bulk-permission" style={{ fontSize: 10.5 }}><ShieldCheck size={11} /><span>{permittedNames.length ? permittedNames.join(", ") : "Unrestricted"}</span></div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <input className="bulk-mini-input" style={{ width: 78, fontSize: 10.5 }} placeholder="Driver" value={cfg.driver_name || ""} onChange={e => updateVehicleField(v.id, "driver_name", e.target.value)} />
                    <input className="bulk-mini-input" style={{ width: 70, fontSize: 10.5 }} placeholder="Helper" value={cfg.helper_name || ""} onChange={e => updateVehicleField(v.id, "helper_name", e.target.value)} />
                  </div>
                  <label className="muted small">Cap <input type="number" min={1} style={{ width: 46 }} value={cfg.capacity} onChange={e => updateVehicleField(v.id, "capacity", Math.max(1, Number(e.target.value)))} /></label>
                  <div className="iso-dropzone">{items.length ? items.map(i => <InvoiceMini key={i.id} invoice={i} onDragStart={() => setDragged({ type: "invoice", id: i.id })} onEdit={() => editInvoice(i)} />) : <span className="muted small">Drop crate here</span>}</div>
                  <button className="btn icon-btn" title="Remove from day" onClick={() => toggleVehicle(v)}><X size={12} /></button>
                </div>;
              })}
              {!selectedVehicles.length && <div className="muted small" style={{ padding: "20px 0" }}>No vehicles for this day yet — pick your defaults from “Manage Defaults”, or add one above.</div>}
            </div>
          </div>
        </section>

        <section className="bulk-section">
          <div className="bulk-section-head"><div><h2>Customers</h2><div className="muted small">Buildings are your customer defaults + anyone with an invoice today. Drop an invoice on a building to assign it.</div></div><GlassButton variant="secondary" size="sm" onClick={() => setShowCustomerManager(x => !x)}><Users size={14} /> {showCustomerManager ? "Close" : "Add customer for today"}</GlassButton></div>
          {showCustomerManager && <GlassCard style={{ marginBottom: 10 }}><div className="bulk-form-row"><GlassInput list="bulk-customer-library" value={customerForm.name} onChange={e => setCustomerForm({ ...customerForm, name: e.target.value })} placeholder="Customer name…" /><select value={customerForm.area} onChange={e => setCustomerForm({ ...customerForm, area: e.target.value })}><option value="">Location / Area…</option>{areas.map(a => <option key={a.id} value={a.name}>{a.code} · {a.name}</option>)}</select><select value={customerForm.division} onChange={e => setCustomerForm({ ...customerForm, division: e.target.value })}><option value="">Division…</option><option>Pharma</option><option>Consumer</option></select><select value={customerForm.building_type} onChange={e => setCustomerForm({ ...customerForm, building_type: e.target.value as any })}><option value="store">Store</option><option value="hospital">Hospital</option><option value="warehouse">Warehouse</option></select><GlassButton size="sm" onClick={addCustomer}><Plus size={14} /> Add Customer</GlassButton></div></GlassCard>}
          <datalist id="bulk-customer-library">{Array.from(new Set([...customerLibrary, ...customers.map(c => c.name)])).map(c => <option key={c} value={c} />)}</datalist>

          <div className="bulk-game-scene">
            <div className="bulk-game-row" style={{ flexWrap: "wrap" }}>
              {customerCards.map(c => {
                const cis = invoices.filter(i => i.customer_id === c.id || norm(i.customer_name) === norm(c.name));
                const cp = cis.reduce((n, i) => n + i.pallets, 0);
                const bType = c.building_type || buildingTypeByName.get(norm(c.name)) || "store";
                return <div key={c.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: 168 }}>
                  <IsoBuilding
                    name={c.name} subtitle={`${c.area || "no area"} · ${cp} plt`} buildingType={bType} notify={notifiedCustomerNames.has(norm(c.name))}
                    onDrop={(e) => { e.preventDefault(); if (!dragged || dragged.type !== "invoice") return; const i = invoices.find(x => x.id === dragged.id); if (i) setPlan(x => ({ ...x, invoices: (x.invoices || []).map(z => z.id === i.id ? { ...z, customer_id: c.id, customer_name: c.name, area: c.area || z.area, division: c.division || z.division } : z), pallets: (x.invoices || []).map(z => z.id === i.id ? { ...z, customer_id: c.id, customer_name: c.name, area: c.area || z.area, division: c.division || z.division } : z) as any })); setDragged(null); }}
                  />
                  <button className="btn icon-btn" title="Remove customer from this day" onClick={() => removeCustomer(c.id)}><X size={12} /></button>
                  <div className="iso-dropzone" style={{ width: "100%" }}>{cis.length ? cis.map(i => <InvoiceCard key={i.id} invoice={i} onDragStart={() => setDragged({ type: "invoice", id: i.id })} onEdit={() => editInvoice(i)} onDelete={() => deleteInvoice(i.id)} showPallets assignments={assignments} />) : <span className="muted small">Drop an invoice here</span>}</div>
                </div>;
              })}
              {!customerCards.length && <div className="muted small" style={{ padding: "20px 0" }}>No customer buildings yet for this day — add defaults from “Manage Defaults”.</div>}
            </div>
          </div>
        </section>

        <section className="bulk-section">
          <div className="bulk-section-head"><div><h2>Invoice &amp; Pallet Pool</h2><div className="muted small">Crates not yet loaded onto a truck. Drag one onto a truck above.</div></div><div style={{ width: 320, maxWidth: "100%", position: "relative" }}><Search size={15} style={{ position: "absolute", left: 10, top: 11, opacity: .6 }} /><GlassInput list="bulk-customer-library" value={search} onChange={e => setSearch(e.target.value)} placeholder="Customer, invoice, area…" style={{ paddingLeft: 32 }} /></div></div>
          <div className="bulk-game-scene" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const nativePallet = e.dataTransfer.getData("text/plain"); const activeDrag = dragged || (nativePallet ? { type: "pallet" as const, id: nativePallet } : null); if (!activeDrag) return; if (activeDrag.type === "invoice") assignInvoice(activeDrag.id, null); else assignPallet(activeDrag.id, null); setDragged(null); }}>
            <div className="iso-dropzone" style={{ justifyContent: "flex-start" }}>
              {visibleInvoices.filter(i => Array.from({ length: Math.max(1, i.pallets) }).some((_, k) => !assignments[`${i.id}::${k}`])).map(i => <InvoiceCard key={i.id} invoice={i} onDragStart={() => setDragged({ type: "invoice", id: i.id })} onEdit={() => editInvoice(i)} onDelete={() => deleteInvoice(i.id)} showPallets assignments={assignments} />)}
              {!visibleInvoices.length && <span className="muted small">No crates waiting — everything is loaded, or add an invoice above.</span>}
            </div>
          </div>
        </section>

        <section className="bulk-section"><GlassCard><div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900 }}><ShieldCheck size={17} /> Planning checks</div><div className="muted small" style={{ marginTop: 8 }}>Vehicle permissions come directly from Fleet Database → permitted areas. Area, vehicle type and division are checked before a drop. If a vehicle has no permitted-area rows, it is treated as unrestricted, matching the existing Fleet data model.</div><div className="bulk-check-grid"><span className="badge">Fleet vehicles {fleet.length}</span><span className="badge">Customers {customerCards.length}</span><span className="badge">Invoices {invoices.length}</span><span className="badge">Pallets {totalPallets}</span><span className="badge">Loaded {loadedPallets}</span></div></GlassCard></section>
      </div>

      <aside>
        <GlassCard>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900, marginBottom: 10 }}><Bell size={16} /> Today's schedule {pendingNotifications > 0 && <span className="iso-badge" style={{ position: "static" }}>{pendingNotifications}</span>}</div>
          {!notifications.length && <div className="muted small">No default customers scheduled for {WEEKDAY_LABELS[todaysWeekday]}. Set weekly schedules from “Manage Defaults”.</div>}
          <div className="bulk-notify-panel">
            {notifications.map(n => <div key={n.id} className="bulk-notify-item"><span className={`dot ${n.pending ? "pending" : "done"}`} /><span style={{ flex: 1 }}><strong>{n.name}</strong><br /><span className="muted small">{n.area || "no area"}</span></span><span className="muted small">{n.pending ? "waiting" : "✓ invoiced"}</span></div>)}
          </div>
        </GlassCard>
      </aside>
    </div>

    <GlassModal open={showInvoiceModal} onOpenChange={(o) => { setShowInvoiceModal(o); if (!o) { setEditingInvoice(null); setInvoiceForm({ ...emptyInvoiceForm, schedule_date: date }); } }} title={editingInvoice ? "Edit invoice" : "Add invoice"} size="md">
      <div className="bulk-form-grid">
        <label>Invoice No<input value={invoiceForm.invoice_no} onChange={e => setInvoiceForm({ ...invoiceForm, invoice_no: e.target.value })} placeholder="INV-…" /></label>
        <label>Customer<input list="bulk-customer-library" value={invoiceForm.customer_name} onChange={e => { const name = e.target.value; const c = customers.find(x => norm(x.name) === norm(name)); setInvoiceForm({ ...invoiceForm, customer_name: name, customer_id: c?.id || "", area: c?.area || invoiceForm.area, division: c?.division || invoiceForm.division }); }} placeholder="Predictive customer…" /></label>
        <label>Location / Area<select value={invoiceForm.area} onChange={e => setInvoiceForm({ ...invoiceForm, area: e.target.value })}><option value="">Select area…</option>{areas.map(a => <option key={a.id} value={a.name}>{a.code} · {a.name}</option>)}</select></label>
        <label>Division<select value={invoiceForm.division} onChange={e => setInvoiceForm({ ...invoiceForm, division: e.target.value })}><option value="">Auto / select…</option><option>Pharma</option><option>Consumer</option></select></label>
        <label>Pallets<input type="number" min={1} value={invoiceForm.pallets} onChange={e => setInvoiceForm({ ...invoiceForm, pallets: Math.max(1, Number(e.target.value)) })} /></label>
        <label>Invoice Date<input type="date" value={invoiceForm.invoice_date} onChange={e => setInvoiceForm({ ...invoiceForm, invoice_date: e.target.value })} /></label>
        <label>Schedule Date<input type="date" value={invoiceForm.schedule_date} onChange={e => setInvoiceForm({ ...invoiceForm, schedule_date: e.target.value })} /></label>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        {editingInvoice ? <GlassButton size="sm" onClick={updateInvoice}><Check size={14} /> Update Invoice</GlassButton> : <GlassButton size="sm" onClick={addInvoice}><Plus size={14} /> Add Invoice</GlassButton>}
      </div>
    </GlassModal>

    <GlassModal open={showDefaultsModal} onOpenChange={setShowDefaultsModal} title="Manage Defaults" description="These are the vehicles and customers every day starts with — the same set for every month, until you change it here." size="lg">
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <GlassButton size="sm" variant={defaultsTab === "vehicles" ? "primary" : "secondary"} onClick={() => setDefaultsTab("vehicles")}>Default Vehicles</GlassButton>
        <GlassButton size="sm" variant={defaultsTab === "customers" ? "primary" : "secondary"} onClick={() => setDefaultsTab("customers")}>Default Customers</GlassButton>
      </div>

      {defaultsTab === "vehicles" && <div>
        <div className="bulk-form-grid" style={{ marginBottom: 12 }}>
          <label>Vehicle<select value={defVehicleForm.vehicle_id} onChange={e => setDefVehicleForm({ ...defVehicleForm, vehicle_id: e.target.value })}><option value="">Select from fleet…</option>{fleet.filter(v => !defaultVehicles.some(dv => dv.vehicle_id === v.id)).map(v => <option key={v.id} value={v.id}>{v.number} · {v.type}</option>)}</select></label>
          <label>Capacity<input type="number" min={1} value={defVehicleForm.capacity} onChange={e => setDefVehicleForm({ ...defVehicleForm, capacity: Math.max(1, Number(e.target.value)) })} /></label>
          <label>Driver<input value={defVehicleForm.driver_name} onChange={e => setDefVehicleForm({ ...defVehicleForm, driver_name: e.target.value })} placeholder="Optional" /></label>
          <label>Helper<input value={defVehicleForm.helper_name} onChange={e => setDefVehicleForm({ ...defVehicleForm, helper_name: e.target.value })} placeholder="Optional" /></label>
          <div style={{ display: "flex", alignItems: "end" }}><GlassButton size="sm" onClick={() => void saveDefaultVehicle()}><Plus size={14} /> Add to defaults</GlassButton></div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {defaultVehicles.map(dv => { const v = vehicleMap.get(dv.vehicle_id); return <div key={dv.id} className="bulk-notify-item"><span style={{ flex: 1 }}><strong>{v?.number || dv.vehicle_id}</strong> · cap {dv.capacity} · {dv.driver_name || "no driver"} / {dv.helper_name || "no helper"}</span><button className="btn icon-btn" onClick={() => void removeDefaultVehicle(dv.id)}><Trash2 size={13} /></button></div>; })}
          {!defaultVehicles.length && <div className="muted small">No default vehicles yet — every day starts empty until you add some here.</div>}
        </div>
      </div>}

      {defaultsTab === "customers" && <div>
        <div className="bulk-form-grid" style={{ marginBottom: 12 }}>
          <label>Name<input list="bulk-customer-library" value={defCustomerForm.name} onChange={e => setDefCustomerForm({ ...defCustomerForm, name: e.target.value })} placeholder="Customer / hospital / store name" /></label>
          <label>Area<select value={defCustomerForm.area} onChange={e => setDefCustomerForm({ ...defCustomerForm, area: e.target.value })}><option value="">Location / Area…</option>{areas.map(a => <option key={a.id} value={a.name}>{a.code} · {a.name}</option>)}</select></label>
          <label>Division<select value={defCustomerForm.division} onChange={e => setDefCustomerForm({ ...defCustomerForm, division: e.target.value })}><option value="">Division…</option><option>Pharma</option><option>Consumer</option></select></label>
          <label>Building<select value={defCustomerForm.building_type} onChange={e => setDefCustomerForm({ ...defCustomerForm, building_type: e.target.value as any })}><option value="store">Store</option><option value="hospital">Hospital</option><option value="warehouse">Warehouse</option></select></label>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          {WEEKDAY_LABELS.map((lbl, idx) => <button key={idx} className={`bulk-fleet-choice ${defCustomerForm.weekdays.includes(idx) ? "selected" : ""}`} style={{ padding: "6px 10px" }} onClick={() => toggleDefCustomerWeekday(idx)}>{lbl}</button>)}
        </div>
        <GlassButton size="sm" onClick={() => void saveDefaultCustomer()} style={{ marginBottom: 14 }}><Plus size={14} /> Add to defaults</GlassButton>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {defaultCustomers.map(dc => <div key={dc.id} className="bulk-notify-item"><span style={{ flex: 1 }}><strong>{dc.name}</strong> · {dc.building_type} · {(dc.weekdays || []).map(w => WEEKDAY_LABELS[w]).join(", ") || "no recurring days"}</span><button className="btn icon-btn" onClick={() => void removeDefaultCustomer(dc.id)}><Trash2 size={13} /></button></div>)}
          {!defaultCustomers.length && <div className="muted small">No default customers yet.</div>}
        </div>
      </div>}
    </GlassModal>
  </div>;
}

function InvoiceCard({ invoice, onDragStart, onEdit, onDelete, showPallets = false, assignments = {} }: { invoice: InvoicePlan; onDragStart: () => void; onEdit: () => void; onDelete: () => void; showPallets?: boolean; assignments?: Record<string, string | null> }) {
  return <div className="bulk-invoice-card" draggable onDragStart={onDragStart}><div className="bulk-invoice-head"><span className="bulk-drag"><GripVertical size={15} /></span><strong>{invoice.invoice_no}</strong><span className="badge">{invoice.division}</span><span className="bulk-actions"><button className="btn icon-btn" onClick={e => { e.stopPropagation(); onEdit(); }} title="Edit invoice"><Pencil size={13} /></button><button className="btn icon-btn" onClick={e => { e.stopPropagation(); onDelete(); }} title="Delete invoice"><Trash2 size={13} /></button></span></div><div className="bulk-invoice-customer">{invoice.customer_name}</div><div className="muted small"><MapPin size={12} style={{ verticalAlign: "-2px" }} /> {invoice.area || "No location"} · {invoice.pallets} pallets · Invoice {invoice.invoice_date || "—"}</div>{showPallets && <PalletPieces invoice={invoice} assignments={assignments} />}</div>;
}
function InvoiceMini({ invoice, onDragStart, onEdit }: { invoice: InvoicePlan; onDragStart: () => void; onEdit: () => void }) { return <div className="bulk-invoice-mini" draggable onDragStart={onDragStart}><span><GripVertical size={12} /> {invoice.customer_name}</span><span className="badge">{invoice.pallets}p</span><button className="btn icon-btn" onClick={e => { e.stopPropagation(); onEdit(); }}><Pencil size={12} /></button></div>; }
function PalletPieces({ invoice, assignments }: { invoice: InvoicePlan; assignments: Record<string, string | null> }) {
  return <div className="bulk-pallet-pieces" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
    {Array.from({ length: Math.max(1, invoice.pallets) }).map((_, idx) => {
      const key = `${invoice.id}::${idx}`;
      return <IsoPallet key={key} loaded={!!assignments[key]} label={`P${idx + 1}${assignments[key] ? " · loaded" : ""}`} onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData("text/plain", key); e.dataTransfer.effectAllowed = "move"; }} />;
    })}
  </div>;
}
