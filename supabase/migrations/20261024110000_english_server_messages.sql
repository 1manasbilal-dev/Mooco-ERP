-- English messages for the database functions.
--
-- The owner asked for the whole app in English. These functions raised (or saved) Roman Urdu
-- text, which the app shows as-is in toasts and dialogs. Each function below is its latest
-- definition, copied unchanged except for those message strings and Roman Urdu words in comments.
-- No logic, signature, security setting or grant changes (CREATE OR REPLACE keeps grants).
--
-- Source of each definition:
--   app_private.assert_books_open                20261023110000_money_rpc_helpers.sql
--   app_private.assert_can                       20261023110000_money_rpc_helpers.sql
--   app_private.assert_stock_day_open            20261024100000_stock_inbound_helpers.sql
--   app_private.bank_tx_sign                     20261023110000_money_rpc_helpers.sql
--   app_private.check_request                    20261021130000_request_gate_401.sql
--   app_private.move_item_stock                  20261024100000_stock_inbound_helpers.sql
--   app_private.pin_lockout_message              20261023100000_pin_lockout_hardening.sql
--   app_private.post_bank_tx                     20261023110000_money_rpc_helpers.sql
--   app_private.post_manual_account              20261023110000_money_rpc_helpers.sql
--   app_private.reverse_bank_tx                  20261023110000_money_rpc_helpers.sql
--   public.allocate_milk_pool                    20261024102000_milk_allocation_rpcs.sql
--   public.app_approve_override                  20261023100000_pin_lockout_hardening.sql
--   public.app_create_user                       20261019171000_operator_auth_lockdown.sql
--   public.app_delete_user                       20261019171000_operator_auth_lockdown.sql
--   public.app_list_users                        20261019171000_operator_auth_lockdown.sql
--   public.app_login                             20261023100000_pin_lockout_hardening.sql
--   public.app_login_with_pin                    20261023100000_pin_lockout_hardening.sql
--   public.app_update_user                       20261023106000_user_admin_self_escalation_guards.sql
--   public.app_verify_pin                        20261023100000_pin_lockout_hardening.sql
--   public.cancel_production_batch               20261024103000_production_batch_rpcs.sql
--   public.cash_control_accept_remittance        live database (not in any repo migration)
--   public.change_sale_payment_mode              20261023104000_payment_mode_and_order_advance_fixes.sql
--   public.close_business_day                    20261023115000_close_business_day.sql
--   public.complete_production_batch             20261024103000_production_batch_rpcs.sql
--   public.create_financial_account              20261023117000_create_financial_account.sql
--   public.dayclose_stock_count                  20261024109000_dayclose_count_every_pile.sql
--   public.delete_customer_transaction_effects   20261019152000_customer_order_advance_posting.sql
--   public.delete_supplier_transaction_effects   20261019154000_delete_supplier_transaction_effects.sql
--   public.pos_sync_order_effects                20261024106000_pos_sync_stock_from_bill.sql
--   public.post_customer_order_advance           20261023104000_payment_mode_and_order_advance_fixes.sql
--   public.post_journal_entry                    20261023116000_journal_and_bank_entries.sql
--   public.process_sales_return                  20261024107000_sales_return_stock_from_bill.sql
--   public.record_bank_transaction_effects       20261023116000_journal_and_bank_entries.sql
--   public.record_customer_payment_effects       live database (not in any repo migration)
--   public.record_daily_supply_effects           20261023118000_record_daily_supply_effects.sql
--   public.record_material_purchase              20261024101000_material_purchase_rpcs.sql
--   public.return_material_purchase              20261024101000_material_purchase_rpcs.sql
--   public.return_milk_purchase                  20261024104000_return_milk_purchase_no_raw_log.sql
--   public.settle_supplier_balance               20261023113000_write_off_and_settle_balances.sql
--   public.take_counter_milk                     20261024102000_milk_allocation_rpcs.sql
--   public.transfer_between_accounts             live database (not in any repo migration)
--   public.update_expense                        20261023114000_update_expense.sql
--   public.validate_customer_order               20261019152000_customer_order_advance_posting.sql
--   public.write_off_customer_balance            20261023113000_write_off_and_settle_balances.sql
--
-- Apply after 20261024105000 .. 20261024109000: three of these functions come from those files.
-- The web app still understands the old Roman Urdu login message (src/lib/moneyRpc.ts), so the
-- old and new build both work before and after this migration.

create or replace function app_private.assert_books_open(p_at timestamptz, p_business_day_id text default null)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_date date := (coalesce(p_at, now()) at time zone 'Asia/Karachi')::date;
  v_lock text;
begin
  select s.security ->> 'lockDate' into v_lock
  from public.app_settings s
  order by (s.id = 'global_settings') desc
  limit 1;
  if v_lock ~ '^\d{4}-\d{2}-\d{2}$' and v_date <= v_lock::date then
    raise exception 'Books are closed up to %. Entries on this date (%) cannot be added, edited or deleted.',
      v_lock, to_char(v_date, 'DD-Mon-YYYY') using errcode = 'P0001';
  end if;
  if exists (select 1 from public.business_days d where d.business_date = v_date and d.status = 'Closed') then
    raise exception 'Day % is closed (locked). Money entries cannot go into a closed day; reopen the day first.',
      to_char(v_date, 'DD-Mon-YYYY');
  end if;
  if nullif(p_business_day_id, '') is not null
     and exists (select 1 from public.business_days d where d.id = p_business_day_id and d.status = 'Closed') then
    raise exception 'This entry belongs to a closed (locked) business day. Reopen the day first.';
  end if;
end;
$$;

