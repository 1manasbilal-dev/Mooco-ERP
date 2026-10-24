-- Live functions that no repo migration defines, copied from the live database on 2026-10-24
-- (pg_get_functiondef; bodies md5-identical to live). english-messages.mjs loads them so it can
-- compare them before and after 20261024110000_english_server_messages.sql.

CREATE OR REPLACE FUNCTION public.cash_control_accept_remittance(p_remittance_id text, p_user_id text, p_user_name text, p_counted_amount numeric, p_denominations jsonb, p_destination_account_id text, p_notes text)
 RETURNS cash_remittances
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_remit public.cash_remittances;
  v_destination_id text;
  v_source_account_id text;
begin
  select * into v_remit
  from public.cash_remittances
  where id = p_remittance_id and status = 'Pending'
  for update;
  if not found then
    raise exception 'Pending remittance was not found';
  end if;

  update public.cash_remittances
  set counted_amount = p_counted_amount,
      variance = p_counted_amount - declared_amount,
      counted_denominations = coalesce(p_denominations, '{}'::jsonb),
      destination_account_id = p_destination_account_id,
      accepted_by_user_id = p_user_id,
      accepted_by_user_name = p_user_name,
      accepted_at = now(),
      notes = nullif(trim(p_notes), ''),
      status = case when abs(p_counted_amount - declared_amount) < 0.01 then 'Accepted' else 'Disputed' end
  where id = p_remittance_id
  returning * into v_remit;

  if abs(v_remit.variance) >= 0.01 then
    insert into public.cash_variances (
      id, business_day_id, shift_id, remittance_id, variance_type,
      expected_amount, counted_amount, variance, reason, reported_by
    ) values (
      'var_remit_' || p_remittance_id, v_remit.business_day_id, v_remit.shift_id,
      v_remit.id, 'Head Remittance', v_remit.declared_amount,
      p_counted_amount, v_remit.variance, p_notes, p_user_id
    );
  end if;

  -- Receive the in-transit cash into the head's chosen account. The drawer
  -- already lost this cash at submit time — only the destination is credited.
  if p_counted_amount > 0 then
    v_source_account_id := coalesce(
      (select account_id from public.cash_drawers where id = v_remit.drawer_id),
      v_remit.drawer_id
    );
    v_destination_id := p_destination_account_id;
    if v_destination_id is null or not exists (
      select 1 from public.financial_accounts
      where id = v_destination_id and is_active <> false
    ) then
      select id into v_destination_id
      from public.financial_accounts
      where is_active <> false
        and id <> v_source_account_id
        and (type in ('Cash', 'Bank', 'Wallet'))
      order by (type = 'Cash') desc, created_at
      limit 1;
    end if;
    if v_destination_id is null then
      raise exception 'Koi receiving account nahi mila — pehle Bank & Cash mein account banayein';
    end if;

    update public.cash_remittances
    set destination_account_id = v_destination_id
    where id = p_remittance_id;

    if not exists (select 1 from public.bank_transactions where id = 'btx_remit_in_' || p_remittance_id) then
      perform public.adjust_account_balance(v_destination_id, p_counted_amount);
      insert into public.bank_transactions (
        id, date, account_id, amount, type, category, description, reference_id,
        business_day_id, shift_session_id, drawer_id, cashier_id
      ) values (
        'btx_remit_in_' || p_remittance_id, now(), v_destination_id, p_counted_amount,
        'Transfer_In', 'Cash Remittance',
        'Cash remittance received from ' || v_remit.cashier_name || ' (in transit cleared)',
        p_remittance_id, v_remit.business_day_id, v_remit.shift_id,
        v_remit.drawer_id, v_remit.cashier_id
      );
    end if;
  end if;

  return v_remit;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_customer_payment_effects(p_tx_id text, p_customer_id text, p_amount numeric, p_date text, p_type text, p_details jsonb DEFAULT '{}'::jsonb, p_account_id text DEFAULT NULL::text, p_business_day_id text DEFAULT NULL::text, p_shift_session_id text DEFAULT NULL::text, p_drawer_id text DEFAULT NULL::text, p_cashier_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_amount numeric := round(p_amount, 2);
  v_delta numeric;
  v_btx_id text := 'btx_' || p_tx_id;
begin
  if p_tx_id is null or p_tx_id = '' then
    raise exception 'tx_id zaroori hai.';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Amount 0 se bara hona chahiye.';
  end if;
  if p_type not in ('Payment', 'Charge') then
    raise exception 'Type Payment ya Charge hona chahiye.';
  end if;

  -- Idempotency guard
  if exists (select 1 from customer_transactions where id = p_tx_id) then
    return jsonb_build_object('already_applied', true, 'tx_id', p_tx_id);
  end if;

  v_delta := case when p_type = 'Payment' then -v_amount else v_amount end;

  insert into customer_transactions
    (id, customer_id, date, type, amount, details,
     business_day_id, shift_session_id, drawer_id, cashier_id)
  values
    (p_tx_id, p_customer_id, p_date::timestamptz, p_type, v_amount,
     p_details || jsonb_build_object(
        'business_day_id', p_business_day_id,
        'shift_session_id', p_shift_session_id,
        'drawer_id', p_drawer_id,
        'cashier_id', p_cashier_id),
     p_business_day_id, p_shift_session_id, p_drawer_id, p_cashier_id);

  perform public.adjust_customer_balance(p_customer_id, v_delta);

  if p_type = 'Payment' and p_account_id is not null then
    insert into bank_transactions
      (id, account_id, amount, date, type, category, description, reference_id,
       business_day_id, shift_session_id, drawer_id, cashier_id)
    values
      (v_btx_id, p_account_id, v_amount, p_date::timestamptz, 'Income', 'Customer Receipt',
       coalesce(p_details ->> 'description', 'Customer Receipt'), p_tx_id,
       p_business_day_id, p_shift_session_id, p_drawer_id, p_cashier_id);

    perform public.adjust_account_balance(p_account_id, v_amount);
  end if;

  return jsonb_build_object('applied', true, 'tx_id', p_tx_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_between_accounts(p_from_id text, p_to_id text, p_amount numeric, p_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP, p_category text DEFAULT 'Transfer'::text, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_amount numeric := round(p_amount, 2);
  v_date timestamptz := coalesce(p_date, clock_timestamp());
begin
  if v_amount is null or v_amount <= 0 then
    raise exception 'Transfer amount 0 se bara hona chahiye.';
  end if;
  if p_from_id = p_to_id then
    raise exception 'Source aur destination account alag hone chahiye.';
  end if;

  -- Lock both rows in a stable order to avoid deadlocks
  perform 1 from financial_accounts
  where id in (least(p_from_id, p_to_id), greatest(p_from_id, p_to_id))
  order by id
  for update;

  update financial_accounts set balance = round(balance - v_amount, 2)
  where id = p_from_id;
  if not found then raise exception 'Source account nahi mila.'; end if;

  update financial_accounts set balance = round(balance + v_amount, 2)
  where id = p_to_id;
  if not found then raise exception 'Destination account nahi mila.'; end if;

  insert into bank_transactions (id, account_id, amount, date, type, category, description, reference_id, created_at)
  values
    ('btx_transfer_out_' || replace(gen_random_uuid()::text, '-', ''),
     p_from_id, v_amount, v_date, 'Transfer_Out', p_category,
     coalesce(p_reference, 'Funds Transfer'), p_reference, clock_timestamp()),
    ('btx_transfer_in_' || replace(gen_random_uuid()::text, '-', ''),
     p_to_id, v_amount, v_date, 'Transfer_In', p_category,
     coalesce(p_reference, 'Funds Transfer'), p_reference, clock_timestamp());

  return jsonb_build_object('success', true, 'amount', v_amount);
end;
$function$;
