import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowRight, BookOpen, Calendar as CalendarIcon, CheckCircle2, History, Lock, Milk, RotateCcw, Save, Wallet,
} from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { useTabs } from '../../context/TabContext';
import { useToast } from '../../context/ToastContext';
import { MilkType } from '../../types';
import { cn } from '../../lib/cn';
import { roundCurrency, roundQuantity } from '../../lib/db';
import { formatQty, normalizeTransactionTimestamp } from '../../lib/formatters';
import { Badge, Button, Card, confirmAction, controlClass, Input, Kbd, Money, StatCard } from '../ui';
import { SmartNumberInput } from '../SmartNumberInput';
import { Avatar, PillGroup, PillOption, ProcurementHeader, SectionLabel, SettlementBar, ShiftIcon, varietyDot } from './ProcurementUI';
import { SupplierPicker } from './SupplierPicker';
import { AccountPicker, PaidInput, PayModeControl, usePaymentAccount } from './PaymentFields';
import { MilkEntriesTable } from './MilkEntriesTable';
import {
  balanceOf, countOf, dayOf, defaultShiftFor, formatRate, isActiveEntry, pkTime, prettyDate, settlementOf, shiftKey, shortDay,
  useBusinessClock, useConfiguredShifts, useHistoryParam,
} from './procurementData';
import type { ReturnRequest } from './ReturnPurchaseModal';

const ReturnPurchaseModal = lazy(() => import('./ReturnPurchaseModal'));
const PurchaseLogDrawer = lazy(() => import('./PurchaseLogDrawer'));

const MILK_TYPES: { value: MilkType; label: string }[] = [
  { value: MilkType.BUFFALO, label: 'Buffalo' },
  { value: MilkType.COW, label: 'Cow' },
  { value: MilkType.MIXED, label: 'Mixed' },
];

interface MilkForm {
  supplier_id: string;
  date: string;
  shift: string;
  milk_type: MilkType;
  quantity: string;
  rate: string;
}

interface SavedSlip {
  supplier: string;
  liters: number;
  rate: number;
  total: number;
  paid: number;
  shift: string;
}

const parseAmount = (text: string) => (text.trim() === '' ? NaN : Number(text));

