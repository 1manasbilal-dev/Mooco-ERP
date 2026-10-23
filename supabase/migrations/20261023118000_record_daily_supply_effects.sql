-- Daily supply (delivery) batch in one transaction (2026-10-23).
-- Requires 20261023110000_money_rpc_helpers.sql.
--
-- Before: recordDailySupply inserted all delivery rows, then for each one wrote the khata charge,
-- moved the customer balance, moved the cash account and wrote its ledger row as separate browser
-- calls. The receipt's ledger insert was never checked, so the cash balance could move with no
-- ledger row; a failure on entry 5 left entries 1-4 posted and 5-n saved with no money moved.
--
-- record_daily_supply_effects writes every entry with its khata charge (ctx_ds_<id>) and cash
-- receipt (btx_ds_<id>) in one transaction: all of the batch or none of it. An entry id that is
-- already saved is skipped, so a retry after a lost response posts nothing twice. Pending and
-- Cancelled entries are saved without money effects (as before). Needs customers:edit.

create or replace function public.record_daily_supply_effects(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entries jsonb := coalesce(p_payload->'entries', '[]'::jsonb);
  v_account_id text := nullif(p_payload->>'account_id', '');
  v_in_drawer boolean := v_account_id is not null
    and v_account_id = any(array(select jsonb_array_elements_text(coalesce(p_payload->'drawer_account_ids', '[]'::jsonb))));
  v_entry jsonb;
  v_det jsonb;
  v_id text;
  v_date timestamptz;
  v_customer_id text;
  v_total numeric;
  v_paid numeric;
  v_due numeric;
  v_applied integer := 0;
  v_skipped integer := 0;
  v_charged numeric := 0;
  v_received numeric := 0;
begin
  perform app_private.assert_can('customers', 'edit', 'delivery ka hisaab darj karne');
  if jsonb_typeof(v_entries) <> 'array' or jsonb_array_length(v_entries) = 0 then
    raise exception 'Supply ki koi entry nahi.';
  end if;

  for v_entry in select value from jsonb_array_elements(v_entries) loop
    v_id := nullif(v_entry->>'id', '');
    if v_id is null then raise exception 'Har supply entry ki id zaroori hai.'; end if;
    if exists (select 1 from daily_supply where id = v_id) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_det := case when jsonb_typeof(v_entry->'details') = 'object' then v_entry->'details' else '{}'::jsonb end;
    v_date := coalesce(nullif(v_entry->>'date', '')::timestamptz, now());
    v_customer_id := nullif(v_entry->>'customer_id', '');
    v_total := round(coalesce(nullif(v_entry->>'total_amount', '')::numeric, 0), 2);
    if v_total < 0 then raise exception 'Supply ki raqam manfi nahi ho sakti.'; end if;
    perform app_private.assert_books_open(v_date, p_payload->>'business_day_id');
    if v_customer_id is not null then
      perform 1 from customers where id = v_customer_id for update;
      if not found then raise exception 'Customer "%" nahi mila.', v_customer_id; end if;
    end if;

    insert into daily_supply (id, date, customer_id, total_amount, details, business_day_id, shift_session_id, drawer_id, cashier_id)
    values (
      v_id, v_date, v_customer_id, v_total,
      v_det || jsonb_build_object(
        'business_day_id', nullif(p_payload->>'business_day_id', ''), 'shift_session_id', nullif(p_payload->>'shift_session_id', ''),
        'drawer_id', nullif(p_payload->>'drawer_id', ''), 'cashier_id', nullif(p_payload->>'cashier_id', '')
      ),
      nullif(p_payload->>'business_day_id', ''), nullif(p_payload->>'shift_session_id', ''),
      nullif(p_payload->>'drawer_id', ''), nullif(p_payload->>'cashier_id', '')
    );

    if coalesce(v_det->>'status', '') not in ('Cancelled', 'Pending') then
      v_paid := round(coalesce(nullif(v_det->>'payment_received', '')::numeric, 0), 2);
      v_due := round(coalesce(nullif(v_det->>'balance_due', '')::numeric, greatest(0, v_total - v_paid)), 2);
      if v_paid < 0 or v_due < 0 then raise exception 'Supply ki raqam manfi nahi ho sakti.'; end if;

      -- The due goes on the khata as its own ledger row, so the delivery shows on the statement.
      if v_customer_id is not null and v_due > 0 then
        insert into customer_transactions (id, customer_id, date, type, amount, details)
        values ('ctx_ds_' || v_id, v_customer_id, v_date, 'Charge', v_due, jsonb_build_object(
          'mode', 'Delivery',
          'note', 'Daily supply' || coalesce(' (' || nullif(v_det->>'customer_name', '') || ')', ''),
          'daily_supply_id', v_id
        ));
        perform public.adjust_customer_balance(v_customer_id, v_due);
        v_charged := v_charged + v_due;
      end if;
      if v_paid > 0 then
        if v_account_id is null then
          raise exception 'Cash account nahi mila. Pehle shift shuru karein ya Bank & Cash mein Cash account banayein.';
        end if;
        perform app_private.post_bank_tx(
          'btx_ds_' || v_id, v_account_id, 'Income', v_paid, v_date, 'Milk Supply',
          'Daily Supply Receipt (' || coalesce(nullif(v_det->>'customer_name', ''), 'Customer') || ')', v_id,
          p_payload->>'business_day_id',
          case when v_in_drawer then p_payload->>'shift_session_id' end,
          case when v_in_drawer then p_payload->>'drawer_id' end,
          p_payload->>'cashier_id'
        );
        v_received := v_received + v_paid;
      end if;
    end if;
    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object('applied', v_applied, 'already_applied', v_skipped, 'charged', v_charged, 'received', v_received);
end;
$$;

revoke all on function public.record_daily_supply_effects(jsonb) from public, anon;
grant execute on function public.record_daily_supply_effects(jsonb) to authenticated, service_role;
