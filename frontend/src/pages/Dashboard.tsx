import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Building2, Warehouse, MapPin, Truck, Briefcase, CalendarDays, ChevronDown, FileSpreadsheet, BarChart3, Timer, Package, Map, AlertTriangle } from "lucide-react";
import { getPreloadedDashboardRange, getCachedDashboardFilterMeta, getCachedDashboardDriverDirectory } from "../services/dashboardKpis";
import { getDashboardLocalDataset,
  getDashboardLocalLoadingProgress,
  subscribeDashboardLocalProgress, getLocalFilterOptions, preloadDashboardLocalDataset, subscribeDashboardLocal } from "../services/dashboardLocalStore";
import { exportDashboardExcel, exportDashboardView, fetchDashboardEndpoint, type DashboardExportView } from "../services/dashboardAnalytics";
import { getDrivers } from "../services/operational";
import { triggerDashboardRefresh } from "../hooks/dashboardRefreshBus";
import DashboardTabs from "../components/DashboardTabs";
import MultiSelectSlicer from "../components/MultiSelectSlicer";
import DriverSlicerBar, { DriverDirectoryEntry } from "../components/DriverSlicerBar";
import HomeTab from "./HomeTab";
import LeadTimeTab from "./LeadTimeTab";
import OrderSummaryTab from "./OrderSummaryTab";
import AreaAnalyticsTab from "./AreaAnalyticsTab";
import NotSuppliedTab from "./NotSuppliedTab";
import DriverPerformanceTab from "./DriverPerformanceTab";
import { GlassHeader } from "../design-system/GlassHeader";
import { GlassButton } from "../design-system/GlassButton";
import { GlassFilterBar } from "../design-system/GlassFilter";
import { GlassInput } from "../design-system/GlassInput";
import { dashboardFilterParams } from "../types/dashboardFilters";
import { getFederatedSupabaseClients } from "../lib/supabase";
import { useOperationalRealtime } from "../hooks/useOperationalRealtime";
import ExportStatus from "../components/ExportStatus";
import type { ExportProgress } from "../services/desktopExport";

// NAV REDESIGN (latest): the Overview/Analytics-wrapper split from the
// previous round is reverted per explicit instruction - Driver
// Performance/Lead Time/Order Summary/Area Analytics/Not Supplied are
// direct top-level Dashboard tabs again, right after Overview, no
// Analytics wrapper tab in between. Driver Mapping Review/Diagnostics/
// Dashboard Configuration stay relocated to their own Admin-linked pages
// from the prior round (that part of the redesign wasn't reverted).
const TABS = [
  { key: "home", label: "Overview" },
  { key: "driver-performance", label: "Driver Performance" },
  { key: "lead-time", label: "Lead Time" },
  { key: "order-summary", label: "Order Summary" },
  { key: "area-analytics", label: "Area Analytics" },
  { key: "not-supplied", label: "Not Supplied" },
];

