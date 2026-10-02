-- LOGI compatibility: driver_daily_divisions historically uses person_code/driver_code,
-- while some LOGI reasoning paths may request driver_id.
alter table public.driver_daily_divisions add column if not exists driver_id uuid;

update public.driver_daily_divisions d
set driver_id = dr.id
from public.drivers dr
where d.driver_id is null
  and upper(trim(coalesce(d.person_code,d.driver_code,''))) = upper(trim(coalesce(dr.code,dr.driver_code,'')));

create or replace function public.sync_driver_daily_divisions_driver_id()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
begin
  if new.driver_id is null then
    select dr.id into new.driver_id
    from public.drivers dr
    where upper(trim(coalesce(new.person_code,new.driver_code,''))) =
          upper(trim(coalesce(dr.code,dr.driver_code,'')))
    limit 1;
  end if;
  return new;
end
$$;

drop trigger if exists trg_driver_daily_divisions_driver_id on public.driver_daily_divisions;
create trigger trg_driver_daily_divisions_driver_id
before insert or update of person_code,driver_code,driver_id
on public.driver_daily_divisions
for each row execute function public.sync_driver_daily_divisions_driver_id();

grant select on public.driver_daily_divisions to anon,authenticated;
