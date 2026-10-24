import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  balancePhrase,
  buildPaymentRegister,
  buildSupplierStatement,
  formatLedgerDate,
  formatMoney,
  ledgerDay,
  localIsoDate,
  money,
  printWhenReady,
  rangeForPreset,
  rangeLabel,
  type StatementSupplier
} from '../supplierStatement';

const originalTz = process.env.TZ;
afterEach(() => {
  vi.useRealTimers();
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const at = (iso: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
};

describe('money and labels', () => {
  it('rounds to the paisa with halves away from zero', () => {
    expect(money(10.075)).toBe(10.08);
    expect(money(-10.075)).toBe(-10.08);
    expect(money(0.1 + 0.2)).toBe(0.3);
    expect(money(NaN)).toBe(0);
    expect(Object.is(money(-0.004), 0)).toBe(true);
  });

  it('phrases balances as payable, advance or settled', () => {
    expect(formatMoney(-12500.5)).toBe('Rs 12,500.5');
    expect(balancePhrase(12500)).toBe('Rs 12,500 Payable');
    expect(balancePhrase(-800)).toBe('Rs 800 Advance');
    expect(balancePhrase(0.4)).toBe('Rs 0 Settled');
  });

  it('formats ledger dates with and without the weekday', () => {
    expect(formatLedgerDate('2026-10-23')).toBe('23 Oct 2026');
    expect(formatLedgerDate('2026-10-23T10:00:00Z', true)).toBe('Fri, 23 Oct 2026');
    expect(formatLedgerDate('')).toBe('Opening');
    expect(formatLedgerDate('garbage')).toBe('garbage');
    expect(formatMoney(1234567.891)).toBe('Rs 1,234,567.89');
  });

  it('labels ranges', () => {
    expect(rangeLabel('', '')).toBe('All dates');
    expect(rangeLabel('2026-10-01', '2026-10-01')).toBe('01 Oct 2026');
    expect(rangeLabel('2026-10-01', '2026-10-10')).toBe('01 Oct 2026 – 10 Oct 2026');
    expect(rangeLabel('2026-10-01', '')).toBe('From 01 Oct 2026');
    expect(rangeLabel('', '2026-10-10')).toBe('Until 10 Oct 2026');
  });
});

describe('Pakistan days', () => {
  it('puts early-morning UTC timestamps on the right Pakistan day', () => {
    expect(ledgerDay('2026-10-05T20:30:00Z')).toBe('2026-10-06');
    expect(ledgerDay('2026-10-05T18:59:59Z')).toBe('2026-10-05');
    expect(ledgerDay('2026-10-05')).toBe('2026-10-05');
    expect(ledgerDay('')).toBe('');
    expect(ledgerDay(undefined)).toBe('');
  });

  it('dates today by Pakistan time whatever the device zone', () => {
    process.env.TZ = 'UTC';
    at('2026-10-22T20:00:00Z');
    expect(localIsoDate()).toBe('2026-10-23');
    expect(localIsoDate(new Date('2026-10-22T18:00:00Z'))).toBe('2026-10-22');
    expect(localIsoDate(new Date('nope'))).toBe('');
  });
});

describe('rangeForPreset', () => {
  it('builds presets on the Pakistan calendar', () => {
    process.env.TZ = 'America/New_York';
    at('2026-10-22T20:00:00Z'); // Friday 23 Oct, 01:00 in Pakistan; still Thursday 22nd in New York
    expect(rangeForPreset('today')).toEqual({ from: '2026-10-23', to: '2026-10-23' });
    expect(rangeForPreset('week')).toEqual({ from: '2026-10-19', to: '2026-10-23' });
    expect(rangeForPreset('tendays')).toEqual({ from: '2026-10-21', to: '2026-10-31' });
    expect(rangeForPreset('fifteendays')).toEqual({ from: '2026-10-16', to: '2026-10-31' });
    expect(rangeForPreset('month')).toEqual({ from: '2026-10-01', to: '2026-10-23' });
    expect(rangeForPreset('lastmonth')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(rangeForPreset('all')).toEqual({ from: '', to: '' });
  });

  it('handles Sunday, the first ten days and February', () => {
    at('2026-02-08T06:00:00Z'); // Sunday
    expect(rangeForPreset('week')).toEqual({ from: '2026-02-02', to: '2026-02-08' });
    expect(rangeForPreset('tendays')).toEqual({ from: '2026-02-01', to: '2026-02-10' });
    at('2028-02-25T06:00:00Z');
    expect(rangeForPreset('tendays')).toEqual({ from: '2028-02-21', to: '2028-02-29' });
    at('2026-01-15T06:00:00Z');
    expect(rangeForPreset('lastmonth')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(rangeForPreset('fifteendays')).toEqual({ from: '2026-01-01', to: '2026-01-15' });
  });

  it('orders a reversed custom range', () => {
    expect(rangeForPreset('custom', '2026-10-20T10:00:00Z', '2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-10-20' });
    expect(rangeForPreset('custom', '2026-10-01', '')).toEqual({ from: '2026-10-01', to: '' });
  });
});

describe('buildSupplierStatement', () => {
  const supplier = (pendingBalance: number): StatementSupplier => ({ id: 'sup1', name: 'Ali Dairy Farm', phone: '03001234567', pendingBalance });
  const purchases = [
    { id: 'p1', supplier_id: 'sup1', date: '2026-10-01T01:00:00Z', quantity: 100, milk_type: 'Buffalo', shift: 'Morning', rate: 150, total_amount: 15000, paid_amount: 5000, fat: 6.5 },
    { id: 'p2', supplier_id: 'sup1', date: '2026-10-05T20:30:00Z', quantity: 50, milk_type: 'Cow', shift: 'Evening', rate: 150, total_amount: 7500, paid_amount: 0 },
    { id: 'other', supplier_id: 'sup2', date: '2026-10-02', quantity: 10, total_amount: 1500 }
  ];
  const materials = [{ id: 'm1', supplier_id: 'sup1', date: '2026-10-03', item_name: 'Feed', quantity: 2, unit: 'bag', total_amount: 3000, paid_amount: 0 }];
  const transactions = [
    { id: 'stx_pur_p1', supplier_id: 'sup1', date: '2026-10-01T01:00:00Z', type: 'Payment', amount: 5000, note: 'Spot Payment for Milk Intake' },
    { id: 't1', supplier_id: 'sup1', date: '2026-10-10T07:00:00Z', type: 'Payment', amount: 10000, mode: 'Bank', account_id: 'acc_bank' }
  ];
  const input = { purchases, materialPurchases: materials, transactions, accountNames: { acc_bank: 'Meezan Bank' } };

  it('reconciles the ledger to the supplier balance with an opening line', () => {
    const statement = buildSupplierStatement({ ...input, supplier: supplier(12500) });
    expect(statement.openingBalance).toBe(2000);
    expect(statement.closingBalance).toBe(12500);
    expect(statement.printRows.map(r => r.id)).toEqual(['p1', 'stx_pur_p1', 'm1', 'p2', 't1']);
    expect(statement.totalCredit).toBe(25500);
    expect(statement.netPaid).toBe(15000);
    expect(statement.totalMilkLitres).toBe(150);
    expect(statement.entries[0].id).toBe('t1');
    expect(statement.printRows.find(r => r.id === 't1')).toMatchObject({ accountName: 'Meezan Bank', canDelete: true });
    expect(statement.printRows.find(r => r.id === 'stx_pur_p1')?.canDelete).toBe(false);
  });

  it('carries everything before the range into the opening balance', () => {
    const statement = buildSupplierStatement({ ...input, supplier: supplier(12500), from: '2026-10-06', to: '2026-10-31' });
    // p2 was saved at 20:30 UTC on the 5th, which is 01:30 on the 6th in Pakistan.
    expect(statement.printRows.map(r => r.id)).toEqual(['p2', 't1']);
    expect(statement.openingBalance).toBe(15000);
    expect(statement.closingBalance).toBe(12500);
    expect(statement.openingBalance + statement.totalCredit - statement.netPaid).toBe(statement.closingBalance);
    expect(statement.cashOut).toBe(10000);
    expect(statement.cashPaid).toBe(0);
    expect(statement.otherPaid).toBe(10000);
    expect(statement.milkStats).toMatchObject({ totalLitres: 50, eveningLitres: 50, morningLitres: 0, avgRate: 150 });
  });

  it('keeps an undated entry in the opening balance of a dated range', () => {
    const statement = buildSupplierStatement({
      supplier: supplier(1500),
      purchases: [
        { id: 'old', supplier_id: 'sup1', quantity: 10, total_amount: 1000 },
        { id: 'new', supplier_id: 'sup1', date: '2026-10-10', quantity: 5, total_amount: 500 }
      ],
      from: '2026-10-06',
      to: '2026-10-31'
    });
    expect(statement.openingBalance).toBe(1000);
    expect(statement.closingBalance).toBe(1500);
    expect(statement.openingBalance + statement.totalCredit - statement.netPaid).toBe(statement.closingBalance);

    const untilOnly = buildSupplierStatement({
      supplier: supplier(1500),
      purchases: [
        { id: 'old', supplier_id: 'sup1', quantity: 10, total_amount: 1000 },
        { id: 'new', supplier_id: 'sup1', date: '2026-10-10', quantity: 5, total_amount: 500 }
      ],
      to: '2026-10-31'
    });
    expect(untilOnly.openingBalance + untilOnly.totalCredit - untilOnly.netPaid).toBe(untilOnly.closingBalance);
  });

  it('adds a spot payment line when a paid purchase has no payment row', () => {
    const statement = buildSupplierStatement({
      supplier: supplier(1000),
      purchases: [{ id: 'p3', supplier_id: 'sup1', date: '2026-10-12', quantity: 20, total_amount: 3000, paid_amount: 2000 }]
    });
    expect(statement.printRows.map(r => [r.id, r.credit, r.debit])).toEqual([['p3', 3000, 0], ['spot_milk_p3', 0, 2000]]);
    expect(statement.closingBalance).toBe(1000);
    expect(statement.cashPaid).toBe(2000);
  });

  it('hides a fully returned purchase and its refunded payment from the ledger but not the cash register', () => {
    const statement = buildSupplierStatement({
      supplier: supplier(0),
      purchases: [{ id: 'p4', supplier_id: 'sup1', date: '2026-10-12', quantity: 20, total_amount: 4000, paid_amount: 4000, status: 'Returned' }],
      transactions: [
        { id: 'stx_pur_p4', supplier_id: 'sup1', date: '2026-10-12', type: 'Payment', amount: 4000 },
        { id: 'r4', supplier_id: 'sup1', date: '2026-10-13', type: 'Return', amount: 4000, details: { purchase_id: 'p4', cash_refund: 4000 } }
      ]
    });
    expect(statement.printRows).toEqual([]);
    expect(statement.closingBalance).toBe(0);
    expect(statement.cashOut).toBe(4000);
    expect(statement.cashIn).toBe(4000);
    expect(statement.paymentDays.map(d => d.date)).toEqual(['2026-10-13', '2026-10-12']);
  });

  it('nets an unlinked return into the ledger and shows waivers without cash', () => {
    const statement = buildSupplierStatement({
      supplier: supplier(3000 - 500 - 1000),
      purchases: [{ id: 'p5', supplier_id: 'sup1', date: '2026-10-12', quantity: 20, total_amount: 3000 }],
      transactions: [
        { id: 'r5', supplier_id: 'sup1', date: '2026-10-13', type: 'Return', amount: 800, details: { cash_refund: 300 } },
        { id: 'w1', supplier_id: 'sup1', date: '2026-10-14', type: 'Payment', amount: 1000, mode: 'Waiver' }
      ]
    });
    expect(statement.printRows.map(r => [r.id, r.debit])).toEqual([['p5', 0], ['r5', 500], ['w1', 1000]]);
    expect(statement.cashOut).toBe(0);
    expect(statement.cashIn).toBe(300);
    expect(statement.closingBalance).toBe(1500);
  });

  it('filters by kind and search without changing balances', () => {
    const statement = buildSupplierStatement({ ...input, supplier: supplier(12500), kind: 'Payment', query: 'meezan' });
    expect(statement.printRows.map(r => r.id)).toEqual(['t1']);
    expect(statement.closingBalance).toBe(12500);
  });
});

describe('printWhenReady', () => {
  const fakePopup = (readyState: string, fontsReady: Promise<unknown>) => {
    const listeners: Record<string, () => void> = {};
    const popup = {
      closed: false,
      print: vi.fn(),
      focus: vi.fn(),
      addEventListener: vi.fn((type: string, fn: () => void) => { listeners[type] = fn; }),
      document: { readyState, fonts: { ready: fontsReady } }
    };
    return { popup, win: popup as unknown as Window, fireLoad: () => listeners.load?.() };
  };

  it('waits for the page and its web fonts, then prints once', async () => {
    vi.useFakeTimers();
    let fontsLoaded!: () => void;
    const { popup, win, fireLoad } = fakePopup('loading', new Promise<void>(resolve => { fontsLoaded = resolve; }));
    printWhenReady(win, 350, 4000);
    await vi.advanceTimersByTimeAsync(500);
    expect(popup.print).not.toHaveBeenCalled();
    fireLoad();
    await vi.advanceTimersByTimeAsync(100);
    expect(popup.print).not.toHaveBeenCalled();
    fontsLoaded();
    await vi.advanceTimersByTimeAsync(0);
    expect(popup.print).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(popup.print).toHaveBeenCalledTimes(1);
  });

  it('keeps the minimum delay when everything is already loaded', async () => {
    vi.useFakeTimers();
    const { popup, win } = fakePopup('complete', Promise.resolve());
    printWhenReady(win, 350, 4000);
    await vi.advanceTimersByTimeAsync(300);
    expect(popup.print).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60);
    expect(popup.print).toHaveBeenCalledTimes(1);
  });

  it('prints anyway when fonts never arrive, and not at all once the window is closed', async () => {
    vi.useFakeTimers();
    const stuck = fakePopup('complete', new Promise(() => {}));
    printWhenReady(stuck.win, 350, 4000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(stuck.popup.print).toHaveBeenCalledTimes(1);

    const closed = fakePopup('complete', Promise.resolve());
    closed.popup.closed = true;
    printWhenReady(closed.win, 350, 4000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(closed.popup.print).not.toHaveBeenCalled();
  });
});

describe('buildPaymentRegister', () => {
  it('collects every supplier payment by day', () => {
    const register = buildPaymentRegister({
      suppliers: [
        { id: 'a', name: 'Ali', pendingBalance: 0 },
        { id: 'b', name: 'Bilal', pendingBalance: 0 }
      ],
      transactions: [
        { id: 't1', supplier_id: 'a', date: '2026-10-10T07:00:00Z', type: 'Payment', amount: 1000 },
        { id: 't2', supplier_id: 'b', date: '2026-10-10T09:00:00Z', type: 'Advance', amount: 500, mode: 'Online' },
        { id: 't3', supplier_id: 'b', date: '2026-10-11T09:00:00Z', type: 'Payment', amount: 200 }
      ],
      from: '2026-10-10',
      to: '2026-10-10'
    });
    expect(register.count).toBe(2);
    expect(register.cashOut).toBe(1500);
    expect(register.cashPaid).toBe(1000);
    expect(register.otherPaid).toBe(500);
    expect(register.days).toHaveLength(1);
    expect(register.days[0].rows.map(r => r.supplierName)).toEqual(['Ali', 'Bilal']);
  });
});
