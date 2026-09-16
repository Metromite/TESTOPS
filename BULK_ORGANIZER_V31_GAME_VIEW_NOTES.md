# Bulk Organizer v31 — "game view" rebuild

## What changed vs v30
The Customer → Invoice → Pallet → Vehicle planning model, drag/drop, capacity
math, and Fleet permission checks from v30 (`BULK_ORGANIZER_V30_NOTES.md`)
are **unchanged** — same data, same rules, same `bulk_organizer_plans` table.
What changed is the skin and three real new features:

1. **Isometric "game" visuals.** Customers render as small isometric
   buildings (store / hospital / warehouse, colour + icon per type),
   vehicles as isometric trucks with a fuel-gauge-style capacity bar
   (yellow while there's room, green only once genuinely full), and pallets
   as small draggable crates. Built with flat CSS `clip-path` hexagonal
   cubes (`components/BulkOrganizerIso.tsx`, `.iso-*` rules in `index.css`)
   — no 3D transforms, no perspective, no WebGL, so it costs nothing extra
   to render and looks identical on every Windows GPU. This was the
   explicit trade-off from the brief ("isometric ثابت... أسرع وأخف على
   الجهاز") over a real rotatable 3D camera.

2. **Admin-curated defaults (migration 0047).** Previously every day
   auto-selected *all* active Vans/Pick-Ups and derived customers only from
   that day's SAP invoices. Now two new tables —
   `bulk_organizer_default_vehicles` and `bulk_organizer_default_customers`
   — hold the set an Admin explicitly picks as "every day starts with
   this" (same set for every month, as requested). A day with no saved
   plan yet seeds from these defaults instead of "everything"; the
   existing per-day add/remove UI still overrides on top, unchanged.
   Default customers also carry a `weekdays` array (recurring schedule)
   and a `building_type`. Managed from the new "Manage Defaults" button/modal
   on the page itself — nothing was added outside the Bulk Organizer page.

3. **Driver/helper + schedule notifications.** Each vehicle-per-day now has
   editable driver/helper name fields (stored in the existing per-day JSON,
   not the default row, since a driver can change day to day on the same
   truck). A right-hand "Today's schedule" panel lists every default
   customer whose `weekdays` match the open date, flagged pending (red dot)
   until an invoice with pallets exists for them that day, done (green
   dot) after — the same information also shows as a pulsing "!" badge on
   that customer's building.

4. **Invoice entry moved into a modal** opened from a header button
   (`Add Invoice`), instead of an always-visible inline form. The
   predictive customer dropdown (native `<datalist>`) is unchanged.

## Deliberately simplified / not built this pass
- **Dragging a vehicle onto a building** ("اسحب العربية وحطها قدام
  المبنى") was not built as a literal free-canvas drag between two
  isometric objects — the existing invoice/customer and invoice/vehicle
  drag targets already give the same functional result (an invoice ends
  up both under a customer and loaded on a vehicle) without a second,
  separate linking model to keep in sync. If a literal drag-vehicle-
  onto-building interaction is still wanted on top of this, it should be
  scoped as its own pass rather than guessed at silently here.
- No real 3D/WebGL renderer, no camera controls, no game-asset artwork —
  matches the "isometric ثابت" choice made for this pass.
- Areas/permissions/capacity logic is exactly v30's; not re-verified beyond
  what v30 already covered.

## Verification
Every changed/added file (`BulkOrganizer.tsx`, `BulkOrganizerIso.tsx`,
`services/bulkOrganizer.ts`, `theme/ThemeProvider.tsx`) was parsed
individually with esbuild to catch syntax errors. A full `npm install` +
production TypeScript build was **not** run in this sandbox (same
limitation as v30) — no claim of a completed production build is made.
Run `ONE_CLICK_SETUP.bat` (or `npm run tauri:build`) for the real build,
and run the new `RUN_ALL_MIGRATIONS.sql` (or just migration 0047) against
Supabase before testing, since the new default tables don't exist until
that migration runs.

## Wallpaper fix (unrelated, bundled in this drop)
`index.css`'s post-"iOS 27" default background gradient on `body` is now
scoped to `body:not(.custom-bg)`, and `ThemeProvider.tsx` applies the
custom wallpaper via `style.setProperty(..., "important")` instead of a
plain property assignment — so a custom wallpaper can no longer be buried
by a future facelift pass the way it was after the iOS UI work.
