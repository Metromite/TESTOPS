-- Price Change maintenance + deterministic driver initial password.
create or replace function public.dispatchops_price_change_admin_delete(p_key text,p_table text,p_id uuid)
returns boolean language plpgsql security definer set search_path=public,extensions,pg_temp as $$
begin
 if p_key <> encode(digest('0000','sha256'),'hex') then raise exception 'Admin authorization failed'; end if;
 if p_table='campaign' then
   delete from price_change_customer_visits where campaign_id=p_id;
   delete from price_change_assignment_items where assignment_id in (select id from price_change_assignments where campaign_id=p_id);
   delete from price_change_assignments where campaign_id=p_id;
   delete from price_change_items where campaign_id=p_id;
   delete from price_change_campaigns where id=p_id;
 elsif p_table='item' then
   delete from price_change_visit_items where item_id=p_id;
   delete from price_change_assignment_items where item_id=p_id;
   delete from price_change_items where id=p_id;
 elsif p_table='assignment' then
   delete from price_change_customer_visits where assignment_id=p_id;
   delete from price_change_assignment_items where assignment_id=p_id;
   delete from price_change_assignments where id=p_id;
 elsif p_table='visit' then
   delete from price_change_visit_items where visit_id=p_id;
   delete from price_change_customer_visits where id=p_id;
 else raise exception 'Unsupported delete target'; end if;
 return true;
end $$;
revoke all on function public.dispatchops_price_change_admin_delete(text,text,uuid) from public;
grant execute on function public.dispatchops_price_change_admin_delete(text,text,uuid) to anon,authenticated;

-- Driver login: password is driver + driver code, e.g. T046 -> driverT046.
create or replace function public.dispatchops_driver_login(p_username text,p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare a driver_portal_accounts; d drivers; token text; expected text;
begin
 select * into a from driver_portal_accounts where username=upper(trim(p_username)) and enabled=true;
 if not found or (a.locked_until is not null and a.locked_until>now()) then raise exception 'Invalid username or password'; end if;
 select * into d from drivers where id=a.driver_id;
 expected:='driver'||upper(trim(d.code));
 if crypt(p_password,a.password_hash)<>a.password_hash then
   if crypt(expected,a.password_hash)<>a.password_hash then
     update driver_portal_accounts set failed_attempts=failed_attempts+1,locked_until=case when failed_attempts+1>=5 then now()+interval '15 minutes' else locked_until end,updated_at=now() where driver_id=a.driver_id;
     raise exception 'Invalid username or password';
   end if;
   update driver_portal_accounts set password_hash=crypt(expected,gen_salt('bf')),failed_attempts=0,locked_until=null,last_login_at=now(),updated_at=now() where driver_id=a.driver_id;
 else
   update driver_portal_accounts set failed_attempts=0,locked_until=null,last_login_at=now(),updated_at=now() where driver_id=a.driver_id;
 end if;
 token=encode(gen_random_bytes(32),'hex');
 insert into driver_portal_sessions(driver_id,token_hash,expires_at) values(a.driver_id,encode(digest(token,'sha256'),'hex'),now()+interval '30 days');
 return jsonb_build_object('token',token,'expires_at',now()+interval '30 days','driver',jsonb_build_object('id',d.id,'code',d.code,'name',d.name,'division',d.division,'veh_type',d.veh_type));
end $$;
revoke all on function public.dispatchops_driver_login(text,text) from public;
grant execute on function public.dispatchops_driver_login(text,text) to anon,authenticated;
notify pgrst,'reload schema';
