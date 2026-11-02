# DispatchOPS Dashboard October Import + Import Delete Fix

Scope: Dashboard source-data cache/loading and the import-file delete workflow only.

Changes:
- Dashboard's local SAP dataset now reads Primary, Secondary, and Tertiary projects, preserving Primary-first date precedence and then using Secondary/Tertiary only when a higher-priority project does not already own that dispatch date.
- Bumped the local dashboard dataset version so older cached snapshots are discarded.
- Added a lightweight latest-import metadata check before reusing an IndexedDB snapshot, so a newly uploaded source batch cannot remain hidden behind a still-valid 12-hour cache.
- Invalidate the dashboard snapshot after successful SAP/V-Zone imports and after deleting an import batch.
- Delete SAP facts, Landmark/V-Zone facts, and raw import rows in batches of 250 IDs rather than issuing one large DELETE per table. The file and batch metadata are removed only after child-row deletion succeeds.

No SQL, migrations, database settings, or production data were changed. No other application pages or vehicle/driver matching rules were changed.

Verification:
- ZIP integrity checked after packaging.
- TypeScript transpile/syntax check passed for both modified files.
- Full `npm run build` was not run because this supplied archive has no package lock and no installed frontend dependencies in the build environment.
