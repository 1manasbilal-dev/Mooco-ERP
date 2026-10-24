import React, { Suspense, lazy, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Banknote, CheckCircle2, ChevronDown, ClipboardCheck, LockKeyhole, PackageSearch,
} from 'lucide-react';
import { Badge, Button, Field, LoadMoreRow, Modal, Money, SearchInput, Textarea } from '../ui';
import { useDairy } from '../../context/DairyContext';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import { cn } from '../../lib/cn';
import { cleanNumber, formatQty } from '../../lib/formatters';
import { formatBaseQty } from '../../lib/stockRules';
import { buildStockRows, countPiles, readPileCount, type CountPile } from '../milk-ops/inventoryStock';
import { CountTotals, PileCountRow, signedQty } from '../milk-ops/StockCountParts';
import { CheckItem, CountInput, MiniStat, VarianceCallout } from './CashBits';
import { cashVariance, formatBusinessDate, formatPkDateTime, parseCashInput, useLatest } from './cashFormat';
import { EMPTY_DAY_STATUS, buildCashClose, computeDayCash, expectedDayCash, indexDays, summarizeDay } from './dayData';
import { denominationPieces, denominationTotal, type DenominationCounts } from './denominations';
import { useShiftTotals, type RunAction } from './useCashData';
import type { CashTab } from './tabs';

const DenominationDialog = lazy(() => import('../DenominationDialog').then(module => ({ default: module.DenominationDialog })));

export type DayCloseStep = 'check' | 'cash' | 'stock' | 'lock';

const STEPS: Array<{ id: DayCloseStep; label: string; icon: React.ReactNode }> = [
  { id: 'check', label: 'Checklist', icon: <ClipboardCheck /> },
  { id: 'cash', label: 'Cash count', icon: <Banknote /> },
  { id: 'stock', label: 'Stock count', icon: <PackageSearch /> },
  { id: 'lock', label: 'Lock day', icon: <LockKeyhole /> },
];

interface DayCloseDialogProps {
  dayId: string;
  initialStep: DayCloseStep;
  onClose: () => void;
  run: RunAction;
  busyKey: string | null;
  onOpenTab: (tab: CashTab) => void;
}

/** One product in the stock count: every pile a count can reach, hidden packs and stray counts included. */
interface StockGroup {
  itemId: string;
  name: string;
  unit: string;
  costRate: number;
  totalBase: number;
  piles: CountPile[];
  search: string;
}

/** Count keys are `<item id>::<pile id>`; the loose pile goes to the server without a variant id. */
const countKey = (itemId: string, pileId: string) => `${itemId}::${pileId}`;

