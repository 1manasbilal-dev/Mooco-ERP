import React, { memo, useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, History, X } from 'lucide-react';
import {
  Badge, Button, Card, CardHeader, EmptyState, LoadMoreRow, Money, SearchInput, SegmentedControl, TBody, TD, TH, THead, TR, Table, TableContainer, Toolbar,
} from '../ui';
import type { Tone } from '../ui';
import { useDairy } from '../../context/DairyContext';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import type { CashVariance, ShiftSession } from '../../types';
import { cn } from '../../lib/cn';
import { ShiftStatusBadge } from './CashBits';
import { OPEN_SHIFT_STATUSES, formatBusinessDate, formatPkDateTime, formatPkTime, useLatest } from './cashFormat';
import { useDrawerLookup, type RunAction } from './useCashData';
import { useVarianceGuard } from './useVarianceGuard';

type ShiftFilter = 'all' | 'open' | 'review' | 'closed';

const VARIANCE_TYPE_TONE: Record<string, Tone> = {
  'Shift Closing': 'warning',
  'Head Remittance': 'info',
  'Opening Handover': 'neutral',
  'Opening Mismatch': 'neutral',
};

interface AuditTrailProps {
  run: RunAction;
  busyKey: string | null;
}

const AuditTrail: React.FC<AuditTrailProps> = ({ run, busyKey }) => {
  const { shiftSessions, cashVariances, users, resolveCashVariance } = useDairy();
  const resolveRef = useLatest(resolveCashVariance);
  const { nameOf } = useDrawerLookup();
  const { confirmNote, approvalDialog } = useVarianceGuard();
  const [filter, setFilter] = useState<ShiftFilter>('all');
  const [query, setQuery] = useState('');

  const openVariances = useMemo(
    () => cashVariances.filter(variance => variance.status === 'Open').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    [cashVariances],
  );
  const shiftById = useMemo(() => new Map<string, ShiftSession>(shiftSessions.map(shift => [shift.id, shift])), [shiftSessions]);
  const userName = useCallback((userId?: string) => (userId ? users.find(user => user.id === userId)?.name || userId : '—'), [users]);

  const counts = useMemo(() => {
    let open = 0, review = 0, closed = 0;
    for (const shift of shiftSessions) {
      if (shift.status === 'Pending Review') review += 1;
      else if (OPEN_SHIFT_STATUSES.includes(shift.status)) open += 1;
      else closed += 1;
    }
    return { all: shiftSessions.length, open, review, closed };
  }, [shiftSessions]);

  const filteredShifts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return shiftSessions.filter(shift => {
      if (filter === 'open' && !(OPEN_SHIFT_STATUSES.includes(shift.status) && shift.status !== 'Pending Review')) return false;
      if (filter === 'review' && shift.status !== 'Pending Review') return false;
      if (filter === 'closed' && OPEN_SHIFT_STATUSES.includes(shift.status)) return false;
      if (!needle) return true;
      return [shift.user_name, shift.drawer_name, shift.date, shift.business_date, shift.status].some(value => String(value || '').toLowerCase().includes(needle));
    });
  }, [shiftSessions, filter, query]);

  const { visibleItems, hiddenCount, sentinelRef, showMore, showAll } = useProgressiveList<ShiftSession>(filteredShifts, 25, `${filter}|${query}`);

  const resolve = useCallback(async (variance: CashVariance, status: 'Approved' | 'Rejected', note: string) => {
    const finalNote = await confirmNote(variance, note);
    if (finalNote === null) return false;
    return run(`variance:${variance.id}`, () => resolveRef.current(variance.id, status, finalNote));
  }, [confirmNote, run, resolveRef]);

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <Card className="overflow-hidden">
        <CardHeader
          title="Open variances"
          description="Har farq yahan approve ya reject hota hai. Reject ke liye wajah zaroori hai."
          icon={<AlertTriangle />}
          actions={openVariances.length > 0 ? <Badge tone="danger" dot>{openVariances.length} open</Badge> : <Badge tone="success" dot>All clear</Badge>}
        />
        {openVariances.length === 0 ? (
          <EmptyState size="compact" icon={<CheckCircle2 />} title="No open variance" description="Har cash farq resolve ho chuka hai." />
        ) : (
          <div className="divide-y divide-line border-t border-line">
            {openVariances.map(variance => {
              const shift = variance.shift_id ? shiftById.get(variance.shift_id) : undefined;
              return (
                <VarianceRow
                  key={variance.id}
                  variance={variance}
                  context={shift ? `${shift.user_name} · ${shift.drawer_name || nameOf(shift.drawer_id)}` : variance.business_day_id}
                  reportedBy={userName(variance.reported_by)}
                  busy={busyKey === `variance:${variance.id}`}
                  locked={busyKey !== null}
                  onResolve={resolve}
                />
              );
            })}
          </div>
        )}
      </Card>

      <section aria-labelledby="shift-history-heading" className="flex flex-col gap-3">
        <div>
          <h3 id="shift-history-heading" className="text-[15px] font-bold text-fg">Shift history</h3>
          <p className="mt-0.5 text-[13px] text-fg-subtle">Har shift ki opening, gini hui closing aur farq — naye pehle.</p>
        </div>
        <Toolbar>
          <SegmentedControl
            aria-label="Shift status"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All', count: counts.all },
              { value: 'open', label: 'Open', count: counts.open },
              { value: 'review', label: 'Review', count: counts.review },
              { value: 'closed', label: 'Closed', count: counts.closed },
            ]}
          />
          <SearchInput value={query} onChange={setQuery} placeholder="Cashier, drawer ya date…" className="min-w-[12rem] flex-1" />
        </Toolbar>
        <TableContainer>
          {filteredShifts.length === 0 ? (
            <EmptyState size="compact" icon={<History />} title="Koi shift nahi mili" description={query ? 'Search badal kar dekhein.' : 'Is filter mein koi shift nahi.'} />
          ) : (
            <Table className="min-w-[860px]">
              <THead>
                <TR>
                  <TH>Cashier</TH>
                  <TH>Business day</TH>
                  <TH>Time</TH>
                  <TH numeric>Opening</TH>
                  <TH numeric>Expected</TH>
                  <TH numeric>Counted</TH>
                  <TH numeric>Variance</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {visibleItems.map(shift => <ShiftRow key={shift.id} shift={shift} drawer={shift.drawer_name || nameOf(shift.drawer_id)} />)}
                <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} colSpan={8} />
              </TBody>
            </Table>
          )}
        </TableContainer>
      </section>
      {approvalDialog}
    </div>
  );
};

