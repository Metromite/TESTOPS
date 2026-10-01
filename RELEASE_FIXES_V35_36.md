# DispatchOPS V13.6.36 – Dashboard Offline-Feel / Preload Pass

## Scope
Dashboard-only performance/UX pass. No business calculations, database tables, import logic, Bulk Organizer, Price Change, Experience, Route Planning, or other page behavior was intentionally changed.

## Changes
1. Dashboard filter metadata is now cached per exact date range, not only as one generic cache entry.
2. Dynamic Driver slicer options are cached per exact date range + non-driver filter combination.
3. Driver directory is cached locally for immediate code/name rendering.
4. Dashboard preload now warms filter metadata, driver options, and the Overview before navigation.
5. Remaining Dashboard tabs are warmed sequentially in the background after the Overview warm-up. Sequential warming avoids the PostgreSQL contention that previously caused statement-timeout behavior when several heavy dashboard RPCs were launched together.
6. Warmed dashboard results are written into the same local cache consumed by the mounted tabs, so navigation does not start a duplicate request.
7. Existing stale-while-revalidate behavior remains: cached values paint immediately and a background request refreshes them.
8. Existing realtime refresh behavior remains in place so imported/master data can invalidate the cached dashboard state.

## Intentional non-change
We did NOT switch the entire Dashboard to downloading all historical SAP/Landmark rows into the browser for arbitrary client-side filtering. That would make first load heavier and can expose/retain much more data in the browser. Server-side snapshot RPCs remain the source of truth for uncached filter combinations.

## Build verification
The source was statically sanity-checked after the change. A full `npm run build` could not be completed in the packaging environment because the ZIP does not contain `node_modules` and the environment could not fetch the private/un-cached npm dependency set within the available time. The existing project build command remains unchanged: `tsc -b && vite build`.
