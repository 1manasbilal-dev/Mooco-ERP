-- Customer order advances are posted when they are taken, not when the order is billed.
--
-- Before: the booking advance was only a number on the order. At checkout it was posted as income
-- into the checkout shift's drawer, so the booking day's drawer counted "over", the billing day's
-- drawer counted "short", an Online advance landed in the cash drawer, and a cancelled order left
-- no trace of the money.
--
-- Now:
--   * post_customer_order_advance books the not-yet-posted part of advance_paid as a khata Payment
--     (customer credit) into the receiving account, in one transaction, and records it in
--     customer_orders.advance_posted.
--   * checkout_customer_order (next migration) charges the bill balance to khata (the earlier credit
--     settles it) and only posts money received at the counter. Advances from before this change
--     (unposted) keep the old behaviour so they are still recorded once.
--   * the order trigger refuses to lower advance_paid below what was already posted (refund it
--     through the customer khata instead) and lets only the posting function change advance_posted.
--   * delete_customer_transaction_effects reverses Return rows the right way, only touches an
--     account the money actually went to, and refuses sale, order-advance and closed-shift rows.

-- Columns that exist live but were never added by a migration in this repo.
alter table public.customer_orders add column if not exists advance_paid numeric(14,2) not null default 0;
alter table public.customer_orders add column if not exists payment_mode text;
alter table public.customer_orders add column if not exists payment_status text;
alter table public.customer_orders add column if not exists payment_notes text;
alter table public.customer_orders add column if not exists advance_posted numeric(14,2) not null default 0;

create or replace function public.validate_customer_order()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  line jsonb;
  product public.items%rowtype;
  v_subtotal numeric := 0;
  v_qty numeric;
  v_price numeric;
  v_validate_catalog boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'Pending' or new.sale_id is not null then raise exception 'New orders must be pending.'; end if;
    new.revision := 1;
    new.created_at := now();
    new.history := jsonb_build_array(jsonb_build_object('status', new.status, 'at', now()));
    new.advance_posted := 0;
  else
    if old.status in ('Completed', 'Cancelled') then raise exception 'Completed or cancelled orders cannot be changed.'; end if;
    if new.id <> old.id or new.order_number <> old.order_number or new.created_by <> old.created_by then raise exception 'Order identity cannot be changed.'; end if;
    if new.status <> old.status and not (
      (old.status = 'Pending' and new.status in ('Confirmed', 'Cancelled')) or
      (old.status = 'Confirmed' and new.status in ('Ready', 'Completed', 'Cancelled')) or
      (old.status = 'Ready' and new.status in ('Completed', 'Cancelled'))
    ) then raise exception 'Invalid order status transition.'; end if;
    if new.sale_id is distinct from old.sale_id and new.status <> 'Completed' then raise exception 'Invoice links are set by checkout.'; end if;
    if new.status = 'Completed' and not exists (
      select 1 from public.sales s where s.id = new.sale_id and s.customer_id = new.customer_id
        and s.details->>'customer_order_id' = new.id and s.total = new.total
    ) then raise exception 'Complete billing in POS before completing this order.'; end if;
    if new.advance_posted is distinct from old.advance_posted
       and coalesce(current_setting('mooco.posting_advance', true), '') <> 'on' then
      raise exception 'Advance posting is recorded by the system only.';
    end if;
    if coalesce(new.advance_paid, 0) < coalesce(old.advance_posted, 0) then
      raise exception 'Rs % advance is already in the customer khata. Refund it from the customer khata instead of lowering it here.', old.advance_posted;
    end if;
    if new.customer_id is distinct from old.customer_id and coalesce(old.advance_posted, 0) > 0 then
      raise exception 'This order has a posted advance, so its customer cannot be changed.';
    end if;
    new.revision := old.revision + 1;
    new.created_at := old.created_at;
    new.history := old.history || jsonb_build_array(jsonb_build_object('status', new.status, 'at', now(), 'action', case when new.status = old.status then 'Edited' else 'Status changed' end));
  end if;
  new.updated_at := now();
  v_validate_catalog := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then v_validate_catalog := new.items is distinct from old.items or new.customer_id is distinct from old.customer_id; end if;
  if v_validate_catalog and not exists(select 1 from public.customers where id = new.customer_id and is_active) then raise exception 'Choose an active customer.'; end if;
  if jsonb_typeof(new.items) <> 'array' or jsonb_array_length(new.items) not between 1 and 100 then raise exception 'Add 1 to 100 products.'; end if;
  if exists(select 1 from jsonb_array_elements(new.items) x group by x->>'itemId', coalesce(x->>'variantId','') having count(*) > 1) then raise exception 'Combine duplicate products into one line.'; end if;
  for line in select value from jsonb_array_elements(new.items) loop
    v_qty := (line->>'qty')::numeric; v_price := (line->>'price')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty <> round(v_qty,3) or v_qty::text in ('NaN','Infinity','-Infinity') or v_price is null or v_price < 0 or v_price::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid quantity or price.'; end if;
    if nullif(line->>'variantId','') is not null and v_qty <> trunc(v_qty) then raise exception 'Pack quantities must be whole numbers.'; end if;
    if v_validate_catalog then
      select * into product from public.items where id = line->>'itemId' and is_active and 'Sale product' = any(type) and not ('Packaging material' = any(type));
      if not found then raise exception 'An ordered product is no longer available.'; end if;
      if nullif(line->>'variantId','') is not null then
        if not exists (select 1 from jsonb_array_elements(coalesce(product.variants,'[]')) v where v->>'id' = line->>'variantId' and coalesce((v->>'isActive')::boolean,true)) then raise exception 'An ordered pack is no longer available.'; end if;
      elsif product.allow_loose_sale = false then raise exception 'Select a pack for this product.';
      end if;
    end if;
    v_subtotal := v_subtotal + round(v_qty * v_price,2);
  end loop;
  new.subtotal := v_subtotal;
  new.total := v_subtotal - coalesce(new.discount, 0);
  new.advance_paid := coalesce(new.advance_paid, 0);
  if new.advance_paid < 0 then raise exception 'Advance payment cannot be negative.'; end if;
  if new.advance_paid > new.total and new.total > 0 then raise exception 'Advance payment cannot exceed the order total.'; end if;
  new.payment_status := case
    when new.total <= 0 then 'Paid'
    when new.advance_paid >= new.total then 'Paid'
    when new.advance_paid > 0 then 'Partial'
    else 'Unpaid'
  end;
  if new.advance_paid > 0 and (new.payment_mode is null or new.payment_mode = 'Unpaid') then
    new.payment_mode := 'Cash';
  elsif new.advance_paid = 0 then
    new.payment_mode := 'Unpaid';
  end if;
  return new;
