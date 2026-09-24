-- Unified dashboard snapshot: one indexed server-side pass per Supabase project.
-- The desktop app receives only compact aggregates instead of downloading all SAP/GPS rows.
create or replace function public.dispatchops_dashboard_snapshot(p_start date default null, p_end date default null, p_filters jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
as $$
with base as (
  select s.invoice_no,s.invoice_date,s.dispatch_date,s.driver_name,s.customer_name,
         coalesce(s.facility_type,'') facility_type,coalesce(s.area,'') area,
         coalesce(s.division_desc,'') division_desc,coalesce(s.vehicle_type,'') vehicle_type,
         coalesce(s.vehicle_key,'') vehicle_key,coalesce(s.vehicle_num,'') vehicle_num,
         coalesce(s.boxes,0) boxes,coalesce(s.normal_boxes,0) normal_boxes,
         coalesce(s.freezer_boxes,0) freezer_boxes,coalesce(s.not_supplied_reason,'') not_supplied_reason,
         coalesce(s.salesman,'') salesman,
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
    and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
    and (lower(trim(coalesce(s.facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') or lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown'))
    and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 or exists(select 1 from public.areas a where (a.code=s.area or a.name=s.area) and a.route_type in (select jsonb_array_elements_text(p_filters->'route_type'))))
), lead as (
  select * from base
  where invoice_date is not null and dispatch_date is not null and days>=0
    and (nullif(p_filters->>'lead_time_band','') is null or (case when days<=0 then '0 Days' when days=1 then '1 Day' when days<=5 then days||' Days' else 'More than 5 Days' end)=p_filters->>'lead_time_band')
    and (nullif(p_filters->>'classification','') is null or case when lower(trim(coalesce(facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then facility_type when lower(trim(coalesce(division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then division_desc end=p_filters->>'classification')
),
lead_class as (
 select coalesce(jsonb_agg(jsonb_build_object('name',class,'orders',orders,'avg_days',avg_days,'min_days',min_days,'max_days',max_days) order by class),'[]'::jsonb) v
 from (select case when lower(trim(coalesce(facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then facility_type when lower(trim(coalesce(division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then division_desc end class,count(*) orders,round(avg(days)::numeric,2) avg_days,min(days) min_days,max(days) max_days from lead group by 1)x
),
lead_stats as (select count(*) total,round(avg(days)::numeric,2) avg_days,min(days) min_days,max(days) max_days from lead),
lead_bands as (
 select b band,coalesce((select count(*) from lead s where (case when s.days<=0 then '0 Days' when s.days=1 then '1 Day' when s.days<=5 then s.days||' Days' else 'More than 5 Days' end)=b),0) n
 from unnest(array['0 Days','1 Day','2 Days','3 Days','4 Days','5 Days','More than 5 Days']) b
),
lead_classes as (select coalesce(jsonb_agg(class order by class),'[]'::jsonb) v from (select distinct case when lower(trim(coalesce(facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then facility_type when lower(trim(coalesce(division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then division_desc end class from lead)x),
lead_matrix as (
 select coalesce(jsonb_agg(jsonb_build_object('band',b.band,'counts',(select coalesce(jsonb_object_agg(class,n),'{}'::jsonb) from (select case when lower(trim(coalesce(facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then facility_type when lower(trim(coalesce(division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then division_desc end class,count(*) n from lead s where (case when s.days<=0 then '0 Days' when s.days=1 then '1 Day' when s.days<=5 then s.days||' Days' else 'More than 5 Days' end)=b.band group by 1)z),'total',b.n) order by array_position(array['0 Days','1 Day','2 Days','3 Days','4 Days','5 Days','More than 5 Days'],b.band)),'[]'::jsonb) v from lead_bands b
),
fast as (select coalesce(jsonb_agg(to_jsonb(t) order by t.days,t.dispatch_date),'[]'::jsonb) v from (select invoice_no,driver_name,customer_name,invoice_date,dispatch_date,days from lead order by days,dispatch_date limit 100)t),
slow as (select coalesce(jsonb_agg(to_jsonb(t) order by t.days desc,t.dispatch_date desc),'[]'::jsonb) v from (select invoice_no,driver_name,customer_name,invoice_date,dispatch_date,days from lead order by days desc,dispatch_date desc limit 100)t),

ord as (
 select nullif(driver_name,'') driver,case when lower(trim(coalesce(facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then facility_type when lower(trim(coalesce(division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then division_desc end facility,count(*) n from base group by 1,2
),
facilities as (select coalesce(jsonb_agg(facility order by facility),'[]'::jsonb) v from (select distinct facility from ord)x),
order_rows as (
 select coalesce(jsonb_agg(jsonb_build_object('driver',d.driver,'by_facility',(select coalesce(jsonb_agg(coalesce((select n from ord o2 where o2.driver=d.driver and o2.facility=f.facility),0) order by f.facility),'[]'::jsonb) from (select distinct facility from ord) f),'total',(select coalesce(sum(n),0) from ord o3 where o3.driver=d.driver)) order by d.driver),'[]'::jsonb) v from (select distinct driver from ord)d
),

areas_agg as (
 select nullif(area,'') area,count(*) orders,sum(boxes) boxes,sum(freezer_boxes) freezer,count(*) filter(where not_supplied_reason<>'') returns,count(distinct driver_name) drivers
 from base group by 1
),
area_table as (select coalesce(jsonb_agg(jsonb_build_object('area',area,'orders',orders,'boxes',boxes,'freezer',freezer,'returns',returns,'drivers',drivers,'success_pct',case when orders>0 then round((orders-returns)::numeric/orders*10000)/100 else 0 end) order by area),'[]'::jsonb) v from areas_agg),
area_weeks as (
 select to_char(date_trunc('week',dispatch_date),'YYYY-MM-DD') week,nullif(area,'') area,count(*) n from base group by 1,2
),
area_names as (select coalesce(jsonb_agg(distinct area order by area),'[]'::jsonb) v from areas_agg),
weekly as (select coalesce(jsonb_agg(jsonb_build_object('week',w.week,'by_area',(select coalesce(jsonb_agg(coalesce((select n from area_weeks w2 where w2.week=w.week and w2.area=a.area),0) order by a.area),'[]'::jsonb) from areas_agg a)) order by w.week),'[]'::jsonb) v from (select distinct week from area_weeks)w),

ns as (select coalesce(jsonb_agg(to_jsonb(t) order by t.dispatch_date desc),'[]'::jsonb) v from (select driver_name,customer_name,facility_type,not_supplied_reason reason,boxes,coalesce(invoice_date::text,'') invoice_date,dispatch_date from base where not_supplied_reason<>'' order by dispatch_date desc limit 2000)t),
zero as (select coalesce(jsonb_agg(to_jsonb(t) order by t.dispatch_date desc),'[]'::jsonb) v from (select driver_name,customer_name,coalesce(invoice_date::text,'') invoice_date,coalesce(dispatch_date::text,'') dispatch_date from base where boxes<=0 order by dispatch_date desc limit 2000)t),

lm as (
 select l.* from public.landmark_visit_facts l
 where (p_start is null or l.visit_date>=p_start) and (p_end is null or l.visit_date<=p_end)
   and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or l.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')) or exists(select 1 from base s where s.vehicle_key=l.vehicle_key and s.driver_name in (select jsonb_array_elements_text(p_filters->'drivers'))))
   and (nullif(p_filters->>'driver','') is null or l.driver_name=p_filters->>'driver' or exists(select 1 from base s where s.vehicle_key=l.vehicle_key and s.driver_name=p_filters->>'driver'))
   and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or exists(select 1 from base s where s.vehicle_key=l.vehicle_key and s.area in (select jsonb_array_elements_text(p_filters->'areas'))))
   and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or exists(select 1 from base s where s.vehicle_key=l.vehicle_key and s.division_desc in (select jsonb_array_elements_text(p_filters->'division'))))
   and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or exists(select 1 from base s where s.vehicle_key=l.vehicle_key and s.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type'))))
   and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or exists(select 1 from base s where s.vehicle_key=l.vehicle_key and s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type'))))
   and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or exists(select 1 from base s where s.vehicle_key=l.vehicle_key and s.salesman in (select jsonb_array_elements_text(p_filters->'salesman'))))
),
lm_cards as (
 select coalesce(l.vehicle_key,'') vehicle_key,
        nullif(max(l.driver_name) filter(where l.driver_name<>''),'') gps_driver,
        count(*) filter(where not l.is_passthrough and not l.is_depot) stops,
        round(avg(l.minutes) filter(where not l.is_passthrough and not l.is_depot)) avg_stop,
        count(*) filter(where l.is_passthrough) passthru,
        min(l.departed_at) filter(where l.is_depot) route_start,
        max(l.departed_at) filter(where not l.is_passthrough and not l.is_depot) route_end
 from lm l group by 1
),
manual as (select vehicle_key,coalesce(sap_driver,'') sap_driver from public.vehicle_driver_manual_mappings),
perf_cards as (
 select c.vehicle_key,coalesce(nullif(m.sap_driver,''),nullif(s.driver_name,''),c.gps_driver) display_driver,
        c.vehicle_key vehicle_num,
        case when s.vehicle_key is not null then 'vehicle' when m.sap_driver<>'' then 'manual' when s2.driver_name is not null then 'name' else 'none' end match_method,
        c.route_start,c.route_end,
        case when c.route_start is not null and c.route_end is not null and c.route_end>=c.route_start then floor(extract(epoch from c.route_end-c.route_start)/3600)::int||'h '||floor(mod(extract(epoch from c.route_end-c.route_start)/60,60))::int||'m' else '0h 0m' end route_duration_hm,
        c.stops,
        floor(coalesce(c.avg_stop,0)/60)::int||'h '||floor(mod(coalesce(c.avg_stop,0),60))::int||'m' avg_stop_hm,
        c.passthru passthru_count,
        case when s.vehicle_key is not null then jsonb_build_object('invoices',s.invoices,'boxes',s.boxes,'freezer',s.freezer) else null end sap_orders,
        case when c.route_start is not null and c.route_end is not null and c.route_end>=c.route_start then round((extract(epoch from c.route_end-c.route_start)/3600)::numeric,2) else 0 end _hours
 from lm_cards c
 left join manual m on m.vehicle_key=c.vehicle_key
 left join lateral (select min(driver_name) driver_name,min(vehicle_key) vehicle_key,count(*) invoices,sum(boxes) boxes,sum(freezer_boxes) freezer from base x where x.vehicle_key=c.vehicle_key group by x.vehicle_key limit 1)s on true
 left join lateral (select min(driver_name) driver_name from base x where lower(trim(x.driver_name))=lower(trim(c.gps_driver)) limit 1)s2 on true
),
perf as (
 select coalesce(jsonb_agg(to_jsonb(x)-'_hours'),'[]'::jsonb) cards,count(*) gps_vehicles,coalesce(sum(stops),0) total_stops,coalesce(avg(_hours) filter(where _hours>0),null) avg_hours from perf_cards x
)
select jsonb_build_object(
 'lead_time',jsonb_build_object('kpis',jsonb_build_object('total_invoices',ls.total,'overall_avg_days',ls.avg_days,'fastest_days',ls.min_days,'longest_days',ls.max_days),'by_classification',lc.v,'distribution',jsonb_build_object('bins',jsonb_build_array('0 Days','1 Day','2 Days','3 Days','4 Days','5 Days','More than 5 Days'),'counts',(select coalesce(jsonb_agg(n order by array_position(array['0 Days','1 Day','2 Days','3 Days','4 Days','5 Days','More than 5 Days'],band)),'[]'::jsonb) from lead_bands)),'fastest_detail',fast.v,'longest_detail',slow.v,'band_classification_matrix',jsonb_build_object('classifications',(select v from lead_classes),'rows',(select v from lead_matrix),'col_totals',(select coalesce(jsonb_object_agg(class,n),'{}'::jsonb) from (select case when lower(trim(coalesce(facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then facility_type when lower(trim(coalesce(division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') then division_desc end class,count(*) n from lead group by 1)z),'grand_total',ls.total),'available_bands',(select coalesce(jsonb_agg(band order by array_position(array['0 Days','1 Day','2 Days','3 Days','4 Days','5 Days','More than 5 Days'],band)),'[]'::jsonb) from lead_bands where n>0),'available_classifications',(select v from lead_classes)),
 'order_summary',jsonb_build_object('facility_types',facilities.v,'rows',(select v from order_rows),'facility_totals',(select coalesce(jsonb_agg(t.n order by t.facility),'[]'::jsonb) from (select facility,sum(n) n from ord group by facility) t),'grand_total',(select count(*) from base)),
 'area_analytics',jsonb_build_object('table',area_table.v,'totals',jsonb_build_object('orders',(select coalesce(sum(orders),0) from areas_agg),'boxes',(select coalesce(sum(boxes),0) from areas_agg),'freezer',(select coalesce(sum(freezer),0) from areas_agg),'returns',(select coalesce(sum(returns),0) from areas_agg),'drivers',(select count(distinct driver_name) from base),'success_pct',case when (select sum(orders) from areas_agg)>0 then round(((select sum(orders-returns) from areas_agg)::numeric/(select sum(orders) from areas_agg))*10000)/100 else 0 end),'area_names',area_names.v,'weekly_table',(select v from weekly),'chart',jsonb_build_object('labels',(select coalesce(jsonb_agg(t.area order by t.orders desc),'[]'::jsonb) from (select area,orders from areas_agg order by orders desc limit 15) t),'values',(select coalesce(jsonb_agg(t.orders order by t.orders desc),'[]'::jsonb) from (select orders from areas_agg order by orders desc limit 15) t))),
 'not_supplied',jsonb_build_object('not_supplied',ns.v,'zero_box_excluded_from_kpis',zero.v),
 'driver_performance',jsonb_build_object('standalone_mode',coalesce(p.gps_vehicles,0)>0 and not exists(select 1 from perf_cards where match_method<>'none'),'validation_results','[]'::jsonb,'kpis',jsonb_build_object('gps_vehicles',p.gps_vehicles,'total_gps_stops',p.total_stops,'avg_stops_per_vehicle',case when p.gps_vehicles>0 then round(p.total_stops::numeric/p.gps_vehicles,2) else 0 end,'avg_route_duration_hrs',p.avg_hours,'avg_stop_duration','','sap_orders',(select count(*) from base),'sap_total_boxes',(select coalesce(sum(boxes),0) from base)),'chart_stops',jsonb_build_object('labels',(select coalesce(jsonb_agg(display_driver order by stops desc),'[]'::jsonb) from perf_cards),'values',(select coalesce(jsonb_agg(stops order by stops desc),'[]'::jsonb) from perf_cards)),'chart_route_hours',jsonb_build_object('labels',(select coalesce(jsonb_agg(display_driver order by _hours desc),'[]'::jsonb) from perf_cards),'values',(select coalesce(jsonb_agg(_hours order by _hours desc),'[]'::jsonb) from perf_cards)),'route_cards',p.cards)
)
from lead_stats ls,lead_class lc,fast,slow,facilities,area_table,area_names,weekly,ns,zero,perf p;
$$;

grant execute on function public.dispatchops_dashboard_snapshot(date,date,jsonb) to anon, authenticated;

create index if not exists idx_sap_dashboard_filter on public.sap_invoice_facts (dispatch_date, driver_name, area, division_desc, vehicle_type, facility_type, salesman, vehicle_key);
create index if not exists idx_lm_dashboard_driver_vehicle_date on public.landmark_visit_facts (visit_date, driver_name, vehicle_key);
