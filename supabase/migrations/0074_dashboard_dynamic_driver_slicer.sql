-- Dashboard Driver slicer: driver options follow the active non-driver filters.
-- Drivers remain Fleet-authoritative and only drivers with valid SAP data in
-- the current date/filter context are returned.
create or replace function public.dispatchops_dashboard_driver_options_dynamic(
  p_start date default null,
  p_end date default null,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language sql
stable
set statement_timeout = '15s'
set search_path = 'public, pg_temp'
as $function$
with fleet as (
  select distinct on (regexp_replace(upper(trim(coalesce(nullif(v.number,''),v.vehicle_number,''))),'[^A-Z0-9]','','g'))
    regexp_replace(upper(trim(coalesce(nullif(v.number,''),v.vehicle_number,''))),'[^A-Z0-9]','','g') vehicle_key,
    regexp_replace(trim(coalesce(nullif(v.number,''),v.vehicle_number,'')),'[^0-9]','','g') vehicle_digits,
    trim(coalesce(nullif(v.number,''),v.vehicle_number,'')) vehicle_num,
    trim(coalesce(nullif(v.type,''),v.vehicle_type,'')) raw_type
  from public.vehicles v
  where nullif(trim(coalesce(nullif(v.number,''),v.vehicle_number,'')),'') is not null
  order by regexp_replace(upper(trim(coalesce(nullif(v.number,''),v.vehicle_number,''))),'[^A-Z0-9]','','g'), v.updated_at desc nulls last
),
fleet_drivers as (
  select distinct on (regexp_replace(upper(trim(coalesce(nullif(d.code,''),d.driver_code,''))),'[^A-Z0-9]','','g'))
    regexp_replace(upper(trim(coalesce(nullif(d.code,''),d.driver_code,''))),'[^A-Z0-9]','','g') driver_key,
    trim(coalesce(nullif(d.code,''),d.driver_code,'')) code,
    trim(coalesce(nullif(d.name,''),d.driver_name,'')) name
  from public.drivers d
  where nullif(trim(coalesce(nullif(d.code,''),d.driver_code,'')),'') is not null
    and nullif(trim(coalesce(nullif(d.name,''),d.driver_name,'')),'') is not null
  order by regexp_replace(upper(trim(coalesce(nullif(d.code,''),d.driver_code,''))),'[^A-Z0-9]','','g'), d.updated_at desc nulls last
),
valid as (
  select d.code, d.name
  from public.sap_invoice_facts s
  join fleet_drivers d on d.driver_key = regexp_replace(upper(trim(coalesce(s.driver_code,''))),'[^A-Z0-9]','','g')
  left join fleet f on f.vehicle_key = regexp_replace(upper(trim(coalesce(nullif(s.vehicle_num,''),s.vehicle_key,''))),'[^A-Z0-9]','','g')
    or (length(f.vehicle_digits)>=4 and f.vehicle_digits=regexp_replace(trim(coalesce(nullif(s.vehicle_num,''),s.vehicle_key,'')),'[^0-9]','','g'))
  where (p_start is null or s.dispatch_date >= p_start)
    and (p_end is null or s.dispatch_date <= p_end)
    and coalesce(s.boxes,0) > 0
    and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
    and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas')))
    and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
    and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
    and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman')))
    and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or
      (case when regexp_replace(upper(coalesce(nullif(f.raw_type,''),nullif(s.vehicle_type,''),'')),'[^A-Z0-9]','','g') like '%PICKUP%' then 'Pickup' else 'Van' end)
      in (select initcap(lower(trim(jsonb_array_elements_text(p_filters->'vehicle_type')))))
    )
)
select jsonb_build_object(
  'drivers', coalesce((select jsonb_agg(code order by code) from (select distinct code from valid) x),'[]'::jsonb),
  'driver_names', coalesce((select jsonb_agg(jsonb_build_object('code',code,'name',name) order by name,code) from (select distinct code,name from valid) x),'[]'::jsonb)
);
$function$;

grant execute on function public.dispatchops_dashboard_driver_options_dynamic(date,date,jsonb) to anon, authenticated;
