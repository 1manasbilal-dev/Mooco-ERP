import React from 'react';
import { cn } from '../../lib/cn';

/**
 * Data table building blocks. Wrap in `TableContainer` for the card frame.
 * Money and quantity columns use `numeric` so they right-align with tabular figures.
 */
export function TableContainer({ className, ...props }: React.ComponentProps<'div'>) {
  // `overflow: clip` rounds the corners without becoming a scroll container, so a sticky
  // head inside can still stick to the page; `hidden` is the fallback for older browsers.
  return <div className={cn('overflow-hidden rounded-card border border-line bg-surface shadow-e1 supports-[overflow:clip]:overflow-clip', className)} {...props} />;
}

export type TableProps = React.ComponentProps<'table'> & {
  /**
   * Where the table scrolls. A sticky `THead` sticks to the nearest scrolling ancestor:
   * - `x` (default): an inner wrapper scrolls sideways (wide tables on phones); the head does not stick to the page.
   * - `both`: the inner wrapper scrolls both ways; give it a height with `wrapperClassName` (e.g. `max-h-[60vh]`) and the head sticks inside it.
   * - `none`: no inner wrapper; the head sticks to the page or to whatever container scrolls. Columns must fit.
   */
  scroll?: 'x' | 'both' | 'none';
  /** Classes for the inner scroll wrapper (`scroll="x"` or `"both"`). */
  wrapperClassName?: string;
};

export function Table({ className, scroll = 'x', wrapperClassName, ...props }: TableProps) {
  const table = <table className={cn('ds-table w-full border-collapse text-sm', className)} {...props} />;
  if (scroll === 'none') return table;
  return <div className={cn(scroll === 'both' ? 'overflow-auto overscroll-contain' : 'overflow-x-auto', wrapperClassName)}>{table}</div>;
}

/**
 * Sticky header. It sticks to the nearest scrolling ancestor, so pick `Table scroll="none"` (page
 * scroll) or `scroll="both"` with a height (container scroll). Solid, not blurred, so long tables scroll smoothly.
 */
export function THead({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('sticky top-0 z-[1] bg-surface-2', className)} {...props} />;
}

export function TBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={cn('[&>tr:last-child]:border-0', className)} {...props} />;
}

export function TR({ className, interactive, selected, ...props }: React.ComponentProps<'tr'> & { interactive?: boolean; selected?: boolean }) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        'border-b border-line/70 transition-colors duration-100',
        interactive && 'cursor-pointer hover:bg-surface-2/70',
        selected && 'bg-brand-soft/60 hover:bg-brand-soft',
        className,
      )}
      {...props}
    />
  );
}

export function TH({ className, numeric, ...props }: React.ComponentProps<'th'> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'h-10 whitespace-nowrap border-b border-line px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-fg-subtle first:pl-5 last:pr-5',
        numeric && 'text-right',
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, numeric, ...props }: React.ComponentProps<'td'> & { numeric?: boolean }) {
  return (
    <td
      className={cn('px-4 py-3 align-middle text-fg first:pl-5 last:pr-5', numeric && 'text-right font-semibold tabular-nums', className)}
      {...props}
    />
  );
}
