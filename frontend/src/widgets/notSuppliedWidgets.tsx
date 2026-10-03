/**
 * Not Supplied dashboard widget.
 * Rows are intentionally grouped by driver and collapsed by default so the
 * page paints a compact driver list first instead of rendering every line.
 */
import React, { useMemo, useState } from "react";
import DetailWindow from "../components/DetailWindow";
import { useDashboardLocalData } from "../hooks/useDashboardLocalData";
import { GlobalFilters } from "../types/dashboardFilters";

export interface NsRow { driver_name: string; customer_name: string; facility_type: string; reason: string; boxes: number; invoice_date: string; dispatch_date?: string; invoice_no?: string; }
export interface ZeroRow { driver_name: string; customer_name: string; invoice_date: string; dispatch_date: string; }
export interface NotSuppliedData { not_supplied: NsRow[]; zero_box_excluded_from_kpis: ZeroRow[]; driver_summary: { driver_name: string; total_orders: number; delivered: number; not_supplied: number }[]; }

export function useNotSuppliedData(driver: string, globalFilters?: GlobalFilters) {
  return useDashboardLocalData<NotSuppliedData>("/dashboard/not-supplied", globalFilters, driver);
}

export function NotSuppliedTable({ data }: { data: NotSuppliedData }) {
  const [detailDriver, setDetailDriver] = useState<string | null>(null);
  const detailRows = useMemo(() => {
    if (!detailDriver) return [];
    return data.not_supplied
      .filter((row) => (row.driver_name || "Unknown") === detailDriver)
      .map((row) => ({
        "Invoice No": row.invoice_no || "",
        Customer: row.customer_name,
        "Facility Type": row.facility_type,
        Reason: row.reason,
        Boxes: row.boxes,
        "Invoice Date": row.invoice_date,
        "Dispatch Date": row.dispatch_date || "",
      }));
  }, [data.not_supplied, detailDriver]);

  const selectedSummary = data.driver_summary.find((row) => row.driver_name === detailDriver);

  return (
    <>
      <div className="glass-card">
        <div className="flex items-center justify-between gap-3">
          <strong>Not Supplied</strong>
          <span className="text-[12px] text-muted">{data.driver_summary.reduce((n,r) => n + r.total_orders, 0).toLocaleString()} orders · {data.not_supplied.length.toLocaleString()} not supplied</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          {data.driver_summary.length === 0 ? (
            <div className="py-6 text-center text-muted">No orders in the current filter.</div>
          ) : (
            <table className="data-table">
              <thead><tr><th>Driver</th><th>Total Orders</th><th>Delivered</th><th>Not Supplied</th></tr></thead>
              <tbody>
                {data.driver_summary.map((row) => (
                  <tr key={row.driver_name} onClick={() => { if (row.not_supplied > 0) setDetailDriver(row.driver_name); }} style={{ cursor: row.not_supplied > 0 ? "pointer" : "default" }} title={row.not_supplied > 0 ? "Open not-supplied order details" : "No not-supplied orders for this driver"}>
                    <td><strong>{row.driver_name}</strong></td>
                    <td>{row.total_orders.toLocaleString()}</td>
                    <td>{row.delivered.toLocaleString()}</td>
                    <td>{row.not_supplied.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {detailDriver && selectedSummary && (
        <DetailWindow
          title={`${detailDriver} — Total ${selectedSummary.total_orders.toLocaleString()} · Delivered ${selectedSummary.delivered.toLocaleString()} · Not Supplied ${selectedSummary.not_supplied.toLocaleString()}`}
          columns={[
            { key: "Invoice No", label: "Invoice" },
            { key: "Customer", label: "Customer" },
            { key: "Facility Type", label: "Facility" },
            { key: "Reason", label: "Reason" },
            { key: "Boxes", label: "Boxes" },
            { key: "Invoice Date", label: "Invoice Date" },
            { key: "Dispatch Date", label: "Dispatch Date" },
          ]}
          rows={detailRows}
          totalMatching={detailRows.length}
          onClose={() => setDetailDriver(null)}
        />
      )}
    </>
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
