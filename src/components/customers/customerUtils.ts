import type { Customer, CustomerTransaction, POSBill } from '../../types';
import { businessDate } from '../../lib/dashboardAnalytics';
import { salePaidAmount } from '../../lib/moneyFlow';
import { roundCurrency } from '../../lib/db';

// The shop's own day of an entry. Stored timestamps are UTC, so their "YYYY-MM-DD" prefix is the
// previous day for anything posted between 00:00 and 05:00 PKT; a plain date is kept as written.
// Pakistan time (businessDate), not the device clock, like the rest of the reporting.
export const localDay = (value?: string): string => {
  if (!value) return '';
  const trimmed = String(value).trim();
  return businessDate(trimmed.replace(' ', 'T')) || trimmed.slice(0, 10);
};

/** A ledger balance closer to zero than this is floating-point residue, not money owed either way. */
export const BALANCE_EPSILON = 0.01;

export type BalanceState = 'due' | 'advance' | 'settled';

/** One rule for due / advance / settled, so the stats, filters, badges and counts always agree. */
export const balanceState = (balance: unknown): BalanceState => {
  const value = Number(balance) || 0;
  if (Math.abs(value) < BALANCE_EPSILON) return 'settled';
  return value > 0 ? 'due' : 'advance';
};

export const digitsOnly = (value?: string | null) => String(value ?? '').replace(/\D/g, '');

/** "+92 300 1234567", "0092300..." and "0300-1234567" all become "03001234567" so they compare equal. */
export const canonicalPhone = (value?: string | null) => {
  let digits = digitsOnly(value);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('92') && digits.length >= 12) digits = `0${digits.slice(2)}`;
  else if (digits.length === 10 && digits.startsWith('3')) digits = `0${digits}`;
  return digits;
};

/** wa.me wants the number with the country code and no leading zero: 923001234567. */
export const whatsAppNumber = (raw?: string | null) => {
  const local = canonicalPhone(raw);
  if (!local) return '';
  return local.startsWith('0') ? `92${local.slice(1)}` : local;
};

export const openWhatsApp = (phone: string, message: string) => {
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
};

export const customerPhones = (customer: Customer) => {
  const extra = customer.additional_phones?.length
    ? customer.additional_phones
    : customer.secondary_phone
      ? [{ phone: customer.secondary_phone, is_whatsapp: Boolean(customer.is_secondary_whatsapp), label: 'Secondary' }]
      : [];
  return extra.filter(p => p && String(p.phone || '').trim() !== '');
};

export const hasWhatsApp = (customer: Customer) => Boolean(customer.whatsapp || customer.is_phone_whatsapp);

export const customerInitial = (name?: string) => (String(name || '').trim().charAt(0) || '?').toUpperCase();

// ---------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------

export interface CustomerSearchRow {
  /** name, phone, city and address, lower case */
  text: string;
  /** every phone of the customer in canonical form, space separated so a match never spans two numbers */
  phones: string;
}

export const buildCustomerSearchIndex = (customers: Customer[]) => {
  const index = new Map<string, CustomerSearchRow>();
  for (const c of customers) {
    if (!c) continue;
    const phones = [c.phone, c.whatsapp, ...customerPhones(c).map(p => p.phone)].map(canonicalPhone).filter(Boolean);
    index.set(c.id, {
      text: `${c.name || ''} ${c.phone || ''} ${c.city || ''} ${c.address || ''}`.toLowerCase(),
      phones: phones.join(' '),
    });
  }
  return index;
};

interface SaleSearchRow { customerId: string; bill: string; billAlpha: string; idAlpha: string }

export const buildSaleSearchIndex = (sales: POSBill[]): SaleSearchRow[] => {
  const rows: SaleSearchRow[] = [];
  for (const s of sales) {
    const customerId = s.customer_id || s.details?.customer_id;
    if (!customerId) continue;
    const bill = String(s.bill_number || '').toLowerCase();
    rows.push({ customerId, bill, billAlpha: bill.replace(/[^a-z0-9]/g, ''), idAlpha: String(s.id || '').toLowerCase().replace(/[^a-z0-9]/g, '') });
  }
  return rows;
};

