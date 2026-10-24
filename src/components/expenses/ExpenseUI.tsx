import React from 'react';
import {
  Coffee, FileText, Fuel, Home, Megaphone, Package, Receipt, Tag, Users, Wrench, X, Zap,
} from 'lucide-react';
import { Badge, PageHeader, SegmentedControl } from '../ui';
import type { Tone } from '../ui';
import { cn } from '../../lib/cn';
import { businessDate, offsetDate } from '../../lib/dashboardAnalytics';

/**
 * Shared building blocks for the Expenses & Vendors screens, built on the design system
 * (src/components/ui + token classes). Dialog-only pieces live in ExpenseSheet.tsx so they
 * load with the lazy dialogs chunk, not with the screen.
 */

export type ExpensesSection = 'transactions' | 'vendors';

const SECTIONS: { id: ExpensesSection; label: string; short: string; Icon: React.ElementType }[] = [
  { id: 'transactions', label: 'Expenses', short: 'Expenses', Icon: Receipt },
  { id: 'vendors', label: 'Vendors & Ledgers', short: 'Vendors', Icon: Users },
];

export const ExpensesHeader: React.FC<{
  active: ExpensesSection;
  onChange: (section: ExpensesSection) => void;
  subtitle: string;
  counts?: Partial<Record<ExpensesSection, number>>;
  actions?: React.ReactNode;
}> = ({ active, onChange, subtitle, counts, actions }) => (
  <PageHeader
    className="gap-3 print:hidden"
    eyebrow="Expenses & vendors"
    description={subtitle}
    actions={actions}
  >
    <SegmentedControl
      variant="underline"
      aria-label="Expenses sections"
      value={active}
      // Re-clicking the open section must not reset its search and selection.
      onChange={section => { if (section !== active) onChange(section); }}
      className="w-full"
      options={SECTIONS.map(({ id, label, short, Icon }) => ({
        value: id,
        icon: <Icon />,
        label: <><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span></>,
        count: counts?.[id] ? counts[id] : undefined,
      }))}
    />
  </PageHeader>
);

/** Mid-tone series colours: readable on light and dark surfaces without `dark:` twins. */
const SERIES = [
  'bg-lime-500', 'bg-sky-500', 'bg-amber-500', 'bg-rose-500', 'bg-emerald-500',
  'bg-indigo-500', 'bg-orange-500', 'bg-cyan-500', 'bg-purple-500', 'bg-blue-500',
];

export interface CategoryTone { bar: string; }

/** Stable series colour per category name, so a category's dot and bar look the same everywhere. */
export function categoryTone(name?: string): CategoryTone {
  const value = (name || '').trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return { bar: SERIES[hash % SERIES.length] };
}

const ICON_RULES: [RegExp, React.ElementType][] = [
  [/staff|salar|wage|employee/, Users],
  [/rent|premises|godown|shop/, Home],
  [/electric|utilit|gas|water|internet|bill/, Zap],
  [/fuel|diesel|petrol|logistic|transport|vehicle/, Fuel],
  [/packag|cup|bottle|pouch|shopper/, Package],
  [/food|welfare|tea|meal/, Coffee],
  [/repair|mainten|plumb|wiring/, Wrench],
  [/station|office|register|roll/, FileText],
  [/market|brand|banner|ads/, Megaphone],
];

function categoryIcon(name?: string): React.ElementType {
  const value = (name || '').toLowerCase();
  return ICON_RULES.find(([pattern]) => pattern.test(value))?.[1] || Tag;
}

