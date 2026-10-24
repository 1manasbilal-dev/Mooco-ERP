import { useId, useMemo, useState } from 'react';
import { ClipboardCheck, History as HistoryIcon, PackagePlus, X } from 'lucide-react';
import { Badge, Button, EmptyState, IconButton, Input, LoadMoreRow, SegmentedControl } from '../ui';
import { SideSheet } from '../items/SideSheet';
import { cn } from '../../lib/cn';
import { formatBaseQty } from '../../lib/stockRules';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import type { InventoryLog } from '../../types';
import { formatPkDay, formatPkTime, pkDay } from './milkOps';
import type { StockRow } from './inventoryStock';
import { buildItemHistory, historyTotals, type LogLine } from './stockLog';
import { StatusBadge } from './StockRows';
import { diffTone, signedQty } from './StockCountParts';

type Range = '7' | '30' | 'all' | 'custom';

const daysAgo = (today: string, days: number) => {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

interface StockHistoryDrawerProps {
  row: StockRow;
  /** This product's logs, any order. */
  logs: InventoryLog[];
  canEdit: boolean;
  /** No movements yet and nothing on hand: offer opening stock. */
  canOpen: boolean;
  onCount: () => void;
  onOpening: () => void;
  onClose: () => void;
}

/** One product's stock movements with the balance after each, filtered by date. Lazy-loaded by Inventory. */
export default function StockHistoryDrawer({ row, logs, canEdit, canOpen, onCount, onOpening, onClose }: StockHistoryDrawerProps) {
  const titleId = useId();
  const today = useMemo(() => pkDay(new Date().toISOString()), []);
  const [range, setRange] = useState<Range>('30');
  const [from, setFrom] = useState(() => daysAgo(today, 29));
  const [to, setTo] = useState('');
  const unit = row.reading.unit;

  // Balances need every newer row, so they are worked out on the full history before the date filter.
  const history = useMemo(
    () => buildItemHistory(logs, row.item, { loose: row.loose, packs: row.variantStocks }),
    [logs, row.item, row.loose, row.variantStocks],
  );
  const shown = useMemo(() => history.filter(line => (!from || line.day >= from) && (!to || line.day <= to)), [history, from, to]);
  const totals = useMemo(() => historyTotals(shown), [shown]);
  const list = useProgressiveList<LogLine>(shown, 30, `${row.item.id}|${from}|${to}`);

  const chooseRange = (next: Range) => {
    setRange(next);
    if (next === '7') { setFrom(daysAgo(today, 6)); setTo(''); }
    else if (next === '30') { setFrom(daysAgo(today, 29)); setTo(''); }
    else if (next === 'all') { setFrom(''); setTo(''); }
  };
  const editDate = (which: 'from' | 'to', value: string) => {
    setRange('custom');
    if (which === 'from') setFrom(value); else setTo(value);
  };

  return (
    <SideSheet onClose={onClose} labelledBy={titleId}>
      <header className="shrink-0 border-b border-line px-4 pb-3 pt-4 sm:px-6 sm:pt-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-fg"><HistoryIcon className="size-5" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-fg-subtle">Stock history</p>
            <h2 id={titleId} className="truncate text-xl font-bold tracking-tight text-fg">{row.item.name}</h2>
          </div>
          <IconButton aria-label="Band karein" icon={<X />} onClick={onClose} />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-control bg-surface-2 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-lg font-bold tabular-nums text-fg">{formatBaseQty(row.reading.totalBase, unit)} <span className="text-xs font-semibold text-fg-subtle">on hand</span></p>
            {(row.pileDetail || row.stray.length > 0) && (
              <p className="text-[11px] tabular-nums text-fg-subtle">{[...(row.pileDetail ? row.piles : []), ...row.stray].join(' · ')}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge row={row} />
            {canEdit && (canOpen
              ? <Button size="sm" leftIcon={<PackagePlus />} onClick={onOpening}>Opening stock</Button>
              : <Button size="sm" variant="secondary" leftIcon={<ClipboardCheck />} onClick={onCount}>Count</Button>)}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {history.length === 0 ? (
          <EmptyState
            icon={<HistoryIcon />}
            title="Abhi koi movement nahi"
            description={canOpen ? 'Is product ka stock abhi tak kabhi nahi hila. Shuru ka stock "Opening stock" se daalein.' : 'Is product ki koi stock entry load nahi hui.'}
            action={canEdit && canOpen ? <Button size="sm" leftIcon={<PackagePlus />} onClick={onOpening}>Opening stock</Button> : undefined}
          />
        ) : (
          <div className="space-y-3">
            <SegmentedControl
              aria-label="Date range"
              size="sm"
              value={range}
              onChange={chooseRange}
              options={[
                { value: '7', label: '7 din' },
                { value: '30', label: '30 din' },
                { value: 'all', label: 'Sab' },
                { value: 'custom', label: 'Tareekh' },
              ]}
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] font-semibold text-fg-subtle">
                Se
                <Input type="date" inputSize="sm" value={from} max={to || today} onChange={event => editDate('from', event.target.value)} className="mt-1" />
              </label>
              <label className="text-[11px] font-semibold text-fg-subtle">
                Tak
                <Input type="date" inputSize="sm" value={to} min={from || undefined} max={today} onChange={event => editDate('to', event.target.value)} className="mt-1" />
              </label>
            </div>

            <dl className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-control bg-success-soft/70 px-2 py-2">
                <dt className="text-fg-subtle">Aaya</dt>
                <dd className="mt-0.5 font-bold tabular-nums text-success-fg">{signedQty(totals.stockIn)} {unit}</dd>
              </div>
              <div className="rounded-control bg-danger-soft/70 px-2 py-2">
                <dt className="text-fg-subtle">Gaya</dt>
                <dd className="mt-0.5 font-bold tabular-nums text-danger-fg">{signedQty(-totals.stockOut)} {unit}</dd>
              </div>
              <div className="rounded-control bg-surface-2 px-2 py-2">
                <dt className="text-fg-subtle">Net</dt>
                <dd className={cn('mt-0.5 font-bold tabular-nums', diffTone(totals.net))}>{signedQty(totals.net)} {unit}</dd>
              </div>
            </dl>

            {shown.length === 0 ? (
              <EmptyState size="compact" icon={<HistoryIcon />} title="Is muddat mein koi movement nahi" description="Tareekh badal kar dekhein." />
            ) : (
              <>
                <ol className="divide-y divide-line overflow-hidden rounded-control border border-line" aria-label={`${shown.length} entries`}>
                  {list.visibleItems.map(line => <HistoryLine key={line.log.id} line={line} unit={unit} />)}
                </ol>
                <LoadMoreRow sentinelRef={list.sentinelRef} hiddenCount={list.hiddenCount} onShowMore={list.showMore} onShowAll={list.showAll} />
              </>
            )}
            <p className="text-[11px] text-fg-subtle">
              Balance = us entry ke baad ka kul stock ({unit}). Loose hissa entry mein likha hua hai; packs aaj ki ginti se peeche hisaab kiye gaye hain.
            </p>
          </div>
        )}
      </div>
    </SideSheet>
  );
}

function HistoryLine({ line, unit }: { line: LogLine; unit: string }) {
  const { log } = line;
  const time = formatPkTime(log.date);
  const hasPacks = line.moves.some(move => move.kind !== 'loose');
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
          <Badge>{log.reason || 'Adjustment'}</Badge>
          <span className="tabular-nums">{formatPkDay(log.date, 'full')}{time ? `, ${time}` : ''}</span>
        </div>
        {log.notes && <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{log.notes}</p>}
        {hasPacks && (
          <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] font-medium tabular-nums">
            {line.moves.map(move => (
              <span key={move.id} className={diffTone(move.delta)}>
                {signedQty(move.delta)} {move.kind === 'loose' ? `${unit} loose` : move.kind === 'pack' ? `× ${move.name}` : `old ${move.name}`}
              </span>
            ))}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className={cn('text-sm font-bold tabular-nums', diffTone(line.baseDelta))}>
          {signedQty(line.baseDelta)} <span className="text-[11px] font-semibold">{unit}</span>
        </p>
        {line.balanceAfter !== null && (
          <p className={cn('text-[11px] tabular-nums', line.balanceAfter < 0 ? 'text-danger-fg' : 'text-fg-subtle')}>Balance {formatBaseQty(line.balanceAfter, unit)}</p>
        )}
      </div>
    </li>
  );
}
