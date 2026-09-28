-- Import hardening: SAP exports sometimes omit Division Description or expose
-- it under a different header. Never allow a blank/null compatibility value
-- to abort the whole upload.
alter table public.sap_invoice_facts alter column division_desc set default 'UNKNOWN';

create or replace function public.dispatchops_sync_compat_columns()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'sap_invoice_facts' then
    if nullif(new.invoice_no,'') is null and nullif(new.invoice_number,'') is not null then new.invoice_no := new.invoice_number; end if;
    if nullif(new.invoice_number,'') is null and nullif(new.invoice_no,'') is not null then new.invoice_number := new.invoice_no; end if;
    if nullif(new.vehicle_num,'') is null and nullif(new.vehicle_number,'') is not null then new.vehicle_num := new.vehicle_number; end if;
    if nullif(new.vehicle_number,'') is null and nullif(new.vehicle_num,'') is not null then new.vehicle_number := new.vehicle_num; end if;
    if coalesce(new.boxes,0)=0 and coalesce(new.no_of_boxes,0)<>0 then new.boxes := new.no_of_boxes; end if;
    if coalesce(new.no_of_boxes,0)=0 and coalesce(new.boxes,0)<>0 then new.no_of_boxes := new.boxes; end if;
    if coalesce(new.normal_boxes,0)=0 and coalesce(new.no_of_normal_box,0)<>0 then new.normal_boxes := new.no_of_normal_box; end if;
    if coalesce(new.no_of_normal_box,0)=0 and coalesce(new.normal_boxes,0)<>0 then new.no_of_normal_box := new.normal_boxes; end if;
    if coalesce(new.freezer_boxes,0)=0 and coalesce(new.no_of_freezer_box,0)<>0 then new.freezer_boxes := new.no_of_freezer_box; end if;
    if coalesce(new.no_of_freezer_box,0)=0 and coalesce(new.freezer_boxes,0)<>0 then new.no_of_freezer_box := new.freezer_boxes; end if;
    if nullif(new.division_desc,'') is null and nullif(new.division_description,'') is not null then new.division_desc := new.division_description; end if;
    if nullif(new.division_description,'') is null and nullif(new.division_desc,'') is not null then new.division_description := new.division_desc; end if;
    if nullif(new.division_desc,'') is null then new.division_desc := 'UNKNOWN'; end if;
    if nullif(new.division_description,'') is null then new.division_description := new.division_desc; end if;
  end if;
  return new;
end;
$$;

update public.sap_invoice_facts
set division_desc='UNKNOWN'
where division_desc is null or btrim(division_desc)='';
