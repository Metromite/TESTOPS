-- Shared location knowledge fields edited by DispatchOPS and the Chrome extension.
alter table public.invoice_location_knowledge
  add column if not exists coordinates text,
  add column if not exists t_nf1 text,
  add column if not exists t_nt1 text,
  add column if not exists t_nf2 text,
  add column if not exists t_nt2 text,
  add column if not exists t_ff text,
  add column if not exists t_ft text,
  add column if not exists t_sf text,
  add column if not exists t_st text,
  add column if not exists fri_off boolean not null default false,
  add column if not exists sat_off boolean not null default false,
  add column if not exists custom_days jsonb not null default '[]'::jsonb;
