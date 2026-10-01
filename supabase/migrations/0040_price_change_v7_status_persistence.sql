-- Keep the driver edit/save status consistent with the selected status (including NO_STOCK).
create or replace function public.dispatchops_driver_save_visit(p_token text,p_visit jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare did uuid; vid uuid; aid uuid; x jsonb; assigned_location text; locked boolean; allowed boolean; v_campaign_id uuid; v_status text; has_positive_qty boolean:=false; existing_attachment text;
begin
 select driver_id into did from driver_portal_sessions where token_hash=encode(digest(p_token,'sha256'),'hex') and expires_at>now();
 if did is null then raise exception 'Session expired'; end if;
 aid:=nullif(p_visit->>'assignment_id','')::uuid;
 if aid is null then raise exception 'Assignment is required'; end if;
 select a.campaign_id,a.location,a.location_locked into v_campaign_id,assigned_location,locked from price_change_assignments a where a.id=aid and a.driver_id=did and a.active=true;
 if not found then raise exception 'Assignment not found'; end if;
 if not exists(select 1 from price_change_campaigns where id=v_campaign_id and status='OPEN') then raise exception 'This list is closed'; end if;
 if coalesce(trim(p_visit->>'customer_name'),'')='' then raise exception 'Customer name is required'; end if;
 if not coalesce(locked,false) and coalesce(trim(p_visit->>'location'),'')='' then raise exception 'Location is required'; end if;
 if coalesce(locked,false) and coalesce(trim(assigned_location),'')='' then raise exception 'Admin locked location is empty'; end if;
 if coalesce(trim(p_visit->>'pharmacist_name'),'')='' then raise exception 'Pharmacist name is required'; end if;
 v_status:=case when upper(coalesce(p_visit->>'status',''))='NO_STOCK' then 'NO_STOCK' else 'SUBMITTED' end;
 select attachment_path into existing_attachment from price_change_customer_visits where id=nullif(p_visit->>'id','')::uuid and driver_id=did;
 if coalesce(nullif(p_visit->>'attachment_path',''),existing_attachment) is null then raise exception 'A pharmacy/place photo is required before saving'; end if;
 if nullif(p_visit->>'id','') is not null then
   vid:=(p_visit->>'id')::uuid;
   if not exists(select 1 from price_change_customer_visits where id=vid and driver_id=did and campaign_id=v_campaign_id) then raise exception 'Visit not found'; end if;
 end if;
 insert into price_change_customer_visits(id,campaign_id,driver_id,customer_name,location,telephone,pharmacist_name,notes,status,attachment_path,signature_path)
 values(coalesce(vid,gen_random_uuid()),v_campaign_id,did,trim(p_visit->>'customer_name'),case when locked then assigned_location else trim(p_visit->>'location') end,coalesce(trim(p_visit->>'telephone'),''),trim(p_visit->>'pharmacist_name'),coalesce(p_visit->>'notes',''),v_status,nullif(p_visit->>'attachment_path',''),nullif(p_visit->>'signature_path',''))
 on conflict(id) do update set customer_name=excluded.customer_name,location=excluded.location,telephone=excluded.telephone,pharmacist_name=excluded.pharmacist_name,notes=excluded.notes,status=excluded.status,attachment_path=coalesce(excluded.attachment_path,price_change_customer_visits.attachment_path),signature_path=coalesce(excluded.signature_path,price_change_customer_visits.signature_path),updated_at=now();
 delete from price_change_visit_items where visit_id=coalesce(vid,(select id from price_change_customer_visits where campaign_id=v_campaign_id and driver_id=did and customer_name=trim(p_visit->>'customer_name') order by updated_at desc limit 1));
 select coalesce(vid,(select id from price_change_customer_visits where campaign_id=v_campaign_id and driver_id=did and customer_name=trim(p_visit->>'customer_name') order by updated_at desc limit 1)) into vid;
 for x in select * from jsonb_array_elements(coalesce(p_visit->'items','[]'::jsonb)) loop
   if coalesce((x->>'quantity')::integer,0)<0 then raise exception 'Quantity cannot be negative'; end if;
   if coalesce((x->>'quantity')::integer,0)>0 then has_positive_qty:=true; end if;
   select exists(select 1 from price_change_assignment_items ai where ai.assignment_id=aid and ai.item_id=(x->>'item_id')::uuid) into allowed;
   if not allowed then raise exception 'Item is not assigned to this customer'; end if;
   insert into price_change_visit_items(visit_id,item_id,quantity) values(vid,(x->>'item_id')::uuid,coalesce((x->>'quantity')::integer,0));
 end loop;
 if not has_positive_qty and v_status<>'NO_STOCK' then raise exception 'Enter quantity for at least one item, or select No Stock'; end if;
 return jsonb_build_object('ok',true,'visit_id',vid,'status',v_status);
end $$;
notify pgrst,'reload schema';
