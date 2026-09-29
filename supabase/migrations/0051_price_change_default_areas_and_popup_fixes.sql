-- V35.26 Price Change follow-up:
-- 1) Persist a master set of Price Change areas independently of campaigns.
-- 2) Seed that master set from the areas already configured on existing lists.
-- 3) Copy master defaults into every newly-created Price Change list.
-- 4) Return campaign areas/default areas from the admin data RPC.
create table if not exists public.price_change_default_areas (
  id uuid primary key default gen_random_uuid(),
  area_name text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ux_price_change_default_area on public.price_change_default_areas(lower(trim(area_name)));
create index if not exists ix_price_change_default_areas_active on public.price_change_default_areas(active, sort_order);

-- Preserve the areas already entered by the user as the master defaults.
insert into public.price_change_default_areas(area_name,sort_order,active)
select min(trim(area_name)), row_number() over(order by min(sort_order), min(trim(area_name))) - 1, true
from public.price_change_campaign_areas
where active and nullif(trim(area_name),'') is not null
group by lower(trim(area_name))
on conflict (lower(trim(area_name))) do nothing;

create or replace function public.dispatchops_price_change_admin_save_campaign(p_key text,p_row jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare r public.price_change_campaigns; rid uuid; is_new boolean;
begin
 if p_key <> encode(digest('0000','sha256'),'hex') then raise exception 'Admin authorization failed'; end if;
 is_new := nullif(p_row->>'id','') is null;
 rid := coalesce(nullif(p_row->>'id','')::uuid, gen_random_uuid());
 insert into public.price_change_campaigns(id,title,document_date,effective_date,decree_numbers,notes,status)
 values(rid,coalesce(p_row->>'title',''),nullif(p_row->>'document_date','')::date,nullif(p_row->>'effective_date','')::date,coalesce(p_row->>'decree_numbers',''),coalesce(p_row->>'notes',''),coalesce(p_row->>'status','OPEN'))
 on conflict(id) do update set title=excluded.title,document_date=excluded.document_date,effective_date=excluded.effective_date,decree_numbers=excluded.decree_numbers,notes=excluded.notes,status=excluded.status,updated_at=now()
 returning * into r;

 -- Only a genuinely new list inherits the master defaults. Existing lists keep
 -- their own editable area set exactly as the user left it.
 if is_new then
   insert into public.price_change_campaign_areas(campaign_id,area_name,sort_order,active)
   select rid, d.area_name, d.sort_order, true
   from public.price_change_default_areas d
   where d.active
   order by d.sort_order, d.area_name
   on conflict (campaign_id, lower(trim(area_name))) do nothing;
 end if;
 return to_jsonb(r);
end $$;

grant execute on function public.dispatchops_price_change_admin_save_campaign(text,jsonb) to anon,authenticated;

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
  'campaign_areas',coalesce((select jsonb_agg(ca order by ca.campaign_id,ca.sort_order,ca.area_name) from price_change_campaign_areas ca where (p_campaign_id is null or ca.campaign_id=p_campaign_id)),'[]'::jsonb),
  'default_areas',coalesce((select jsonb_agg(da order by da.sort_order,da.area_name) from price_change_default_areas da where da.active),'[]'::jsonb),
  'drivers',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'code',d.code,'name',d.name,'status',d.status) order by d.name) from drivers d where coalesce(d.code,'')<>''),'[]'::jsonb)
 ) into result;
 return result;
end $$;

grant execute on function public.dispatchops_price_change_admin_data(text,uuid) to anon,authenticated;
notify pgrst,'reload schema';
