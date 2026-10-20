import React from 'react';
import { ClipboardCheck, Droplets, Moon, Package, Sun, SunMedium } from 'lucide-react';
import { useTabs } from '../../context/TabContext';

/** Shared building blocks for the three Procurement screens (milk, supplies, collection details). */

export type ProcurementPageId = 'purchase' | 'purchase-supplies' | 'purchase-details';

const PAGES: { id: ProcurementPageId; label: string; short: string; Icon: React.ElementType }[] = [
  { id: 'purchase', label: 'Milk Collection', short: 'Milk', Icon: Droplets },
  { id: 'purchase-supplies', label: 'Supplies', short: 'Supplies', Icon: Package },
  { id: 'purchase-details', label: 'Collection Details', short: 'Details', Icon: ClipboardCheck },
];

export const ProcurementHeader: React.FC<{
  active: ProcurementPageId;
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
}> = ({ active, title, subtitle, actions }) => {
  const { openTab } = useTabs();
  const ActiveIcon = PAGES.find(page => page.id === active)?.Icon || Droplets;

  return (
    <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-lime-400 to-lime-600 text-white shadow-md shadow-lime-600/25">
          <ActiveIcon size={20} strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Procurement</p>
          <h1 className="truncate text-lg font-black leading-tight tracking-tight text-slate-900 sm:text-xl">{title}</h1>
          <p className="truncate text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <nav aria-label="Procurement screens" className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-100 p-1 scrollbar-hide lg:flex-initial">
          {PAGES.map(({ id, label, short, Icon }) => {
            const selected = id === active;
            return (
              <button
                key={id}
                type="button"
                aria-current={selected ? 'page' : undefined}
                onClick={() => !selected && openTab(id)}
                className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-all lg:flex-initial ${
                  selected
                    ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon size={14} className={selected ? 'text-lime-600' : ''} />
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>
              </button>
            );
          })}
        </nav>
        {actions}
      </div>
    </header>
  );
};

export type Tone = 'lime' | 'cyan' | 'violet' | 'rose' | 'amber' | 'emerald' | 'slate';

export const TONE: Record<Tone, { tile: string; text: string; bar: string }> = {
  lime: { tile: 'bg-lime-100 text-lime-700', text: 'text-lime-700', bar: 'bg-lime-500' },
  cyan: { tile: 'bg-cyan-100 text-cyan-700', text: 'text-cyan-700', bar: 'bg-cyan-500' },
  violet: { tile: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300', text: 'text-violet-700 dark:text-violet-300', bar: 'bg-violet-500' },
  rose: { tile: 'bg-rose-100 text-rose-700', text: 'text-rose-600 dark:text-rose-400', bar: 'bg-rose-500' },
  amber: { tile: 'bg-amber-100 text-amber-700', text: 'text-amber-700', bar: 'bg-amber-500' },
  emerald: { tile: 'bg-emerald-100 text-emerald-700', text: 'text-emerald-700', bar: 'bg-emerald-500' },
  slate: { tile: 'bg-slate-100 text-slate-600', text: 'text-slate-900', bar: 'bg-slate-400' },
};

export const StatTile: React.FC<{
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: Tone;
  valueTone?: Tone;
  className?: string;
  children?: React.ReactNode;
}> = ({ icon: Icon, label, value, hint, tone = 'slate', valueTone, className = '', children }) => (
  <div className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs ${className}`}>
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${TONE[tone].tile}`}>
        <Icon size={14} />
      </span>
    </div>
    <p className={`mt-1.5 truncate font-mono text-lg font-black tracking-tight tabular-nums sm:text-xl ${valueTone ? TONE[valueTone].text : 'text-slate-900'}`}>
      {value}
    </p>
    {hint && <p className="mt-0.5 truncate text-[11px] text-slate-500">{hint}</p>}
    {children}
  </div>
);

export interface PillOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  /** Small colour swatch shown before the label, e.g. 'bg-sky-500'. */
  dot?: string;
  disabled?: boolean;
}

/** Radio-style segmented pills. Faster than a dropdown for two to five choices. */
export function PillGroup<T extends string>({
  options, value, onChange, label, size = 'md', className = '',
}: {
  options: PillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 ${className}`}>
      {options.map(option => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={`flex flex-auto shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
              size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
            } ${
              selected
                ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {option.dot && <span className={`h-2 w-2 shrink-0 rounded-full ${option.dot}`} />}
            {option.icon}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ShiftIcon({ name, size = 14 }: { name: string; size?: number }) {
  const value = name.toLowerCase();
  if (value.includes('evening') || value.includes('night') || value.includes('sham') || value.includes('raat')) {
    return <Moon size={size} className="shrink-0 text-indigo-400" />;
  }
  if (value.includes('noon') || value.includes('dopehar')) return <SunMedium size={size} className="shrink-0 text-orange-500" />;
  return <Sun size={size} className="shrink-0 text-amber-500" />;
}

export const VARIETY_DOT: Record<string, string> = {
  buffalo: 'bg-lime-500',
  cow: 'bg-sky-500',
  mixed: 'bg-violet-500',
};

export function varietyDot(type: string) {
  const value = String(type || '').toLowerCase();
  if (value.includes('buffalo')) return VARIETY_DOT.buffalo;
  if (value.includes('cow')) return VARIETY_DOT.cow;
  return VARIETY_DOT.mixed;
}

/** Initials avatar; red when we owe the party money, lime otherwise. */
export function Avatar({ name, owed = false, size = 'md' }: { name: string; owed?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const letters = (name || '?').trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('') || '?';
  const box = size === 'lg' ? 'h-11 w-11 text-sm rounded-2xl' : size === 'sm' ? 'h-7 w-7 text-[10px] rounded-lg' : 'h-9 w-9 text-xs rounded-xl';
  return (
    <span className={`grid shrink-0 place-items-center font-black ${box} ${owed ? 'bg-rose-100 text-rose-700' : 'bg-lime-100 text-lime-700'}`}>
      {letters}
    </span>
  );
}

/** Paid vs khata split of a bill, as one bar with both amounts underneath. */
export function SettlementBar({ total, paid, formatMoney }: { total: number; paid: number; formatMoney: (value: number) => string }) {
  if (total <= 0) return null;
  const paidPart = Math.min(total, Math.max(0, paid));
  const due = Math.max(0, total - paidPart);
  const pct = (paidPart / total) * 100;
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-rose-500/20" aria-hidden="true">
        <span className="h-full rounded-full bg-emerald-500 transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] font-semibold">
        <span className="flex items-center gap-1.5 text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Paid {formatMoney(paidPart)}</span>
        <span className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400"><span className="h-1.5 w-1.5 rounded-full bg-rose-500" />Khata {formatMoney(due)}</span>
      </div>
    </div>
  );
}

export function SectionLabel({ step, children, aside }: { step?: number; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
        {step !== undefined && (
          <span className="grid h-4 w-4 place-items-center rounded-full bg-lime-600 text-[9px] font-black text-white">{step}</span>
        )}
        {children}
      </span>
      {aside}
    </div>
  );
}
