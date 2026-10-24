import { businessDate } from '../../lib/dashboardAnalytics';
import type { AllocationEntry } from '../../types';

// Shared helpers for the milk operations screens (Allocation, Production, Inventory).

/** Litres still in a collection lot. Same rule the allocation step uses: remaining, else original minus allocated. */
export const remainingOf = (lot: Pick<AllocationEntry, 'remaining_quantity' | 'original_quantity' | 'allocated_quantity'>) => {
  const raw = lot.remaining_quantity !== null && lot.remaining_quantity !== undefined
    ? Number(lot.remaining_quantity)
    : Number(lot.original_quantity || 0) - Number(lot.allocated_quantity || 0);
  return Number.isFinite(raw) ? raw : 0;
};

/** Parses a typed quantity; empty or junk is 0. */
export const parseQty = (text: string | number | null | undefined) => {
  const value = typeof text === 'number' ? text : parseFloat(String(text ?? '').replace(/,/g, ''));
  return Number.isFinite(value) ? value : 0;
};

/** A quantity as a plain input value (no grouping), trimmed to 3 decimals. */
export const qtyInputValue = (value: number) => String(Math.round(Math.max(0, value) * 1000) / 1000);

const PK_ZONE = 'Asia/Karachi';
const shortDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const fullDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const longDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const clock = new Intl.DateTimeFormat('en-US', { timeZone: PK_ZONE, hour: 'numeric', minute: '2-digit' });

/** Pakistan calendar day (YYYY-MM-DD) of a stored date or UTC timestamp. */
export const pkDay = (value?: string | null) => (value ? businessDate(value) : '');

const dayAtNoon = (day: string) => new Date(`${day}T12:00:00Z`);

/** "23 Oct" (or "23 Oct 2026" / "Thursday, 23 October 2026") in Pakistan time, whatever the device zone. */
export const formatPkDay = (value?: string | null, style: 'short' | 'full' | 'long' = 'short') => {
  const day = pkDay(value);
  if (!day) return '—';
  const formatter = style === 'long' ? longDay : style === 'full' ? fullDay : shortDay;
  return formatter.format(dayAtNoon(day));
};

/** "4:05 PM" in Pakistan time. Date-only values have no time and return ''. */
export const formatPkTime = (value?: string | null) => {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? clock.format(date) : '';
};
