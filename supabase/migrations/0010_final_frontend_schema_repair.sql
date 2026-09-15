-- DispatchOPS final frontend/schema repair. Safe to run repeatedly.
-- Repairs compatibility columns that were present in the source migrations but
-- were missing from the live Supabase project, plus Storage buckets/policies.

alter table public.import_batches
  add column if not exists storage_bucket text not null default 'dispatchops-files',
  add column if not exists storage_path text,
  add column if not exists file_size_bytes bigint,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists label text not null default '';

alter table public.sap_invoice_facts
  add column if not exists area text;

alter table public.consumer_salesmen
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by text;

alter table public.driver_aliases
  add column if not exists confidence double precision,
  add column if not exists first_seen timestamptz,
  add column if not exists landmark_driver_name text,
  add column if not exists last_seen timestamptz,
  add column if not exists sap_driver_normalized text,
  add column if not exists sap_driver_original text,
  add column if not exists times_confirmed integer;

alter table public.driver_daily_divisions
  add column if not exists computed_at timestamptz;

alter table public.learned_values
  add column if not exists first_seen timestamptz,
  add column if not exists last_seen timestamptz;


create index if not exists ix_import_batches_storage_path on public.import_batches(storage_path);

insert into storage.buckets (id,name,public)
values ('wallpaper','wallpaper',false),('dispatchops-files','dispatchops-files',false)
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='allow_app_access_wallpaper') then
    create policy allow_app_access_wallpaper on storage.objects for all to anon, authenticated
      using (bucket_id='wallpaper') with check (bucket_id='wallpaper');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='allow_app_access_dispatchops_files') then
    create policy allow_app_access_dispatchops_files on storage.objects for all to anon, authenticated
      using (bucket_id='dispatchops-files') with check (bucket_id='dispatchops-files');
  end if;
end $$;