create or replace function app_private.assert_can(p_module text, p_action text, p_what text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app_private.is_trusted_caller() then return; end if;
  if app_private.current_operator_id() is null then
    raise exception 'Login required. Please sign in again.' using errcode = '42501';
  end if;
  if not app_private.can_perform(p_module, p_action) then
    raise exception 'You do not have permission to %.', p_what using errcode = '42501';
  end if;
end;
$$;

create or replace function app_private.assert_stock_day_open(p_at timestamptz)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_date date := (coalesce(p_at, now()) at time zone 'Asia/Karachi')::date;
  v_lock text;
begin
  select s.security ->> 'lockDate' into v_lock
  from public.app_settings s
  order by (s.id = 'global_settings') desc
  limit 1;
  if v_lock ~ '^\d{4}-\d{2}-\d{2}$' and v_date <= v_lock::date then
    raise exception 'Books are closed up to %. No stock entry can be made on this date (%).',
      v_lock, to_char(v_date, 'DD-Mon-YYYY');
  end if;
  if exists (select 1 from public.business_days d where d.business_date = v_date and d.status = 'Closed') then
    raise exception 'Day % is closed (locked). Stock entries cannot go into a closed day; reopen the day first.',
      to_char(v_date, 'DD-Mon-YYYY');
  end if;
end;
$$;

create or replace function app_private.bank_tx_sign(p_type text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_type in ('Income', 'Deposit', 'Transfer_In') then return 1; end if;
  if p_type in ('Expense', 'Withdrawal', 'Transfer_Out') then return -1; end if;
  raise exception 'Bank transaction type "%" is not valid.', p_type;
end;
$$;

create or replace function app_private.check_request()
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_role text := coalesce(v_claims ->> 'role', '');
  v_path text := ltrim(coalesce(current_setting('request.path', true), ''), '/');
begin
  if v_role = 'service_role' then
    return;
  end if;
  if v_role = 'authenticated' and app_private.is_operator() then
    return;
  end if;
  if v_path in ('rpc/app_login_directory', 'rpc/sync_delivery_order') then
    return;
  end if;
  raise sqlstate 'PGRST' using
    message = json_build_object('code', 'MOOCO401', 'message', 'Login required. Please sign in again.')::text,
    detail = json_build_object('status', 401, 'headers', json_build_object())::text;
end;
$function$;

create or replace function app_private.move_item_stock(
  p_item_id text,
  p_loose_delta numeric,
  p_variant_deltas jsonb,
  p_log_id text,
  p_date timestamptz,
  p_reason text,
  p_notes text,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items;
  v_loose numeric := round(coalesce(p_loose_delta, 0), 3);
  v_packs jsonb;
  v_result jsonb;
begin
  if nullif(p_log_id, '') is null then raise exception 'Stock log id is required.'; end if;
  select * into v_item from public.items where id = p_item_id for update;
  if not found then
    raise exception 'Item "%" not found in the catalog; stock was not changed.', p_item_id;
  end if;
  -- adjust_item_stock skips a row whose stock is null.
  if v_item.stock is null then
    update public.items set stock = 0 where id = p_item_id;
    v_item.stock := 0;
  end if;

  select coalesce(jsonb_object_agg(d.key, round(app_private.jnum(d.value), 3)), '{}'::jsonb)
  into v_packs
  from jsonb_each(case when jsonb_typeof(p_variant_deltas) = 'object' then p_variant_deltas else '{}'::jsonb end) d
  where coalesce(round(app_private.jnum(d.value), 3), 0) <> 0;

  v_result := public.adjust_item_stock(p_item_id, v_loose, v_packs);

  insert into public.inventory_logs (id, date, item_id, item_name, old_quantity, new_quantity, difference, reason, notes, details)
  values (
    p_log_id, coalesce(p_date, now()), p_item_id, v_item.name,
    round(v_item.stock, 3), (v_result ->> 'stock')::numeric, v_loose, p_reason, p_notes,
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object('loose_delta', v_loose, 'variant_deltas', v_packs)
  );

  return jsonb_build_object(
    'id', p_item_id,
    'old_stock', v_item.stock,
    'stock', (v_result ->> 'stock')::numeric,
    'variant_stocks', v_result -> 'variant_stocks',
    'loose_delta', v_loose,
    'variant_deltas', v_packs
  );
end;
$$;

create or replace function app_private.pin_lockout_message(p_keys text[])
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when count(*) filter (where a.attempted_at > now() - interval '15 minutes') >= 8
      then 'Too many wrong attempts. Try again in 15 minutes.'
    when count(*) >= 20
      then 'Too many wrong PIN attempts today. Try again in a few hours.'
  end
  from public.app_login_attempts a
  where a.username = any (p_keys)
    and a.success = false
    and a.attempted_at > now() - interval '24 hours'
$$;

create or replace function app_private.post_bank_tx(
  p_btx_id text,
  p_account_id text,
  p_type text,
  p_amount numeric,
  p_date timestamptz,
  p_category text,
  p_description text,
  p_reference_id text,
  p_business_day_id text default null,
  p_shift_session_id text default null,
  p_drawer_id text default null,
  p_cashier_id text default null,
  p_details jsonb default null
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount numeric := round(p_amount, 2);
  v_balance numeric;
begin
  if nullif(p_btx_id, '') is null then raise exception 'Bank entry id is required.'; end if;
  if v_amount is null or v_amount <= 0 or v_amount = 'NaN'::numeric then
    raise exception 'Amount must be more than 0.';
  end if;
  if nullif(p_account_id, '') is null then raise exception 'No payment account selected.'; end if;

  update public.financial_accounts
  set balance = round(coalesce(balance, 0) + app_private.bank_tx_sign(p_type) * v_amount, 2)
  where id = p_account_id
  returning balance into v_balance;
  if not found then
    raise exception 'Account "%" not found. Check the account in Bank & Cash.', p_account_id;
  end if;

  insert into public.bank_transactions (
    id, account_id, amount, date, type, category, description, reference_id,
    business_day_id, shift_session_id, drawer_id, cashier_id, details
  ) values (
    p_btx_id, p_account_id, v_amount, coalesce(p_date, now()), p_type, p_category, p_description, p_reference_id,
    nullif(p_business_day_id, ''), nullif(p_shift_session_id, ''), nullif(p_drawer_id, ''), nullif(p_cashier_id, ''),
    p_details
  );

  return v_balance;
end;
$$;

create or replace function app_private.post_manual_account(p_account_id text, p_debit numeric, p_credit numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_net numeric := round(coalesce(p_debit, 0) - coalesce(p_credit, 0), 2);
  v_balance numeric;
begin
  select type into v_type from public.manual_accounts where id = p_account_id for update;
  if not found then
    raise exception 'Account "%" not found in the Chart of Accounts.', p_account_id;
  end if;
  if v_type in ('Liability', 'Equity', 'Income') then v_net := -v_net; end if;
  update public.manual_accounts
  set balance = round(coalesce(balance, 0) + v_net, 2)
  where id = p_account_id
  returning balance into v_balance;
  return v_balance;
end;
$$;

create or replace function app_private.reverse_bank_tx(p_btx_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.bank_transactions;
begin
  select * into v_row from public.bank_transactions where id = p_btx_id for update;
  if not found then return; end if;
  if v_row.account_id is not null and round(coalesce(v_row.amount, 0), 2) <> 0 then
    update public.financial_accounts
    set balance = round(coalesce(balance, 0) - app_private.bank_tx_sign(v_row.type) * round(v_row.amount, 2), 2)
    where id = v_row.account_id;
    if not found then
      raise exception 'Account "%" not found; the old entry could not be reversed.', v_row.account_id;
    end if;
  end if;
  delete from public.bank_transactions where id = p_btx_id;
end;
$$;

create or replace function public.allocate_milk_pool(p_request_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dest text := nullif(btrim(coalesce(p_payload ->> 'destination', '')), '');
  v_retail boolean;
  v_lines jsonb := p_payload -> 'lines';
  v_line jsonb;
  v_idx int := 0;
  v_alloc allocations;
  v_left numeric;
  v_qty numeric;
  v_new_remaining numeric;
  v_full boolean;
  v_details jsonb;
  v_item items;
  v_stock_qty numeric;
  v_rate numeric;
  v_value numeric;
  v_on_hand numeric;
  v_new_cost numeric;
  v_rows jsonb := '[]'::jsonb;
  v_items jsonb := '{}'::jsonb;
  v_ref text;
begin
  perform app_private.assert_can('allocation', 'create', 'allocate milk');
  if nullif(p_request_id, '') is null then raise exception 'request id is required.'; end if;
  if v_dest is null then raise exception 'Milk destination is required.'; end if;
  if jsonb_typeof(v_lines) is distinct from 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'The allocation has no lines.';
  end if;
  v_retail := v_dest = 'Retail Counter';

  perform pg_advisory_xact_lock(hashtext('allocate_milk_pool:' || p_request_id));
  if exists (
    select 1 from allocations a
    where (a.id in (select l.value ->> 'allocation_id' from jsonb_array_elements(v_lines) l)
           or a.purchase_id in (select l.value ->> 'allocation_id' from jsonb_array_elements(v_lines) l))
      and coalesce(a.details -> 'request_ids', '[]'::jsonb) ? p_request_id
  ) then
    select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_rows
    from allocations a where coalesce(a.details -> 'request_ids', '[]'::jsonb) ? p_request_id;
    return jsonb_build_object('already_applied', true, 'rows', v_rows);
  end if;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_idx := v_idx + 1;
    v_ref := v_line ->> 'allocation_id';
    select * into v_alloc from allocations
    where id = v_ref or purchase_id = v_ref
    order by (id = v_ref) desc
    limit 1
    for update;
    if not found then raise exception 'Milk lot not found (%). Reload the page.', v_ref; end if;

    v_qty := round(app_private.jnum(v_line -> 'quantity'), 3);
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity to allocate must be more than 0.'; end if;
    v_left := round(greatest(0, coalesce(v_alloc.remaining_quantity,
      coalesce(v_alloc.original_quantity, 0) - coalesce(v_alloc.allocated_quantity, 0))), 3);
    if v_qty > v_left + 0.001 then
      raise exception 'Only % L of milk is left (%), so % L cannot be allocated.', v_left, coalesce(v_alloc.supplier_name, 'lot'), v_qty;
    end if;
    v_new_remaining := round(greatest(0, v_left - v_qty), 3);
    v_full := v_new_remaining <= 0.01;

    v_details := case when jsonb_typeof(v_alloc.details) = 'object' then v_alloc.details else '{}'::jsonb end;
    v_details := v_details || jsonb_build_object(
      'allocation_history',
        (case when jsonb_typeof(v_details -> 'allocation_history') = 'array' then v_details -> 'allocation_history' else '[]'::jsonb end)
        || jsonb_build_array(jsonb_build_object(
             'allocated_at', now(), 'quantity', v_qty, 'destination', v_dest,
             'rate', coalesce(v_alloc.average_rate, app_private.jnum(p_payload -> 'rate')), 'request_id', p_request_id)),
      'last_allocated_at', now(),
      'last_destination', v_dest,
      'request_ids', coalesce(v_details -> 'request_ids', '[]'::jsonb) || to_jsonb(p_request_id)
    );

    update allocations
    set remaining_quantity = case when v_full then 0 else v_new_remaining end,
        allocated_quantity = round(coalesce(allocated_quantity, 0) + v_qty, 3),
        status = case when v_full then 'Fully Allocated' else 'Partially Allocated' end,
        destination = case when v_full then v_dest else coalesce(destination, v_dest) end,
        details = v_details
    where id = v_alloc.id
    returning * into v_alloc;
    v_rows := v_rows || to_jsonb(v_alloc);

    if v_retail then
      select * into v_item from items where id = v_line ->> 'item_id' for update;
      if not found then
        raise exception 'Counter milk item not found (% milk). Create a milk item in L or ml in the catalog.', coalesce(v_alloc.milk_type, 'Mixed');
      end if;
      v_stock_qty := app_private.convert_qty(v_qty, 'L', coalesce(nullif(btrim(v_item.unit), ''), 'L'));
      if v_stock_qty is null then
        raise exception '%: litres cannot be converted to "%". Counter milk needs an item in L or ml.', v_item.name, v_item.unit;
      end if;
      v_stock_qty := round(v_stock_qty, 3);

      -- Average cost per stock unit: the lot's litre rate spread over the converted quantity.
      v_rate := coalesce(nullif(v_alloc.average_rate, 0), nullif(app_private.jnum(p_payload -> 'rate'), 0));
      v_value := case when v_rate is not null then v_qty * v_rate else v_stock_qty * coalesce(v_item.cost_price, 0) end;
      v_on_hand := app_private.on_hand_base(v_item.stock, v_item.variant_stocks, v_item.variants);
      v_new_cost := app_private.average_cost_after_intake(v_on_hand, v_item.cost_price, v_stock_qty, v_value);

      perform app_private.move_item_stock(
        v_item.id, v_stock_qty, '{}'::jsonb,
        'log_alloc_' || p_request_id || '_' || v_idx,
        now(),
        'Allocation',
        'Allocated to Counter from ' || coalesce(v_alloc.supplier_name, 'Milk Tank') || ' (Purchase #' || coalesce(v_alloc.purchase_id, 'N/A') || ')',
        jsonb_build_object('allocation_id', v_alloc.id, 'purchase_id', v_alloc.purchase_id, 'litres', v_qty, 'request_id', p_request_id)
      );
      if v_new_cost > 0 then
        update items set cost_price = v_new_cost where id = v_item.id;
      end if;
      v_items := v_items || jsonb_build_object(v_item.id, app_private.item_state(v_item.id));
    end if;
  end loop;

  return jsonb_build_object('applied', true, 'rows', v_rows, 'items', v_items);
end;
$$;

create or replace function public.app_approve_override(p_user_id text, p_pin text, p_permission text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_user app_users%rowtype;
  v_key text := 'approve_uid_' || coalesce(p_user_id, '');
  v_lock text;
  v_module text := split_part(coalesce(p_permission, ''), ':', 1);
  v_allowed boolean;
begin
  if not app_private.is_operator() then
    raise exception 'Login required.' using errcode = '42501';
  end if;
  if p_pin is null or trim(p_pin) = '' then
    raise exception 'PIN code is required.';
  end if;
  if v_module = '' then
    raise exception 'Unknown approval type.';
  end if;

  -- Approvals count in their own bucket: a cashier typing wrong manager PINs into the approval
  -- dialog must not lock that manager out of logging in (app_verify_pin uses 'uid_').
  perform pg_advisory_xact_lock(hashtextextended('mooco_pin:' || v_key, 0));

  v_lock := app_private.pin_lockout_message(array[v_key]);
  if v_lock is not null then
    raise exception '%', v_lock;
  end if;

  select * into v_user from app_users where id = p_user_id;

  if v_user.id is null
     or v_user.is_active = false
     or v_user.pin_hash is null
     or v_user.pin_hash <> encode(digest(v_user.pin_salt || trim(p_pin), 'sha256'), 'hex') then
    insert into app_login_attempts(username, success) values (v_key, false);
    return jsonb_build_object('approved', false, 'message', 'Wrong PIN code!');
  end if;

  select v_user.role_id = 'role_super_admin' or exists (
    select 1
    from jsonb_array_elements_text(
      coalesce(v_user.permissions, '[]'::jsonb)
      || coalesce((select r.permissions from app_roles r where r.id = v_user.role_id), '[]'::jsonb)
    ) p(perm)
    where p.perm = v_module or p.perm = p_permission
  ) into v_allowed;

  if not v_allowed then
    raise exception '% does not have permission to approve this.', v_user.name;
  end if;

  return jsonb_build_object('approved', true, 'id', v_user.id, 'name', v_user.name);
end;
$$;

create or replace function public.app_create_user(p_name text, p_username text, p_pin text, p_role_id text, p_phone text default null::text, p_avatar text default null::text, p_permissions jsonb default null::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_id text;
  v_salt text;
  v_user app_users%rowtype;
begin
  if not app_private.can_manage_users() then
    raise exception 'You do not have permission to manage users.' using errcode = '42501';
  end if;
  if p_role_id = 'role_super_admin' and not app_private.is_super_admin() then
    raise exception 'Only a Super Admin can create a Super Admin.' using errcode = '42501';
  end if;
  if p_name is null or trim(p_name) = '' then raise exception 'Name is required.'; end if;
  if p_username is null or trim(p_username) = '' then raise exception 'Username is required.'; end if;
  if p_pin is null or p_pin !~ '^\d{4,10}$' then raise exception 'PIN must be 4 to 10 digits.'; end if;
  if p_role_id is null or trim(p_role_id) = '' then raise exception 'Role is required.'; end if;
  if exists (select 1 from app_users where lower(username) = lower(trim(p_username))) then
    raise exception 'This username already exists.';
  end if;

  v_id := 'user_' || replace(encode(gen_random_bytes(12), 'hex'), '-', '');
  v_salt := encode(gen_random_bytes(16), 'hex');

  insert into app_users (id, name, username, pin_salt, pin_hash, role_id, phone, avatar, permissions, is_active, created_at)
  values (v_id, trim(p_name), trim(p_username),
          v_salt, encode(digest(v_salt || p_pin, 'sha256'), 'hex'),
          p_role_id, p_phone, p_avatar,
          case when p_permissions is null then '[]'::jsonb else p_permissions end,
          true, now())
  returning * into v_user;

  return to_jsonb(v_user) - 'pin' - 'pin_hash' - 'pin_salt';
end;
$function$;

create or replace function public.app_delete_user(p_user_id text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_super_count int;
  v_is_super boolean;
begin
  if not app_private.can_manage_users() then
    raise exception 'You do not have permission to manage users.' using errcode = '42501';
  end if;

  select count(*) into v_super_count from app_users where role_id = 'role_super_admin';
  select exists (select 1 from app_users where id = p_user_id and role_id = 'role_super_admin')
    into v_is_super;

  if v_is_super and not app_private.is_super_admin() then
    raise exception 'Only a Super Admin can delete a Super Admin.' using errcode = '42501';
  end if;
  if v_is_super and v_super_count <= 1 then
    raise exception 'The last Super Admin user cannot be deleted.';
  end if;

  delete from app_users where id = p_user_id;
  return found;
end;
$function$;

create or replace function public.app_list_users()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not app_private.is_operator() then
    raise exception 'Login required.' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(u) - 'pin' - 'pin_hash' - 'pin_salt' order by u.created_at), '[]'::jsonb)
    from app_users u
  );
end;
$$;

create or replace function public.app_login(p_username text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_user app_users%rowtype;
  v_name text;
  v_key text;
  v_lock text;
begin
  if p_username is null or trim(p_username) = '' or p_pin is null or trim(p_pin) = '' then
    raise exception 'Username and PIN are both required.';
  end if;
  v_name := lower(trim(p_username));

  select * into v_user
  from app_users
  where lower(username) = v_name;

  -- Same bucket as app_verify_pin, so switching login mode buys no extra guesses.
  v_key := case when v_user.id is null then v_name else 'uid_' || v_user.id end;
  perform pg_advisory_xact_lock(hashtextextended('mooco_pin:' || v_key, 0));

  delete from app_login_attempts where attempted_at < now() - interval '1 day';

  v_lock := app_private.pin_lockout_message(array[v_name, v_key]);
  if v_lock is not null then
    raise exception '%', v_lock;
  end if;

  if v_user.id is null
     or v_user.is_active = false
     or v_user.pin_hash is null
     or v_user.pin_hash <> encode(digest(v_user.pin_salt || trim(p_pin), 'sha256'), 'hex') then
    -- Return instead of raising so the failed attempt is committed and counts toward the lockout.
    insert into app_login_attempts(username, success) values (v_key, false);
    return null;
  end if;

  insert into app_login_attempts(username, success) values (v_key, true);
  update app_users set last_login = now() where id = v_user.id;

  return to_jsonb(v_user) - 'pin' - 'pin_hash' - 'pin_salt';
end;
$function$;

create or replace function public.app_login_with_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_user app_users%rowtype;
  v_lock text;
begin
  if p_pin is null or trim(p_pin) = '' then
    raise exception 'PIN code is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mooco_pin:__pin_unlock__', 0));

  delete from app_login_attempts where attempted_at < now() - interval '1 day';

  v_lock := app_private.pin_lockout_message(array['__pin_unlock__']);
  if v_lock is not null then
    raise exception '%', v_lock;
  end if;

  for v_user in
    select * from app_users where is_active = true and pin_hash is not null
  loop
    if v_user.pin_hash = encode(digest(v_user.pin_salt || trim(p_pin), 'sha256'), 'hex') then
      insert into app_login_attempts(username, success) values ('__pin_unlock__', true);
      update app_users set last_login = now() where id = v_user.id;
      return to_jsonb(v_user) - 'pin' - 'pin_hash' - 'pin_salt';
    end if;
  end loop;

  insert into app_login_attempts(username, success) values ('__pin_unlock__', false);
  return null;
end;
$function$;

create or replace function public.app_update_user(p_user_id text, p_updates jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_salt text;
  v_pin text;
  v_user app_users%rowtype;
  v_new_perms jsonb;
begin
  if not app_private.can_manage_users() then
    raise exception 'You do not have permission to manage users.' using errcode = '42501';
  end if;

  select * into v_user from app_users where id = p_user_id;
  if v_user.id is null then raise exception 'User not found.'; end if;

  if (v_user.role_id = 'role_super_admin' or p_updates ->> 'role_id' = 'role_super_admin')
     and not app_private.is_super_admin() then
    raise exception 'Only a Super Admin can change a Super Admin.' using errcode = '42501';
  end if;

  -- The Settings form may resend the whole row, so only a real change counts (permissions compared
  -- as a set, order ignored).
  if v_user.id = app_private.current_operator_id() and not app_private.is_super_admin() then
    v_new_perms := coalesce(p_updates -> 'permissions', v_user.permissions);
    if coalesce(nullif(p_updates ->> 'role_id', ''), v_user.role_id) is distinct from v_user.role_id
       or coalesce((p_updates ->> 'is_active')::boolean, v_user.is_active) is distinct from v_user.is_active
       or (select coalesce(array_agg(distinct p order by p), '{}')
           from jsonb_array_elements_text(case when jsonb_typeof(v_new_perms) = 'array' then v_new_perms else '[]'::jsonb end) p)
          is distinct from
          (select coalesce(array_agg(distinct p order by p), '{}')
           from jsonb_array_elements_text(case when jsonb_typeof(v_user.permissions) = 'array' then v_user.permissions else '[]'::jsonb end) p)
    then
      raise exception 'You cannot change your own role, permissions or status. Ask a Super Admin.' using errcode = '42501';
    end if;
  end if;

  v_pin := nullif(p_updates ->> 'pin', '');
  if v_pin is not null and v_pin !~ '^\d{4,10}$' then
    raise exception 'PIN must be 4 to 10 digits.';
  end if;

  if v_pin is not null then
    v_salt := encode(gen_random_bytes(16), 'hex');
    update app_users
    set pin_salt = v_salt,
        pin_hash = encode(digest(v_salt || v_pin, 'sha256'), 'hex')
    where id = p_user_id;
  end if;

  update app_users set
    name        = coalesce(nullif(trim(p_updates ->> 'name'), ''), name),
    username    = coalesce(nullif(trim(p_updates ->> 'username'), ''), username),
    role_id     = coalesce(nullif(p_updates ->> 'role_id', ''), role_id),
    phone       = coalesce(p_updates ->> 'phone', phone),
    avatar      = coalesce(p_updates ->> 'avatar', avatar),
    is_active   = coalesce((p_updates ->> 'is_active')::boolean, is_active),
    permissions = coalesce(p_updates -> 'permissions', permissions)
  where id = p_user_id;

  return (select to_jsonb(u) - 'pin' - 'pin_hash' - 'pin_salt' from app_users u where id = p_user_id);
end;
$function$;

create or replace function public.app_verify_pin(p_user_id text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_user app_users%rowtype;
  v_key text;
  v_lock text;
begin
  if p_pin is null or trim(p_pin) = '' then
    raise exception 'PIN code is required.';
  end if;

  select * into v_user from app_users where id = p_user_id;

  v_key := 'uid_' || coalesce(p_user_id, '');
  perform pg_advisory_xact_lock(hashtextextended('mooco_pin:' || v_key, 0));

  delete from app_login_attempts where attempted_at < now() - interval '1 day';

  -- Failures app_login recorded under the username (before this migration) still count.
  v_lock := app_private.pin_lockout_message(array[v_key, lower(v_user.username)]);
  if v_lock is not null then
    raise exception '%', v_lock;
  end if;

  if v_user.id is null
     or v_user.is_active = false
     or v_user.pin_hash is null
     or v_user.pin_hash <> encode(digest(v_user.pin_salt || trim(p_pin), 'sha256'), 'hex') then
    insert into app_login_attempts(username, success) values (v_key, false);
    return null;
  end if;

  insert into app_login_attempts(username, success) values (v_key, true);
  update app_users set last_login = now() where id = v_user.id;

  return to_jsonb(v_user) - 'pin' - 'pin_hash' - 'pin_salt';
end;
$function$;

create or replace function public.cancel_production_batch(p_batch_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch production_batches;
  v_det jsonb;
  v_now timestamptz := now();
  v_message text := coalesce(nullif(p_payload ->> 'message', ''), 'Batch Cancelled');
  v_input numeric;
  v_part record;
  v_item items;
  v_stock_qty numeric;
  v_retail_back numeric := 0;
  v_missing numeric := 0;
  v_pool numeric := 0;
  v_raw text;
  v_milk_type text := 'Mixed';
  v_has_cow boolean;
  v_has_buffalo boolean;
  v_text text;
  v_alloc allocations;
  v_items jsonb := '{}'::jsonb;
begin
  perform app_private.assert_can('production', 'edit', 'cancel a production batch');
  select * into v_batch from production_batches where id = p_batch_id for update;
  if not found then raise exception 'Batch not found. Reload the page.'; end if;
  if v_batch.status = 'Cancelled' then
    return jsonb_build_object('already_applied', true, 'batch', to_jsonb(v_batch));
  end if;
  if v_batch.status = 'Completed' then
    raise exception 'A completed batch cannot be cancelled. Correct it with a stock adjustment.';
  end if;

  v_det := case when jsonb_typeof(v_batch.details) = 'object' then v_batch.details else '{}'::jsonb end;
  v_input := round(coalesce(v_batch.quantity_input, 0), 3);

  if v_input > 0 then
    -- Counter milk back to the counter item it came from, all lines of one item together.
    for v_part in
      select regexp_replace(coalesce(m.value ->> 'allocationId', ''), '^inv_', '') as item_id,
             round(sum(app_private.jnum(m.value -> 'quantity')), 3) as litres
      from jsonb_array_elements(case when jsonb_typeof(v_det -> 'milk_breakdown') = 'array' then v_det -> 'milk_breakdown' else '[]'::jsonb end) m
      where m.value ->> 'source' = 'retail' and coalesce(app_private.jnum(m.value -> 'quantity'), 0) > 0
      group by 1
      order by 1
    loop
      -- An older browser run already returned this item's milk.
      if exists (select 1 from inventory_logs where id = 'log_batch_cancel_' || v_batch.id || '_' || v_part.item_id) then
        v_retail_back := v_retail_back + v_part.litres;
        continue;
      end if;
      select * into v_item from items where id = v_part.item_id for update;
      if not found then
        -- The counter item is gone: its litres go back to the pool with the rest.
        v_missing := v_missing + v_part.litres;
        continue;
      end if;
      v_stock_qty := app_private.convert_qty(v_part.litres, 'L', coalesce(nullif(btrim(v_item.unit), ''), 'L'));
      if v_stock_qty is null then
        raise exception '%: litres cannot be converted to "%"; the batch was not cancelled.', v_item.name, v_item.unit;
      end if;
      perform app_private.move_item_stock(
        v_item.id, round(v_stock_qty, 3), '{}'::jsonb,
        'log_batch_cancel_' || v_batch.id || '_' || v_item.id,
        v_now,
        'Production Cancellation',
        'Batch #' || coalesce(v_batch.batch_number, v_batch.id) || ' cancelled: counter milk returned (' || v_part.litres || ' L)',
        jsonb_build_object('batch_id', v_batch.id, 'litres', v_part.litres)
      );
      v_items := v_items || jsonb_build_object(v_item.id, app_private.item_state(v_item.id));
      v_retail_back := v_retail_back + v_part.litres;
    end loop;

    v_pool := round(greatest(0, v_input - v_retail_back), 3);
    if v_pool > 0 and not exists (select 1 from allocations where id = 'alloc_ret_batch_' || v_batch.id) then
      -- The lot keeps the batch's milk type: its own type, else one type across the breakdown, else Mixed.
      v_raw := lower(coalesce(v_det ->> 'milk_type', ''));
      if v_raw <> '' then
        v_milk_type := case when v_raw like '%buffalo%' then 'Buffalo' when v_raw like '%cow%' then 'Cow' else 'Mixed' end;
      elsif jsonb_typeof(v_det -> 'milk_breakdown') = 'array' and jsonb_array_length(v_det -> 'milk_breakdown') > 0 then
        select bool_or(lower(coalesce(m.value ->> 'milkType', '')) like '%cow%'),
               bool_or(lower(coalesce(m.value ->> 'milkType', '')) like '%buffalo%')
        into v_has_cow, v_has_buffalo
        from jsonb_array_elements(v_det -> 'milk_breakdown') m;
        v_milk_type := case when v_has_cow and not v_has_buffalo then 'Cow' when v_has_buffalo and not v_has_cow then 'Buffalo' else 'Mixed' end;
      else
        select lower(coalesce(string_agg(l.value ->> 'message', ' '), '')) into v_text
        from jsonb_array_elements(case when jsonb_typeof(v_batch.logs) = 'array' then v_batch.logs else '[]'::jsonb end) l;
        v_milk_type := case
          when v_text like '%cow milk%' or lower(coalesce(v_batch.product_name, '')) like '%cow%' then 'Cow'
          when v_text like '%buffalo milk%' or lower(coalesce(v_batch.product_name, '')) like '%buffalo%' then 'Buffalo'
          else 'Mixed' end;
      end if;

      insert into allocations (
        id, purchase_id, date, supplier_name, milk_type, original_quantity, allocated_quantity, remaining_quantity,
        status, average_rate, details
      ) values (
        'alloc_ret_batch_' || v_batch.id, 'ret_batch_' || v_batch.id, v_now,
        'Return: Batch #' || coalesce(v_batch.batch_number, v_batch.id) || ' (' || coalesce(v_batch.product_name, '') || ')',
        v_milk_type, v_pool, 0, v_pool, 'Unallocated', coalesce(v_batch.input_cost_per_unit, 0),
        jsonb_strip_nulls(jsonb_build_object(
          'returned_from_batch_id', v_batch.id,
          'batch_number', v_batch.batch_number,
          'product_name', v_batch.product_name,
          'milk_type', v_milk_type,
          'cancel_reason', v_message,
          'counter_milk_without_item', case when v_missing > 0 then v_missing end
        ))
      )
      returning * into v_alloc;
    end if;
  end if;

  update production_batches
  set status = 'Cancelled',
      completed_date = v_now,
      logs = coalesce(logs, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('stage', 'Cancelled', 'message', v_message, 'timestamp', v_now))
  where id = v_batch.id
  returning * into v_batch;

  return jsonb_build_object(
    'applied', true,
    'batch', to_jsonb(v_batch),
    'returned_litres', v_input,
    'counter_litres', round(v_retail_back, 3),
    'pool_litres', v_pool,
    'allocation', case when v_alloc.id is not null then to_jsonb(v_alloc) end,
    'items', v_items
  );
end;
$$;

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
      raise exception 'No receiving account found. Create an account in Bank & Cash first.';
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

create or replace function public.change_sale_payment_mode(
  p_sale_id text,
  p_new_mode text,
  p_old_account_id text,
  p_new_account_id text,
  p_amount numeric,
  p_btx_id text default null::text,
  p_btx jsonb default '{}'::jsonb,
  p_event jsonb default null::jsonb,
  p_details jsonb default null::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale public.sales;
  v_btx public.bank_transactions;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_moved numeric;
begin
  if p_new_mode not in ('Cash', 'Online') then
    raise exception 'Payment mode can only be Cash or Online.';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Bill not found on the server. Try again after sync finishes.';
  end if;
  if coalesce(v_sale.payment_mode, 'Cash') = p_new_mode then
    return jsonb_build_object('success', true, 'unchanged', true);
  end if;
  if v_sale.status in ('Returned', 'Partially Returned') or coalesce(v_sale.refund_amount, 0) > 0 then
    raise exception 'The payment mode of a returned bill cannot be changed.';
  end if;

  -- The bill's own receipt row says where its money is now. Refund rows (btx_ret_*) also point
  -- at the sale, so only an Income row counts. The client's p_btx_id only breaks a tie.
  select * into v_btx
  from public.bank_transactions b
  where b.id = 'btx_' || p_sale_id
     or (b.reference_id = p_sale_id and b.type = 'Income' and b.id not like 'btx\_ret%')
  order by (b.id = p_btx_id) desc nulls last, (b.id = 'btx_' || p_sale_id) desc, b.created_at
  limit 1
  for update;

  if v_btx.id is not null then
    v_moved := round(coalesce(v_btx.amount, 0), 2);

    if p_new_account_id is not null and v_moved > 0
       and v_btx.account_id is distinct from p_new_account_id then
      perform 1 from public.financial_accounts
      where id in (v_btx.account_id, p_new_account_id)
      order by id
      for update;

      if v_btx.account_id is not null then
        update public.financial_accounts set balance = round(coalesce(balance, 0) - v_moved, 2)
        where id = v_btx.account_id;
        if not found then raise exception 'Old account not found.'; end if;
      end if;

      update public.financial_accounts set balance = round(coalesce(balance, 0) + v_moved, 2)
      where id = p_new_account_id;
      if not found then raise exception 'New account not found.'; end if;
    end if;

    if p_new_account_id is not null then
      update public.bank_transactions
      set account_id = p_new_account_id,
          category = coalesce(p_btx->>'category', category),
          description = coalesce(p_btx->>'description', description)
      where id = v_btx.id;
    end if;
  elsif v_amount > 0 and p_new_account_id is not null then
    -- No receipt on the server yet: the money never reached any account, so it only goes into
    -- the new one. pos_sync_order_effects will find btx_<sale> and not post it again.
    if not exists (select 1 from public.financial_accounts where id = p_new_account_id) then
      raise exception 'New account not found.';
    end if;
    insert into public.bank_transactions (
      id, account_id, amount, date, type, category, description, reference_id,
      business_day_id, shift_session_id, drawer_id, cashier_id
    ) values (
      'btx_' || p_sale_id, p_new_account_id, v_amount,
      coalesce(v_sale.date, now()), 'Income',
      p_btx->>'category', p_btx->>'description', p_sale_id,
      nullif(p_btx->>'business_day_id', ''), nullif(p_btx->>'shift_session_id', ''),
      nullif(p_btx->>'drawer_id', ''), nullif(p_btx->>'cashier_id', '')
    );
    perform public.adjust_account_balance(p_new_account_id, v_amount);
    v_moved := v_amount;
  end if;

  -- Audit trail only; expected drawer cash follows the bill's mode and ignores payment_correction events.
  if p_event is not null and coalesce(v_moved, 0) > 0 then
    insert into public.shift_cash_events (
      id, business_day_id, shift_id, drawer_id, event_type, direction, amount,
      payment_mode, source_type, source_id, description, occurred_at, created_by
    ) values (
      p_event->>'id', p_event->>'business_day_id', nullif(p_event->>'shift_id', ''),
      p_event->>'drawer_id', 'Payment Mode Correction', p_event->>'direction', v_moved,
      'Cash', 'payment_correction', p_sale_id, p_event->>'description', now(),
      nullif(p_event->>'created_by', '')
    )
    on conflict (id) do nothing;
  end if;

  update public.sales
  set payment_mode = p_new_mode,
      details = coalesce(p_details, details)
  where id = p_sale_id;

  return jsonb_build_object('success', true, 'amount', coalesce(v_moved, 0));
end;
$function$;

create or replace function public.close_business_day(p_business_day_id text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day business_days;
  v_now timestamptz := now();
  v_user_id text := coalesce(app_private.current_operator_id(), nullif(p_payload->>'user_id', ''));
  v_user_name text;
  v_active integer;
  v_remits integer;
  v_disputed integer;
  v_variances integer;
  v_cash jsonb := case when jsonb_typeof(p_payload->'cash_close') = 'object' then p_payload->'cash_close' end;
  v_summary jsonb := case when jsonb_typeof(p_payload->'summary') = 'object' then p_payload->'summary' else '{}'::jsonb end;
  v_accepted integer := 0;
begin
  if not app_private.can_approve_cash() then
    raise exception 'Only a manager / owner can close the day.' using errcode = '42501';
  end if;

  select * into v_day from business_days where id = p_business_day_id for update;
  if not found then raise exception 'Business day not found. Reload the page.'; end if;
  if v_day.status = 'Closed' then
    return jsonb_build_object('already_closed', true, 'business_day_id', p_business_day_id, 'closed_at', v_day.closed_at);
  end if;

  select count(*) into v_active from cash_shifts
  where business_day_id = p_business_day_id and status in ('Pending Acceptance', 'Active', 'Closing', 'Pending Review');
  select count(*) into v_remits from cash_remittances
  where business_day_id = p_business_day_id and status in ('Pending', 'Disputed');
  select count(*) into v_disputed from drawer_handovers
  where business_day_id = p_business_day_id and status = 'Disputed';
  select count(*) into v_variances from cash_variances
  where business_day_id = p_business_day_id and status = 'Open';
  if v_active + v_remits + v_disputed + v_variances > 0 then
    raise exception 'The day cannot be closed yet: % shift, % remittance, % disputed handover, % difference still open.',
      v_active, v_remits, v_disputed, v_variances;
  end if;

  select name into v_user_name from app_users where id = v_user_id;
  v_user_name := coalesce(v_user_name, nullif(p_payload->>'user_name', ''), 'Manager');

  -- Keep a cash closing recorded earlier (Close Cash) when none comes with the lock.
  if v_cash is null and jsonb_typeof(v_day.summary->'cash') = 'object' then
    v_summary := v_summary || jsonb_build_object('cash', v_day.summary->'cash');
  elsif v_cash is not null then
    v_summary := v_summary || jsonb_build_object('cash', v_cash);
  end if;

  update business_days
  set status = 'Closed',
      closed_at = v_now,
      closed_by = v_user_id,
      notes = coalesce(p_payload->>'notes', notes),
      cash_closed_at = coalesce(cash_closed_at, v_now),
      stock_closed_at = coalesce(stock_closed_at, v_now),
      summary = v_summary
  where id = p_business_day_id;

  -- Only now that the day is closed: whatever is still pending simply stays in the drawer overnight.
  update drawer_handovers
  set status = 'Accepted',
      accepted_by_user_id = v_user_id,
      accepted_by_user_name = v_user_name,
      accepted_at = v_now,
      resolution_notes = 'Auto-accepted: cash left in drawer at day close'
  where business_day_id = p_business_day_id and status = 'Pending';
  get diagnostics v_accepted = row_count;

  -- End-of-day snapshot (Z-report). Fixed id: reopen + close again overwrites, never duplicates.
  if v_cash is not null then
    insert into day_closings (id, date, status, details)
    values ('eod_' || p_business_day_id, v_day.business_date::text, 'Locked', v_cash)
    on conflict (id) do update set date = excluded.date, status = excluded.status, details = excluded.details;
  end if;

  return jsonb_build_object(
    'closed', true,
    'business_day_id', p_business_day_id,
    'closed_at', v_now,
    'handovers_accepted', v_accepted
  );
end;
$$;

create or replace function public.complete_production_batch(p_batch_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch production_batches;
  v_det jsonb;
  v_now timestamptz := now();
  v_message text := coalesce(nullif(p_payload ->> 'message', ''), 'Batch completed');
  v_output jsonb := p_payload -> 'output';
  v_name text;
  v_product items;
  v_variants jsonb;
  v_pack jsonb;
  v_variant jsonb;
  v_count numeric;
  v_size numeric;
  v_loose numeric;
  v_packed_base numeric := 0;
  v_total_out numeric;
  v_pack_deltas jsonb := '{}'::jsonb;
  v_out_variants jsonb := '[]'::jsonb;
  v_pack_summary text[] := '{}';
  v_input numeric;
  v_scale numeric;
  v_ing jsonb;
  v_mat items;
  v_mat_unit text;
  v_mat_qty numeric;
  v_conv numeric;
  v_recipe_inputs jsonb := '[]'::jsonb;
  v_pack_inputs jsonb := '[]'::jsonb;
  v_need jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_milk_rate numeric;
  v_milk_cost numeric;
  v_ing_cost numeric := 0;
  v_pack_cost numeric := 0;
  v_total_cost numeric;
  v_remaining numeric;
  v_take numeric;
  v_loose_delta numeric;
  v_mat_packs jsonb;
  v_opened text[];
  v_p record;
  v_n numeric;
  v_short jsonb := '[]'::jsonb;
  v_items jsonb := '{}'::jsonb;
  v_on_hand numeric;
  v_new_cost numeric;
  v_unit text;
begin
  perform app_private.assert_can('production', 'edit', 'complete a production batch');
  select * into v_batch from production_batches where id = p_batch_id for update;
  if not found then raise exception 'Batch not found. Reload the page.'; end if;
  if v_batch.status = 'Completed' then
    return jsonb_build_object('already_applied', true, 'batch', to_jsonb(v_batch));
  end if;
  if v_batch.status = 'Cancelled' then
    raise exception 'Batch #% is cancelled; it cannot be completed.', coalesce(v_batch.batch_number, v_batch.id);
  end if;
  perform app_private.assert_stock_day_open(v_now);

  v_det := case when jsonb_typeof(v_batch.details) = 'object' then v_batch.details else '{}'::jsonb end;

  -- An older browser run already put this batch's output in stock: only the status is left.
  if exists (select 1 from inventory_logs where id = 'log_prod_' || v_batch.id) then
    update production_batches
    set status = 'Completed', completed_date = coalesce(completed_date, v_now),
        logs = coalesce(logs, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('stage', 'Completed', 'message', v_message, 'timestamp', v_now))
    where id = v_batch.id
    returning * into v_batch;
    return jsonb_build_object('applied', true, 'stock_already_posted', true, 'batch', to_jsonb(v_batch));
  end if;

  -- The product.
  v_name := lower(btrim(coalesce(v_batch.product_name, '')));
  if nullif(p_payload ->> 'product_item_id', '') is not null then
    select * into v_product from items where id = p_payload ->> 'product_item_id' for update;
    if not found then raise exception 'Product not found. Reload the page.'; end if;
  else
    select * into v_product from items where v_name <> '' and lower(btrim(name)) = v_name order by id limit 1 for update;
    if not found and v_name <> '' and (
      select count(*) from items i
      where btrim(coalesce(i.name, '')) <> ''
        and (strpos(lower(i.name), v_name) > 0 or strpos(v_name, lower(btrim(i.name))) > 0)
    ) = 1 then
      select * into v_product from items i
      where btrim(coalesce(i.name, '')) <> ''
        and (strpos(lower(i.name), v_name) > 0 or strpos(v_name, lower(btrim(i.name))) > 0)
      for update;
    end if;
    if v_product.id is null then
      raise exception 'Product "%" not found in the catalog. Create the product first (or fix the name), then complete the batch.', v_batch.product_name;
    end if;
  end if;
  v_unit := coalesce(nullif(btrim(v_product.unit), ''), 'kg');
  v_variants := case when jsonb_typeof(v_product.variants) = 'array' then v_product.variants else '[]'::jsonb end;
  v_input := round(coalesce(v_batch.quantity_input, 0), 3);

  -- Output: loose quantity and pack counts. No output sent: the estimate goes to loose.
  if jsonb_typeof(v_output) is distinct from 'object' then
    v_loose := round(coalesce(nullif(v_batch.quantity_output_estimated, 0), v_input * 0.85), 3);
  else
    v_loose := round(coalesce(app_private.jnum(v_output -> 'loose_qty'), 0), 3);
    if v_loose < 0 then raise exception 'Loose output cannot be negative.'; end if;
    for v_pack in select value from jsonb_array_elements(case when jsonb_typeof(v_output -> 'packs') = 'array' then v_output -> 'packs' else '[]'::jsonb end) loop
      v_count := app_private.jnum(v_pack -> 'count');
      if v_count is null or v_count < 0 or v_count <> trunc(v_count) then
        raise exception 'Pack counts must be whole numbers (0, 1, 2 ...).';
      end if;
      if v_count = 0 then continue; end if;
      v_variant := null;
      select v.value into v_variant from jsonb_array_elements(v_variants) v where v.value ->> 'id' = v_pack ->> 'variant_id' limit 1;
      if v_variant is null then
        raise exception 'This pack of % is no longer in the catalog. Reload the page and complete again.', v_product.name;
      end if;
      v_size := app_private.pack_size(v_variant);
      if app_private.is_pack(v_variant) then
        v_pack_deltas := v_pack_deltas || jsonb_build_object(v_variant ->> 'id',
          round(coalesce(app_private.jnum(v_pack_deltas -> (v_variant ->> 'id')), 0) + v_count, 3));
        v_packed_base := v_packed_base + v_count * v_size;
      else
        v_loose := round(v_loose + v_count * v_size, 3);
      end if;
      v_pack_summary := v_pack_summary || (v_count || 'x ' || coalesce(v_variant ->> 'name', 'pack'));
      v_out_variants := v_out_variants || jsonb_build_array(jsonb_build_object(
        'variantId', v_variant ->> 'id',
        'variant_name', coalesce(v_variant ->> 'name', 'Unknown'),
        'count', v_count,
        'base_qty_each', v_size,
        'total_base_qty', round(v_count * v_size, 3),
        'stocked_as', case when app_private.is_pack(v_variant) then 'packs' else 'loose' end
      ));

      -- Packaging used by these packs.
      if nullif(v_variant ->> 'packaging_item_id', '') is not null and coalesce(app_private.jnum(v_variant -> 'packaging_qty'), 0) > 0 then
        select * into v_mat from items where id = v_variant ->> 'packaging_item_id';
        if not found then
          raise exception 'Packaging material for % not found in the catalog. Fix the pack packaging.', coalesce(v_variant ->> 'name', 'pack');
        end if;
        v_mat_qty := round(v_count * app_private.jnum(v_variant -> 'packaging_qty'), 3);
        v_pack_inputs := v_pack_inputs || jsonb_build_array(jsonb_build_object(
          'item_id', v_mat.id, 'name', v_mat.name, 'quantity', v_mat_qty, 'unit', v_mat.unit, 'unit_cost', coalesce(v_mat.cost_price, 0)));
        v_pack_cost := v_pack_cost + v_mat_qty * coalesce(v_mat.cost_price, 0);
        v_need := v_need || jsonb_build_object(v_mat.id, round(coalesce(app_private.jnum(v_need -> v_mat.id), 0) + v_mat_qty, 3));
      end if;
    end loop;
  end if;
  v_total_out := round(v_loose + v_packed_base, 3);

  -- Recipe materials, in each material's own stock unit.
  if jsonb_typeof(v_product.recipe) = 'array' and coalesce(v_product.recipe_base_quantity, 0) > 0 then
    v_scale := v_input / v_product.recipe_base_quantity;
    for v_ing in select value from jsonb_array_elements(v_product.recipe) loop
      if nullif(v_ing ->> 'item_id', '') is null then continue; end if;
      v_mat_qty := coalesce(app_private.jnum(v_ing -> 'quantity'), 0) * v_scale;
      if v_mat_qty <= 0 then continue; end if;
      select * into v_mat from items where id = v_ing ->> 'item_id';
      if not found then
        raise exception 'Recipe material "%" not found in the catalog. Fix the recipe for %.', coalesce(v_ing ->> 'item_name', v_ing ->> 'item_id'), v_product.name;
      end if;
      v_mat_unit := coalesce(nullif(btrim(v_mat.unit), ''), nullif(btrim(v_ing ->> 'unit'), ''));
      if nullif(btrim(v_ing ->> 'unit'), '') is not null and v_mat_unit is not null then
        v_conv := app_private.convert_qty(v_mat_qty, v_ing ->> 'unit', v_mat_unit);
        if v_conv is null then
          raise exception '%: the recipe uses "%" but stock is kept in "%"; this cannot be converted. Fix the recipe for %.',
            v_mat.name, v_ing ->> 'unit', v_mat_unit, v_product.name;
        end if;
        v_mat_qty := v_conv;
      end if;
      v_mat_qty := round(v_mat_qty, 3);
      if v_mat_qty <= 0 then continue; end if;
      v_recipe_inputs := v_recipe_inputs || jsonb_build_array(jsonb_build_object(
        'item_id', v_mat.id, 'name', v_mat.name, 'quantity', v_mat_qty, 'unit', v_mat_unit, 'unit_cost', coalesce(v_mat.cost_price, 0)));
      v_ing_cost := v_ing_cost + v_mat_qty * coalesce(v_mat.cost_price, 0);
      v_need := v_need || jsonb_build_object(v_mat.id, round(coalesce(app_private.jnum(v_need -> v_mat.id), 0) + v_mat_qty, 3));
    end loop;
  end if;

  -- Take each material: loose first, then whole packs (smallest first), opened remainder back to loose.
  for v_key, v_val in select key, value from jsonb_each(v_need) order by key loop
    select * into v_mat from items where id = v_key for update;
    v_remaining := round(app_private.jnum(v_val), 3);
    v_take := least(v_remaining, greatest(0, coalesce(v_mat.stock, 0)));
    v_loose_delta := -v_take;
    v_remaining := round(v_remaining - v_take, 3);
    v_mat_packs := '{}'::jsonb;
    v_opened := '{}';
    if v_remaining > 0 then
      for v_p in
        select v.value ->> 'id' as id, coalesce(v.value ->> 'name', 'pack') as name, app_private.pack_size(v.value) as size,
               floor(coalesce(app_private.jnum(v_mat.variant_stocks -> (v.value ->> 'id')), 0)) as cnt
        from jsonb_array_elements(case when jsonb_typeof(v_mat.variants) = 'array' then v_mat.variants else '[]'::jsonb end) v
        where app_private.is_pack(v.value)
          and coalesce(app_private.jnum(v_mat.variant_stocks -> (v.value ->> 'id')), 0) >= 1
        order by app_private.pack_size(v.value), v.value ->> 'id'
      loop
        exit when v_remaining <= 0;
        v_n := least(v_p.cnt, ceil(v_remaining / v_p.size));
        if v_n <= 0 then continue; end if;
        v_mat_packs := v_mat_packs || jsonb_build_object(v_p.id, -v_n);
        v_opened := v_opened || (v_n || ' x ' || v_p.name);
        v_remaining := round(v_remaining - v_n * v_p.size, 3);
      end loop;
    end if;
    -- v_remaining < 0: opened packs held more than needed, the rest goes to loose.
    -- v_remaining > 0: not enough stock; loose goes below zero by the shortfall.
    v_loose_delta := round(v_loose_delta - v_remaining, 3);
    if v_remaining > 0 then
      v_short := v_short || jsonb_build_array(jsonb_build_object('item_id', v_mat.id, 'name', v_mat.name, 'short', v_remaining, 'unit', v_mat.unit));
    end if;
    perform app_private.move_item_stock(
      v_mat.id, v_loose_delta, v_mat_packs,
      'log_prod_mat_' || v_batch.id || '_' || v_mat.id,
      v_now,
      'Production Usage',
      'Consumed in Batch #' || coalesce(v_batch.batch_number, v_batch.id) || ' (' || coalesce(v_batch.product_name, '') || ')'
        || case when cardinality(v_opened) > 0 then ' [opened ' || array_to_string(v_opened, ', ') || ']' else '' end,
      jsonb_build_object('batch_id', v_batch.id, 'used', app_private.jnum(v_val))
    );
    v_items := v_items || jsonb_build_object(v_mat.id, app_private.item_state(v_mat.id));
  end loop;

  -- Costs, and the product's moving average over what it held before this output.
  v_milk_rate := coalesce(nullif(v_batch.input_cost_per_unit, 0), app_private.jnum(v_det -> 'input_cost_per_unit'), 0);
  v_milk_cost := round(v_input * v_milk_rate, 2);
  v_ing_cost := round(v_ing_cost, 2);
  v_pack_cost := round(v_pack_cost, 2);
  v_total_cost := round(v_milk_cost + v_ing_cost + v_pack_cost, 2);

  select * into v_product from items where id = v_product.id;
  v_on_hand := app_private.on_hand_base(v_product.stock, v_product.variant_stocks, v_product.variants);
  v_new_cost := case when v_total_out > 0 and v_total_cost > 0
    then app_private.average_cost_after_intake(v_on_hand, v_product.cost_price, v_total_out, v_total_cost)
    else coalesce(v_product.cost_price, 0) end;

  perform app_private.move_item_stock(
    v_product.id, v_loose, v_pack_deltas,
    'log_prod_' || v_batch.id,
    v_now,
    'Production',
    'Batch #' || coalesce(v_batch.batch_number, v_batch.id) || ' (' || coalesce(v_batch.product_name, '') || ') Completed: '
      || case when v_loose > 0 then v_loose || v_unit || ' loose' else '' end
      || case when cardinality(v_pack_summary) > 0 then ' [Packaged: ' || array_to_string(v_pack_summary, ', ') || ']' else '' end
      || ' (Total: ' || v_total_out || v_unit || ')',
    jsonb_build_object('batch_id', v_batch.id)
  );
  if v_new_cost > 0 and v_new_cost is distinct from v_product.cost_price then
    update items set cost_price = v_new_cost where id = v_product.id;
  end if;
  v_items := v_items || jsonb_build_object(v_product.id, app_private.item_state(v_product.id));

  update production_batches
  set status = 'Completed',
      completed_date = v_now,
      quantity_output_actual = v_total_out,
      logs = coalesce(logs, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('stage', 'Completed', 'message', v_message, 'timestamp', v_now)),
      details = v_det || jsonb_build_object(
        'product_item_id', v_product.id,
        'output_breakdown', jsonb_build_object('loose_qty', v_loose, 'variants', v_out_variants),
        'cost_snapshot', jsonb_build_object(
          'saved_at', v_now,
          'milk_cost', v_milk_cost,
          'ingredients', v_recipe_inputs,
          'packaging', v_pack_inputs,
          'recipe_inputs', v_recipe_inputs,
          'packaging_inputs', v_pack_inputs,
          'ingredients_cost', v_ing_cost,
          'packaging_cost', v_pack_cost,
          'total_cost', v_total_cost,
          'materials_posted', true,
          'external_conversion_cost', 0
        )
      )
  where id = v_batch.id
  returning * into v_batch;

  return jsonb_build_object(
    'applied', true,
    'batch', to_jsonb(v_batch),
    'product_id', v_product.id,
    'total_output', v_total_out,
    'unit', v_unit,
    'total_cost', v_total_cost,
    'short_materials', v_short,
    'items', v_items
  );
end;
$$;

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
    raise exception 'You do not have permission to create an account.' using errcode = '42501';
  end if;
  if v_id is null then raise exception 'account id is required.'; end if;
  if v_name is null then raise exception 'Enter the account name.'; end if;
  if v_type not in ('Cash', 'Bank', 'Wallet') then
    raise exception 'Account type must be Cash, Bank or Wallet.';
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

create or replace function public.dayclose_stock_count(p_business_day_id text, p_counts jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_entry jsonb;
  v_item_id text;
  v_log_id text;
  v_item public.items;
  v_counted numeric;
  v_pack_id text;
  v_variant jsonb;
  v_delta numeric;
  v_loose_delta numeric;
  v_variant_delta jsonb;
  v_adjusted int := 0;
  v_skipped int := 0;
  v_nochange int := 0;
begin
  if not app_private.can_approve_cash() then
    raise exception 'Only a manager / owner can enter the day close stock count.' using errcode = '42501';
  end if;
  if p_business_day_id is null or p_business_day_id = '' then
    raise exception 'business_day_id is required.';
  end if;
  if p_counts is null or jsonb_typeof(p_counts) <> 'array' then
    raise exception 'counts must be an array.';
  end if;
  for v_entry in select value from jsonb_array_elements(p_counts) loop
    if jsonb_typeof(v_entry) <> 'object'
       or app_private.json_num(v_entry->'counted') is null
       or app_private.json_num(v_entry->'counted') < 0 then
      raise exception 'Stock count is not valid (%): enter 0 or a higher number.', coalesce(v_entry->>'item_id', '?');
    end if;
  end loop;

  for v_item_id in
    select distinct coalesce(entry ->> 'item_id', '')
    from jsonb_array_elements(p_counts) entry
  loop
    if v_item_id = '' then continue; end if;
    v_log_id := 'log_dayclose_' || p_business_day_id || '_' || v_item_id;

    if exists (select 1 from inventory_logs where id = v_log_id) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Locked: a sale posting between this read and the adjustment would otherwise be overwritten.
    select * into v_item from items where id = v_item_id for update;
    if not found or v_item.stock is null then continue; end if;

    -- Loose stock: the entry without a variant (or with 'loose').
    select min(app_private.json_num(entry -> 'counted'))
    into v_counted
    from jsonb_array_elements(p_counts) entry
    where coalesce(entry ->> 'item_id', '') = v_item_id
      and coalesce(nullif(entry ->> 'variant_id', ''), 'loose') = 'loose';

    v_loose_delta := case when v_counted is null then 0 else round(v_counted - v_item.stock, 3) end;

    -- Packs: each counted pile moves by its difference.
    v_variant_delta := '{}'::jsonb;
    for v_pack_id, v_counted in
      select entry ->> 'variant_id', min(app_private.json_num(entry -> 'counted'))
      from jsonb_array_elements(p_counts) entry
      where coalesce(entry ->> 'item_id', '') = v_item_id
        and coalesce(nullif(entry ->> 'variant_id', ''), 'loose') <> 'loose'
      group by 1
    loop
      v_variant := null;
      select v into v_variant
      from jsonb_array_elements(case when jsonb_typeof(v_item.variants) = 'array' then v_item.variants else '[]'::jsonb end) v
      where v ->> 'id' = v_pack_id
      limit 1;
      if (v_variant is null or coalesce(v_variant ->> 'deduct_from_base', '') = 'true') and v_counted <> 0 then
        raise exception '% (%) has no count of its own: an old count can only be set to 0. Count the stock loose in %.',
          coalesce(v_variant ->> 'name', 'Old pack'), v_item.name, coalesce(v_item.unit, '');
      end if;
      v_delta := round(v_counted - coalesce(app_private.json_num(coalesce(v_item.variant_stocks, '{}'::jsonb) -> v_pack_id), 0), 3);
      if v_delta <> 0 then
        v_variant_delta := v_variant_delta || jsonb_build_object(v_pack_id, v_delta);
      end if;
    end loop;

    if v_loose_delta = 0 and v_variant_delta = '{}'::jsonb then
      -- No difference: still write the guard row so the day's count is marked applied.
      insert into inventory_logs (id, date, item_id, item_name, old_quantity, new_quantity, difference, reason, notes, details)
      values (v_log_id, now(), v_item_id, v_item.name, v_item.stock, v_item.stock, 0,
              'Stock Count Correction', 'Day Close Stock Count (' || p_business_day_id || ') — no difference',
              jsonb_build_object('loose_delta', 0, 'variant_deltas', '{}'::jsonb, 'business_day_id', p_business_day_id));
      v_nochange := v_nochange + 1;
      continue;
    end if;

    perform public.adjust_item_stock(
      v_item_id,
      v_loose_delta,
      case when v_variant_delta = '{}'::jsonb then null else v_variant_delta end
    );

    insert into inventory_logs (id, date, item_id, item_name, old_quantity, new_quantity, difference, reason, notes, details)
    values (v_log_id, now(), v_item_id, v_item.name, v_item.stock, round(v_item.stock + v_loose_delta, 3), v_loose_delta,
            'Stock Count Correction',
            'Day Close Stock Count (' || p_business_day_id || ')'
            || case when v_variant_delta <> '{}'::jsonb
                    then ' · ' || (select count(*) from jsonb_object_keys(v_variant_delta))::text || ' pack count(s)'
                    else '' end,
            jsonb_build_object('loose_delta', v_loose_delta, 'variant_deltas', v_variant_delta, 'business_day_id', p_business_day_id));
    v_adjusted := v_adjusted + 1;
  end loop;

  return jsonb_build_object('adjusted', v_adjusted, 'skipped', v_skipped, 'no_change', v_nochange);
end;
$function$;

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
    raise exception 'This entry belongs to a bill. Return the bill from Sales History.';
  end if;
  if v_tx.details->>'source' = 'customer_order_advance' then
    raise exception 'This is an order advance. To refund it, pay the customer back as a separate payment.';
  end if;
  if v_tx.shift_session_id is not null then
    select status into v_shift_status from cash_shifts where id = v_tx.shift_session_id;
    if v_shift_status is not null and v_shift_status not in ('Active', 'Closing')
       and exists (select 1 from bank_transactions where reference_id = p_tx_id) then
      raise exception 'This payment is from a closed shift and the drawer is already counted. Add a reversing entry instead of deleting.';
    end if;
  end if;

  v_amount := round(coalesce(v_tx.amount, 0), 2);

  -- Payment and Return both lowered the ledger when posted, so deleting them raises it back.
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
    raise exception 'Only a payment / advance entry can be deleted. Reverse a purchase or return from the Purchase screen.';
  end if;
  if p_tx_id like 'stx\_pur\_%' escape '\' or p_tx_id like 'stx\_mp\_%' escape '\' then
    raise exception 'This payment was made with a purchase. Reverse it with a purchase return.';
  end if;

  select * into v_btx from public.bank_transactions
  where reference_id = p_tx_id or id = 'btx_' || p_tx_id
  order by created_at
  limit 1;

  if found and v_btx.shift_session_id is not null then
    select status into v_shift_status from public.cash_shifts where id = v_btx.shift_session_id;
    if v_shift_status is not null and v_shift_status not in ('Active', 'Closing') then
      raise exception 'This payment came from a closed shift drawer. Add a reversing entry instead of deleting.';
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

create or replace function public.pos_sync_order_effects(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id text := p_payload ->> 'order_id';
  v_btx_id text := 'btx_' || v_order_id;
  v_ctx_id text := 'ctx_' || v_order_id;
  v_bill_items jsonb;
  v_lines jsonb;
  v_from_bill boolean := false;
  v_item_id text;
  v_log_id text;
  v_line jsonb;
  v_move jsonb;
  v_loose numeric;
  v_variants jsonb;
  v_pack text;
  v_old_stock numeric;
  v_item_name text;
  v_item_variants jsonb;
  v_stock_result jsonb;
  v_received numeric;
  v_due numeric;
  v_result jsonb := jsonb_build_object(
    'inventory_applied', false,
    'payment_applied', false,
    'ledger_applied', false
  );
begin
  if v_order_id is null or v_order_id = '' then
    raise exception 'order_id is required.';
  end if;

  -- 1. Stock, from the bill's own lines (their snapshot decides the pile), one guard row per order+item.
  select items into v_bill_items from sales where id = v_order_id;
  if found and jsonb_typeof(v_bill_items) = 'array' then
    v_from_bill := true;
    select coalesce(jsonb_agg(x || jsonb_build_object('item_id', coalesce(nullif(x->>'itemId', ''), nullif(x->>'id', '')))), '[]'::jsonb)
    into v_lines
    from jsonb_array_elements(v_bill_items) x
    where jsonb_typeof(x) = 'object';
  else
    -- No bill row: the payload lines are already in pile units (loose base qty, or a pack count).
    select coalesce(jsonb_agg(jsonb_build_object(
             'item_id', x->>'item_id',
             'qty', x->'qty',
             'variantId', nullif(x->>'variant_id', ''),
             'deductFromBase', case when nullif(x->>'variant_id', '') is null then null else false end
           )), '[]'::jsonb)
    into v_lines
    from jsonb_array_elements(case when jsonb_typeof(p_payload -> 'items') = 'array' then p_payload -> 'items' else '[]'::jsonb end) x
    where jsonb_typeof(x) = 'object';
  end if;

  for v_item_id in
    select distinct l->>'item_id'
    from jsonb_array_elements(v_lines) l
    where nullif(l->>'item_id', '') is not null
  loop
    v_log_id := 'log_' || v_order_id || '_' || v_item_id;
    continue when exists (select 1 from inventory_logs where id = v_log_id);

    select stock, name, coalesce(variants, '[]'::jsonb)
    into v_old_stock, v_item_name, v_item_variants
    from items
    where id = v_item_id
    for update;
    -- A product deleted since the sale: nothing to move (as before).
    continue when v_old_stock is null;

    v_loose := 0;
    v_variants := '{}'::jsonb;
    for v_line in select l from jsonb_array_elements(v_lines) l where l->>'item_id' = v_item_id loop
      v_move := app_private.sale_line_stock(v_line, v_item_variants);
      if (v_move->>'from_base')::boolean then
        v_loose := v_loose + (v_move->>'base_qty')::numeric;
      else
        v_pack := v_move->>'variant_id';
        -- Variant deltas are NEGATIVE pack counts, summed per pack so repeated lines all count.
        v_variants := v_variants || jsonb_build_object(v_pack,
          round(coalesce((v_variants->>v_pack)::numeric, 0) - (v_move->>'stock_qty')::numeric, 3));
      end if;
    end loop;
    v_loose := round(v_loose, 3);

    v_stock_result := public.adjust_item_stock(v_item_id, -v_loose, case when v_variants = '{}'::jsonb then null else v_variants end);

    insert into inventory_logs (id, date, item_id, item_name, old_quantity, new_quantity, difference, reason, notes, details)
    values (
      v_log_id,
      coalesce((p_payload ->> 'date')::timestamptz, now()),
      v_item_id,
      v_item_name,
      v_old_stock,
      (v_stock_result ->> 'stock')::numeric,
      -v_loose,
      'Sale',
      'POS #' || coalesce(p_payload ->> 'bill_number', '') || ': ' || coalesce(v_item_name, v_item_id)
        || case when v_variants <> '{}'::jsonb then ' (packs)' else '' end,
      jsonb_build_object('loose_delta', -v_loose, 'variant_deltas', v_variants, 'sale_id', v_order_id,
                         'stock_from', case when v_from_bill then 'bill' else 'payload' end)
    );

    v_result := jsonb_set(v_result, '{inventory_applied}', 'true');
  end loop;

  -- 2. Idempotent payment receipt (cash/online portion of the bill)
  v_received := round(least(
                 coalesce((p_payload ->> 'paid_amount')::numeric, 0),
                 coalesce((p_payload ->> 'total')::numeric, 0)
               ), 2);

  if v_received > 0
     and p_payload ->> 'account_id' is not null
     and not exists (select 1 from bank_transactions where id = v_btx_id) then
    insert into bank_transactions (id, account_id, amount, date, type, category, description, reference_id,
                                   business_day_id, shift_session_id, drawer_id, cashier_id)
    values (v_btx_id,
            p_payload ->> 'account_id',
            v_received,
            (p_payload ->> 'date')::timestamptz,
            'Income',
            case when p_payload ->> 'payment_mode' = 'Cash' then 'POS Sale' else 'Online Sale' end,
            'POS ' || coalesce(p_payload ->> 'payment_mode', 'Sale') || ' Sale #' || coalesce(p_payload ->> 'bill_number', ''),
            v_order_id,
            p_payload ->> 'business_day_id',
            p_payload ->> 'shift_session_id',
            p_payload ->> 'drawer_id',
            p_payload ->> 'cashier_id');

    perform public.adjust_account_balance(p_payload ->> 'account_id', v_received);
    v_result := jsonb_set(v_result, '{payment_applied}', 'true');
  end if;

  -- 3. Idempotent customer ledger charge (credit portion)
  v_due := round(coalesce((p_payload ->> 'due_amount')::numeric, 0), 2);

  if v_due > 0
     and p_payload ->> 'customer_id' is not null
     and not exists (select 1 from customer_transactions where id = v_ctx_id) then
    insert into customer_transactions (id, customer_id, date, type, amount, details)
    values (v_ctx_id,
            p_payload ->> 'customer_id',
            (p_payload ->> 'date')::timestamptz,
            'Charge',
            v_due,
            jsonb_build_object(
              'mode', case when coalesce((p_payload ->> 'paid_amount')::numeric, 0) > 0
                           then coalesce(p_payload ->> 'payment_mode', '') || ' + Ledger Due'
                           else 'Credit Sale' end,
              'note', 'Sale #' || coalesce(p_payload ->> 'bill_number', '')
                      || ' (Total: Rs ' || coalesce((p_payload ->> 'total')::numeric, 0)
                      || ', Paid: Rs ' || coalesce((p_payload ->> 'paid_amount')::numeric, 0)
                      || ', Due: Rs ' || v_due || ')',
              'business_day_id', p_payload ->> 'business_day_id',
              'shift_session_id', p_payload ->> 'shift_session_id',
              'drawer_id', p_payload ->> 'drawer_id',
              'cashier_id', p_payload ->> 'cashier_id'
            ));

    perform public.adjust_customer_balance(p_payload ->> 'customer_id', v_due);
    v_result := jsonb_set(v_result, '{ledger_applied}', 'true');
  end if;

  return v_result || jsonb_build_object('stock_from_bill', v_from_bill);
end;
$function$;

create or replace function public.post_customer_order_advance(
  p_order_id text,
  p_tx_id text,
  p_account_id text,
  p_business_day_id text default null::text,
  p_shift_session_id text default null::text,
  p_drawer_id text default null::text,
  p_cashier_id text default null::text
)
returns customer_orders
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.customer_orders;
  v_delta numeric;
  v_tx_id text;
  v_result jsonb;
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

  -- One id per advance level, taken from the locked row (advance_posted only ever rises to
  -- advance_paid, so a level is posted at most once). p_tx_id is kept for the signature.
  v_tx_id := 'ctx_adv_' || v_order.id || '_' || round(coalesce(v_order.advance_paid, 0) * 100)::bigint;

  v_result := public.record_customer_payment_effects(
    v_tx_id, v_order.customer_id, v_delta, now()::text, 'Payment',
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
  if coalesce((v_result->>'already_applied')::boolean, false) then
    raise exception 'Advance entry % already exists. Reopen the order and try again.', v_tx_id;
  end if;

  perform set_config('mooco.posting_advance', 'on', true);
  update public.customer_orders set advance_posted = advance_paid where id = p_order_id
  returning * into v_order;
  perform set_config('mooco.posting_advance', 'off', true);
  return v_order;
end;
$function$;

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
  perform app_private.assert_can('accounts', 'create', 'post a journal entry');
  if nullif(p_entry_id, '') is null then raise exception 'journal entry id is required.'; end if;
  if exists (select 1 from journal_entries where id = p_entry_id) then
    return jsonb_build_object('already_applied', true, 'id', p_entry_id);
  end if;
  perform app_private.assert_books_open(v_date, null);

  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) < 2 then
    raise exception 'A journal entry needs at least two lines.';
  end if;
  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_debit := round(coalesce(nullif(v_line->>'debit', '')::numeric, 0), 2);
    v_credit := round(coalesce(nullif(v_line->>'credit', '')::numeric, 0), 2);
    if v_debit < 0 or v_credit < 0 then raise exception 'Debit / credit cannot be negative.'; end if;
    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  end loop;
  if abs(v_total_debit - v_total_credit) > 0.01 then
    raise exception 'Double-entry out of balance! Debit (Rs %) and Credit (Rs %) are not equal.', v_total_debit, v_total_credit;
  end if;
  if v_total_debit <= 0 then raise exception 'Journal entry amount must be more than 0.'; end if;

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
      raise exception 'A journal can only use Chart of Accounts and Bank/Cash accounts (account "%" not found).', coalesce(v_account_id, '-');
    end if;
  end loop;

  v_details := (p_payload - 'date' - 'lines' - 'drawer_account_ids' - 'business_day_id' - 'shift_session_id' - 'drawer_id' - 'cashier_id' - 'totalAmount')
    || jsonb_build_object('lines', v_lines);
  insert into journal_entries (id, date, total_amount, details)
  values (p_entry_id, v_date, round(v_total_debit, 2), v_details);

  return jsonb_build_object('applied', true, 'id', p_entry_id, 'date', v_date, 'total_amount', round(v_total_debit, 2), 'details', v_details);
end;
$$;

create or replace function public.process_sales_return(p_sale_id text, p_return_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale public.sales;
  v_item public.items;
  v_group record;
  v_sold_line jsonb;
  v_item_id text;
  v_move jsonb;
  v_sold numeric;
  v_back numeric;
  v_price numeric;
  v_gross numeric := 0;
  v_ratio numeric;
  v_max_refund numeric;
  v_total numeric;
  v_collected numeric;
  v_khata_charged numeric;
  v_prior_refund numeric;
  v_khata_left numeric;
  v_cash_cap numeric;
  v_is_replace boolean := coalesce(p_payload->>'return_type', '') = 'replace';
  v_refund numeric := round(coalesce((p_payload->>'refund_amount')::numeric, 0), 2);
  v_khata numeric := round(coalesce((p_payload #>> '{khata,amount}')::numeric, 0), 2);
  v_cash numeric := round(coalesce((p_payload #>> '{cash,amount}')::numeric, 0), 2);
  v_new_items jsonb := coalesce(p_payload->'returned_items', '[]'::jsonb);
  v_all_items jsonb;
  v_status text;
  v_full boolean;
  v_any_back boolean;
  v_dir integer;
  v_n integer := 0;
  v_loose_delta numeric;
  v_pack_deltas jsonb;
  v_label text;
  v_applied jsonb := '[]'::jsonb;
begin
  perform app_private.assert_can('sales_history', 'return', 'process a sales return');
  if p_return_id is null or p_return_id = '' then raise exception 'return id is required.'; end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Bill not found on the server. Return it after sync finishes.';
  end if;
  if coalesce(v_sale.details->'return_ids', '[]'::jsonb) ? p_return_id then
    return jsonb_build_object('already_applied', true, 'status', v_sale.status, 'refund_amount', coalesce(v_sale.refund_amount, 0));
  end if;
  if v_sale.status = 'Returned' then
    raise exception 'This bill has already been fully returned.';
  end if;
  perform app_private.assert_books_open(now(), nullif(p_payload->>'business_day_id', ''));
  if jsonb_typeof(v_new_items) <> 'array' or jsonb_array_length(v_new_items) = 0 then
    raise exception 'No item selected for return.';
  end if;
  if v_refund < 0 or v_khata < 0 or v_cash < 0 or round(v_khata + v_cash, 2) > v_refund + 0.01 then
    raise exception 'Refund amount is not valid.';
  end if;
  if v_is_replace and v_refund > 0 then
    raise exception 'A replacement does not refund any amount.';
  end if;
  if round(coalesce(v_sale.refund_amount, 0) + v_refund, 2) > coalesce(v_sale.total, 0) + 0.01 then
    raise exception 'Refund cannot be more than the bill amount.';
  end if;

  -- Every bill line in its own sold unit, with all of this request's lines for it added up: earlier
  -- returns and replacements plus this one cannot exceed what was sold.
  for v_group in
    -- Same key the return screen uses: the sold line's itemId (copied onto the returned line), else its name.
    select coalesce(nullif(x->>'itemId', ''), lower(x->>'name')) || '|' || coalesce(nullif(x->>'variantId', ''), '') as k,
           sum(coalesce((x->>'qty')::numeric, 0)) as qty,
           min(coalesce((x->>'qty')::numeric, 0)) as min_qty,
           min(x->>'name') as name
    from jsonb_array_elements(v_new_items) x
    group by 1
  loop
    if v_group.min_qty <= 0 then raise exception 'Return qty must be more than 0.'; end if;

    select coalesce(sum(coalesce((x->>'qty')::numeric, 0)), 0), coalesce(max(coalesce((x->>'price')::numeric, 0)), 0)
    into v_sold, v_price
    from jsonb_array_elements(coalesce(v_sale.items, '[]'::jsonb)) x
    where coalesce(nullif(x->>'itemId', ''), lower(x->>'name')) || '|' || coalesce(nullif(x->>'variantId', ''), '') = v_group.k;

    select coalesce(sum(coalesce((x->>'qty')::numeric, 0)), 0) into v_back
    from jsonb_array_elements(coalesce(v_sale.details->'returned_items', '[]'::jsonb)) x
    where coalesce(nullif(x->>'itemId', ''), lower(x->>'name')) || '|' || coalesce(nullif(x->>'variantId', ''), '') = v_group.k;

    if v_back + v_group.qty > v_sold + 0.0005 then
      raise exception '%: only % qty can be returned.', coalesce(v_group.name, 'Item'), greatest(0, v_sold - v_back);
    end if;
    -- Priced at what the bill charged, not at what the client sends.
    v_gross := v_gross + v_group.qty * v_price;
  end loop;

  -- Line prices are before the bill discount (proportionalRefund).
  v_total := greatest(0, coalesce(v_sale.total, 0));
  v_ratio := case when coalesce(v_sale.subtotal, 0) > 0 then v_total / v_sale.subtotal else 1 end;
  v_max_refund := round(greatest(0, v_gross * v_ratio), 2);
  if v_refund > v_max_refund + 0.01 then
    raise exception 'Refund (Rs %) is more than the value of the returned items (Rs %).', v_refund, v_max_refund;
  end if;

  -- Khata is reversed first; cash/online goes back only for money that was collected (splitRefund).
  v_collected := case
    when nullif(coalesce(v_sale.details->>'paid_amount', ''), '') is not null
      then least(greatest(0, (v_sale.details->>'paid_amount')::numeric), v_total)
    when lower(coalesce(v_sale.payment_mode, '')) = 'credit' then 0
    else v_total
  end;
  v_khata_charged := round(greatest(0, v_total - v_collected), 2);
  v_prior_refund := round(coalesce(v_sale.refund_amount, 0), 2);
  v_khata_left := round(greatest(0, v_khata_charged - least(v_prior_refund, v_khata_charged)), 2);
  v_cash_cap := round(greatest(0, v_refund - least(v_refund, v_khata_left)), 2);
  if v_cash > v_cash_cap + 0.01 then
    raise exception 'Only Rs % can be refunded as cash/online on this bill; the rest comes off the customer balance.', v_cash_cap;
  end if;

  -- Stock: out of the pile for a replacement, back into it for a restocked return, nothing for a scrap.
  v_dir := case
    when v_is_replace then -1
    when coalesce(p_payload->>'restock_action', '') = 'scrap_spoilage' then 0
    when jsonb_typeof(p_payload->'restock') = 'boolean' then case when (p_payload->>'restock')::boolean then 1 else 0 end
    when jsonb_typeof(p_payload->'stock_moves') = 'array' and jsonb_array_length(p_payload->'stock_moves') > 0 then 1
    else 0
  end;

  for v_group in
    select coalesce(nullif(x->>'itemId', ''), lower(x->>'name')) || '|' || coalesce(nullif(x->>'variantId', ''), '') as k,
           min(nullif(x->>'itemId', '')) as item_id,
           min(x->>'name') as name,
           sum(coalesce((x->>'qty')::numeric, 0)) as qty
    from jsonb_array_elements(v_new_items) x
    group by 1
    order by 1
  loop
    v_n := v_n + 1;
    -- The sold line this one came from: its snapshot decides the pile and the size.
    select x into v_sold_line
    from jsonb_array_elements(coalesce(v_sale.items, '[]'::jsonb)) x
    where coalesce(nullif(x->>'itemId', ''), lower(x->>'name')) || '|' || coalesce(nullif(x->>'variantId', ''), '') = v_group.k
    limit 1;

    v_item_id := coalesce(nullif(v_sold_line->>'itemId', ''), nullif(v_sold_line->>'id', ''), v_group.item_id);
    if v_item_id is null then
      -- Old bill lines without an id: only an exact, unambiguous product name.
      select min(i.id) into v_item_id from public.items i
      where lower(btrim(i.name)) = lower(btrim(coalesce(v_sold_line->>'name', v_group.name)))
      having count(*) = 1;
    end if;
    select * into v_item from public.items where id = v_item_id for update;
    -- A product deleted since the sale: nothing to move.
    continue when not found;

    v_move := app_private.sale_line_stock(coalesce(v_sold_line, '{}'::jsonb) || jsonb_build_object('qty', v_group.qty), v_item.variants);
    v_loose_delta := case when (v_move->>'from_base')::boolean then v_dir * (v_move->>'base_qty')::numeric else 0 end;
    v_pack_deltas := case when (v_move->>'from_base')::boolean or v_dir = 0 then '{}'::jsonb
                          else jsonb_build_object(v_move->>'variant_id', v_dir * (v_move->>'stock_qty')::numeric) end;

    if v_loose_delta <> 0 or v_pack_deltas <> '{}'::jsonb then
      perform public.adjust_item_stock(v_item.id, v_loose_delta, case when v_pack_deltas = '{}'::jsonb then null else v_pack_deltas end);
      v_applied := v_applied || jsonb_build_array(jsonb_build_object('item_id', v_item.id, 'loose_delta', v_loose_delta, 'variant_deltas', v_pack_deltas));
    end if;

    v_label := case when (v_move->>'from_base')::boolean and (v_move->>'contains')::numeric = 1
                    then btrim(trim_scale(round(v_group.qty, 3))::text || ' ' || coalesce(v_item.unit, ''))
                    else trim_scale(round(v_group.qty, 3))::text || ' x ' || coalesce(v_sold_line->>'name', v_group.name, v_item.name) end;

    insert into public.inventory_logs (id, date, item_id, item_name, old_quantity, new_quantity, difference, reason, notes, details)
    values (
      'log_ret_' || p_return_id || '_' || v_n,
      now(),
      v_item.id,
      v_item.name,
      coalesce(v_item.stock, 0),
      round(coalesce(v_item.stock, 0) + v_loose_delta, 3),
      v_loose_delta,
      case when v_dir = 1 then 'Sales Return' else 'Spoilage / Wastage' end,
      case
        when v_dir = 1 then 'Returned to counter stock from Invoice #' || coalesce(v_sale.bill_number, '') || ': ' || v_label
                            || coalesce(' (' || nullif(p_payload->>'return_reason', '') || ')', '')
        when v_dir = -1 then 'Customer Replacement: ' || v_label || ' spoiled item returned and a fresh one issued for Invoice #' || coalesce(v_sale.bill_number, '')
        else 'Customer Return (Scrapped Spoilage): ' || v_label || ' from #' || coalesce(v_sale.bill_number, '') || ' discarded'
      end,
      jsonb_build_object('loose_delta', v_loose_delta, 'variant_deltas', v_pack_deltas, 'sale_id', p_sale_id, 'return_id', p_return_id)
        || case when v_dir = 0 then jsonb_build_object('scrapped_qty', (v_move->>'stock_qty')::numeric) else '{}'::jsonb end
        -- The scrapped pack's size is read from details.variant_id (reports: scrappedBaseQty).
        || case when v_dir = 0 and not (v_move->>'from_base')::boolean then jsonb_build_object('variant_id', v_move->>'variant_id') else '{}'::jsonb end
    )
    on conflict (id) do nothing;
  end loop;

  if v_khata > 0 then
    if v_sale.customer_id is null then raise exception 'A walk-in bill has no customer ledger.'; end if;
    if nullif(p_payload #>> '{khata,tx_id}', '') is null then raise exception 'Ledger entry id is required.'; end if;
    perform public.adjust_customer_balance(v_sale.customer_id, -v_khata);
    insert into public.customer_transactions (id, customer_id, date, type, amount, details, business_day_id, shift_session_id, drawer_id, cashier_id)
    values (
      p_payload #>> '{khata,tx_id}', v_sale.customer_id, now(), 'Return', v_khata,
      coalesce(p_payload #> '{khata,details}', '{}'::jsonb),
      nullif(p_payload->>'business_day_id', ''), nullif(p_payload->>'shift_session_id', ''),
      nullif(p_payload->>'drawer_id', ''), nullif(p_payload->>'cashier_id', '')
    );
  end if;

  if v_cash > 0 then
    perform app_private.post_bank_tx(
      p_payload #>> '{cash,btx_id}', p_payload #>> '{cash,account_id}', 'Expense', v_cash, now(),
      p_payload #>> '{cash,category}', p_payload #>> '{cash,description}', p_sale_id,
      nullif(p_payload->>'business_day_id', ''), nullif(p_payload->>'shift_session_id', ''),
      nullif(p_payload #>> '{cash,drawer_id}', ''), nullif(p_payload->>'cashier_id', '')
    );
    if p_payload #> '{cash,event}' is not null and jsonb_typeof(p_payload #> '{cash,event}') = 'object' then
      insert into public.shift_cash_events (id, business_day_id, shift_id, drawer_id, event_type, direction, amount, payment_mode, source_type, source_id, description, occurred_at, created_by)
      values (
        p_payload #>> '{cash,event,id}', p_payload #>> '{cash,event,business_day_id}', p_payload #>> '{cash,event,shift_id}',
        p_payload #>> '{cash,event,drawer_id}', 'Cash Refund', 'Out', v_cash, 'Cash', 'sales_return',
        p_payload #>> '{cash,event,source_id}', p_payload #>> '{cash,event,description}', now(),
        nullif(p_payload #>> '{cash,event,created_by}', '')
      );
    end if;
  end if;

  v_all_items := coalesce(v_sale.details->'returned_items', '[]'::jsonb) || v_new_items;

  -- Full return = every sold line came back (replacements do not count); a replacement alone
  -- leaves the bill as it was.
  select bool_and(coalesce(b.qty, 0) >= s.qty - 0.0005), bool_or(coalesce(b.qty, 0) > 0)
  into v_full, v_any_back
  from (
    select coalesce(nullif(x->>'itemId', ''), lower(x->>'name')) || '|' || coalesce(nullif(x->>'variantId', ''), '') k,
           sum(coalesce((x->>'qty')::numeric, 0)) qty
    from jsonb_array_elements(coalesce(v_sale.items, '[]'::jsonb)) x
    group by 1
  ) s
  left join (
    select coalesce(nullif(x->>'itemId', ''), lower(x->>'name')) || '|' || coalesce(nullif(x->>'variantId', ''), '') k,
           sum(coalesce((x->>'qty')::numeric, 0)) qty
    from jsonb_array_elements(v_all_items) x
    where coalesce(x->>'action', '') <> 'replace'
    group by 1
  ) b on b.k = s.k;
  v_status := case
    when coalesce(v_full, false) then 'Returned'
    when coalesce(v_any_back, false) then 'Partially Returned'
    else coalesce(v_sale.status, 'Completed')
  end;

  update public.sales
  set status = v_status,
      return_reason = p_payload->>'return_reason',
      returned_at = now(),
      refund_amount = round(coalesce(refund_amount, 0) + v_refund, 2),
      details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
        'return_type', p_payload->>'return_type',
        'restock_action', p_payload->>'restock_action',
        'returned_items', v_all_items,
        'return_ids', coalesce(details->'return_ids', '[]'::jsonb) || to_jsonb(p_return_id)
      )
  where id = p_sale_id;

  return jsonb_build_object(
    'applied', true,
    'status', v_status,
    'refund_amount', round(coalesce(v_sale.refund_amount, 0) + v_refund, 2),
    'stock_moves', v_applied
  );
end;
$function$;

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
  perform app_private.assert_can('bank_cash', 'create', 'record a deposit / withdrawal');
  if v_btx_id is null then raise exception 'transaction id is required.'; end if;
  if exists (select 1 from bank_transactions where id = v_btx_id) then
    return jsonb_build_object('already_applied', true, 'id', v_btx_id);
  end if;
  if v_type is null or v_type not in ('Deposit', 'Withdrawal', 'Income', 'Expense') then
    raise exception 'Only a Deposit / Withdrawal can be recorded here. Use Transfer to move money between accounts.';
  end if;
  perform app_private.assert_books_open(v_date, p_payload->>'business_day_id');

  if v_contra_id is not null then
    select name into v_contra_name from manual_accounts where id = v_contra_id;
    if not found then raise exception 'Contra account not found. Check the Chart of Accounts.'; end if;
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
    raise exception 'tx_id is required.';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Amount must be more than 0.';
  end if;
  if p_type not in ('Payment', 'Charge') then
    raise exception 'Type must be Payment or Charge.';
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
  perform app_private.assert_can('customers', 'edit', 'record deliveries');
  if jsonb_typeof(v_entries) <> 'array' or jsonb_array_length(v_entries) = 0 then
    raise exception 'No supply entries.';
  end if;

  for v_entry in select value from jsonb_array_elements(v_entries) loop
    v_id := nullif(v_entry->>'id', '');
    if v_id is null then raise exception 'Every supply entry needs an id.'; end if;
    if exists (select 1 from daily_supply where id = v_id) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_det := case when jsonb_typeof(v_entry->'details') = 'object' then v_entry->'details' else '{}'::jsonb end;
    v_date := coalesce(nullif(v_entry->>'date', '')::timestamptz, now());
    v_customer_id := nullif(v_entry->>'customer_id', '');
    v_total := round(coalesce(nullif(v_entry->>'total_amount', '')::numeric, 0), 2);
    if v_total < 0 then raise exception 'Supply amount cannot be negative.'; end if;
    perform app_private.assert_books_open(v_date, p_payload->>'business_day_id');
    if v_customer_id is not null then
      perform 1 from customers where id = v_customer_id for update;
      if not found then raise exception 'Customer "%" not found.', v_customer_id; end if;
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
      if v_paid < 0 or v_due < 0 then raise exception 'Supply amount cannot be negative.'; end if;

      -- The due goes on the ledger as its own ledger row, so the delivery shows on the statement.
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
          raise exception 'Cash account not found. Start a shift first, or create a Cash account in Bank & Cash.';
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

create or replace function public.record_material_purchase(p_request_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_lines jsonb := p_payload -> 'lines';
  v_line jsonb;
  v_idx int := 0;
  v_count int;
  v_date timestamptz := coalesce(nullif(p_payload ->> 'date', '')::timestamptz, now());
  v_supplier_id text := nullif(p_payload ->> 'supplier_id', '');
  v_supplier suppliers;
  v_supplier_name text;
  v_purchase_type text := coalesce(nullif(p_payload ->> 'purchase_type', ''), 'Raw Material');
  v_payment_mode text := coalesce(nullif(p_payload ->> 'payment_mode', ''), 'Cash');
  v_account_id text := nullif(p_payload ->> 'account_id', '');
  v_in_drawer boolean;
  v_total numeric := 0;
  v_requested_paid numeric;
  v_paid numeric;
  v_unpaid numeric;
  v_paid_left numeric;
  v_line_total numeric;
  v_line_paid numeric;
  v_line_due numeric;
  v_item items;
  v_unit text;
  v_item_unit text;
  v_variant jsonb;
  v_factor numeric;
  v_pack_id text;
  v_qty numeric;
  v_rate numeric;
  v_base_qty numeric;
  v_on_hand numeric;
  v_new_cost numeric;
  v_move jsonb;
  v_ids text[] := '{}';
  v_line_paid_map jsonb := '{}'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_items jsonb := '{}'::jsonb;
  v_row material_purchases;
  v_note_lines text[] := '{}';
  v_supplier_balance numeric;
begin
  perform app_private.assert_can('purchase', 'create', 'purchase supplies');
  if nullif(p_request_id, '') is null then raise exception 'request id is required.'; end if;
  v_prefix := 'mp_' || p_request_id || '_';

  -- Same request twice (Save pressed again after a lost response): answer with what was saved.
  perform pg_advisory_xact_lock(hashtext('record_material_purchase:' || p_request_id));
  if exists (select 1 from material_purchases where id = v_prefix || '1') then
    select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb) into v_rows
    from material_purchases m where left(m.id, length(v_prefix)) = v_prefix;
    return jsonb_build_object('already_applied', true, 'rows', v_rows);
  end if;

  if jsonb_typeof(v_lines) is distinct from 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'The bill has no items.';
  end if;
  v_count := jsonb_array_length(v_lines);

  perform app_private.assert_books_open(v_date, p_payload ->> 'business_day_id');

  -- Bill total and the paid share, the way the purchase screen shows them.
  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_qty := app_private.jnum(v_line -> 'quantity');
    v_rate := app_private.jnum(v_line -> 'rate');
    if v_qty is null or v_qty <= 0 or v_rate is null or v_rate < 0 then
      raise exception '"%": quantity must be more than 0 and the rate cannot be negative.', coalesce(v_line ->> 'item_name', v_line ->> 'item_id');
    end if;
    v_total := v_total + v_qty * v_rate;
  end loop;
  v_total := round(v_total, 2);

  v_requested_paid := round(greatest(0, coalesce(app_private.jnum(p_payload -> 'paid_amount'),
    case when v_supplier_id is null then v_total else 0 end)), 2);
  if v_requested_paid > v_total + 0.01 then
    raise exception 'Paid (Rs %) is more than the bill (Rs %). Give the extra amount to the supplier as a separate Advance payment.', v_requested_paid, v_total;
  end if;
  v_paid := least(v_requested_paid, v_total);
  v_unpaid := round(greatest(0, v_total - v_paid), 2);
  if v_supplier_id is null and v_unpaid > 0.01 then
    raise exception 'Choose a supplier for a purchase on credit, or pay the full amount.';
  end if;
  if v_paid > 0 and v_account_id is null then
    raise exception 'Payment account not found! Create an account in ''Bank & Cash'' first, or save the bill on credit.';
  end if;

  if v_supplier_id is not null then
    select * into v_supplier from suppliers where id = v_supplier_id for update;
    if not found then raise exception 'Supplier not found. Reload the page.'; end if;
    v_supplier_name := v_supplier.name;
  end if;

  v_paid_left := v_paid;
  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_idx := v_idx + 1;
    v_qty := round(app_private.jnum(v_line -> 'quantity'), 3);
    v_rate := app_private.jnum(v_line -> 'rate');
    v_line_total := round(v_qty * v_rate, 2);
    if v_idx = v_count then
      v_line_paid := round(greatest(0, v_paid_left), 2);
    else
      v_line_paid := case when v_total > 0 then round(v_line_total / v_total * v_paid, 2) else 0 end;
      v_paid_left := round(v_paid_left - v_line_paid, 2);
    end if;
    v_line_due := round(greatest(0, v_line_total - v_line_paid), 2);

    select * into v_item from items where id = v_line ->> 'item_id' for update;
    if not found then
      raise exception '"%" not found in the catalog. The bill was not saved.', coalesce(v_line ->> 'item_name', v_line ->> 'item_id');
    end if;

    -- Which pile, from the catalog (the browser's conversion factor is not trusted).
    v_item_unit := coalesce(nullif(btrim(v_item.unit), ''), 'pcs');
    v_unit := coalesce(nullif(btrim(v_line ->> 'unit'), ''), v_item_unit);
    v_pack_id := null;
    v_variant := null;
    if lower(v_unit) = lower(v_item_unit) then
      v_factor := 1;
    else
      select v.value into v_variant
      from jsonb_array_elements(case when jsonb_typeof(v_item.variants) = 'array' then v_item.variants else '[]'::jsonb end) v
      where lower(btrim(v.value ->> 'name')) = lower(v_unit)
      order by (coalesce(v.value -> 'isActive', 'true'::jsonb) <> 'false'::jsonb) desc
      limit 1;
      if v_variant is not null then
        v_factor := app_private.pack_size(v_variant);
        if app_private.is_pack(v_variant) then v_pack_id := v_variant ->> 'id'; end if;
      else
        v_factor := app_private.convert_qty(1, v_unit, v_item_unit);
        if v_factor is null or v_factor <= 0 then
          raise exception '%: unit "%" cannot be converted to "%". Add this unit under the product Units & Packaging.', v_item.name, v_unit, v_item_unit;
        end if;
      end if;
    end if;
    v_base_qty := round(v_qty * v_factor, 3);

    -- Average cost over everything on hand before this intake, on the locked row.
    v_on_hand := app_private.on_hand_base(v_item.stock, v_item.variant_stocks, v_item.variants);
    v_new_cost := app_private.average_cost_after_intake(v_on_hand, v_item.cost_price, v_base_qty, v_line_total);

    insert into material_purchases (
      id, date, supplier_id, item_id, item_name, quantity, unit, rate, total_amount, purchase_type, status,
      business_day_id, shift_session_id, drawer_id, cashier_id, details
    ) values (
      v_prefix || v_idx, v_date, v_supplier_id, v_item.id, coalesce(nullif(v_line ->> 'item_name', ''), v_item.name),
      v_qty, v_unit, v_rate, v_line_total, v_purchase_type, 'Completed',
      nullif(p_payload ->> 'business_day_id', ''), nullif(p_payload ->> 'shift_session_id', ''),
      nullif(p_payload ->> 'drawer_id', ''), nullif(p_payload ->> 'cashier_id', ''),
      jsonb_strip_nulls(jsonb_build_object(
        'paid_amount', v_line_paid,
        'due_amount', v_line_due,
        'payment_mode', case when v_line_paid > 0 then v_payment_mode end,
        'account_id', case when v_line_paid > 0 then v_account_id end,
        'conversion_factor', v_factor,
        'base_quantity', v_base_qty,
        'base_unit', v_item_unit,
        'variant_id', v_pack_id,
        'stocked_as', case when v_pack_id is not null then 'packs' else 'loose' end,
        'request_id', p_request_id
      ))
    ) returning * into v_row;
    v_ids := v_ids || v_row.id;
    v_line_paid_map := v_line_paid_map || jsonb_build_object(v_row.id, v_line_paid);
    v_rows := v_rows || to_jsonb(v_row);
    v_note_lines := v_note_lines || (v_qty || ' ' || v_unit || ' ' || v_row.item_name);

    v_move := app_private.move_item_stock(
      v_item.id,
      case when v_pack_id is null then v_base_qty else 0 end,
      case when v_pack_id is not null then jsonb_build_object(v_pack_id, v_qty) else '{}'::jsonb end,
      'log_purch_' || p_request_id || '_' || v_idx,
      now(),
      'Purchase',
      case when v_supplier_id is not null then 'Vendor: ' || coalesce(v_supplier_name, v_supplier_id) else 'Spot Cash Purchase' end
        || case when v_factor <> 1 or v_pack_id is not null
             then ' (' || v_qty || ' ' || v_unit || ' = ' || v_base_qty || ' ' || v_item_unit
                  || case when v_pack_id is not null then ', stocked as packs' else '' end || ')'
             else '' end,
      jsonb_build_object('purchase_id', v_row.id, 'request_id', p_request_id)
    );
    if v_new_cost > 0 then
      update items set cost_price = v_new_cost where id = v_item.id;
    end if;
    v_items := v_items || jsonb_build_object(v_item.id, app_private.item_state(v_item.id));
  end loop;

  if v_supplier_id is not null and v_unpaid > 0 then
    v_supplier_balance := public.adjust_supplier_balance(v_supplier_id, v_unpaid);
  end if;

  if v_paid > 0 then
    v_in_drawer := v_account_id = any(array(select jsonb_array_elements_text(coalesce(p_payload -> 'drawer_account_ids', '[]'::jsonb))));
    perform app_private.post_bank_tx(
      'btx_mp_' || p_request_id, v_account_id, 'Expense', v_paid, v_date, 'Purchase',
      'Material Purchase (' || v_purchase_type || ') - ' || coalesce(v_supplier_name, 'Spot Vendor'),
      array_to_string(v_ids, ','),
      p_payload ->> 'business_day_id',
      case when v_in_drawer then p_payload ->> 'shift_session_id' end,
      case when v_in_drawer then p_payload ->> 'drawer_id' end,
      p_payload ->> 'cashier_id'
    );
    if v_supplier_id is not null then
      insert into supplier_transactions (id, supplier_id, date, type, amount, details)
      values (
        'stx_mp_' || p_request_id, v_supplier_id, v_date, 'Payment', v_paid,
        jsonb_build_object(
          'mode', v_payment_mode,
          'note', 'Spot Payment for Material Purchase (' || array_to_string(v_note_lines, ', ') || ')',
          'account_id', v_account_id,
          'purchase_ids', to_jsonb(v_ids),
          'line_paid', v_line_paid_map
        )
      );
    end if;
  end if;

  if v_supplier_id is not null and v_supplier_balance is null then
    select balance into v_supplier_balance from suppliers where id = v_supplier_id;
  end if;

  return jsonb_build_object(
    'applied', true,
    'rows', v_rows,
    'purchase_ids', to_jsonb(v_ids),
    'total', v_total,
    'paid', v_paid,
    'unpaid', v_unpaid,
    'account_id', case when v_paid > 0 then v_account_id end,
    'account_balance', case when v_paid > 0 then (select balance from financial_accounts where id = v_account_id) end,
    'bank_tx_id', case when v_paid > 0 then 'btx_mp_' || p_request_id end,
    'supplier_tx_id', case when v_paid > 0 and v_supplier_id is not null then 'stx_mp_' || p_request_id end,
    'supplier_id', v_supplier_id,
    'supplier_balance', v_supplier_balance,
    'items', v_items
  );
end;
$$;

create or replace function public.return_material_purchase(p_purchase_id text, p_return_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mp material_purchases;
  v_det jsonb;
  v_now timestamptz := now();
  v_reason text := coalesce(nullif(p_payload ->> 'reason', ''), 'Material Return to Supplier');
  v_refund_as text := coalesce(nullif(p_payload ->> 'refund_as', ''), 'cash');
  v_req_qty numeric := round(app_private.jnum(p_payload -> 'return_qty'), 3);
  v_total_qty numeric;
  v_qty numeric;
  v_full boolean;
  v_rate numeric;
  v_return_amount numeric;
  v_remaining_qty numeric;
  v_remaining_amount numeric;
  v_orig_paid numeric;
  v_account_id text;
  v_bill numeric;
  v_cash_refund numeric := 0;
  v_remaining_paid numeric;
  v_credit numeric;
  v_conversion numeric;
  v_base_qty numeric;
  v_item items;
  v_has_item boolean := false;
  v_variant jsonb;
  v_pack_id text;
  v_on_hand numeric;
  v_base_rate numeric;
  v_left numeric;
  v_revised numeric;
  v_supplier suppliers;
  v_has_supplier boolean := false;
  v_supplier_balance numeric;
  v_new_details jsonb;
  v_in_drawer boolean;
  v_item_state jsonb;
begin
  perform app_private.assert_can('purchase', 'delete', 'return supplies');
  if nullif(p_return_id, '') is null then raise exception 'return id is required.'; end if;
  if v_refund_as not in ('cash', 'khata') then raise exception 'Refund method is not valid.'; end if;

  select * into v_mp from material_purchases where id = p_purchase_id for update;
  if not found then raise exception 'Material purchase not found. Reload the page.'; end if;
  v_det := coalesce(v_mp.details, '{}'::jsonb);
  if coalesce(v_det -> 'return_ids', '[]'::jsonb) ? p_return_id then
    return jsonb_build_object('already_applied', true, 'purchase_id', p_purchase_id, 'row', to_jsonb(v_mp));
  end if;
  if v_mp.status = 'Returned' then raise exception 'This material purchase has already been returned.'; end if;

  perform app_private.assert_books_open(v_now, p_payload ->> 'business_day_id');
  if v_reason = 'Deleted by user' then
    perform app_private.assert_books_open(v_mp.date, null);
  end if;

  v_total_qty := round(coalesce(v_mp.quantity, 0), 3);
  if v_req_qty is not null and (v_req_qty <= 0 or v_req_qty > v_total_qty + 0.0005) then
    raise exception 'Return quantity must be more than 0 and at most % %.', v_total_qty, coalesce(v_mp.unit, '');
  end if;
  v_qty := least(coalesce(v_req_qty, v_total_qty), v_total_qty);
  if v_qty <= 0 then raise exception 'This entry has nothing left to return.'; end if;
  v_full := v_qty >= v_total_qty;
  v_rate := coalesce(v_mp.rate, 0);
  v_return_amount := round(v_qty * v_rate, 2);
  v_remaining_qty := round(v_total_qty - v_qty, 3);
  v_remaining_amount := round(v_remaining_qty * v_rate, 2);

  v_orig_paid := round(coalesce(app_private.jnum(v_det -> 'paid_amount'), 0), 2);
  v_account_id := nullif(v_det ->> 'account_id', '');
  v_bill := coalesce(nullif(v_mp.total_amount, 0), v_total_qty * v_rate);
  if v_refund_as = 'cash' and v_orig_paid > 0 and v_account_id is not null and v_bill > 0 then
    v_cash_refund := round(least(v_orig_paid, v_return_amount * (v_orig_paid / v_bill)), 2);
  end if;
  v_remaining_paid := round(greatest(0, v_orig_paid - v_cash_refund), 2);

  -- The goods leave the pile the purchase put them in.
  v_conversion := coalesce(nullif(app_private.jnum(v_det -> 'conversion_factor'), 0), 1);
  v_base_qty := round(v_qty * v_conversion, 3);
  select * into v_item from items where id = v_mp.item_id for update;
  v_has_item := found;
  if not v_has_item and nullif(v_mp.item_name, '') is not null then
    select * into v_item from items where lower(name) = lower(v_mp.item_name) order by id limit 1 for update;
    v_has_item := found;
  end if;

  if v_has_item then
    if nullif(v_det ->> 'variant_id', '') is not null then
      select v.value into v_variant
      from jsonb_array_elements(case when jsonb_typeof(v_item.variants) = 'array' then v_item.variants else '[]'::jsonb end) v
      where v.value ->> 'id' = v_det ->> 'variant_id'
      limit 1;
      -- Still a ready-made pack: back out of that pack pile. Deleted or turned into a multi-unit:
      -- out of loose at the size it was bought at.
      if app_private.is_pack(v_variant) then v_pack_id := v_det ->> 'variant_id'; end if;
    end if;

    v_on_hand := app_private.on_hand_base(v_item.stock, v_item.variant_stocks, v_item.variants);
    perform app_private.move_item_stock(
      v_item.id,
      case when v_pack_id is null then -v_base_qty else 0 end,
      case when v_pack_id is not null then jsonb_build_object(v_pack_id, -v_qty) else '{}'::jsonb end,
      'log_mp_ret_' || p_return_id,
      v_now,
      'Supply Return',
      case when v_full then 'Full' else 'Partial' end || ' Material Return to Supplier: ' || v_qty || ' ' || coalesce(v_mp.unit, '') || ' (' || v_reason || ')',
      jsonb_build_object('purchase_id', v_mp.id, 'return_id', p_return_id)
    );

    -- Take the returned goods out of the average at the rate they came in at.
    v_base_rate := case when v_conversion > 0 then v_rate / v_conversion else 0 end;
    v_left := v_on_hand - v_base_qty;
    if v_left > 0.0005 and v_base_rate > 0 and coalesce(v_item.cost_price, 0) > 0 then
      v_revised := round((v_on_hand * v_item.cost_price - v_base_qty * v_base_rate) / v_left, 4);
      if v_revised > 0 then
        update items set cost_price = v_revised where id = v_item.id;
      end if;
    end if;
    v_item_state := app_private.item_state(v_item.id);
  end if;

  if v_full then
    v_new_details := v_det || jsonb_build_object(
      'returned', true,
      'return_reason', v_reason,
      'returned_at', v_now,
      'returned_quantity', round(coalesce(app_private.jnum(v_det -> 'returned_quantity'), 0) + v_qty, 3),
      'original_quantity', coalesce(v_det -> 'original_intake_quantity', v_det -> 'original_quantity', to_jsonb(v_total_qty)),
      'original_intake_quantity', coalesce(v_det -> 'original_intake_quantity', v_det -> 'original_quantity', to_jsonb(v_total_qty)),
      'original_paid_amount', coalesce(v_det -> 'original_paid_amount', to_jsonb(v_orig_paid)),
      'paid_amount', v_remaining_paid,
      'cash_refund', round(coalesce(app_private.jnum(v_det -> 'cash_refund'), 0) + v_cash_refund, 2),
      'return_ids', coalesce(v_det -> 'return_ids', '[]'::jsonb) || to_jsonb(p_return_id)
    );
    if v_account_id is not null then v_new_details := v_new_details || jsonb_build_object('account_id', v_account_id); end if;
    update material_purchases set status = 'Returned', details = v_new_details where id = p_purchase_id
    returning * into v_mp;
  else
    v_new_details := v_det || jsonb_build_object(
      'partial_returned', true,
      'returned_quantity', round(coalesce(app_private.jnum(v_det -> 'returned_quantity'), 0) + v_qty, 3),
      'original_quantity', coalesce(v_det -> 'original_intake_quantity', v_det -> 'original_quantity', to_jsonb(v_total_qty)),
      'original_intake_quantity', coalesce(v_det -> 'original_intake_quantity', v_det -> 'original_quantity', to_jsonb(v_total_qty)),
      'return_reason', v_reason,
      'base_quantity', round(v_remaining_qty * v_conversion, 3),
      'returned_at', v_now,
      'original_paid_amount', coalesce(v_det -> 'original_paid_amount', to_jsonb(v_orig_paid)),
      'paid_amount', v_remaining_paid,
      'due_amount', round(greatest(0, v_remaining_amount - v_remaining_paid), 2),
      'cash_refund', round(coalesce(app_private.jnum(v_det -> 'cash_refund'), 0) + v_cash_refund, 2),
      'return_ids', coalesce(v_det -> 'return_ids', '[]'::jsonb) || to_jsonb(p_return_id)
    );
    if v_account_id is not null then v_new_details := v_new_details || jsonb_build_object('account_id', v_account_id); end if;
    update material_purchases
    set quantity = v_remaining_qty, total_amount = v_remaining_amount, status = 'Completed', details = v_new_details
    where id = p_purchase_id
    returning * into v_mp;
  end if;

  if v_cash_refund > 0 then
    -- Only cash coming back into the open drawer belongs to that shift's count.
    v_in_drawer := v_account_id = any(array(select jsonb_array_elements_text(coalesce(p_payload -> 'drawer_account_ids', '[]'::jsonb))));
    perform app_private.post_bank_tx(
      'btx_mpret_' || p_return_id, v_account_id, 'Income', v_cash_refund, v_now, 'Purchase Return',
      'Material Return Cash Refund: ' || coalesce(v_mp.item_name, '') || ' (' || v_qty || ' ' || coalesce(v_mp.unit, '') || ')',
      v_mp.id,
      p_payload ->> 'business_day_id',
      case when v_in_drawer then p_payload ->> 'shift_session_id' end,
      case when v_in_drawer then p_payload ->> 'drawer_id' end,
      p_payload ->> 'cashier_id'
    );
  end if;

  v_credit := round(greatest(0, v_return_amount - v_cash_refund), 2);
  if v_mp.supplier_id is not null then
    select * into v_supplier from suppliers where id = v_mp.supplier_id for update;
    v_has_supplier := found;
  end if;
  if v_has_supplier then
    if v_credit > 0 then
      v_supplier_balance := public.adjust_supplier_balance(v_supplier.id, -v_credit);
    else
      v_supplier_balance := v_supplier.balance;
    end if;
    insert into supplier_transactions (id, supplier_id, date, type, amount, details)
    values (
      'stx_mpret_' || p_return_id, v_supplier.id, v_now, 'Return', v_return_amount,
      jsonb_build_object(
        'note', case when v_full then 'Full' else 'Partial' end || ' Material Return: ' || v_qty || ' ' || coalesce(v_mp.unit, '')
                || ' of ' || coalesce(v_mp.item_name, '') || ' (' || v_reason || ')'
                || case when v_cash_refund > 0 then ' (Cash Refunded: Rs ' || v_cash_refund || ')' else '' end,
        'purchase_id', v_mp.id,
        'cash_refund', v_cash_refund,
        'account_id', v_account_id
      )
    );
  end if;

  return jsonb_build_object(
    'applied', true,
    'purchase_id', p_purchase_id,
    'row', to_jsonb(v_mp),
    'status', v_mp.status,
    'is_full', v_full,
    'return_qty', v_qty,
    'return_amount', v_return_amount,
    'cash_refund', v_cash_refund,
    'supplier_credit', case when v_has_supplier then v_credit else 0 end,
    'supplier_id', case when v_has_supplier then v_supplier.id end,
    'supplier_balance', v_supplier_balance,
    'account_id', v_account_id,
    'remaining_qty', v_remaining_qty,
    'remaining_amount', v_remaining_amount,
    'remaining_paid', v_remaining_paid,
    'item', v_item_state
  );
end;
$$;

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
  perform app_private.assert_can('purchase', 'delete', 'return milk');
  if nullif(p_return_id, '') is null then raise exception 'return id is required.'; end if;
  if v_refund_as not in ('cash', 'khata') then raise exception 'Refund method is not valid.'; end if;

  select * into v_pur from purchases where id = p_purchase_id for update;
  if not found then raise exception 'Purchase not found. Reload the page.'; end if;
  v_det := coalesce(v_pur.details, '{}'::jsonb);
  if coalesce(v_det->'return_ids', '[]'::jsonb) ? p_return_id then
    return jsonb_build_object('already_applied', true, 'purchase_id', p_purchase_id, 'status', v_pur.status,
      'remaining_qty', v_pur.quantity, 'remaining_amount', v_pur.total_amount, 'details', v_det);
  end if;
  if v_pur.status = 'Returned' then raise exception 'This purchase has already been fully returned.'; end if;

  perform app_private.assert_books_open(v_now, p_payload->>'business_day_id');
  if v_reason = 'Deleted by user' then
    perform app_private.assert_books_open(v_pur.date, null);
  end if;

  v_total_qty := round(coalesce(v_pur.quantity, 0), 3);
  if v_req_qty is not null and (v_req_qty <= 0 or v_req_qty > v_total_qty + 0.0005) then
    raise exception 'Return quantity must be more than 0 and at most % L.', v_total_qty;
  end if;
  v_qty := least(coalesce(v_req_qty, v_total_qty), v_total_qty);
  if v_qty <= 0 then raise exception 'This entry has no milk left to return.'; end if;
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
      raise exception '% L cannot be returned: only % L is left (% L already went to processing).',
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

create or replace function public.settle_supplier_balance(p_supplier_id text, p_settle_id text, p_deactivate boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sup suppliers;
  v_bal numeric;
  v_now timestamptz := now();
  v_tx_id text := 'stx_wo_' || p_settle_id;
  v_kind text := 'none';
begin
  perform app_private.assert_can('suppliers', 'delete', 'settle / archive a supplier balance');
  if nullif(p_settle_id, '') is null then raise exception 'settle id is required.'; end if;

  select * into v_sup from suppliers where id = p_supplier_id for update;
  if not found then raise exception 'Supplier not found. Reload the page.'; end if;
  if exists (select 1 from supplier_transactions where id = v_tx_id) then
    return jsonb_build_object('already_applied', true, 'supplier_id', p_supplier_id, 'balance', v_sup.balance, 'is_active', v_sup.is_active);
  end if;

  v_bal := round(coalesce(v_sup.balance, 0), 2);
  if abs(v_bal) >= 0.01 then
    perform app_private.assert_books_open(v_now, null);
    -- We owe (bal > 0): a waiver Payment settles the ledger with no money leaving an account
    -- (waiver: true keeps it out of the cash-paid register and of any reversal on delete).
    -- The supplier holds our advance (bal < 0): it is written off with a Charge.
    v_kind := case when v_bal > 0 then 'waiver' else 'advance_written_off' end;
    insert into supplier_transactions (id, supplier_id, date, type, amount, details)
    values (
      v_tx_id, p_supplier_id, v_now, case when v_bal > 0 then 'Payment' else 'Charge' end, abs(v_bal),
      case when v_bal > 0
        then jsonb_build_object('mode', 'Supplier Waiver / Discount', 'note', 'Payable balance settled via discount waiver prior to vendor archival', 'waiver', true)
        else jsonb_build_object('mode', 'Advance Written Off', 'note', 'Unrecovered advance written off prior to supplier archival', 'waiver', true)
      end
    );
    perform public.adjust_supplier_balance(p_supplier_id, -v_bal);
  end if;

  if coalesce(p_deactivate, true) then
    update suppliers set is_active = false where id = p_supplier_id;
  end if;

  return jsonb_build_object(
    'applied', true,
    'supplier_id', p_supplier_id,
    'kind', v_kind,
    'settled', v_bal,
    'balance', (select balance from suppliers where id = p_supplier_id),
    'is_active', not coalesce(p_deactivate, true) and coalesce(v_sup.is_active, true)
  );
end;
$$;

create or replace function public.take_counter_milk(p_request_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dest text := coalesce(nullif(btrim(coalesce(p_payload ->> 'destination', '')), ''), 'Production');
  v_lines jsonb := p_payload -> 'lines';
  v_line jsonb;
  v_item items;
  v_qty numeric;
  v_unit text;
  v_stock_qty numeric;
  v_need jsonb := '{}'::jsonb;
  v_key text;
  v_entry jsonb;
  v_idx int := 0;
  v_items jsonb := '{}'::jsonb;
begin
  perform app_private.assert_can('allocation', 'create', 'allocate counter milk');
  if nullif(p_request_id, '') is null then raise exception 'request id is required.'; end if;
  if jsonb_typeof(v_lines) is distinct from 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'The allocation has no lines.';
  end if;

  perform pg_advisory_xact_lock(hashtext('take_counter_milk:' || p_request_id));
  if exists (select 1 from inventory_logs where id = 'log_alloc_ret_' || p_request_id || '_1') then
    return jsonb_build_object('already_applied', true);
  end if;

  -- Every line in the item's own unit, summed per item, before anything moves.
  for v_line in select value from jsonb_array_elements(v_lines) loop
    select * into v_item from items where id = v_line ->> 'item_id' for update;
    if not found then raise exception 'Counter item "%" not found. Reload the page.', v_line ->> 'item_id'; end if;
    v_qty := round(app_private.jnum(v_line -> 'quantity'), 3);
    if v_qty is null or v_qty <= 0 then raise exception '%: quantity must be more than 0.', v_item.name; end if;
    v_unit := coalesce(nullif(btrim(v_line ->> 'unit'), ''), 'L');
    v_stock_qty := app_private.convert_qty(v_qty, v_unit, coalesce(nullif(btrim(v_item.unit), ''), v_unit));
    if v_stock_qty is null then
      raise exception '%: % cannot be converted to %. This item cannot be allocated here.', v_item.name, v_unit, v_item.unit;
    end if;
    v_entry := coalesce(v_need -> v_item.id, jsonb_build_object('qty', 0, 'litres', 0));
    v_need := v_need || jsonb_build_object(v_item.id, jsonb_build_object(
      'qty', round((v_entry ->> 'qty')::numeric + v_stock_qty, 3),
      'litres', round((v_entry ->> 'litres')::numeric + coalesce(app_private.convert_qty(v_qty, v_unit, 'L'), v_qty), 3)
    ));
  end loop;

  for v_key, v_entry in select key, value from jsonb_each(v_need) order by key loop
    select * into v_item from items where id = v_key;
    if round(coalesce(v_item.stock, 0), 3) + 0.001 < (v_entry ->> 'qty')::numeric then
      raise exception '%: only % % in stock, so % cannot be allocated.', v_item.name, round(coalesce(v_item.stock, 0), 3), coalesce(v_item.unit, ''), v_entry ->> 'qty';
    end if;
  end loop;

  for v_key, v_entry in select key, value from jsonb_each(v_need) order by key loop
    v_idx := v_idx + 1;
    perform app_private.move_item_stock(
      v_key, -(v_entry ->> 'qty')::numeric, '{}'::jsonb,
      'log_alloc_ret_' || p_request_id || '_' || v_idx,
      now(),
      'Allocation',
      'Leftover Milk Allocated to ' || v_dest,
      jsonb_build_object('litres', -(v_entry ->> 'litres')::numeric, 'request_id', p_request_id)
    );
    v_items := v_items || jsonb_build_object(v_key, app_private.item_state(v_key));
  end loop;

  return jsonb_build_object('applied', true, 'items', v_items);
end;
$$;

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
    raise exception 'Transfer amount must be more than 0.';
  end if;
  if p_from_id = p_to_id then
    raise exception 'Source and destination accounts must be different.';
  end if;

  -- Lock both rows in a stable order to avoid deadlocks
  perform 1 from financial_accounts
  where id in (least(p_from_id, p_to_id), greatest(p_from_id, p_to_id))
  order by id
  for update;

  update financial_accounts set balance = round(balance - v_amount, 2)
  where id = p_from_id;
  if not found then raise exception 'Source account not found.'; end if;

  update financial_accounts set balance = round(balance + v_amount, 2)
  where id = p_to_id;
  if not found then raise exception 'Destination account not found.'; end if;

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

create or replace function public.update_expense(p_expense_id text, p_edit_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exp expenses;
  v_old jsonb;
  v_old_amount numeric;
  v_old_paid numeric;
  v_old_vendor text;
  v_btx record;
  v_shift_status text;

  v_date timestamptz := coalesce(nullif(p_payload->>'date', '')::timestamptz, now());
  v_category text := coalesce(nullif(p_payload->>'category', ''), 'General');
  v_amount numeric := round(coalesce((p_payload->>'amount')::numeric, 0), 2);
  v_status text := nullif(p_payload->>'payment_status', '');
  v_paid numeric;
  v_description text := coalesce(p_payload->>'description', '');
  v_account_id text := nullif(p_payload->>'account_id', '');
  v_vendor_id text := nullif(p_payload->>'vendor_id', '');
  v_vendor_name text := nullif(p_payload->>'vendor_name', '');
  v_details jsonb;
  v_btx_id text := 'btx_' || p_expense_id;
begin
  perform app_private.assert_can('expenses', 'edit', 'edit an expense');
  if nullif(p_expense_id, '') is null then raise exception 'expense id is required.'; end if;
  if nullif(p_edit_id, '') is null then raise exception 'edit id is required.'; end if;

  select * into v_exp from expenses where id = p_expense_id for update;
  if not found then raise exception 'Expense not found. Reload the page.'; end if;

  v_old := coalesce(v_exp.details, '{}'::jsonb);
  if coalesce(v_old->'edit_ids', '[]'::jsonb) ? p_edit_id then
    return jsonb_build_object('already_applied', true, 'expense_id', p_expense_id,
      'date', v_exp.date, 'amount', v_exp.amount, 'paid_amount', v_old->'paid_amount',
      'payment_status', v_old->>'payment_status', 'details', v_old);
  end if;

  if v_exp.shift_session_id is not null then
    select status into v_shift_status from cash_shifts where id = v_exp.shift_session_id;
    if v_shift_status in ('Closed', 'Force Closed') then
      raise exception 'This expense is from a closed shift and the drawer is already counted. Add a reversing entry instead of editing.';
    end if;
  end if;
  perform app_private.assert_books_open(v_exp.date, v_exp.business_day_id);
  perform app_private.assert_books_open(v_date, null);

  if v_amount < 0 then raise exception 'Expense amount cannot be negative.'; end if;
  v_paid := case when lower(coalesce(v_status, '')) = 'unpaid' then 0
                 else round(coalesce(nullif(p_payload->>'paid_amount', '')::numeric, v_amount), 2) end;
  if v_paid < 0 or v_paid > v_amount + 0.01 then
    raise exception 'Paid amount (Rs %) cannot be negative or more than the expense (Rs %).', v_paid, v_amount;
  end if;
  v_paid := least(v_paid, v_amount);
  v_status := case when v_paid <= 0 then 'Unpaid' when v_paid < v_amount then 'Partial' else 'Paid' end;
  -- A paid voucher with no account (a bad-debt write-off, an old entry) moves no money, as when it
  -- was recorded by record_expense_effects.
  if v_vendor_id is not null and not exists (select 1 from expense_vendors where id = v_vendor_id) then
    raise exception 'Vendor not found.';
  end if;

  -- 1. Undo the old payment from the ledger rows that exist for this voucher.
  for v_btx in
    select id from bank_transactions
    where id = v_btx_id or reference_id = p_expense_id
    order by id
    for update
  loop
    perform app_private.reverse_bank_tx(v_btx.id);
  end loop;

  -- 2. Undo the old vendor figures (the same figures the loader shows for the old voucher).
  v_old_amount := round(coalesce(v_exp.amount, (v_old->>'amount')::numeric, 0), 2);
  v_old_paid := case
    when lower(coalesce(v_old->>'payment_status', v_old->>'paymentStatus', '')) = 'unpaid' then 0
    else round(coalesce((v_old->>'paid_amount')::numeric, (v_old->>'paidAmount')::numeric, v_old_amount), 2)
  end;
  v_old_vendor := nullif(v_old->>'vendor_id', '');
  if v_old_vendor is not null then
    perform public.adjust_expense_vendor_stats(v_old_vendor, -greatest(0, v_old_amount - v_old_paid), -v_old_amount, -v_old_paid);
  end if;

  -- 3. Save the edit. The camelCase copies an older client wrote are dropped so the loader cannot
  --    read a stale paidAmount; the shift tags stay the voucher's own.
  v_details := (v_old - 'paidAmount' - 'paymentStatus' - 'edit_ids')
    || (coalesce(p_payload, '{}'::jsonb) - 'expense_id' - 'edit_ids' - 'paidAmount' - 'paymentStatus'
        - 'business_day_id' - 'shift_session_id' - 'drawer_id' - 'cashier_id')
    || jsonb_build_object(
         'expense_id', p_expense_id,
         'date', v_date,
         'category', v_category,
         'amount', v_amount,
         'paid_amount', v_paid,
         'payment_status', v_status,
         'description', v_description,
         'account_id', case when v_paid > 0 then v_account_id end,
         'account_name', case when v_paid > 0 then p_payload->>'account_name' end,
         'vendor_id', v_vendor_id,
         'vendor_name', v_vendor_name,
         'business_day_id', v_exp.business_day_id,
         'shift_session_id', v_exp.shift_session_id,
         'drawer_id', v_exp.drawer_id,
         'cashier_id', v_exp.cashier_id,
         'edit_ids', coalesce(v_old->'edit_ids', '[]'::jsonb) || to_jsonb(p_edit_id),
         'edited_at', now()
       );

  update expenses
  set date = v_date,
      category = v_category,
      amount = v_amount,
      description = v_description,
      details = v_details
  where id = p_expense_id;

  -- 4. New vendor figures and payment.
  if v_vendor_id is not null then
    perform public.adjust_expense_vendor_stats(v_vendor_id, greatest(0, v_amount - v_paid), v_amount, v_paid);
  end if;
  if v_paid > 0 and v_account_id is not null then
    perform app_private.post_bank_tx(
      v_btx_id, v_account_id, 'Expense', v_paid, v_date, v_category,
      'Expense: ' || v_description || coalesce(' (' || v_vendor_name || ')', ''),
      p_expense_id, v_exp.business_day_id, v_exp.shift_session_id, v_exp.drawer_id, v_exp.cashier_id
    );
  end if;

  return jsonb_build_object(
    'applied', true,
    'expense_id', p_expense_id,
    'date', v_date,
    'amount', v_amount,
    'paid_amount', v_paid,
    'payment_status', v_status,
    'details', v_details
  );
end;
$$;

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
      raise exception 'Rs % advance is already in the customer ledger. Refund it from the customer ledger instead of lowering it here.', old.advance_posted;
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

create or replace function public.write_off_customer_balance(p_customer_id text, p_write_off_id text, p_deactivate boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cust customers;
  v_bal numeric;
  v_now timestamptz := now();
  v_tx_id text := 'ctx_wo_' || p_write_off_id;
  v_kind text := 'none';
begin
  perform app_private.assert_can('customers', 'delete', 'archive / write off a customer');
  if nullif(p_write_off_id, '') is null then raise exception 'write-off id is required.'; end if;

  select * into v_cust from customers where id = p_customer_id for update;
  if not found then raise exception 'Customer not found. Reload the page.'; end if;
  if exists (select 1 from customer_transactions where id = v_tx_id) then
    return jsonb_build_object('already_applied', true, 'customer_id', p_customer_id, 'balance', v_cust.balance, 'is_active', v_cust.is_active);
  end if;

  v_bal := round(coalesce(v_cust.balance, 0), 2);
  if abs(v_bal) >= 0.01 then
    perform app_private.assert_books_open(v_now, null);
  end if;

  if v_bal >= 0.01 then
    -- The customer owes us: the ledger is cleared and the loss is a non-cash bad-debt expense
    -- (settled in full, no account), so the balance sheet still balances.
    v_kind := 'bad_debt';
    insert into customer_transactions (id, customer_id, date, type, amount, details)
    values (v_tx_id, p_customer_id, v_now, 'Payment', v_bal, jsonb_build_object(
      'mode', 'Bad Debt Write-Off',
      'note', 'Balance written off as bad debt expense (Customer Archived)',
      'is_write_off', true
    ));
    insert into expenses (id, date, category, amount, description, details)
    values (
      'exp_wo_' || p_write_off_id, v_now, 'Bad Debt & Write-off', v_bal,
      'Bad debt write-off for customer: ' || coalesce(v_cust.name, p_customer_id),
      jsonb_build_object(
        'expense_id', 'exp_wo_' || p_write_off_id, 'customer_id', p_customer_id, 'write_off', true,
        'amount', v_bal, 'paid_amount', v_bal, 'payment_mode', 'Adjustment', 'payment_status', 'Paid',
        'category', 'Bad Debt & Write-off', 'description', 'Bad debt write-off for customer: ' || coalesce(v_cust.name, p_customer_id)
      )
    );
    perform public.adjust_customer_balance(p_customer_id, -v_bal);
  elsif v_bal <= -0.01 then
    -- An unclaimed advance we hold is forfeited.
    v_kind := 'advance_forfeit';
    insert into customer_transactions (id, customer_id, date, type, amount, details)
    values (v_tx_id, p_customer_id, v_now, 'Charge', abs(v_bal), jsonb_build_object(
      'mode', 'Advance Forfeited',
      'note', 'Unclaimed customer advance forfeited upon archival',
      'is_write_off', true
    ));
    perform public.adjust_customer_balance(p_customer_id, abs(v_bal));
  end if;

  if coalesce(p_deactivate, true) then
    update customers set is_active = false where id = p_customer_id;
  end if;

  return jsonb_build_object(
    'applied', true,
    'customer_id', p_customer_id,
    'kind', v_kind,
    'written_off', v_bal,
    'balance', (select balance from customers where id = p_customer_id),
    'is_active', not coalesce(p_deactivate, true) and coalesce(v_cust.is_active, true)
  );
end;
$$;
