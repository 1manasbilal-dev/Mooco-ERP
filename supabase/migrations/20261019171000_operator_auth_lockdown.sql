-- Operator auth, phase 2 of 2: the anon key alone can no longer read or write the books.
--
-- APPLY ONLY AFTER: (1) 20261019170000_operator_auth_prep.sql, (2) the operator-login Edge
-- Function is deployed, (3) the new web build (which signs in through it) is live on erp.mooco.pk.
-- Old builds still open on a device stop working until they reload.
--
-- After this migration:
--   * every business table: one policy, for `authenticated` and only while the JWT belongs to an
--     active PIN operator (app_private.is_operator()). anon has no table or sequence privileges.
--   * app_roles: operators read; only user managers write (no self-promotion via the roles table).
--   * app_users / app_login_attempts / app_api_keys: no Data API access at all (RPC only).
--   * functions: nothing in public is executable by anon except app_login_directory and
--     sync_delivery_order (delivery app, API-key checked). The PIN RPCs are service_role only
--     (called by the Edge Function). User admin RPCs check can_manage_users().
--   * pgrst.db_pre_request = app_private.check_request: a second, central gate that rejects any
--     non-operator request before it reaches a table or function, so a forgotten grant (or a
--     random sign-up on the Auth endpoint) still cannot touch data.
--   * default privileges: future tables/functions created by postgres are not granted to anon.
--     New functions must be granted to `authenticated` explicitly — never to anon.

-- 1. Table policies ---------------------------------------------------------------------------
do $$
declare
  t record;
  p record;
begin
  for t in
    select c.oid, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    for p in select polname from pg_policy where polrelid = t.oid loop
      execute format('drop policy %I on public.%I', p.polname, t.relname);
    end loop;

    execute format('alter table public.%I enable row level security', t.relname);

    if t.relname in ('app_users', 'app_login_attempts', 'app_api_keys') then
      -- RPC-only tables: no policy, no grants.
      execute format('revoke all on table public.%I from anon, authenticated', t.relname);
    elsif t.relname = 'app_roles' then
      execute 'create policy app_roles_operator_read on public.app_roles for select to authenticated using ((select app_private.is_operator()))';
      execute 'create policy app_roles_manager_insert on public.app_roles for insert to authenticated with check ((select app_private.can_manage_users()))';
      execute 'create policy app_roles_manager_update on public.app_roles for update to authenticated using ((select app_private.can_manage_users())) with check ((select app_private.can_manage_users()))';
      execute 'create policy app_roles_manager_delete on public.app_roles for delete to authenticated using ((select app_private.can_manage_users()))';
    else
      execute format(
        'create policy operator_full_access on public.%I for all to authenticated using ((select app_private.is_operator())) with check ((select app_private.is_operator()))',
        t.relname
      );
    end if;
  end loop;
end
$$;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- 2. Function grants --------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname in ('app_login', 'app_login_with_pin', 'app_verify_pin') then
      execute format('revoke execute on function %s from authenticated', f.sig);
      execute format('grant execute on function %s to service_role', f.sig);
    elsif f.proname in ('reset_all_data', 'clear_granular_data') then
      execute format('revoke execute on function %s from authenticated, service_role', f.sig);
    else
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    end if;
  end loop;
end
$$;

grant execute on function public.app_login_directory() to anon;
grant execute on function public.sync_delivery_order(text, jsonb) to anon;

-- 3. User admin RPCs: only user managers; only a Super Admin can create or edit a Super Admin. -
create or replace function public.app_list_users()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not app_private.is_operator() then
    raise exception 'Login zaroori hai.' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(u) - 'pin' - 'pin_hash' - 'pin_salt' order by u.created_at), '[]'::jsonb)
    from app_users u
  );
end;
$$;

