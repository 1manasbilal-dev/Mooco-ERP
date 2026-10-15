-- Customer bookings follow this application's existing trusted-terminal access model.
-- The app uses PIN operators, not Supabase Auth sessions; UI permissions are not RLS identities.
-- No DELETE privilege: cancellations retain the booking and its invoice reference.
create table public.customer_orders (
  id text primary key,
  order_number text not null unique,
  customer_id text not null references public.customers(id),
  customer_name text not null,
  customer_phone text not null default '',
  fulfillment text not null check (fulfillment in ('Pickup', 'Delivery')),
  due_date date not null,
  due_time text not null default '' check (due_time = '' or due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  address text not null default '',
  notes text not null default '',
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 100),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0 and discount <= subtotal),
  total numeric(14,2) not null check (total >= 0 and total = subtotal - discount),
  status text not null default 'Pending' check (status in ('Pending', 'Confirmed', 'Ready', 'Completed', 'Cancelled')),
  revision integer not null default 1,
  sale_id text unique references public.sales(id),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  history jsonb not null default '[]',
  check (fulfillment <> 'Delivery' or length(trim(address)) > 0),
  check ((status = 'Completed') = (sale_id is not null))
);
create index customer_orders_customer_idx on public.customer_orders(customer_id);
create index customer_orders_due_idx on public.customer_orders(due_date, status);
create index customer_orders_created_idx on public.customer_orders(created_at desc, id);
alter table public.customer_orders enable row level security;
grant select, insert, update on public.customer_orders to anon, authenticated;
revoke delete, truncate, references, trigger on public.customer_orders from anon, authenticated;
create policy customer_orders_read on public.customer_orders for select to anon, authenticated using (true);
create policy customer_orders_insert on public.customer_orders for insert to anon, authenticated with check (true);
create policy customer_orders_update on public.customer_orders for update to anon, authenticated using (true) with check (true);

create function public.validate_customer_order() returns trigger
language plpgsql security invoker set search_path = public as $$
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
  new.total := v_subtotal - new.discount;
  return new;
end;
$$;
create trigger customer_order_validation before insert or update on public.customer_orders for each row execute function public.validate_customer_order();

