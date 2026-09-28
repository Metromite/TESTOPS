/**
 * hooks/dashboardCache.ts
 * ------------------------
 * FOLLOW-UP TO ITEM 1: "visitedTabs" (Dashboard.tsx) already made
 * switching BETWEEN Dashboard's own tabs (Overview/Driver Performance/
 * Lead Time/etc.) instant within one visit, by keeping already-opened
 * tabs mounted. It does NOT help when you navigate away to a different
 * top-level page (Fleet, Route Planning, ...) and back to Dashboard -
 * that's a full React Router route change, which unmounts Dashboard.tsx
 * entirely, including every tab's hook state - so on return, every hook
 * starts from `data: null` again and shows "Loading..." while it
 * refetches, even though the data it's about to fetch hasn't
 * necessarily changed.
 *
 * This is a plain module-level Map, NOT React state - it lives at the
 * JS module scope, so unlike a useState/useRef inside Dashboard.tsx it
 * survives Dashboard unmounting and remounting (as long as the page
 * itself isn't hard-refreshed/reloaded). useDashboardQuery/useHomeData
 * read from it synchronously as their initial state (so the very first
 * render already has the last-known data - no "Loading..." flash on
 * return), then still fetch fresh data in the background and update
 * both the cache and the screen when it arrives (stale-while-revalidate
 * - never permanently stale, since a normal load already happens on
 * every mount, and the item 1 refresh button/auto-refresh also update
 * it explicitly).
 *
 * ITEM PASS 4 (item 2, "fast reopen"/local cache): the in-memory Map
 * above only survives SPA navigation - a hard refresh or actually
 * closing/reopening the app tab loses it entirely, which is exactly
 * the "app takes 1-2 minutes to become usable" moment the requirement
 * is about. Backed the same Map with `localStorage` underneath, purely
 * additively: `getCached`/`setCached`'s signatures and every call site
 * are UNCHANGED - this only changes where the value ultimately lives.
 *
 * What is and isn't cached this way, per the explicit "do not cache
 * sensitive/user-specific info unsafely" constraint: this module is
 * ONLY ever called with Dashboard KPI/chart/filter-option payloads
 * (verified by grepping every `getCached`/`setCached` call site) -
 * never auth tokens, never anything from the auth/session layer, which
 * live entirely separately in api/client.ts's own token handling. It's
 * company-wide reporting data any authenticated user of this app can
 * already see via the API, not per-user private data.
 *
 * Still genuinely stale-while-revalidate, not a second source of
 * truth: every value written here is ALWAYS immediately followed by a
 * real network fetch on the next mount (see useDashboardQuery.ts) that
 * overwrites both the in-memory Map and localStorage with the server's
 * current answer - this is a "show something instantly while asking
 * the server for the real answer" cache, never a replacement for asking
 * the server. A `PERSIST_VERSION` tag lets a future payload-shape change
 * invalidate old cached entries cleanly (old, differently-shaped cached
 * JSON is simply ignored rather than fed into a component expecting the
 * new shape) without needing a manual cache-clear step.
 */
const cache = new Map<string, unknown>();
const PERSIST_PREFIX = "dc_dashcache_v1:"; // v1 = PERSIST_VERSION below, kept in the key itself so a version bump can't collide with old entries
const PERSIST_VERSION = 1;

function readFromStorage(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(PERSIST_PREFIX + key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== PERSIST_VERSION) return undefined;
    return parsed.value;
  } catch {
    // localStorage disabled (private browsing, quota, etc.) - fall back
    // to memory-only behavior, exactly like before this change.
    return undefined;
  }
}

function writeToStorage(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PERSIST_PREFIX + key, JSON.stringify({ v: PERSIST_VERSION, value }));
  } catch {
    // Quota exceeded or storage disabled: silently degrade to
    // memory-only for this entry - never throw, never block the caller.
  }
}

export function getCached<T>(key: string): T | undefined {
  if (cache.has(key)) return cache.get(key) as T | undefined;
  // Not in the in-memory Map yet (fresh page load) - fall back to the
  // persisted copy from a previous visit/session, and warm the Map from
  // it so subsequent reads this session skip the JSON.parse.
  const persisted = readFromStorage(key);
  if (persisted !== undefined) cache.set(key, persisted);
  return persisted as T | undefined;
}

export function setCached(key: string, value: unknown): void {
  cache.set(key, value);
  writeToStorage(key, value);
}

