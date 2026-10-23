import React from 'react';
import type { FinancialAccount } from '../../types';
import { formatCurrency } from '../../lib/formatters';
import { cn } from '../../lib/cn';
import type { Tone } from '../ui';

const ICON_TONE: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-muted',
  brand: 'bg-brand-soft text-brand-fg',
  success: 'bg-success-soft text-success-fg',
  danger: 'bg-danger-soft text-danger-fg',
  warning: 'bg-warning-soft text-warning-fg',
  info: 'bg-info-soft text-info-fg',
};

/** Icon chip for a dialog header. */
export function DialogIcon({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={cn('flex size-10 items-center justify-center rounded-xl [&_svg]:size-5', ICON_TONE[tone])}>{children}</span>;
}

export const accountOptionLabel = (account: Pick<FinancialAccount, 'name' | 'balance'>) =>
  `${account.name} (${formatCurrency(account.balance)})`;

/** Switch styled checkbox row: title, help text and the toggle. */
export function ToggleRow({ title, description, checked, onChange, disabled }: {
  title: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-card border border-line/70 bg-surface-2 p-3', disabled && 'cursor-not-allowed opacity-60')}>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-fg">{title}</span>
        {description && <span className="mt-0.5 block text-xs text-fg-subtle">{description}</span>}
      </span>
      <span className="relative inline-flex shrink-0 items-center">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={event => onChange(event.target.checked)}
        />
        <span
          aria-hidden="true"
          className="h-6 w-10 rounded-full bg-surface-3 ring-1 ring-inset ring-line transition-colors duration-150 peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0.5 top-0.5 size-5 rounded-full bg-surface shadow-e1 transition-transform duration-150 ease-out-expo peer-checked:translate-x-4"
        />
      </span>
    </label>
  );
}
