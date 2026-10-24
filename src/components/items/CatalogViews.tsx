import React, { memo } from 'react';
import { ArchiveX, ArrowDown, ArrowUp, Boxes, GripVertical, Pencil, ShieldAlert, Trash2 } from 'lucide-react';
import { Badge, IconButton, Money, Skeleton, TD, TR } from '../ui';
import type { Tone } from '../ui';
import { cn } from '../../lib/cn';
import { formatQty } from '../../lib/formatters';
import { STOCK_STATUS_LABEL, formatBaseQty } from '../../lib/stockRules';
import type { CatalogRow } from './catalogModel';
import { ProductThumb } from './ProductThumb';

type StockLook = { tone: Tone; short: string; text: string; dot: string };

// One look per alert from the shared stock rule; inactive products get no alert colours.
const STOCK_LOOK: Record<'ok' | 'low' | 'out' | 'minus' | 'inactive', StockLook> = {
  ok: { tone: 'success', short: '', text: 'text-fg', dot: 'bg-success' },
  low: { tone: 'warning', short: 'Low', text: 'text-warning-fg', dot: 'bg-warning' },
  out: { tone: 'danger', short: 'Out', text: 'text-danger-fg', dot: 'bg-danger' },
  minus: { tone: 'danger', short: 'Minus', text: 'text-danger-fg', dot: 'bg-danger' },
  inactive: { tone: 'neutral', short: '', text: 'text-fg-muted', dot: 'bg-fg-faint' },
};

function stockLook(row: CatalogRow): StockLook {
  if (row.item.isActive === false) return STOCK_LOOK.inactive;
  return STOCK_LOOK[row.alert || 'ok'];
}

/** Hover text: status, pile by pile, what can be sold and the alert level. */
export function stockTitle(row: CatalogRow): string {
  const { reading } = row;
  const parts = [row.item.isActive === false ? 'Inactive (no alerts)' : STOCK_STATUS_LABEL[reading.status]];
  if (row.breakdown.length) parts.push(row.breakdown.join(' · '));
  if (row.isSale && Math.abs(reading.sellableBase - reading.totalBase) > 0.0005) parts.push(`${formatBaseQty(reading.sellableBase, reading.unit)} can be sold`);
  parts.push(row.reorder > 0 ? `alert at ${formatBaseQty(row.reorder, reading.unit)}` : 'low-stock alert off');
  return parts.join(' · ');
}

/** Packs or stray counts make one number ambiguous, so the table spells the piles out. */
function hasPileDetail(row: CatalogRow): boolean {
  return row.reading.piles.some(p => (p.kind === 'packed' || p.kind === 'orphan') && p.count !== 0);
}

export type DropPosition = 'above' | 'below' | null;

