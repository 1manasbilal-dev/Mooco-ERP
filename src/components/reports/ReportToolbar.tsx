import React, { memo, useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, GitCompareArrows, RotateCcw } from 'lucide-react';
import { RichSelect, RichSelectOption } from '../RichSelect';
import { DATE_PRESETS, presetLabel } from '../../lib/reports/presets';
import { daysBetween, offsetDate } from '../../lib/reports/helpers';
import type { FilterKey, GroupBy, ReportDefinition, ReportFilters } from '../../lib/reports/types';

export type FilterOptions = Partial<Record<Exclude<FilterKey, 'groupBy'>, RichSelectOption[]>>;

const FILTER_LABEL: Record<Exclude<FilterKey, 'groupBy'>, string> = {
  customerId: 'Customer', supplierId: 'Supplier', itemId: 'Product', accountId: 'Account', category: 'Category',
  paymentMode: 'Payment mode', cashierId: 'Cashier', milkType: 'Milk type', shift: 'Shift',
};

const QUICK = ['today', 'yesterday', 'last_7', 'this_month', 'last_month'];

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

export const ReportToolbar = memo(({ report, filters, preset, today, compare, options, onPreset, onRange, onFilter, onCompare, onReset }: Props) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [moreOpen]);

  const shift = (direction: -1 | 1) => {
    const days = daysBetween(filters.from, filters.to);
    const from = offsetDate(filters.from, days * direction);
    const to = offsetDate(filters.to, days * direction);
    if (direction > 0 && from > today) return;
    onRange(from, to > today ? today : to);
  };

  const pickers = (report.filters || []).filter(k => k !== 'groupBy') as Exclude<FilterKey, 'groupBy'>[];
  const hasFilters = pickers.some(k => filters[k]);
  const chip = (active: boolean) => `h-8 rounded-lg px-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${active ? 'bg-lime-600 text-white shadow-sm shadow-lime-600/20' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`;

  return (
    <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-xs dark:border-slate-800 print:hidden">
      {!report.snapshot ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Date range">
            {QUICK.map(id => (
              <button key={id} type="button" onClick={() => onPreset(id)} className={chip(preset === id)} aria-pressed={preset === id}>{presetLabel(id)}</button>
            ))}
            <div ref={moreRef} className="relative">
              <button type="button" onClick={() => setMoreOpen(v => !v)} aria-expanded={moreOpen}
                className={`${chip(!QUICK.includes(preset) && preset !== 'custom')} inline-flex items-center gap-1`}>
                {!QUICK.includes(preset) && preset !== 'custom' ? presetLabel(preset) : 'More'}<ChevronDown size={12} />
              </button>
              {moreOpen && (
                <div className="absolute left-0 top-9 z-30 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700">
                  {DATE_PRESETS.filter(p => !QUICK.includes(p.id)).map(p => (
                    <button key={p.id} type="button" onClick={() => { onPreset(p.id); setMoreOpen(false); }}
                      className={`block w-full rounded-lg px-3 py-2 text-left text-xs font-medium ${preset === p.id ? 'bg-lime-50 text-lime-800 dark:bg-lime-950/40 dark:text-lime-300' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700">
              <button type="button" onClick={() => shift(-1)} className="h-8 px-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white" aria-label="Previous period" title="Previous period"><ChevronLeft size={15} /></button>
              <CalendarDays size={13} className="text-slate-400" />
              <input type="date" value={filters.from} max={filters.to} onChange={e => e.target.value && onRange(e.target.value, filters.to)} aria-label="From date"
                className="h-8 w-[7.6rem] bg-transparent px-1 text-xs font-semibold text-slate-700 outline-none dark:text-slate-200" />
              <span className="text-xs text-slate-400">→</span>
              <input type="date" value={filters.to} min={filters.from} max={today} onChange={e => e.target.value && onRange(filters.from, e.target.value)} aria-label="To date"
                className="h-8 w-[7.6rem] bg-transparent px-1 text-xs font-semibold text-slate-700 outline-none dark:text-slate-200" />
              <button type="button" onClick={() => shift(1)} disabled={filters.to >= today} className="h-8 px-1.5 text-slate-500 hover:text-slate-900 disabled:opacity-30 dark:hover:text-white" aria-label="Next period" title="Next period"><ChevronRight size={15} /></button>
            </div>
            {report.comparable && (
              <button type="button" onClick={() => onCompare(!compare)} aria-pressed={compare} title="Compare with the previous period of the same length"
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold ${compare ? 'border-lime-500 bg-lime-50 text-lime-800 dark:bg-lime-950/40 dark:text-lime-300' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
                <GitCompareArrows size={13} />Compare
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-1 py-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
          <CalendarDays size={14} />Position as of today — live balances
        </div>
      )}

      {(pickers.length > 0 || report.filters?.includes('groupBy')) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
          {report.filters?.includes('groupBy') && !report.snapshot && (
            <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800" role="group" aria-label="Group by">
              {(['day', 'week', 'month'] as GroupBy[]).map(g => (
                <button key={g} type="button" onClick={() => onFilter('groupBy', g)} aria-pressed={filters.groupBy === g}
                  className={`h-7 rounded-md px-2.5 text-xs font-semibold capitalize ${filters.groupBy === g ? 'bg-white text-lime-800 shadow-xs dark:bg-slate-700 dark:text-lime-300' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
                  {g === 'day' ? 'Daily' : g === 'week' ? 'Weekly' : 'Monthly'}
                </button>
              ))}
            </div>
          )}
          {pickers.map(key => (
            <div key={key} className="w-full min-w-[11rem] sm:w-56">
              <RichSelect compact options={options[key] || []} value={filters[key] || ''} onChange={v => onFilter(key, v)}
                placeholder={`${report.requires === key ? 'Choose' : 'All'} ${FILTER_LABEL[key].toLowerCase()}${report.requires === key ? '' : 's'}`}
                searchPlaceholder={`Search ${FILTER_LABEL[key].toLowerCase()}…`} />
            </div>
          ))}
          {hasFilters && (
            <button type="button" onClick={onReset} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800">
              <RotateCcw size={12} />Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
});
