import { describe, expect, it } from 'vitest';
import {
  expenseCashPaid,
  isInternalCashTransfer,
  isPurchaseReturnTx,
  isSalesRefundTx,
  isSpotSupplierPayment,
  materialCashPaid,
  netPurchaseReturnRefunds,
  proportionalRefund,
  purchaseCashPaid,
  saleCashCollected,
  saleNetCollection,
  saleOnlineCollected,
  salePaidAmount,
  splitRefund
} from '../moneyFlow';

describe('money collected on a bill', () => {
  it('counts a cash or online bill as fully paid and credit as unpaid', () => {
    expect(salePaidAmount({ total: 1200, payment_mode: 'Cash' })).toBe(1200);
    expect(salePaidAmount({ total: 1200, payment_mode: 'Online' })).toBe(1200);
    expect(salePaidAmount({ total: 1200, payment_mode: 'Credit' })).toBe(0);
  });

  it('uses the recorded down payment, capped at the bill', () => {
    expect(salePaidAmount({ total: 1200, payment_mode: 'Credit', paid_amount: 500 })).toBe(500);
    expect(salePaidAmount({ total: 1200, payment_mode: 'Credit', details: { paid_amount: 300 } })).toBe(300);
    expect(salePaidAmount({ total: 1200, paid_amount: 5000 })).toBe(1200);
    expect(salePaidAmount({ total: 1200, paid_amount: -50 })).toBe(0);
    expect(salePaidAmount({ total: -10, payment_mode: 'Cash' })).toBe(0);
    expect(salePaidAmount(null)).toBe(0);
  });

  it('splits till cash from online', () => {
    expect(saleCashCollected({ total: 800, payment_mode: 'Cash' })).toBe(800);
    expect(saleCashCollected({ total: 800, payment_mode: 'Online' })).toBe(0);
    expect(saleCashCollected({ total: 800, payment_mode: 'Credit', paid_amount: 200 })).toBe(200);
    expect(saleOnlineCollected({ total: 800, payment_mode: 'Online' })).toBe(800);
    expect(saleOnlineCollected({ total: 800, payment_mode: 'Cash' })).toBe(0);
  });
});

describe('refunds', () => {
  const discounted = { subtotal: 1000, total: 900, payment_mode: 'Cash' };

  it('applies the bill discount rate to returned lines', () => {
    expect(proportionalRefund(discounted, [{ qty: 2, price: 100 }])).toBe(180);
    expect(proportionalRefund({ subtotal: 0, total: 0 }, [{ qty: 1, price: 50 }])).toBe(0);
  });

  it('never refunds more than is left on the bill', () => {
    expect(proportionalRefund({ ...discounted, refund_amount: 850 }, [{ qty: 2, price: 100 }])).toBe(50);
    expect(proportionalRefund({ ...discounted, refund_amount: 900 }, [{ qty: 1, price: 100 }])).toBe(0);
  });

  it('reverses the ledger (credit) first, then cash', () => {
    const credit = { total: 1000, payment_mode: 'Credit', paid_amount: 400 };
    expect(splitRefund(credit, 700)).toEqual({ khata: 600, cash: 100 });
    expect(splitRefund({ ...credit, refund_amount: 300 }, 500)).toEqual({ khata: 300, cash: 200 });
    expect(splitRefund({ total: 500, payment_mode: 'Cash' }, 200)).toEqual({ khata: 0, cash: 200 });
    expect(splitRefund({ total: 500, payment_mode: 'Credit' }, 200)).toEqual({ khata: 200, cash: 0 });
    expect(splitRefund({ total: 500, payment_mode: 'Cash' }, -20)).toEqual({ khata: 0, cash: 0 });
  });

  it('keeps net collection consistent with the refund split', () => {
    const sale = { total: 1000, payment_mode: 'Credit', paid_amount: 400, refund_amount: 700 };
    expect(saleNetCollection(sale)).toEqual({ cash: 300, online: 0, credit: 0, net: 300 });
    expect(saleNetCollection({ total: 1000, payment_mode: 'Online', refund_amount: 250 })).toEqual({ cash: 0, online: 750, credit: 0, net: 750 });
    expect(saleNetCollection({ total: 1000, payment_mode: 'Credit', paid_amount: 400, refund_amount: 100 })).toEqual({ cash: 400, online: 0, credit: 500, net: 900 });
    expect(saleNetCollection({ total: 1000, payment_mode: 'Cash', refund_amount: 5000 })).toEqual({ cash: 0, online: 0, credit: 0, net: 0 });
  });
});

