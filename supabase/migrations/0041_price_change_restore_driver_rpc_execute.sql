-- Price Change V8: restore the intentionally exposed token-authenticated portal RPC grants.
-- The driver portal uses the publishable/anon role and performs its own session-token authorization inside these SECURITY DEFINER functions.
revoke execute on function public.dispatchops_driver_data(text) from public;
revoke execute on function public.dispatchops_driver_login(text,text) from public;
revoke execute on function public.dispatchops_driver_save_visit(text,jsonb) from public;
revoke execute on function public.dispatchops_driver_delete_visit(text,uuid) from public;
revoke execute on function public.dispatchops_driver_logout(text) from public;
grant execute on function public.dispatchops_driver_data(text) to anon, authenticated;
grant execute on function public.dispatchops_driver_login(text,text) to anon, authenticated;
grant execute on function public.dispatchops_driver_save_visit(text,jsonb) to anon, authenticated;
grant execute on function public.dispatchops_driver_delete_visit(text,uuid) to anon, authenticated;
grant execute on function public.dispatchops_driver_logout(text) to anon, authenticated;
revoke execute on function public.dispatchops_price_change_admin_data(text,uuid) from public;
revoke execute on function public.dispatchops_price_change_admin_save_campaign(text,jsonb) from public;
revoke execute on function public.dispatchops_price_change_admin_save_item(text,jsonb) from public;
revoke execute on function public.dispatchops_price_change_admin_save_assignment(text,jsonb,uuid[]) from public;
revoke execute on function public.dispatchops_price_change_admin_delete(text,text,uuid) from public;
revoke execute on function public.dispatchops_price_change_admin_reset(text,uuid,uuid) from public;
grant execute on function public.dispatchops_price_change_admin_data(text,uuid) to anon, authenticated;
grant execute on function public.dispatchops_price_change_admin_save_campaign(text,jsonb) to anon, authenticated;
grant execute on function public.dispatchops_price_change_admin_save_item(text,jsonb) to anon, authenticated;
grant execute on function public.dispatchops_price_change_admin_save_assignment(text,jsonb,uuid[]) to anon, authenticated;
grant execute on function public.dispatchops_price_change_admin_delete(text,text,uuid) to anon, authenticated;
grant execute on function public.dispatchops_price_change_admin_reset(text,uuid,uuid) to anon, authenticated;
notify pgrst,'reload schema';
