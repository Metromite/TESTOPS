/**
 * widgets/orderSummaryWidgets.tsx
 * Round -12: OrderSummaryTab.tsx was already a single cohesive table (no
 * separate KPIs/charts to split out), so this is one atomic widget, not
 * several - the presentational/standalone split still applies so Control
 * Center can add it as its own card without also getting the page shell.
 */
import { useDashboardQuery } from "../hooks/useDashboardQuery";
import { GlobalFilters } from "../types/dashboardFilters";

export interface OrderSummaryData {
  facility_types: string[];
  rows: { driver: string; by_facility: number[]; total: number }[];
  facility_totals: number[];
  grand_total: number;
}
export function useOrderSummaryData(driver: string, globalFilters?: GlobalFilters) {
  return useDashboardQuery<OrderSummaryData>("/dashboard/order-summary", driver, globalFilters);
}
export function OrderSummaryTable({ data }: { data: OrderSummaryData }) {
  return (
    <div className="glass-card" style={{ overflowX: "auto" }}>
      <strong>Orders by Driver &times; Facility Type</strong>
      <table className="data-table" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>Driver</th>
            {data.facility_types.map((f) => <th key={f}>{f}</th>)}
            <th style={{ borderLeft: "2px solid var(--border)", color: "var(--teal)" }}>Total / Driver</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.driver}>
              <td><strong>{r.driver}</strong></td>
              {r.by_facility.map((c, i) => <td key={i}>{c > 0 ? c : "—"}</td>)}
              <td style={{ borderLeft: "2px solid var(--border)" }}><strong style={{ color: "var(--teal)" }}>{r.total}</strong></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td><strong>TOTAL / FACILITY</strong></td>
            {data.facility_totals.map((t, i) => <td key={i}><strong>{t}</strong></td>)}
            <td style={{ borderLeft: "2px solid var(--border)", color: "var(--cyan)" }}><strong>{data.grand_total}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
export function StandaloneOrderSummaryTable({ driver = "", globalFilters }: { driver?: string; globalFilters?: GlobalFilters }) {
  const { data, error } = useOrderSummaryData(driver, globalFilters);
  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data) return <div>Loading...</div>;
  return <OrderSummaryTable data={data} />;
}
