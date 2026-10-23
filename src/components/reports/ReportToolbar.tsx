import { memo, useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, GitCompareArrows, RotateCcw } from 'lucide-react';
import { RichSelect, RichSelectOption } from '../RichSelect';
import { Button, IconButton, SegmentedControl, Toolbar } from '../ui';
import type { SegmentOption } from '../ui';
import { cn } from '../../lib/cn';
import { DATE_PRESETS, presetLabel, rangeText } from '../../lib/reports/presets';
import { daysBetween, offsetDate } from '../../lib/reports/helpers';
import type { FilterKey, GroupBy, ReportDefinition, ReportFilters } from '../../lib/reports/types';

export type FilterOptions = Partial<Record<Exclude<FilterKey, 'groupBy'>, RichSelectOption[]>>;

const FILTER_LABEL: Record<Exclude<FilterKey, 'groupBy'>, string> = {
  customerId: 'Customer', supplierId: 'Supplier', itemId: 'Product', accountId: 'Account', category: 'Category',
  paymentMode: 'Payment mode', cashierId: 'Cashier', milkType: 'Milk type', shift: 'Shift',
};

const QUICK = ['today', 'yesterday', 'last_7', 'this_month', 'last_month'];
const GROUPS: SegmentOption<GroupBy>[] = [{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }];

