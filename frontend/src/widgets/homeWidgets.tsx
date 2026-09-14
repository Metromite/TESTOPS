/**
 * widgets/homeWidgets.tsx
 * -------------------------
 * Round -12: atomic widgets extracted from HomeTab.tsx (the Overview page),
 * without changing any calculation. Every number/chart/table here comes
 * from the exact same `/dashboard/home` response, fetched by the exact
 * same hooks/useHomeData.ts hook that was inlined in HomeTab.tsx before
 * this round - the fetch/param/validation logic was moved, not rewritten.
 *
 * Two layers, so composing these on the real Dashboard page doesn't cause
 * redundant fetches:
 *   - Presentational components (KpiTile, the 4 *Chart components, the
 *     Driver Overview table) take already-fetched `data` as a prop and do
 *     no fetching of their own. HomeTab.tsx (refactored this round) uses
 *     these directly, sharing its ONE top-level useHomeData() call - same
 *     as before this round, just composed from named pieces instead of
 *     one large inline JSX tree.
 *   - Standalone widgets (the *Standalone components, and the 12
 *     HOME_KPI_DEFS-driven single-KPI cards) each call useHomeData() on
 *     their own. These are what Control Center's widget library actually
 *     adds as cards - each one is a fully independent unit, matching how
 *     the existing "whole page" cards already worked (self-contained,
 *     `driver=""` default). REAL, FLAGGED LIMITATION: dropping several of
 *     these on the same canvas means several independent fetches of
 *     `/dashboard/home` (one per widget, each on its own 30s poll) - there
 *     is no shared cross-card cache. Solving that is a separate,
 *     legitimate follow-up (e.g. a page-level query cache/context), not
 *     attempted this round.
 *
 * PHASE 5-6 REDESIGN NOTE: visuals only. Every exported function name and
 * prop shape below is unchanged from before - registry.tsx, HomeTab.tsx,
 * and Control Center all still import these exact same names. Only the
 * JSX/CSS internals moved from raw `.glass-card`/`.kpi-card`/`.data-table`
 * markup onto the Glass* design system + shared Recharts chart theme.
 */
import { useState } from "react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import { motion } from "framer-motion";
import { useHomeData, HomeDashboard, METRIC_COLUMNS, DEFAULT_COLUMNS } from "../hooks/useHomeData";
import DetailWindow from "../components/DetailWindow";
import AvailabilityWidget from "../components/AvailabilityWidget";
import { GlobalFilters } from "../types/dashboardFilters";
import { GlassCard } from "../design-system/GlassCard";
import { GlassPanel } from "../design-system/GlassPanel";
import { GlassTable } from "../design-system/GlassTable";
import { GlassBadge } from "../design-system/GlassBadge";
import { CHART_PALETTE, chartGrid, chartAxisTick, chartAxisLine, GlassTooltip } from "../design-system/chartTheme";
import { fadeUp } from "../design-system/motion";

export const HOME_KPI_DEFS: { key: string; icon: string; label: string; getValue: (k: HomeDashboard["kpis"]) => string | number; metric?: string }[] = [
  { key: "valid_invoices", icon: "📋", label: "Valid Invoices", getValue: (k) => k.valid_invoices.toLocaleString(), metric: "valid_invoices" },
  { key: "total_boxes", icon: "📦", label: "Total Boxes", getValue: (k) => k.total_boxes.toLocaleString(), metric: "valid_invoices" },
  { key: "freezer_boxes", icon: "❄️", label: "Freezer Boxes", getValue: (k) => k.freezer_boxes.toLocaleString(), metric: "freezer_boxes" },
  { key: "active_drivers", icon: "🚚", label: "Active Drivers", getValue: (k) => k.active_drivers, metric: "active_drivers" },
  { key: "avg_boxes_per_driver", icon: "📊", label: "Avg Boxes / Driver", getValue: (k) => k.avg_boxes_per_driver, metric: "active_drivers" },
  { key: "not_supplied", icon: "⚠️", label: "Not Supplied", getValue: (k) => k.not_supplied, metric: "not_supplied" },
  { key: "avg_lead_time_days", icon: "📅", label: "Avg Lead Time (Days)", getValue: (k) => k.avg_lead_time_days ?? "N/A", metric: "valid_invoices" },
  { key: "unique_customers", icon: "🏪", label: "Unique Customers", getValue: (k) => k.unique_customers, metric: "unique_customers" },
  { key: "avg_route_hours", icon: "⏱️", label: "Avg Route Hours", getValue: (k) => k.avg_route_hours ?? "N/A" },
  { key: "orders_per_driver", icon: "🏆", label: "Orders / Driver", getValue: (k) => k.orders_per_driver, metric: "active_drivers" },
  { key: "active_vehicles", icon: "🚗", label: "Active Vehicles", getValue: (k) => k.active_vehicles, metric: "active_vehicles" },
  { key: "normal_boxes", icon: "📦", label: "Normal Boxes", getValue: (k) => k.normal_boxes.toLocaleString(), metric: "normal_boxes" },
];

