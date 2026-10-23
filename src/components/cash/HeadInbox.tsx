import React, { Suspense, lazy, memo, useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRightLeft, Check, CheckCircle2, ChevronDown, Clock3, ShieldCheck, WalletCards,
} from 'lucide-react';
import {
  Badge, Button, Card, CardHeader, EmptyState, Field, Money, Select, StatCard, TBody, TD, TH, THead, TR, Table, TableContainer, Textarea,
} from '../ui';
import { useDairy } from '../../context/DairyContext';
import type { CashHandover, CashRemittance, CashVariance, FinancialAccount, ShiftSession } from '../../types';
import { cn } from '../../lib/cn';
import { formatCurrency } from '../../lib/formatters';
import { Avatar, CountInput, DenominationChips, Detail, ShiftStatusBadge, VarianceCallout } from './CashBits';
import { LIVE_SHIFT_STATUSES, OPEN_SHIFT_STATUSES, cashVariance, formatPkDateTime, formatPkTime, parseCashInput, useLatest } from './cashFormat';
import { denominationPieces, denominationTotal, type DenominationCounts } from './denominations';
import { useDrawerLookup, useShiftTotals, type RunAction } from './useCashData';
import { useVarianceGuard } from './useVarianceGuard';
import type { CashTab } from './tabs';

const DenominationDialog = lazy(() => import('../DenominationDialog').then(module => ({ default: module.DenominationDialog })));
const NoteDialog = lazy(() => import('./NoteDialog'));

interface HeadInboxProps {
  run: RunAction;
  busyKey: string | null;
  onOpenTab: (tab: CashTab) => void;
}

