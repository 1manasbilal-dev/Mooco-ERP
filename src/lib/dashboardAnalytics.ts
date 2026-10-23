import { isDateOnlyOrMidnight } from './formatters';

export type DashboardRange = 'today' | 'yesterday' | '7days' | 'month';

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
});
const hourFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Karachi', hour: '2-digit', hourCycle: 'h23',
});
const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const pktDay = (date: Date) => {
  const parts = dayFormatter.formatToParts(date);
  const part = (name: string) => parts.find(p => p.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};
// Dashboards and reports ask for the day of every record on each render.
const dayCache = new Map<string, string>();

/**
 * The dairy's reporting day follows Pakistan time, including timestamped POS bills.
 * Called with no argument it is today. A record passed without a date has no business day ('');
 * it used to fall back to today and was counted in today's totals.
 */
export function businessDate(...args: [value?: string | Date | null]): string {
  const value = args.length === 0 ? new Date() : args[0];
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? pktDay(value) : '';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const cached = dayCache.get(text);
  if (cached !== undefined) return cached;
  const date = new Date(text);
  const day = Number.isFinite(date.getTime()) ? pktDay(date) : '';
  if (dayCache.size > 20000) dayCache.clear();
  dayCache.set(text, day);
  return day;
}

export function offsetDate(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function getDashboardPeriod(range: DashboardRange, now = new Date()) {
  const todayStr = businessDate(now);
  const ydayStr = offsetDate(todayStr, -1);
  const end = range === 'yesterday' ? ydayStr : todayStr;
  const start = range === '7days' ? offsetDate(end, -6)
    : range === 'month' ? `${todayStr.slice(0, 7)}-01` : end;
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  return { start, end, todayStr, ydayStr, days, previousStart: offsetDate(start, -days), previousEnd: offsetDate(start, -1) };
}

export function percentageChange(current: number, previous: number): number | null {
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}

/**
 * Date-only values and legacy UTC-midnight stamps ('2026-09-22T00:00:00+00:00', saved from a date
 * picker) carry no real time; read as a time they all pile up at a phantom 05:00 PKT.
 */
const hasNoRecordedTime = (value: string) => !value?.includes('T') || isDateOnlyOrMidnight(value);

export function reportingHour(value: string): number {
  if (hasNoRecordedTime(value)) return 12;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 12;
  return Number(hourFormatter.format(date));
}

/** Date-only records retain the existing noon placement because no time was recorded. */
export function reportingHalfHour(value: string): number {
  if (hasNoRecordedTime(value)) return 24;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 24;
  const parts = clockFormatter.formatToParts(date);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  const minute = Number(parts.find(part => part.type === 'minute')?.value);
  return hour * 2 + Math.floor(minute / 30);
}
