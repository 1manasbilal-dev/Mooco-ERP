-- Lock Day in one transaction (2026-10-23).
-- Requires 20261023110000_money_rpc_helpers.sql.
--
-- Before: closeBusinessDay checked readiness on the screen's copy of shifts / remittances /
-- handovers / differences, set the day Closed, then auto-accepted the pending drawer handovers and
-- wrote the end-of-day snapshot in two more calls. A failure after the first call left a locked day
-- with handovers still pending (blocking the next day's opening) or no Z-report; a shift opened on
-- another counter after the screen loaded was not seen at all.
--
-- close_business_day locks the day row, re-checks readiness on the server, closes the day, and only
-- then (same transaction) accepts the pending handovers and writes the snapshot. A second call on a
-- closed day returns already_closed. Needs the Cash Control approver right (the client's
-- canApproveCashControl).

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
    raise exception 'Din band karne ki ijazat sirf manager / owner ko hai.' using errcode = '42501';
  end if;

  select * into v_day from business_days where id = p_business_day_id for update;
  if not found then raise exception 'Business day nahi mila. Page reload karein.'; end if;
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
    raise exception 'Din abhi band nahi ho sakta: % shift, % remittance, % disputed handover, % difference baqi hai.',
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

revoke all on function public.close_business_day(text, jsonb) from public, anon;
grant execute on function public.close_business_day(text, jsonb) to authenticated, service_role;
