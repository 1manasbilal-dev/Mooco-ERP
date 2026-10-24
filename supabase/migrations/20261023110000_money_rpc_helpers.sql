-- Shared helpers for the all-or-nothing money RPCs that follow (20261023111000 .. 20261023119000).
--
-- Why: several money flows still ran 2-4 separate writes from the browser (balance, ledger row,
-- khata, voucher). A crash or network drop in the middle left the books half-posted, and the
-- client's undo steps could fail too. Each flow now runs in one Postgres function; these helpers
-- are what they share:
--
--   * bank_tx_sign / post_bank_tx / reverse_bank_tx: move financial_accounts.balance and write (or
--     remove) the matching bank_transactions row in the caller's transaction. Unlike
--     adjust_account_balance, a missing account raises instead of silently updating nothing.
--   * post_manual_account: a Chart of Accounts (manual_accounts) posting as a delta on the locked
--     row, with the normal-balance rule the client used (Liability / Equity / Income rise on a
--     credit). Writing "screen balance + change" from the browser lost postings made elsewhere.
--   * assert_books_open: refuses a posting dated inside the closed books (app_settings.security
--     lockDate, the client's isPeriodLocked) or on a locked business day (status 'Closed', the
--     client's isDayLocked). Dates are Pakistan business dates.
--   * can_perform / assert_can / can_approve_cash: the client's canPerform and
--     canApproveCashControl rules for the operator behind the request's JWT. Role rights were
--     UI-only; the new RPCs now check them too. A service_role call or a direct database session
--     (no JWT at all) is trusted.
--
-- app_private is not exposed by the Data API. The posting helpers are only called from SECURITY
-- DEFINER RPCs and are not executable by anon or authenticated.

create schema if not exists app_private;

-- Signed effect of a ledger row on its account. Unknown types raise, so a typo cannot post 0.
create or replace function app_private.bank_tx_sign(p_type text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_type in ('Income', 'Deposit', 'Transfer_In') then return 1; end if;
  if p_type in ('Expense', 'Withdrawal', 'Transfer_Out') then return -1; end if;
  raise exception 'Bank transaction type "%" ghalat hai.', p_type;
end;
$$;

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
    raise exception 'Books % tak band hain. Is tareekh (%) ki entry add, edit ya delete nahi ho sakti.',
      v_lock, to_char(v_date, 'DD-Mon-YYYY') using errcode = 'P0001';
  end if;
  if exists (select 1 from public.business_days d where d.business_date = v_date and d.status = 'Closed') then
    raise exception 'Din % band (locked) hai. Band din mein raqam ki entry nahi ho sakti; pehle din dobara kholein.',
      to_char(v_date, 'DD-Mon-YYYY');
  end if;
  if nullif(p_business_day_id, '') is not null
     and exists (select 1 from public.business_days d where d.id = p_business_day_id and d.status = 'Closed') then
    raise exception 'Ye entry band (locked) business day ki hai. Pehle din dobara kholein.';
  end if;
end;
$$;

-- Moves the account balance and writes the matching ledger row. Returns the new balance.
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
  if nullif(p_btx_id, '') is null then raise exception 'Bank entry ki id zaroori hai.'; end if;
  if v_amount is null or v_amount <= 0 or v_amount = 'NaN'::numeric then
    raise exception 'Raqam 0 se zyada honi chahiye.';
  end if;
  if nullif(p_account_id, '') is null then raise exception 'Payment account nahi chuna gaya.'; end if;

  update public.financial_accounts
  set balance = round(coalesce(balance, 0) + app_private.bank_tx_sign(p_type) * v_amount, 2)
  where id = p_account_id
  returning balance into v_balance;
  if not found then
    raise exception 'Account "%" nahi mila. Bank & Cash mein account check karein.', p_account_id;
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

-- Undoes one ledger row: puts its effect back on the account and deletes it.
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
      raise exception 'Account "%" nahi mila; purani entry wapas nahi ho saki.', v_row.account_id;
    end if;
  end if;
  delete from public.bank_transactions where id = p_btx_id;
end;
$$;

-- One Chart of Accounts posting. Returns the new balance.
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
    raise exception 'Chart of Accounts mein account "%" nahi mila.', p_account_id;
  end if;
  if v_type in ('Liability', 'Equity', 'Income') then v_net := -v_net; end if;
  update public.manual_accounts
  set balance = round(coalesce(balance, 0) + v_net, 2)
  where id = p_account_id
  returning balance into v_balance;
  return v_balance;
end;
$$;

-- The client's canPerform(module, action) for the signed-in operator.
create or replace function app_private.can_perform(p_module text, p_action text default 'view')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select u.role_id,
           case when jsonb_typeof(u.permissions) = 'array' then u.permissions else '[]'::jsonb end as up,
           case when jsonb_typeof(r.permissions) = 'array' then r.permissions else '[]'::jsonb end as rp
    from public.app_users u
    left join public.app_roles r on r.id = u.role_id
    where u.auth_user_id = auth.uid()
      and u.is_active is not false
    limit 1
  )
  select coalesce((
    select case
      when role_id = 'role_super_admin' then true
      when up ? (p_module || ':' || p_action) or rp ? (p_module || ':' || p_action) then true
      when up ? p_module then true
      when p_action = 'view' and exists (
        select 1 from jsonb_array_elements_text(up || rp) p(perm)
        where left(p.perm, length(p_module) + 1) = p_module || ':'
      ) then true
      when p_module = 'cash_control' and (up ? 'retail_stock' or rp ? 'retail_stock') then p_action = 'view'
      else rp ? p_module
    end
    from me
  ), false)
$$;

-- A service_role call or a direct database session (no JWT) is trusted; everyone else must be an
-- active operator holding the right.
create or replace function app_private.is_trusted_caller()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
      or (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = ''
          and nullif(current_setting('request.jwt.claim.sub', true), '') is null)
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
    raise exception 'Login zaroori hai. Dobara sign in karein.' using errcode = '42501';
  end if;
  if not app_private.can_perform(p_module, p_action) then
    raise exception 'Aap ko % ki ijazat nahi hai.', p_what using errcode = '42501';
  end if;
end;
$$;

-- The client's canApproveCashControl: the Manager role, or whoever may approve in Cash Control.
create or replace function app_private.can_approve_cash()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_trusted_caller()
      or app_private.current_role_id() = 'role_manager'
      or app_private.can_perform('cash_control', 'approve')
$$;

revoke all on function app_private.bank_tx_sign(text) from public, anon, authenticated;
revoke all on function app_private.assert_books_open(timestamptz, text) from public, anon, authenticated;
revoke all on function app_private.post_bank_tx(text, text, text, numeric, timestamptz, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function app_private.reverse_bank_tx(text) from public, anon, authenticated;
revoke all on function app_private.post_manual_account(text, numeric, numeric) from public, anon, authenticated;
revoke all on function app_private.can_perform(text, text) from public, anon;
revoke all on function app_private.is_trusted_caller() from public, anon;
revoke all on function app_private.assert_can(text, text, text) from public, anon, authenticated;
revoke all on function app_private.can_approve_cash() from public, anon;
grant execute on function app_private.can_perform(text, text) to authenticated, service_role;
grant execute on function app_private.is_trusted_caller() to authenticated, service_role;
grant execute on function app_private.can_approve_cash() to authenticated, service_role;
