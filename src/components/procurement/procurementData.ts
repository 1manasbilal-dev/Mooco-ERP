import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { businessDate } from '../../lib/dashboardAnalytics';
import { formatQty } from '../../lib/formatters';
import { shiftPart } from './ProcurementUI';

/** Data helpers shared by the Procurement screens. Pure functions plus two small hooks. */

const PK_CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const PK_HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', hourCycle: 'h23' });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// businessDate() goes through Intl.formatToParts, which is slow over thousands of rows.
// Entry objects are reused between renders, so the day is worked out once per object.
const dayCache = new WeakMap<object, string>();

/** Pakistan business day (YYYY-MM-DD) of a purchase row. */
export function dayOf(entry: { date?: string }): string {
  let day = dayCache.get(entry);
  if (day === undefined) {
    day = entry.date ? businessDate(entry.date) : '';
    dayCache.set(entry, day);
  }
  return day;
}

export const isActiveEntry = (entry: { status?: string }) => entry.status !== 'Cancelled' && entry.status !== 'Returned';

export const shiftKey = (name: unknown) => String(name || '').trim().toLowerCase();

/** "07:42" in Pakistan time, or '' for a back-dated row that has no real time. */
export function pkTime(date?: string): string {
  if (!date || !date.includes('T')) return '';
  const parsed = new Date(date);
  return Number.isFinite(parsed.getTime()) ? PK_CLOCK.format(parsed) : '';
}

/** 23 Oct 2026 */
export function prettyDate(iso: string) {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

/** Thu, 23 Oct */
export function shortDay(iso: string) {
  const parsed = new Date(`${iso}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return iso;
  return `${WEEKDAYS[parsed.getUTCDay()]}, ${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]}`;
}

/** Rates keep up to 2 decimals so litres x rate on screen matches the saved amount. */
export const formatRate = (rate: unknown) => formatQty(Number(rate) || 0, 2);

export const balanceOf = (party: any) => Number(party?.pending_balance ?? party?.balance ?? 0) || 0;

/** Paid and khata parts of a purchase row, never more than the bill. */
export function settlementOf(entry: any) {
  const amount = Math.max(0, Number(entry.total_amount) || 0);
  const paid = Math.min(amount, Math.max(0, Number(entry.paid_amount ?? entry.details?.paid_amount ?? 0) || 0));
  return { amount, paid, due: Math.max(0, amount - paid) };
}

export function settlementLabel(paid: number, due: number): 'Paid' | 'Khata' | 'Partial' {
  if (due <= 0.5 && paid > 0) return 'Paid';
  if (paid <= 0.5) return 'Khata';
  return 'Partial';
}

/** Shift names from Settings > Company Profile, or Morning / Evening. */
export function useConfiguredShifts(list: unknown): string[] {
  return useMemo(() => {
    const names = Array.isArray(list) ? list.map(item => String(item).trim()).filter(Boolean) : [];
    return names.length ? Array.from(new Set(names)) : ['Morning', 'Evening'];
  }, [list]);
}

/**
 * The shift that is running at this Pakistan hour: morning until 2 PM (or 11 AM when a
 * noon shift exists), noon until 3 PM, evening after that.
 */
export function defaultShiftFor(shifts: string[], hour: number): string {
  if (shifts.length === 0) return 'Morning';
  const hasNoon = shifts.some(name => shiftPart(name) === 'noon');
  const part = hasNoon
    ? (hour < 11 ? 'morning' : hour < 15 ? 'noon' : 'evening')
    : (hour < 14 ? 'morning' : 'evening');
  return shifts.find(name => shiftPart(name) === part) || (part === 'morning' ? shifts[0] : shifts[shifts.length - 1]);
}

function readClock() {
  const now = new Date();
  return { today: businessDate(now), hour: Number(PK_HOUR.format(now)) % 24 };
}

/**
 * Today's Pakistan date and hour, refreshed every minute. Screens stay mounted for the whole
 * day, so a date picked once at mount would still say yesterday after midnight.
 */
export function useBusinessClock() {
  const [clock, setClock] = useState(readClock);
  useEffect(() => {
    const tick = () => setClock(prev => {
      const next = readClock();
      return next.today === prev.today && next.hour === prev.hour ? prev : next;
    });
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return clock;
}

/**
 * The purchase log drawer is open while the URL has `?history=true`, so the log can be linked
 * and the browser Back button closes it. Only the visible tab writes the URL.
 */
export function useHistoryParam(active: boolean) {
  const location = useLocation();
  const navigate = useNavigate();
  const isOpen = active && new URLSearchParams(location.search).get('history') === 'true';
  const setOpen = (open: boolean) => {
    const params = new URLSearchParams(location.search);
    if (open) params.set('history', 'true');
    else params.delete('history');
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ''}`, { replace: true });
  };
  return [isOpen, setOpen] as const;
}

/** "1 slip", "3 slips" */
export const countOf = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
