-- Explicit Data API grants for the department dispatch table.
-- This keeps existing deployments working and protects fresh/preview/reset deployments
-- after Supabase stops auto-granting Data API access to newly-created public tables.
grant select, insert, update, delete on public.department_dispatch_entries to anon;
grant select, insert, update, delete on public.department_dispatch_entries to authenticated;
grant select, insert, update, delete on public.department_dispatch_entries to service_role;
