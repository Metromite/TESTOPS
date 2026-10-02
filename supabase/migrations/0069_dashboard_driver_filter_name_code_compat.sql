-- Keep the Dashboard driver slicer tied to Fleet Database identity.
-- Driver filters may arrive as Fleet code (e.g. D040) or Fleet name
-- (e.g. Hussain Mohammed). Matching is normalized so harmless casing/spacing
-- differences cannot turn a valid driver selection into a zero-result dashboard.
create or replace function public.dispatchops_dashboard_home_snapshot(
  p_start date default null,
  p_end date default null,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language sql
stable
set statement_timeout to '20s'
set search_path to 'public','pg_temp'
as $function$
with fleet as (
  select distinct on (regexp_replace(upper(trim(coalesce(v.number,v.vehicle_number,''))),'[^A-Z0-9]','','g'))
    regexp_replace(upper(trim(coalesce(v.number,v.vehicle_number,''))),'[^A-Z0-9]','','g') vehicle_key,
    trim(coalesce(nullif(v.type,''),nullif(v.vehicle_type,''),'')) vehicle_type
  from public.vehicles v
  where nullif(trim(coalesce(v.number,v.vehicle_number,'')),'') is not null
  order by regexp_replace(upper(trim(coalesce(v.number,v.vehicle_number,''))),'[^A-Z0-9]','','g'), v.updated_at desc nulls last
),
base as materialized (
  select s.invoice_no,s.invoice_date,s.dispatch_date,
    coalesce(s.driver_name,'') driver_name,
    coalesce(s.driver_code,'') driver_code,
    coalesce(s.vehicle_num,'') vehicle_num,
    coalesce(nullif(s.vehicle_key,''),regexp_replace(upper(trim(coalesce(s.vehicle_num,''))),'[^A-Z0-9]','','g')) vehicle_key,
    coalesce(nullif(f.vehicle_type,''),nullif(s.vehicle_type,''),'') vehicle_type,
    coalesce(s.customer_name,'') customer_name,coalesce(s.area,'') area,
    coalesce(s.division_desc,'') division_desc,coalesce(s.facility_type,'') facility_type,
    coalesce(s.salesman,'') salesman,coalesce(s.boxes,0) boxes,
    coalesce(s.normal_boxes,0) normal_boxes,coalesce(s.freezer_boxes,0) freezer_boxes,
    coalesce(s.not_supplied_reason,'') not_supplied_reason
  from public.sap_invoice_facts s
  left join fleet f on f.vehicle_key=regexp_replace(upper(trim(coalesce(s.vehicle_num,''))),'[^A-Z0-9]','','g')
  where (p_start is null or s.dispatch_date>=p_start)
    and (p_end is null or s.dispatch_date<=p_end)
    and (
      jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0
      or exists (
        select 1 from jsonb_array_elements_text(p_filters->'drivers') selected_driver
        where upper(trim(selected_driver))=upper(trim(coalesce(s.driver_name,'')))
           or upper(trim(selected_driver))=upper(trim(coalesce(s.driver_code,'')))
           or exists (
             select 1 from public.drivers d
             where upper(trim(coalesce(nullif(d.name,''),d.driver_name,'')))=upper(trim(coalesce(s.driver_name,'')))
               and upper(trim(coalesce(nullif(d.code,''),d.driver_code,'')))=upper(trim(selected_driver))
           )
      )
    )
    and (nullif(p_filters->>'driver','') is null or upper(trim(s.driver_name))=upper(trim(p_filters->>'driver')) or upper(trim(s.driver_code))=upper(trim(p_filters->>'driver')))
    and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas')))
    and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
    and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
    and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman')))
    and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or coalesce(nullif(f.vehicle_type,''),nullif(s.vehicle_type,''),'') in (select jsonb_array_elements_text(p_filters->'vehicle_type')))
    and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 or exists(select 1 from public.areas a where coalesce(nullif(a.name,''),a.area_name)=s.area and a.route_type in (select jsonb_array_elements_text(p_filters->'route_type'))))
    and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
),
stats as (
  select count(*)::int valid_invoices,coalesce(sum(boxes),0)::bigint total_boxes,
    coalesce(sum(normal_boxes),0)::bigint normal_boxes,coalesce(sum(freezer_boxes),0)::bigint freezer_boxes,
    count(distinct nullif(driver_name,''))::int active_drivers,count(*) filter(where not_supplied_reason<>'')::int not_supplied,
    count(distinct nullif(customer_name,''))::int unique_customers,
    round(avg((dispatch_date-invoice_date)) filter(where invoice_date is not null and dispatch_date is not null and dispatch_date>=invoice_date)::numeric,1) avg_lead
  from base
),
driver_groups as (
  select driver_name,min(nullif(vehicle_num,'')) vehicle_num,min(vehicle_type) vehicle_type,count(*)::int orders,
    coalesce(sum(boxes),0)::bigint boxes,coalesce(sum(freezer_boxes),0)::bigint freezer,count(*) filter(where not_supplied_reason<>'')::int not_supplied
  from base where driver_name<>'' group by driver_name
),
facility_groups as (select facility_type,count(*)::int n from base where facility_type<>'' group by facility_type),
vehicle_type_groups as (
  select vehicle_type,coalesce(sum(normal_boxes),0)::bigint normal,coalesce(sum(freezer_boxes),0)::bigint freezer
  from base where vehicle_type<>'' group by vehicle_type
),
scoped_vehicles as (select distinct vehicle_key from base where vehicle_key<>''),
daily_routes as (
  select l.vehicle_key,min(l.departed_at) filter(where l.is_depot) route_start,max(l.departed_at) filter(where not l.is_passthrough and not l.is_depot) route_end
  from public.landmark_visit_facts l join scoped_vehicles v on v.vehicle_key=l.vehicle_key
  where (p_start is null or l.visit_date>=p_start) and (p_end is null or l.visit_date<=p_end)
  group by l.vehicle_key,l.visit_date
),
route_stats as (
  select round(avg(extract(epoch from (route_end-route_start))/3600.0) filter(where route_start is not null and route_end is not null and route_end>route_start)::numeric,1) avg_route_hours
  from daily_routes
),
active_vehicle_count as (
  select count(distinct b.vehicle_key)::int n from base b where b.vehicle_key<>'' and exists(select 1 from fleet f where f.vehicle_key=b.vehicle_key)
),
drivers_json as (
  select coalesce(jsonb_agg(jsonb_build_object('driver_name',driver_name,'vehicle_num',coalesce(vehicle_num,'-'),'vehicle_type',vehicle_type,'orders',orders,'boxes',boxes,'freezer',freezer,'not_supplied',not_supplied) order by boxes desc),'[]'::jsonb) v from driver_groups
),
driver_chart as (
  select jsonb_build_object('labels',coalesce(jsonb_agg(driver_name order by boxes desc),'[]'::jsonb),'values',coalesce(jsonb_agg(boxes order by boxes desc),'[]'::jsonb)) v from driver_groups
),
facility_chart as (
  select jsonb_build_object('labels',coalesce(jsonb_agg(facility_type order by facility_type),'[]'::jsonb),'values',coalesce(jsonb_agg(n order by facility_type),'[]'::jsonb)) v from facility_groups
),
vehicle_chart as (
  select jsonb_build_object('labels',coalesce(jsonb_agg(vehicle_type order by vehicle_type),'[]'::jsonb),'normal',coalesce(jsonb_agg(normal order by vehicle_type),'[]'::jsonb),'freezer',coalesce(jsonb_agg(freezer order by vehicle_type),'[]'::jsonb)) v from vehicle_type_groups
)
select jsonb_build_object(
  'kpis',jsonb_build_object('valid_invoices',stats.valid_invoices,'total_boxes',stats.total_boxes,'freezer_boxes',stats.freezer_boxes,'normal_boxes',stats.normal_boxes,'active_drivers',stats.active_drivers,'avg_boxes_per_driver',case when stats.active_drivers>0 then round(stats.total_boxes::numeric/stats.active_drivers,1) else 0 end,'not_supplied',stats.not_supplied,'avg_lead_time_days',stats.avg_lead,'unique_customers',stats.unique_customers,'avg_route_hours',route_stats.avg_route_hours,'orders_per_driver',case when stats.active_drivers>0 then round(stats.valid_invoices::numeric/stats.active_drivers,1) else 0 end,'active_vehicles',active_vehicle_count.n),
  'driver_overview',drivers_json.v,
  'charts',jsonb_build_object('driver_boxes',driver_chart.v,'facility',facility_chart.v,'vantype',vehicle_chart.v,'returns',jsonb_build_object('delivered',stats.valid_invoices-stats.not_supplied,'not_supplied',stats.not_supplied))
)
from stats,route_stats,active_vehicle_count,drivers_json,driver_chart,facility_chart,vehicle_chart;
$function$;

grant execute on function public.dispatchops_dashboard_home_snapshot(date,date,jsonb) to anon, authenticated;
