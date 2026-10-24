import React, { memo } from 'react';
import { AlertTriangle, Boxes, Briefcase, ClipboardCheck, EyeOff, Factory, History as HistoryIcon, Lock, Package, PackagePlus, Truck } from 'lucide-react';
import { Badge, Button, IconButton, Money, TD, TR } from '../ui';
import { cn } from '../../lib/cn';
import { formatCurrency } from '../../lib/formatters';
import { formatBaseQty } from '../../lib/stockRules';
import { STATUS_BADGE, type StockRow } from './inventoryStock';

export type RowAction = 'count' | 'history' | 'opening';
type ActionHandler = (action: RowAction, itemId: string) => void;

const SOURCE_ICON: Record<string, React.ReactNode> = {
  Supplier: <Truck aria-hidden="true" />,
  Production: <Factory aria-hidden="true" />,
};

const qtyTone = (row: StockRow) =>
  !row.alerting ? 'text-fg-muted'
    : row.status === 'minus' || row.status === 'out' ? 'text-danger-fg'
    : row.status === 'low' ? 'text-warning-fg'
    : 'text-fg';

/** The one status of a row. Inactive products get no stock alerts. */
export function StatusBadge({ row }: { row: Pick<StockRow, 'alerting' | 'status'> }) {
  if (!row.alerting) return <Badge dot>Inactive</Badge>;
  const badge = STATUS_BADGE[row.status];
  return <Badge tone={badge.tone} variant={badge.solid ? 'solid' : 'soft'} dot={!badge.solid}>{badge.label}</Badge>;
}

function ItemThumb({ row, size = 'md' }: { row: StockRow; size?: 'sm' | 'md' }) {
  const { item } = row;
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-2 text-fg-subtle ring-1 ring-inset ring-line [&_svg]:size-4',
        size === 'sm' ? 'size-9' : 'size-10',
        item.isSystem && 'bg-brand-soft text-brand-fg',
        !row.isActive && 'opacity-60',
      )}
    >
      {item.image_url ? (
        <img src={item.image_url} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
      ) : item.isSystem ? <Lock aria-hidden="true" /> : <Package aria-hidden="true" />}
    </span>
  );
}

function ItemMeta({ row }: { row: StockRow }) {
  const { item } = row;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
      <span className="truncate">{item.category?.[0] || 'Uncategorized'}</span>
      <span aria-hidden="true">·</span>
      <span className="inline-flex items-center gap-1 [&_svg]:size-3">{SOURCE_ICON[item.source] || <Briefcase aria-hidden="true" />}{item.source}</span>
      {item.isSystem && <Badge>System</Badge>}
    </div>
  );
}

/**
 * Pile by pile ("4 kg loose", "6 × 500 g tub", "2 × 1 kg tub (hidden)"), never one "N packs" figure.
 * Stray counts come last with a warning, because only a stock count can clear them.
 */
function PileList({ row, className }: { row: StockRow; className?: string }) {
  const piles = row.pileDetail ? row.piles : [];
  if (piles.length === 0 && row.stray.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] font-medium tabular-nums text-fg-subtle', className)} aria-label="Stock piles">
      {piles.map(part => {
        const hidden = part.endsWith('(hidden)');
        return (
          <li key={part} className={cn('inline-flex items-center gap-1', part.startsWith('-') && 'text-danger-fg', hidden && 'italic')}>
            {hidden && <EyeOff className="size-3 shrink-0" aria-hidden="true" />}
            {part}
          </li>
        );
      })}
      {row.stray.map(part => (
        <li key={part} className="inline-flex items-center gap-1 font-semibold text-warning-fg">
          <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
          {part}
        </li>
      ))}
    </ul>
  );
}

function OnHand({ row }: { row: StockRow }) {
  return (
    <span className={cn('font-bold tabular-nums', qtyTone(row))}>
      {formatBaseQty(row.reading.totalBase, '')}
      <span className="ml-1 text-[11px] font-semibold text-fg-subtle">{row.reading.unit}</span>
    </span>
  );
}

/** What the POS can sell now. Only sale products have it; it is shown dimmed when part of the stock can't be sold. */
function Sellable({ row }: { row: StockRow }) {
  if (!row.isProduct) return <span className="text-fg-faint">—</span>;
  const sellable = Math.max(0, row.reading.sellableBase);
  const short = sellable < Math.max(0, row.reading.totalBase);
  return (
    <span className={cn('font-semibold tabular-nums', sellable <= 0 ? 'text-fg-faint' : short ? 'text-warning-fg' : 'text-fg-muted')} title={short ? 'Some stock is in a hidden pack or in loose stock that is not for sale' : undefined}>
      {formatBaseQty(sellable, row.reading.unit)}
    </span>
  );
}

function RateCell({ row }: { row: StockRow }) {
  return row.fromPrice !== null ? (
    <span className="text-xs">From {formatCurrency(row.fromPrice)}</span>
  ) : (
    <Money amount={row.rate} />
  );
}

