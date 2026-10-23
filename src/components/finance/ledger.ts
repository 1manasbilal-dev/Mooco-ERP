import { Building2, Smartphone, Wallet } from 'lucide-react';
import type {
  BankTransaction, Customer, CustomerTransaction, ExpenseEntry, FinancialAccount, POSBill, Supplier, SupplierTransaction, SystemSettings,
} from '../../types';
import { businessDate, offsetDate } from '../../lib/dashboardAnalytics';
import { cleanNumber, isDateOnlyOrMidnight } from '../../lib/formatters';

/**
 * Bank & Cash statement maths: one list of money movements per account, the running balance
 * and Pakistan-time date ranges. Pure functions so the screen can memoise them.
 */

export type SourceModule = 'Direct' | 'Expense' | 'POS Sale' | 'Customer Payment' | 'Supplier Payment' | 'Payroll';

export interface LedgerEntry {
  id: string;
  /** As stored: an ISO timestamp or a plain YYYY-MM-DD date. */
  date: string;
  /** Pakistan business day (YYYY-MM-DD) the entry belongs to. */
  day: string;
  /** Sort key in milliseconds. */
  time: number;
  type: string;
  category: string;
  description: string;
  /** Always positive. */
  amount: number;
  /** + money in, − money out (same rule the balance update uses). */
  signed: number;
  accountId: string;
  accountName: string;
  sourceModule: SourceModule;
}

const INFLOW_TYPES = new Set(['Deposit', 'Income', 'Transfer_In']);

/** Same rule as the account balance update: Deposit / Income / Transfer_In add, everything else subtracts. */
export const isInflow = (type: string) => INFLOW_TYPES.has(type);
export const isTransfer = (type: string) => type === 'Transfer_In' || type === 'Transfer_Out';

export type Flow = 'All' | 'Inflow' | 'Outflow' | 'Transfer';

export const matchesFlow = (entry: LedgerEntry, flow: Flow) =>
  flow === 'All' ? true
  : flow === 'Transfer' ? isTransfer(entry.type)
  : flow === 'Inflow' ? isInflow(entry.type)
  : !isInflow(entry.type);

interface LedgerSources {
  accounts: FinancialAccount[];
  bankTransactions: BankTransaction[];
  expenses: ExpenseEntry[];
  sales: POSBill[];
  customers: Customer[];
  customerTransactions: CustomerTransaction[];
  suppliers: Supplier[];
  supplierTransactions: SupplierTransaction[];
  settings: SystemSettings;
}

const today = () => businessDate();

const makeEntry = (
  base: Omit<LedgerEntry, 'day' | 'time' | 'signed'>,
): LedgerEntry => {
  const amount = Number(base.amount) || 0;
  const time = Date.parse(base.date);
  return {
    ...base,
    amount,
    day: businessDate(base.date) || today(),
    time: Number.isFinite(time) ? time : 0,
    signed: isInflow(base.type) ? amount : -amount,
  };
};

/**
 * Every movement on every account: the bank_transactions rows plus expenses, POS sales and
 * party payments that are not in bank_transactions yet (offline / unsynced). Newest first.
 */
