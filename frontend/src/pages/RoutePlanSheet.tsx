import RoutePlanner from "./RoutePlanner";

/**
 * ROUTE PLANNER INTEGRATION FIX: this page used to call the old ephemeral
 * `/route-plan/sheet` endpoint independently of the persisted Driver/Helper
 * Route Plans - which is exactly why it never reflected what was actually
 * generated, had no Excel export, and used a different (overlapping)
 * column layout. It's now just a deep link into RoutePlanner's "Route Plan
 * Sheet" tab, so there's a single, always-in-sync implementation instead
 * of two.
 */
export default function RoutePlanSheet() {
  return <RoutePlanner initialTab="sheet" />;
}
