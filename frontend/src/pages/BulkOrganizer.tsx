import { useEffect, useMemo, useState } from "react";
import {
  Bell, Building2, CalendarDays, CarFront, Check, ChevronLeft, ChevronRight,
  CircleAlert, Database, GripVertical, Hospital, MapPin, Package, Pencil,
  Plus, RefreshCw, Save, Search, ShieldCheck, Store, Trash2, Truck, Users, X,
  UserRound, Gauge, Route, Sparkles
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { GlassButton } from "../design-system/GlassButton";
import { GlassCard } from "../design-system/GlassCard";
import { GlassInput } from "../design-system/GlassInput";
import {
  loadBulkOrganizerDefaults, loadBulkOrganizerPlan, saveBulkOrganizerDefaults,
  saveBulkOrganizerPlan, type BulkOrganizerDefaults, type BulkOrganizerPlan
} from "../services/bulkOrganizer";

const norm = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
const isPickup = (v: unknown) => { const n = norm(v); return n === "PICKUP" || n.includes("PICK UP"); };
const isVan = (v: unknown) => norm(v).includes("VAN");
const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const monthKey = (date: string) => `${date.slice(0, 7)}-01`;
const dayLabel = (date: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00`));
const divisionFor = (row: any) => { const d = norm(row.division_desc); if (d.includes("PHARMA")) return "Pharma"; if (d.includes("CONSUMER")) return "Consumer"; return row.division_desc || "Unknown"; };
const defaultCapacity = (type: string) => isVan(type) ? 20 : isPickup(type) ? 10 : 10;

type Building = {
  id: string; name: string; type: "warehouse" | "hospital" | "store" | "other";
  area: string; enabled: boolean; note?: string;
};
type CustomerSchedule = {
  id: string; customer_name: string; days: number[]; area: string; division: string; building_id?: string | null; enabled: boolean;
};
type InvoicePlan = {
  id: string; invoice_no: string; customer_id: string; customer_name: string; area: string;
  division: string; pallets: number; invoice_date: string | null; scheduled_date: string; vehicle_id: string | null;
};
type VehicleConfig = { vehicle_id: string; capacity: number; driver?: string; helper?: string; building_id?: string | null };
type PlanV3 = BulkOrganizerPlan & {
  buildings?: Building[];
  vehicle_meta?: Record<string, { driver?: string; helper?: string; building_id?: string | null }>;
  customer_schedules?: CustomerSchedule[];
};
type DefaultsV2 = BulkOrganizerDefaults & {
  month_key?: string;
  buildings: Building[];
  vehicles: VehicleConfig[];
  customer_schedules: CustomerSchedule[];
};

const emptyPlan = (date: string): PlanV3 => ({
  plan_date: date, vehicles: [], pallets: [], customers: [], invoices: [], pallet_assignments: {},
  buildings: [], vehicle_meta: {}, customer_schedules: []
});

export default function BulkOrganizer() {
  const [date, setDate] = useState(dateKey(new Date()));
  const [fleet, setFleet] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [facts, setFacts] = useState<any[]>([]);
  const [customerLibrary, setCustomerLibrary] = useState<string[]>([]);
  const [plan, setPlan] = useState<PlanV3>(emptyPlan(date));
  const [defaults, setDefaults] = useState<DefaultsV2>({ month_key: monthKey(date), buildings: [], vehicles: [], customer_schedules: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [dragged, setDragged] = useState<{ type: "invoice" | "pallet" | "vehicle"; id: string } | null>(null);
  const [showFleet, setShowFleet] = useState(false);
  const [showBuildingEditor, setShowBuildingEditor] = useState(false);
  const [showCustomerManager, setShowCustomerManager] = useState(false);
  const [showScheduleManager, setShowScheduleManager] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<InvoicePlan | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({ invoice_no: "", customer_id: "", customer_name: "", area: "", division: "", pallets: 1, invoice_date: "", schedule_date: date });
  const [buildingForm, setBuildingForm] = useState<Building>({ id: "", name: "", type: "warehouse", area: "", enabled: true });
  const [customerForm, setCustomerForm] = useState({ name: "", area: "", division: "" });
  const [scheduleForm, setScheduleForm] = useState({ customer_name: "", days: [] as number[], area: "", division: "", building_id: "" });

  async function loadSourceData(selectedDate: string) {
    setLoading(true); setError("");
    try {
      const mk = monthKey(selectedDate);
      const [v, a, p, f, allCustomers, saved, savedDefaults] = await Promise.all([
        supabase.from("vehicles").select("id,number,type,division,status").order("number"),
        supabase.from("areas").select("id,code,name,sector,region,route_type,vehicle_type").order("code"),
        supabase.from("vehicle_permitted_areas").select("vehicle_id,area_id,areas(id,code,name)"),
        supabase.from("sap_invoice_facts").select("id,invoice_no,invoice_date,dispatch_date,customer_name,area,boxes,division_desc,vehicle_num,vehicle_type,salesman").or(`dispatch_date.eq.${selectedDate},invoice_date.eq.${selectedDate}`).order("customer_name"),
        supabase.from("sap_invoice_facts").select("customer_name").not("customer_name", "is", null).order("customer_name").limit(5000),
        loadBulkOrganizerPlan(selectedDate),
        loadBulkOrganizerDefaults(mk),
      ]);
      if (v.error) throw v.error; if (a.error) throw a.error; if (p.error) throw p.error; if (f.error) throw f.error;

      const active = (v.data ?? []).filter((x: any) => String(x.status ?? "Active").toLowerCase() !== "under service");
      setFleet(active); setAreas(a.data ?? []); setPermissions(p.data ?? []); setFacts(f.data ?? []);
      setCustomerLibrary(Array.from(new Set((allCustomers.data ?? []).map((x: any) => String(x.customer_name || "").trim()).filter(Boolean))));

      const loadedDefaults = (savedDefaults || { buildings: [], vehicles: [], customer_schedules: [] }) as DefaultsV2;
      const sourceInvoices: InvoicePlan[] = (f.data ?? []).map((r: any, i: number) => ({
        id: `${r.invoice_no || r.id || i}`, invoice_no: r.invoice_no || `INV-${i + 1}`,
        customer_id: `customer:${norm(r.customer_name || "unknown")}`, customer_name: r.customer_name || "Unknown customer",
        area: r.area || "", division: divisionFor(r), pallets: Math.max(1, Number(r.boxes || 1)),
        invoice_date: r.invoice_date || null, scheduled_date: selectedDate, vehicle_id: null,
      }));

      const old = (saved || {}) as PlanV3;
      const savedInvoices = old.invoices?.length ? old.invoices : [];
      const merged = sourceInvoices.map(src => {
        const s = savedInvoices.find((x: any) => x.invoice_no === src.invoice_no);
        return s ? { ...src, ...s, scheduled_date: selectedDate, customer_name: src.customer_name, area: src.area, division: src.division } : src;
      });
      const customerMap = new Map<string, any>();
      merged.forEach(i => customerMap.set(i.customer_id, customerMap.get(i.customer_id) || { id: i.customer_id, name: i.customer_name, area: i.area, division: i.division, enabled: true }));
      (old.customers || []).forEach(c => customerMap.set(c.id, c));
      loadedDefaults.customer_schedules.forEach(s => {
        const id = s.id || `schedule:${norm(s.customer_name)}`;
        if (!customerMap.has(`schedule:${norm(s.customer_name)}`)) customerMap.set(`schedule:${norm(s.customer_name)}`, { id, name: s.customer_name, area: s.area, division: s.division, enabled: true });
      });

      const assignments: Record<string, string | null> = { ...(old.pallet_assignments || {}) };
      merged.forEach(i => { for (let k = 0; k < Math.max(1, i.pallets); k++) { const key = `${i.id}::${k}`; if (!(key in assignments)) assignments[key] = i.vehicle_id || null; } });

      const defaultVehicles = loadedDefaults.vehicles.filter(x => active.some(vh => vh.id === x.vehicle_id));
      const savedVehicles = (old.vehicles || []).filter(x => active.some(vh => vh.id === x.vehicle_id));
      const vehicleMeta = { ...(old.vehicle_meta || {}) };
      const planBuildings = old.buildings?.length ? old.buildings : loadedDefaults.buildings;
      setDefaults({ ...loadedDefaults });
      setPlan({
        ...emptyPlan(selectedDate), ...old, plan_date: selectedDate,
        vehicles: savedVehicles.length ? savedVehicles : defaultVehicles,
        customers: Array.from(customerMap.values()), invoices: merged, pallets: merged as any,
        pallet_assignments: assignments, buildings: planBuildings, vehicle_meta: vehicleMeta,
        customer_schedules: old.customer_schedules?.length ? old.customer_schedules : loadedDefaults.customer_schedules
      });
    } catch (e: any) {
      setError(e?.message || "Could not load Bulk Organizer data.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void loadSourceData(date); }, [date]);

  useEffect(() => {
    const channel = supabase.channel("bulk-organizer-global-defaults")
      .on("postgres_changes", { event: "*", schema: "public", table: "bulk_organizer_defaults" }, (payload: any) => {
        if (payload.new) setDefaults(payload.new as DefaultsV2);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    const channel = supabase.channel(`bulk-organizer-${date}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bulk_organizer_plans", filter: `plan_date=eq.${date}` },
        (payload: any) => { if (payload.new) setPlan(p => ({ ...p, ...(payload.new as PlanV3), plan_date: date })); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [date]);

  const vehicleMap = useMemo(() => new Map(fleet.map(v => [v.id, v])), [fleet]);
  const areaMap = useMemo(() => new Map(areas.map(a => [norm(a.name), a])), [areas]);
  const invoices = plan.invoices || [];
  const customers = plan.customers || [];
  const selectedVehicles = plan.vehicles || [];
  const assignments = plan.pallet_assignments || {};
  const totalPallets = invoices.reduce((n, i) => n + Number(i.pallets || 0), 0);
  const loadedPallets = Object.values(assignments).filter(Boolean).length;
  const pendingPallets = Math.max(0, totalPallets - loadedPallets);
  const todayDow = new Date(`${date}T12:00:00`).getDay();
  const visibleInvoices = invoices.filter(i => !search || [i.invoice_no, i.customer_name, i.area, i.division].some(v => norm(v).includes(norm(search))));

  const notifications = useMemo(() => {
    const list: { id: string; title: string; text: string; tone: "blue" | "amber" | "green" }[] = [];
    (plan.customer_schedules || []).filter(s => s.enabled && s.days.includes(todayDow)).forEach(s => {
      list.push({ id: `s-${s.id}`, title: "Scheduled customer", text: `${s.customer_name} · ${s.area || "Area not set"}`, tone: "blue" });
    });
    invoices.forEach(i => list.push({ id: `i-${i.id}`, title: "Today's invoice", text: `${i.invoice_no} · ${i.pallets} pallets · ${i.customer_name}`, tone: "green" }));
    if (pendingPallets) list.push({ id: "pending", title: "Pallets waiting", text: `${pendingPallets} pallet${pendingPallets === 1 ? "" : "s"} still need a vehicle`, tone: "amber" });
    return list.slice(0, 10);
  }, [plan.customer_schedules, invoices, todayDow, pendingPallets]);

  function vehiclePermission(invoice: InvoicePlan, vehicle: any) {
    const area = areaMap.get(norm(invoice.area));
    if (!area) return { ok: true, text: "No mapped area" };
    const expectedType = norm(area.vehicle_type), actualType = norm(vehicle.type);
    const typeOk = !expectedType || actualType.includes(expectedType) || (isPickup(expectedType) && isPickup(actualType)) || (isVan(expectedType) && isVan(actualType));
    const divisionOk = !area.sector || !vehicle.division || norm(area.sector) === norm(vehicle.division);
    const rows = permissions.filter(x => x.vehicle_id === vehicle.id);
    const permitted = rows.length === 0 || rows.some(x => x.area_id === area.id);
    return { ok: typeOk && divisionOk && permitted, text: !typeOk ? `Vehicle type: ${area.vehicle_type}` : !divisionOk ? `Division: ${area.sector}` : !permitted ? "Area not permitted" : "Permitted" };
  }

  function assignPallet(id: string, vehicleId: string | null) {
    setPlan(x => {
      const next = { ...(x.pallet_assignments || {}), [id]: vehicleId };
      const invoiceId = id.split("::")[0];
      const inv = (x.invoices || []).find(i => i.id === invoiceId);
      const allLoaded = inv ? Array.from({ length: Math.max(1, inv.pallets) }).every((_, k) => !!next[`${invoiceId}::${k}`]) : false;
      return { ...x, pallet_assignments: next, invoices: (x.invoices || []).map(i => i.id === invoiceId ? { ...i, vehicle_id: allLoaded ? vehicleId : null } : i) };
    });
  }

  function assignInvoice(id: string, vehicleId: string | null) {
    setPlan(x => {
      const next = { ...(x.pallet_assignments || {}) };
      const inv = (x.invoices || []).find(i => i.id === id);
      if (inv) for (let k = 0; k < Math.max(1, inv.pallets); k++) next[`${id}::${k}`] = vehicleId;
      return { ...x, pallet_assignments: next, invoices: (x.invoices || []).map(i => i.id === id ? { ...i, vehicle_id: vehicleId } : i) };
    });
  }

  function dropOnVehicle(v: any, activeDrag: { type: string; id: string }) {
    const cfg = selectedVehicles.find(x => x.vehicle_id === v.id);
    if (!cfg) return;
    const used = Object.values(assignments).filter(val => val === v.id).length;
    const inv = invoices.find(i => activeDrag.type === "invoice" ? i.id === activeDrag.id : activeDrag.id.startsWith(`${i.id}::`));
    if (!inv) return;
    const check = vehiclePermission(inv, v);
    const adding = activeDrag.type === "pallet" ? 1 : Math.max(1, inv.pallets);
    if (!check.ok) { setError(`${v.number}: ${check.text}`); return; }
    if (used + adding > cfg.capacity) { setError(`${v.number}: only ${Math.max(0, cfg.capacity - used)} pallet space left.`); return; }
    activeDrag.type === "pallet" ? assignPallet(activeDrag.id, v.id) : assignInvoice(inv.id, v.id);
    setError("");
  }

  function toggleVehicle(v: any, fromDefaults = false) {
    const listKey = fromDefaults ? "defaults" : "plan";
    if (fromDefaults) {
      setDefaults(x => x.vehicles.some(z => z.vehicle_id === v.id)
        ? { ...x, vehicles: x.vehicles.filter(z => z.vehicle_id !== v.id) }
        : { ...x, vehicles: [...x.vehicles, { vehicle_id: v.id, capacity: defaultCapacity(v.type), driver: "", helper: "" }] });
      return;
    }
    setPlan(x => x.vehicles.some(z => z.vehicle_id === v.id)
      ? { ...x, vehicles: x.vehicles.filter(z => z.vehicle_id !== v.id), pallet_assignments: Object.fromEntries(Object.entries(x.pallet_assignments || {}).map(([k, val]) => [k, val === v.id ? null : val])) }
      : { ...x, vehicles: [...x.vehicles, { vehicle_id: v.id, capacity: defaultCapacity(v.type) }] });
    void listKey;
  }

  async function save() {
    setSaving(true); setError("");
    try { await saveBulkOrganizerPlan({ ...plan, pallets: invoices as any }); }
    catch (e: any) { setError(e?.message || "Save failed"); } finally { setSaving(false); }
  }
  async function saveDefaults() {
    setSavingDefaults(true); setError("");
    try {
      const result = await saveBulkOrganizerDefaults({ ...defaults });
      setDefaults(result as DefaultsV2);
      setPlan(x => ({ ...x, buildings: result.buildings, customer_schedules: result.customer_schedules, vehicles: x.vehicles.length ? x.vehicles : result.vehicles }));
    } catch (e: any) { setError(e?.message || "Could not save monthly defaults."); } finally { setSavingDefaults(false); }
  }

  function shiftDate(days: number) { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days); setDate(dateKey(d)); }

  function addBuilding() {
    if (!buildingForm.name.trim()) return;
    const b = { ...buildingForm, id: buildingForm.id || `building:${crypto.randomUUID()}`, name: buildingForm.name.trim() };
    setDefaults(x => ({ ...x, buildings: [...x.buildings.filter(z => z.id !== b.id), b] }));
    setPlan(x => ({ ...x, buildings: [...(x.buildings || []).filter(z => z.id !== b.id), b] }));
    setBuildingForm({ id: "", name: "", type: "warehouse", area: "", enabled: true });
  }

  function deleteBuilding(id: string) {
    setDefaults(x => ({ ...x, buildings: x.buildings.filter(b => b.id !== id) }));
    setPlan(x => ({ ...x, buildings: (x.buildings || []).filter(b => b.id !== id), vehicle_meta: Object.fromEntries(Object.entries((x.vehicle_meta || {}) as Record<string, any>).map(([k,v]) => [k, v.building_id === id ? { ...v, building_id: null } : v])) }));
  }

  function addCustomer() {
    const name = customerForm.name.trim(); if (!name) return;
    const id = `manual:${crypto.randomUUID()}`;
    const c = { id, name, area: customerForm.area, division: customerForm.division || "Unknown", enabled: true };
    setPlan(x => ({ ...x, customers: [...(x.customers || []), c] }));
    setCustomerForm({ name: "", area: "", division: "" });
  }

  function addSchedule() {
    if (!scheduleForm.customer_name.trim() || !scheduleForm.days.length) return;
    const s: CustomerSchedule = { id: `schedule:${crypto.randomUUID()}`, customer_name: scheduleForm.customer_name.trim(), days: scheduleForm.days, area: scheduleForm.area, division: scheduleForm.division || "Unknown", building_id: scheduleForm.building_id || null, enabled: true };
    setDefaults(x => ({ ...x, customer_schedules: [...x.customer_schedules, s] }));
    setPlan(x => ({ ...x, customer_schedules: [...(x.customer_schedules || []), s] }));
    setScheduleForm({ customer_name: "", days: [], area: "", division: "", building_id: "" });
  }

  async function addInvoice() {
    const name = invoiceForm.customer_name.trim(); if (!invoiceForm.invoice_no.trim() || !name) return;
    const customer = customers.find(c => c.id === invoiceForm.customer_id) || customers.find(c => norm(c.name) === norm(name));
    const customerId = customer?.id || `manual:${crypto.randomUUID()}`;
    const inv: InvoicePlan = {
      id: `manual-invoice:${crypto.randomUUID()}`, invoice_no: invoiceForm.invoice_no.trim(), customer_id: customerId,
      customer_name: customer?.name || name, area: invoiceForm.area || customer?.area || "", division: invoiceForm.division || customer?.division || "Unknown",
      pallets: Math.max(1, Number(invoiceForm.pallets || 1)), invoice_date: invoiceForm.invoice_date || null,
      scheduled_date: invoiceForm.schedule_date || date, vehicle_id: null
    };
    if (inv.scheduled_date === date) {
      setPlan(x => ({ ...x, invoices: [...(x.invoices || []), inv], customers: customer ? (x.customers || []) : [...(x.customers || []), { id: customerId, name, area: inv.area, division: inv.division, enabled: true }] }));
    } else {
      try {
        const target = await loadBulkOrganizerPlan(inv.scheduled_date);
        const next = target || emptyPlan(inv.scheduled_date);
        next.invoices = [...(next.invoices || []), inv];
        next.pallets = next.invoices as any;
        next.customers = [...(next.customers || []), ...(customer ? [] : [{ id: customerId, name, area: inv.area, division: inv.division, enabled: true }])];
        await saveBulkOrganizerPlan(next);
      } catch (e: any) { setError(e?.message || "Could not place the invoice on its scheduled date."); }
    }
    setInvoiceForm({ invoice_no: "", customer_id: "", customer_name: "", area: "", division: "", pallets: 1, invoice_date: "", schedule_date: date });
  }

  function updateInvoice() {
    if (!editingInvoice) return;
    const next = { ...editingInvoice, invoice_no: invoiceForm.invoice_no, customer_name: invoiceForm.customer_name, area: invoiceForm.area, division: invoiceForm.division, pallets: Math.max(1, Number(invoiceForm.pallets || 1)), invoice_date: invoiceForm.invoice_date || null, scheduled_date: invoiceForm.schedule_date || date };
    setPlan(x => ({ ...x, invoices: (x.invoices || []).map(i => i.id === editingInvoice.id ? next : i) }));
    setEditingInvoice(null);
  }

  function editInvoice(i: InvoicePlan) { setEditingInvoice(i); setInvoiceForm({ invoice_no: i.invoice_no, customer_id: i.customer_id, customer_name: i.customer_name, area: i.area, division: i.division, pallets: i.pallets, invoice_date: i.invoice_date || "", schedule_date: i.scheduled_date }); }
  function deleteInvoice(id: string) { setPlan(x => { const next = { ...(x.pallet_assignments || {}) }; Object.keys(next).filter(k => k.startsWith(`${id}::`)).forEach(k => delete next[k]); return { ...x, invoices: (x.invoices || []).filter(i => i.id !== id), pallet_assignments: next }; }); }

  function routeVehicle(vehicleId: string, buildingId: string | null) {
    setPlan(x => ({ ...x, vehicle_meta: { ...(x.vehicle_meta || {}), [vehicleId]: { ...(x.vehicle_meta?.[vehicleId] || {}), building_id: buildingId } } }));
  }

  function updateVehicleMeta(vehicleId: string, field: "driver" | "helper", value: string) {
    setPlan(x => ({ ...x, vehicle_meta: { ...(x.vehicle_meta || {}), [vehicleId]: { ...(x.vehicle_meta?.[vehicleId] || {}), [field]: value } } }));
  }

  if (loading) return <div className="page"><GlassCard style={{ padding: 28 }}>Loading Bulk Organizer game board…</GlassCard></div>;

  const buildingCards = (plan.buildings || []).filter(b => b.enabled);
  const dayName = new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long" });

  return <div className="page bulk-game-page">
    <div className="bulk-game-header glass-card">
      <div>
        <div className="bulk-eyebrow"><Sparkles size={14}/> Bulk Organizer · Visual Dispatch Planner</div>
        <h1>Build the day like a logistics game</h1>
        <p>Buildings → vehicles → pallets. Set monthly defaults once, then make day-by-day changes without changing Fleet or SAP data.</p>
      </div>
      <div className="bulk-header-actions">
        <GlassButton variant="secondary" size="sm" onClick={() => void loadSourceData(date)}><RefreshCw size={14}/> Refresh</GlassButton>
        <GlassButton size="sm" onClick={() => void save()} disabled={saving}><Save size={14}/> {saving ? "Saving…" : "Save Day"}</GlassButton>
      </div>
    </div>

    {error && <div className="bulk-game-error"><CircleAlert size={15}/> {error}<button onClick={() => setError("")}><X size={14}/></button></div>}

    <div className="bulk-date-game glass-card">
      <button className="btn icon-btn" onClick={() => shiftDate(-1)}><ChevronLeft size={18}/></button>
      <div className="bulk-date-center"><CalendarDays size={18}/><strong>{dayLabel(date)}</strong><input type="date" value={date} onChange={e => setDate(e.target.value)}/></div>
      <button className="btn icon-btn" onClick={() => shiftDate(1)}><ChevronRight size={18}/></button>
      <div className="bulk-live-pill"><span/> LIVE PLAN</div>
    </div>

    <div className="bulk-game-layout">
      <aside className="bulk-side-rail">
        <div className="bulk-side-title"><Bell size={16}/> Today</div>
        <div className="bulk-side-date">{dayName} · {date}</div>
        {notifications.length ? notifications.map(n => <div key={n.id} className={`bulk-notification ${n.tone}`}><div className="bulk-notification-dot"/><div><b>{n.title}</b><span>{n.text}</span></div></div>) : <div className="bulk-empty-side">No scheduled alerts for this day.</div>}
        <div className="bulk-side-stats">
          <div><span>Customers</span><b>{customers.length}</b></div><div><span>Invoices</span><b>{invoices.length}</b></div><div><span>Pallets</span><b>{totalPallets}</b></div><div><span>Waiting</span><b>{pendingPallets}</b></div>
        </div>
      </aside>

      <main className="bulk-game-board">
        <section className="bulk-game-section">
          <div className="bulk-game-section-head">
            <div><div className="bulk-section-kicker">LEVEL 01 · DESTINATIONS</div><h2>Buildings & Customers</h2><p>Drop a vehicle on a building to route it. Buildings can be warehouses, hospitals, stores or your own type.</p></div>
            <div className="bulk-section-actions">
              <GlassButton variant="secondary" size="sm" onClick={() => setShowBuildingEditor(x => !x)}><Building2 size={14}/>{showBuildingEditor ? "Close" : "Build / Edit"}</GlassButton>
              <GlassButton variant="secondary" size="sm" onClick={() => void saveDefaults()} disabled={savingDefaults}><Save size={14}/>{savingDefaults ? "Saving…" : "Save Defaults"}</GlassButton>
            </div>
          </div>

          {showBuildingEditor && <GlassCard className="bulk-builder-panel">
            <div className="bulk-builder-row">
              <input value={buildingForm.name} placeholder="Building name (e.g. Main Warehouse)" onChange={e => setBuildingForm({...buildingForm,name:e.target.value})}/>
              <select value={buildingForm.type} onChange={e => setBuildingForm({...buildingForm,type:e.target.value as Building["type"]})}><option value="warehouse">Warehouse</option><option value="hospital">Hospital</option><option value="store">Store</option><option value="other">Custom</option></select>
              <select value={buildingForm.area} onChange={e => setBuildingForm({...buildingForm,area:e.target.value})}><option value="">Area / City</option>{areas.map(a => <option key={a.id} value={a.name}>{a.code} · {a.name}</option>)}</select>
              <GlassButton size="sm" onClick={addBuilding}><Plus size={14}/> Build</GlassButton>
            </div>
          </GlassCard>}

          <div className="bulk-building-grid">
            {buildingCards.map(b => {
              const routed = selectedVehicles.filter(v => plan.vehicle_meta?.[v.vehicle_id]?.building_id === b.id).length;
              return <div key={b.id} className="bulk-building-wrap">
                <div className="bulk-3d-building" onDragOver={e => e.preventDefault()} onDrop={e => {
                  e.preventDefault(); const raw = e.dataTransfer.getData("text/plain"); const d = dragged || (raw ? {type:"vehicle",id:raw}:null);
                  if (d?.type === "vehicle") routeVehicle(d.id, b.id); setDragged(null);
                }}>
                  <div className={`bulk-building-art ${b.type}`}><div className="bulk-building-roof"/><div className="bulk-building-body"><span>{b.type === "hospital" ? <Hospital/> : b.type === "store" ? <Store/> : <Building2/>}</span><i/><i/><i/></div><div className="bulk-building-sign">{b.name}</div></div>
                  <div className="bulk-building-info"><b>{b.name}</b><span><MapPin size={11}/> {b.area || "Area not set"}</span><em>{routed} vehicle{routed === 1 ? "" : "s"} routed</em></div>
                  <button className="bulk-delete-building" onClick={() => deleteBuilding(b.id)}><Trash2 size={12}/></button>
                </div>
              </div>;
            })}
            {!buildingCards.length && <div className="bulk-no-buildings"><Building2 size={34}/><b>No buildings yet</b><span>Use Build / Edit to create your monthly defaults.</span></div>}
          </div>
        </section>

        <section className="bulk-game-section">
          <div className="bulk-game-section-head">
            <div><div className="bulk-section-kicker">LEVEL 02 · FLEET</div><h2>Vehicles / Pickups / Vans</h2><p>Only vehicles you choose are placed on the board. Their Fleet number, type, division and permissions come from Fleet Data Manager.</p></div>
            <GlassButton variant="secondary" size="sm" onClick={() => setShowFleet(x => !x)}><Database size={14}/>{showFleet ? "Close Fleet" : "Choose Defaults"}</GlassButton>
          </div>
          {showFleet && <GlassCard className="bulk-fleet-panel">
            <div className="bulk-fleet-panel-head"><b>Monthly vehicle defaults</b><span>Selected vehicles carry to the other days of this month.</span></div>
            <div className="bulk-fleet-picker">{fleet.map(v => { const on = defaults.vehicles.some(x => x.vehicle_id === v.id); return <button key={v.id} className={`bulk-fleet-choice ${on ? "selected" : ""}`} onClick={() => toggleVehicle(v,true)}><span className="bulk-mini-vehicle">{isPickup(v.type) ? <Truck/> : <CarFront/>}</span><span><b>{v.number}</b><small>{v.type} · {v.division || "No division"}</small></span>{on && <Check size={15}/>}</button>; })}</div>
          </GlassCard>}

          <div className="bulk-vehicle-game-grid">
            {selectedVehicles.map(cfg => {
              const v = vehicleMap.get(cfg.vehicle_id); if (!v) return null;
              const used = Object.values(assignments).filter(val => val === v.id).length;
              const free = Math.max(0, cfg.capacity - used);
              const pct = Math.min(100, used / Math.max(1, cfg.capacity) * 100);
              const meta = plan.vehicle_meta?.[v.id] || {};
              const routedBuilding = buildingCards.find(b => b.id === meta.building_id);
              return <div key={v.id} className={`bulk-3d-vehicle-card ${used >= cfg.capacity ? "is-full" : ""}`}
                draggable onDragStart={e => { e.dataTransfer.setData("text/plain", v.id); setDragged({type:"vehicle",id:v.id}); }}
                onDragEnd={() => setDragged(null)}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const raw=e.dataTransfer.getData("text/plain"); const d=dragged || (raw ? {type:"pallet",id:raw}:null); if(d && d.type!=="vehicle") dropOnVehicle(v,d); setDragged(null); }}>
                <div className="bulk-vehicle-3d-art"><div className="bulk-vehicle-cabin"/><div className="bulk-vehicle-box"/><div className="bulk-wheel w1"/><div className="bulk-wheel w2"/><div className="bulk-wheel w3"/><div className="bulk-wheel w4"/></div>
                <div className="bulk-vehicle-game-title"><div><b>{v.number}</b><span>{v.type} · {v.division || "—"}</span></div><span className="bulk-capacity-badge">{used}/{cfg.capacity} P</span></div>
                <div className="bulk-fill-tank"><div className={pct >= 100 ? "full" : "open"} style={{width:`${pct}%`}}/></div>
                <div className="bulk-fill-text"><b>{free} pallet space free</b><span>{routedBuilding ? `→ ${routedBuilding.name}` : "Drop on a building to route"}</span></div>
                <div className="bulk-vehicle-drop">
                  {Array.from({length: Math.min(12, Math.max(0, used))}).map((_,i)=><div className="bulk-mini-pallet" key={i}><Package size={11}/></div>)}
                  {!used && <span>Drop pallets here</span>}
                </div>
                <div className="bulk-vehicle-fields">
                  <label><UserRound size={12}/> Driver<input value={meta.driver || ""} placeholder="Optional" onChange={e => updateVehicleMeta(v.id,"driver",e.target.value)}/></label>
                  <label><Users size={12}/> Helper<input value={meta.helper || ""} placeholder="Optional" onChange={e => updateVehicleMeta(v.id,"helper",e.target.value)}/></label>
                </div>
                <div className="bulk-vehicle-permission"><ShieldCheck size={12}/>{permissions.filter(x=>x.vehicle_id===v.id).map(x=>x.areas?.code || x.areas?.name).filter(Boolean).join(", ") || "Fleet permissions: unrestricted / not mapped"}</div>
              </div>;
            })}
            {!selectedVehicles.length && <div className="bulk-no-buildings"><Truck size={34}/><b>Fleet board is empty</b><span>Choose your default Vans / Pickups. The app will not place every Fleet vehicle here automatically.</span></div>}
          </div>
        </section>

        <section className="bulk-game-section">
          <div className="bulk-game-section-head">
            <div><div className="bulk-section-kicker">LEVEL 03 · ORDERS</div><h2>Today's Pallets / Invoices</h2><p>Orders appear only on their scheduled date. Drag a pallet or a whole invoice into an eligible vehicle.</p></div>
            <div className="bulk-order-tools"><div className="bulk-search"><Search size={14}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customer / invoice…"/></div><GlassButton variant="secondary" size="sm" onClick={()=>setShowCustomerManager(x=>!x)}><Users size={14}/>{showCustomerManager?"Close":"Customers"}</GlassButton><GlassButton variant="secondary" size="sm" onClick={()=>setShowScheduleManager(x=>!x)}><CalendarDays size={14}/>{showScheduleManager?"Close":"Schedules"}</GlassButton></div>
          </div>

          {showCustomerManager && <GlassCard className="bulk-builder-panel">
            <div className="bulk-builder-row">
              <input list="bulk-customer-library" value={customerForm.name} placeholder="Customer name…" onChange={e=>setCustomerForm({...customerForm,name:e.target.value})}/>
              <select value={customerForm.area} onChange={e=>setCustomerForm({...customerForm,area:e.target.value})}><option value="">Area</option>{areas.map(a=><option key={a.id} value={a.name}>{a.code} · {a.name}</option>)}</select>
              <select value={customerForm.division} onChange={e=>setCustomerForm({...customerForm,division:e.target.value})}><option value="">Division</option><option>Pharma</option><option>Consumer</option></select>
              <GlassButton size="sm" onClick={addCustomer}><Plus size={14}/> Add Customer</GlassButton>
            </div>
          </GlassCard>}

          {showScheduleManager && <GlassCard className="bulk-builder-panel">
            <div className="bulk-schedule-editor">
              <input list="bulk-customer-library" value={scheduleForm.customer_name} placeholder="Customer…" onChange={e=>setScheduleForm({...scheduleForm,customer_name:e.target.value})}/>
              <select value={scheduleForm.area} onChange={e=>setScheduleForm({...scheduleForm,area:e.target.value})}><option value="">Area</option>{areas.map(a=><option key={a.id} value={a.name}>{a.code} · {a.name}</option>)}</select>
              <select value={scheduleForm.division} onChange={e=>setScheduleForm({...scheduleForm,division:e.target.value})}><option value="">Division</option><option>Pharma</option><option>Consumer</option></select>
              <div className="bulk-day-picker">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d,i)=><button key={d} className={scheduleForm.days.includes(i)?"active":""} onClick={()=>setScheduleForm(x=>({...x,days:x.days.includes(i)?x.days.filter(y=>y!==i):[...x.days,i]}))}>{d}</button>)}</div>
              <GlassButton size="sm" onClick={addSchedule}><Plus size={14}/> Add Schedule</GlassButton>
            </div>
            <div className="bulk-schedule-list">{(defaults.customer_schedules||[]).map(s=><span key={s.id}><b>{s.customer_name}</b> · {s.days.map((d: number)=>["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]).join(", ")}</span>)}</div>
          </GlassCard>}

          <div className="bulk-order-board" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const raw=e.dataTransfer.getData("text/plain");const d=dragged || (raw?{type:"pallet" as const,id:raw}:null);if(!d)return;if(d.type==="pallet")assignPallet(d.id,null);else if(d.type==="invoice")assignInvoice(d.id,null);setDragged(null);}}>
            {visibleInvoices.map(i => {
              const loaded = Array.from({length:Math.max(1,i.pallets)}).filter((_,k)=>!!assignments[`${i.id}::${k}`]).length;
              return <div key={i.id} className="bulk-order-tower" draggable onDragStart={()=>setDragged({type:"invoice",id:i.id})} onDragEnd={()=>setDragged(null)}>
                <div className="bulk-order-head"><span className="bulk-invoice-icon"><Package size={16}/></span><div><b>{i.customer_name}</b><span>{i.invoice_no} · {i.area || "Area not set"}</span></div><span className="bulk-order-date">{i.scheduled_date}</span><button className="btn icon-btn" onClick={e=>{e.stopPropagation();editInvoice(i)}}><Pencil size={13}/></button><button className="btn icon-btn" onClick={e=>{e.stopPropagation();deleteInvoice(i.id)}}><Trash2 size={13}/></button></div>
                <div className="bulk-order-meta"><span>{i.division}</span><span>{i.pallets} pallets</span><span>{loaded} loaded</span><span>{i.vehicle_id ? `Vehicle ${vehicleMap.get(i.vehicle_id)?.number || ""}` : "Waiting for vehicle"}</span></div>
                <div className="bulk-pallet-rack">{Array.from({length:Math.max(1,i.pallets)}).map((_,k)=>{const key=`${i.id}::${k}`;return <div key={key} draggable onDragStart={e=>{e.stopPropagation();e.dataTransfer.setData("text/plain",key);setDragged({type:"pallet",id:key})}} className={`bulk-pallet-3d ${assignments[key]?"loaded":""}`}><div className="pallet-box"/><span>P{k+1}</span></div>})}</div>
              </div>;
            })}
            {!visibleInvoices.length && <div className="bulk-no-buildings"><Package size={34}/><b>No orders for {date}</b><span>Add an invoice above or import/use today's SAP invoice facts.</span></div>}
          </div>

          <div className="bulk-invoice-entry glass-card">
            <div className="bulk-section-kicker">ADD / EDIT INVOICE</div>
            <div className="bulk-invoice-form">
              <input value={invoiceForm.invoice_no} placeholder="Invoice no." onChange={e=>setInvoiceForm({...invoiceForm,invoice_no:e.target.value})}/>
              <div className="bulk-predictive"><input list="bulk-customer-library" value={invoiceForm.customer_name} placeholder="Predictive customer…" onChange={e=>{const name=e.target.value;const c=customers.find(x=>norm(x.name)===norm(name));setInvoiceForm({...invoiceForm,customer_name:name,customer_id:c?.id||"",area:c?.area||invoiceForm.area,division:c?.division||invoiceForm.division})}}/></div>
              <select value={invoiceForm.area} onChange={e=>setInvoiceForm({...invoiceForm,area:e.target.value})}><option value="">Area</option>{areas.map(a=><option key={a.id} value={a.name}>{a.code} · {a.name}</option>)}</select>
              <select value={invoiceForm.division} onChange={e=>setInvoiceForm({...invoiceForm,division:e.target.value})}><option value="">Division</option><option>Pharma</option><option>Consumer</option></select>
              <input type="number" min={1} value={invoiceForm.pallets} onChange={e=>setInvoiceForm({...invoiceForm,pallets:Math.max(1,Number(e.target.value))})} placeholder="Pallets"/>
              <input type="date" value={invoiceForm.invoice_date} onChange={e=>setInvoiceForm({...invoiceForm,invoice_date:e.target.value})}/>
              <input type="date" value={invoiceForm.schedule_date} onChange={e=>setInvoiceForm({...invoiceForm,schedule_date:e.target.value})}/>
              <GlassButton size="sm" onClick={editingInvoice?updateInvoice:addInvoice}>{editingInvoice?<Check size={14}/>:<Plus size={14}/>} {editingInvoice?"Update":"Add"} Invoice</GlassButton>
            </div>
          </div>
        </section>
      </main>
    </div>

    <datalist id="bulk-customer-library">{Array.from(new Set([...customerLibrary,...customers.map(c=>c.name)])).map(c=><option key={c} value={c}/>)}</datalist>
  </div>;
}
