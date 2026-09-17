# DispatchOPS Final Release Package

This package preserves the existing DispatchOPS Dashboard/UI and adds only the requested operational layers.

## Included
- Existing DispatchOPS Tauri desktop application source.
- Existing Supabase federation (Primary + Secondary + Tertiary).
- Existing Dashboard pages, KPIs, slicers, route planning, location knowledge and LOGI AI.
- Price Change / Repricing admin page and driver portal.
- Capacity-aware NEW-import placement using `dispatchops_database_size()` with 500 MB database quota and 85% safety threshold; one import remains atomic and is never split.
- Location Knowledge preferred-branch selection: ambiguous matches are shown as canonical candidates; selecting one stores a preferred canonical area for that exact pattern.
- Price Change admin delete/reset source functions restored in the source migration set.

## Important build status
The ZIP is a source/deployment package. A native Windows EXE was NOT rebuilt in this environment because the Windows/Rust/Tauri build toolchain and npm dependency installation were not available. Do not treat this ZIP as a compiled EXE.

## Supabase placement
- Primary remains the first project for new imports until its database usage reaches the safety threshold.
- Secondary is next, then Tertiary.
- A single import is kept in one project so invoice/route/fact relationships are not split.

## Dashboard preservation
No Dashboard page logic was intentionally changed by the final location/price-change additions. The targeted Dashboard RPC security fixes remain in the source history/migrations supplied with the project.
