import { memo } from 'react';
import { Droplets } from 'lucide-react';
import { Badge, Card } from '../ui';
import { cn } from '../../lib/cn';
import { formatQty } from '../../lib/formatters';

interface PoolSummaryProps {
  /** Litres still unallocated across open collection lots. */
  remaining: number;
  /** Litres already allocated out of those same open lots. */
  allocated: number;
  /** Fresh litres sitting in the allocation cart (not yet saved). */
  inCart: number;
  lots: number;
  className?: string;
}

const pct = (part: number, total: number) => (total > 0 ? `${Math.min(100, Math.max(0, (part / total) * 100))}%` : '0%');

/** The unallocated milk pool: one big number plus a meter of allocated / in cart / still left. */
export const PoolSummary = memo(function PoolSummary({ remaining, allocated, inCart, lots, className }: PoolSummaryProps) {
  const left = Math.max(0, remaining);
  const cart = Math.min(Math.max(0, inCart), left);
  const after = Math.max(0, left - cart);
  const done = Math.max(0, allocated);
  const total = done + left;
  const isEmpty = left <= 0.001;

  return (
    <Card className={cn('flex min-w-0 flex-col gap-4 p-4 sm:p-5', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4',
              isEmpty ? 'bg-success-soft text-success-fg' : 'bg-warning-soft text-warning-fg',
            )}
          >
            <Droplets aria-hidden="true" />
          </span>
          <span className="truncate text-[13px] font-semibold text-fg-subtle">Unallocated doodh</span>
        </div>
        <Badge tone={isEmpty ? 'success' : 'warning'} dot>
          {isEmpty ? 'Sab allocate ho gaya' : `${lots} ${lots === 1 ? 'lot' : 'lots'} baqi`}
        </Badge>
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <p className={cn('text-4xl font-bold leading-none tracking-tight tabular-nums sm:text-[44px]', isEmpty ? 'text-fg' : 'text-warning-fg')}>
          {formatQty(left)}
          <span className="ml-1 text-lg font-semibold text-fg-subtle">L</span>
        </p>
        {cart > 0 && (
          <p className="pb-1 text-sm font-medium text-fg-muted">
            Is allocation ke baad <span className="font-bold tabular-nums text-fg">{formatQty(after)} L</span> baqi
          </p>
        )}
      </div>

      {total > 0 && (
        <div className="space-y-2">
          <div
            className="flex h-2.5 overflow-hidden rounded-full bg-surface-3"
            role="img"
            aria-label={`Open lots: ${formatQty(done)} L allocate ho chuka, ${formatQty(cart)} L cart mein, ${formatQty(after)} L baqi`}
          >
            <span className="h-full bg-fg-faint/45 transition-[width] duration-200 ease-out-expo" style={{ width: pct(done, total) }} />
            <span className="h-full bg-brand-accent transition-[width] duration-200 ease-out-expo" style={{ width: pct(cart, total) }} />
            <span className="h-full bg-warning transition-[width] duration-200 ease-out-expo" style={{ width: pct(after, total) }} />
          </div>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-subtle">
            <LegendItem dot="bg-fg-faint/60" label="Allocate ho chuka" value={done} />
            <LegendItem dot="bg-brand-accent" label="Cart mein" value={cart} />
            <LegendItem dot="bg-warning" label="Baqi" value={after} />
          </dl>
        </div>
      )}
    </Card>
  );
});

function LegendItem({ dot, label, value }: { dot: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn('size-2 rounded-full', dot)} aria-hidden="true" />
      <dt>{label}</dt>
      <dd className="font-semibold tabular-nums text-fg-muted">{formatQty(value)} L</dd>
    </div>
  );
}
