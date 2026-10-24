import type { POSBill } from '../../types';
import { cleanQty, isDateOnlyOrMidnight } from '../../lib/formatters';
import { businessDate } from '../../lib/dashboardAnalytics';

export interface ReturnItemSelection {
  itemId?: string;
  name: string;
  soldQty: number;
  remainingQty: number;
  returnQty: number;
  price: number;
  unit?: string;
  variantId?: string;
  isSelected: boolean;
  /** Position of the bill line, saved with the return so later returns match the exact line. */
  lineIndex?: number;
  /** Bill snapshot, passed through so the return restocks the pile the sale used. */
  lineUnit?: string;
  baseUnit?: string;
  stockDeduction?: number;
  deductFromBase?: boolean;
  isLoose?: boolean;
  /** Pre-packed lines go back in whole packs. */
  wholeOnly?: boolean;
}

/** Where a returned line's stock goes back to (or a replacement is taken from). */
export interface ReturnPile {
  kind: 'loose' | 'pack';
  /** "loose stock" or "500 g tub pack stock". */
  name: string;
  /** Stock moved for the given quantity: base units for loose, packs for a pack. Null when an old bill has no pack size. */
  amount: number | null;
  unit: string;
}

/**
 * The pile a bill line returns to, read from the bill's own snapshot (docs/stock-model.md, "Sales return"):
 * a ready-made pack line (wholeOnly) goes back to its pack count; loose and multi-unit (dozen) lines go
 * back to loose stock as quantity x pack size.
 */
export function returnLinePile(item: ReturnItemSelection, qty: number): ReturnPile {
  if (item.wholeOnly) {
    const unit = item.unit || 'pack';
    return { kind: 'pack', name: `${unit} pack stock`, amount: cleanQty(qty), unit };
  }
  const base = item.baseUnit || (item.variantId ? '' : item.lineUnit || item.unit || '');
  const contains = item.variantId && !item.isLoose ? (Number(item.stockDeduction) > 0 ? Number(item.stockDeduction) : null) : 1;
  return {
    kind: 'loose',
    name: 'loose stock',
    amount: contains === null ? null : cleanQty(qty * contains),
    unit: base,
  };
}

/** The return posts as spoilage (no stock back) when chosen, or when the reason itself says spoiled / defective. */
export function returnIsScrap(restockOption: 'restock' | 'scrap_spoilage', finalReason: string): boolean {
  return restockOption === 'scrap_spoilage' || /spoil|defect|kharab/i.test(finalReason);
}

export type SaleDateTime = { date: string; time: string };

const computeSaleDateTime = (dateStr?: string, fallbackTime?: string): SaleDateTime => {
  if (!dateStr) return { date: 'N/A', time: fallbackTime || '' };
  try {
    const safeStr = typeof dateStr === 'string' ? dateStr.trim().replace(' ', 'T') : dateStr;
    const d = new Date(safeStr);
    if (isNaN(d.getTime())) {
      const fallbackDate = new Date(dateStr);
      if (isNaN(fallbackDate.getTime())) return { date: dateStr, time: fallbackTime || '' };
      const dateFormatted = fallbackDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const isMidnight = isDateOnlyOrMidnight(dateStr);
      const timeFormatted = isMidnight ? (fallbackTime || '') : fallbackDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      return { date: dateFormatted, time: timeFormatted };
    }
    const dateFormatted = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const isMidnight = isDateOnlyOrMidnight(dateStr);
    let timeFormatted = isMidnight ? '' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    if (!timeFormatted && fallbackTime) {
      timeFormatted = fallbackTime;
    }
    return { date: dateFormatted, time: timeFormatted };
  } catch {
    return { date: dateStr, time: fallbackTime || '' };
  }
};

// toLocale*String is slow and search runs it for every bill on every keystroke. The result only
// depends on the two inputs, so it is cached by them (cleared when it grows past the limit).
const dateTimeCache = new Map<string, SaleDateTime>();
const DATE_TIME_CACHE_LIMIT = 20_000;

export const formatSaleDateTime = (dateStr?: string, fallbackTime?: string): SaleDateTime => {
  if (!dateStr) return { date: 'N/A', time: fallbackTime || '' };
  const key = `${dateStr}\u0001${fallbackTime || ''}`;
  let hit = dateTimeCache.get(key);
  if (!hit) {
    if (dateTimeCache.size >= DATE_TIME_CACHE_LIMIT) dateTimeCache.clear();
    hit = computeSaleDateTime(dateStr, fallbackTime);
    dateTimeCache.set(key, hit);
  }
  return hit;
};

/** Date and time shown for a bill everywhere on the screen (list, detail, receipt). */
export const saleDateTime = (sale: POSBill): SaleDateTime =>
  formatSaleDateTime(sale.date || (sale as any).created_at, (sale as any).time || sale.details?.time);

