-- DispatchOPS login protection.
-- Non-admin accounts are locked after 5 failed attempts and remain locked
-- until an administrator explicitly unlocks them. Admin accounts are exempt.
alter table public.dispatchops_app_users
  add column if not exists failed_login_attempts integer not null default 0,
  add column if not exists login_locked boolean not null default false,
  add column if not exists last_failed_login_at timestamptz;

create or replace function public.dispatchops_auth_login(p_username text,p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare u public.dispatchops_app_users; next_fail integer;
begin
  select * into u from public.dispatchops_app_users
  where lower(username)=lower(trim(coalesce(p_username,''))) and active=true limit 1;
  if u.id is null then raise exception 'Invalid username or password'; end if;
  if u.role <> 'admin' and u.login_locked then
    raise exception 'This login is locked. Ask an administrator to unlock it.';
  end if;
  if p_password is not null and u.password_hash=extensions.crypt(p_password,u.password_hash) then
    update public.dispatchops_app_users
      set failed_login_attempts=0,login_locked=false,last_failed_login_at=null,updated_at=now()
      where id=u.id;
    return jsonb_build_object('ok',true,'id',u.id,'username',u.username,'role',u.role,'active',u.active);
  end if;
  if u.role='admin' then raise exception 'Invalid username or password'; end if;
  next_fail=coalesce(u.failed_login_attempts,0)+1;
  update public.dispatchops_app_users
    set failed_login_attempts=next_fail,login_locked=(next_fail>=5),last_failed_login_at=now(),updated_at=now()
    where id=u.id;
  if next_fail>=5 then raise exception 'This login has been locked after 5 failed attempts. Ask an administrator to unlock it.'; end if;
  raise exception 'Invalid username or password';
end $$;

create or replace function public.dispatchops_admin_unlock_user(p_admin_username text,p_admin_password text,p_id uuid)
returns boolean language plpgsql security definer set search_path=public,extensions,pg_temp as $$
begin
  if not public.dispatchops_admin_verify(p_admin_username,p_admin_password) then raise exception 'Admin authorization failed'; end if;
  update public.dispatchops_app_users
    set failed_login_attempts=0,login_locked=false,last_failed_login_at=null,updated_at=now()
    where id=p_id;
  if not found then raise exception 'User not found'; end if;
  return true;
end $$;

grant execute on function public.dispatchops_auth_login(text,text) to anon,authenticated;
grant execute on function public.dispatchops_admin_unlock_user(text,text,uuid) to anon,authenticated;

create or replace function public.dispatchops_admin_user_list(p_admin_username text,p_admin_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
begin
  if not public.dispatchops_admin_verify(p_admin_username,p_admin_password) then raise exception 'Admin authorization failed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'username',u.username,'role',u.role,'active',u.active,'failed_login_attempts',u.failed_login_attempts,'login_locked',u.login_locked,'created_at',u.created_at,'updated_at',u.updated_at) order by lower(u.username)) from public.dispatchops_app_users u),'[]'::jsonb);
end $$;
grant execute on function public.dispatchops_admin_user_list(text,text) to anon,authenticated;
