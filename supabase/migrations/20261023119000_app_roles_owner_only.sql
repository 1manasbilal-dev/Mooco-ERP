-- Roles: only the Owner (Super Admin) may create, change or delete them (2026-10-23).
--
-- updateRole / createRole / deleteRole write app_roles straight from the browser. After
-- 20261023106000 a user manager still could not edit the role they hold, but could edit any other
-- role (e.g. give the Cashier role every right) and then create a user with that role and its PIN:
-- the same escalation by one more step. Role rights are the business's access policy, so writes
-- now need the Super Admin; every operator can still read roles (the app needs them to check
-- rights). Users are unchanged (app_create_user / app_update_user keep their own rules).
--
-- With RLS, a refused UPDATE / DELETE matches no row rather than raising; the client checks the
-- returned rows and says so.

drop policy if exists app_roles_manager_insert on public.app_roles;
drop policy if exists app_roles_manager_update on public.app_roles;
drop policy if exists app_roles_manager_delete on public.app_roles;
drop policy if exists app_roles_owner_insert on public.app_roles;
drop policy if exists app_roles_owner_update on public.app_roles;
drop policy if exists app_roles_owner_delete on public.app_roles;

create policy app_roles_owner_insert on public.app_roles
  for insert to authenticated
  with check ((select app_private.is_super_admin()));

create policy app_roles_owner_update on public.app_roles
  for update to authenticated
  using ((select app_private.is_super_admin()))
  with check ((select app_private.is_super_admin()));

create policy app_roles_owner_delete on public.app_roles
  for delete to authenticated
  using ((select app_private.is_super_admin()) and id <> 'role_super_admin');
