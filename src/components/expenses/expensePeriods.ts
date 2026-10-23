import { offsetDate } from '../../lib/dashboardAnalytics';
import { ExpenseDateFilterMode } from './ExpenseTypes';

/** Inclusive Pakistan-day range (YYYY-MM-DD). An empty edge means open-ended. */
export interface DayRange { start: string; end: string; }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
};

const lastDayOf = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

const monthRange = (month: string, upToDay?: number): DayRange => {
  const last = lastDayOf(month);
  const day = Math.min(last, upToDay ?? last);
  return { start: `${month}-01`, end: `${month}-${String(day).padStart(2, '0')}` };
};

const daysBetween = (start: string, end: string) =>
  Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);

export interface PeriodInput {
  mode: ExpenseDateFilterMode;
  today: string;
  month: string;
  singleDate: string;
  startDate: string;
  endDate: string;
}

/** The days a period filter covers; `null` means no date filter ("All"). */
export function periodRange({ mode, today, month, singleDate, startDate, endDate }: PeriodInput): DayRange | null {
  switch (mode) {
    case 'today': return { start: today, end: today };
    case 'yesterday': { const day = offsetDate(today, -1); return { start: day, end: day }; }
    case '7days': return { start: offsetDate(today, -6), end: today };
    case '30days': return { start: offsetDate(today, -29), end: today };
    case 'this_month': return monthRange(month || today.slice(0, 7));
    case 'last_month': return monthRange(shiftMonth(today.slice(0, 7), -1));
    case 'single_date': return singleDate ? { start: singleDate, end: singleDate } : null;
    case 'custom_range': {
      if (!startDate && !endDate) return null;
      // A reversed range (end before start) used to match nothing; read it the way it was meant.
      if (startDate && endDate && startDate > endDate) return { start: endDate, end: startDate };
      return { start: startDate, end: endDate };
    }
    default: return null;
  }
}

/**
 * The period just before the selected one, for the spend trend. The running month is compared
 * with the same days of last month, so a half month is not set against a full one.
 */
export function previousPeriod(input: PeriodInput): { range: DayRange; label: string } | null {
  const { mode, today } = input;
  const current = periodRange(input);
  if (!current) return null;
  if (mode === 'this_month' || mode === 'last_month') {
    const month = current.start.slice(0, 7);
    const prev = shiftMonth(month, -1);
    const isRunning = month === today.slice(0, 7);
    const upTo = isRunning ? Number(today.slice(8, 10)) : undefined;
    const [, m] = prev.split('-').map(Number);
    return { range: monthRange(prev, upTo), label: isRunning ? `vs same days of ${MONTHS[m - 1]}` : `vs ${MONTHS[m - 1]}` };
  }
  if (!current.start || !current.end) return null;
  const length = daysBetween(current.start, current.end) + 1;
  const range = { start: offsetDate(current.start, -length), end: offsetDate(current.start, -1) };
  const label = mode === 'today' ? 'vs yesterday' : length === 1 ? 'vs day before' : `vs previous ${length} days`;
  return { range, label };
}

export const inRange = (day: string, range: DayRange | null) =>
  !range || Boolean(day && (!range.start || day >= range.start) && (!range.end || day <= range.end));
