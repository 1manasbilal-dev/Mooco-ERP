import { useCallback, useMemo, useRef, useState } from 'react';
import { useDairy } from '../../context/DairyContext';
import { useLatest } from './cashFormat';

/**
 * getShiftTotals is a new function on every provider render, so memoising on it would recompute
 * on every keystroke anywhere in the app. `version` changes only when data the totals read
 * changes; memos depend on it and call the stable `getTotals`.
 */
export function useShiftTotals() {
  const {
    getShiftTotals, sales, shiftSessions, shiftCashEvents, customerTransactions, dailySupplyEntries, bankTransactions,
    expenses, purchases, materialPurchases, suppliers, expenseVendorTransactions, accounts, cashDrawers,
  } = useDairy();
  const latest = useLatest(getShiftTotals);
  const version = useMemo(
    () => [sales, shiftSessions, shiftCashEvents, customerTransactions, dailySupplyEntries, bankTransactions, expenses, purchases, materialPurchases, suppliers, expenseVendorTransactions, accounts, cashDrawers],
    [sales, shiftSessions, shiftCashEvents, customerTransactions, dailySupplyEntries, bankTransactions, expenses, purchases, materialPurchases, suppliers, expenseVendorTransactions, accounts, cashDrawers],
  );
  const getTotals = useCallback((shiftId: string) => latest.current(shiftId), [latest]);
  return { version, getTotals };
}

/** Custody rows store a cash_drawers id or the Bank & Cash account id; resolve the account and a label. */
export function useDrawerLookup() {
  const { accounts, cashDrawers } = useDairy();
  const accountOf = useCallback((drawerId?: string | null) => {
    if (!drawerId) return undefined;
    const direct = accounts.find(item => item.id === drawerId);
    if (direct) return direct;
    const drawer = cashDrawers.find(item => item.id === drawerId);
    return drawer?.account_id ? accounts.find(item => item.id === drawer.account_id) : undefined;
  }, [accounts, cashDrawers]);
  const nameOf = useCallback((drawerId?: string | null) => {
    if (!drawerId) return 'Drawer';
    return accountOf(drawerId)?.name || cashDrawers.find(item => item.id === drawerId)?.name || drawerId;
  }, [accountOf, cashDrawers]);
  return { accountOf, nameOf };
}

export type RunAction =(key: string, operation: () => Promise<boolean>) => Promise<boolean>;

/**
 * One money action at a time for the whole screen. The ref lock closes the gap between a click and
 * React re-rendering the button as disabled, so a fast double click can never submit twice.
 */
export function useCashAction() {
  const lock = useRef(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const run = useCallback<RunAction>(async (key, operation) => {
    if (lock.current) return false;
    lock.current = true;
    setBusyKey(key);
    try {
      return await operation();
    } catch (error) {
      console.error('[Cash Control]', error);
      return false;
    } finally {
      lock.current = false;
      setBusyKey(null);
    }
  }, []);
  return { run, busyKey };
}
