-- Price Change V11: one shared/default area list for every Price Change list.
-- Existing campaign-specific areas are promoted into the shared list so no
-- existing configured areas are lost.
create table if not exists public.price_change_default_areas (
  id uuid primary key default gen_random_uuid(),
  area_name text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ux_price_change_default_area on public.price_change_default_areas(lower(trim(area_name)));
create index if not exists ix_price_change_default_areas_active on public.price_change_default_areas(active, sort_order, area_name);

insert into public.price_change_default_areas(area_name, sort_order, active)
select area_name, row_number() over(order by lower(trim(area_name))) - 1, true
from (
  select distinct lower(trim(area_name)) as normalized, trim(area_name) as area_name
  from public.price_change_campaign_areas
  where active
    and nullif(trim(area_name),'') is not null
) s
on conflict (lower(trim(area_name))) do nothing;

create or replace function public.dispatchops_price_change_admin_save_default_area(p_key text,p_row jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare r public.price_change_default_areas;
begin
  if p_key <> encode(digest('0000','sha256'),'hex') then raise exception 'Admin authorization failed'; end if;
  if nullif(trim(p_row->>'area_name'),'') is null then raise exception 'Area name is required'; end if;
  if nullif(p_row->>'id','') is null then
    insert into public.price_change_default_areas(area_name,sort_order,active)
    values(trim(p_row->>'area_name'),coalesce(nullif(p_row->>'sort_order','')::integer,0),true)
    on conflict (lower(trim(area_name))) do update set active=true,updated_at=now()
    returning * into r;
  else
    update public.price_change_default_areas
    set area_name=trim(p_row->>'area_name'),
        sort_order=coalesce(nullif(p_row->>'sort_order','')::integer,0),
        active=coalesce((p_row->>'active')::boolean,true),
        updated_at=now()
    where id=(p_row->>'id')::uuid returning * into r;
    if not found then raise exception 'Default area not found'; end if;
  end if;
  return to_jsonb(r);
end $$;

create or replace function public.dispatchops_price_change_admin_delete_default_area(p_key text,p_id uuid)
returns boolean language plpgsql security definer set search_path=public,extensions,pg_temp as $$
begin
  if p_key <> encode(digest('0000','sha256'),'hex') then raise exception 'Admin authorization failed'; end if;
  update public.price_change_default_areas set active=false,updated_at=now() where id=p_id;
  return found;
end $$;

grant execute on function public.dispatchops_price_change_admin_save_default_area(text,jsonb) to anon,authenticated;
grant execute on function public.dispatchops_price_change_admin_delete_default_area(text,uuid) to anon,authenticated;

create or replace function public.dispatchops_price_change_admin_data(p_key text,p_campaign_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare result jsonb;
begin
 if p_key <> encode(digest('0000','sha256'),'hex') then raise exception 'Admin authorization failed'; end if;
 select jsonb_build_object(
  'campaigns',coalesce((select jsonb_agg(c order by c.created_at desc) from price_change_campaigns c),'[]'::jsonb),
  'items',coalesce((select jsonb_agg(i order by i.campaign_id,i.line_no) from price_change_items i where p_campaign_id is null or i.campaign_id=p_campaign_id),'[]'::jsonb),
  'assignments',coalesce((select jsonb_agg(a order by a.created_at desc) from price_change_assignments a where p_campaign_id is null or a.campaign_id=p_campaign_id),'[]'::jsonb),
  'assignment_items',coalesce((select jsonb_agg(ai) from price_change_assignment_items ai join price_change_assignments a on a.id=ai.assignment_id where p_campaign_id is null or a.campaign_id=p_campaign_id),'[]'::jsonb),
  'visits',coalesce((select jsonb_agg((to_jsonb(v) || jsonb_build_object('price_change_visit_items',coalesce((select jsonb_agg(vi order by vi.created_at) from price_change_visit_items vi where vi.visit_id=v.id),'[]'::jsonb))) order by v.visited_at desc) from price_change_customer_visits v where p_campaign_id is null or v.campaign_id=p_campaign_id),'[]'::jsonb),
  'drivers',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'code',d.code,'name',d.name,'status',d.status) order by d.name) from drivers d where coalesce(d.code,'')<>''),'[]'::jsonb),
  'default_areas',coalesce((select jsonb_agg(a order by a.sort_order,a.area_name) from price_change_default_areas a where a.active),'[]'::jsonb),
  'campaign_areas',coalesce((select jsonb_agg(ca order by ca.campaign_id,ca.sort_order,ca.area_name) from price_change_campaign_areas ca where ca.active and (p_campaign_id is null or ca.campaign_id=p_campaign_id)),'[]'::jsonb)
 ) into result;
 return result;
end $$;

create or replace function public.dispatchops_driver_data(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare did uuid; result jsonb;
begin
 select driver_id into did from driver_portal_sessions where token_hash=encode(digest(p_token,'sha256'),'hex') and expires_at>now();
 if did is null then raise exception 'Session expired'; end if;
 update driver_portal_sessions set last_seen_at=now() where token_hash=encode(digest(p_token,'sha256'),'hex');
 select jsonb_build_object(
  'driver',jsonb_build_object('id',d.id,'code',d.code,'name',d.name,'division',d.division,'veh_type',d.veh_type),
  'default_areas',coalesce((select jsonb_agg(a order by a.sort_order,a.area_name) from price_change_default_areas a where a.active),'[]'::jsonb),
  'campaigns',coalesce((select jsonb_agg(jsonb_build_object(
   'campaign',c,
   'areas',coalesce((select jsonb_agg(x order by x.area_name) from (
      select da.area_name, da.sort_order from price_change_default_areas da where da.active
      union
      select ca.area_name, ca.sort_order from price_change_campaign_areas ca where ca.campaign_id=c.id and ca.active
   ) x),'[]'::jsonb),
   'assignments',coalesce((select jsonb_agg(a order by a.created_at) from price_change_assignments a where a.campaign_id=c.id and a.driver_id=did and a.active),'[]'::jsonb),
   'items',coalesce((select jsonb_agg(i order by i.line_no) from price_change_items i where i.campaign_id=c.id and i.active),'[]'::jsonb),
   'assignment_items',coalesce((select jsonb_agg(ai) from price_change_assignment_items ai join price_change_assignments a on a.id=ai.assignment_id where a.campaign_id=c.id and a.driver_id=did and a.active),'[]'::jsonb),
   'visits',coalesce((select jsonb_agg((to_jsonb(v) || jsonb_build_object('price_change_visit_items',coalesce((select jsonb_agg(vi order by vi.created_at) from price_change_visit_items vi where vi.visit_id=v.id),'[]'::jsonb))) order by v.visited_at desc) from price_change_customer_visits v where v.campaign_id=c.id and v.driver_id=did),'[]'::jsonb)
  )) from price_change_campaigns c where c.status='OPEN'),'[]'::jsonb)
 ) into result from drivers d where d.id=did;
 return result;
end $$;

grant execute on function public.dispatchops_driver_data(text) to anon,authenticated;
notify pgrst,'reload schema';
