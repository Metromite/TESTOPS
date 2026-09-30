# DispatchOPS Department Entry

Standalone Cloudflare/Vite site for Pharma, Medical and Consumer departments to submit next-day dispatch preparation into the existing DispatchOPS Supabase database.

## Accounts

- `pharma` / `0000` → Pharma queue
- `medical` / `0000` → Medical queue (feeds the Pharma planner)
- `consumer` / `0000` → Consumer queue

These are intentionally simple operational credentials in the frontend. They are not Supabase Auth accounts. For stronger security later, move them to Supabase Auth or an Edge Function.

## Rules

- Entry window closes at 16:30 Asia/Dubai.
- New entries must target tomorrow or a later date.
- Store availability comes from the existing Bulk Organizer monthly defaults / daily plan.
- Big + small pallet counts must equal total pallets.
- Entries are written to `public.department_dispatch_entries`.
- The Bulk Organizer reads those entries for the matching target date and subscribes to their realtime changes.

## Cloudflare Pages

Build command: `npm run build`

Output directory: `dist`

Set these variables if desired (the app also has the current project defaults built in):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
