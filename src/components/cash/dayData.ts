import type { BusinessDay, CashHandover, CashRemittance, CashVariance, ShiftSession } from '../../types';
import { roundCurrency } from '../../lib/db';
import { isSpotSupplierPayment, materialCashPaid, purchaseCashPaid, salePaidAmount } from '../../lib/moneyFlow';
import { OPEN_SHIFT_STATUSES, LIVE_SHIFT_STATUSES, pkDateOf } from './cashFormat';
import type { DenominationCounts } from './denominations';

// ---------------------------------------------------------------------------
// Day readiness: one pass over the custody tables instead of a filter per day card.
// ---------------------------------------------------------------------------

export interface DayStatus {
  shifts: ShiftSession[];
  /** Shifts that still block the close (incl. Pending Review). */
  openShifts: number;
  /** Shifts whose drawer is still in use, so the day's cash cannot be counted yet. */
  liveShifts: number;
  pendingRemits: number;
  disputedHandovers: number;
  openVariances: number;
  blockers: number;
}

const emptyStatus = (): DayStatus => ({
  shifts: [], openShifts: 0, liveShifts: 0, pendingRemits: 0, disputedHandovers: 0, openVariances: 0, blockers: 0,
});

export function indexDays(
  shiftSessions: ShiftSession[],
  cashRemittances: CashRemittance[],
  cashHandovers: CashHandover[],
  cashVariances: CashVariance[],
): Map<string, DayStatus> {
  const index = new Map<string, DayStatus>();
  const entry = (dayId?: string | null) => {
    if (!dayId) return null;
    let status = index.get(dayId);
    if (!status) { status = emptyStatus(); index.set(dayId, status); }
    return status;
  };
  for (const shift of shiftSessions) {
    const status = entry(shift.business_day_id);
    if (!status) continue;
    status.shifts.push(shift);
    if (OPEN_SHIFT_STATUSES.includes(shift.status)) status.openShifts += 1;
    if (LIVE_SHIFT_STATUSES.includes(shift.status)) status.liveShifts += 1;
  }
  for (const remittance of cashRemittances) {
    if (remittance.status === 'Pending' || remittance.status === 'Disputed') {
      const status = entry(remittance.business_day_id);
      if (status) status.pendingRemits += 1;
    }
  }
  // Pending handovers are cash left in the drawer and are auto-accepted at day close.
  // Only a disputed handover blocks (its variance is open).
  for (const handover of cashHandovers) {
    if (handover.status === 'Disputed') {
      const status = entry(handover.business_day_id);
      if (status) status.disputedHandovers += 1;
    }
  }
  for (const variance of cashVariances) {
    if (variance.status === 'Open') {
      const status = entry(variance.business_day_id);
      if (status) status.openVariances += 1;
    }
  }
  index.forEach(status => {
    status.blockers = status.openShifts + status.pendingRemits + status.disputedHandovers + status.openVariances;
  });
  return index;
}

export const EMPTY_DAY_STATUS: DayStatus = emptyStatus();

// ---------------------------------------------------------------------------
// Day summary: live from the shifts while the day is open, the stored record once it is closed.
// ---------------------------------------------------------------------------

export interface DaySummary {
  shifts: number;
  gross: number;
  cash: number;
  online: number;
  credit: number;
  /** Net of all shift closing differences (over − short). */
  variance: number;
  over: number;
  short: number;
}

type ShiftTotalsFn = (shiftId: string) => { gross_sales?: number; cash_sales?: number; online_sales?: number; credit_sales?: number };

export function summarizeDay(day: BusinessDay, shifts: ShiftSession[], getShiftTotals: ShiftTotalsFn): DaySummary {
  let over = 0;
  let short = 0;
  for (const shift of shifts) {
    const difference = Number(shift.cash_difference || 0);
    if (difference > 0) over += difference;
    else if (difference < 0) short += difference;
  }
  const stored = day.summary as Record<string, any> | undefined;
  // A closed day keeps the figures it was locked with; recomputing them from today's data would
  // let a later return or edit silently rewrite a closed day's record.
  if (day.status === 'Closed' && stored && typeof stored.gross_sales === 'number') {
    return {
      shifts: Number(stored.shifts_count ?? shifts.length),
      gross: roundCurrency(Number(stored.gross_sales || 0)),
      cash: roundCurrency(Number(stored.cash_sales || 0)),
      online: roundCurrency(Number(stored.online_sales || 0)),
      credit: roundCurrency(Number(stored.credit_sales || 0)),
      variance: roundCurrency(Number(stored.total_variance ?? over + short)),
      over: roundCurrency(over),
      short: roundCurrency(short),
    };
  }
  let gross = 0, cash = 0, online = 0, credit = 0;
  for (const shift of shifts) {
    const totals = getShiftTotals(shift.id);
    gross += Number(totals.gross_sales || 0);
    cash += Number(totals.cash_sales || 0);
    online += Number(totals.online_sales || 0);
    credit += Number(totals.credit_sales || 0);
  }
  return {
    shifts: shifts.length,
    gross: roundCurrency(gross),
    cash: roundCurrency(cash),
    online: roundCurrency(online),
    credit: roundCurrency(credit),
    variance: roundCurrency(over + short),
    over: roundCurrency(over),
    short: roundCurrency(short),
  };
}

