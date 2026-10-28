import React, { useId, useState } from 'react';
import { ChartColumn, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useMediaQuery } from '../../hooks/useMediaQuery';

/** Phones, and phones held sideways: there the cards would fill most of the screen. */
export const COMPACT_STATS_QUERY = '(max-width: 767px), (max-height: 520px) and (pointer: coarse)';

const STORAGE_PREFIX = 'mooco_stats_open:';

const readOpen = (key: string) => {
  try { return localStorage.getItem(STORAGE_PREFIX + key) === '1'; } catch { return false; }
};
const writeOpen = (key: string, open: boolean) => {
  try {
    if (open) localStorage.setItem(STORAGE_PREFIX + key, '1');
    else localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {}
};

const PEEK_TONE = {
  danger: 'text-danger-fg',
  success: 'text-success-fg',
  warning: 'text-warning-fg',
} as const;

export interface StatPeek {
  value: React.ReactNode;
  /** Word after the value, e.g. "on credit". */
  label?: React.ReactNode;
  tone?: keyof typeof PEEK_TONE;
}

export interface StatGridProps {
  /** Accessible name of the cards, and the title of the folded bar on phones. Keep it short. */
  label: string;
  /** Remembers per screen, on this device, whether the cards were left open on a phone. */
  storageKey: string;
  /** One or two headline figures shown on the folded bar, so the main number is never hidden. */
  peek?: StatPeek[];
  /** Classes for the whole block, e.g. `print:hidden`. */
  className?: string;
  /** Column overrides for the card grid, e.g. `xl:grid-cols-4`. */
  gridClassName?: string;
  children: React.ReactNode;
}

/**
 * The `StatCard` row at the top of a screen. Wide screens show the cards as a grid. On phones they
 * fold into one bar with the headline figure, so the form or list the screen is for comes first;
 * a tap opens the cards and the choice is remembered for that screen.
 */
export function StatGrid({ label, storageKey, peek, className, gridClassName, children }: StatGridProps) {
  const compact = useMediaQuery(COMPACT_STATS_QUERY);
  const [open, setOpen] = useState(() => readOpen(storageKey));
  const gridId = useId();
  const grid = cn('grid grid-cols-2 gap-3 lg:grid-cols-4', gridClassName);

  if (!compact) {
    return <section aria-label={label} className={cn(grid, className)}>{children}</section>;
  }

  const toggle = () => {
    setOpen(previous => {
      writeOpen(storageKey, !previous);
      return !previous;
    });
  };

  return (
    <section aria-label={label} className={cn('flex flex-col gap-2', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={gridId}
        onClick={toggle}
        className="flex min-h-12 w-full items-center gap-3 rounded-card border border-line bg-surface px-3 py-2 text-left shadow-e1 transition-colors duration-150 hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-surface-2"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-muted" aria-hidden="true">
          <ChartColumn className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-semibold text-fg">{label}</span>
          {peek && peek.length > 0 && (
            <span className="truncate text-xs text-fg-subtle">
              {open ? 'Tap to hide' : peek.map((item, index) => (
                <React.Fragment key={index}>
                  {index > 0 && <span aria-hidden="true"> · </span>}
                  <span className={cn('font-bold tabular-nums text-fg', item.tone && PEEK_TONE[item.tone])}>{item.value}</span>
                  {item.label && <> {item.label}</>}
                </React.Fragment>
              ))}
            </span>
          )}
        </span>
        <ChevronDown className={cn('size-5 shrink-0 text-fg-subtle transition-transform duration-200', open && 'rotate-180')} aria-hidden="true" />
      </button>
      <div id={gridId} hidden={!open} className={open ? cn(grid, 'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200') : 'hidden'}>
        {children}
      </div>
    </section>
  );
}