const HeadInbox: React.FC<HeadInboxProps> = ({ run, busyKey, onOpenTab }) => {
  const { accounts, cashHandovers, cashRemittances, cashVariances, cashInTransit, shiftSessions, acceptHeadRemittance, resolveCashHandover, resolveCashVariance } = useDairy();
  const actions = useLatest({ acceptHeadRemittance, resolveCashHandover, resolveCashVariance });
  const { accountOf, nameOf: drawerName } = useDrawerLookup();
  const { version, getTotals } = useShiftTotals();
  const { confirmNote, approvalDialog } = useVarianceGuard();
  const [settling, setSettling] = useState<{ handover: CashHandover; variance?: CashVariance } | null>(null);

  const pendingRemittances = useMemo(
    () => cashRemittances.filter(remittance => remittance.status === 'Pending').sort((a, b) => (a.declared_at < b.declared_at ? -1 : 1)),
    [cashRemittances],
  );
  const disputedRemittances = useMemo(() => cashRemittances.filter(remittance => remittance.status === 'Disputed').length, [cashRemittances]);
  const openHandovers = useMemo(() => cashHandovers.filter(handover => handover.status === 'Pending' || handover.status === 'Disputed'), [cashHandovers]);
  const openVarianceByHandover = useMemo(() => {
    const map = new Map<string, CashVariance>();
    for (const variance of cashVariances) if (variance.status === 'Open' && variance.handover_id) map.set(variance.handover_id, variance);
    return map;
  }, [cashVariances]);
  const openVarianceCount = useMemo(() => cashVariances.filter(variance => variance.status === 'Open').length, [cashVariances]);
  const receivingAccounts = useMemo(() => accounts.filter(account => account.isActive !== false), [accounts]);

  // Live expected cash for the drawers in use right now (a handful of shifts, recomputed only when data changes).
  const liveShifts = useMemo(() => {
    void version;
    return shiftSessions
      .filter(shift => OPEN_SHIFT_STATUSES.includes(shift.status))
      .map(shift => {
        const live = shift.status === 'Active' || shift.status === 'Closing';
        const expected = live ? Number(getTotals(shift.id).expectedCash || 0) : Number(shift.expected_drawer_cash || 0);
        const counted = shift.status === 'Pending Review' && shift.actual_physical_cash !== undefined ? Number(shift.actual_physical_cash) : null;
        return { shift, expected, counted, variance: counted === null ? null : Number(shift.cash_difference ?? cashVariance(counted, expected)) };
      });
  }, [shiftSessions, getTotals, version]);

  const liveCount = liveShifts.filter(row => LIVE_SHIFT_STATUSES.includes(row.shift.status)).length;

  const accept = useCallback((remittance: CashRemittance, counted: number, denominations: DenominationCounts, destinationId: string, notes: string) =>
    run(`remit:${remittance.id}`, () => actions.current.acceptHeadRemittance(remittance.id, counted, denominations, destinationId, notes)), [run, actions]);

  const openSettle = useCallback((handover: CashHandover) => setSettling({ handover, variance: openVarianceByHandover.get(handover.id) }), [openVarianceByHandover]);

  const settleHandover = async (note: string) => {
    if (!settling) return false;
    const { handover, variance } = settling;
    // Approving the handover's open variance also settles the handover (and frees the day close);
    // settling only the handover left its variance open and the day still blocked.
    if (!variance) return run(`handover:${handover.id}`, () => actions.current.resolveCashHandover(handover.id, 'Resolve', note));
    const finalNote = await confirmNote(variance, note);
    if (finalNote === null) return false;
    return run(`handover:${handover.id}`, () => actions.current.resolveCashVariance(variance.id, 'Approved', finalNote));
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Cash in transit"
          icon={<WalletCards />}
          tone={cashInTransit.count > 0 ? 'warning' : 'neutral'}
          value={<Money amount={cashInTransit.amount} compact />}
          hint={`${cashInTransit.count} to receive`}
        />
        <StatCard label="Live shifts" icon={<Clock3 />} tone={liveCount > 0 ? 'brand' : 'neutral'} value={liveCount} hint="Drawers in use" />
        <StatCard label="Handovers" icon={<ArrowRightLeft />} tone={openHandovers.length > 0 ? 'info' : 'neutral'} value={openHandovers.length} hint="Waiting for next shift" />
        <StatCard
          label="Open variances"
          icon={<AlertTriangle />}
          tone={openVarianceCount > 0 ? 'danger' : 'neutral'}
          value={openVarianceCount}
          hint={openVarianceCount > 0 ? 'Review karein' : 'All clear'}
          onClick={() => onOpenTab('audit')}
        />
      </div>

      <section aria-labelledby="remittances-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 id="remittances-heading" className="text-[15px] font-bold text-fg">Remittances to receive</h3>
            <p className="mt-0.5 text-[13px] text-fg-subtle">Cashier ka bheja hua cash gin kar account mein receive karein. Har farq variance ban kar record hota hai.</p>
          </div>
          {pendingRemittances.length > 0 && <Badge tone="warning" dot>{pendingRemittances.length} pending</Badge>}
        </div>
        {disputedRemittances > 0 && (
          <div className="flex flex-col gap-2 rounded-card bg-warning-soft px-4 py-3 text-[13px] text-warning-fg ring-1 ring-inset ring-warning/25 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-start gap-2 font-semibold">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {disputedRemittances} remittance{disputedRemittances > 1 ? 's' : ''} ki ginti mein farq hai — Audit Trail mein variance approve ya reject karein.
            </span>
            <Button size="sm" variant="secondary" onClick={() => onOpenTab('audit')}>Open Audit Trail</Button>
          </div>
        )}
        {pendingRemittances.length === 0 ? (
          <Card>
            <EmptyState icon={<CheckCircle2 />} title="No pending remittance" description="Cashiers ka sara bheja hua cash receive ho chuka hai." />
          </Card>
        ) : (
          pendingRemittances.map(remittance => (
            <RemittanceCard
              key={remittance.id}
              remittance={remittance}
              drawerName={drawerName(remittance.drawer_id)}
              drawerAccountId={accountOf(remittance.drawer_id)?.id}
              accounts={receivingAccounts}
              busy={busyKey === `remit:${remittance.id}`}
              locked={busyKey !== null}
              onAccept={accept}
            />
          ))
        )}
      </section>

      {liveShifts.length > 0 && (
        <TableContainer>
          <CardHeader
            title="Open shifts"
            description="Drawers abhi kis ke paas hain aur un mein kitna cash hona chahiye. Pending Review = gini ja chuki, farq approve hona baqi."
            icon={<Clock3 />}
            actions={<Badge tone="success" dot>{liveShifts.length} open</Badge>}
          />
          <Table className="min-w-[720px]">
            <THead>
              <TR>
                <TH>Cashier</TH>
                <TH>Drawer</TH>
                <TH>Started</TH>
                <TH numeric>Opening</TH>
                <TH numeric>Expected now</TH>
                <TH numeric>Counted</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {liveShifts.map(row => <LiveShiftRow key={row.shift.id} {...row} drawer={drawerName(row.shift.drawer_id)} />)}
            </TBody>
          </Table>
        </TableContainer>
      )}

      <section aria-labelledby="handovers-heading" className="flex flex-col gap-3">
        <div>
          <h3 id="handovers-heading" className="text-[15px] font-bold text-fg">Drawer handovers</h3>
          <p className="mt-0.5 text-[13px] text-fg-subtle">Drawer mein chhora gaya cash — agli shift isay gin kar opening cash ke tor par leti hai.</p>
        </div>
        {openHandovers.length === 0 ? (
          <Card>
            <EmptyState size="compact" icon={<ArrowRightLeft />} title="No pending handover" description="Har drawer ka cash kisi shift ne le liya hai." />
          </Card>
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {openHandovers.map(handover => (
              <HandoverRow
                key={handover.id}
                handover={handover}
                drawerName={drawerName(handover.drawer_id)}
                busy={busyKey === `handover:${handover.id}`}
                locked={busyKey !== null}
                onSettle={openSettle}
              />
            ))}
          </Card>
        )}
      </section>

      {settling && (
        <Suspense fallback={null}>
          <NoteDialog
            open
            onClose={() => setSettling(null)}
            busy={busyKey === `handover:${settling.handover.id}`}
            title="Disputed handover settle karein"
            description={settling.variance
              ? 'Is handover ka farq approve ho jayega aur handover settle ho jayega.'
              : 'Handover settle ho jayega; is ka koi open variance nahi mila.'}
            icon={<span className="flex size-10 items-center justify-center rounded-xl bg-warning-soft text-warning-fg"><ShieldCheck size={20} /></span>}
            summary={(
              <div className="grid grid-cols-3 gap-2 rounded-control bg-surface-2 p-3 text-[13px] ring-1 ring-inset ring-line/70">
                <Detail label="Declared"><Money amount={settling.handover.declared_amount} /></Detail>
                <Detail label="Counted"><Money amount={settling.handover.counted_amount ?? settling.variance?.counted_amount} /></Detail>
                <Detail label="Farq"><Money amount={settling.handover.variance ?? settling.variance?.variance} tone="signed" /></Detail>
              </div>
            )}
            label="Settle karne ki wajah"
            placeholder="e.g. Rs 100 ka note pichli shift mein galat gina gaya tha"
            confirmLabel="Approve & settle"
            confirmIcon={<Check />}
            onConfirm={settleHandover}
          />
        </Suspense>
      )}
      {approvalDialog}
    </div>
  );
};

