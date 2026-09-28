/**
 * hooks/dashboardRefreshBus.ts
 * ----------------------------
 * ITEM 1 (Dashboard Performance / Refresh Dashboard button):
 *
 * Every dashboard tab already avoids refetching on tab-switch (see the
 * `visitedTabs` comment in pages/Dashboard.tsx - once a tab has been
 * opened it stays mounted, so switching back to it is instant with no
 * API call, no spinner, no recomputation). That part of item 1 was
 * already true before this change.
 *
 * What was still missing: a way to deliberately reload ALL currently
 * mounted dashboard data at once (a "Refresh Dashboard" button) and an
 * optional auto-refresh timer, without keeping every tab mounted at
 * all times (only *visited* tabs hold data) and without changing the
 * signature of useDashboardQuery/useHomeData or any of the six tab
 * page components.
 *
 * This is a minimal pub/sub bus: Dashboard.tsx calls
 * triggerDashboardRefresh() from the button and from an optional
 * setInterval. Each data hook subscribes once (via a ref so it always
 * calls its *current* load() closure, i.e. with whatever driver/filters
 * are active right now) and re-runs its existing load() function -
 * same endpoint, same params, same parsing as a normal effect-driven
 * load. Nothing about how data is fetched or shaped changes; this only
 * adds a way to ask already-mounted hooks to do what they already do.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeDashboardRefresh(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function triggerDashboardRefresh(): void {
  listeners.forEach((fn) => fn());
}
