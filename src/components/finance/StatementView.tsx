import React, { memo } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { Badge, LoadMoreRow, Money, Skeleton, TBody, TD, TH, THead, TR, Table, TableContainer } from '../ui';
import type { Tone } from '../ui';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import { useMediaQuery, BREAKPOINTS } from '../../hooks/useMediaQuery';
import { cn } from '../../lib/cn';
import { formatDay, formatTime, isInflow, isTransfer, type LedgerEntry } from './ledger';

const PAGE_SIZE = 50;

const flowTone = (entry: LedgerEntry): Tone => (isTransfer(entry.type) ? 'info' : isInflow(entry.type) ? 'success' : 'danger');

interface RowProps {
  entry: LedgerEntry;
  /** Balance after this entry (single-account statement only). */
  balance?: number;
  showAccount: boolean;
}

const DesktopRow = memo(function DesktopRow({ entry, balance, showAccount }: RowProps) {
  const time = formatTime(entry.date);
  const inflow = isInflow(entry.type);
  return (
    <TR>
      <TD className="whitespace-nowrap">
        <p className="font-semibold tabular-nums text-fg">{formatDay(entry.day)}</p>
        {time && <p className="text-xs tabular-nums text-fg-subtle">{time}</p>}
      </TD>
      <TD className="max-w-[22rem]">
        <p className="flex min-w-0 items-center gap-1.5 font-semibold text-fg">
          {isTransfer(entry.type) && <ArrowRightLeft className="size-3.5 shrink-0 text-info-fg" aria-hidden="true" />}
          <span className="truncate" title={entry.description}>{entry.description}</span>
        </p>
        {showAccount && <p className="truncate text-xs text-fg-subtle">{entry.accountName}</p>}
      </TD>
      <TD>
        <div className="flex flex-col items-start gap-1">
          <Badge tone={flowTone(entry)} className="max-w-[12rem]"><span className="truncate">{entry.category}</span></Badge>
          <span className="text-[11px] text-fg-subtle">{entry.sourceModule}</span>
        </div>
      </TD>
      <TD numeric>{inflow ? <Money amount={entry.amount} className="text-success-fg" /> : <span className="text-fg-faint">—</span>}</TD>
      <TD numeric>{inflow ? <span className="text-fg-faint">—</span> : <Money amount={entry.amount} className="text-danger-fg" />}</TD>
      {balance !== undefined && (
        <TD numeric><Money amount={balance} className={balance < 0 ? 'text-danger-fg' : 'text-fg'} /></TD>
      )}
    </TR>
  );
});

