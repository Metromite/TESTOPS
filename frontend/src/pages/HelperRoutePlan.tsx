import RoutePlanner from "./RoutePlanner";

/**
 * NAV REDESIGN: deep link into RoutePlanner's "Helper Route Plan" tab, so
 * it's directly reachable from the persistent Route Planning toolbar
 * (see RoutePlanningToolbar.tsx) instead of being nested one level
 * deeper inside Route Planner's own internal tab bar. Same pattern as
 * RoutePlanSheet.tsx.
 */
export default function HelperRoutePlan() {
  return <RoutePlanner initialTab="helper" />;
}
