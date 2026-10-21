-- Audit fixes (2026-10-21). Apply AFTER 20261019171000_operator_auth_lockdown.sql and
-- 20261020130000_settings_security_and_approvals.sql. Deploy the updated operator-login Edge
-- Function first (it already treats a null RPC result as "wrong PIN").
--
-- 1. PIN lockout never worked. app_login / app_login_with_pin / app_verify_pin /
--    app_approve_override inserted the failed attempt into app_login_attempts and then RAISED,
--    and the exception rolled the insert back. The live table holds only successful attempts, so
--    the "8 wrong tries per 15 minutes" limit never triggered and a 4-digit PIN could be guessed
--    without limit. A wrong PIN now records the attempt and returns null (login RPCs) or
--    {approved:false} (manager approval) instead of raising; the clients already treat both as a
--    wrong PIN. The lockout itself still raises (there is nothing to record then).
-- 2. adjust_expense_vendor_stats read the vendor's jsonb totals without a row lock, so two
--    concurrent expense/payment postings for one vendor lost one update. It now locks the row.
-- 3. dayclose_stock_count read the item's stock without a lock and then applied (counted - old)
--    as a delta, so a sale landing in between left stock off the counted figure. It now locks.
-- 4. Functions without a fixed search_path (advisor 0011) get one.
--
-- CREATE OR REPLACE keeps the existing grants.