// ---------------------------------------------------------------------------
// Day cash closing: where the day's cash came from and where it went.
// ---------------------------------------------------------------------------

export interface DayCashSources {
  sales: any[];
  shiftCashEvents: any[];
  customerTransactions: any[];
  dailySupplyEntries: any[];
  expenses: any[];
  purchases: any[];
  materialPurchases: any[];
  supplierTransactions: any[];
  expenseVendorTransactions: any[];
  cashRemittances: CashRemittance[];
  shiftSessions: ShiftSession[];
}

export interface CashLine {
  key: string;
  label: string;
  detail: string;
  amount: number;
}

export interface CashOutItem {
  id: string;
  label: string;
  amount: number;
}

export interface DayCash {
  cashIn: { lines: CashLine[]; total: number; posSales: number; ledger: number; delivery: number; vendorRefunds: number; billCount: number; receiptCount: number; deliveryCount: number };
  cashOut: { lines: CashLine[]; items: CashOutItem[]; total: number; expenses: number; purchases: number; materialPurchases: number; supplierPayments: number; vendorPayments: number; refunds: number };
  /** Every remittance of the day: the drawer lost the declared amount the moment it was submitted. */
  remitted: { total: number; count: number; pending: number };
  /** Shift opening and closing differences already counted and booked into the drawer account. */
  recorded: { total: number; count: number };
  /** Sum of each drawer's first counted opening of the day. */
  suggestedOpening: number;
}

const isCash = (value: unknown) => String(value || '').toLowerCase().includes('cash');
const isRefundOut = (event: any) => event.direction === 'Out' && String(event.event_type || '').toLowerCase().includes('refund');

/** The bill a refund event belongs to: its id, or `${saleId}_xxxx` (sale ids contain underscores too). */
const parentSaleId = (source: string, saleIds: Set<string>): string | null => {
  if (saleIds.has(source)) return source;
  for (let index = source.lastIndexOf('_'); index > 0; index = source.lastIndexOf('_', index - 1)) {
    const prefix = source.slice(0, index);
    if (saleIds.has(prefix)) return prefix;
  }
  return null;
};

