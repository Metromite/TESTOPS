import { useEffect, useState } from "react";
import { Download, X, Building2, Warehouse, MapPin, Truck, Route, Briefcase, CalendarDays, RefreshCw, Clock, ChevronDown, FileSpreadsheet, BarChart3, Timer, Package, Map, AlertTriangle } from "lucide-react";
import { getCachedDashboardFilterMeta, getDashboardFilterMeta } from "../services/dashboardKpis";
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
import { supabase } from "../lib/supabase";
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
  const [tab, setTab] = useState("home");
  const [exportError, setExportError] = useState("");
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
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
  // every one multi-select. Options are sourced live: vehicle_types/
  // route_types from /api/meta/options (reference_data.py), everything
  // else (drivers/areas/divisions/facility types/salesmen) from
  // /api/dashboard/filter-options (distinct values actually imported).
  const [selDrivers, setSelDrivers] = useState<string[]>([]);
  const [selAreas, setSelAreas] = useState<string[]>([]);
  const [selDivisions, setSelDivisions] = useState<string[]>([]);
  const [selRouteTypes, setSelRouteTypes] = useState<string[]>([]);
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
  const [dateFrom, setDateFrom] = useState(_monthStart());
  const [dateTo, setDateTo] = useState(_today());
  // FINAL CORRECTION PASS (single source of truth, item 12): promoted out
  // of LeadTimeTab-local state so Dashboard.tsx is the one place that owns
  // every filter, including these two - see dashboardFilters.ts's
  // GlobalFilters doc comment for why.
  const [selLeadTimeBand, setSelLeadTimeBand] = useState("");
  const [selClassification, setSelClassification] = useState("");

  const cachedFilterMeta = getCachedDashboardFilterMeta();
  const [vehicleTypeOptions, setVehicleTypeOptions] = useState<string[]>(
    cachedFilterMeta?.vehicle_types?.length ? cachedFilterMeta.vehicle_types : ["Pick-Up", "Van", "2-8 Van", "2-8 Pick-Up", "Bus"]
  );
  const [routeTypeOptions, setRouteTypeOptions] = useState<string[]>(
    cachedFilterMeta?.route_types?.length ? cachedFilterMeta.route_types : ["Main Route", "Second Trip", "Urgent & Government", "Fleet", "Cold Chain"]
  );
  const [filterOptions, setFilterOptions] = useState<{ divisions: string[]; facility_types: string[]; salesmen: string[]; areas: string[]; drivers: string[] }>(
    cachedFilterMeta ? {
      divisions: cachedFilterMeta.divisions,
      facility_types: cachedFilterMeta.facility_types,
      salesmen: cachedFilterMeta.salesmen,
      areas: cachedFilterMeta.areas,
      drivers: cachedFilterMeta.drivers,
    } : { divisions: [], facility_types: [], salesmen: [], areas: [], drivers: [] }
  );
  // DRIVER SLICER (item 7 - display name): Fleet Database's own
  // code+name directory, fetched once and reused - purely for a richer
  // label on the slicer buttons (e.g. "D040 · Hussain Mohammed" instead
  // of just "D040"). NOT used to decide which drivers are valid - that
  // authoritative restriction already happened server-side in
  // /api/dashboard/filter-options (filterOptions.drivers below), same as
  // before this change. GET /api/drivers already exists (Fleet Database
  // CRUD) - reused as-is, no new endpoint.
  const [driverDirectory, setDriverDirectory] = useState<DriverDirectoryEntry[]>([]);

  const globalFilters = {
    drivers: selDrivers.join(","), areas: selAreas.join(","), division: selDivisions.join(","),
    route_type: selRouteTypes.join(","), vehicle_type: selVehicleTypes.join(","),
    facility_type: selFacilityTypes.join(","), salesman: selSalesmen.join(","),
    start_date: dateFrom, end_date: dateTo,
    lead_time_band: selLeadTimeBand, classification: selClassification,
  };
  const anyGlobalFilterActive = !!(
    selDrivers.length || selAreas.length || selDivisions.length || selRouteTypes.length ||
    selVehicleTypes.length || selFacilityTypes.length || selSalesmen.length || dateFrom || dateTo ||
    selLeadTimeBand || selClassification
  );

  function clearAllFilters() {
    setDriver("");
    setSelDrivers([]); setSelAreas([]); setSelDivisions([]); setSelRouteTypes([]);
    setSelVehicleTypes([]); setSelFacilityTypes([]); setSelSalesmen([]);
    setDateFrom(""); setDateTo("");
    setSelLeadTimeBand(""); setSelClassification("");
  }

  function loadFilterMeta() {
    // Use the last known slicer metadata immediately, then refresh it in the
    // background. This removes the old "page through all SAP rows first"
    // delay while keeping the dropdowns current after imports.
    getDashboardFilterMeta().then((m) => {
      setVehicleTypeOptions(m.vehicle_types);
      setRouteTypeOptions(m.route_types);
      setFilterOptions({
        divisions: m.divisions,
        facility_types: m.facility_types,
        salesmen: m.salesmen,
        areas: m.areas,
        drivers: m.drivers,
      });
    }).catch(() => {});
    getDrivers<DriverDirectoryEntry>().then((rows) => setDriverDirectory(rows || [])).catch(() => {});
  }

  useEffect(() => {
    loadFilterMeta();
    // Pick the latest month with actual SAP data, then scope the initial
    // dashboard query/render to that month only. Never default to all history.
    (async () => {
      try {
        const { data, error } = await supabase
          .from("sap_invoice_facts")
          .select("dispatch_date")
          .not("dispatch_date", "is", null)
          .order("dispatch_date", { ascending: false })
          .limit(1);
        if (error || !data?.[0]?.dispatch_date) return;
        const latest = String(data[0].dispatch_date).slice(0, 10);
        const [year, month] = latest.split("-").map(Number);
        if (!year || !month) return;
        const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        setDateFrom(monthStart);
        setDateTo(monthEnd);
      } catch {
        // Leave the date fields empty if the metadata lookup fails; the
        // existing dashboard remains usable and the user can choose dates.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useOperationalRealtime("dashboard-live-master-data", ["import_batches", "vehicles", "drivers", "areas", "consumer_salesmen"], () => { loadFilterMeta(); triggerDashboardRefresh(); });

  // Do NOT fire every heavy dashboard RPC when filters change. The previous
  // warm-up launched Driver Performance + Lead Time + Order Summary (and the
  // other analytics) simultaneously, which made PostgreSQL compete for CPU
  // and caused statement timeouts on larger datasets. Each tab now loads only
  // when it is actually needed; the shared cache still makes revisits fast.
  // ITEM 1: "Refresh Dashboard" button + optional auto-refresh.
  // Reloads the filter-option lists (drivers/areas/divisions/etc. can
  // change as new data is imported) and, via triggerDashboardRefresh(),
  // every currently-mounted tab's own data - same endpoints/params each
  // tab already uses, just re-run on demand instead of only on filter
  // change. This does not touch the visitedTabs keep-mounted behavior
  // above, so switching tabs is still instant with no refetch.
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefreshMin, setAutoRefreshMin] = useState(0); // 0 = off

  function refreshDashboard() {
    setRefreshing(true);
    loadFilterMeta();
    triggerDashboardRefresh();
    // purely cosmetic - the underlying loads are async and have no shared
    // "done" signal to await, so this just gives the button a brief
    // pressed/spinning state rather than claiming a precise completion time.
    setTimeout(() => setRefreshing(false), 600);
  }

  useEffect(() => {
    if (!autoRefreshMin) return;
    const id = setInterval(refreshDashboard, autoRefreshMin * 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefreshMin]);

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
    <div className="page">
      <GlassHeader
        eyebrow="Dispatch Operations"
        title="Dashboard"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-[12px] text-muted">
              <Clock className="h-3.5 w-3.5" />
              <select
                value={autoRefreshMin}
                onChange={(e) => setAutoRefreshMin(Number(e.target.value))}
                title="Auto-refresh dashboard"
              >
                <option value={0}>Auto-refresh: Off</option>
                <option value={1}>Every 1 min</option>
                <option value={5}>Every 5 min</option>
                <option value={15}>Every 15 min</option>
                <option value={30}>Every 30 min</option>
              </select>
            </div>
            <GlassButton variant="subtle" size="sm" onClick={refreshDashboard} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh Dashboard
            </GlassButton>
            <div className="relative" onMouseLeave={() => setExportMenuOpen(false)}>
              <GlassButton variant="primary" size="sm" onClick={() => { setExportMenuOpen((v) => !v); }}>
                <Download className="h-4 w-4" />
                Export to Excel
                <ChevronDown className="h-3.5 w-3.5" />
              </GlassButton>
              <div className="absolute right-0 top-full z-[300] mt-2 min-w-[250px] rounded-xl border border-[var(--border)] bg-[var(--navy2)] p-1.5 shadow-2xl" style={{ display: exportMenuOpen ? "block" : "none", boxShadow: "0 18px 50px rgba(0,0,0,.35)" }}>
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
              </div>
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
        <MultiSelectSlicer icon={Route} label="Route Type" options={routeTypeOptions} selected={selRouteTypes} onChange={setSelRouteTypes} />
        <MultiSelectSlicer icon={Briefcase} label="Salesman" options={filterOptions.salesmen} selected={selSalesmen} onChange={setSelSalesmen} />
        <div className="flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5 text-muted" />
          <GlassInput type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="From date" className="w-auto" />
          <GlassInput type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="To date" className="w-auto" />
        </div>
        {(driver || anyGlobalFilterActive) && (
          <GlassButton variant="subtle" size="sm" onClick={clearAllFilters}>
            <X className="h-3.5 w-3.5" />
            Clear All Filters
          </GlassButton>
        )}
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
        options={filterOptions.drivers.length ? filterOptions.drivers : driverList}
        selected={selDrivers}
        onChange={setSelDrivers}
        driverDirectory={driverDirectory}
      />

      <div className="mt-5" />

      <DashboardTabs tabs={TABS} active={tab} onChange={selectTab} />

      {tab === "home" && <HomeTab driver={driver} onSelectDriver={setDriver} onDriverListLoaded={setDriverList} globalFilters={globalFilters} />}
      {tab === "driver-performance" && <DriverPerformanceTab driver={driver} globalFilters={globalFilters} />}
      {tab === "lead-time" && <LeadTimeTab driver={driver} globalFilters={globalFilters} setLeadTimeBand={setSelLeadTimeBand} setClassification={setSelClassification} />}
      {tab === "order-summary" && <OrderSummaryTab driver={driver} globalFilters={globalFilters} />}
      {tab === "area-analytics" && <AreaAnalyticsTab driver={driver} globalFilters={globalFilters} />}
      {tab === "not-supplied" && <NotSuppliedTab driver={driver} globalFilters={globalFilters} />}
    </div>
  );
}
