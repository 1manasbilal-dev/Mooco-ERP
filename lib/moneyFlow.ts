import { roundCurrency } from './db';

/** Cash/online actually collected on a bill, capped at the bill total. Credit with no down payment is 0. */
export function salePaidAmount(sale: any): number {
  const total = Math.max(0, Number(sale?.total || 0));
  const explicit = sale?.paid_amount ?? sale?.details?.paid_amount;
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    return roundCurrency(Math.min(Math.max(0, Number(explicit) || 0), total));
  }
  const mode = String(sale?.payment_mode || '').toLowerCase();
  if (mode === 'credit') return 0;
  return roundCurrency(total);
}

/** Till cash: cash bills and cash handed over on a credit bill. Online is excluded. */
export function saleCashCollected(sale: any): number {
  const mode = String(sale?.payment_mode || '').toLowerCase();
  if (mode === 'online') return 0;
  return salePaidAmount(sale);
}

export function saleOnlineCollected(sale: any): number {
  const mode = String(sale?.payment_mode || '').toLowerCase();
  if (mode !== 'online') return 0;
  return salePaidAmount(sale);
}

/** Line prices are before the bill discount, so the refund follows the same discount rate and cannot exceed what is still refundable. */
export function proportionalRefund(sale: any, lines: Array<{ qty?: number; price?: number }>): number {
  const gross = lines.reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.price) || 0), 0);
  const subtotal = Number(sale?.subtotal || 0);
  const billTotal = Number(sale?.total ?? subtotal);
  const ratio = subtotal > 0 ? billTotal / subtotal : 1;
  const raw = roundCurrency(Math.max(0, gross * ratio));
  const already = roundCurrency(Number(sale?.refund_amount || 0));
  const cap = roundCurrency(Math.max(0, billTotal - already));
  return roundCurrency(Math.min(raw, cap));
}

/**
 * Khata is reversed first. Cash/bank is refunded only for the part the customer had actually paid.
 */
export function splitRefund(sale: any, refundAmount: number): { khata: number; cash: number } {
  const total = Math.max(0, Number(sale?.total || 0));
  const collected = salePaidAmount(sale);
  const khataCharged = roundCurrency(Math.max(0, total - collected));
  const already = roundCurrency(Number(sale?.refund_amount || 0));
  const priorKhata = roundCurrency(Math.min(already, khataCharged));
  const remainingKhata = roundCurrency(Math.max(0, khataCharged - priorKhata));
  const amount = roundCurrency(Math.max(0, refundAmount));
  const khata = roundCurrency(Math.min(amount, remainingKhata));
  const cash = roundCurrency(Math.max(0, amount - khata));
  return { khata, cash };
}

export function expenseCashPaid(expense: any): number {
  const explicit = expense?.paidAmount ?? expense?.paid_amount ?? expense?.details?.paidAmount ?? expense?.details?.paid_amount;
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    return roundCurrency(Math.max(0, Number(explicit) || 0));
  }
  const status = String(expense?.paymentStatus || expense?.payment_status || expense?.details?.paymentStatus || '').toLowerCase();
  if (status === 'unpaid') return 0;
  return roundCurrency(Math.max(0, Number(expense?.amount || 0)));
}

/** Cash paid on intake. After a partial return the live paid_amount shrinks, but original_paid_amount stays so the outflow is not counted twice with the refund. */
export function purchaseCashPaid(row: any): number {
  const original = row?.original_paid_amount ?? row?.details?.original_paid_amount;
  if (original !== undefined && original !== null && original !== '') {
    return roundCurrency(Math.max(0, Number(original) || 0));
  }
  const paid = row?.paid_amount ?? row?.details?.paid_amount;
  return roundCurrency(Math.max(0, Number(paid) || 0));
}

/** Cash that left an account for this material line. Legacy supplier bills did not store the split, so unpaid khata is not treated as cash. */
export function materialCashPaid(row: any): number {
  const explicit = row?.paid_amount ?? row?.details?.paid_amount;
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    return roundCurrency(Math.max(0, Number(explicit) || 0));
  }
  if (!row?.supplier_id) return roundCurrency(Math.max(0, Number(row?.total_amount || 0)));
  return 0;
}

export function bankTxCategory(tx: any): string {
  return String(tx?.category || tx?.details?.category || '');
}

export function isInternalCashTransfer(tx: any): boolean {
  const type = String(tx?.type || '');
  const category = bankTxCategory(tx);
  return type === 'Transfer_In' || type === 'Transfer_Out' || category === 'Cash Remittance' || category === 'Transfer';
}

/** Spot milk/material payments are already counted on the purchase. Counting the supplier ledger row again doubles the cash out. */
export function isSpotSupplierPayment(tx: any): boolean {
  if (tx?.purchase_id || tx?.details?.purchase_id) return true;
  const note = String(tx?.note || tx?.details?.note || '');
  return note.startsWith('Spot Payment for Milk Intake') || note.startsWith('Spot Payment for Material Purchase');
}

export function isSalesRefundTx(tx: any): boolean {
  const category = bankTxCategory(tx).toLowerCase();
  const description = String(tx?.description || tx?.details?.description || '').toLowerCase();
  return category.includes('sales return') || description.includes('sales refund');
}

