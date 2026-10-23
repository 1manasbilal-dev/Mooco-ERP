-- Tighten grants the app never uses (2026-10-23).
--
-- 1. `authenticated` held TRUNCATE, TRIGGER, REFERENCES and MAINTAIN on every business table
--    (Supabase's default ALL grant). TRUNCATE is not subject to RLS, so anything that ever ran
--    SQL as `authenticated` could empty a table regardless of the operator policies. The Data API
--    only needs SELECT / INSERT / UPDATE / DELETE, which stay. Future tables get the same.
-- 2. Trigger functions were executable over /rest/v1/rpc. PostgreSQL checks EXECUTE on a trigger
--    function only when the trigger is created, never when it fires, so revoking it changes
--    nothing for the triggers (advisor 0029 for validate_customer_order).
-- 3. The login-attempts sequence belongs to an RPC-only table.

do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, trigger, references, maintain on table public.%I from anon, authenticated', t.relname);
  end loop;
end
$$;

alter default privileges for role postgres in schema public
  revoke truncate, trigger, references, maintain on tables from anon, authenticated;

revoke execute on function public.validate_customer_order() from public, anon, authenticated;
revoke execute on function public.sync_cash_drawer_from_account() from public, anon, authenticated;
revoke execute on function public.mooco_set_updated_at() from public, anon, authenticated;

revoke all on sequence public.app_login_attempts_id_seq from anon, authenticated;
