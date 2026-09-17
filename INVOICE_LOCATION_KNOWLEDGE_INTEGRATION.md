# DispatchOPS Invoice Location Knowledge Integration

Implemented without changing existing dashboard, route planner, experience, fleet, or normal SAP/Landmark imports.

- New Admin page: **Invoice Location Knowledge** (`/location-knowledge`).
- Monthly XLSX/XLS/CSV is parsed in memory only. The raw workbook and filename are not stored by this feature.
- Hard-excludes any row containing **Not Supply** or **Not Supplied** before persistence.
- Canonical Area Code/Area Name come only from the DispatchOPS `areas` master. Unresolved areas are skipped instead of inventing a code.
- Deduplication key: normalized Customer + Shipment To + Remarks + canonical Area Code. Repeated invoices increase `seen_count`; distinct branches/instructions remain separate patterns.
- New Supabase table: `invoice_location_knowledge` (migration `0026_invoice_location_knowledge.sql`).
- Chrome extension v9.0 queries the primary DispatchOPS Supabase knowledge table while scanning SAP.
- Extension matching requires exact normalized customer, then scores Shipment To + Remarks. Competing branches with similar evidence return an ambiguous state instead of guessing.
- Extension's original `chrome.storage.local` customer/timing/GPS database remains as fallback; it was not deleted.

Primary database migration was applied and verified. Secondary project rejected DDL in this session because that connection is read-only; the migration file is included so schema remains reproducible. The feature intentionally reads/writes the primary knowledge store, which is also the endpoint used by the extension.

Build note: this environment has no project `node_modules`, so a full Vite/Tauri rebuild was not possible here. New TypeScript files were syntax-checked as far as the available compiler permits; its only reported errors were unresolved external modules due to missing dependencies. The extension JavaScript passes `node --check`.