const MobileRow = memo(function MobileRow({ entry, balance, showAccount }: RowProps) {
  const time = formatTime(entry.date);
  const inflow = isInflow(entry.type);
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold leading-snug text-fg">
            {isTransfer(entry.type) && <ArrowRightLeft className="size-3.5 shrink-0 text-info-fg" aria-hidden="true" />}
            <span className="break-words">{entry.description}</span>
          </p>
          <p className="mt-0.5 text-xs tabular-nums text-fg-subtle">
            {formatDay(entry.day)}{time ? ` · ${time}` : ''}{showAccount ? ` · ${entry.accountName}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn('text-sm font-bold tabular-nums', inflow ? 'text-success-fg' : 'text-danger-fg')}>
            {inflow ? '+' : '−'} <Money amount={entry.amount} />
          </p>
          {balance !== undefined && (
            <p className="text-[11px] tabular-nums text-fg-subtle">
              Bal <Money amount={balance} className={balance < 0 ? 'text-danger-fg' : undefined} />
            </p>
          )}
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <Badge tone={flowTone(entry)} className="max-w-[60%]"><span className="truncate">{entry.category}</span></Badge>
        <span className="truncate text-[11px] text-fg-subtle">{entry.sourceModule}</span>
      </div>
    </li>
  );
});

export interface SummaryItem {
  label: string;
  amount: number;
  /** Shown instead of the amount (e.g. an entry count). */
  text?: string;
  /** `in` = green, `out` = red, `balance` = red only when negative. */
  tone?: 'in' | 'out' | 'balance' | 'plain';
  prefix?: string;
  hint?: string;
}

/** Opening / in / out / closing strip at the top of a statement. */
export function StatementSummary({ items, loading }: { items: SummaryItem[]; loading?: boolean }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-control bg-line/70 ring-1 ring-line/70 lg:grid-cols-4">
      {items.map(item => (
        <div key={item.label} className="min-w-0 bg-surface-2 px-3.5 py-3">
          <dt className="truncate text-xs font-semibold text-fg-subtle">{item.label}</dt>
          <dd
            className={cn(
              'mt-1 truncate text-base font-bold tabular-nums sm:text-lg',
              item.tone === 'in' ? 'text-success-fg'
              : item.tone === 'out' ? 'text-danger-fg'
              : item.tone === 'balance' && item.amount < 0 ? 'text-danger-fg'
              : 'text-fg',
            )}
          >
            {loading ? <Skeleton className="h-6 w-24" /> : item.text ?? <>{item.prefix}<Money amount={item.amount} /></>}
          </dd>
          {item.hint && <p className="truncate text-[11px] text-fg-subtle">{item.hint}</p>}
        </div>
      ))}
    </dl>
  );
}

interface StatementViewProps {
  entries: LedgerEntry[];
  /** Running balances for a single account; null on the consolidated view. */
  balanceAfter: Map<LedgerEntry, number> | null;
  showAccount: boolean;
  /** Balance brought forward into the range, shown as the last row once every row is on screen. */
  openingBalance?: number | null;
  /** Changing it jumps back to the first page (account, filters). */
  resetKey: string;
  empty: React.ReactNode;
  loading?: boolean;
}

/** Account statement: a reconciliation-style table on desktop, a compact list on phones. */
export function StatementView({ entries, balanceAfter, showAccount, openingBalance, resetKey, empty, loading }: StatementViewProps) {
  const isDesktop = useMediaQuery(BREAKPOINTS.md);
  const { visibleItems, hiddenCount, sentinelRef, showMore, showAll } = useProgressiveList(entries, PAGE_SIZE, resetKey);
  const hasBalance = balanceAfter !== null;
  const showOpening = hasBalance && hiddenCount === 0 && openingBalance != null;

  if (loading) {
    return (
      <TableContainer aria-busy="true">
        <div className="divide-y divide-line">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </TableContainer>
    );
  }

  if (entries.length === 0) return <TableContainer>{empty}</TableContainer>;

  if (!isDesktop) {
    return (
      <TableContainer>
        <ul className="divide-y divide-line">
          {visibleItems.map(entry => (
            <MobileRow key={entry.id} entry={entry} balance={balanceAfter?.get(entry)} showAccount={showAccount} />
          ))}
          {showOpening && (
            <li className="flex items-center justify-between gap-3 bg-surface-2/60 px-4 py-3 text-sm">
              <span className="font-semibold text-fg-muted">Opening balance (b/f)</span>
              <Money amount={openingBalance} className={cn('font-bold', openingBalance! < 0 ? 'text-danger-fg' : 'text-fg')} />
            </li>
          )}
        </ul>
        <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} />
      </TableContainer>
    );
  }

  const columns = hasBalance ? 6 : 5;
  return (
    <TableContainer>
      <Table>
        <THead>
          <tr>
            <TH className="w-32">Date</TH>
            <TH>Details</TH>
            <TH>Category</TH>
            <TH numeric>Money in</TH>
            <TH numeric>Money out</TH>
            {hasBalance && <TH numeric>Balance</TH>}
          </tr>
        </THead>
        <TBody>
          {visibleItems.map(entry => (
            <DesktopRow key={entry.id} entry={entry} balance={balanceAfter?.get(entry)} showAccount={showAccount} />
          ))}
          {showOpening && (
            <TR className="bg-surface-2/60">
              <TD colSpan={columns - 1}><span className="font-semibold text-fg-muted">Opening balance (b/f)</span></TD>
              <TD numeric><Money amount={openingBalance} className={openingBalance! < 0 ? 'text-danger-fg' : 'text-fg'} /></TD>
            </TR>
          )}
          <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} colSpan={columns} />
        </TBody>
      </Table>
    </TableContainer>
  );
}
