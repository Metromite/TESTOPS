/**
 * pages/AreaAnalyticsTab.tsx
 * Round -12: refactored to compose widgets/areaAnalyticsWidgets.tsx.
 */
import { GlobalFilters } from "../types/dashboardFilters";
import { useAreaAnalyticsData, OrdersByAreaChart, ByAreaTable, WeeklyByAreaTable } from "../widgets/areaAnalyticsWidgets";

export default function AreaAnalyticsTab({ driver, globalFilters }: { driver: string; globalFilters?: GlobalFilters }) {
  const { data, error } = useAreaAnalyticsData(driver, globalFilters);
  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data) return <div className="glass-card text-muted">Loading...</div>;
  return (
    <div className="dashboard-tab-content">
      <div className="dashboard-section-gap"><OrdersByAreaChart data={data} /></div>
      <div className="dashboard-section-gap"><ByAreaTable data={data} /></div>
      <WeeklyByAreaTable data={data} />
    </div>
  );
}
