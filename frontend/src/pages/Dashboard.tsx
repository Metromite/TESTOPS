import { useEffect, useState } from "react";
import { Download, X, Building2, Warehouse, MapPin, Truck, Route, Briefcase, CalendarDays, RefreshCw, Clock } from "lucide-react";
import { api } from "../api/client";
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
  // PERF FIX (slow tab switching): tabs below used to be conditionally
  // *mounted* (`{tab === "x" && <XTab/>}`), so switching away from a tab
  // unmounted it entirely - switching back mounted it fresh and re-ran
  // its data-fetching effects from scratch every single time, even for a
  // tab you'd already loaded seconds earlier. `visitedTabs` tracks which
  // tabs have been opened at least once; once a tab is in the set it
  // stays mounted (rendered every render) and is just hidden/shown with
  // CSS `display`, so its internal state and fetched data persist across
  // switches - switching back to an already-visited tab is instant, no
  // refetch. Tabs are still lazily mounted on first visit, and no tab's
  // own fetch/render logic changed at all.
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set(["home"]));
  function selectTab(key: string) {
    setTab(key);
    setVisitedTabs((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }
  // Single-driver drill-down (click a row in the Home tab's Driver
  // Overview table) - still used as-is by the tabs that only accept one
  // driver (Lead Time, Order Summary, Area Analytics, Not Supplied).
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
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // FINAL CORRECTION PASS (single source of truth, item 12): promoted out
  // of LeadTimeTab-local state so Dashboard.tsx is the one place that owns
  // every filter, including these two - see dashboardFilters.ts's
  // GlobalFilters doc comment for why.
  const [selLeadTimeBand, setSelLeadTimeBand] = useState("");
  const [selClassification, setSelClassification] = useState("");

  const [vehicleTypeOptions, setVehicleTypeOptions] = useState<string[]>(["Pick-Up", "Van", "2-8 Van", "2-8 Pick-Up", "Bus"]);
  const [routeTypeOptions, setRouteTypeOptions] = useState<string[]>(["Main Route", "Second Trip", "Urgent & Government", "Fleet", "Cold Chain"]);
  const [filterOptions, setFilterOptions] = useState<{ divisions: string[]; facility_types: string[]; salesmen: string[]; areas: string[]; drivers: string[] }>(
    { divisions: [], facility_types: [], salesmen: [], areas: [], drivers: [] }
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
    api.get("/meta/options").then((m) => {
      if (m?.vehicle_types) setVehicleTypeOptions(m.vehicle_types);
      if (m?.route_types) setRouteTypeOptions(m.route_types);
    }).catch(() => {});
    api.get("/dashboard/filter-options").then(setFilterOptions).catch(() => {});
    // item 11 (performance): fetched once here, alongside the other
    // filter-meta calls, not re-fetched on every tab switch or driver
    // click - same "loaded once, reused" rule as filterOptions/
    // vehicleTypeOptions/routeTypeOptions above.
    api.get("/drivers").then((rows: DriverDirectoryEntry[]) => setDriverDirectory(rows || [])).catch(() => {});
  }

  useEffect(() => {
    loadFilterMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function handleExport() {
    // NOTE for when auth is re-enabled: window.open() doesn't attach the
    // Authorization header, since it's a plain browser navigation, not a
    // fetch() call. Works fine while AUTH_DISABLED is on; once auth comes
    // back, switch this to a fetch() + blob download, or a short-lived
    // signed URL, instead of a raw window.open().
    //
    // BUGFIX (export always downloaded the whole month, ignoring every
    // active filter): this used to open the export URL with no query
    // string at all - the export endpoint had no idea Dispatch
    // Date/Driver/Area/Division/etc. were even set on the dashboard.
    // Reuses the exact same `driver` + `globalFilters` this component
    // already passes to every tab (dashboardFilterParams(), same helper
    // every tab's own fetch uses) - not a second/duplicate filter
    // pipeline, just the same params attached to this URL too.
    const params = new URLSearchParams(dashboardFilterParams(driver, globalFilters));
    window.open(`/api/dashboard/export-excel?${params.toString()}`, "_blank");
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
            <GlassButton variant="primary" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4" />
              Export to Excel
            </GlassButton>
          </div>
        }
      />

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

      {visitedTabs.has("home") && <div style={{ display: tab === "home" ? undefined : "none" }}><HomeTab driver={driver} onSelectDriver={setDriver} onDriverListLoaded={setDriverList} globalFilters={globalFilters} /></div>}
      {visitedTabs.has("driver-performance") && <div style={{ display: tab === "driver-performance" ? undefined : "none" }}><DriverPerformanceTab driver={driver} globalFilters={globalFilters} /></div>}
      {visitedTabs.has("lead-time") && <div style={{ display: tab === "lead-time" ? undefined : "none" }}><LeadTimeTab driver={driver} globalFilters={globalFilters} setLeadTimeBand={setSelLeadTimeBand} setClassification={setSelClassification} /></div>}
      {visitedTabs.has("order-summary") && <div style={{ display: tab === "order-summary" ? undefined : "none" }}><OrderSummaryTab driver={driver} globalFilters={globalFilters} /></div>}
      {visitedTabs.has("area-analytics") && <div style={{ display: tab === "area-analytics" ? undefined : "none" }}><AreaAnalyticsTab driver={driver} globalFilters={globalFilters} /></div>}
      {visitedTabs.has("not-supplied") && <div style={{ display: tab === "not-supplied" ? undefined : "none" }}><NotSuppliedTab driver={driver} globalFilters={globalFilters} /></div>}
    </div>
  );
}