export function KpiTile({ icon, label, value, onClick }: { icon: string; label: string; value: string | number; onClick?: () => void }) {
  return (
    <motion.div {...fadeUp}>
      <GlassCard
        interactive={!!onClick}
        onClick={onClick}
        padding="md"
        className="flex flex-col gap-2 text-left"
        title={onClick ? "Click for details" : undefined}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--navy3)] text-[16px]">{icon}</span>
        <span className="font-mono text-[26px] font-bold leading-none tabular-nums text-[var(--teal)]">{value}</span>
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      </GlassCard>
    </motion.div>
  );
}

function pctTooltipFormatter(data: { name: string; value: number }[]) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (value: number, name: string): [string, string] => [`${value} (${total ? Math.round((value / total) * 100) : 0}%)`, name];
}
const renderPctLabel = ({ percent }: { percent: number }) => (percent >= 0.04 ? `${Math.round(percent * 100)}%` : "");

export function BoxesByDriverChart({ data, onBarClick }: { data: HomeDashboard; onBarClick?: (driverName: string) => void }) {
  const driverBoxesData = data.charts.driver_boxes.labels.map((l, i) => ({ name: l, boxes: data.charts.driver_boxes.values[i] }));
  return (
    <GlassPanel title="📦 Boxes by Driver">
      <ResponsiveContainer width="100%" height={Math.max(280, driverBoxesData.length * 30)}>
        <BarChart data={driverBoxesData} layout="vertical" margin={{ left: 10, right: 20 }}>
          <CartesianGrid {...chartGrid} />
          <XAxis type="number" tick={chartAxisTick} axisLine={chartAxisLine} tickLine={false} />
          <YAxis type="category" dataKey="name" tick={chartAxisTick} axisLine={chartAxisLine} tickLine={false} width={140} interval={0} />
          <Tooltip content={<GlassTooltip />} cursor={{ fill: "var(--row-hover)" }} />
          <Bar dataKey="boxes" fill={CHART_PALETTE[0]} radius={[0, 4, 4, 0]} barSize={16} cursor={onBarClick ? "pointer" : undefined}
            onClick={onBarClick ? (d: any) => onBarClick(d.name) : undefined} />
        </BarChart>
      </ResponsiveContainer>
    </GlassPanel>
  );
}
export function FacilityDistributionChart({ data }: { data: HomeDashboard }) {
  const facilityData = data.charts.facility.labels.map((l, i) => ({ name: l, value: data.charts.facility.values[i] }));
  return (
    <GlassPanel title="🏪 Facility Distribution">
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          {/*
            ITEM PASS 5 (chart labels overlapping, e.g. "Government"):
            Facility Type can have many distinct categories (Pharma,
            Government, Hospital, Clinic, Consumer, ...), unlike the
            fixed 2-slice Returns chart below - at outerRadius=90 with
            several thin adjacent slices, Recharts' default inline
            percent-label placement crowded/overlapped neighboring
            labels (the reported "Government" case). Per the spec's own
            guidance for this exact situation ("if too many categories
            for readable labels, move labels to an external legend, use
            tooltip on hover, do not force text into the pie") - dropped
            the inline `label`/`labelLine` here specifically and rely on
            the Legend (already present below) + GlassTooltip (already
            present) instead, which can never overlap each other or a
            slice. No data/calculation changed - `facilityData` itself,
            the Cell colors, and the Legend/Tooltip are all identical to
            before.
          */}
          <Pie data={facilityData} dataKey="value" nameKey="name" outerRadius={90}>
            {facilityData.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} stroke="var(--navy2)" strokeWidth={2} />)}
          </Pie>
          <Tooltip content={<GlassTooltip formatter={pctTooltipFormatter(facilityData) as any} />} />
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} />
        </PieChart>
      </ResponsiveContainer>
    </GlassPanel>
  );
}
export function VehicleTypeChart({ data }: { data: HomeDashboard }) {
  const vantypeData = data.charts.vantype.labels.map((l, i) => ({ name: l, Normal: data.charts.vantype.normal[i], Freezer: data.charts.vantype.freezer[i] }));
  return (
    <GlassPanel title="🚗 Units by Vehicle Type">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={vantypeData}>
          <CartesianGrid {...chartGrid} />
          <XAxis dataKey="name" tick={chartAxisTick} axisLine={chartAxisLine} tickLine={false} />
          <YAxis tick={chartAxisTick} axisLine={chartAxisLine} tickLine={false} />
          <Tooltip content={<GlassTooltip />} cursor={{ fill: "var(--row-hover)" }} />
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} />
          <Bar dataKey="Normal" stackId="a" fill={CHART_PALETTE[1]} radius={[0, 0, 0, 0]} />
          <Bar dataKey="Freezer" stackId="a" fill={CHART_PALETTE[0]} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </GlassPanel>
  );
}
export function ReturnsChart({ data }: { data: HomeDashboard }) {
  const returnsData = [{ name: "Delivered", value: data.charts.returns.delivered }, { name: "Not Supplied", value: data.charts.returns.not_supplied }];
  return (
    <GlassPanel title="✅ Delivered vs Not Supplied">
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={returnsData} dataKey="value" nameKey="name" outerRadius={90} label={renderPctLabel} labelLine>
            <Cell fill="var(--green)" stroke="var(--navy2)" strokeWidth={2} />
            <Cell fill="var(--red)" stroke="var(--navy2)" strokeWidth={2} />
          </Pie>
          <Tooltip content={<GlassTooltip formatter={pctTooltipFormatter(returnsData) as any} />} />
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} />
        </PieChart>
      </ResponsiveContainer>
    </GlassPanel>
  );
}
export function DriverOverviewTable({ data, driver, onSelectDriver }: { data: HomeDashboard; driver: string; onSelectDriver: (name: string) => void }) {
  return (
    <GlassPanel title="Driver Overview" bodyClassName="-mx-1">
      <GlassTable.Wrap>
        <GlassTable.Root>
          <GlassTable.Header>
            <tr>
              <GlassTable.Th>Driver</GlassTable.Th><GlassTable.Th>Vehicle</GlassTable.Th><GlassTable.Th>Type</GlassTable.Th>
              <GlassTable.Th>Orders</GlassTable.Th><GlassTable.Th>Boxes</GlassTable.Th><GlassTable.Th>Freezer</GlassTable.Th><GlassTable.Th>Not Sup.</GlassTable.Th>
            </tr>
          </GlassTable.Header>
          <GlassTable.Body>
            {data.driver_overview.map((d) => (
              <tr key={d.driver_name} className={d.not_supplied > 0 ? "bg-[color-mix(in_srgb,var(--red)_7%,transparent)]" : undefined}>
                <GlassTable.Td>
                  <button
                    onClick={() => onSelectDriver(driver === d.driver_name ? "" : d.driver_name)}
                    className={
                      "bg-transparent border-0 cursor-pointer p-0 font-bold underline decoration-edge underline-offset-2 " +
                      (driver === d.driver_name ? "text-[var(--teal)]" : "text-ink")
                    }
                    title="Click to filter the whole dashboard by this driver"
                  >
                    {d.driver_name}
                  </button>
                </GlassTable.Td>
                <GlassTable.Td>{d.vehicle_num}</GlassTable.Td><GlassTable.Td>{d.vehicle_type}</GlassTable.Td>
                <GlassTable.Td className="font-mono tabular-nums">{d.orders}</GlassTable.Td>
                <GlassTable.Td className="font-mono tabular-nums">{d.boxes}</GlassTable.Td>
                <GlassTable.Td className="font-mono tabular-nums">{d.freezer}</GlassTable.Td>
                <GlassTable.Td>{d.not_supplied > 0 ? <GlassBadge tone="danger">{d.not_supplied}</GlassBadge> : <span className="font-mono tabular-nums">0</span>}</GlassTable.Td>
              </tr>
            ))}
          </GlassTable.Body>
        </GlassTable.Root>
      </GlassTable.Wrap>
    </GlassPanel>
  );
}

