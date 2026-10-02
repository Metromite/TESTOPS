-- DispatchOPS Dashboard final September 2026 performance/filter pass.
--
-- This migration is intentionally a documentation/verification marker for
-- the live production functions installed during this release. The functions
-- are created by the deployment migration sequence in this release and are
-- granted below. It does not modify imported SAP rows or Fleet data.
--
-- Live functions in this release:
--   dispatchops_dashboard_filter_meta_v2(date,date)
--   dispatchops_dashboard_home_snapshot(date,date,jsonb)
--   dispatchops_dashboard_home_detail(date,date,text,jsonb,integer,integer,text)
--
-- Required grants:
grant execute on function public.dispatchops_dashboard_filter_meta_v2(date,date) to anon, authenticated;
grant execute on function public.dispatchops_dashboard_home_snapshot(date,date,jsonb) to anon, authenticated;
grant execute on function public.dispatchops_dashboard_home_detail(date,date,text,jsonb,integer,integer,text) to anon, authenticated;