export function buildLedgerEntries({
  accounts, bankTransactions, expenses, sales, customers, customerTransactions, suppliers, supplierTransactions, settings,
}: LedgerSources): LedgerEntry[] {
  const list: LedgerEntry[] = [];
  const accountsById = new Map(accounts.map(a => [a.id, a]));
  const accountName = (id: string) => accountsById.get(id)?.name || 'Account';
  const defaultCashId = settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id || accounts[0]?.id || '';
  const defaultBankId = settings.financial?.defaultDigitalAccountId || accounts.find(a => a.type === 'Bank' || a.type === 'Wallet')?.id || accounts[0]?.id || '';

  // Lookups for deduplicating against bank_transactions (built once instead of scanning per record).
  const btxIds = new Set<string>();
  const btxRefIds = new Set<string>();
  const btxBillTokens = new Set<string>();
  const btxExpenseIds = new Set<string>();
  const descriptions: string[] = [];

  bankTransactions.forEach(tx => {
    if (tx.id) btxIds.add(tx.id);
    if (tx.reference_id) btxRefIds.add(tx.reference_id);
    const relatedExpenseId = (tx as any).related_expense_id;
    if (relatedExpenseId) btxExpenseIds.add(relatedExpenseId);
    if (tx.description) {
      descriptions.push(tx.description);
      const match = tx.description.match(/#?([A-Z0-9]+-[0-9]+-[A-Z0-9]+)/i);
      if (match) btxBillTokens.add(match[1]);
    }

    const catLower = (tx.category || '').toLowerCase();
    const descLower = (tx.description || '').toLowerCase();
    let sourceModule: SourceModule = 'Direct';
    if (catLower.includes('pos') || descLower.includes('pos cash sale') || descLower.includes('pos sale')) {
      sourceModule = 'POS Sale';
    } else if (catLower.includes('milk') || catLower.includes('supplier') || descLower.includes('milk intake') || descLower.includes('supplier payment')) {
      sourceModule = 'Supplier Payment';
    } else if (catLower.includes('customer') || descLower.includes('customer receipt') || descLower.includes('payment from:')) {
      sourceModule = 'Customer Payment';
    } else if (catLower.includes('expense') || descLower.includes('expense:')) {
      sourceModule = 'Expense';
    }

    list.push(makeEntry({
      id: tx.id,
      date: tx.date || today(),
      type: tx.type,
      category: tx.category || tx.type,
      description: tx.description || tx.type,
      amount: tx.amount || 0,
      accountId: tx.account_id,
      accountName: accountName(tx.account_id),
      sourceModule,
    }));
  });

  // One joined string answers "does any description mention this id" with a single native search.
  // \u0001 never appears in an id, so a match cannot span two descriptions.
  let joinedDescriptions: string | null = null;
  const anyDescriptionIncludes = (needle: string) => {
    if (joinedDescriptions === null) joinedDescriptions = descriptions.join('\u0001');
    return joinedDescriptions.includes(needle);
  };

  // Expenses: only offline / unsynced ones not yet in bankTransactions
  expenses.forEach(exp => {
    if ((exp as any).status === 'Cancelled' || (exp as any).status === 'Returned') return;
    if (exp.paymentStatus === 'Unpaid' || (exp as any).payment_status === 'Unpaid') return;
    // Bad-debt write-offs are non-cash adjustments: no account moved.
    if (exp.paymentMode === 'Adjustment' || (exp as any).details?.write_off || (exp as any).write_off) return;
    const actualPaid = exp.paymentStatus === 'Partial'
      ? Number(exp.paidAmount || 0)
      : Number(exp.paidAmount ?? (exp as any).paid_amount ?? exp.amount ?? 0);
    if (actualPaid <= 0) return;

    const isAlreadyInBankTx = btxIds.has(`btx_${exp.id}`) || btxRefIds.has(exp.id) || btxExpenseIds.has(exp.id) || anyDescriptionIncludes(exp.id);
    if (isAlreadyInBankTx) return;

    const accId = exp.account_id || (exp.paymentMode === 'Cash' ? defaultCashId : defaultBankId);
    if (!accId) return;
    list.push(makeEntry({
      id: `exp_${exp.id}`,
      date: exp.date || today(),
      type: 'Expense',
      category: exp.category || 'Expense',
      description: `Expense: ${exp.description}${exp.vendor_name ? ` (${exp.vendor_name})` : ''}`,
      amount: actualPaid,
      accountId: accId,
      accountName: accountName(accId),
      sourceModule: 'Expense',
    }));
  });

  // POS sales: only offline / unsynced ones not yet in bankTransactions
  sales.forEach(sale => {
    if (sale.status !== 'Completed' || !(sale.total > 0)) return;
    const isCash = sale.payment_mode === 'Cash';
    const isOnline = sale.payment_mode === 'Online';
    if (!isCash && !isOnline) return;
    const isAlreadyInBankTx = btxIds.has(`btx_${sale.id}`) || btxRefIds.has(sale.id) || (sale.bill_number && btxBillTokens.has(sale.bill_number));
    if (isAlreadyInBankTx) return;

    const targetAccId = (sale as any).receipt_account_id || (isCash ? defaultCashId : defaultBankId);
    if (!targetAccId) return;
    list.push(makeEntry({
      id: `sale_${sale.id}`,
      // Keep the full timestamp: its UTC date part is the previous day for bills rung up before 05:00 PKT.
      date: sale.date || today(),
      type: 'Income',
      category: isCash ? 'Cash Sale' : 'Online Sale',
      description: `POS Sale #${sale.bill_number}${sale.customer_name ? ` (${sale.customer_name})` : ''}`,
      amount: sale.total || 0,
      accountId: targetAccId,
      accountName: accountName(targetAccId),
      sourceModule: 'POS Sale',
    }));
  });

  const customersById = new Map(customers.map(c => [c.id, c]));
  // Customer payments: only offline / unsynced ones not yet in bankTransactions
  customerTransactions.forEach(ct => {
    if (ct.type !== 'Payment' || !(ct.amount > 0)) return;
    const modeLower = String(ct.mode || (ct as any).details?.mode || '').toLowerCase();
    if (
      modeLower.includes('bad debt') ||
      modeLower.includes('waiver') ||
      modeLower.includes('write-off') ||
      modeLower.includes('discount') ||
      modeLower.includes('opening balance') ||
      ct.id.startsWith('ctx_op_')
    ) return;

    const isAlreadyInBankTx = btxIds.has(`btx_${ct.id}`) || btxIds.has(`btx_cust_${ct.id}`) || btxRefIds.has(ct.id);
    if (isAlreadyInBankTx) return;

    const isCash = !ct.mode || ct.mode.toLowerCase().includes('cash');
    const targetAccId = (ct as any).account_id || (ct as any).details?.account_id || (isCash ? defaultCashId : defaultBankId);
    if (!targetAccId) return;
    list.push(makeEntry({
      id: `cust_${ct.id}`,
      date: ct.date || today(),
      type: 'Income',
      category: 'Customer Receipt',
      description: `Payment from: ${customersById.get(ct.customer_id)?.name || 'Customer'}${ct.note ? ` (${ct.note})` : ''}`,
      amount: ct.amount,
      accountId: targetAccId,
      accountName: accountName(targetAccId),
      sourceModule: 'Customer Payment',
    }));
  });

  const suppliersById = new Map(suppliers.map(s => [s.id, s]));
  // Supplier payments: only offline / unsynced ones not yet in bankTransactions
  supplierTransactions.forEach(st => {
    if ((st.type !== 'Payment' && st.type !== 'Advance') || !(st.amount > 0)) return;
    const details = (st as any).details;
    const modeLower = String(st.mode || details?.mode || '').toLowerCase();
    if (
      modeLower.includes('waiver') ||
      modeLower.includes('discount') ||
      modeLower.includes('opening balance') ||
      st.id.startsWith('stx_op_')
    ) return;

    const purchaseId = details?.purchase_id || (st.id.startsWith('stx_pur_') ? st.id.replace('stx_pur_', '') : null);
    const isAlreadyInBankTx = btxIds.has(st.id.replace(/^stx_/, 'btx_')) ||
      btxIds.has(`btx_${st.id}`) ||
      btxRefIds.has(st.id) ||
      (purchaseId && (btxIds.has(`btx_pur_${purchaseId}`) || btxRefIds.has(purchaseId) || btxRefIds.has(`pur_${purchaseId}`)));
    if (isAlreadyInBankTx) return;

    const isCash = !st.mode || st.mode.toLowerCase().includes('cash');
    const targetAccId = (st as any).account_id || details?.account_id || (isCash ? defaultCashId : defaultBankId);
    if (!targetAccId) return;
    list.push(makeEntry({
      id: `supp_${st.id}`,
      date: st.date || today(),
      type: 'Expense',
      category: 'Supplier Payment',
      description: `Payment to: ${suppliersById.get(st.supplier_id)?.name || 'Supplier'}${st.note ? ` (${st.note})` : ''}`,
      amount: st.amount,
      accountId: targetAccId,
      accountName: accountName(targetAccId),
      sourceModule: 'Supplier Payment',
    }));
  });

  // Newest first; ID breaks ties so the order is stable
  return list.sort((a, b) => (a.time !== b.time ? b.time - a.time : b.id.localeCompare(a.id)));
}

/** Entry count per account, for the account cards. */
export function countByAccount(entries: LedgerEntry[]) {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.accountId, (counts.get(entry.accountId) || 0) + 1);
  return counts;
}