export interface CatalogItemProps {
  row: CatalogRow;
  canEdit: boolean;
  canDelete: boolean;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export interface ReorderProps {
  /** Drag handle and up/down buttons show only for sale products in POS order. */
  reorderable?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  isDragging?: boolean;
  dropPosition?: DropPosition;
  onMove?: (id: string, direction: 'up' | 'down') => void;
  onDragStart?: (event: React.DragEvent, id: string) => void;
  onDragOver?: (event: React.DragEvent, id: string) => void;
  onDragLeave?: (event: React.DragEvent) => void;
  onDrop?: (event: React.DragEvent, id: string) => void;
  onDragEnd?: () => void;
}

const DROP_LINE: Record<'above' | 'below', string> = {
  above: 'shadow-[inset_0_2px_0_rgb(var(--brand-accent))]',
  below: 'shadow-[inset_0_-2px_0_rgb(var(--brand-accent))]',
};

const stopClick = (event: React.SyntheticEvent) => event.stopPropagation();

export function StockPill({ row, size = 'sm' }: { row: CatalogRow; size?: 'sm' | 'md' }) {
  const s = stockLook(row);
  return (
    <Badge tone={s.tone} dot size={size} title={stockTitle(row)}>
      <span className="tabular-nums">{formatQty(row.totalBase, 3)}</span> {row.item.unit}
      {s.short && <span className="font-bold">· {s.short}</span>}
    </Badge>
  );
}

export function MarginText({ row, className }: { row: CatalogRow; className?: string }) {
  if (!row.isSale || row.marginPct === null) return <span className={cn('text-fg-faint', className)}>—</span>;
  const pct = row.marginPct;
  return (
    <span
      className={cn('whitespace-nowrap font-semibold tabular-nums', pct < 0 ? 'text-danger-fg' : pct === 0 ? 'text-fg-subtle' : 'text-success-fg', className)}
      title={pct < 0 ? 'Rate below cost: a loss on every sale' : `Profit per ${row.basis?.per}`}
    >
      {pct < 0 ? 'Loss ' : ''}{pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%
    </span>
  );
}

function PriceText({ row, className }: { row: CatalogRow; className?: string }) {
  if (!row.isSale) return <span className={cn('text-fg-faint', className)}>—</span>;
  if (!row.basis) return <span className={cn('text-xs font-semibold text-warning-fg', className)}>No price</span>;
  return (
    <span className={cn('whitespace-nowrap', className)}>
      <Money amount={row.basis.sell} className="font-bold text-fg" />
      <span className="ml-1 text-xs font-medium text-fg-subtle">/ {row.basis.per}</span>
    </span>
  );
}

function ItemFlags({ row }: { row: CatalogRow }) {
  const { item } = row;
  const units = item.variants?.length || 0;
  return (
    <>
      {item.isActive === false && <Badge tone="neutral">Inactive</Badge>}
      {item.isSystem && <Badge tone="info">System</Badge>}
      {row.packsOnly && row.isSale && <Badge tone="neutral">Packs only</Badge>}
      {units > 0 && <Badge tone="neutral" icon={<Boxes />}>{units} {units === 1 ? 'unit' : 'units'}</Badge>}
    </>
  );
}

function metaLine(row: CatalogRow) {
  const cats = row.item.category?.length ? row.item.category.join(', ') : 'Uncategorized';
  return `${cats} · ${row.item.unit}`;
}

function RowActions({ row, canEdit, canDelete, onEdit, onDelete }: Omit<CatalogItemProps, 'onOpen'>) {
  const { item } = row;
  return (
    <div className="flex items-center justify-end gap-0.5" onClick={stopClick} onKeyDown={stopClick}>
      {canEdit && <IconButton size="sm" aria-label={`Edit ${item.name}`} icon={<Pencil />} onClick={() => onEdit(item.id)} />}
      {canDelete && (
        item.isSystem ? (
          <IconButton size="sm" aria-label={item.isActive ? `${item.name}: system product, make inactive` : `${item.name}: system product`} icon={<ShieldAlert />} onClick={() => onDelete(item.id)} />
        ) : (
          <IconButton
            size="sm"
            aria-label={`Delete ${item.name}`}
            icon={item.isActive === false ? <ArchiveX /> : <Trash2 />}
            className="hover:bg-danger-soft hover:text-danger-fg"
            onClick={() => onDelete(item.id)}
          />
        )
      )}
    </div>
  );
}

function MoveButtons({ id, isFirst, isLast, onMove, className }: { id: string; isFirst?: boolean; isLast?: boolean; onMove?: ReorderProps['onMove']; className?: string }) {
  return (
    <div className={cn('flex items-center', className)} onClick={stopClick} onKeyDown={stopClick}>
      <IconButton size="sm" aria-label="Move up in POS" icon={<ArrowUp />} disabled={isFirst} onClick={() => onMove?.(id, 'up')} />
      <IconButton size="sm" aria-label="Move down in POS" icon={<ArrowDown />} disabled={isLast} onClick={() => onMove?.(id, 'down')} />
    </div>
  );
}

const openOnKey = (event: React.KeyboardEvent, open: () => void) => {
  if (event.target !== event.currentTarget) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    open();
  }
};

/** Desktop table row. */
export const ProductTableRow = memo(function ProductTableRow(props: CatalogItemProps & ReorderProps) {
  const { row, onOpen, reorderable, isFirst, isLast, isDragging, dropPosition, onMove, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd } = props;
  const { item } = row;
  const s = stockLook(row);
  const inactive = item.isActive === false;

  return (
    <TR
      interactive
      tabIndex={0}
      onClick={() => onOpen(item.id)}
      onKeyDown={event => openOnKey(event, () => onOpen(item.id))}
      draggable={reorderable || undefined}
      onDragStart={reorderable ? event => onDragStart?.(event, item.id) : undefined}
      onDragOver={reorderable ? event => onDragOver?.(event, item.id) : undefined}
      onDragLeave={reorderable ? onDragLeave : undefined}
      onDrop={reorderable ? event => onDrop?.(event, item.id) : undefined}
      onDragEnd={reorderable ? onDragEnd : undefined}
      className={cn('group focus-visible:bg-surface-2 focus-visible:outline-none', isDragging && 'opacity-40', dropPosition && DROP_LINE[dropPosition])}
    >
      <TD className="w-28 py-2.5">
        <div className="flex items-center gap-1">
          {reorderable ? (
            <span className="cursor-grab text-fg-faint hover:text-fg-muted active:cursor-grabbing" title="Drag up or down to change the POS order" aria-hidden="true">
              <GripVertical className="size-4" />
            </span>
          ) : (
            <span className="w-4" aria-hidden="true" />
          )}
          {row.isSale ? (
            <Badge tone="brand" className="min-w-9 justify-center font-mono" title="Position in the POS grid">#{item.sort_order ?? 999}</Badge>
          ) : (
            <span className="min-w-9 text-center text-xs text-fg-faint">—</span>
          )}
          {reorderable && (
            <MoveButtons id={item.id} isFirst={isFirst} isLast={isLast} onMove={onMove} className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
          )}
        </div>
      </TD>
      <TD className="py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <ProductThumb name={item.name} src={item.image_url} dimmed={inactive} className="size-10 rounded-xl" initialsClassName="text-xs" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn('font-semibold', inactive ? 'text-fg-subtle line-through decoration-fg-faint' : 'text-fg')}>{item.name}</span>
              <ItemFlags row={row} />
            </div>
            <p className="mt-0.5 truncate text-xs text-fg-subtle">{metaLine(row)} · {item.source || 'Both'}</p>
          </div>
        </div>
      </TD>
      <TD className="py-2.5">
        <div title={stockTitle(row)}>
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <span className={cn('size-2 rounded-full', s.dot)} aria-hidden="true" />
            <span className={cn('font-semibold tabular-nums', s.text)}>{formatQty(row.totalBase, 3)}</span>
            <span className="text-xs text-fg-subtle">{item.unit}</span>
            {s.short && <Badge tone={s.tone}>{s.short}</Badge>}
          </span>
          {hasPileDetail(row) && <p className="mt-0.5 max-w-[16rem] truncate pl-4 text-[11px] text-fg-subtle">{row.breakdown.join(' · ')}</p>}
        </div>
      </TD>
      <TD numeric className="py-2.5 font-medium text-fg-muted">
        <Money amount={item.cost_price} />
      </TD>
      <TD numeric className="py-2.5">
        <PriceText row={row} />
      </TD>
      <TD numeric className="py-2.5">
        <MarginText row={row} />
      </TD>
      <TD className="w-24 py-2.5">
        <RowActions {...props} />
      </TD>
    </TR>
  );
});

/** Phone list row. */
export const ProductListItem = memo(function ProductListItem(props: CatalogItemProps & ReorderProps) {
  const { row, onOpen, reorderable, isFirst, isLast, onMove } = props;
  const { item } = row;
  const inactive = item.isActive === false;

  return (
    <li className="relative flex items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-2/70">
      <ProductThumb name={item.name} src={item.image_url} dimmed={inactive} className="size-12 rounded-xl" initialsClassName="text-sm" />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen(item.id)}
          className="block w-full truncate text-left text-sm font-semibold text-fg after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-control focus-visible:after:ring-2 focus-visible:after:ring-ring"
        >
          <span className={cn(inactive && 'text-fg-subtle line-through decoration-fg-faint')}>{item.name}</span>
        </button>
        <p className="mt-0.5 truncate text-xs text-fg-subtle">
          {row.isSale && <span className="font-mono font-semibold text-brand-fg">#{item.sort_order ?? 999} · </span>}
          {metaLine(row)}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StockPill row={row} />
          {inactive && <Badge tone="neutral">Inactive</Badge>}
          {row.isSale && row.marginPct !== null && row.marginPct < 0 && <Badge tone="danger">Loss</Badge>}
        </div>
        {hasPileDetail(row) && <p className="mt-1 truncate text-[11px] text-fg-subtle">{row.breakdown.join(' · ')}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <PriceText row={row} className="text-sm" />
        {reorderable && <MoveButtons id={item.id} isFirst={isFirst} isLast={isLast} onMove={onMove} className="relative z-[1] -mr-1" />}
      </div>
    </li>
  );
});

/** Grid card with a photo. */
export const ProductCard = memo(function ProductCard({ row, canEdit, onOpen, onEdit }: CatalogItemProps) {
  const { item } = row;
  const inactive = item.isActive === false;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-e1 transition-[box-shadow,border-color] duration-200 ease-out-expo hover:border-line-strong hover:shadow-e2 focus-within:border-line-strong">
      <div className="relative">
        <ProductThumb name={item.name} src={item.image_url} dimmed={inactive} className="aspect-[4/3] w-full ring-0" initialsClassName="text-2xl" />
        <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-1">
          <div className="flex flex-wrap gap-1">
            {row.isSale && <Badge tone="brand" variant="solid" className="font-mono">#{item.sort_order ?? 999}</Badge>}
            {inactive && <Badge tone="neutral" variant="solid">Inactive</Badge>}
          </div>
        </div>
        {canEdit && (
          <IconButton
            size="sm"
            variant="secondary"
            aria-label={`Edit ${item.name}`}
            icon={<Pencil />}
            onClick={() => onEdit(item.id)}
            className="absolute right-2 top-2 z-[1] opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
          />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-3.5">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onOpen(item.id)}
            className="block w-full truncate text-left text-sm font-bold text-fg after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-card focus-visible:after:ring-2 focus-visible:after:ring-ring"
            title={item.name}
          >
            {item.name}
          </button>
          <p className="mt-0.5 truncate text-xs text-fg-subtle">{metaLine(row)}</p>
        </div>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-2 gap-y-1.5">
          <PriceText row={row} className="text-[15px]" />
          <StockPill row={row} />
        </div>
        {row.isSale && (
          <div className="flex items-center justify-between border-t border-line/70 pt-2 text-xs text-fg-subtle">
            <span>Cost <Money amount={item.cost_price} className="font-semibold text-fg-muted" /></span>
            <MarginText row={row} />
          </div>
        )}
      </div>
    </article>
  );
});

export function CatalogSkeleton({ view }: { view: 'grid' | 'list' }) {
  if (view === 'grid') {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-card border border-line bg-surface shadow-e1">
            <Skeleton className="aspect-[4/3] w-full rounded-none" />
            <div className="space-y-2 p-3.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-5 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="divide-y divide-line/70 overflow-hidden rounded-card border border-line bg-surface shadow-e1" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
    </div>
  );
}
