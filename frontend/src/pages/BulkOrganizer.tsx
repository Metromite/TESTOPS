import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell, Building2, CalendarDays, CarFront, Check, ChevronLeft, ChevronRight,
  CircleAlert, Database, GripVertical, Hospital, MapPin, Package, Pencil,
  Plus, RefreshCw, Save, Search, ShieldCheck, Store, Trash2, Truck, Users, X, ChevronDown,
  UserRound, Gauge, Route, Sparkles, ListChecks
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { getAppearanceConfig, getWallpaperUrl } from "../services/wallpaper";
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
const nextMonthKey = (date: string) => { const d = new Date(`${date.slice(0,7)}-01T12:00:00`); d.setMonth(d.getMonth()+1); return dateKey(d); };
const dayLabel = (date: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00`));
const divisionFor = (row: any) => { const d = norm(row.division_desc); if (d.includes("PHARMA")) return "Pharma"; if (d.includes("CONSUMER")) return "Consumer"; return row.division_desc || "Unknown"; };
const defaultCapacity = (typeOrVehicle: any) => {
  const v = typeof typeOrVehicle === "object" ? typeOrVehicle : null;
  if (v) {
    const pallets = Number(v.pallet_capacity ?? v.capacity_pallets ?? v.capacity ?? 0);
    if (Number.isFinite(pallets) && pallets > 0) return pallets;
    const tons = Number(v.capacity_tons ?? v.tonnage ?? v.tons ?? 0);
    if (tons > 0) return Math.max(1, Math.round(tons * 2));
    return isVan(v.type) ? 20 : isPickup(v.type) ? 10 : 10;
  }
  return isVan(typeOrVehicle) ? 20 : isPickup(typeOrVehicle) ? 10 : 10;
};

type Building = {
  id: string; name: string; division?: string; type: "warehouse" | "hospital" | "store" | "other" | "custom";
  custom_type?: string;
  area: string; enabled: boolean; note?: string; schedule_days?: number[]; schedule_dates?: string[]; sort_order?: number;
};
type CustomerSchedule = {
  id: string; customer_name: string; days: number[]; area: string; division: string; building_id?: string | null; enabled: boolean;
};
type InvoicePlan = {
  id: string; invoice_no: string; customer_id: string; customer_name: string; area: string;
  division: string; pallets: number; invoice_date: string | null; scheduled_date: string | null; vehicle_id: string | null; building_id?: string | null;
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
  const [divisionView, setDivisionView] = useState<"Pharma" | "Consumer">("Pharma");
  const [fleet, setFleet] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [facts, setFacts] = useState<any[]>([]);
  const [customerLibrary, setCustomerLibrary] = useState<string[]>([]);
  const [driverLibrary, setDriverLibrary] = useState<any[]>([]);
  const [helperLibrary, setHelperLibrary] = useState<any[]>([]);
  const [waitingInvoices, setWaitingInvoices] = useState<InvoicePlan[]>([]);
  const [plan, setPlan] = useState<PlanV3>(emptyPlan(date));
  const [defaults, setDefaults] = useState<DefaultsV2>({ buildings: [], vehicles: [], customer_schedules: [] });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [defaultsSaved, setDefaultsSaved] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [dragged, setDragged] = useState<{ type: "invoice" | "pallet" | "vehicle" | "customer" | "store"; id: string } | null>(null);
  const [worldZoom, setWorldZoom] = useState(1);
  const initialBulkTheme = document.documentElement.getAttribute("data-theme") || (document.documentElement.classList.contains("dark") ? "dark" : "light");
  const [bulkWallpaper, setBulkWallpaper] = useState<string | null>(() => {
    try { return localStorage.getItem(`bulk-wallpaper-${initialBulkTheme === "light" ? "light" : "dark"}`); } catch { return null; }
  });
  const [bulkTheme, setBulkTheme] = useState(initialBulkTheme);
  const planRef = useRef<PlanV3>(plan);
  const defaultsRef = useRef<DefaultsV2>(defaults);
  const autoSaveTimer = useRef<number | null>(null);
  const autoDefaultsTimer = useRef<number | null>(null);
  const hydratedDateRef = useRef<string>("");
  const savingPlanRef = useRef(false);
  const savingDefaultsRef = useRef(false);
  const [showFleet, setShowFleet] = useState(false);
  const [vehiclesExpanded, setVehiclesExpanded] = useState(false);
  const [customerSectionExpanded, setCustomerSectionExpanded] = useState(true);
  const [showBuildingEditor, setShowBuildingEditor] = useState(false);
  const [storeForm, setStoreForm] = useState({ name: "", type: "store" as Building["type"], custom_type: "", area: "", note: "", schedule_days: [] as number[], schedule_dates: "", division: "" });
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [storeDatePicker, setStoreDatePicker] = useState("");
  const [invoiceBuildingLocked, setInvoiceBuildingLocked] = useState(false);
  const [invoiceCustomerLocked, setInvoiceCustomerLocked] = useState(false);
  const [showCustomerManager, setShowCustomerManager] = useState(false);
  const [showInvoiceManager, setShowInvoiceManager] = useState(false);
  const [showScheduleManager, setShowScheduleManager] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<InvoicePlan | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({ invoice_no: "", customer_id: "", customer_name: "", area: "", division: "", pallets: 1, invoice_date: "", schedule_date: "", building_id: "" });
  const [scheduleMode, setScheduleMode] = useState<"today" | "waiting" | "specific">("today");
  const [loadInvoiceTarget, setLoadInvoiceTarget] = useState<InvoicePlan | null>(null);
  const [showBatchLoadModal, setShowBatchLoadModal] = useState(false);
  const [invoiceBatchMode, setInvoiceBatchMode] = useState(false);
  const [invoiceBatchRows, setInvoiceBatchRows] = useState<Array<typeof invoiceForm>>([]);
  const [batchIncludeWaiting, setBatchIncludeWaiting] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([]);
  const [batchBuildingId, setBatchBuildingId] = useState<string | null>(null);
  const [batchVehicleIds, setBatchVehicleIds] = useState<string[]>([]);
  const [batchLoadMode, setBatchLoadMode] = useState<"full" | "partial">("full");
  const [batchPartialQuantities, setBatchPartialQuantities] = useState<Record<string, number>>({});
  const [loadVehicleId, setLoadVehicleId] = useState("");
  const [loadQuantity, setLoadQuantity] = useState(1);
  const [manageVehicleId, setManageVehicleId] = useState<string | null>(null);
  const [buildingForm, setBuildingForm] = useState<Building>({ id: "", name: "", type: "warehouse", area: "", enabled: true });
  const [customerForm, setCustomerForm] = useState({ name: "", area: "", division: "" });
  const [scheduleForm, setScheduleForm] = useState({ customer_name: "", days: [] as number[], area: "", division: "", building_id: "" });

  useEffect(() => { planRef.current = plan; }, [plan]);
  useEffect(() => { defaultsRef.current = defaults; }, [defaults]);

  // Persist every meaningful Bulk Organizer edit automatically. Loading a date is
  // deliberately excluded so a hydration pass can never overwrite the server.
  useEffect(() => {
    if (loading || hydratedDateRef.current !== date) return;
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = window.setTimeout(async () => {
      if (savingPlanRef.current) return;
      savingPlanRef.current = true;
      try { await saveBulkOrganizerPlan({ ...planRef.current, pallets: planRef.current.invoices || [] }); }
      catch (e: any) { setError(e?.message || "Automatic save failed"); }
      finally { savingPlanRef.current = false; }
    }, 450);
    return () => { if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current); };
  }, [plan, loading, date]);

  // Monthly defaults are saved explicitly by the "Save selected as monthly defaults"
  // action. Do not autosave this state: doing so could persist a transient/stale
  // picker state while a daily plan is being hydrated.

  async function loadSourceData(selectedDate: string) {
    setLoading(true); setError("");
    const mk = monthKey(selectedDate);
    try {
      // Phase 1: hydrate the saved planner immediately. The heavy SAP/month queries
      // must never block the first paint of the page.
      const [v, a, p, saved, savedDefaults] = await Promise.all([
        supabase.from("vehicles").select("*").order("number"),
        supabase.from("areas").select("id,code,name,sector,region,route_type,vehicle_type").order("code"),
        supabase.from("vehicle_permitted_areas").select("vehicle_id,area_id,areas(id,code,name)"),
        loadBulkOrganizerPlan(selectedDate),
        loadBulkOrganizerDefaults(mk).catch(() => null),
      ]);
      if (v.error) throw v.error; if (a.error) throw a.error; if (p.error) throw p.error;

      const active = (v.data ?? []).filter((x: any) => String(x.status ?? "Active").toLowerCase() !== "under service");
      const loadedDefaults = (savedDefaults || { buildings: [], vehicles: [], customer_schedules: [] }) as DefaultsV2;
      const old = (saved || {}) as PlanV3;
      const dailyBuildings = old.buildings || [];
      const defaultBuildings = loadedDefaults.buildings || [];
      const planBuildings = defaultBuildings.length ? [
        ...defaultBuildings.map(db => { const daily = dailyBuildings.find(b => b.id === db.id); return daily ? { ...daily, schedule_days: db.schedule_days || [], schedule_dates: db.schedule_dates || [] } : db; }),
        ...dailyBuildings.filter(db => !defaultBuildings.some(b => b.id === db.id)),
      ] : dailyBuildings;
      const dailySchedules = old.customer_schedules || [];
      const defaultSchedules = loadedDefaults.customer_schedules || [];
      const planSchedules = defaultSchedules.length ? [
        ...defaultSchedules.map(ds => { const daily = dailySchedules.find(s => s.id === ds.id || (s.building_id && ds.building_id && s.building_id === ds.building_id)); return daily ? { ...daily, days: ds.days || [] } : ds; }),
        ...dailySchedules.filter(ds => !defaultSchedules.some(s => s.id === ds.id || (s.building_id && ds.building_id && s.building_id === ds.building_id))),
      ] : dailySchedules;
      const storedInvoicesRaw = [
        ...(Array.isArray((old as any).invoices) ? (old as any).invoices : []),
        ...(Array.isArray((old as any).pallets) ? (old as any).pallets : []),
      ];
      const storedInvoices = Array.from(new Map(storedInvoicesRaw.map((x: any) => [String(x?.id || x?.invoice_no || crypto.randomUUID()), x])).values());
      const savedInvoices = storedInvoices.filter((x: any) => !x.scheduled_date || x.scheduled_date === selectedDate);
      const customerMap = new Map<string, any>();
      savedInvoices.forEach((i: any) => customerMap.set(i.customer_id || `manual:${norm(i.customer_name)}`, { id: i.customer_id || `manual:${norm(i.customer_name)}`, name: i.customer_name, area: i.area, division: i.division, enabled: true }));
      (old.customers || []).forEach(c => customerMap.set(c.id, c));
      planSchedules.forEach(s => { const id = s.id || `schedule:${norm(s.customer_name)}`; if (!customerMap.has(`schedule:${norm(s.customer_name)}`)) customerMap.set(`schedule:${norm(s.customer_name)}`, { id, name: s.customer_name, area: s.area, division: s.division, enabled: true }); });
      const assignments: Record<string, string | null> = { ...(old.pallet_assignments || {}) };
      savedInvoices.forEach(i => { for (let k = 0; k < Math.max(1, Number(i.pallets || 0)); k++) { const key = `${i.id}::${k}`; if (!(key in assignments)) assignments[key] = i.vehicle_id || null; } });
      const defaultVehicles = loadedDefaults.vehicles.filter(x => active.some(vh => vh.id === x.vehicle_id));
      const savedVehicles = (old.vehicles || []).filter(x => active.some(vh => vh.id === x.vehicle_id));
      const effectiveVehicles = savedVehicles.length ? savedVehicles : defaultVehicles;
      const vehicleMeta = { ...(old.vehicle_meta || {}) };
      defaultVehicles.forEach(vh => { vehicleMeta[vh.vehicle_id] = { ...(vehicleMeta[vh.vehicle_id] || {}), driver: vehicleMeta[vh.vehicle_id]?.driver || vh.driver || "", helper: vehicleMeta[vh.vehicle_id]?.helper || vh.helper || "" }; });

      setFleet(active); setAreas(a.data ?? []); setPermissions(p.data ?? []);
      setDefaults({ ...loadedDefaults });
      setWaitingInvoices([]); setFacts([]); setCustomerLibrary([]); setDriverLibrary([]); setHelperLibrary([]);
      setPlan({ ...emptyPlan(selectedDate), ...old, plan_date: selectedDate, vehicles: effectiveVehicles, customers: Array.from(customerMap.values()), invoices: savedInvoices as any, pallets: savedInvoices as any, pallet_assignments: assignments, buildings: planBuildings, vehicle_meta: vehicleMeta, customer_schedules: planSchedules });
      hydratedDateRef.current = "";
      setLoading(false);

      // Phase 2: enrich the already-visible planner with SAP facts and month waiting
      // data. These queries are intentionally off the critical first-render path.
      const f = await supabase.from("sap_invoice_facts").select("id,invoice_no,invoice_date,dispatch_date,customer_name,area,boxes,division_desc,vehicle_num,vehicle_type,salesman").or(`dispatch_date.eq.${selectedDate},invoice_date.eq.${selectedDate}`).order("customer_name");
      if (f.error) throw f.error;
      if (selectedDate !== date) return;
      setFacts(f.data ?? []);

      const sourceInvoices: InvoicePlan[] = (f.data ?? []).map((r: any, i: number) => ({
        id: `${r.invoice_no || r.id || i}`, invoice_no: r.invoice_no || `INV-${i + 1}`,
        customer_id: `customer:${norm(r.customer_name || "unknown")}`, customer_name: r.customer_name || "Unknown customer",
        area: r.area || "", division: divisionFor(r), pallets: Math.max(1, Number(r.boxes || 1)), invoice_date: r.invoice_date || null,
        scheduled_date: selectedDate, vehicle_id: null,
      }));
      const currentPlan = planRef.current;
      const oldNow = (currentPlan || {}) as PlanV3;
      const storedRaw = [ ...(Array.isArray((oldNow as any).invoices) ? (oldNow as any).invoices : []), ...(Array.isArray((oldNow as any).pallets) ? (oldNow as any).pallets : []) ];
      const stored = Array.from(new Map(storedRaw.map((x: any) => [String(x?.id || x?.invoice_no || crypto.randomUUID()), x])).values());
      const savedNow = stored.filter((x: any) => !x.scheduled_date || x.scheduled_date === selectedDate);
      const merged: InvoicePlan[] = sourceInvoices.map(src => {
        const sv = savedNow.find((x: any) => norm(x.invoice_no) === norm(src.invoice_no));
        if (!sv) return src;
        const savedDivision = String(sv.division || '').trim();
        const scheduledDivision = loadedDefaults.customer_schedules.find((cs: any) => norm(cs.customer_name) === norm(sv.customer_name || src.customer_name))?.division;
        return { ...src, ...sv, scheduled_date: selectedDate, customer_name: sv.customer_name || src.customer_name, area: sv.area || src.area, division: savedDivision && norm(savedDivision) !== 'UNKNOWN' ? savedDivision : (scheduledDivision || src.division), building_id: sv.building_id || src.building_id || null };
      });
      savedNow.forEach((sv: any) => { if (!merged.some(x => x.id === sv.id || norm(x.invoice_no) === norm(sv.invoice_no))) { const sd = loadedDefaults.customer_schedules.find((cs: any) => norm(cs.customer_name) === norm(sv.customer_name))?.division; merged.push({ ...sv, scheduled_date: sv.scheduled_date || null, vehicle_id: sv.vehicle_id || null, division: (sv.division && norm(sv.division) !== 'UNKNOWN') ? sv.division : (sd || sv.division || 'Unknown') }); } });
      const nextAssignments: Record<string, string | null> = { ...(oldNow.pallet_assignments || {}) };
      merged.forEach(i => { for (let k = 0; k < Math.max(1, Number(i.pallets || 0)); k++) { const key = `${i.id}::${k}`; if (!(key in nextAssignments)) nextAssignments[key] = i.vehicle_id || null; } });
      const customerMap2 = new Map<string, any>();
      merged.forEach(i => customerMap2.set(i.customer_id, customerMap2.get(i.customer_id) || { id: i.customer_id, name: i.customer_name, area: i.area, division: i.division, enabled: true }));
      (oldNow.customers || []).forEach(c => customerMap2.set(c.id, c));
      loadedDefaults.customer_schedules.forEach(s => { const id = s.id || `schedule:${norm(s.customer_name)}`; if (!customerMap2.has(`schedule:${norm(s.customer_name)}`)) customerMap2.set(`schedule:${norm(s.customer_name)}`, { id, name: s.customer_name, area: s.area, division: s.division, enabled: true }); });
      setPlan(x => ({ ...x, invoices: merged, pallets: merged as any, customers: Array.from(customerMap2.values()), pallet_assignments: nextAssignments }));

      // Secondary libraries do not block the invoice cards. They can arrive a little later.
      const [allCustomers, d, h, monthPlans] = await Promise.all([
        supabase.from("sap_invoice_facts").select("customer_name").not("customer_name", "is", null).order("customer_name").limit(5000),
        supabase.from("drivers").select("id,code,name,status").order("name"),
        supabase.from("helpers").select("id,code,name,status").order("name"),
        supabase.from("bulk_organizer_plans").select("plan_date,invoices").gte("plan_date", mk).lt("plan_date", nextMonthKey(selectedDate)),
      ]);
      if (selectedDate !== date) return;
      setDriverLibrary((d as any)?.data || []); setHelperLibrary((h as any)?.data || []);
      setCustomerLibrary(Array.from(new Set((allCustomers.data ?? []).map((x: any) => String(x.customer_name || "").trim()).filter(Boolean))));
      const monthWaiting: InvoicePlan[] = [];
      for (const row of ((monthPlans as any)?.data || [])) for (const inv of ((row as any).invoices || [])) if (!inv?.scheduled_date) monthWaiting.push({ ...inv, scheduled_date: null, vehicle_id: null });
      setWaitingInvoices(monthWaiting);
      hydratedDateRef.current = selectedDate;
    } catch (e: any) {
      setError(e?.message || "Could not load Bulk Organizer data.");
      setLoading(false);
    }
  }

  useEffect(() => { void loadSourceData(date); }, [date]);

  useEffect(() => {
    const syncTheme = () => setBulkTheme(document.documentElement.getAttribute("data-theme") || (document.documentElement.classList.contains("dark") ? "dark" : "light"));
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    syncTheme();
    return () => observer.disconnect();
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
  const allPlanInvoices = plan.invoices || [];
  const invoices = allPlanInvoices.filter(i => i.scheduled_date === date && norm(i.division) === norm(divisionView));
  const allTodayInvoices = allPlanInvoices.filter(i => i.scheduled_date === date);
  const waiting = [...waitingInvoices, ...allPlanInvoices.filter(i => !i.scheduled_date && !waitingInvoices.some(w => w.id === i.id))].filter(i => norm(i.division) === norm(divisionView));
  const customers = plan.customers || [];
  const selectedVehicles = plan.vehicles || [];
  const assignments = plan.pallet_assignments || {};
  const totalPallets = invoices.reduce((n, i) => n + Number(i.pallets || 0), 0);
  const loadedPallets = Object.entries(assignments).filter(([k,v]) => !!v && invoices.some(i => k.startsWith(`${i.id}::`))).length;
  const pendingPallets = Math.max(0, totalPallets - loadedPallets);
  const todayDow = new Date(`${date}T12:00:00`).getDay();
  const visibleInvoices = invoices.filter(i => !search || [i.invoice_no, i.customer_name, i.area, i.division].some(v => norm(v).includes(norm(search))));

  const alertGroups = useMemo(() => {
    const groups: { id:string; title:string; items:{id:string; title:string; text:string; tone:"blue"|"amber"|"green"}[] }[] = [];
    const byBuilding = (buildingId: string | null | undefined) => (plan.buildings || []).find(b => b.id === buildingId);
    const buildingIds = Array.from(new Set([...invoices.map(i=>i.building_id).filter(Boolean), ...waiting.map(i=>i.building_id).filter(Boolean)]));
    for (const bid of buildingIds) {
      const b = byBuilding(bid as string); if (!b) continue;
      const today = invoices.filter(i=>i.building_id===b.id);
      const wait = waiting.filter(i=>i.building_id===b.id);
      const items = [
        ...(today.length ? [{ id:`today-${b.id}`, title:"Schedule for today", text:`${today.length} invoice${today.length===1?"":"s"} · ${today.reduce((n,i)=>n+Number(i.pallets||0),0)} pallets`, tone:"green" as const }] : []),
        ...(wait.length ? [{ id:`waiting-${b.id}`, title:"Waiting for schedule", text:`${wait.length} invoice${wait.length===1?"":"s"} waiting`, tone:"amber" as const }] : []),
      ];
      if (items.length) groups.push({ id:b.id, title:b.name, items });
    }
    if (pendingPallets) groups.push({ id:"allocation", title:"Allocation", items:[{id:"pending",title:"Pallets waiting",text:`${pendingPallets} pallet${pendingPallets===1?"":"s"} still need a vehicle`,tone:"amber"}] });
    return groups;
  }, [plan.buildings, invoices, waiting, pendingPallets]);

  // Bulk Organizer is intentionally unrestricted by Consumer/Pharma, area, or
  // vehicle-type compatibility. Any scheduled customer/invoice can be loaded
  // into any selected van; only the van's actual pallet capacity is enforced.
  function vehiclePermission(_invoice: InvoicePlan, _vehicle: any) {
    return { ok: true, text: "Permitted" };
  }

  const persistPlanNow = (next: PlanV3) => {
    void saveBulkOrganizerPlan({ ...next, pallets: next.invoices || [] }).catch((e: any) => setError(e?.message || "Automatic save failed"));
  };

  const assignedCountOnVehicle = (inv: InvoicePlan, vehicleId: string) =>
    Array.from({ length: Math.max(1, Number(inv.pallets || 0)) }).filter((_, k) => assignments[`${inv.id}::${k}`] === vehicleId).length;

  function removeInvoicePallets(inv: InvoicePlan, vehicleId: string, qty: number) {
    const nextAssignments = { ...(planRef.current.pallet_assignments || {}) };
    let left = Math.max(0, Math.min(qty, assignedCountOnVehicle(inv, vehicleId)));
    for (let k = Math.max(1, Number(inv.pallets || 0)) - 1; k >= 0 && left > 0; k--) {
      const key = `${inv.id}::${k}`;
      if (nextAssignments[key] === vehicleId) { delete nextAssignments[key]; left--; }
    }
    const remainingLoaded = Array.from({ length: Math.max(1, Number(inv.pallets || 0)) }, (_, k) => nextAssignments[`${inv.id}::${k}`]).filter(Boolean);
    const uniqueVehicles = Array.from(new Set(remainingLoaded));
    const next = { ...planRef.current, pallet_assignments: nextAssignments,
      invoices: (planRef.current.invoices || []).map(i => i.id === inv.id ? { ...i, vehicle_id: remainingLoaded.length === Number(i.pallets || 0) && uniqueVehicles.length === 1 ? String(uniqueVehicles[0]) : null } : i) };
    setPlan(next); persistPlanNow(next); setError("");
  }

  function moveInvoicePallets(inv: InvoicePlan, fromVehicleId: string, toVehicleId: string, qty: number) {
    if (!toVehicleId || fromVehicleId === toVehicleId) return;
    const fromCount = assignedCountOnVehicle(inv, fromVehicleId);
    const amount = Math.max(1, Math.min(fromCount, Number(qty || 1)));
    const cfg = selectedVehicles.find(x => x.vehicle_id === toVehicleId);
    const vehicle = vehicleMap.get(toVehicleId);
    if (!cfg || !vehicle) return;
    const free = Math.max(0, capacityFor(cfg, vehicle) - loadedByVehicle(toVehicleId));
    if (amount > free) { setError(`${vehicle.number}: only ${free} pallet space left.`); return; }
    const nextAssignments = { ...(planRef.current.pallet_assignments || {}) };
    const sourceKeys: string[] = [];
    for (let k = Math.max(1, Number(inv.pallets || 0)) - 1; k >= 0 && sourceKeys.length < amount; k--) {
      if (nextAssignments[`${inv.id}::${k}`] === fromVehicleId) sourceKeys.push(`${inv.id}::${k}`);
    }
    sourceKeys.forEach(k => { nextAssignments[k] = toVehicleId; });
    const loadedNow = Array.from({ length: Math.max(1, Number(inv.pallets || 0)) }, (_, k) => nextAssignments[`${inv.id}::${k}`]).filter(Boolean);
    const uniqueVehicles = Array.from(new Set(loadedNow));
    const next = { ...planRef.current, pallet_assignments: nextAssignments,
      invoices: (planRef.current.invoices || []).map(i => i.id === inv.id ? { ...i, vehicle_id: loadedNow.length === Number(i.pallets || 0) && uniqueVehicles.length === 1 ? String(uniqueVehicles[0]) : null } : i) };
    setPlan(next); persistPlanNow(next); setError(""); setManageVehicleId(null); closeInvoiceLoadModal();
  }

  function assignPallet(id: string, vehicleId: string | null) {
    setPlan(x => {
      const assignments = { ...(x.pallet_assignments || {}), [id]: vehicleId };
      const invoiceId = id.split("::")[0];
      const inv = (x.invoices || []).find(i => i.id === invoiceId);
      const allLoaded = inv ? Array.from({ length: Math.max(1, inv.pallets) }).every((_, k) => !!assignments[`${invoiceId}::${k}`]) : false;
      const next = { ...x, pallet_assignments: assignments, invoices: (x.invoices || []).map(i => i.id === invoiceId ? { ...i, vehicle_id: allLoaded ? vehicleId : null } : i) };
      persistPlanNow(next);
      return next;
    });
  }

  function assignInvoice(id: string, vehicleId: string | null) {
    setPlan(x => {
      const assignments = { ...(x.pallet_assignments || {}) };
      const inv = (x.invoices || []).find(i => i.id === id);
      if (inv) for (let k = 0; k < Math.max(1, inv.pallets); k++) assignments[`${id}::${k}`] = vehicleId;
      const next = { ...x, pallet_assignments: assignments, invoices: (x.invoices || []).map(i => i.id === id ? { ...i, vehicle_id: vehicleId } : i) };
      persistPlanNow(next);
      return next;
    });
  }

  function openBatchLoadModal(buildingId?: string) {
    const scheduled = allPlanInvoices.filter(i =>
      i.scheduled_date === date &&
      invoiceLoaded(i) < Number(i.pallets || 0) &&
      (!buildingId || i.building_id === buildingId)
    );
    setBatchBuildingId(buildingId || null);
    setBatchIncludeWaiting(false);
    setBatchSelectedIds(scheduled.map(i => i.id));
    setBatchVehicleIds(selectedVehicles.map(v => v.vehicle_id));
    setBatchLoadMode("full");
    setBatchPartialQuantities(Object.fromEntries(scheduled.map(i => [i.id, Math.max(1, Number(i.pallets || 0) - invoiceLoaded(i))])));
    setShowBatchLoadModal(true);
    setError("");
  }

  function closeBatchLoadModal() {
    setShowBatchLoadModal(false);
    setBatchIncludeWaiting(false);
    setBatchSelectedIds([]);
    setBatchBuildingId(null);
    setBatchVehicleIds([]);
    setBatchLoadMode("full");
    setBatchPartialQuantities({});
  }

  function toggleBatchInvoice(id: string) {
    setBatchSelectedIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  }

  function confirmBatchLoad() {
    const candidates = [
      ...allPlanInvoices.filter(i => i.scheduled_date === date && (!batchBuildingId || i.building_id === batchBuildingId)),
      ...(batchIncludeWaiting ? waiting.filter(i => !batchBuildingId || i.building_id === batchBuildingId) : [])
    ];
    const selected = candidates.filter((i, idx, arr) => batchSelectedIds.includes(i.id) && arr.findIndex(x => x.id === i.id) === idx);
    if (!selected.length) { setError("Select at least one invoice to load."); return; }
    const batchVehicles = selectedVehicles.filter(v => batchVehicleIds.includes(v.vehicle_id));
    if (!batchVehicles.length) { setError("Select at least one vehicle for this batch load."); return; }

    const nextAssignments = { ...(planRef.current.pallet_assignments || {}) };
    const usedByVehicle = new Map<string, number>();
    batchVehicles.forEach(cfg => usedByVehicle.set(cfg.vehicle_id, loadedByVehicle(cfg.vehicle_id)));
    const loaded: string[] = [];
    const skipped: string[] = [];

    for (const inv of selected) {
      const remainingTotal = Math.max(0, Number(inv.pallets || 0) - invoiceLoaded(inv));
      if (!remainingTotal) continue;
      const requested = batchLoadMode === "partial"
        ? Math.min(remainingTotal, Math.max(1, Number(batchPartialQuantities[inv.id] || 1)))
        : remainingTotal;
      let remaining = requested;
      let placed = 0;
      for (const cfg of batchVehicles) {
        const vehicle = vehicleMap.get(cfg.vehicle_id);
        if (!vehicle || remaining <= 0) continue;
        const permission = vehiclePermission(inv, vehicle);
        if (!permission.ok) continue;
        const cap = capacityFor(cfg, vehicle);
        const used = usedByVehicle.get(vehicle.id) || 0;
        const room = Math.max(0, cap - used);
        const qty = Math.min(room, remaining);
        const beforeVehicle = placed;
        for (let k = 0; k < Math.max(1, inv.pallets) && placed < requested; k++) {
          const key = `${inv.id}::${k}`;
          if (!nextAssignments[key] && placed - beforeVehicle < qty) { nextAssignments[key] = vehicle.id; placed++; }
        }
        const placedOnVehicle = placed - beforeVehicle;
        usedByVehicle.set(vehicle.id, used + placedOnVehicle);
        remaining -= placedOnVehicle;
      }
      if (remaining === 0) loaded.push(inv.invoice_no);
      else skipped.push(inv.invoice_no);
    }

    if (loaded.length) {
      const next = {
        ...planRef.current,
        pallet_assignments: nextAssignments,
        invoices: (planRef.current.invoices || []).map(i => {
          const total = Math.max(1, Number(i.pallets || 0));
          const assigned = Array.from({ length: total }, (_, k) => nextAssignments[`${i.id}::${k}`]).filter(Boolean);
          const vehicles = Array.from(new Set(assigned));
          return selected.some(x => x.id === i.id)
            ? { ...i, vehicle_id: vehicles.length === 1 && assigned.length >= total ? String(vehicles[0]) : null }
            : i;
        })
      };
      setPlan(next);
      persistPlanNow(next);
    }

    closeBatchLoadModal();
    setError(skipped.length
      ? `Loaded ${loaded.length} invoice${loaded.length === 1 ? "" : "s"}. Could not fully load: ${skipped.slice(0, 4).join(", ")}${skipped.length > 4 ? "…" : ""}.`
      : `Loaded ${loaded.length} invoice${loaded.length === 1 ? "" : "s"}.`);
  }

  function openInvoiceLoadModal(inv: InvoicePlan) {
    const remaining = Math.max(0, Number(inv.pallets || 0) - invoiceLoaded(inv));
    setManageVehicleId(null);
    if (!remaining) { setError(`${inv.invoice_no} is already fully loaded. Use a vehicle tag to move or remove pallets.`); return; }
    setLoadInvoiceTarget(inv);
    setLoadVehicleId(selectedVehicles[0]?.vehicle_id || "");
    setLoadQuantity(remaining);
    setError("");
  }

  function openInvoiceVehicleManager(inv: InvoicePlan, vehicleId: string) {
    setLoadInvoiceTarget(inv);
    setManageVehicleId(vehicleId);
    setLoadVehicleId(vehicleId);
    setLoadQuantity(Math.max(1, assignedCountOnVehicle(inv, vehicleId)));
    setError("");
  }

  function closeInvoiceLoadModal() {
    setLoadInvoiceTarget(null);
    setLoadVehicleId("");
    setLoadQuantity(1);
    setManageVehicleId(null);
  }

  function confirmInvoiceLoad() {
    const inv = loadInvoiceTarget;
    if (!inv) return;
    const vehicle = vehicleMap.get(loadVehicleId);
    const cfg = selectedVehicles.find(x => x.vehicle_id === loadVehicleId);
    if (!vehicle || !cfg) { setError("Select a vehicle first."); return; }
    const remaining = Math.max(0, Number(inv.pallets || 0) - invoiceLoaded(inv));
    const qty = Math.max(1, Math.min(remaining, Number(loadQuantity || 0)));
    const used = loadedByVehicle(loadVehicleId);
    const capacity = capacityFor(cfg, vehicle);
    if (used + qty > capacity) {
      setError(`${vehicle.number}: only ${Math.max(0, capacity - used)} pallet space left.`);
      return;
    }
    const nextAssignments = { ...(planRef.current.pallet_assignments || {}) };
    let left = qty;
    for (let k = 0; k < Math.max(1, inv.pallets) && left > 0; k++) {
      const key = `${inv.id}::${k}`;
      if (!nextAssignments[key]) { nextAssignments[key] = loadVehicleId; left--; }
    }
    const loadedNow = Array.from({ length: Math.max(1, inv.pallets) }, (_, k) => nextAssignments[`${inv.id}::${k}`]).filter(Boolean);
    const uniqueVehicles = Array.from(new Set(loadedNow));
    const next = {
      ...planRef.current,
      pallet_assignments: nextAssignments,
      invoices: (planRef.current.invoices || []).map(i => i.id === inv.id
        ? { ...i, vehicle_id: uniqueVehicles.length === 1 && loadedNow.length >= Number(i.pallets || 0) ? String(uniqueVehicles[0]) : null }
        : i)
    };
    setPlan(next);
    persistPlanNow(next);
    closeInvoiceLoadModal();
    setError("");
  }

  const isOthersStore = (store: Building) => norm(store.name) === "others";

  function openInvoiceForStore(store: Building) {
    const others = isOthersStore(store);
    setInvoiceBatchMode(true);
    setInvoiceBatchRows([]);
    const matched = customers.find(c => norm(c.name) === norm(store.name));
    setEditingInvoice(null); setInvoiceBuildingLocked(true); setInvoiceCustomerLocked(!others);
    setShowInvoiceManager(true); setScheduleMode("today");
    setInvoiceForm(x => ({ ...x, invoice_no: "", customer_id: matched?.id || "", customer_name: others ? "" : store.name, area: store.area || "", division: store.division || divisionView, pallets: 1, invoice_date: date, schedule_date: date, building_id: store.id }));
  }

  function openInvoiceForCustomer(customer: any, store: Building) {
    setInvoiceBatchMode(false);
    setInvoiceBatchRows([]);
    const matched = customers.find(c => c.id === customer.id) || customers.find(c => norm(c.name) === norm(customer.name));
    const others = isOthersStore(store);
    setEditingInvoice(null); setInvoiceBuildingLocked(true); setInvoiceCustomerLocked(!others);
    setShowInvoiceManager(true); setScheduleMode("today");
    setInvoiceForm(x => ({ ...x, invoice_no: "", customer_id: matched?.id || customer.id || "", customer_name: others ? "" : customer.name, area: customer.area || store.area || matched?.area || "", division: customer.division || store.division || divisionView, pallets: 1, invoice_date: date, schedule_date: date, building_id: store.id }));
  }

  function dropStoreOnVehicle(v: any, storeId: string) {
    const store = buildingCards.find(b => b.id === storeId);
    if (!store) return;
    const storeInvoices = invoices.filter(i => i.building_id === store.id);
    if (!storeInvoices.length) { setError(`No scheduled invoices for ${store.name} on ${date}.`); return; }
    const cfg = selectedVehicles.find(x => x.vehicle_id === v.id);
    const cap = capacityFor(cfg || { vehicle_id: v.id, capacity: defaultCapacity(v) }, v);
    let used = loadedByVehicle(v.id);
    for (const inv of storeInvoices) {
      const remaining = Math.max(0, Number(inv.pallets || 0) - invoiceLoaded(inv));
      if (!remaining) continue;
      const check = vehiclePermission(inv, v);
      if (!check.ok) { setError(`${v.number}: ${check.text} for ${inv.invoice_no}`); return; }
      if (used + remaining > cap) { setError(`${v.number}: only ${Math.max(0, cap - used)} pallet space left.`); return; }
      assignInvoice(inv.id, v.id);
      used += remaining;
    }
    setError("");
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
        : { ...x, vehicles: [...x.vehicles, { vehicle_id: v.id, capacity: defaultCapacity(v), driver: "", helper: "" }] });
      return;
    }
    setPlan(x => x.vehicles.some(z => z.vehicle_id === v.id)
      ? { ...x, vehicles: x.vehicles.filter(z => z.vehicle_id !== v.id), pallet_assignments: Object.fromEntries(Object.entries(x.pallet_assignments || {}).map(([k, val]) => [k, val === v.id ? null : val])) }
      : { ...x, vehicles: [...x.vehicles, { vehicle_id: v.id, capacity: defaultCapacity(v) }] });
    void listKey;
  }

  async function save() {
    setSaving(true); setError("");
    try { await saveBulkOrganizerPlan({ ...plan, pallets: invoices as any }); }
    catch (e: any) { setError(e?.message || "Save failed"); } finally { setSaving(false); }
  }
  async function saveDefaults() {
    setSavingDefaults(true); setDefaultsSaved(false); setError("");
    try {
      // The button means "make the vehicles currently selected for THIS DAY
      // the monthly defaults". The old implementation saved `defaults`,
      // which had not been updated by the fleet picker, and then replaced the
      // current day with that stale list. That is why selected vehicles
      // appeared to disappear immediately after saving.
      const nextDefaults: DefaultsV2 = {
        ...defaultsRef.current,
        month_key: monthKey(date),
        vehicles: (planRef.current.vehicles || []).map(v => ({ ...v, driver: planRef.current.vehicle_meta?.[v.vehicle_id]?.driver || v.driver || "", helper: planRef.current.vehicle_meta?.[v.vehicle_id]?.helper || v.helper || "" })),
        buildings: [...(planRef.current.buildings || [])],
        customer_schedules: [...(planRef.current.customer_schedules || [])],
      };
      const result = await saveBulkOrganizerDefaults(nextDefaults);
      setDefaults(result as DefaultsV2);
      // NEVER replace the current day's vehicle selection when saving a
      // monthly default. The selected day remains exactly as the user left it.
      setDefaultsSaved(true);
    } catch (e: any) { setError(e?.message || "Could not save monthly defaults."); } finally { setSavingDefaults(false); }
  }

  async function changePlanningDate(nextDate: string) {
    if (!nextDate || nextDate === date) return;
    try { await saveBulkOrganizerPlan({ ...planRef.current, pallets: planRef.current.invoices || [] }); } catch { /* autosave will retry */ }
    setDate(nextDate);
  }
  async function shiftDate(days: number) { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days); await changePlanningDate(dateKey(d)); }

  const buildingForCustomer = (customerName: string, requestedDivision = divisionView) => {
    const schedules = (plan.customer_schedules || []).filter(s => norm(s.customer_name) === norm(customerName));
    const schedule = schedules.find(s => norm(s.division) === norm(requestedDivision)) || schedules[0];
    return (plan.buildings || []).find(b => b.id === schedule?.building_id) || (plan.buildings || []).find(b => norm(b.name) === norm(customerName));
  };

  // Empty weekday/date selections mean "every day". A store may still opt into
  // a specific set of weekdays and/or explicit dates; invoice scheduling must
  // never offer dates outside those rules.
  const buildingAllowsDate = (buildingId: string | null | undefined, targetDate: string) => {
    if (!buildingId) return true;
    const b = (plan.buildings || []).find(x => x.id === buildingId);
    if (!b) return true;
    const specificDates = (b.schedule_dates || []).filter(Boolean);
    const days = b.schedule_days || [];
    if (!specificDates.length && !days.length) return true;
    if (specificDates.includes(targetDate)) return true;
    return days.includes(new Date(`${targetDate}T12:00:00`).getDay());
  };

  const allowedInvoiceDates = useMemo(() => {
    const buildingId = invoiceForm.building_id || null;
    const out: string[] = [];
    const start = new Date(`${date}T12:00:00`);
    for (let i = 0; i < 120; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const key = dateKey(d);
      if (buildingAllowsDate(buildingId, key)) out.push(key);
    }
    if (invoiceForm.schedule_date && !out.includes(invoiceForm.schedule_date) && buildingAllowsDate(buildingId, invoiceForm.schedule_date)) out.push(invoiceForm.schedule_date);
    return out.sort();
  }, [invoiceForm.building_id, invoiceForm.schedule_date, plan.buildings, date]);

  const allowedDatesForBuilding = (buildingId: string, currentSchedule = "") => {
    const out: string[] = [];
    const start = new Date(`${date}T12:00:00`);
    for (let i = 0; i < 120; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const key = dateKey(d);
      if (buildingAllowsDate(buildingId, key)) out.push(key);
    }
    if (currentSchedule && !out.includes(currentSchedule) && buildingAllowsDate(buildingId, currentSchedule)) out.push(currentSchedule);
    return out.sort();
  };

  function storeIcon(type: Building["type"]) {
    if (type === "hospital") return <Hospital size={16}/>;
    if (type === "warehouse") return <Building2 size={16}/>;
    return <Store size={16}/>;
  }
  const buildingTypeLabel = (b: Building) => b.type === "custom" ? (b.custom_type || "Custom") : b.type;

  function toggleStoreDay(day: number) {
    setStoreForm(x => ({ ...x, schedule_days: x.schedule_days.includes(day) ? x.schedule_days.filter(d => d !== day) : [...x.schedule_days, day] }));
  }
  function addStoreSpecificDate() {
    if (!storeDatePicker) return;
    setStoreForm(x => {
      const dates = x.schedule_dates.split(",").map(v => v.trim()).filter(Boolean);
      return { ...x, schedule_dates: Array.from(new Set([...dates, storeDatePicker])).join(", ") };
    });
    setStoreDatePicker("");
  }

  async function addStore() {
    const name = storeForm.name.trim();
    if (!name) return;
    const scheduleDates = storeForm.schedule_dates.split(",").map(x => x.trim()).filter(Boolean);
    // No weekday selection and no explicit dates means the store is available every day.
    const effectiveDays = storeForm.schedule_days.length ? storeForm.schedule_days : [];
    const currentPlan = planRef.current;
    const currentDefaults = defaultsRef.current;
    let nextBuildings = [...(currentPlan.buildings || [])];
    let nextSchedules = [...(currentPlan.customer_schedules || [])];
    let nextCustomers = [...(currentPlan.customers || [])];

    if (editingStoreId) {
      const existing = nextBuildings.find(b => b.id === editingStoreId);
      if (!existing) return;
      const updated: Building = { ...existing, name, division: storeForm.division || divisionView, type: storeForm.type, custom_type: storeForm.type === "custom" ? storeForm.custom_type.trim() : undefined, area: storeForm.area.trim(), note: storeForm.note.trim() || undefined, schedule_days: effectiveDays, schedule_dates: scheduleDates };
      const oldSchedule = nextSchedules.find(x => x.building_id === editingStoreId);
      const updatedSchedule: CustomerSchedule = { id: oldSchedule?.id || `schedule:${crypto.randomUUID()}`, customer_name: name, days: effectiveDays, area: updated.area, division: updated.division || divisionView, building_id: editingStoreId, enabled: true };
      nextBuildings = nextBuildings.map(b => b.id === editingStoreId ? updated : b);
      nextSchedules = nextSchedules.some(cs => cs.building_id === editingStoreId)
        ? nextSchedules.map(cs => cs.building_id === editingStoreId ? updatedSchedule : cs)
        : [...nextSchedules.filter(cs => norm(cs.customer_name) !== norm(name)), updatedSchedule];
      nextCustomers = nextCustomers.map(c => norm(c.name) === norm(existing.name) ? { ...c, name, area: updated.area, division: updated.division || c.division } : c);
      setEditingStoreId(null);
    } else {
      const b: Building = { id: `store:${crypto.randomUUID()}`, name, division: storeForm.division || divisionView, type: storeForm.type, custom_type: storeForm.type === "custom" ? storeForm.custom_type.trim() : undefined, area: storeForm.area.trim(), sort_order: nextBuildings.length, enabled: true, note: storeForm.note.trim() || undefined, schedule_days: effectiveDays, schedule_dates: scheduleDates };
      const schedule: CustomerSchedule = { id: `schedule:${crypto.randomUUID()}`, customer_name: name, days: effectiveDays, area: b.area, division: storeForm.division || divisionView, building_id: b.id, enabled: true };
      const existingCustomer = nextCustomers.find(c => norm(c.name) === norm(name));
      nextBuildings = [...nextBuildings, b];
      nextSchedules = [...nextSchedules.filter(s => norm(s.customer_name) !== norm(name)), schedule];
      if (!existingCustomer) nextCustomers = [...nextCustomers, { id: `manual:${crypto.randomUUID()}`, name, area: b.area, division: b.division || divisionView, enabled: true }];
    }

    // Build the complete next state FIRST, then persist that exact state. The old
    // code saved planRef immediately after setPlan/setDefaults, which still held
    // the previous state and caused weekday changes to revert (often to the old
    // Wednesday-only configuration).
    const nextPlan: PlanV3 = { ...currentPlan, buildings: nextBuildings, customers: nextCustomers, customer_schedules: nextSchedules };
    const nextDefaults: DefaultsV2 = { ...currentDefaults, month_key: monthKey(date), buildings: nextBuildings, customer_schedules: nextSchedules };
    setPlan(nextPlan);
    setDefaults(nextDefaults);
    setStoreForm({ name: "", type: "store", custom_type: "", area: "", note: "", schedule_days: [], schedule_dates: "", division: divisionView });
    setStoreDatePicker("");
    try {
      const saved = await saveBulkOrganizerDefaults(nextDefaults);
      setDefaults(saved as DefaultsV2);
      // Also persist the current daily plan so the store/day rule is immediately
      // available on the active planning date, not only as a monthly default.
      const savedPlan = await saveBulkOrganizerPlan({ ...nextPlan, pallets: nextPlan.invoices || [] });
      setPlan(savedPlan as PlanV3);
    } catch (e: any) { setError(e?.message || "Could not save the store schedule."); }
  }

  function editStore(b: Building) {
    setEditingStoreId(b.id);
    setStoreForm({ name: b.name, type: b.type, custom_type: b.custom_type || "", area: b.area || "", note: b.note || "", schedule_days: b.schedule_days || [], schedule_dates: (b.schedule_dates || []).join(", "), division: b.division || divisionView });
  }

  async function reorderBuildings(sourceId: string, targetId: string) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const reorder = (list: Building[]) => {
      const next = [...list];
      const from = next.findIndex(b => b.id === sourceId);
      const to = next.findIndex(b => b.id === targetId);
      if (from < 0 || to < 0) return list;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next.map((b, i) => ({ ...b, sort_order: i }));
    };
    const nextPlanBuildings = reorder(planRef.current.buildings || []);
    const nextDefaultBuildings = reorder(defaultsRef.current.buildings || []);
    setDefaults(x => ({ ...x, buildings: nextDefaultBuildings }));
    setPlan(x => ({ ...x, buildings: nextPlanBuildings }));
    try {
      const saved = await saveBulkOrganizerDefaults({ ...defaultsRef.current, month_key: monthKey(date), buildings: nextDefaultBuildings });
      setDefaults(saved as DefaultsV2);
    } catch (e: any) {
      setError(e?.message || "Could not save the location order as the monthly default.");
    }
  }

  function removeStore(id: string) {
    setDefaults(x => ({ ...x, buildings: x.buildings.filter(b => b.id !== id) }));
    setPlan(x => ({ ...x, buildings: (x.buildings || []).filter(b => b.id !== id), customer_schedules: (x.customer_schedules || []).map(s => s.building_id === id ? { ...s, building_id: null } : s) }));
  }

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

  async function addSchedule() {
    if (!scheduleForm.customer_name.trim()) return;
    const s: CustomerSchedule = { id: `schedule:${crypto.randomUUID()}`, customer_name: scheduleForm.customer_name.trim(), days: scheduleForm.days, area: scheduleForm.area, division: scheduleForm.division || "Unknown", building_id: scheduleForm.building_id || null, enabled: true };
    setDefaults(x => ({ ...x, customer_schedules: [...x.customer_schedules, s] }));
    setPlan(x => ({ ...x, customer_schedules: [...(x.customer_schedules || []), s] }));
    setScheduleForm({ customer_name: "", days: [], area: "", division: "", building_id: "" });
    try {
      const saved = await saveBulkOrganizerDefaults({
        ...defaultsRef.current, month_key: monthKey(date),
        buildings: [...(planRef.current.buildings || [])],
        customer_schedules: [...(planRef.current.customer_schedules || []), s],
      });
      setDefaults(saved as DefaultsV2);
    } catch (e: any) { setError(e?.message || "Could not save the customer schedule."); }
  }

  function batchBuildingLocked() { const first = invoiceBatchRows[0]?.building_id || invoiceForm.building_id; return !!first && (invoiceBatchRows.length === 0 || invoiceBatchRows.every(r => r.building_id === first)); }

  function invoiceRowForStore(store: Building) {
    const others = isOthersStore(store);
    return { invoice_no: "", customer_id: "", customer_name: others ? "" : store.name, area: store.area || "", division: store.division || divisionView, pallets: 1, invoice_date: date, schedule_date: date, building_id: store.id };
  }

  async function addInvoiceBatch() {
    const rows = invoiceBatchRows.filter(r => r.invoice_no.trim() && r.customer_name.trim());
    if (!rows.length) { setError("Add at least one invoice with Invoice No. and Customer."); return; }
    const targetRows = rows.map(r => ({ ...r, invoice_no: r.invoice_no.trim(), customer_name: r.customer_name.trim() }));
    const newInvoices: InvoicePlan[] = [];
    for (const r of targetRows) {
      const customer = customers.find(c => c.id === r.customer_id) || customers.find(c => norm(c.name) === norm(r.customer_name));
      const customerId = customer?.id || `manual:${crypto.randomUUID()}`;
      const buildingId = r.building_id || plan.customer_schedules?.find(s => norm(s.customer_name) === norm(r.customer_name))?.building_id || buildingForCustomer(r.customer_name)?.id || null;
      if (!buildingId) { setError(`Select a Store / destination for ${r.invoice_no}.`); return; }
      if (r.schedule_date && !buildingAllowsDate(buildingId, r.schedule_date)) { setError(`The selected schedule date is not allowed for ${r.customer_name}.`); return; }
      newInvoices.push({ id:`manual-invoice:${crypto.randomUUID()}`, invoice_no:r.invoice_no, customer_id:customerId, customer_name:customer?.name || r.customer_name, area:r.area || customer?.area || "", division:r.division || customer?.division || "Unknown", pallets:Math.max(1,Number(r.pallets||1)), invoice_date:r.invoice_date || null, scheduled_date:r.schedule_date || null, vehicle_id:null, building_id:buildingId });
    }
    const sameDay = newInvoices.filter(i => !i.scheduled_date || i.scheduled_date === date);
    const future = newInvoices.filter(i => i.scheduled_date && i.scheduled_date !== date);
    if (sameDay.length) {
      setPlan(x => ({ ...x, invoices:[...(x.invoices||[]),...sameDay] }));
    }
    try {
      for (const inv of future) {
        const target = await loadBulkOrganizerPlan(inv.scheduled_date!);
        const next = target || emptyPlan(inv.scheduled_date!);
        next.invoices = [...(next.invoices||[]), inv];
        next.pallets = next.invoices as any;
        await saveBulkOrganizerPlan(next);
      }
      setInvoiceBatchMode(false); setInvoiceBatchRows([]); setShowInvoiceManager(false); setError("");
      setInvoiceForm({ invoice_no:"",customer_id:"",customer_name:"",area:"",division:"",pallets:1,invoice_date:"",schedule_date:"",building_id:"" });
    } catch (e:any) { setError(e?.message || "Could not place the invoices on their scheduled dates."); }
  }

  async function addInvoice() {
    const name = invoiceForm.customer_name.trim(); if (!invoiceForm.invoice_no.trim() || !name) return;
    const customer = customers.find(c => c.id === invoiceForm.customer_id) || customers.find(c => norm(c.name) === norm(name));
    const customerId = customer?.id || `manual:${crypto.randomUUID()}`;
    const inv: InvoicePlan = {
      id: `manual-invoice:${crypto.randomUUID()}`, invoice_no: invoiceForm.invoice_no.trim(), customer_id: customerId,
      customer_name: customer?.name || name, area: invoiceForm.area || customer?.area || "", division: invoiceForm.division || customer?.division || "Unknown",
      pallets: Math.max(1, Number(invoiceForm.pallets || 1)), invoice_date: invoiceForm.invoice_date || null,
      scheduled_date: invoiceForm.schedule_date || null, vehicle_id: null, building_id: invoiceForm.building_id || plan.customer_schedules?.find(s => norm(s.customer_name) === norm(name))?.building_id || buildingForCustomer(name)?.id || null
    };
    if (!inv.building_id) { setError("Select a customer that is already linked to a Store / Hospital / Warehouse / Other before adding the invoice."); return; }
    if (inv.scheduled_date && !buildingAllowsDate(inv.building_id, inv.scheduled_date)) {
      setError("The selected schedule date is not allowed for this store. Choose one of its configured days or dates.");
      return;
    }
    if (!inv.scheduled_date || inv.scheduled_date === date) {
      setPlan(x => ({ ...x, invoices: [...(x.invoices || []), inv], customers: customer ? (x.customers || []) : [...(x.customers || []), { id: customerId, name, area: inv.area, division: inv.division, enabled: true }] }));
    } else {
      try {
        const target = await loadBulkOrganizerPlan(inv.scheduled_date!);
        const next = target || emptyPlan(inv.scheduled_date!);
        next.invoices = [...(next.invoices || []), inv];
        next.pallets = next.invoices as any;
        next.customers = [...(next.customers || []), ...(customer ? [] : [{ id: customerId, name, area: inv.area, division: inv.division, enabled: true }])];
        await saveBulkOrganizerPlan(next);
      } catch (e: any) { setError(e?.message || "Could not place the invoice on its scheduled date."); }
    }
    setScheduleMode("today");
    setInvoiceForm({ invoice_no: "", customer_id: "", customer_name: "", area: "", division: "", pallets: 1, invoice_date: "", schedule_date: "", building_id: "" });
    setShowInvoiceManager(false);
  }

  async function updateInvoice() {
    if (!editingInvoice) return;
    const next = { ...editingInvoice, invoice_no: invoiceForm.invoice_no, customer_name: invoiceForm.customer_name, area: invoiceForm.area, division: invoiceForm.division, pallets: Math.max(1, Number(invoiceForm.pallets || 1)), invoice_date: invoiceForm.invoice_date || null, scheduled_date: invoiceForm.schedule_date || null, building_id: invoiceForm.building_id || plan.customer_schedules?.find(s => norm(s.customer_name) === norm(invoiceForm.customer_name))?.building_id || buildingForCustomer(invoiceForm.customer_name)?.id || editingInvoice.building_id || null };
    if (!next.building_id) { setError("This invoice must stay linked to an existing customer/store before it can be saved."); return; }
    if (next.scheduled_date && !buildingAllowsDate(next.building_id, next.scheduled_date)) {
      setError("The selected schedule date is not allowed for this store. Choose one of its configured days or dates.");
      return;
    }
    try {
      if (next.scheduled_date && next.scheduled_date !== date) {
        const target = await loadBulkOrganizerPlan(next.scheduled_date);
        const targetPlan = target || emptyPlan(next.scheduled_date);
        targetPlan.invoices = [...(targetPlan.invoices || []).filter(i => i.id !== next.id && i.invoice_no !== next.invoice_no), next];
        targetPlan.pallets = targetPlan.invoices as any;
        await saveBulkOrganizerPlan(targetPlan);
        setPlan(x => ({ ...x, invoices: (x.invoices || []).filter(i => i.id !== editingInvoice.id) }));
      } else {
        setPlan(x => ({ ...x, invoices: (x.invoices || []).map(i => i.id === editingInvoice.id ? next : i) }));
      }
      setEditingInvoice(null);
      setError("");
    } catch (e:any) { setError(e?.message || "Could not reschedule the invoice."); }
  }

  function editInvoice(i: InvoicePlan) { setInvoiceBuildingLocked(false); setInvoiceCustomerLocked(false); setEditingInvoice(i); setScheduleMode(!i.scheduled_date ? "waiting" : i.scheduled_date === date ? "today" : "specific"); setInvoiceForm({ invoice_no: i.invoice_no, customer_id: i.customer_id, customer_name: i.customer_name, area: i.area, division: i.division, pallets: i.pallets, invoice_date: i.invoice_date || "", schedule_date: i.scheduled_date || "", building_id: i.building_id || buildingForCustomer(i.customer_name)?.id || "" }); }
  function deleteInvoice(id: string) { setPlan(x => { const next = { ...(x.pallet_assignments || {}) }; Object.keys(next).filter(k => k.startsWith(`${id}::`)).forEach(k => delete next[k]); return { ...x, invoices: (x.invoices || []).filter(i => i.id !== id), pallet_assignments: next }; }); }

  function routeVehicle(vehicleId: string, buildingId: string | null) {
    setPlan(x => ({ ...x, vehicle_meta: { ...(x.vehicle_meta || {}), [vehicleId]: { ...(x.vehicle_meta?.[vehicleId] || {}), building_id: buildingId } } }));
  }

  function personCanonical(value: string, library: any[]) {
    const q = norm(value);
    const hit = library.find(p => norm(p.code) === q || norm(p.name) === q);
    return hit?.name || value;
  }
  function updateVehicleMeta(vehicleId: string, field: "driver" | "helper", value: string) {
    const library = field === "driver" ? driverLibrary : helperLibrary;
    const canonical = personCanonical(value, library);
    setPlan(x => ({ ...x, vehicle_meta: { ...(x.vehicle_meta || {}), [vehicleId]: { ...(x.vehicle_meta?.[vehicleId] || {}), [field]: canonical } } }));
  }
  async function applyPersonForMonth(vehicleId: string, field: "driver" | "helper") {
    const meta = planRef.current.vehicle_meta?.[vehicleId] || {};
    const value = field === "driver" ? meta.driver : meta.helper;
    if (!value) return;
    const library = field === "driver" ? driverLibrary : helperLibrary;
    const canonical = personCanonical(value, library);
    const next = { ...defaultsRef.current, month_key: monthKey(date), vehicles: (defaultsRef.current.vehicles || []).map(v => v.vehicle_id === vehicleId ? { ...v, [field]: canonical } : v) };
    try {
      const saved = await saveBulkOrganizerDefaults(next);
      setDefaults(saved as DefaultsV2);
    } catch (e:any) { setError(e?.message || "Could not save the monthly driver/helper default."); }
  }

  const buildingCards = (plan.buildings || []).filter(b => {
    if (!b.enabled) return false;
    if (norm(b.division) === norm(divisionView)) return true;
    const hasSchedule = (plan.customer_schedules || []).some(s => s.enabled && norm(s.division) === norm(divisionView) && s.building_id === b.id);
    const hasInvoice = allPlanInvoices.some(i => norm(i.division) === norm(divisionView) && i.building_id === b.id);
    return hasSchedule || hasInvoice || !b.division;
  });
  const dayName = new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long" });
  const loadedByVehicle = (vehicleId: string) => Object.entries(assignments).filter(([k,v]) => v === vehicleId && allPlanInvoices.some(i => i.scheduled_date === date && k.startsWith(`${i.id}::`))).length;
  const loadedByVehicleByDivision = (vehicleId: string, div: string) => Object.entries(assignments).filter(([k,v]) => v === vehicleId && allPlanInvoices.some(i => i.scheduled_date === date && norm(i.division) === norm(div) && k.startsWith(`${i.id}::`))).length;
  const invoicesInVehicle = (vehicleId: string) => invoices.filter(i => Object.values(assignments).some(v => v === vehicleId && Object.keys(assignments).some(k => k.startsWith(`${i.id}::`) && assignments[k] === vehicleId)));
  const invoiceLoaded = (i: InvoicePlan) => Array.from({ length: Math.max(1, i.pallets) }).filter((_, k) => !!assignments[`${i.id}::${k}`]).length;
  const vehicleImage = (v: any) => {
    const t = norm(v.type);
    if (isVan(t)) return "/vehicle-images/VAN 1.PNG";
    const ton = Number(v.capacity_tons ?? v.tonnage ?? v.tons ?? 0);
    if (ton >= 12 || t.includes("12")) return "/vehicle-images/12 TON PICK-UP 1.PNG";
    if (ton >= 10 || t.includes("10")) return "/vehicle-images/10 TON PICK-UP 1.PNG";
    return "/vehicle-images/5 TON PICK-UP 1.PNG";
  };
  const capacityFor = (cfg: VehicleConfig, v: any) => Number(
  v.pallet_capacity ?? v.capacity_pallets ?? cfg.capacity ?? v.capacity ?? defaultCapacity(v)
);
  const customersForDay = useMemo(() => {
    const names = new Map<string, any>();
    customers.filter(c => norm(c.division) === norm(divisionView) || !c.division || norm(c.division) === "UNKNOWN").forEach(c => names.set(norm(c.name), c));
    const activeBuildingIds = new Set((plan.buildings || []).filter(b => {
      if (!b.enabled) return false;
      const dates = b.schedule_dates || []; const days = b.schedule_days || [];
      return (!dates.length && !days.length) || dates.includes(date) || days.includes(todayDow);
    }).map(b => b.id));
    (plan.customer_schedules || []).filter(s => norm(s.division) === norm(divisionView) && s.enabled && ((s.days || []).length === 0 || s.days.includes(todayDow) || activeBuildingIds.has(s.building_id || ""))).forEach(s => names.set(norm(s.customer_name), { id:`scheduled:${s.id}`, name:s.customer_name, area:s.area, division:s.division, enabled:true }));
    invoices.forEach(i => names.set(norm(i.customer_name), { id:i.customer_id, name:i.customer_name, area:i.area, division:i.division, enabled:true }));
    return Array.from(names.values());
  }, [customers, plan.customer_schedules, plan.buildings, invoices, todayDow, divisionView]);
  const assignedForCustomer = (name: string) => invoices.filter(i => norm(i.customer_name) === norm(name)).reduce((n,i) => n + invoiceLoaded(i), 0);

  const dropCustomerOnVehicle = (v: any, customerName: string) => {
    const customerInvoices = invoices.filter(i => norm(i.customer_name) === norm(customerName));
    if (!customerInvoices.length) { setError(`No scheduled invoice for ${customerName} on ${date}.`); return; }
    for (const inv of customerInvoices) {
      const unassigned = Math.max(0, Number(inv.pallets) - invoiceLoaded(inv));
      if (!unassigned) continue;
      const check = vehiclePermission(inv, v);
      const cfg = selectedVehicles.find(x => x.vehicle_id === v.id);
      const used = loadedByVehicle(v.id);
      if (!check.ok) { setError(`${v.number}: ${check.text}`); return; }
      if (!cfg || used + unassigned > capacityFor(cfg, v)) { setError(`${v.number}: only ${Math.max(0, capacityFor(cfg || {vehicle_id:v.id,capacity:0}, v) - used)} pallet space left.`); return; }
      assignInvoice(inv.id, v.id);
    }
    setError("");
  };

  return <div className={`page bulk-planner-page bulk-theme-${bulkTheme} ${loading ? "is-hydrating" : ""}`}>
    <div className="bulk-planner-header glass-card">
      <div className="bulk-dispatch-heading"><div><div className="bulk-planner-eyebrow"><Route size={14}/> BULK ORGANIZER · DAILY PLANNING</div><h1>Dispatch Allocation</h1><p>Select your default fleet, review today&apos;s scheduled customers, and link each customer&apos;s invoices to the right vehicle.</p></div>
        <div className="bulk-planner-date bulk-planner-date-inline">
          <div className="bulk-planner-date-controls">
            <button className="btn icon-btn" onClick={()=>shiftDate(-1)} aria-label="Previous day"><ChevronLeft size={18}/></button>
            <div className="bulk-planner-date-center"><small>PLANNING DATE</small><strong>{dayLabel(date)}</strong></div>
            <input type="date" value={date} onChange={e=>void changePlanningDate(e.target.value)} aria-label="Planning date"/>
            <button className="btn icon-btn" onClick={()=>shiftDate(1)} aria-label="Next day"><ChevronRight size={18}/></button>
            <span className="bulk-live-pill"><span/> LIVE</span>
          </div>
          <div className="bulk-division-switch" role="tablist" aria-label="Business division">
            <button type="button" className={divisionView === "Pharma" ? "active" : ""} onClick={()=>setDivisionView("Pharma")}>Pharma</button>
            <button type="button" className={divisionView === "Consumer" ? "active" : ""} onClick={()=>setDivisionView("Consumer")}>Consumer</button>
          </div>
        </div>
      </div>
      <div className="bulk-planner-actions"><GlassButton variant="secondary" size="sm" onClick={() => void loadSourceData(date)}><RefreshCw size={14}/> Refresh</GlassButton><GlassButton size="sm" onClick={() => void save()} disabled={saving}><Save size={14}/> {saving ? "Saving…" : "Save Day"}</GlassButton></div>
    </div>
    {error && <div className="bulk-planner-error"><CircleAlert size={15}/><span>{error}</span><button onClick={()=>setError("")}><X size={14}/></button></div>}
    <div className="bulk-allocation-layout">
      <aside className="bulk-allocation-left">
        <div className="bulk-schedule-panel bulk-glass-surface"><div className="bulk-planner-section-head compact"><div><span>02 · ALERTS</span><h2>Today&apos;s schedule</h2></div><Bell size={17}/></div><div className="bulk-alert-list">{alertGroups.length?alertGroups.map(g=><div key={g.id} className="bulk-alert-group"><h4>{g.title}</h4>{g.items.map(n=><div key={n.id} className={`bulk-alert ${n.tone}`}><div className="bulk-alert-icon">{n.tone==="green"?<Check size={13}/>:n.tone==="amber"?<CircleAlert size={13}/>:<Bell size={13}/>}</div><div><b>{n.title}</b><span>{n.text}</span></div></div>)}</div>):<div className="bulk-empty-state">No scheduled alerts for this date.</div>}</div><div className="bulk-kpis"><div><span>Invoices</span><b>{invoices.length}</b></div><div><span>Pallets</span><b>{totalPallets}</b></div><div><span>Allocated</span><b>{loadedPallets}</b></div><div><span>Waiting</span><b>{pendingPallets}</b></div></div><div className="bulk-side-tools"><GlassButton variant="secondary" size="sm" onClick={()=>setShowScheduleManager(x=>!x)}><CalendarDays size={13}/> Schedules</GlassButton><GlassButton variant="secondary" size="sm" onClick={()=>setShowBuildingEditor(x=>!x)}><Store size={13}/> Stores</GlassButton><GlassButton size="sm" onClick={()=>{setEditingInvoice(null);setInvoiceBuildingLocked(false);setInvoiceCustomerLocked(false);setShowInvoiceManager(true);setScheduleMode("waiting");setInvoiceForm(x=>({...x,schedule_date:"",invoice_no:"",building_id:""}))}}><Plus size={13}/> Invoice</GlassButton></div></div>
      </aside>
      <div className="bulk-allocation-right">

        <section className="bulk-vehicles-section glass-card bulk-glass-surface">
          <div className="bulk-planner-section-head"><div><span>01 · FLEET</span><h2>Default & daily vehicles</h2><p>Vehicles selected as defaults repeat across days. Add or remove vehicles for this day without changing the Fleet Data Manager.</p></div><div className="bulk-section-head-actions"><GlassButton variant="secondary" size="sm" onClick={()=>setVehiclesExpanded(x=>!x)}><ChevronDown size={14} className={vehiclesExpanded?"bulk-chevron-open":""}/>{vehiclesExpanded?"Minimize":"Expand"}</GlassButton><GlassButton size="sm" onClick={()=>setShowFleet(x=>!x)}><Truck size={14}/>{showFleet?"Close Fleet":"Choose Fleet"}</GlassButton></div></div>
          {vehiclesExpanded&&<div className={`bulk-vehicle-strip expanded`}>
            {selectedVehicles.map(cfg=>{const v=vehicleMap.get(cfg.vehicle_id);if(!v)return null;const cap=capacityFor(cfg,v),used=loadedByVehicle(v.id),pct=Math.min(100,Math.round(used/Math.max(1,cap)*100)),meta=plan.vehicle_meta?.[v.id]||{};return <div key={v.id} className={`bulk-vehicle-card ${pct>=100?"is-full":pct>=80?"is-near-full":""}`} onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add("drop-ready")}} onDragLeave={e=>e.currentTarget.classList.remove("drop-ready")} onDrop={e=>{e.preventDefault();e.currentTarget.classList.remove("drop-ready");const raw=e.dataTransfer.getData("text/plain");const d=dragged||(raw?{type:"customer" as const,id:raw}:null);if(d?.type==="customer")dropCustomerOnVehicle(v,d.id);else if(d?.type==="invoice")dropOnVehicle(v,d);else if(d?.type==="store")dropStoreOnVehicle(v,d.id);setDragged(null)}}>
              <div className="bulk-vehicle-image-wrap"><img src={vehicleImage(v)} alt={v.type||"Vehicle"}/><span className="bulk-vehicle-ton">{String(v.type||"").toUpperCase()}</span></div>
              <div className="bulk-vehicle-main"><div className="bulk-vehicle-top"><b>{v.number}</b><button className="btn icon-btn" title="Remove from day" onClick={(e)=>{e.stopPropagation();toggleVehicle(v)}}><X size={12}/></button></div><div className="bulk-capacity-row"><span>{used} / {cap} pallets</span><strong>{Math.max(0,cap-used)} free</strong></div>{(() => { const other = divisionView === "Pharma" ? "Consumer" : "Pharma"; const otherUsed = loadedByVehicleByDivision(v.id, other); return otherUsed ? <div className="bulk-cross-division-load"><span>{other} already loaded</span><b>{otherUsed} pallets</b></div> : null; })()}<div className="bulk-capacity-bar"><i style={{width:`${pct}%`}}/></div><div className="bulk-vehicle-meta"><label>Driver<input list="bulk-driver-library" value={meta.driver||""} placeholder="Driver name or code" onChange={e=>updateVehicleMeta(v.id,"driver",e.target.value)} onBlur={e=>updateVehicleMeta(v.id,"driver",e.target.value)}/><button type="button" className="bulk-person-month-btn" onClick={()=>applyPersonForMonth(v.id,"driver")}>Use rest of month</button></label><label>Helper<input list="bulk-helper-library" value={meta.helper||""} placeholder="Helper name or code" onChange={e=>updateVehicleMeta(v.id,"helper",e.target.value)} onBlur={e=>updateVehicleMeta(v.id,"helper",e.target.value)}/><button type="button" className="bulk-person-month-btn" onClick={()=>applyPersonForMonth(v.id,"helper")}>Use rest of month</button></label></div></div><div className="bulk-vehicle-load-list">{invoicesInVehicle(v.id).map((i, invoiceIndex)=><div key={i.id} className="bulk-loaded-invoice" draggable onDragStart={e=>{e.stopPropagation();e.dataTransfer.setData("text/plain",i.id);setDragged({type:"invoice",id:i.id})}} onDragEnd={()=>setDragged(null)}><div className="bulk-loaded-pallet"><Package size={12}/><b>{assignedCountOnVehicle(i,v.id)}</b><span>PLT</span></div><span className="bulk-invoice-sequence" title={`Invoice ${invoiceIndex + 1}`}>{invoiceIndex + 1}</span><div className="bulk-loaded-invoice-info"><b>{i.invoice_no} {invoiceLoaded(i) >= Number(i.pallets || 0) && <span className="bulk-invoice-complete" title="Invoice fully loaded"><Check size={10}/></span>}</b><span>{i.customer_name}</span><small>{assignedCountOnVehicle(i,v.id)} / {i.pallets} pallets · {i.area||"Area not set"} · {i.division||"Division not set"}</small><small>Scheduled {i.scheduled_date}</small></div><div className="bulk-loaded-invoice-actions"><button className="btn icon-btn" title="Edit invoice" onClick={(e)=>{e.stopPropagation();editInvoice(i)}}><Pencil size={11}/></button><button className="btn icon-btn" title="Remove only this vehicle's loaded pallets" onClick={(e)=>{e.stopPropagation();removeInvoicePallets(i,v.id,assignedCountOnVehicle(i,v.id))}}><X size={12}/></button></div></div>)}{!invoicesInVehicle(v.id).length&&<span className="bulk-vehicle-empty">Drop invoice or customer here</span>}</div>
            </div>})}
            {!selectedVehicles.length&&<div className="bulk-no-vehicles"><Truck size={24}/><b>No vehicles selected</b><span>Choose the Fleet vehicles you want as defaults or for this day.</span><button className="btn" onClick={()=>setShowFleet(true)}><Plus size={13}/> Choose vehicles</button></div>}
          </div>}
          {showFleet&&<div className="bulk-fleet-panel"><div className="bulk-fleet-panel-head"><b>Select Fleet vehicles</b><span>{selectedVehicles.length} selected</span></div><div className="bulk-fleet-choice-grid">{fleet.map(v=>{const on=selectedVehicles.some(x=>x.vehicle_id===v.id),def=defaults.vehicles.some(x=>x.vehicle_id===v.id);return <button key={v.id} className={`bulk-fleet-choice-v2 ${on?"selected":""}`} onClick={()=>toggleVehicle(v)}><img src={vehicleImage(v)} alt=""/><div><b>{v.number}</b><span>{v.type||"Vehicle"} · {v.division||"Division"}</span></div><div className="fleet-choice-state">{on?<Check size={14}/>:<Plus size={14}/>} {def&&<small>DEFAULT</small>}</div></button>})}</div><div className="bulk-default-actions"><GlassButton variant="secondary" size="sm" onClick={()=>void saveDefaults()} disabled={savingDefaults}><Save size={13}/>{savingDefaults?"Saving…":defaultsSaved?"Saved ✓":"Save selected as monthly defaults"}</GlassButton></div></div>}
        </section>


<main className="bulk-customer-section glass-card bulk-glass-surface">
          <div className="bulk-planner-section-head bulk-section-centered">
            <div><span>03 · CUSTOMER LOAD PLAN</span><h2>Scheduled customers</h2><p>Customers are grouped by their selected store or destination. Drag a customer or invoice onto a permitted vehicle.</p></div>
            <div className="bulk-section-head-actions"><div className="bulk-search"><Search size={14}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customer / invoice…"/></div><GlassButton variant="secondary" size="sm" onClick={()=>setCustomerSectionExpanded(x=>!x)}><ChevronDown size={14} className={customerSectionExpanded?"bulk-chevron-open":""}/>{customerSectionExpanded?"Minimize":"Expand"}</GlassButton></div>
          </div>
          {customerSectionExpanded&&<div className="bulk-store-customer-grid">
            {[...buildingCards].sort((a,b)=>(a.sort_order ?? 9999)-(b.sort_order ?? 9999)).map(store=>{
              const storeCustomers=customersForDay.filter(c=>norm(buildingForCustomer(c.name)?.id||"")===norm(store.id) || invoices.some(i=>norm(i.customer_name)===norm(c.name)&&i.building_id===store.id));
              const storeInvoices=invoices.filter(i=>i.building_id===store.id || storeCustomers.some(c=>norm(c.name)===norm(i.customer_name)));
              const vehiclesForInvoice = (inv: InvoicePlan) => Array.from(new Set(Object.entries(assignments).filter(([k,v]) => v && k.startsWith(`${inv.id}::`)).map(([,v]) => v as string))).map(id => vehicleMap.get(id)).filter(Boolean);
              if(search && !store.name.toLowerCase().includes(search.toLowerCase()) && !storeCustomers.some(c=>norm(c.name).includes(norm(search)) || storeInvoices.some(i=>norm(i.invoice_no).includes(norm(search))))) return null;
              return <section key={store.id} className="bulk-store-customer-box" draggable onDragOver={e=>{if(e.dataTransfer.types.includes("application/x-bulk-location")){e.preventDefault();e.currentTarget.classList.add("bulk-location-drop-target")}}} onDragLeave={e=>e.currentTarget.classList.remove("bulk-location-drop-target")} onDrop={e=>{const source=e.dataTransfer.getData("application/x-bulk-location");if(!source)return;e.preventDefault();e.stopPropagation();e.currentTarget.classList.remove("bulk-location-drop-target");void reorderBuildings(source,store.id);}} onDragStart={e=>{e.dataTransfer.setData("text/plain",store.id);setDragged({type:"store",id:store.id})}} onDragEnd={()=>setDragged(null)} title="Drag this location to a vehicle to load its scheduled invoices">
                <div className="bulk-store-hero">
                  <button type="button" className="bulk-store-reorder-handle" title="Drag to reorder this location" draggable onClick={e=>e.stopPropagation()} onDragStart={e=>{e.stopPropagation();e.dataTransfer.setData("application/x-bulk-location",store.id)}} onDragEnd={()=>{}}><GripVertical size={16}/></button><div className={`bulk-store-picture ${storeInvoices.filter(i=>i.scheduled_date===date).length && storeInvoices.filter(i=>i.scheduled_date===date).every(i => invoiceLoaded(i) >= Number(i.pallets || 0)) ? "store-complete" : ""}`}>{storeIcon(store.type)}{storeInvoices.filter(i=>i.scheduled_date===date).length > 0 && storeInvoices.filter(i=>i.scheduled_date===date).every(i => invoiceLoaded(i) >= Number(i.pallets || 0)) && <span className="bulk-store-complete-check" title="Today's schedule is fully loaded into vehicles"><Check size={10}/></span>}</div>
                  <div className="bulk-store-heading"><span>{buildingTypeLabel(store).toUpperCase()}</span><h3>{store.name}</h3><small><MapPin size={12}/> {store.area||"Area not set"}</small></div>
                  <div className="bulk-store-summary"><div><b>{storeInvoices.length}</b><span>Invoices</span></div><div><b>{storeInvoices.reduce((n,i)=>n+Number(i.pallets||0),0)}</b><span>Pallets</span></div></div>
                  <div className="bulk-store-hero-actions"><GlassButton size="sm" variant="secondary" onClick={e=>{e.stopPropagation();openBatchLoadModal(store.id)}}><ListChecks size={12}/> Load multiple</GlassButton><GlassButton size="sm" variant="secondary" onClick={e=>{e.stopPropagation();openInvoiceForStore(store)}}><Plus size={12}/> Add invoices</GlassButton></div>
                </div>
                <div className="bulk-store-schedule-sections"><div className={`bulk-store-schedule-section today ${storeInvoices.filter(i=>i.scheduled_date===date).length > 0 && storeInvoices.filter(i=>i.scheduled_date===date).every(i=>invoiceLoaded(i)>=Number(i.pallets||0)) ? "is-loaded" : ""}`}><div className="bulk-schedule-section-heading"><div><span className="bulk-section-kicker">TODAY</span><h4>Schedule for today</h4></div><b>{storeInvoices.filter(i=>i.scheduled_date===date).length} invoice(s)</b></div><div className="bulk-customer-grid compact-store-grid">
                  {storeCustomers.filter(c=>buildingForCustomer(c.name)?.id===store.id || storeInvoices.some(i=>norm(i.customer_name)===norm(c.name) && i.scheduled_date===date)).map(c=>{const ci=invoices.filter(i=>norm(i.customer_name)===norm(c.name) && (i.building_id===store.id || !i.building_id));const pallets=ci.reduce((n,i)=>n+i.pallets,0),loaded=assignedForCustomer(c.name),scheduled=plan.customer_schedules?.find(s=>norm(s.customer_name)===norm(c.name)&&s.days.includes(todayDow));return <div key={c.id} draggable onDragStart={e=>{e.dataTransfer.setData("text/plain",c.name);setDragged({type:"customer",id:c.name})}} onDragEnd={()=>setDragged(null)} className={`bulk-customer-card ${loaded>=pallets&&pallets?"complete":""}`}>
                    <div className="customer-card-top"><div className="customer-avatar">{storeIcon(store.type)}</div><div><b>{c.name}</b><span>{c.area||store.area||"Area not set"} · {c.division||"Unknown"}</span></div><GripVertical size={16}/></div>
                    <div className="customer-card-details"><span><strong>{ci.length}</strong> invoices</span><span><strong>{pallets}</strong> pallets</span><span><strong>{loaded}</strong> linked</span></div>
                    {scheduled&&<div className="customer-schedule-chip"><CalendarDays size={11}/> {scheduled.days.map((d:number)=>["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]).join(" · ")}</div>}
                    <div className="customer-card-invoices">{ci.map((i, invoiceIndex)=>{const l=invoiceLoaded(i);return <div key={i.id} className={`customer-invoice-row ${l>=Number(i.pallets||0) && l>0 ? "invoice-loaded invoice-fully-loaded" : l>0 ? "invoice-partial-loaded" : ""}`} draggable onDragStart={e=>{e.stopPropagation();e.dataTransfer.setData("text/plain",i.id);setDragged({type:"invoice",id:i.id})}} onDragEnd={()=>setDragged(null)}><span className="bulk-invoice-sequence" title={`Invoice ${invoiceIndex + 1}`}>{invoiceIndex + 1}</span><div className="invoice-pallet-icon"><span>{i.pallets}</span></div><div><b>{i.invoice_no}</b><small>{i.scheduled_date} · {i.area||"No area"} · {i.division||"Division"}</small>{l>0&&<span className="bulk-invoice-vehicle-tags"><span className="bulk-invoice-load-status">{l>=Number(i.pallets||0)?"FULLY LOADED":"PARTIAL LOAD"}</span>{vehiclesForInvoice(i).map((v:any)=><button type="button" key={v.id} className="bulk-invoice-vehicle-tag" title={`Manage ${i.invoice_no} on ${v.number}`} onClick={e=>{e.stopPropagation();openInvoiceVehicleManager(i,v.id)}}><Truck size={10}/>{v.number}</button>)}</span>}</div><em className={l>=Number(i.pallets||0)?"invoice-count-full":"invoice-count-partial"}>{l}/{i.pallets}</em><button className="btn icon-btn invoice-load-btn" title="Load invoice into a vehicle" onClick={e=>{e.stopPropagation();openInvoiceLoadModal(i)}} disabled={invoiceLoaded(i)>=Number(i.pallets||0)}><Truck size={11}/></button><button className="btn icon-btn invoice-edit-btn" title="Edit invoice" onClick={e=>{e.stopPropagation();editInvoice(i)}}><Pencil size={11}/></button></div>})}</div>
                    <div className="customer-card-footer"><span>{!ci.length ? "No invoices yet" : loaded>=pallets&&pallets?"FULLY LINKED":"Drag to a permitted vehicle"}</span><div className="customer-card-footer-actions"><button type="button" className="btn icon-btn customer-add-invoice-btn" title={`Add invoice for ${c.name}`} onClick={e=>{e.stopPropagation();openInvoiceForCustomer(c,store)}}><Plus size={12}/></button>{loaded>=pallets&&pallets?<span className="bulk-customer-complete-check"><Check size={10}/></span>:<Route size={13}/>}</div></div>
                  </div>})}
                  {!storeCustomers.length&&<div className="bulk-empty-state">No customers linked to this location yet.</div>}
                </div></div><div className="bulk-store-schedule-section waiting"><div className="bulk-schedule-section-heading"><div><span className="bulk-section-kicker">NOT SCHEDULED</span><h4>Waiting for schedule</h4></div><b>{waiting.filter(i=>i.building_id===store.id).length} invoice(s)</b></div><div className="bulk-store-schedule-invoices">{waiting.filter(i=>i.building_id===store.id).map((i, invoiceIndex)=><div className="bulk-schedule-invoice-row" key={`waiting-${i.id}`}><span className="bulk-invoice-sequence" title={`Invoice ${invoiceIndex + 1}`}>{invoiceIndex + 1}</span><div className="invoice-pallet-icon"><span>{i.pallets}</span></div><div><b>{i.invoice_no}</b><small>{i.customer_name} · {i.area||"No area"} · {i.division||"Division"}</small></div><em>Waiting</em><button className="btn icon-btn invoice-edit-btn" title="Edit invoice" onClick={e=>{e.stopPropagation();editInvoice(i)}}><Pencil size={11}/></button></div>)}{!waiting.some(i=>i.building_id===store.id)&&<div className="bulk-empty-state">Nothing waiting for schedule.</div>}</div></div></div>
              </section>;
            })}
            {!buildingCards.length && customersForDay.length>0 && <div className="bulk-empty-state large"><Users size={30}/><b>No stores configured</b><span>Create a store/destination to organize scheduled customers.</span></div>}
            {!customersForDay.length&&<div className="bulk-empty-state large"><Users size={30}/><b>No scheduled customers</b><span>Add a customer schedule or invoice for this date.</span></div>}
          </div>}
        </main>
      </div>
    </div>
    {showBatchLoadModal&&<div className="bulk-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)closeBatchLoadModal()}}><GlassCard className="bulk-planner-modal bulk-load-modal bulk-modal-surface">
      <div className="bulk-panel-title"><ListChecks size={16}/> Load multiple{batchBuildingId ? ` · ${(plan.buildings||[]).find(b=>b.id===batchBuildingId)?.name || "Store"}` : " invoices"} <button onClick={closeBatchLoadModal}><X size={14}/></button></div>
      <div className="bulk-modal-intro">Choose the invoices and the vehicles for this store. Each vehicle shows the same capacity/readiness information used in the Fleet cards.</div>
      <div className="bulk-batch-vehicle-title"><b>Vehicles for this load</b><span>{batchVehicleIds.length} selected</span></div>
      <div className="bulk-batch-vehicle-grid">{selectedVehicles.map(cfg=>{const v=vehicleMap.get(cfg.vehicle_id);if(!v)return null;const used=loadedByVehicle(v.id),cap=capacityFor(cfg,v),free=Math.max(0,cap-used),active=batchVehicleIds.includes(v.id);return <button type="button" key={v.id} className={`bulk-load-vehicle-choice bulk-batch-vehicle-choice ${active?"selected":""}`} onClick={()=>setBatchVehicleIds(ids=>ids.includes(v.id)?ids.filter(x=>x!==v.id):[...ids,v.id])}>
        <img src={vehicleImage(v)} alt=""/><div><b>{v.number}</b><span>{v.type||"Vehicle"}</span><small>{free} pallets free · {used}/{cap} loaded</small></div>{active&&<Check size={15}/>}
      </button>})}</div>
      <div className="bulk-batch-load-toolbar"><button type="button" className="bulk-batch-select-btn" onClick={()=>{const ids=allPlanInvoices.filter(i=>i.scheduled_date===date&&(!batchBuildingId||i.building_id===batchBuildingId)&&invoiceLoaded(i)<Number(i.pallets||0)).map(i=>i.id);setBatchSelectedIds(ids)}}>Select scheduled</button><button type="button" className="bulk-batch-select-btn" onClick={()=>setBatchSelectedIds([])}>Clear</button><label><input type="checkbox" checked={batchIncludeWaiting} onChange={e=>{setBatchIncludeWaiting(e.target.checked);if(e.target.checked){setBatchSelectedIds(ids=>Array.from(new Set([...ids,...waiting.filter(i=>(!batchBuildingId||i.building_id===batchBuildingId)&&invoiceLoaded(i)<Number(i.pallets||0)).map(i=>i.id)])))}}}/> Include waiting</label></div>
      <div className="bulk-load-form bulk-batch-load-form">
        <div className="bulk-load-mode"><span>Load quantity</span><div><button type="button" className={batchLoadMode==="full"?"active":""} onClick={()=>setBatchLoadMode("full")}>Full load</button><button type="button" className={batchLoadMode==="partial"?"active":""} onClick={()=>setBatchLoadMode("partial")}>Partial</button></div></div>
      </div>
      <div className="bulk-batch-invoice-list">{[...allPlanInvoices.filter(i=>i.scheduled_date===date&&(!batchBuildingId||i.building_id===batchBuildingId)),...(batchIncludeWaiting?waiting.filter(i=>!batchBuildingId||i.building_id===batchBuildingId):[])].filter((i,idx,arr)=>arr.findIndex(x=>x.id===i.id)===idx).map(i=>{const remaining=Math.max(0,Number(i.pallets||0)-invoiceLoaded(i));const qty=Math.min(remaining,Math.max(1,Number(batchPartialQuantities[i.id]||1)));return <label key={i.id} className={`bulk-batch-invoice-row ${batchSelectedIds.includes(i.id)?"selected":""}`}><input type="checkbox" checked={batchSelectedIds.includes(i.id)} disabled={!remaining} onChange={()=>{toggleBatchInvoice(i.id);setBatchPartialQuantities(q=>({...q,[i.id]:Math.max(1,remaining)}))}}/><span><b>{i.invoice_no}</b><small>{i.customer_name} · {i.area||"No area"} · {i.division||"Division"} · {i.scheduled_date ? `Scheduled · ${i.scheduled_date}` : "Waiting for schedule"}</small></span><em className="bulk-batch-invoice-status">{i.scheduled_date ? "SCHEDULED" : "WAITING"}</em><strong>{remaining}/{i.pallets} PLT</strong>{batchLoadMode==="partial"&&<input className="bulk-batch-qty" type="number" min={1} max={remaining||1} value={qty} disabled={!remaining} onChange={e=>setBatchPartialQuantities(q=>({...q,[i.id]:Math.min(remaining||1,Math.max(1,Number(e.target.value)||1))}))}/>}</label>})}</div>
      <div className="bulk-batch-load-note">Only the selected vehicles receive pallets. Loading still respects vehicle compatibility and remaining capacity.</div>
      <div className="bulk-load-modal-actions"><GlassButton variant="secondary" size="sm" onClick={closeBatchLoadModal}>Cancel</GlassButton><GlassButton size="sm" onClick={confirmBatchLoad} disabled={!batchSelectedIds.length||!batchVehicleIds.length}><Truck size={13}/> Load selected</GlassButton></div>
    </GlassCard></div>}
    {loadInvoiceTarget&&<div className="bulk-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)closeInvoiceLoadModal()}}><GlassCard className="bulk-planner-modal bulk-load-modal bulk-modal-surface">
      <div className="bulk-panel-title"><Truck size={16}/> Load invoice <button onClick={closeInvoiceLoadModal}><X size={14}/></button></div>
      <div className="bulk-load-modal-invoice"><div><span>INVOICE</span><b>{loadInvoiceTarget.invoice_no}</b><small>{loadInvoiceTarget.customer_name} · {loadInvoiceTarget.pallets} pallets total</small></div><div className="bulk-load-remaining"><strong>{Math.max(0,Number(loadInvoiceTarget.pallets||0)-invoiceLoaded(loadInvoiceTarget))}</strong><span>remaining</span></div></div>
      <div className="bulk-load-vehicle-grid">{selectedVehicles.map(cfg=>{const v=vehicleMap.get(cfg.vehicle_id);if(!v)return null;const free=Math.max(0,capacityFor(cfg,v)-loadedByVehicle(cfg.vehicle_id));const active=loadVehicleId===v.id;return <button type="button" key={v.id} className={`bulk-load-vehicle-choice ${active?"selected":""}`} onClick={()=>setLoadVehicleId(v.id)}><img src={vehicleImage(v)} alt=""/><div><b>{v.number}</b><span>{v.type||"Vehicle"}</span><small>{free} pallets free</small></div>{active&&<Check size={15}/>}</button>})}</div>
      {!manageVehicleId&&<div className="bulk-load-form">
        <div className="bulk-load-mode"><span>Load quantity</span><div><button type="button" className={loadQuantity===Math.max(1,Number(loadInvoiceTarget.pallets||0)-invoiceLoaded(loadInvoiceTarget))?"active":""} onClick={()=>setLoadQuantity(Math.max(1,Number(loadInvoiceTarget.pallets||0)-invoiceLoaded(loadInvoiceTarget)))}>Full load</button><button type="button" className={loadQuantity!==Math.max(1,Number(loadInvoiceTarget.pallets||0)-invoiceLoaded(loadInvoiceTarget))?"active":""} onClick={()=>setLoadQuantity(Math.min(1,Math.max(1,Number(loadInvoiceTarget.pallets||0)-invoiceLoaded(loadInvoiceTarget))))}>Partial</button></div></div>
        <label className="bulk-load-qty"><span>Pallets to load</span><input type="number" min={1} max={Math.max(1,Number(loadInvoiceTarget.pallets||0)-invoiceLoaded(loadInvoiceTarget))} value={loadQuantity} onChange={e=>setLoadQuantity(Math.max(1,Math.min(Math.max(1,Number(loadInvoiceTarget.pallets||0)-invoiceLoaded(loadInvoiceTarget)),Number(e.target.value||1))))}/></label>
      </div>}
      {manageVehicleId&&<div className="bulk-load-manage-panel"><div><span>Currently on {vehicleMap.get(manageVehicleId)?.number || manageVehicleId}</span><b>{assignedCountOnVehicle(loadInvoiceTarget,manageVehicleId)} pallets</b></div><label><span>Quantity</span><input type="number" min={1} max={Math.max(1,assignedCountOnVehicle(loadInvoiceTarget,manageVehicleId))} value={loadQuantity} onChange={e=>setLoadQuantity(Math.max(1,Math.min(Math.max(1,assignedCountOnVehicle(loadInvoiceTarget,manageVehicleId)),Number(e.target.value||1))))}/></label><div className="bulk-load-manage-destination"><span>Move to</span><div>{selectedVehicles.filter(cfg=>cfg.vehicle_id!==manageVehicleId).map(cfg=>{const v=vehicleMap.get(cfg.vehicle_id);return <button type="button" key={cfg.vehicle_id} className={loadVehicleId===cfg.vehicle_id?"selected":""} onClick={()=>setLoadVehicleId(cfg.vehicle_id)}>{v?.number||cfg.vehicle_id}</button>})}</div></div></div>}
      <div className="bulk-load-modal-actions"><GlassButton variant="secondary" size="sm" onClick={closeInvoiceLoadModal}>Cancel</GlassButton>{manageVehicleId?<><GlassButton variant="secondary" size="sm" onClick={()=>removeInvoicePallets(loadInvoiceTarget,manageVehicleId,loadQuantity)}><X size={13}/> Remove {loadQuantity}</GlassButton><GlassButton size="sm" onClick={()=>moveInvoicePallets(loadInvoiceTarget,manageVehicleId,loadVehicleId,loadQuantity)} disabled={!loadVehicleId || loadVehicleId===manageVehicleId}><Truck size={13}/> Move {loadQuantity}</GlassButton></>:<GlassButton size="sm" onClick={confirmInvoiceLoad}><Truck size={13}/> Load {loadQuantity} pallet{loadQuantity===1?"":"s"}</GlassButton>}</div>
    </GlassCard></div>}
    {showBuildingEditor&&<div className="bulk-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setShowBuildingEditor(false)}}><GlassCard className="bulk-planner-modal bulk-modal-surface"><div className="bulk-panel-title"><Store size={16}/> Stores & destinations <button onClick={()=>setShowBuildingEditor(false)}><X size={14}/></button></div><div className="bulk-modal-intro">Create reusable store categories with default weekdays, specific dates, area and operational notes.</div><div className="bulk-store-form"><input value={storeForm.name} placeholder="Customer / store / destination name" onChange={e=>setStoreForm({...storeForm,name:e.target.value})}/><select value={storeForm.type} onChange={e=>setStoreForm({...storeForm,type:e.target.value as Building["type"]})}><option value="store">Store</option><option value="hospital">Hospital / Ward</option><option value="warehouse">Warehouse</option><option value="other">Other</option><option value="custom">Custom type</option></select><select value={storeForm.division} onChange={e=>setStoreForm({...storeForm,division:e.target.value})}><option value="">Current page: {divisionView}</option><option value="Pharma">Pharma</option><option value="Consumer">Consumer</option></select>{storeForm.type==="custom"&&<input value={storeForm.custom_type} placeholder="Custom type name" onChange={e=>setStoreForm({...storeForm,custom_type:e.target.value})}/>}<input value={storeForm.area} placeholder="Area" onChange={e=>setStoreForm({...storeForm,area:e.target.value})}/><input value={storeForm.note} placeholder="Details / notes" onChange={e=>setStoreForm({...storeForm,note:e.target.value})}/><div className="bulk-store-days">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d,i)=><button type="button" key={d} className={storeForm.schedule_days.includes(i)?"active":""} onClick={()=>toggleStoreDay(i)}>{d}</button>)}</div><div className="bulk-specific-date-picker"><input type="date" value={storeDatePicker} onChange={e=>setStoreDatePicker(e.target.value)}/><GlassButton variant="secondary" size="sm" onClick={addStoreSpecificDate}><Plus size={13}/> Add date</GlassButton><span>{storeForm.schedule_dates || "No specific dates selected"}</span></div><div className="bulk-store-form-actions"><GlassButton size="sm" onClick={addStore}>{editingStoreId?<Check size={13}/>:<Plus size={13}/>} {editingStoreId?"Update Customer / Location":"Add Customer / Location"}</GlassButton>{editingStoreId&&<GlassButton variant="secondary" size="sm" onClick={()=>{setEditingStoreId(null);setStoreForm({ name:"", type:"store", custom_type:"", area:"", note:"", schedule_days:[], schedule_dates:"", division:divisionView });}}>Cancel</GlassButton>}</div></div><div className="bulk-store-list">{(plan.buildings||[]).map(b=><div className="bulk-store-row" key={b.id}><div className="bulk-store-icon">{storeIcon(b.type)}</div><div><b>{b.name}</b><span>{buildingTypeLabel(b)} · {b.division || "Shared"} · {b.area||"Area not set"}{b.note?` · ${b.note}`:""}</span><small>{b.schedule_days?.length?b.schedule_days.map((d:number)=>["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]).join(" · "):"Every day"}{b.schedule_dates?.length?` · ${b.schedule_dates.length} specific date(s)`:""}</small></div><div className="bulk-store-row-actions"><button className="btn icon-btn" title="Edit store / customer" onClick={()=>editStore(b)}><Pencil size={13}/></button><button className="btn icon-btn" title="Remove store" onClick={()=>removeStore(b.id)}><Trash2 size={13}/></button></div></div>)}</div></GlassCard></div>}

    {(showCustomerManager||showScheduleManager||showInvoiceManager||editingInvoice||invoiceForm.invoice_no)&&<div className="bulk-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget){setShowCustomerManager(false);setShowScheduleManager(false);setShowInvoiceManager(false);setEditingInvoice(null);setInvoiceBuildingLocked(false);setInvoiceCustomerLocked(false);setInvoiceBatchMode(false);setInvoiceBatchRows([]);setInvoiceForm(x=>({...x,invoice_no:"",building_id:""}))}}}><GlassCard className="bulk-planner-modal bulk-modal-surface">
      <div className="bulk-panel-title"><Users size={16}/> Data & scheduling <button onClick={()=>{setShowCustomerManager(false);setShowScheduleManager(false);setShowInvoiceManager(false);setEditingInvoice(null);setInvoiceBuildingLocked(false);setInvoiceCustomerLocked(false);setInvoiceBatchMode(false);setInvoiceBatchRows([]);setInvoiceForm(x=>({...x,invoice_no:"",building_id:""}))}}><X size={14}/></button></div>
      <div className="bulk-modal-intro">Keep customer, schedule and invoice data in one clean workspace. Each invoice appears on its scheduled date.</div>
      {showScheduleManager&&<div className="bulk-modal-block"><h4>Customer schedule</h4><div className="bulk-schedule-editor"><input list="bulk-customer-library" value={scheduleForm.customer_name} placeholder="Customer" onChange={e=>setScheduleForm({...scheduleForm,customer_name:e.target.value})}/><select value={scheduleForm.area} onChange={e=>setScheduleForm({...scheduleForm,area:e.target.value})}><option value="">Area</option>{areas.map(a=><option key={a.id} value={a.name}>{a.code} · {a.name}</option>)}</select><select value={scheduleForm.division} onChange={e=>setScheduleForm({...scheduleForm,division:e.target.value})}><option value="">Division</option><option>Pharma</option><option>Consumer</option></select><select value={scheduleForm.building_id} onChange={e=>setScheduleForm({...scheduleForm,building_id:e.target.value})}><option value="">Store / destination</option>{(plan.buildings||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select><div className="bulk-day-picker">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d,i)=><button key={d} className={scheduleForm.days.includes(i)?"active":""} onClick={()=>setScheduleForm(x=>({...x,days:x.days.includes(i)?x.days.filter(y=>y!==i):[...x.days,i]}))}>{d}</button>)}</div><GlassButton size="sm" onClick={addSchedule}><Plus size={14}/> Save Schedule</GlassButton></div></div>}
      {(showInvoiceManager||editingInvoice||invoiceForm.invoice_no)&&<div className="bulk-modal-block">
        <h4>{editingInvoice?"Edit invoice":invoiceBatchMode?"Add invoices":"Add invoice"}</h4>
        {invoiceBatchMode&&!editingInvoice ? <div className="bulk-invoice-batch-list">
          {(invoiceBatchRows.length?invoiceBatchRows:[invoiceForm]).map((row,idx)=>{const rowBuilding=(plan.buildings||[]).find(b=>b.id===row.building_id);const rowDates=allowedDatesForBuilding(row.building_id,row.schedule_date);return <div className="bulk-invoice-batch-row" key={idx}>
            <input value={row.invoice_no} placeholder={`Invoice ${idx+1}`} onChange={e=>setInvoiceBatchRows(rows=>{const base=rows.length?rows:[{...invoiceForm}];return base.map((r,j)=>j===idx?{...r,invoice_no:e.target.value}:r)})}/>
            <input list="bulk-customer-library" value={row.customer_name} disabled={invoiceCustomerLocked} placeholder="Customer" onChange={e=>{const name=e.target.value;const c=customers.find(x=>norm(x.name)===norm(name));setInvoiceBatchRows(rows=>{const base=rows.length?rows:[{...invoiceForm}];return base.map((r,j)=>j===idx?{...r,customer_name:name,customer_id:c?.id||"",area:c?.area||r.area,division:c?.division||r.division}:r)})}}/>
            <select value={row.building_id} disabled={batchBuildingLocked()} onChange={e=>{const id=e.target.value;const b=(plan.buildings||[]).find(x=>x.id===id);setInvoiceBatchRows(rows=>{const base=rows.length?rows:[{...invoiceForm}];return base.map((r,j)=>j===idx?{...r,building_id:id,customer_name:isOthersStore(b)?r.customer_name:(b?.name||r.customer_name),area:b?.area||r.area,division:b?.division||r.division,schedule_date:buildingAllowsDate(id,date)?date:""}:r)})}}><option value="">Store / location</option>{(plan.buildings||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>
            <select value={row.area} onChange={e=>setInvoiceBatchRows(rows=>{const base=rows.length?rows:[{...invoiceForm}];return base.map((r,j)=>j===idx?{...r,area:e.target.value}:r)})}><option value="">Area</option>{areas.map(a=><option key={a.id} value={a.name}>{a.code} · {a.name}</option>)}</select>
            <select value={row.division} onChange={e=>setInvoiceBatchRows(rows=>{const base=rows.length?rows:[{...invoiceForm}];return base.map((r,j)=>j===idx?{...r,division:e.target.value}:r)})}><option value="">Division</option><option>Pharma</option><option>Consumer</option></select>
            <input type="number" min={1} value={row.pallets} title="Pallets" onChange={e=>setInvoiceBatchRows(rows=>{const base=rows.length?rows:[{...invoiceForm}];return base.map((r,j)=>j===idx?{...r,pallets:Math.max(1,Number(e.target.value))}:r)})}/>
            <input type="date" value={row.invoice_date} title="Invoice date" onChange={e=>setInvoiceBatchRows(rows=>{const base=rows.length?rows:[{...invoiceForm}];return base.map((r,j)=>j===idx?{...r,invoice_date:e.target.value}:r)})}/>
            <select value={row.schedule_date} title="Schedule" onChange={e=>setInvoiceBatchRows(rows=>{const base=rows.length?rows:[{...invoiceForm}];return base.map((r,j)=>j===idx?{...r,schedule_date:e.target.value}:r)})}><option value="">Waiting for schedule</option>{rowDates.map(d=><option key={d} value={d}>{dayLabel(d)}</option>)}</select>
            {invoiceBatchRows.length>1&&<button type="button" className="btn icon-btn" title="Remove invoice" onClick={()=>setInvoiceBatchRows(rows=>rows.filter((_,j)=>j!==idx))}><X size={12}/></button>}
          </div>})}
          <div className="bulk-invoice-batch-actions"><button type="button" className="bulk-batch-select-btn" onClick={()=>setInvoiceBatchRows(rows=>[...(rows.length?rows:[{...invoiceForm}]),{...(rows.length?rows[rows.length-1]:invoiceForm),invoice_no:""}])}><Plus size={12}/> Add another invoice</button><GlassButton size="sm" onClick={addInvoiceBatch}><Check size={14}/> Add all invoices</GlassButton></div>
        </div> : <div className="bulk-invoice-form">
          <input value={invoiceForm.invoice_no} placeholder="Invoice no." onChange={e=>setInvoiceForm({...invoiceForm,invoice_no:e.target.value})}/><input list="bulk-customer-library" value={invoiceForm.customer_name} disabled={invoiceCustomerLocked} className={invoiceCustomerLocked?"bulk-invoice-locked-field":""} placeholder="Customer / Supply / Other customer" onChange={e=>{const name=e.target.value;const c=customers.find(x=>norm(x.name)===norm(name));const sched=plan.customer_schedules?.find(s=>norm(s.customer_name)===norm(name));setInvoiceForm({...invoiceForm,customer_name:name,customer_id:c?.id||"",building_id:invoiceBuildingLocked ? invoiceForm.building_id : (sched?.building_id||buildingForCustomer(name)?.id||invoiceForm.building_id),area:c?.area||invoiceForm.area,division:c?.division||invoiceForm.division})}}/><label className="bulk-field-with-label"><span>Store / location</span>{invoiceBuildingLocked ? <div className="bulk-invoice-locked-location">{buildingTypeLabel((plan.buildings||[]).find(b=>b.id===invoiceForm.building_id) || {id:"",name:"Selected location",type:"other",area:"",enabled:true})}</div> : <select value={invoiceForm.building_id} onChange={e=>{const buildingId=e.target.value;const b=(plan.buildings||[]).find(x=>x.id===buildingId);const isOthers=norm(b?.name)==="OTHERS";const c=isOthers?undefined:customers.find(x=>norm(x.name)===norm(b?.name||""));const linkedSchedule=plan.customer_schedules?.find(s=>s.building_id===buildingId);setInvoiceCustomerLocked(!!b&&!isOthers);setInvoiceForm(x=>({...x,building_id:buildingId,customer_name:isOthers?"":(b?.name||""),customer_id:c?.id||`manual:${buildingId||""}`,area:b?.area||linkedSchedule?.area||x.area,division:b?.division||linkedSchedule?.division||x.division,schedule_date:(x.schedule_date&&buildingAllowsDate(buildingId,x.schedule_date))?x.schedule_date:""}));if(!isOthers&&b&&!buildingAllowsDate(buildingId,date))setScheduleMode("specific");}}><option value="">Select location</option>{(plan.buildings||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>}</label><select value={invoiceForm.area} onChange={e=>setInvoiceForm({...invoiceForm,area:e.target.value})}><option value="">Area</option>{areas.map(a=><option key={a.id} value={a.name}>{a.code} · {a.name}</option>)}</select><select value={invoiceForm.division} onChange={e=>setInvoiceForm({...invoiceForm,division:e.target.value})}><option value="">Division</option><option>Pharma</option><option>Consumer</option></select><label className="bulk-field-with-label"><span>Pallets</span><input type="number" min={1} value={invoiceForm.pallets} onChange={e=>setInvoiceForm({...invoiceForm,pallets:Math.max(1,Number(e.target.value))})}/></label><label className="bulk-field-with-label"><span>Invoice date</span><input type="date" value={invoiceForm.invoice_date} onChange={e=>setInvoiceForm({...invoiceForm,invoice_date:e.target.value})}/></label><label className="bulk-field-with-label"><span>Schedule</span><select value={scheduleMode} onChange={e=>{const v=e.target.value as "today"|"waiting"|"specific";setScheduleMode(v);setInvoiceForm({...invoiceForm,schedule_date:v==="today"?date:v==="waiting"?"":(invoiceForm.schedule_date&&allowedInvoiceDates.includes(invoiceForm.schedule_date)?invoiceForm.schedule_date:(allowedInvoiceDates[0]||""))})}}>{buildingAllowsDate(invoiceForm.building_id,date)&&<option value="today">Schedule for today</option>}<option value="waiting">Waiting for schedule</option><option value="specific">Specific allowed date</option></select>{scheduleMode==="specific"&&<select value={invoiceForm.schedule_date} onChange={e=>setInvoiceForm({...invoiceForm,schedule_date:e.target.value})}><option value="">Select allowed date</option>{allowedInvoiceDates.map(d=><option key={d} value={d}>{dayLabel(d)}</option>)}</select>}</label><GlassButton size="sm" onClick={editingInvoice?updateInvoice:addInvoice}>{editingInvoice?<Check size={14}/>:<Plus size={14}/>} {editingInvoice?"Update":"Add"} Invoice</GlassButton>
        </div>}
      </div>}
    </GlassCard></div>}
    <datalist id="bulk-driver-library">{driverLibrary.map(d=><option key={d.id} value={d.name}>{d.code}</option>)}</datalist><datalist id="bulk-helper-library">{helperLibrary.map(h=><option key={h.id} value={h.name}>{h.code}</option>)}</datalist><datalist id="bulk-customer-library">{Array.from(new Set([...customerLibrary,...customers.map(c=>c.name)])).map(c=><option key={c} value={c}/>)}</datalist>
  </div>;
}
