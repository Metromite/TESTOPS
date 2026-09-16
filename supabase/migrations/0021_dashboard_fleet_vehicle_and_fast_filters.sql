-- DispatchOPS dashboard v21
-- Fast slicer metadata + Fleet Database authoritative vehicle type matching.
-- Apply this migration to every Supabase project used by DispatchOPS.

create or replace function public.dispatchops_dashboard_filter_meta()
returns jsonb
language sql
stable
set statement_timeout='10s'
as $$
with
divisions as (
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) v
  from (
    select distinct trim(division_desc) v
    from public.sap_invoice_facts
    where lower(trim(coalesce(division_desc,''))) not in
      ('','unknown','unclassified','n/a','na','not available','not available/unknown')
  ) q
),
facility_types as (
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) v
  from (
    select distinct trim(facility_type) v
    from public.sap_invoice_facts
    where lower(trim(coalesce(facility_type,''))) not in
      ('','unknown','unclassified','n/a','na','not available','not available/unknown')
  ) q
),
salesmen as (
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) v
  from (
    select distinct trim(salesman) v
    from public.sap_invoice_facts
    where nullif(trim(coalesce(salesman,'')),'') is not null
  ) q
),
areas as (
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) v
  from (
    select distinct trim(coalesce(nullif(name,''),area_name)) v
    from public.areas
    where nullif(trim(coalesce(nullif(name,''),area_name,'')),'') is not null
  ) q
),
drivers as (
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) v
  from (
    select distinct trim(coalesce(nullif(name,''),driver_name)) v
    from public.drivers
    where nullif(trim(coalesce(nullif(name,''),driver_name,'')),'') is not null
  ) q
),
vehicle_types as (
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) v
  from (
    select distinct trim(type) v
    from public.vehicles
    where nullif(trim(type),'') is not null
      and lower(trim(coalesce(status,''))) not in ('under service','inactive','retired')
  ) q
),
route_types as (
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) v
  from (
    select distinct trim(route_type) v
    from public.areas
    where nullif(trim(coalesce(route_type,'')),'') is not null
  ) q
)
select jsonb_build_object(
  'divisions',divisions.v,
  'facility_types',facility_types.v,
  'salesmen',salesmen.v,
  'areas',areas.v,
  'drivers',drivers.v,
  'vehicle_types',vehicle_types.v,
  'route_types',route_types.v
)
from divisions,facility_types,salesmen,areas,drivers,vehicle_types,route_types;
$$;

grant execute on function public.dispatchops_dashboard_filter_meta() to anon, authenticated;

