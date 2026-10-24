import React from 'react';
import { Badge, Money } from '../ui';
import type { Tone } from '../ui';
import { cn } from '../../lib/cn';
import type { LedgerKind, StatementSupplier } from '../../lib/supplierStatement';
import type { Supplier } from '../../types';

/*
 * Supplier ledger sign rule (same as DairyContext and lib/supplierStatement):
 *   pending_balance > 0  → Payable: the dairy owes the supplier (we owe)    → danger
 *   pending_balance < 0  → Advance: the dairy paid ahead (supplier owes us) → success
 * Amounts are shown without a minus sign next to a label, so the colour and the word agree.
 */

/** Below half a rupee a ledger balance counts as settled (matches lib/supplierStatement). */
export const SETTLED_EPSILON = 0.5;

export type BalanceState = 'payable' | 'advance' | 'settled';

export function balanceState(value: number): BalanceState {
  const amount = Number(value) || 0;
  if (Math.abs(amount) < SETTLED_EPSILON) return 'settled';
  return amount > 0 ? 'payable' : 'advance';
}

const STATE_TONE: Record<BalanceState, Tone> = { payable: 'danger', advance: 'success', settled: 'neutral' };
const STATE_TEXT: Record<BalanceState, string> = {
  payable: 'text-danger-fg',
  advance: 'text-success-fg',
  settled: 'text-fg-subtle',
};
const STATE_SHORT: Record<BalanceState, string> = { payable: 'Payable', advance: 'Advance', settled: 'Settled' };
const STATE_LONG: Record<BalanceState, string> = {
  payable: 'Payable · we owe',
  advance: 'Advance · paid ahead',
  settled: 'Settled',
};

export const balanceTone = (value: number) => STATE_TONE[balanceState(value)];
export const balanceTextClass = (value: number) => STATE_TEXT[balanceState(value)];
export const balanceLabel = (value: number, long = false) => (long ? STATE_LONG : STATE_SHORT)[balanceState(value)];

/** Ledger amount: absolute value coloured by direction, with an optional Payable / Advance word. */
export function SupplierBalance({
  value,
  label = 'short',
  compact,
  className,
}: {
  value: number;
  /** `short` = "Payable", `none` = amount only. */
  label?: 'short' | 'none';
  compact?: boolean;
  className?: string;
}) {
  const state = balanceState(value);
  return (
    <span className={cn('inline-flex items-baseline gap-1.5 whitespace-nowrap', STATE_TEXT[state], className)}>
      <Money amount={state === 'settled' ? 0 : Math.abs(value)} compact={compact} />
      {label === 'short' && state !== 'settled' && (
        <span className="text-[10px] font-bold uppercase tracking-wide opacity-80">{state === 'payable' ? 'Pay' : 'Adv'}</span>
      )}
    </span>
  );
}

export function SupplierBalanceBadge({ value, long, className }: { value: number; long?: boolean; className?: string }) {
  return (
    <Badge tone={balanceTone(value)} dot className={className}>
      {balanceLabel(value, long)}
    </Badge>
  );
}

const KIND_TONE: Record<LedgerKind, Tone> = {
  Opening: 'neutral',
  Milk: 'info',
  Material: 'neutral',
  Charge: 'warning',
  Payment: 'success',
  Refund: 'warning',
};

export function LedgerKindBadge({ kind, subtype }: { kind: LedgerKind; subtype?: string }) {
  const label = subtype === 'Advance' ? 'Advance' : subtype === 'Return' ? 'Return' : kind;
  return <Badge tone={KIND_TONE[kind]}>{label}</Badge>;
}

export function toStatementSupplier(supplier: Supplier): StatementSupplier {
  return {
    id: supplier.id,
    name: supplier.name,
    phone: supplier.phone,
    whatsapp: supplier.whatsapp,
    village: supplier.village,
    city: supplier.city,
    address: supplier.address,
    pendingBalance: Number(supplier.pending_balance) || 0,
  };
}

export const supplierPlace = (supplier: Pick<Supplier, 'village' | 'city'>) =>
  [supplier.village, supplier.city].filter(Boolean).join(', ');

export function SupplierAvatar({ name, className }: { name: string; className?: string }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden="true"
      className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-sm font-bold text-fg-muted ring-1 ring-inset ring-line', className)}
    >
      {initial}
    </span>
  );
}

/** Small label + value pair for detail panels. */
export function InfoRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-[13px]">
      <span className="shrink-0 text-fg-subtle">{label}</span>
      <span className="min-w-0 text-right font-semibold text-fg">{children}</span>
    </div>
  );
}
