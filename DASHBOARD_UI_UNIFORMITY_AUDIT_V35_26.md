# DispatchOPS v35.26 — Dashboard UI Uniformity Audit / Fix

## Findings
- `GlassCard` contained a hard-coded dark rgba background, so dashboard cards could stay dark even in light mode.
- `GlassButton` secondary/subtle variants also contained a hard-coded dark rgba background.
- Dashboard filter controls mixed glass surfaces with solid `--navy3`, making the filter row visually separate from the glass system.
- Driver Performance and Lead Time used fixed 4-column KPI grids and fixed 2-column chart grids, which can collide when a Windows browser window is resized.
- Dashboard tabs had no explicit overflow policy for narrow desktop windows.
- Theme transition only transitioned paint properties on a limited set of selectors; the design-system surfaces now explicitly transition their theme-aware paint properties.
- Native select/date controls in the dashboard could visually diverge from the glass inputs.

## Changes
- Replaced hard-coded dark surfaces in GlassCard/GlassButton with `--glass-bg`, `--glass-border`, `--elevation-1`, and theme tokens.
- Standardized Dashboard filter bar as a glass Level-1 surface.
- Added responsive Dashboard KPI/chart grids with 4 -> 2 -> 1 column behavior.
- Added min-width/overflow protections to prevent cards and table content from forcing sibling overlap.
- Improved Dashboard tab bar behavior for resized windows.
- Standardized dashboard native date/select controls to glass tokens.
- Strengthened light/dark visual transition coverage without animating layout or backdrop blur.
- Kept the existing navigation structure/functionality intact.

## Validation target
Build with the existing frontend build script and manually check:
1. Dark mode: Overview, Driver Performance, Lead Time, Order Summary, Area Analytics, Not Supplied.
2. Light mode: same pages.
3. Resize Windows browser from wide desktop to ~1200, ~900, ~760 and mobile widths.
4. Open/close Dashboard filters and top navigation dropdowns.
5. Switch dark/light repeatedly and verify smooth paint transition with no layout jump.
