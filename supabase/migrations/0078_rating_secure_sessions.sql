-- Rating-only authenticated sessions. The existing app's sessionStorage user ID is not an authorization credential.
create table if not exists public.dispatchops_rating_sessions (
  token_hash text primary key,
  app_user_id uuid not null references public.dispatchops_app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists dispatchops_rating_sessions_expiry_idx on public.dispatchops_rating_sessions(expires_at);
alter table public.dispatchops_rating_sessions enable row level security;
revoke all on public.dispatchops_rating_sessions from public,anon,authenticated;

create or replace function public.dispatchops_rating_session_open(p_username text,p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare u public.dispatchops_app_users; raw_token text;
begin
  select * into u from public.dispatchops_app_users where lower(username)=lower(trim(coalesce(p_username,''))) and active=true limit 1;
  if u.id is null or p_password is null or u.password_hash<>extensions.crypt(p_password,u.password_hash) then raise exception 'Invalid username or password'; end if;
  raw_token := encode(extensions.gen_random_bytes(32),'hex');
  insert into public.dispatchops_rating_sessions(token_hash,app_user_id,expires_at)
  values(encode(extensions.digest(raw_token,'sha256'),'hex'),u.id,now()+interval '12 hours');
  return jsonb_build_object('token',raw_token,'expires_at',now()+interval '12 hours');
end $$;

create or replace function public.dispatchops_rating_bootstrap(p_session_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare u public.dispatchops_app_users; is_sup boolean;
begin
  select a.* into u from public.dispatchops_app_users a join public.dispatchops_rating_sessions s on s.app_user_id=a.id
  where s.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex') and s.expires_at>now() and a.active=true;
  if u.id is null then raise exception 'Rating session expired. Sign out and sign in again.'; end if;
  is_sup := u.role='admin' or exists(select 1 from public.dispatchops_rating_supervisors where app_user_id=u.id);
  return jsonb_build_object('user_id',u.id,'username',u.username,'is_admin',u.role='admin','is_supervisor',is_sup);
end $$;

create or replace function public.dispatchops_rating_list(p_session_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare u public.dispatchops_app_users;
begin
  select a.* into u from public.dispatchops_app_users a join public.dispatchops_rating_sessions s on s.app_user_id=a.id
  where s.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex') and s.expires_at>now() and a.active=true;
  if u.id is null then raise exception 'Rating session expired. Sign out and sign in again.'; end if;
  return coalesce((select jsonb_agg(to_jsonb(i) order by i.occurred_at desc, i.created_at desc) from public.dispatchops_rating_incidents i),'[]'::jsonb);
end $$;

create or replace function public.dispatchops_rating_create(
  p_session_token text,p_person_type text,p_person_id uuid,p_category text,p_category_other text,
  p_severity text,p_details text,p_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare u public.dispatchops_app_users; person_code text; person_name text; is_sup boolean; deduction numeric(6,2); r public.dispatchops_rating_incidents;
begin
  select a.* into u from public.dispatchops_app_users a join public.dispatchops_rating_sessions s on s.app_user_id=a.id
  where s.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex') and s.expires_at>now() and a.active=true;
  if u.id is null then raise exception 'Rating session expired. Sign out and sign in again.'; end if;
  if p_person_type not in ('Driver','Helper') then raise exception 'Invalid person type'; end if;
  if nullif(trim(coalesce(p_category,'')),'') is null or nullif(trim(coalesce(p_details,'')),'') is null then raise exception 'Category and incident details are required'; end if;
  if p_severity not in ('Low','Medium','High') then raise exception 'Invalid severity'; end if;
  if p_person_type='Driver' then
    select coalesce(nullif(code,''),nullif(driver_code,''),''),coalesce(nullif(name,''),nullif(driver_name,''),'') into person_code,person_name from public.drivers where id=p_person_id;
  else
    select coalesce(nullif(code,''),nullif(helper_code,''),''),coalesce(nullif(name,''),nullif(helper_name,''),'') into person_code,person_name from public.helpers where id=p_person_id;
  end if;
  if person_name is null then raise exception 'Selected Driver/Helper no longer exists in Fleet Database'; end if;
  deduction := case p_severity when 'Low' then 1 when 'Medium' then 3 else 5 end;
  is_sup := u.role='admin' or exists(select 1 from public.dispatchops_rating_supervisors where app_user_id=u.id);
  insert into public.dispatchops_rating_incidents(person_type,person_id,person_code,person_name,occurred_at,category,category_other,severity,points_deducted,details,status,created_by,created_by_name,approved_by,approved_by_name,approved_at)
  values(p_person_type,p_person_id,person_code,person_name,coalesce(p_occurred_at,now()),trim(p_category),coalesce(trim(p_category_other),''),p_severity,deduction,p_details,case when is_sup then 'approved' else 'pending' end,u.id,u.username,case when is_sup then u.id end,case when is_sup then u.username else '' end,case when is_sup then now() end)
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.dispatchops_rating_review(p_session_token text,p_incident_id uuid,p_decision text,p_review_note text default '')
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare u public.dispatchops_app_users; r public.dispatchops_rating_incidents;
begin
  select a.* into u from public.dispatchops_app_users a join public.dispatchops_rating_sessions s on s.app_user_id=a.id
  where s.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex') and s.expires_at>now() and a.active=true;
  if u.id is null then raise exception 'Rating session expired. Sign out and sign in again.'; end if;
  if not (u.role='admin' or exists(select 1 from public.dispatchops_rating_supervisors where app_user_id=u.id)) then raise exception 'Supervisor approval permission required'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
  update public.dispatchops_rating_incidents set status=p_decision,approved_by=u.id,approved_by_name=u.username,approved_at=now(),review_note=coalesce(p_review_note,''),updated_at=now()
  where id=p_incident_id and status='pending' returning * into r;
  if r.id is null then raise exception 'Pending incident not found or already reviewed'; end if;
  return to_jsonb(r);
end $$;

-- Remove the ID-only entry points from the first draft so they cannot be used to impersonate a Supervisor.
drop function if exists public.dispatchops_rating_bootstrap(uuid);
drop function if exists public.dispatchops_rating_list(uuid);
drop function if exists public.dispatchops_rating_create(uuid,text,uuid,text,text,text,text,timestamptz);
drop function if exists public.dispatchops_rating_review(uuid,uuid,text,text);
revoke all on function public.dispatchops_rating_session_open(text,text) from public;
revoke all on function public.dispatchops_rating_bootstrap(text) from public;
revoke all on function public.dispatchops_rating_list(text) from public;
revoke all on function public.dispatchops_rating_create(text,text,uuid,text,text,text,text,timestamptz) from public;
revoke all on function public.dispatchops_rating_review(text,uuid,text,text) from public;
grant execute on function public.dispatchops_rating_session_open(text,text) to anon,authenticated;
grant execute on function public.dispatchops_rating_bootstrap(text) to anon,authenticated;
grant execute on function public.dispatchops_rating_list(text) to anon,authenticated;
grant execute on function public.dispatchops_rating_create(text,text,uuid,text,text,text,text,timestamptz) to anon,authenticated;
grant execute on function public.dispatchops_rating_review(text,uuid,text,text) to anon,authenticated;
notify pgrst,'reload schema';
