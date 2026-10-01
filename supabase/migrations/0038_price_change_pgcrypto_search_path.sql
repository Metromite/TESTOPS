-- Ensure pgcrypto digest() is resolvable inside every Price Change RPC.
-- The extension lives in the extensions schema; keep the search path explicitly pinned.
alter function public.dispatchops_driver_login(text,text) set search_path = public, extensions, pg_temp;
alter function public.dispatchops_driver_data(text) set search_path = public, extensions, pg_temp;
alter function public.dispatchops_driver_save_visit(text,jsonb) set search_path = public, extensions, pg_temp;
alter function public.dispatchops_driver_delete_visit(text,uuid) set search_path = public, extensions, pg_temp;
alter function public.dispatchops_driver_logout(text) set search_path = public, extensions, pg_temp;
alter function public.dispatchops_price_change_admin_data(text, uuid) set search_path = public, extensions, pg_temp;
alter function public.dispatchops_price_change_admin_save_campaign(text, jsonb) set search_path = public, extensions, pg_temp;
alter function public.dispatchops_price_change_admin_save_item(text, jsonb) set search_path = public, extensions, pg_temp;
alter function public.dispatchops_price_change_admin_save_assignment(text, jsonb, uuid[]) set search_path = public, extensions, pg_temp;

alter function public.dispatchops_price_change_admin_delete(text, text, uuid) set search_path = public, extensions, pg_temp;
alter function public.dispatchops_price_change_admin_reset(text, uuid, uuid) set search_path = public, extensions, pg_temp;
