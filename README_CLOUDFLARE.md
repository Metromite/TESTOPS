# DispatchOPS — Cloudflare Pages

Use the **frontend** directory as the Cloudflare Pages root directory.

- Build command: `npm run build`
- Build output directory: `dist`
- Framework: Vite
- Node: 20+

The existing Supabase integration is preserved. No database migrations are run by Cloudflare.

`.env.local` is intentionally excluded. Configure the required `VITE_*` values in Cloudflare Pages environment variables if needed.