const LiveShiftRow = memo(function LiveShiftRow({ shift, drawer, expected, counted, variance }: {
  shift: ShiftSession; drawer: string; expected: number; counted: number | null; variance: number | null;
}) {
  return (
    <TR>
      <TD>
        <div className="flex items-center gap-2.5">
          <Avatar name={shift.user_name} size="sm" tone="brand" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-fg">{shift.user_name}</p>
            {shift.role_name && <p className="truncate text-xs text-fg-subtle">{shift.role_name}</p>}
          </div>
        </div>
      </TD>
      <TD className="text-fg-muted">{drawer}</TD>
      <TD className="whitespace-nowrap text-fg-muted">{formatPkTime(shift.started_at || shift.start_time)}</TD>
      <TD numeric><Money amount={shift.opening_counted ?? shift.opening_float} /></TD>
      <TD numeric>{shift.status === 'Pending Acceptance' ? <span className="text-fg-faint">—</span> : <Money amount={expected} />}</TD>
      <TD numeric>
        {counted === null ? <span className="text-fg-faint">—</span> : (
          <div className="flex flex-col items-end">
            <Money amount={counted} />
            {variance !== null && variance !== 0 && <Money amount={variance} tone="signed" className="text-xs" />}
          </div>
        )}
      </TD>
      <TD><ShiftStatusBadge status={shift.status} /></TD>
    </TR>
  );
});

interface RemittanceCardProps {
  remittance: CashRemittance;
  drawerName: string;
  /** The drawer's own Bank & Cash account; cash cannot be received back into it. */
  drawerAccountId?: string;
  accounts: FinancialAccount[];
  busy: boolean;
  /** Another cash action is running. */
  locked: boolean;
  onAccept: (remittance: CashRemittance, counted: number, denominations: DenominationCounts, destinationId: string, notes: string) => Promise<boolean>;
}

