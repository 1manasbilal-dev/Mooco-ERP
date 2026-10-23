import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomerOrder, CustomerOrderLine } from '../../types';
import { localOrderDate, orderAmounts, orderIsOpen, unpostedAdvance } from '../customerOrders';

// The module talks to Supabase for saving; these tests only cover its pure helpers.
vi.mock('../supabase', () => ({ supabase: {} }));

const line = (qty: number, price: number): CustomerOrderLine => ({ itemId: 'i1', name: 'Kheer', qty, price, unit: 'pcs' });
const order = (patch: Partial<CustomerOrder>) => ({ status: 'Pending', advance_paid: 0, advance_posted: 0, ...patch }) as CustomerOrder;

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('orderAmounts', () => {
  it('totals lines, applies the discount and splits advance from remaining', () => {
    expect(orderAmounts([line(2, 350), line(1.5, 220)], 30, 500)).toEqual({
      subtotal: 1030, discount: 30, total: 1000, advance_paid: 500, remaining: 500, payment_status: 'Partial'
    });
  });

  it('marks a fully paid order and caps the advance at the total', () => {
    expect(orderAmounts([line(1, 1000)], 0, 1000)).toMatchObject({ advance_paid: 1000, remaining: 0, payment_status: 'Paid' });
    expect(orderAmounts([line(1, 1000)], 0, 1500)).toMatchObject({ advance_paid: 1000, remaining: 0, payment_status: 'Paid' });
  });

  it('treats no advance as unpaid and junk advance as zero', () => {
    expect(orderAmounts([line(1, 1000)])).toMatchObject({ advance_paid: 0, remaining: 1000, payment_status: 'Unpaid' });
    expect(orderAmounts([line(1, 1000)], 0, Number.NaN)).toMatchObject({ advance_paid: 0, payment_status: 'Unpaid' });
    expect(orderAmounts([line(1, 1000)], 0, -200)).toMatchObject({ advance_paid: 0, payment_status: 'Unpaid' });
  });

  it('rounds each line to the paisa before adding', () => {
    expect(orderAmounts([line(0.333, 150), line(0.333, 150)]).subtotal).toBe(99.9);
    expect(orderAmounts([line(3, 1.1)]).subtotal).toBe(3.3);
  });

  it('treats a free order as paid', () => {
    expect(orderAmounts([line(1, 0)])).toMatchObject({ total: 0, payment_status: 'Paid' });
  });
});

describe('order helpers', () => {
  it('knows which orders are still open', () => {
    expect(orderIsOpen(order({ status: 'Pending' }))).toBe(true);
    expect(orderIsOpen(order({ status: 'Ready' }))).toBe(true);
    expect(orderIsOpen(order({ status: 'Completed' }))).toBe(false);
    expect(orderIsOpen(order({ status: 'Cancelled' }))).toBe(false);
  });

  it('posts only the advance not posted yet', () => {
    expect(unpostedAdvance(order({ advance_paid: 1000, advance_posted: 400 }))).toBe(600);
    expect(unpostedAdvance(order({ advance_paid: 400, advance_posted: 1000 }))).toBe(0);
    expect(unpostedAdvance(order({ advance_paid: undefined, advance_posted: undefined }))).toBe(0);
  });

  it('dates orders on the Pakistan calendar on any device zone', () => {
    process.env.TZ = 'UTC';
    // 2026-10-22 20:00 UTC is 01:00 on the 23rd in Pakistan.
    expect(localOrderDate(new Date('2026-10-22T20:00:00Z'))).toBe('2026-10-23');
    expect(localOrderDate(new Date('2026-10-22T18:59:59Z'))).toBe('2026-10-22');
  });
});
