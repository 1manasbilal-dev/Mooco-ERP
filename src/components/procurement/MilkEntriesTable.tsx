import { memo, useDeferredValue, useMemo, useState } from 'react';
import { History, Milk, PencilLine, RotateCcw } from 'lucide-react';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import { cn } from '../../lib/cn';
import { formatQty } from '../../lib/formatters';
import {
  Badge, Button, EmptyState, IconButton, LoadMoreRow, Money, SearchInput, SegmentedControl, TBody, TD, TH, THead, TR, Table, TableContainer,
} from '../ui';
import { Avatar, ShiftIcon, varietyDot } from './ProcurementUI';
import { SETTLEMENT_TEXT, countOf, formatRate, isActiveEntry, pkTime, settlementLabel, settlementOf, shiftKey } from './procurementData';

const STATUS_TONE = { Paid: 'success', Partial: 'warning', Khata: 'danger' } as const;

/** One day's milk slips under the entry form: filter by shift, search, return or correct a slip. */
export function MilkEntriesTable({
  entries, shifts, suppliersById, dayLabel, onReturn, onOpenLog,
}: {
  entries: any[];
  shifts: string[];
  suppliersById: Map<string, any>;
  dayLabel: string;
  onReturn: (entry: any, correct?: boolean) => void;
  onOpenLog: () => void;
}) {
  const [shiftFilter, setShiftFilter] = useState('all');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach(entry => {
      if (!isActiveEntry(entry)) return;
      map.set(shiftKey(entry.shift), (map.get(shiftKey(entry.shift)) || 0) + 1);
    });
    return map;
  }, [entries]);

  const rows = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return entries.filter(entry => {
      if (shiftFilter !== 'all' && shiftKey(entry.shift) !== shiftKey(shiftFilter)) return false;
      if (!needle) return true;
      const supplier = suppliersById.get(entry.supplier_id);
      const haystack = `${supplier?.name || entry.supplier_name || ''} ${supplier?.village || ''} ${supplier?.phone || ''}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [entries, shiftFilter, deferredQuery, suppliersById]);

  const totals = useMemo(() => {
    let liters = 0;
    let amount = 0;
    let due = 0;
    let active = 0;
    rows.forEach(entry => {
      if (!isActiveEntry(entry)) return;
      const money = settlementOf(entry);
      active += 1;
      liters += Number(entry.quantity) || 0;
      amount += money.amount;
      due += money.due;
    });
    return { liters, amount, due, active };
  }, [rows]);

  const { visibleItems, hiddenCount, sentinelRef, showMore, showAll } = useProgressiveList<any>(rows, 40, `${dayLabel}|${shiftFilter}|${deferredQuery}`);

  const shiftOptions = [
    { value: 'all', label: 'All', count: entries.filter(isActiveEntry).length },
    ...shifts.map(name => ({ value: name, label: name, icon: <ShiftIcon name={name} size={13} />, count: counts.get(shiftKey(name)) || 0 })),
  ];

  return (
    <section aria-labelledby="milk-entries-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="milk-entries-title" className="text-[15px] font-bold tracking-tight text-fg">Slips · {dayLabel}</h3>
          <p className="text-xs text-fg-subtle">Fix a wrong slip here, or return it to the supplier.</p>
        </div>
        <Button variant="ghost" size="sm" leftIcon={<History />} onClick={onOpenLog}>Log for all dates</Button>
      </div>

      <TableContainer>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2">
          <SegmentedControl aria-label="Shift filter" size="sm" value={shiftFilter} onChange={setShiftFilter} options={shiftOptions} />
          <SearchInput value={query} onChange={setQuery} placeholder="Search farmer…" className="w-full sm:ml-auto sm:w-64" />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            size="compact"
            icon={<Milk />}
            title={entries.length === 0 ? `No slips yet · ${dayLabel}` : 'No slips match this filter'}
            description={entries.length === 0 ? 'Record the first slip with the form above.' : 'Try a different shift or search.'}
          />
        ) : (
          <Table>
              <THead>
                <tr>
                  <TH className="hidden w-16 sm:table-cell">Time</TH>
                  <TH>Farmer</TH>
                  <TH className="hidden md:table-cell">Shift</TH>
                  <TH numeric className="hidden sm:table-cell">Liters</TH>
                  <TH numeric className="hidden md:table-cell">Rate</TH>
                  <TH numeric>Amount</TH>
                  <TH className="hidden sm:table-cell">Status</TH>
                  <TH className="w-12 px-2 text-right sm:w-20 sm:px-4"><span className="sr-only">Actions</span></TH>
                </tr>
              </THead>
              <TBody>
                {visibleItems.map(entry => (
                  <SlipRow
                    key={entry.id}
                    entry={entry}
                    supplier={suppliersById.get(entry.supplier_id)}
                    onReturn={onReturn}
                  />
                ))}
                <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} colSpan={8} />
              </TBody>
              <tfoot className="bg-surface-2/80 text-sm font-bold text-fg">
                <tr>
                  <td className="hidden sm:table-cell" />
                  <td className="px-4 py-3">
                    {countOf(totals.active, 'slip')}
                    <span className="block text-xs font-semibold tabular-nums text-fg-subtle sm:hidden">{formatQty(totals.liters)} L</span>
                  </td>
                  <td className="hidden md:table-cell" />
                  <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">{formatQty(totals.liters)} L</td>
                  <td className="hidden md:table-cell" />
                  <td className="px-4 py-3 text-right">
                    <Money amount={totals.amount} />
                    {totals.due > 0.5 && <span className="block text-xs font-semibold text-danger-fg">Unpaid <Money amount={totals.due} /></span>}
                  </td>
                  <td className="hidden sm:table-cell" />
                  <td />
                </tr>
              </tfoot>
            </Table>
        )}
      </TableContainer>
    </section>
  );
}

const SlipRow = memo(function SlipRow({ entry, supplier, onReturn }: { entry: any; supplier: any; onReturn: (entry: any, correct?: boolean) => void }) {
  const returned = entry.status === 'Returned' || entry.status === 'Cancelled';
  const name = supplier?.name || entry.supplier_name || 'Farmer';
  const money = settlementOf(entry);
  const label = settlementLabel(money.paid, money.due);
  const time = pkTime(entry.date);
  const partlyReturned = Boolean(entry.details?.partial_returned);

  return (
    <TR className={cn(returned && 'opacity-60')}>
      <TD className="hidden text-xs tabular-nums text-fg-subtle sm:table-cell">{time || '—'}</TD>
      <TD>
        {/* Capped on phones so long names truncate instead of pushing the actions off screen. */}
        <div className="flex min-w-0 max-w-[10.5rem] items-center gap-2.5 sm:max-w-[18rem] lg:max-w-none">
          <Avatar name={name} owed={!returned && money.due > 0.5} size="sm" />
          <div className="min-w-0">
            <p className={cn('truncate font-semibold text-fg', returned && 'line-through')}>{name}</p>
            <p className="flex items-center gap-1.5 truncate text-[11px] text-fg-subtle">
              <span className={cn('size-1.5 shrink-0 rounded-full', varietyDot(entry.milk_type))} aria-hidden="true" />
              <span className="hidden sm:inline">{entry.milk_type}</span>
              <span className="truncate tabular-nums sm:hidden">{formatQty(entry.quantity)} L @ {formatRate(entry.rate)} · {entry.shift}</span>
              {supplier?.village && <span className="hidden lg:inline">· {supplier.village}</span>}
            </p>
            {(returned || partlyReturned) && (
              <Badge tone="danger" className="mt-1 sm:hidden">{returned ? 'Returned' : 'Part returned'}</Badge>
            )}
          </div>
        </div>
      </TD>
      <TD className="hidden md:table-cell">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-fg-muted"><ShiftIcon name={entry.shift} size={13} />{entry.shift}</span>
      </TD>
      <TD numeric className={cn('hidden sm:table-cell', returned && 'line-through')}>{formatQty(entry.quantity)}</TD>
      <TD numeric className="hidden font-medium text-fg-muted md:table-cell">{formatRate(entry.rate)}</TD>
      <TD numeric>
        <Money amount={money.amount} className={cn(returned && 'line-through text-fg-subtle')} />
      </TD>
      <TD className="hidden sm:table-cell">
        {returned ? (
          <Badge tone="neutral">Returned</Badge>
        ) : (
          <span className="flex flex-wrap items-center gap-1">
            <Badge tone={STATUS_TONE[label]} dot>{SETTLEMENT_TEXT[label]}</Badge>
            {partlyReturned && <Badge tone="warning">Part returned</Badge>}
          </span>
        )}
      </TD>
      <TD className="px-2 text-right sm:px-4">
        {!returned && (
          <span className="inline-flex flex-col items-center gap-0.5 sm:flex-row">
            <IconButton size="sm" variant="ghost" icon={<PencilLine />} aria-label={`Fix ${name}'s slip`} title="Fix a wrong entry" onClick={() => onReturn(entry, true)} />
            <IconButton size="sm" variant="ghost" icon={<RotateCcw />} aria-label={`Return ${name}'s milk`} title="Return to supplier" onClick={() => onReturn(entry, false)} className="hover:text-warning-fg" />
          </span>
        )}
      </TD>
    </TR>
  );
});
