create or replace function public.dispatchops_dashboard_driver_performance_snapshot(p_start date default null,p_end date default null,p_filters jsonb default '{}'::jsonb)
returns jsonb language sql stable as $$
with sap as materialized (
 select s.vehicle_key,min(s.driver_name) driver_name,count(*) invoices,sum(coalesce(s.boxes,0)) boxes,sum(coalesce(s.freezer_boxes,0)) freezer
 from public.sap_invoice_facts s
 where (p_start is null or s.dispatch_date>=p_start) and (p_end is null or s.dispatch_date<=p_end)
 and (nullif(p_filters->>'driver','') is null or s.driver_name=p_filters->>'driver')
 and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or s.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')))
 and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas')))
 and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
 and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or s.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type')))
 and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
 and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman')))
 and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
 and lower(trim(coalesce(s.facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
 group by s.vehicle_key
),
scope as materialized (
 select distinct s.vehicle_key from public.sap_invoice_facts s
 where (p_start is null or s.dispatch_date>=p_start) and (p_end is null or s.dispatch_date<=p_end)
 and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas')))
 and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
 and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or s.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type')))
 and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
 and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman')))
 and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
 and lower(trim(coalesce(s.facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
),
lm as materialized (
 select l.* from public.landmark_visit_facts l
 where (p_start is null or l.visit_date>=p_start) and (p_end is null or l.visit_date<=p_end)
 and (nullif(p_filters->>'driver','') is null or l.driver_name=p_filters->>'driver' or exists(select 1 from scope x where x.vehicle_key=l.vehicle_key))
 and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or l.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')) or exists(select 1 from scope x where x.vehicle_key=l.vehicle_key))
),
cards as (
 select l.vehicle_key,
        coalesce(nullif(max(l.driver_name) filter(where l.driver_name<>''),''),max(s.driver_name)) display_driver,
        count(*) filter(where not l.is_passthrough and not l.is_depot) stops,
        round(avg(l.minutes) filter(where not l.is_passthrough and not l.is_depot)) avg_stop,
        count(*) filter(where l.is_passthrough) passthru,
        min(l.departed_at) filter(where l.is_depot) route_start,
        max(l.departed_at) filter(where not l.is_passthrough and not l.is_depot) route_end,
        max(s.invoices) invoices,max(s.boxes) boxes,max(s.freezer) freezer
 from lm l left join sap s on s.vehicle_key=l.vehicle_key group by l.vehicle_key
),
manual as (select vehicle_key,coalesce(sap_driver,'') sap_driver from public.vehicle_driver_manual_mappings),
final as (
 select c.vehicle_key,coalesce(nullif(m.sap_driver,''),c.display_driver) display_driver,c.vehicle_key vehicle_num,
        case when m.sap_driver<>'' then 'manual' else 'vehicle' end match_method,c.route_start,c.route_end,
        case when c.route_start is not null and c.route_end is not null and c.route_end>=c.route_start then floor(extract(epoch from c.route_end-c.route_start)/3600)::int||'h '||floor(mod(extract(epoch from c.route_end-c.route_start)/60,60))::int||'m' else '0h 0m' end route_duration_hm,
        c.stops,floor(coalesce(c.avg_stop,0)/60)::int||'h '||floor(mod(coalesce(c.avg_stop,0),60))::int||'m' avg_stop_hm,c.passthru passthru_count,
        case when c.invoices is not null then jsonb_build_object('invoices',c.invoices,'boxes',c.boxes,'freezer',c.freezer) end sap_orders,
        case when c.route_start is not null and c.route_end is not null and c.route_end>=c.route_start then round((extract(epoch from c.route_end-c.route_start)/3600)::numeric,2) else 0 end _hours
 from cards c left join lateral (select * from manual m0 where m0.vehicle_key=c.vehicle_key limit 1)m on true
),
agg as (select coalesce(jsonb_agg(to_jsonb(f)-'_hours' order by f.stops desc),'[]'::jsonb) cards,count(*) gps_vehicles,coalesce(sum(stops),0) total_stops,coalesce(avg(_hours) filter(where _hours>0),null) avg_hours from final f)
select jsonb_build_object('standalone_mode',false,'validation_results','[]'::jsonb,'kpis',jsonb_build_object('gps_vehicles',agg.gps_vehicles,'total_gps_stops',agg.total_stops,'avg_stops_per_vehicle',case when agg.gps_vehicles>0 then round(agg.total_stops::numeric/agg.gps_vehicles,2) else 0 end,'avg_route_duration_hrs',agg.avg_hours,'avg_stop_duration','','sap_orders',(select count(*) from sap),'sap_total_boxes',(select coalesce(sum(boxes),0) from sap)),'chart_stops',jsonb_build_object('labels',(select coalesce(jsonb_agg(display_driver order by stops desc),'[]'::jsonb) from final),'values',(select coalesce(jsonb_agg(stops order by stops desc),'[]'::jsonb) from final)),'chart_route_hours',jsonb_build_object('labels',(select coalesce(jsonb_agg(display_driver order by _hours desc),'[]'::jsonb) from final),'values',(select coalesce(jsonb_agg(_hours order by _hours desc),'[]'::jsonb) from final)),'route_cards',agg.cards) from agg;
$$;

grant execute on function public.dispatchops_dashboard_driver_performance_snapshot(date,date,jsonb) to anon,authenticated;
