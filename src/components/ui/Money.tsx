import React from 'react';
import { cn } from '../../lib/cn';
import { formatCompactValue, formatCurrency } from '../../lib/formatters';

export type MoneyProps = Omit<React.ComponentProps<'span'>, 'children'> & {
  amount: number | string | null | undefined;
  /**
   * `plain` (default) never colours. `balance` colours a ledger balance: positive = due (danger),
   * negative = advance (success). `signed` colours a cash flow: positive = in (success), negative = out (danger).
   */
  tone?: 'plain' | 'balance' | 'signed';
  /** "Rs 1.2M" style for tight spaces; the exact amount stays in the tooltip. */
  compact?: boolean;
};

/** Rupee amount with tabular figures. Always use this (or `formatCurrency`) for money on screen. */
export function Money({ amount, tone = 'plain', compact, className, title, ...props }: MoneyProps) {
  const value = Number(amount) || 0;
  const exact = formatCurrency(value);
  const text = compact && Math.abs(value) >= 10_000 ? `${value < 0 ? '-' : ''}Rs ${formatCompactValue(Math.abs(value))}` : exact;
  const color =
    tone === 'balance' ? (value > 0 ? 'text-danger-fg' : value < 0 ? 'text-success-fg' : 'text-fg-subtle')
    : tone === 'signed' ? (value > 0 ? 'text-success-fg' : value < 0 ? 'text-danger-fg' : 'text-fg-subtle')
    : undefined;

  return (
    <span className={cn('whitespace-nowrap tabular-nums', color, className)} title={title ?? (text !== exact ? exact : undefined)} {...props}>
      {text}
    </span>
  );
}
