import React, { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { History, RotateCcw, Search, X } from 'lucide-react';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import { cn } from '../../lib/cn';
import { formatQty } from '../../lib/formatters';
import { Badge, Button, EmptyState, IconButton, LoadMoreRow, Money, SearchInput, SegmentedControl } from '../ui';
import { Avatar, varietyDot } from './ProcurementUI';
import { dayOf, pkTime, settlementOf, shortDay } from './procurementData';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Side sheet with every milk slip or supplies bill line, newest first, grouped by day.
 * Loaded lazily: it only ships when someone opens the log.
 */
const PurchaseLogDrawer: React.FC<{
  mode: 'milk' | 'supplies';
  entries: any[];
  suppliersById: Map<string, any>;
  today: string;
  onClose: () => void;
  onReturn: (entry: any) => void;
}> = ({ mode, entries, suppliersById, today, onClose, onReturn }) => {
  const isMilk = mode === 'milk';
  const [scope, setScope] = useState<'today' | 'all'>('today');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => panelRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  const sorted = useMemo(
    () => entries.filter(entry => entry.date).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
    [entries],
  );

  const rows = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return sorted.filter(entry => {
      if (scope === 'today' && dayOf(entry) !== today) return false;
      if (!needle) return true;
      const name = (suppliersById.get(entry.supplier_id)?.name || entry.supplier_name || 'spot cash purchase').toLowerCase();
      return name.includes(needle) || String(entry.item_name || '').toLowerCase().includes(needle);
    });
  }, [sorted, scope, deferredQuery, today, suppliersById]);

  const { visibleItems, hiddenCount, sentinelRef, showMore, showAll } = useProgressiveList<any>(rows, 50, `${scope}|${deferredQuery}`);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      // The search field clears itself first; a second Esc closes the log.
      if ((event.target as HTMLElement).matches('input[type="search"]') && query) return;
      event.preventDefault();
      onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = (Array.from(panelRef.current.querySelectorAll(FOCUSABLE)) as HTMLElement[]).filter(el => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const title = isMilk ? 'Milk intake log' : 'Supplies purchase log';
  let lastDay = '';

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end" data-app-modal="true" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-slate-950/45 animate-in fade-in duration-150 motion-reduce:animate-none" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-e3 animate-in slide-in-from-right duration-200 motion-reduce:animate-none"
      >
        <div className="flex shrink-0 flex-col gap-3 border-b border-line p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-fg-muted"><History size={16} aria-hidden="true" /></span>
              <div className="min-w-0">
                <h2 className="truncate text-[15px] font-bold text-fg">{title}</h2>
                <p className="truncate text-xs text-fg-subtle">Galat entry ho to yahan se supplier ko return karein</p>
              </div>
            </div>
            <IconButton aria-label="Band karein" icon={<X />} onClick={onClose} />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <SegmentedControl
              aria-label="Log range"
              size="sm"
              value={scope}
              onChange={setScope}
              options={[{ value: 'today', label: 'Today' }, { value: 'all', label: 'All dates' }]}
              className="shrink-0"
            />
            <SearchInput value={query} onChange={setQuery} placeholder={isMilk ? 'Farmer dhoondein…' : 'Vendor ya item…'} className="flex-1" />
          </div>
          <p className="text-xs text-fg-subtle tabular-nums">{rows.length} {rows.length === 1 ? 'entry' : 'entries'}</p>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
          {rows.length === 0 ? (
            <EmptyState
              size="compact"
              icon={<Search />}
              title="Koi entry nahi mili"
              description={scope === 'today' ? 'All dates par switch kar ke dekhein.' : 'Search badal kar dekhein.'}
              action={scope === 'today' ? <Button variant="secondary" size="sm" onClick={() => setScope('all')}>All dates</Button> : undefined}
            />
          ) : (
            <>
              {visibleItems.map(entry => {
                const day = dayOf(entry);
                const showDay = day !== lastDay;
                lastDay = day;
                return (
                  <React.Fragment key={entry.id}>
                    {showDay && (
                      <p className="sticky top-0 z-10 -mx-3 bg-surface px-4 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                        {day === today ? 'Today' : shortDay(day)}
                      </p>
                    )}
                    <LogRow entry={entry} supplierName={suppliersById.get(entry.supplier_id)?.name} isMilk={isMilk} onReturn={onReturn} />
                  </React.Fragment>
                );
              })}
              <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

const LogRow = memo(function LogRow({ entry, supplierName, isMilk, onReturn }: { entry: any; supplierName?: string; isMilk: boolean; onReturn: (entry: any) => void }) {
  const name = supplierName || entry.supplier_name || 'Spot Cash Purchase';
  const isReturned = entry.status === 'Returned';
  const { amount, paid, due } = settlementOf(entry);
  const mode = entry.payment_mode || entry.details?.payment_mode;
  const time = pkTime(entry.date);
  return (
    <div className={cn('mb-2 rounded-control border p-3 text-xs transition-colors', isReturned ? 'border-danger/25 bg-danger-soft/40 opacity-75' : 'border-line bg-surface hover:border-line-strong')}>
      <div className="flex items-start gap-2.5">
        <Avatar name={name} owed={!isReturned && due > 0.5} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-bold text-fg">{name}</span>
              {isReturned && <Badge tone="danger">Returned</Badge>}
            </span>
            <Money amount={entry.total_amount} className={cn('shrink-0 font-bold', isReturned ? 'text-fg-subtle line-through' : 'text-fg')} />
          </div>
          <p className={cn('mt-0.5 flex items-center gap-1.5 text-fg-muted', isReturned && 'line-through')}>
            {isMilk ? (
              <>
                <span className={cn('size-1.5 rounded-full', varietyDot(entry.milk_type))} aria-hidden="true" />
                {formatQty(entry.quantity)} L · {entry.milk_type} · {entry.shift}{time ? ` · ${time}` : ''}
              </>
            ) : (
              <>{entry.item_name} · {formatQty(entry.quantity)} {entry.unit}{time ? ` · ${time}` : ''}</>
            )}
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {paid > 0 && <Badge tone="success">Paid <Money amount={paid} />{mode ? ` · ${mode}` : ''}</Badge>}
              {due > 0.5 && amount > 0 && <Badge tone="danger">Khata <Money amount={due} /></Badge>}
            </div>
            {!isReturned && (
              <Button variant="secondary" size="sm" leftIcon={<RotateCcw />} onClick={() => onReturn(entry)} title="Return to supplier">
                Return
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default PurchaseLogDrawer;
