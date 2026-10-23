-- PIN lockout hardening (2026-10-23).
--
-- The 8-wrong-PINs-per-15-minutes lockout could be beaten three ways:
-- 1. Parallel guesses. Each RPC counted the failures and only then recorded its own, in its own
--    transaction, so a burst of simultaneous requests all saw the same count and all got a guess.
--    Attempts on one bucket are now serialised with a transaction-level advisory lock.
-- 2. Two buckets per operator. app_login counted failures under the username and app_verify_pin
--    under 'uid_<id>', so one operator gave an attacker 16 guesses per 15 minutes (user ids are
--    public through app_login_directory). Both now record under 'uid_<id>' and count both keys.
-- 3. No daily limit. 8 tries every 15 minutes is ~768 guesses a day per operator, enough to find
--    a 4-digit PIN in a few days. A bucket now also locks after 20 failures in 24 hours.
--
-- Manual unlock (SQL editor), if an operator is locked out by the daily limit:
--   delete from public.app_login_attempts
--   where success = false and username in ('uid_<user id>', '<username in lower case>');
--
-- CREATE OR REPLACE keeps the existing grants (login RPCs: service_role only).

create index if not exists app_login_attempts_bucket_idx
  on public.app_login_attempts (username, attempted_at desc);

-- The lockout message for these buckets, or null while they may try again.
create or replace function app_private.pin_lockout_message(p_keys text[])
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when count(*) filter (where a.attempted_at > now() - interval '15 minutes') >= 8
      then 'Bohat zyada galat koshishen. 15 minute baad dobara koshish karein.'
    when count(*) >= 20
      then 'Aaj bohat zyada galat PIN koshishen ho chuki hain. Kuch ghante baad dobara koshish karein.'
  end
  from public.app_login_attempts a
  where a.username = any (p_keys)
    and a.success = false
    and a.attempted_at > now() - interval '24 hours'
$$;

revoke all on function app_private.pin_lockout_message(text[]) from public, anon, authenticated;

create or replace function public.app_login(p_username text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_user app_users%rowtype;
  v_name text;
  v_key text;
  v_lock text;
begin
  if p_username is null or trim(p_username) = '' or p_pin is null or trim(p_pin) = '' then
    raise exception 'Username aur PIN dono zaroori hain.';
  end if;
  v_name := lower(trim(p_username));

  select * into v_user
  from app_users
  where lower(username) = v_name;

  -- Same bucket as app_verify_pin, so switching login mode buys no extra guesses.
  v_key := case when v_user.id is null then v_name else 'uid_' || v_user.id end;
  perform pg_advisory_xact_lock(hashtextextended('mooco_pin:' || v_key, 0));

  delete from app_login_attempts where attempted_at < now() - interval '1 day';

  v_lock := app_private.pin_lockout_message(array[v_name, v_key]);
  if v_lock is not null then
    raise exception '%', v_lock;
  end if;

  if v_user.id is null
     or v_user.is_active = false
     or v_user.pin_hash is null
     or v_user.pin_hash <> encode(digest(v_user.pin_salt || trim(p_pin), 'sha256'), 'hex') then
    -- Return instead of raising so the failed attempt is committed and counts toward the lockout.
    insert into app_login_attempts(username, success) values (v_key, false);
    return null;
  end if;

  insert into app_login_attempts(username, success) values (v_key, true);
  update app_users set last_login = now() where id = v_user.id;

  return to_jsonb(v_user) - 'pin' - 'pin_hash' - 'pin_salt';
end;
$function$;

create or replace function public.app_login_with_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_user app_users%rowtype;
  v_lock text;
begin
  if p_pin is null or trim(p_pin) = '' then
    raise exception 'PIN code zaroori hai.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mooco_pin:__pin_unlock__', 0));

  delete from app_login_attempts where attempted_at < now() - interval '1 day';

  v_lock := app_private.pin_lockout_message(array['__pin_unlock__']);
  if v_lock is not null then
    raise exception '%', v_lock;
  end if;

  for v_user in
    select * from app_users where is_active = true and pin_hash is not null
  loop
    if v_user.pin_hash = encode(digest(v_user.pin_salt || trim(p_pin), 'sha256'), 'hex') then
      insert into app_login_attempts(username, success) values ('__pin_unlock__', true);
      update app_users set last_login = now() where id = v_user.id;
      return to_jsonb(v_user) - 'pin' - 'pin_hash' - 'pin_salt';
    end if;
  end loop;

  insert into app_login_attempts(username, success) values ('__pin_unlock__', false);
  return null;
end;
$function$;

create or replace function public.app_verify_pin(p_user_id text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_user app_users%rowtype;
  v_key text;
  v_lock text;
begin
  if p_pin is null or trim(p_pin) = '' then
    raise exception 'PIN code zaroori hai.';
  end if;

  select * into v_user from app_users where id = p_user_id;

  v_key := 'uid_' || coalesce(p_user_id, '');
  perform pg_advisory_xact_lock(hashtextextended('mooco_pin:' || v_key, 0));

  delete from app_login_attempts where attempted_at < now() - interval '1 day';

  -- Failures app_login recorded under the username (before this migration) still count.
  v_lock := app_private.pin_lockout_message(array[v_key, lower(v_user.username)]);
  if v_lock is not null then
    raise exception '%', v_lock;
  end if;

  if v_user.id is null
     or v_user.is_active = false
     or v_user.pin_hash is null
     or v_user.pin_hash <> encode(digest(v_user.pin_salt || trim(p_pin), 'sha256'), 'hex') then
    insert into app_login_attempts(username, success) values (v_key, false);
    return null;
  end if;

  insert into app_login_attempts(username, success) values (v_key, true);
  update app_users set last_login = now() where id = v_user.id;

  return to_jsonb(v_user) - 'pin' - 'pin_hash' - 'pin_salt';
end;
$function$;

create or replace function public.app_approve_override(p_user_id text, p_pin text, p_permission text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_user app_users%rowtype;
  v_key text := 'approve_uid_' || coalesce(p_user_id, '');
  v_lock text;
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

  -- Approvals count in their own bucket: a cashier typing wrong manager PINs into the approval
  -- dialog must not lock that manager out of logging in (app_verify_pin uses 'uid_').
  perform pg_advisory_xact_lock(hashtextextended('mooco_pin:' || v_key, 0));

  v_lock := app_private.pin_lockout_message(array[v_key]);
  if v_lock is not null then
    raise exception '%', v_lock;
  end if;

  select * into v_user from app_users where id = p_user_id;

  if v_user.id is null
     or v_user.is_active = false
     or v_user.pin_hash is null
     or v_user.pin_hash <> encode(digest(v_user.pin_salt || trim(p_pin), 'sha256'), 'hex') then
    insert into app_login_attempts(username, success) values (v_key, false);
    return jsonb_build_object('approved', false, 'message', 'Ghalat PIN code!');
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
