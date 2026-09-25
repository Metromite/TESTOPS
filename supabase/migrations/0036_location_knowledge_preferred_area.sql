-- Preferred canonical branch for an exact learned customer/shipment/remarks pattern.
-- This never invents an area: the value must be a canonical Areas master code.
alter table public.invoice_location_knowledge
  add column if not exists preferred_area_code text;

create index if not exists ix_invoice_location_preferred_area
  on public.invoice_location_knowledge(preferred_area_code)
  where preferred_area_code is not null;

create or replace function public.dispatchops_set_location_preference(p_id uuid,p_area_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r public.invoice_location_knowledge;
begin
  if coalesce(trim(p_area_code),'')='' then raise exception 'Area code is required'; end if;
  if not exists(select 1 from public.areas where code=trim(p_area_code)) then
    raise exception 'Area code is not present in the Areas master';
  end if;
  update public.invoice_location_knowledge
     set preferred_area_code=trim(p_area_code), updated_at=now()
   where id=p_id
   returning * into r;
  if not found then raise exception 'Location knowledge record not found'; end if;
  return to_jsonb(r);
end $$;

revoke all on function public.dispatchops_set_location_preference(uuid,text) from public;
grant execute on function public.dispatchops_set_location_preference(uuid,text) to anon, authenticated;
notify pgrst,'reload schema';
