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
  if (!data) return <div className="dashboard-tab-content">Loading...</div>;

  return (
    <div>
      {data.standalone_mode && (
        <div className="glass-card error-text" style={{ marginBottom: 20 }}>
          STANDALONE MODE: vehicle/driver matching couldn't be validated - SAP and GPS data shown independently.
        </div>
      )}

      <div className="dashboard-kpi-grid">
        {DP_KPI_DEFS.map((def) => <DpKpiTile key={def.key} label={def.label} value={def.getValue(data.kpis)} />)}
      </div>

      <div className="dashboard-chart-grid">
        <StopsPerDriverChart data={data} />
        <RouteDurationChart data={data} />
      </div>

      <RouteDetailTable data={data} />
    </div>
  );
}
