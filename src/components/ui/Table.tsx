import React from 'react';
import { cn } from '../../lib/cn';

/**
 * Data table building blocks. Wrap in `TableContainer` for the card frame and horizontal scroll.
 * Money and quantity columns use `numeric` so they right-align with tabular figures.
 */
export function TableContainer({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('overflow-hidden rounded-card border border-line bg-surface shadow-e1', className)} {...props} />;
}

export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  );
}

/** Sticky header; give the scrolling parent a max height to keep it visible. */
export function THead({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('sticky top-0 z-[1] bg-surface-2/95 backdrop-blur-sm', className)} {...props} />;
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
