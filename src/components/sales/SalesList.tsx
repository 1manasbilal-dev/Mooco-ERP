import React, { memo } from 'react';
import { ArrowLeftRight, ChevronDown, Clock, Eye, Printer, RotateCcw, ShoppingBag } from 'lucide-react';
import type { POSBill } from '../../types';
import { cn } from '../../lib/cn';
import { formatCurrency } from '../../lib/formatters';
import { Button, EmptyState, IconButton, Money, TD, TR } from '../ui';
import { BillTotals, InvoiceChip, PaymentModeChip, SaleStatusBadge } from './SalesBits';
import { saleDateTime } from './salesHistoryUtils';

export type SaleAction = (sale: POSBill) => void;
export type CopyInvoice = (event: React.MouseEvent, billNumber: string) => void;

interface SaleRowProps {
  sale: POSBill;
  /** From saleModeLockReason: null when Cash ⇄ Online may be changed. */
  modeLock: string | null;
  onOpenDetail: SaleAction;
  onOpenReceipt: SaleAction;
  onOpenMode: SaleAction;
  onOpenReturn: SaleAction;
  onCopy: CopyInvoice;
}

const stopRowClick = (event: React.MouseEvent) => event.stopPropagation();

/** Desktop table row. Memoised: the page passes stable callbacks, so typing in search never re-renders rows. */
export const SaleTableRow = memo(function SaleTableRow({ sale, modeLock, onOpenDetail, onOpenReceipt, onOpenMode, onOpenReturn, onCopy }: SaleRowProps) {
  const isReturned = sale.status === 'Returned';
  const refund = Number(sale.refund_amount || 0);
  const { date, time } = saleDateTime(sale);

  return (
    <TR interactive onClick={() => onOpenDetail(sale)}>
      <TD className="whitespace-nowrap">
        <InvoiceChip sale={sale} onCopy={onCopy} />
      </TD>

      <TD className="whitespace-nowrap">
        <div className="flex flex-col">
          <span className="font-semibold text-fg">{date}</span>
          {time && (
            <span className="flex items-center gap-1 text-xs tabular-nums text-fg-subtle">
              <Clock aria-hidden="true" className="size-3" /> {time}
            </span>
          )}
        </div>
      </TD>

      <TD>
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-xs font-bold text-fg-muted">
            {(sale.customer_name || 'W').charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="max-w-[180px] truncate font-semibold text-fg">{sale.customer_name || 'Walk-in'}</p>
            {sale.customer_id && <p className="text-xs font-medium text-fg-subtle">Ledger Customer</p>}
          </div>
        </div>
      </TD>

      <TD numeric className="whitespace-nowrap">
        <div className="flex flex-col items-end">
          <Money amount={sale.total || 0} className={isReturned ? 'text-fg-faint line-through' : 'text-fg'} />
          {sale.discount > 0 && (
            <span className="text-xs font-medium text-success-fg">Disc: <Money amount={sale.discount} /></span>
          )}
          {refund > 0 && (
            <span className="text-xs font-medium text-danger-fg">Ref: <Money amount={refund} /></span>
          )}
        </div>
      </TD>

      <TD className="whitespace-nowrap text-center" onClick={stopRowClick}>
        <PaymentModeChip sale={sale} lockReason={modeLock} onChange={onOpenMode} />
      </TD>

      <TD className="whitespace-nowrap text-center">
        <SaleStatusBadge status={sale.status} short />
      </TD>

      <TD className="whitespace-nowrap" onClick={stopRowClick}>
        <div className="flex items-center justify-end gap-1">
          <IconButton size="sm" aria-label="View Invoice Details" icon={<Eye />} onClick={() => onOpenDetail(sale)} />
          <IconButton size="sm" aria-label="View / Print Receipt" icon={<Printer />} onClick={() => onOpenReceipt(sale)} />
          {!modeLock && (
            <IconButton size="sm" aria-label="Change Payment Mode (Cash ⇄ Online)" icon={<ArrowLeftRight />} onClick={() => onOpenMode(sale)} />
          )}
          {!isReturned && (
            <Button size="sm" variant="secondary" leftIcon={<RotateCcw />} onClick={() => onOpenReturn(sale)} title="Process Return & Refund">
              Return
            </Button>
          )}
        </div>
      </TD>
    </TR>
  );
});

interface SaleCardProps extends SaleRowProps {
  expanded: boolean;
  onToggle: (saleId: string) => void;
}

/** Phone card: summary row that expands to items, totals and actions. */
export const SaleCard = memo(function SaleCard({ sale, modeLock, expanded, onToggle, onOpenDetail, onOpenReceipt, onOpenMode, onOpenReturn, onCopy }: SaleCardProps) {
  const isReturned = sale.status === 'Returned';
  const { date, time } = saleDateTime(sale);
  const lines = sale.items || [];

  return (
    <article
      className={cn(
        'overflow-hidden rounded-card border border-line bg-surface shadow-e1 transition-shadow duration-150',
        expanded && 'ring-2 ring-brand-accent/60',
      )}
    >
      <div onClick={() => onToggle(sale.id)} className="flex cursor-pointer items-center gap-2 p-3 transition-colors active:bg-surface-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <InvoiceChip sale={sale} onCopy={onCopy} />
            <span className="truncate text-sm font-semibold text-fg">{sale.customer_name || 'Walk-in'}</span>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-subtle">
            <span className="font-semibold text-fg-muted">{date}</span>
            {time && (
              <>
                <span aria-hidden="true" className="text-fg-faint">•</span>
                <span className="inline-flex items-center gap-0.5 tabular-nums">
                  <Clock aria-hidden="true" className="size-3 shrink-0" />
                  {time}
                </span>
              </>
            )}
            <span aria-hidden="true" className="text-fg-faint">•</span>
            <PaymentModeChip sale={sale} lockReason={modeLock} onChange={onOpenMode} />
            {sale.items && (
              <>
                <span aria-hidden="true" className="text-fg-faint">•</span>
                <span>{lines.length} {lines.length === 1 ? 'item' : 'items'}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <div className="flex flex-col items-end gap-1">
            <Money amount={sale.total || 0} className={cn('text-sm font-bold', isReturned ? 'text-fg-faint line-through' : 'text-fg')} />
            <SaleStatusBadge status={sale.status} short />
          </div>
          <IconButton
            size="sm"
            aria-label={expanded ? 'Hide details' : 'Show details'}
            aria-expanded={expanded}
            icon={<ChevronDown className={cn('transition-transform duration-200', expanded && 'rotate-180')} />}
            onClick={event => { event.stopPropagation(); onToggle(sale.id); }}
          />
        </div>
      </div>

      {expanded && (
        <div className="animate-fade-up space-y-3 border-t border-line bg-surface-2/60 p-3">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Sold Items</p>
            <ul className="divide-y divide-line rounded-control bg-surface ring-1 ring-inset ring-line">
              {lines.length > 0 ? (
                lines.map((it, idx) => (
                  <li key={idx} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-fg">{it.name}</p>
                      <p className="text-xs tabular-nums text-fg-subtle">
                        {it.qty} {(it as any).unit || 'qty'} @ {formatCurrency(it.price)}
                      </p>
                    </div>
                    <Money amount={it.total || it.qty * it.price} className="font-semibold text-fg" />
                  </li>
                ))
              ) : (
                <li className="px-3 py-2.5 text-xs italic text-fg-subtle">No item details</li>
              )}
            </ul>
          </div>

          <BillTotals sale={sale} />

          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" leftIcon={<Eye />} onClick={() => onOpenDetail(sale)} title="View Full Details">
              Details
            </Button>
            <Button variant="secondary" leftIcon={<Printer />} onClick={() => onOpenReceipt(sale)}>
              View Receipt
            </Button>
            {!modeLock && (
              <Button variant="secondary" leftIcon={<ArrowLeftRight />} onClick={() => onOpenMode(sale)} title="Change Payment Mode">
                Pay Mode
              </Button>
            )}
            {!isReturned && (
              <Button variant="secondary" leftIcon={<RotateCcw />} onClick={() => onOpenReturn(sale)} className={cn(modeLock && 'col-span-2')}>
                Return / Refund
              </Button>
            )}
          </div>
        </div>
      )}
    </article>
  );
});

interface SalesEmptyStateProps {
  /** The search text the list was filtered with (trimmed). */
  search: string;
  matchingAllDatesCount: number;
  searchAcrossAllDates: boolean;
  totalSales: number;
  filterDateRange: string;
  onShowAllDates: () => void;
  onClearSearch: () => void;
  onViewAll: () => void;
}

export function SalesEmptyState({
  search, matchingAllDatesCount, searchAcrossAllDates, totalSales, filterDateRange, onShowAllDates, onClearSearch, onViewAll,
}: SalesEmptyStateProps) {
  if (search) {
    const elsewhere = matchingAllDatesCount > 0 && !searchAcrossAllDates;
    return (
      <EmptyState
        icon={<ShoppingBag />}
        title={`No Invoices Found for "${search}"`}
        description={elsewhere
          ? `Found ${matchingAllDatesCount} matching invoice(s) across other dates. Click below to view them.`
          : 'Check the invoice number (e.g. #INV-..., 3E3CE7), customer name, item, or amount.'}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            {elsewhere && <Button onClick={onShowAllDates}>View in All Dates ({matchingAllDatesCount})</Button>}
            <Button variant="secondary" onClick={onClearSearch}>Clear Search</Button>
          </div>
        }
      />
    );
  }
  if (totalSales > 0) {
    const rangeLabel = filterDateRange === 'today' ? 'Today' : filterDateRange === 'month' ? 'This Month' : 'selected';
    return (
      <EmptyState
        icon={<ShoppingBag />}
        title="No Sales Invoices Found"
        description={`No invoices match the current ${rangeLabel} filter (${totalSales} total in system).`}
        action={<Button onClick={onViewAll}>View All Invoices ({totalSales})</Button>}
      />
    );
  }
  return (
    <EmptyState
      icon={<ShoppingBag />}
      title="No Sales Invoices Found"
      description="Try adjusting your search filters or record sales at POS."
    />
  );
}
