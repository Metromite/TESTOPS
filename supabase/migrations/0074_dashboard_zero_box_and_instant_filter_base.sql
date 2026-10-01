create or replace function public.dispatchops_dashboard_home_snapshot(
  p_start date default null,
  p_end date default null,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language sql stable set statement_timeout='20s'
as $$
with base as materialized (
  select
    s.invoice_no,
    s.invoice_date,
    s.dispatch_date,
    coalesce(d.name, nullif(trim(s.driver_name),''), '') as driver_name,
    coalesce(s.vehicle_num,'') as vehicle_num,
    coalesce(nullif(trim(coalesce(v.number,'')),''), nullif(trim(coalesce(s.vehicle_key,'')),''), '') as vehicle_key,
    case when regexp_replace(upper(coalesce(v.type,'')),'[^A-Z0-9]','','g') like '%PICKUP%' then 'Pickup' else 'Van' end as vehicle_type,
    coalesce(s.customer_name,'') as customer_name,
    coalesce(s.area,'') as area,
    coalesce(s.division_desc,'') as division_desc,
    coalesce(s.facility_type,'') as facility_type,
    coalesce(s.salesman,'') as salesman,
    coalesce(s.boxes,0) as boxes,
    coalesce(s.normal_boxes,0) as normal_boxes,
    coalesce(s.freezer_boxes,0) as freezer_boxes,
    coalesce(s.not_supplied_reason,'') as not_supplied_reason
  from public.sap_invoice_facts s
  left join lateral (
    select d.name
    from public.drivers d
    where (nullif(trim(s.driver_code),'') is not null and upper(trim(coalesce(d.code,'')))=upper(trim(s.driver_code)))
       or (nullif(trim(s.driver_code),'') is null and lower(trim(coalesce(d.name,'')))=lower(trim(coalesce(s.driver_name,''))))
    order by case when upper(trim(coalesce(d.code,'')))=upper(trim(coalesce(s.driver_code,''))) then 0 else 1 end
    limit 1
  ) d on true
  left join lateral (
    select v.number, v.type
    from public.vehicles v
    where regexp_replace(upper(trim(coalesce(nullif(v.number,''),v.vehicle_number,''))),'[^A-Z0-9]','','g') =
          regexp_replace(upper(trim(coalesce(nullif(s.vehicle_num,''),s.vehicle_key,''))),'[^A-Z0-9]','','g')
       or (
         regexp_replace(coalesce(s.vehicle_num,''),'[^0-9]','','g') <> '' and
         regexp_replace(coalesce(v.number,v.vehicle_number,''),'[^0-9]','','g') = regexp_replace(coalesce(s.vehicle_num,''),'[^0-9]','','g')
       )
    order by v.updated_at desc nulls last
    limit 1
  ) v on true
  where (p_start is null or s.dispatch_date >= p_start)
    and (p_end is null or s.dispatch_date <= p_end)
    and coalesce(s.boxes,0) > 0
    and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
    and (nullif(p_filters->>'driver','') is null or lower(trim(coalesce(d.name,'')))=lower(trim(p_filters->>'driver')))
    and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or lower(trim(coalesce(d.name,''))) in (select lower(trim(value)) from jsonb_array_elements_text(p_filters->'drivers')))
    and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas')))
    and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
    and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
    and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman')))
    and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or (case when regexp_replace(upper(coalesce(v.type,'')),'[^A-Z0-9]','','g') like '%PICKUP%' then 'Pickup' else 'Van' end) in (select jsonb_array_elements_text(p_filters->'vehicle_type')))
    and d.name is not null
),
stats as (
  select count(*)::int valid_invoices,
         coalesce(sum(boxes),0)::bigint total_boxes,
         coalesce(sum(normal_boxes),0)::bigint normal_boxes,
         coalesce(sum(freezer_boxes),0)::bigint freezer_boxes,
         count(distinct nullif(driver_name,''))::int active_drivers,
         count(*) filter(where not_supplied_reason<>'')::int not_supplied,
         count(distinct nullif(customer_name,''))::int unique_customers,
         round(avg((dispatch_date-invoice_date)) filter(where invoice_date is not null and dispatch_date is not null and dispatch_date>=invoice_date)::numeric,1) avg_lead
  from base
),
driver_groups as (
  select driver_name,min(nullif(vehicle_num,'')) vehicle_num,min(vehicle_type) vehicle_type,
         count(*)::int orders,coalesce(sum(boxes),0)::bigint boxes,
         coalesce(sum(freezer_boxes),0)::bigint freezer,
         count(*) filter(where not_supplied_reason<>'')::int not_supplied
  from base where driver_name<>'' group by driver_name
),
facility_groups as (select facility_type,count(*)::int n from base where facility_type<>'' group by facility_type),
vehicle_type_groups as (select vehicle_type,coalesce(sum(normal_boxes),0)::bigint normal,coalesce(sum(freezer_boxes),0)::bigint freezer from base group by vehicle_type),
scoped_vehicles as (select distinct vehicle_key from base where vehicle_key<>''),
daily_routes as (
  select l.vehicle_key,l.visit_date,
         min(l.departed_at) filter(where l.is_depot) route_start,
         max(l.departed_at) filter(where not l.is_passthrough and not l.is_depot) route_end
  from public.landmark_visit_facts l join scoped_vehicles sv on sv.vehicle_key=l.vehicle_key
  where (p_start is null or l.visit_date>=p_start) and (p_end is null or l.visit_date<=p_end)
  group by l.vehicle_key,l.visit_date
),
route_stats as (
  select round(avg(extract(epoch from (route_end-route_start))/3600.0) filter(where route_start is not null and route_end is not null and route_end>route_start)::numeric,1) avg_route_hours
  from daily_routes
),
active_vehicle_count as (select count(distinct b.vehicle_key)::int n from base b where b.vehicle_key<>''),
drivers_json as (select coalesce(jsonb_agg(jsonb_build_object('driver_name',driver_name,'vehicle_num',coalesce(vehicle_num,'-'),'vehicle_type',vehicle_type,'orders',orders,'boxes',boxes,'freezer',freezer,'not_supplied',not_supplied) order by boxes desc),'[]'::jsonb) v from driver_groups),
driver_chart as (select jsonb_build_object('labels',coalesce(jsonb_agg(driver_name order by boxes desc),'[]'::jsonb),'values',coalesce(jsonb_agg(boxes order by boxes desc),'[]'::jsonb)) v from driver_groups),
facility_chart as (select jsonb_build_object('labels',coalesce(jsonb_agg(facility_type order by facility_type),'[]'::jsonb),'values',coalesce(jsonb_agg(n order by facility_type),'[]'::jsonb)) v from facility_groups),
vehicle_chart as (select jsonb_build_object('labels',coalesce(jsonb_agg(vehicle_type order by vehicle_type),'[]'::jsonb),'normal',coalesce(jsonb_agg(normal order by vehicle_type),'[]'::jsonb),'freezer',coalesce(jsonb_agg(freezer order by vehicle_type),'[]'::jsonb)) v from vehicle_type_groups)
select jsonb_build_object(
 'kpis',jsonb_build_object(
   'valid_invoices',stats.valid_invoices,'total_boxes',stats.total_boxes,'freezer_boxes',stats.freezer_boxes,'normal_boxes',stats.normal_boxes,
   'active_drivers',stats.active_drivers,'avg_boxes_per_driver',case when stats.active_drivers>0 then round(stats.total_boxes::numeric/stats.active_drivers,1) else 0 end,
   'not_supplied',stats.not_supplied,'avg_lead_time_days',stats.avg_lead,'unique_customers',stats.unique_customers,'avg_route_hours',route_stats.avg_route_hours,
   'orders_per_driver',case when stats.active_drivers>0 then round(stats.valid_invoices::numeric/stats.active_drivers,1) else 0 end,'active_vehicles',active_vehicle_count.n),
 'driver_overview',drivers_json.v,
 'charts',jsonb_build_object('driver_boxes',driver_chart.v,'facility',facility_chart.v,'vantype',vehicle_chart.v,'returns',jsonb_build_object('delivered',stats.valid_invoices-stats.not_supplied,'not_supplied',stats.not_supplied))
) from stats,route_stats,active_vehicle_count,drivers_json,driver_chart,facility_chart,vehicle_chart;
$$;

grant execute on function public.dispatchops_dashboard_home_snapshot(date,date,jsonb) to anon, authenticated;
