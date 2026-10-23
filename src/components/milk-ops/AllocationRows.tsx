import { memo } from 'react';
import { Check, Plus, Refrigerator, X } from 'lucide-react';
import { Badge, IconButton, Input, Money } from '../ui';
import { cn } from '../../lib/cn';
import { formatCurrency, formatQty } from '../../lib/formatters';
import { parseQty, qtyInputValue } from './milkOps';

export type MilkSource = 'fresh' | 'retail';

/** One row a user can allocate from: a collection lot (fresh) or loose counter milk (retail). */
export interface SourceEntry {
  /** Cart key: the allocation id (fresh) or the item id (retail). */
  id: string;
  source: MilkSource;
  /** Name as stored on the batch breakdown (keeps a "Return:" prefix). */
  rawName: string;
  /** Name shown on screen. */
  name: string;
  isReturn: boolean;
  milkType: string;
  /** Cost per litre. */
  rate: number;
  /** Litres that can be allocated right now. */
  available: number;
  /** Fresh lots: collected litres. */
  original?: number;
  partial: boolean;
  day?: string;
  shift?: string;
  searchText: string;
}

export interface CartItem {
  allocationId: string;
  /** Typed litres, kept as text so "2." and "" can be edited naturally. */
  qty: string;
  supplierName: string;
  milkType: string;
  rate: number;
  source: MilkSource;
}

export const displaySourceName = (rawName: string) =>
  rawName.startsWith('Return:') ? rawName.replace('Return:', '').trim() : rawName || 'Unknown';

interface SourceRowProps {
  entry: SourceEntry;
  /** Litres of this row already in the cart, or null. */
  inCartQty: number | null;
  onOpen: (entry: SourceEntry) => void;
}

export const SourceRow = memo(function SourceRow({ entry, inCartQty, onOpen }: SourceRowProps) {
  const inCart = inCartQty !== null;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(entry)}
        aria-label={`${entry.name}: ${formatQty(entry.available)} L baqi. ${inCart ? 'Cart qty badlein' : 'Cart mein dalein'}`}
        className={cn(
          'group flex w-full cursor-pointer items-center gap-3 rounded-control border px-3 py-3 text-left transition-[border-color,background-color] duration-150 sm:px-4',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          inCart ? 'border-brand-accent/60 bg-brand-soft/60' : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2/60',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold text-fg">{entry.name}</p>
            {inCart && <Badge tone="brand" variant="solid">{formatQty(inCartQty)} L cart mein</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-subtle">
            {entry.source === 'retail' ? (
              <Badge tone="info" icon={<Refrigerator aria-hidden="true" />}>Counter</Badge>
            ) : entry.isReturn ? (
              <Badge tone="warning">Return</Badge>
            ) : (
              <Badge>{entry.milkType}</Badge>
            )}
            {entry.partial && <Badge tone="info">Partial</Badge>}
            <span className="tabular-nums">{formatCurrency(entry.rate)}/L</span>
            {entry.day && (
              <>
                <span aria-hidden="true">·</span>
                <span>{entry.day}{entry.shift ? ` · ${entry.shift}` : ''}</span>
              </>
            )}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[11px] font-semibold text-fg-subtle">Baqi</p>
          <p className="text-lg font-bold leading-tight tabular-nums text-fg">
            {formatQty(entry.available)}
            <span className="ml-0.5 text-xs font-semibold text-fg-subtle">L</span>
          </p>
          {entry.partial && entry.original !== undefined && (
            <p className="text-[11px] tabular-nums text-fg-subtle">of {formatQty(entry.original)} L</p>
          )}
        </div>

        <span
          aria-hidden="true"
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-control transition-colors duration-150 [&_svg]:size-4',
            inCart ? 'bg-brand text-brand-on' : 'bg-brand-soft text-brand-fg group-hover:bg-brand group-hover:text-brand-on',
          )}
        >
          {inCart ? <Check /> : <Plus />}
        </span>
      </button>
    </li>
  );
});

interface CartLineProps {
  line: CartItem;
  /** Live litres left in this lot / counter item. */
  available: number;
  onQtyChange: (id: string, text: string) => void;
  onRemove: (id: string) => void;
}

/** Problem with one cart line, or '' when it can be allocated. */
export const cartLineError = (line: CartItem, available: number) => {
  const qty = parseQty(line.qty);
  if (!(qty > 0)) return 'Qty likhein';
  if (qty > Math.max(0, available) + 0.001) return `Sirf ${formatQty(Math.max(0, available))} L baqi hai`;
  return '';
};

export const CartLine = memo(function CartLine({ line, available, onQtyChange, onRemove }: CartLineProps) {
  const name = displaySourceName(line.supplierName);
  const qty = parseQty(line.qty);
  const error = cartLineError(line, available);
  const isRetail = line.source === 'retail';

  return (
    <li className={cn('rounded-control border bg-surface p-3', error ? 'border-danger/40' : 'border-line')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-fg">
            {isRetail && <Refrigerator className="size-3.5 shrink-0 text-info-fg" aria-hidden="true" />}
            <span className="truncate">{name}</span>
          </p>
          <p className="mt-0.5 text-xs tabular-nums text-fg-subtle">
            {isRetail ? 'Counter milk' : line.milkType} · {formatCurrency(line.rate)}/L · Max {formatQty(Math.max(0, available))} L
          </p>
        </div>
        <IconButton
          size="sm"
          aria-label={`${name} cart se hatayen`}
          icon={<X />}
          onClick={() => onRemove(line.allocationId)}
          className="-mr-1 -mt-1 hover:bg-danger-soft hover:text-danger-fg"
        />
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <div className="w-32 shrink-0">
          <Input
            inputMode="decimal"
            autoComplete="off"
            value={line.qty}
            onChange={event => onQtyChange(line.allocationId, event.target.value.replace(/[^\d.]/g, ''))}
            onFocus={event => event.target.select()}
            suffix="L"
            aria-label={`${name} litres`}
            aria-invalid={error ? true : undefined}
            className="text-right font-semibold tabular-nums"
          />
        </div>
        {qty < available - 0.001 && available > 0 && (
          <button
            type="button"
            onClick={() => onQtyChange(line.allocationId, qtyInputValue(available))}
            className="h-8 cursor-pointer rounded-lg px-2.5 text-xs font-semibold text-brand-fg transition-colors hover:bg-brand-soft"
          >
            Max
          </button>
        )}
        <Money amount={qty * line.rate} className="ml-auto text-sm font-semibold text-fg-muted" />
      </div>
      {error && <p className="mt-1.5 text-xs font-semibold text-danger-fg">{error}</p>}
    </li>
  );
});
