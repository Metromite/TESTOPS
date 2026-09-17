# DispatchOPS v35.28 — Liquid Glass UI Audit / Fix Pass

## Audited areas
- Persistent top command navigation and dropdown menus
- Route Planning branch navigation / active-state motion
- Dashboard header, slicers, filters, KPI cards, charts and tables
- Invoice Location Knowledge records header/search layout
- LOGI floating assistant window and chat bubbles
- Cross-page content transition behavior
- Existing theme token system and legacy CSS parity layer

## Root causes found
1. `GlassNavItem` / `GlassNavGroup` accepted a Framer Motion `layoutId` but did not actually use it for the active pill, so the main top navigation had no shared sliding transition.
2. Top-nav dropdowns were portaled correctly for stacking, but had no enter/exit animation and were using a mixed legacy material definition.
3. The final CSS parity layer explicitly disabled page transitions with `.page-fade-in { animation: none !important; }`, defeating the transition already implemented in `ProtectedLayout`.
4. The legacy `--dispatch-glass-light` / `--dispatch-glass-inner-light` values were much more transparent than the design-system `--glass-bg` / level-2 / level-3 materials. Dashboard and older pages therefore looked like a different, flatter UI—especially in light mode.
5. Dashboard internals still contained legacy widget classes. A final parity layer was needed so those classes use the same Liquid Glass material without changing their data/query logic.
6. Location Knowledge used a single flex row with an inline `minWidth: 320` search input while the global responsive rules could force children to wrap. The records title/search area was converted to a dedicated responsive layout.
7. LOGI's main window was a glass card, but its chat bubbles and confirmation surface still used opaque `--navy3` / `--navy4`, creating the old visual language inside the new shell.

## Changes made
- Added real Framer Motion shared active-pill transitions to the main top navigation.
- Added animated Liquid Glass dropdown open/close transitions while preserving portal positioning.
- Restored the non-blocking page entrance transition; no JS opacity handshake or `opacity: 0` dead state was introduced.
- Normalized legacy dashboard/page card, KPI, chart, filter and table surfaces onto the existing glass token system.
- Normalized dashboard controls and chart backgrounds.
- Kept Route Planning's existing branch-navigation behavior intact.
- Restyled LOGI's chat window/bubbles to Level-2/Level-3 glass.
- Fixed Customer Location Records title/search/button layout for desktop and mobile.

## Data / behavior preserved
No Supabase queries, RPCs, CRUD operations, route paths, filter state model, or business logic were intentionally changed by this pass.

## Validation
A full dependency install/build could not be completed in the isolated audit environment because the supplied frontend package has no package-lock and external npm package installation was unavailable/timed out. Global TypeScript parsing was attempted, but dependency-resolution errors prevent a complete type-check. The edited files were inspected for syntax/structure and the changes are isolated to the UI/navigation layer plus CSS parity.
