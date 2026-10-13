/**
 * widgets/areaAnalyticsWidgets.tsx
 * Round -12: atomic widgets extracted from AreaAnalyticsTab.tsx.
 */
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useDashboardQuery } from "../hooks/useDashboardQuery";
import { GlobalFilters } from "../types/dashboardFilters";
import { GlassTooltip } from "../design-system/chartTheme";

export interface AreaRow { area: string; orders: number; boxes: number; freezer: number; returns: number; drivers: number; success_pct: number; }
export interface AreaData {
  table: AreaRow[];
  totals: { orders: number; boxes: number; freezer: number; returns: number; drivers: number; success_pct: number };
  area_names: string[];
  weekly_table: { week: string; by_area: number[] }[];
  chart: { labels: string[]; values: number[] };
}
export function useAreaAnalyticsData(driver: string, globalFilters?: GlobalFilters) {
  return useDashboardQuery<AreaData>("/dashboard/area-analytics", driver, globalFilters);
}
export function OrdersByAreaChart({ data }: { data: AreaData }) {
  const chartData = data.chart.labels.map((l, i) => ({ name: l, orders: data.chart.values[i] }));
  return (
    <div className="glass-card">
      <strong>📦 Orders by Area (top 15)</strong>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} layout="vertical">
          <XAxis type="number" tick={{ fontSize: 10 }} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={110} />
          {/* CHART READABILITY FIX: this was the one chart in the app still
              using Recharts' plain default <Tooltip/> (no background
              styling at all) instead of the shared GlassTooltip every
              other chart already used - switched to match, and see
              chartTheme.tsx for the tooltip background opacity bump. */}
          <Tooltip content={<GlassTooltip />} cursor={{ fill: "var(--row-hover)" }} /><Bar dataKey="orders" fill="#00d4a8" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
export function ByAreaTable({ data }: { data: AreaData }) {
  return (
    <div className="glass-card" style={{ overflowX: "auto" }}>
      <strong>By Area</strong>
      <table className="data-table" style={{ marginTop: 10 }}>
        <thead><tr><th>Area</th><th>Orders</th><th>Boxes</th><th>Freezer</th><th>Returns</th><th>Drivers</th><th>Success %</th></tr></thead>
        <tbody>
          {data.table.map((r) => (
            <tr key={r.area}><td>{r.area}</td><td>{r.orders}</td><td>{r.boxes}</td><td>{r.freezer}</td><td>{r.returns}</td><td>{r.drivers}</td><td>{r.success_pct}%</td></tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td><strong>TOTAL</strong></td><td>{data.totals.orders}</td><td>{data.totals.boxes}</td>
            <td>{data.totals.freezer}</td><td>{data.totals.returns}</td><td>{data.totals.drivers}</td>
            <td>{data.totals.success_pct}%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
export function WeeklyByAreaTable({ data }: { data: AreaData }) {
  if (data.weekly_table.length === 0) return null;
  return (
    <div className="glass-card" style={{ overflowX: "auto" }}>
      <strong>Weekly by Area</strong>
      <table className="data-table" style={{ marginTop: 10 }}>
        <thead><tr><th>Week</th>{data.area_names.map((a) => <th key={a}>{a}</th>)}</tr></thead>
        <tbody>
          {data.weekly_table.map((w) => (
            <tr key={w.week}><td>{w.week}</td>{w.by_area.map((c, i) => <td key={i}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function withAreaData<P extends { data: AreaData }>(Comp: (p: P) => JSX.Element | null) {
  return function Standalone({ driver = "", globalFilters, ...rest }: { driver?: string; globalFilters?: GlobalFilters } & Omit<P, "data">) {
    const { data, error } = useAreaAnalyticsData(driver, globalFilters);
    if (error) return <div className="glass-card error-text">{error}</div>;
    if (!data) return <div>Loading...</div>;
    return <Comp {...(rest as unknown as P)} data={data} />;
  };
}
export const StandaloneOrdersByAreaChart = withAreaData(OrdersByAreaChart);
export const StandaloneByAreaTable = withAreaData(ByAreaTable);
export const StandaloneWeeklyByAreaTable = withAreaData(WeeklyByAreaTable);
