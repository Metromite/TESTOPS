import { Component, ErrorInfo, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Bell, Building2, CalendarDays, CarFront, Check, ChevronLeft, ChevronRight,
  CircleAlert, Clock3, Database, GripVertical, Hospital, MapPin, Package, Pencil,
  Plus, RefreshCw, Save, Search, ShieldCheck, Store, Trash2, Truck, Users, X, ChevronDown,
  UserRound, Gauge, Route, Sparkles, ListChecks
} from "lucide-react";
import { supabase, getPrimarySupabaseClient, getTertiarySupabaseClient } from "../lib/supabase";
import { GlassButton } from "../design-system/GlassButton";
import { getRole } from "../api/client";
import { GlassCard } from "../design-system/GlassCard";
import { GlassInput } from "../design-system/GlassInput";
import {
  loadBulkOrganizerDefaults, loadBulkOrganizerPlan, saveBulkOrganizerDefaults,
  saveBulkOrganizerPlan, type BulkOrganizerDefaults, type BulkOrganizerPlan
} from "../services/bulkOrganizer";

const norm = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
const MAX_UI_PALLETS = 100;
const safePalletCount = (value: unknown, fallback = 1) => { const n = Number(value); if (!Number.isFinite(n) || n <= 0) return fallback; return Math.min(Math.floor(n), MAX_UI_PALLETS); };
const rawPalletCount = (value: unknown, fallback = 1) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback; };
const isPickup = (v: unknown) => { const n = norm(v); return n === "PICKUP" || n.includes("PICK UP"); };
const isVan = (v: unknown) => norm(v).includes("VAN");
const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const monthKey = (date: string) => `${date.slice(0, 7)}-01`;
const canonicalInvoiceDate = (value: unknown) => {
  const s = String(value ?? "").trim();
  if (!s) return null;
  return s.slice(0, 10);
};
const canonicalizeInvoice = (invoice: any, fallbackDate?: string): any => ({
  ...invoice,
  scheduled_date: canonicalInvoiceDate(invoice?.scheduled_date ?? invoice?.schedule_date) || (fallbackDate ? canonicalInvoiceDate(fallbackDate) : null),
});
const BULK_DELETED_INVOICES_KEY = "dispatchops.bulkOrganizer.deletedInvoices.v1";
const readDeletedInvoiceKeys = () => { try { const raw=localStorage.getItem(BULK_DELETED_INVOICES_KEY); const parsed=raw?JSON.parse(raw):[]; return new Set<string>(Array.isArray(parsed)?parsed.map(String):[]); } catch { return new Set<string>(); } };
const invoiceDeletionKeys = (invoice: any) => [String(invoice?.id || ""), norm(invoice?.invoice_no || "")].filter(Boolean);
const isBulkInvoiceDeleted = (invoice: any) => { const keys=readDeletedInvoiceKeys(); return invoiceDeletionKeys(invoice).some(k=>keys.has(k)); };
const rememberBulkInvoiceDeleted = (invoice: any) => { try { const keys=readDeletedInvoiceKeys(); invoiceDeletionKeys(invoice).forEach(k=>keys.add(k)); localStorage.setItem(BULK_DELETED_INVOICES_KEY, JSON.stringify(Array.from(keys))); } catch {} };
const nextMonthKey = (date: string) => { const d = new Date(`${date.slice(0,7)}-01T12:00:00`); d.setMonth(d.getMonth()+1); return dateKey(d); };
const dayLabel = (date: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00`));
const divisionFor = (row: any) => { const d = norm(row.division_desc); if (d.includes("PHARMA")) return "Pharma"; if (d.includes("CONSUMER")) return "Consumer"; return row.division_desc || "Unknown"; };
const SMALL_TO_BIG = 2 / 3; // Standard: 1 Big = 1.5 Small, so 1 Small = 2/3 Big-equivalent.
const palletEquivalent = (size: "big" | "small", quantity: number, smallToBig = SMALL_TO_BIG) => Math.max(0, Number(quantity || 0)) * (size === "small" ? smallToBig : 1);
const mixedPalletTypes = (big: number, small: number): Array<"big" | "small"> => [...Array(Math.max(0, Math.floor(Number(big || 0)))).fill("big"), ...Array(Math.max(0, Math.floor(Number(small || 0)))).fill("small")];
const formatEquivalent = (value: number) => { const n = Math.max(0, Number(value || 0)); const rounded = Math.ceil((n - 1e-9) * 2) / 2; return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1); };

// Box standard supplied for Bulk Organizer: capacities are per physical pallet.
// We calculate each box size deterministically: full Big pallets first, then
// full/partial Small pallets, with 1 Small pallet = 2/3 Big-equivalent.
type BoxPalletSettings = {
  big: { small: number; medium: number; big: number };
  small: { small: number; medium: number; big: number };
  smallToBig: number;
};
const DEFAULT_BOX_PALLET_SETTINGS: BoxPalletSettings = {
  big: { small: 200, medium: 100, big: 32 },
  small: { small: 130, medium: 70, big: 24 },
  smallToBig: SMALL_TO_BIG,
};
const BULK_BOX_SETTINGS_KEY = "dispatchops.bulkOrganizer.boxSettings.v1";
const BULK_CLEARED_BEFORE_KEY = "dispatchops.bulkOrganizer.clearedBefore.v1";
const loadLocalBoxSettings = (): BoxPalletSettings => {
  try {
    const raw = localStorage.getItem(BULK_BOX_SETTINGS_KEY);
    const x = raw ? JSON.parse(raw) : null;
    return {
      big: { small: Math.max(1, Number(x?.big?.small) || 200), medium: Math.max(1, Number(x?.big?.medium) || 100), big: Math.max(1, Number(x?.big?.big) || 32) },
      small: { small: Math.max(1, Number(x?.small?.small) || 130), medium: Math.max(1, Number(x?.small?.medium) || 70), big: Math.max(1, Number(x?.small?.big) || 24) },
      smallToBig: Math.max(0.01, Number(x?.smallToBig) || SMALL_TO_BIG),
    };
  } catch { return DEFAULT_BOX_PALLET_SETTINGS; }
};
type BoxCounts = { small: number; medium: number; big: number };
const emptyBoxCounts = (): BoxCounts => ({ small: 0, medium: 0, big: 0 });
const normalizeBoxCounts = (value: any): BoxCounts => ({
  small: Math.max(0, Math.floor(Number(value?.small || 0))),
  medium: Math.max(0, Math.floor(Number(value?.medium || 0))),
  big: Math.max(0, Math.floor(Number(value?.big || 0))),
});
const calculateBoxLoad = (value: any, settings: BoxPalletSettings = DEFAULT_BOX_PALLET_SETTINGS) => {
  const boxes = normalizeBoxCounts(value);
  let bigFull = 0;
  let smallFull = 0;
  let smallFraction = 0;
  let partialSmallPallets = 0;
  const remainder = emptyBoxCounts();
  const palletTypes: Array<"big" | "small"> = [];
  const palletEquivalents: number[] = [];
  (Object.keys(boxes) as Array<keyof BoxCounts>).forEach(type => {
    let left = boxes[type];
    const bigCap = settings.big[type];
    const smallCap = settings.small[type];
    const fullBig = Math.floor(left / bigCap);
    bigFull += fullBig;
    for (let i = 0; i < fullBig; i++) { palletTypes.push("big"); palletEquivalents.push(1); }
    left -= fullBig * bigCap;
    const fullSmall = Math.floor(left / smallCap);
    smallFull += fullSmall;
    for (let i = 0; i < fullSmall; i++) { palletTypes.push("small"); palletEquivalents.push(settings.smallToBig); }
    left -= fullSmall * smallCap;
    if (left > 0) {
      smallFraction += left / smallCap;
      partialSmallPallets += 1;
      palletTypes.push("small");
      palletEquivalents.push((left / smallCap) * settings.smallToBig);
      remainder[type] = left;
    }
  });
  const physicalSmall = smallFull + partialSmallPallets;
  const bigEquivalent = bigFull + (smallFull + smallFraction) * settings.smallToBig;
  const physicalPallets = bigFull + physicalSmall;
  return {
    boxes, bigFull, smallFull, smallFraction, physicalSmall, physicalPallets, bigEquivalent, remainder, palletTypes, palletEquivalents,
  };
};
const formatPreciseEquivalent = (value: number) => { const n = Math.max(0, Number(value || 0)); return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") || "0"; };
const formatInvoiceEquivalent = (inv: any, value?: number) => inv?.box_pallet_calc?.bigEquivalent != null ? formatPreciseEquivalent(value ?? Number(inv.box_pallet_calc.bigEquivalent || 0)) : formatEquivalent(value ?? 0);
const formatOperationalEquivalent = (value: number) => { const n=Math.max(0,Number(value||0)); return Math.abs(n*2-Math.round(n*2))<1e-9 ? formatEquivalent(n) : formatPreciseEquivalent(n); };
const boxSummaryText = (inv: any, settings: BoxPalletSettings = DEFAULT_BOX_PALLET_SETTINGS) => {
  const calc = inv?.box_pallet_calc || calculateBoxLoad(inv?.box_counts, settings);
  if (!calc?.physicalPallets) return "";
  const parts: string[] = [];
  if (calc.bigFull) parts.push(`${calc.bigFull} Big`);
  if (calc.smallFull) parts.push(`${calc.smallFull} Small`);
  if (calc.smallFraction > 0) parts.push(`${formatPreciseEquivalent(calc.smallFraction * settings.smallToBig)} Big-equiv partial Small`);
  const rem = calc.remainder || {};
  const left = Object.entries(rem).filter(([,v]) => Number(v) > 0).map(([k,v]) => `${v} ${k} box${Number(v)===1?"":"es"}`);
  if (left.length) parts.push(`remaining: ${left.join(", ")}`);
  return parts.join(" · ");
};
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
  area: string; enabled: boolean; note?: string; timing?: string; linked_customers?: Array<{ id: string; name: string; area?: string; division?: string; manual?: boolean }>; schedule_days?: number[]; schedule_dates?: string[]; sort_order?: number; can_share_vehicle?: boolean;
};
type LinkedCustomer = NonNullable<Building["linked_customers"]>[number];
type CustomerSchedule = {
  id: string; customer_name: string; days: number[]; area: string; division: string; building_id?: string | null; enabled: boolean;
};
type InvoicePlan = {
  id: string; invoice_no: string; customer_id: string; customer_name: string; area: string;
  division: string; pallets: number; pallet_size?: "big" | "small"; pallet_quantity?: number; big_pallets?: number; small_pallets?: number;
  pallet_types?: Array<"big" | "small">;
  box_counts?: BoxCounts;
  box_pallet_calc?: ReturnType<typeof calculateBoxLoad>;
  pallet_equivalents?: number[];
  timing?: string;
  remarks?: string;
  can_share_vehicle?: boolean;
  invoice_date: string | null; scheduled_date: string | null; schedule_mode?: "today" | "waiting" | "specific" | "any_day"; vehicle_id: string | null; building_id?: string | null;
  source_entry_id?: string; source_department?: string; handover_status?: "ready" | "handed_over";
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

class BulkOrganizerErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string }> {
  state = { hasError: false, message: "" };
  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, message: error instanceof Error ? error.message : String(error || "Unknown Bulk Organizer error") };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Bulk Organizer render error", error, info);
  }
  render() {
    if (this.state.hasError) {
      return <div className="bulk-organizer-runtime-error" role="alert">
        <div className="bulk-organizer-runtime-error-card">
          <h2>Bulk Organizer could not be displayed</h2>
          <p>The application is still running. The planner hit a data/rendering error instead of taking down the whole page.</p>
          <code>{this.state.message}</code>
          <button type="button" onClick={() => this.setState({ hasError: false, message: "" })}>Try again</button>
        </div>
      </div>;
    }
    return this.props.children;
  }
}

function BulkOrganizerPage() {
  const departmentDb = getTertiarySupabaseClient() || supabase;
  const [date, setDate] = useState(dateKey(new Date()));
  const [divisionView, setDivisionView] = useState<"Pharma" | "Consumer">("Pharma");
  const [fleet, setFleet] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [vehicleAreaAccess, setVehicleAreaAccess] = useState<Record<string, { areas: any[]; groups: any[] }>>({});
  const [facts, setFacts] = useState<any[]>([]);
  const [customerLibrary, setCustomerLibrary] = useState<string[]>([]);
  const [driverLibrary, setDriverLibrary] = useState<any[]>([]);
  const [helperLibrary, setHelperLibrary] = useState<any[]>([]);
  const [waitingInvoices, setWaitingInvoices] = useState<InvoicePlan[]>([]);
  const [anyDayInvoices, setAnyDayInvoices] = useState<InvoicePlan[]>([]);
  const [plan, setPlan] = useState<PlanV3>(emptyPlan(date));
  const [defaults, setDefaults] = useState<DefaultsV2>({ buildings: [], vehicles: [], customer_schedules: [] });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cleaningPreviousMonths, setCleaningPreviousMonths] = useState(false);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [defaultsSaved, setDefaultsSaved] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [dragged, setDragged] = useState<{ type: "invoice" | "pallet" | "vehicle" | "customer" | "store"; id: string } | null>(null);
  const [worldZoom, setWorldZoom] = useState(1);
  const initialBulkTheme = document.documentElement.getAttribute("data-theme") || (document.documentElement.classList.contains("dark") ? "dark" : "light");
  const [bulkTheme, setBulkTheme] = useState(initialBulkTheme);
  const planRef = useRef<PlanV3>(plan);
  const defaultsRef = useRef<DefaultsV2>(defaults);
  const autoSaveTimer = useRef<number | null>(null);
  const autoDefaultsTimer = useRef<number | null>(null);
  const hydratedDateRef = useRef<string>("");
  const savingPlanRef = useRef(false);
  const savingDefaultsRef = useRef(false);
  const [showFleet, setShowFleet] = useState(false);
  const [showBulkSettings, setShowBulkSettings] = useState(false);
  const [boxSettings, setBoxSettings] = useState<BoxPalletSettings>(() => loadLocalBoxSettings());
  const [linkedCustomerInputs, setLinkedCustomerInputs] = useState<Record<string, string>>({});
  const [vehiclesExpanded, setVehiclesExpanded] = useState(false);
  const [customerSectionExpanded, setCustomerSectionExpanded] = useState(false);
  const [expandedStoreIds, setExpandedStoreIds] = useState<Set<string>>(new Set());
  const [expandedVehicleIds, setExpandedVehicleIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!expandedStoreIds.size) return;
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".bulk-store-compact-card, .bulk-store-customer-box")) setExpandedStoreIds(new Set());
    };
    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, [expandedStoreIds]);
  const [showBuildingEditor, setShowBuildingEditor] = useState(false);
  const [storeForm, setStoreForm] = useState({ name: "", type: "store" as Building["type"], custom_type: "", area: "", note: "", timing: "", schedule_days: [] as number[], schedule_dates: "", division: "", can_share_vehicle: true });
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [storeDatePicker, setStoreDatePicker] = useState("");
  const [invoiceBuildingLocked, setInvoiceBuildingLocked] = useState(false);
  const [invoiceCustomerLocked, setInvoiceCustomerLocked] = useState(false);
  const [showCustomerManager, setShowCustomerManager] = useState(false);
  const [showInvoiceManager, setShowInvoiceManager] = useState(false);
  const [showScheduleManager, setShowScheduleManager] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<InvoicePlan | null>(null);
  const [deleteInvoiceTarget, setDeleteInvoiceTarget] = useState<InvoicePlan | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({ invoice_no: "", customer_id: "", customer_name: "", area: "", division: "", pallets: 1, pallet_size: "big" as "big" | "small", pallet_quantity: 1, big_pallet_quantity: 1, small_pallet_quantity: 0, box_small: 0, box_medium: 0, box_big: 0, timing: "", remarks: "", can_share_vehicle: "store" as "store" | "yes" | "no", invoice_date: "", schedule_date: "", building_id: "" });
  const [scheduleMode, setScheduleMode] = useState<"today" | "waiting" | "specific" | "any_day">("today");
  const [loadInvoiceTarget, setLoadInvoiceTarget] = useState<InvoicePlan | null>(null);
  const [showBatchLoadModal, setShowBatchLoadModal] = useState(false);
  const [invoiceBatchMode, setInvoiceBatchMode] = useState(false);
  const [invoiceBatchRows, setInvoiceBatchRows] = useState<Array<typeof invoiceForm>>([]);
  const [batchScheduleOpen, setBatchScheduleOpen] = useState<Record<number, boolean>>({});
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
      const primaryDb = getPrimarySupabaseClient();
      // Phase 1: hydrate the saved planner immediately. The heavy SAP/month queries
      // must never block the first paint of the page.
      const [v, a, p, pg, gm, saved, savedDefaults, departmentEntriesResult, waitingRowsResult] = await Promise.all([
        primaryDb.from("vehicles").select("*").order("number"),
        primaryDb.from("areas").select("id,code,name,sector,region,route_type,vehicle_type").order("code"),
        primaryDb.from("vehicle_permitted_areas").select("vehicle_id,area_id,areas(id,code,name)"),
        primaryDb.from("vehicle_permitted_area_groups").select("vehicle_id,group_id,area_groups(id,name)"),
        primaryDb.from("area_group_members").select("group_id,area_id,areas(id,code,name)"),
        loadBulkOrganizerPlan(selectedDate),
        loadBulkOrganizerDefaults(mk).catch(() => null),
        departmentDb.from("department_dispatch_entries").select("*").eq("target_date", selectedDate).in("department", divisionView === "Consumer" ? ["Consumer"] : ["Pharma", "Medical"]).order("created_at"),
        departmentDb.from("bulk_organizer_plans").select("plan_date,invoices,pallets").order("plan_date"),
      ]);
      if (v.error) throw v.error; if (a.error) throw a.error; if (p.error) throw p.error;
      // Area-group reads are enrichment only. If Fleet Data permissions are temporarily unavailable,
      // keep the existing Bulk Organizer fully usable instead of blocking the planner.
      const groupRows = (pg as any).error ? [] : (((pg as any).data || []) as any[]);
      const groupMemberRows = (gm as any).error ? [] : (((gm as any).data || []) as any[]);

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
      const clearedBefore = (() => { try { return localStorage.getItem(BULK_CLEARED_BEFORE_KEY) || ""; } catch { return ""; } })();
      const hideClearedHistory = Boolean(clearedBefore && selectedDate < clearedBefore);
      const departmentEntries = hideClearedHistory ? [] : (((departmentEntriesResult as any)?.data || []) as any[]);
      const departmentInvoices: InvoicePlan[] = departmentEntries
        .filter(e => String(e.status || "ready") !== "cancelled" && !isBulkInvoiceDeleted({ id:`dept:${e.id}`, invoice_no:e.invoice_no }))
        .map(e => ({
          id: `dept:${e.id}`, invoice_no: e.invoice_no,
          customer_id: `dept:${e.store_id || e.store_name}`, customer_name: e.store_name,
          area: e.area || "", division: e.division,
          pallets: Math.max(1, Number(e.pallet_count || 1)),
          pallet_size: Number(e.big_pallet_count || 0) > 0 && Number(e.small_pallet_count || 0) === 0 ? "big" : "small",
          pallet_quantity: Number(e.big_pallet_count || 0) > 0 && Number(e.small_pallet_count || 0) === 0 ? Number(e.big_pallet_count || 0) : Number(e.small_pallet_count || e.pallet_count || 1),
          big_pallets: Math.max(0, Number(e.big_pallet_count || 0)),
          small_pallets: Math.max(0, Number(e.small_pallet_count || 0)),
          pallet_types: Array.from({length: safePalletCount(e.pallet_count)}, (_, k) => k < Number(e.big_pallet_count || 0) ? "big" : "small"),
          invoice_date: e.entry_date || null, scheduled_date: e.target_date, vehicle_id: null,
          building_id: e.store_id || null, source_entry_id: e.id, source_department: e.department,
          handover_status: e.status === "handed_over" ? "handed_over" : "ready",
        }));
      const mergedDepartmentInvoices = departmentInvoices.map(i => canonicalizeInvoice(i, selectedDate)).filter(di => !(old.invoices || []).some((i:any) => i.source_entry_id === di.source_entry_id || i.id === di.id));
      if (mergedDepartmentInvoices.length) old.invoices = [...(old.invoices || []), ...mergedDepartmentInvoices];

      const storedInvoicesRaw = [
        ...(Array.isArray((old as any).invoices) ? (old as any).invoices : []),
        ...(Array.isArray((old as any).pallets) ? (old as any).pallets : []),
      ];
      const storedInvoices = Array.from(new Map(storedInvoicesRaw.map((x: any) => [String(x?.id || x?.invoice_no || crypto.randomUUID()), canonicalizeInvoice(x)])).values());
      const storedAssignments: Record<string, string | null> = { ...(old.pallet_assignments || {}) };
      const isPhysicallyLoaded = (invoice: any) => Boolean(invoice?.vehicle_id) || Object.entries(storedAssignments).some(([key, value]) => Boolean(value) && key.startsWith(`${invoice?.id}::`));
      // A legacy waiting invoice can already have a vehicle assignment while its
      // scheduled_date is still null. In that state the old UI reports it as
      // loaded but cannot render it inside a vehicle because vehicle cards only
      // show today's scheduled invoices. Loading a waiting invoice means it
      // belongs to the currently selected day, so promote that legacy record to
      // today's schedule before building the visible plan.
      const normalizedStoredInvoices = storedInvoices.map((invoice: any) =>
        !invoice.scheduled_date && isPhysicallyLoaded(invoice)
          ? { ...invoice, scheduled_date: canonicalInvoiceDate(selectedDate) }
          : invoice
      );
      const promotedLegacyWaiting = normalizedStoredInvoices.some((invoice: any, index: number) =>
        invoice.scheduled_date !== storedInvoices[index]?.scheduled_date && !storedInvoices[index]?.scheduled_date
      );
      const savedInvoices = normalizedStoredInvoices.filter((x: any) => !x.scheduled_date || canonicalInvoiceDate(x.scheduled_date) === canonicalInvoiceDate(selectedDate));
      if (promotedLegacyWaiting) {
        const promoted = normalizedStoredInvoices;
        old.invoices = promoted;
        old.pallets = promoted as any;
        void saveBulkOrganizerPlan({ ...old, plan_date: selectedDate, invoices: promoted, pallets: promoted as any }).catch(() => {});
      }
      const customerMap = new Map<string, any>();
      savedInvoices.forEach((i: any) => customerMap.set(i.customer_id || `manual:${norm(i.customer_name)}`, { id: i.customer_id || `manual:${norm(i.customer_name)}`, name: i.customer_name, area: i.area, division: i.division, enabled: true }));
      (old.customers || []).forEach(c => customerMap.set(c.id, c));
      planSchedules.forEach(s => { const id = s.id || `schedule:${norm(s.customer_name)}`; if (!customerMap.has(`schedule:${norm(s.customer_name)}`)) customerMap.set(`schedule:${norm(s.customer_name)}`, { id, name: s.customer_name, area: s.area, division: s.division, enabled: true }); });
      const assignments: Record<string, string | null> = { ...(old.pallet_assignments || {}) };
      savedInvoices.forEach(i => { for (let k = 0; k < safePalletCount(i.pallets); k++) { const key = `${i.id}::${k}`; if (!(key in assignments)) assignments[key] = i.vehicle_id || null; } });
      const defaultVehicles = loadedDefaults.vehicles.filter(x => active.some(vh => vh.id === x.vehicle_id));
      const savedVehicles = (old.vehicles || []).filter(x => active.some(vh => vh.id === x.vehicle_id));
      // A daily plan can intentionally override the monthly default, including
      // the valid case of selecting ZERO vehicles. The marker lives inside the
      // existing vehicle_meta JSON so no schema change is required.
      const dailyVehicleOverride = String((old.vehicle_meta as any)?.__selection_mode || "") === "daily";
      const hasMonthlyDefaults = Boolean(savedDefaults);
      const effectiveVehicles = dailyVehicleOverride
        ? savedVehicles
        : hasMonthlyDefaults
          ? defaultVehicles
          : savedVehicles;
      const vehicleMeta = { ...(old.vehicle_meta || {}) };
      defaultVehicles.forEach(vh => { vehicleMeta[vh.vehicle_id] = { ...(vehicleMeta[vh.vehicle_id] || {}), driver: vehicleMeta[vh.vehicle_id]?.driver || vh.driver || "", helper: vehicleMeta[vh.vehicle_id]?.helper || vh.helper || "" }; });

      const waitingMap = new Map<string, InvoicePlan>();
      for (const row of (((waitingRowsResult as any)?.data || []) as any[])) {
        const raw = [
          ...(Array.isArray(row?.invoices) ? row.invoices : []),
          ...(Array.isArray(row?.pallets) ? row.pallets : []),
        ];
        for (const rawInv of raw) {
          const inv = canonicalizeInvoice(rawInv);
          if (!inv.scheduled_date && inv.schedule_mode !== "any_day") {
            const key = String(inv.id || inv.invoice_no || `${row.plan_date}:${JSON.stringify(inv)}`);
            waitingMap.set(key, { ...inv, scheduled_date: null, vehicle_id: null });
          }
        }
      }

      const groupMembersById = new Map<string, any[]>();
      for (const row of groupMemberRows) {
        const key = String(row.group_id);
        const list = groupMembersById.get(key) || [];
        if (row.areas) list.push(row.areas);
        groupMembersById.set(key, list);
      }
      const access: Record<string, { areas: any[]; groups: any[] }> = {};
      for (const row of ((p.data || []) as any[])) {
        const key = String(row.vehicle_id);
        access[key] = access[key] || { areas: [], groups: [] };
        if (row.areas) access[key].areas.push(row.areas);
      }
      for (const row of groupRows) {
        const key = String(row.vehicle_id);
        access[key] = access[key] || { areas: [], groups: [] };
        const group = row.area_groups ? { ...row.area_groups, areas: groupMembersById.get(String(row.group_id)) || [] } : null;
        if (group) access[key].groups.push(group);
      }
      setFleet(active); setAreas(a.data ?? []); setPermissions(p.data ?? []); setVehicleAreaAccess(access);
      setDefaults({ ...loadedDefaults });
      // Waiting-for-schedule is loaded in the same first hydration transaction as
      // the visible plan. Do not clear it and then refill it later: that created
      // the brief disappear/reappear flicker. The source is all Tertiary plan rows,
      // so a waiting invoice survives day and month changes until it is actually loaded.
      setWaitingInvoices(Array.from(waitingMap.values()));
      const anyDayMap = new Map<string, InvoicePlan>();
      for (const row of (((waitingRowsResult as any)?.data || []) as any[])) {
        const raw = [...(Array.isArray(row?.invoices) ? row.invoices : []), ...(Array.isArray(row?.pallets) ? row.pallets : [])];
        for (const rawInv of raw) { const inv = canonicalizeInvoice(rawInv); if (inv.schedule_mode === "any_day") anyDayMap.set(String(inv.id || inv.invoice_no || crypto.randomUUID()), { ...inv, scheduled_date: null, vehicle_id: null }); }
      }
      setAnyDayInvoices(Array.from(anyDayMap.values()));
      setFacts([]); setCustomerLibrary([]); setDriverLibrary([]); setHelperLibrary([]);
      setPlan({ ...emptyPlan(selectedDate), ...old, plan_date: selectedDate, vehicles: effectiveVehicles, customers: Array.from(customerMap.values()), invoices: savedInvoices as any, pallets: savedInvoices as any, pallet_assignments: assignments, buildings: planBuildings, vehicle_meta: vehicleMeta, customer_schedules: planSchedules });
      hydratedDateRef.current = "";
      setLoading(false);

      // Phase 2: enrich the already-visible planner with SAP facts and month waiting
      // data. These queries are intentionally off the critical first-render path.
      const f = hideClearedHistory ? { data: [], error: null } as any : await primaryDb.from("sap_invoice_facts").select("id,invoice_no,invoice_date,dispatch_date,customer_name,area,boxes,division_desc,vehicle_num,vehicle_type,salesman").or(`dispatch_date.eq.${selectedDate},invoice_date.eq.${selectedDate}`).order("customer_name");
      if (f.error) throw f.error;
      if (selectedDate !== date) return;
      setFacts(f.data ?? []);

      const sourceInvoices: InvoicePlan[] = (f.data ?? []).filter((r:any) => !isBulkInvoiceDeleted({ id:r.invoice_no || r.id, invoice_no:r.invoice_no })).map((r: any, i: number) => ({
        id: `${r.invoice_no || r.id || i}`, invoice_no: r.invoice_no || `INV-${i + 1}`,
        customer_id: `customer:${norm(r.customer_name || "unknown")}`, customer_name: r.customer_name || "Unknown customer",
        area: r.area || "", division: divisionFor(r), pallets: Math.max(1, Number(r.boxes || 1)), invoice_date: r.invoice_date || null,
        scheduled_date: selectedDate, vehicle_id: null,
      }));
      const currentPlan = planRef.current;
      const oldNow = (currentPlan || {}) as PlanV3;
      const storedRaw = [ ...(Array.isArray((oldNow as any).invoices) ? (oldNow as any).invoices : []), ...(Array.isArray((oldNow as any).pallets) ? (oldNow as any).pallets : []) ];
      const stored = Array.from(new Map(storedRaw.map((x: any) => [String(x?.id || x?.invoice_no || crypto.randomUUID()), x])).values());
      const savedNow = stored.map((x: any) => canonicalizeInvoice(x)).filter((x: any) => !x.scheduled_date || canonicalInvoiceDate(x.scheduled_date) === canonicalInvoiceDate(selectedDate));
      const merged: InvoicePlan[] = sourceInvoices.map(src => {
        const sv = savedNow.find((x: any) => norm(x.invoice_no) === norm(src.invoice_no));
        if (!sv) return src;
        const savedDivision = String(sv.division || '').trim();
        const scheduledDivision = loadedDefaults.customer_schedules.find((cs: any) => norm(cs.customer_name) === norm(sv.customer_name || src.customer_name))?.division;
        return { ...src, ...sv, scheduled_date: selectedDate, customer_name: sv.customer_name || src.customer_name, area: sv.area || src.area, division: savedDivision && norm(savedDivision) !== 'UNKNOWN' ? savedDivision : (scheduledDivision || src.division), building_id: sv.building_id || src.building_id || null };
      });
      savedNow.forEach((sv: any) => { if (!merged.some(x => x.id === sv.id || norm(x.invoice_no) === norm(sv.invoice_no))) { const sd = loadedDefaults.customer_schedules.find((cs: any) => norm(cs.customer_name) === norm(sv.customer_name))?.division; merged.push({ ...canonicalizeInvoice(sv), scheduled_date: canonicalInvoiceDate(sv.scheduled_date), vehicle_id: sv.vehicle_id || null, division: (sv.division && norm(sv.division) !== 'UNKNOWN') ? sv.division : (sd || sv.division || 'Unknown') }); } });
      const nextAssignments: Record<string, string | null> = { ...(oldNow.pallet_assignments || {}) };
      merged.forEach(i => { for (let k = 0; k < safePalletCount(i.pallets); k++) { const key = `${i.id}::${k}`; if (!(key in nextAssignments)) nextAssignments[key] = i.vehicle_id || null; } });
      const customerMap2 = new Map<string, any>();
      merged.forEach(i => customerMap2.set(i.customer_id, customerMap2.get(i.customer_id) || { id: i.customer_id, name: i.customer_name, area: i.area, division: i.division, enabled: true }));
      (oldNow.customers || []).forEach(c => customerMap2.set(c.id, c));
      loadedDefaults.customer_schedules.forEach(s => { const id = s.id || `schedule:${norm(s.customer_name)}`; if (!customerMap2.has(`schedule:${norm(s.customer_name)}`)) customerMap2.set(`schedule:${norm(s.customer_name)}`, { id, name: s.customer_name, area: s.area, division: s.division, enabled: true }); });
      setPlan(x => ({ ...x, invoices: merged, pallets: merged as any, customers: Array.from(customerMap2.values()), pallet_assignments: nextAssignments }));

      // Secondary libraries do not block the invoice cards. They can arrive a little later.
      const [allCustomers, d, h] = await Promise.all([
        primaryDb.from("sap_invoice_facts").select("customer_name").not("customer_name", "is", null).order("customer_name").limit(5000),
        primaryDb.from("drivers").select("id,code,name,status").order("name"),
        primaryDb.from("helpers").select("id,code,name,status").order("name"),
      ]);
      if (selectedDate !== date) return;
      setDriverLibrary((d as any)?.data || []); setHelperLibrary((h as any)?.data || []);
      setCustomerLibrary(Array.from(new Set((allCustomers.data ?? []).map((x: any) => String(x.customer_name || "").trim()).filter(Boolean))));
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
    const primaryDb = getPrimarySupabaseClient();
    const channel = departmentDb.channel(`bulk-organizer-${date}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "department_dispatch_entries", filter: `target_date=eq.${date}` },
        (payload: any) => {
          const row = payload.new;
          if (!row || (row.division !== "Consumer" && !["Pharma","Medical"].includes(row.department))) return;
          if (payload.eventType === "DELETE") return;
          const incoming: InvoicePlan = {
            id: `dept:${row.id}`, invoice_no: row.invoice_no, customer_id: `dept:${row.store_id || row.store_name}`,
            customer_name: row.store_name, area: row.area || "", division: row.division,
            pallets: Math.max(1, Number(row.pallet_count || 1)), big_pallets: Number(row.big_pallet_count || 0), small_pallets: Number(row.small_pallet_count || 0),
            pallet_types: Array.from({length: safePalletCount(row.pallet_count)}, (_, k) => k < Number(row.big_pallet_count || 0) ? "big" : "small"),
            invoice_date: row.entry_date || null, scheduled_date: row.target_date, vehicle_id: null, building_id: row.store_id || null,
            source_entry_id: row.id, source_department: row.department, handover_status: row.status === "handed_over" ? "handed_over" : "ready"
          };
          setPlan(p => {
            const nextInvoices = (p.invoices || []).filter((i:any) => i.source_entry_id !== row.id);
            const next = {...p, invoices:[...nextInvoices, incoming], pallets:[...nextInvoices, incoming] as any};
            persistPlanNow(next);
            return next;
          });
        })
      .subscribe((status: string) => { if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.warn("Bulk Organizer department realtime unavailable:", status); });
    const tertiaryChannel = departmentDb.channel(`bulk-organizer-tertiary-${date}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bulk_organizer_plans", filter: `plan_date=eq.${date}` },
        () => { void loadSourceData(date); })
      .subscribe((status: string) => { if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.warn("Bulk Organizer plan realtime unavailable:", status); });
    return () => { void departmentDb.removeChannel(channel); void departmentDb.removeChannel(tertiaryChannel); };
  }, [date]);

  const vehicleMap = useMemo(() => new Map(fleet.map(v => [v.id, v])), [fleet]);
  const areaMap = useMemo(() => new Map(areas.map(a => [norm(a.name), a])), [areas]);
  const allPlanInvoices = [...(plan.invoices || []), ...anyDayInvoices.filter(a => !(plan.invoices || []).some(i => i.id === a.id))];
  // Saved/manual invoices are authoritative for the selected day. Division is a
  // view/category, not a visibility gate: an invoice with a valid scheduled date
  // must remain visible even when its stored division is blank/legacy/mismatched.
  const invoices = allPlanInvoices.filter(i => i.schedule_mode === "any_day" || canonicalInvoiceDate(i.scheduled_date) === canonicalInvoiceDate(date));
  const allTodayInvoices = allPlanInvoices.filter(i => i.schedule_mode === "any_day" || canonicalInvoiceDate(i.scheduled_date) === canonicalInvoiceDate(date));
  // Waiting-for-schedule is intentionally date-independent and division-independent.
  // It must stay visible on every planning day until the user schedules it.
  const waiting = [...waitingInvoices, ...allPlanInvoices.filter(i => !i.scheduled_date && i.schedule_mode !== "any_day" && !waitingInvoices.some(w => w.id === i.id))].filter(
    (i, idx, arr) => arr.findIndex(x => x.id === i.id || (x.invoice_no && x.invoice_no === i.invoice_no)) === idx
  );
  const customers = plan.customers || [];
  const selectedVehicles = plan.vehicles || [];
  const assignments = plan.pallet_assignments || {};
  const totalPallets = invoices.reduce((n, i) => n + Number(i.pallets || 0), 0);
  const loadedPallets = Object.entries(assignments).filter(([k,v]) => !!v && invoices.some(i => k.startsWith(`${i.id}::`))).length;
  const pendingPallets = Math.max(0, totalPallets - loadedPallets);
  const todayDow = new Date(`${date}T12:00:00`).getDay();
  const visibleInvoices = invoices.filter(i => !search || [i.invoice_no, i.customer_name, i.area, i.division].some(v => norm(v).includes(norm(search))));

  const capacityFor = (cfg: VehicleConfig, v: any) => Number(v?.pallet_capacity ?? v?.capacity_pallets ?? cfg.capacity ?? v?.capacity ?? defaultCapacity(v));
  const invoicePalletEquivalentAt = (inv: any, index: number) => {
    const dynamicBoxCalc = inv?.box_counts ? calculateBoxLoad(inv.box_counts, boxSettings) : null;
    const dynamic = Array.isArray(dynamicBoxCalc?.palletEquivalents) ? Number(dynamicBoxCalc?.palletEquivalents[index]) : NaN;
    if (Number.isFinite(dynamic)) return Math.max(0, dynamic);
    const stored = Array.isArray(inv?.pallet_equivalents) ? Number(inv.pallet_equivalents[index]) : NaN;
    if (Number.isFinite(stored)) return Math.max(0, stored);
    return palletEquivalent(invoicePalletSize(inv, index), 1, boxSettings.smallToBig);
  };
  const invoicePalletSize = (inv: any, index?: number): "big" | "small" => {
    const types = Array.isArray(inv?.pallet_types) ? inv.pallet_types : [];
    if (typeof index === "number" && types[index]) return types[index] === "small" ? "small" : "big";
    const big = Math.max(0, Number(inv?.big_pallets || 0));
    const small = Math.max(0, Number(inv?.small_pallets || 0));
    if (typeof index === "number" && (big > 0 || small > 0)) return index < big ? "big" : "small";
    if (big > 0 && small > 0) return "big";
    return inv?.pallet_size === "small" ? "small" : "big";
  };
  const invoicePhysicalQuantity = (inv: any) => {
    if (inv?.box_counts) {
      const dynamic = calculateBoxLoad(inv.box_counts, boxSettings);
      return safePalletCount(dynamic.physicalPallets || inv?.pallets || 1);
    }
    return safePalletCount(inv?.pallets ?? inv?.pallet_quantity ?? 1);
  };
  const invoiceStoredPhysicalQuantity = (inv: any) => rawPalletCount(inv?.pallets ?? inv?.pallet_quantity ?? 1);
  const invoiceBigCount = (inv:any) => Number(inv?.big_pallets ?? (invoicePalletSize(inv)==="big" ? invoicePhysicalQuantity(inv) : 0));
  const invoiceSmallCount = (inv:any) => Number(inv?.small_pallets ?? (invoicePalletSize(inv)==="small" ? invoicePhysicalQuantity(inv) : 0));
  const invoiceEquivalentCapacity = (inv: any, quantity?: number) => {
    const dynamicBoxCalc = inv?.box_counts ? calculateBoxLoad(inv.box_counts, boxSettings) : null;
    if (dynamicBoxCalc?.bigEquivalent != null) {
      const totalPhysical = Math.max(1, Number(dynamicBoxCalc.physicalPallets || invoicePhysicalQuantity(inv)));
      const q = Math.min(totalPhysical, Math.max(1, Number(quantity || totalPhysical)));
      if (q >= totalPhysical) return Number(dynamicBoxCalc.bigEquivalent || 0);
      const equivalents = Array.isArray(dynamicBoxCalc.palletEquivalents) ? dynamicBoxCalc.palletEquivalents : [];
      if (equivalents.length) return equivalents.slice(0, q).reduce((sum, value) => sum + Number(value || 0), 0);
      const types: Array<"big"|"small"> = Array.isArray(dynamicBoxCalc.palletTypes) ? dynamicBoxCalc.palletTypes : [];
      return types.slice(0, q).reduce((sum, type) => sum + palletEquivalent(type, 1, boxSettings.smallToBig), 0);
    }
    const q=Math.min(invoicePhysicalQuantity(inv), Math.max(1, Number(quantity || invoicePhysicalQuantity(inv))));
    const types: Array<"big" | "small"> = Array.isArray(inv?.pallet_types) && inv.pallet_types.length
      ? (inv.pallet_types as Array<"big" | "small">)
      : mixedPalletTypes(invoiceBigCount(inv), invoiceSmallCount(inv));
    let total = 0;
    for (const type of types.slice(0, q)) total += palletEquivalent(type, 1);
    return total;
  };
  const invoiceEquivalentTotal = (inv: any) => invoiceEquivalentCapacity(inv, invoicePhysicalQuantity(inv));
  const alertGroups = useMemo(() => {
    const groups: { id:string; title:string; items:{id:string; title:string; text:string; tone:"blue"|"amber"|"green"}[] }[] = [];
    const byBuilding = (buildingId: string | null | undefined) => (plan.buildings || []).find(b => b.id === buildingId);
    const buildingIds = Array.from(new Set([...invoices.map(i=>i.building_id).filter(Boolean), ...waiting.map(i=>i.building_id).filter(Boolean)]));
    for (const bid of buildingIds) {
      const b = byBuilding(bid as string); if (!b) continue;
      const today = invoices.filter(i=>i.building_id===b.id);
      const wait = waiting.filter(i=>i.building_id===b.id);
      const items = [
        ...(today.length ? [{ id:`today-${b.id}`, title:"Schedule for today", text:`${today.length} invoice${today.length===1?"":"s"} · ${today.reduce((n,i)=>n+Number(i.pallets||0),0)} physical pallets · ${formatEquivalent(today.reduce((n,i)=>n+invoiceEquivalentTotal(i),0))} big-equiv`, tone:"green" as const }] : []),
        ...(wait.length ? [{ id:`waiting-${b.id}`, title:"Waiting for schedule", text:`${wait.length} invoice${wait.length===1?"":"s"} waiting`, tone:"amber" as const }] : []),
      ];
      if (items.length) groups.push({ id:b.id, title:b.name, items });
    }
    const timed = invoices.filter(i => String(i.timing || "").trim()).sort((a,b) => String(a.timing).localeCompare(String(b.timing)));
    if (timed.length) groups.push({ id:"timing", title:"Timing / notifications", items: timed.map(i => ({ id:`timing-${i.id}`, title:`${i.timing} · ${i.customer_name}`, text:`Invoice ${i.invoice_no}${i.remarks ? ` · ${i.remarks}` : ""}`, tone:"blue" as const })) });
    if (pendingPallets) groups.push({ id:"allocation", title:"Allocation", items:[{id:"pending",title:"Pallets waiting",text:`${pendingPallets} pallet${pendingPallets===1?"":"s"} still need a vehicle`,tone:"amber"}] });
    return groups;
  }, [plan.buildings, invoices, waiting, pendingPallets, date]);

  const vehicleAreaStatus = (invoice: InvoicePlan, vehicle: any) => {
    const access = vehicleAreaAccess[String(vehicle?.id)] || { areas: [], groups: [] };
    const restricted = access.areas.length > 0 || access.groups.length > 0;
    if (!restricted || !String(invoice?.area || "").trim()) return { permitted: true, restricted, label: "Area unrestricted" };
    const wanted = norm(invoice.area);
    const direct = access.areas.some(a => norm(a?.name) === wanted || norm(a?.code) === wanted);
    const grouped = access.groups.some(g => (g.areas || []).some((a: any) => norm(a?.name) === wanted || norm(a?.code) === wanted));
    return { permitted: direct || grouped, restricted, label: direct ? "Permitted area" : grouped ? "Permitted via area group" : "Outside permitted areas" };
  };
  const vehiclePermittedLabel = (vehicleId: string) => {
    const access = vehicleAreaAccess[String(vehicleId)] || { areas: [], groups: [] };
    const direct = access.areas.map(a => a?.code || a?.name).filter(Boolean);
    const groups = access.groups.map(g => `Group: ${g?.name || "Area group"}`).filter(Boolean);
    if (!direct.length && !groups.length) return "All areas";
    return [...direct, ...groups].join(" · ");
  };

  // Loading is restricted only by the store receiving-day rule, the optional
  // no-sharing rule, and the vehicle's real capacity. Area permission is a
  // warning only: dispatch can still load a non-permitted vehicle deliberately.
  function vehiclePermission(invoice: InvoicePlan, vehicle: any) {
    const store = (plan.buildings || []).find(b => b.id === invoice.building_id);
    const canShare = invoice.can_share_vehicle ?? store?.can_share_vehicle ?? true;
    if (!canShare) {
      const others = invoicesInVehicle(vehicle.id).filter(i => norm(i.customer_name) !== norm(invoice.customer_name));
      if (others.length) return { ok: false, text: `${invoice.customer_name} must use a vehicle without another customer.` };
    }
    const existingExclusive = invoicesInVehicle(vehicle.id).find(i => i.can_share_vehicle === false || ((plan.buildings || []).find(b => b.id === i.building_id)?.can_share_vehicle === false));
    if (existingExclusive && norm(existingExclusive.customer_name) !== norm(invoice.customer_name)) {
      return { ok: false, text: `${vehicle.number} is reserved for ${existingExclusive.customer_name} because sharing is disabled.` };
    }
    return { ok: true, text: "Permitted" };
  }

  const persistPlanNow = (next: PlanV3) => {
    void saveBulkOrganizerPlan({ ...next, pallets: next.invoices || [] }).catch((e: any) => setError(e?.message || "Automatic save failed"));
  };

  const assignedCountOnVehicle = (inv: InvoicePlan, vehicleId: string) =>
    Array.from({ length: safePalletCount(inv.pallets) }).filter((_, k) => assignments[`${inv.id}::${k}`] === vehicleId).length;

  const invoiceEquivalentForNextUnassigned = (inv: any, quantity: number, assignmentMap: Record<string,string|null> = assignments) => {
    const types: Array<"big"|"small"> = Array.isArray(inv?.pallet_types) && inv.pallet_types.length ? inv.pallet_types : mixedPalletTypes(invoiceBigCount(inv), invoiceSmallCount(inv));
    let remaining = Math.max(0, Number(quantity || 0));
    let total = 0;
    for (let k = 0; k < safePalletCount(inv?.pallets || types.length || 1) && remaining > 0; k++) {
      if (assignmentMap[`${inv.id}::${k}`]) continue;
      total += invoicePalletEquivalentAt(inv, k);
      remaining--;
    }
    return total;
  };

  function removeInvoicePallets(inv: InvoicePlan, vehicleId: string, qty: number) {
    const nextAssignments = { ...(planRef.current.pallet_assignments || {}) };
    let left = Math.max(0, Math.min(qty, assignedCountOnVehicle(inv, vehicleId)));
    for (let k = safePalletCount(inv.pallets) - 1; k >= 0 && left > 0; k--) {
      const key = `${inv.id}::${k}`;
      if (nextAssignments[key] === vehicleId) { delete nextAssignments[key]; left--; }
    }
    const remainingLoaded = Array.from({ length: safePalletCount(inv.pallets) }, (_, k) => nextAssignments[`${inv.id}::${k}`]).filter(Boolean);
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
    const permission = vehiclePermission(inv, vehicle);
    if (!permission.ok) { setError(`${vehicle.number}: ${permission.text}`); return; }
    const free = Math.max(0, capacityFor(cfg, vehicle) - loadedByVehicle(toVehicleId));
    const requestedEquivalent = invoiceEquivalentForNextUnassigned(inv, amount);
    if (requestedEquivalent > free) { setError(`${vehicle.number}: only ${formatEquivalent(free)} big-pallet space left.`); return; }
    if (!canFitInvoice(inv, cfg, vehicle, amount)) { setError(`${vehicle.number}: the big/small pallet capacity would be exceeded.`); return; }
    const nextAssignments = { ...(planRef.current.pallet_assignments || {}) };
    const sourceKeys: string[] = [];
    for (let k = safePalletCount(inv.pallets) - 1; k >= 0 && sourceKeys.length < amount; k--) {
      if (nextAssignments[`${inv.id}::${k}`] === fromVehicleId) sourceKeys.push(`${inv.id}::${k}`);
    }
    sourceKeys.forEach(k => { nextAssignments[k] = toVehicleId; });
    const loadedNow = Array.from({ length: safePalletCount(inv.pallets) }, (_, k) => nextAssignments[`${inv.id}::${k}`]).filter(Boolean);
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
      const allLoaded = inv ? Array.from({ length: safePalletCount(inv.pallets) }).every((_, k) => !!assignments[`${invoiceId}::${k}`]) : false;
      const next = { ...x, pallet_assignments: assignments, invoices: (x.invoices || []).map(i => i.id === invoiceId ? { ...i, vehicle_id: allLoaded ? vehicleId : null } : i) };
      persistPlanNow(next);
      return next;
    });
  }

  function assignInvoice(id: string, vehicleId: string | null) {
    setPlan(x => {
      const assignments = { ...(x.pallet_assignments || {}) };
      const inv = (x.invoices || []).find(i => i.id === id);
      if (inv) for (let k = 0; k < safePalletCount(inv.pallets); k++) assignments[`${id}::${k}`] = vehicleId;
      const next = { ...x, pallet_assignments: assignments, invoices: (x.invoices || []).map(i => i.id === id ? { ...i, vehicle_id: vehicleId } : i) };
      persistPlanNow(next);
      return next;
    });
  }

  function openBatchLoadModal(buildingId?: string) {
    const scheduled = allPlanInvoices.filter(i =>
      canonicalInvoiceDate(i.scheduled_date) === canonicalInvoiceDate(date) &&
      invoiceLoaded(i) < Number(i.pallets || 0) &&
      (!buildingId || i.building_id === buildingId)
    );
    setBatchBuildingId(buildingId || null);
    setBatchIncludeWaiting(false);
    setBatchSelectedIds([]);
    setBatchVehicleIds([]);
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
      ...allPlanInvoices.filter(i => canonicalInvoiceDate(i.scheduled_date) === canonicalInvoiceDate(date) && (!batchBuildingId || i.building_id === batchBuildingId)),
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
        const store = (plan.buildings || []).find(b => b.id === inv.building_id);
        const canShare = inv.can_share_vehicle ?? store?.can_share_vehicle ?? true;
        if (!canShare) {
          const existingCustomers = new Set<string>();
          Object.entries(nextAssignments).forEach(([key, assignedVehicle]) => {
            if (assignedVehicle !== vehicle.id) return;
            const [invoiceId] = key.split("::");
            const existing = allPlanInvoices.find(x => x.id === invoiceId);
            if (existing) existingCustomers.add(norm(existing.customer_name));
          });
          if (Array.from(existingCustomers).some(name => name && name !== norm(inv.customer_name))) continue;
        }
        const cap = capacityFor(cfg, vehicle);
        const used = usedByVehicle.get(vehicle.id) || 0;
        const room = Math.max(0, cap - used);
        const perPallet = invoiceEquivalentForNextUnassigned(inv, 1, nextAssignments);
        let qty = Math.min(remaining, Math.floor((room + 1e-9) / Math.max(perPallet, 1e-9)));
        while (qty > 0 && !canFitInvoice(inv, cfg, vehicle, qty)) qty--;
        if (qty <= 0) continue;
        const beforeVehicle = placed;
        for (let k = 0; k < safePalletCount(inv.pallets) && placed < requested; k++) {
          const key = `${inv.id}::${k}`;
          if (!nextAssignments[key] && placed - beforeVehicle < qty) { nextAssignments[key] = vehicle.id; placed++; }
        }
        const placedOnVehicle = placed - beforeVehicle;
        usedByVehicle.set(vehicle.id, used + invoiceEquivalentForNextUnassigned(inv, placedOnVehicle, nextAssignments));
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
          const total = safePalletCount(i.pallets);
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

  async function confirmInvoiceLoad() {
    const inv = loadInvoiceTarget;
    if (!inv) return;
    // A waiting invoice is not owned by a particular day yet. Loading it means
    // it is now physically allocated for the current planning day, so promote
    // it to today's schedule before writing the vehicle assignment. This also
    // prevents a waiting-only object from receiving assignments that are lost
    // because it is not present in plan.invoices.
    const planInvoice = (planRef.current.invoices || []).find(i => i.id === inv.id || i.invoice_no === inv.invoice_no);
    const workingInv = !inv.scheduled_date
      ? { ...inv, scheduled_date: date, vehicle_id: null }
      : inv;
    const vehicle = vehicleMap.get(loadVehicleId);
    const cfg = selectedVehicles.find(x => x.vehicle_id === loadVehicleId);
    if (!vehicle || !cfg) { setError("Select a vehicle first."); return; }
    const permission = vehiclePermission(workingInv, vehicle);
    if (!permission.ok) { setError(`${vehicle.number}: ${permission.text}`); return; }
    const remaining = Math.max(0, Number(inv.pallets || 0) - invoiceLoaded(workingInv));
    const qty = Math.max(1, Math.min(remaining, Number(loadQuantity || 0)));
    const used = loadedByVehicle(loadVehicleId);
    const capacity = capacityFor(cfg, vehicle);
    const requestedEquivalent = invoiceEquivalentForNextUnassigned(workingInv, qty);
    if (used + requestedEquivalent > capacity) {
      setError(`${vehicle.number}: only ${formatEquivalent(Math.max(0, capacity - used))} big-pallet space left.`);
      return;
    }
    if (!canFitInvoice(workingInv, cfg, vehicle, qty)) {
      setError(`${vehicle.number}: the big/small pallet capacity would be exceeded.`);
      return;
    }
    const nextAssignments = { ...(planRef.current.pallet_assignments || {}) };
    let left = qty;
    for (let k = 0; k < safePalletCount(workingInv.pallets) && left > 0; k++) {
      const key = `${inv.id}::${k}`;
      if (!nextAssignments[key]) { nextAssignments[key] = loadVehicleId; left--; }
    }
    const loadedNow = Array.from({ length: safePalletCount(workingInv.pallets) }, (_, k) => nextAssignments[`${inv.id}::${k}`]).filter(Boolean);
    const uniqueVehicles = Array.from(new Set(loadedNow));
    const sourceInvoices = planInvoice
      ? (planRef.current.invoices || []).map(i => i.id === inv.id || i.invoice_no === inv.invoice_no
        ? { ...i, scheduled_date: i.scheduled_date || date, vehicle_id: uniqueVehicles.length === 1 && loadedNow.length >= Number(i.pallets || 0) ? String(uniqueVehicles[0]) : null }
        : i)
      : [...(planRef.current.invoices || []), { ...workingInv, vehicle_id: uniqueVehicles.length === 1 && loadedNow.length >= Number(workingInv.pallets || 0) ? String(uniqueVehicles[0]) : null }];
    const next = {
      ...planRef.current,
      plan_date: date,
      pallet_assignments: nextAssignments,
      invoices: sourceInvoices,
      pallets: sourceInvoices as any,
    };
    // Remove every persisted unscheduled copy before saving the newly loaded
    // scheduled copy. This is what makes Waiting survive month changes, but stop
    // being Waiting immediately after a real load.
    try {
      const allRowsResult = await departmentDb.from("bulk_organizer_plans").select("*").order("plan_date");
      if (allRowsResult.error) throw allRowsResult.error;
      const oldId = String(inv.id || "");
      const oldNo = norm(inv.invoice_no);
      for (const row of (((allRowsResult as any).data || []) as any[])) {
        const oldInvoices = Array.isArray(row?.invoices) ? row.invoices : [];
        const hasWaitingCopy = oldInvoices.some((x: any) => !x?.scheduled_date && (String(x?.id || "") === oldId || norm(x?.invoice_no) === oldNo));
        if (!hasWaitingCopy) continue;
        const kept = oldInvoices.filter((x: any) => !(String(x?.id || "") === oldId || norm(x?.invoice_no) === oldNo));
        const nextAssignmentsForRow = { ...(row.pallet_assignments || {}) };
        Object.keys(nextAssignmentsForRow).filter(k => k.startsWith(`${oldId}::`)).forEach(k => delete nextAssignmentsForRow[k]);
        await saveBulkOrganizerPlan({ ...row, invoices: kept, pallets: kept, pallet_assignments: nextAssignmentsForRow, __preserveExistingWhenEmpty: false } as any);
      }
      setPlan(next);
      setWaitingInvoices(current => current.filter(i => i.id !== workingInv.id && i.invoice_no !== workingInv.invoice_no));
      await saveBulkOrganizerPlan({ ...next, pallets: next.invoices || [] });
      closeInvoiceLoadModal();
      setError("");
    } catch (e: any) {
      setError(e?.message || "Could not load the waiting invoice.");
    }
  }

  const isOthersStore = (store: Building) => norm(store.name) === "others";

  function startInvoiceBatchFromCurrent() {
    const seed = { ...invoiceForm };
    setInvoiceBatchRows(prev => prev.length ? prev : [seed]);
    setBatchScheduleOpen({});
    setInvoiceBatchMode(true);
  }

  function openInvoiceForStore(store: Building) {
    const others = isOthersStore(store);
    const linked = store.linked_customers || [];
    const matched = customers.find(c => norm(c.name) === norm(store.name));
    const receivesToday = buildingAllowsDate(store.id, date);
    setInvoiceBatchMode(false);
    setInvoiceBatchRows([]);
    setEditingInvoice(null);
    setInvoiceBuildingLocked(true);
    setInvoiceCustomerLocked(!others && linked.length === 0);
    setShowInvoiceManager(true);
    setScheduleMode(receivesToday ? "today" : "waiting");
    setInvoiceForm(x => ({ ...x, invoice_no: "", customer_id: matched?.id || `manual:${store.id}`, customer_name: others ? "" : store.name, area: store.area || "", division: store.division || divisionView, pallets: 1, pallet_size: "big" as "big" | "small", pallet_quantity: 1, big_pallet_quantity: 1, small_pallet_quantity: 0, box_small: 0, box_medium: 0, box_big: 0, timing: store.timing || "", remarks: "", can_share_vehicle: "store", invoice_date: date, schedule_date: receivesToday ? date : "", building_id: store.id }));
  }

  function openInvoiceForCustomer(customer: any, store: Building) {
    const receivesToday = buildingAllowsDate(store.id, date);
    setInvoiceBatchMode(false);
    setInvoiceBatchRows([]);
    const matched = customers.find(c => c.id === customer.id) || customers.find(c => norm(c.name) === norm(customer.name));
    const others = isOthersStore(store);
    setEditingInvoice(null); setInvoiceBuildingLocked(true); setInvoiceCustomerLocked(!others);
    setShowInvoiceManager(true); setScheduleMode(receivesToday ? "today" : "waiting");
    setInvoiceForm(x => ({ ...x, invoice_no: "", customer_id: matched?.id || customer.id || "", customer_name: others ? "" : customer.name, area: customer.area || store.area || matched?.area || "", division: customer.division || store.division || divisionView, pallets: 1, pallet_size: "big" as "big" | "small", pallet_quantity: 1, big_pallet_quantity: 1, small_pallet_quantity: 0, box_small: 0, box_medium: 0, box_big: 0, timing: store.timing || "", remarks: "", can_share_vehicle: "store", invoice_date: date, schedule_date: receivesToday ? date : "", building_id: store.id }));
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
      const requestedEquivalent = invoiceEquivalentForNextUnassigned(inv, remaining);
      if (used + requestedEquivalent > cap) { setError(`${v.number}: only ${formatEquivalent(Math.max(0, cap - used))} big-pallet space left.`); return; }
      if (!canFitInvoice(inv, cfg || {vehicle_id:v.id,capacity:cap}, v, remaining)) { setError(`${v.number}: the big/small pallet capacity would be exceeded.`); return; }
      assignInvoice(inv.id, v.id);
      used += requestedEquivalent;
    }
    setError("");
  }

  function dropOnVehicle(v: any, activeDrag: { type: string; id: string }) {
    const cfg = selectedVehicles.find(x => x.vehicle_id === v.id);
    if (!cfg) return;
    const used = loadedByVehicle(v.id);
    const inv = invoices.find(i => activeDrag.type === "invoice" ? i.id === activeDrag.id : activeDrag.id.startsWith(`${i.id}::`));
    if (!inv) return;
    const check = vehiclePermission(inv, v);
    const adding = activeDrag.type === "pallet" ? 1 : safePalletCount(inv.pallets);
    const addingEquivalent = invoiceEquivalentForNextUnassigned(inv, adding);
    if (!check.ok) { setError(`${v.number}: ${check.text}`); return; }
    if (!canFitInvoice(inv, cfg, v, adding)) { setError(`${v.number}: vehicle capacity would be exceeded.`); return; }
    if (used + addingEquivalent > capacityFor(cfg, v)) { setError(`${v.number}: only ${formatEquivalent(Math.max(0, capacityFor(cfg, v) - used))} big-pallet space left.`); return; }
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
    setPlan(x => {
      const nextVehicles = x.vehicles.some(z => z.vehicle_id === v.id)
        ? x.vehicles.filter(z => z.vehicle_id !== v.id)
        : [...x.vehicles, { vehicle_id: v.id, capacity: defaultCapacity(v) }];
      const nextMeta = { ...(x.vehicle_meta || {}), __selection_mode: "daily" } as any;
      const nextAssignments = Object.fromEntries(Object.entries(x.pallet_assignments || {}).map(([k, val]) => [k, val === v.id ? null : val]));
      return { ...x, vehicles: nextVehicles, vehicle_meta: nextMeta, pallet_assignments: nextAssignments };
    });
    void listKey;
  }

  async function clearPreviousBulkOrganizerMonths() {
    if (getRole() !== "admin") return;
    const currentMonthStart = monthKey(dateKey(new Date()));
    const currentDate = dateKey(new Date());
    const ok = window.confirm(
      `Delete all Bulk Organizer plan data from months before ${currentMonthStart.slice(0, 7)}?\n\n` +
      `Scheduled invoices from previous months will be deleted.\n` +
      `Waiting and Any Day invoices from previous months will be cleared too.\n\n` +
      `This cannot be undone. Continue?`
    );
    if (!ok) return;

    setCleaningPreviousMonths(true);
    setError("");
    try {
      const { data: oldRows, error: readError } = await departmentDb
        .from("bulk_organizer_plans")
        .select("*")
        .lt("plan_date", currentMonthStart)
        .order("plan_date");
      if (readError) throw readError;

      // Clear means clear previous Bulk Organizer history. Do not carry old
      // waiting/any-day copies forward; otherwise the next date hydration can
      // reconstruct the exact data the admin just cleared.
      // Delete only previous-month daily plans. Current month is untouched.
      if ((oldRows || []).length) {
        const { error: deleteError } = await departmentDb
          .from("bulk_organizer_plans")
          .delete()
          .lt("plan_date", currentMonthStart);
        if (deleteError) throw deleteError;
      }

      // The cleanup is defined against the real current month, so return the
      // planner to today after a successful admin cleanup.
      try { localStorage.setItem(BULK_CLEARED_BEFORE_KEY, currentMonthStart); } catch {}
      if (date !== currentDate) setDate(currentDate);
      await loadSourceData(currentDate);
      setError("");
    } catch (e: any) {
      setError(e?.message || "Could not clear previous Bulk Organizer months.");
    } finally {
      setCleaningPreviousMonths(false);
    }
  }

  async function save() {
    setSaving(true); setError("");
    try { await saveBulkOrganizerPlan({ ...plan, pallets: invoices as any }); }
    catch (e: any) { setError(e?.message || "Save failed"); } finally { setSaving(false); }
  }
  function persistBoxSettings(next: BoxPalletSettings) {
    const safe: BoxPalletSettings = {
      big: { small: Math.max(1, Math.floor(next.big.small)), medium: Math.max(1, Math.floor(next.big.medium)), big: Math.max(1, Math.floor(next.big.big)) },
      small: { small: Math.max(1, Math.floor(next.small.small)), medium: Math.max(1, Math.floor(next.small.medium)), big: Math.max(1, Math.floor(next.small.big)) },
      smallToBig: Math.max(0.01, Number(next.smallToBig) || SMALL_TO_BIG),
    };
    localStorage.setItem(BULK_BOX_SETTINGS_KEY, JSON.stringify(safe));
    setBoxSettings(safe);
    setShowBulkSettings(false);
    setError("");
  }

  function updateStoreLinkedCustomers(storeId: string, linked: Array<{ id: string; name: string; area?: string; division?: string; manual?: boolean }>) {
    const nextBuildings = (planRef.current.buildings || []).map(b => b.id === storeId ? { ...b, linked_customers: linked } : b);
    const nextPlan: PlanV3 = { ...planRef.current, buildings: nextBuildings };
    const nextDefaults: DefaultsV2 = { ...defaultsRef.current, month_key: monthKey(date), buildings: nextBuildings };
    setPlan(nextPlan); setDefaults(nextDefaults);
    void saveBulkOrganizerPlan({ ...nextPlan, pallets: nextPlan.invoices || [] }).catch((e:any)=>setError(e?.message || "Could not save linked customers."));
    void saveBulkOrganizerDefaults(nextDefaults).then(x=>setDefaults(x as DefaultsV2)).catch(()=>{});
  }

  function addLinkedCustomer(storeId: string, rawName: string) {
    const name = String(rawName || "").trim(); if (!name) return;
    const store = (planRef.current.buildings || []).find(b => b.id === storeId); if (!store) return;
    const existing = (store.linked_customers || []);
    if (existing.some((x: LinkedCustomer) => norm(x.name) === norm(name))) { setLinkedCustomerInputs(x=>({...x,[storeId]:""})); return; }
    const customer = customers.find(c => norm(c.name) === norm(name));
    const linked = [...existing, { id: customer?.id || `linked:${crypto.randomUUID()}`, name: customer?.name || name, area: customer?.area || store.area || "", division: customer?.division || store.division || divisionView, manual: !customer }];
    updateStoreLinkedCustomers(storeId, linked);
    setLinkedCustomerInputs(x=>({...x,[storeId]:""}));
  }

  function removeLinkedCustomer(storeId: string, customerId: string) {
    const store = (planRef.current.buildings || []).find(b => b.id === storeId); if (!store) return;
    updateStoreLinkedCustomers(storeId, (store.linked_customers || []).filter((x: LinkedCustomer) => x.id !== customerId));
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
  const scheduleDayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const receivingDaysForStore = (b: Building) => {
    const days = b.schedule_days || [];
    if (days.length) return days;
    if ((b.schedule_dates || []).length) return Array.from(new Set((b.schedule_dates || []).map(d => new Date(`${d}T12:00:00`).getDay())));
    return [0,1,2,3,4,5,6];
  };
  const storeReceivesToday = (b: Building) => buildingAllowsDate(b.id, date);

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
      const updated: Building = { ...existing, linked_customers: existing.linked_customers || [], name, division: storeForm.division || divisionView, type: storeForm.type, custom_type: storeForm.type === "custom" ? storeForm.custom_type.trim() : undefined, area: storeForm.area.trim(), note: storeForm.note.trim() || undefined, timing: storeForm.timing || undefined, schedule_days: effectiveDays, schedule_dates: scheduleDates, can_share_vehicle: storeForm.can_share_vehicle };
      const oldSchedule = nextSchedules.find(x => x.building_id === editingStoreId);
      const updatedSchedule: CustomerSchedule = { id: oldSchedule?.id || `schedule:${crypto.randomUUID()}`, customer_name: name, days: effectiveDays, area: updated.area, division: updated.division || divisionView, building_id: editingStoreId, enabled: true };
      nextBuildings = nextBuildings.map(b => b.id === editingStoreId ? updated : b);
      nextSchedules = nextSchedules.some(cs => cs.building_id === editingStoreId)
        ? nextSchedules.map(cs => cs.building_id === editingStoreId ? updatedSchedule : cs)
        : [...nextSchedules.filter(cs => norm(cs.customer_name) !== norm(name)), updatedSchedule];
      nextCustomers = nextCustomers.map(c => norm(c.name) === norm(existing.name) ? { ...c, name, area: updated.area, division: updated.division || c.division } : c);
      setEditingStoreId(null);
    } else {
      const b: Building = { id: `store:${crypto.randomUUID()}`, name, linked_customers: [], division: storeForm.division || divisionView, type: storeForm.type, custom_type: storeForm.type === "custom" ? storeForm.custom_type.trim() : undefined, area: storeForm.area.trim(), sort_order: nextBuildings.length, enabled: true, note: storeForm.note.trim() || undefined, timing: storeForm.timing || undefined, schedule_days: effectiveDays, schedule_dates: scheduleDates, can_share_vehicle: storeForm.can_share_vehicle };
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
    setStoreForm({ name: "", type: "store", custom_type: "", area: "", note: "", timing: "", schedule_days: [], schedule_dates: "", division: divisionView, can_share_vehicle: true });
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
    setStoreForm({ name: b.name, type: b.type, custom_type: b.custom_type || "", area: b.area || "", note: b.note || "", timing: b.timing || "", schedule_days: b.schedule_days || [], schedule_dates: (b.schedule_dates || []).join(", "), division: b.division || divisionView, can_share_vehicle: b.can_share_vehicle !== false });
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
    return { invoice_no: "", customer_id: "", customer_name: others ? "" : store.name, area: store.area || "", division: store.division || divisionView, pallets: 1, pallet_size: "big" as "big" | "small", pallet_quantity: 1, big_pallet_quantity: 1, small_pallet_quantity: 0, box_small: 0, box_medium: 0, box_big: 0, timing: "", remarks: "", can_share_vehicle: "store", invoice_date: date, schedule_date: date, building_id: store.id };
  }

  function buildInvoiceLoadData(form: any, buildingId: string | null, fallbackPallets = 1) {
    const boxCounts = normalizeBoxCounts({ small: form.box_small, medium: form.box_medium, big: form.box_big });
    const hasBoxes = boxCounts.small + boxCounts.medium + boxCounts.big > 0;
    const boxCalc = hasBoxes ? calculateBoxLoad(boxCounts, boxSettings) : null;
    const bigPallets = boxCalc ? boxCalc.bigFull : Math.max(0, Number(form.big_pallet_quantity || 0));
    const smallPallets = boxCalc ? boxCalc.physicalSmall : Math.max(0, Number(form.small_pallet_quantity || 0));
    const physicalPallets = boxCalc ? Math.max(1, boxCalc.physicalPallets) : Math.max(1, bigPallets + smallPallets || Number(fallbackPallets || 1));
    const palletTypes = boxCalc ? boxCalc.palletTypes : mixedPalletTypes(bigPallets, smallPallets);
    const store = (planRef.current.buildings || []).find(b => b.id === buildingId);
    const canShare = form.can_share_vehicle === "yes" ? true : form.can_share_vehicle === "no" ? false : store?.can_share_vehicle !== false;
    return {
      pallets: physicalPallets,
      pallet_size: (smallPallets > 0 && bigPallets === 0 ? "small" : "big") as "big" | "small",
      pallet_quantity: physicalPallets,
      big_pallets: bigPallets,
      small_pallets: smallPallets,
      pallet_types: palletTypes,
      pallet_equivalents: boxCalc ? boxCalc.palletEquivalents : undefined,
      box_counts: hasBoxes ? boxCounts : undefined,
      box_pallet_calc: boxCalc || undefined,
      timing: String(form.timing || "").trim() || undefined,
      remarks: String(form.remarks || "").trim() || undefined,
      can_share_vehicle: canShare,
    };
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
      if (r.schedule_date && !buildingAllowsDate(buildingId, r.schedule_date) && canonicalInvoiceDate(r.schedule_date) !== canonicalInvoiceDate(date)) { setError(`The selected schedule date is not allowed for ${r.customer_name}.`); return; }
      const loadData = buildInvoiceLoadData(r, buildingId, Number(r.pallet_quantity || r.pallets || 1));
      newInvoices.push({ id:`manual-invoice:${crypto.randomUUID()}`, invoice_no:r.invoice_no, customer_id:customerId, customer_name:customer?.name || r.customer_name, area:r.area || customer?.area || "", division:r.division || customer?.division || "Unknown", ...loadData, invoice_date:r.invoice_date || null, scheduled_date:r.schedule_date || null, vehicle_id:null, building_id:buildingId });
    }
    const sameDay = newInvoices.filter(i => !i.scheduled_date || canonicalInvoiceDate(i.scheduled_date) === canonicalInvoiceDate(date));
    const future = newInvoices.filter(i => i.scheduled_date && canonicalInvoiceDate(i.scheduled_date) !== canonicalInvoiceDate(date));
    try {
      if (sameDay.length) {
        const nextCurrent = { ...planRef.current, plan_date: date, invoices:[...(planRef.current.invoices||[]),...sameDay] };
        nextCurrent.pallets = nextCurrent.invoices as any;
        setPlan(nextCurrent);
        await saveBulkOrganizerPlan(nextCurrent);
      }
      for (const inv of future) {
        const target = await loadBulkOrganizerPlan(inv.scheduled_date!);
        const next = target || emptyPlan(inv.scheduled_date!);
        next.invoices = [...(next.invoices||[]), inv];
        next.pallets = next.invoices as any;
        await saveBulkOrganizerPlan(next);
      }
      setInvoiceBatchMode(false); setInvoiceBatchRows([]); setBatchScheduleOpen({}); setShowInvoiceManager(false); setError("");
      setInvoiceForm({ invoice_no:"",customer_id:"",customer_name:"",area:"",division:"",pallets:1,pallet_size:"big",pallet_quantity:1,big_pallet_quantity:1,small_pallet_quantity:0,box_small:0,box_medium:0,box_big:0,timing:"",remarks:"",can_share_vehicle:"store",invoice_date:"",schedule_date:"",building_id:"" });
    } catch (e:any) { setError(e?.message || "Could not place the invoices on their scheduled dates."); }
  }

  async function addInvoice() {
    const name = invoiceForm.customer_name.trim(); if (!invoiceForm.invoice_no.trim() || !name) return;
    const customer = customers.find(c => c.id === invoiceForm.customer_id) || customers.find(c => norm(c.name) === norm(name));
    const customerId = customer?.id || `manual:${crypto.randomUUID()}`;
    const inv: InvoicePlan = {
      id: `manual-invoice:${crypto.randomUUID()}`, invoice_no: invoiceForm.invoice_no.trim(), customer_id: customerId,
      customer_name: customer?.name || name, area: invoiceForm.area || customer?.area || "", division: invoiceForm.division || customer?.division || "Unknown",
      ...buildInvoiceLoadData(invoiceForm, invoiceForm.building_id || plan.customer_schedules?.find(s => norm(s.customer_name) === norm(name))?.building_id || buildingForCustomer(name)?.id || null, Number(invoiceForm.pallet_quantity || 1)),
      invoice_date: invoiceForm.invoice_date || null,
      scheduled_date: invoiceForm.schedule_date || null, schedule_mode: scheduleMode, vehicle_id: null, building_id: invoiceForm.building_id || plan.customer_schedules?.find(s => norm(s.customer_name) === norm(name))?.building_id || buildingForCustomer(name)?.id || null
    };
    if (!inv.building_id) { setError("Select a customer that is already linked to a Store / Hospital / Warehouse / Other before adding the invoice."); return; }
    if (inv.scheduled_date && !buildingAllowsDate(inv.building_id, inv.scheduled_date) && canonicalInvoiceDate(inv.scheduled_date) !== canonicalInvoiceDate(date)) {
      setError("The selected schedule date is not allowed for this store. Choose one of its configured days or dates.");
      return;
    }
    if (!inv.scheduled_date || canonicalInvoiceDate(inv.scheduled_date) === canonicalInvoiceDate(date)) {
      const next = {
        ...planRef.current,
        plan_date: date,
        invoices: [...(planRef.current.invoices || []), inv],
        pallets: [...(planRef.current.invoices || []), inv],
        customers: customer ? (planRef.current.customers || []) : [...(planRef.current.customers || []), { id: customerId, name, area: inv.area, division: inv.division, enabled: true }],
      };
      setPlan(next);
      try { await saveBulkOrganizerPlan(next); }
      catch (e: any) { setError(e?.message || "Could not save the invoice."); return; }
    } else {
      try {
        const target = await loadBulkOrganizerPlan(inv.scheduled_date!);
        const next = target || emptyPlan(inv.scheduled_date!);
        next.invoices = [...(next.invoices || []), inv];
        next.pallets = next.invoices as any;
        next.customers = [...(next.customers || []), ...(customer ? [] : [{ id: customerId, name, area: inv.area, division: inv.division, enabled: true }])];
        await saveBulkOrganizerPlan(next);
      } catch (e: any) { setError(e?.message || "Could not place the invoice on its scheduled date."); return; }
    }
    setScheduleMode("today");
    setInvoiceForm({ invoice_no: "", customer_id: "", customer_name: "", area: "", division: "", pallets: 1, pallet_size: "big" as "big" | "small", pallet_quantity: 1, big_pallet_quantity: 1, small_pallet_quantity: 0, box_small: 0, box_medium: 0, box_big: 0, timing: "", remarks: "", can_share_vehicle: "store", invoice_date: "", schedule_date: "", building_id: "" });
    setShowInvoiceManager(false);
  }

  async function updateInvoice() {
    if (!editingInvoice) return;
    const buildingId = invoiceForm.building_id || plan.customer_schedules?.find(s => norm(s.customer_name) === norm(invoiceForm.customer_name))?.building_id || buildingForCustomer(invoiceForm.customer_name)?.id || editingInvoice.building_id || null;
    const next = { ...editingInvoice, invoice_no: invoiceForm.invoice_no, customer_name: invoiceForm.customer_name, area: invoiceForm.area, division: invoiceForm.division, ...buildInvoiceLoadData(invoiceForm, buildingId, Number(invoiceForm.pallet_quantity || 1)), invoice_date: invoiceForm.invoice_date || null, scheduled_date: invoiceForm.schedule_date || null, schedule_mode: scheduleMode, building_id: buildingId };
    if (!next.building_id) { setError("This invoice must stay linked to an existing customer/store before it can be saved."); return; }
    if (next.scheduled_date && !buildingAllowsDate(next.building_id, next.scheduled_date) && canonicalInvoiceDate(next.scheduled_date) !== canonicalInvoiceDate(date)) {
      setError("The selected schedule date is not allowed for this store. Choose one of its configured days or dates.");
      return;
    }
    try {
      const targetDate = canonicalInvoiceDate(next.scheduled_date);
      const currentDate = canonicalInvoiceDate(date) || date;
      const targetPlanDate = targetDate;
      const targetPlan = next.schedule_mode === "any_day"
        ? (await loadBulkOrganizerPlan(currentDate) || emptyPlan(currentDate))
        : (targetPlanDate
          ? (await loadBulkOrganizerPlan(targetPlanDate) || emptyPlan(targetPlanDate))
          : null);

      // Waiting invoices are not in plan.invoices on the currently selected day;
      // they live in the month-wide waiting collection. Always remove the old
      // copy from every Tertiary daily row before writing the new scheduled copy.
      const monthStart = monthKey(date);
      const monthEnd = nextMonthKey(date);
      const { data: monthRows, error: monthError } = await departmentDb
        .from("bulk_organizer_plans").select("*")
        .gte("plan_date", monthStart).lt("plan_date", monthEnd);
      if (monthError) throw monthError;

      const oldId = String(editingInvoice.id || "");
      const oldNo = norm(editingInvoice.invoice_no);
      for (const row of ((monthRows || []) as any[])) {
        const oldInvoices = Array.isArray(row.invoices) ? row.invoices : [];
        const kept = oldInvoices.filter((i:any) => String(i?.id || "") !== oldId && norm(i?.invoice_no) !== oldNo);
        const oldAssignments = { ...(row.pallet_assignments || {}) };
        Object.keys(oldAssignments).filter(k => k.startsWith(`${oldId}::`)).forEach(k => delete oldAssignments[k]);
        const changed = kept.length !== oldInvoices.length || Object.keys(oldAssignments).length !== Object.keys(row.pallet_assignments || {}).length;
        if (changed) {
          await saveBulkOrganizerPlan({ ...row, invoices: kept, pallets: kept, pallet_assignments: oldAssignments, __preserveExistingWhenEmpty: false } as any);
        }
      }

      if (targetPlan) {
        const cleanTarget = (targetPlan.invoices || []).filter(i => String(i?.id || "") !== oldId && norm(i?.invoice_no) !== oldNo);
        const savedNext = { ...targetPlan, plan_date: next.schedule_mode === "any_day" ? currentDate : targetDate!, invoices: [...cleanTarget, { ...next, scheduled_date: next.schedule_mode === "any_day" ? null : targetDate }], pallets: [...cleanTarget, { ...next, scheduled_date: next.schedule_mode === "any_day" ? null : targetDate }] };
        await saveBulkOrganizerPlan(savedNext as any);
      } else if (!targetDate) {
        // Keep Waiting as an explicit persisted invoice on today's Tertiary row.
        const base = await loadBulkOrganizerPlan(currentDate!) || emptyPlan(currentDate!);
        const savedNext = { ...base, invoices: [...(base.invoices || []), { ...next, scheduled_date: null }], pallets: [...(base.invoices || []), { ...next, scheduled_date: null }] };
        await saveBulkOrganizerPlan(savedNext as any);
      }

      // Reload from the single source of truth so the UI cannot retain a stale
      // Waiting object after a successful reschedule.
      await loadSourceData(date);
      setEditingInvoice(null);
      setError("");
    } catch (e:any) { setError(e?.message || "Could not reschedule the invoice."); }
  }

  function editInvoice(i: InvoicePlan) {
    const boxes = normalizeBoxCounts(i.box_counts);
    setInvoiceBuildingLocked(false); setInvoiceCustomerLocked(false); setEditingInvoice(i);
    setScheduleMode(i.schedule_mode === "any_day" ? "any_day" : !i.scheduled_date ? "waiting" : canonicalInvoiceDate(i.scheduled_date) === canonicalInvoiceDate(date) ? "today" : "specific");
    setInvoiceForm({ invoice_no: i.invoice_no, customer_id: i.customer_id, customer_name: i.customer_name, area: i.area, division: i.division, pallets: invoiceStoredPhysicalQuantity(i), pallet_size: invoicePalletSize(i), pallet_quantity: invoiceStoredPhysicalQuantity(i), big_pallet_quantity: Number(i.big_pallets ?? (invoicePalletSize(i)==="big" ? invoicePhysicalQuantity(i) : 0)), small_pallet_quantity: Number(i.small_pallets ?? (invoicePalletSize(i)==="small" ? invoicePhysicalQuantity(i) : 0)), box_small: boxes.small, box_medium: boxes.medium, box_big: boxes.big, timing: i.timing || "", remarks: i.remarks || "", can_share_vehicle: i.can_share_vehicle == null ? "store" : i.can_share_vehicle ? "yes" : "no", invoice_date: i.invoice_date || "", schedule_date: i.scheduled_date || "", building_id: i.building_id || buildingForCustomer(i.customer_name)?.id || "" });
  }
  async function confirmDeleteInvoice() {
    const target = deleteInvoiceTarget;
    if (!target) return;
    setError("");
    try {
      rememberBulkInvoiceDeleted(target);
      const oldId = String(target.id || "");
      const oldNo = norm(target.invoice_no);
      const { data: rows, error: readError } = await departmentDb.from("bulk_organizer_plans").select("*").order("plan_date");
      if (readError) throw readError;
      for (const row of ((rows || []) as any[])) {
        const oldInvoices = Array.isArray(row?.invoices) ? row.invoices : [];
        const kept = oldInvoices.filter((i:any) => String(i?.id || "") !== oldId && norm(i?.invoice_no) !== oldNo);
        const nextAssignments = { ...(row.pallet_assignments || {}) };
        Object.keys(nextAssignments).filter(k => k.startsWith(`${oldId}::`)).forEach(k => delete nextAssignments[k]);
        if (kept.length !== oldInvoices.length || Object.keys(nextAssignments).length !== Object.keys(row.pallet_assignments || {}).length) {
          await saveBulkOrganizerPlan({ ...row, invoices: kept, pallets: kept, pallet_assignments: nextAssignments, __preserveExistingWhenEmpty: false } as any);
        }
      }
      setWaitingInvoices(current => current.filter(i => i.id !== target.id && norm(i.invoice_no) !== oldNo));
      setPlan(current => {
        const nextAssignments = { ...(current.pallet_assignments || {}) };
        Object.keys(nextAssignments).filter(k => k.startsWith(`${oldId}::`)).forEach(k => delete nextAssignments[k]);
        return { ...current, invoices: (current.invoices || []).filter(i => i.id !== target.id && norm(i.invoice_no) !== oldNo), pallets: (current.invoices || []).filter(i => i.id !== target.id && norm(i.invoice_no) !== oldNo), pallet_assignments: nextAssignments, __preserveExistingWhenEmpty: false } as PlanV3;
      });
      setDeleteInvoiceTarget(null);
      setEditingInvoice(null);
      setShowInvoiceManager(false);
      setError("");
    } catch (e:any) { setError(e?.message || "Could not delete the invoice."); }
  }

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
  const loadedByVehicle = (vehicleId: string) => assignedCapacityOnVehicle(vehicleId);
  const loadedByVehicleByDivision = (vehicleId: string, div: string) => { let used = 0; Object.entries(assignments).forEach(([key,value]) => { if (value !== vehicleId) return; const [invoiceId] = key.split("::"); const inv = allPlanInvoices.find(i => i.id === invoiceId && canonicalInvoiceDate(i.scheduled_date) === canonicalInvoiceDate(date) && norm(i.division) === norm(div)); if (inv) { const idx=Number(key.split("::")[1]||0);
      used += invoicePalletEquivalentAt(inv, idx); } }); return used; };
  const invoicesInVehicle = (vehicleId: string) => invoices.filter(i => Object.values(assignments).some(v => v === vehicleId && Object.keys(assignments).some(k => k.startsWith(`${i.id}::`) && assignments[k] === vehicleId)));
  const invoiceLoaded = (i: InvoicePlan) => Array.from({ length: safePalletCount(i.pallets) }).filter((_, k) => !!assignments[`${i.id}::${k}`]).length;
  const vehicleImage = (v: any) => {
    const t = norm(v.type);
    if (isVan(t)) return "/vehicle-images/VAN 1.PNG";
    const ton = Number(v.capacity_tons ?? v.tonnage ?? v.tons ?? 0);
    if (ton >= 12 || t.includes("12")) return "/vehicle-images/12 TON PICK-UP 1.PNG";
    if (ton >= 10 || t.includes("10")) return "/vehicle-images/10 TON PICK-UP 1.PNG";
    return "/vehicle-images/5 TON PICK-UP 1.PNG";
  };
  const invoiceEquivalentLoaded = (inv: any) => {
    let total = 0;
    for (let idx=0; idx<invoicePhysicalQuantity(inv); idx++) {
      if (assignments[`${inv.id}::${idx}`]) total += invoicePalletEquivalentAt(inv, idx);
    }
    return total;
  };
  const invoiceEquivalentLoadedOnVehicle = (inv: any, vehicleId: string) => {
    let total = 0;
    for (let idx=0; idx<invoicePhysicalQuantity(inv); idx++) {
      if (assignments[`${inv.id}::${idx}`] === vehicleId) total += invoicePalletEquivalentAt(inv, idx);
    }
    return total;
  };
  const assignedCapacityOnVehicle = (vehicleId: string) => {
    let used = 0;
    Object.entries(assignments).forEach(([key, value]) => {
      if (value !== vehicleId) return;
      const [invoiceId] = key.split("::");
      const inv = allPlanInvoices.find(i => i.id === invoiceId);
      if (inv) { const idx=Number(key.split("::")[1]||0);
      used += invoicePalletEquivalentAt(inv, idx); }
    });
    return used;
  };
  const canFitInvoice = (inv: any, cfg: VehicleConfig, v: any, quantity?: number) => {
    const capacity = capacityFor(cfg, v);
    const used = assignedCapacityOnVehicle(v.id);
    return used + invoiceEquivalentCapacity(inv, quantity) <= capacity + 1e-9;
  };
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
      const requestedEquivalent = invoiceEquivalentForNextUnassigned(inv, unassigned);
      if (!check.ok) { setError(`${v.number}: ${check.text}`); return; }
      if (!cfg || used + requestedEquivalent > capacityFor(cfg, v)) { setError(`${v.number}: only ${formatEquivalent(Math.max(0, capacityFor(cfg || {vehicle_id:v.id,capacity:0}, v) - used))} big-pallet space left.`); return; }
      if (!canFitInvoice(inv, cfg, v, unassigned)) { setError(`${v.number}: the big/small pallet capacity would be exceeded.`); return; }
      assignInvoice(inv.id, v.id);
    }
    setError("");
  };

  function downloadDailyPlanExcel() {
    const rows: any[] = [];
    selectedVehicles.forEach(cfg => {
      const v = vehicleMap.get(cfg.vehicle_id);
      if (!v) return;
      const meta = plan.vehicle_meta?.[v.id] || {};
      const vehicleInvoices = invoicesInVehicle(v.id);
      if (!vehicleInvoices.length) {
        rows.push({ Date: date, Vehicle: v.number, Driver: meta.driver || cfg.driver || "", Helper: meta.helper || cfg.helper || "", Customer: "", "Invoice No": "", "Big-equiv": 0, "Physical pallets": 0, Timing: "", Remarks: "" });
      } else {
        vehicleInvoices.forEach(inv => rows.push({ Date: date, Vehicle: v.number, Driver: meta.driver || cfg.driver || "", Helper: meta.helper || cfg.helper || "", Customer: inv.customer_name, "Invoice No": inv.invoice_no, "Big-equiv": formatInvoiceEquivalent(inv, invoiceEquivalentTotal(inv)), "Physical pallets": invoicePhysicalQuantity(inv), Timing: inv.timing || "", Remarks: inv.remarks || "" }));
      }
    });
    invoices.filter(inv => invoiceLoaded(inv) < invoicePhysicalQuantity(inv)).forEach(inv => {
      const remainingPhysical = Math.max(0, invoicePhysicalQuantity(inv) - invoiceLoaded(inv));
      const remainingEq = Math.max(0, invoiceEquivalentTotal(inv) - invoiceEquivalentLoaded(inv));
      rows.push({ Date: date, Vehicle: "Unassigned / Remaining", Driver: "", Helper: "", Customer: inv.customer_name, "Invoice No": inv.invoice_no, "Big-equiv": formatInvoiceEquivalent(inv, remainingEq), "Physical pallets": remainingPhysical, Timing: inv.timing || "", Remarks: inv.remarks || "" });
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Plan of the Day");
    const vehicleRows = selectedVehicles.map(cfg => { const v=vehicleMap.get(cfg.vehicle_id); const meta=plan.vehicle_meta?.[cfg.vehicle_id]||{}; const used=loadedByVehicle(cfg.vehicle_id); return { Vehicle:v?.number||cfg.vehicle_id, Driver:meta.driver||cfg.driver||"", Helper:meta.helper||cfg.helper||"", Capacity_Big:formatEquivalent(capacityFor(cfg,v)), Used_Big:formatEquivalent(used), Free_Big:formatEquivalent(Math.max(0,capacityFor(cfg,v)-used)), Customers:invoicesInVehicle(cfg.vehicle_id).map(i=>i.customer_name).filter((x,i,a)=>a.indexOf(x)===i).join(" · ") }; });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vehicleRows), "Vehicles");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invoices.map(inv => ({ Invoice:inv.invoice_no, Customer:inv.customer_name, Store:(plan.buildings||[]).find(b=>b.id===inv.building_id)?.name||"", Schedule:inv.scheduled_date||"Waiting", "Big-equiv":formatInvoiceEquivalent(inv, invoiceEquivalentTotal(inv)), "Physical pallets":invoicePhysicalQuantity(inv), Small_boxes:inv.box_counts?.small||0, Medium_boxes:inv.box_counts?.medium||0, Big_boxes:inv.box_counts?.big||0, Timing:inv.timing||"", Remarks:inv.remarks||"", "Can share vehicle":inv.can_share_vehicle === false ? "No" : "Yes" }))), "Invoices");
    XLSX.writeFile(wb, `Bulk-Organizer-Plan-${date}.xlsx`);
  }

  return <div className={`page bulk-planner-page bulk-theme-${bulkTheme} ${loading ? "is-hydrating" : ""}`}>
    <style>{`
 .bulk-store-compact-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:10px;margin-top:10px}
