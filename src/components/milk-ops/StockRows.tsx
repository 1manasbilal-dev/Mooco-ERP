import React, { memo, useState } from 'react';
import { Archive, Boxes, Briefcase, ChevronDown, ChevronUp, ClipboardCheck, Factory, Lock, Package, Truck } from 'lucide-react';
import { Badge, IconButton, Money, TD, TR } from '../ui';
import { cn } from '../../lib/cn';
import { formatCurrency, formatQty } from '../../lib/formatters';
import { STATUS_BADGE, type StockRow, type StockStatus } from './inventoryStock';

type AuditHandler = (itemId: string, variantId: string) => void;

const SOURCE_ICON: Record<string, React.ReactNode> = {
  Supplier: <Truck aria-hidden="true" />,
  Production: <Factory aria-hidden="true" />,
};

const qtyTone = (status: StockStatus) =>
  status === 'negative' || status === 'out' ? 'text-danger-fg' : status === 'low' ? 'text-warning-fg' : 'text-fg';

export function StatusBadge({ status }: { status: StockStatus }) {
  const badge = STATUS_BADGE[status];
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
      <span className="inline-flex items-center gap-1 [&_svg]:size-3">{SOURCE_ICON[item.source] || <Briefcase aria-hidden="true" />}{item.source}</span>
      {item.isSystem && <Badge>System</Badge>}
      {row.packaged.length > 0 && <Badge tone="warning" icon={<Archive aria-hidden="true" />}>{formatQty(row.packCount)} packs</Badge>}
      {row.multiUnits.length > 0 && <Badge tone="info" icon={<Boxes aria-hidden="true" />}>Multi-unit</Badge>}
    </div>
  );
}

/** "≈ 2.5 Dozen · 1 Tray": loose stock expressed in the item's bigger units. */
const multiUnitText = (row: StockRow) =>
  row.multiUnits
    .map(mu => `${formatQty(mu.quantity_in_base_unit > 0 ? row.quantity / mu.quantity_in_base_unit : 0, 1)} ${mu.name}`)
    .join(' · ');

function StockQty({ row }: { row: StockRow }) {
  if (row.packagedOnly) {
    return (
      <span className={cn('font-bold tabular-nums', qtyTone(row.status))}>
        {formatQty(row.packCount)} <span className="text-[11px] font-semibold text-fg-subtle">packs</span>
      </span>
    );
  }
  return (
    <span className={cn('font-bold tabular-nums', qtyTone(row.status))}>
      {formatQty(row.quantity, 3)} <span className="text-[11px] font-semibold text-fg-subtle">{row.item.unit}</span>
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
      <Money amount={row.valuation.costValue} className="font-bold text-fg" />
      {row.valuation.costMissing ? (
        <span className="block text-[11px] font-semibold text-warning-fg">Cost set nahi</span>
      ) : row.isProduct && row.valuation.retailValue > 0 ? (
        <span className="block text-[11px] font-medium text-fg-subtle">Retail {formatCurrency(row.valuation.retailValue)}</span>
      ) : null}
    </>
  );
}

interface TableRowsProps {
  row: StockRow;
  onAudit: AuditHandler;
}

/** One item in the desktop table, plus a sub-row per pre-packed size. */
export const StockTableRows = memo(function StockTableRows({ row, onAudit }: TableRowsProps) {
  const { item } = row;
  return (
    <>
      <TR className={cn('hover:bg-surface-2/60', row.status === 'negative' && 'bg-danger-soft/40')}>
        <TD>
          <div className="flex items-center gap-3">
            <ItemThumb row={row} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-semibold text-fg">{item.name}</p>
              <ItemMeta row={row} />
            </div>
          </div>
        </TD>
        <TD className="text-xs text-fg-muted">{item.category?.[0] || 'Uncategorized'}</TD>
        <TD numeric>
          <StockQty row={row} />
          {!row.packagedOnly && row.multiUnits.length > 0 && (
            <span className="block text-[11px] font-medium text-info-fg">≈ {multiUnitText(row)}</span>
          )}
        </TD>
        <TD numeric className="font-medium text-fg-muted">
          <RateCell row={row} />
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-fg-faint">{row.isProduct ? 'Sale' : 'Cost'}</span>
        </TD>
        <TD numeric><ValueCell row={row} /></TD>
        <TD className="text-center"><StatusBadge status={row.status} /></TD>
        <TD className="text-right">
          <IconButton size="sm" aria-label={`${item.name}: stock audit`} icon={<ClipboardCheck />} onClick={() => onAudit(item.id, 'loose')} />
        </TD>
      </TR>
      {row.packaged.map(v => {
        const count = Number(row.variantStocks[v.id]) || 0;
        const pack = row.valuation.packs.find(p => p.id === v.id);
        return (
          <TR key={v.id} className="bg-surface-2/40 hover:bg-surface-2/70">
            <TD className="py-2.5 pl-12">
              <div className="flex items-center gap-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning-fg [&_svg]:size-3.5"><Archive aria-hidden="true" /></span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-fg-muted">{v.name}</p>
                  <p className="text-[11px] text-fg-subtle">Pre-packed</p>
                </div>
              </div>
            </TD>
            <TD className="py-2.5 text-xs tabular-nums text-fg-subtle">{formatQty(v.quantity_in_base_unit, 3)} {item.unit} / pack</TD>
            <TD numeric className="py-2.5">
              <span className={cn('tabular-nums', count < 0 ? 'text-danger-fg' : count > 0 ? 'text-fg' : 'text-fg-faint')}>{formatQty(count)}</span>
              <span className="ml-1 text-[11px] font-semibold text-fg-subtle">packs</span>
            </TD>
            <TD numeric className="py-2.5 text-xs font-medium text-fg-muted">{formatCurrency(v.selling_price || row.rate * v.quantity_in_base_unit)}</TD>
            <TD numeric className="py-2.5 text-xs font-medium text-fg-subtle">(<Money amount={pack?.costValue || 0} />)</TD>
            <TD className="py-2.5 text-center">
              {count < 0 ? <Badge tone="danger" variant="solid">Minus</Badge> : count > 0 ? <Badge tone="success">In stock</Badge> : <Badge tone="danger">Out</Badge>}
            </TD>
            <TD className="py-2.5 text-right">
              <IconButton size="sm" aria-label={`${v.name}: packed stock audit`} icon={<ClipboardCheck />} onClick={() => onAudit(item.id, v.id)} />
            </TD>
          </TR>
        );
      })}
    </>
  );
});