-- One row lock protects against duplicate checkout and concurrent editing/cancellation.
-- A retry after a lost response returns the original invoice without reapplying effects.
create function public.checkout_customer_order(p_order_id text, p_revision integer, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  booking public.customer_orders%rowtype;
  shift public.cash_shifts%rowtype;
  day public.business_days%rowtype;
  product public.items%rowtype;
  sale public.sales%rowtype;
  line jsonb;
  v_sale_items jsonb;
  v_effect_items jsonb;
  v_mode text := p_payload->>'payment_mode';
  v_paid numeric := round((p_payload->>'paid_amount')::numeric,2);
  v_account text := nullif(p_payload->>'account_id','');
  v_allow_negative boolean := false;
  v_sale_id text := 'co_sale_' || p_order_id;
  v_bill text;
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
  if not found or day.status = 'Closed' or day.cash_closed_at is not null or shift.business_date <> (now() at time zone 'Asia/Karachi')::date then raise exception 'The business day is closed or the shift is stale.'; end if;
  if v_mode is null or v_mode not in ('Cash','Online','Credit') or v_paid is null or v_paid < 0 or v_paid::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid payment details.'; end if;
  v_paid := least(v_paid, booking.total);
  -- Credit with a cash contribution posts that contribution to cash custody.
  if v_mode = 'Credit' and v_paid > 0 then v_mode := 'Cash'; end if;
  if v_paid > 0 and not exists(select 1 from public.financial_accounts where id=v_account and type in ('Cash','Bank','Wallet')) then raise exception 'Choose a valid payment account.'; end if;
  select coalesce((inventory->>'allowNegativeStock')::boolean, (settings->'inventory'->>'allowNegativeStock')::boolean, false) into v_allow_negative from public.app_settings where id='global_settings';
  v_allow_negative := coalesce(v_allow_negative,false);
  -- Lock all products in stable order, then check aggregate requested stock.
  perform 1 from public.items where id in (select x->>'itemId' from jsonb_array_elements(booking.items) x) order by id for update;
  for line in select value from jsonb_array_elements(booking.items) loop
    select * into product from public.items where id = line->>'itemId' and is_active and 'Sale product' = any(type) and not ('Packaging material' = any(type));
    if not found then raise exception 'An ordered product is inactive or missing.'; end if;
    if nullif(line->>'variantId','') is not null then
      if not exists (select 1 from jsonb_array_elements(coalesce(product.variants,'[]')) v where v->>'id'=line->>'variantId' and coalesce((v->>'isActive')::boolean,true)) then raise exception 'An ordered pack is inactive or missing.'; end if;
      if not v_allow_negative and coalesce((product.variant_stocks->>(line->>'variantId'))::numeric,0) < (line->>'qty')::numeric then raise exception 'Insufficient pack stock for %.', product.name; end if;
    else
      if product.allow_loose_sale = false then raise exception 'Loose sale is disabled for %.', product.name; end if;
      if not v_allow_negative and coalesce(product.stock,0) < (line->>'qty')::numeric then raise exception 'Insufficient stock for %.', product.name; end if;
    end if;
  end loop;
  select jsonb_agg(x || jsonb_build_object('total', round((x->>'qty')::numeric*(x->>'price')::numeric,2), 'isLoose', nullif(x->>'variantId','') is null)),
         jsonb_agg(jsonb_build_object('item_id',x->>'itemId','qty',(x->>'qty')::numeric,'variant_id',nullif(x->>'variantId','')))
    into v_sale_items,v_effect_items from jsonb_array_elements(booking.items) x;
  v_bill := 'INV-' || booking.order_number;
  insert into public.sales(id,bill_number,date,customer_id,customer_name,subtotal,discount,total,payment_mode,status,items,details,business_day_id,shift_session_id,drawer_id,cashier_id,cashier_name)
  values(v_sale_id,v_bill,now(),booking.customer_id,booking.customer_name,booking.subtotal,booking.discount,booking.total,v_mode,'Completed',v_sale_items,
    jsonb_build_object('customer_order_id',booking.id,'customer_order_number',booking.order_number,'customer_phone',booking.customer_phone,'paid_amount',v_paid,'due_amount',booking.total-v_paid,'cash_given',coalesce((p_payload->>'cash_given')::numeric,v_paid),'change_return',coalesce((p_payload->>'change_return')::numeric,0)),
    shift.business_day_id,shift.id,shift.drawer_id,shift.user_id,shift.user_name) returning * into sale;
  perform public.pos_sync_order_effects(jsonb_build_object('order_id',v_sale_id,'bill_number',v_bill,'date',sale.date,'payment_mode',v_mode,'customer_id',booking.customer_id,'paid_amount',v_paid,'total',booking.total,'due_amount',booking.total-v_paid,'account_id',v_account,'business_day_id',shift.business_day_id,'shift_session_id',shift.id,'drawer_id',shift.drawer_id,'cashier_id',shift.user_id,'items',v_effect_items));
  update public.customer_orders set status='Completed',sale_id=v_sale_id where id=booking.id;
  return to_jsonb(sale);
end;
$$;
revoke all on function public.checkout_customer_order(text,integer,jsonb) from public;
grant execute on function public.checkout_customer_order(text,integer,jsonb) to anon, authenticated;
revoke all on function public.validate_customer_order() from public;

-- Existing standard counter/manager roles receive the new standard workflow.
-- Custom roles keep their existing access and can opt in from Settings.
update public.app_roles set permissions = permissions || '["customer_orders"]'::jsonb
where id in ('role_super_admin','role_manager','role_cashier') and not permissions @> '["customer_orders"]'::jsonb;
