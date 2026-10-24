import React, { memo, useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Ban, CalendarDays, ChevronDown, ChevronUp, FileText, History, Package, X } from 'lucide-react';
import { Badge, Card, EmptyState, IconButton, Input, LoadMoreRow, Money, SearchInput, SegmentedControl, Toolbar } from '../ui';
import { cn } from '../../lib/cn';
import { formatQty, getTodayLocalDate } from '../../lib/formatters';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import { ProductionStage, type ProductionBatch } from '../../types';
import { formatPkDay, formatPkTime, pkDay } from './milkOps';
import { YIELD_COPY, batchYield, formatOfTarget, formatYieldPerLitre } from './productionStages';

type StatusFilter = 'all' | 'completed' | 'cancelled';

interface ProductionHistoryProps {
  batches: ProductionBatch[];
  unitByProduct: Map<string, string>;
}

const TONE_TEXT: Record<string, string> = {
  neutral: 'text-fg',
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
};

const finishedAt = (batch: ProductionBatch) => batch.completed_date || batch.start_date || '';

interface UsedMaterial { item_id?: string; name?: string; quantity: number; unit?: string; unit_cost?: number }

/** Completed and cancelled batches, grouped by Pakistan day, paginated. Lazy-loaded by the Production screen. */
export default function ProductionHistory({ batches, unitByProduct }: ProductionHistoryProps) {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [date, setDate] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Finished batches, newest first, with their Pakistan day worked out once.
  const finished = useMemo(() => batches
    .filter(b => b.status === ProductionStage.COMPLETED || b.status === ProductionStage.CANCELLED)
    .map(batch => {
      const at = finishedAt(batch);
      return { batch, at, time: new Date(at || 0).getTime() || 0, day: pkDay(at), search: `${batch.product_name || ''} ${batch.batch_number || ''}`.toLowerCase() };
    })
    .sort((a, b) => b.time - a.time), [batches]);

  const counts = useMemo(() => {
    let completed = 0;
    for (const row of finished) if (row.batch.status === ProductionStage.COMPLETED) completed += 1;
    return { all: finished.length, completed, cancelled: finished.length - completed };
  }, [finished]);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return finished.filter(row =>
      (!q || row.search.includes(q))
      // Stored as UTC; a batch finished before 05:00 PKT belongs to that Pakistan day, not the UTC one.
      && (!date || row.day === date)
      && (status === 'all' || (status === 'completed') === (row.batch.status === ProductionStage.COMPLETED)));
  }, [finished, deferredSearch, date, status]);

  const list = useProgressiveList<(typeof filtered)[number]>(filtered, 30, `${deferredSearch}|${date}|${status}`);

  const groups = useMemo(() => {
    const result: { day: string; rows: typeof filtered }[] = [];
    for (const row of list.visibleItems) {
      const last = result[result.length - 1];
      if (last && last.day === row.day) last.rows.push(row);
      else result.push({ day: row.day, rows: [row] });
    }
    return result;
  }, [list.visibleItems]);

  const toggle = useCallback((id: string) => setExpandedId(current => (current === id ? null : id)), []);
  const hasFilters = Boolean(search || date || status !== 'all');

  return (
    <div className="flex flex-col gap-4">
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search batch # or product..." className="w-full sm:w-72" aria-label="Search batches" />
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={date}
            max={getTodayLocalDate()}
            onChange={event => setDate(event.target.value)}
            leftIcon={<CalendarDays />}
            aria-label="Choose day"
            className="w-44"
          />
          {date && <IconButton size="sm" aria-label="Clear date" icon={<X />} onClick={() => setDate('')} />}
        </div>
        <SegmentedControl
          aria-label="Batch status"
          size="sm"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'completed', label: 'Completed', count: counts.completed },
            { value: 'cancelled', label: 'Cancelled', count: counts.cancelled },
          ]}
        />
      </Toolbar>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<History />}
            title={hasFilters ? 'No batches match this filter' : 'No production history yet'}
            description={hasFilters ? 'Try a different search, day or status.' : 'Completed and cancelled batches will show here.'}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(group => (
            <section key={group.day || 'unknown'} className="flex flex-col gap-2">
              <h3 className="px-1 text-xs font-semibold text-fg-subtle">
                {group.day ? formatPkDay(group.day, 'long') : 'No date'}
                <span className="ml-1.5 tabular-nums text-fg-faint">· {group.rows.length}</span>
              </h3>
              <ul className="flex flex-col gap-2">
                {group.rows.map(row => (
                  <HistoryRow
                    key={row.batch.id}
                    batch={row.batch}
                    at={row.at}
                    unit={unitByProduct.get(row.batch.product_name) || 'kg'}
                    expanded={expandedId === row.batch.id}
                    onToggle={toggle}
                  />
                ))}
              </ul>
            </section>
          ))}
          <LoadMoreRow sentinelRef={list.sentinelRef} hiddenCount={list.hiddenCount} onShowMore={list.showMore} onShowAll={list.showAll} />
        </div>
      )}
    </div>
  );
}

