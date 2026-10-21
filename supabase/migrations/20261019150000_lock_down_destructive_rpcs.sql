-- Security hardening.
-- 1. reset_all_data / clear_granular_data truncate every business table and were callable by the
--    public anon key. The app never calls them, so nobody outside the SQL editor may run them.
-- 2. app_api_keys had RLS disabled, so the delivery API secret was readable with the anon key.
--    Only sync_delivery_order (SECURITY DEFINER) reads it, which bypasses RLS as the owner.

revoke execute on function public.reset_all_data() from public, anon, authenticated;
revoke execute on function public.clear_granular_data(text) from public, anon, authenticated;

alter table public.app_api_keys enable row level security;
revoke all on table public.app_api_keys from anon, authenticated;