// Calendar presets step by whole months, so "This month" ‹ goes to all of last month
// instead of the 23 days before the 1st.
const PRESET_MONTHS: Record<string, number> = { this_month: 1, last_month: 1, this_quarter: 3, last_quarter: 3, this_year: 12, this_fy: 12, last_fy: 12 };
const ym = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const fromYm = (n: number) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}-01`;
const monthEnd = (date: string) => offsetDate(fromYm(ym(date) + 1), -1);

function shiftedRange(from: string, to: string, preset: string, direction: -1 | 1) {
  const fullMonths = from.endsWith('-01') && to === monthEnd(to);
  const months = PRESET_MONTHS[preset] || (fullMonths ? ym(to) - ym(from) + 1 : 0);
  if (months && from.endsWith('-01')) {
    const start = ym(from) + direction * months;
    return { from: fromYm(start), to: monthEnd(fromYm(start + months - 1)) };
  }
  if (preset === 'this_week') {
    // Monday to today becomes the whole week before (or after).
    const start = offsetDate(from, direction * 7);
    return { from: start, to: offsetDate(start, 6) };
  }
  const days = daysBetween(from, to);
  return { from: offsetDate(from, days * direction), to: offsetDate(to, days * direction) };
}

interface Props {
  report: ReportDefinition;
  filters: ReportFilters;
  preset: string;
  today: string;
  compare: boolean;
  options: FilterOptions;
  onPreset: (id: string) => void;
  onRange: (from: string, to: string) => void;
  onFilter: (key: FilterKey, value: string) => void;
  onCompare: (on: boolean) => void;
  onReset: () => void;
}

// Phones: the two dates share the row; larger screens: fixed widths.
const dateInput = 'ds-control h-9 min-w-0 flex-1 bg-transparent px-1 text-[13px] font-semibold tabular-nums text-fg outline-none sm:w-[8.4rem] sm:flex-none';

export const ReportToolbar = memo(({ report, filters, preset, today, compare, options, onPreset, onRange, onFilter, onCompare, onReset }: Props) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [moreOpen]);

  // On phones the preset pills scroll sideways: keep the chosen one in view.
  const presetsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = presetsRef.current?.querySelector<HTMLElement>('[role="tablist"]');
    const active = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !active) return;
    const box = list.getBoundingClientRect();
    const pill = active.getBoundingClientRect();
    if (pill.left < box.left || pill.right > box.right) list.scrollLeft += pill.left - box.left - 8;
  }, [preset]);

  const shift = (direction: -1 | 1) => {
    const next = shiftedRange(filters.from, filters.to, preset, direction);
    if (direction > 0 && next.from > today) return;
    onRange(next.from, next.to > today ? today : next.to);
  };

  const pickers = (report.filters || []).filter(k => k !== 'groupBy') as Exclude<FilterKey, 'groupBy'>[];
  const hasFilters = pickers.some(k => filters[k]);
  const showGroupBy = Boolean(report.filters?.includes('groupBy')) && !report.snapshot;
  const inMore = !QUICK.includes(preset);
  // The active "More" preset (or a custom range) shows as a selected pill so the choice stays visible.
  const presetOptions: SegmentOption<string>[] = [
    ...QUICK.map(id => ({ value: id, label: presetLabel(id) })),
    ...(inMore ? [{ value: preset, label: preset === 'custom' ? 'Custom' : presetLabel(preset) }] : []),
  ];
  const days = daysBetween(filters.from, filters.to);

  return (
    // Stacked rows: `flex-nowrap` matters, a wrapping column would size every row to its content and overflow on phones.
    <Toolbar className="flex-col flex-nowrap items-stretch gap-0 p-0 print:hidden">
      {!report.snapshot ? (
        <div className="flex flex-col gap-2 p-2.5 2xl:flex-row 2xl:items-center">
          <div ref={presetsRef} className="flex min-w-0 items-center gap-1.5">
            <SegmentedControl aria-label="Date range" options={presetOptions} value={preset} size="sm" className="min-w-0"
              // Re-picking the active pill (a "Custom" range especially) must not reset the dates.
              onChange={id => { if (id !== preset) onPreset(id); }} />
            <div ref={moreRef} className="relative shrink-0">
              <Button variant="ghost" size="sm" rightIcon={<ChevronDown />} onClick={() => setMoreOpen(v => !v)} aria-expanded={moreOpen} aria-haspopup="menu">
                More
              </Button>
              {moreOpen && (
                <div role="menu" aria-label="More date ranges" className="absolute right-0 top-10 z-30 w-60 rounded-control border border-line bg-surface p-1.5 shadow-e2 animate-fade-up sm:left-0 sm:right-auto">
                  {DATE_PRESETS.filter(p => !QUICK.includes(p.id)).map(p => (
                    <button key={p.id} type="button" role="menuitemradio" aria-checked={preset === p.id} onClick={() => { onPreset(p.id); setMoreOpen(false); }}
                      className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-medium',
                        preset === p.id ? 'bg-brand-soft text-brand-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg')}>
                      <span className="flex-1">{p.label}</span>
                      {preset === p.id && <Check size={15} strokeWidth={2.5} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2 2xl:ml-auto">
            <div className="flex h-10 w-full min-w-0 items-center rounded-control border border-line bg-surface shadow-e1 sm:w-auto">
              <IconButton size="sm" icon={<ChevronLeft />} aria-label="Previous period" onClick={() => shift(-1)} className="ml-0.5" />
              <CalendarDays size={14} className="mx-1 hidden shrink-0 text-fg-faint sm:block" aria-hidden="true" />
              <input type="date" value={filters.from} max={filters.to} onChange={e => e.target.value && onRange(e.target.value, filters.to)} aria-label="From date" className={dateInput} />
              <span className="px-0.5 text-xs text-fg-faint" aria-hidden="true">→</span>
              <input type="date" value={filters.to} min={filters.from} max={today} onChange={e => e.target.value && onRange(filters.from, e.target.value)} aria-label="To date" className={dateInput} />
              <IconButton size="sm" icon={<ChevronRight />} aria-label="Next period" onClick={() => shift(1)} disabled={filters.to >= today} className="mr-0.5" />
            </div>
            {report.comparable && (
              <Button variant={compare ? 'soft' : 'secondary'} leftIcon={<GitCompareArrows />} onClick={() => onCompare(!compare)} aria-pressed={compare}
                title="Compare with the previous period of the same length">
                Compare
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3.5 py-3 text-[13px] font-semibold text-fg-muted">
          <CalendarDays size={15} className="text-fg-faint" aria-hidden="true" />Position as of {rangeText(today, today)} — live balances
        </div>
      )}

      {!report.snapshot && (
        <p className="flex flex-wrap items-center gap-x-1.5 border-t border-line px-3.5 py-2 text-xs text-fg-subtle" aria-live="polite">
          <span className="font-semibold text-fg-muted">{rangeText(filters.from, filters.to)}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{days.toLocaleString('en-PK')} {days === 1 ? 'day' : 'days'}</span>
          {filters.to === today && <><span aria-hidden="true">·</span><span>includes today</span></>}
        </p>
      )}

      {(pickers.length > 0 || showGroupBy) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line p-2.5">
          {showGroupBy && <SegmentedControl aria-label="Group by" options={GROUPS} value={filters.groupBy} onChange={g => onFilter('groupBy', g)} size="sm" />}
          {pickers.map(key => (
            <div key={key} className="w-full min-w-[11rem] sm:w-56">
              <RichSelect compact options={options[key] || []} value={filters[key] || ''} onChange={v => onFilter(key, v)}
                placeholder={`${report.requires === key ? 'Choose' : 'All'} ${FILTER_LABEL[key].toLowerCase()}${report.requires === key ? '' : 's'}`}
                searchPlaceholder={`Search ${FILTER_LABEL[key].toLowerCase()}…`} />
            </div>
          ))}
          {hasFilters && (
            <Button variant="ghost" size="sm" leftIcon={<RotateCcw />} onClick={onReset}>Clear filters</Button>
          )}
        </div>
      )}
    </Toolbar>
  );
});
