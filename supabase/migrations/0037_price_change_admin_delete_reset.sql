-- Protected admin delete/reset functions for Price Change.
-- The client sends only the SHA-256 digest of the existing local admin key.
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

revoke all on function public.dispatchops_price_change_admin_delete(text,text,uuid) from public;
revoke all on function public.dispatchops_price_change_admin_reset(text,uuid,uuid) from public;
grant execute on function public.dispatchops_price_change_admin_delete(text,text,uuid) to anon,authenticated;
grant execute on function public.dispatchops_price_change_admin_reset(text,uuid,uuid) to anon,authenticated;
notify pgrst,'reload schema';