export const getLocalDateString = (dStr?: string | Date): string => {
  if (!dStr) return '';
  try {
    const d = typeof dStr === 'string' ? new Date(dStr) : dStr;
    if (isNaN(d.getTime())) {
      return typeof dStr === 'string' ? (dStr.includes('T') ? dStr.split('T')[0] : dStr) : '';
    }
    // Pakistan calendar day, whatever the terminal's clock zone is.
    return businessDate(d);
  } catch {
    return typeof dStr === 'string' ? (dStr.includes('T') ? dStr.split('T')[0] : dStr) : '';
  }
};

// The shop's own calendar day of a bill. Timestamps are UTC, so their raw "YYYY-MM-DD" prefix is the
// wrong day for bills made between 00:00 and 05:00 PKT; only a plain date string is taken as written.
export const saleDayKey = (saleDateStr?: string): string => {
  if (!saleDateStr) return '';
  const trimmed = String(saleDateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(trimmed.replace(' ', 'T'));
  return isNaN(d.getTime()) ? trimmed.slice(0, 10) : getLocalDateString(d);
};

/**
 * The old checkSaleDateMatches, with the bill's day key and today's key worked out once
 * (per bill / per filter pass) instead of for every bill on every keystroke.
 */
export const saleDayMatchesRange = (
  saleDateStr: string | undefined,
  saleDay: string,
  range: string,
  customD: string,
  today: string,
): boolean => {
  if (!saleDateStr) return true;
  if (range === 'all') return true;
  if (range === 'today') return saleDay === today;
  if (range === 'month') return saleDay.startsWith(today.slice(0, 7));
  if (range === 'custom' && customD) return saleDay === customD;
  return true;
};

export const matchSaleWithToken = (
  sale: POSBill,
  token: string,
  customerMap: Map<string, { phone: string; name: string }>
): boolean => {
  const tok = token.toLowerCase();
  const cleanTok = tok.replace(/^[#\s]+/, '').trim();
  const alphaTok = tok.replace(/[^a-z0-9]/g, '');

  const billNum = (sale.bill_number || '').toLowerCase();
  const saleId = (sale.id || '').toLowerCase();
  const fallbackBill5 = `inv-${saleId.slice(-5)}`;
  const fallbackBill6 = `inv-${saleId.slice(-6)}`;
  const orderNum = (sale.details?.order_number || sale.details?.customer_order_id || '').toString().toLowerCase();

  // Substring matching with or without hash prefix
  if (cleanTok) {
    if (billNum && (billNum.includes(cleanTok) || cleanTok.includes(billNum))) return true;
    if (fallbackBill5.includes(cleanTok) || fallbackBill6.includes(cleanTok)) return true;
    if (saleId.includes(cleanTok)) return true;
    if (orderNum && (orderNum.includes(cleanTok) || cleanTok.includes(orderNum))) return true;
  }

  // Alphanumeric matching (ignores dashes, spaces, e.g. "INV2610083E3CE7" or "2610083E3CE7" or "3E3CE7")
  if (alphaTok.length >= 2) {
    const alphaBill = billNum.replace(/[^a-z0-9]/g, '');
    const alphaId = saleId.replace(/[^a-z0-9]/g, '');
    const alphaOrder = orderNum.replace(/[^a-z0-9]/g, '');

    if (alphaBill && (alphaBill.includes(alphaTok) || alphaTok.includes(alphaBill))) return true;
    if (alphaId && alphaId.includes(alphaTok)) return true;
    if (alphaOrder && alphaOrder.includes(alphaTok)) return true;
    if (alphaBill && alphaBill.endsWith(alphaTok)) return true;
  }

  // Suffix matching (e.g. typing the 4-6 char hash suffix of an invoice)
  if (cleanTok.length >= 3 && billNum.endsWith(cleanTok)) return true;

  if (sale.customer_name && sale.customer_name.toLowerCase().includes(tok)) return true;
  const linkedCustomer = sale.customer_id ? customerMap.get(sale.customer_id) : undefined;
  if (linkedCustomer?.name && linkedCustomer.name.toLowerCase().includes(tok)) return true;

  const phoneDigits = alphaTok.replace(/\D/g, '');
  if (phoneDigits.length >= 3) {
    const salePhone = (sale.details?.customer_phone || '').replace(/\D/g, '');
    if (salePhone && salePhone.includes(phoneDigits)) return true;
    const linkedPhone = (linkedCustomer?.phone || '').replace(/\D/g, '');
    if (linkedPhone && linkedPhone.includes(phoneDigits)) return true;
  }

  if (sale.items && sale.items.length > 0) {
    const itemMatch = sale.items.some(it => {
      const itName = (it.name || '').toLowerCase();
      const variant = ((it as any).variantName || '').toLowerCase();
      const unit = ((it as any).unit || '').toLowerCase();
      if (itName.includes(tok) || variant.includes(tok) || unit.includes(tok)) return true;
      if (alphaTok.length >= 2 && itName.replace(/[^a-z0-9]/g, '').includes(alphaTok)) return true;
      return false;
    });
    if (itemMatch) return true;
  }

  const numericToken = tok.replace(/^(rs\.?|pkr)\s*/i, '').replace(/,/g, '').trim();
  const parsedNum = parseFloat(numericToken);
  if (!isNaN(parsedNum) && parsedNum > 0) {
    if (Math.abs((sale.total || 0) - parsedNum) < 0.01) return true;
    if (Math.abs((sale.subtotal || 0) - parsedNum) < 0.01) return true;
    if (sale.discount && Math.abs(sale.discount - parsedNum) < 0.01) return true;
    if (sale.refund_amount && Math.abs(sale.refund_amount - parsedNum) < 0.01) return true;
    if (sale.items?.some(it => Math.abs(it.price - parsedNum) < 0.01 || Math.abs((it.total || 0) - parsedNum) < 0.01)) {
      return true;
    }
  }
  if (numericToken.length >= 2 && sale.total?.toString().includes(numericToken)) return true;

  const modeStr = (sale.payment_mode || '').toLowerCase();
  if (modeStr.includes(tok)) return true;
  if ((tok === 'credit' || tok === 'khata' || tok === 'udhaar' || tok === 'due') && (sale.payment_mode === 'Credit' || Boolean(sale.customer_id))) {
    return true;
  }
  if ((tok === 'cash' || tok === 'nagad') && sale.payment_mode === 'Cash') return true;
  if ((tok === 'online' || tok === 'bank' || tok === 'digital') && sale.payment_mode === 'Online') return true;

  const statusStr = (sale.status || '').toLowerCase();
  if (statusStr.includes(tok)) return true;
  if ((tok === 'return' || tok === 'returned' || tok === 'wapsi') && (sale.status === 'Returned' || (sale as any).status === 'Partially Returned')) {
    return true;
  }
  if (sale.return_reason && sale.return_reason.toLowerCase().includes(tok)) return true;

  const { date: formattedDate, time: formattedTime } = saleDateTime(sale);
  if (formattedDate.toLowerCase().includes(tok)) return true;
  if (formattedTime && formattedTime.toLowerCase().includes(tok)) return true;
  if (sale.date && sale.date.toLowerCase().includes(tok)) return true;

  if (sale.cashier_name && sale.cashier_name.toLowerCase().includes(tok)) return true;
  if (sale.shift_name && sale.shift_name.toLowerCase().includes(tok)) return true;
  if (sale.details?.notes && typeof sale.details.notes === 'string' && sale.details.notes.toLowerCase().includes(tok)) return true;

  return false;
};

/** `POSBill.status` is typed 'Completed' | 'Returned', but bills are also saved as 'Partially Returned'. */
export const saleStatusOf = (sale: POSBill): string => String((sale as any).status || '');

/** Invoice number as shown ("INV-..." without a leading #). */
export const billLabel = (sale: POSBill): string =>
  sale.bill_number ? sale.bill_number.replace(/^#/, '') : `INV-${sale.id.slice(-6)}`;

/** Invoice number as copied to the clipboard (copyInvoiceNumber adds the #). */
export const billCopyValue = (sale: POSBill): string => sale.bill_number || `INV-${sale.id.slice(-6)}`;

export interface ModeChangeRules {
  /** canPerform('sales_history', 'edit') */
  canEdit: boolean;
  isDayLocked?: (date: string) => boolean;
  shiftById?: Map<string, { status?: string }>;
}

/**
 * Why updateSalePaymentMode (DairyContext) would refuse to switch this bill between Cash and
 * Online, or null when it may. Every "change mode" control on the screen, and the return
 * dialog's "mark original Online" option (which calls updateSalePaymentMode), use this one rule.
 */
export function saleModeLockReason(sale: POSBill, rules: ModeChangeRules): string | null {
  if (sale.payment_mode === 'Credit') return 'Udhaar bill — payment khaate se lein';
  const status = saleStatusOf(sale);
  if (status === 'Returned' || status === 'Partially Returned' || Number(sale.refund_amount || 0) > 0) {
    return 'Returned bill ka mode nahi badla ja sakta';
  }
  if (!rules.canEdit) return 'Aap ko bill ka payment mode badalne ki ijazat nahi hai';
  const shift = sale.shift_session_id ? rules.shiftById?.get(sale.shift_session_id) : undefined;
  if ((sale.date && rules.isDayLocked?.(sale.date)) || (shift && shift.status !== 'Active' && shift.status !== 'Closing')) {
    return 'Band shift / band din ka bill — mode nahi badla ja sakta';
  }
  return null;
}
