-- Experience federation + database usage helper.
-- Experience uploads remain independent from normal SAP Dashboard imports.

create or replace function public.dispatchops_database_size()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object('used_bytes', pg_database_size(current_database()));
$$;

grant execute on function public.dispatchops_database_size() to anon, authenticated;
