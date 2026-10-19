-- Deleting a supplier payment in one transaction.
--
-- Before: the client reversed the supplier balance, then put money back into an account and deleted
-- the bank row and the ledger row in separate calls. When the row had no account (a "Settle &
-- deactivate" waiver / discount) it fell back to the default cash or digital account, so deleting a
-- waiver created money in the bank that never existed. Spot payments, returns and closed-shift
-- payments could also be deleted from the context.
--
-- Now: only Payment / Advance rows can be deleted; spot payments made with a purchase are reversed by
-- returning the purchase. Money goes back only to the account of the bank row the payment actually
-- created. A payment taken from a drawer whose shift is already closed must be reversed, not deleted.

create or replace function public.delete_supplier_transaction_effects(p_tx_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tx public.supplier_transactions;
  v_btx public.bank_transactions;
  v_amount numeric;
  v_shift_status text;
begin
  select * into v_tx from public.supplier_transactions where id = p_tx_id for update;
  if not found then
    return jsonb_build_object('already_deleted', true, 'tx_id', p_tx_id);
  end if;

  if v_tx.type not in ('Payment', 'Advance') then
    raise exception 'Sirf payment / advance entry delete ho sakti hai. Purchase ya return ko Purchase screen se wapas karein.';
  end if;
  if p_tx_id like 'stx\_pur\_%' escape '\' or p_tx_id like 'stx\_mp\_%' escape '\' then
    raise exception 'Ye purchase ke saath di gayi payment hai. Isay purchase return se wapas karein.';
  end if;

  select * into v_btx from public.bank_transactions
  where reference_id = p_tx_id or id = 'btx_' || p_tx_id
  order by created_at
  limit 1;

  if found and v_btx.shift_session_id is not null then
    select status into v_shift_status from public.cash_shifts where id = v_btx.shift_session_id;
    if v_shift_status is not null and v_shift_status not in ('Active', 'Closing') then
      raise exception 'Ye payment band shift ke drawer se hui thi. Delete ki jagah ulti (reverse) entry karein.';
    end if;
  end if;

  v_amount := round(coalesce(v_tx.amount, 0), 2);

  -- A payment lowered what we owe the supplier, so deleting it raises the payable back.
  perform public.adjust_supplier_balance(v_tx.supplier_id, v_amount);

  -- Money returns only to the account the payment really left. A waiver / discount has no bank row.
  if v_btx.id is not null and v_btx.account_id is not null then
    perform public.adjust_account_balance(v_btx.account_id, v_amount);
  end if;
  delete from public.bank_transactions where reference_id = p_tx_id or id = 'btx_' || p_tx_id;

  delete from public.supplier_transactions where id = p_tx_id;
  return jsonb_build_object('deleted', true, 'tx_id', p_tx_id, 'account_id', v_btx.account_id);
end;
$function$;

revoke all on function public.delete_supplier_transaction_effects(text) from public;
grant execute on function public.delete_supplier_transaction_effects(text) to anon, authenticated;
