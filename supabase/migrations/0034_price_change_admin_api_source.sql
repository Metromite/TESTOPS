-- Admin API source for the Price Change manager. The existing DispatchOPS shell uses the same local
-- admin reset credential; the driver portal never receives these functions' authorization input.
create or replace function public.dispatchops_price_change_admin_data(p_key text,p_campaign_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if p_key <> encode(digest('0000','sha256'),'hex') then raise exception 'Admin authorization failed'; end if;
 select jsonb_build_object(
  'campaigns',coalesce((select jsonb_agg(c order by c.created_at desc) from price_change_campaigns c),'[]'::jsonb),
  'items',coalesce((select jsonb_agg(i order by i.campaign_id,i.line_no) from price_change_items i where p_campaign_id is null or i.campaign_id=p_campaign_id),'[]'::jsonb),
  'assignments',coalesce((select jsonb_agg(a order by a.created_at desc) from price_change_assignments a where p_campaign_id is null or a.campaign_id=p_campaign_id),'[]'::jsonb),
  'assignment_items',coalesce((select jsonb_agg(ai) from price_change_assignment_items ai join price_change_assignments a on a.id=ai.assignment_id where p_campaign_id is null or a.campaign_id=p_campaign_id),'[]'::jsonb),
  'visits',coalesce((select jsonb_agg(v order by v.visited_at desc) from price_change_customer_visits v where p_campaign_id is null or v.campaign_id=p_campaign_id),'[]'::jsonb),
  'drivers',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'code',d.code,'name',d.name,'status',d.status) order by d.name) from drivers d where coalesce(d.code,'')<>''),'[]'::jsonb)
 ) into result;
 return result;
end $$;

