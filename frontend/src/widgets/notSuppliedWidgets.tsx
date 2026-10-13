/**
 * widgets/notSuppliedWidgets.tsx
 * Round -12: atomic widgets extracted from NotSuppliedTab.tsx (2 tables).
 */
import { useDashboardQuery } from "../hooks/useDashboardQuery";
import { GlobalFilters } from "../types/dashboardFilters";

export interface NsRow { driver_name: string; customer_name: string; facility_type: string; reason: string; boxes: number; invoice_date: string; }
export interface ZeroRow { driver_name: string; customer_name: string; invoice_date: string; dispatch_date: string; }
export interface NotSuppliedData { not_supplied: NsRow[]; zero_box_excluded_from_kpis: ZeroRow[]; }

export function useNotSuppliedData(driver: string, globalFilters?: GlobalFilters) {
  return useDashboardQuery<NotSuppliedData>("/dashboard/not-supplied", driver, globalFilters);
}
export function NotSuppliedTable({ data }: { data: NotSuppliedData }) {
  return (
    <div className="glass-card">
      <strong>Not Supplied</strong>
      <table className="data-table" style={{ marginTop: 10 }}>
        <thead><tr><th>Driver</th><th>Customer</th><th>Facility Type</th><th>Supply Description</th><th>Boxes</th><th>Invoice Date</th></tr></thead>
        <tbody>
          {data.not_supplied.length === 0 ? (
            <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No not-supplied lines</td></tr>
          ) : data.not_supplied.map((r, i) => (
            <tr key={i} style={{ background: "rgba(239,68,68,0.08)" }}>
              <td>{r.driver_name}</td><td>{r.customer_name}</td><td>{r.facility_type}</td>
              <td>{r.reason}</td><td>{r.boxes}</td><td>{r.invoice_date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function ZeroBoxTable({ data }: { data: NotSuppliedData }) {
  return (
    <div className="glass-card">
      <strong>Zero Boxes (informational — excluded from KPIs)</strong>
      <table className="data-table" style={{ marginTop: 10 }}>
        <thead><tr><th>Driver</th><th>Customer</th><th>Invoice Date</th><th>Dispatch Date</th><th>Note</th></tr></thead>
        <tbody>
          {data.zero_box_excluded_from_kpis.length === 0 ? (
            <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No zero-box rows</td></tr>
          ) : data.zero_box_excluded_from_kpis.map((r, i) => (
            <tr key={i}>
              <td>{r.driver_name}</td><td>{r.customer_name}</td><td>{r.invoice_date}</td><td>{r.dispatch_date}</td>
              <td style={{ color: "var(--muted)", fontStyle: "italic" }}>Excluded from KPIs</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function withNsData<P extends { data: NotSuppliedData }>(Comp: (p: P) => JSX.Element) {
  return function Standalone({ driver = "", globalFilters }: { driver?: string; globalFilters?: GlobalFilters }) {
    const { data, error } = useNotSuppliedData(driver, globalFilters);
    if (error) return <div className="glass-card error-text">{error}</div>;
    if (!data) return <div>Loading...</div>;
    return <Comp {...({ data } as unknown as P)} />;
  };
}
export const StandaloneNotSuppliedTable = withNsData(NotSuppliedTable);
export const StandaloneZeroBoxTable = withNsData(ZeroBoxTable);