export function computeDayCash(day: BusinessDay, src: DayCashSources): DayCash {
  const date = day.business_date;
  const onDay = (value?: string | null) => Boolean(value) && pkDateOf(value) === date;

  // Cash in -----------------------------------------------------------------
  const daySales = src.sales.filter(sale => sale.business_day_id === day.id);
  const saleIds = new Set<string>(daySales.map(sale => String(sale.id)));
  const refundBySale = new Map<string, number>();
  const priorRefunds: any[] = [];
  for (const event of src.shiftCashEvents) {
    if (event.business_day_id !== day.id || !isRefundOut(event)) continue;
    const saleId = parentSaleId(String(event.source_id || ''), saleIds);
    if (saleId) refundBySale.set(saleId, (refundBySale.get(saleId) || 0) + Number(event.amount || 0));
    else priorRefunds.push(event);
  }
  // Any bill that is not online counts (a credit bill's cash down payment too), net of the cash
  // refunded for it the same day.
  const cashSales = daySales.filter(sale => String(sale.payment_mode || '').toLowerCase() !== 'online' && salePaidAmount(sale) > 0);
  const posSales = roundCurrency(cashSales.reduce((sum, sale) => sum + Math.max(0, salePaidAmount(sale) - (refundBySale.get(String(sale.id)) || 0)), 0));

  const ledgerRows = src.customerTransactions.filter(tx => tx.type === 'Payment' && isCash(tx.mode) && Number(tx.amount || 0) > 0 && (tx.business_day_id === day.id || onDay(tx.date)));
  const ledger = roundCurrency(ledgerRows.reduce((sum, tx) => sum + Number(tx.amount || 0), 0));
  const deliveryRows = src.dailySupplyEntries.filter(entry => isCash(entry.payment_mode) && Number(entry.payment_received || 0) > 0 && (entry.business_day_id === day.id || onDay(entry.date)));
  const delivery = roundCurrency(deliveryRows.reduce((sum, entry) => sum + Number(entry.payment_received || 0), 0));
  const vendorCash = src.expenseVendorTransactions.filter(tx => isCash(tx.payment_mode) && Number(tx.amount || 0) > 0 && onDay(tx.date));
  const vendorRefundRows = vendorCash.filter(tx => tx.type === 'Refund');
  const vendorRefunds = roundCurrency(vendorRefundRows.reduce((sum, tx) => sum + Number(tx.amount || 0), 0));
  const cashInTotal = roundCurrency(posSales + ledger + delivery + vendorRefunds);

  // Cash out ----------------------------------------------------------------
  const expenseRows = src.expenses.filter(expense => isCash(expense.paymentMode) && Number(expense.paidAmount || 0) > 0 && onDay(expense.date));
  const expensesTotal = roundCurrency(expenseRows.reduce((sum, expense) => sum + Number(expense.paidAmount || 0), 0));
  const purchaseRows = src.purchases.filter(purchase => isCash(purchase.payment_mode || purchase.details?.payment_mode) && purchaseCashPaid(purchase) > 0 && onDay(purchase.date));
  const purchasesTotal = roundCurrency(purchaseRows.reduce((sum, purchase) => sum + purchaseCashPaid(purchase), 0));
  // A credit material line's total is not cash.
  const materialRows = src.materialPurchases.filter(row => isCash(row.payment_mode || row.details?.payment_mode) && materialCashPaid(row) > 0 && onDay(row.date));
  const materialTotal = roundCurrency(materialRows.reduce((sum, row) => sum + materialCashPaid(row), 0));
  // Spot payments are already in the purchases above; waivers moved no cash.
  const supplierRows = src.supplierTransactions.filter(tx => tx.type === 'Payment' && isCash(tx.mode) && Number(tx.amount || 0) > 0 && onDay(tx.date) && !isSpotSupplierPayment(tx) && !tx.details?.waiver);
  const supplierTotal = roundCurrency(supplierRows.reduce((sum, tx) => sum + Number(tx.amount || 0), 0));
  // Vendor / staff ledger settled in cash (shift totals count these too).
  const vendorPaymentRows = vendorCash.filter(tx => tx.type === 'Payment');
  const vendorPayments = roundCurrency(vendorPaymentRows.reduce((sum, tx) => sum + Number(tx.amount || 0), 0));
  const refunds = roundCurrency(priorRefunds.reduce((sum, event) => sum + Number(event.amount || 0), 0));
  const cashOutTotal = roundCurrency(expensesTotal + purchasesTotal + materialTotal + supplierTotal + vendorPayments + refunds);

  const items: CashOutItem[] = [
    ...expenseRows.map(expense => ({
      id: `exp_${expense.id}`,
      label: `${expense.category || 'Expense'}${expense.vendor_name ? ` · ${expense.vendor_name}` : ''}${expense.description ? ` — ${expense.description}` : ''}`,
      amount: Number(expense.paidAmount || 0),
    })),
    ...purchaseRows.map(purchase => ({ id: `milk_${purchase.id}`, label: `Milk · ${purchase.supplier_name || 'Supplier'}`, amount: purchaseCashPaid(purchase) })),
    ...materialRows.map(row => ({ id: `mat_${row.id}`, label: `Material · ${row.supplier_name || 'Supplier'} (${row.item_name || 'Supplies'})`, amount: materialCashPaid(row) })),
    ...vendorPaymentRows.map(tx => ({ id: `ven_${tx.id}`, label: `Vendor / Staff · ${tx.vendor_name || tx.note || 'Vendor'}`, amount: Number(tx.amount || 0) })),
    ...supplierRows.map(tx => ({ id: `sup_${tx.id}`, label: `Supplier payment · ${tx.note || tx.supplier_name || 'Supplier'}`, amount: Number(tx.amount || 0) })),
    ...priorRefunds.map(event => ({ id: `ref_${event.id}`, label: `Refund · ${event.event_type}`, amount: Number(event.amount || 0) })),
  ];

  // Custody -----------------------------------------------------------------
  // The drawer account is debited with the declared amount when the cashier submits, so every
  // remittance of the day counts here, whatever the head later found in the bag. (Counting only
  // 'Accepted' ones dropped remittances that went to 'Resolved' after a count difference and
  // showed a false shortage for the day.)
  const dayRemits = src.cashRemittances.filter(remittance => remittance.business_day_id === day.id && remittance.status !== 'Rejected');
  const remitted = roundCurrency(dayRemits.reduce((sum, remittance) => sum + Number(remittance.declared_amount || 0), 0));

  // The first shift of each drawer sets the day's opening; later shifts take over the previous
  // shift's cash, so their opening differences (and every closing difference) are already booked.
  const dayShifts = src.shiftSessions.filter(shift => shift.business_day_id === day.id);
  const firstByDrawer = new Map<string, ShiftSession>();
  for (const shift of dayShifts) {
    const drawerKey = shift.drawer_id || shift.account_id || 'drawer';
    const current = firstByDrawer.get(drawerKey);
    if (!current || String(shift.started_at || shift.start_time || '') < String(current.started_at || current.start_time || '')) {
      firstByDrawer.set(drawerKey, shift);
    }
  }
  const baseline = new Set(Array.from(firstByDrawer.values()).map(shift => shift.id));
  const suggestedOpening = roundCurrency(Array.from(firstByDrawer.values()).reduce((sum, shift) => sum + Number(shift.opening_counted ?? shift.opening_float ?? 0), 0));
  let recordedTotal = 0;
  let recordedCount = 0;
  for (const shift of dayShifts) {
    const closing = Number(shift.cash_difference || 0);
    const opening = baseline.has(shift.id) ? 0 : Number(shift.opening_variance || 0);
    if (Math.abs(closing) >= 0.01) { recordedTotal += closing; recordedCount += 1; }
    if (Math.abs(opening) >= 0.01) { recordedTotal += opening; recordedCount += 1; }
  }

  return {
    cashIn: {
      lines: [
        { key: 'pos', label: 'POS cash sales', detail: `${cashSales.length} bills`, amount: posSales },
        { key: 'ledger', label: 'Customer ledger cash', detail: `${ledgerRows.length} payments`, amount: ledger },
        { key: 'delivery', label: 'Daily delivery cash', detail: `${deliveryRows.length} entries`, amount: delivery },
        ...(vendorRefunds > 0 ? [{ key: 'vendor-refunds', label: 'Vendor / staff refunds', detail: `${vendorRefundRows.length} refunds`, amount: vendorRefunds }] : []),
      ],
      total: cashInTotal,
      posSales, ledger, delivery, vendorRefunds,
      billCount: cashSales.length,
      receiptCount: ledgerRows.length,
      deliveryCount: deliveryRows.length,
    },
    cashOut: {
      lines: [
        { key: 'expenses', label: 'Cash expenses', detail: `${expenseRows.length} entries`, amount: expensesTotal },
        { key: 'milk', label: 'Milk cash purchases', detail: `${purchaseRows.length} purchases`, amount: purchasesTotal },
        { key: 'material', label: 'Material cash purchases', detail: `${materialRows.length} purchases`, amount: materialTotal },
        { key: 'supplier', label: 'Supplier cash payments', detail: `${supplierRows.length} payments`, amount: supplierTotal },
        { key: 'vendor', label: 'Vendor / staff payments', detail: `${vendorPaymentRows.length} payments`, amount: vendorPayments },
        { key: 'refunds', label: 'Cash refunds (earlier bills)', detail: `${priorRefunds.length} refunds`, amount: refunds },
      ].filter(line => line.amount > 0 || line.key === 'expenses' || line.key === 'milk'),
      items,
      total: cashOutTotal,
      expenses: expensesTotal,
      purchases: purchasesTotal,
      materialPurchases: materialTotal,
      supplierPayments: supplierTotal,
      vendorPayments,
      refunds,
    },
    remitted: { total: remitted, count: dayRemits.length, pending: dayRemits.filter(remittance => remittance.status === 'Pending').length },
    recorded: { total: roundCurrency(recordedTotal), count: recordedCount },
    suggestedOpening,
  };
}