create or replace function public.dispatchops_price_change_admin_save_campaign(p_key text,p_row jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r price_change_campaigns;
begin
 if p_key <> encode(digest('0000','sha256'),'hex') then raise exception 'Admin authorization failed'; end if;
 insert into price_change_campaigns(id,title,document_date,effective_date,decree_numbers,notes,status)
 values(coalesce(nullif(p_row->>'id','')::uuid,gen_random_uuid()),coalesce(p_row->>'title',''),nullif(p_row->>'document_date','')::date,nullif(p_row->>'effective_date','')::date,coalesce(p_row->>'decree_numbers',''),coalesce(p_row->>'notes',''),coalesce(p_row->>'status','OPEN'))
 on conflict(id) do update set title=excluded.title,document_date=excluded.document_date,effective_date=excluded.effective_date,decree_numbers=excluded.decree_numbers,notes=excluded.notes,status=excluded.status,updated_at=now()
 returning * into r; return to_jsonb(r);
end $$;

create or replace function public.dispatchops_price_change_admin_save_item(p_key text,p_row jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r price_change_items; rid uuid;
begin
 if p_key <> encode(digest('0000','sha256'),'hex') then raise exception 'Admin authorization failed'; end if;
 rid:=coalesce(nullif(p_row->>'id','')::uuid,gen_random_uuid());
 insert into price_change_items(id,campaign_id,line_no,item_code,item_description,old_pharmacy_price,old_public_price,new_pharmacy_price,new_public_price,default_pack_qty,active)
 values(rid,(p_row->>'campaign_id')::uuid,coalesce((p_row->>'line_no')::integer,1),coalesce(p_row->>'item_code',''),coalesce(p_row->>'item_description',''),nullif(p_row->>'old_pharmacy_price','')::numeric,nullif(p_row->>'old_public_price','')::numeric,nullif(p_row->>'new_pharmacy_price','')::numeric,nullif(p_row->>'new_public_price','')::numeric,nullif(p_row->>'default_pack_qty','')::integer,coalesce((p_row->>'active')::boolean,true))
 on conflict(id) do update set campaign_id=excluded.campaign_id,line_no=excluded.line_no,item_code=excluded.item_code,item_description=excluded.item_description,old_pharmacy_price=excluded.old_pharmacy_price,old_public_price=excluded.old_public_price,new_pharmacy_price=excluded.new_pharmacy_price,new_public_price=excluded.new_public_price,default_pack_qty=excluded.default_pack_qty,active=excluded.active;
 select * into r from price_change_items where id=rid; return to_jsonb(r);
end $$;

create or replace function public.dispatchops_price_change_admin_save_assignment(p_key text,p_row jsonb,p_item_ids uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r price_change_assignments;
begin
 if p_key <> encode(digest('0000','sha256'),'hex') then raise exception 'Admin authorization failed'; end if;
 insert into price_change_assignments(id,campaign_id,driver_id,customer_name,location,telephone,assigned_at,notes,active,location_locked)
 values(coalesce(nullif(p_row->>'id','')::uuid,gen_random_uuid()),(p_row->>'campaign_id')::uuid,(p_row->>'driver_id')::uuid,coalesce(p_row->>'customer_name',''),coalesce(p_row->>'location',''),coalesce(p_row->>'telephone',''),coalesce(nullif(p_row->>'assigned_at','')::timestamptz,now()),coalesce(p_row->>'notes',''),coalesce((p_row->>'active')::boolean,true),coalesce((p_row->>'location_locked')::boolean,false))
 on conflict(id) do update set campaign_id=excluded.campaign_id,driver_id=excluded.driver_id,customer_name=excluded.customer_name,location=excluded.location,telephone=excluded.telephone,assigned_at=excluded.assigned_at,notes=excluded.notes,active=excluded.active,location_locked=excluded.location_locked,updated_at=now()
 returning * into r;
 delete from price_change_assignment_items where assignment_id=r.id;
 insert into price_change_assignment_items(assignment_id,item_id) select r.id,x from unnest(coalesce(p_item_ids,'{}')) x on conflict do nothing;
 return to_jsonb(r);
end $$;

create or replace function public.dispatchops_price_change_admin_delete(p_key text,p_table text,p_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_key <> encode(digest('0000','sha256'),'hex') then raise exception 'Admin authorization failed'; end if;
 if p_table='campaign' then delete from price_change_campaigns where id=p_id;
 elsif p_table='item' then delete from price_change_items where id=p_id;
 elsif p_table='assignment' then delete from price_change_assignments where id=p_id;
 elsif p_table='visit' then delete from price_change_customer_visits where id=p_id;
 else raise exception 'Unsupported delete target'; end if;
 return true;
end $$;

create or replace function public.dispatchops_price_change_admin_reset(p_key text,p_campaign_id uuid default null,p_driver_id uuid default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_key <> encode(digest('0000','sha256'),'hex') then raise exception 'Admin authorization failed'; end if;
 if p_campaign_id is null and p_driver_id is null then delete from price_change_customer_visits;
 elsif p_driver_id is null then delete from price_change_customer_visits where campaign_id=p_campaign_id;
 elsif p_campaign_id is null then delete from price_change_customer_visits where driver_id=p_driver_id;
 else delete from price_change_customer_visits where campaign_id=p_campaign_id and driver_id=p_driver_id; end if;
 return true;
end $$;

revoke all on function public.dispatchops_price_change_admin_data(text,uuid) from public;
revoke all on function public.dispatchops_price_change_admin_save_campaign(text,jsonb) from public;
revoke all on function public.dispatchops_price_change_admin_save_item(text,jsonb) from public;
revoke all on function public.dispatchops_price_change_admin_save_assignment(text,jsonb,uuid[]) from public;
revoke all on function public.dispatchops_price_change_admin_delete(text,text,uuid) from public;
revoke all on function public.dispatchops_price_change_admin_reset(text,uuid,uuid) from public;
grant execute on function public.dispatchops_price_change_admin_data(text,uuid) to anon,authenticated;
grant execute on function public.dispatchops_price_change_admin_save_campaign(text,jsonb) to anon,authenticated;
grant execute on function public.dispatchops_price_change_admin_save_item(text,jsonb) to anon,authenticated;
grant execute on function public.dispatchops_price_change_admin_save_assignment(text,jsonb,uuid[]) to anon,authenticated;
grant execute on function public.dispatchops_price_change_admin_delete(text,text,uuid) to anon,authenticated;
grant execute on function public.dispatchops_price_change_admin_reset(text,uuid,uuid) to anon,authenticated;
notify pgrst,'reload schema';