describe('cash paid on expenses and purchases', () => {
  it('reads the paid part of an expense', () => {
    expect(expenseCashPaid({ amount: 1000, paidAmount: 400 })).toBe(400);
    expect(expenseCashPaid({ amount: 1000, details: { paid_amount: 250 } })).toBe(250);
    expect(expenseCashPaid({ amount: 1000, paymentStatus: 'Unpaid' })).toBe(0);
    expect(expenseCashPaid({ amount: 1000 })).toBe(1000);
  });

  it('keeps the original paid amount after a partial purchase return', () => {
    expect(purchaseCashPaid({ paid_amount: 600, original_paid_amount: 1000 })).toBe(1000);
    expect(purchaseCashPaid({ paid_amount: 600 })).toBe(600);
    expect(purchaseCashPaid({})).toBe(0);
  });

  it('does not treat a legacy unpaid supplier ledger balance as cash', () => {
    expect(materialCashPaid({ total_amount: 900, supplier_id: 'sup1' })).toBe(0);
    expect(materialCashPaid({ total_amount: 900 })).toBe(900);
    expect(materialCashPaid({ total_amount: 900, supplier_id: 'sup1', paid_amount: 300 })).toBe(300);
  });
});

describe('transaction classifiers', () => {
  it('recognises transfers, spot payments and returns', () => {
    expect(isInternalCashTransfer({ type: 'Transfer_In' })).toBe(true);
    expect(isInternalCashTransfer({ type: 'Expense', category: 'Cash Remittance' })).toBe(true);
    expect(isInternalCashTransfer({ type: 'Income', category: 'POS Sale' })).toBe(false);
    expect(isSpotSupplierPayment({ id: 'stx_pur_123' })).toBe(true);
    expect(isSpotSupplierPayment({ details: { purchase_id: 'p1' } })).toBe(true);
    expect(isSpotSupplierPayment({ note: 'Spot Payment for Milk Intake #4' })).toBe(true);
    expect(isSpotSupplierPayment({ id: 'stx_99', note: 'Monthly payment' })).toBe(false);
    expect(isSalesRefundTx({ category: 'Sales Return' })).toBe(true);
    expect(isSalesRefundTx({ description: 'POS sales refund #12' })).toBe(true);
    expect(isPurchaseReturnTx({ category: 'Purchase Return' })).toBe(true);
    expect(isPurchaseReturnTx({ description: 'Return cash refund from supplier' })).toBe(true);
  });
});

describe('netPurchaseReturnRefunds', () => {
  const outflow = { id: 'btx_pur_p1', title: 'Milk intake · Ali', amount: 5000, category: 'Milk Purchase', time: '2026-10-23T05:00:00Z' };

  it('nets a same-shift return against its purchase', () => {
    const result = netPurchaseReturnRefunds({
      outflows: [outflow],
      refunds: [{ id: 'r1', type: 'Income', category: 'Purchase Return', amount: 2000, reference_id: 'p1', shift_session_id: 's1' }],
      purchases: [{ id: 'p1', shift_session_id: 's1', supplier_id: 'sup1' }]
    });
    expect(result.netted).toBe(2000);
    expect(result.outflows[0].amount).toBe(3000);
    expect(result.cashIn).toEqual([]);
  });

  it('drops a fully returned purchase from the outflows', () => {
    const result = netPurchaseReturnRefunds({
      outflows: [outflow],
      refunds: [{ id: 'r1', type: 'Income', category: 'Purchase Return', amount: 5000, reference_id: 'p1' }],
      purchases: [{ id: 'p1' }]
    });
    expect(result.outflows).toEqual([]);
    expect(result.netted).toBe(5000);
  });

  it('shows the return of an earlier shift purchase as cash received', () => {
    const result = netPurchaseReturnRefunds({
      outflows: [],
      refunds: [{ id: 'r1', type: 'Income', category: 'Purchase Return', amount: 1500, reference_id: 'p1', shift_session_id: 's2', date: '2026-10-23T09:00:00Z' }],
      purchases: [{ id: 'p1', shift_session_id: 's1', supplier_id: 'sup1' }],
      suppliers: [{ id: 'sup1', name: 'Ali Dairy Farm' }]
    });
    expect(result.netted).toBe(0);
    expect(result.cashIn).toHaveLength(1);
    expect(result.cashIn[0]).toMatchObject({ amount: 1500, partyName: 'Ali Dairy Farm', category: 'Purchase Return' });
  });

  it('ignores refunds that are not purchase-return income', () => {
    const result = netPurchaseReturnRefunds({
      outflows: [outflow],
      refunds: [{ id: 'r1', type: 'Expense', category: 'Purchase Return', amount: 2000, reference_id: 'p1' }]
    });
    expect(result.outflows[0].amount).toBe(5000);
    expect(result.cashIn).toEqual([]);
  });
});
