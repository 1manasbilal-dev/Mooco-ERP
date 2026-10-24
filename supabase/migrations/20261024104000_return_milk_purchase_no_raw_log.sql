-- Milk return without the fake "milk_raw" stock log (2026-10-24).
-- Replaces public.return_milk_purchase from 20261023112000 (same signature, same grants); the only
-- change is that it no longer writes an inventory_logs row for item_id 'milk_raw'.
--
-- Why: collected milk lives in the milk pool (allocations), not in items (docs/stock-model.md:
-- "Milk collection / milk return: milk pool only"). The return already moves the pool row and the
-- purchase row. The extra log pointed at an item that does not exist, so stock history and the
-- movement reports showed a "Milk (Raw)" product with a minus quantity that no count could clear.
-- Old milk_raw rows are left as they are (history).

create or replace function public.return_milk_purchase(p_purchase_id text, p_return_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pur purchases;
  v_det jsonb;
  v_alloc allocations;
  v_has_alloc boolean := false;
  v_supplier suppliers;
  v_has_supplier boolean := false;
  v_now timestamptz := now();
  v_reason text := coalesce(nullif(p_payload->>'reason', ''), 'Milk Return to Supplier');
  v_refund_as text := coalesce(nullif(p_payload->>'refund_as', ''), 'cash');
  v_req_qty numeric := round(nullif(p_payload->>'return_qty', '')::numeric, 3);
  v_total_qty numeric;
  v_qty numeric;
  v_full boolean;
  v_rate numeric;
  v_return_amount numeric;
  v_remaining_qty numeric;
  v_remaining_amount numeric;
  v_unallocated numeric;
  v_orig_paid numeric;
  v_account_id text;
  v_bill numeric;
  v_cash_refund numeric := 0;
  v_remaining_paid numeric;
  v_credit numeric;
  v_new_details jsonb;
  v_in_drawer boolean;
begin
  perform app_private.assert_can('purchase', 'delete', 'doodh wapas karne');
  if nullif(p_return_id, '') is null then raise exception 'return id zaroori hai.'; end if;
  if v_refund_as not in ('cash', 'khata') then raise exception 'Refund ka tareeqa ghalat hai.'; end if;

  select * into v_pur from purchases where id = p_purchase_id for update;
  if not found then raise exception 'Purchase nahi mili. Page reload karein.'; end if;
  v_det := coalesce(v_pur.details, '{}'::jsonb);
  if coalesce(v_det->'return_ids', '[]'::jsonb) ? p_return_id then
    return jsonb_build_object('already_applied', true, 'purchase_id', p_purchase_id, 'status', v_pur.status,
      'remaining_qty', v_pur.quantity, 'remaining_amount', v_pur.total_amount, 'details', v_det);
  end if;
  if v_pur.status = 'Returned' then raise exception 'Ye purchase pehle hi poori wapas ho chuki hai.'; end if;

  perform app_private.assert_books_open(v_now, p_payload->>'business_day_id');
  if v_reason = 'Deleted by user' then
    perform app_private.assert_books_open(v_pur.date, null);
  end if;

  v_total_qty := round(coalesce(v_pur.quantity, 0), 3);
  if v_req_qty is not null and (v_req_qty <= 0 or v_req_qty > v_total_qty + 0.0005) then
    raise exception 'Wapsi ki miqdar 0 se zyada aur % L tak honi chahiye.', v_total_qty;
  end if;
  v_qty := least(coalesce(v_req_qty, v_total_qty), v_total_qty);
  if v_qty <= 0 then raise exception 'Is entry mein wapas karne ko doodh nahi.'; end if;
  v_full := v_qty >= v_total_qty;
  v_rate := coalesce(v_pur.rate, 0);
  v_return_amount := round(v_qty * v_rate, 2);
  v_remaining_qty := round(v_total_qty - v_qty, 3);
  v_remaining_amount := round(v_remaining_qty * v_rate, 2);

  -- Only milk still in the unallocated pool can go back.
  select * into v_alloc from allocations
  where id = 'alloc_' || p_purchase_id or purchase_id = p_purchase_id
  order by (id = 'alloc_' || p_purchase_id) desc
  limit 1
  for update;
  v_has_alloc := found;
  if v_has_alloc then
    v_unallocated := coalesce(v_alloc.remaining_quantity,
      case when v_alloc.status = 'Fully Allocated' then 0 else v_alloc.original_quantity end, 0);
    if v_unallocated + 0.0005 < v_qty then
      raise exception '% L wapas nahi ho sakta: sirf % L baqi hai (% L processing ko ja chuka).',
        v_qty, v_unallocated, coalesce(v_alloc.allocated_quantity, 0);
    end if;
  end if;

  -- A spot-paid intake gets its paid share back on the account that paid it.
  v_orig_paid := round(coalesce((v_det->>'paid_amount')::numeric, 0), 2);
  v_account_id := nullif(v_det->>'account_id', '');
  v_bill := coalesce(nullif(v_pur.total_amount, 0), v_total_qty * v_rate);
  if v_refund_as = 'cash' and v_orig_paid > 0 and v_account_id is not null and v_bill > 0 then
    v_cash_refund := round(least(v_orig_paid, v_return_amount * (v_orig_paid / v_bill)), 2);
  end if;
  v_remaining_paid := round(greatest(0, v_orig_paid - v_cash_refund), 2);

  if v_full then
    v_new_details := v_det || jsonb_build_object(
      'returned', true,
      'returned_quantity', round(coalesce((v_det->>'returned_quantity')::numeric, 0) + v_qty, 3),
      'return_reason', v_reason,
      'returned_at', v_now,
      'original_paid_amount', coalesce((v_det->>'original_paid_amount')::numeric, v_orig_paid),
      'cash_refund', round(coalesce((v_det->>'cash_refund')::numeric, 0) + v_cash_refund, 2),
      'original_quantity', coalesce((v_det->>'original_intake_quantity')::numeric, (v_det->>'original_quantity')::numeric, v_total_qty),
      'original_intake_quantity', coalesce((v_det->>'original_intake_quantity')::numeric, (v_det->>'original_quantity')::numeric, v_total_qty),
      'return_ids', coalesce(v_det->'return_ids', '[]'::jsonb) || to_jsonb(p_return_id)
    );
    update purchases
    set status = 'Returned', return_reason = v_reason, returned_at = v_now, details = v_new_details
    where id = p_purchase_id;
    if v_has_alloc then
      delete from allocations where id = v_alloc.id;
    end if;
  else
    v_new_details := v_det || jsonb_build_object(
      'partial_returned', true,
      'returned_quantity', round(coalesce((v_det->>'returned_quantity')::numeric, 0) + v_qty, 3),
      'last_return_reason', v_reason,
      'last_returned_at', v_now,
      'original_intake_quantity', coalesce((v_det->>'original_intake_quantity')::numeric, v_total_qty),
      'original_paid_amount', coalesce((v_det->>'original_paid_amount')::numeric, v_orig_paid),
      'paid_amount', v_remaining_paid,
      'due_amount', round(greatest(0, v_remaining_amount - v_remaining_paid), 2),
      'cash_refund', round(coalesce((v_det->>'cash_refund')::numeric, 0) + v_cash_refund, 2),
      'return_ids', coalesce(v_det->'return_ids', '[]'::jsonb) || to_jsonb(p_return_id)
    );
    update purchases
    set quantity = v_remaining_qty,
        total_amount = v_remaining_amount,
        status = 'Completed',
        return_reason = 'Partial Return: ' || v_qty || 'L returned (' || v_reason || ')',
        details = v_new_details
    where id = p_purchase_id;
    if v_has_alloc then
      update allocations
      set original_quantity = round(greatest(0, coalesce(original_quantity, 0) - v_qty), 3),
          remaining_quantity = round(greatest(0, coalesce(remaining_quantity, original_quantity, 0) - v_qty), 3)
      where id = v_alloc.id;
    end if;
  end if;

  select * into v_supplier from suppliers where id = v_pur.supplier_id for update;
  v_has_supplier := found;

  if v_cash_refund > 0 then
    -- Only cash coming back into the open drawer belongs to that shift's count.
    v_in_drawer := v_account_id = any(array(select jsonb_array_elements_text(coalesce(p_payload->'drawer_account_ids', '[]'::jsonb))));
    perform app_private.post_bank_tx(
      'btx_purret_' || p_return_id, v_account_id, 'Income', v_cash_refund, v_now, 'Purchase Return',
      'Milk Return Cash Refund: ' || coalesce(v_supplier.name, 'Gwala') || ' (' || v_qty || 'L)',
      p_purchase_id,
      p_payload->>'business_day_id',
      case when v_in_drawer then p_payload->>'shift_session_id' end,
      case when v_in_drawer then p_payload->>'drawer_id' end,
      p_payload->>'cashier_id'
    );
  end if;

  v_credit := round(greatest(0, v_return_amount - v_cash_refund), 2);
  if v_has_supplier then
    if v_credit > 0 then
      perform public.adjust_supplier_balance(v_supplier.id, -v_credit);
    end if;
    insert into supplier_transactions (id, supplier_id, date, type, amount, details)
    values (
      'stx_ret_' || p_return_id, v_supplier.id, v_now, 'Return', v_return_amount,
      jsonb_build_object(
        'note', case when v_full then 'Full' else 'Partial' end || ' Milk Return: ' || v_qty || 'L @ Rs ' || v_rate || '/L (' || v_reason || ')'
                || case when v_cash_refund > 0 then ' (Cash Refunded: Rs ' || v_cash_refund || ')' else '' end,
        'purchase_id', p_purchase_id,
        'cash_refund', v_cash_refund,
        'account_id', v_account_id
      )
    );
  end if;

  return jsonb_build_object(
    'applied', true,
    'purchase_id', p_purchase_id,
    'status', case when v_full then 'Returned' else 'Completed' end,
    'is_full', v_full,
    'return_qty', v_qty,
    'return_amount', v_return_amount,
    'cash_refund', v_cash_refund,
    'supplier_credit', case when v_has_supplier then v_credit else 0 end,
    'account_id', v_account_id,
    'remaining_qty', v_remaining_qty,
    'remaining_amount', v_remaining_amount,
    'remaining_paid', v_remaining_paid,
    'details', v_new_details
  );
end;
$$;

revoke all on function public.return_milk_purchase(text, text, jsonb) from public, anon;
grant execute on function public.return_milk_purchase(text, text, jsonb) to authenticated, service_role;
