-- Price Change list-level visibility.
-- Hiding a list must not remove or deactivate any driver assignment/submission.

alter table public.price_change_campaigns
  add column if not exists hidden_from_driver_portal boolean not null default false;

create or replace function public.dispatchops_price_change_admin_save_campaign(p_key text,p_row jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare r public.price_change_campaigns; rid uuid; is_new boolean;
begin
 if p_key <> encode(digest('0000','sha256'),'hex') then raise exception 'Admin authorization failed'; end if;
 is_new := nullif(p_row->>'id','') is null;
 rid := coalesce(nullif(p_row->>'id','')::uuid, gen_random_uuid());
 insert into public.price_change_campaigns(id,title,document_date,effective_date,decree_numbers,notes,status,hidden_from_driver_portal)
 values(rid,coalesce(p_row->>'title',''),nullif(p_row->>'document_date','')::date,nullif(p_row->>'effective_date','')::date,coalesce(p_row->>'decree_numbers',''),coalesce(p_row->>'notes',''),coalesce(p_row->>'status','OPEN'),coalesce((p_row->>'hidden_from_driver_portal')::boolean,false))
 on conflict(id) do update set title=excluded.title,document_date=excluded.document_date,effective_date=excluded.effective_date,decree_numbers=excluded.decree_numbers,notes=excluded.notes,status=excluded.status,hidden_from_driver_portal=excluded.hidden_from_driver_portal,updated_at=now()
 returning * into r;
 if is_new then
   insert into public.price_change_campaign_areas(campaign_id,area_name,sort_order,active)
   select rid,d.area_name,d.sort_order,true
   from public.price_change_default_areas d
   where d.active
   order by d.sort_order,d.area_name
   on conflict (campaign_id, lower(trim(area_name))) do nothing;
 end if;
 return to_jsonb(r);
end $$;

grant execute on function public.dispatchops_price_change_admin_save_campaign(text,jsonb) to anon,authenticated;

create or replace function public.dispatchops_driver_data(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare did uuid; result jsonb;
begin
 select driver_id into did from driver_portal_sessions where token_hash=encode(digest(p_token,'sha256'),'hex') and expires_at>now();
 if did is null then raise exception 'Session expired'; end if;
 update driver_portal_sessions set last_seen_at=now() where token_hash=encode(digest(p_token,'sha256'),'hex');
 select jsonb_build_object(
  'driver',jsonb_build_object('id',d.id,'code',d.code,'name',d.name,'division',d.division,'veh_type',d.veh_type),
  'campaigns',coalesce((select jsonb_agg(jsonb_build_object(
   'campaign',c,
   'areas',coalesce((select jsonb_agg(ca order by ca.sort_order,ca.area_name) from price_change_campaign_areas ca where ca.campaign_id=c.id and ca.active),'[]'::jsonb),
   'assignments',coalesce((select jsonb_agg(a order by a.created_at) from price_change_assignments a where a.campaign_id=c.id and a.driver_id=did and a.active),'[]'::jsonb),
   'items',coalesce((select jsonb_agg(i order by i.line_no) from price_change_items i where i.campaign_id=c.id and i.active),'[]'::jsonb),
   'assignment_items',coalesce((select jsonb_agg(ai) from price_change_assignment_items ai join price_change_assignments a on a.id=ai.assignment_id where a.campaign_id=c.id and a.driver_id=did and a.active),'[]'::jsonb),
   'visits',coalesce((select jsonb_agg((to_jsonb(v) || jsonb_build_object('price_change_visit_items',coalesce((select jsonb_agg(vi order by vi.created_at) from price_change_visit_items vi where vi.visit_id=v.id),'[]'::jsonb))) order by v.visited_at desc) from price_change_customer_visits v where v.campaign_id=c.id and v.driver_id=did),'[]'::jsonb)
  )) from price_change_campaigns c where c.status='OPEN' and c.hidden_from_driver_portal=false and exists(select 1 from price_change_assignments aa where aa.campaign_id=c.id and aa.driver_id=did and aa.active=true)),'[]'::jsonb)
 ) into result from drivers d where d.id=did;
 return result;
end $$;

grant execute on function public.dispatchops_driver_data(text) to anon,authenticated;
notify pgrst,'reload schema';