-- Replace Home snapshot with Fleet Database authoritative vehicle matching.
-- vehicle_num and vehicle_type are resolved from public.vehicles using a
-- normalized vehicle number, so SAP's stale/misclassified vehicle type cannot
-- override the current Fleet Database record.
create or replace function public.dispatchops_dashboard_home_snapshot(
  p_start date default null,
  p_end date default null,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language sql
stable
set statement_timeout='20s'
as $$
with fleet as materialized (
  select
    id,
    number,
    type,
    regexp_replace(upper(trim(number)),'[^A-Z0-9]','','g') fleet_vehicle_key
  from public.vehicles
  where nullif(trim(number),'') is not null
),
base_raw as materialized (
  select
    s.invoice_no,s.invoice_date,s.dispatch_date,
    coalesce(s.driver_name,'') driver_name,
    coalesce(nullif(trim(f.number),''),nullif(trim(s.vehicle_num),''),'') vehicle_num,
    coalesce(nullif(trim(f.fleet_vehicle_key),''),coalesce(s.vehicle_key,'')) vehicle_key,
    coalesce(nullif(trim(f.type),''),coalesce(s.vehicle_type,'')) vehicle_type,
    coalesce(s.customer_name,'') customer_name,
    coalesce(s.area,'') area,
    coalesce(s.division_desc,'') division_desc,
    coalesce(s.facility_type,'') facility_type,
    coalesce(s.salesman,'') salesman,
    coalesce(s.boxes,0) boxes,
    coalesce(s.normal_boxes,0) normal_boxes,
    coalesce(s.freezer_boxes,0) freezer_boxes,
    coalesce(s.not_supplied_reason,'') not_supplied_reason
  from public.sap_invoice_facts s
  left join fleet f
    on f.fleet_vehicle_key = regexp_replace(
      upper(trim(coalesce(nullif(s.vehicle_num,''),s.vehicle_key,''))),
      '[^A-Z0-9]','','g'
    )
  where (p_start is null or s.dispatch_date>=p_start)
    and (p_end is null or s.dispatch_date<=p_end)
    and (nullif(p_filters->>'driver','') is null or s.driver_name=p_filters->>'driver')
    and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or s.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')))
    and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas')))
    and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
    and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
    and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman')))
    and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
    and lower(trim(coalesce(s.facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
    and (not exists(select 1 from public.drivers) or exists(select 1 from public.drivers d where coalesce(nullif(d.name,''),d.driver_name)=s.driver_name))
    and (not exists(select 1 from public.areas) or exists(select 1 from public.areas a where coalesce(nullif(a.name,''),a.area_name)=s.area)
        or nullif(trim(s.area),'') is null)
),
base as materialized (
  select *
  from base_raw s
  where (
    jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0
    and jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0
  )
  or (
    (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0
     or exists (
       select 1 from public.areas a
       where coalesce(nullif(a.name,''),a.area_name)=s.area
         and a.route_type in (select jsonb_array_elements_text(p_filters->'route_type'))
     ))
    and
    (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0
     or upper(trim(s.vehicle_type)) in (
       select upper(trim(jsonb_array_elements_text(p_filters->'vehicle_type')))
     ))
  )
),
stats as (
 select count(*)::int valid_invoices,
        coalesce(sum(boxes),0)::bigint total_boxes,
        coalesce(sum(normal_boxes),0)::bigint normal_boxes,
        coalesce(sum(freezer_boxes),0)::bigint freezer_boxes,
        count(distinct nullif(driver_name,''))::int active_drivers,
        count(*) filter(where not_supplied_reason<>'')::int not_supplied,
        count(distinct nullif(customer_name,''))::int unique_customers,
        round(avg((dispatch_date-invoice_date)) filter(
          where invoice_date is not null and dispatch_date is not null
            and dispatch_date>=invoice_date
        )::numeric,1) avg_lead
 from base
),
driver_groups as (
 select driver_name,
        min(nullif(vehicle_num,'')) vehicle_num,
        min(vehicle_type) vehicle_type,
        count(*)::int orders,
        coalesce(sum(boxes),0)::bigint boxes,
        coalesce(sum(freezer_boxes),0)::bigint freezer,
        count(*) filter(where not_supplied_reason<>'')::int not_supplied
 from base
 where driver_name<>'' group by driver_name
),
facility_groups as (
 select facility_type,count(*)::int n
 from base where facility_type<>'' group by facility_type
),
vehicle_type_groups as (
 select vehicle_type,
        coalesce(sum(normal_boxes),0)::bigint normal,
        coalesce(sum(freezer_boxes),0)::bigint freezer
 from base group by vehicle_type
),
scoped_vehicles as (
 select distinct vehicle_key from base where vehicle_key<>''
),
daily_routes as (
 select l.vehicle_key,l.visit_date,
        min(l.departed_at) filter(where l.is_depot) route_start,
        max(l.departed_at) filter(where not l.is_passthrough and not l.is_depot) route_end
 from public.landmark_visit_facts l
 join scoped_vehicles v on v.vehicle_key=l.vehicle_key
 where (p_start is null or l.visit_date>=p_start)
   and (p_end is null or l.visit_date<=p_end)
 group by l.vehicle_key,l.visit_date
),
route_stats as (
 select round(avg(extract(epoch from (route_end-route_start))/3600.0)
   filter(where route_start is not null and route_end is not null and route_end>route_start)::numeric,1) avg_route_hours
 from daily_routes
),
active_vehicle_count as (
 select count(distinct b.vehicle_key)::int n
 from base b
 where b.vehicle_key<>''
   and exists(select 1 from fleet v where v.fleet_vehicle_key=b.vehicle_key)
),
drivers_json as (
 select coalesce(jsonb_agg(jsonb_build_object(
   'driver_name',driver_name,
   'vehicle_num',coalesce(vehicle_num,'-'),
   'vehicle_type',vehicle_type,
   'orders',orders,'boxes',boxes,'freezer',freezer,'not_supplied',not_supplied
 ) order by boxes desc),'[]'::jsonb) v
 from driver_groups
),
driver_chart as (
 select jsonb_build_object(
   'labels',coalesce(jsonb_agg(driver_name order by boxes desc),'[]'::jsonb),
   'values',coalesce(jsonb_agg(boxes order by boxes desc),'[]'::jsonb)
 ) v from driver_groups
),
facility_chart as (
 select jsonb_build_object(
   'labels',coalesce(jsonb_agg(facility_type order by facility_type),'[]'::jsonb),
   'values',coalesce(jsonb_agg(n order by facility_type),'[]'::jsonb)
 ) v from facility_groups
),
vehicle_chart as (
 select jsonb_build_object(
   'labels',coalesce(jsonb_agg(vehicle_type order by vehicle_type),'[]'::jsonb),
   'normal',coalesce(jsonb_agg(normal order by vehicle_type),'[]'::jsonb),
   'freezer',coalesce(jsonb_agg(freezer order by vehicle_type),'[]'::jsonb)
 ) v from vehicle_type_groups
)
select jsonb_build_object(
 'kpis',jsonb_build_object(
   'valid_invoices',stats.valid_invoices,
   'total_boxes',stats.total_boxes,
   'freezer_boxes',stats.freezer_boxes,
   'normal_boxes',stats.normal_boxes,
   'active_drivers',stats.active_drivers,
   'avg_boxes_per_driver',case when stats.active_drivers>0 then round(stats.total_boxes::numeric/stats.active_drivers,1) else 0 end,
   'not_supplied',stats.not_supplied,
   'avg_lead_time_days',stats.avg_lead,
   'unique_customers',stats.unique_customers,
   'avg_route_hours',route_stats.avg_route_hours,
   'orders_per_driver',case when stats.active_drivers>0 then round(stats.valid_invoices::numeric/stats.active_drivers,1) else 0 end,
   'active_vehicles',active_vehicle_count.n
 ),
 'driver_overview',drivers_json.v,
 'charts',jsonb_build_object(
   'driver_boxes',driver_chart.v,
   'facility',facility_chart.v,
   'vantype',vehicle_chart.v,
   'returns',jsonb_build_object('delivered',stats.valid_invoices-stats.not_supplied,'not_supplied',stats.not_supplied)
 )
)
from stats,route_stats,active_vehicle_count,drivers_json,driver_chart,facility_chart,vehicle_chart;
$$;

grant execute on function public.dispatchops_dashboard_home_snapshot(date,date,jsonb) to anon, authenticated;
notify pgrst,'reload schema';