/** One cashier remittance: count it, pick the receiving account, accept. Holds its own form state. */
const RemittanceCard = memo(function RemittanceCard({ remittance, drawerName, drawerAccountId, accounts, busy, locked, onAccept }: RemittanceCardProps) {
  const [countRaw, setCountRaw] = useState('');
  const [denominations, setDenominations] = useState<DenominationCounts>({});
  const [destinationId, setDestinationId] = useState('');
  const [notes, setNotes] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const [tried, setTried] = useState(false);

  const declared = Number(remittance.declared_amount || 0);
  const count = parseCashInput(countRaw);
  const variance = count.valid ? cashVariance(count.value, declared) : null;
  const notesNeeded = variance !== null && variance !== 0;
  const receiving = useMemo(
    () => accounts.filter(account => account.id !== remittance.drawer_id && account.id !== drawerAccountId),
    [accounts, remittance.drawer_id, drawerAccountId],
  );
  const destination = receiving.find(account => account.id === destinationId);
  const noteTotal = denominationTotal(denominations);

  const countError = !count.empty && !count.valid
    ? 'Sahi raqam likhein (0 ya zyada).'
    : count.valid && declared > 0 && count.value <= 0
      ? 'Gini hui raqam 0 se zyada honi chahiye.'
      : tried && count.empty ? 'Physical count likhein.' : undefined;
  const destinationError = tried && !destinationId ? 'Receiving account chunein.' : undefined;
  const notesError = tried && notesNeeded && notes.trim().length < 3 ? 'Farq ki wajah likhein — ye variance ke sath record hogi.' : undefined;
  const ready = count.valid && !(declared > 0 && count.value <= 0) && Boolean(destinationId) && (!notesNeeded || notes.trim().length >= 3);

  const handleCountChange = (value: string) => {
    setCountRaw(value);
    // A typed amount that no longer matches the note count would record a breakdown that is not the cash.
    if (noteTotal > 0 && parseCashInput(value).value !== noteTotal) setDenominations({});
  };

  const submit = async () => {
    setTried(true);
    if (!ready || locked) return;
    await onAccept(remittance, count.value, noteTotal > 0 ? denominations : {}, destinationId, notes.trim());
  };

  return (
    <Card className="overflow-hidden animate-fade-up">
      <div className="flex flex-wrap items-start gap-3 p-4 sm:items-center sm:p-5">
        <Avatar name={remittance.cashier_name} tone="brand" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-[15px] font-bold text-fg">{remittance.cashier_name}</h4>
            <Badge tone="warning" dot>Pending</Badge>
            {remittance.bag_reference && <Badge>Bag {remittance.bag_reference}</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-fg-subtle">{drawerName} · submitted {formatPkDateTime(remittance.declared_at)}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Declared</p>
          <p className="text-xl font-bold tracking-tight text-fg"><Money amount={declared} /></p>
        </div>
      </div>

      <div className="grid gap-4 border-t border-line p-4 sm:p-5 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Field label="Physical count (head)" required error={countError}>
            {control => (
              <CountInput
                id={control.id}
                value={countRaw}
                onChange={handleCountChange}
                onCount={() => setCountOpen(true)}
                denominationTotal={noteTotal}
                denominationPieces={denominationPieces(denominations)}
                placeholder={String(declared)}
                invalid={Boolean(control['aria-invalid'])}
                aria-describedby={control['aria-describedby']}
                disabled={busy}
              />
            )}
          </Field>
          <VarianceCallout variance={variance} against="declared" consequence="variance record ho kar review mein jayegi." />
        </div>
        <div className="flex flex-col gap-3">
          <Field label="Receiving account (Bank & Cash)" required error={destinationError}>
            {control => (
              <Select {...control} value={destinationId} onChange={event => setDestinationId(event.target.value)} disabled={busy}>
                <option value="">Account chunein…</option>
                {receiving.map(account => (
                  <option key={account.id} value={account.id}>{account.name} ({account.type}) · {formatCurrency(account.balance)}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={notesNeeded ? 'Farq ki wajah' : 'Receipt note (optional)'} required={notesNeeded} error={notesError}>
            {control => (
              <Textarea
                {...control}
                rows={2}
                className="min-h-0"
                value={notes}
                onChange={event => setNotes(event.target.value)}
                disabled={busy}
                placeholder={notesNeeded ? 'e.g. bag mein Rs 500 kam nikle, cashier ko bata diya' : 'e.g. Bag sealed tha, sab theek'}
              />
            )}
          </Field>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-line bg-surface-2/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <button
          type="button"
          aria-expanded={showDetails}
          onClick={() => setShowDetails(open => !open)}
          className="inline-flex w-fit cursor-pointer items-center gap-1 rounded-lg text-xs font-semibold text-fg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown className={cn('size-3.5 transition-transform', showDetails && 'rotate-180')} aria-hidden="true" />
          {showDetails ? 'Hide details' : 'Cashier ki details'}
        </button>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {count.valid && destination && (
            <p className="text-xs text-fg-subtle sm:text-right">
              <Money amount={count.value} className="font-semibold text-fg-muted" /> → {destination.name}
            </p>
          )}
          <Button leftIcon={<Check />} loading={busy} disabled={locked && !busy} onClick={submit} className="w-full sm:w-auto">
            Accept remittance
          </Button>
        </div>
      </div>

      {showDetails && (
        <div className="grid gap-x-6 gap-y-3 border-t border-line bg-surface-2/40 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-3">
          <Detail label="Drawer">{drawerName}</Detail>
          <Detail label="Business day">{remittance.business_day_id || '—'}</Detail>
          <Detail label="Submitted">{formatPkDateTime(remittance.declared_at)}</Detail>
          <Detail label="Shift"><span className="font-mono text-xs">{remittance.shift_id || '—'}</span></Detail>
          <Detail label="Remittance ID"><span className="font-mono text-xs">{remittance.id}</span></Detail>
          <Detail label="Bag reference">{remittance.bag_reference || '—'}</Detail>
          <Detail label="Declared denominations" className="sm:col-span-2 lg:col-span-3"><DenominationChips value={remittance.declared_denominations} /></Detail>
          {remittance.notes && <Detail label="Cashier note" className="sm:col-span-2 lg:col-span-3">{remittance.notes}</Detail>}
        </div>
      )}

      {countOpen && (
        <Suspense fallback={null}>
          <DenominationDialog
            open
            onClose={() => setCountOpen(false)}
            value={denominations}
            onChange={setDenominations}
            onApply={total => setCountRaw(String(total))}
            title="Head cash count"
            subtitle={`${remittance.cashier_name} ka bag — har note gin kar likhein`}
            expectedAmount={declared}
            expectedLabel="Declared"
          />
        </Suspense>
      )}
    </Card>
  );
});

interface HandoverRowProps {
  handover: CashHandover;
  drawerName: string;
  busy: boolean;
  locked: boolean;
  onSettle: (handover: CashHandover) => void;
}

const HandoverRow = memo(function HandoverRow({ handover, drawerName, busy, locked, onSettle }: HandoverRowProps) {
  const [open, setOpen] = useState(false);
  const disputed = handover.status === 'Disputed';
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
        <Avatar name={handover.from_user_name} tone="info" size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Money amount={handover.declared_amount} className="text-sm font-bold text-fg" />
            <Badge tone={disputed ? 'danger' : 'info'} dot>{handover.status}</Badge>
            {disputed && handover.variance !== undefined && handover.variance !== null && (
              <span className="text-xs font-semibold text-fg-subtle">Farq <Money amount={handover.variance} tone="signed" /></span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-fg-subtle">{handover.from_user_name} · {drawerName} · {formatPkDateTime(handover.declared_at)}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {disputed && (
            <Button size="sm" variant="soft" leftIcon={<ShieldCheck />} loading={busy} disabled={locked && !busy} onClick={() => onSettle(handover)}>
              Settle
            </Button>
          )}
          <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(value => !value)} rightIcon={<ChevronDown className={cn('transition-transform', open && 'rotate-180')} />}>
            {open ? 'Hide' : 'Details'}
          </Button>
        </div>
      </div>
      {open && (
        <div className="grid gap-x-6 gap-y-3 border-t border-line bg-surface-2/40 px-4 py-3 sm:grid-cols-2 sm:px-5">
          <Detail label="Business day">{handover.business_day_id || '—'}</Detail>
          <Detail label="From shift"><span className="font-mono text-xs">{handover.from_shift_id || 'Head float'}</span></Detail>
          <Detail label="Declared at">{formatPkDateTime(handover.declared_at)}</Detail>
          <Detail label="Handover ID"><span className="font-mono text-xs">{handover.id}</span></Detail>
          <Detail label="Declared notes" className="sm:col-span-2"><DenominationChips value={handover.declared_denominations} /></Detail>
        </div>
      )}
    </div>
  );
});

export default HeadInbox;
