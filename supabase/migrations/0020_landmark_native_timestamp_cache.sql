-- v20: parse Landmark text timestamps once on ingest, not on every dashboard query.
create or replace function public.dispatchops_fill_landmark_native_timestamps()
returns trigger language plpgsql as $$
begin
  if new.arrived_at is null and nullif(trim(coalesce(new.arrival,'')),'') is not null then
    new.arrived_at := public.dispatchops_landmark_timestamp(new.arrival);
  end if;
  if new.departed_at is null and nullif(trim(coalesce(new.departure,'')),'') is not null then
    new.departed_at := public.dispatchops_landmark_timestamp(new.departure);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_landmark_native_timestamps on public.landmark_visit_facts;
create trigger trg_landmark_native_timestamps
before insert or update of arrival,departure on public.landmark_visit_facts
for each row execute function public.dispatchops_fill_landmark_native_timestamps();

update public.landmark_visit_facts
set arrived_at = coalesce(arrived_at,public.dispatchops_landmark_timestamp(arrival)),
    departed_at = coalesce(departed_at,public.dispatchops_landmark_timestamp(departure))
where arrived_at is null or departed_at is null;

create index if not exists idx_lm_vehicle_visit_departed_v20 on public.landmark_visit_facts(vehicle_key,visit_date,departed_at);
analyze public.landmark_visit_facts;

