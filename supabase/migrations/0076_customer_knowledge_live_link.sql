-- 0076: Read-only live link from Bulk Organizer DB to Customer Knowledge DB.
-- Additive only: no existing application tables or rows are modified.
-- The foreign table lives in a private schema; only the security-definer lookup
-- function is exposed to the application roles.

create schema if not exists dispatchops_link;

create extension if not exists wrappers with schema extensions;

drop server if exists dispatchops_customer_knowledge_api cascade;

create foreign data wrapper wasm_wrapper
  handler extensions.wasm_fdw_handler
  validator extensions.wasm_fdw_validator;

create server dispatchops_customer_knowledge_api
  foreign data wrapper wasm_wrapper
  options (
    fdw_package_url 'https://github.com/supabase/wrappers/releases/download/wasm_openapi_fdw_v0.2.1/openapi_fdw.wasm',
    fdw_package_name 'supabase:openapi-fdw',
    fdw_package_version '0.2.1',
    fdw_package_checksum '12c902f3089e18142a1d8d35c66b9ceb85c193224229687bd929aff6b44cddde',
    base_url 'https://chrokbnrlvrfejckmzuz.supabase.co/rest/v1',
    api_key_id '119b3470-068b-4f3d-87bd-55744da1a313',
    api_key_header 'apikey',
    api_key_prefix '',
    accept 'application/json'
  );

create foreign table dispatchops_link.customer_knowledge (
  id text,
  customer_key text,
  customer_name text,
  shipment_to_key text,
  shipment_to text,
  remarks_key text,
  remarks text,
  area_code text,
  area_name text,
  latest_invoice text,
  first_seen_date date,
  last_seen_date date,
  seen_count integer,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  coordinates text,
  t_nf1 text,
  t_nt1 text,
  t_nf2 text,
  t_nt2 text,
  t_ff text,
  t_ft text,
  t_sf text,
  t_st text,
  fri_off boolean,
  sat_off boolean,
  custom_days jsonb,
  preferred_area_code text
)
server dispatchops_customer_knowledge_api
options (
  endpoint '/invoice_location_knowledge',
  rowid_column 'id',
  response_path '/'
);

create or replace function public.dispatchops_customer_knowledge_link(
  p_customer text default null,
  p_shipment_to text default null,
  p_remarks text default null,
  p_area_code text default null
)
returns setof dispatchops_link.customer_knowledge
language sql
security definer
set search_path = public, dispatchops_link
as $$
  select *
  from dispatchops_link.customer_knowledge
  where (p_customer is null or customer_name ilike '%' || p_customer || '%' or customer_key ilike '%' || p_customer || '%')
    and (p_shipment_to is null or shipment_to ilike '%' || p_shipment_to || '%' or shipment_to_key ilike '%' || p_shipment_to || '%')
    and (p_remarks is null or remarks ilike '%' || p_remarks || '%' or remarks_key ilike '%' || p_remarks || '%')
    and (p_area_code is null or area_code = p_area_code or preferred_area_code = p_area_code)
  order by is_active desc, seen_count desc nulls last, updated_at desc nulls last
  limit 50;
$$;

revoke all on function public.dispatchops_customer_knowledge_link(text,text,text,text) from public;
grant execute on function public.dispatchops_customer_knowledge_link(text,text,text,text) to anon, authenticated;
