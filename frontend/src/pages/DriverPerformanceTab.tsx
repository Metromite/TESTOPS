/**
 * pages/DriverPerformanceTab.tsx
 * Round -12: refactored to compose widgets/driverPerformanceWidgets.tsx's
 * atomic pieces from one shared useDriverPerformanceData() call - same
 * fetch as before this round, just composed from named pieces.
 */
import { GlobalFilters } from "../types/dashboardFilters";
import {
  useDriverPerformanceData, DP_KPI_DEFS, DpKpiTile,
  StopsPerDriverChart, RouteDurationChart, RouteDetailTable,
} from "../widgets/driverPerformanceWidgets";

export default function DriverPerformanceTab({ driver = "", globalFilters }: { driver?: string; globalFilters?: GlobalFilters }) {
  const { data, error } = useDriverPerformanceData(driver, globalFilters);

  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data) return <div>Loading...</div>;

  // If SAP dispatch data exists but Landmark facts do not, do not render a
  // misleading wall of zero GPS KPIs. Show the real SAP activity and clearly
  // state that stops/route duration require the missing Landmark import.
  const sapOnly = data.route_cards.length === 0 && Number(data.kpis.sap_orders || 0) > 0;
  if (sapOnly) {
    const summary = data.sap_driver_summary || [];
    const fmt = (value: number) => Number(value || 0).toLocaleString();
    return (
      <div>
        <div className="glass-card" style={{ marginBottom: 18, border: "1px solid var(--amber, #d69e36)" }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>SAP dispatch data is available — GPS/Landmark data is missing for this period</div>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-muted, var(--muted))" }}>
            Driver activity below is calculated from the saved SAP invoices. Stops, GPS vehicles and route duration are not shown as zero because no Landmark visit records were found for the selected period.
          </div>
        </div>
        <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, minmax(150px,1fr))", marginBottom: 20 }}>
          <DpKpiTile label="SAP Drivers" value={fmt(summary.length)} />
          <DpKpiTile label="SAP Invoices" value={fmt(data.kpis.sap_orders)} />
          <DpKpiTile label="SAP Boxes" value={fmt(data.kpis.sap_total_boxes)} />
          <DpKpiTile label="SAP Vehicles" value={fmt(data.sap_vehicles || 0)} />
        </div>
        <div className="glass-card" style={{ overflow: "hidden" }}>
          <div style={{ fontWeight: 700, padding: "4px 2px 14px" }}>SAP Dispatch Activity by Driver</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
              <thead><tr>
                {["Driver", "Invoices", "Boxes", "Vehicles", "Dispatch Days"].map((label) => <th key={label} style={{ textAlign: label === "Driver" ? "left" : "right", padding: "10px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-muted, var(--muted))", borderBottom: "1px solid var(--border, #333)" }}>{label}</th>)}
              </tr></thead>
              <tbody>{summary.map((row) => <tr key={row.driver}>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border, #333)", fontWeight: 600 }}>{row.driver}</td>
                {[row.invoices, row.boxes, row.vehicles, row.dispatch_days].map((value, index) => <td key={index} style={{ padding: "10px 12px", borderBottom: "1px solid var(--border, #333)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(value)}</td>)}
              </tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {data.standalone_mode && (
        <div className="glass-card error-text" style={{ marginBottom: 20 }}>
          STANDALONE MODE: vehicle/driver matching couldn't be validated - SAP and GPS data shown independently.
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, minmax(150px,1fr))" }}>
        {DP_KPI_DEFS.map((def) => <DpKpiTile key={def.key} label={def.label} value={def.getValue(data.kpis)} />)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <StopsPerDriverChart data={data} />
        <RouteDurationChart data={data} />
      </div>

      <RouteDetailTable data={data} />
    </div>
  );
}