export function isPurchaseReturnTx(tx: any): boolean {
  const category = bankTxCategory(tx).toLowerCase();
  const description = String(tx?.description || tx?.details?.description || '').toLowerCase();
  return category.includes('purchase return') || description.includes('return cash refund');
}

export interface ShiftOutflowLine {
  id: string;
  title: string;
  amount: number;
  category: string;
  group?: string;
  partyName?: string;
  details?: string;
  time?: string;
}

export interface PurchaseReturnCashIn {
  id: string;
  title: string;
  partyName: string;
  amount: number;
  category: string;
  source: string;
  details: string;
  time?: string;
}

const txTime = (value?: string) => {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : NaN;
};

const isPurchaseOutflow = (item: ShiftOutflowLine) => {
  const category = String(item.category || '').toLowerCase();
  const group = String(item.group || '').toLowerCase();
  return category.includes('purchase') || category.includes('milk') || group.includes('material') || group.includes('milk');
};

/**
 * A purchase return puts cash back in the drawer. Same-shift returns cancel the
 * original cash purchase so it does not stay in shop expenses. A return of an
 * earlier shift's purchase is cash received in this shift.
 */
export function netPurchaseReturnRefunds(input: {
  outflows: ShiftOutflowLine[];
  refunds: any[];
  purchases?: any[];
  materialPurchases?: any[];
  suppliers?: Array<{ id: string; name?: string }>;
  expenseLinks?: Array<{ id: string; reference_id?: string | null }>;
}): { outflows: ShiftOutflowLine[]; netted: number; cashIn: PurchaseReturnCashIn[] } {
  const outflows = input.outflows.map(item => ({ ...item, amount: roundCurrency(item.amount) }));
  const purchases = [...(input.purchases || []), ...(input.materialPurchases || [])];
  const supplierName = (id?: string) => input.suppliers?.find(s => s.id === id)?.name || '';
  const cashIn: PurchaseReturnCashIn[] = [];
  let netted = 0;

  const claim = (item: ShiftOutflowLine, amount: number) => {
    const applied = roundCurrency(Math.min(item.amount, amount));
    if (applied <= 0) return 0;
    item.amount = roundCurrency(item.amount - applied);
    if (item.amount > 0.01) {
      item.details = `${item.details || item.category} · Rs ${applied.toLocaleString('en-PK')} returned`;
    }
    netted = roundCurrency(netted + applied);
    return applied;
  };

  for (const refund of input.refunds || []) {
    if (!isPurchaseReturnTx(refund) || String(refund?.type || '').toLowerCase() !== 'income') continue;
    let remaining = roundCurrency(Number(refund.amount || 0));
    if (remaining <= 0.01) continue;

    const ref = String(refund.reference_id || '');
    const source = ref ? purchases.find(row => row.id === ref) : undefined;
    const sourceShift = source?.shift_session_id;
    const refundShift = refund.shift_session_id;
    const sameShift = !source || !sourceShift || !refundShift || sourceShift === refundShift;

    if (sameShift && ref) {
      const linkedIds = new Set(
        (input.expenseLinks || [])
          .filter(link => String(link.reference_id || '').split(',').map(part => part.trim()).includes(ref))
          .map(link => link.id)
      );
      const direct = outflows.find(item =>
        item.amount > 0.01 && isPurchaseOutflow(item) && (
          item.id === ref || item.id === `btx_pur_${ref}` || linkedIds.has(item.id)
        )
      );
      if (direct) remaining = roundCurrency(remaining - claim(direct, remaining));
    }

    if (sameShift && remaining > 0.01 && source) {
      const sourceAt = txTime(source.date || source.created_at);
      const refundAt = txTime(refund.date || refund.created_at);
      const name = supplierName(source.supplier_id);
      const candidates = outflows.filter(item => {
        if (item.amount <= 0.01 || !isPurchaseOutflow(item)) return false;
        const at = txTime(item.time);
        if (!Number.isFinite(sourceAt) || !Number.isFinite(at) || Math.abs(at - sourceAt) > 120000) return false;
        if (Number.isFinite(refundAt) && at > refundAt + 15000) return false;
        if (name) {
          const label = `${item.title || ''} ${item.partyName || ''}`;
          if (!label.includes(name)) return false;
        }
        return true;
      }).sort((a, b) => Math.abs(txTime(a.time) - sourceAt) - Math.abs(txTime(b.time) - sourceAt));
      if (candidates[0]) remaining = roundCurrency(remaining - claim(candidates[0], remaining));
    }

    if (remaining > 0.01) {
      const name = supplierName(source?.supplier_id);
      cashIn.push({
        id: String(refund.id || `purchase_return_${cashIn.length}`),
        title: refund.description || 'Purchase return cash refund',
        partyName: name || 'Purchase return',
        amount: remaining,
        category: 'Purchase Return',
        source: 'Purchase Return',
        details: sameShift
          ? 'Cash received back from a returned purchase'
          : 'Cash received back from a purchase recorded on an earlier shift',
        time: refund.date || refund.created_at
      });
    }
  }

  return {
    outflows: outflows.filter(item => item.amount > 0.01),
    netted,
    cashIn
  };
}
