-- DispatchOPS Dashboard performance architecture v18
-- Each visible tab has a dedicated compact RPC. No Area/Not-Supplied request
-- invokes the old all-tabs snapshot. Overview is aggregated in PostgreSQL.

create index if not exists idx_sap_dashboard_driver_date_v18 on public.sap_invoice_facts (driver_name, dispatch_date);
create index if not exists idx_sap_dashboard_area_date_v18 on public.sap_invoice_facts (area, dispatch_date);
create index if not exists idx_sap_dashboard_division_date_v18 on public.sap_invoice_facts (division_desc, dispatch_date);
create index if not exists idx_lm_dashboard_vehicle_date_v18 on public.landmark_visit_facts (vehicle_key, visit_date);

create or replace function public.dispatchops_dashboard_area_snapshot(
  p_start date default null,
  p_end date default null,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language sql stable
set statement_timeout='20s'
as $$
with base as materialized (
  select s.dispatch_date, coalesce(s.area,'') area, coalesce(s.driver_name,'') driver_name,
         coalesce(s.boxes,0) boxes, coalesce(s.freezer_boxes,0) freezer_boxes,
         coalesce(s.not_supplied_reason,'') not_supplied_reason
  from public.sap_invoice_facts s
  where (p_start is null or s.dispatch_date>=p_start)
    and (p_end is null or s.dispatch_date<=p_end)
    and (nullif(p_filters->>'driver','') is null or s.driver_name=p_filters->>'driver')
    and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or s.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')))
    and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas')))
    and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
    and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
    and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman')))
    and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
    and (lower(trim(coalesce(s.facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') or lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown'))
    and (
      (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 and jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0)
      or exists (
        select 1 from public.areas a
        where (coalesce(nullif(a.code,''),a.area_code)=s.area or coalesce(nullif(a.name,''),a.area_name)=s.area)
          and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 or a.route_type in (select jsonb_array_elements_text(p_filters->'route_type')))
          and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or a.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type')))
      )
    )
), agg as (
  select nullif(area,'') area, count(*)::int orders, coalesce(sum(boxes),0)::bigint boxes,
         coalesce(sum(freezer_boxes),0)::bigint freezer,
         count(*) filter(where not_supplied_reason<>'')::int returns,
         count(distinct nullif(driver_name,''))::int drivers
  from base group by 1
), area_table as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'area',area,'orders',orders,'boxes',boxes,'freezer',freezer,'returns',returns,'drivers',drivers,
    'success_pct',case when orders>0 then round((orders-returns)::numeric/orders*10000)/100 else 0 end
  ) order by area),'[]'::jsonb) v from agg
), names as (
  select coalesce(jsonb_agg(area order by area),'[]'::jsonb) v from agg
), weekly_counts as (
  select to_char(date_trunc('week',dispatch_date),'YYYY-MM-DD') week, nullif(area,'') area, count(*)::int n
  from base group by 1,2
), weekly as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'week',w.week,
    'by_area',(select coalesce(jsonb_agg(coalesce(wc.n,0) order by a.area),'[]'::jsonb)
               from agg a left join weekly_counts wc on wc.week=w.week and wc.area=a.area)
  ) order by w.week),'[]'::jsonb) v
  from (select distinct week from weekly_counts) w
), totals as (
  select count(*)::int orders, coalesce(sum(boxes),0)::bigint boxes, coalesce(sum(freezer_boxes),0)::bigint freezer,
         count(*) filter(where not_supplied_reason<>'')::int returns,
         count(distinct nullif(driver_name,''))::int drivers
  from base
)
select jsonb_build_object(
  'table',area_table.v,
  'totals',jsonb_build_object('orders',totals.orders,'boxes',totals.boxes,'freezer',totals.freezer,'returns',totals.returns,'drivers',totals.drivers,
      'success_pct',case when totals.orders>0 then round((totals.orders-totals.returns)::numeric/totals.orders*10000)/100 else 0 end),
  'area_names',names.v,
  'weekly_table',weekly.v,
  'chart',jsonb_build_object(
      'labels',(select coalesce(jsonb_agg(t.area order by t.orders desc),'[]'::jsonb) from (select area,orders from agg order by orders desc limit 15)t),
      'values',(select coalesce(jsonb_agg(t.orders order by t.orders desc),'[]'::jsonb) from (select area,orders from agg order by orders desc limit 15)t))
) from area_table,names,weekly,totals;
$$;

grant execute on function public.dispatchops_dashboard_area_snapshot(date,date,jsonb) to anon,authenticated;

