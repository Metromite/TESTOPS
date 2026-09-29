create or replace function public.dispatchops_price_change_admin_data(p_key text,p_campaign_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare result jsonb;
begin
 if p_key <> encode(digest('0000','sha256'),'hex') then raise exception 'Admin authorization failed'; end if;
 select jsonb_build_object(
  'campaigns',coalesce((select jsonb_agg(c order by c.created_at desc) from price_change_campaigns c),'[]'::jsonb),
  'items',case when p_campaign_id is null then '[]'::jsonb else coalesce((select jsonb_agg(i order by i.campaign_id,i.line_no) from price_change_items i where i.campaign_id=p_campaign_id),'[]'::jsonb) end,
  'assignments',case when p_campaign_id is null then '[]'::jsonb else coalesce((select jsonb_agg(a order by a.created_at desc) from price_change_assignments a where a.campaign_id=p_campaign_id),'[]'::jsonb) end,
  'assignment_items',case when p_campaign_id is null then '[]'::jsonb else coalesce((select jsonb_agg(ai) from price_change_assignment_items ai join price_change_assignments a on a.id=ai.assignment_id where a.campaign_id=p_campaign_id),'[]'::jsonb) end,
  'visits',case when p_campaign_id is null then '[]'::jsonb else coalesce((select jsonb_agg((to_jsonb(v) || jsonb_build_object('price_change_visit_items',coalesce((select jsonb_agg(vi order by vi.created_at) from price_change_visit_items vi where vi.visit_id=v.id),'[]'::jsonb))) order by v.visited_at desc) from price_change_customer_visits v where v.campaign_id=p_campaign_id),'[]'::jsonb) end,
  'campaign_areas',coalesce((select jsonb_agg(ca order by ca.campaign_id,ca.sort_order,ca.area_name) from price_change_campaign_areas ca where p_campaign_id is null or ca.campaign_id=p_campaign_id),'[]'::jsonb),
  'default_areas',coalesce((select jsonb_agg(da order by da.sort_order,da.area_name) from price_change_default_areas da where da.active),'[]'::jsonb),
  'drivers',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'code',d.code,'name',d.name,'status',d.status) order by d.name) from drivers d where coalesce(d.code,'')<>''),'[]'::jsonb)
 ) into result;
 return result;
end $$;
grant execute on function public.dispatchops_price_change_admin_data(text,uuid) to anon,authenticated;
notify pgrst,'reload schema';
