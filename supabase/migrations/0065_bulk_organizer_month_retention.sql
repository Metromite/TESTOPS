-- Keep Bulk Organizer operational history lean.
-- On the 8th of each month, remove plans/defaults from all previous months.
-- The current month and all future months (including Waiting for Schedule)
-- are never touched.
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.dispatchops_cleanup_old_bulk_months()
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare cutoff date := date_trunc('month',current_date)::date;
declare deleted_plans integer := 0; deleted_defaults integer := 0;
begin
  delete from public.bulk_organizer_plans where plan_date < cutoff;
  get diagnostics deleted_plans = row_count;
  delete from public.bulk_organizer_month_defaults where month_key < cutoff;
  get diagnostics deleted_defaults = row_count;
  return jsonb_build_object('cutoff_month',cutoff,'deleted_plans',deleted_plans,'deleted_defaults',deleted_defaults);
end $$;

revoke all on function public.dispatchops_cleanup_old_bulk_months() from public,anon,authenticated;
select cron.unschedule(jobid) from cron.job where jobname='dispatchops-bulk-month-retention';
select cron.schedule('dispatchops-bulk-month-retention','30 2 8 * *','select public.dispatchops_cleanup_old_bulk_months();');