export default function Dashboard() {
  // Browser refresh can restore the previous document scroll position before
  // React mounts. On Dashboard that can expose a blank strip above the global
  // top navigation even though a fresh navigation starts correctly at y=0.
  // Reset only when Dashboard mounts; normal scrolling inside the page remains
  // untouched. Also disable page-level overscroll chaining while Dashboard is
  // mounted so pulling past the top cannot reveal the blank overscroll area.
  useLayoutEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverscroll = html.style.overscrollBehaviorY;
    const previousBodyOverscroll = body.style.overscrollBehaviorY;
    const previousScrollRestoration = history.scrollRestoration;
    const resetScroll = () => {
      window.scrollTo(0, 0);
      html.scrollTop = 0;
      body.scrollTop = 0;
    };

    // Prevent Chromium/WebKit from restoring the pre-refresh scroll offset
    // after Dashboard has mounted, which is what creates the blank strip
    // above the global top navigation on refresh only.
    history.scrollRestoration = "manual";
    html.style.overscrollBehaviorY = "none";
    body.style.overscrollBehaviorY = "none";
    resetScroll();
    const frame = window.requestAnimationFrame(resetScroll);

    return () => {
      window.cancelAnimationFrame(frame);
      history.scrollRestoration = previousScrollRestoration;
      html.style.overscrollBehaviorY = previousHtmlOverscroll;
      body.style.overscrollBehaviorY = previousBodyOverscroll;
    };
  }, []);

  const [tab, setTab] = useState("home");
  const [exportError, setExportError] = useState("");
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportTriggerRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [exportMenuPos, setExportMenuPos] = useState<{ left: number; top: number } | null>(null);
  // Keep the portaled export menu anchored to the Export button while any
  // page/container scroll happens. The menu is fixed to the viewport, so its
  // coordinates are refreshed from the trigger on every scroll frame.
  useEffect(() => {
    if (!exportMenuOpen) return;
    const sync = () => {
      const rect = exportTriggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setExportMenuPos({ left: Math.max(8, rect.right - 250), top: rect.bottom + 8 });
    };
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = !!exportTriggerRef.current?.contains(target);
      const insideMenu = !!exportMenuRef.current?.contains(target);
      if (!insideTrigger && !insideMenu) setExportMenuOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setExportMenuOpen(false); };
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", key);
    };
  }, [exportMenuOpen]);
  // PERF FIX (slow tab switching): tabs below used to be conditionally
  // *mounted* (`{tab === "x" && <XTab/>}`), so switching away from a tab
  // unmounted it entirely - switching back mounted it fresh and re-ran
  // its data-fetching effects from scratch every single time, even for a
  // PERFORMANCE: only the active tab stays mounted. Exact-filter results are
  // cached by dashboardCache, so revisiting a tab is still instant without
  // allowing hidden tabs to re-query Supabase on every slicer change.
  function selectTab(key: string) { setTab(key); }

  const [driver, setDriver] = useState("");
  const [driverList, setDriverList] = useState<string[]>([]);

  // Dashboard Filter Slicers (V2 milestone) - Excel/Power BI-style,
  // every one multi-select. Vehicle type is intentionally limited to Van/Pickup;
  // Area comes directly from the selected SAP export month, and Drivers are
  // Fleet Database identities that have valid SAP data in that month.
  const [selDrivers, setSelDrivers] = useState<string[]>([]);
  const [selAreas, setSelAreas] = useState<string[]>([]);
  const [selDivisions, setSelDivisions] = useState<string[]>([]);
  const [selVehicleTypes, setSelVehicleTypes] = useState<string[]>([]);
  const [selFacilityTypes, setSelFacilityTypes] = useState<string[]>([]);
  const [selSalesmen, setSelSalesmen] = useState<string[]>([]);
  // DEFAULT DATE RANGE (portable-app item 10): dashboard opens scoped to
  // the current month only, so first load isn't querying/rendering the
  // entire historical dataset. Purely an initial value - selecting any
  // other range (or clearing filters, below) still works exactly as
  // before; nothing here permanently restricts the data available.
  const _monthStart = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  };
  const _today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  // Keep the dashboard fast on startup: default to ONE calendar month only,
  // specifically the latest month that actually has imported SAP data. This
  // avoids opening on an empty current month (for example, opening in Sep when
  // the latest imported data is Aug) and avoids loading several months at once.
  // Users can still change From/To manually at any time to view multiple months.
  // Start with the current month as a safe, bounded query while the one-row
  // "latest data date" lookup completes. The effect below immediately moves
  // this to the latest month that actually contains data.
  const preloadedRange = getPreloadedDashboardRange();
  const [dateFrom, setDateFrom] = useState(preloadedRange?.start || "");
  const [dateTo, setDateTo] = useState(preloadedRange?.end || "");
  const [latestRangeReady, setLatestRangeReady] = useState(() => Boolean(preloadedRange?.start && preloadedRange?.end));
  const [localDataset, setLocalDataset] = useState(() => getDashboardLocalDataset());
  const [initialLoadingProgress, setInitialLoadingProgress] = useState(() => getDashboardLocalLoadingProgress());
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [initialLoadingHint, setInitialLoadingHint] = useState("Preparing your Dashboard data…");
  // FINAL CORRECTION PASS (single source of truth, item 12): promoted out
  // of LeadTimeTab-local state so Dashboard.tsx is the one place that owns
  // every filter, including these two - see dashboardFilters.ts's
  // GlobalFilters doc comment for why.
  const [selLeadTimeBand, setSelLeadTimeBand] = useState("");
  const [selClassification, setSelClassification] = useState("");

  const [vehicleTypeOptions, setVehicleTypeOptions] = useState<string[]>(["Van", "Pickup"]);
  const initialFilterMeta = getCachedDashboardFilterMeta(dateFrom, dateTo);
  const [filterOptions, setFilterOptions] = useState<{ divisions: string[]; facility_types: string[]; salesmen: string[]; areas: string[]; drivers: string[] }>({
    divisions: initialFilterMeta?.divisions || [],
    facility_types: initialFilterMeta?.facility_types || [],
    salesmen: initialFilterMeta?.salesmen || [],
    areas: initialFilterMeta?.areas || [],
    drivers: initialFilterMeta?.drivers || [],
  });
  // DRIVER SLICER (item 7 - display name): Fleet Database's own
  // code+name directory, fetched once and reused - purely for a richer
  // label on the slicer buttons (e.g. "D040 · Hussain Mohammed" instead
  // of just "D040"). NOT used to decide which drivers are valid - that
  // authoritative restriction already happened server-side in
  // /api/dashboard/filter-options (filterOptions.drivers below), same as
  // before this change. GET /api/drivers already exists (Fleet Database
  // CRUD) - reused as-is, no new endpoint.
  const [driverDirectory, setDriverDirectory] = useState<DriverDirectoryEntry[]>(() => getCachedDashboardDriverDirectory() as DriverDirectoryEntry[]);

  // The local Dashboard dataset uses the exact driver identifiers exposed by
  // its own slicer options. Do NOT rewrite a selected driver through the Fleet
  // directory here: a Fleet display name can differ from the SAP driver_name
  // stored in the local analytical rows, which makes one selected driver look
  // like zero rows and can cause later selections to appear to combine. Keep
  // the slicer value as the filter value; the directory remains display-only.
  const globalFilters = {
    drivers: selDrivers.join(","), areas: selAreas.join(","), division: selDivisions.join(","),
    route_type: "", vehicle_type: selVehicleTypes.join(","),
    facility_type: selFacilityTypes.join(","), salesman: selSalesmen.join(","),
    start_date: dateFrom, end_date: dateTo,
    lead_time_band: selLeadTimeBand, classification: selClassification,
  };



  async function syncDashboardToLatestImportedMonth(force = false) {
    try {
      const clients = getFederatedSupabaseClients();
      const results = await Promise.all(clients.map(async (client) => {
        const { data, error } = await client
          .from("sap_invoice_facts")
          .select("dispatch_date")
          .not("dispatch_date", "is", null)
          .order("dispatch_date", { ascending: false })
          .limit(1);
        if (error) return null;
        return data?.[0]?.dispatch_date ? String(data[0].dispatch_date).slice(0, 10) : null;
      }));
      const latest = results.filter(Boolean).sort().pop();
      if (!latest) return;
      const [year, month] = latest.split("-").map(Number);
      if (!year || !month) return;
      const latestMonthKey = `${year}-${String(month).padStart(2, "0")}`;
      const currentMonthKey = String(dateFrom || "").slice(0, 7);
      if (!force && currentMonthKey === latestMonthKey) return;
      const monthStart = `${latestMonthKey}-01`;
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const monthEnd = `${latestMonthKey}-${String(lastDay).padStart(2, "0")}`;
      setDateFrom(monthStart);
      setDateTo(monthEnd);
    } catch {
      // Keep the current selection if the live latest-date lookup fails.
    }
  }


  useEffect(() => {
    const unsubscribe = subscribeDashboardLocal(() => setLocalDataset(getDashboardLocalDataset()));
    const unsubscribeProgress = subscribeDashboardLocalProgress(setInitialLoadingProgress);
    return () => { unsubscribe(); unsubscribeProgress(); };
  }, []);

  // UI-only finalization. Keep the existing data-loading pipeline untouched.
  // Once the dataset and latest range are ready, finish the visual progress
  // at 100% first, keep 100% on screen briefly, and only then reveal the
  // Dashboard. This prevents the UI from ever opening while it visibly stops
  // at 65% (or another intermediate value).
  useEffect(() => {
    if (!localDataset || !latestRangeReady || initialLoadComplete) return;

    // The data pipeline can legitimately jump from its last measured fetch
    // checkpoint (often ~65%) to ready. Do not expose that jump to the user.
    // Finish the *visual* progress in small steps so it reads as continuous
    // progress while the already-loaded local dataset stays completely
    // untouched.
    let displayed = Math.max(0, Math.min(99, initialLoadingProgress));
    if (displayed < 65 || displayed >= 95) displayed = 65;
    setInitialLoadingProgress(displayed);

    const hints = [
      "Did you know? You can combine multiple months in the date filter.",
      "Did you know? Driver filters update the dashboard instantly from local data.",
      "Did you know? You can click a KPI to drill into the underlying orders.",
      "Did you know? Division, Area, Vehicle Type and Salesman filters can work together.",
      "Did you know? Dashboard data is kept locally so returning to this page is fast.",
      "Did you know? Driver Performance links GPS routes back to the matching driver and vehicle.",
    ];
    let hintIndex = 0;
    setInitialLoadingHint(hints[hintIndex]);
    const hintTimer = window.setInterval(() => {
      hintIndex = (hintIndex + 1) % hints.length;
      setInitialLoadingHint(hints[hintIndex]);
    }, 2200);

    let revealTimer: number | undefined;
    const progressTimer = window.setInterval(() => {
      displayed = Math.min(100, displayed + (displayed < 88 ? 2 : 1));
      setInitialLoadingProgress(displayed);
      if (displayed >= 100) {
        window.clearInterval(progressTimer);
        revealTimer = window.setTimeout(() => setInitialLoadComplete(true), 350);
      }
    }, 70);

    return () => {
      window.clearInterval(progressTimer);
      window.clearInterval(hintTimer);
      if (revealTimer !== undefined) window.clearTimeout(revealTimer);
    };
  }, [localDataset, latestRangeReady, initialLoadComplete]);

  useEffect(() => {
    // On a brand-new browser there may be no cached latest-data range yet.
    // Resolve the latest imported SAP month before starting the first local
    // dataset render so the Dashboard cannot open on an empty current month
    // and paint all KPIs as zero. Refreshes already have this range cached,
    // which is why the bug was mainly visible on first load.
    if (latestRangeReady) return;
    void syncDashboardToLatestImportedMonth(false).finally(() => setLatestRangeReady(true));
  }, [latestRangeReady]);

  useEffect(() => {
    if (!latestRangeReady || (!dateFrom && !dateTo)) return;
    void preloadDashboardLocalDataset(dateFrom, dateTo).catch(() => {});
  }, [latestRangeReady, dateFrom, dateTo]);

  useEffect(() => {
    const cached = getCachedDashboardDriverDirectory();
    if (cached.length) setDriverDirectory(cached as DriverDirectoryEntry[]);
    void getDrivers<DriverDirectoryEntry>().then((rows) => setDriverDirectory(rows || [])).catch(() => {});
  }, []);

  useEffect(() => {
    // The Dashboard now derives all slicer options from the same local dataset
    // used by the analytics tabs. This makes the lists month-aware and keeps
    // selections that have no rows from ever producing a zero-result surprise.
    if (!localDataset || localDataset.key !== "ALL") return;
    const opts = getLocalFilterOptions(localDataset, globalFilters);
    setVehicleTypeOptions(opts.vehicle_types);
    setFilterOptions({ divisions: opts.divisions, facility_types: opts.facility_types, salesmen: opts.salesmen, areas: opts.areas, drivers: opts.drivers });
    // Do NOT prune selected drivers when option availability is recalculated.
    // A selected slicer value must remain selected even if another active
    // slicer temporarily makes that driver unavailable. Pruning here was the
    // source of the order-dependent A=0 / A+B=works / A+B+C=works behavior.
  }, [localDataset, dateFrom, dateTo, selDrivers, selAreas, selDivisions, selFacilityTypes, selSalesmen, selVehicleTypes]);

  useOperationalRealtime("dashboard-live-master-data", ["import_batches", "sap_invoice_facts", "vehicles", "drivers", "areas", "consumer_salesmen"], () => {
    void preloadDashboardLocalDataset(dateFrom, dateTo, true).catch(() => {});
    void syncDashboardToLatestImportedMonth(false);
    triggerDashboardRefresh();
  });

  // Do NOT fire every heavy dashboard RPC when filters change. The previous
  // warm-up launched Driver Performance + Lead Time + Order Summary (and the
  // other analytics) simultaneously, which made PostgreSQL compete for CPU
  // and caused statement timeouts on larger datasets. Each tab now loads only
  // when it is actually needed; the shared cache still makes revisits fast.

  async function handleExport(view: DashboardExportView = "full") {
    setExportError("");
    setExportProgress({ pct: 5, status: "preparing", message: "Preparing Excel export…" });
    const params = new URLSearchParams(dashboardFilterParams(driver, globalFilters));
    try {
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const names: Record<DashboardExportView, string> = {
        full: `DispatchOPS_Full_Dashboard_${stamp}.xlsx`,
        dashboard: `DispatchOPS_KPI_Summary_${stamp}.xlsx`,
        driverperf: `DispatchOPS_Driver_Performance_${stamp}.xlsx`,
        leadtime: `DispatchOPS_Lead_Time_${stamp}.xlsx`,
        order: `DispatchOPS_Order_Summary_${stamp}.xlsx`,
        area: `DispatchOPS_Area_Analytics_${stamp}.xlsx`,
        notsupplied: `DispatchOPS_Not_Supplied_${stamp}.xlsx`,
      };
      if (view === "full") await exportDashboardExcel(params, names[view], setExportProgress);
      else await exportDashboardView(view, params, names[view], setExportProgress);
    } catch (e: any) {
      setExportError(e.message);
      setExportProgress({ pct: 100, status: "error", message: e.message });
    }
  }

  return (
    <div className="page dashboard-page">
      <GlassHeader
        eyebrow="Dispatch Operations"
        title="Dashboard"
        actions={
          <div className="flex items-center gap-2">
            <div ref={exportTriggerRef} className="relative">
              <GlassButton variant="primary" size="sm" onClick={() => {
                setExportMenuOpen((v) => !v);
                const rect = exportTriggerRef.current?.getBoundingClientRect();
                if (rect) setExportMenuPos({ left: Math.max(8, rect.right - 250), top: rect.bottom + 8 });
              }}>
                <Download className="h-4 w-4" />
                Export to Excel
                <ChevronDown className="h-3.5 w-3.5" />
              </GlassButton>
              {exportMenuOpen && exportMenuPos && createPortal(
                <div ref={exportMenuRef} className="dashboard-export-menu" style={{ position: "fixed", left: exportMenuPos.left, top: exportMenuPos.top, width: 250, zIndex: 100000, boxShadow: "0 18px 50px rgba(0,0,0,.35)" }}>
                  {[
                    ["full", "Full Dashboard Export", Download],
                    ["dashboard", "KPI Summary", BarChart3],
                    ["driverperf", "Driver Performance", FileSpreadsheet],
                    ["leadtime", "Lead Time Analytics", Timer],
                    ["order", "Order Summary", Package],
                    ["area", "Area Analytics", Map],
                    ["notsupplied", "Not Supplied", AlertTriangle],
                  ].map(([key, label, Icon]) => {
                    const I = Icon as any;
                    return <button key={String(key)} type="button" onClick={() => { setExportMenuOpen(false); handleExport(key as DashboardExportView); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-ink hover:bg-[var(--row-hover)] hover:text-[var(--teal)]">
                      <I className="h-3.5 w-3.5" /> {String(label)}
                    </button>;
                  })}
                </div>,
                document.body
              )}
            </div>
            {exportError && (
              <span style={{ fontSize: 12, color: "var(--red)" }}>{exportError}</span>
            )}
          </div>
        }
      />
      <div style={{ marginBottom: 14 }}><ExportStatus state={exportProgress} onClose={() => { setExportProgress(null); setExportError(""); }} /></div>

      <GlassFilterBar className="mb-3">
        <MultiSelectSlicer icon={Building2} label="Division" options={filterOptions.divisions} selected={selDivisions} onChange={setSelDivisions} />
        <MultiSelectSlicer icon={Warehouse} label="Facility Type" options={filterOptions.facility_types} selected={selFacilityTypes} onChange={setSelFacilityTypes} />
        <MultiSelectSlicer icon={MapPin} label="Area" options={filterOptions.areas} selected={selAreas} onChange={setSelAreas} />
        <MultiSelectSlicer icon={Truck} label="Vehicle Type" options={vehicleTypeOptions} selected={selVehicleTypes} onChange={setSelVehicleTypes} />
        <MultiSelectSlicer icon={Briefcase} label="Salesman" options={filterOptions.salesmen} selected={selSalesmen} onChange={setSelSalesmen} />
        <div className="flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5 text-muted" />
          <GlassInput type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="From date" className="w-auto" />
          <GlassInput type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="To date" className="w-auto" />
        </div>
      </GlassFilterBar>

      {/*
        DRIVER SLICER (focused addition): Excel/Power-BI-style horizontal
        button row, immediately below the existing filter bar as
        requested. Replaces the old dropdown-style Driver MultiSelectSlicer
        that used to be the first item in GlassFilterBar above - same
        `selDrivers`/`setSelDrivers` state, same `filterOptions.drivers`
        (Fleet-Database-restricted) option list, so nothing about the
        underlying filtering pipeline changed, only how this one filter is
        edited. See DriverSlicerBar.tsx for the full rationale.
      */}
      <DriverSlicerBar
        options={filterOptions.drivers}
        selected={selDrivers}
        onChange={setSelDrivers}
        driverDirectory={driverDirectory}
      />

      <div className="mt-5" />

      <DashboardTabs tabs={TABS} active={tab} onChange={selectTab} />

      {tab === "home" && <HomeTab driver={driver} onSelectDriver={(name) => { setDriver(name); setSelDrivers([]); }} onDriverListLoaded={setDriverList} globalFilters={globalFilters} />}
      {tab === "driver-performance" && <DriverPerformanceTab driver={driver} globalFilters={globalFilters} />}
      {tab === "lead-time" && <LeadTimeTab driver={driver} globalFilters={globalFilters} setLeadTimeBand={setSelLeadTimeBand} setClassification={setSelClassification} />}
      {tab === "order-summary" && <OrderSummaryTab driver={driver} globalFilters={globalFilters} />}
      {tab === "area-analytics" && <AreaAnalyticsTab driver={driver} globalFilters={globalFilters} />}
      {tab === "not-supplied" && <NotSuppliedTab driver={driver} globalFilters={globalFilters} />}

      {(!localDataset || !latestRangeReady || !initialLoadComplete) && (
        <DashboardInitialLoadingOverlay progress={initialLoadingProgress} hint={initialLoadingHint} />
      )}
    </div>
  );
}

function DashboardInitialLoadingOverlay({ progress, hint }: { progress: number; hint: string }) {
  const safeProgress = Math.max(0, Math.min(100, Math.round(progress)));
  const [dots, setDots] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setDots((v) => (v + 1) % 4), 420);
    return () => window.clearInterval(id);
  }, []);

  const stage = safeProgress < 72
    ? "Preparing your data"
    : safeProgress < 88
      ? "Building your dashboard"
      : safeProgress < 100
        ? "Finalizing your workspace"
        : "Ready";

  return (
    <div className="dashboard-initial-loading" aria-live="polite" aria-busy="true">
      <div className="dashboard-loading-scrim" />

      <div className="dashboard-loading-card">
        <div className="dashboard-loading-brand">
          <div className="dashboard-loading-logo">D</div>
          <div>
            <div className="dashboard-loading-title">DispatchOPS</div>
            <div className="dashboard-loading-subtitle">Dashboard</div>
          </div>
          <div className="dashboard-loading-live"><span /> LIVE</div>
        </div>

        <div className="dashboard-loading-status">
          <div>
            <strong>{stage}</strong>
            <span>We’re loading, hang on{".".repeat(dots)}</span>
          </div>
          <b>{safeProgress}%</b>
        </div>

        <div className="dashboard-loading-progress-track">
          <div className="dashboard-loading-progress-fill" style={{ width: `${safeProgress}%` }}>
            <span className="dashboard-loading-progress-glow" />
          </div>
        </div>

        <div className="dashboard-loading-activity">
          <span className="dashboard-loading-dot" />
          <span className="dashboard-loading-dot" />
          <span className="dashboard-loading-dot" />
          <span className="dashboard-loading-activity-label">Loading dashboard data securely</span>
        </div>

        <div className="dashboard-loading-hint">{hint}</div>
      </div>
    </div>
  );
}