const ShiftRow = memo(function ShiftRow({ shift, drawer }: { shift: ShiftSession; drawer: string }) {
  const closed = Boolean(shift.closed_at);
  const variance = shift.cash_difference;
  return (
    <TR>
      <TD>
        <p className="font-semibold text-fg">{shift.user_name}</p>
        <p className="text-xs text-fg-subtle">{drawer}</p>
      </TD>
      <TD className="whitespace-nowrap text-fg-muted">{formatBusinessDate(shift.business_date || shift.date)}</TD>
      <TD className="whitespace-nowrap text-xs text-fg-muted">
        {formatPkTime(shift.started_at || shift.start_time)} → {closed ? formatPkTime(shift.closed_at) : 'now'}
      </TD>
      <TD numeric><Money amount={shift.opening_counted ?? shift.opening_float} /></TD>
      <TD numeric>{closed ? <Money amount={shift.expected_drawer_cash} /> : <span className="text-fg-faint">—</span>}</TD>
      <TD numeric>{shift.actual_physical_cash !== undefined ? <Money amount={shift.actual_physical_cash} /> : <span className="text-fg-faint">—</span>}</TD>
      <TD numeric>
        {variance === undefined || variance === null
          ? <span className="text-fg-faint">—</span>
          : Math.abs(Number(variance)) < 0.01 ? <span className="text-xs font-semibold text-success-fg">Exact</span> : <Money amount={variance} tone="signed" />}
      </TD>
      <TD><ShiftStatusBadge status={shift.status} /></TD>
    </TR>
  );
});

interface VarianceRowProps {
  variance: CashVariance;
  context: string;
  reportedBy: string;
  busy: boolean;
  locked: boolean;
  onResolve: (variance: CashVariance, status: 'Approved' | 'Rejected', note: string) => Promise<boolean>;
}

const VarianceRow = memo(function VarianceRow({ variance, context, reportedBy, busy, locked, onResolve }: VarianceRowProps) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const amount = Number(variance.variance || 0);

  const act = (status: 'Approved' | 'Rejected') => {
    const trimmed = note.trim();
    // A rejection overrides what the cashier said happened, so it must say why.
    if (status === 'Rejected' && trimmed.length < 3) {
      setError('Reject karne ki wajah likhein.');
      return;
    }
    setError('');
    void onResolve(variance, status, trimmed || (status === 'Approved' ? 'Approved by head' : 'Rejected by head'));
  };

  return (
    <div className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={VARIANCE_TYPE_TONE[variance.variance_type] || 'neutral'}>{variance.variance_type}</Badge>
          <span className={cn('text-base font-bold tabular-nums', amount < 0 ? 'text-danger-fg' : 'text-success-fg')}>
            {amount < 0 ? 'Short ' : 'Over '}<Money amount={Math.abs(amount)} />
          </span>
        </div>
        <p className="mt-1 text-xs text-fg-subtle">
          Expected <Money amount={variance.expected_amount} className="font-semibold text-fg-muted" /> · counted <Money amount={variance.counted_amount} className="font-semibold text-fg-muted" />
        </p>
        <p className="mt-0.5 truncate text-xs text-fg-subtle">{context} · {formatPkDateTime(variance.created_at)} · by {reportedBy}</p>
        {variance.reason && <p className="mt-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-fg-muted ring-1 ring-inset ring-line/70">“{variance.reason}”</p>}
      </div>
      <div className="flex flex-col gap-2">
        <input
          value={note}
          onChange={event => { setNote(event.target.value); if (error) setError(''); }}
          placeholder="Resolution note"
          aria-label="Resolution note"
          aria-invalid={error ? true : undefined}
          className={cn('ds-control h-10 w-full rounded-control border bg-surface px-3 text-sm text-fg shadow-e1 outline-none placeholder:text-fg-faint focus:border-brand-accent focus:ring-4 focus:ring-ring/20', error ? 'border-danger' : 'border-line')}
        />
        {error && <p className="text-xs font-semibold text-danger-fg">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" leftIcon={<Check />} loading={busy} disabled={locked && !busy} onClick={() => act('Approved')}>Approve</Button>
          <Button size="sm" variant="danger-soft" leftIcon={<X />} disabled={locked} onClick={() => act('Rejected')}>Reject</Button>
        </div>
      </div>
    </div>
  );
});

export default AuditTrail;
