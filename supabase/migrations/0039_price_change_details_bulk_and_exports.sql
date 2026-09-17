-- Price Change V7: expose visit line details to both admin and driver views,
-- fix edit/status persistence, and pin pgcrypto for delete/reset RPCs.

-- Normalize the driver visit payload so the portal continues to receive visit fields
-- directly (plus nested line items). This avoids breaking the existing client shape.
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
    'assignments',coalesce((select jsonb_agg(a order by a.created_at) from price_change_assignments a where a.campaign_id=c.id and a.driver_id=did and a.active),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(i order by i.line_no) from price_change_items i where i.campaign_id=c.id and i.active),'[]'::jsonb),
    'assignment_items',coalesce((select jsonb_agg(ai) from price_change_assignment_items ai join price_change_assignments a on a.id=ai.assignment_id where a.campaign_id=c.id and a.driver_id=did and a.active),'[]'::jsonb),
    'visits',coalesce((select jsonb_agg((to_jsonb(v) || jsonb_build_object('price_change_visit_items',coalesce((select jsonb_agg(vi order by vi.created_at) from price_change_visit_items vi where vi.visit_id=v.id),'[]'::jsonb))) order by v.visited_at desc) from price_change_customer_visits v where v.campaign_id=c.id and v.driver_id=did),'[]'::jsonb)
  )) from price_change_campaigns c where c.status='OPEN'),'[]'::jsonb)
 ) into result from drivers d where d.id=did;
 return result;
end $$;

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
  'drivers',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'code',d.code,'name',d.name,'status',d.status) order by d.name) from drivers d where coalesce(d.code,'')<>''),'[]'::jsonb)
 ) into result;
 return result;
end $$;

alter function public.dispatchops_price_change_admin_delete(text,text,uuid) set search_path=public,extensions,pg_temp;
alter function public.dispatchops_price_change_admin_reset(text,uuid,uuid) set search_path=public,extensions,pg_temp;
notify pgrst,'reload schema';
