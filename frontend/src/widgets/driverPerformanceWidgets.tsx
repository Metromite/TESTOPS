/**
 * widgets/driverPerformanceWidgets.tsx
 * Round -12: atomic widgets extracted from DriverPerformanceTab.tsx.
 * Same two-layer pattern as homeWidgets.tsx - presentational components
 * (used by the refactored DriverPerformanceTab.tsx, one shared fetch) plus
 * standalone self-fetching versions (used by Control Center's widget
 * library, one fetch each - same redundant-fetch-if-many-on-one-canvas
 * caveat noted in homeWidgets.tsx applies here too).
 *
 * PHASE 11 REDESIGN NOTE: visuals only - every export name/prop is
 * unchanged, internals moved onto the Glass design system + chart theme
 * (same pattern as homeWidgets.tsx from Phase 5-6).
 */
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useState } from "react";
import { Route, Clock3, ChevronDown, ChevronUp } from "lucide-react";
import { useDashboardLocalData } from "../hooks/useDashboardLocalData";
import { GlobalFilters } from "../types/dashboardFilters";
import { GlassCard } from "../design-system/GlassCard";
import { GlassPanel } from "../design-system/GlassPanel";
import { GlassTable } from "../design-system/GlassTable";
import { GlassBadge } from "../design-system/GlassBadge";
import { CHART_PALETTE, chartGrid, chartAxisTick, chartAxisLine, GlassTooltip, ChartPanel, chartBarProps } from "../design-system/chartTheme";

export interface RouteCard {
  vehicle_key: string; vehicle_num: string; vehicle_model: string;
  display_driver: string; match_method: string; match_confidence: string;
  route_start: string; route_end: string; route_duration_hm: string;
  stops: number; avg_stop_hm: string; passthru_count: number;
  sap_orders: { invoices: number; boxes: number; freezer: number } | null;
}
export interface PerfData {
  standalone_mode: boolean;
  validation_results: { level: string; msg: string }[];
  kpis: { gps_vehicles: number; total_gps_stops: number; avg_stops_per_vehicle: number;
           avg_route_duration_hrs: number | null; avg_stop_duration: string; sap_orders: number; sap_total_boxes: number };
  chart_stops: { labels: string[]; values: number[] };
  chart_route_hours: { labels: string[]; values: number[] };
  route_cards: RouteCard[];
}
const methodTone: Record<string, "ok" | "neutral" | "danger"> = { vehicle: "ok", manual: "ok", name: "neutral", none: "danger" };

export function useDriverPerformanceData(driver: string, globalFilters?: GlobalFilters) {
  return useDashboardLocalData<PerfData>("/dashboard/driver-performance", globalFilters, driver);
}

export function DpKpiTile({ label, value }: { label: string; value: string | number }) {
  return (
    <GlassCard padding="md" className="flex flex-col gap-1.5">
      <span className="font-mono text-[26px] font-bold leading-none tabular-nums text-[var(--purple)]">{value}</span>
      <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{label}</span>
    </GlassCard>
  );
}
export const DP_KPI_DEFS: { key: string; label: string; getValue: (k: PerfData["kpis"]) => string | number }[] = [
  { key: "gps_vehicles", label: "GPS Vehicles", getValue: (k) => k.gps_vehicles },
  { key: "total_gps_stops", label: "Total GPS Stops", getValue: (k) => k.total_gps_stops },
  { key: "avg_stops_per_vehicle", label: "Avg Stops / Vehicle", getValue: (k) => k.avg_stops_per_vehicle },
  { key: "avg_route_duration_hrs", label: "Avg Route Hours", getValue: (k) => k.avg_route_duration_hrs ?? "N/A" },
];

