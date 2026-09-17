/**
 * pages/CustomerIntelligence.tsx
 * Round -12: refactored to compose widgets/customerIntelligenceWidgets.tsx.
 */
import { TotalAliasesKpi, ConfirmedAliasesKpi, AliasListWidget } from "../widgets/customerIntelligenceWidgets";

export default function CustomerIntelligence() {
  return (
    <div className="page">
      <h2>Customer Intelligence</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -8 }}>
        Every SAP ↔ Landmark customer name mapping the correlation engine has learned, permanently.
      </p>
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(2, minmax(180px, 1fr))" }}>
        <TotalAliasesKpi />
        <ConfirmedAliasesKpi />
      </div>
      <AliasListWidget />
    </div>
  );
}