create or replace function public.dispatchops_dashboard_not_supplied_snapshot(
  p_start date default null,
  p_end date default null,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language sql stable
set statement_timeout='20s'
as $$
with base as materialized (
  select s.driver_name,s.customer_name,coalesce(s.facility_type,'') facility_type,
         coalesce(s.not_supplied_reason,'') not_supplied_reason,coalesce(s.boxes,0) boxes,
         s.invoice_date,s.dispatch_date,s.area,s.division_desc,s.vehicle_type,s.salesman
  from public.sap_invoice_facts s
  where (p_start is null or s.dispatch_date>=p_start)
    and (p_end is null or s.dispatch_date<=p_end)
    and (nullif(p_filters->>'driver','') is null or s.driver_name=p_filters->>'driver')
    and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb))=0 or s.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')))
    and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb))=0 or s.area in (select jsonb_array_elements_text(p_filters->'areas')))
    and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb))=0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
    and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb))=0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
    and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb))=0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman')))
    and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
    and (lower(trim(coalesce(s.facility_type,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown') or lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown'))
    and (
      (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 and jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0)
      or exists (
        select 1 from public.areas a
        where (coalesce(nullif(a.code,''),a.area_code)=s.area or coalesce(nullif(a.name,''),a.area_name)=s.area)
          and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 or a.route_type in (select jsonb_array_elements_text(p_filters->'route_type')))
          and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or a.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type')))
      )
    )
), ns as (
  select coalesce(jsonb_agg(to_jsonb(t) order by t.dispatch_date desc),'[]'::jsonb) v
  from (select driver_name,customer_name,facility_type,not_supplied_reason reason,boxes,coalesce(invoice_date::text,'') invoice_date,dispatch_date
        from base where not_supplied_reason<>'' order by dispatch_date desc limit 2000)t
), zero as (
  select coalesce(jsonb_agg(to_jsonb(t) order by t.dispatch_date desc),'[]'::jsonb) v
  from (select driver_name,customer_name,coalesce(invoice_date::text,'') invoice_date,coalesce(dispatch_date::text,'') dispatch_date
        from base where boxes<=0 order by dispatch_date desc limit 2000)t
)
select jsonb_build_object('not_supplied',ns.v,'zero_box_excluded_from_kpis',zero.v) from ns,zero;
$$;

grant execute on function public.dispatchops_dashboard_not_supplied_snapshot(date,date,jsonb) to anon,authenticated;