-- Once native timestamps are populated, remove per-query text parsing from Home.
create or replace function public.dispatchops_dashboard_home_snapshot(p_start date default null,p_end date default null,p_filters jsonb default '{}'::jsonb)
returns jsonb language sql stable set statement_timeout='20s' as $$
with base as materialized (
 select s.invoice_no,s.invoice_date,s.dispatch_date,coalesce(s.driver_name,'') driver_name,coalesce(s.vehicle_num,'') vehicle_num,coalesce(s.vehicle_key,'') vehicle_key,coalesce(s.vehicle_type,'') vehicle_type,coalesce(s.customer_name,'') customer_name,coalesce(s.area,'') area,coalesce(s.division_desc,'') division_desc,coalesce(s.facility_type,'') facility_type,coalesce(s.salesman,'') salesman,coalesce(s.boxes,0) boxes,coalesce(s.normal_boxes,0) normal_boxes,coalesce(s.freezer_boxes,0) freezer_boxes,coalesce(s.not_supplied_reason,'') not_supplied_reason
 from public.sap_invoice_facts s
 where (p_start is null or s.dispatch_date>=p_start) and (p_end is null or s.dispatch_date<=p_end)
 and (nullif(p_filters->>'driver','') is null or s.driver_name=p_filters->>'driver')
 and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or s.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')))
 and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas')))
 and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
 and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
 and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman')))
 and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
 and (lower(trim(coalesce(s.facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') or lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown'))
 and (not exists(select 1 from public.drivers) or exists(select 1 from public.drivers d where coalesce(nullif(d.name,''),d.driver_name)=s.driver_name))
 and (not exists(select 1 from public.areas) or exists(select 1 from public.areas a where coalesce(nullif(a.name,''),a.area_name)=s.area))
 and ((jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 and jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0) or exists(select 1 from public.areas a where coalesce(nullif(a.name,''),a.area_name)=s.area and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 or a.route_type in (select jsonb_array_elements_text(p_filters->'route_type'))) and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or a.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type')))))
),stats as (select count(*)::int valid_invoices,coalesce(sum(boxes),0)::bigint total_boxes,coalesce(sum(normal_boxes),0)::bigint normal_boxes,coalesce(sum(freezer_boxes),0)::bigint freezer_boxes,count(distinct nullif(driver_name,''))::int active_drivers,count(*) filter(where not_supplied_reason<>'')::int not_supplied,count(distinct nullif(customer_name,''))::int unique_customers,round(avg((dispatch_date-invoice_date)) filter(where invoice_date is not null and dispatch_date is not null and dispatch_date>=invoice_date)::numeric,1) avg_lead from base),
driver_groups as (select driver_name,min(nullif(vehicle_num,'')) vehicle_num,min(vehicle_type) vehicle_type,count(*)::int orders,coalesce(sum(boxes),0)::bigint boxes,coalesce(sum(freezer_boxes),0)::bigint freezer,count(*) filter(where not_supplied_reason<>'')::int not_supplied from base where driver_name<>'' group by driver_name),
facility_groups as (select facility_type,count(*)::int n from base where facility_type<>'' group by facility_type),vehicle_type_groups as (select vehicle_type,coalesce(sum(normal_boxes),0)::bigint normal,coalesce(sum(freezer_boxes),0)::bigint freezer from base group by vehicle_type),scoped_vehicles as (select distinct vehicle_key from base where vehicle_key<>''),
daily_routes as (select l.vehicle_key,l.visit_date,min(l.departed_at) filter(where l.is_depot) route_start,max(l.departed_at) filter(where not l.is_passthrough and not l.is_depot) route_end from public.landmark_visit_facts l join scoped_vehicles v on v.vehicle_key=l.vehicle_key where (p_start is null or l.visit_date>=p_start) and (p_end is null or l.visit_date<=p_end) group by l.vehicle_key,l.visit_date),
route_stats as (select round(avg(extract(epoch from (route_end-route_start))/3600.0) filter(where route_start is not null and route_end is not null and route_end>route_start)::numeric,1) avg_route_hours from daily_routes),
active_vehicle_count as (select count(distinct b.vehicle_key)::int n from base b where b.vehicle_key<>'' and exists(select 1 from public.vehicles v where regexp_replace(upper(trim(coalesce(nullif(v.number,''),v.vehicle_number,''))),'[^A-Z0-9]','','g')=b.vehicle_key)),
drivers_json as (select coalesce(jsonb_agg(jsonb_build_object('driver_name',driver_name,'vehicle_num',coalesce(vehicle_num,'-'),'vehicle_type',vehicle_type,'orders',orders,'boxes',boxes,'freezer',freezer,'not_supplied',not_supplied) order by boxes desc),'[]'::jsonb) v from driver_groups),driver_chart as (select jsonb_build_object('labels',coalesce(jsonb_agg(driver_name order by boxes desc),'[]'::jsonb),'values',coalesce(jsonb_agg(boxes order by boxes desc),'[]'::jsonb)) v from driver_groups),facility_chart as (select jsonb_build_object('labels',coalesce(jsonb_agg(facility_type order by facility_type),'[]'::jsonb),'values',coalesce(jsonb_agg(n order by facility_type),'[]'::jsonb)) v from facility_groups),vehicle_chart as (select jsonb_build_object('labels',coalesce(jsonb_agg(vehicle_type order by vehicle_type),'[]'::jsonb),'normal',coalesce(jsonb_agg(normal order by vehicle_type),'[]'::jsonb),'freezer',coalesce(jsonb_agg(freezer order by vehicle_type),'[]'::jsonb)) v from vehicle_type_groups)
select jsonb_build_object('kpis',jsonb_build_object('valid_invoices',stats.valid_invoices,'total_boxes',stats.total_boxes,'freezer_boxes',stats.freezer_boxes,'normal_boxes',stats.normal_boxes,'active_drivers',stats.active_drivers,'avg_boxes_per_driver',case when stats.active_drivers>0 then round(stats.total_boxes::numeric/stats.active_drivers,1) else 0 end,'not_supplied',stats.not_supplied,'avg_lead_time_days',stats.avg_lead,'unique_customers',stats.unique_customers,'avg_route_hours',route_stats.avg_route_hours,'orders_per_driver',case when stats.active_drivers>0 then round(stats.valid_invoices::numeric/stats.active_drivers,1) else 0 end,'active_vehicles',active_vehicle_count.n),'driver_overview',drivers_json.v,'charts',jsonb_build_object('driver_boxes',driver_chart.v,'facility',facility_chart.v,'vantype',vehicle_chart.v,'returns',jsonb_build_object('delivered',stats.valid_invoices-stats.not_supplied,'not_supplied',stats.not_supplied))) from stats,route_stats,active_vehicle_count,drivers_json,driver_chart,facility_chart,vehicle_chart;
$$;

grant execute on function public.dispatchops_dashboard_home_snapshot(date,date,jsonb) to anon,authenticated;

-- Driver Performance also reads only native timestamps now.
create or replace function public.dispatchops_dashboard_driver_performance_snapshot(p_start date default null,p_end date default null,p_filters jsonb default '{}'::jsonb)
returns jsonb language sql stable set statement_timeout='20s' as $$
with sap as materialized (
 select s.vehicle_key,min(s.driver_name) driver_name,count(*) invoices,sum(coalesce(s.boxes,0)) boxes,sum(coalesce(s.freezer_boxes,0)) freezer
 from public.sap_invoice_facts s where (p_start is null or s.dispatch_date>=p_start) and (p_end is null or s.dispatch_date<=p_end)
 and (nullif(p_filters->>'driver','') is null or s.driver_name=p_filters->>'driver') and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or s.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')))
 and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas'))) and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
 and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or s.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type'))) and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
 and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman'))) and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 or exists(select 1 from public.areas a where (coalesce(nullif(a.code,''),a.area_code)=s.area or coalesce(nullif(a.name,''),a.area_name)=s.area) and a.route_type in (select jsonb_array_elements_text(p_filters->'route_type'))))
 and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') and lower(trim(coalesce(s.facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') group by s.vehicle_key
),scope as materialized (select vehicle_key from sap where nullif(vehicle_key,'') is not null),
lm as materialized (select l.vehicle_key,l.visit_date,l.driver_name,l.minutes,l.is_passthrough,l.is_depot,l.departed_at dep_ts from public.landmark_visit_facts l join scope x on x.vehicle_key=l.vehicle_key where (p_start is null or l.visit_date>=p_start) and (p_end is null or l.visit_date<=p_end)),
daily as (select l.vehicle_key,l.visit_date,count(*) filter(where not l.is_passthrough and not l.is_depot) stops,avg(l.minutes) filter(where not l.is_passthrough and not l.is_depot) avg_stop,count(*) filter(where l.is_passthrough) passthru,min(l.dep_ts) filter(where l.is_depot) route_start,max(l.dep_ts) filter(where not l.is_passthrough and not l.is_depot) route_end from lm l group by l.vehicle_key,l.visit_date),
cards as (select d.vehicle_key,min(d.route_start) route_start,max(d.route_end) route_end,sum(d.stops)::int stops,round(avg(d.avg_stop)) avg_stop,sum(d.passthru)::int passthru,round(avg(extract(epoch from (d.route_end-d.route_start))/3600.0) filter(where d.route_start is not null and d.route_end is not null and d.route_end>d.route_start)::numeric,2) avg_hours,max(s.driver_name) display_driver,max(s.invoices) invoices,max(s.boxes) boxes,max(s.freezer) freezer from daily d join sap s on s.vehicle_key=d.vehicle_key group by d.vehicle_key),manual as (select distinct on (vehicle_key) vehicle_key,coalesce(sap_driver,'') sap_driver from public.vehicle_driver_manual_mappings order by vehicle_key),
final as (select c.vehicle_key,coalesce(nullif(m.sap_driver,''),c.display_driver) display_driver,c.vehicle_key vehicle_num,case when coalesce(m.sap_driver,'')<>'' then 'manual' else 'vehicle' end match_method,c.route_start,c.route_end,case when c.avg_hours is not null then floor(c.avg_hours)::int||'h '||floor(mod(c.avg_hours*60,60))::int||'m' else '0h 0m' end route_duration_hm,c.stops,floor(coalesce(c.avg_stop,0)/60)::int||'h '||floor(mod(coalesce(c.avg_stop,0),60))::int||'m' avg_stop_hm,c.passthru passthru_count,jsonb_build_object('invoices',c.invoices,'boxes',c.boxes,'freezer',c.freezer) sap_orders,coalesce(c.avg_hours,0) _hours from cards c left join manual m on m.vehicle_key=c.vehicle_key),agg as (select coalesce(jsonb_agg(to_jsonb(f) order by f.stops desc),'[]'::jsonb) cards,count(*) gps_vehicles,coalesce(sum(stops),0) total_stops,round(avg(_hours) filter(where _hours>0)::numeric,2) avg_hours from final f)
select jsonb_build_object('standalone_mode',false,'validation_results','[]'::jsonb,'kpis',jsonb_build_object('gps_vehicles',agg.gps_vehicles,'total_gps_stops',agg.total_stops,'avg_stops_per_vehicle',case when agg.gps_vehicles>0 then round(agg.total_stops::numeric/agg.gps_vehicles,2) else 0 end,'avg_route_duration_hrs',agg.avg_hours,'avg_stop_duration','','sap_orders',(select coalesce(sum(invoices),0) from sap),'sap_total_boxes',(select coalesce(sum(boxes),0) from sap)),'chart_stops',jsonb_build_object('labels',(select coalesce(jsonb_agg(display_driver order by stops desc),'[]'::jsonb) from final),'values',(select coalesce(jsonb_agg(stops order by stops desc),'[]'::jsonb) from final)),'chart_route_hours',jsonb_build_object('labels',(select coalesce(jsonb_agg(display_driver order by _hours desc),'[]'::jsonb) from final),'values',(select coalesce(jsonb_agg(_hours order by _hours desc),'[]'::jsonb) from final)),'route_cards',agg.cards) from agg;
$$;

grant execute on function public.dispatchops_dashboard_driver_performance_snapshot(date,date,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
