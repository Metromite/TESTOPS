/**
 * hooks/useDashboardQuery.ts
 * ----------------------------
 * Round -12: the shared data-fetching hook behind every dashboard page AND
 * every atomic widget extracted from those pages (see widgets/*.tsx). This
 * is the piece that makes "atomic widgets without changing calculations"
 * actually true: a widget and the full page it came from call the exact
 * same hook, hitting the exact same endpoint with the exact same params in
 * the exact same way - not a reimplementation, not an approximation.
 *
 * Each page previously duplicated this same shape (useState + useEffect +
 * api.get + optional setInterval poll) with only the endpoint, poll
 * interval, and dependency array differing. This hook is that shared shape,
 * parameterized - not a behavior change for any page, since every existing
 * page is refactored to call this hook with the exact settings it already
 * had (verified per-page against the pre-refactor file, noted in each
 * widgets/*.tsx file's own header comment).
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { GlobalFilters, EMPTY_GLOBAL_FILTERS, dashboardFilterParams } from "../types/dashboardFilters";
import { subscribeDashboardRefresh } from "./dashboardRefreshBus";
import { getCached, setCached } from "./dashboardCache";

export function useDashboardQuery<T>(
  endpoint: string,
  driver: string,
  globalFilters: GlobalFilters | undefined,
  opts?: { pollMs?: number; skipFilters?: boolean }
): { data: T | null; error: string; reload: () => void } {
  const gf = globalFilters || EMPTY_GLOBAL_FILTERS;
  const params = opts?.skipFilters ? new URLSearchParams() : new URLSearchParams(dashboardFilterParams(driver, gf));
  const cacheKey = `${endpoint}?${params.toString()}`;
  // Synchronous initial value from the module-level cache (see
  // dashboardCache.ts) - if this exact endpoint+filters combo was
  // fetched earlier in this browser session (even before Dashboard was
  // unmounted by navigating away), show it immediately instead of a
  // blank "Loading..." while the effect below fetches a fresh copy.
  const [data, setData] = useState<T | null>(() => getCached<T>(cacheKey) ?? null);
  const [error, setError] = useState("");
  const reloadTick = useRef(0);
  const [, setTickState] = useState(0);

  async function load() {
    try {
      const p = opts?.skipFilters ? new URLSearchParams() : new URLSearchParams(dashboardFilterParams(driver, gf));
      const d: T = await api.get(`${endpoint}${p.toString() ? `?${p.toString()}` : ""}`);
      setData(d);
      setCached(cacheKey, d);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    if (opts?.pollMs) {
      const id = setInterval(load, opts.pollMs);
      return () => clearInterval(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, driver, gf.drivers, gf.areas, gf.division, gf.route_type, gf.vehicle_type, gf.facility_type, gf.salesman, gf.start_date, gf.end_date, reloadTick.current]);

  // ITEM 1: subscribe to the global "Refresh Dashboard" bus. loadRef always
  // points at the current `load` closure (current endpoint/driver/filters),
  // so a bus trigger reloads with whatever is active right now - same as
  // this hook's own effect-driven load, just invoked on demand.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => subscribeDashboardRefresh(() => loadRef.current()), []);

  function reload() {
    reloadTick.current += 1;
    setTickState((t) => t + 1);
  }

  return { data, error, reload };
}
