import React, { Suspense, lazy, memo, useCallback, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, LockKeyhole, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, EmptyState, LoadMoreRow, Money } from '../ui';
import { useDairy } from '../../context/DairyContext';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import type { BusinessDay } from '../../types';
import { cn } from '../../lib/cn';
import { formatCurrency } from '../../lib/formatters';
import { CheckItem, MiniStat } from './CashBits';
import { formatBusinessDate, formatPkDateTime, useLatest } from './cashFormat';
import { EMPTY_DAY_STATUS, indexDays, summarizeDay, type DayStatus, type DaySummary } from './dayData';
import { useShiftTotals, type RunAction } from './useCashData';
import type { DayCloseStep } from './DayCloseDialog';
import type { CashTab } from './tabs';

const DayCloseDialog = lazy(() => import('./DayCloseDialog'));
const NoteDialog = lazy(() => import('./NoteDialog'));

interface BusinessDaysProps {
  run: RunAction;
  busyKey: string | null;
  /** Owner (Super Admin) only, matching reopenBusinessDay. */
  canReopen: boolean;
  onOpenTab: (tab: CashTab) => void;
}

const firstStep = (day: BusinessDay, status: DayStatus): DayCloseStep =>
  status.blockers > 0 ? 'check' : !day.cash_closed_at ? 'cash' : !day.stock_closed_at ? 'stock' : 'lock';

const BusinessDays: React.FC<BusinessDaysProps> = ({ run, busyKey, canReopen, onOpenTab }) => {
  const { businessDays, shiftSessions, cashRemittances, cashHandovers, cashVariances, getBusinessDate, reopenBusinessDay } = useDairy();
  const reopenRef = useLatest(reopenBusinessDay);
  const { version, getTotals } = useShiftTotals();
  const today = getBusinessDate();
  const [closing, setClosing] = useState<{ dayId: string; step: DayCloseStep } | null>(null);
  const [reopenDayId, setReopenDayId] = useState<string | null>(null);

  const dayIndex = useMemo(
    () => indexDays(shiftSessions, cashRemittances, cashHandovers, cashVariances),
    [shiftSessions, cashRemittances, cashHandovers, cashVariances],
  );
  // Newest first; the context loads them that way but a locally added day can land anywhere.
  const days = useMemo(() => businessDays.slice().sort((a, b) => b.business_date.localeCompare(a.business_date)), [businessDays]);
  const earlierOpenDays = useMemo(() => days.filter(day => day.status !== 'Closed' && day.business_date < today), [days, today]);

  const { visibleItems, hiddenCount, sentinelRef, showMore, showAll } = useProgressiveList<BusinessDay>(days, 10);

  // Live totals only for the days on screen; closed days read their stored record.
  const summaries = useMemo(() => {
    void version;
    const map = new Map<string, DaySummary>();
    for (const day of visibleItems) map.set(day.id, summarizeDay(day, (dayIndex.get(day.id) || EMPTY_DAY_STATUS).shifts, getTotals));
    return map;
  }, [visibleItems, dayIndex, getTotals, version]);

  const openClose = useCallback((day: BusinessDay, step?: DayCloseStep) => {
    setClosing({ dayId: day.id, step: step || firstStep(day, dayIndex.get(day.id) || EMPTY_DAY_STATUS) });
  }, [dayIndex]);
  const openReopen = useCallback((day: BusinessDay) => setReopenDayId(day.id), []);
  const reopenDay = businessDays.find(day => day.id === reopenDayId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-[15px] font-bold text-fg">Business days</h3>
          <p className="mt-0.5 max-w-2xl text-[13px] text-fg-subtle">A day locks once every shift, remittance, handover and variance is settled. Each card&apos;s checklist shows what is left.</p>
        </div>
        <Badge tone="brand" size="md" dot>Today: {formatBusinessDate(today)}</Badge>
      </div>

      {earlierOpenDays.length > 0 && (
        <div className="flex flex-col gap-2 rounded-card bg-info-soft px-4 py-3 text-[13px] text-info-fg ring-1 ring-inset ring-info/20 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-start gap-2 font-semibold">
            <CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {earlierOpenDays.length === 1
              ? `${formatBusinessDate(earlierOpenDays[0].business_date)} is still open — today's work isn't blocked, but please close this day.`
              : `${earlierOpenDays.length} earlier days are still open — today's work isn't blocked, but please close them.`}
          </span>
          <Button size="sm" variant="secondary" onClick={() => openClose(earlierOpenDays[earlierOpenDays.length - 1])}>
            Close {formatBusinessDate(earlierOpenDays[earlierOpenDays.length - 1].business_date)}
          </Button>
        </div>
      )}

      {days.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarDays />} title="No business day yet" description="A business day is created as soon as the first shift starts." />
        </Card>
      ) : (
        <>
          {visibleItems.map(day => (
            <DayCard
              key={day.id}
              day={day}
              status={dayIndex.get(day.id) || EMPTY_DAY_STATUS}
              summary={summaries.get(day.id)}
              isToday={day.business_date === today}
              canReopen={canReopen}
              busy={busyKey === `day-reopen:${day.id}`}
              onClose={openClose}
              onReopen={openReopen}
            />
          ))}
          <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} />
        </>
      )}

      {closing && (
        <Suspense fallback={null}>
          <DayCloseDialog
            key={closing.dayId}
            dayId={closing.dayId}
            initialStep={closing.step}
            onClose={() => setClosing(null)}
            run={run}
            busyKey={busyKey}
            onOpenTab={onOpenTab}
          />
        </Suspense>
      )}

      {reopenDay && (
        <Suspense fallback={null}>
          <NoteDialog
            open
            onClose={() => setReopenDayId(null)}
            busy={busyKey === `day-reopen:${reopenDay.id}`}
            tone="danger"
            title="Reopen business day"
            description={`${formatBusinessDate(reopenDay.business_date)} will open again; cash and stock closing must be done again. The reason is recorded in the audit trail.`}
            icon={<span className="flex size-10 items-center justify-center rounded-xl bg-danger-soft text-danger-fg"><RefreshCw size={20} /></span>}
            label="Reason for reopening"
            placeholder="e.g. stock closing was missed — reopening to complete it"
            confirmLabel="Reopen day"
            confirmIcon={<RefreshCw />}
            onConfirm={reason => run(`day-reopen:${reopenDay.id}`, () => reopenRef.current(reopenDay.id, reason))}
          />
        </Suspense>
      )}
    </div>
  );
};