function ValueCell({ row }: { row: StockRow }) {
  return (
    <>
      <Money amount={row.reading.costValue} className="font-bold text-fg" />
      {row.costMissing ? (
        <span className="block text-[11px] font-semibold text-warning-fg">No cost set</span>
      ) : row.isProduct && row.retailValue > 0 ? (
        <span className="block text-[11px] font-medium text-fg-subtle">Retail {formatCurrency(row.retailValue)}</span>
      ) : null}
    </>
  );
}

interface RowProps {
  row: StockRow;
  canEdit: boolean;
  /** No movements yet and nothing on hand: offer "Opening stock" instead of a count. */
  canOpen: boolean;
  onAction: ActionHandler;
}

function RowActions({ row, canEdit, canOpen, onAction, compact }: RowProps & { compact?: boolean }) {
  const { item } = row;
  return (
    <div className={cn('flex items-center justify-end gap-1', compact && 'gap-1.5')}>
      {canEdit && canOpen ? (
        <Button size="sm" variant="soft" leftIcon={<PackagePlus />} onClick={() => onAction('opening', item.id)} aria-label={`${item.name}: opening stock`}>
          Opening stock
        </Button>
      ) : canEdit ? (
        <IconButton size="sm" variant={compact ? 'secondary' : 'ghost'} aria-label={`${item.name}: stock count`} title="Stock count" icon={<ClipboardCheck />} onClick={() => onAction('count', item.id)} />
      ) : null}
      <IconButton size="sm" variant={compact ? 'secondary' : 'ghost'} aria-label={`${item.name}: stock history`} title="Stock history" icon={<HistoryIcon />} onClick={() => onAction('history', item.id)} />
    </div>
  );
}

/** One product in the desktop table: on hand with its piles, sellable, rate, value and one status. */
export const StockTableRow = memo(function StockTableRow(props: RowProps) {
  const { row } = props;
  const { item } = row;
  return (
    <TR className={cn('hover:bg-surface-2/60', row.alerting && row.status === 'minus' && 'bg-danger-soft/40')}>
      <TD>
        <div className="flex items-center gap-3">
          <ItemThumb row={row} size="sm" />
          <div className="min-w-0">
            <p className={cn('truncate font-semibold', row.isActive ? 'text-fg' : 'text-fg-muted')}>{item.name}</p>
            <ItemMeta row={row} />
          </div>
        </div>
      </TD>
      <TD className="min-w-[10rem]">
        <OnHand row={row} />
        <PileList row={row} className="mt-0.5" />
        {row.multiUnitHint && <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-info-fg"><Boxes className="size-3" aria-hidden="true" />≈ {row.multiUnitHint}</span>}
      </TD>
      <TD numeric><Sellable row={row} /></TD>
      <TD numeric className="font-medium text-fg-muted">
        <RateCell row={row} />
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-fg-faint">{row.isProduct ? 'Sale' : 'Cost'}</span>
      </TD>
      <TD numeric><ValueCell row={row} /></TD>
      <TD className="text-center"><StatusBadge row={row} /></TD>
      <TD className="text-right"><RowActions {...props} /></TD>
    </TR>
  );
});

/** One product as a card on phones. */
export const StockCard = memo(function StockCard(props: RowProps) {
  const { row } = props;
  const { item } = row;
  return (
    <li className={cn('rounded-card border bg-surface p-3.5 shadow-e1', row.alerting && row.status === 'minus' ? 'border-danger/40' : 'border-line')}>
      <div className="flex items-start gap-3">
        <ItemThumb row={row} />
        <div className="min-w-0 flex-1">
          <p className={cn('text-sm font-semibold leading-snug', row.isActive ? 'text-fg' : 'text-fg-muted')}>{item.name}</p>
          <ItemMeta row={row} />
        </div>
        <StatusBadge row={row} />
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 rounded-control bg-surface-2 px-3 py-2.5 text-xs">
        <div className="min-w-0">
          <dt className="text-fg-subtle">On hand</dt>
          <dd className="mt-0.5 text-sm"><OnHand row={row} /></dd>
        </div>
        <div className="min-w-0 text-center">
          <dt className="text-fg-subtle">Sellable</dt>
          <dd className="mt-0.5 text-sm"><Sellable row={row} /></dd>
        </div>
        <div className="min-w-0 text-right">
          <dt className="text-fg-subtle">Value (cost)</dt>
          <dd className="mt-0.5 text-sm"><ValueCell row={row} /></dd>
        </div>
      </dl>

      {(row.pileDetail || row.stray.length > 0 || row.multiUnitHint) && (
        <div className="mt-2 space-y-1">
          <PileList row={row} />
          {row.multiUnitHint && <p className="flex items-center gap-1 text-[11px] font-medium text-info-fg"><Boxes className="size-3" aria-hidden="true" />≈ {row.multiUnitHint}</p>}
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line pt-2.5">
        <span className="text-xs text-fg-subtle">{row.isProduct ? 'Sale rate' : 'Cost rate'}: <span className="font-semibold text-fg-muted"><RateCell row={row} /></span></span>
        <RowActions {...props} compact />
      </div>
    </li>
  );
});