export function StopsPerDriverChart({ data }: { data: PerfData }) {
  const [showAll, setShowAll] = useState(false);
  const allRows = data.chart_stops.labels.map((l, i) => ({ name: l, stops: data.chart_stops.values[i] }));
  const visibleRows = showAll ? allRows : allRows.slice(0, 8);
  return (
    <ChartPanel
      title="Stops per Driver"
      icon={Route}
      actions={allRows.length > 8 ? (
        <button type="button" className="dispatch-chart-action" onClick={() => setShowAll((v) => !v)}>
          {showAll ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {showAll ? "Show top 8" : `View all ${allRows.length}`}
        </button>
      ) : undefined}
    >
      <div className={showAll ? "dispatch-chart-expanded" : "dispatch-chart-compact"}>
        <ResponsiveContainer width="100%" height={showAll ? Math.max(300, visibleRows.length * 31) : 286}>
          <BarChart data={visibleRows} layout="vertical" margin={{ left: 10, right: 20 }}>
            <CartesianGrid {...chartGrid} />
            <XAxis type="number" tick={chartAxisTick} axisLine={chartAxisLine} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={chartAxisTick} axisLine={chartAxisLine} tickLine={false} width={140} interval={0} />
            <Tooltip content={<GlassTooltip />} cursor={{ fill: "var(--row-hover)" }} />
            <Bar dataKey="stops" fill={CHART_PALETTE[1]} {...chartBarProps} barSize={16} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartPanel>
  );
}

export function RouteDurationChart({ data }: { data: PerfData }) {
  const [showAll, setShowAll] = useState(false);
  const allRows = data.chart_route_hours.labels.map((l, i) => ({ name: l, hours: data.chart_route_hours.values[i] }));
  const visibleRows = showAll ? allRows : allRows.slice(0, 8);
  return (
    <ChartPanel
      title="Route Duration (hrs)"
      icon={Clock3}
      actions={allRows.length > 8 ? (
        <button type="button" className="dispatch-chart-action" onClick={() => setShowAll((v) => !v)}>
          {showAll ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {showAll ? "Show top 8" : `View all ${allRows.length}`}
        </button>
      ) : undefined}
    >
      <div className={showAll ? "dispatch-chart-expanded" : "dispatch-chart-compact"}>
        <ResponsiveContainer width="100%" height={showAll ? Math.max(300, visibleRows.length * 31) : 286}>
          <BarChart data={visibleRows} layout="vertical" margin={{ left: 10, right: 20 }}>
            <CartesianGrid {...chartGrid} />
            <XAxis type="number" tick={chartAxisTick} axisLine={chartAxisLine} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={chartAxisTick} axisLine={chartAxisLine} tickLine={false} width={140} interval={0} />
            <Tooltip content={<GlassTooltip />} cursor={{ fill: "var(--row-hover)" }} />
            <Bar dataKey="hours" fill={CHART_PALETTE[0]} {...chartBarProps} barSize={16} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartPanel>
  );
}
export function RouteDetailTable({ data }: { data: PerfData }) {
  return (
    <GlassPanel title="Route Detail" bodyClassName="-mx-1">
      <GlassTable.Wrap>
        <GlassTable.Root>
          <GlassTable.Header>
            <tr>
              <GlassTable.Th>Vehicle</GlassTable.Th><GlassTable.Th>Driver</GlassTable.Th><GlassTable.Th>Match</GlassTable.Th>
              <GlassTable.Th>Depot Out</GlassTable.Th><GlassTable.Th>Last Stop</GlassTable.Th><GlassTable.Th>Route Dur.</GlassTable.Th>
              <GlassTable.Th>Stops</GlassTable.Th><GlassTable.Th>Avg Stop</GlassTable.Th><GlassTable.Th>SAP Boxes</GlassTable.Th>
            </tr>
          </GlassTable.Header>
          <GlassTable.Body>
            {data.route_cards.map((r) => (
              <tr key={r.vehicle_key}>
                <GlassTable.Td>{r.vehicle_num}{r.vehicle_model && <span className="text-muted"> ({r.vehicle_model})</span>}</GlassTable.Td>
                <GlassTable.Td>{r.display_driver}</GlassTable.Td>
                <GlassTable.Td><GlassBadge tone={methodTone[r.match_method]}>{r.match_method}</GlassBadge></GlassTable.Td>
                <GlassTable.Td>{r.route_start}</GlassTable.Td><GlassTable.Td>{r.route_end}</GlassTable.Td>
                <GlassTable.Td className="font-mono tabular-nums">{r.route_duration_hm}</GlassTable.Td>
                <GlassTable.Td className="font-mono tabular-nums">{r.stops}</GlassTable.Td>
                <GlassTable.Td className="font-mono tabular-nums">{r.avg_stop_hm}</GlassTable.Td>
                <GlassTable.Td>{r.sap_orders ? `${r.sap_orders.boxes} (${r.sap_orders.invoices} ord.)` : "—"}</GlassTable.Td>
              </tr>
            ))}
          </GlassTable.Body>
        </GlassTable.Root>
      </GlassTable.Wrap>
    </GlassPanel>
  );
}

export function StandaloneDpKpiWidget({ metricKey, driver = "", globalFilters }: { metricKey: string; driver?: string; globalFilters?: GlobalFilters }) {
  const { data, error } = useDriverPerformanceData(driver, globalFilters);
  const def = DP_KPI_DEFS.find((d) => d.key === metricKey);
  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data || !def) return <div>Loading...</div>;
  return <DpKpiTile label={def.label} value={def.getValue(data.kpis)} />;
}
export function StandaloneStopsPerDriverChart({ driver = "", globalFilters }: { driver?: string; globalFilters?: GlobalFilters }) {
  const { data, error } = useDriverPerformanceData(driver, globalFilters);
  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data) return <div>Loading...</div>;
  return <StopsPerDriverChart data={data} />;
}
export function StandaloneRouteDurationChart({ driver = "", globalFilters }: { driver?: string; globalFilters?: GlobalFilters }) {
  const { data, error } = useDriverPerformanceData(driver, globalFilters);
  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data) return <div>Loading...</div>;
  return <RouteDurationChart data={data} />;
}
export function StandaloneRouteDetailTable({ driver = "", globalFilters }: { driver?: string; globalFilters?: GlobalFilters }) {
  const { data, error } = useDriverPerformanceData(driver, globalFilters);
  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data) return <div>Loading...</div>;
  return <RouteDetailTable data={data} />;
}