interface DayCardProps {
  day: BusinessDay;
  status: DayStatus;
  summary?: DaySummary;
  isToday: boolean;
  canReopen: boolean;
  busy: boolean;
  onClose: (day: BusinessDay, step?: DayCloseStep) => void;
  onReopen: (day: BusinessDay) => void;
}

const DayCard = memo(function DayCard({ day, status, summary, isToday, canReopen, busy, onClose, onReopen }: DayCardProps) {
  const closed = day.status === 'Closed';
  const closings = [
    { step: 'cash' as const, label: 'Cash', at: day.cash_closed_at },
    { step: 'stock' as const, label: 'Stock', at: day.stock_closed_at },
  ];
  return (
    <Card className={cn('overflow-hidden', !closed && status.blockers === 0 && 'ring-1 ring-inset ring-brand-accent/30')}>
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', closed ? 'bg-surface-2 text-fg-subtle' : 'bg-brand-soft text-brand-fg')}>
            {closed ? <LockKeyhole size={18} /> : <CalendarDays size={18} />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[15px] font-bold text-fg">{formatBusinessDate(day.business_date)}</h4>
              {isToday && <Badge tone="brand">Today</Badge>}
              <Badge tone={closed ? 'neutral' : 'success'} dot>{closed ? 'Closed' : 'Open'}</Badge>
              {!closed && status.blockers > 0 && <Badge tone="warning">{status.blockers} pending</Badge>}
            </div>
            <p className="mt-1 text-xs text-fg-subtle">
              {status.shifts.length} shift{status.shifts.length === 1 ? '' : 's'}
              {closed && day.closed_at ? ` · locked ${formatPkDateTime(day.closed_at)}` : ' · in progress'}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {closings.map(item => (
                item.at ? (
                  <Badge key={item.step} tone="success" icon={<CheckCircle2 />} title={`${item.label} closing ${formatPkDateTime(item.at)}`}>{item.label} closed</Badge>
                ) : closed ? null : (
                  <button
                    key={item.step}
                    type="button"
                    onClick={() => onClose(day, item.step)}
                    className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-full bg-warning-soft px-2.5 text-[11px] font-semibold text-warning-fg ring-1 ring-inset ring-warning/25 hover:bg-warning/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <AlertTriangle className="size-3" aria-hidden="true" /> {item.label} due
                  </button>
                )
              ))}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!closed && (
            <Button leftIcon={<LockKeyhole />} variant={status.blockers === 0 ? 'primary' : 'secondary'} onClick={() => onClose(day)} className="w-full sm:w-auto">
              {status.blockers === 0 ? 'Close day' : 'Review & close'}
            </Button>
          )}
          {closed && canReopen && (
            <Button variant="danger-soft" leftIcon={<RefreshCw />} loading={busy} onClick={() => onReopen(day)} className="w-full sm:w-auto">
              Reopen
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 border-t border-line px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        {!closed ? (
          <div className="flex flex-col gap-2">
            <CheckItem ok={status.openShifts === 0} label="All shifts closed" count={status.openShifts} />
            <CheckItem ok={status.pendingRemits === 0} label="Remittances received" count={status.pendingRemits} />
            <CheckItem ok={status.disputedHandovers === 0} label="Handovers settled" count={status.disputedHandovers} />
            <CheckItem ok={status.openVariances === 0} label="Variances resolved" count={status.openVariances} />
          </div>
        ) : (
          <div className="text-xs text-fg-subtle">
            {day.notes ? <p><span className="font-semibold text-fg-muted">Close notes:</span> {day.notes}</p> : <p>Final record — figures as at the lock.</p>}
            {day.reopen_reason && <p className="mt-1"><span className="font-semibold text-fg-muted">Reopened before:</span> {day.reopen_reason}</p>}
          </div>
        )}
        {summary && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <MiniStat label="Gross sales"><Money amount={summary.gross} /></MiniStat>
            <MiniStat label="Cash"><Money amount={summary.cash} /></MiniStat>
            <MiniStat label="Online"><Money amount={summary.online} /></MiniStat>
            <MiniStat label="Credit"><Money amount={summary.credit} /></MiniStat>
            <MiniStat label="Shifts">{summary.shifts}</MiniStat>
            <MiniStat label="Over / short" tone={summary.variance < 0 ? 'danger' : summary.variance > 0 ? 'success' : undefined}>
              {/* Net can hide an over in one shift and a short in another, so the split is on hover. */}
              <Money amount={summary.variance} tone="signed" title={`Over ${formatCurrency(summary.over)} · Short ${formatCurrency(summary.short)}`} />
            </MiniStat>
          </div>
        )}
      </div>
    </Card>
  );
});

export default BusinessDays;
