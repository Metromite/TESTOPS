-- DispatchOPS schema alignment: keep canonical and legacy frontend contracts synchronized.
-- This prevents individual tabs from failing when one part of the app uses the
-- original field names and another uses the canonical Supabase field names.

alter table public.consumer_salesmen add column if not exists name text not null default '';
alter table public.dashboard_config_rules add column if not exists rule_type text not null default 'custom';
alter table public.dashboard_config_rules add column if not exists value text not null default '';
alter table public.dashboard_config_rules add column if not exists note text not null default '';
alter table public.dashboard_config_rules add column if not exists operator text not null default 'contains';
alter table public.dashboard_config_rules add column if not exists negate boolean not null default false;
alter table public.dashboard_config_rules add column if not exists logic text not null default 'OR';
alter table public.dashboard_config_rules add column if not exists created_by text not null default '';
alter table public.dashboard_config_rules add column if not exists created_at timestamptz not null default now();

create or replace function public.dispatchops_sync_compat_columns()
returns trigger language plpgsql as $$
begin
  if TG_TABLE_NAME = 'drivers' then
    if nullif(new.code,'') is null and nullif(new.driver_code,'') is not null then new.code := new.driver_code; end if;
    if nullif(new.driver_code,'') is null and nullif(new.code,'') is not null then new.driver_code := new.code; end if;
    if nullif(new.name,'') is null and nullif(new.driver_name,'') is not null then new.name := new.driver_name; end if;
    if nullif(new.driver_name,'') is null and nullif(new.name,'') is not null then new.driver_name := new.name; end if;
  elsif TG_TABLE_NAME = 'helpers' then
    if nullif(new.code,'') is null and nullif(new.helper_code,'') is not null then new.code := new.helper_code; end if;
    if nullif(new.helper_code,'') is null and nullif(new.code,'') is not null then new.helper_code := new.code; end if;
    if nullif(new.name,'') is null and nullif(new.helper_name,'') is not null then new.name := new.helper_name; end if;
    if nullif(new.helper_name,'') is null and nullif(new.name,'') is not null then new.helper_name := new.name; end if;
  elsif TG_TABLE_NAME = 'areas' then
    if nullif(new.code,'') is null and nullif(new.area_code,'') is not null then new.code := new.area_code; end if;
    if nullif(new.area_code,'') is null and nullif(new.code,'') is not null then new.area_code := new.code; end if;
    if nullif(new.name,'') is null and nullif(new.area_name,'') is not null then new.name := new.area_name; end if;
    if nullif(new.area_name,'') is null and nullif(new.name,'') is not null then new.area_name := new.name; end if;
  elsif TG_TABLE_NAME = 'vehicles' then
    if nullif(new.number,'') is null and nullif(new.vehicle_number,'') is not null then new.number := new.vehicle_number; end if;
    if nullif(new.vehicle_number,'') is null and nullif(new.number,'') is not null then new.vehicle_number := new.number; end if;
    if nullif(new.type,'') is null and nullif(new.vehicle_type,'') is not null then new.type := new.vehicle_type; end if;
    if nullif(new.vehicle_type,'') is null and nullif(new.type,'') is not null then new.vehicle_type := new.type; end if;
  elsif TG_TABLE_NAME = 'sap_invoice_facts' then
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
  elsif TG_TABLE_NAME = 'landmark_visit_facts' then
    if nullif(new.vehicle_key,'') is null and nullif(new.vehicle_number,'') is not null then new.vehicle_key := new.vehicle_number; end if;
    if nullif(new.vehicle_number,'') is null and nullif(new.vehicle_key,'') is not null then new.vehicle_number := new.vehicle_key; end if;
    if nullif(new.vehicle_raw,'') is null and nullif(new.vehicle_number,'') is not null then new.vehicle_raw := new.vehicle_number; end if;
    if nullif(new.arrival,'') is null and new.arrived_at is not null then new.arrival := new.arrived_at::text; end if;
    if nullif(new.departure,'') is null and new.departed_at is not null then new.departure := new.departed_at::text; end if;
    if coalesce(new.minutes,0)=0 and coalesce(new.duration_minutes,0)<>0 then new.minutes := new.duration_minutes::integer; end if;
    if coalesce(new.duration_minutes,0)=0 and coalesce(new.minutes,0)<>0 then new.duration_minutes := new.minutes; end if;
  elsif TG_TABLE_NAME = 'consumer_salesmen' then
    if nullif(new.name,'') is null and nullif(new.salesman_name,'') is not null then new.name := new.salesman_name; end if;
    if nullif(new.salesman_name,'') is null and nullif(new.name,'') is not null then new.salesman_name := new.name; end if;
  elsif TG_TABLE_NAME = 'feature_flags' then
    if nullif(new.name,'') is null and nullif(new.flag_key,'') is not null then new.name := new.flag_key; end if;
    if nullif(new.flag_key,'') is null and nullif(new.name,'') is not null then new.flag_key := new.name; end if;
  elsif TG_TABLE_NAME = 'dashboard_config_rules' then
    if nullif(new.rule_type,'') is null and nullif(new.rule_key,'') is not null then new.rule_type := new.rule_key; end if;
    if nullif(new.rule_key,'') is null and nullif(new.rule_type,'') is not null then new.rule_key := new.rule_type; end if;
    if nullif(new.value,'') is null and nullif(new.rule_value,'') is not null then new.value := new.rule_value; end if;
    if nullif(new.rule_value,'') is null and nullif(new.value,'') is not null then new.rule_value := new.value; end if;
  end if;
  return new;