/** Milk Collection: fast slip entry for many farmers per shift, with the day's sheet underneath. */
const MilkCollection: React.FC = () => {
  const { suppliers, purchases, allocations, addPurchase, items, settings, isDayLocked } = useDairy();
  const { showToast } = useToast();
  const { activeTabId, openTab } = useTabs();
  const isActive = activeTabId === 'purchase';
  const { today, hour } = useBusinessClock();
  const shifts = useConfiguredShifts(settings?.general?.shifts);
  const autoShift = defaultShiftFor(shifts, hour);

  const [form, setForm] = useState<MilkForm>(() => ({
    supplier_id: '', date: today, shift: autoShift, milk_type: MilkType.BUFFALO, quantity: '', rate: '',
  }));
  // The shift follows the clock until the user picks one.
  const [shiftPinned, setShiftPinned] = useState(false);
  const [rateSource, setRateSource] = useState<'default' | 'last' | null>(null);
  const [paidText, setPaidText] = useState('');
  const [payMode, setPayMode] = useState('Cash');
  const { availableAccounts, accountId, setAccountId, hasShiftDrawer } = usePaymentAccount(payMode);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const [triedSave, setTriedSave] = useState(false);
  const [lastSaved, setLastSaved] = useState<SavedSlip | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [returnRequest, setReturnRequest] = useState<ReturnRequest | null>(null);
  const [isLogOpen, setLogOpen] = useHistoryParam(isActive);
  // SmartNumberInput keeps its own input ref, so the fields are reached through their wrappers.
  const litersRef = useRef<HTMLDivElement>(null);
  const rateRef = useRef<HTMLDivElement>(null);

  // After midnight a form still on yesterday's date moves to the new day; a back-date stays.
  const prevTodayRef = useRef(today);
  useEffect(() => {
    const previous = prevTodayRef.current;
    if (previous === today) return;
    prevTodayRef.current = today;
    setForm(current => (current.date === previous ? { ...current, date: today } : current));
    setShiftPinned(false);
  }, [today]);

  useEffect(() => {
    setForm(current => {
      const valid = shifts.includes(current.shift);
      if (valid && (shiftPinned || current.shift === autoShift)) return current;
      return { ...current, shift: autoShift };
    });
  }, [autoShift, shiftPinned, shifts]);

  // Catalog switch per milk variety; an unknown variety counts as active (as before).
  const isVarietyActive = useMemo(() => {
    const cache = new Map<string, boolean>();
    return (variety: string) => {
      const v = String(variety).toLowerCase();
      if (cache.has(v)) return cache.get(v)!;
      const item = items.find((i: any) => {
        const name = String(i.name || '').toLowerCase();
        const id = String(i.id || '').toLowerCase();
        if (v === 'buffalo') return id === 'item_buffalo_milk' || name.includes('buffalo');
        if (v === 'cow') return id === 'item_cow_milk' || name.includes('cow');
        if (v === 'mixed') return id === 'item_mixed_milk' || name.includes('mixed');
        return name.includes(v) || id.includes(v);
      });
      const active = item ? item.isActive !== false : true;
      cache.set(v, active);
      return active;
    };
  }, [items]);

  const milkTypes = useMemo(() => MILK_TYPES.filter(option => isVarietyActive(option.value)), [isVarietyActive]);
  useEffect(() => {
    if (milkTypes.length > 0 && !milkTypes.some(option => option.value === form.milk_type)) {
      setForm(current => ({ ...current, milk_type: milkTypes[0].value }));
    }
  }, [milkTypes, form.milk_type]);

  const milkSuppliers = useMemo(() => suppliers.filter((s: any) => {
    if (s.isActive === false || s.is_active === false) return false;
    const types = (s.supplier_types || []).map((t: string) => String(t).toLowerCase());
    return types.length === 0 || types.some((t: string) => t.includes('milk'));
  }), [suppliers]);

  const suppliersById = useMemo(() => new Map<string, any>(suppliers.map((s: any) => [s.id, s])), [suppliers]);
  const selectedSupplier = form.supplier_id ? suppliersById.get(form.supplier_id) : undefined;
  const selectedBalance = balanceOf(selectedSupplier);

  const supplierRecent = useMemo(() => {
    if (!form.supplier_id) return [];
    return purchases
      .filter((p: any) => p.supplier_id === form.supplier_id && isActiveEntry(p))
      .sort((a: any, b: any) => Date.parse(b.date) - Date.parse(a.date))
      .slice(0, 4);
  }, [form.supplier_id, purchases]);

  // Everything recorded for the form's date, newest first. The stats, shift totals and the
  // duplicate check all read this one list, so typing never rescans every purchase.
  const dayEntries = useMemo(() => purchases
    .filter((entry: any) => entry.date && dayOf(entry) === form.date)
    .sort((a: any, b: any) => Date.parse(b.date) - Date.parse(a.date)), [purchases, form.date]);

  const daySummary = useMemo(() => {
    const byShift = shifts.map(name => ({ name, liters: 0, slips: 0, amount: 0 }));
    let liters = 0;
    let amount = 0;
    let due = 0;
    let slips = 0;
    let otherLiters = 0;
    const farmers = new Set<string>();
    const duplicates = new Map<string, any[]>();
    dayEntries.forEach((entry: any) => {
      if (!isActiveEntry(entry)) return;
      const qty = Number(entry.quantity) || 0;
      const money = settlementOf(entry);
      liters += qty;
      amount += money.amount;
      due += money.due;
      slips += 1;
      if (entry.supplier_id) farmers.add(entry.supplier_id);
      const row = byShift.find(item => shiftKey(item.name) === shiftKey(entry.shift));
      if (row) { row.liters += qty; row.slips += 1; row.amount += money.amount; }
      else otherLiters += qty;
      const key = `${entry.supplier_id}|${shiftKey(entry.shift)}|${shiftKey(entry.milk_type)}`;
      duplicates.set(key, [...(duplicates.get(key) || []), entry]);
    });
    return { byShift, liters, amount, due, slips, otherLiters, farmers: farmers.size, duplicates };
  }, [dayEntries, shifts]);

  const duplicates = form.supplier_id
    ? daySummary.duplicates.get(`${form.supplier_id}|${shiftKey(form.shift)}|${shiftKey(form.milk_type)}`) || []
    : [];

  // Amounts are rounded the way addPurchase stores them, so the screen shows the saved figure.
  const qty = parseAmount(form.quantity);
  const rate = parseAmount(form.rate);
  const qtyOk = Number.isFinite(qty) && qty > 0;
  const rateOk = Number.isFinite(rate) && rate > 0;
  const liters = qtyOk ? roundQuantity(qty) : 0;
  const unitRate = rateOk ? roundCurrency(rate) : 0;
  const total = roundCurrency(liters * unitRate);
  const paidRaw = parseAmount(paidText);
  const paid = Number.isFinite(paidRaw) ? roundCurrency(Math.max(0, paidRaw)) : 0;
  const overPaid = paid > total + 0.01;
  const due = Math.max(0, roundCurrency(total - paid));
  const projectedBalance = roundCurrency(selectedBalance + due);
  const isLocked = Boolean(isDayLocked && form.date && isDayLocked(form.date));
  const isBackDated = form.date !== today;
  const shiftTotal = daySummary.byShift.find(item => item.name === form.shift);

  const qtyError = triedSave && !qtyOk ? (Number.isFinite(qty) && qty <= 0 ? 'Liter 0 se zyada hone chahiye' : 'Liter likhein') : undefined;
  const rateError = triedSave && !rateOk ? (Number.isFinite(rate) && rate <= 0 ? 'Rate 0 se zyada hona chahiye' : 'Rate likhein') : undefined;
  const supplierError = triedSave && !form.supplier_id ? 'Farmer chunein' : undefined;

  const status = total <= 0 ? null : paid >= total ? { label: 'Fully paid', tone: 'success' as const } : paid > 0 ? { label: 'Partly paid', tone: 'warning' as const } : { label: 'On khata', tone: 'danger' as const };

  // The fields are always mounted, so focus moves at once (a frame callback never runs in a background tab).
  const focusField = (ref: React.RefObject<HTMLDivElement | null>) => {
    const input = ref.current?.querySelector('input');
    input?.focus();
    input?.select();
  };
  const focusLiters = () => focusField(litersRef);
  const focusRate = () => focusField(rateRef);
  const focusSupplier = () => setFocusToken(token => token + 1);

  // Farmer picked: load their usual milk type and rate (default rate, else the last slip's rate).
  // Done here rather than in an effect, so a background balance refresh never overwrites a typed rate.
  const pickSupplier = (supplierId: string) => {
    const supplier = suppliersById.get(supplierId);
    setForm(current => {
      const next = { ...current, supplier_id: supplierId };
      if (!supplier) return next;
      if (supplier.default_milk_type && isVarietyActive(supplier.default_milk_type)) next.milk_type = supplier.default_milk_type;
      const defaultRate = Number(supplier.default_rate) || 0;
      let lastRate = 0;
      if (defaultRate <= 0) {
        let lastAt = -Infinity;
        purchases.forEach((p: any) => {
          if (p.supplier_id !== supplierId || !isActiveEntry(p) || shiftKey(p.milk_type) !== shiftKey(next.milk_type)) return;
          const at = Date.parse(p.date);
          if (at > lastAt && Number(p.rate) > 0) { lastAt = at; lastRate = Number(p.rate); }
        });
      }
      const pickedRate = defaultRate > 0 ? defaultRate : lastRate;
      setRateSource(defaultRate > 0 ? 'default' : lastRate > 0 ? 'last' : null);
      if (pickedRate > 0) next.rate = String(pickedRate);
      return next;
    });
  };

  const resetForm = (keep: Partial<MilkForm> = {}) => {
    setForm(current => ({ ...current, supplier_id: '', quantity: '', rate: '', ...keep }));
    setPaidText('');
    setPayMode('Cash');
    setTriedSave(false);
    setRateSource(null);
  };

  const handleSave = async () => {
    if (savingRef.current || isSaving) return;
    setTriedSave(true);
    if (!form.supplier_id) { showToast('Please select a supplier / farmer', 'warning'); focusSupplier(); return; }
    if (milkTypes.length === 0 || !isVarietyActive(form.milk_type)) {
      showToast(`${form.milk_type} Milk variety is inactive in catalog! Reactivate it in Products & Catalog to record purchase.`, 'warning');
      return;
    }
    if (!qtyOk) { showToast('Please enter a valid volume (Liters) greater than 0', 'warning'); focusLiters(); return; }
    if (!rateOk) { showToast('Rate per liter 0 se zyada likhein', 'warning'); focusRate(); return; }
    if (isLocked) { showToast(`${form.date} band (locked) hai. Is din ki milk entry save nahi ho sakti.`, 'warning'); return; }
    if (overPaid) {
      showToast('Paid amount bill se zyada hai. Zyada raqam supplier ko alag Advance payment ke taur par dein.', 'warning');
      return;
    }
    if (paid > 0 && availableAccounts.length === 0) {
      showToast("Aapka koi Payment / Cash Drawer account mojood nahi hy! Pehle 'Bank & Cash' module men account banayein ya Paid Amount ko 0 rakh ker entry ko Khata per save karein.", 'warning');
      return;
    }

    savingRef.current = true;
    const supplierName = selectedSupplier?.name || 'Farmer';
    if (duplicates.length > 0) {
      const ok = await confirmAction({
        tone: 'warning',
        title: 'Yeh entry pehle se hai',
        message: `${supplierName} ki ${shortDay(form.date)} ${form.shift} (${form.milk_type}) slip pehle hi save hai.`,
        consequences: [
          ...duplicates.slice(0, 3).map((entry: any) => {
            const time = pkTime(entry.date);
            return `${formatQty(entry.quantity)} L @ Rs ${formatRate(entry.rate)} = Rs ${formatQty(entry.total_amount, 2)}${time ? ` · ${time}` : ''}`;
          }),
          'Dobara save karne se farmer ke khaate mein doosri slip judegi.',
        ],
        confirmLabel: 'Haan, nayi slip save karein',
        cancelLabel: 'Nahi, wapas',
      });
      if (!ok) { savingRef.current = false; return; }
    }

    setIsSaving(true);
    try {
      const success = await addPurchase({
        supplier_id: form.supplier_id,
        // Today -> the real moment; a back-dated entry -> noon of that Pakistan day.
        date: normalizeTransactionTimestamp(form.date),
        shift: form.shift,
        milk_type: form.milk_type,
        quantity: liters,
        rate: unitRate,
        fat: 0,
        snf: 0,
        paid_amount: paid,
        payment_mode: paid > 0 ? payMode : undefined,
        account_id: paid > 0 ? accountId : undefined,
      });
      if (success) {
        setLastSaved({ supplier: supplierName, liters, rate: unitRate, total, paid, shift: form.shift });
        // Keep date, shift and variety for the next farmer in the queue.
        resetForm();
        focusSupplier();
      }
    } catch (err: any) {
      showToast('Error saving intake: ' + (err?.message || 'Failed'), 'error');
    } finally {
      setIsSaving(false);
      window.setTimeout(() => { savingRef.current = false; }, 400);
    }
  };

  // Enter moves to the next empty field and saves once the slip is complete.
  const onLitersKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.defaultPrevented) return;
    event.preventDefault();
    if (rateOk && form.supplier_id) void handleSave();
    else if (!form.supplier_id) focusSupplier();
    else focusRate();
  };
  const onRateKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.defaultPrevented) return;
    event.preventDefault();
    if (!qtyOk) focusLiters();
    else void handleSave();
  };
  const onPaidKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.defaultPrevented) return;
    event.preventDefault();
    void handleSave();
  };

  // "/" jumps to the farmer search while this tab is on screen.
  useEffect(() => {
    if (!isActive) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (document.querySelector('[data-app-modal="true"]')) return;
      event.preventDefault();
      setFocusToken(token => token + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isActive]);

  const openReturn = useCallback((entry: any, correct = false) => {
    const alloc = allocations.find((a: any) => a.purchase_id === entry.id || a.id === `alloc_${entry.id}`);
    const available = Number(alloc ? (alloc.remaining_quantity ?? alloc.original_quantity) : entry.quantity) || 0;
    if (available <= 0) {
      showToast('Cannot return milk: Already allocated to production stock.', 'error');
      return;
    }
    const fullyFree = available >= (Number(entry.quantity) || 0) - 0.0005;
    if (correct && !fullyFree) {
      showToast(`Is slip ka ${formatQty((Number(entry.quantity) || 0) - available)} L production mein ja chuka hai. Sirf bacha hua ${formatQty(available)} L return ho sakta hai.`, 'warning');
    }
    setReturnRequest({
      entry,
      type: 'milk',
      maxQty: available,
      supplierName: suppliersById.get(entry.supplier_id)?.name || entry.supplier_name || 'Farmer',
      correct: correct && fullyFree,
    });
  }, [allocations, showToast, suppliersById]);

  // A slip returned as a data-entry error comes back into the form to be typed correctly.
  const onReturned = (entry: any, refill: boolean) => {
    if (!refill) return;
    const money = settlementOf(entry);
    setForm({
      supplier_id: entry.supplier_id,
      date: dayOf(entry) || today,
      shift: shifts.includes(entry.shift) ? entry.shift : form.shift,
      milk_type: entry.milk_type,
      quantity: String(entry.quantity ?? ''),
      rate: String(entry.rate ?? ''),
    });
    if (shifts.includes(entry.shift)) setShiftPinned(true);
    setRateSource(null);
    setPaidText(money.paid > 0 ? String(money.paid) : '');
    setPayMode(String(entry.payment_mode || entry.details?.payment_mode || 'Cash').toLowerCase().includes('cash') ? 'Cash' : 'Online');
    setLastSaved(null);
    focusLiters();
  };

  const varietyPills: PillOption<string>[] = milkTypes.map(option => ({ value: option.value, label: option.label, dot: varietyDot(option.value) }));
  const dayLabel = isBackDated ? shortDay(form.date) : 'Aaj';
  const shiftShare = daySummary.liters > 0 && shiftTotal ? Math.round((shiftTotal.liters / daySummary.liters) * 100) : 0;

  return (
    <div className="flex flex-col gap-4 pb-8 sm:gap-5">
      <ProcurementHeader
        active="purchase"
        title="Milk Collection"
        subtitle={<>Farmer chunein, liter aur rate likhein, <b className="font-semibold text-fg-muted">Enter</b> dabayein.</>}
        actions={
          <Button variant="secondary" leftIcon={<History />} onClick={() => setLogOpen(true)}>
            Poora log
          </Button>
        }
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={`Collection summary for ${prettyDate(form.date)}`}>
        <StatCard
          label={`Collected · ${dayLabel}`}
          value={`${formatQty(daySummary.liters)} L`}
          icon={<Milk />}
          tone="brand"
          hint={`${countOf(daySummary.slips, 'slip')} · ${countOf(daySummary.farmers, 'farmer')}`}
        />
        <StatCard
          label={`${form.shift} shift`}
          value={`${formatQty(shiftTotal?.liters || 0)} L`}
          icon={<ShiftIcon name={form.shift} className="text-current" />}
          tone="info"
          hint={daySummary.liters > 0 ? `${countOf(shiftTotal?.slips || 0, 'slip')} · ${shiftShare}% of day` : 'Abhi koi entry nahi'}
        />
        <StatCard
          label="Milk bill"
          value={<Money amount={daySummary.amount} compact />}
          icon={<Wallet />}
          hint={daySummary.liters > 0 ? `Avg Rs ${formatRate(daySummary.amount / daySummary.liters)}/L` : '—'}
        />
        <StatCard
          label="On khata"
          value={<Money amount={daySummary.due} compact />}
          icon={<BookOpen />}
          tone={daySummary.due > 0.5 ? 'danger' : 'neutral'}
          hint={<>Paid <Money amount={Math.max(0, daySummary.amount - daySummary.due)} /></>}
        />
      </section>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        <Card className="flex flex-col lg:col-span-8">
          <form
            noValidate
            onSubmit={event => { event.preventDefault(); void handleSave(); }}
            aria-label="Milk slip"
            className="flex flex-col"
          >
            {/* Date, shift and variety stay put between slips. */}
            <div className="flex flex-col gap-3 rounded-t-card border-b border-line bg-surface-2/60 p-3 sm:p-4 xl:flex-row xl:flex-wrap xl:items-center">
              <div className="flex items-center gap-2">
                <div className="w-[11.5rem] shrink-0">
                  <Input
                    type="date"
                    aria-label="Collection date"
                    leftIcon={<CalendarIcon />}
                    value={form.date}
                    max={today}
                    onChange={event => setForm(current => ({ ...current, date: event.target.value || today }))}
                    className={cn('font-semibold', isBackDated && 'border-warning/60')}
                  />
                </div>
                {isBackDated ? (
                  <button type="button" onClick={() => setForm(current => ({ ...current, date: today }))} className="cursor-pointer" title="Aaj ki date par wapas">
                    <Badge tone="warning" dot>Back-date</Badge>
                  </button>
                ) : (
                  <Badge tone="brand" dot>Aaj</Badge>
                )}
              </div>
              <ShiftPicker
                shifts={daySummary.byShift}
                value={form.shift}
                onChange={value => { setShiftPinned(true); setForm(current => ({ ...current, shift: value })); }}
              />
              {/* A picked shift never changes by itself mid-entry; this nudges when the clock has moved on. */}
              {shiftPinned && !isBackDated && form.shift !== autoShift && (
                <button
                  type="button"
                  onClick={() => { setShiftPinned(false); setForm(current => ({ ...current, shift: autoShift })); }}
                  className="cursor-pointer self-start xl:self-auto"
                >
                  <Badge tone="info" icon={<ShiftIcon name={autoShift} size={12} className="text-current" />}>Ab {autoShift} ka waqt hai — badlein</Badge>
                </button>
              )}
              {varietyPills.length > 0 ? (
                <PillGroup
                  label="Milk variety"
                  options={varietyPills}
                  value={String(form.milk_type)}
                  onChange={value => setForm(current => ({ ...current, milk_type: value as MilkType }))}
                  className="xl:ml-auto"
                />
              ) : (
                <Badge tone="warning" className="h-auto whitespace-normal py-1 xl:ml-auto">Catalog mein sab milk varieties inactive hain.</Badge>
              )}
            </div>

            <div className="flex flex-col gap-5 p-4 sm:p-5">
              {isLocked && (
                <div className="flex items-center gap-2.5 rounded-control bg-warning-soft p-3 text-xs font-semibold text-warning-fg ring-1 ring-inset ring-warning/25" role="alert">
                  <Lock size={15} className="shrink-0" aria-hidden="true" />
                  <span><strong>{prettyDate(form.date)} band (locked) hai.</strong> Is din ki milk entry save nahi ho sakti.</span>
                </div>
              )}

              <section>
                <SectionLabel
                  step={1}
                  htmlFor="milk-supplier"
                  aside={selectedSupplier && selectedBalance !== 0 && (
                    <Badge tone={selectedBalance > 0 ? 'danger' : 'success'}>
                      <Money amount={Math.abs(selectedBalance)} /> {selectedBalance > 0 ? 'Due' : 'Advance'}
                    </Badge>
                  )}
                >
                  Farmer / Gwala
                </SectionLabel>
                <SupplierPicker
                  id="milk-supplier"
                  value={form.supplier_id}
                  onChange={pickSupplier}
                  onPicked={focusLiters}
                  suppliers={milkSuppliers}
                  placeholder="Naam, gaon ya phone se dhoondein…  ( / )"
                  focusToken={focusToken}
                  aria-invalid={supplierError ? true : undefined}
                />
                {supplierError && <p className="mt-1.5 text-xs font-semibold text-danger-fg">{supplierError}</p>}
                {duplicates.length > 0 && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-control bg-warning-soft px-2.5 py-2 text-xs font-semibold text-warning-fg ring-1 ring-inset ring-warning/25" role="status">
                    <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" />
                    <span>
                      Is farmer ki {form.shift} ({form.milk_type}) slip {dayLabel === 'Aaj' ? 'aaj' : dayLabel} pehle se hai:{' '}
                      {duplicates.slice(0, 2).map((entry: any) => `${formatQty(entry.quantity)} L @ Rs ${formatRate(entry.rate)}${pkTime(entry.date) ? ` (${pkTime(entry.date)})` : ''}`).join(', ')}
                    </span>
                  </p>
                )}
                {supplierRecent[0] && (
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-fg-subtle lg:hidden">
                    <History size={11} aria-hidden="true" />
                    Pichli: <b className="tabular-nums text-fg-muted">{formatQty(supplierRecent[0].quantity)} L @ Rs {formatRate(supplierRecent[0].rate)}</b>
                    · {shortDay(dayOf(supplierRecent[0]))} {supplierRecent[0].shift}
                  </p>
                )}
              </section>

              <section>
                <SectionLabel step={2}>Quantity &amp; rate</SectionLabel>
                <div className="grid grid-cols-2 gap-3">
                  <BigNumberField
                    inputRef={litersRef}
                    label="Liters"
                    suffix="L"
                    value={form.quantity}
                    onChange={value => setForm(current => ({ ...current, quantity: value }))}
                    onKeyDown={onLitersKey}
                    error={qtyError}
                  />
                  <BigNumberField
                    inputRef={rateRef}
                    label="Rate / liter"
                    prefix="Rs"
                    value={form.rate}
                    onChange={value => { setRateSource(null); setForm(current => ({ ...current, rate: value })); }}
                    onKeyDown={onRateKey}
                    error={rateError}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                  <span className="text-fg-subtle">
                    {rateSource === 'default' && 'Farmer ka default rate laga hai.'}
                    {rateSource === 'last' && 'Pichli slip ka rate laga hai.'}
                    {!rateSource && Number(selectedSupplier?.default_rate) > 0 && Number(form.rate) !== Number(selectedSupplier.default_rate) && (
                      <button
                        type="button"
                        onClick={() => { setRateSource('default'); setForm(current => ({ ...current, rate: String(selectedSupplier.default_rate) })); }}
                        className="cursor-pointer font-semibold text-brand-fg hover:underline"
                      >
                        Farmer ka default rate Rs {formatRate(selectedSupplier.default_rate)} lagayein
                      </button>
                    )}
                  </span>
                  {qtyOk && rateOk && (
                    <span className="font-semibold tabular-nums text-fg-muted">
                      {formatQty(liters, 3)} L × Rs {formatRate(unitRate)} = <Money amount={total} className="font-bold text-fg" />
                    </span>
                  )}
                </div>
              </section>

              <section>
                <SectionLabel step={3} htmlFor="milk-paid" aside={status && <Badge tone={status.tone} dot>{status.label}</Badge>}>
                  Payment <span className="font-normal text-fg-subtle">(khali = khata)</span>
                </SectionLabel>
                <div className="flex flex-col gap-3 rounded-control bg-surface-2/60 p-3 ring-1 ring-inset ring-line sm:p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <PaidInput
                        id="milk-paid"
                        value={paidText}
                        onChange={setPaidText}
                        total={total}
                        paid={paid}
                        onKeyDown={onPaidKey}
                        invalid={overPaid}
                        describedBy={overPaid ? 'milk-paid-error' : undefined}
                      />
                      {overPaid && <p id="milk-paid-error" className="mt-1.5 text-xs font-semibold text-danger-fg">Paid bill (<Money amount={total} />) se zyada hai.</p>}
                    </div>
                    <PayModeControl value={payMode} onChange={setPayMode} disabled={paid <= 0} />
                  </div>
                  {paid > 0 && (
                    <AccountPicker accounts={availableAccounts} value={accountId} onChange={setAccountId} mode={payMode} hasShiftDrawer={hasShiftDrawer} />
                  )}
                  <SettlementBar total={total} paid={paid} />
                </div>
              </section>
            </div>

            <div className="flex flex-col gap-3 rounded-b-card border-t border-line bg-surface-2/60 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="min-w-0" aria-live="polite">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Total payable</span>
                <Money amount={total} className="text-2xl font-bold tracking-tight text-fg" />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="lg" leftIcon={<RotateCcw />} onClick={() => resetForm()}>
                  Clear
                </Button>
                <Button
                  type="submit"
                  size="lg"
                  loading={isSaving}
                  disabled={isLocked || milkTypes.length === 0}
                  leftIcon={<Save />}
                  className="flex-1 sm:flex-initial"
                  title={isLocked ? `Selected date (${form.date}) is closed & locked` : 'Enter se bhi save hota hai'}
                >
                  {isSaving ? 'Saving…' : 'Save slip'}
                  {!isSaving && <Kbd className="hidden bg-brand-on/15 text-brand-on ring-brand-on/20 sm:inline-flex">Enter</Kbd>}
                </Button>
              </div>
            </div>
          </form>
          {lastSaved && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-4 py-2.5 text-xs text-fg-muted animate-fade-up sm:px-5" role="status">
              <CheckCircle2 size={15} className="shrink-0 text-success" aria-hidden="true" />
              <span className="font-semibold text-fg">Saved:</span>
              <span className="min-w-0 truncate">
                {lastSaved.supplier} · {formatQty(lastSaved.liters)} L @ Rs {formatRate(lastSaved.rate)} · {lastSaved.shift}
              </span>
              <Money amount={lastSaved.total} className="font-bold text-fg" />
              <Badge tone={lastSaved.paid >= lastSaved.total ? 'success' : lastSaved.paid > 0 ? 'warning' : 'danger'}>
                {lastSaved.paid >= lastSaved.total ? 'Paid' : lastSaved.paid > 0 ? 'Partial' : 'Khata'}
              </Badge>
            </div>
          )}
        </Card>

        <aside className="flex flex-col gap-4 lg:col-span-4" aria-label="Farmer and shift summary">
          {selectedSupplier && (
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <Avatar name={selectedSupplier.name} owed={selectedBalance > 0} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-fg">{selectedSupplier.name}</p>
                  <p className="truncate text-xs text-fg-subtle">
                    {[selectedSupplier.village || selectedSupplier.city, selectedSupplier.phone].filter(Boolean).join(' · ') || 'No contact saved'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  rightIcon={<ArrowRight />}
                  onClick={() => {
                    openTab({ id: 'suppliers', path: `/suppliers?id=${encodeURIComponent(selectedSupplier.id)}` });
                    window.dispatchEvent(new CustomEvent('mooco-select-supplier', { detail: { supplierId: selectedSupplier.id } }));
                  }}
                >
                  Khata
                </Button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <BalanceBox label="Balance now" amount={selectedBalance} />
                <BalanceBox label="After slip" amount={projectedBalance} highlight={due > 0} />
              </div>
              <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Recent deliveries</p>
              {supplierRecent.length === 0 ? (
                <p className="rounded-control border border-dashed border-line py-3 text-center text-xs text-fg-subtle">Pehli delivery</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {supplierRecent.map((entry: any) => (
                    <li key={entry.id} className="flex items-center justify-between gap-2 rounded-control px-2.5 py-2 text-xs ring-1 ring-inset ring-line/70">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={cn('size-2 shrink-0 rounded-full', varietyDot(entry.milk_type))} aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block font-semibold tabular-nums text-fg">{formatQty(entry.quantity)} L <span className="font-normal text-fg-subtle">@ Rs {formatRate(entry.rate)}</span></span>
                          <span className="block text-[11px] text-fg-subtle">{shortDay(dayOf(entry))} · {entry.shift}</span>
                        </span>
                      </span>
                      <Money amount={entry.total_amount} className="font-bold text-fg" />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card className="p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-[15px] font-bold text-fg">
                <span className="size-2 rounded-full bg-brand-accent" aria-hidden="true" />
                {isBackDated ? prettyDate(form.date) : 'Aaj ki collection'}
              </h3>
              <span className="text-xs font-bold tabular-nums text-fg-muted">{formatQty(daySummary.liters)} L</span>
            </div>
            <ShiftBars rows={daySummary.byShift} active={form.shift} otherLiters={daySummary.otherLiters} />
          </Card>
        </aside>
      </div>

      <MilkEntriesTable
        entries={dayEntries}
        shifts={shifts}
        suppliersById={suppliersById}
        dayLabel={isBackDated ? prettyDate(form.date) : 'Aaj'}
        onReturn={openReturn}
        onOpenLog={() => setLogOpen(true)}
      />

      <Suspense fallback={null}>
        {returnRequest && (
          <ReturnPurchaseModal
            key={`${returnRequest.entry.id}-${returnRequest.correct ? 'fix' : 'ret'}`}
            request={returnRequest}
            onClose={() => setReturnRequest(null)}
            onReturned={onReturned}
          />
        )}
        {isLogOpen && (
          <PurchaseLogDrawer
            mode="milk"
            entries={purchases}
            suppliersById={suppliersById}
            today={today}
            onClose={() => setLogOpen(false)}
            onReturn={entry => openReturn(entry)}
          />
        )}
      </Suspense>
    </div>
  );
};

/** Big tabular input for litres and rate; Enter handling comes from the parent. */
function BigNumberField({
  inputRef, label, value, onChange, onKeyDown, prefix, suffix, error,
}: {
  inputRef: React.RefObject<HTMLDivElement | null>;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  prefix?: string;
  suffix?: string;
  error?: string;
}) {
  const id = `milk-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <div ref={inputRef}>
      <div className="relative">
        <label htmlFor={id} className="pointer-events-none absolute left-3.5 top-2 z-10 text-[10px] font-bold uppercase tracking-wider text-fg-subtle">{label}</label>
        {prefix && <span className="pointer-events-none absolute bottom-[0.9rem] left-3.5 z-10 text-sm font-bold text-fg-subtle">{prefix}</span>}
        <SmartNumberInput
          id={id}
          inputMode="decimal"
          enterKeyHint="next"
          autoComplete="off"
          placeholder="0"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(controlClass, 'h-16 pb-1.5 pt-5 text-2xl font-bold tracking-tight tabular-nums', prefix ? 'pl-10 pr-3.5' : 'pl-3.5 pr-9')}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
        />
        {suffix && <span className="pointer-events-none absolute right-3.5 top-1/2 z-10 -translate-y-1/2 text-sm font-bold text-fg-subtle">{suffix}</span>}
      </div>
      {error && <p id={`${id}-error`} className="mt-1.5 text-xs font-semibold text-danger-fg">{error}</p>}
    </div>
  );
}

/** Shift choice with each shift's litres for the day; arrow keys move between shifts. */
function ShiftPicker({ shifts, value, onChange }: { shifts: { name: string; liters: number; slips: number }[]; value: string; onChange: (value: string) => void }) {
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step || shifts.length === 0) return;
    event.preventDefault();
    const index = shifts.findIndex(item => item.name === value);
    const next = shifts[(index + step + shifts.length) % shifts.length];
    onChange(next.name);
    (event.currentTarget.querySelector(`[data-shift="${CSS.escape(next.name)}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Shift" onKeyDown={onKeyDown} className="grid auto-cols-fr grid-flow-col gap-1 rounded-control bg-surface-2 p-1 ring-1 ring-inset ring-line/70 xl:flex">
      {shifts.map(item => {
        const selected = item.name === value;
        return (
          <button
            key={item.name}
            type="button"
            role="radio"
            aria-checked={selected}
            data-shift={item.name}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.name)}
            className={cn(
              'flex h-10 min-w-0 cursor-pointer items-center justify-center gap-2 rounded-[calc(var(--radius-control)-4px)] px-3 text-[13px] font-semibold transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'bg-surface text-fg shadow-e1' : 'text-fg-subtle hover:text-fg',
            )}
          >
            <ShiftIcon name={item.name} size={15} />
            <span className="truncate">{item.name}</span>
            <span className={cn('rounded-full px-1.5 text-[10px] font-bold tabular-nums leading-4', selected ? 'bg-brand-soft text-brand-fg' : 'bg-surface-3 text-fg-subtle')}>
              {formatQty(item.liters, 1)} L
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ShiftBars({ rows, active, otherLiters }: { rows: { name: string; liters: number; slips: number; amount: number }[]; active: string; otherLiters: number }) {
  const max = Math.max(1, ...rows.map(row => row.liters), otherLiters);
  return (
    <div className="mt-3 flex flex-col gap-2.5">
      {rows.map(row => (
        <div key={row.name} className="text-xs">
          <div className="flex items-center gap-2.5">
            <span className="flex w-24 shrink-0 items-center gap-1.5 truncate font-semibold text-fg-muted"><ShiftIcon name={row.name} size={13} />{row.name}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
              <span
                className={cn('block h-full rounded-full transition-[width] duration-500 ease-out-expo', row.name === active ? 'bg-brand-accent' : 'bg-fg-faint/60')}
                style={{ width: `${(row.liters / max) * 100}%` }}
              />
            </span>
            <span className="w-16 shrink-0 text-right font-bold tabular-nums text-fg">{formatQty(row.liters)} L</span>
          </div>
          <p className="ml-[6.6rem] mt-0.5 text-[11px] text-fg-subtle tabular-nums">{countOf(row.slips, 'slip')} · <Money amount={row.amount} /></p>
        </div>
      ))}
      {otherLiters > 0 && (
        <p className="text-[11px] text-fg-subtle">Purane shift naam: <b className="tabular-nums text-fg-muted">{formatQty(otherLiters)} L</b></p>
      )}
    </div>
  );
}

function BalanceBox({ label, amount, highlight }: { label: string; amount: number; highlight?: boolean }) {
  return (
    <div className={cn('rounded-control p-2.5', highlight ? 'bg-danger-soft' : 'bg-surface-2')}>
      <span className="block text-[11px] font-semibold text-fg-subtle">{label}</span>
      <Money amount={Math.abs(amount)} tone="plain" className={cn('text-sm font-bold', amount > 0 ? 'text-danger-fg' : amount < 0 ? 'text-success-fg' : 'text-fg')} />
      <span className="ml-1 text-[10px] font-semibold text-fg-subtle">{amount > 0 ? 'due' : amount < 0 ? 'adv' : ''}</span>
    </div>
  );
}

export default MilkCollection;