end;
$function$;

create or replace function public.post_customer_order_advance(
  p_order_id text,
  p_tx_id text,
  p_account_id text,
  p_business_day_id text default null,
  p_shift_session_id text default null,
  p_drawer_id text default null,
  p_cashier_id text default null
) returns public.customer_orders
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.customer_orders;
  v_delta numeric;
begin
  select * into v_order from public.customer_orders where id = p_order_id for update;
  if not found then raise exception 'Customer order not found.'; end if;

  v_delta := round(coalesce(v_order.advance_paid, 0) - coalesce(v_order.advance_posted, 0), 2);
  if v_delta <= 0 then
    return v_order;
  end if;
  if v_order.status in ('Completed', 'Cancelled') then
    raise exception 'Completed or cancelled orders cannot take an advance.';
  end if;
  if p_account_id is null or not exists (
    select 1 from public.financial_accounts where id = p_account_id and type in ('Cash', 'Bank', 'Wallet')
  ) then
    raise exception 'Choose a valid account to receive the advance.';
  end if;

  perform public.record_customer_payment_effects(
    p_tx_id, v_order.customer_id, v_delta, now()::text, 'Payment',
    jsonb_build_object(
      'mode', coalesce(nullif(v_order.payment_mode, 'Unpaid'), 'Cash'),
      'note', 'Advance for order ' || v_order.order_number || coalesce(' · ' || nullif(v_order.payment_notes, ''), ''),
      'account_id', p_account_id,
      'description', 'Order advance: ' || v_order.customer_name || ' (' || v_order.order_number || ')',
      'customer_order_id', v_order.id,
      'source', 'customer_order_advance'
    ),
    p_account_id, p_business_day_id, p_shift_session_id, p_drawer_id, p_cashier_id
  );

  perform set_config('mooco.posting_advance', 'on', true);
  update public.customer_orders set advance_posted = advance_paid where id = p_order_id
  returning * into v_order;
  perform set_config('mooco.posting_advance', 'off', true);
  return v_order;
end;
$function$;

revoke all on function public.post_customer_order_advance(text, text, text, text, text, text, text) from public;
grant execute on function public.post_customer_order_advance(text, text, text, text, text, text, text) to anon, authenticated;

create or replace function public.delete_customer_transaction_effects(p_tx_id text, p_fallback_account_id text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tx customer_transactions;
  v_account text;
  v_amount numeric;
  v_shift_status text;
begin
  select * into v_tx from customer_transactions where id = p_tx_id for update;
  if not found then
    return jsonb_build_object('already_deleted', true, 'tx_id', p_tx_id);
  end if;

  if p_tx_id like 'ctx\_%' escape '\' and exists (select 1 from sales where id = substr(p_tx_id, 5)) then
    raise exception 'Ye entry ek bill ki hai. Bill ko Sales History se return karein.';
  end if;
  if v_tx.details->>'source' = 'customer_order_advance' then
    raise exception 'Ye order ka advance hai. Refund ke liye customer ko alag payment wapas karein.';
  end if;
  if v_tx.shift_session_id is not null then
    select status into v_shift_status from cash_shifts where id = v_tx.shift_session_id;
    if v_shift_status is not null and v_shift_status not in ('Active', 'Closing')
       and exists (select 1 from bank_transactions where reference_id = p_tx_id) then
      raise exception 'Ye payment band shift ki hai, drawer ka hisaab ho chuka hai. Delete ki jagah ulti (reverse) entry karein.';
    end if;
  end if;

  v_amount := round(coalesce(v_tx.amount, 0), 2);

  -- Payment and Return both lowered the khata when posted, so deleting them raises it back.
  if v_tx.type in ('Payment', 'Return') then
    perform public.adjust_customer_balance(v_tx.customer_id, v_amount);
  else
    perform public.adjust_customer_balance(v_tx.customer_id, -v_amount);
  end if;

  -- Only an account the money really went to: the stored account, else the linked bank row.
  -- Opening-balance advances and write-offs never touched an account, so none is debited.
  if v_tx.type = 'Payment' then
    v_account := coalesce(
      nullif(v_tx.details ->> 'account_id', ''),
      (select account_id from bank_transactions where reference_id = p_tx_id order by created_at limit 1)
    );
    if v_account is not null and exists (select 1 from bank_transactions where reference_id = p_tx_id) then
      perform public.adjust_account_balance(v_account, -v_amount);
    end if;
    delete from bank_transactions where reference_id = p_tx_id;
  end if;

  delete from customer_transactions where id = p_tx_id;
  return jsonb_build_object('deleted', true, 'tx_id', p_tx_id);
end;
$function$;
