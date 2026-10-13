/**
 * pages/LeadTimeTab.tsx
 * Round -12: refactored to compose widgets/leadTimeWidgets.tsx's atomic
 * pieces from one shared useLeadTimeData() call.
 *
 * FINAL CORRECTION PASS (single source of truth, item 12): Lead Time Band
 * / Classification are no longer local `useState` here - they're two more
 * fields on the shared GlobalFilters object Dashboard.tsx already owns
 * (see dashboardFilters.ts), passed down alongside the setters that update
 * them. This is what makes the Excel export (which reads the same
 * `globalFilters` via `dashboardFilterParams`) automatically pick up
 * whatever Lead Time Band/Classification is selected here - no separate
 * "LeadTimeFilters" state, no separate export wiring.
 */
import { GlobalFilters } from "../types/dashboardFilters";
import {
  useLeadTimeData, TotalInvoicesKpi, OverallAvgKpi, FastestKpi, LongestKpi,
  AvgByClassificationChart, DistributionChart, ByClassificationTable,
  BandClassificationMatrixTable, LeadTimeFilterBar,
} from "../widgets/leadTimeWidgets";

export default function LeadTimeTab({
  driver, globalFilters, setLeadTimeBand, setClassification,
}: {
  driver: string; globalFilters?: GlobalFilters;
  setLeadTimeBand: (v: string) => void; setClassification: (v: string) => void;
}) {
  const { data, error } = useLeadTimeData(driver, globalFilters);

  if (error) return <div className="glass-card error-text">{error}</div>;
  if (!data) return <div>Loading...</div>;

  return (
    <div>
      <LeadTimeFilterBar
        data={data}
        band={globalFilters?.lead_time_band || ""} setBand={setLeadTimeBand}
        classification={globalFilters?.classification || ""} setClassification={setClassification}
      />

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, minmax(160px,1fr))" }}>
        <TotalInvoicesKpi data={data} />
        <OverallAvgKpi data={data} />
        <FastestKpi data={data} />
        <LongestKpi data={data} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <AvgByClassificationChart data={data} />
        <DistributionChart data={data} />
      </div>

      <div style={{ marginBottom: 20 }}>
        <ByClassificationTable data={data} />
      </div>

      <BandClassificationMatrixTable data={data} />
    </div>
  );
}
