-- Avoid PostgREST overload resolution: keep the legacy negative-only RPC intact
-- and expose positive/negative records through a dedicated, uniquely named RPC.
drop function if exists public.dispatchops_rating_create(text,text,uuid,text,text,text,text,text,timestamptz);

create or replace function public.dispatchops_rating_create_entry(
  p_session_token text,
  p_person_type text,
  p_person_id uuid,
  p_category text,
  p_category_other text,
  p_entry_type text,
  p_severity text,
  p_details text,
  p_occurred_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  u public.dispatchops_app_users;
  person_code text;
  person_name text;
  is_sup boolean;
  deduction numeric(6,2) := 0;
  award numeric(6,2) := 0;
  r public.dispatchops_rating_incidents;
begin
  select a.* into u
  from public.dispatchops_app_users a
  join public.dispatchops_rating_sessions s on s.app_user_id=a.id
  where s.token_hash=encode(extensions.digest(coalesce(p_session_token,''),'sha256'),'hex')
    and s.expires_at>now() and a.active=true;

  if u.id is null then raise exception 'Rating session expired. Sign out and sign in again.'; end if;
  if p_person_type not in ('Driver','Helper') then raise exception 'Invalid person type'; end if;
  if coalesce(p_entry_type,'') not in ('negative','positive') then raise exception 'Invalid Rating entry type'; end if;
  if nullif(trim(coalesce(p_category,'')),'') is null or nullif(trim(coalesce(p_details,'')),'') is null then
    raise exception 'Category and details are required';
  end if;
  if coalesce(p_severity,'') not in ('Low','Medium','High') then raise exception 'Invalid points level'; end if;

  if p_person_type='Driver' then
    select coalesce(nullif(code,''),nullif(driver_code,''),''),
           coalesce(nullif(name,''),nullif(driver_name,''),'')
      into person_code,person_name from public.drivers where id=p_person_id;
  else
    select coalesce(nullif(code,''),nullif(helper_code,''),''),
           coalesce(nullif(name,''),nullif(helper_name,''),'')
      into person_code,person_name from public.helpers where id=p_person_id;
  end if;
  if person_name is null then raise exception 'Selected Driver/Helper no longer exists in Fleet Database'; end if;

  if p_entry_type='negative' then
    deduction := case p_severity when 'Low' then 1 when 'Medium' then 3 else 5 end;
  else
    award := case p_severity when 'Low' then 1 when 'Medium' then 3 else 5 end;
  end if;

  is_sup := u.role='admin' or exists(
    select 1 from public.dispatchops_rating_supervisors where app_user_id=u.id
  );

  insert into public.dispatchops_rating_incidents(
    person_type,person_id,person_code,person_name,occurred_at,category,category_other,
    severity,points_deducted,entry_type,points_awarded,details,status,
    created_by,created_by_name,approved_by,approved_by_name,approved_at
  ) values (
    p_person_type,p_person_id,person_code,person_name,coalesce(p_occurred_at,now()),
    trim(p_category),coalesce(trim(p_category_other),''),p_severity,deduction,
    p_entry_type,award,p_details,
    case when is_sup then 'approved' else 'pending' end,
    u.id,u.username,case when is_sup then u.id end,
    case when is_sup then u.username else '' end,
    case when is_sup then now() end
  ) returning * into r;

  return to_jsonb(r);
end;
$$;

revoke all on function public.dispatchops_rating_create_entry(text,text,uuid,text,text,text,text,text,timestamptz) from public,anon;
grant execute on function public.dispatchops_rating_create_entry(text,text,uuid,text,text,text,text,text,timestamptz) to anon,authenticated;
notify pgrst,'reload schema';
