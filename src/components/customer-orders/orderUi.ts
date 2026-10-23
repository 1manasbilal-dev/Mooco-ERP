import type { CustomerOrder, CustomerOrderStatus } from '../../types';
import type { Tone } from '../ui';
import { formatCurrency } from '../../lib/formatters';
import { roundCurrency } from '../../lib/db';

/** Status pill colours: waiting = warning, confirmed = info, ready = brand, done = success, cancelled = danger. */
export const STATUS_TONE: Record<CustomerOrderStatus, Tone> = {
  Pending: 'warning',
  Confirmed: 'info',
  Ready: 'brand',
  Completed: 'success',
  Cancelled: 'danger',
};

export const STATUS_FILTERS = ['Active', 'All', 'Pending', 'Confirmed', 'Ready', 'Completed', 'Cancelled'] as const;
export type StatusFilter = typeof STATUS_FILTERS[number];

export const prettyDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });

/** Money as text (for strings, print and RichSelect badges). On screen prefer the `Money` component. */
export const orderMoney = (value: number) => formatCurrency(value, 'Rs ');

export const orderAdvance = (order: Pick<CustomerOrder, 'advance_paid'>) => Number(order.advance_paid || 0);

/** What the customer still owes on the booking after the advance. */
export const orderBalance = (order: Pick<CustomerOrder, 'advance_paid' | 'total'>) =>
  roundCurrency(Math.max(0, Number(order.total || 0) - orderAdvance(order)));
