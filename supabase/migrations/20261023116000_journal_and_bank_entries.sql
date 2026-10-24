-- Journal vouchers and Bank & Cash deposits / withdrawals in one transaction each (2026-10-23).
-- Requires 20261023110000_money_rpc_helpers.sql.
--
-- Before:
--   * addJournalEntry saved the voucher, then posted each line from the browser: Chart of Accounts
--     lines by compare-and-swap on the server balance (retried up to 4 times), cash/bank lines as a
--     balance delta plus a ledger row. A failure on line 3 left lines 1-2 posted and the voucher
--     saved, i.e. an unbalanced book.
--   * Bank & Cash (CashEntryDialog, formerly BankCash.tsx ~620) recorded the deposit, then set the
--     contra account to "screen balance + change": a posting made on another device in between was
--     overwritten (lost update), and a failure left the bank side posted with no contra.
--
-- post_journal_entry checks the voucher balances, posts every line and saves the voucher together.
-- record_bank_transaction_effects posts the cash/bank side and the contra Chart of Accounts line as
-- deltas on locked rows. Both are idempotent on the client's id and refuse closed books / a locked
-- day. Need accounts:create and bank_cash:create.

create or replace function public.post_journal_entry(p_entry_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date timestamptz := coalesce(nullif(p_payload->>'date', '')::timestamptz, now());
  v_lines jsonb := coalesce(p_payload->'lines', '[]'::jsonb);
  v_line jsonb;
  v_idx integer := -1;
  v_debit numeric;
  v_credit numeric;
  v_net numeric;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_account_id text;
  v_in_drawer boolean;
  v_drawer_accounts text[] := array(select jsonb_array_elements_text(coalesce(p_payload->'drawer_account_ids', '[]'::jsonb)));
  v_details jsonb;
begin
  perform app_private.assert_can('accounts', 'create', 'journal entry post karne');
  if nullif(p_entry_id, '') is null then raise exception 'journal entry id zaroori hai.'; end if;
  if exists (select 1 from journal_entries where id = p_entry_id) then
    return jsonb_build_object('already_applied', true, 'id', p_entry_id);
  end if;
  perform app_private.assert_books_open(v_date, null);

  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) < 2 then
    raise exception 'Journal entry mein kam az kam do lines honi chahiye.';
  end if;
  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_debit := round(coalesce(nullif(v_line->>'debit', '')::numeric, 0), 2);
    v_credit := round(coalesce(nullif(v_line->>'credit', '')::numeric, 0), 2);
    if v_debit < 0 or v_credit < 0 then raise exception 'Debit / credit manfi nahi ho sakta.'; end if;
    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  end loop;
  if abs(v_total_debit - v_total_credit) > 0.01 then
    raise exception 'Double-entry unbalance! Debit (Rs %) aur Credit (Rs %) barabar nahi.', v_total_debit, v_total_credit;
  end if;
  if v_total_debit <= 0 then raise exception 'Journal entry ki raqam 0 se zyada honi chahiye.'; end if;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_idx := v_idx + 1;
    v_account_id := nullif(v_line->>'account_id', '');
    v_debit := round(coalesce(nullif(v_line->>'debit', '')::numeric, 0), 2);
    v_credit := round(coalesce(nullif(v_line->>'credit', '')::numeric, 0), 2);
    v_net := round(v_debit - v_credit, 2);

    if exists (select 1 from manual_accounts where id = v_account_id) then
      if v_net <> 0 then
        perform app_private.post_manual_account(v_account_id, v_debit, v_credit);
      end if;
    elsif exists (select 1 from financial_accounts where id = v_account_id) then
      -- A cash/bank line needs its own ledger row, or the account statement stops adding up.
      if v_net <> 0 then
        v_in_drawer := v_account_id = any(v_drawer_accounts);
        perform app_private.post_bank_tx(
          'btx_' || p_entry_id || '_' || v_idx, v_account_id,
          case when v_net > 0 then 'Deposit' else 'Withdrawal' end, abs(v_net), v_date, 'Journal Entry',
          coalesce(nullif(v_line->>'description', ''), nullif(p_payload->>'narration', ''), nullif(p_payload->>'referenceNo', ''), 'Journal Entry'),
          p_entry_id,
          p_payload->>'business_day_id',
          case when v_in_drawer then p_payload->>'shift_session_id' end,
          case when v_in_drawer then p_payload->>'drawer_id' end,
          p_payload->>'cashier_id'
        );
      end if;
    else
      raise exception 'Journal mein sirf Chart of Accounts aur Bank/Cash accounts chun sakte hain (account "%" nahi mila).', coalesce(v_account_id, '-');
    end if;
  end loop;

  v_details := (p_payload - 'date' - 'lines' - 'drawer_account_ids' - 'business_day_id' - 'shift_session_id' - 'drawer_id' - 'cashier_id' - 'totalAmount')
    || jsonb_build_object('lines', v_lines);
  insert into journal_entries (id, date, total_amount, details)
  values (p_entry_id, v_date, round(v_total_debit, 2), v_details);

  return jsonb_build_object('applied', true, 'id', p_entry_id, 'date', v_date, 'total_amount', round(v_total_debit, 2), 'details', v_details);