/**
 * Customers whose bills match the query. Only a query that looks like a bill number (has a digit, or
 * starts with #) is matched against bills, and sale ids only from 8 characters: short name queries such
 * as "ali" or "deb" used to match the hex in random sale ids and pull unrelated customers into the list.
 */
export const customersWithMatchingBills = (rawQuery: string, saleIndex: SaleSearchRow[]) => {
  const ids = new Set<string>();
  const query = rawQuery.toLowerCase().trim();
  const billQuery = query.replace(/^[#\s]+/, '').trim();
  const billAlpha = billQuery.replace(/[^a-z0-9]/g, '');
  const looksLikeBill = (billAlpha.length >= 4 && /\d/.test(billAlpha)) || (query.startsWith('#') && billAlpha.length >= 2);
  if (!looksLikeBill) return ids;
  for (const row of saleIndex) {
    if (ids.has(row.customerId)) continue;
    if ((row.bill && row.bill.includes(billQuery)) || (row.billAlpha && row.billAlpha.includes(billAlpha)) || (billAlpha.length >= 8 && row.idAlpha.includes(billAlpha))) {
      ids.add(row.customerId);
    }
  }
  return ids;
};

export const matchesCustomerQuery = (row: CustomerSearchRow | undefined, query: string, queryPhone: string) => {
  if (!row) return false;
  if (row.text.includes(query)) return true;
  return queryPhone.length >= 3 && row.phones.includes(queryPhone);
};

// ---------------------------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------------------------

export type LedgerType = 'Sale' | 'Payment' | 'Charge' | 'Return';
export type LedgerFilter = 'All' | LedgerType;

export interface LedgerEntry {
  id: string;
  /** Business day, "YYYY-MM-DD" */
  date: string;
  /** "23 Oct 2026" */
  dateLabel: string;
  timestamp?: string;
  description: string;
  debit: number;
  credit: number;
  type: LedgerType;
  mode?: string;
  note?: string;
  status?: string;
  return_reason?: string;
  refund_amount?: number;
  isReturned?: boolean;
  isPartiallyReturned?: boolean;
  canDelete: boolean;
  runningBalance: number;
  sale?: POSBill;
  rawTx?: any;
}

export interface LedgerSummary {
  /** Newest first, each with the balance after it. */
  entries: LedgerEntry[];
  totalDebit: number;
  totalCredit: number;
  /** Stored ledger balance minus what the entries add up to; non-zero means the history is incomplete or wrong. */
  ledgerGap: number;
  returnedCount: number;
  returnedAmount: number;
}

export const EMPTY_LEDGER: LedgerSummary = { entries: [], totalDebit: 0, totalCredit: 0, ledgerGap: 0, returnedCount: 0, returnedAmount: 0 };

const isAlnum = (ch: string | undefined) => Boolean(ch && /[a-z0-9]/i.test(ch));

/**
 * True when `text` mentions `bill` as a whole token. A plain substring test made a note such as
 * "Sale #INV-251023-AB12CD7" (or any note that happens to contain a short bill number) match, and a
 * matched Charge is hidden from the ledger as a duplicate of the bill.
 */
export const mentionsBill = (text: string | undefined, bill: string | undefined) => {
  if (!text || !bill) return false;
  let from = text.indexOf(bill);
  while (from !== -1) {
    if (!isAlnum(text[from - 1]) && !isAlnum(text[from + bill.length])) return true;
    from = text.indexOf(bill, from + 1);
  }
  return false;
};

const timeOf = (value?: string) => {
  const ms = Date.parse(String(value || '').trim().replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : 0;
};

export const indexByCustomer = <T,>(rows: T[], customerIdOf: (row: T) => string | undefined) => {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const id = customerIdOf(row);
    if (!id) continue;
    const bucket = map.get(id);
    if (bucket) bucket.push(row);
    else map.set(id, [row]);
  }
  return map;
};

export const saleCustomerId = (s: POSBill) => s.customer_id || s.details?.customer_id;

// Value returned, once per bill. The ledger Return row of a bill is the same goods as the bill's
// refund, so adding both (or a returned bill's full debit) counted the return twice.
const returnedValue = (entries: LedgerEntry[]) => roundCurrency(entries
  .filter(e => e.sale && !e.rawTx && (e.isReturned || e.isPartiallyReturned))
  .reduce((sum, e) => sum + (Number(e.refund_amount || 0) || (e.isReturned ? e.debit : 0)), 0));

/**
 * The customer's ledger: POS bills plus manual ledger rows, oldest first for the running balance,
 * returned newest first. Pure, so the page can memoise it per customer.
 */
export function buildLedger(
  customer: Customer,
  customerSales: POSBill[],
  customerTxs: CustomerTransaction[],
  salesById: Map<string, POSBill>,
  canDelete: boolean,
): LedgerSummary {
  const entries: Omit<LedgerEntry, 'runningBalance' | 'dateLabel'>[] = [];
  const posSaleIds = new Set<string>();
  const ownSales = customerSales.filter(s => s.status !== ('Cancelled' as any));

  for (const s of ownSales) {
    posSaleIds.add(s.id);
    const itemNames = (s.items || []).map(i => `${i.qty}x ${i.name}`).join(', ');
    const status = String(s.status || '');
    const isReturned = status === 'Returned';
    const isPartiallyReturned = status === 'Partially Returned';
    entries.push({
      id: s.id,
      date: localDay(s.date),
      timestamp: s.date,
      description: `POS Bill #${s.bill_number} (${itemNames || 'Dairy Items'})`,
      debit: Number(s.total) || 0,
      // What was actually collected on the bill; the unpaid part stays on credit (the matching
      // ctx_ charge row is skipped below, so it must not be counted as paid here).
      credit: salePaidAmount(s),
      type: isReturned ? 'Return' : 'Sale',
      mode: s.payment_mode,
      status,
      return_reason: s.return_reason,
      refund_amount: s.refund_amount ? Number(s.refund_amount) : undefined,
      isReturned,
      isPartiallyReturned,
      canDelete: false,
      sale: s,
    });
  }

  for (const tx of customerTxs) {
    const details = (tx as any).details || {};
    const note: string | undefined = tx.note || details.note;
    const rawType = String(tx.type);
    const isPayment = rawType === 'Payment';
    const isCharge = rawType === 'Charge' || rawType === 'Debit';
    const isReturn = rawType === 'Return';

    // Skip the ledger charge of a credit bill: the bill row above already carries it.
    const isDuplicateSaleCharge = isCharge && (
      (tx.id.startsWith('ctx_') && posSaleIds.has(tx.id.slice(4))) ||
      ownSales.some(s => mentionsBill(note, s.bill_number))
    );
    if (isDuplicateSaleCharge) continue;

    const matchedSale =
      (details.sale_id && salesById.get(details.sale_id)) ||
      (details.order_id && salesById.get(details.order_id)) ||
      ownSales.find(s => mentionsBill(note, s.bill_number)) ||
      undefined;

    const isOpeningBalance = details.mode === 'Opening Balance' || tx.mode === 'Opening Balance' || tx.id.startsWith('ctx_op_');
    const noteText = note || (details.mode === 'Balance Adjustment' ? 'Unrecorded Delivery Sales Adjustment' : '');
    let description = `Ledger Charge: ${noteText || 'Manual Debit'}`;
    if (isOpeningBalance) {
      description = `Opening Balance${noteText && !noteText.toLowerCase().includes('opening balance') ? `: ${noteText}` : ''}`;
    } else if (isPayment) {
      description = `Payment Received (${tx.mode || details.mode || 'Cash'})`;
    } else if (isReturn) {
      description = `Sales Return / Credit: ${noteText || 'Items Returned'}`;
    }

    const amount = Number(tx.amount) || 0;
    entries.push({
      id: tx.id,
      date: localDay(tx.date),
      timestamp: tx.created_at || tx.date,
      description,
      debit: isCharge ? amount : 0,
      credit: isPayment || isReturn ? amount : 0,
      // "Debit" is an older spelling of a ledger charge; it now filters with the charges.
      type: (isCharge ? 'Charge' : rawType) as LedgerType,
      mode: tx.mode || details.mode,
      note: tx.note,
      status: isReturn ? 'Returned' : undefined,
      isReturned: isReturn,
      // Returns are undone from Sales History; an order advance is refunded, not deleted.
      // Deleting an entry moves ledger and account money back, so it needs the delete right.
      canDelete: canDelete && !isReturn && details.source !== 'customer_order_advance' && !String(tx.id).startsWith('ctx_adv_'),
      sale: matchedSale || undefined,
      rawTx: tx,
    });
  }

  // Oldest first by the shop's day, then by when it was posted that day. Sorting by the posting time
  // alone put a back-dated payment at the top of the list under an older date, and its running
  // balance after entries it came before.
  const keyed = entries.map(entry => ({ entry, ms: timeOf(entry.timestamp || entry.date) }));
  keyed.sort((a, b) => (a.entry.date === b.entry.date ? a.ms - b.ms : a.entry.date < b.entry.date ? -1 : 1));

  let running = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  const withBalance: LedgerEntry[] = keyed.map(({ entry }) => {
    totalDebit += entry.debit;
    totalCredit += entry.credit;
    running = running + entry.debit - entry.credit;
    return { ...entry, dateLabel: formatDay(entry.date), runningBalance: roundCurrency(running) };
  });

  return {
    entries: withBalance.reverse(),
    totalDebit: roundCurrency(totalDebit),
    totalCredit: roundCurrency(totalCredit),
    ledgerGap: roundCurrency(Number(customer.balance || 0) - running),
    returnedCount: withBalance.filter(e => e.isReturned).length,
    returnedAmount: returnedValue(withBalance),
  };
}

export interface LedgerPeriod {
  /** Entries of the duration, newest first, keeping the running balance of the full ledger. */
  entries: LedgerEntry[];
  /** Balance carried in from before the duration. */
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  returnedAmount: number;
}

/**
 * One duration of the ledger ("YYYY-MM-DD" business days, both included; a blank end is open).
 * Opening + debit - credit always equals closing, so a printed statement adds up on paper.
 */
export function ledgerForPeriod(entries: LedgerEntry[], from: string, to: string): LedgerPeriod {
  const shown = entries.filter(e => (!from || e.date >= from) && (!to || e.date <= to));
  // Entries are newest first, so the first one before the duration holds the balance carried in.
  const openingBalance = from ? entries.find(e => e.date < from)?.runningBalance ?? 0 : 0;
  const totalDebit = roundCurrency(shown.reduce((sum, e) => sum + e.debit, 0));
  const totalCredit = roundCurrency(shown.reduce((sum, e) => sum + e.credit, 0));
  return {
    entries: shown,
    openingBalance,
    totalDebit,
    totalCredit,
    closingBalance: roundCurrency(openingBalance + totalDebit - totalCredit),
    returnedAmount: returnedValue(shown),
  };
}

export const isReturnEntry = (entry: LedgerEntry) => Boolean(entry.isReturned || entry.type === 'Return');

export const matchesLedgerType = (entry: LedgerEntry, filter: LedgerFilter) =>
  filter === 'All' ||
  (filter === 'Sale' && entry.type === 'Sale' && !entry.isReturned) ||
  (filter === 'Return' && (entry.type === 'Return' || entry.isReturned || entry.isPartiallyReturned)) ||
  entry.type === filter;

export const filterLedger = (entries: LedgerEntry[], filter: LedgerFilter, rawQuery: string) => {
  const q = rawQuery.toLowerCase().trim();
  if (filter === 'All' && !q) return entries;
  const cleanQ = q.replace(/^[#\s]+/, '').trim();
  const alphaQ = q.replace(/[^a-z0-9]/g, '');
  const numQ = parseFloat(q.replace(/^(rs\.?|pkr)\s*/i, '').replace(/,/g, ''));
  return entries.filter(entry => {
    if (!matchesLedgerType(entry, filter)) return false;
    if (!q) return true;
    const descLower = entry.description.toLowerCase();
    const billLower = (entry.sale?.bill_number || '').toLowerCase();
    return (
      descLower.includes(q) ||
      (cleanQ && descLower.includes(cleanQ)) ||
      (entry.note || '').toLowerCase().includes(q) ||
      (entry.return_reason || '').toLowerCase().includes(q) ||
      entry.date.includes(q) ||
      entry.dateLabel.toLowerCase().includes(q) ||
      (cleanQ && billLower && (billLower.includes(cleanQ) || cleanQ.includes(billLower))) ||
      (alphaQ.length >= 2 && (descLower.replace(/[^a-z0-9]/g, '').includes(alphaQ) || billLower.replace(/[^a-z0-9]/g, '').includes(alphaQ))) ||
      (!isNaN(numQ) && numQ > 0 && (Math.abs(entry.debit - numQ) < 0.01 || Math.abs(entry.credit - numQ) < 0.01))
    );
  });
};

// ---------------------------------------------------------------------------------------------
// Dates and amounts
// ---------------------------------------------------------------------------------------------

const PKT_DATE = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' });
const PKT_TIME = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Karachi' });

/**
 * Bill date and time in Pakistan time. A date-only value has no time, so none is shown (it used to
 * print a made-up "05:00 AM", and the device's own zone decided the day).
 */
export const formatSaleDateTime = (dateStr?: string, timeStr?: string): { date: string; time: string } => {
  if (!dateStr) return { date: 'N/A', time: timeStr || '' };
  const raw = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T12:00:00+05:00`);
    return { date: Number.isFinite(d.getTime()) ? PKT_DATE.format(d) : raw, time: timeStr || '' };
  }
  const d = new Date(raw.replace(' ', 'T'));
  if (!Number.isFinite(d.getTime())) return { date: raw, time: timeStr || '' };
  return { date: PKT_DATE.format(d), time: PKT_TIME.format(d) || timeStr || '' };
};

/** "12-03-2026" style day label for a "YYYY-MM-DD" business day. */
export const formatDay = (day: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const d = new Date(`${day}T12:00:00+05:00`);
  return Number.isFinite(d.getTime()) ? PKT_DATE.format(d) : day;
};

/**
 * Parses a typed rupee amount. Accepts "1,250" and "1250.5"; rejects "12abc", "1e5", blanks, zero,
 * negatives and more than 2 decimals (parseFloat used to read "12abc" as 12 and "1e5" as 100000).
 */
export const parseAmount = (raw: string): { value: number; error?: string } => {
  const text = String(raw ?? '').trim().replace(/,/g, '');
  if (!text) return { value: 0, error: 'Enter an amount' };
  if (!/^\d*\.?\d*$/.test(text) || text === '.') return { value: 0, error: 'Numbers only, like 1250 or 1250.50' };
  if (/\.\d{3,}$/.test(text)) return { value: 0, error: 'Use at most 2 decimal places' };
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return { value: 0, error: 'Amount must be more than 0' };
  if (value > 100_000_000) return { value: 0, error: 'Amount is too large, please check it' };
  return { value: roundCurrency(value) };
};

/** Plain-text label of a ledger balance for WhatsApp and print: "Rs 1,200 (Due)". */
export const balanceWords = (balance: number, format: (n: number) => string) => {
  const state = balanceState(balance);
  if (state === 'settled') return `${format(0)} (Settled)`;
  return `${format(Math.abs(balance))} (${state === 'due' ? 'Due' : 'Advance'})`;
};

export const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
