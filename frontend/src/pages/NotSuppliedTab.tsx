/**
 * pages/NotSuppliedTab.tsx
 * Round -12: refactored to compose widgets/notSuppliedWidgets.tsx.
 */
import { GlobalFilters } from "../types/dashboardFilters";
import { useNotSuppliedData, NotSuppliedTable, ZeroBoxTable } from "../widgets/notSuppliedWidgets";

export default function NotSuppliedTab({ driver, globalFilters }: { driver: string; globalFilters?: GlobalFilters }) {
  const { data, error } = useNotSuppliedData(driver, globalFilters);
  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data) return <div>Loading...</div>;
  return (
    <div>
      <div style={{ marginBottom: 20 }}><NotSuppliedTable data={data} /></div>
      <ZeroBoxTable data={data} />
    </div>
  );
}
