-- Fix GPS landmark date filtering and move Lead Time aggregation into PostgreSQL.
create or replace function public.dispatchops_lead_time_summary(p_start date default null, p_end date default null, p_filters jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
as $$
with base as (
  select s.invoice_no,s.invoice_date,s.dispatch_date,s.driver_name,s.customer_name,
         s.facility_type,s.division_desc,s.area,s.vehicle_type,s.salesman,
         (s.dispatch_date-s.invoice_date) as days
  from public.sap_invoice_facts s
  where (p_start is null or s.dispatch_date >= p_start)
    and (p_end is null or s.dispatch_date <= p_end)
    and (nullif(p_filters->>'driver','') is null or s.driver_name = p_filters->>'driver')
    and (jsonb_array_length(coalesce(p_filters->'drivers','[]'::jsonb)) = 0 or s.driver_name in (select jsonb_array_elements_text(p_filters->'drivers')))
    and (jsonb_array_length(coalesce(p_filters->'areas','[]'::jsonb)) = 0 or s.area in (select jsonb_array_elements_text(p_filters->'areas')))
    and (jsonb_array_length(coalesce(p_filters->'division','[]'::jsonb)) = 0 or s.division_desc in (select jsonb_array_elements_text(p_filters->'division')))
    and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb)) = 0 or s.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type')))
    and (jsonb_array_length(coalesce(p_filters->'facility_type','[]'::jsonb)) = 0 or s.facility_type in (select jsonb_array_elements_text(p_filters->'facility_type')))
    and (jsonb_array_length(coalesce(p_filters->'salesman','[]'::jsonb)) = 0 or s.salesman in (select jsonb_array_elements_text(p_filters->'salesman')))
    and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb)) = 0 or exists (select 1 from public.areas a where (a.code=s.area or a.name=s.area) and a.route_type in (select jsonb_array_elements_text(p_filters->'route_type'))))
    and s.invoice_date is not null and s.dispatch_date is not null and s.dispatch_date >= s.invoice_date
), filtered as (
  select *, case when days<=0 then '0 Days' when days=1 then '1 Day' when days<=5 then days||' Days' else 'More than 5 Days' end as band,
         coalesce(nullif(facility_type,''),nullif(division_desc,''),'Unclassified') as class
  from base
  where (nullif(p_filters->>'lead_time_band','') is null or (case when days<=0 then '0 Days' when days=1 then '1 Day' when days<=5 then days||' Days' else 'More than 5 Days' end)=p_filters->>'lead_time_band')
    and (nullif(p_filters->>'classification','') is null or coalesce(nullif(facility_type,''),nullif(division_desc,''),'Unclassified')=p_filters->>'classification')
), classes as (select coalesce(jsonb_agg(class order by class),'[]'::jsonb) v from (select distinct class from filtered) x),
byclass as (select coalesce(jsonb_agg(jsonb_build_object('name',class,'orders',orders,'avg_days',avg_days,'min_days',min_days,'max_days',max_days) order by class),'[]'::jsonb) v from (select class,count(*) orders,round(avg(days)::numeric,2) avg_days,min(days) min_days,max(days) max_days from filtered group by class) x),
bands as (select b,coalesce((select count(*) from filtered f where f.band=b),0) n from unnest(array['0 Days','1 Day','2 Days','3 Days','4 Days','5 Days','More than 5 Days']) b),
fast as (select coalesce(jsonb_agg(jsonb_build_object('invoice_no',invoice_no,'driver_name',driver_name,'customer_name',customer_name,'invoice_date',invoice_date,'dispatch_date',dispatch_date,'days',days) order by invoice_no),'[]'::jsonb) v from (select * from filtered order by days asc,dispatch_date asc limit 100) x),
slow as (select coalesce(jsonb_agg(jsonb_build_object('invoice_no',invoice_no,'driver_name',driver_name,'customer_name',customer_name,'invoice_date',invoice_date,'dispatch_date',dispatch_date,'days',days) order by invoice_no),'[]'::jsonb) v from (select * from filtered order by days desc,dispatch_date desc limit 100) x),
allstats as (select count(*) total,round(avg(days)::numeric,2) avg_days,min(days) min_days,max(days) max_days from filtered)
select jsonb_build_object('kpis',jsonb_build_object('total_invoices',total,'overall_avg_days',avg_days,'fastest_days',min_days,'longest_days',max_days),'by_classification',(select v from byclass),'distribution',jsonb_build_object('bins',jsonb_build_array('0 Days','1 Day','2 Days','3 Days','4 Days','5 Days','More than 5 Days'),'counts',(select coalesce(jsonb_agg(n order by array_position(array['0 Days','1 Day','2 Days','3 Days','4 Days','5 Days','More than 5 Days'],b)),'[]'::jsonb) from bands)),'fastest_detail',(select v from fast),'longest_detail',(select v from slow),'band_classification_matrix',jsonb_build_object('classifications',(select v from classes),'rows',(select coalesce(jsonb_agg(jsonb_build_object('band',b,'counts',(select coalesce(jsonb_object_agg(class,n),'{}'::jsonb) from (select class,count(*) n from filtered where band=b group by class) z),'total',n)),'[]'::jsonb) from bands),'col_totals',(select coalesce(jsonb_object_agg(class,n),'{}'::jsonb) from (select class,count(*) n from filtered group by class) z),'grand_total',total),'available_bands',(select coalesce(jsonb_agg(distinct band order by band),'[]'::jsonb) from filtered),'available_classifications',(select v from classes)) from allstats;
$$;
grant execute on function public.dispatchops_lead_time_summary(date,date,jsonb) to anon, authenticated;

update public.landmark_visit_facts
set visit_date = case when arrival ~ '^\d{2} [A-Za-z]{3} \d{4}' then to_date(left(arrival,11),'DD Mon YYYY') else visit_date end
where visit_date is null and arrival is not null;

create index if not exists idx_landmark_visit_date on public.landmark_visit_facts (visit_date);
create index if not exists idx_landmark_visit_date_vehicle on public.landmark_visit_facts (visit_date, vehicle_key);
create index if not exists idx_sap_dispatch_date_invoice on public.sap_invoice_facts (dispatch_date, invoice_date);
