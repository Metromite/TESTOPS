-- Full Price Change driver portal API source.
-- This migration is kept in source control for deployment. It uses a short-lived opaque portal token,
-- hashes tokens server-side, validates driver ownership for every read/write/delete, and never accepts
-- a driver-supplied visit timestamp.
create extension if not exists pgcrypto;

alter table public.price_change_assignments add column if not exists location_locked boolean not null default false;

create table if not exists public.driver_portal_accounts (
  driver_id uuid primary key references public.drivers(id) on delete cascade,
  username text not null unique,
  password_hash text not null,
  enabled boolean not null default true,
  last_login_at timestamptz,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.driver_portal_sessions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists ix_driver_portal_sessions_token on public.driver_portal_sessions(token_hash);

alter table public.driver_portal_accounts enable row level security;
alter table public.driver_portal_sessions enable row level security;
revoke all on public.driver_portal_accounts from anon,authenticated;
revoke all on public.driver_portal_sessions from anon,authenticated;

-- Provision current drivers with username=driver code and the requested initial password.
-- If an account already exists, its password is not overwritten here.
insert into public.driver_portal_accounts(driver_id,username,password_hash)
select d.id,upper(trim(d.code)),crypt('driver',gen_salt('bf'))
from public.drivers d where coalesce(trim(d.code),'')<>''
on conflict(driver_id) do update set username=excluded.username,updated_at=now();

create or replace function public.dispatchops_driver_login(p_username text,p_password text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a driver_portal_accounts; d drivers; token text;
begin
 select * into a from driver_portal_accounts where username=upper(trim(p_username)) and enabled=true;
 if not found or (a.locked_until is not null and a.locked_until>now()) then raise exception 'Invalid username or password'; end if;
 if crypt(p_password,a.password_hash)<>a.password_hash then
   update driver_portal_accounts set failed_attempts=failed_attempts+1,locked_until=case when failed_attempts+1>=5 then now()+interval '15 minutes' else locked_until end,updated_at=now() where driver_id=a.driver_id;
   raise exception 'Invalid username or password';
 end if;
 token=encode(gen_random_bytes(32),'hex');
 insert into driver_portal_sessions(driver_id,token_hash,expires_at) values(a.driver_id,encode(digest(token,'sha256'),'hex'),now()+interval '30 days');
 update driver_portal_accounts set failed_attempts=0,locked_until=null,last_login_at=now(),updated_at=now() where driver_id=a.driver_id;
 select * into d from drivers where id=a.driver_id;
 return jsonb_build_object('token',token,'expires_at',now()+interval '30 days','driver',jsonb_build_object('id',d.id,'code',d.code,'name',d.name,'division',d.division,'veh_type',d.veh_type));
end $$;

create or replace function public.dispatchops_driver_data(p_token text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare did uuid; result jsonb;
begin
 select driver_id into did from driver_portal_sessions where token_hash=encode(digest(p_token,'sha256'),'hex') and expires_at>now();
 if did is null then raise exception 'Session expired'; end if;
 update driver_portal_sessions set last_seen_at=now() where token_hash=encode(digest(p_token,'sha256'),'hex');
 select jsonb_build_object('driver',jsonb_build_object('id',d.id,'code',d.code,'name',d.name,'division',d.division,'veh_type',d.veh_type),'campaigns',coalesce((select jsonb_agg(jsonb_build_object('campaign',c,'assignments',coalesce((select jsonb_agg(a order by a.created_at) from price_change_assignments a where a.campaign_id=c.id and a.driver_id=did and a.active),'[]'::jsonb),'items',coalesce((select jsonb_agg(i order by i.line_no) from price_change_items i where i.campaign_id=c.id and i.active),'[]'::jsonb),'assignment_items',coalesce((select jsonb_agg(ai) from price_change_assignment_items ai join price_change_assignments a on a.id=ai.assignment_id where a.campaign_id=c.id and a.driver_id=did and a.active),'[]'::jsonb),'visits',coalesce((select jsonb_agg(v order by v.visited_at desc) from price_change_customer_visits v where v.campaign_id=c.id and v.driver_id=did),'[]'::jsonb))) from price_change_campaigns c where c.status='OPEN'),'[]'::jsonb)) into result from drivers d where d.id=did;
 return result;
end $$;

create or replace function public.dispatchops_driver_save_visit(p_token text,p_visit jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
 if (not coalesce(locked,false)) and coalesce(trim(p_visit->>'location'),'')='' then raise exception 'Location is required'; end if;
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
 on conflict(id) do update set customer_name=excluded.customer_name,location=excluded.location,telephone=excluded.telephone,pharmacist_name=excluded.pharmacist_name,notes=excluded.notes,status='SUBMITTED',attachment_path=coalesce(excluded.attachment_path,price_change_customer_visits.attachment_path),signature_path=coalesce(excluded.signature_path,price_change_customer_visits.signature_path),updated_at=now();
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

create or replace function public.dispatchops_driver_delete_visit(p_token text,p_visit_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare did uuid; deleted_count integer;
begin
 select driver_id into did from driver_portal_sessions where token_hash=encode(digest(p_token,'sha256'),'hex') and expires_at>now();
 if did is null then raise exception 'Session expired'; end if;
 delete from price_change_customer_visits where id=p_visit_id and driver_id=did;
 get diagnostics deleted_count = row_count;
 return deleted_count > 0;
end $$;

create or replace function public.dispatchops_driver_logout(p_token text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin delete from driver_portal_sessions where token_hash=encode(digest(p_token,'sha256'),'hex'); return true; end $$;

revoke all on function public.dispatchops_driver_login(text,text) from public;
revoke all on function public.dispatchops_driver_data(text) from public;
revoke all on function public.dispatchops_driver_save_visit(text,jsonb) from public;
revoke all on function public.dispatchops_driver_delete_visit(text,uuid) from public;
revoke all on function public.dispatchops_driver_logout(text) from public;
grant execute on function public.dispatchops_driver_login(text,text) to anon,authenticated;
grant execute on function public.dispatchops_driver_data(text) to anon,authenticated;
grant execute on function public.dispatchops_driver_save_visit(text,jsonb) to anon,authenticated;
grant execute on function public.dispatchops_driver_delete_visit(text,uuid) to anon,authenticated;
grant execute on function public.dispatchops_driver_logout(text) to anon,authenticated;

notify pgrst,'reload schema';
