import DashboardConfigTab from "./DashboardConfigTab";

/**
 * NAV REDESIGN: this used to be one of Dashboard's internal tabs. The
 * Dashboard page now only shows Overview/Analytics, so this moved to its
 * own route (linked from the Admin nav group) - same component, same
 * data, same behavior, just reached via a different nav path.
 */
export default function DashboardConfigurationPage() {
  return (
    <div className="page">
      <h2>Dashboard Configuration</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        Rules that exclude or reclassify data before it reaches the Dashboard/reporting numbers.
      </p>
      <DashboardConfigTab />
    </div>
  );
}
