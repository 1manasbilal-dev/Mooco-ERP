-- New cash / bank account and its opening balance in one transaction (2026-10-23).
-- Requires 20261023110000_money_rpc_helpers.sql.
--
-- Before: addAccount inserted the account with its balance already set, then wrote the
-- "Opening Balance" ledger row in a second call, deleting the account again if that failed. A
-- dropped connection in between left an account whose balance had no ledger row behind it (or the
-- undo failed), so it never reconciled.
--
-- create_financial_account inserts the account at 0 and posts the opening balance through the
-- ledger (btx_op_<id>), so balance and ledger always agree. The cash-drawer row for a Cash account
-- still comes from the financial_accounts trigger. Idempotent on the account id. Needs
-- bank_cash:create or accounts:create (Bank & Cash and Chart of Accounts both add accounts).

create or replace function public.create_financial_account(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := nullif(p_payload->>'id', '');
  v_name text := nullif(trim(p_payload->>'name'), '');
  v_type text := coalesce(nullif(p_payload->>'type', ''), 'Bank');
  v_opening numeric := round(coalesce(nullif(p_payload->>'opening_balance', '')::numeric, 0), 2);
  v_as_of timestamptz := coalesce(nullif(p_payload->>'opening_date', '')::timestamptz, now());
  v_row financial_accounts;
begin
  if not app_private.is_trusted_caller()
     and not app_private.can_perform('bank_cash', 'create')
     and not app_private.can_perform('accounts', 'create') then
    raise exception 'Aap ko naya account banane ki ijazat nahi hai.' using errcode = '42501';
  end if;
  if v_id is null then raise exception 'account id zaroori hai.'; end if;
  if v_name is null then raise exception 'Account ka naam likhein.'; end if;
  if v_type not in ('Cash', 'Bank', 'Wallet') then
    raise exception 'Account ki qisam Cash, Bank ya Wallet honi chahiye.';
  end if;

  select * into v_row from financial_accounts where id = v_id;
  if found then
    return jsonb_build_object('already_applied', true, 'account', to_jsonb(v_row));
  end if;
  if v_opening <> 0 then
    perform app_private.assert_books_open(v_as_of, null);
  end if;

  insert into financial_accounts (id, name, type, balance, is_active, details)
  values (v_id, v_name, v_type, 0, coalesce((p_payload->>'is_active')::boolean, true),
          case when jsonb_typeof(p_payload->'details') = 'object' then p_payload->'details' else '{}'::jsonb end);

  if v_opening <> 0 then
    perform app_private.post_bank_tx(
      'btx_op_' || v_id, v_id,
      case when v_opening > 0 then 'Deposit' else 'Withdrawal' end,
      abs(v_opening), v_as_of, 'Opening Balance', 'Opening Balance for ' || v_name, v_id
    );
  end if;

  select * into v_row from financial_accounts where id = v_id;
  return jsonb_build_object('applied', true, 'account', to_jsonb(v_row));
end;
$$;

revoke all on function public.create_financial_account(jsonb) from public, anon;
grant execute on function public.create_financial_account(jsonb) to authenticated, service_role;
