import { useRef } from 'react';
import type { Tone } from '../ui';
import { roundCurrency } from '../../lib/db';

// Cash custody runs on the Pakistan business day; stored timestamps are UTC, so every label and
// every day comparison here is done in Asia/Karachi, never in the device's own zone.
export const PK_TIME_ZONE = 'Asia/Karachi';

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: PK_TIME_ZONE, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
});
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: PK_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true });
// Business dates are plain calendar days ("2026-10-23"); format them in UTC so no zone can shift them.
const businessDateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

const validDate = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** "23 Oct, 9:41 pm" in Pakistan time. */
export const formatPkDateTime = (value?: string | null) => {
  const date = validDate(value);
  return date ? dateTimeFormat.format(date) : '—';
};

/** "9:41 pm" in Pakistan time. */
export const formatPkTime = (value?: string | null) => {
  const date = validDate(value);
  return date ? timeFormat.format(date) : '—';
};

/** "Thu, 23 Oct 2026" for a YYYY-MM-DD business date. */
export const formatBusinessDate = (ymd?: string | null) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!match) return ymd || '—';
  return businessDateFormat.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
};

/** The Pakistan business date (YYYY-MM-DD) a date or timestamp falls on. */
export const pkDateOf = (value?: string | null): string => {
  if (!value) return '';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = validDate(text);
  return date ? date.toLocaleDateString('en-CA', { timeZone: PK_TIME_ZONE }) : '';
};

export const initials = (name?: string | null) =>
  (name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || '').join('') || '?';

/** Statuses that still block a day close. */
export const OPEN_SHIFT_STATUSES = ['Pending Acceptance', 'Active', 'Closing', 'Pending Review'];
/** Statuses where the drawer is still in use, so its cash cannot be counted for the day yet. */
export const LIVE_SHIFT_STATUSES = ['Pending Acceptance', 'Active', 'Closing'];

export const SHIFT_STATUS_TONE: Record<string, Tone> = {
  'Pending Acceptance': 'info',
  Active: 'success',
  Closing: 'warning',
  'Pending Review': 'warning',
  Closed: 'neutral',
  'Force Closed': 'danger',
};

export interface CashInput {
  /** Nothing typed yet. */
  empty: boolean;
  /** A finite amount of zero or more. */
  valid: boolean;
  /** Rounded to paisa; 0 when empty or invalid. */
  value: number;
}

/** Reads a typed rupee amount. Negative, non-numeric and blank input are told apart. */
export const parseCashInput = (raw: string | null | undefined): CashInput => {
  const text = String(raw ?? '').trim();
  if (!text) return { empty: true, valid: false, value: 0 };
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) return { empty: false, valid: false, value: 0 };
  return { empty: false, valid: true, value: roundCurrency(number) };
};

/** counted − expected, rounded so float noise never shows as a 1-paisa difference. */
export const cashVariance = (counted: number, expected: number) => {
  const difference = roundCurrency(counted - expected);
  return Math.abs(difference) < 0.01 ? 0 : difference;
};

/** A ref that always holds the latest value, so memoised callbacks can call fresh context functions. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
