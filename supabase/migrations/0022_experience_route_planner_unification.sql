-- Unify Experience with Fleet/Route Planner canonical masters.
-- This migration never deletes or changes SAP invoice facts.
alter table public.experience_history add column if not exists area_code text not null default 'UNKNOWN';
alter table public.experience_history add column if not exists area_name text;
alter table public.experience_history add column if not exists experience_type text;
alter table public.experience_history add column if not exists route_type text;
alter table public.experience_history add column if not exists canonical_person_code text;
alter table public.experience_history add column if not exists canonical_person_name text;
alter table public.experience_history add column if not exists canonical_vehicle_number text;

create index if not exists ix_experience_history_person_area_date on public.experience_history(person_code,area_code,date desc);
create index if not exists ix_experience_history_route_lookup on public.experience_history(area_code,experience_division,vehicle_type,date desc);

-- Canonicalize existing Experience rows against Fleet masters without touching SAP data.
update public.experience_history e
set area_code=coalesce((select a.code from public.areas a where upper(regexp_replace(coalesce(a.code,''),'[^A-Z0-9]','','g'))=upper(regexp_replace(coalesce(e.area,''),'[^A-Z0-9]','','g')) or upper(regexp_replace(coalesce(a.name,''),'[^A-Z0-9]','','g'))=upper(regexp_replace(coalesce(e.area,''),'[^A-Z0-9]','','g')) limit 1),'UNKNOWN'),
    area_name=coalesce((select a.name from public.areas a where upper(regexp_replace(coalesce(a.code,''),'[^A-Z0-9]','','g'))=upper(regexp_replace(coalesce(e.area,''),'[^A-Z0-9]','','g')) or upper(regexp_replace(coalesce(a.name,''),'[^A-Z0-9]','','g'))=upper(regexp_replace(coalesce(e.area,''),'[^A-Z0-9]','','g')) limit 1),nullif(e.area,'')),
    sector=coalesce((select a.sector from public.areas a where upper(regexp_replace(coalesce(a.code,''),'[^A-Z0-9]','','g'))=upper(regexp_replace(coalesce(e.area,''),'[^A-Z0-9]','','g')) or upper(regexp_replace(coalesce(a.name,''),'[^A-Z0-9]','','g'))=upper(regexp_replace(coalesce(e.area,''),'[^A-Z0-9]','','g')) limit 1),e.sector),
    route_type=coalesce((select a.route_type from public.areas a where upper(regexp_replace(coalesce(a.code,''),'[^A-Z0-9]','','g'))=upper(regexp_replace(coalesce(e.area,''),'[^A-Z0-9]','','g')) or upper(regexp_replace(coalesce(a.name,''),'[^A-Z0-9]','','g'))=upper(regexp_replace(coalesce(e.area,''),'[^A-Z0-9]','','g')) limit 1),e.route_type),
    experience_type=coalesce(e.experience_type,e.experience_division),
    canonical_person_code=e.person_code,
    canonical_person_name=coalesce((select d.name from public.drivers d where upper(trim(coalesce(d.code,'')))=upper(trim(e.person_code)) limit 1),(select h.name from public.helpers h where upper(trim(coalesce(h.code,'')))=upper(trim(e.person_code)) limit 1),e.person_name),
    canonical_vehicle_number=coalesce((select v.vehicle_number from public.vehicles v where upper(regexp_replace(coalesce(v.vehicle_number,v.number,''),'[^A-Z0-9]','','g'))=upper(regexp_replace(coalesce(e.vehicle_number,''),'[^A-Z0-9]','','g')) order by v.updated_at desc nulls last limit 1),e.vehicle_number);

-- Experience uploads are independent from SAP Dashboard imports; never rebuild or delete them
-- automatically when the Consumer Salesmen master changes.
drop trigger if exists trg_refresh_experience_after_salesman_change on public.consumer_salesmen;