end $$;

 drop trigger if exists trg_dispatchops_drivers_compat on public.drivers;
 create trigger trg_dispatchops_drivers_compat before insert or update on public.drivers for each row execute function public.dispatchops_sync_compat_columns();
 drop trigger if exists trg_dispatchops_helpers_compat on public.helpers;
 create trigger trg_dispatchops_helpers_compat before insert or update on public.helpers for each row execute function public.dispatchops_sync_compat_columns();
 drop trigger if exists trg_dispatchops_areas_compat on public.areas;
 create trigger trg_dispatchops_areas_compat before insert or update on public.areas for each row execute function public.dispatchops_sync_compat_columns();
 drop trigger if exists trg_dispatchops_vehicles_compat on public.vehicles;
 create trigger trg_dispatchops_vehicles_compat before insert or update on public.vehicles for each row execute function public.dispatchops_sync_compat_columns();
 drop trigger if exists trg_dispatchops_sap_compat on public.sap_invoice_facts;
 create trigger trg_dispatchops_sap_compat before insert or update on public.sap_invoice_facts for each row execute function public.dispatchops_sync_compat_columns();
 drop trigger if exists trg_dispatchops_landmark_compat on public.landmark_visit_facts;
 create trigger trg_dispatchops_landmark_compat before insert or update on public.landmark_visit_facts for each row execute function public.dispatchops_sync_compat_columns();
 drop trigger if exists trg_dispatchops_salesmen_compat on public.consumer_salesmen;
 create trigger trg_dispatchops_salesmen_compat before insert or update on public.consumer_salesmen for each row execute function public.dispatchops_sync_compat_columns();
 drop trigger if exists trg_dispatchops_flags_compat on public.feature_flags;
 create trigger trg_dispatchops_flags_compat before insert or update on public.feature_flags for each row execute function public.dispatchops_sync_compat_columns();
 drop trigger if exists trg_dispatchops_rules_compat on public.dashboard_config_rules;
 create trigger trg_dispatchops_rules_compat before insert or update on public.dashboard_config_rules for each row execute function public.dispatchops_sync_compat_columns();

-- Backfill existing rows in both naming contracts.
update public.drivers set code=coalesce(nullif(code,''),driver_code), name=coalesce(nullif(name,''),driver_name), driver_code=coalesce(nullif(driver_code,''),code), driver_name=coalesce(nullif(driver_name,''),name);
update public.helpers set code=coalesce(nullif(code,''),helper_code), name=coalesce(nullif(name,''),helper_name), helper_code=coalesce(nullif(helper_code,''),code), helper_name=coalesce(nullif(helper_name,''),name);
update public.areas set code=coalesce(nullif(code,''),area_code), name=coalesce(nullif(name,''),area_name), area_code=coalesce(nullif(area_code,''),code), area_name=coalesce(nullif(area_name,''),name);
update public.vehicles set number=coalesce(nullif(number,''),vehicle_number), type=coalesce(nullif(type,''),vehicle_type), vehicle_number=coalesce(nullif(vehicle_number,''),number), vehicle_type=coalesce(nullif(vehicle_type,''),type);
update public.sap_invoice_facts set invoice_no=coalesce(nullif(invoice_no,''),invoice_number), invoice_number=coalesce(nullif(invoice_number,''),invoice_no), vehicle_num=coalesce(nullif(vehicle_num,''),vehicle_number), vehicle_number=coalesce(nullif(vehicle_number,''),vehicle_num), boxes=case when coalesce(boxes,0)=0 then coalesce(no_of_boxes,0) else boxes end, no_of_boxes=case when coalesce(no_of_boxes,0)=0 then coalesce(boxes,0) else no_of_boxes end, normal_boxes=case when coalesce(normal_boxes,0)=0 then coalesce(no_of_normal_box,0) else normal_boxes end, no_of_normal_box=case when coalesce(no_of_normal_box,0)=0 then coalesce(normal_boxes,0) else no_of_normal_box end, freezer_boxes=case when coalesce(freezer_boxes,0)=0 then coalesce(no_of_freezer_box,0) else freezer_boxes end, no_of_freezer_box=case when coalesce(no_of_freezer_box,0)=0 then coalesce(freezer_boxes,0) else no_of_freezer_box end, division_desc=coalesce(nullif(division_desc,''),division_description), division_description=coalesce(nullif(division_description,''),division_desc);
update public.landmark_visit_facts set vehicle_key=coalesce(nullif(vehicle_key,''),vehicle_number), vehicle_number=coalesce(nullif(vehicle_number,''),vehicle_key), vehicle_raw=coalesce(nullif(vehicle_raw,''),vehicle_number), arrival=coalesce(nullif(arrival,''),arrived_at::text), departure=coalesce(nullif(departure,''),departed_at::text), minutes=case when coalesce(minutes,0)=0 then coalesce(duration_minutes,0)::integer else minutes end, duration_minutes=case when coalesce(duration_minutes,0)=0 then coalesce(minutes,0) else duration_minutes end;
update public.consumer_salesmen set name=coalesce(nullif(name,''),salesman_name), salesman_name=coalesce(nullif(salesman_name,''),name);
update public.feature_flags set name=coalesce(nullif(name,''),flag_key), flag_key=coalesce(nullif(flag_key,''),name);
update public.dashboard_config_rules set rule_type=coalesce(nullif(rule_type,''),rule_key), rule_key=coalesce(nullif(rule_key,''),rule_type), value=coalesce(nullif(value,''),rule_value), rule_value=coalesce(nullif(rule_value,''),value);

-- Frontend compatibility: SAP dashboard analytics expects the legacy area field.
alter table public.sap_invoice_facts add column if not exists area text;