/** Expected drawer cash at the end of the day. */
export const expectedDayCash = (cash: DayCash, opening: number) =>
  roundCurrency(opening + cash.cashIn.total - cash.cashOut.total - cash.remitted.total + cash.recorded.total);

/** Snapshot stored on the business day and in day_closings (same keys as before, plus the new custody lines). */
export function buildCashClose(
  cash: DayCash,
  opening: number,
  counted: number,
  variance: number,
  source: 'physical' | 'expected',
  denominations: DenominationCounts,
  closedByName: string,
) {
  return {
    opening,
    cash_in: {
      pos_sales: cash.cashIn.posSales,
      ledger_collections: cash.cashIn.ledger,
      delivery_collections: cash.cashIn.delivery,
      vendor_refunds: cash.cashIn.vendorRefunds,
      total: cash.cashIn.total,
      bill_count: cash.cashIn.billCount,
      receipt_count: cash.cashIn.receiptCount,
      delivery_count: cash.cashIn.deliveryCount,
    },
    cash_out: {
      expenses: cash.cashOut.expenses,
      purchases: cash.cashOut.purchases,
      material_purchases: cash.cashOut.materialPurchases,
      supplier_payments: cash.cashOut.supplierPayments,
      vendor_payments: cash.cashOut.vendorPayments,
      refunds: cash.cashOut.refunds,
      total: cash.cashOut.total,
    },
    remitted_to_head: cash.remitted.total,
    remittance_count: cash.remitted.count,
    recorded_shift_differences: cash.recorded.total,
    expected: expectedDayCash(cash, opening),
    counted,
    variance,
    counted_source: source,
    denominations,
    closed_by_name: closedByName,
    closed_at: new Date().toISOString(),
  };
}
