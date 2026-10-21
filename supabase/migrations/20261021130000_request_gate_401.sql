-- The request gate (app_private.check_request) raised its 401 with DETAIL '{"status":401}'.
-- PostgREST requires a "headers" key there, so every blocked request came back as HTTP 500
-- PGRST121 ("Could not parse JSON") instead of 401 MOOCO401, and the app could not tell an
-- expired / missing login from a server fault.

create or replace function app_private.check_request()
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_role text := coalesce(v_claims ->> 'role', '');
  v_path text := ltrim(coalesce(current_setting('request.path', true), ''), '/');
begin
  if v_role = 'service_role' then
    return;
  end if;
  if v_role = 'authenticated' and app_private.is_operator() then
    return;
  end if;
  if v_path in ('rpc/app_login_directory', 'rpc/sync_delivery_order') then
    return;
  end if;
  raise sqlstate 'PGRST' using
    message = json_build_object('code', 'MOOCO401', 'message', 'Login zaroori hai. Dobara sign in karein.')::text,
    detail = json_build_object('status', 401, 'headers', json_build_object())::text;
end;
$function$;
