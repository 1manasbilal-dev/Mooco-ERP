-- User admin: no self-promotion (2026-10-23).
--
-- Any operator with user_management (not only the Super Admin) could, through the Data API:
-- 1. app_update_user on their own row: change their own role_id or permissions (self-promotion)
--    or is_active (lock themselves out). The Settings UI now hides those fields for self-edits;
--    the server did not enforce it.
-- 2. update app_roles directly (policy app_roles_manager_update) including the role they hold,
--    adding any permission to themselves through it.
-- Now only a Super Admin may change their own role / permissions / active flag or edit the role
-- they hold. Editing other users and other roles is unchanged.

create or replace function app_private.current_role_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.role_id
  from public.app_users u
  where u.auth_user_id = auth.uid()
    and u.is_active is not false
  limit 1
$$;

revoke all on function app_private.current_role_id() from public, anon;
grant execute on function app_private.current_role_id() to authenticated, service_role;

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
  v_new_perms jsonb;
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

  -- The Settings form may resend the whole row, so only a real change counts (permissions compared
  -- as a set, order ignored).
  if v_user.id = app_private.current_operator_id() and not app_private.is_super_admin() then
    v_new_perms := coalesce(p_updates -> 'permissions', v_user.permissions);
    if coalesce(nullif(p_updates ->> 'role_id', ''), v_user.role_id) is distinct from v_user.role_id
       or coalesce((p_updates ->> 'is_active')::boolean, v_user.is_active) is distinct from v_user.is_active
       or (select coalesce(array_agg(distinct p order by p), '{}')
           from jsonb_array_elements_text(case when jsonb_typeof(v_new_perms) = 'array' then v_new_perms else '[]'::jsonb end) p)
          is distinct from
          (select coalesce(array_agg(distinct p order by p), '{}')
           from jsonb_array_elements_text(case when jsonb_typeof(v_user.permissions) = 'array' then v_user.permissions else '[]'::jsonb end) p)
    then
      raise exception 'Apna role, permissions ya status khud nahi badal sakte. Super Admin se kahein.' using errcode = '42501';
    end if;
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

drop policy if exists app_roles_manager_update on public.app_roles;
create policy app_roles_manager_update on public.app_roles
  for update to authenticated
  using ((select app_private.can_manage_users())
         and ((select app_private.is_super_admin()) or id is distinct from (select app_private.current_role_id())))
  with check ((select app_private.can_manage_users())
         and ((select app_private.is_super_admin()) or id is distinct from (select app_private.current_role_id())));

drop policy if exists app_roles_manager_delete on public.app_roles;
create policy app_roles_manager_delete on public.app_roles
  for delete to authenticated
  using ((select app_private.can_manage_users())
         and ((select app_private.is_super_admin()) or id is distinct from (select app_private.current_role_id())));
