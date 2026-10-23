import React, { useRef } from 'react';
import { ClipboardCheck, Droplets, Moon, Package, Sun, SunMedium } from 'lucide-react';
import { useTabs } from '../../context/TabContext';
import { PageHeader, SegmentedControl } from '../ui';
import { cn } from '../../lib/cn';
import { formatCurrency } from '../../lib/formatters';

/**
 * Shared building blocks for the Procurement screens (milk, supplies, collection details),
 * built on the design system in `src/components/ui`. The Expenses screens import
 * `PillGroup`, `StatTile`, `SettlementBar` and `Avatar` too, so their props stay stable.
 */

export type ProcurementPageId = 'purchase' | 'purchase-supplies' | 'purchase-details';

const PAGES: { id: ProcurementPageId; label: string; short: string; Icon: React.ElementType }[] = [
  { id: 'purchase', label: 'Milk Collection', short: 'Milk', Icon: Droplets },
  { id: 'purchase-supplies', label: 'Supplies', short: 'Supplies', Icon: Package },
  { id: 'purchase-details', label: 'Collection Details', short: 'Details', Icon: ClipboardCheck },
];

/** Screen header with the procurement sub-navigation. The app header already shows the screen name. */
export const ProcurementHeader: React.FC<{
  active: ProcurementPageId;
  title: string;
  subtitle: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ active, title, subtitle, actions }) => {
  const { openTab } = useTabs();
  return (
    <PageHeader eyebrow="Procurement" description={subtitle} actions={actions}>
      <h1 className="sr-only">{title}</h1>
      <SegmentedControl<ProcurementPageId>
        aria-label="Procurement screens"
        variant="underline"
        value={active}
        onChange={id => { if (id !== active) openTab(id); }}
        options={PAGES.map(({ id, label, short, Icon }) => ({
          value: id,
          icon: <Icon aria-hidden="true" />,
          label: (
            <>
              <span className="sm:hidden">{short}</span>
              <span className="hidden sm:inline">{label}</span>
            </>
          ),
        }))}
      />
    </PageHeader>
  );
};

export type Tone = 'lime' | 'cyan' | 'violet' | 'rose' | 'amber' | 'emerald' | 'slate';

// Legacy tone names mapped onto the design-system status colours.
const TONE: Record<Tone, { tile: string; text: string }> = {
  lime: { tile: 'bg-brand-soft text-brand-fg', text: 'text-brand-fg' },
  cyan: { tile: 'bg-info-soft text-info-fg', text: 'text-info-fg' },
  violet: { tile: 'bg-surface-2 text-fg-muted', text: 'text-fg' },
  rose: { tile: 'bg-danger-soft text-danger-fg', text: 'text-danger-fg' },
  amber: { tile: 'bg-warning-soft text-warning-fg', text: 'text-warning-fg' },
  emerald: { tile: 'bg-success-soft text-success-fg', text: 'text-success-fg' },
  slate: { tile: 'bg-surface-2 text-fg-muted', text: 'text-fg' },
};

/** KPI tile with room for a small chart under the value. Prefer `StatCard` when no children are needed. */
export const StatTile: React.FC<{
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: Tone;
  valueTone?: Tone;
  className?: string;
  children?: React.ReactNode;
}> = ({ icon: Icon, label, value, hint, tone = 'slate', valueTone, className, children }) => (
  <div className={cn('flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-4 shadow-e1', className)}>
    <div className="flex items-center gap-2.5">
      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', TONE[tone].tile)}>
        <Icon size={16} aria-hidden="true" />
      </span>
      <span className="truncate text-[13px] font-semibold text-fg-subtle">{label}</span>
    </div>
    <p className={cn('truncate text-2xl font-bold leading-tight tracking-tight tabular-nums', valueTone ? TONE[valueTone].text : 'text-fg')}>
      {value}
    </p>
    {hint && <p className="-mt-1 truncate text-xs text-fg-subtle">{hint}</p>}
    {children}
  </div>
);

export interface PillOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  /** Small colour swatch shown before the label, e.g. 'bg-info'. */
  dot?: string;
  disabled?: boolean;
}

