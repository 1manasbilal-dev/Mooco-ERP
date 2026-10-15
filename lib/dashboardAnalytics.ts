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

/** The dairy's reporting day follows Pakistan time, including timestamped POS bills. */
export function businessDate(value: string | Date = new Date()): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = dayFormatter.formatToParts(date);
  const part = (name: string) => parts.find(p => p.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
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

export function reportingHour(value: string): number {
  if (!value?.includes('T')) return 12;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 12;
  return Number(hourFormatter.format(date));
}

/** Date-only records retain the existing noon placement because no time was recorded. */
export function reportingHalfHour(value: string): number {
  if (!value?.includes('T')) return 24;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 24;
  const parts = clockFormatter.formatToParts(date);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  const minute = Number(parts.find(part => part.type === 'minute')?.value);
  return hour * 2 + Math.floor(minute / 30);
}