-- 1. Login / approval RPCs ---------------------------------------------------------------------
create or replace function public.app_login(p_username text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_user app_users%rowtype;
  v_failed int;
begin
  if p_username is null or trim(p_username) = '' or p_pin is null or trim(p_pin) = '' then
    raise exception 'Username aur PIN dono zaroori hain.';
  end if;

  delete from app_login_attempts where attempted_at < now() - interval '1 day';

  select count(*) into v_failed
  from app_login_attempts
  where username = lower(trim(p_username))
    and success = false
    and attempted_at > now() - interval '15 minutes';

  if v_failed >= 8 then
    raise exception 'Bohat zyada galat koshishen. 15 minute baad dobara koshish karein.';
  end if;

  select * into v_user
  from app_users
  where lower(username) = lower(trim(p_username));

  if v_user.id is null
     or v_user.is_active = false
     or v_user.pin_hash is null
     or v_user.pin_hash <> encode(digest(v_user.pin_salt || trim(p_pin), 'sha256'), 'hex') then
    -- Return instead of raising so the failed attempt is committed and counts toward the lockout.
    insert into app_login_attempts(username, success) values (lower(trim(p_username)), false);
    return null;
  end if;

  insert into app_login_attempts(username, success) values (lower(trim(p_username)), true);
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
  v_failed int;
begin
  if p_pin is null or trim(p_pin) = '' then
    raise exception 'PIN code zaroori hai.';
  end if;

  delete from app_login_attempts where attempted_at < now() - interval '1 day';

  select count(*) into v_failed
  from app_login_attempts
  where username = '__pin_unlock__'
    and success = false
    and attempted_at > now() - interval '15 minutes';

  if v_failed >= 8 then
    raise exception 'Bohat zyada galat koshishen. 15 minute baad dobara koshish karein.';
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
  v_failed int;
begin
  if p_pin is null or trim(p_pin) = '' then
    raise exception 'PIN code zaroori hai.';
  end if;

  delete from app_login_attempts where attempted_at < now() - interval '1 day';

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
    return null;
  end if;

  insert into app_login_attempts(username, success) values ('uid_' || p_user_id, true);
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

  -- Approvals count in their own bucket: a cashier typing wrong manager PINs into the approval
  -- dialog must not lock that manager out of logging in (app_verify_pin uses 'uid_').

  select count(*) into v_failed
  from app_login_attempts
  where username = 'approve_uid_' || p_user_id
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
    insert into app_login_attempts(username, success) values ('approve_uid_' || p_user_id, false);
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

revoke all on function public.app_approve_override(text, text, text) from public, anon;
grant execute on function public.app_approve_override(text, text, text) to authenticated, service_role;

-- 2. Vendor totals under a row lock ----------------------------------------------------------
create or replace function public.adjust_expense_vendor_stats(p_vendor_id text, p_pending_delta numeric default 0, p_billed_delta numeric default 0, p_paid_delta numeric default 0)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_details jsonb;
  v_new_pending numeric;
begin
  select coalesce(details, '{}'::jsonb) into v_details
  from expense_vendors
  where id = p_vendor_id
  for update;

  if v_details is null then
    return null;
  end if;

  v_new_pending := round(coalesce((v_details ->> 'pending_balance')::numeric, 0) + p_pending_delta, 2);

  update expense_vendors
  set details = jsonb_set(
        jsonb_set(
          jsonb_set(
            v_details,
            '{pending_balance}',
            to_jsonb(v_new_pending)
          ),
          '{total_billed}',
          to_jsonb(round(coalesce((v_details ->> 'total_billed')::numeric, 0) + p_billed_delta, 2))
        ),
        '{total_paid}',
        to_jsonb(round(coalesce((v_details ->> 'total_paid')::numeric, 0) + p_paid_delta, 2))
      )
  where id = p_vendor_id;

  return v_new_pending;
end;
$function$;

-- 3. Day-close stock count under a row lock ----------------------------------------------------
create or replace function public.dayclose_stock_count(p_business_day_id text, p_counts jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item_id text;
  v_log_id text;
  v_old_loose numeric;
  v_old_variants jsonb;
  v_item_name text;
  v_counted numeric;
  v_loose_delta numeric;
  v_variant_delta jsonb;
  v_adjusted int := 0;
  v_skipped int := 0;
  v_nochange int := 0;
begin
  if p_business_day_id is null or p_business_day_id = '' then
    raise exception 'business_day_id zaroori hai.';
  end if;
  if p_counts is null or jsonb_typeof(p_counts) <> 'array' then
    raise exception 'counts array hona chahiye.';
  end if;

  for v_item_id in
    select distinct coalesce(entry ->> 'item_id', '')
    from jsonb_array_elements(p_counts) entry
  loop
    if v_item_id = '' then continue; end if;
    v_log_id := 'log_dayclose_' || p_business_day_id || '_' || v_item_id;

    if exists (select 1 from inventory_logs where id = v_log_id) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Locked: a sale posting between this read and the adjustment would otherwise be overwritten.
    select stock, coalesce(variant_stocks, '{}'::jsonb), name
    into v_old_loose, v_old_variants, v_item_name
    from items
    where id = v_item_id
    for update;
    if v_old_loose is null then continue; end if;

    -- Loose stock: the counted entry without a variant_id
    select min((entry ->> 'counted')::numeric)
    into v_counted
    from jsonb_array_elements(p_counts) entry
    where coalesce(entry ->> 'item_id', '') = v_item_id and entry ->> 'variant_id' is null;

    v_loose_delta := 0;
    if v_counted is not null then
      v_loose_delta := round(v_counted - v_old_loose, 3);
    end if;

    -- Variant deltas: only keys whose counted value differs from system stock
    select coalesce(
             jsonb_object_agg(
               entry ->> 'variant_id',
               round((entry ->> 'counted')::numeric
                     - coalesce((v_old_variants ->> (entry ->> 'variant_id'))::numeric, 0), 3)
             ) filter (where round((entry ->> 'counted')::numeric
                     - coalesce((v_old_variants ->> (entry ->> 'variant_id'))::numeric, 0), 3) <> 0),
             '{}'::jsonb
           )
    into v_variant_delta
    from jsonb_array_elements(p_counts) entry
    where coalesce(entry ->> 'item_id', '') = v_item_id and entry ->> 'variant_id' is not null;

    if v_loose_delta = 0 and v_variant_delta = '{}'::jsonb then
      -- No difference — still write the guard row so the day's count is marked applied
      insert into inventory_logs (id, date, item_id, item_name, old_quantity, new_quantity, difference, reason, notes)
      values (v_log_id, now(), v_item_id, v_item_name, v_old_loose, v_old_loose, 0,
              'Stock Count Correction', 'Day Close Stock Count (' || p_business_day_id || ') — no difference');
      v_nochange := v_nochange + 1;
      continue;
    end if;

    perform public.adjust_item_stock(
      v_item_id,
      v_loose_delta,
      case when v_variant_delta = '{}'::jsonb then null else v_variant_delta end
    );

    insert into inventory_logs (id, date, item_id, item_name, old_quantity, new_quantity, difference, reason, notes)
    values (v_log_id, now(), v_item_id, v_item_name, v_old_loose, round(v_old_loose + v_loose_delta, 3), v_loose_delta,
            'Stock Count Correction',
            'Day Close Stock Count (' || p_business_day_id || ')'
            || case when v_variant_delta <> '{}'::jsonb
                    then ' · ' || (select count(*) from jsonb_object_keys(v_variant_delta))::text || ' variant adjustment(s)'
                    else '' end);
    v_adjusted := v_adjusted + 1;
  end loop;

  return jsonb_build_object('adjusted', v_adjusted, 'skipped', v_skipped, 'no_change', v_nochange);
end;
$function$;

-- 4. Fixed search_path for the functions the advisor flags. -----------------------------------
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.cash_control_accept_remittance(text, text, text, numeric, jsonb, text, text)',
    'public.cash_control_close_shift(text, numeric, numeric, numeric, numeric, jsonb, text, text, jsonb, text, text)',
    'public.sync_cash_drawer_from_account()',
    'public.reset_all_data()',
    'public.clear_granular_data(text)'
  ] loop
    if to_regprocedure(v_sig) is not null then
      execute format('alter function %s set search_path to public', v_sig);
    end if;
  end loop;
end
$$;
