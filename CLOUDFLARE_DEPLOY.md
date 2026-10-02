# DispatchOPS — Cloudflare Pages deployment

This package preserves the existing DispatchOPS Tauri desktop application and its Supabase integration. It adds only the web-hosting pieces needed for a Cloudflare Pages deployment.

## Important safety rule
Do **not** run the SQL files in `supabase/migrations` or `supabase/RUN_ALL_MIGRATIONS.sql` as part of the Cloudflare deployment. Those files are included as source/history for the existing application, not as a deployment step.

The web build talks to the existing three Supabase projects using the client-side publishable keys already used by the application. No database schema/data changes are required for the web deployment.

## Cloudflare Pages settings

- Repository: `Metromite/DispatchOPS`
- Root directory: `frontend`
- Build command: `npm run build`
- Build output directory: `dist`
- Node version: 20+ recommended

The `frontend/public/_redirects` file keeps React Router routes working on direct page loads/refreshes.

## Environment variables (optional)

The source contains the same **publishable** Supabase values as fallbacks, so the first deployment can work without Cloudflare variables. If you prefer Cloudflare-managed configuration, set the variables listed in `frontend/.env.example` in the Pages project.

Never add a Supabase service-role key or database password to the frontend or Cloudflare Pages variables.

## Desktop EXE

The `frontend/src-tauri` project is intentionally preserved. This web deployment does not rebuild, modify, or replace the existing Windows `.exe`.