export interface AccountStatement {
  /** Balance before the oldest entry on record (opening balance / brought forward). */
  opening: number;
  /** Balance right after each entry. Keyed by the entry object, so duplicate ids cannot collide. */
  balanceAfter: Map<LedgerEntry, number>;
}

/**
 * Running balance for one account. `entries` are that account's entries, newest first, unfiltered:
 * the balance is always worked out over the full history in date order, and anchored so the newest
 * row ends on the account's current balance. Any history that is missing shows up as the opening.
 */
export function buildStatement(entries: LedgerEntry[], currentBalance: number): AccountStatement {
  let total = 0;
  for (const entry of entries) total += entry.signed;
  const opening = cleanNumber((Number(currentBalance) || 0) - total);
  const balanceAfter = new Map<LedgerEntry, number>();
  let running = opening;
  for (let i = entries.length - 1; i >= 0; i--) {
    running = cleanNumber(running + entries[i].signed);
    balanceAfter.set(entries[i], running);
  }
  return { opening, balanceAfter };
}

export type PeriodPreset = 'all' | 'today' | '7d' | 'month' | 'custom';

export interface DateRange { from: string; to: string }

/** Date range in Pakistan business days. Empty `from` / `to` means open-ended. */
export function periodRange(preset: PeriodPreset, customFrom = '', customTo = '', todayStr = businessDate()): DateRange {
  if (preset === 'today') return { from: todayStr, to: todayStr };
  if (preset === '7d') return { from: offsetDate(todayStr, -6), to: todayStr };
  if (preset === 'month') return { from: `${todayStr.slice(0, 7)}-01`, to: todayStr };
  if (preset === 'custom') {
    let from = customFrom.slice(0, 10);
    let to = customTo.slice(0, 10);
    if (from && to && from > to) [from, to] = [to, from];
    return { from, to };
  }
  return { from: '', to: '' };
}