create or replace function public.dispatchops_dashboard_home_snapshot(
  p_start date default null,
  p_end date default null,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language sql stable
set statement_timeout='20s'
as $$
with base as materialized (
  select s.invoice_no,s.invoice_date,s.dispatch_date,coalesce(s.driver_name,'') driver_name,
         coalesce(s.vehicle_num,'') vehicle_num,coalesce(s.vehicle_key,'') vehicle_key,coalesce(s.vehicle_type,'') vehicle_type,
         coalesce(s.customer_name,'') customer_name,coalesce(s.area,'') area,coalesce(s.division_desc,'') division_desc,
         coalesce(s.facility_type,'') facility_type,coalesce(s.salesman,'') salesman,
         coalesce(s.boxes,0) boxes,coalesce(s.normal_boxes,0) normal_boxes,coalesce(s.freezer_boxes,0) freezer_boxes,
         coalesce(s.not_supplied_reason,'') not_supplied_reason
  from public.sap_invoice_facts s
  where (p_start is null or s.dispatch_date>=p_start)
    and (p_end is null or s.dispatch_date<=p_end)
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
    and (
      (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 and jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0)
      or exists (
        select 1 from public.areas a
        where coalesce(nullif(a.name,''),a.area_name)=s.area
          and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 or a.route_type in (select jsonb_array_elements_text(p_filters->'route_type')))
          and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or a.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type')))
      )
    )
), stats as (
  select count(*)::int valid_invoices,coalesce(sum(boxes),0)::bigint total_boxes,coalesce(sum(normal_boxes),0)::bigint normal_boxes,
         coalesce(sum(freezer_boxes),0)::bigint freezer_boxes,count(distinct nullif(driver_name,''))::int active_drivers,
         count(*) filter(where not_supplied_reason<>'')::int not_supplied,count(distinct nullif(customer_name,''))::int unique_customers,
         round(avg((dispatch_date-invoice_date)) filter(where invoice_date is not null and dispatch_date is not null and dispatch_date>=invoice_date)::numeric,1) avg_lead
  from base
), driver_groups as (
  select driver_name,min(nullif(vehicle_num,'')) vehicle_num,min(vehicle_type) vehicle_type,count(*)::int orders,
         coalesce(sum(boxes),0)::bigint boxes,coalesce(sum(freezer_boxes),0)::bigint freezer,
         count(*) filter(where not_supplied_reason<>'')::int not_supplied
  from base where driver_name<>'' group by driver_name
), facility_groups as (
  select facility_type,count(*)::int n from base where facility_type<>'' group by facility_type
), vehicle_type_groups as (
  select vehicle_type,coalesce(sum(normal_boxes),0)::bigint normal,coalesce(sum(freezer_boxes),0)::bigint freezer
  from base group by vehicle_type
), scoped_vehicles as (
  select distinct vehicle_key from base where vehicle_key<>''
), daily_routes as (
  select l.vehicle_key,l.visit_date,
         min(l.departed_at) filter(where l.is_depot) route_start,
         max(l.departed_at) filter(where not l.is_passthrough and not l.is_depot) route_end
  from public.landmark_visit_facts l join scoped_vehicles v on v.vehicle_key=l.vehicle_key
  where (p_start is null or l.visit_date>=p_start) and (p_end is null or l.visit_date<=p_end)
  group by l.vehicle_key,l.visit_date
), route_stats as (
  select round(avg(extract(epoch from (route_end-route_start))/3600.0) filter(where route_start is not null and route_end is not null and route_end>route_start)::numeric,1) avg_route_hours
  from daily_routes
), active_vehicle_count as (
  select count(distinct b.vehicle_key)::int n from base b
  where b.vehicle_key<>'' and exists(
    select 1 from public.vehicles v
    where regexp_replace(upper(trim(coalesce(nullif(v.number,''),v.vehicle_number,''))),'[^A-Z0-9]','','g')=b.vehicle_key
  )
), drivers_json as (
  select coalesce(jsonb_agg(jsonb_build_object('driver_name',driver_name,'vehicle_num',coalesce(vehicle_num,'-'),'vehicle_type',vehicle_type,
           'orders',orders,'boxes',boxes,'freezer',freezer,'not_supplied',not_supplied) order by boxes desc),'[]'::jsonb) v from driver_groups
), driver_chart as (
  select jsonb_build_object('labels',coalesce(jsonb_agg(driver_name order by boxes desc),'[]'::jsonb),'values',coalesce(jsonb_agg(boxes order by boxes desc),'[]'::jsonb)) v from driver_groups
), facility_chart as (
  select jsonb_build_object('labels',coalesce(jsonb_agg(facility_type order by facility_type),'[]'::jsonb),'values',coalesce(jsonb_agg(n order by facility_type),'[]'::jsonb)) v from facility_groups
), vehicle_chart as (
  select jsonb_build_object('labels',coalesce(jsonb_agg(vehicle_type order by vehicle_type),'[]'::jsonb),'normal',coalesce(jsonb_agg(normal order by vehicle_type),'[]'::jsonb),'freezer',coalesce(jsonb_agg(freezer order by vehicle_type),'[]'::jsonb)) v from vehicle_type_groups
)
select jsonb_build_object(
 'kpis',jsonb_build_object(
   'valid_invoices',stats.valid_invoices,'total_boxes',stats.total_boxes,'freezer_boxes',stats.freezer_boxes,'normal_boxes',stats.normal_boxes,
   'active_drivers',stats.active_drivers,'avg_boxes_per_driver',case when stats.active_drivers>0 then round(stats.total_boxes::numeric/stats.active_drivers,1) else 0 end,
   'not_supplied',stats.not_supplied,'avg_lead_time_days',stats.avg_lead,'unique_customers',stats.unique_customers,
   'avg_route_hours',route_stats.avg_route_hours,'orders_per_driver',case when stats.active_drivers>0 then round(stats.valid_invoices::numeric/stats.active_drivers,1) else 0 end,
   'active_vehicles',active_vehicle_count.n
 ),
 'driver_overview',drivers_json.v,
 'charts',jsonb_build_object('driver_boxes',driver_chart.v,'facility',facility_chart.v,'vantype',vehicle_chart.v,
          'returns',jsonb_build_object('delivered',stats.valid_invoices-stats.not_supplied,'not_supplied',stats.not_supplied))
) from stats,route_stats,active_vehicle_count,drivers_json,driver_chart,facility_chart,vehicle_chart;
$$;

grant execute on function public.dispatchops_dashboard_home_snapshot(date,date,jsonb) to anon,authenticated;

analyze public.sap_invoice_facts;
analyze public.landmark_visit_facts;
notify pgrst,'reload schema';
