-- Driver slicer rule: only Fleet Database drivers that actually occur in the
-- dashboard/SAP export data are returned. Export-only names that are not in
-- Fleet Database are excluded by the join to public.drivers.
create or replace function public.dispatchops_dashboard_filter_meta()
returns jsonb
language sql
stable
set statement_timeout='10s'
as $$
with

divisions as (
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) v from (
    select distinct trim(division_desc) v from public.sap_invoice_facts
    where lower(trim(coalesce(division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
  ) q
),
facility_types as (
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) v from (
    select distinct trim(facility_type) v from public.sap_invoice_facts
    where lower(trim(coalesce(facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
  ) q
),
salesmen as (
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) v from (
    select distinct trim(salesman) v from public.sap_invoice_facts where nullif(trim(coalesce(salesman,'')),'') is not null
  ) q
),
areas as (
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) v from (
    select distinct trim(coalesce(nullif(name,''),area_name)) v from public.areas
    where nullif(trim(coalesce(nullif(name,''),area_name,'')),'') is not null
  ) q
),
drivers as (
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) v from (
    select distinct trim(coalesce(nullif(d.name,''),d.driver_name)) v
    from public.drivers d
    where nullif(trim(coalesce(nullif(d.name,''),d.driver_name,'')),'') is not null
      and exists (
        select 1 from public.sap_invoice_facts f
        where nullif(trim(coalesce(f.driver_name,'')),'') is not null
          and upper(trim(f.driver_name)) = upper(trim(coalesce(nullif(d.name,''),d.driver_name)))
      )
  ) q
),
vehicle_types as (
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) v from (
    select distinct trim(type) v from public.vehicles
    where nullif(trim(type),'') is not null and lower(trim(coalesce(status,''))) not in ('under service','inactive','retired')
  ) q
),
route_types as (
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) v from (
    select distinct trim(route_type) v from public.areas where nullif(trim(coalesce(route_type,'')),'') is not null
  ) q
)
select jsonb_build_object('divisions',divisions.v,'facility_types',facility_types.v,'salesmen',salesmen.v,'areas',areas.v,'drivers',drivers.v,'vehicle_types',vehicle_types.v,'route_types',route_types.v)
from divisions,facility_types,salesmen,areas,drivers,vehicle_types,route_types;
$$;

grant execute on function public.dispatchops_dashboard_filter_meta() to anon,authenticated;
notify pgrst,'reload schema';