export const inRange = (day: string, { from, to }: DateRange) => (!from || day >= from) && (!to || day <= to);

export interface PeriodSummary {
  opening: number;
  inflow: number;
  outflow: number;
  closing: number;
  count: number;
}

/**
 * In / out for a date range. With `opening` (one account) it also gives the balance brought
 * forward into the range and carried out of it. Consolidated views pass `excludeTransfers`,
 * since money moved between our own accounts is not money in or out of the business.
 */
export function summarizePeriod(entries: LedgerEntry[], range: DateRange, opening = 0, excludeTransfers = false): PeriodSummary {
  let before = 0;
  let inflow = 0;
  let outflow = 0;
  let count = 0;
  for (const entry of entries) {
    if (range.from && entry.day < range.from) { before += entry.signed; continue; }
    if (range.to && entry.day > range.to) continue;
    count += 1;
    if (excludeTransfers && isTransfer(entry.type)) continue;
    if (entry.signed >= 0) inflow += entry.signed;
    else outflow -= entry.signed;
  }
  const periodOpening = cleanNumber(opening + before);
  return {
    opening: periodOpening,
    inflow: cleanNumber(inflow),
    outflow: cleanNumber(outflow),
    closing: cleanNumber(periodOpening + inflow - outflow),
    count,
  };
}

const dayFormatter = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' });
const clockFormatter = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Karachi' });

/** "23 Oct 2026" for a YYYY-MM-DD business day. */
export function formatDay(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return dayFormatter.format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Pakistan clock time of a timestamp, or '' when no real time was captured: date-only values,
 * legacy UTC-midnight values, and back-dated entries stored at exactly 12:00:00.
 */
export function formatTime(value: string) {
  if (!value || isDateOnlyOrMidnight(value)) return '';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  if (time % 1000 === 0 && clockFormatter.format(time) === '12:00:00') return '';
  return timeFormatter.format(time);
}

export const ACCOUNT_TYPES = ['Cash', 'Bank', 'Wallet'] as const;
export type AccountKind = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_ICON = { Cash: Wallet, Bank: Building2, Wallet: Smartphone } as const;

/** Cash and mobile wallets hold real money only: they cannot go below zero. Banks can be overdrawn. */
export const canOverdraw = (account?: Pick<FinancialAccount, 'type'> | null) => account?.type === 'Bank';

export const isDefaultAccount = (account: FinancialAccount, settings: SystemSettings) =>
  Boolean(account.is_default || account.id === settings.financial?.defaultCashAccountId || account.id === settings.financial?.defaultDigitalAccountId);

/** Parses a typed amount; returns NaN for empty, non-numeric or non-finite input. Rounded to paisa. */
export function parseAmount(value: string) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return NaN;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? cleanNumber(parsed) : NaN;
}

export const todayPk = () => businessDate();