create or replace function public.app_create_user(p_name text, p_username text, p_pin text, p_role_id text, p_phone text default null::text, p_avatar text default null::text, p_permissions jsonb default null::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_id text;
  v_salt text;
  v_user app_users%rowtype;
begin
  if not app_private.can_manage_users() then
    raise exception 'Users manage karne ki ijazat nahi hai.' using errcode = '42501';
  end if;
  if p_role_id = 'role_super_admin' and not app_private.is_super_admin() then
    raise exception 'Super Admin sirf Super Admin bana sakta hai.' using errcode = '42501';
  end if;
  if p_name is null or trim(p_name) = '' then raise exception 'Name zaroori hai.'; end if;
  if p_username is null or trim(p_username) = '' then raise exception 'Username zaroori hai.'; end if;
  if p_pin is null or p_pin !~ '^\d{4,10}$' then raise exception 'PIN 4 se 10 digits ka hona chahiye.'; end if;
  if p_role_id is null or trim(p_role_id) = '' then raise exception 'Role zaroori hai.'; end if;
  if exists (select 1 from app_users where lower(username) = lower(trim(p_username))) then
    raise exception 'Yeh username pehle se mojood hai.';
  end if;

  v_id := 'user_' || replace(encode(gen_random_bytes(12), 'hex'), '-', '');
  v_salt := encode(gen_random_bytes(16), 'hex');

  insert into app_users (id, name, username, pin_salt, pin_hash, role_id, phone, avatar, permissions, is_active, created_at)
  values (v_id, trim(p_name), trim(p_username),
          v_salt, encode(digest(v_salt || p_pin, 'sha256'), 'hex'),
          p_role_id, p_phone, p_avatar,
          case when p_permissions is null then '[]'::jsonb else p_permissions end,
          true, now())
  returning * into v_user;

  return to_jsonb(v_user) - 'pin' - 'pin_hash' - 'pin_salt';
end;
$function$;

create or replace function public.app_update_user(p_user_id text, p_updates jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_salt text;
  v_pin text;
  v_user app_users%rowtype;
begin
  if not app_private.can_manage_users() then
    raise exception 'Users manage karne ki ijazat nahi hai.' using errcode = '42501';
  end if;

  select * into v_user from app_users where id = p_user_id;
  if v_user.id is null then raise exception 'User nahi mila.'; end if;

  if (v_user.role_id = 'role_super_admin' or p_updates ->> 'role_id' = 'role_super_admin')
     and not app_private.is_super_admin() then
    raise exception 'Super Admin ko sirf Super Admin badal sakta hai.' using errcode = '42501';
  end if;

  v_pin := nullif(p_updates ->> 'pin', '');
  if v_pin is not null and v_pin !~ '^\d{4,10}$' then
    raise exception 'PIN 4 se 10 digits ka hona chahiye.';
  end if;

  if v_pin is not null then
    v_salt := encode(gen_random_bytes(16), 'hex');
    update app_users
    set pin_salt = v_salt,
        pin_hash = encode(digest(v_salt || v_pin, 'sha256'), 'hex')
    where id = p_user_id;
  end if;

  update app_users set
    name        = coalesce(nullif(trim(p_updates ->> 'name'), ''), name),
    username    = coalesce(nullif(trim(p_updates ->> 'username'), ''), username),
    role_id     = coalesce(nullif(p_updates ->> 'role_id', ''), role_id),
    phone       = coalesce(p_updates ->> 'phone', phone),
    avatar      = coalesce(p_updates ->> 'avatar', avatar),
    is_active   = coalesce((p_updates ->> 'is_active')::boolean, is_active),
    permissions = coalesce(p_updates -> 'permissions', permissions)
  where id = p_user_id;

  return (select to_jsonb(u) - 'pin' - 'pin_hash' - 'pin_salt' from app_users u where id = p_user_id);
end;
$function$;

create or replace function public.app_delete_user(p_user_id text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_super_count int;
  v_is_super boolean;
begin
  if not app_private.can_manage_users() then
    raise exception 'Users manage karne ki ijazat nahi hai.' using errcode = '42501';
  end if;

  select count(*) into v_super_count from app_users where role_id = 'role_super_admin';
  select exists (select 1 from app_users where id = p_user_id and role_id = 'role_super_admin')
    into v_is_super;

  if v_is_super and not app_private.is_super_admin() then
    raise exception 'Super Admin ko sirf Super Admin delete kar sakta hai.' using errcode = '42501';
  end if;
  if v_is_super and v_super_count <= 1 then
    raise exception 'Aakhri Super Admin user delete nahi ho sakta.';
  end if;

  delete from app_users where id = p_user_id;
  return found;
end;
$function$;

-- create or replace keeps existing grants; restate them so the result never depends on history.
revoke execute on function public.app_list_users() from public, anon;
revoke execute on function public.app_create_user(text, text, text, text, text, text, jsonb) from public, anon;
revoke execute on function public.app_update_user(text, jsonb) from public, anon;
revoke execute on function public.app_delete_user(text) from public, anon;
grant execute on function public.app_list_users() to authenticated, service_role;
grant execute on function public.app_create_user(text, text, text, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.app_update_user(text, jsonb) to authenticated, service_role;
grant execute on function public.app_delete_user(text) to authenticated, service_role;

-- 4. Future objects: never auto-exposed to anon. -----------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
-- PUBLIC's built-in EXECUTE default can only be removed role-wide (a per-schema revoke is a no-op).
-- authenticated/service_role keep EXECUTE on new public functions through the per-schema default.
alter default privileges for role postgres revoke execute on functions from public;

-- 5. Central request gate. --------------------------------------------------------------------
alter role authenticator set pgrst.db_pre_request = 'app_private.check_request';
notify pgrst, 'reload config';
