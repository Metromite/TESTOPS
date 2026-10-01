/**
 * pages/AreaAnalyticsTab.tsx
 * Round -12: refactored to compose widgets/areaAnalyticsWidgets.tsx.
 */
import { GlobalFilters } from "../types/dashboardFilters";
import { useAreaAnalyticsData, OrdersByAreaChart, ByAreaTable, WeeklyByAreaTable } from "../widgets/areaAnalyticsWidgets";

export default function AreaAnalyticsTab({ driver, globalFilters }: { driver: string; globalFilters?: GlobalFilters }) {
  const { data, error } = useAreaAnalyticsData(driver, globalFilters);
  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data) return <div>Loading...</div>;
  return (
    <div>
      <div style={{ marginBottom: 20 }}><OrdersByAreaChart data={data} /></div>
      <div style={{ marginBottom: 20 }}><ByAreaTable data={data} /></div>
      <WeeklyByAreaTable data={data} />
    </div>
  );
}