.bulk-store-compact-card{min-width:0;border:1px solid var(--border,rgba(148,163,184,.22));border-radius:14px;padding:10px 11px;background:var(--surface,rgba(255,255,255,.55));transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease;overflow:hidden}
.bulk-store-compact-card:hover{transform:translateY(-1px);box-shadow:0 5px 16px rgba(15,23,42,.07)}
.bulk-store-compact-card.is-not-today{opacity:.78}
.bulk-store-compact-card.is-expanded{border-color:rgba(59,130,246,.4);box-shadow:0 6px 20px rgba(59,130,246,.08)}
.bulk-store-compact-top{display:flex;align-items:center;gap:9px;min-width:0}
.bulk-store-compact-icon{width:34px;height:34px;display:grid;place-items:center;flex:0 0 34px;border-radius:10px;background:rgba(59,130,246,.09);border:1px solid rgba(59,130,246,.16)}
.bulk-store-compact-main{min-width:0;flex:1 1 auto}
.bulk-store-compact-main b{display:block;overflow-wrap:anywhere;word-break:break-word;font-size:12px;line-height:1.25}.bulk-store-compact-main>span{display:block;color:var(--muted);font-size:10px;margin-top:2px;overflow-wrap:anywhere}
.bulk-store-compact-actions{display:flex;align-items:center;gap:5px;flex:0 0 auto}.bulk-store-compact-actions .btn{width:28px;height:28px;padding:0}.bulk-store-compact-count{font-size:9px;font-weight:800;white-space:normal;text-align:right;color:var(--muted);line-height:1.25;max-width:92px}
.bulk-store-compact-status{display:inline-flex;align-items:center;gap:4px;margin-top:8px;padding:4px 7px;border-radius:8px;font-size:9px;font-weight:900;letter-spacing:.02em}.bulk-store-compact-status.green{background:rgba(34,197,94,.11);color:#16a34a;border:1px solid rgba(34,197,94,.24)}.bulk-store-compact-status.amber{background:rgba(245,158,11,.12);color:#d97706;border:1px solid rgba(245,158,11,.25)}.bulk-store-compact-status.muted{background:rgba(148,163,184,.10);color:var(--muted);border:1px solid rgba(148,163,184,.2)}
.bulk-store-compact-meta{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;min-width:0}.bulk-store-compact-meta span{display:inline-flex;align-items:center;gap:4px;min-width:0;max-width:100%;padding:4px 6px;border-radius:7px;background:rgba(148,163,184,.08);font-size:9px;font-weight:800;color:var(--muted);overflow-wrap:anywhere}.bulk-store-compact-days{display:flex;flex-wrap:wrap;gap:3px;margin-top:8px}.bulk-store-compact-days span{font-size:8px;font-weight:900;padding:3px 5px;border-radius:6px;border:1px solid rgba(148,163,184,.28);background:rgba(148,163,184,.06);color:#ef4444}.bulk-store-compact-days span.on{background:rgba(34,197,94,.11);border-color:rgba(34,197,94,.25);color:#16a34a}.bulk-store-compact-buttons{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}.bulk-store-compact-buttons .btn{font-size:10px;min-height:28px}.bulk-store-compact-expanded-hint{margin-top:7px;font-size:9px;color:var(--muted);font-weight:700}
.bulk-vehicle-compact-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:10px;margin-top:10px}.bulk-vehicle-compact-card{min-width:0;border:1px solid var(--border,rgba(148,163,184,.22));border-radius:14px;padding:10px;background:var(--surface,rgba(255,255,255,.55));overflow:hidden}.bulk-vehicle-compact-card.green{border-color:rgba(34,197,94,.28)}.bulk-vehicle-compact-card.amber{border-color:rgba(245,158,11,.32)}.bulk-vehicle-compact-top{display:flex;align-items:center;gap:9px;min-width:0}.bulk-vehicle-compact-top img{width:48px;height:34px;object-fit:contain;flex:0 0 48px}.bulk-vehicle-compact-main{min-width:0;flex:1}.bulk-vehicle-compact-main b{display:block;font-size:12px;overflow-wrap:anywhere}.bulk-vehicle-compact-main span,.bulk-vehicle-compact-main small{display:block;color:var(--muted);font-size:9px;margin-top:2px;overflow-wrap:anywhere}.bulk-vehicle-compact-actions{display:flex;gap:5px;align-items:center;flex:0 0 auto}.bulk-vehicle-compact-actions .btn{width:28px;height:28px;padding:0}.bulk-vehicle-compact-status{font-size:9px;font-weight:900;padding:4px 7px;border-radius:8px;display:inline-flex;margin-top:7px}.bulk-vehicle-compact-status.green{background:rgba(34,197,94,.11);color:#16a34a}.bulk-vehicle-compact-status.amber{background:rgba(245,158,11,.12);color:#d97706}.bulk-vehicle-compact-cap{display:flex;justify-content:space-between;gap:8px;font-size:9px;font-weight:800;color:var(--muted);margin-top:7px}.bulk-vehicle-compact-card .bulk-capacity-bar{margin-top:6px}.bulk-vehicle-compact-meta{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}.bulk-vehicle-compact-meta span{font-size:9px;font-weight:800;padding:4px 6px;border-radius:7px;background:rgba(148,163,184,.08);color:var(--muted);overflow-wrap:anywhere}.bulk-vehicle-expanded-list{margin-top:10px;display:grid;gap:10px}
@media(max-width:620px){.bulk-store-compact-grid,.bulk-vehicle-compact-grid{grid-template-columns:1fr}.bulk-store-compact-count{max-width:82px}}
`}</style><style>{`
      .bulk-planner-page .bulk-vehicle-card,
      .bulk-planner-page .bulk-store-customer-box,
      .bulk-planner-page .bulk-loaded-invoice,
      .bulk-planner-page .bulk-fleet-choice-v2 { min-width: 0; }
      .bulk-planner-page .bulk-vehicle-main,
      .bulk-planner-page .bulk-store-heading,
      .bulk-planner-page .bulk-loaded-invoice-info { min-width: 0; }
      .bulk-planner-page .bulk-vehicle-top b,
      .bulk-planner-page .bulk-store-heading h3,
      .bulk-planner-page .bulk-loaded-invoice-info b,
      .bulk-planner-page .bulk-loaded-invoice-info span { overflow-wrap: anywhere; word-break: break-word; }
      .bulk-planner-page .bulk-store-heading select,
      .bulk-planner-page .bulk-store-heading input { max-width: 100%; box-sizing: border-box; }
      .bulk-planner-page .bulk-store-summary { flex: 0 1 auto; min-width: 110px; }
      .bulk-planner-page .bulk-store-hero-actions { flex: 0 0 auto; display: flex; flex-wrap: wrap; gap: 7px; }
      .bulk-planner-page .bulk-vehicle-meta { min-width: 0; }
      .bulk-planner-page .bulk-vehicle-meta label { min-width: 0; }
      .bulk-planner-page .bulk-vehicle-meta input { width: 100%; min-width: 0; box-sizing: border-box; }
      .bulk-planner-page .bulk-loaded-invoice-actions { flex: 0 0 auto; }
      @media (max-width: 900px) {
        .bulk-planner-page .bulk-store-hero { grid-template-columns: auto minmax(0,1fr); }
        .bulk-planner-page .bulk-store-summary,
        .bulk-planner-page .bulk-store-hero-actions { grid-column: 2; }
      }
      @media (max-width: 620px) {
        .bulk-planner-page .bulk-store-hero { grid-template-columns: 1fr; }
        .bulk-planner-page .bulk-store-summary,
        .bulk-planner-page .bulk-store-hero-actions { grid-column: 1; }
        .bulk-planner-page .bulk-store-heading h3 { font-size: 15px; }
      }
    `}</style>
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
      <div className="bulk-planner-actions">{getRole() === "admin" && <GlassButton variant="secondary" size="sm" onClick={()=>setShowBulkSettings(true)}><Gauge size={14}/> Settings</GlassButton>}<GlassButton variant="secondary" size="sm" onClick={downloadDailyPlanExcel}><Database size={14}/> Download Plan Excel</GlassButton><GlassButton variant="secondary" size="sm" onClick={() => void loadSourceData(date)}><RefreshCw size={14}/> Refresh</GlassButton>{getRole() === "admin" && <GlassButton variant="secondary" size="sm" onClick={() => void clearPreviousBulkOrganizerMonths()} disabled={cleaningPreviousMonths}><Trash2 size={14}/> {cleaningPreviousMonths ? "Clearing…" : "Clear Previous Months"}</GlassButton>}<GlassButton size="sm" onClick={() => void save()} disabled={saving}><Save size={14}/> {saving ? "Saving…" : "Save only today"}</GlassButton></div>
    </div>
    {error && <div className="bulk-planner-error"><CircleAlert size={15}/><span>{error}</span><button onClick={()=>setError("")}><X size={14}/></button></div>}
    <div className="bulk-allocation-layout">
      <aside className="bulk-allocation-left">
        <div className="bulk-schedule-panel bulk-glass-surface"><div className="bulk-planner-section-head compact"><div><span>02 · ALERTS</span><h2>Today&apos;s schedule</h2></div><Bell size={17}/></div><div className="bulk-alert-list">{alertGroups.length?alertGroups.map(g=><div key={g.id} className="bulk-alert-group"><h4>{g.title}</h4>{g.items.map(n=><div key={n.id} className={`bulk-alert ${n.tone}`}><div className="bulk-alert-icon">{n.tone==="green"?<Check size={13}/>:n.tone==="amber"?<CircleAlert size={13}/>:<Bell size={13}/>}</div><div><b>{n.title}</b><span>{n.text}</span></div></div>)}</div>):<div className="bulk-empty-state">No scheduled alerts for this date.</div>}</div><div className="bulk-kpis"><div><span>Invoices</span><b>{invoices.length}</b></div><div><span>Physical pallets</span><b>{totalPallets}</b></div><div><span>Big-equiv</span><b>{formatEquivalent(invoices.reduce((n,i)=>n+invoiceEquivalentTotal(i),0))}</b></div><div><span>Allocated</span><b>{loadedPallets}</b></div><div><span>Waiting</span><b>{pendingPallets}</b></div></div><div className="bulk-side-tools"><GlassButton variant="secondary" size="sm" onClick={()=>setShowScheduleManager(x=>!x)}><CalendarDays size={13}/> Schedules</GlassButton><GlassButton variant="secondary" size="sm" onClick={()=>setShowBuildingEditor(x=>!x)}><Store size={13}/> Stores</GlassButton><GlassButton size="sm" onClick={()=>{setEditingInvoice(null);setInvoiceBuildingLocked(false);setInvoiceCustomerLocked(false);setShowInvoiceManager(true);setScheduleMode("waiting");setInvoiceForm(x=>({...x,schedule_date:"",invoice_no:"",building_id:""}))}}><Plus size={13}/> Invoice</GlassButton></div></div>
      </aside>
      <div className="bulk-allocation-right">

        <section className="bulk-vehicles-section glass-card bulk-glass-surface">
          <div className="bulk-planner-section-head"><div><span>01 · FLEET</span><h2>Default & daily vehicles</h2><p>Vehicles, drivers and helpers selected here can be saved as the default for future planning days. The current day stays unchanged.</p></div><div className="bulk-section-head-actions"><GlassButton variant="secondary" size="sm" onClick={()=>{setVehiclesExpanded(x=>!x);if(vehiclesExpanded)setExpandedVehicleIds(new Set())}}><ChevronDown size={14} className={vehiclesExpanded?"bulk-chevron-open":""}/>{vehiclesExpanded?"Minimize":"Expand"}</GlassButton><GlassButton variant="secondary" size="sm" onClick={()=>void saveDefaults()} disabled={savingDefaults}><Save size={13}/>{savingDefaults?"Saving…":defaultsSaved?"Saved ✓":"Save as Default"}</GlassButton><GlassButton size="sm" onClick={()=>setShowFleet(x=>!x)}><Truck size={14}/>{showFleet?"Close Fleet":"Choose Fleet"}</GlassButton></div></div>
          {!vehiclesExpanded&&<div className="bulk-vehicle-compact-grid">{selectedVehicles.map(cfg=>{const v=vehicleMap.get(cfg.vehicle_id);if(!v)return null;const cap=capacityFor(cfg,v),used=loadedByVehicle(v.id),pct=Math.min(100,Math.round(used/Math.max(1,cap)*100)),meta=plan.vehicle_meta?.[v.id]||{},vehicleInvoices=invoicesInVehicle(v.id),pending=vehicleInvoices.some(i=>invoiceLoaded(i)<Number(i.pallets||0)),status=vehicleInvoices.length&&pct>=100&&!pending?"green":vehicleInvoices.length?"amber":"muted";const expanded=expandedVehicleIds.has(v.id);return <div key={v.id} className={`bulk-vehicle-compact-card ${status}`}>
              <div className="bulk-vehicle-compact-top"><img src={vehicleImage(v)} alt={v.type||"Vehicle"}/><div className="bulk-vehicle-compact-main"><b>{v.number}{Number(v.capacity_tons ?? v.tonnage ?? v.tons ?? 0)>0?` · ${Number(v.capacity_tons ?? v.tonnage ?? v.tons)} tons`:""}</b><span>{v.type||"Vehicle"}</span><small>{meta.driver||cfg.driver||"No driver"} · {meta.helper||cfg.helper||"No helper"}</small></div><div className="bulk-vehicle-compact-actions"><button className="btn icon-btn" title={expanded?"Collapse vehicle":"Expand vehicle details"} onClick={()=>setExpandedVehicleIds(prev=>{const n=new Set(prev);n.has(v.id)?n.delete(v.id):n.add(v.id);return n;})}><ChevronDown size={13} className={expanded?"bulk-chevron-open":""}/></button><button className="btn icon-btn" title="Remove from day" onClick={()=>toggleVehicle(v)}><X size={12}/></button></div></div>
              <span className={`bulk-vehicle-compact-status ${status}`} >{status==="green"?<><Check size={10}/> Fully loaded</>:status==="amber"?<><CircleAlert size={10}/> Loading pending</>:<>No loads yet</>}</span>
              <div className="bulk-vehicle-compact-cap"><span>{formatOperationalEquivalent(used)} / {formatOperationalEquivalent(cap)} big-equiv</span><span>{formatOperationalEquivalent(Math.max(0,cap-used))} free</span></div><div className="bulk-capacity-bar"><i style={{width:`${pct}%`}}/></div>
              <div className="bulk-vehicle-compact-meta"><span><MapPin size={9}/> {vehiclePermittedLabel(v.id)}</span><span>{vehicleInvoices.length} invoices</span><span>{vehicleInvoices.reduce((n,i)=>n+Number(i.pallets||0),0)} pallets</span></div>
              <div className="bulk-store-compact-buttons"><button type="button" className="btn" onClick={()=>setExpandedVehicleIds(prev=>new Set(prev).add(v.id))}><ChevronDown size={11}/> {expanded?"Details open":"Open details"}</button></div>
            </div>})}</div>}
          {(vehiclesExpanded||expandedVehicleIds.size>0)&&<div className={`bulk-vehicle-strip expanded`}>
            {selectedVehicles.filter(cfg=>vehiclesExpanded||expandedVehicleIds.has(cfg.vehicle_id)).map(cfg=>{const v=vehicleMap.get(cfg.vehicle_id);if(!v)return null;const cap=capacityFor(cfg,v),used=loadedByVehicle(v.id),pct=Math.min(100,Math.round(used/Math.max(1,cap)*100)),meta=plan.vehicle_meta?.[v.id]||{};return <div key={v.id} className={`bulk-vehicle-card ${pct>=100?"is-full":pct>=80?"is-near-full":""}`} onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add("drop-ready")}} onDragLeave={e=>e.currentTarget.classList.remove("drop-ready")} onDrop={e=>{e.preventDefault();e.currentTarget.classList.remove("drop-ready");const raw=e.dataTransfer.getData("text/plain");const d=dragged||(raw?{type:"customer" as const,id:raw}:null);if(d?.type==="customer")dropCustomerOnVehicle(v,d.id);else if(d?.type==="invoice")dropOnVehicle(v,d);else if(d?.type==="store")dropStoreOnVehicle(v,d.id);setDragged(null)}}>
              <div className="bulk-vehicle-image-wrap"><img src={vehicleImage(v)} alt={v.type||"Vehicle"}/><span className="bulk-vehicle-ton">{String(v.type||"").toUpperCase()}</span></div>
              <div className="bulk-vehicle-main"><div className="bulk-vehicle-top"><div style={{minWidth:0,display:"flex",flexDirection:"column",gap:3}}><b>{v.number}</b><small style={{fontSize:10,color:"var(--muted)",whiteSpace:"normal",overflowWrap:"anywhere"}}>{Number(v.capacity_tons ?? v.tonnage ?? v.tons ?? 0) > 0 ? ` · ${Number(v.capacity_tons ?? v.tonnage ?? v.tons).toString()} tons` : ""}</small><small style={{fontSize:10,color:"var(--muted)",whiteSpace:"normal",overflowWrap:"anywhere"}}><MapPin size={10} style={{verticalAlign:"-1px",marginRight:4}}/>Permitted: {vehiclePermittedLabel(v.id)}</small></div><button className="btn icon-btn" title="Remove from day" onClick={(e)=>{e.stopPropagation();toggleVehicle(v)}}><X size={12}/></button></div><div className="bulk-capacity-row"><span>{formatOperationalEquivalent(used)} / {formatOperationalEquivalent(cap)} big-pallet space</span><strong>{formatOperationalEquivalent(Math.max(0,cap-used))} free</strong></div><div className="bulk-vehicle-type-capacity"><span>Capacity {formatOperationalEquivalent(cap)} big</span><span>Small equivalent: {formatOperationalEquivalent(cap / Math.max(0.01, boxSettings.smallToBig))} small</span></div>{(() => { const other = divisionView === "Pharma" ? "Consumer" : "Pharma"; const otherUsed = loadedByVehicleByDivision(v.id, other); return otherUsed ? <div className="bulk-cross-division-load"><span>{other} already loaded</span><b>{formatOperationalEquivalent(otherUsed)} big-equiv</b></div> : null; })()}<div className="bulk-capacity-bar"><i style={{width:`${pct}%`}}/></div><div className="bulk-vehicle-meta"><label>Driver<input list="bulk-driver-library" value={meta.driver||""} placeholder="Driver name or code" onChange={e=>updateVehicleMeta(v.id,"driver",e.target.value)} onBlur={e=>updateVehicleMeta(v.id,"driver",e.target.value)}/></label><label>Helper<input list="bulk-helper-library" value={meta.helper||""} placeholder="Helper name or code" onChange={e=>updateVehicleMeta(v.id,"helper",e.target.value)} onBlur={e=>updateVehicleMeta(v.id,"helper",e.target.value)}/></label></div></div><div className="bulk-vehicle-load-list">{invoicesInVehicle(v.id).map((i, invoiceIndex)=><div key={i.id} className="bulk-loaded-invoice" draggable onDragStart={e=>{e.stopPropagation();e.dataTransfer.setData("text/plain",i.id);setDragged({type:"invoice",id:i.id})}} onDragEnd={()=>setDragged(null)}><div className="bulk-loaded-pallet"><Package size={12}/><b>{formatInvoiceEquivalent(i, invoiceEquivalentLoadedOnVehicle(i,v.id))}</b><span>BIG EQ</span></div><span className="bulk-invoice-sequence" title={`Invoice ${invoiceIndex + 1}`}>{invoiceIndex + 1}</span><div className="bulk-loaded-invoice-info"><b>{i.invoice_no} {invoiceLoaded(i) >= Number(i.pallets || 0) && <span className="bulk-invoice-complete" title="Invoice fully loaded"><Check size={10}/></span>}</b><span style={{display:"flex",alignItems:"center",gap:5,minWidth:0}}>{i.customer_name}{!vehicleAreaStatus(i,v).permitted && <span title="Invoice area is outside this vehicle's permitted areas" style={{width:8,height:8,borderRadius:"50%",background:"#f59e0b",boxShadow:"0 0 0 2px rgba(245,158,11,.16)",flex:"0 0 auto"}}/>}</span><small>{formatInvoiceEquivalent(i, invoiceEquivalentLoadedOnVehicle(i,v.id))} / {formatInvoiceEquivalent(i, invoiceEquivalentTotal(i))} big-equiv · {assignedCountOnVehicle(i,v.id)} / {i.pallets} physical pallets · {i.area||"Area not set"} · {i.division||"Division not set"}</small><small>Scheduled {i.scheduled_date}</small></div><div className="bulk-loaded-invoice-actions"><button className="btn icon-btn" title="Edit invoice" onClick={(e)=>{e.stopPropagation();editInvoice(i)}}><Pencil size={11}/></button><button className="btn icon-btn" title="Remove only this vehicle's loaded pallets" onClick={(e)=>{e.stopPropagation();removeInvoicePallets(i,v.id,assignedCountOnVehicle(i,v.id))}}><X size={12}/></button></div></div>)}{!invoicesInVehicle(v.id).length&&<span className="bulk-vehicle-empty">Drop invoice or customer here</span>}</div>
            </div>})}
            {!selectedVehicles.length&&<div className="bulk-no-vehicles"><Truck size={24}/><b>No vehicles selected</b><span>Choose the Fleet vehicles you want as defaults or for this day.</span><button className="btn" onClick={()=>setShowFleet(true)}><Plus size={13}/> Choose vehicles</button></div>}
          </div>}
          {showFleet&&<div className="bulk-fleet-panel"><div className="bulk-fleet-panel-head"><b>Select Fleet vehicles</b><span>{selectedVehicles.length} selected</span></div><div className="bulk-fleet-choice-grid">{fleet.map(v=>{const on=selectedVehicles.some(x=>x.vehicle_id===v.id),def=defaults.vehicles.some(x=>x.vehicle_id===v.id);return <button key={v.id} className={`bulk-fleet-choice-v2 ${on?"selected":""}`} onClick={()=>toggleVehicle(v)}><img src={vehicleImage(v)} alt=""/><div><b>{v.number}</b><span>{v.type||"Vehicle"} · {v.division||"Division"}</span></div><div className="fleet-choice-state">{on?<Check size={14}/>:<Plus size={14}/>} {def&&<small>DEFAULT</small>}</div></button>})}</div></div>}
        </section>


<main className="bulk-customer-section glass-card bulk-glass-surface">
          <div className="bulk-planner-section-head bulk-section-centered">
            <div><span>03 · CUSTOMER LOAD PLAN</span><h2>Scheduled customers</h2><p>Customers are grouped by their selected store or destination. Drag a customer or invoice onto a permitted vehicle.</p></div>
            <div className="bulk-section-head-actions"><div className="bulk-search"><Search size={14}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customer / invoice…"/></div><GlassButton variant="secondary" size="sm" onClick={()=>{setCustomerSectionExpanded(x=>!x);if(customerSectionExpanded)setExpandedStoreIds(new Set())}}><ChevronDown size={14} className={customerSectionExpanded?"bulk-chevron-open":""}/>{customerSectionExpanded?"Minimize":"Expand"}</GlassButton></div>
          </div>
          {!customerSectionExpanded&&<div className="bulk-store-compact-grid">{[...buildingCards].sort((a,b)=>(a.sort_order ?? 9999)-(b.sort_order ?? 9999)).map(store=>{const ci=invoices.filter(i=>i.building_id===store.id);const wi=waiting.filter(i=>i.building_id===store.id);const loaded=ci.reduce((n,i)=>n+invoiceLoaded(i),0);const pallets=ci.reduce((n,i)=>n+Number(i.pallets||0),0);const scheduledToday=ci.filter(i=>canonicalInvoiceDate(i.scheduled_date)===canonicalInvoiceDate(date));const todayComplete=scheduledToday.length>0&&scheduledToday.every(i=>invoiceLoaded(i)>=Number(i.pallets||0));const todayPending=scheduledToday.some(i=>invoiceLoaded(i)<Number(i.pallets||0));const status=todayComplete?"green":todayPending?"amber":"muted";const expanded=expandedStoreIds.has(store.id);const receiving=storeReceivesToday(store);return <div key={store.id} className={`bulk-store-compact-card ${!receiving?"is-not-today":""} ${expanded?"is-expanded":""}`}>
            <div className="bulk-store-compact-top"><div className="bulk-store-compact-icon">{storeIcon(store.type)}</div><div className="bulk-store-compact-main"><b>{store.name}</b><span>{store.area||"Area not set"}{store.timing?` · Timing ${store.timing}`:""}</span></div><div className="bulk-store-compact-actions"><span className="bulk-store-compact-count">{ci.length} invoices · {pallets} pallets</span><button type="button" className="btn icon-btn" title={expanded?"Collapse store":"Expand store details"} onClick={()=>setExpandedStoreIds(prev=>{const n=new Set(prev);n.has(store.id)?n.delete(store.id):n.add(store.id);return n;})}><ChevronDown size={13} className={expanded?"bulk-chevron-open":""}/></button></div></div>
            <span className={`bulk-store-compact-status ${status}`}>{status==="green"?<><Check size={10}/> Today fully loaded</>:status==="amber"?<><CircleAlert size={10}/> Scheduled today · loading pending</>:<><Clock3 size={10}/> No loading today</>}</span>
            <div className="bulk-store-compact-days">{scheduleDayNames.map((d,idx)=><span key={d} className={receivingDaysForStore(store).includes(idx)?"on":""}>{d}</span>)}</div>
            <div className="bulk-store-compact-meta"><span><CalendarDays size={9}/> {receiving?`Receiving ${dayName}`:`Not receiving ${dayName}`}</span><span><Clock3 size={9}/> {store.timing||"No timing"}</span><span><Package size={9}/> {loaded} loaded · {wi.length} waiting</span>{(store.linked_customers||[]).length>0&&<span><Users size={9}/> {(store.linked_customers||[]).slice(0,2).map((c: LinkedCustomer)=>c.name).join(" · ")}{(store.linked_customers||[]).length>2?` +${(store.linked_customers||[]).length-2}`:""}</span>}</div>
            <div className="bulk-store-compact-buttons"><button type="button" className="btn" onClick={()=>openInvoiceForStore(store)}><Plus size={11}/> Add invoice</button><button type="button" className="btn" onClick={()=>openBatchLoadModal(store.id)}><ListChecks size={11}/> Load multiple</button><button type="button" className="btn" onClick={()=>setExpandedStoreIds(prev=>new Set(prev).add(store.id))}><ChevronDown size={11}/> {expanded?"Details open":"Open details"}</button></div>
            {expanded&&<div className="bulk-store-compact-expanded-hint">Full store details are opened below. The main Expand button still opens all stores together.</div>}
          </div>})}</div>}{(customerSectionExpanded||expandedStoreIds.size>0)&&<div className="bulk-store-customer-grid">
            {[...buildingCards].sort((a,b)=>(a.sort_order ?? 9999)-(b.sort_order ?? 9999)).filter(store=>customerSectionExpanded||expandedStoreIds.has(store.id)).map(store=>{
              const linkedCustomers = (store.linked_customers || []).map((c: LinkedCustomer)=>({ id:c.id, name:c.name, area:c.area || store.area, division:c.division || store.division || divisionView, enabled:true }));
              const storeCustomers=Array.from(new Map([...customersForDay.filter(c=>norm(buildingForCustomer(c.name)?.id||"")===norm(store.id) || invoices.some(i=>norm(i.customer_name)===norm(c.name)&&i.building_id===store.id)), ...linkedCustomers].map(c=>[norm(c.name),c])).values());
              const storeInvoices=invoices.filter(i=>i.building_id===store.id || storeCustomers.some(c=>norm(c.name)===norm(i.customer_name)));
              const vehiclesForInvoice = (inv: InvoicePlan) => Array.from(new Set(Object.entries(assignments).filter(([k,v]) => v && k.startsWith(`${inv.id}::`)).map(([,v]) => v as string))).map(id => vehicleMap.get(id)).filter(Boolean);
              if(search && !store.name.toLowerCase().includes(search.toLowerCase()) && !storeCustomers.some(c=>norm(c.name).includes(norm(search)) || storeInvoices.some(i=>norm(i.invoice_no).includes(norm(search))))) return null;
              const receivingToday = storeReceivesToday(store);
              return <section key={store.id} className={`bulk-store-customer-box ${receivingToday ? "" : "bulk-store-not-receiving"}`} style={{opacity:receivingToday?1:0.52,filter:receivingToday?"none":"grayscale(.75)"}} draggable onDragOver={e=>{if(e.dataTransfer.types.includes("application/x-bulk-location")){e.preventDefault();e.currentTarget.classList.add("bulk-location-drop-target")}}} onDragLeave={e=>e.currentTarget.classList.remove("bulk-location-drop-target")} onDrop={e=>{const source=e.dataTransfer.getData("application/x-bulk-location");if(!source)return;e.preventDefault();e.stopPropagation();e.currentTarget.classList.remove("bulk-location-drop-target");void reorderBuildings(source,store.id);}} onDragStart={e=>{e.dataTransfer.setData("text/plain",store.id);setDragged({type:"store",id:store.id})}} onDragEnd={()=>setDragged(null)} title="Drag this location to a vehicle to load its scheduled invoices">
                <div className="bulk-store-hero">
                  <button type="button" className="bulk-store-reorder-handle" title="Drag to reorder this location" draggable onClick={e=>e.stopPropagation()} onDragStart={e=>{e.stopPropagation();e.dataTransfer.setData("application/x-bulk-location",store.id)}} onDragEnd={()=>{}}><GripVertical size={16}/></button><div className={`bulk-store-picture ${storeInvoices.filter(i=>i.scheduled_date===date).length && storeInvoices.filter(i=>i.scheduled_date===date).every(i => invoiceLoaded(i) >= Number(i.pallets || 0)) ? "store-complete" : ""}`}>{storeIcon(store.type)}{storeInvoices.filter(i=>i.scheduled_date===date).length > 0 && storeInvoices.filter(i=>i.scheduled_date===date).every(i => invoiceLoaded(i) >= Number(i.pallets || 0)) && <span className="bulk-store-complete-check" title="Today's schedule is fully loaded into vehicles"><Check size={10}/></span>}</div>
                  <div className="bulk-store-heading"><span>{buildingTypeLabel(store).toUpperCase()}</span><h3 style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>{store.name}<em style={{fontStyle:"normal",fontSize:10,fontWeight:800,padding:"3px 7px",borderRadius:999,background:"rgba(59,130,246,.10)",color:"var(--accent,#3b82f6)",border:"1px solid rgba(59,130,246,.18)"}}>{store.area||"Area not set"}</em>{store.timing&&<em style={{fontStyle:"normal",fontSize:10,fontWeight:800,padding:"3px 7px",borderRadius:999,background:"rgba(99,102,241,.10)",color:"#6366f1",border:"1px solid rgba(99,102,241,.18)"}}>Timing {store.timing}</em>}</h3><small><MapPin size={12}/> {store.area||"Area not set"}</small><div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:6}}>{scheduleDayNames.map((d,idx)=>{const on=receivingDaysForStore(store).includes(idx);const today=idx===todayDow;return <span key={d} title={on?`${d}: receiving day`:`${d}: not a receiving day`} style={{fontSize:10,fontWeight:800,padding:"2px 5px",borderRadius:6,border:`1px solid ${on?"rgba(52,211,153,.45)":"rgba(148,163,184,.35)"}`,background:on?"rgba(52,211,153,.13)":"rgba(148,163,184,.08)",color:on?"#16a34a":"#ef4444",boxShadow:today?"0 0 0 1px currentColor":"none"}}>{d}</span>})}</div><small style={{fontWeight:800,color:receivingToday?"#16a34a":"#ef4444"}}>{receivingToday?`Receiving today · ${dayName}`:`Not receiving today · ${dayName}`}</small><div style={{display:"flex",flexWrap:"wrap",gap:5,alignItems:"center",marginTop:7}}>{(store.linked_customers||[]).map((c: LinkedCustomer)=><span key={c.id} style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,fontWeight:800,padding:"3px 6px",borderRadius:7,background:"rgba(148,163,184,.10)",border:"1px solid rgba(148,163,184,.22)"}}>{c.name}<button type="button" className="btn icon-btn" title={`Remove ${c.name} from ${store.name}`} style={{width:18,height:18,padding:0}} onClick={e=>{e.stopPropagation();removeLinkedCustomer(store.id,c.id)}}><X size={10}/></button></span>)}<select aria-label={`Add customer to ${store.name}`} value="" style={{minWidth:145,maxWidth:210}} onChange={e=>addLinkedCustomer(store.id,e.target.value)}><option value="">+ Add linked customer</option>{Array.from(new Set(Array.from(new Set([...customerLibrary,...customers.map(c=>c.name).filter(Boolean)])).filter(n=>!((store.linked_customers||[]).some((c: LinkedCustomer)=>norm(c.name)===norm(n)))))).sort().map(n=><option key={n} value={n}>{n}</option>)}</select><input value={linkedCustomerInputs[store.id]||""} placeholder="Manual customer/store" style={{minWidth:145,maxWidth:190,flex:"1 1 145px"}} onChange={e=>setLinkedCustomerInputs(x=>({...x,[store.id]:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addLinkedCustomer(store.id,linkedCustomerInputs[store.id]||"")}}}/><button type="button" className="btn" style={{whiteSpace:"nowrap"}} onClick={e=>{e.stopPropagation();addLinkedCustomer(store.id,linkedCustomerInputs[store.id]||"")}}><Plus size={11}/> Add</button></div></div>
                  <div className="bulk-store-summary"><div><b>{storeInvoices.length}</b><span>Invoices</span></div><div><b>{formatEquivalent(storeInvoices.reduce((n,i)=>n+invoiceEquivalentTotal(i),0))}</b><span>Big-equiv</span></div></div>
                  <div className="bulk-store-hero-actions"><GlassButton size="sm" variant="secondary" onClick={e=>{e.stopPropagation();openBatchLoadModal(store.id)}} title={receivingToday?"Load multiple invoices":"Load multiple anyway — store is not receiving today"}><ListChecks size={12}/> Load multiple</GlassButton><GlassButton size="sm" variant="secondary" onClick={e=>{e.stopPropagation();openInvoiceForStore(store)}}><Plus size={12}/> Add invoice</GlassButton>{!receivingToday&&<span title="Store is not scheduled to receive today; invoices can still be added and manually loaded" style={{width:9,height:9,borderRadius:"50%",background:"#f59e0b",boxShadow:"0 0 0 2px rgba(245,158,11,.16)",flex:"0 0 auto"}}/>}</div>
                </div>
                <div className="bulk-store-schedule-sections"><div className={`bulk-store-schedule-section today ${storeInvoices.filter(i=>i.scheduled_date===date).length > 0 && storeInvoices.filter(i=>i.scheduled_date===date).every(i=>invoiceLoaded(i)>=Number(i.pallets||0)) ? "is-loaded" : ""}`}><div className="bulk-schedule-section-heading"><div><span className="bulk-section-kicker">TODAY</span><h4>Schedule for today</h4></div><b>{storeInvoices.filter(i=>i.scheduled_date===date).length} invoice(s)</b></div><div className="bulk-customer-grid compact-store-grid">
                  {storeCustomers.filter(c=>buildingForCustomer(c.name)?.id===store.id || storeInvoices.some(i=>norm(i.customer_name)===norm(c.name) && i.scheduled_date===date)).map(c=>{const ci=invoices.filter(i=>norm(i.customer_name)===norm(c.name) && (i.building_id===store.id || !i.building_id));const pallets=ci.reduce((n,i)=>n+Number(i.pallets||0),0),equivalent=ci.reduce((n,i)=>n+invoiceEquivalentTotal(i),0),loaded=assignedForCustomer(c.name),loadedEquivalent=ci.reduce((n,i)=>n+invoiceEquivalentLoaded(i),0),scheduled=plan.customer_schedules?.find(s=>norm(s.customer_name)===norm(c.name)&&s.days.includes(todayDow));return <div key={c.id} draggable onDragStart={e=>{e.dataTransfer.setData("text/plain",c.name);setDragged({type:"customer",id:c.name})}} onDragEnd={()=>setDragged(null)} className={`bulk-customer-card ${loaded>=pallets&&pallets?"complete":""}`}>
                    <div className="customer-card-top"><div className="customer-avatar">{storeIcon(store.type)}</div><div><b>{c.name}</b><span>{c.area||store.area||"Area not set"} · {c.division||"Unknown"}</span></div><GripVertical size={16}/></div>
                    <div className="customer-card-details"><span><strong>{ci.length}</strong> invoices</span><span><strong>{formatEquivalent(equivalent)}</strong> big-equiv</span><span><strong>{formatEquivalent(loadedEquivalent)}</strong> linked</span></div>
                    {scheduled&&<div className="customer-schedule-chip"><CalendarDays size={11}/> {scheduled.days.map((d:number)=>["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]).join(" · ")}</div>}
                    <div className="customer-card-invoices">{ci.map((i, invoiceIndex)=>{const l=invoiceLoaded(i);return <div key={i.id} className={`customer-invoice-row ${l>=Number(i.pallets||0) && l>0 ? "invoice-loaded invoice-fully-loaded" : l>0 ? "invoice-partial-loaded" : ""}`} draggable onDragStart={e=>{e.stopPropagation();e.dataTransfer.setData("text/plain",i.id);setDragged({type:"invoice",id:i.id})}} onDragEnd={()=>setDragged(null)}><span className="bulk-invoice-sequence" title={`Invoice ${invoiceIndex + 1}`}>{invoiceIndex + 1}</span><div className="invoice-pallet-icon"><span>{formatInvoiceEquivalent(i, invoiceEquivalentTotal(i))}</span></div><div><b>{i.invoice_no}</b><small>{i.scheduled_date} · {i.area||"No area"} · {i.division||"Division"}</small><small>{invoicePhysicalQuantity(i)} physical pallets · {formatInvoiceEquivalent(i, invoiceEquivalentTotal(i))} big-equiv</small>{l>0&&<span className="bulk-invoice-vehicle-tags"><span className="bulk-invoice-load-status">{l>=Number(i.pallets||0)?"FULLY LOADED":"PARTIAL LOAD"}</span>{vehiclesForInvoice(i).map((v:any)=><button type="button" key={v.id} className="bulk-invoice-vehicle-tag" title={`Manage ${i.invoice_no} on ${v.number}`} onClick={e=>{e.stopPropagation();openInvoiceVehicleManager(i,v.id)}}><Truck size={10}/>{v.number}</button>)}</span>}</div><em className={l>=Number(i.pallets||0)?"invoice-count-full":"invoice-count-partial"}>{formatInvoiceEquivalent(i, invoiceEquivalentLoaded(i))}/{formatInvoiceEquivalent(i, invoiceEquivalentTotal(i))}</em><button className="btn icon-btn invoice-load-btn" title={receivingToday?"Load invoice into a vehicle":"Load anyway — store is not receiving today"} onClick={e=>{e.stopPropagation();openInvoiceLoadModal(i)}} disabled={invoiceLoaded(i)>=Number(i.pallets||0)}><Truck size={11}/></button><button className="btn icon-btn invoice-edit-btn" title="Edit invoice" onClick={e=>{e.stopPropagation();editInvoice(i)}}><Pencil size={11}/></button><button className="btn icon-btn" title="Delete invoice" onClick={e=>{e.stopPropagation();setDeleteInvoiceTarget(i)}}><X size={11}/></button></div>})}</div>
                    <div className="customer-card-footer"><span>{!ci.length ? "No invoices yet" : loaded>=pallets&&pallets?"FULLY LINKED":"Drag to a permitted vehicle"}</span><div className="customer-card-footer-actions"><button type="button" className="btn icon-btn customer-add-invoice-btn" title={`Add invoice for ${c.name}`} onClick={e=>{e.stopPropagation();openInvoiceForCustomer(c,store)}}><Plus size={12}/></button>{loaded>=pallets&&pallets?<span className="bulk-customer-complete-check"><Check size={10}/></span>:<Route size={13}/>}</div></div>
                  </div>})}
                  {!storeCustomers.length&&<div className="bulk-empty-state">No customers linked to this location yet.</div>}
                </div></div><div className="bulk-store-schedule-section waiting"><div className="bulk-schedule-section-heading"><div><span className="bulk-section-kicker">NOT SCHEDULED</span><h4>Waiting for schedule</h4></div><b>{waiting.filter(i=>i.building_id===store.id).length} invoice(s)</b></div><div className="bulk-store-schedule-invoices">{waiting.filter(i=>i.building_id===store.id).map((i, invoiceIndex)=><div className="bulk-schedule-invoice-row" key={`waiting-${i.id}`}><span className="bulk-invoice-sequence" title={`Invoice ${invoiceIndex + 1}`}>{invoiceIndex + 1}</span><div className="invoice-pallet-icon"><span>{formatInvoiceEquivalent(i, invoiceEquivalentTotal(i))}</span></div><div><b>{i.invoice_no}</b><small>{i.customer_name} · {i.area||"No area"} · {i.division||"Division"}</small><small>{invoicePhysicalQuantity(i)} physical pallets · {formatInvoiceEquivalent(i, invoiceEquivalentTotal(i))} big-equiv</small></div><em>Waiting</em>{!receivingToday&&<span title="Store is not scheduled for today — loading is still allowed" style={{width:9,height:9,borderRadius:"50%",background:"#f59e0b",boxShadow:"0 0 0 2px rgba(245,158,11,.16)",flex:"0 0 auto"}}/>}<button className="btn icon-btn invoice-load-btn" title={receivingToday?"Load invoice into a vehicle (schedules it for today)":"Load anyway — this will schedule it for today"} onClick={e=>{e.stopPropagation();openInvoiceLoadModal(i)}} disabled={invoiceLoaded(i)>=Number(i.pallets||0)}><Truck size={11}/></button><button className="btn icon-btn invoice-edit-btn" title="Edit invoice" onClick={e=>{e.stopPropagation();editInvoice(i)}}><Pencil size={11}/></button><button className="btn icon-btn" title="Delete invoice" onClick={e=>{e.stopPropagation();setDeleteInvoiceTarget(i)}}><X size={11}/></button></div>)}{!waiting.some(i=>i.building_id===store.id)&&<div className="bulk-empty-state">Nothing waiting for schedule.</div>}</div></div></div>
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
        <img src={vehicleImage(v)} alt=""/><div><b>{v.number}</b><span>{v.type||"Vehicle"}</span><small>{formatOperationalEquivalent(free)} big-pallet space free · {formatOperationalEquivalent(used)}/{formatOperationalEquivalent(cap)} used</small><small>{(plan.vehicle_meta?.[v.id]?.driver||cfg.driver||"No driver")} · {(plan.vehicle_meta?.[v.id]?.helper||cfg.helper||"No helper")}</small><small style={{whiteSpace:"normal",overflowWrap:"anywhere",color:"var(--muted)"}}>Permitted: {vehiclePermittedLabel(v.id)}</small>{!vehicleAreaStatus(loadInvoiceTarget!,v).permitted&&<span title="Invoice area is outside this vehicle's permitted areas" style={{width:9,height:9,borderRadius:"50%",background:"#f59e0b",boxShadow:"0 0 0 2px rgba(245,158,11,.16)",flex:"0 0 auto"}}/>}</div>{active&&<Check size={15}/>}
      </button>})}</div>
      <div className="bulk-batch-load-toolbar"><button type="button" className="bulk-batch-select-btn" onClick={()=>{const ids=allPlanInvoices.filter(i=>i.scheduled_date===date&&(!batchBuildingId||i.building_id===batchBuildingId)&&invoiceLoaded(i)<Number(i.pallets||0)).map(i=>i.id);setBatchSelectedIds(ids)}}>Select scheduled</button><button type="button" className="bulk-batch-select-btn" onClick={()=>setBatchSelectedIds([])}>Clear</button><label><input type="checkbox" checked={batchIncludeWaiting} onChange={e=>{setBatchIncludeWaiting(e.target.checked);if(e.target.checked){setBatchSelectedIds(ids=>Array.from(new Set([...ids,...waiting.filter(i=>(!batchBuildingId||i.building_id===batchBuildingId)&&invoiceLoaded(i)<Number(i.pallets||0)).map(i=>i.id)])))}}}/> Include waiting</label></div>
      <div className="bulk-load-form bulk-batch-load-form">
        <div className="bulk-load-mode"><span>Load quantity</span><div><button type="button" className={batchLoadMode==="full"?"active":""} onClick={()=>setBatchLoadMode("full")}>Full load</button><button type="button" className={batchLoadMode==="partial"?"active":""} onClick={()=>setBatchLoadMode("partial")}>Partial</button></div></div>
      </div>
      <div className="bulk-batch-invoice-list">{[...allPlanInvoices.filter(i=>i.scheduled_date===date&&(!batchBuildingId||i.building_id===batchBuildingId)),...(batchIncludeWaiting?waiting.filter(i=>!batchBuildingId||i.building_id===batchBuildingId):[])].filter((i,idx,arr)=>arr.findIndex(x=>x.id===i.id)===idx).map(i=>{const remaining=Math.max(0,Number(i.pallets||0)-invoiceLoaded(i));const qty=Math.min(remaining,Math.max(1,Number(batchPartialQuantities[i.id]||1)));return <label key={i.id} className={`bulk-batch-invoice-row ${batchSelectedIds.includes(i.id)?"selected":""}`}><input type="checkbox" checked={batchSelectedIds.includes(i.id)} disabled={!remaining} onChange={()=>{toggleBatchInvoice(i.id);setBatchPartialQuantities(q=>({...q,[i.id]:Math.max(1,remaining)}))}}/><span><b>{i.invoice_no}</b><small>{i.customer_name} · {i.area||"No area"} · {i.division||"Division"} · {i.scheduled_date ? `Scheduled · ${i.scheduled_date}` : "Waiting for schedule"}</small></span><em className="bulk-batch-invoice-status">{i.scheduled_date ? "SCHEDULED" : "WAITING"}</em><strong>{remaining}/{i.pallets} physical · {formatEquivalent(invoiceEquivalentForNextUnassigned(i, remaining))} big-equiv</strong>{batchLoadMode==="partial"&&<input className="bulk-batch-qty" type="number" min={1} max={remaining||1} value={qty} disabled={!remaining} onChange={e=>setBatchPartialQuantities(q=>({...q,[i.id]:Math.min(remaining||1,Math.max(1,Number(e.target.value)||1))}))}/>}</label>})}</div>
      <div className="bulk-batch-load-note">Only the selected vehicles receive pallets. Loading still respects vehicle compatibility and remaining capacity.</div>
      <div className="bulk-load-modal-actions"><GlassButton variant="secondary" size="sm" onClick={closeBatchLoadModal}>Cancel</GlassButton><GlassButton size="sm" onClick={confirmBatchLoad} disabled={!batchSelectedIds.length||!batchVehicleIds.length}><Truck size={13}/> Load selected</GlassButton></div>
    </GlassCard></div>}
    {loadInvoiceTarget&&<div className="bulk-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)closeInvoiceLoadModal()}}><GlassCard className="bulk-planner-modal bulk-load-modal bulk-modal-surface">
      <div className="bulk-panel-title"><Truck size={16}/> Load invoice <button onClick={closeInvoiceLoadModal}><X size={14}/></button></div>
      <div className="bulk-load-modal-invoice"><div><span>INVOICE</span><b>{loadInvoiceTarget.invoice_no}</b><small>{loadInvoiceTarget.customer_name} · {invoicePhysicalQuantity(loadInvoiceTarget)} physical pallets · {formatEquivalent(invoiceEquivalentTotal(loadInvoiceTarget))} big-equiv</small><small>Physical count is separate from Big-equivalent loading capacity.</small></div><div className="bulk-load-remaining"><strong>{Math.max(0,Number(loadInvoiceTarget.pallets||0)-invoiceLoaded(loadInvoiceTarget))}</strong><span>physical remaining</span><small>{formatInvoiceEquivalent(loadInvoiceTarget, invoiceEquivalentForNextUnassigned(loadInvoiceTarget, Math.max(0,Number(loadInvoiceTarget.pallets||0)-invoiceLoaded(loadInvoiceTarget))))} big-equiv</small></div></div>
      <div className="bulk-load-vehicle-grid">{selectedVehicles.map(cfg=>{const v=vehicleMap.get(cfg.vehicle_id);if(!v)return null;const free=Math.max(0,capacityFor(cfg,v)-loadedByVehicle(cfg.vehicle_id));const active=loadVehicleId===v.id;return <button type="button" key={v.id} className={`bulk-load-vehicle-choice ${active?"selected":""}`} onClick={()=>setLoadVehicleId(v.id)}><img src={vehicleImage(v)} alt=""/><div><b>{v.number}</b><span>{v.type||"Vehicle"}</span><small>{formatOperationalEquivalent(free)} big-pallet space free</small><small>{(plan.vehicle_meta?.[v.id]?.driver||cfg.driver||"No driver")} · {(plan.vehicle_meta?.[v.id]?.helper||cfg.helper||"No helper")}</small><small style={{whiteSpace:"normal",overflowWrap:"anywhere",color:"var(--muted)"}}>Permitted: {vehiclePermittedLabel(v.id)}</small>{!vehicleAreaStatus(loadInvoiceTarget!,v).permitted&&<span title="Invoice area is outside this vehicle's permitted areas" style={{width:9,height:9,borderRadius:"50%",background:"#f59e0b",boxShadow:"0 0 0 2px rgba(245,158,11,.16)",flex:"0 0 auto"}}/>}</div>{active&&<Check size={15}/>}</button>})}</div>
      {!manageVehicleId&&<div className="bulk-load-form">
        <div className="bulk-load-mode"><span>Load quantity</span><div><button type="button" className={loadQuantity===Math.max(1,Number(loadInvoiceTarget.pallets||0)-invoiceLoaded(loadInvoiceTarget))?"active":""} onClick={()=>setLoadQuantity(Math.max(1,Number(loadInvoiceTarget.pallets||0)-invoiceLoaded(loadInvoiceTarget)))}>Full load</button><button type="button" className={loadQuantity!==Math.max(1,Number(loadInvoiceTarget.pallets||0)-invoiceLoaded(loadInvoiceTarget))?"active":""} onClick={()=>setLoadQuantity(Math.min(1,Math.max(1,Number(loadInvoiceTarget.pallets||0)-invoiceLoaded(loadInvoiceTarget))))}>Partial</button></div></div>
        <label className="bulk-load-qty"><span>Physical pallets to load</span><input type="number" min={1} max={Math.max(1,Number(loadInvoiceTarget.pallets||0)-invoiceLoaded(loadInvoiceTarget))} value={loadQuantity} onChange={e=>setLoadQuantity(Math.max(1,Math.min(Math.max(1,Number(loadInvoiceTarget.pallets||0)-invoiceLoaded(loadInvoiceTarget)),Number(e.target.value||1))))}/></label><small style={{display:"block",marginTop:6,color:"var(--muted)"}}>This load = {formatInvoiceEquivalent(loadInvoiceTarget, invoiceEquivalentForNextUnassigned(loadInvoiceTarget, loadQuantity))} big-equiv.</small>
      </div>}
      {manageVehicleId&&<div className="bulk-load-manage-panel"><div><span>Currently on {vehicleMap.get(manageVehicleId)?.number || manageVehicleId}</span><b>{formatEquivalent(invoiceEquivalentLoaded(loadInvoiceTarget))} big-equiv loaded</b></div><label><span>Quantity</span><input type="number" min={1} max={Math.max(1,assignedCountOnVehicle(loadInvoiceTarget,manageVehicleId))} value={loadQuantity} onChange={e=>setLoadQuantity(Math.max(1,Math.min(Math.max(1,assignedCountOnVehicle(loadInvoiceTarget,manageVehicleId)),Number(e.target.value||1))))}/></label><div className="bulk-load-manage-destination"><span>Move to</span><div>{selectedVehicles.filter(cfg=>cfg.vehicle_id!==manageVehicleId).map(cfg=>{const v=vehicleMap.get(cfg.vehicle_id);return <button type="button" key={cfg.vehicle_id} className={loadVehicleId===cfg.vehicle_id?"selected":""} onClick={()=>setLoadVehicleId(cfg.vehicle_id)}>{v?.number||cfg.vehicle_id}</button>})}</div></div></div>}
      <div className="bulk-load-modal-actions"><GlassButton variant="secondary" size="sm" onClick={closeInvoiceLoadModal}>Cancel</GlassButton>{manageVehicleId?<><GlassButton variant="secondary" size="sm" onClick={()=>removeInvoicePallets(loadInvoiceTarget,manageVehicleId,loadQuantity)}><X size={13}/> Remove {loadQuantity}</GlassButton><GlassButton size="sm" onClick={()=>moveInvoicePallets(loadInvoiceTarget,manageVehicleId,loadVehicleId,loadQuantity)} disabled={!loadVehicleId || loadVehicleId===manageVehicleId}><Truck size={13}/> Move {loadQuantity}</GlassButton></>:<GlassButton size="sm" onClick={confirmInvoiceLoad}><Truck size={13}/> Load {loadQuantity} physical pallet{loadQuantity===1?"":"s"}</GlassButton>}</div>
    </GlassCard></div>}
    {deleteInvoiceTarget&&<div className="bulk-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setDeleteInvoiceTarget(null)}}><GlassCard className="bulk-planner-modal bulk-modal-surface" style={{maxWidth:460}}><div className="bulk-panel-title"><Trash2 size={16}/> Delete invoice <button onClick={()=>setDeleteInvoiceTarget(null)}><X size={14}/></button></div><div className="bulk-modal-intro">Do you want to delete this invoice?</div><div style={{padding:"14px 0",display:"grid",gap:6}}><strong>{deleteInvoiceTarget.invoice_no}</strong><span>{deleteInvoiceTarget.customer_name}</span><small>{deleteInvoiceTarget.scheduled_date ? `Scheduled ${deleteInvoiceTarget.scheduled_date}` : "Waiting for schedule"} · {formatEquivalent(invoiceEquivalentTotal(deleteInvoiceTarget))} big-equiv</small></div><div className="bulk-load-modal-actions"><GlassButton variant="secondary" size="sm" onClick={()=>setDeleteInvoiceTarget(null)}>No</GlassButton><GlassButton size="sm" onClick={()=>void confirmDeleteInvoice()}><Trash2 size={13}/> Yes, delete</GlassButton></div></GlassCard></div>}
    {showBuildingEditor&&<div className="bulk-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setShowBuildingEditor(false)}}><GlassCard className="bulk-planner-modal bulk-modal-surface"><div className="bulk-panel-title"><Store size={16}/> Stores & destinations <button onClick={()=>setShowBuildingEditor(false)}><X size={14}/></button></div><div className="bulk-modal-intro">Create reusable store categories with default weekdays, specific dates, area and operational notes.</div><div className="bulk-store-form"><input value={storeForm.name} placeholder="Customer / store / destination name" onChange={e=>setStoreForm({...storeForm,name:e.target.value})}/><select value={storeForm.type} onChange={e=>setStoreForm({...storeForm,type:e.target.value as Building["type"]})}><option value="store">Store</option><option value="hospital">Hospital / Ward</option><option value="warehouse">Warehouse</option><option value="other">Other</option><option value="custom">Custom type</option></select><select value={storeForm.division} onChange={e=>setStoreForm({...storeForm,division:e.target.value})}><option value="">Current page: {divisionView}</option><option value="Pharma">Pharma</option><option value="Consumer">Consumer</option></select>{storeForm.type==="custom"&&<input value={storeForm.custom_type} placeholder="Custom type name" onChange={e=>setStoreForm({...storeForm,custom_type:e.target.value})}/>}<input value={storeForm.area} placeholder="Area" onChange={e=>setStoreForm({...storeForm,area:e.target.value})}/><input value={storeForm.note} placeholder="Details / notes" onChange={e=>setStoreForm({...storeForm,note:e.target.value})}/><label className="bulk-field-with-label"><span>Store timing</span><input type="time" value={storeForm.timing} onChange={e=>setStoreForm({...storeForm,timing:e.target.value})}/></label><label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,fontWeight:700}}><input type="checkbox" checked={storeForm.can_share_vehicle !== false} onChange={e=>setStoreForm({...storeForm,can_share_vehicle:e.target.checked})}/> Can share vehicle with other customers</label><div className="bulk-store-days">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d,i)=><button type="button" key={d} className={storeForm.schedule_days.includes(i)?"active":""} onClick={()=>toggleStoreDay(i)}>{d}</button>)}</div><div className="bulk-specific-date-picker"><input type="date" value={storeDatePicker} onChange={e=>setStoreDatePicker(e.target.value)}/><GlassButton variant="secondary" size="sm" onClick={addStoreSpecificDate}><Plus size={13}/> Add date</GlassButton><span>{storeForm.schedule_dates || "No specific dates selected"}</span></div><div className="bulk-store-form-actions"><GlassButton size="sm" onClick={addStore}>{editingStoreId?<Check size={13}/>:<Plus size={13}/>} {editingStoreId?"Update Customer / Location":"Add Customer / Location"}</GlassButton>{editingStoreId&&<GlassButton variant="secondary" size="sm" onClick={()=>{setEditingStoreId(null);setStoreForm({ name:"", type:"store", custom_type:"", area:"", note:"", timing:"", schedule_days:[], schedule_dates:"", division:divisionView, can_share_vehicle:true });}}>Cancel</GlassButton>}</div></div><div className="bulk-store-list">{(plan.buildings||[]).map(b=><div className="bulk-store-row" key={b.id}><div className="bulk-store-icon">{storeIcon(b.type)}</div><div><b>{b.name}</b><span>{buildingTypeLabel(b)} · {b.division || "Shared"} · {b.area||"Area not set"}{b.note?` · ${b.note}`:""}{b.timing?` · Timing ${b.timing}`:""}</span><small>{(b.schedule_days?.length?b.schedule_days.map((d:number)=>scheduleDayNames[d]).join(" · "):"Every day")}{b.schedule_dates?.length?` · ${b.schedule_dates.length} specific date(s)`:""} · {b.can_share_vehicle === false ? "Vehicle alone" : "Vehicle can share"}</small></div><div className="bulk-store-row-actions"><button className="btn icon-btn" title="Edit store / customer" onClick={()=>editStore(b)}><Pencil size={13}/></button><button className="btn icon-btn" title="Remove store" onClick={()=>removeStore(b.id)}><Trash2 size={13}/></button></div></div>)}</div></GlassCard></div>}

    {getRole() === "admin" && showBulkSettings&&<div className="bulk-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setShowBulkSettings(false)}}><GlassCard className="bulk-planner-modal bulk-modal-surface" style={{maxWidth:680,width:"min(680px,94vw)"} as any}><div className="bulk-panel-title"><Gauge size={16}/> Bulk Organizer Settings <button onClick={()=>setShowBulkSettings(false)}><X size={14}/></button></div><div className="bulk-modal-intro">Configure the shared box-to-pallet standards used by Bulk Organizer calculations. This does not modify Fleet Data or the database schema.</div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12}}><div style={{padding:12,borderRadius:12,border:"1px solid var(--glass-border,rgba(148,163,184,.2))"}}><b>Big pallet capacity</b><label className="bulk-field-with-label"><span>Small boxes</span><input type="number" min={1} value={boxSettings.big.small} onChange={e=>setBoxSettings(x=>({...x,big:{...x.big,small:Number(e.target.value)}}))}/></label><label className="bulk-field-with-label"><span>Medium boxes</span><input type="number" min={1} value={boxSettings.big.medium} onChange={e=>setBoxSettings(x=>({...x,big:{...x.big,medium:Number(e.target.value)}}))}/></label><label className="bulk-field-with-label"><span>Big boxes</span><input type="number" min={1} value={boxSettings.big.big} onChange={e=>setBoxSettings(x=>({...x,big:{...x.big,big:Number(e.target.value)}}))}/></label></div><div style={{padding:12,borderRadius:12,border:"1px solid var(--glass-border,rgba(148,163,184,.2))"}}><b>Small pallet capacity</b><label className="bulk-field-with-label"><span>Small boxes</span><input type="number" min={1} value={boxSettings.small.small} onChange={e=>setBoxSettings(x=>({...x,small:{...x.small,small:Number(e.target.value)}}))}/></label><label className="bulk-field-with-label"><span>Medium boxes</span><input type="number" min={1} value={boxSettings.small.medium} onChange={e=>setBoxSettings(x=>({...x,small:{...x.small,medium:Number(e.target.value)}}))}/></label><label className="bulk-field-with-label"><span>Big boxes</span><input type="number" min={1} value={boxSettings.small.big} onChange={e=>setBoxSettings(x=>({...x,small:{...x.small,big:Number(e.target.value)}}))}/></label></div><div style={{padding:12,borderRadius:12,border:"1px solid var(--glass-border,rgba(148,163,184,.2))"}}><b>Small → Big equivalent</b><label className="bulk-field-with-label"><span>1 Small pallet = Big</span><input type="number" min={0.01} step={0.01} value={boxSettings.smallToBig} onChange={e=>setBoxSettings(x=>({...x,smallToBig:Number(e.target.value)}))}/></label><small style={{color:"var(--muted)",lineHeight:1.45}}>Default is 0.67 (2/3). Changing this changes new box calculations and the shared Bulk Organizer standard.</small></div></div><div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16,flexWrap:"wrap"}}><GlassButton variant="secondary" size="sm" onClick={()=>setBoxSettings(DEFAULT_BOX_PALLET_SETTINGS)}>Reset</GlassButton><GlassButton size="sm" onClick={()=>persistBoxSettings(boxSettings)}><Save size={13}/> Save settings</GlassButton></div></GlassCard></div>}

    {(showCustomerManager||showScheduleManager||showInvoiceManager||editingInvoice||invoiceForm.invoice_no)&&<div className="bulk-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget){setShowCustomerManager(false);setShowScheduleManager(false);setShowInvoiceManager(false);setEditingInvoice(null);setInvoiceBuildingLocked(false);setInvoiceCustomerLocked(false);setInvoiceBatchMode(false);setInvoiceBatchRows([]);setBatchScheduleOpen({});setInvoiceForm(x=>({...x,invoice_no:"",building_id:""}))}}}><GlassCard className="bulk-planner-modal bulk-modal-surface">
      <div className="bulk-panel-title"><Users size={16}/> Data & scheduling <button onClick={()=>{setShowCustomerManager(false);setShowScheduleManager(false);setShowInvoiceManager(false);setEditingInvoice(null);setInvoiceBuildingLocked(false);setInvoiceCustomerLocked(false);setInvoiceBatchMode(false);setInvoiceBatchRows([]);setBatchScheduleOpen({});setInvoiceForm(x=>({...x,invoice_no:"",building_id:""}))}}><X size={14}/></button></div>
      <div className="bulk-modal-intro">Keep customer, schedule and invoice data in one clean workspace. Each invoice appears on its scheduled date.</div>
      {showScheduleManager&&<div className="bulk-modal-block"><h4>Customer schedule</h4><div className="bulk-schedule-editor"><input list="bulk-customer-library" value={scheduleForm.customer_name} placeholder="Customer" onChange={e=>setScheduleForm({...scheduleForm,customer_name:e.target.value})}/><select value={scheduleForm.area} onChange={e=>setScheduleForm({...scheduleForm,area:e.target.value})}><option value="">Area</option>{areas.map(a=><option key={a.id} value={a.name}>{a.code} · {a.name}</option>)}</select><select value={scheduleForm.division} onChange={e=>setScheduleForm({...scheduleForm,division:e.target.value})}><option value="">Division</option><option>Pharma</option><option>Consumer</option></select><select value={scheduleForm.building_id} onChange={e=>setScheduleForm({...scheduleForm,building_id:e.target.value})}><option value="">Store / destination</option>{(plan.buildings||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select><div className="bulk-day-picker">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d,i)=><button key={d} className={scheduleForm.days.includes(i)?"active":""} onClick={()=>setScheduleForm(x=>({...x,days:x.days.includes(i)?x.days.filter(y=>y!==i):[...x.days,i]}))}>{d}</button>)}</div><GlassButton size="sm" onClick={addSchedule}><Plus size={14}/> Save Schedule</GlassButton></div></div>}
      {(showInvoiceManager||editingInvoice||invoiceForm.invoice_no)&&<div className="bulk-modal-block">
        <h4>{editingInvoice?"Edit invoice":invoiceBatchMode?"Add invoices":"Add invoice"}</h4>
        {invoiceBatchMode&&!editingInvoice ? <div className="bulk-invoice-batch-list bulk-invoice-batch-cards">
          {(invoiceBatchRows.length?invoiceBatchRows:[invoiceForm]).map((row,idx)=>{
            const rowDates=allowedDatesForBuilding(row.building_id,row.schedule_date);
            const rowAllowsToday=buildingAllowsDate(row.building_id,date);
            const updateRow=(patch: Partial<typeof invoiceForm>)=>setInvoiceBatchRows(rows=>{
              const base=rows.length?rows:[{...invoiceForm}];
              return base.map((r,j)=>j===idx?{...r,...patch}:r);
            });
            return <div className="bulk-invoice-form bulk-invoice-batch-card" key={idx}>
              <div className="bulk-invoice-batch-card-head"><div><span>INVOICE {idx+1}</span><b>{row.customer_name || "New invoice"}</b></div>{invoiceBatchRows.length>1&&<button type="button" className="btn icon-btn" title="Remove invoice" onClick={()=>setInvoiceBatchRows(rows=>rows.filter((_,j)=>j!==idx))}><X size={12}/></button>}</div>
              <input value={row.invoice_no} placeholder="Invoice no." onChange={e=>updateRow({invoice_no:e.target.value})}/>
              <input list="bulk-customer-library" value={row.customer_name} placeholder="Customer / Supply / Other customer" onChange={e=>{
                const name=e.target.value; const c=customers.find(x=>norm(x.name)===norm(name)); const sched=plan.customer_schedules?.find(x=>norm(x.customer_name)===norm(name));
                updateRow({customer_name:name,customer_id:c?.id||"",building_id:sched?.building_id||buildingForCustomer(name)?.id||row.building_id,area:c?.area||row.area,division:c?.division||row.division});
              }}/>
              <label className="bulk-field-with-label"><span>Store / location</span><select value={row.building_id} onChange={e=>{
                const buildingId=e.target.value; const b=(plan.buildings||[]).find(x=>x.id===buildingId); const isOthers=norm(b?.name)==="OTHERS"; const c=isOthers?undefined:customers.find(x=>norm(x.name)===norm(b?.name||"")); const linked=plan.customer_schedules?.find(x=>x.building_id===buildingId);
                updateRow({building_id:buildingId,customer_name:isOthers?"":(b?.name||""),customer_id:c?.id||`manual:${buildingId||""}`,area:b?.area||linked?.area||row.area,division:b?.division||linked?.division||row.division,schedule_date:(row.schedule_date&&buildingAllowsDate(buildingId,row.schedule_date))?row.schedule_date:""});
              }}><option value="">Select location</option>{(plan.buildings||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <select value={row.area} onChange={e=>updateRow({area:e.target.value})}><option value="">Area</option>{areas.map(a=><option key={a.id} value={a.name}>{a.code} · {a.name}</option>)}</select>
              <select value={row.division} onChange={e=>updateRow({division:e.target.value})}><option value="">Division</option><option>Pharma</option><option>Consumer</option></select>
              <div className="bulk-pallet-size-fields"><label className="bulk-field-with-label"><span>Big pallets</span><input type="number" min={0} step={1} value={row.big_pallet_quantity ?? (row.pallet_size === "big" ? row.pallet_quantity : 0)} onChange={e=>updateRow({big_pallet_quantity:Math.max(0,Number(e.target.value||0)),pallets:Math.max(1,Number(e.target.value||0)+Number(row.small_pallet_quantity||0))})}/></label><label className="bulk-field-with-label"><span>Small pallets</span><input type="number" min={0} step={1} value={row.small_pallet_quantity ?? (row.pallet_size === "small" ? row.pallet_quantity : 0)} onChange={e=>updateRow({small_pallet_quantity:Math.max(0,Number(e.target.value||0)),pallets:Math.max(1,Number(row.big_pallet_quantity||0)+Number(e.target.value||0))})}/></label><span className="bulk-pallet-total-chip">Total {formatEquivalent(Number(row.big_pallet_quantity||0) + Number(row.small_pallet_quantity||0) * boxSettings.smallToBig)} big</span></div><div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(80px,1fr))",gap:6,marginTop:8}}><label className="bulk-field-with-label"><span>Small boxes</span><input type="number" min={0} value={row.box_small || 0} onChange={e=>updateRow({box_small:Math.max(0,Number(e.target.value||0))})}/></label><label className="bulk-field-with-label"><span>Medium boxes</span><input type="number" min={0} value={row.box_medium || 0} onChange={e=>updateRow({box_medium:Math.max(0,Number(e.target.value||0))})}/></label><label className="bulk-field-with-label"><span>Big boxes</span><input type="number" min={0} value={row.box_big || 0} onChange={e=>updateRow({box_big:Math.max(0,Number(e.target.value||0))})}/></label></div><div style={{fontSize:11,color:"var(--muted)",marginTop:5}}>Box standard: Big {boxSettings.big.small}/{boxSettings.big.medium}/{boxSettings.big.big} · Small {boxSettings.small.small}/{boxSettings.small.medium}/{boxSettings.small.big}. {boxSummaryText({box_counts:{small:row.box_small,medium:row.box_medium,big:row.box_big}}, boxSettings) || "No box calculation yet."}</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1.3fr",gap:6,marginTop:8}}><label className="bulk-field-with-label"><span>Timing</span><input type="time" value={row.timing || ""} onChange={e=>updateRow({timing:e.target.value})}/></label><label className="bulk-field-with-label"><span>Remarks</span><input value={row.remarks || ""} onChange={e=>updateRow({remarks:e.target.value})}/></label><label className="bulk-field-with-label"><span>Vehicle sharing</span><select value={row.can_share_vehicle || "store"} onChange={e=>updateRow({can_share_vehicle:e.target.value as any})}><option value="store">Use store rule</option><option value="yes">Can share</option><option value="no">Must be alone</option></select></label></div>
              <label className="bulk-field-with-label"><span>Invoice date</span><input type="date" value={row.invoice_date} onChange={e=>updateRow({invoice_date:e.target.value})}/></label>
              <label className="bulk-field-with-label"><span>Schedule</span><div className="bulk-schedule-choice-box"><div className="bulk-schedule-choice-row"><button type="button" className={row.schedule_date===date?"active":""} title={rowAllowsToday?"Schedule for today":"Store is not scheduled today, but manual scheduling is allowed"} onClick={()=>updateRow({schedule_date:date})}>{dayLabel(date)}{!rowAllowsToday&&" ⚠"}</button><button type="button" className={!row.schedule_date?"active":""} onClick={()=>updateRow({schedule_date:""})}>Waiting</button><button type="button" className={batchScheduleOpen[idx] ? "active" : ""} onClick={()=>{setBatchScheduleOpen(x=>({...x,[idx]:true}));if(!row.schedule_date) updateRow({schedule_date:date})}}>Date</button></div>{batchScheduleOpen[idx]&&<div className="bulk-batch-schedule-picker"><input className="bulk-schedule-date-input" type="date" value={row.schedule_date || date} min={date} onChange={e=>updateRow({schedule_date:e.target.value})}/><span>{row.schedule_date ? dayLabel(row.schedule_date) : "Select schedule date"}</span></div>}</div></label>
            </div>;
          })}
          <div className="bulk-invoice-batch-actions"><button type="button" className="bulk-batch-select-btn" onClick={()=>setInvoiceBatchRows(rows=>[...(rows.length?rows:[{...invoiceForm}]),{...(rows.length?rows[rows.length-1]:invoiceForm),invoice_no:""}])}><Plus size={12}/> Add another invoice</button><GlassButton size="sm" onClick={addInvoiceBatch}><Check size={14}/> Add all invoices</GlassButton></div>
        </div> : <div className="bulk-invoice-form">
          <input value={invoiceForm.invoice_no} placeholder="Invoice no." onChange={e=>setInvoiceForm({...invoiceForm,invoice_no:e.target.value})}/>{(() => { const invoiceStore = (plan.buildings || []).find(b => b.id === invoiceForm.building_id); const linked = invoiceStore?.linked_customers || []; if (invoiceBuildingLocked && linked.length && !isOthersStore(invoiceStore!)) { const options = [{ id: customers.find(c=>norm(c.name)===norm(invoiceStore!.name))?.id || `manual:${invoiceStore!.id}`, name: invoiceStore!.name, area: invoiceStore!.area, division: invoiceStore!.division || divisionView }, ...linked]; return <select value={invoiceForm.customer_name} onChange={e=>{const picked=options.find(c=>norm(c.name)===norm(e.target.value)) || options[0];setInvoiceForm(x=>({...x,customer_name:picked.name,customer_id:picked.id,area:picked.area||invoiceStore!.area||x.area,division:picked.division||invoiceStore!.division||divisionView,timing:x.timing||invoiceStore!.timing||""}))}}>{options.map(c=><option key={`${c.id}:${c.name}`} value={c.name}>{c.name}</option>)}</select>; } return <input list="bulk-customer-library" value={invoiceForm.customer_name} disabled={invoiceCustomerLocked} className={invoiceCustomerLocked?"bulk-invoice-locked-field":""} placeholder="Customer / Supply / Other customer" onChange={e=>{const name=e.target.value;const c=customers.find(x=>norm(x.name)===norm(name));const sched=plan.customer_schedules?.find(s=>norm(s.customer_name)===norm(name));setInvoiceForm({...invoiceForm,customer_name:name,customer_id:c?.id||"",building_id:invoiceBuildingLocked ? invoiceForm.building_id : (sched?.building_id||buildingForCustomer(name)?.id||invoiceForm.building_id),area:c?.area||invoiceForm.area,division:c?.division||invoiceForm.division})}}/>; })()}<label className="bulk-field-with-label"><span>Store / location</span>{invoiceBuildingLocked ? <div className="bulk-invoice-locked-location">{buildingTypeLabel((plan.buildings||[]).find(b=>b.id===invoiceForm.building_id) || {id:"",name:"Selected location",type:"other",area:"",enabled:true})}</div> : <select value={invoiceForm.building_id} onChange={e=>{const buildingId=e.target.value;const b=(plan.buildings||[]).find(x=>x.id===buildingId);const isOthers=norm(b?.name)==="OTHERS";const c=isOthers?undefined:customers.find(x=>norm(x.name)===norm(b?.name||""));const linkedSchedule=plan.customer_schedules?.find(s=>s.building_id===buildingId);setInvoiceCustomerLocked(!!b&&!isOthers);setInvoiceForm(x=>({...x,building_id:buildingId,customer_name:isOthers?"":(b?.name||""),customer_id:c?.id||`manual:${buildingId||""}`,area:b?.area||linkedSchedule?.area||x.area,division:b?.division||linkedSchedule?.division||x.division,schedule_date:(x.schedule_date&&buildingAllowsDate(buildingId,x.schedule_date))?x.schedule_date:""}));if(!isOthers&&b&&!buildingAllowsDate(buildingId,date))setScheduleMode("specific");}}><option value="">Select location</option>{(plan.buildings||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>}</label><select value={invoiceForm.area} onChange={e=>setInvoiceForm({...invoiceForm,area:e.target.value})}><option value="">Area</option>{areas.map(a=><option key={a.id} value={a.name}>{a.code} · {a.name}</option>)}</select><select value={invoiceForm.division} onChange={e=>setInvoiceForm({...invoiceForm,division:e.target.value})}><option value="">Division</option><option>Pharma</option><option>Consumer</option></select><div className="bulk-pallet-size-fields"><label className="bulk-field-with-label"><span>Big pallets</span><input type="number" min={0} step={1} value={invoiceForm.big_pallet_quantity} onChange={e=>setInvoiceForm(x=>({...x,big_pallet_quantity:Math.max(0,Number(e.target.value||0)),pallets:Math.max(1,Number(e.target.value||0)+Number(x.small_pallet_quantity||0))}))}/></label><label className="bulk-field-with-label"><span>Small pallets</span><input type="number" min={0} step={1} value={invoiceForm.small_pallet_quantity} onChange={e=>setInvoiceForm(x=>({...x,small_pallet_quantity:Math.max(0,Number(e.target.value||0)),pallets:Math.max(1,Number(x.big_pallet_quantity||0)+Number(e.target.value||0))}))}/></label><span className="bulk-pallet-total-chip">Total {formatEquivalent(Number(invoiceForm.big_pallet_quantity||0) + Number(invoiceForm.small_pallet_quantity||0) * boxSettings.smallToBig)} big</span></div><div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(90px,1fr))",gap:7,marginTop:8}}><label className="bulk-field-with-label"><span>Small boxes</span><input type="number" min={0} value={invoiceForm.box_small} onChange={e=>setInvoiceForm(x=>({...x,box_small:Math.max(0,Number(e.target.value||0))}))}/></label><label className="bulk-field-with-label"><span>Medium boxes</span><input type="number" min={0} value={invoiceForm.box_medium} onChange={e=>setInvoiceForm(x=>({...x,box_medium:Math.max(0,Number(e.target.value||0))}))}/></label><label className="bulk-field-with-label"><span>Big boxes</span><input type="number" min={0} value={invoiceForm.box_big} onChange={e=>setInvoiceForm(x=>({...x,box_big:Math.max(0,Number(e.target.value||0))}))}/></label></div><div style={{fontSize:11,color:"var(--muted)",marginTop:5}}>Big pallet: {boxSettings.big.small} small / {boxSettings.big.medium} medium / {boxSettings.big.big} big · Small pallet: {boxSettings.small.small} / {boxSettings.small.medium} / {boxSettings.small.big}. {boxSummaryText({box_counts:{small:invoiceForm.box_small,medium:invoiceForm.box_medium,big:invoiceForm.box_big}}, boxSettings) || "Enter boxes to calculate pallet equivalents."}</div><div style={{display:"grid",gridTemplateColumns:"1fr 1.4fr 1.2fr",gap:7,marginTop:8}}><label className="bulk-field-with-label"><span>Timing</span><input type="time" value={invoiceForm.timing} onChange={e=>setInvoiceForm(x=>({...x,timing:e.target.value}))}/></label><label className="bulk-field-with-label"><span>Remarks</span><input value={invoiceForm.remarks} placeholder="Optional" onChange={e=>setInvoiceForm(x=>({...x,remarks:e.target.value}))}/></label><label className="bulk-field-with-label"><span>Vehicle sharing</span><select value={invoiceForm.can_share_vehicle} onChange={e=>setInvoiceForm(x=>({...x,can_share_vehicle:e.target.value as any}))}><option value="store">Use store rule</option><option value="yes">Can share</option><option value="no">Must be alone</option></select></label></div><label className="bulk-field-with-label"><span>Invoice date</span><input type="date" value={invoiceForm.invoice_date} onChange={e=>setInvoiceForm({...invoiceForm,invoice_date:e.target.value})}/></label><label className="bulk-field-with-label"><span>Schedule</span><div className="bulk-schedule-choice-box"><div className="bulk-schedule-choice-row"><button type="button" className={scheduleMode==="today"?"active":""} title={buildingAllowsDate(invoiceForm.building_id,date)?"Schedule for today":"Store is not scheduled today, but manual scheduling is allowed"} onClick={()=>{setScheduleMode("today");setInvoiceForm(x=>({...x,schedule_date:date}))}}>{dayLabel(date)}{!buildingAllowsDate(invoiceForm.building_id,date)&&" ⚠"}</button><button type="button" className={scheduleMode==="waiting"?"active":""} onClick={()=>{setScheduleMode("waiting");setInvoiceForm(x=>({...x,schedule_date:""}))}}>Waiting</button><button type="button" className={scheduleMode==="specific"?"active":""} onClick={()=>{const first=invoiceForm.schedule_date&&allowedInvoiceDates.includes(invoiceForm.schedule_date)?invoiceForm.schedule_date:(allowedInvoiceDates[0]||"");setScheduleMode("specific");setInvoiceForm(x=>({...x,schedule_date:first}))}}>Date</button><button type="button" className={scheduleMode==="any_day"?"active":""} title="Available on any planning day without a fixed date" onClick={()=>{setScheduleMode("any_day");setInvoiceForm(x=>({...x,schedule_date:""}))}}>Any day</button></div>{scheduleMode==="specific"&&<input className="bulk-schedule-date-input" type="date" value={invoiceForm.schedule_date} onChange={e=>{const v=e.target.value;if(v && !allowedInvoiceDates.includes(v)){setError("Choose one of the allowed schedule dates for this store.");return;}setInvoiceForm(x=>({...x,schedule_date:v}))}} />}{scheduleMode==="any_day"&&<small style={{display:"block",marginTop:6,color:"var(--muted)"}}>No fixed date — this invoice can appear on any planning day until it is loaded or assigned.</small>}</div></label><div className="bulk-invoice-single-actions">
            <GlassButton size="sm" onClick={editingInvoice?updateInvoice:addInvoice}>{editingInvoice?<Check size={14}/>:<Plus size={14}/>} {editingInvoice?"Update":"Add"} Invoice</GlassButton>
            {!editingInvoice && <GlassButton size="sm" variant="secondary" onClick={startInvoiceBatchFromCurrent}><Plus size={14}/> Add Another Invoice</GlassButton>}
          </div>
        </div>}
      </div>}
    </GlassCard></div>}
    <datalist id="bulk-driver-library">{driverLibrary.map(d=><option key={d.id} value={d.name}>{d.code}</option>)}</datalist><datalist id="bulk-helper-library">{helperLibrary.map(h=><option key={h.id} value={h.name}>{h.code}</option>)}</datalist><datalist id="bulk-customer-library">{Array.from(new Set([...customerLibrary,...customers.map(c=>c.name)])).map(c=><option key={c} value={c}/>)}</datalist>
  </div>;
}

export default function BulkOrganizer() {
  return <BulkOrganizerErrorBoundary><BulkOrganizerPage /></BulkOrganizerErrorBoundary>;
}
