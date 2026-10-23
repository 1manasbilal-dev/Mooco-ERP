import { memo } from 'react';
import { BookOpen, CalendarDays, ImageDown, Milk, Printer, Receipt, Trash2 } from 'lucide-react';
import { CashDay, CashLine, DatePreset, formatLedgerDate } from '../../lib/supplierStatement';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import { Badge, Button, Card, EmptyState, IconButton, Input, LoadMoreRow, Money, SegmentedControl } from '../ui';
import type { SegmentOption } from '../ui';
import { cn } from '../../lib/cn';
import { SupplierBalance } from './supplierUi';

export type LedgerView = 'statement' | 'milk' | 'payments';

const PRESETS: SegmentOption<DatePreset>[] = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'tendays', label: '10 days' },
  { value: 'fifteendays', label: '15 days' },
  { value: 'month', label: 'Month' },
  { value: 'lastmonth', label: 'Last month' },
  { value: 'custom', label: 'Custom' },
];

const VIEWS: SegmentOption<LedgerView>[] = [
  { value: 'statement', label: 'Ledger', icon: <BookOpen /> },
  { value: 'milk', label: 'Milk', icon: <Milk /> },
  { value: 'payments', label: 'Payments', icon: <Receipt /> },
];

/** Kept for older call sites: a khata amount with a Pay / Adv tag. */
export function BalanceAmount({ value, className = '' }: { value: number; className?: string }) {
  return <SupplierBalance value={value} className={className} />;
}

export const LedgerRangeBar = memo(function LedgerRangeBar(props: {
  preset: DatePreset;
  from: string;
  to: string;
  onPreset: (preset: DatePreset) => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  view?: LedgerView;
  onView?: (view: LedgerView) => void;
  onPrint: () => void;
  printLabel: string;
  onShare?: () => void;
  shareLabel?: string;
  sharing?: boolean;
  rangeLabel: string;
}) {
  return (
    <Card className="flex flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {props.onView && props.view ? (
          <SegmentedControl aria-label="Khata view" value={props.view} onChange={props.onView} options={VIEWS} />
        ) : (
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-fg-muted">
            <CalendarDays className="size-4 text-fg-faint" aria-hidden="true" />
            Period
          </p>
        )}
        <div className="flex items-center gap-2">
          {props.onShare && (
            <Button variant="soft" size="sm" leftIcon={<ImageDown />} onClick={props.onShare} loading={props.sharing}>
              {props.sharing ? 'Ban raha hai...' : props.shareLabel || 'Send image'}
            </Button>
          )}
          <Button variant="secondary" size="sm" leftIcon={<Printer />} onClick={props.onPrint}>
            {props.printLabel}
          </Button>
        </div>
      </div>

      <SegmentedControl aria-label="Date range" size="sm" value={props.preset} onChange={props.onPreset} options={PRESETS} />

      {props.preset === 'custom' && (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-fg-muted sm:flex-row sm:items-center sm:gap-2">
            From
            <Input type="date" inputSize="sm" value={props.from} max={props.to || undefined} onChange={event => props.onFrom(event.target.value)} className="sm:w-40" />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-fg-muted sm:flex-row sm:items-center sm:gap-2">
            To
            <Input type="date" inputSize="sm" value={props.to} min={props.from || undefined} onChange={event => props.onTo(event.target.value)} className="sm:w-40" />
          </label>
          <p className="col-span-2 text-[11px] text-fg-subtle">Dono tareekhein shamil hain (Pakistan time).</p>
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs font-medium text-fg-subtle">
        <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{props.rangeLabel}</span>
      </p>
    </Card>
  );
});

const CashRow = memo(function CashRow({
  row, showSupplier, onOpenSupplier, onVoucher, onDelete,
}: {
  row: CashLine;
  showSupplier?: boolean;
  onOpenSupplier?: (id: string) => void;
  onVoucher?: (line: CashLine) => void;
  onDelete?: (id: string) => void;
}) {
  const isRefund = row.direction === 'in';
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0 space-y-1">
        {showSupplier && (
          <button
            type="button"
            onClick={() => onOpenSupplier?.(row.supplierId)}
            className="block max-w-full cursor-pointer truncate text-left text-sm font-bold text-fg hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            {row.supplierName}
          </button>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
          <Badge tone={isRefund ? 'warning' : row.subtype === 'Advance' ? 'info' : 'success'}>{row.subtype}</Badge>
          <span className="font-medium">{row.mode}{row.accountName ? ` · ${row.accountName}` : ''}</span>
        </div>
        {row.note && <p className="break-words text-[11px] text-fg-subtle">{row.note}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className={cn('mr-1 text-sm font-bold', isRefund ? 'text-warning-fg' : 'text-success-fg')} title={isRefund ? 'Refund wapas aaya' : 'Supplier ko diya'}>
          {isRefund ? '−' : ''}<Money amount={row.amount} />
        </span>
        {onVoucher && <IconButton size="sm" aria-label="Voucher print karein" icon={<Printer />} onClick={() => onVoucher(row)} />}
        {row.canDelete && onDelete && (
          <IconButton
            size="sm"
            aria-label="Payment delete karein"
            icon={<Trash2 />}
            className="hover:bg-danger-soft hover:text-danger-fg"
            onClick={() => onDelete(row.id)}
          />
        )}
      </div>
    </li>
  );
});

const CashDayCard = memo(function CashDayCard({
  day, showSupplier, onOpenSupplier, onVoucher, onDelete,
}: {
  day: CashDay;
  showSupplier?: boolean;
  onOpenSupplier?: (id: string) => void;
  onVoucher?: (line: CashLine) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line bg-surface-2 px-4 py-2.5 sm:px-5">
        <span className="text-[13px] font-bold text-fg">{formatLedgerDate(day.date, true)}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-xs font-semibold text-fg-subtle">
          <span>Paid <Money amount={day.paid} className="text-fg-muted" /></span>
          {day.refunded > 0 && <span>· Refund <Money amount={day.refunded} className="text-warning-fg" /></span>}
          <span>· Net <Money amount={day.net} className="text-fg" /></span>
        </span>
      </div>
      <ul className="divide-y divide-line/70">
        {day.rows.map(row => (
          <CashRow key={row.id} row={row} showSupplier={showSupplier} onOpenSupplier={onOpenSupplier} onVoucher={onVoucher} onDelete={onDelete} />
        ))}
      </ul>
    </Card>
  );
});

export function CashPaymentDays(props: {
  days: CashDay[];
  onDelete?: (id: string) => void;
  onVoucher?: (line: CashLine) => void;
  onOpenSupplier?: (id: string) => void;
  showSupplier?: boolean;
  emptyText?: string;
  /** Changing it (supplier, range) jumps back to the first page of days. */
  resetKey?: unknown;
}) {
  const { visibleItems, hiddenCount, sentinelRef, showMore, showAll } = useProgressiveList(props.days, 20, props.resetKey);

  if (props.days.length === 0) {
    return (
      <Card>
        <EmptyState
          size="compact"
          icon={<Receipt />}
          title={props.emptyText || 'Is period mein koi payment nahi'}
          description="Tareekh badlein ya supplier ki payment record karein."
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {visibleItems.map(day => (
        <CashDayCard
          key={day.date}
          day={day}
          showSupplier={props.showSupplier}
          onOpenSupplier={props.onOpenSupplier}
          onVoucher={props.onVoucher}
          onDelete={props.onDelete}
        />
      ))}
      <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} />
    </div>
  );
}
