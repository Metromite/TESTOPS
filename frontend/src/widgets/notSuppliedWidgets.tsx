/**
 * Not Supplied dashboard widget.
 * Rows are intentionally grouped by driver and collapsed by default so the
 * page paints a compact driver list first instead of rendering every line.
 */
import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useDashboardLocalData } from "../hooks/useDashboardLocalData";
import { GlobalFilters } from "../types/dashboardFilters";

export interface NsRow { driver_name: string; customer_name: string; facility_type: string; reason: string; boxes: number; invoice_date: string; }
export interface ZeroRow { driver_name: string; customer_name: string; invoice_date: string; dispatch_date: string; }
export interface NotSuppliedData { not_supplied: NsRow[]; zero_box_excluded_from_kpis: ZeroRow[]; }

export function useNotSuppliedData(driver: string, globalFilters?: GlobalFilters) {
  return useDashboardLocalData<NotSuppliedData>("/dashboard/not-supplied", globalFilters, driver);
}

export function NotSuppliedTable({ data }: { data: NotSuppliedData }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const map = new Map<string, NsRow[]>();
    for (const row of data.not_supplied) {
      const key = row.driver_name || "Unknown";
      const list = map.get(key) || [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.entries()].sort((a,b) => b[1].length - a[1].length);
  }, [data.not_supplied]);

  function toggle(driverName: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(driverName)) next.delete(driverName); else next.add(driverName);
      return next;
    });
  }

  return (
    <div className="glass-card">
      <div className="flex items-center justify-between gap-3">
        <strong>Not Supplied</strong>
        <span className="text-[12px] text-muted">{data.not_supplied.length.toLocaleString()} lines · {groups.length} drivers</span>
      </div>
      <div className="mt-3 overflow-x-auto">
        {groups.length === 0 ? (
          <div className="py-6 text-center text-muted">No not-supplied lines</div>
        ) : (
          <table className="data-table">
            <thead><tr><th style={{width: "28px"}}></th><th>Driver</th><th>Lines</th><th>Boxes</th></tr></thead>
            <tbody>
              {groups.map(([driverName, rows]) => {
                const isOpen = expanded.has(driverName);
                const boxes = rows.reduce((n,r) => n + Number(r.boxes || 0), 0);
                return (
                  <React.Fragment key={driverName}>
                    <tr onClick={() => toggle(driverName)} style={{cursor:"pointer"}}>
                      <td>{isOpen ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}</td>
                      <td><strong>{driverName}</strong></td><td>{rows.length}</td><td>{boxes}</td>
                    </tr>
                    {isOpen && rows.map((r,i) => (
                      <tr key={`${driverName}-${i}`} style={{ background: "rgba(239,68,68,0.08)" }}>
                        <td></td><td colSpan={1}>{r.customer_name}</td><td>{r.facility_type} · {r.reason}</td><td>{r.boxes} · {r.invoice_date}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
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
