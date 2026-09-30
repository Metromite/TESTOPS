-- V35.26 follow-up: self-heal the permanent Price Change area defaults.
-- If the master table exists but was left empty, preserve the areas currently
-- configured on any list before a new-list operation can copy them.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='price_change_default_areas') then
    insert into public.price_change_default_areas(area_name,sort_order,active)
    select min(trim(area_name)), row_number() over(order by min(sort_order), min(trim(area_name))) - 1, true
    from public.price_change_campaign_areas
    where active and nullif(trim(area_name),'') is not null
      and not exists (select 1 from public.price_change_default_areas where active)
    group by lower(trim(area_name))
    on conflict (lower(trim(area_name))) do nothing;
  end if;
end $$;
