/**
 * pages/NotSuppliedTab.tsx
 * Round -12: refactored to compose widgets/notSuppliedWidgets.tsx.
 */
import { GlobalFilters } from "../types/dashboardFilters";
import { useNotSuppliedData, NotSuppliedTable, ZeroBoxTable } from "../widgets/notSuppliedWidgets";

export default function NotSuppliedTab({ driver, globalFilters }: { driver: string; globalFilters?: GlobalFilters }) {
  const { data, error } = useNotSuppliedData(driver, globalFilters);
  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data) return <div className="glass-card text-muted">Loading...</div>;
  return (
    <div className="dashboard-tab-content">
      <div className="dashboard-section-gap"><NotSuppliedTable data={data} /></div>
      <ZeroBoxTable data={data} />
    </div>
  );
}
