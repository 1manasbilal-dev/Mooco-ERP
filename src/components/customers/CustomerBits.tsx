import React, { memo, useCallback, useLayoutEffect, useRef } from 'react';
import { RotateCcw } from 'lucide-react';
import { Badge, Money } from '../ui';
import { cn } from '../../lib/cn';
import { balanceState, customerInitial, isReturnEntry, type LedgerEntry } from './customerUtils';

const BALANCE_TEXT = { due: 'text-danger-fg', advance: 'text-success-fg', settled: 'text-fg-subtle' } as const;

export interface KhataBalanceProps {
  balance: number;
  /** `word`: Due / Advance / Settled. `drcr`: statement style Dr / Cr. `none`: amount only. */
  label?: 'word' | 'drcr' | 'none';
  /** Stack the label under the amount (phone cards). */
  stacked?: boolean;
  className?: string;
  amountClassName?: string;
}

/**
 * A ledger balance as staff read it: the amount without a minus sign, coloured like `Money tone="balance"`
 * (due red, advance green), and named. "-Rs 500" read as a debt to the counter staff, not as an advance.
 */
export const KhataBalance = memo(function KhataBalance({ balance, label = 'word', stacked, className, amountClassName }: KhataBalanceProps) {
  const state = balanceState(balance);
  const color = BALANCE_TEXT[state];
  const text = label === 'drcr'
    ? state === 'due' ? 'Dr' : state === 'advance' ? 'Cr' : ''
    : state === 'due' ? 'Due' : state === 'advance' ? 'Advance' : 'Settled';
  return (
    <span className={cn(stacked ? 'inline-flex flex-col items-end leading-tight' : 'inline-flex items-baseline gap-1.5', className)}>
      <Money amount={state === 'settled' ? 0 : Math.abs(Number(balance) || 0)} className={cn('font-bold', color, amountClassName)} />
      {label !== 'none' && text && <span className={cn('text-[11px] font-semibold', color)}>{text}</span>}
    </span>
  );
});

export const BalanceBadge = ({ balance, size }: { balance: number; size?: 'sm' | 'md' }) => {
  const state = balanceState(balance);
  return (
    <Badge tone={state === 'due' ? 'danger' : state === 'advance' ? 'success' : 'neutral'} size={size} dot>
      {state === 'due' ? 'Due receivable' : state === 'advance' ? 'Advance credit' : 'Settled'}
    </Badge>
  );
};

export const CustomerAvatar = ({ name, size = 'md', className }: { name?: string; size?: 'md' | 'lg'; className?: string }) => (
  <span
    aria-hidden="true"
    className={cn(
      'flex shrink-0 items-center justify-center font-bold',
      size === 'lg' ? 'size-12 rounded-2xl bg-brand-soft text-lg text-brand-fg' : 'size-9 rounded-xl bg-surface-2 text-sm text-fg-muted',
      className,
    )}
  >
    {customerInitial(name)}
  </span>
);

/** Checkbox + label row on the design tokens (the design system has no checkbox primitive yet). */
export const CheckRow = ({
  id, checked, onChange, label, hint, disabled,
}: { id: string; checked: boolean; onChange: (checked: boolean) => void; label: React.ReactNode; hint?: React.ReactNode; disabled?: boolean }) => (
  <div className="flex items-start gap-2.5">
    <input
      id={id}
      type="checkbox"
      className="mt-0.5 size-4 shrink-0 cursor-pointer rounded accent-brand disabled:cursor-not-allowed"
      checked={checked}
      disabled={disabled}
      onChange={e => onChange(e.target.checked)}
    />
    <label htmlFor={id} className="cursor-pointer text-[13px] font-semibold text-fg-muted">
      {label}
      {hint && <span className="mt-0.5 block text-xs font-normal text-fg-subtle">{hint}</span>}
    </label>
  </div>
);

export const EntryTypeBadge = ({ entry }: { entry: LedgerEntry }) => {
  if (isReturnEntry(entry)) return <Badge tone="danger" icon={<RotateCcw aria-hidden="true" />}>Returned</Badge>;
  if (entry.isPartiallyReturned) return <Badge tone="warning" icon={<RotateCcw aria-hidden="true" />}>Part. return</Badge>;
  if (entry.type === 'Sale') return <Badge tone="info">Sale</Badge>;
  if (entry.type === 'Payment') return <Badge tone="success">Payment</Badge>;
  return <Badge tone="warning">Charge</Badge>;
};

/**
 * A callback whose identity never changes but that always runs the latest render's code, so memoised
 * ledger and customer rows are not re-rendered every time the context hands down new data.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