// ---- standalone (self-fetching) versions, for Control Center's widget library ----
function useStandaloneHome(driver: string, globalFilters?: GlobalFilters) {
  return useHomeData(driver, globalFilters);
}

function DrillDownModal({ hook }: { hook: ReturnType<typeof useHomeData> }) {
  if (!hook.detailMetric) return null;
  return (
    <DetailWindow
      title={hook.detailTitle}
      columns={METRIC_COLUMNS[hook.detailMetric] || DEFAULT_COLUMNS}
      rows={hook.detailRows}
      loading={hook.detailLoading}
      truncated={hook.detailTruncated}
      totalMatching={hook.detailTotal}
      onClose={hook.closeDetail}
    />
  );
}

export function StandaloneHomeKpiWidget({ metricKey, driver = "", globalFilters }: { metricKey: string; driver?: string; globalFilters?: GlobalFilters }) {
  const hook = useStandaloneHome(driver, globalFilters);
  const { data, error, openDetail } = hook;
  const def = HOME_KPI_DEFS.find((d) => d.key === metricKey);
  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data || !def) return <div>Loading...</div>;
  return (
    <>
      <KpiTile icon={def.icon} label={def.label} value={def.getValue(data.kpis)} onClick={def.metric ? () => openDetail(def.metric!, def.label) : undefined} />
      <DrillDownModal hook={hook} />
    </>
  );
}
export function StandaloneAvailabilityWidget() { return <AvailabilityWidget />; }
export function StandaloneBoxesByDriverChart({ driver = "", globalFilters }: { driver?: string; globalFilters?: GlobalFilters }) {
  const hook = useStandaloneHome(driver, globalFilters);
  const { data, error, openDetail } = hook;
  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data) return <div>Loading...</div>;
  return (
    <>
      <BoxesByDriverChart data={data} onBarClick={(name) => openDetail("valid_invoices", `Invoices — ${name}`, name)} />
      <DrillDownModal hook={hook} />
    </>
  );
}
export function StandaloneFacilityDistributionChart({ driver = "", globalFilters }: { driver?: string; globalFilters?: GlobalFilters }) {
  const { data, error } = useStandaloneHome(driver, globalFilters);
  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data) return <div>Loading...</div>;
  return <FacilityDistributionChart data={data} />;
}
export function StandaloneVehicleTypeChart({ driver = "", globalFilters }: { driver?: string; globalFilters?: GlobalFilters }) {
  const { data, error } = useStandaloneHome(driver, globalFilters);
  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data) return <div>Loading...</div>;
  return <VehicleTypeChart data={data} />;
}
export function StandaloneReturnsChart({ driver = "", globalFilters }: { driver?: string; globalFilters?: GlobalFilters }) {
  const { data, error } = useStandaloneHome(driver, globalFilters);
  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data) return <div>Loading...</div>;
  return <ReturnsChart data={data} />;
}
export function StandaloneDriverOverviewTable({ driver = "", globalFilters }: { driver?: string; globalFilters?: GlobalFilters }) {
  const [selfDriver, setSelfDriver] = useState(driver);
  const { data, error } = useStandaloneHome(selfDriver, globalFilters);
  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data) return <div>Loading...</div>;
  return <DriverOverviewTable data={data} driver={selfDriver} onSelectDriver={setSelfDriver} />;
}
export { METRIC_COLUMNS, DEFAULT_COLUMNS, DetailWindow };
