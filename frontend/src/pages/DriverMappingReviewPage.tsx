import DriverMappingReviewTab from "./DriverMappingReviewTab";

/**
 * NAV REDESIGN: this used to be one of Dashboard's internal tabs. The
 * Dashboard page now only shows Overview/Analytics, so this moved to its
 * own route (linked from the Admin nav group) - same component, same
 * data, same behavior, just reached via a different nav path.
 */
export default function DriverMappingReviewPage() {
  return (
    <div className="page">
      <h2>Driver Mapping Review</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        Review and correct how imported GPS/vehicle data maps to SAP driver records.
      </p>
      <DriverMappingReviewTab />
    </div>
  );
}
