-- Shift start no longer hides a drawer mismatch.
--
-- Before: when the drawer account balance differed from the opening count, the difference was
-- booked as an "Opening Float" Deposit/Expense with no review. Cash that went missing between
-- shifts (e.g. Rs 17,770 on 2026-10-18) disappeared from the books silently.
--
-- Now: the drawer still matches the physical count (the count is the truth for a drawer), but
-- the part that the handover does not explain is booked as "Cash Over / Short" and opens a
-- cash_variances row ('Opening Mismatch') for a manager to review. The bank row keeps its
-- btx_float_<shift> id so retries stay idempotent and the client keeps treating it as a system row.
--
-- Grants are unchanged (CREATE OR REPLACE keeps them); 20261019171000_operator_auth_lockdown.sql
-- handles anon/authenticated.

alter table public.cash_variances drop constraint if exists cash_variances_variance_type_check;
alter table public.cash_variances add constraint cash_variances_variance_type_check
  check (variance_type = any (array['Opening Handover', 'Opening Mismatch', 'Shift Closing', 'Head Remittance']));

create or replace function public.cash_control_start_shift(
  p_shift_id text,
  p_business_day_id text,
  p_business_date date,
  p_drawer_id text,
  p_user_id text,
  p_user_name text,
  p_role_name text,
  p_opening_counted numeric,
  p_denominations jsonb default '{}'::jsonb,
  p_handover_id text default null::text
)
returns cash_shifts
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_handover public.drawer_handovers;
  v_declared numeric(14,2);
  v_source text;
  v_shift public.cash_shifts;
  v_account_id text;
  v_curr_balance numeric(14,2);
  v_delta numeric(14,2);
  v_unexplained numeric(14,2);
begin
  if p_opening_counted < 0 then
    raise exception 'Opening cash cannot be negative';
  end if;

  insert into public.business_days (id, business_date, status, opened_by)
  values (p_business_day_id, p_business_date, 'Open', p_user_id)
  on conflict (business_date) do nothing;

  if exists (
    select 1 from public.business_days
    where id = p_business_day_id and status = 'Closed'
  ) then
    raise exception 'This business day is already closed';
  end if;

  if p_handover_id is not null then
    select * into v_handover
    from public.drawer_handovers
    where id = p_handover_id and status = 'Pending'
    for update;

    if not found then
      raise exception 'Pending drawer handover was not found';
    end if;
    if v_handover.drawer_id <> p_drawer_id then
      raise exception 'Handover belongs to another drawer';
    end if;
    v_declared := v_handover.declared_amount;
    v_source := 'Drawer Handover';
  else
    v_declared := p_opening_counted;
    v_source := 'Head Float';
  end if;

  insert into public.cash_shifts (
    id, business_day_id, business_date, drawer_id, user_id, user_name,
    role_name, status, opening_source, opening_declared, opening_counted,
    opening_variance, opening_denominations
  ) values (
    p_shift_id, p_business_day_id, p_business_date, p_drawer_id, p_user_id, p_user_name,
    p_role_name, 'Active', v_source, v_declared, p_opening_counted,
    p_opening_counted - v_declared, coalesce(p_denominations, '{}'::jsonb)
  ) returning * into v_shift;

  if p_handover_id is not null then
    update public.drawer_handovers
    set to_shift_id = p_shift_id,
        accepted_by_user_id = p_user_id,
        accepted_by_user_name = p_user_name,
        counted_amount = p_opening_counted,
        variance = p_opening_counted - v_declared,
        accepted_denominations = coalesce(p_denominations, '{}'::jsonb),
        status = case when abs(p_opening_counted - v_declared) < 0.01 then 'Accepted' else 'Disputed' end,
        accepted_at = now()
    where id = p_handover_id;

    if abs(p_opening_counted - v_declared) >= 0.01 then
      insert into public.cash_variances (
        id, business_day_id, shift_id, handover_id, variance_type,
        expected_amount, counted_amount, variance, reported_by
      ) values (
        'var_open_' || p_shift_id, p_business_day_id, p_shift_id, p_handover_id,
        'Opening Handover', v_declared, p_opening_counted,
        p_opening_counted - v_declared, p_user_id
      );
    end if;
  end if;

  v_account_id := coalesce(
    (select account_id from public.cash_drawers where id = p_drawer_id),
    p_drawer_id
  );

  select balance into v_curr_balance
  from public.financial_accounts
  where id = v_account_id
  for update;

  if found and not exists (select 1 from public.bank_transactions where id = 'btx_float_' || p_shift_id) then
    v_curr_balance := coalesce(v_curr_balance, 0);
    v_delta := p_opening_counted - v_curr_balance;

    if abs(v_delta) >= 0.01 then
      perform public.adjust_account_balance(v_account_id, v_delta);
      insert into public.bank_transactions (
        id, date, account_id, amount, type, category, description, reference_id,
        business_day_id, shift_session_id, drawer_id, cashier_id
      ) values (
        'btx_float_' || p_shift_id, now(), v_account_id, abs(v_delta),
        case when v_delta > 0 then 'Income' else 'Expense' end,
        'Cash Over / Short',
        'Opening cash mismatch: books Rs ' || to_char(v_curr_balance, 'FM999999990.00')
          || ', counted Rs ' || to_char(p_opening_counted, 'FM999999990.00')
          || ' (' || p_user_name || ')',
        p_shift_id, p_business_day_id, p_shift_id, p_drawer_id, p_user_id
      );

      -- The handover variance (counted - declared) is already open for review above. What is left,
      -- declared - books, is cash that changed while nobody had the drawer.
      v_unexplained := v_declared - v_curr_balance;
      if abs(v_unexplained) >= 0.01 then
        insert into public.cash_variances (
          id, business_day_id, shift_id, handover_id, variance_type,
          expected_amount, counted_amount, variance, reason, reported_by
        ) values (
          'var_mismatch_' || p_shift_id, p_business_day_id, p_shift_id, p_handover_id,
          'Opening Mismatch', v_curr_balance, v_declared, v_unexplained,
          'Drawer books did not match the cash handed over / counted at shift start', p_user_id
        )
        on conflict (id) do nothing;
      end if;
    end if;
  end if;

  return v_shift;
end;
$function$;

-- close_shift is SECURITY DEFINER without a fixed search_path.
alter function public.cash_control_close_shift(text, numeric, numeric, numeric, numeric, jsonb, text, text, jsonb, text, text)
  set search_path to 'public';