/** Neutral icon tile for a category; its series colour shows as a small dot in the corner. */
export const CategoryBadge: React.FC<{ name?: string; size?: 'sm' | 'md' | 'lg' }> = React.memo(({ name, size = 'md' }) => {
  const Icon = categoryIcon(name);
  const box = size === 'lg' ? 'size-11 rounded-control' : size === 'sm' ? 'size-7 rounded-lg' : 'size-9 rounded-[10px]';
  return (
    <span className={cn('relative flex shrink-0 items-center justify-center bg-surface-2 text-fg-muted ring-1 ring-inset ring-line', box)} aria-hidden="true">
      <Icon size={size === 'lg' ? 18 : size === 'sm' ? 13 : 15} />
      {size !== 'sm' && <span className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface', categoryTone(name).bar)} />}
    </span>
  );
});
CategoryBadge.displayName = 'CategoryBadge';

export type PayStatus = 'Paid' | 'Partial' | 'Unpaid';

export const STATUS_META: Record<PayStatus, { label: string; tone: Tone; dot: string }> = {
  Paid: { label: 'Paid', tone: 'success', dot: 'bg-success' },
  Partial: { label: 'Partial', tone: 'warning', dot: 'bg-warning' },
  Unpaid: { label: 'On credit', tone: 'danger', dot: 'bg-danger' },
};

export const StatusPill: React.FC<{ status?: string; className?: string }> = ({ status, className }) => {
  const meta = STATUS_META[(status as PayStatus) || 'Paid'] || STATUS_META.Paid;
  return <Badge tone={meta.tone} dot className={className}>{meta.label}</Badge>;
};

/** Small coloured dot used as a SegmentedControl option icon. */
export const Dot: React.FC<{ className: string }> = ({ className }) => (
  <span className={cn('size-2 shrink-0 rounded-full', className)} aria-hidden="true" />
);

/** Amount actually paid on an expense, tolerating snake_case rows from the database. */
export function paidOf(expense: { amount?: number; paidAmount?: number; paymentStatus?: string } & Record<string, any>): number {
  const status = expense.paymentStatus || expense.payment_status;
  if (status === 'Unpaid') return 0;
  const raw = expense.paidAmount ?? expense.paid_amount;
  return raw !== undefined && raw !== null ? Number(raw) : Number(expense.amount || 0);
}

export const pkToday = () => businessDate();

export function dayKey(value?: string): string {
  if (!value) return '';
  return value.includes('T') ? businessDate(value) : value.slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Today", "Yesterday" or "Mon, 12 Oct 2026" for a YYYY-MM-DD day. */
export function dayHeading(day: string): { title: string; sub: string } {
  if (!day) return { title: 'No date', sub: '' };
  const today = pkToday();
  const [y, m, d] = day.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const full = `${d} ${MONTHS[m - 1]} ${y}`;
  if (day === today) return { title: 'Today', sub: `${weekday}, ${full}` };
  if (day === offsetDate(today, -1)) return { title: 'Yesterday', sub: `${weekday}, ${full}` };
  return { title: `${weekday}, ${d} ${MONTHS[m - 1]}`, sub: String(y) === today.slice(0, 4) ? '' : String(y) };
}

/** "1 vendor", "3 vendors". */
export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m ? `${MONTHS[m - 1]} ${y}` : month;
}

/** Day-group header inside a list card: day on the left, a summary on the right. */
export const DayHeader: React.FC<{ day: string; children?: React.ReactNode }> = ({ day, children }) => {
  const heading = dayHeading(day);
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2/70 px-4 py-1.5 text-[11px]">
      <span className="font-bold text-fg-muted">
        {heading.title}
        {heading.sub && <span className="ml-1.5 font-medium text-fg-subtle">{heading.sub}</span>}
      </span>
      <span className="font-semibold text-fg-subtle">{children}</span>
    </div>
  );
};

/** Removable chip that shows one active filter. */
export const FilterChip: React.FC<{ label: string; onClear: () => void }> = ({ label, onClear }) => (
  <span className="inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-brand-soft pl-2.5 pr-1 text-[11px] font-semibold text-brand-fg ring-1 ring-inset ring-brand/20">
    <span className="truncate">{label}</span>
    <button
      type="button"
      onClick={onClear}
      aria-label={`Remove ${label} filter`}
      className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-brand/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <X size={10} />
    </button>
  </span>
);

/** Initials avatar; red when we owe the party money, brand otherwise. */
export const Avatar: React.FC<{ name: string; owed?: boolean; size?: 'sm' | 'md' | 'lg' }> = ({ name, owed = false, size = 'md' }) => {
  const letters = (name || '?').trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('') || '?';
  const box = size === 'lg' ? 'size-11 text-sm rounded-control' : size === 'sm' ? 'size-7 text-[10px] rounded-lg' : 'size-9 text-xs rounded-[10px]';
  return (
    <span className={cn('flex shrink-0 items-center justify-center font-bold', box, owed ? 'bg-danger-soft text-danger-fg' : 'bg-brand-soft text-brand-fg')} aria-hidden="true">
      {letters}
    </span>
  );
};

/** Paid vs on-credit split of a bill, as one bar with both amounts underneath. */
export const SettlementBar: React.FC<{ total: number; paid: number; formatMoney: (value: number) => string }> = ({ total, paid, formatMoney }) => {
  if (total <= 0) return null;
  const paidPart = Math.min(total, Math.max(0, paid));
  const due = Math.max(0, total - paidPart);
  const pct = (paidPart / total) * 100;
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-danger/15" aria-hidden="true">
        <span className="h-full rounded-full bg-success transition-[width] duration-300 ease-out-expo" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] font-semibold tabular-nums">
        <span className="flex items-center gap-1.5 text-success-fg"><span className="size-1.5 rounded-full bg-success" />Paid {formatMoney(paidPart)}</span>
        <span className="flex items-center gap-1.5 text-danger-fg"><span className="size-1.5 rounded-full bg-danger" />On credit {formatMoney(due)}</span>
      </div>
    </div>
  );
};

/** Compact money figure with a caption, for summary strips. */
export const MiniStat: React.FC<{ label: string; value: React.ReactNode; tone?: 'fg' | 'success' | 'danger' | 'info' }> = ({ label, value, tone = 'fg' }) => (
  <div className="min-w-0 rounded-control border border-line bg-surface px-3 py-2 shadow-e1">
    <p className="truncate text-[11px] font-semibold text-fg-subtle">{label}</p>
    <p className={cn(
      'mt-0.5 truncate text-sm font-bold tabular-nums',
      tone === 'success' ? 'text-success-fg' : tone === 'danger' ? 'text-danger-fg' : tone === 'info' ? 'text-info-fg' : 'text-fg',
    )}>
      {value}
    </p>
  </div>
);
