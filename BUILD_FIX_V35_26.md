# Build Fix v35.26

- Fixed TS2345 in frontend/src/services/dashboardKpis.ts by narrowing the Supabase dynamic row to SapRow at the dashboard classification boundary.
- The runtime behavior and UI are unchanged by this type-only correction.
