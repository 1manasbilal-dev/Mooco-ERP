import React from 'react';
import { ArrowLeftRight, Banknote, BookOpen, CircleCheck, CircleX, Copy, RotateCcw, Wallet } from 'lucide-react';
import type { POSBill } from '../../types';
import { cn } from '../../lib/cn';
import { formatCurrency } from '../../lib/formatters';
import { Badge, Money } from '../ui';
import type { Tone } from '../ui';
import { billCopyValue, billLabel } from './salesHistoryUtils';

/** Small pieces shared by the Sales History list and its dialogs. */

const MODE_TONE: Record<string, Tone> = { Cash: 'neutral', Online: 'info', Credit: 'warning' };
const MODE_ICON: Record<string, React.ReactNode> = {
  Cash: <Banknote aria-hidden="true" />,
  Online: <Wallet aria-hidden="true" />,
  Credit: <BookOpen aria-hidden="true" />,
};

/** Cash = neutral, Online = info, Credit (on account) = warning. */
export function PaymentModeBadge({ mode, trailing, className, title }: { mode?: string; trailing?: React.ReactNode; className?: string; title?: string }) {
  const key = mode || 'Cash';
  return (
    <Badge tone={MODE_TONE[key] || 'neutral'} icon={MODE_ICON[key]} className={className} title={title}>
      {mode}
      {trailing}
    </Badge>
  );
}

/**
 * The bill's payment mode. When `lockReason` is null the chip is a button that opens the
 * Cash ⇄ Online dialog; otherwise it is a plain badge whose tooltip says why it is locked.
 */
export function PaymentModeChip({ sale, lockReason, onChange }: { sale: POSBill; lockReason: string | null; onChange: (sale: POSBill) => void }) {
  if (lockReason) return <PaymentModeBadge mode={sale.payment_mode} title={lockReason} />;
  return (
    <button
      type="button"
      onClick={event => { event.stopPropagation(); onChange(sale); }}
      title="Change payment mode (Cash ⇄ Online)"
      aria-label={`Payment mode ${sale.payment_mode} — change`}
      // The vertical padding only widens the tap target; the negative margin keeps the row height.
      className="group -my-1.5 inline-flex cursor-pointer rounded-full py-1.5 focus-visible:outline-none"
    >
      <PaymentModeBadge
        mode={sale.payment_mode}
        className="transition-shadow group-hover:shadow-e1 group-focus-visible:ring-2 group-focus-visible:ring-ring"
        trailing={<ArrowLeftRight aria-hidden="true" className="opacity-50 transition-opacity group-hover:opacity-100" />}
      />
    </button>
  );
}

/** Completed = success, Partially Returned = warning, Returned = danger. */
export function SaleStatusBadge({ status, short }: { status?: string; short?: boolean }) {
  const value = String(status || '');
  if (value === 'Returned') return <Badge tone="danger" icon={<CircleX aria-hidden="true" />}>Returned</Badge>;
  if (value === 'Partially Returned') {
    return <Badge tone="warning" icon={<RotateCcw aria-hidden="true" />}>{short ? 'Partial Ret' : 'Partially Returned'}</Badge>;
  }
  if (value === 'Cancelled') return <Badge tone="neutral">Cancelled</Badge>;
  return <Badge tone="success" icon={<CircleCheck aria-hidden="true" />}>Completed</Badge>;
}

/** Copy-to-clipboard invoice number chip. */
export function InvoiceChip({ sale, onCopy }: { sale: POSBill; onCopy: (event: React.MouseEvent, billNumber: string) => void }) {
  const label = billLabel(sale);
  return (
    <button
      type="button"
      onClick={event => onCopy(event, billCopyValue(sale))}
      title="Click to copy invoice number"
      aria-label={`Copy invoice #${label}`}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs font-bold text-fg ring-1 ring-inset ring-line transition-colors hover:bg-brand-soft hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      #{label}
      <Copy aria-hidden="true" className="size-3 opacity-50" />
    </button>
  );
}

/** Large amount for a StatCard: compact on phones (exact figure in the tooltip), full from `sm` up. */
export function StatMoney({ amount }: { amount: number }) {
  const exact = formatCurrency(amount);
  return (
    <>
      <Money amount={amount} compact className="sm:hidden" />
      <Money amount={amount} title={exact} className="hidden sm:inline" />
    </>
  );
}

/** Selectable option tile (resolution, refund mode, stock disposal, new payment mode). */
export function ChoiceCard({
  selected, onSelect, icon, title, description, disabled,
}: { selected: boolean; onSelect: () => void; icon?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        // Rings, not borders: the legacy dark-mode layer repaints every `border` colour.
        'flex min-h-11 w-full cursor-pointer flex-col items-start justify-center gap-0.5 rounded-control px-3 py-2.5 text-left ring-inset',
        'transition-[background-color,box-shadow,color] duration-150 ease-out-expo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        selected ? 'bg-brand-soft text-brand-fg ring-2 ring-brand-accent' : 'bg-surface text-fg-muted ring-1 ring-line hover:bg-surface-2 hover:text-fg',
      )}
    >
      <span className="flex items-center gap-2 text-sm font-semibold [&_svg]:size-4 [&_svg]:shrink-0">
        {icon}
        {title}
      </span>
      {description && <span className={cn('text-xs', selected ? 'text-brand-fg/80' : 'text-fg-subtle')}>{description}</span>}
    </button>
  );
}

/** Label / value line inside a summary panel. */
export function SummaryRow({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <span className="text-fg-subtle">{label}</span>
      <span className="min-w-0 truncate text-right font-semibold text-fg">{children}</span>
    </div>
  );
}

/** Subtotal, discount, refund, grand total and return reason of a bill. */
export function BillTotals({ sale, className }: { sale: POSBill; className?: string }) {
  const refund = Number(sale.refund_amount || 0);
  return (
    <div className={cn('space-y-1.5 rounded-control bg-surface p-3 text-sm ring-1 ring-inset ring-line', className)}>
      <SummaryRow label="Subtotal"><Money amount={sale.subtotal || sale.total} /></SummaryRow>
      {sale.discount > 0 && (
        <div className="flex items-center justify-between gap-3 font-semibold text-success-fg">
          <span>Discount</span>
          <span>- <Money amount={sale.discount} /></span>
        </div>
      )}
      {refund > 0 && (
        <div className="flex items-center justify-between gap-3 font-semibold text-danger-fg">
          <span>Refunded Amount</span>
          <span>- <Money amount={refund} /></span>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-line pt-2 font-bold text-fg">
        <span>Grand Total</span>
        <Money amount={sale.total || 0} className="text-base" />
      </div>
      {sale.return_reason && (
        <p className="mt-1 rounded-lg bg-danger-soft px-2.5 py-2 text-xs text-danger-fg">
          <strong>Return Reason:</strong> {sale.return_reason}
        </p>
      )}
    </div>
  );
}
