create or replace function public.dispatchops_rating_delete_incident(p_admin_username text,p_admin_password text,p_incident_id uuid)
returns boolean language plpgsql security definer set search_path=public,extensions,pg_temp as $$
begin
  if not public.dispatchops_admin_verify(p_admin_username,p_admin_password) then raise exception 'Admin authorization failed'; end if;
  delete from public.dispatchops_rating_incidents where id=p_incident_id;
  if not found then raise exception 'Incident not found'; end if;
  return true;
end $$;
revoke all on function public.dispatchops_rating_delete_incident(text,text,uuid) from public;
grant execute on function public.dispatchops_rating_delete_incident(text,text,uuid) to anon,authenticated;
notify pgrst,'reload schema';
