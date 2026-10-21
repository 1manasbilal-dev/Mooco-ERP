-- Operator auth, phase 1 of 2 (safe to apply while the old app is still live: it removes nothing).
--
-- Adds what the new login needs:
--   * app_users.auth_user_id: every PIN operator gets a fixed Supabase Auth user id. The
--     operator-login Edge Function signs that Auth user in after the PIN check.
--   * app_private schema (not exposed by the Data API) with the helpers RLS and the pre-request
--     guard use: current_operator_id(), is_operator(), can_manage_users(), check_request().
--   * app_login_directory(): the only thing the login screen may read before sign-in (names and
--     avatars for the user tiles; no username, phone, permissions or PIN data).
-- Phase 2 (20261019171000_operator_auth_lockdown.sql) switches the policies and grants over.

alter table public.app_users
  add column if not exists auth_user_id uuid not null default gen_random_uuid();

create unique index if not exists app_users_auth_user_id_key on public.app_users (auth_user_id);

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to anon, authenticated, service_role;

-- The active PIN operator behind the current request's JWT, or null.
create or replace function app_private.current_operator_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.app_users u
  where u.auth_user_id = auth.uid()
    and u.is_active is not false
  limit 1
$$;

create or replace function app_private.is_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.current_operator_id() is not null
$$;

-- Same rule as the client's hasPermission('user_management'): Super Admin, or the module (or any
-- of its actions) granted on the user or on the user's role.
create or replace function app_private.can_manage_users()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_users u
    left join public.app_roles r on r.id = u.role_id
    where u.auth_user_id = auth.uid()
      and u.is_active is not false
      and (
        u.role_id = 'role_super_admin'
        or exists (
          select 1
          from jsonb_array_elements_text(coalesce(u.permissions, '[]'::jsonb) || coalesce(r.permissions, '[]'::jsonb)) p(perm)
          where p.perm = 'user_management' or p.perm like 'user_management:%'
        )
      )
  )
$$;

create or replace function app_private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_users u
    where u.auth_user_id = auth.uid() and u.is_active is not false and u.role_id = 'role_super_admin'
  )
$$;

revoke all on all functions in schema app_private from public;
grant execute on all functions in schema app_private to anon, authenticated, service_role;

-- Runs before every Data API request once phase 2 registers it (pgrst.db_pre_request).
-- Fail-closed: only service_role, an active operator, or the two public RPCs get through.
-- Anything else gets HTTP 401 with code MOOCO401, which the app treats as "sign in again"
-- (retryable), never as a data error.
create or replace function app_private.check_request()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    detail = json_build_object('status', 401)::text;
end;
$$;

grant execute on function app_private.check_request() to anon, authenticated, service_role;

-- Login-screen directory: enough for the user tiles, nothing an attacker can use to log in.
create or replace function public.app_login_directory()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', u.id,
        'name', u.name,
        'avatar', u.avatar,
        'role_id', u.role_id,
        'role_name', r.name,
        'is_active', true
      ) order by u.created_at
    ),
    '[]'::jsonb
  )
  from app_users u
  left join app_roles r on r.id = u.role_id
  where u.is_active is not false
$$;

revoke all on function public.app_login_directory() from public;
grant execute on function public.app_login_directory() to anon, authenticated, service_role;

-- The Edge Function calls the PIN RPCs as service_role.
grant execute on function public.app_login(text, text) to service_role;
grant execute on function public.app_login_with_pin(text) to service_role;
grant execute on function public.app_verify_pin(text, text) to service_role;