end;
$$;

create or replace function public.record_bank_transaction_effects(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_btx_id text := nullif(p_payload->>'id', '');
  v_account_id text := nullif(p_payload->>'account_id', '');
  v_type text := p_payload->>'type';
  v_amount numeric := round(coalesce(nullif(p_payload->>'amount', '')::numeric, 0), 2);
  v_date timestamptz := coalesce(nullif(p_payload->>'date', '')::timestamptz, now());
  v_category text := coalesce(nullif(p_payload->>'category', ''), p_payload->>'type');
  v_description text := coalesce(nullif(p_payload->>'description', ''), p_payload->>'type');
  v_contra_id text := nullif(p_payload->>'related_account_id', '');
  v_contra_name text;
  v_money_in boolean;
  v_balance numeric;
  v_contra_balance numeric;
begin
  perform app_private.assert_can('bank_cash', 'create', 'deposit / withdrawal karne');
  if v_btx_id is null then raise exception 'transaction id zaroori hai.'; end if;
  if exists (select 1 from bank_transactions where id = v_btx_id) then
    return jsonb_build_object('already_applied', true, 'id', v_btx_id);
  end if;
  if v_type is null or v_type not in ('Deposit', 'Withdrawal', 'Income', 'Expense') then
    raise exception 'Sirf Deposit / Withdrawal yahan record hoti hai. Account se account raqam ke liye Transfer use karein.';
  end if;
  perform app_private.assert_books_open(v_date, p_payload->>'business_day_id');

  if v_contra_id is not null then
    select name into v_contra_name from manual_accounts where id = v_contra_id;
    if not found then raise exception 'Contra account nahi mila. Chart of Accounts check karein.'; end if;
  end if;

  v_balance := app_private.post_bank_tx(
    v_btx_id, v_account_id, v_type, v_amount, v_date, v_category, v_description,
    nullif(p_payload->>'reference_id', ''),
    p_payload->>'business_day_id', p_payload->>'shift_session_id', p_payload->>'drawer_id', p_payload->>'cashier_id',
    case
      when v_contra_id is not null then coalesce(p_payload->'details', '{}'::jsonb) || jsonb_build_object('related_account_id', v_contra_id, 'related_account_name', v_contra_name)
      else p_payload->'details'
    end
  );

  -- Money into the bank/cash account is credited to the contra account, money out is debited.
  if v_contra_id is not null then
    v_money_in := app_private.bank_tx_sign(v_type) > 0;
    v_contra_balance := app_private.post_manual_account(
      v_contra_id,
      case when v_money_in then 0 else v_amount end,
      case when v_money_in then v_amount else 0 end
    );
  end if;

  return jsonb_build_object(
    'applied', true,
    'id', v_btx_id,
    'balance', v_balance,
    'related_account_id', v_contra_id,
    'related_account_balance', v_contra_balance
  );
end;
$$;

revoke all on function public.post_journal_entry(text, jsonb) from public, anon;
revoke all on function public.record_bank_transaction_effects(jsonb) from public, anon;
grant execute on function public.post_journal_entry(text, jsonb) to authenticated, service_role;
grant execute on function public.record_bank_transaction_effects(jsonb) to authenticated, service_role;
