import { supabase } from './supabase';
import { roundCurrency, roundQuantity } from './db';

/**
 * Atomic server-side balance/stock mutations.
 *
 * Every function here maps to a Postgres function (see
 * supabase/migrations/*_atomic_financial_ops.sql) that applies a DELTA to the
 * row with UPDATE ... RETURNING. This removes the lost-update race of the old
 * "SELECT balance -> compute in browser -> UPDATE balance" pattern when two
 * devices (or the POS background sync) touch the same row.
 *
 * All helpers return the Supabase result so callers can check `error` and use
 * the RETURNED value to reconcile optimistic UI state.
 */

export const adjustAccountBalance = (accountId: string, delta: number) =>
  supabase.rpc('adjust_account_balance', {
    p_account_id: accountId,
    p_delta: roundCurrency(delta)
  });

export const adjustCustomerBalance = (customerId: string, delta: number) =>
  supabase.rpc('adjust_customer_balance', {
    p_customer_id: customerId,
    p_delta: roundCurrency(delta)
  });

export const adjustSupplierBalance = (supplierId: string, delta: number) =>
  supabase.rpc('adjust_supplier_balance', {
    p_supplier_id: supplierId,
    p_delta: roundCurrency(delta)
  });

/**
 * Moves stock piles by a difference (never writes an absolute number). A delta that is not a finite
 * number is refused here: NaN would reach Postgres as null and silently move nothing, or fail the
 * whole call. Packs whose delta rounds to 0 are left out, so they keep their key untouched.
 */
export const adjustItemStock = (
  itemId: string,
  looseDelta: number,
  variantDeltas?: Record<string, number>
) => {
  const deltas = Object.entries(variantDeltas || {});
  if (!Number.isFinite(Number(looseDelta)) || deltas.some(([, v]) => !Number.isFinite(Number(v)))) {
    return Promise.resolve({ data: null, error: new Error('Stock ki tabdeeli ghalat number hai; kuch save nahi hua.') });
  }
  const packs = deltas.map(([k, v]) => [k, roundQuantity(v)] as const).filter(([, v]) => v !== 0);
  return supabase.rpc('adjust_item_stock', {
    p_item_id: itemId,
    p_loose_delta: roundQuantity(looseDelta),
    p_variant_deltas: packs.length ? Object.fromEntries(packs) : null
  });
};

import { normalizeTransactionTimestamp } from './formatters';

export const transferBetweenAccounts = (
  fromAccountId: string,
  toAccountId: string,
  amount: number,
  date?: string,
  reference?: string
) =>
  supabase.rpc('transfer_between_accounts', {
    p_from_id: fromAccountId,
    p_to_id: toAccountId,
    p_amount: roundCurrency(amount),
    p_date: normalizeTransactionTimestamp(date),
    p_category: 'Transfer',
    p_reference: reference || null
  });

export const adjustExpenseVendorStats = (
  vendorId: string,
  pendingDelta: number,
  billedDelta: number,
  paidDelta: number
) =>
  supabase.rpc('adjust_expense_vendor_stats', {
    p_vendor_id: vendorId,
    p_pending_delta: roundCurrency(pendingDelta),
    p_billed_delta: roundCurrency(billedDelta),
    p_paid_delta: roundCurrency(paidDelta)
  });

export const procureMilkIntake = (payload: any) =>
  supabase.rpc('procure_milk_intake_effects', {
    p_payload: payload
  });

export const recordSupplierPaymentEffects = (payload: any) =>
  supabase.rpc('record_supplier_payment_effects', {
    p_payload: payload
  });

export const recordExpenseEffects = (payload: any) =>
  supabase.rpc('record_expense_effects', {
    p_payload: payload
  });