/** One item as a card on phones. */
export const StockCard = memo(function StockCard({ row, onAudit }: TableRowsProps) {
  const { item } = row;
  const [showPacks, setShowPacks] = useState(false);
  return (
    <li className={cn('rounded-card border bg-surface p-3.5 shadow-e1', row.status === 'negative' ? 'border-danger/40' : 'border-line')}>
      <div className="flex items-start gap-3">
        <ItemThumb row={row} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug text-fg">{item.name}</p>
          <p className="text-[11px] text-fg-subtle">{item.category?.[0] || 'Uncategorized'}</p>
          <ItemMeta row={row} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusBadge status={row.status} />
          <IconButton size="sm" variant="secondary" aria-label={`${item.name}: stock audit`} icon={<ClipboardCheck />} onClick={() => onAudit(item.id, 'loose')} />
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 rounded-control bg-surface-2 px-3 py-2.5 text-xs">
        <div className="min-w-0">
          <dt className="text-fg-subtle">{row.packagedOnly ? 'Packs' : 'Stock'}</dt>
          <dd className="mt-0.5 text-sm"><StockQty row={row} /></dd>
        </div>
        <div className="min-w-0 text-center">
          <dt className="text-fg-subtle">{row.isProduct ? 'Sale rate' : 'Cost rate'}</dt>
          <dd className="mt-0.5 text-sm font-semibold text-fg-muted"><RateCell row={row} /></dd>
        </div>
        <div className="min-w-0 text-right">
          <dt className="text-fg-subtle">Value (cost)</dt>
          <dd className="mt-0.5 text-sm"><ValueCell row={row} /></dd>
        </div>
      </dl>

      {!row.packagedOnly && row.multiUnits.length > 0 && (
        <p className="mt-2 text-[11px] font-medium text-info-fg">≈ {multiUnitText(row)}</p>
      )}

      {row.packaged.length > 0 && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setShowPacks(open => !open)}
            aria-expanded={showPacks}
            className="flex h-10 w-full cursor-pointer items-center justify-between rounded-control bg-warning-soft px-3 text-xs font-semibold text-warning-fg"
          >
            <span className="flex items-center gap-1.5"><Archive className="size-3.5" aria-hidden="true" /> {row.packaged.length} packed sizes · {formatQty(row.packCount)} packs</span>
            {showPacks ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
          </button>
          {showPacks && (
            <ul className="mt-2 space-y-1.5 animate-fade-up">
              {row.packaged.map(v => {
                const count = Number(row.variantStocks[v.id]) || 0;
                return (
                  <li key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-fg">{v.name}</p>
                      <p className="text-fg-subtle">{formatQty(v.quantity_in_base_unit, 3)} {item.unit} · {formatCurrency(v.selling_price || row.rate * v.quantity_in_base_unit)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className={cn('font-bold tabular-nums', count < 0 ? 'text-danger-fg' : count > 0 ? 'text-fg' : 'text-fg-faint')}>{formatQty(count)} packs</span>
                      <IconButton size="sm" aria-label={`${v.name}: packed stock audit`} icon={<ClipboardCheck />} onClick={() => onAudit(item.id, v.id)} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  );
});
