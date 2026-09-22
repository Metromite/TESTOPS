# DispatchOPS v35.26 — Driver Slicer / Valid Invoice / Sticky Nav / Mobile Pass

- Driver slicer is now a first-class Liquid Glass surface and no longer relies on generic legacy filter styling.
- Driver slicer search, ALL, selected drivers, clear, and Show-all controls use the shared glass material; selected states use the existing `--blue` app accent.
- Nav active states and theme selector use the existing `--blue` accent rather than the separate purple token.
- Top navigation remains sticky so it stays available while page content scrolls.
- Large dashboard detail reads now yield to the browser between Supabase pages so opening Valid Invoices can paint its loading modal instead of monopolizing the main thread.
- Mobile page shells are constrained to avoid accidental page-wide horizontal overflow while data tables retain local scrolling where needed.
- No dashboard calculations or filtering semantics were intentionally changed.

Build note: the supplied archive does not contain installed dependencies. A local `npm run build` attempt therefore reports missing React/JSX modules; this is an environment/dependency issue, not a new TypeScript error introduced by this pass.
