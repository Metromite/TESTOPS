-- Bulk Entry bridge for the existing Chrome Extension.
-- This is additive: it does not alter Customer Knowledge or existing Bulk Organizer UI/data models.
-- The function atomically de-duplicates invoice numbers across all daily plans.

create or replace function public.dispatchops_bulk_entry_import(
  p_plan_date date,
  p_invoices jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.bulk_organizer_plans%rowtype;
  existing_invoices jsonb := '[]'::jsonb;
  next_invoices jsonb := '[]'::jsonb;
  added jsonb := '[]'::jsonb;
  duplicates jsonb := '[]'::jsonb;
  item jsonb;
  invoice_key text;
  existing_key text;
  seen_input text[] := '{}';
  has_duplicate boolean;
begin
  if p_plan_date is null then
    raise exception 'Bulk Entry requires a target plan date';
  end if;
  if jsonb_typeof(coalesce(p_invoices, '[]'::jsonb)) <> 'array' then
    raise exception 'Bulk Entry invoices must be a JSON array';
  end if;

  -- Serialize imports for the same planning day. This prevents two extension
  -- submissions from both reading the same old JSON and then overwriting each other.
  perform pg_advisory_xact_lock(hashtextextended('dispatchops-bulk-entry:' || p_plan_date::text, 0));

  select * into target
  from public.bulk_organizer_plans
  where plan_date = p_plan_date
  for update;

  if not found then
    insert into public.bulk_organizer_plans (plan_date, invoices, pallets)
    values (p_plan_date, '[]'::jsonb, '[]'::jsonb)
    returning * into target;
  end if;

  existing_invoices := coalesce(target.invoices, '[]'::jsonb);
  if jsonb_typeof(existing_invoices) <> 'array' then existing_invoices := '[]'::jsonb; end if;
  if jsonb_array_length(existing_invoices) = 0 and jsonb_typeof(coalesce(target.pallets, '[]'::jsonb)) = 'array' and jsonb_array_length(coalesce(target.pallets, '[]'::jsonb)) > 0 then
    existing_invoices := target.pallets;
  end if;
  next_invoices := existing_invoices;

  -- Check every existing plan, not only the selected date, because Waiting and
  -- Any Day invoices are intentionally stored on different daily rows.
  for item in
    select elem
    from public.bulk_organizer_plans p
    cross join lateral jsonb_array_elements(coalesce(p.invoices, '[]'::jsonb)) elem
    where coalesce(nullif(trim(elem->>'invoice_no'), ''), '') <> ''
  loop
    existing_key := regexp_replace(upper(trim(item->>'invoice_no')), '\s+', '', 'g');
    if existing_key <> '' and not (existing_key = any(seen_input)) then
      seen_input := array_append(seen_input, existing_key);
    end if;
  end loop;

  -- Also include legacy rows that only exist in pallets.
  for item in
    select elem
    from public.bulk_organizer_plans p
    cross join lateral jsonb_array_elements(coalesce(p.pallets, '[]'::jsonb)) elem
    where coalesce(nullif(trim(elem->>'invoice_no'), ''), '') <> ''
  loop
    existing_key := regexp_replace(upper(trim(item->>'invoice_no')), '\s+', '', 'g');
    if existing_key <> '' and not (existing_key = any(seen_input)) then
      seen_input := array_append(seen_input, existing_key);
    end if;
  end loop;

  for item in select value from jsonb_array_elements(p_invoices)
  loop
    invoice_key := regexp_replace(upper(trim(coalesce(item->>'invoice_no',''))), '\s+', '', 'g');
    if invoice_key = '' then
      continue;
    end if;

    has_duplicate := invoice_key = any(seen_input);
    if has_duplicate then
      duplicates := duplicates || jsonb_build_array(item || jsonb_build_object('duplicate', true));
      continue;
    end if;

    seen_input := array_append(seen_input, invoice_key);
    next_invoices := next_invoices || jsonb_build_array(item);
    added := added || jsonb_build_array(item);
  end loop;

  if jsonb_array_length(added) > 0 then
    update public.bulk_organizer_plans
    set invoices = next_invoices,
        pallets = next_invoices,
        updated_at = now()
    where id = target.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'plan_date', p_plan_date,
    'added', added,
    'duplicates', duplicates,
    'added_count', jsonb_array_length(added),
    'duplicate_count', jsonb_array_length(duplicates)
  );
end;
$$;

grant execute on function public.dispatchops_bulk_entry_import(date, jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