/** Radio-style segmented pills (arrow keys move the choice). Faster than a dropdown for two to five choices. */
export function PillGroup<T extends string>({
  options, value, onChange, label, size = 'md', className,
}: {
  options: PillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    const enabled = options.filter(option => !option.disabled);
    if (enabled.length === 0) return;
    const index = enabled.findIndex(option => option.value === value);
    const next = enabled[(index + step + enabled.length) % enabled.length];
    event.preventDefault();
    onChange(next.value);
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[options.indexOf(next)]?.focus();
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('flex gap-1 rounded-control bg-surface-2 p-1 ring-1 ring-inset ring-line/70', className)}
    >
      {options.map(option => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (!options.some(o => o.value === value) && option === options[0]) ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex flex-auto shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[calc(var(--radius-control)-4px)] font-semibold transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
              selected ? 'bg-surface text-fg shadow-e1' : 'text-fg-subtle hover:text-fg',
            )}
          >
            {option.dot && <span className={cn('size-2 shrink-0 rounded-full', option.dot)} aria-hidden="true" />}
            {option.icon}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Which part of the day a shift name means: morning, noon or evening. */
export function shiftPart(name: string): 'morning' | 'noon' | 'evening' {
  const value = name.toLowerCase();
  if (value.includes('evening') || value.includes('night') || value.includes('sham') || value.includes('raat')) return 'evening';
  if (value.includes('noon') || value.includes('dopehar')) return 'noon';
  return 'morning';
}

export function ShiftIcon({ name, size = 14, className }: { name: string; size?: number; className?: string }) {
  const part = shiftPart(name);
  if (part === 'evening') return <Moon size={size} className={cn('shrink-0 text-info', className)} aria-hidden="true" />;
  if (part === 'noon') return <SunMedium size={size} className={cn('shrink-0 text-warning', className)} aria-hidden="true" />;
  return <Sun size={size} className={cn('shrink-0 text-warning', className)} aria-hidden="true" />;
}

/** Identity colours for the milk varieties (small dots and mix bars only). */
export const VARIETY_DOT: Record<string, string> = {
  buffalo: 'bg-brand-accent',
  cow: 'bg-info',
  mixed: 'bg-fg-faint',
};

export function varietyDot(type: string) {
  const value = String(type || '').toLowerCase();
  if (value.includes('buffalo')) return VARIETY_DOT.buffalo;
  if (value.includes('cow')) return VARIETY_DOT.cow;
  return VARIETY_DOT.mixed;
}

/** Initials avatar; red when we owe the party money, neutral otherwise. */
export function Avatar({ name, owed = false, size = 'md' }: { name: string; owed?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const letters = (name || '?').trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('') || '?';
  const box = size === 'lg' ? 'size-11 rounded-2xl text-sm' : size === 'sm' ? 'size-7 rounded-lg text-[10px]' : 'size-9 rounded-xl text-xs';
  return (
    <span
      aria-hidden="true"
      className={cn('grid shrink-0 place-items-center font-bold', box, owed ? 'bg-danger-soft text-danger-fg' : 'bg-brand-soft text-brand-fg')}
    >
      {letters}
    </span>
  );
}

/** Paid vs khata split of a bill, as one bar with both amounts underneath. */
export function SettlementBar({ total, paid, formatMoney = formatCurrency }: { total: number; paid: number; formatMoney?: (value: number) => string }) {
  if (total <= 0) return null;
  const paidPart = Math.min(total, Math.max(0, paid));
  const due = Math.max(0, total - paidPart);
  const pct = (paidPart / total) * 100;
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-danger/20" aria-hidden="true">
        <span className="h-full rounded-full bg-success transition-[width] duration-300 ease-out-expo" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] font-semibold tabular-nums">
        <span className="flex items-center gap-1.5 text-success-fg"><span className="size-1.5 rounded-full bg-success" aria-hidden="true" />Paid {formatMoney(paidPart)}</span>
        <span className="flex items-center gap-1.5 text-danger-fg"><span className="size-1.5 rounded-full bg-danger" aria-hidden="true" />Khata {formatMoney(due)}</span>
      </div>
    </div>
  );
}

export function SectionLabel({ step, children, aside, htmlFor }: { step?: number; children: React.ReactNode; aside?: React.ReactNode; htmlFor?: string }) {
  const Tag = htmlFor ? 'label' : 'span';
  return (
    <div className="mb-1.5 flex min-h-5 items-center justify-between gap-2">
      <Tag htmlFor={htmlFor} className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
        {step !== undefined && (
          <span className="grid size-4 place-items-center rounded-full bg-brand text-[9px] font-bold text-brand-on" aria-hidden="true">{step}</span>
        )}
        {children}
      </Tag>
      {aside}
    </div>
  );
}
