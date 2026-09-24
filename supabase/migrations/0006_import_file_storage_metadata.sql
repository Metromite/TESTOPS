-- =============================================================================
-- DispatchOPS — Supabase schema migration 6/6: Storage metadata on
-- import_batches
--
-- Per the file-storage architecture: the original uploaded SAP/V-Zone/
-- Excel/CSV file always goes to the `dispatchops-files` Storage bucket
-- (never as a binary column here), and this table row is its metadata
-- record — file identity/location, not file content.
-- =============================================================================

alter table import_batches
  add column storage_bucket text not null default 'dispatchops-files',
  add column storage_path text,                 -- null until the upload step completes; see imports.ts
  add column file_size_bytes bigint,
  add column deleted_at timestamptz,             -- set only by an explicit, user-confirmed manual delete — never by any automatic process (see 0005's storage-bucket comment)
  add column deleted_by text;

create index ix_import_batches_storage_path on import_batches (storage_path);

comment on column import_batches.deleted_at is
  'Manual delete only. There is no automatic cleanup/retention job anywhere in this schema or the app — do not add one against this column or the dispatchops-files bucket.';
