-- Billing a customer order no longer posts an advance that was already posted at booking
-- (see 20261019152000_customer_order_advance_posting.sql). The bill charges its balance to khata,
-- where the earlier advance credit settles it, and only counter money goes into the drawer.
-- An advance saved before advance posting existed (advance_posted = 0) is still received here once.

create or replace function public.checkout_customer_order(p_order_id text, p_revision integer, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  booking public.customer_orders%rowtype;
  shift public.cash_shifts%rowtype;
  day public.business_days%rowtype;
  product public.items%rowtype;
  sale public.sales%rowtype;
  line jsonb;
  need record;
  v_variant jsonb;
  v_sale_items jsonb;
  v_effect_items jsonb;
  v_mode text := p_payload->>'payment_mode';
  v_paid numeric := round((p_payload->>'paid_amount')::numeric,2);
  v_account text := nullif(p_payload->>'account_id','');
  v_allow_negative boolean := false;
  v_sale_id text := 'co_sale_' || p_order_id;
  v_bill text;
  v_advance numeric := 0;
  v_due numeric := 0;
  v_posted numeric := 0;
  v_unposted numeric := 0;
begin
  select * into booking from public.customer_orders where id = p_order_id for update;
  if not found then raise exception 'Customer order not found.'; end if;
  if booking.status = 'Completed' then
    select * into sale from public.sales where id = booking.sale_id;
    return to_jsonb(sale);
  end if;
  if booking.revision <> p_revision then raise exception 'This order changed at another counter. Reload it before billing.'; end if;
  if booking.status not in ('Confirmed', 'Ready') then raise exception 'Confirm this order before billing. Cancelled orders cannot be billed.'; end if;
  if not exists(select 1 from public.customers where id = booking.customer_id and is_active) then raise exception 'This customer is inactive.'; end if;
  select * into shift from public.cash_shifts where id = p_payload->>'shift_session_id' for update;
  if not found or shift.status <> 'Active' or shift.drawer_id is null then raise exception 'Start an active cash shift before billing.'; end if;
  select * into day from public.business_days where id = shift.business_day_id for update;
  if not found or day.status = 'Closed' or shift.business_date <> (now() at time zone 'Asia/Karachi')::date then raise exception 'The business day is closed or the shift is stale.'; end if;
  if v_mode is null or v_mode not in ('Cash','Online','Credit') or v_paid is null or v_paid < 0 or v_paid::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid payment details.'; end if;

  v_advance := coalesce(booking.advance_paid, 0);
  -- Advance already posted at booking (post_customer_order_advance) is a khata Payment, so the bill
  -- charges the full balance to khata and the earlier credit settles it. Only an advance recorded
  -- before that existed (unposted) is still received here.
  v_posted := least(coalesce(booking.advance_posted, 0), v_advance);
  v_unposted := greatest(0, v_advance - v_posted);
  v_paid := least(v_paid, greatest(0, booking.total - v_advance));
  v_due := greatest(0, round(booking.total - (v_paid + v_unposted), 2));

  if v_mode = 'Credit' and (v_paid + v_unposted) > 0 then v_mode := 'Cash'; end if;
  if (v_paid + v_unposted) > 0 and not exists(select 1 from public.financial_accounts where id=v_account and type in ('Cash','Bank','Wallet')) then raise exception 'Choose a valid payment account.'; end if;
  select coalesce((inventory->>'allowNegativeStock')::boolean, (settings->'inventory'->>'allowNegativeStock')::boolean, false) into v_allow_negative from public.app_settings where id='global_settings';
  v_allow_negative := coalesce(v_allow_negative,false);
  perform 1 from public.items where id in (select x->>'itemId' from jsonb_array_elements(booking.items) x) order by id for update;

  -- Validate every line (product, pack, loose sale allowed, positive qty).
  for line in select value from jsonb_array_elements(booking.items) loop
    select * into product from public.items where id = line->>'itemId' and is_active and 'Sale product' = any(type) and not ('Packaging material' = any(type));
    if not found then raise exception 'An ordered product is inactive or missing.'; end if;
    if coalesce((line->>'qty')::numeric, 0) <= 0 then raise exception 'Quantity must be more than zero for %.', product.name; end if;
    if nullif(line->>'variantId','') is not null then
      v_variant := null;
      select v into v_variant from jsonb_array_elements(coalesce(product.variants,'[]'::jsonb)) v
        where v->>'id' = line->>'variantId' and coalesce((v->>'isActive')::boolean, true)
        limit 1;
      if v_variant is null then raise exception 'An ordered pack is inactive or missing.'; end if;
    elsif product.allow_loose_sale = false then
      raise exception 'Loose sale is disabled for %.', product.name;
    end if;
  end loop;

  select jsonb_agg(enriched.sale_line), jsonb_agg(enriched.effect_line)
    into v_sale_items, v_effect_items
  from (
    select
      x || jsonb_build_object(
        'total', round((x->>'qty')::numeric * (x->>'price')::numeric, 2),
        'isLoose', nullif(x->>'variantId','') is null,
        'stockDeduction', calc.contains,
        'deductFromBase', calc.from_base or nullif(x->>'variantId','') is null,
        'baseUnit', itm.unit
      ) || case when coalesce(itm.cost_price, 0) > 0
                then jsonb_build_object('cost_price', round(itm.cost_price * calc.contains, 4))
                else '{}'::jsonb end as sale_line,
      jsonb_build_object(
        'item_id', x->>'itemId',
        'qty', case when calc.from_base then round((x->>'qty')::numeric * calc.contains, 3) else (x->>'qty')::numeric end,
        'variant_id', case when calc.from_base then null else nullif(x->>'variantId','') end
      ) as effect_line
    from jsonb_array_elements(booking.items) x
    join public.items itm on itm.id = x->>'itemId'
    left join lateral (
      select v
      from jsonb_array_elements(coalesce(itm.variants, '[]'::jsonb)) v
      where v->>'id' = nullif(x->>'variantId','')
      limit 1
    ) found on true
    cross join lateral (
      select
        coalesce((found.v->>'deduct_from_base')::boolean, false) and nullif(x->>'variantId','') is not null as from_base,
        case when nullif(x->>'variantId','') is not null and coalesce((found.v->>'quantity_in_base_unit')::numeric, 1) > 0
             then coalesce((found.v->>'quantity_in_base_unit')::numeric, 1)
             else 1 end as contains
    ) calc
  ) enriched;

  -- Stock is checked once per pile with every line added up (20 loose + 1 dozen = 32 eggs).
  if not v_allow_negative then
    for need in
      select e->>'item_id' as item_id, nullif(e->>'variant_id','') as variant_id, sum((e->>'qty')::numeric) as qty
      from jsonb_array_elements(v_effect_items) e
      group by 1, 2
    loop
      select * into product from public.items where id = need.item_id;
      if need.variant_id is null then
        if coalesce(product.stock, 0) < round(need.qty, 3) then raise exception 'Insufficient stock for %.', product.name; end if;
      else
        if coalesce((product.variant_stocks->>need.variant_id)::numeric, 0) < need.qty then raise exception 'Insufficient pack stock for %.', product.name; end if;
      end if;
    end loop;
  end if;

  v_bill := 'INV-' || booking.order_number;
  insert into public.sales(id,bill_number,date,customer_id,customer_name,subtotal,discount,total,payment_mode,status,items,details,business_day_id,shift_session_id,drawer_id,cashier_id,cashier_name)
  values(v_sale_id,v_bill,now(),booking.customer_id,booking.customer_name,booking.subtotal,booking.discount,booking.total,v_mode,'Completed',v_sale_items,
    jsonb_build_object('customer_order_id',booking.id,'customer_order_number',booking.order_number,'customer_phone',booking.customer_phone,'advance_paid',v_advance,'advance_posted',v_posted,'paid_amount',v_paid+v_unposted,'counter_paid',v_paid,'due_amount',v_due,'cash_given',coalesce((p_payload->>'cash_given')::numeric,v_paid),'change_return',coalesce((p_payload->>'change_return')::numeric,0)),
    shift.business_day_id,shift.id,shift.drawer_id,shift.user_id,shift.user_name) returning * into sale;
  perform public.pos_sync_order_effects(jsonb_build_object('order_id',v_sale_id,'bill_number',v_bill,'date',sale.date,'payment_mode',v_mode,'customer_id',booking.customer_id,'paid_amount',v_paid+v_unposted,'total',booking.total,'due_amount',v_due,'account_id',v_account,'business_day_id',shift.business_day_id,'shift_session_id',shift.id,'drawer_id',shift.drawer_id,'cashier_id',shift.user_id,'items',v_effect_items));
  update public.customer_orders set status='Completed',sale_id=v_sale_id where id=booking.id;
  return to_jsonb(sale);
end;
$$;
revoke all on function public.checkout_customer_order(text,integer,jsonb) from public;
grant execute on function public.checkout_customer_order(text,integer,jsonb) to anon, authenticated;
