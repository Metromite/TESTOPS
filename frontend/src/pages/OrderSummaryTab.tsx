/**
 * pages/OrderSummaryTab.tsx
 * Round -12: refactored to compose widgets/orderSummaryWidgets.tsx.
 */
import { GlobalFilters } from "../types/dashboardFilters";
import { useOrderSummaryData, OrderSummaryTable } from "../widgets/orderSummaryWidgets";

export default function OrderSummaryTab({ driver, globalFilters }: { driver: string; globalFilters?: GlobalFilters }) {
  const { data, error } = useOrderSummaryData(driver, globalFilters);
  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data) return <div>Loading...</div>;
  return <OrderSummaryTable data={data} />;
}
