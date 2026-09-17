-- Canonical Experience Area Codes
-- Always resolve Experience against the canonical Areas master by code OR exact normalized name.
-- If a vehicle is anchored to an Area, retain that anchor as a separate reference so Route Planner
-- can use it without falsely changing the actual area where the person worked.

alter table public.experience_history add column if not exists experienced_area_code text not null default 'UNKNOWN';
alter table public.experience_history add column if not exists experienced_area_name text;
alter table public.experience_history add column if not exists anchored_area_code text;
alter table public.experience_history add column if not exists anchored_area_name text;

create index if not exists ix_experience_history_experienced_area_code on public.experience_history(experienced_area_code);
create index if not exists ix_experience_history_anchored_area_code on public.experience_history(anchored_area_code);

-- Canonicalize every existing row. Never use the Area Name as the code.
-- The lateral match below is the single source of truth.
-- Match by code first, then by normalized name. This also repairs rows imported by older versions.
with matches as (
  select e.id, a.code, a.name, a.sector, a.route_type
  from public.experience_history e
  join lateral (
    select a.*
    from public.areas a
    where upper(regexp_replace(trim(coalesce(a.code,'')),'[^A-Z0-9]','','g')) = upper(regexp_replace(trim(coalesce(e.area_code,'')),'[^A-Z0-9]','','g'))
       or upper(regexp_replace(trim(coalesce(a.name,'')),'[^A-Z0-9]','','g')) = upper(regexp_replace(trim(coalesce(e.area_name,e.area,'')),'[^A-Z0-9]','','g'))
       or upper(regexp_replace(trim(coalesce(a.name,'')),'[^A-Z0-9]','','g')) = upper(regexp_replace(trim(coalesce(e.area,'')),'[^A-Z0-9]','','g'))
    order by case when upper(trim(coalesce(a.code,'')))=upper(trim(coalesce(e.area_code,''))) then 0 else 1 end
    limit 1
  ) a on true
)
update public.experience_history e
set area_code=m.code, area_name=m.name, sector=coalesce(m.sector,e.sector), route_type=coalesce(m.route_type,e.route_type),
    experienced_area_code=m.code, experienced_area_name=m.name
from matches m where e.id=m.id;

-- Resolve vehicle anchor independently. The actual experienced area remains the actual route area;
-- anchored_area_code tells Route Planner that the assigned vehicle is anchored to another specific Area.
with anchors as (
  select e.id, a.code, a.name
  from public.experience_history e
  join lateral (
    select ar.code, ar.name
    from public.area_anchored_vehicles av
    join public.areas ar on ar.id=av.area_id
    join public.vehicles v on v.id=av.vehicle_id
    where upper(regexp_replace(coalesce(v.vehicle_number,v.number,''),'[^A-Z0-9]','','g')) = upper(regexp_replace(coalesce(e.vehicle_number,''),'[^A-Z0-9]','','g'))
    order by ar.code
    limit 1
  ) a on true
)
update public.experience_history e
set anchored_area_code=a.code, anchored_area_name=a.name
from anchors a where e.id=a.id;

-- Keep the existing canonical fields synchronized for route-planner consumers.
update public.experience_history
set canonical_person_code=person_code,
    canonical_person_name=coalesce(canonical_person_name,person_name),
    canonical_vehicle_number=coalesce(canonical_vehicle_number,vehicle_number)
where canonical_person_code is null or canonical_vehicle_number is null;
