import { memo } from 'react';
import { FileText, Trash2 } from 'lucide-react';
import { LedgerRow, formatLedgerDate } from '../../lib/supplierStatement';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import { BREAKPOINTS, useMediaQuery } from '../../hooks/useMediaQuery';
import { Card, EmptyState, IconButton, LoadMoreRow, Money, TBody, TD, TH, THead, TR, Table, TableContainer } from '../ui';
import { LedgerKindBadge, SupplierBalance } from './supplierUi';

const PAGE_SIZE = 80;

interface RowProps {
  entry: LedgerRow;
  /** Undefined when the user may not delete payments. */
  onDelete?: (id: string) => void;
}

const Amount = ({ value, className }: { value: number; className?: string }) =>
  value > 0 ? <Money amount={value} className={className} /> : <span className="text-fg-faint">—</span>;

const LedgerTableRow = memo(function LedgerTableRow({ entry, onDelete }: RowProps) {
  return (
    <TR>
      <TD className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-fg-muted">{formatLedgerDate(entry.date)}</TD>
      <TD><LedgerKindBadge kind={entry.kind} subtype={entry.subtype} /></TD>
      <TD className="min-w-[220px] max-w-[420px]">
        <p className="break-words text-[13px] font-semibold text-fg">{entry.description}</p>
        {entry.note && <p className="mt-0.5 break-words text-[11px] text-fg-subtle">{entry.note}</p>}
        {entry.accountName && <p className="text-[11px] text-fg-subtle">{entry.accountName}</p>}
      </TD>
      <TD numeric><Amount value={entry.credit} /></TD>
      <TD numeric><Amount value={entry.debit} className="text-success-fg" /></TD>
      <TD numeric><SupplierBalance value={entry.runningBalance} /></TD>
      <TD className="w-12 text-right">
        {entry.canDelete && onDelete && (
          <IconButton
            size="sm"
            aria-label="Payment delete karein"
            icon={<Trash2 />}
            className="hover:bg-danger-soft hover:text-danger-fg"
            onClick={() => onDelete(entry.id)}
          />
        )}
      </TD>
    </TR>
  );
});

const LedgerCardRow = memo(function LedgerCardRow({ entry, onDelete }: RowProps) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-semibold tabular-nums text-fg-subtle">{formatLedgerDate(entry.date)}</span>
          <LedgerKindBadge kind={entry.kind} subtype={entry.subtype} />
        </div>
        {entry.canDelete && onDelete && (
          <IconButton
            size="sm"
            aria-label="Payment delete karein"
            icon={<Trash2 />}
            className="-my-1 hover:bg-danger-soft hover:text-danger-fg"
            onClick={() => onDelete(entry.id)}
          />
        )}
      </div>
      <div>
        <p className="break-words text-[13px] font-semibold leading-snug text-fg">{entry.description}</p>
        {(entry.note || entry.accountName) && (
          <p className="mt-0.5 break-words text-[11px] text-fg-subtle">{[entry.note, entry.accountName].filter(Boolean).join(' · ')}</p>
        )}
      </div>
      <dl className="grid grid-cols-3 gap-2 rounded-control bg-surface-2 px-3 py-2 text-xs">
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Supply</dt>
          <dd className="font-semibold tabular-nums text-fg"><Amount value={entry.credit} /></dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Paid</dt>
          <dd className="font-semibold tabular-nums"><Amount value={entry.debit} className="text-success-fg" /></dd>
        </div>
        <div className="text-right">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Balance</dt>
          <dd className="font-bold tabular-nums"><SupplierBalance value={entry.runningBalance} /></dd>
        </div>
      </dl>
    </li>
  );
});

/** Khata statement, newest first, with the running balance after each entry. Long ledgers render in pages. */
export function SupplierLedgerTable({ entries, onDelete, resetKey, filtered }: {
  entries: LedgerRow[];
  onDelete?: (id: string) => void;
  resetKey?: unknown;
  /** A search or type filter is on, so an empty list means "no match" rather than "no history". */
  filtered?: boolean;
}) {
  const { visibleItems, hiddenCount, sentinelRef, showMore, showAll } = useProgressiveList(entries, PAGE_SIZE, resetKey);
  const isWide = useMediaQuery(BREAKPOINTS.md);

  if (entries.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<FileText />}
          title={filtered ? 'Is filter mein koi entry nahi' : 'Is period mein koi entry nahi'}
          description={filtered ? 'Search ya type filter badal kar dekhein.' : 'Tareekh badlein, ya milk purchase / payment record karein.'}
        />
      </Card>
    );
  }

  if (!isWide) {
    return (
      <Card className="overflow-hidden">
        <ul className="divide-y divide-line/70">
          {visibleItems.map(entry => <LedgerCardRow key={entry.id} entry={entry} onDelete={onDelete} />)}
        </ul>
        <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} />
      </Card>
    );
  }

  return (
    <TableContainer>
      <Table>
        <THead>
          <tr>
            <TH>Date</TH>
            <TH>Type</TH>
            <TH>Description</TH>
            <TH numeric title="Supply / charge: payable barhta hai">Supply (Cr)</TH>
            <TH numeric title="Payment: payable kam hota hai">Paid (Dr)</TH>
            <TH numeric>Balance</TH>
            <TH className="w-12"><span className="sr-only">Actions</span></TH>
          </tr>
        </THead>
        <TBody>
          {visibleItems.map(entry => <LedgerTableRow key={entry.id} entry={entry} onDelete={onDelete} />)}
          <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} colSpan={7} />
        </TBody>
      </Table>
    </TableContainer>
  );
}
