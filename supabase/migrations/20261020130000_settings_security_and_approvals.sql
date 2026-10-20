-- Settings redesign: security settings, manager PIN approvals, and the online-payment account fix.
--
-- 1. app_settings.security holds the owner's controls: books lock date, idle auto-lock minutes,
--    cashier discount limit and "returns need a manager PIN".
-- 2. app_approve_override(): a signed-in operator asks for a manager's approval (discount above
--    the limit, a sales return). The manager types their PIN on the same terminal; the check runs
--    here with the same hashing and the same 8-tries-per-15-minutes lockout as the login, and the
--    manager must hold the permission (or be the Super Admin). Nothing about the session changes.
-- 3. sync_delivery_order read defaultDigitalAccountId from the `general` column (SELECT general,
--    financial INTO a single jsonb keeps only the first column), so online delivery payments
--    always fell back to the first bank account. It now reads `financial`.

alter table public.app_settings
  add column if not exists security jsonb not null default '{}'::jsonb;

create or replace function public.app_approve_override(p_user_id text, p_pin text, p_permission text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_user app_users%rowtype;
  v_failed int;
  v_module text := split_part(coalesce(p_permission, ''), ':', 1);
  v_allowed boolean;
begin
  if not app_private.is_operator() then
    raise exception 'Login zaroori hai.' using errcode = '42501';
  end if;
  if p_pin is null or trim(p_pin) = '' then
    raise exception 'PIN code zaroori hai.';
  end if;
  if v_module = '' then
    raise exception 'Approval ki qisam maloom nahi.';
  end if;

  select count(*) into v_failed
  from app_login_attempts
  where username = 'uid_' || p_user_id
    and success = false
    and attempted_at > now() - interval '15 minutes';

  if v_failed >= 8 then
    raise exception 'Bohat zyada galat koshishen. 15 minute baad dobara koshish karein.';
  end if;

  select * into v_user from app_users where id = p_user_id;

  if v_user.id is null
     or v_user.is_active = false
     or v_user.pin_hash is null
     or v_user.pin_hash <> encode(digest(v_user.pin_salt || trim(p_pin), 'sha256'), 'hex') then
    insert into app_login_attempts(username, success) values ('uid_' || p_user_id, false);
    raise exception 'Ghalat PIN code!';
  end if;

  select v_user.role_id = 'role_super_admin' or exists (
    select 1
    from jsonb_array_elements_text(
      coalesce(v_user.permissions, '[]'::jsonb)
      || coalesce((select r.permissions from app_roles r where r.id = v_user.role_id), '[]'::jsonb)
    ) p(perm)
    where p.perm = v_module or p.perm = p_permission
  ) into v_allowed;

  if not v_allowed then
    raise exception '% ke paas is kaam ki approval dene ki ijazat nahi hai.', v_user.name;
  end if;

  return jsonb_build_object('approved', true, 'id', v_user.id, 'name', v_user.name);
end;
$$;

revoke all on function public.app_approve_override(text, text, text) from public, anon;
grant execute on function public.app_approve_override(text, text, text) to authenticated, service_role;

do $$
declare
  v_def text := pg_get_functiondef('public.sync_delivery_order(text, jsonb)'::regprocedure);
begin
  if position('SELECT general, financial INTO v_settings' in v_def) > 0 then
    execute replace(v_def, 'SELECT general, financial INTO v_settings', 'SELECT financial INTO v_settings');
  end if;
end
$$;
