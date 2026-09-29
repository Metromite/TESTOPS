-- Historical Bulk Organizer plans are stored in Primary on existing
-- DispatchOPS installations. Keep realtime updates working there as well.
do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.bulk_organizer_plans;
  end if;
exception when duplicate_object then null;
end $$;
