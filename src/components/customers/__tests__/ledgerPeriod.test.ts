import { describe, expect, it } from 'vitest';
import type { Customer, CustomerTransaction } from '../../../types';
import { buildLedger, ledgerForPeriod } from '../customerUtils';

const customer = { id: 'c1', name: 'Bashir', balance: 900 } as Customer;
const tx = (id: string, date: string, type: string, amount: number) =>
  ({ id, customer_id: 'c1', date, type, amount } as unknown as CustomerTransaction);

// Balance after each entry: 1000, 700, 1200, 900.
const { entries } = buildLedger(customer, [], [
  tx('a', '2026-09-20', 'Charge', 1000),
  tx('b', '2026-09-28', 'Payment', 300),
  tx('c', '2026-10-05', 'Charge', 500),
  tx('d', '2026-10-31', 'Payment', 300),
], new Map(), false);

describe('ledgerForPeriod', () => {
  it('keeps everything when no duration is chosen', () => {
    const period = ledgerForPeriod(entries, '', '');
    expect(period.entries).toHaveLength(4);
    expect(period.openingBalance).toBe(0);
    expect(period.closingBalance).toBe(900);
  });

  it('carries the balance from before the duration in as the opening balance', () => {
    const period = ledgerForPeriod(entries, '2026-10-01', '2026-10-31');
    expect(period.entries.map(e => e.id)).toEqual(['d', 'c']);
    expect(period.openingBalance).toBe(700);
    expect(period.totalDebit).toBe(500);
    expect(period.totalCredit).toBe(300);
    expect(period.closingBalance).toBe(900);
  });

  it('includes both end days, and stops at the last day', () => {
    const period = ledgerForPeriod(entries, '2026-09-28', '2026-10-05');
    expect(period.entries.map(e => e.id)).toEqual(['c', 'b']);
    expect(period.openingBalance).toBe(1000);
    expect(period.closingBalance).toBe(1200);
  });

  it('shows only the carried balance for a duration with no entries', () => {
    const period = ledgerForPeriod(entries, '2026-10-10', '2026-10-20');
    expect(period.entries).toHaveLength(0);
    expect(period.openingBalance).toBe(1200);
    expect(period.closingBalance).toBe(1200);
  });

  it('opens at zero before the first entry', () => {
    const period = ledgerForPeriod(entries, '2026-01-01', '2026-09-20');
    expect(period.openingBalance).toBe(0);
    expect(period.closingBalance).toBe(1000);
  });

  it('agrees with the running balance of the last entry in the duration', () => {
    const period = ledgerForPeriod(entries, '2026-09-25', '2026-10-05');
    expect(period.closingBalance).toBe(period.entries[0].runningBalance);
  });
});