interface HistoryRowProps {
  batch: ProductionBatch;
  at: string;
  unit: string;
  expanded: boolean;
  onToggle: (id: string) => void;
}

const HistoryRow = memo(function HistoryRow({ batch, at, unit, expanded, onToggle }: HistoryRowProps) {
  const isCompleted = batch.status === ProductionStage.COMPLETED;
  const input = Number(batch.quantity_input) || 0;
  const output = Number(batch.quantity_output_actual) || 0;
  const target = Number(batch.quantity_output_estimated) || 0;
  const yieldInfo = batchYield(output, input, target);
  const time = formatPkTime(at);
  const cancelLog = !isCompleted ? [...(batch.logs || [])].reverse().find(log => log.stage === ProductionStage.CANCELLED) : undefined;
  // Completion saves the output and the cost snapshot inside `details`; the top-level columns stay empty.
  const outputBreakdown = batch.output_breakdown || batch.details?.output_breakdown as ProductionBatch['output_breakdown'];
  const financials = batch.financials || batch.details?.financials as ProductionBatch['financials'];
  const profit = financials?.gross_profit;
  // Recipe and packaging used, in each material's stock unit.
  const snapshot = (batch.details?.cost_snapshot || null) as { milk_cost?: number; recipe_inputs?: UsedMaterial[]; packaging_inputs?: UsedMaterial[] } | null;
  const materialsUsed = [...(snapshot?.recipe_inputs || []), ...(snapshot?.packaging_inputs || [])].filter(m => Number(m?.quantity) > 0);
  const snapshotCost = snapshot && !financials ? {
    milk: Number(snapshot.milk_cost) || 0,
    materials: materialsUsed.reduce((sum, m) => sum + (Number(m.quantity) || 0) * (Number(m.unit_cost) || 0), 0),
  } : null;

  const metrics = isCompleted ? (
    <>
      <Stat label={YIELD_COPY.perLitre.label} title={YIELD_COPY.perLitre.hint} value={formatYieldPerLitre(yieldInfo.perLitre, unit)} />
      <Stat
        label={YIELD_COPY.ofTarget.label}
        title={YIELD_COPY.ofTarget.hint}
        value={formatOfTarget(yieldInfo.ofTarget)}
        className={TONE_TEXT[yieldInfo.tone]}
      />
      {profit !== undefined && <Stat label="Profit" value={<Money amount={profit} tone="signed" />} />}
    </>
  ) : null;

  return (
    <li className={cn('overflow-hidden rounded-card border bg-surface shadow-e1 transition-colors', expanded ? 'border-line-strong' : 'border-line')}>
      <button
        type="button"
        onClick={() => onToggle(batch.id)}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center gap-3 p-3 text-left hover:bg-surface-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-4"
      >
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]',
            isCompleted ? 'bg-success-soft text-success-fg' : 'bg-danger-soft text-danger-fg',
          )}
          aria-hidden="true"
        >
          {isCompleted ? <Package /> : <Ban />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-fg">{batch.product_name}</p>
            <Badge className="font-mono">{batch.batch_number}</Badge>
            {!isCompleted && <Badge tone="danger">Cancelled</Badge>}
          </div>
          <p className="mt-0.5 text-xs tabular-nums text-fg-subtle">
            In {formatQty(input, 3)} L
            {isCompleted && <> · Out {formatQty(output, 3)} {unit}</>}
            {time && <> · {time}</>}
          </p>
        </div>
        {metrics && <dl className="hidden shrink-0 items-center gap-5 text-right sm:flex">{metrics}</dl>}
        <span className="shrink-0 text-fg-faint [&_svg]:size-4" aria-hidden="true">{expanded ? <ChevronUp /> : <ChevronDown />}</span>
      </button>
      {metrics && <dl className="flex items-center justify-between gap-3 border-t border-line px-3 py-2 sm:hidden">{metrics}</dl>}

      {expanded && (
        <div className="space-y-3 border-t border-line bg-surface-2/50 p-3 animate-fade-up sm:p-4">
          {cancelLog && <p className="text-sm text-danger-fg">{cancelLog.message}</p>}

          {financials ? (
            <dl className="grid grid-cols-2 gap-2 rounded-control border border-line bg-surface p-3 sm:grid-cols-4">
              <Stat label="Milk cost" value={<Money amount={financials.milk_cost} />} align="left" />
              <Stat label="Additives" value={<Money amount={financials.additives_cost} />} align="left" />
              <Stat label="Total cost" value={<Money amount={financials.total_cost} />} align="left" />
              <Stat label="Sales value" value={<Money amount={financials.sales_value} />} align="left" />
            </dl>
          ) : snapshotCost && (
            <dl className="grid grid-cols-3 gap-2 rounded-control border border-line bg-surface p-3">
              <Stat label="Milk cost" value={<Money amount={snapshotCost.milk} />} align="left" />
              <Stat label="Materials" value={<Money amount={snapshotCost.materials} />} align="left" />
              <Stat label="Total cost" value={<Money amount={snapshotCost.milk + snapshotCost.materials} />} align="left" />
            </dl>
          )}

          {isCompleted && outputBreakdown && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-semibold text-fg-subtle">Added to stock:</span>
              {(outputBreakdown.loose_qty || 0) > 0 && <Badge>Loose {formatQty(outputBreakdown.loose_qty, 3)} {unit}</Badge>}
              {(outputBreakdown.variants || []).map((v, index) => (
                <Badge key={`${v.variant_name}-${index}`} tone="brand">{v.count} × {v.variant_name}</Badge>
              ))}
            </div>
          )}

          {isCompleted && materialsUsed.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-semibold text-fg-subtle">Materials used:</span>
              {materialsUsed.map((m, index) => (
                <Badge key={`${m.item_id || m.name}-${index}`}>{m.name} {formatQty(m.quantity, 3)} {m.unit || ''}</Badge>
              ))}
            </div>
          )}

          <div>
            <h5 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
              <FileText className="size-3.5" aria-hidden="true" /> Batch logs
            </h5>
            <ol className="space-y-2 border-l-2 border-line pl-3">
              {(batch.logs || []).map((log, index) => (
                <li key={index} className="text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-fg-muted">{log.message}</span>
                    <span className="shrink-0 tabular-nums text-fg-subtle">{formatPkDay(log.timestamp)} {formatPkTime(log.timestamp)}</span>
                  </div>
                  <Badge
                    tone={log.stage === ProductionStage.COMPLETED ? 'success' : log.stage === ProductionStage.CANCELLED ? 'danger' : 'neutral'}
                    className="mt-1"
                  >
                    {log.stage}
                  </Badge>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </li>
  );
});

function Stat({ label, value, className, title, align = 'right' }: { label: string; value: React.ReactNode; className?: string; title?: string; align?: 'left' | 'right' }) {
  return (
    <div className={align === 'left' ? 'text-left' : 'sm:text-right'} title={title}>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{label}</dt>
      <dd className={cn('mt-0.5 text-sm font-bold tabular-nums text-fg', className)}>{value}</dd>
    </div>
  );
}
