-- Targeted dashboard RPCs: each tab computes only what it needs.
-- This avoids the previous unified RPC doing Lead Time + Order Summary + Landmark aggregation
-- for every tab request. All functions exclude unknown/unclassified dashboard dimensions.

create or replace function public.dispatchops_dashboard_lead_time_snapshot(p_start date default null, p_end date default null, p_filters jsonb default '{}'::jsonb)
returns jsonb language sql stable as $$
with base as materialized (
  select s.invoice_no,s.driver_name,s.customer_name,s.invoice_date,s.dispatch_date,
         coalesce(nullif(s.facility_type,''),nullif(s.division_desc,'')) classification,
         (s.dispatch_date-s.invoice_date) days
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
    and (lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown'))
    and (lower(trim(coalesce(s.facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown'))
    and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 or exists(select 1 from public.areas a where (a.code=s.area or a.name=s.area) and a.route_type in (select jsonb_array_elements_text(p_filters->'route_type'))))
), lead as (
  select * from base where invoice_date is not null and dispatch_date is not null and days>=0
    and (nullif(p_filters->>'lead_time_band','') is null or (case when days<=0 then '0 Days' when days=1 then '1 Day' when days<=5 then days||' Days' else 'More than 5 Days' end)=p_filters->>'lead_time_band')
    and (nullif(p_filters->>'classification','') is null or classification=p_filters->>'classification')
), stats as (select count(*) total,round(avg(days)::numeric,2) avg_days,min(days) min_days,max(days) max_days from lead),
classes as (select coalesce(jsonb_agg(jsonb_build_object('name',classification,'orders',orders,'avg_days',avg_days,'min_days',min_days,'max_days',max_days) order by classification),'[]'::jsonb) v from (select classification,count(*) orders,round(avg(days)::numeric,2) avg_days,min(days) min_days,max(days) max_days from lead group by classification)x),
bands as (select b band,count(l.*) n from unnest(array['0 Days','1 Day','2 Days','3 Days','4 Days','5 Days','More than 5 Days']) b left join lead l on (case when l.days<=0 then '0 Days' when l.days=1 then '1 Day' when l.days<=5 then l.days||' Days' else 'More than 5 Days' end)=b group by b),
fast as (select coalesce(jsonb_agg(to_jsonb(t) order by t.days,t.dispatch_date),'[]'::jsonb) v from (select invoice_no,driver_name,customer_name,invoice_date,dispatch_date,days from lead order by days,dispatch_date limit 100)t),
slow as (select coalesce(jsonb_agg(to_jsonb(t) order by t.days desc,t.dispatch_date desc),'[]'::jsonb) v from (select invoice_no,driver_name,customer_name,invoice_date,dispatch_date,days from lead order by days desc,dispatch_date desc limit 100)t),
class_names as (select coalesce(jsonb_agg(classification order by classification),'[]'::jsonb) v from (select distinct classification from lead)x),
matrix as (select coalesce(jsonb_agg(jsonb_build_object('band',b.band,'counts',(select coalesce(jsonb_object_agg(classification,n),'{}'::jsonb) from (select classification,count(*) n from lead l where (case when l.days<=0 then '0 Days' when l.days=1 then '1 Day' when l.days<=5 then l.days||' Days' else 'More than 5 Days' end)=b.band group by classification)),'total',b.n) order by array_position(array['0 Days','1 Day','2 Days','3 Days','4 Days','5 Days','More than 5 Days'],b.band)),'[]'::jsonb) v from bands b)
select jsonb_build_object('kpis',jsonb_build_object('total_invoices',stats.total,'overall_avg_days',stats.avg_days,'fastest_days',stats.min_days,'longest_days',stats.max_days),'by_classification',classes.v,'distribution',jsonb_build_object('bins',jsonb_build_array('0 Days','1 Day','2 Days','3 Days','4 Days','5 Days','More than 5 Days'),'counts',(select coalesce(jsonb_agg(n order by array_position(array['0 Days','1 Day','2 Days','3 Days','4 Days','5 Days','More than 5 Days'],band)),'[]'::jsonb) from bands)),'fastest_detail',fast.v,'longest_detail',slow.v,'band_classification_matrix',jsonb_build_object('classifications',class_names.v,'rows',matrix.v,'col_totals',(select coalesce(jsonb_object_agg(classification,n),'{}'::jsonb) from (select classification,count(*) n from lead group by classification)x),'grand_total',stats.total),'available_bands',(select coalesce(jsonb_agg(band order by array_position(array['0 Days','1 Day','2 Days','3 Days','4 Days','5 Days','More than 5 Days'],band)),'[]'::jsonb) from bands where n>0),'available_classifications',class_names.v)
from stats,classes,fast,slow,class_names,matrix;
$$;

grant execute on function public.dispatchops_dashboard_lead_time_snapshot(date,date,jsonb) to anon, authenticated;

create or replace function public.dispatchops_dashboard_order_summary_snapshot(p_start date default null, p_end date default null, p_filters jsonb default '{}'::jsonb)
returns jsonb language sql stable as $$
with base as (
 select s.driver_name,coalesce(nullif(s.facility_type,''),nullif(s.division_desc,'')) facility,count(*) n
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
 and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 or exists(select 1 from public.areas a where (a.code=s.area or a.name=s.area) and a.route_type in (select jsonb_array_elements_text(p_filters->'route_type'))))
 group by s.driver_name,2
), rows as (select driver_name driver,coalesce(jsonb_object_agg(facility,n),'{}'::jsonb) by_facility_json,sum(n) total from base group by driver_name),
fac as (select coalesce(jsonb_agg(facility order by facility),'[]'::jsonb) v from (select distinct facility from base)x),
final_rows as (select coalesce(jsonb_agg(jsonb_build_object('driver',r.driver,'by_facility',(select coalesce(jsonb_agg(coalesce(b.n,0) order by f.facility),'[]'::jsonb) from (select distinct facility from base) f left join base b on b.driver_name=r.driver and b.facility=f.facility),'total',r.total) order by r.driver),'[]'::jsonb) v from rows r)
select jsonb_build_object('facility_types',fac.v,'rows',final_rows.v,'facility_totals',(select coalesce(jsonb_agg(t.n order by t.facility),'[]'::jsonb) from (select facility,sum(n) n from base group by facility)t),'grand_total',coalesce((select sum(n) from base),0)) from fac,final_rows;
$$;

grant execute on function public.dispatchops_dashboard_order_summary_snapshot(date,date,jsonb) to anon, authenticated;

create or replace function public.dispatchops_dashboard_driver_performance_snapshot(p_start date default null, p_end date default null, p_filters jsonb default '{}'::jsonb)
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
 group by s.vehicle_key,s.driver_name
), vehicles as (select distinct vehicle_key from sap where nullif(vehicle_key,'') is not null),
lm as materialized (
 select l.* from public.landmark_visit_facts l join vehicles v on v.vehicle_key=l.vehicle_key
 where (p_start is null or l.visit_date>=p_start) and (p_end is null or l.visit_date<=p_end)
), cards as (
 select l.vehicle_key,coalesce(nullif(max(l.driver_name) filter(where l.driver_name<>''),''),max(s.driver_name)) display_driver,
 count(*) filter(where not l.is_passthrough and not l.is_depot) stops,
 round(avg(l.minutes) filter(where not l.is_passthrough and not l.is_depot)) avg_stop,
 count(*) filter(where l.is_passthrough) passthru,
 min(l.departed_at) filter(where l.is_depot) route_start,
 max(l.departed_at) filter(where not l.is_passthrough and not l.is_depot) route_end,
 max(s.invoices) invoices,max(s.boxes) boxes,max(s.freezer) freezer
 from lm l left join sap s on s.vehicle_key=l.vehicle_key group by l.vehicle_key
), manual as (select vehicle_key,coalesce(sap_driver,'') sap_driver from public.vehicle_driver_manual_mappings),
final as (
 select c.vehicle_key,coalesce(nullif(m.sap_driver,''),c.display_driver) display_driver,c.vehicle_key vehicle_num,
 case when s.vehicle_key is not null then 'vehicle' when m.sap_driver<>'' then 'manual' else 'name' end match_method,
 c.route_start,c.route_end,
 case when c.route_start is not null and c.route_end is not null and c.route_end>=c.route_start then floor(extract(epoch from c.route_end-c.route_start)/3600)::int||'h '||floor(mod(extract(epoch from c.route_end-c.route_start)/60,60))::int||'m' else '0h 0m' end route_duration_hm,
 c.stops,floor(coalesce(c.avg_stop,0)/60)::int||'h '||floor(mod(coalesce(c.avg_stop,0),60))::int||'m' avg_stop_hm,c.passthru passthru_count,
 case when c.invoices is not null then jsonb_build_object('invoices',c.invoices,'boxes',c.boxes,'freezer',c.freezer) end sap_orders,
 case when c.route_start is not null and c.route_end is not null and c.route_end>=c.route_start then round((extract(epoch from c.route_end-c.route_start)/3600)::numeric,2) else 0 end _hours
 from cards c left join lateral (select * from manual m0 where m0.vehicle_key=c.vehicle_key limit 1)m on true left join lateral (select * from sap s0 where s0.vehicle_key=c.vehicle_key limit 1)s on true
), agg as (select coalesce(jsonb_agg(to_jsonb(f)-'_hours' order by f.stops desc),'[]'::jsonb) cards,count(*) gps_vehicles,coalesce(sum(stops),0) total_stops,coalesce(avg(_hours) filter(where _hours>0),null) avg_hours from final f)
select jsonb_build_object('standalone_mode',false,'validation_results','[]'::jsonb,'kpis',jsonb_build_object('gps_vehicles',agg.gps_vehicles,'total_gps_stops',agg.total_stops,'avg_stops_per_vehicle',case when agg.gps_vehicles>0 then round(agg.total_stops::numeric/agg.gps_vehicles,2) else 0 end,'avg_route_duration_hrs',agg.avg_hours,'avg_stop_duration','','sap_orders',(select count(*) from sap),'sap_total_boxes',(select coalesce(sum(boxes),0) from sap)),'chart_stops',jsonb_build_object('labels',(select coalesce(jsonb_agg(display_driver order by stops desc),'[]'::jsonb) from final),'values',(select coalesce(jsonb_agg(stops order by stops desc),'[]'::jsonb) from final)),'chart_route_hours',jsonb_build_object('labels',(select coalesce(jsonb_agg(display_driver order by _hours desc),'[]'::jsonb) from final),'values',(select coalesce(jsonb_agg(_hours order by _hours desc),'[]'::jsonb) from final)),'route_cards',agg.cards) from agg;
$$;

grant execute on function public.dispatchops_dashboard_driver_performance_snapshot(date,date,jsonb) to anon, authenticated;

create index if not exists idx_sap_dashboard_dispatch_filters on public.sap_invoice_facts (dispatch_date, division_desc, facility_type, driver_name, area, vehicle_type, salesman, vehicle_key);
create index if not exists idx_sap_lead_dashboard on public.sap_invoice_facts (dispatch_date, invoice_date, facility_type, division_desc);
create index if not exists idx_landmark_dashboard_vehicle_date on public.landmark_visit_facts (vehicle_key, visit_date);
analyze public.sap_invoice_facts;
analyze public.landmark_visit_facts;
analyze public.areas;
