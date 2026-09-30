-- Stable normalized identity for Experience rows.
-- Prevents duplicate rows when the same month/export is uploaded repeatedly,
-- even when Area/Vehicle formatting changes between exports.
begin;
with ranked as (
  select id,
         row_number() over (
           partition by upper(coalesce(person_code,'')), upper(coalesce(person_type,'')), date,
             upper(regexp_replace(coalesce(nullif(area_code,'UNKNOWN'),area,''),'[^A-Z0-9]','','g')),
             upper(regexp_replace(coalesce(vehicle_number,''),'[^A-Z0-9]','','g'))
           order by created_at desc nulls last,id desc
         ) rn
  from public.experience_history
)
delete from public.experience_history e using ranked r where e.id=r.id and r.rn>1;

alter table public.experience_history add column if not exists experience_key text;
update public.experience_history set experience_key = upper(coalesce(person_code,''))||'|'||upper(coalesce(person_type,''))||'|'||coalesce(date::text,'')||'|'||upper(regexp_replace(coalesce(nullif(area_code,'UNKNOWN'),area,''),'[^A-Z0-9]','','g'))||'|'||upper(regexp_replace(coalesce(vehicle_number,''),'[^A-Z0-9]','','g'));

create or replace function public.set_experience_key() returns trigger language plpgsql set search_path=public as $$
begin
  new.experience_key:=upper(coalesce(new.person_code,''))||'|'||upper(coalesce(new.person_type,''))||'|'||coalesce(new.date::text,'')||'|'||upper(regexp_replace(coalesce(nullif(new.area_code,'UNKNOWN'),new.area,''),'[^A-Z0-9]','','g'))||'|'||upper(regexp_replace(coalesce(new.vehicle_number,''),'[^A-Z0-9]','','g'));
  return new;
end;
$$;
drop trigger if exists trg_set_experience_key on public.experience_history;
create trigger trg_set_experience_key before insert or update of person_code,person_type,date,area_code,area,vehicle_number on public.experience_history for each row execute function public.set_experience_key();
create unique index if not exists ux_experience_history_stable_key on public.experience_history(experience_key);
commit;