/** Day close as four steps. Cash and stock closings stay independent; Lock Day needs every blocker cleared. */
const DayCloseDialog: React.FC<DayCloseDialogProps> = ({ dayId, initialStep, onClose, run, busyKey, onOpenTab }) => {
  const {
    businessDays, shiftSessions, cashRemittances, cashHandovers, cashVariances, sales, shiftCashEvents, customerTransactions,
    dailySupplyEntries, expenses, purchases, materialPurchases, supplierTransactions, expenseVendorTransactions, items, inventory,
    currentUser, isDayLocked, closeDayCash, closeDayStock, closeBusinessDay,
  } = useDairy();
  const actions = useLatest({ closeDayCash, closeDayStock, closeBusinessDay });
  const { version, getTotals } = useShiftTotals();
  const day = businessDays.find(item => item.id === dayId);

  const status = useMemo(
    () => indexDays(shiftSessions, cashRemittances, cashHandovers, cashVariances).get(dayId) || EMPTY_DAY_STATUS,
    [shiftSessions, cashRemittances, cashHandovers, cashVariances, dayId],
  );
  const summary = useMemo(() => {
    void version;
    return day ? summarizeDay(day, status.shifts, getTotals) : null;
  }, [day, status, getTotals, version]);
  const dayCash = useMemo(() => (day ? computeDayCash(day, {
    sales, shiftCashEvents, customerTransactions, dailySupplyEntries, expenses, purchases,
    materialPurchases: materialPurchases || [], supplierTransactions: supplierTransactions || [], expenseVendorTransactions: expenseVendorTransactions || [],
    cashRemittances, shiftSessions,
  }) : null), [day, sales, shiftCashEvents, customerTransactions, dailySupplyEntries, expenses, purchases, materialPurchases, supplierTransactions, expenseVendorTransactions, cashRemittances, shiftSessions]);

  // Countable stock, read with the shared stock rules: loose, every ready-made pack (hidden ones too) and
  // stray counts left on multi-units or deleted packs, which a count must be able to clear to 0.
  // Inactive products are listed only while they still hold stock.
  const stockGroups = useMemo(() => buildStockRows(items, inventory)
    .filter(row => row.isActive || row.hasStock)
    .map((row): StockGroup => ({
      itemId: row.item.id,
      name: row.item.name,
      unit: row.reading.unit,
      costRate: Number(row.item.cost_price) || 0,
      totalBase: row.reading.totalBase,
      piles: countPiles(row.reading),
      search: row.search,
    })), [items, inventory]);

  const [step, setStep] = useState<DayCloseStep>(initialStep);
  const [openingRaw, setOpeningRaw] = useState(() => (dayCash ? String(dayCash.suggestedOpening) : '0'));
  const [countedRaw, setCountedRaw] = useState('');
  const [denominations, setDenominations] = useState<DenominationCounts>({});
  const [countOpen, setCountOpen] = useState(false);
  const [showOutItems, setShowOutItems] = useState(false);
  const [stockCounts, setStockCounts] = useState<Record<string, string>>({});
  const [stockQuery, setStockQuery] = useState('');
  const [notes, setNotes] = useState('');
  const [triedCash, setTriedCash] = useState(false);

  // Every typed count, what it would move per pile and in base units, and its value at cost.
  const stockCount = useMemo(() => {
    const entries: { itemId: string; variantId?: string; counted: number }[] = [];
    const changes: { key: string; group: StockGroup; pile: CountPile; counted: number; diff: number; baseDiff: number }[] = [];
    let errors = 0;
    let valueDiff = 0;
    for (const group of stockGroups) {
      for (const pile of group.piles) {
        const key = countKey(group.itemId, pile.id);
        const read = readPileCount(pile, stockCounts[key]);
        if (read.error) errors += 1;
        if (read.counted === null) continue;
        // Matching counts go to the server too, so the day records that the pile was checked.
        entries.push({ itemId: group.itemId, variantId: pile.id === 'loose' ? undefined : pile.id, counted: read.counted });
        if (read.diff === 0) continue;
        changes.push({ key, group, pile, counted: read.counted, diff: read.diff, baseDiff: read.baseDiff });
        valueDiff += read.baseDiff * group.costRate;
      }
    }
    return { entries, changes, errors, valueDiff: cleanNumber(valueDiff) };
  }, [stockGroups, stockCounts]);

  const filteredStock = useMemo(() => {
    const q = stockQuery.trim().toLowerCase();
    return q ? stockGroups.filter(group => group.search.includes(q)) : stockGroups;
  }, [stockGroups, stockQuery]);
  const stockList = useProgressiveList<StockGroup>(filteredStock, 30, stockQuery);

  if (!day || !dayCash || !summary) return null;

  const locked = Boolean(isDayLocked?.(day.business_date));
  const closed = day.status === 'Closed';
  const anyBusy = busyKey !== null;
  const opening = parseCashInput(openingRaw);
  const counted = parseCashInput(countedRaw);
  const expected = expectedDayCash(dayCash, opening.value);
  const variance = counted.valid ? cashVariance(counted.value, expected) : null;
  const noteTotal = denominationTotal(denominations);

  const stockEntries = stockCount.entries;
  const stockAdjustments = stockCount.changes.length;
  const stockInvalid = stockCount.errors > 0;

  const cashCloseBlocked = status.liveShifts > 0;
  const cashError = triedCash && counted.empty ? 'Cash close se pehle gini hui cash likhein.' : !counted.empty && !counted.valid ? 'Sahi raqam likhein (0 ya zyada).' : undefined;
  const openingError = !opening.valid ? 'Opening cash sahi likhein (0 ya zyada).' : undefined;

  const stepDone: Record<DayCloseStep, boolean> = {
    check: status.blockers === 0,
    cash: Boolean(day.cash_closed_at),
    stock: Boolean(day.stock_closed_at),
    lock: closed,
  };
  const stepIndex = STEPS.findIndex(item => item.id === step);
  const goTo = (offset: number) => setStep(STEPS[Math.max(0, Math.min(STEPS.length - 1, stepIndex + offset))].id);

  const handleCountedChange = (value: string) => {
    setCountedRaw(value);
    if (noteTotal > 0 && parseCashInput(value).value !== noteTotal) setDenominations({});
  };

  const cashSnapshot = (source: 'physical' | 'expected') => buildCashClose(
    dayCash,
    opening.value,
    source === 'physical' ? counted.value : expected,
    source === 'physical' ? (variance ?? 0) : 0,
    source,
    noteTotal > 0 ? denominations : {},
    currentUser?.name || '',
  );

  const closeCash = () => {
    setTriedCash(true);
    if (!counted.valid || !opening.valid || cashCloseBlocked) return;
    void run(`day-cash:${day.id}`, () => actions.current.closeDayCash(day.id, cashSnapshot('physical'), notes));
  };

  const closeStock = () => {
    if (stockInvalid) return;
    const entries = stockEntries;
    void run(`day-stock:${day.id}`, async () => {
      const ok = await actions.current.closeDayStock(day.id, entries);
      if (ok) setStockCounts({});
      return ok;
    });
  };

  const lockDay = () => {
    if (!opening.valid || (!counted.empty && !counted.valid)) return;
    // Same rule as before: a fresh count (or a day with no cash closing yet) writes the cash snapshot;
    // without a count the expected figure is recorded and marked as such.
    const cashClose = (!day.cash_closed_at || counted.valid) ? cashSnapshot(counted.valid ? 'physical' : 'expected') : undefined;
    void run(`day-lock:${day.id}`, async () => {
      const ok = await actions.current.closeBusinessDay(day.id, notes, cashClose);
      if (ok) onClose();
      return ok;
    });
  };

  const jump = (tab: CashTab) => { onClose(); onOpenTab(tab); };

  const notesField = (
    <Field label="Close notes (optional)">
      {control => <Textarea {...control} rows={2} className="min-h-0" value={notes} onChange={event => setNotes(event.target.value)} placeholder="e.g. din saaf khatam hua, koi farq nahi" />}
    </Field>
  );

  const footer = (
    <>
      {stepIndex > 0
        ? <Button variant="ghost" leftIcon={<ArrowLeft />} onClick={() => goTo(-1)} className="sm:mr-auto">Back</Button>
        : <Button variant="ghost" onClick={onClose} className="sm:mr-auto">Cancel</Button>}
      {step === 'cash' && (day.cash_closed_at
        ? <Badge tone="success" size="md" icon={<CheckCircle2 />} className="self-center">Cash closed</Badge>
        : (
          <Button
            leftIcon={<Banknote />}
            loading={busyKey === `day-cash:${day.id}`}
            disabled={(anyBusy && busyKey !== `day-cash:${day.id}`) || locked || cashCloseBlocked}
            onClick={closeCash}
          >
            Close cash
          </Button>
        ))}
      {step === 'stock' && (day.stock_closed_at
        ? <Badge tone="success" size="md" icon={<CheckCircle2 />} className="self-center">Stock closed</Badge>
        : (
          <Button
            leftIcon={<PackageSearch />}
            loading={busyKey === `day-stock:${day.id}`}
            disabled={(anyBusy && busyKey !== `day-stock:${day.id}`) || locked || stockInvalid}
            onClick={closeStock}
          >
            Apply & close stock
          </Button>
        ))}
      {step === 'lock' && (
        <Button
          leftIcon={<LockKeyhole />}
          loading={busyKey === `day-lock:${day.id}`}
          disabled={(anyBusy && busyKey !== `day-lock:${day.id}`) || locked || status.blockers > 0 || !opening.valid}
          onClick={lockDay}
        >
          Lock day
        </Button>
      )}
      {step !== 'lock' && (
        <Button variant={step === 'check' ? 'primary' : 'secondary'} rightIcon={<ArrowRight />} onClick={() => goTo(1)}>
          {STEPS[stepIndex + 1].label}
        </Button>
      )}
    </>
  );

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!anyBusy}
      size="lg"
      title={`Close business day · ${formatBusinessDate(day.business_date)}`}
      description="Lock hone ke baad is din ki entries band ho jati hain; Owner reopen kar sakta hai."
      icon={<span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-fg"><LockKeyhole size={20} /></span>}
      footer={footer}
    >
      <ol className="mb-4 grid grid-cols-4 gap-1.5" aria-label="Day close steps">
        {STEPS.map((item, index) => {
          const active = item.id === step;
          const done = stepDone[item.id];
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setStep(item.id)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-control px-1 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:px-2.5 sm:text-left',
                  active ? 'bg-brand-soft text-brand-fg' : 'text-fg-subtle hover:bg-surface-2 hover:text-fg',
                )}
              >
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold [&_svg]:size-3.5',
                    done ? 'bg-success text-white' : active ? 'bg-brand text-brand-on' : 'bg-surface-2 text-fg-subtle ring-1 ring-inset ring-line',
                  )}
                >
                  {done ? <CheckCircle2 /> : index + 1}
                </span>
                <span className="text-[11px] font-semibold leading-tight sm:text-xs">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {locked && (
        <p className="mb-4 flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2.5 text-[13px] font-semibold text-warning-fg ring-1 ring-inset ring-warning/25">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {closed ? 'Ye din lock ho chuka hai.' : 'Ye tareekh books lock mein hai.'} Nayi closing ya tabdeeli nahi ho sakti.
        </p>
      )}

      {step === 'check' && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 rounded-card bg-surface-2 p-4 ring-1 ring-inset ring-line/70 sm:grid-cols-2">
            <CheckItem ok={status.openShifts === 0} label="Saari shifts close" count={status.openShifts} hint="Live shift POS se close karein; Pending Review ka farq Audit Trail mein approve karein." />
            <CheckItem ok={status.pendingRemits === 0} label="Remittances receive" count={status.pendingRemits} hint="Head Inbox mein gin kar receive karein." />
            <CheckItem ok={status.disputedHandovers === 0} label="Disputed handovers settle" count={status.disputedHandovers} hint="Head Inbox → Drawer handovers." />
            <CheckItem ok={status.openVariances === 0} label="Variances resolve" count={status.openVariances} hint="Audit Trail mein approve ya reject karein." />
          </div>
          {status.blockers > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] text-fg-subtle">Ye kaam pehle mukammal karein:</p>
              {(status.pendingRemits > 0 || status.disputedHandovers > 0) && <Button size="sm" variant="secondary" onClick={() => jump('head')}>Head Inbox kholein</Button>}
              {(status.openVariances > 0 || status.openShifts > 0) && <Button size="sm" variant="secondary" onClick={() => jump('audit')}>Audit Trail kholein</Button>}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-[13px] font-semibold text-success-fg"><CheckCircle2 className="size-4" aria-hidden="true" /> Din close karne ke liye tayyar hai.</p>
          )}
          <p className="text-xs text-fg-subtle">Drawer mein chhori pending handovers lock par khud accept ho jati hain — cash raat bhar drawer mein rehta hai.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <MiniStat label="Shifts">{summary.shifts}</MiniStat>
            <MiniStat label="Gross sales"><Money amount={summary.gross} /></MiniStat>
            <MiniStat label="Cash sales"><Money amount={summary.cash} /></MiniStat>
            <MiniStat label="Online sales"><Money amount={summary.online} /></MiniStat>
            <MiniStat label="Credit sales"><Money amount={summary.credit} /></MiniStat>
            <MiniStat label="Shift over / short" tone={summary.variance < 0 ? 'danger' : summary.variance > 0 ? 'success' : undefined}>
              <Money amount={summary.variance} tone="signed" />
            </MiniStat>
          </div>
        </div>
      )}

      {step === 'cash' && (
        <div className="flex flex-col gap-4">
          {cashCloseBlocked && (
            <p className="flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2.5 text-[13px] font-semibold text-warning-fg ring-1 ring-inset ring-warning/25">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {status.liveShifts} shift abhi chal rahi hai — drawer istemal mein hai, is liye din ki cash abhi gini nahi ja sakti.
            </p>
          )}
          {day.cash_closed_at && (
            <p className="text-[13px] text-fg-subtle">Cash closing {formatPkDateTime(day.cash_closed_at)} ko record hui. Lock se pehle dobara gin kar snapshot update kar sakte hain.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="overflow-hidden rounded-card ring-1 ring-inset ring-line">
              <div className="flex items-center justify-between bg-success-soft/70 px-4 py-2.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-success-fg">Cash in</span>
                <Money amount={dayCash.cashIn.total} tone="signed" className="text-sm font-bold" />
              </div>
              <div className="divide-y divide-line">
                {dayCash.cashIn.lines.map(line => (
                  <div key={line.key} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                    <span className="min-w-0 truncate text-fg-muted">{line.label} <span className="text-fg-subtle">· {line.detail}</span></span>
                    <Money amount={line.amount} className="shrink-0 font-semibold text-fg" />
                  </div>
                ))}
              </div>
            </div>
            <div className="overflow-hidden rounded-card ring-1 ring-inset ring-line">
              <div className="flex items-center justify-between bg-danger-soft/70 px-4 py-2.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-danger-fg">Cash out</span>
                <Money amount={-dayCash.cashOut.total} tone="signed" className="text-sm font-bold" />
              </div>
              <div className="divide-y divide-line">
                {dayCash.cashOut.lines.map(line => (
                  <div key={line.key} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                    <span className="min-w-0 truncate text-fg-muted">{line.label} <span className="text-fg-subtle">· {line.detail}</span></span>
                    <Money amount={line.amount} className="shrink-0 font-semibold text-fg" />
                  </div>
                ))}
              </div>
              {dayCash.cashOut.items.length > 0 && (
                <div className="border-t border-line">
                  <button
                    type="button"
                    aria-expanded={showOutItems}
                    onClick={() => setShowOutItems(value => !value)}
                    className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-2 text-xs font-semibold text-fg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <ChevronDown className={cn('size-3.5 transition-transform', showOutItems && 'rotate-180')} aria-hidden="true" />
                    {dayCash.cashOut.items.length} entries {showOutItems ? 'chhupayein' : 'dekhein'}
                  </button>
                  {showOutItems && (
                    <div className="max-h-40 space-y-1 overflow-y-auto bg-surface-2/60 px-4 py-2">
                      {dayCash.cashOut.items.map(item => (
                        <p key={item.id} className="flex justify-between gap-3 text-xs text-fg-subtle">
                          <span className="truncate">{item.label}</span>
                          <Money amount={-item.amount} tone="signed" className="shrink-0 font-semibold" />
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-card ring-1 ring-inset ring-line">
            <div className="divide-y divide-line text-[13px]">
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <label htmlFor="day-close-opening" className="font-semibold text-fg-muted">Opening cash <span className="font-normal text-fg-subtle">· drawers ki pehli shift</span></label>
                <input
                  id="day-close-opening"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={openingRaw}
                  onChange={event => setOpeningRaw(event.target.value)}
                  aria-invalid={openingError ? true : undefined}
                  className={cn('ds-control h-8 w-32 rounded-lg border bg-surface px-2 text-right text-[13px] font-bold tabular-nums text-fg outline-none focus:border-brand-accent focus:ring-4 focus:ring-ring/20', openingError ? 'border-danger' : 'border-line')}
                />
              </div>
              {openingError && <p className="px-4 py-1.5 text-xs font-semibold text-danger-fg">{openingError}</p>}
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="text-fg-muted">+ Cash in</span>
                <Money amount={dayCash.cashIn.total} className="font-semibold text-fg" />
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="text-fg-muted">− Cash out</span>
                <Money amount={dayCash.cashOut.total} className="font-semibold text-fg" />
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="text-fg-muted">
                  − Remitted to head <span className="text-fg-subtle">· {dayCash.remitted.count}{dayCash.remitted.pending > 0 ? `, ${dayCash.remitted.pending} in transit` : ''}</span>
                </span>
                <Money amount={dayCash.remitted.total} className="font-semibold text-fg" />
              </div>
              {dayCash.recorded.count > 0 && (
                <div className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="text-fg-muted">± Shift farq (pehle se record) <span className="text-fg-subtle">· {dayCash.recorded.count}</span></span>
                  <Money amount={dayCash.recorded.total} tone="signed" className="font-semibold" />
                </div>
              )}
              <div className="flex items-center justify-between gap-3 bg-surface-2 px-4 py-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-fg-subtle">Expected cash</span>
                <Money amount={expected} className="text-lg font-bold text-fg" />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Field label="Actual counted cash — jo haath mein hai" required error={cashError}>
              {control => (
                <CountInput
                  id={control.id}
                  aria-describedby={control['aria-describedby']}
                  invalid={Boolean(control['aria-invalid'])}
                  value={countedRaw}
                  onChange={handleCountedChange}
                  onCount={() => setCountOpen(true)}
                  denominationTotal={noteTotal}
                  denominationPieces={denominationPieces(denominations)}
                  placeholder={String(expected)}
                  disabled={locked}
                />
              )}
            </Field>
            <VarianceCallout variance={variance} consequence="day closing ke record mein jayega." />
            {notesField}
          </div>
        </div>
      )}

      {step === 'stock' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={stockQuery} onChange={setStockQuery} placeholder="Item dhoondein…" className="min-w-[12rem] flex-1" />
            {stockEntries.length > 0 && <Badge tone="brand">{stockEntries.length} counted</Badge>}
            {stockAdjustments > 0 && <Badge tone="warning">{stockAdjustments} adjustment{stockAdjustments > 1 ? 's' : ''}</Badge>}
          </div>
          <div className="max-h-[45vh] overflow-y-auto rounded-card ring-1 ring-inset ring-line">
            {filteredStock.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-fg-subtle">Koi item nahi mila.</p>
            ) : (
              <ul className="divide-y divide-line">
                {stockList.visibleItems.map(group => {
                  const disabled = locked || Boolean(day.stock_closed_at);
                  const setCount = (pileId: string) => (value: string) => setStockCounts(prev => ({ ...prev, [countKey(group.itemId, pileId)]: value }));
                  if (group.piles.length === 1) {
                    const pile = { ...group.piles[0], name: group.name };
                    return (
                      <PileCountRow
                        key={group.itemId}
                        pile={pile}
                        baseUnit={group.unit}
                        idPrefix={`dayclose-${group.itemId}`}
                        value={stockCounts[countKey(group.itemId, pile.id)] || ''}
                        onChange={setCount(pile.id)}
                        showError
                        disabled={disabled}
                      />
                    );
                  }
                  return (
                    <li key={group.itemId}>
                      <p className="flex items-baseline justify-between gap-2 bg-surface-2/70 px-3 pb-1 pt-2 text-[13px] font-semibold text-fg">
                        <span className="truncate">{group.name}</span>
                        <span className="shrink-0 text-[11px] font-medium tabular-nums text-fg-subtle">Kul {formatBaseQty(group.totalBase, group.unit)}</span>
                      </p>
                      <ul className="divide-y divide-line/60 pl-2">
                        {group.piles.map(pile => (
                          <PileCountRow
                            key={pile.id}
                            pile={pile}
                            baseUnit={group.unit}
                            idPrefix={`dayclose-${group.itemId}`}
                            value={stockCounts[countKey(group.itemId, pile.id)] || ''}
                            onChange={setCount(pile.id)}
                            showError
                            disabled={disabled}
                          />
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
            <LoadMoreRow sentinelRef={stockList.sentinelRef} hiddenCount={stockList.hiddenCount} onShowMore={stockList.showMore} onShowAll={stockList.showAll} />
          </div>
          {stockInvalid && <p className="text-xs font-semibold text-danger-fg">Kuch ginti theek nahi: 0 ya zyada likhein, packs poore number mein, purani ginti sirf 0.</p>}
          {stockAdjustments > 0 && (
            <div className="space-y-2">
              <CountTotals changes={stockAdjustments} baseDiff={0} valueDiff={stockCount.valueDiff} />
              <ul className="max-h-32 space-y-0.5 overflow-y-auto text-[11px] tabular-nums text-fg-subtle" aria-label="Badalne wali ginti">
                {stockCount.changes.map(change => (
                  <li key={change.key} className="flex justify-between gap-3">
                    <span className="truncate">{change.group.name}{change.group.piles.length > 1 ? ` — ${change.pile.name}` : ''}: {formatQty(change.pile.system, 3)} → {formatQty(change.counted, 3)} {change.pile.unitLabel}</span>
                    <span className={cn('shrink-0 font-semibold', change.baseDiff > 0 ? 'text-success-fg' : change.baseDiff < 0 ? 'text-danger-fg' : 'text-fg-subtle')}>
                      {change.pile.kind === 'stray' ? 'clear' : `${signedQty(change.baseDiff)} ${change.group.unit}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-fg-subtle">Khali chhorna = koi adjustment nahi. Hidden packs aur purani ginti bhi yahan gini ja sakti hai. Farq wali har pile inventory log ke sath adjust hogi.</p>
        </div>
      )}

      {step === 'lock' && (
        <div className="flex flex-col gap-4">
          <div className="divide-y divide-line overflow-hidden rounded-card ring-1 ring-inset ring-line">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="text-[13px] font-semibold text-fg">Readiness</span>
              {status.blockers === 0
                ? <Badge tone="success" dot>Sab clear</Badge>
                : <Button size="sm" variant="secondary" onClick={() => setStep('check')}>{status.blockers} pending dekhein</Button>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="text-[13px] font-semibold text-fg">Cash</span>
              {counted.valid ? (
                <span className="text-[13px] text-fg-muted">Counted <Money amount={counted.value} className="font-semibold text-fg" />{variance !== 0 && variance !== null && <> · <Money amount={variance} tone="signed" className="font-semibold" /></>}</span>
              ) : day.cash_closed_at ? (
                <Badge tone="success" dot>Closed {formatPkDateTime(day.cash_closed_at)}</Badge>
              ) : (
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-warning-fg">
                  <AlertTriangle className="size-4" aria-hidden="true" /> Count nahi hui — expected <Money amount={expected} /> record hoga
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="text-[13px] font-semibold text-fg">Stock</span>
              {day.stock_closed_at ? (
                <Badge tone="success" dot>Closed {formatPkDateTime(day.stock_closed_at)}</Badge>
              ) : stockEntries.length > 0 ? (
                <Button size="sm" variant="secondary" onClick={() => setStep('stock')}>{stockEntries.length} counts apply nahi hue</Button>
              ) : (
                <span className="text-[13px] text-fg-subtle">Count nahi hua — lock par closing complete mark hogi</span>
              )}
            </div>
          </div>
          {notesField}
        </div>
      )}

      {countOpen && (
        <Suspense fallback={null}>
          <DenominationDialog
            open
            onClose={() => setCountOpen(false)}
            value={denominations}
            onChange={setDenominations}
            onApply={total => setCountedRaw(String(total))}
            title="Day close — cash count"
            subtitle={`${formatBusinessDate(day.business_date)} — drawer ka sara cash gin kar likhein`}
            expectedAmount={expected}
          />
        </Suspense>
      )}
    </Modal>
  );
};

export default DayCloseDialog;
