-- Driver & Helper Rating: isolated tables and RPCs. Existing operational tables are read-only sources.
create table if not exists public.dispatchops_rating_supervisors (
  app_user_id uuid primary key references public.dispatchops_app_users(id) on delete cascade,
  assigned_by uuid references public.dispatchops_app_users(id) on delete set null,
  assigned_at timestamptz not null default now()
);

create table if not exists public.dispatchops_rating_incidents (
  id uuid primary key default extensions.gen_random_uuid(),
  person_type text not null check (person_type in ('Driver','Helper')),
  person_id uuid not null,
  person_code text not null default '',
  person_name text not null default '',
  occurred_at timestamptz not null default now(),
  category text not null,
  category_other text not null default '',
  severity text not null check (severity in ('Low','Medium','High')),
  points_deducted numeric(6,2) not null check (points_deducted >= 0),
  details text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_by uuid not null references public.dispatchops_app_users(id),
  created_by_name text not null,
  approved_by uuid references public.dispatchops_app_users(id),
  approved_by_name text not null default '',
  approved_at timestamptz,
  review_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dispatchops_rating_incidents_person_idx on public.dispatchops_rating_incidents(person_type, person_id, occurred_at desc);
create index if not exists dispatchops_rating_incidents_status_idx on public.dispatchops_rating_incidents(status, occurred_at desc);
alter table public.dispatchops_rating_supervisors enable row level security;
alter table public.dispatchops_rating_incidents enable row level security;
revoke all on public.dispatchops_rating_supervisors, public.dispatchops_rating_incidents from public, anon, authenticated;

create or replace function public.dispatchops_rating_bootstrap(p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare u public.dispatchops_app_users; is_sup boolean;
begin
  select * into u from public.dispatchops_app_users where id=p_actor_id and active=true;
  if u.id is null then raise exception 'Active application user not found'; end if;
  is_sup := u.role='admin' or exists(select 1 from public.dispatchops_rating_supervisors where app_user_id=u.id);
  return jsonb_build_object('user_id',u.id,'username',u.username,'is_admin',u.role='admin','is_supervisor',is_sup);
end $$;

create or replace function public.dispatchops_rating_list(p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare u public.dispatchops_app_users;
begin
  select * into u from public.dispatchops_app_users where id=p_actor_id and active=true;
  if u.id is null then raise exception 'Active application user not found'; end if;
  return coalesce((select jsonb_agg(to_jsonb(i) order by i.occurred_at desc, i.created_at desc) from public.dispatchops_rating_incidents i),'[]'::jsonb);
end $$;

create or replace function public.dispatchops_rating_supervisor_list(p_admin_username text,p_admin_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
begin
  if not public.dispatchops_admin_verify(p_admin_username,p_admin_password) then raise exception 'Admin authorization failed'; end if;
  return coalesce((select jsonb_agg(app_user_id) from public.dispatchops_rating_supervisors),'[]'::jsonb);
end $$;

create or replace function public.dispatchops_rating_supervisor_set(p_admin_username text,p_admin_password text,p_user_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public,extensions,pg_temp as $$
begin
  if not public.dispatchops_admin_verify(p_admin_username,p_admin_password) then raise exception 'Admin authorization failed'; end if;
  if not exists(select 1 from public.dispatchops_app_users where id=p_user_id and active=true) then raise exception 'Active user not found'; end if;
  if coalesce(p_enabled,false) then
    insert into public.dispatchops_rating_supervisors(app_user_id,assigned_by) select p_user_id,id from public.dispatchops_app_users where lower(username)=lower(trim(p_admin_username)) and role='admin' on conflict(app_user_id) do nothing;
  else
    delete from public.dispatchops_rating_supervisors where app_user_id=p_user_id;
  end if;
  return true;
end $$;

create or replace function public.dispatchops_rating_create(
  p_actor_id uuid,p_person_type text,p_person_id uuid,p_category text,p_category_other text,
  p_severity text,p_details text,p_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare u public.dispatchops_app_users; person_code text; person_name text; is_sup boolean; deduction numeric(6,2); r public.dispatchops_rating_incidents;
begin
  select * into u from public.dispatchops_app_users where id=p_actor_id and active=true;
  if u.id is null then raise exception 'Active application user not found'; end if;
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

create or replace function public.dispatchops_rating_review(p_actor_id uuid,p_incident_id uuid,p_decision text,p_review_note text default '')
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare u public.dispatchops_app_users; r public.dispatchops_rating_incidents;
begin
  select * into u from public.dispatchops_app_users where id=p_actor_id and active=true;
  if u.id is null then raise exception 'Active application user not found'; end if;
  if not (u.role='admin' or exists(select 1 from public.dispatchops_rating_supervisors where app_user_id=u.id)) then raise exception 'Supervisor approval permission required'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
  update public.dispatchops_rating_incidents set status=p_decision,approved_by=u.id,approved_by_name=u.username,approved_at=now(),review_note=coalesce(p_review_note,''),updated_at=now()
  where id=p_incident_id and status='pending' returning * into r;
  if r.id is null then raise exception 'Pending incident not found or already reviewed'; end if;
  return to_jsonb(r);
end $$;

create or replace function public.dispatchops_rating_reset(p_admin_username text,p_admin_password text)
returns integer language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare n integer;
begin
  if not public.dispatchops_admin_verify(p_admin_username,p_admin_password) then raise exception 'Admin authorization failed'; end if;
  delete from public.dispatchops_rating_incidents;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.dispatchops_rating_bootstrap(uuid) from public;
revoke all on function public.dispatchops_rating_list(uuid) from public;
revoke all on function public.dispatchops_rating_supervisor_list(text,text) from public;
revoke all on function public.dispatchops_rating_supervisor_set(text,text,uuid,boolean) from public;
revoke all on function public.dispatchops_rating_create(uuid,text,uuid,text,text,text,text,timestamptz) from public;
revoke all on function public.dispatchops_rating_review(uuid,uuid,text,text) from public;
revoke all on function public.dispatchops_rating_reset(text,text) from public;
grant execute on function public.dispatchops_rating_bootstrap(uuid) to anon,authenticated;
grant execute on function public.dispatchops_rating_list(uuid) to anon,authenticated;
grant execute on function public.dispatchops_rating_supervisor_list(text,text) to anon,authenticated;
grant execute on function public.dispatchops_rating_supervisor_set(text,text,uuid,boolean) to anon,authenticated;
grant execute on function public.dispatchops_rating_create(uuid,text,uuid,text,text,text,text,timestamptz) to anon,authenticated;
grant execute on function public.dispatchops_rating_review(uuid,uuid,text,text) to anon,authenticated;
grant execute on function public.dispatchops_rating_reset(text,text) to anon,authenticated;
notify pgrst,'reload schema';
