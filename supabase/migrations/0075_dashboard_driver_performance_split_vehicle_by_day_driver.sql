-- Dashboard Driver Performance: keep shared vehicles split by route day/driver.
-- A vehicle can legitimately have different drivers on different days.
-- Never collapse those route days into one vehicle-level card.
create or replace function public.dispatchops_dashboard_driver_performance_snapshot(
  p_start date default null,
  p_end date default null,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language sql
stable
set statement_timeout='20s'
set search_path='public, pg_temp'
as $$
with sap as materialized (
  select
    s.vehicle_key,
    s.dispatch_date,
    trim(coalesce(s.driver_name,'')) driver_name,
    count(*) invoices,
    sum(coalesce(s.boxes,0)) boxes,
    sum(coalesce(s.freezer_boxes,0)) freezer
  from public.sap_invoice_facts s
  where (p_start is null or s.dispatch_date>=p_start)
    and (p_end is null or s.dispatch_date<=p_end)
    and (nullif(p_filters->>'driver','') is null or s.driver_name=p_filters->>'driver')
    and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or s.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')))
    and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas')))
    and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
    and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or s.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type')))
    and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
    and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman')))
    and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
    and lower(trim(coalesce(s.facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
  group by s.vehicle_key,s.dispatch_date,trim(coalesce(s.driver_name,''))
),
scope as materialized (
  select distinct vehicle_key from sap where nullif(vehicle_key,'') is not null
),
unique_vehicle_driver as materialized (
  select vehicle_key,max(driver_name) driver_name,count(distinct nullif(driver_name,'')) driver_count
  from sap
  group by vehicle_key
),
lm as materialized (
  select
    l.vehicle_key,
    l.visit_date,
    trim(coalesce(l.driver_name,'')) driver_name,
    l.minutes,
    l.is_passthrough,
    l.is_depot,
    coalesce(l.departed_at,public.dispatchops_landmark_timestamp(l.departure)) dep_ts
  from public.landmark_visit_facts l
  join scope x on x.vehicle_key=l.vehicle_key
  where (p_start is null or l.visit_date>=p_start)
    and (p_end is null or l.visit_date<=p_end)
),
daily_raw as (
  select
    l.vehicle_key,
    l.visit_date,
    nullif(l.driver_name,'') driver_name,
    count(*) filter(where not l.is_passthrough and not l.is_depot) stops,
    avg(l.minutes) filter(where not l.is_passthrough and not l.is_depot) avg_stop,
    count(*) filter(where l.is_passthrough) passthru,
    min(l.dep_ts) filter(where l.is_depot) route_start,
    max(l.dep_ts) filter(where not l.is_passthrough and not l.is_depot) route_end
  from lm l
  group by l.vehicle_key,l.visit_date,nullif(l.driver_name,'')
),
daily as (
  select
    d.vehicle_key,
    d.visit_date,
    coalesce(
      d.driver_name,
      sd.driver_name,
      case when u.driver_count=1 then u.driver_name end
    ) display_driver,
    d.stops,d.avg_stop,d.passthru,d.route_start,d.route_end
  from daily_raw d
  left join lateral (
    select s.driver_name
    from sap s
    where s.vehicle_key=d.vehicle_key
      and s.dispatch_date=d.visit_date
      and nullif(s.driver_name,'') is not null
    order by s.invoices desc,s.driver_name
    limit 1
  ) sd on true
  left join unique_vehicle_driver u on u.vehicle_key=d.vehicle_key
),
manual as (
  select distinct on (vehicle_key) vehicle_key,coalesce(sap_driver,'') sap_driver
  from public.vehicle_driver_manual_mappings
  order by vehicle_key
),
cards as (
  select
    d.vehicle_key,
    d.visit_date,
    coalesce(nullif(d.display_driver,''),nullif(m.sap_driver,''),'Unknown') display_driver,
    d.route_start,
    d.route_end,
    d.stops::int stops,
    round(coalesce(d.avg_stop,0)) avg_stop,
    d.passthru::int passthru_count,
    sd.invoices,
    sd.boxes,
    sd.freezer,
    coalesce(extract(epoch from (d.route_end-d.route_start))/3600.0,0) _hours
  from daily d
  left join manual m on m.vehicle_key=d.vehicle_key
  left join lateral (
    select
      coalesce(sum(s.invoices),0)::int invoices,
      coalesce(sum(s.boxes),0)::bigint boxes,
      coalesce(sum(s.freezer),0)::bigint freezer
    from sap s
    where s.vehicle_key=d.vehicle_key
      and s.dispatch_date=d.visit_date
      and (nullif(d.display_driver,'') is null or s.driver_name=d.display_driver)
  ) sd on true
  where (d.stops > 0 or d.route_start is not null or d.route_end is not null)
    and (
      (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 and nullif(p_filters->>'driver','') is null)
      or coalesce(nullif(d.display_driver,''),nullif(m.sap_driver,''),'Unknown') in (select jsonb_array_elements_text(coalesce(p_filters->'drivers','[]'::jsonb)))
      or (nullif(p_filters->>'driver','') is not null and coalesce(nullif(d.display_driver,''),nullif(m.sap_driver,''),'Unknown')=p_filters->>'driver')
    )
),
final as (
  select
    c.vehicle_key||':'||c.visit_date||':'||coalesce(nullif(c.display_driver,''),'unknown') vehicle_key,
    c.display_driver,
    c.vehicle_key vehicle_num,
    case when nullif(c.display_driver,'') is not null and c.display_driver<>'Unknown' then 'vehicle' else 'none' end match_method,
    c.route_start,
    c.route_end,
    case when c._hours>0 then floor(c._hours)::int||'h '||floor(mod(c._hours*60,60))::int||'m' else '0h 0m' end route_duration_hm,
    c.stops,
    floor(c.avg_stop/60)::int||'h '||floor(mod(c.avg_stop,60))::int||'m' avg_stop_hm,
    c.passthru_count,
    jsonb_build_object('invoices',c.invoices,'boxes',c.boxes,'freezer',c.freezer) sap_orders,
    c._hours
  from cards c
),
agg as (
  select
    coalesce(jsonb_agg(to_jsonb(f)-'_hours' order by f.stops desc,f.display_driver,f.route_start),'[]'::jsonb) cards,
    count(*)::int gps_vehicles,
    coalesce(sum(stops),0)::int total_stops,
    round(avg(_hours) filter(where _hours>0)::numeric,2) avg_hours
  from final f
)
select jsonb_build_object(
  'standalone_mode',false,
  'validation_results','[]'::jsonb,
  'kpis',jsonb_build_object(
    'gps_vehicles',agg.gps_vehicles,
    'total_gps_stops',agg.total_stops,
    'avg_stops_per_vehicle',case when agg.gps_vehicles>0 then round(agg.total_stops::numeric/agg.gps_vehicles,2) else 0 end,
    'avg_route_duration_hrs',agg.avg_hours,
    'avg_stop_duration','',
    'sap_orders',(select coalesce(sum(invoices),0) from sap),
    'sap_total_boxes',(select coalesce(sum(boxes),0) from sap)
  ),
  'chart_stops',jsonb_build_object(
    'labels',(select coalesce(jsonb_agg(display_driver order by stops desc,display_driver),'[]'::jsonb) from final),
    'values',(select coalesce(jsonb_agg(stops order by stops desc,display_driver),'[]'::jsonb) from final)
  ),
  'chart_route_hours',jsonb_build_object(
    'labels',(select coalesce(jsonb_agg(display_driver order by _hours desc,display_driver),'[]'::jsonb) from final),
    'values',(select coalesce(jsonb_agg(_hours order by _hours desc,display_driver),'[]'::jsonb) from final)
  ),
  'route_cards',agg.cards
) from agg;
$$;

grant execute on function public.dispatchops_dashboard_driver_performance_snapshot(date,date,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
