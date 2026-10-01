-- Ensure application login administration is present even on installs where
-- the original admin-user migration was recorded but its RPCs were missing.
alter table public.dispatchops_app_users
  add column if not exists failed_login_attempts integer not null default 0,
  add column if not exists login_locked boolean not null default false,
  add column if not exists last_failed_login_at timestamptz;

create unique index if not exists dispatchops_app_users_username_uq on public.dispatchops_app_users (lower(username));
alter table public.dispatchops_app_users enable row level security;
revoke all on public.dispatchops_app_users from public,anon,authenticated;

create or replace function public.dispatchops_admin_verify(p_admin_username text,p_admin_password text)
returns boolean language plpgsql security definer set search_path=public,extensions,pg_temp as $$
begin
  return exists(select 1 from public.dispatchops_app_users where lower(username)=lower(trim(coalesce(p_admin_username,''))) and role='admin' and active=true and password_hash=extensions.crypt(p_admin_password,password_hash));
end $$;

create or replace function public.dispatchops_admin_user_list(p_admin_username text,p_admin_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
begin
  if not public.dispatchops_admin_verify(p_admin_username,p_admin_password) then raise exception 'Admin authorization failed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'username',u.username,'role',u.role,'active',u.active,'failed_login_attempts',coalesce(u.failed_login_attempts,0),'login_locked',coalesce(u.login_locked,false),'created_at',u.created_at,'updated_at',u.updated_at) order by lower(u.username)) from public.dispatchops_app_users u),'[]'::jsonb);
end $$;

create or replace function public.dispatchops_admin_user_save(p_admin_username text,p_admin_password text,p_id uuid default null,p_username text default null,p_password text default null,p_role text default 'user',p_active boolean default true)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare r public.dispatchops_app_users;
begin
  if not public.dispatchops_admin_verify(p_admin_username,p_admin_password) then raise exception 'Admin authorization failed'; end if;
  if nullif(trim(coalesce(p_username,'')),'') is null then raise exception 'Username is required'; end if;
  if p_role not in ('admin','user','dispatcher') then raise exception 'Invalid role'; end if;
  if p_id is null and nullif(p_password,'') is null then raise exception 'Password is required for a new user'; end if;
  if p_id is null then
    insert into public.dispatchops_app_users(username,password_hash,role,active)
    values(lower(trim(p_username)),extensions.crypt(p_password,extensions.gen_salt('bf',10)),p_role,coalesce(p_active,true)) returning * into r;
  else
    update public.dispatchops_app_users
    set username=lower(trim(p_username)),role=p_role,active=coalesce(p_active,true),
        password_hash=case when nullif(p_password,'') is not null then extensions.crypt(p_password,extensions.gen_salt('bf',10)) else password_hash end,
        updated_at=now(), failed_login_attempts=0, login_locked=false, last_failed_login_at=null
    where id=p_id returning * into r;
    if r.id is null then raise exception 'User not found'; end if;
  end if;
  return jsonb_build_object('id',r.id,'username',r.username,'role',r.role,'active',r.active);
exception when unique_violation then raise exception 'Username already exists';
end $$;

create or replace function public.dispatchops_admin_user_delete(p_admin_username text,p_admin_password text,p_id uuid)
returns boolean language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare target public.dispatchops_app_users;
begin
  if not public.dispatchops_admin_verify(p_admin_username,p_admin_password) then raise exception 'Admin authorization failed'; end if;
  select * into target from public.dispatchops_app_users where id=p_id;
  if target.id is null then raise exception 'User not found'; end if;
  if target.role='admin' and (select count(*) from public.dispatchops_app_users where role='admin' and active=true)<=1 then raise exception 'At least one active admin account must remain'; end if;
  delete from public.dispatchops_app_users where id=p_id;
  return true;
end $$;

create or replace function public.dispatchops_admin_unlock_user(p_admin_username text,p_admin_password text,p_id uuid)
returns boolean language plpgsql security definer set search_path=public,extensions,pg_temp as $$
begin
  if not public.dispatchops_admin_verify(p_admin_username,p_admin_password) then raise exception 'Admin authorization failed'; end if;
  update public.dispatchops_app_users set failed_login_attempts=0,login_locked=false,last_failed_login_at=null,updated_at=now() where id=p_id;
  if not found then raise exception 'User not found'; end if;
  return true;
end $$;

grant execute on function public.dispatchops_admin_verify(text,text) to anon,authenticated;
grant execute on function public.dispatchops_admin_user_list(text,text) to anon,authenticated;
grant execute on function public.dispatchops_admin_user_save(text,text,uuid,text,text,text,boolean) to anon,authenticated;
grant execute on function public.dispatchops_admin_user_delete(text,text,uuid) to anon,authenticated;
grant execute on function public.dispatchops_admin_unlock_user(text,text,uuid) to anon,authenticated;

create or replace function public.dispatchops_auth_login(p_username text,p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare u public.dispatchops_app_users; next_fail integer;
begin
  select * into u from public.dispatchops_app_users where lower(username)=lower(trim(coalesce(p_username,''))) and active=true limit 1;
  if u.id is null then raise exception 'Invalid username or password'; end if;
  if u.role <> 'admin' and coalesce(u.login_locked,false) then raise exception 'This login is locked. Ask an administrator to unlock it.'; end if;
  if p_password is not null and u.password_hash=extensions.crypt(p_password,u.password_hash) then
    update public.dispatchops_app_users set failed_login_attempts=0,login_locked=false,last_failed_login_at=null,updated_at=now() where id=u.id;
    return jsonb_build_object('ok',true,'id',u.id,'username',u.username,'role',u.role,'active',u.active);
  end if;
  if u.role='admin' then raise exception 'Invalid username or password'; end if;
  next_fail=coalesce(u.failed_login_attempts,0)+1;
  update public.dispatchops_app_users set failed_login_attempts=next_fail,login_locked=(next_fail>=5),last_failed_login_at=now(),updated_at=now() where id=u.id;
  if next_fail>=5 then raise exception 'This login has been locked after 5 failed attempts. Ask an administrator to unlock it.'; end if;
  raise exception 'Invalid username or password';
end $$;

grant execute on function public.dispatchops_auth_login(text,text) to anon,authenticated;
notify pgrst,'reload schema';
