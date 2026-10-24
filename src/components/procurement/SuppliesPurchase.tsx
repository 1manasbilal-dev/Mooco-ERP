import React, { lazy, memo, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Banknote, BookOpen, Boxes, Calendar as CalendarIcon, History, Lock, Minus, Package, Plus, Receipt, RotateCcw,
  Save, Search, ShoppingCart, Sparkles, Trash2, User, Wallet, X,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useDairy } from '../../context/DairyContext';
import { useTabs } from '../../context/TabContext';
import { useToast } from '../../context/ToastContext';
import { BREAKPOINTS, useMediaQuery } from '../../hooks/useMediaQuery';
import { PurchaseType } from '../../types';
import { cn } from '../../lib/cn';
import { roundCurrency } from '../../lib/db';
import { cleanQty, formatCurrency, formatQty, normalizeTransactionTimestamp } from '../../lib/formatters';
import { formatBaseQty, pileBreakdown, readStock, STOCK_STATUS_LABEL, type StockReading, type StockStatus } from '../../lib/stockRules';
import { convertQuantity } from '../../lib/unitConversion';
import {
  Badge, Button, Card, confirmAction, controlClass, EmptyState, IconButton, Input, Money, StatCard, TBody, TD, TH, THead, TR, Table,
} from '../ui';
import type { Tone } from '../ui';
import { Avatar, ProcurementHeader, SectionLabel, SettlementBar } from './ProcurementUI';
import { SupplierPicker } from './SupplierPicker';
import { AccountPicker, PaidInput, PayModeControl, usePaymentAccount } from './PaymentFields';
import { balanceOf, dayOf, isActiveEntry, prettyDate, useBusinessClock, useHistoryParam } from './procurementData';
import {
  billLineProblem, conversionText, costChangeText, defaultPurchaseUnit, findLineUnit, landingPreview, landingText, pileOnHandInUnit, pileStockOf,
  purchaseLinePile, purchaseUnitsFor, rateForUnit, rateFromTotal, returnableQty, returnedQty, UNIT_KIND_LABEL,
  type Landing, type LandingLine, type PurchaseUnit, type PurchaseUnitKind,
} from './purchaseStock';
import { DraftNumberInput } from './DraftNumberInput';
import type { ReturnRequest } from './ReturnPurchaseModal';

const ReturnPurchaseModal = lazy(() => import('./ReturnPurchaseModal'));
const PurchaseLogDrawer = lazy(() => import('./PurchaseLogDrawer'));
const EditBillLineModal = lazy(() => import('./EditBillLineModal'));

// Cast works around Framer Motion's prop typings.
const MotionDiv = motion.div as any;

export interface BillLine {
  tempId: number;
  item_id: string;
  item_name: string;
  /** Unit name as saved: the base unit, a pack or multi-unit name, or a weight/volume symbol. */
  unit: string;
  /** Which purchase unit this is (`purchaseUnitsFor` key), so the line never mixes up two units. */
  unitKey: string;
  base_unit: string;
  /** Base units in one bought unit. */
  conversion_factor: number;
  quantity: number;
  rate: number;
  total: number;
}

export type { PurchaseUnit } from './purchaseStock';

export interface ItemLanding {
  itemId: string;
  name: string;
  unit: string;
  landing: Landing;
}

const UNIT_KINDS: PurchaseUnitKind[] = ['base', 'pack', 'multi', 'convert'];
const STATUS_TONE: Record<StockStatus, Tone> = { minus: 'danger', out: 'danger', low: 'warning', ok: 'neutral' };

/** Supplies & Materials: a multi-line, multi-unit purchase bill paid now or on credit to the vendor's ledger. */
const SuppliesPurchase: React.FC = () => {
  const {
    suppliers, materialPurchases, inventory = [], items, addBulkMaterialPurchase, isDayLocked, settings,
  } = useDairy();
  const { showToast } = useToast();
  const { activeTabId } = useTabs();
  const isActive = activeTabId === 'purchase-supplies';
  const { today } = useBusinessClock();
  // Phones get the swipeable list, wider screens the editable table; only one is rendered.
  const isWide = useMediaQuery(BREAKPOINTS.md);

  const [vendorId, setVendorId] = useState('');
  const [billDate, setBillDate] = useState(today);
  const [lines, setLines] = useState<BillLine[]>([]);
  const [paidText, setPaidText] = useState('');
  const [payMode, setPayMode] = useState('Cash');
  const { availableAccounts, accountId, setAccountId, hasShiftDrawer } = usePaymentAccount(payMode);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const [editingLine, setEditingLine] = useState<BillLine | null>(null);
  const [returnRequest, setReturnRequest] = useState<ReturnRequest | null>(null);
  const [isLogOpen, setLogOpen] = useHistoryParam(isActive);
  const nextLineId = useRef(1);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const billRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef<number | null>(null);

  // A bill left on yesterday's date moves to the new day after midnight; a back-date stays.
  const prevTodayRef = useRef(today);
  useEffect(() => {
    const previous = prevTodayRef.current;
    if (previous === today) return;
    prevTodayRef.current = today;
    setBillDate(current => (current === previous ? today : current));
  }, [today]);

  const isLocked = Boolean(isDayLocked && billDate && isDayLocked(billDate));
  const itemsById = useMemo(() => new Map<string, any>(items.map((item: any) => [item.id, item])), [items]);
  const inventoryById = useMemo(() => new Map<string, any>(inventory.map((row: any) => [row.item_id, row])), [inventory]);
  const suppliersById = useMemo(() => new Map<string, any>(suppliers.map((s: any) => [s.id, s])), [suppliers]);
  const customUnits = settings?.inventory?.customUnits;

  const stockOf = useCallback((itemId: string) => pileStockOf(itemsById.get(itemId), inventoryById.get(itemId)), [itemsById, inventoryById]);

  // Units are worked out once per product per catalog change, not on every render of every row.
  const unitsFor = useMemo(() => {
    const cache = new Map<string, PurchaseUnit[]>();
    return (itemId: string): PurchaseUnit[] => {
      let units = cache.get(itemId);
      if (!units) {
        units = purchaseUnitsFor(itemsById.get(itemId), customUnits || []);
        cache.set(itemId, units);
      }
      return units;
    };
  }, [itemsById, customUnits]);

  const vendorSuppliers = useMemo(() => suppliers.filter((s: any) => {
    if (s.isActive === false || s.is_active === false) return false;
    const types = (s.supplier_types || []).map((t: string) => String(t).toLowerCase());
    return types.length === 0 || types.some((t: string) => t.includes('raw') || t.includes('material') || t.includes('finish') || t.includes('product'));
  }), [suppliers]);

  const todayStats = useMemo(() => {
    const rows = materialPurchases.filter((entry: any) => entry.date && isActiveEntry(entry) && dayOf(entry) === today);
    // One saved bill writes one row per line, all with the same supplier and timestamp.
    const bills = new Set(rows.map((entry: any) => `${entry.supplier_id || 'cash'}|${entry.date}`));
    const amount = rows.reduce((sum: number, entry: any) => sum + (Number(entry.total_amount) || 0), 0);
    const paid = rows.reduce((sum: number, entry: any) => sum + (Number(entry.paid_amount ?? entry.details?.paid_amount) || 0), 0);
    return { bills: bills.size, lines: rows.length, amount, paid };
  }, [materialPurchases, today]);

  // Milk is bought on the Milk Collection screen. Only milk measured by volume is left out here, so
  // milk powder (kg) and milk pouches/bottles (packaging, pcs) can still be bought.
  const purchasableItems = useMemo(() => items.filter((i: any) => {
    if (i.isActive === false || (i.source !== 'Supplier' && i.source !== 'Both')) return false;
    const types: string[] = i.item_type || [];
    if (!types.some(t => t === 'Raw material' || t === 'Packaging material' || t === 'Sale product')) return false;
    if ((i.category || []).some((c: string) => String(c).toLowerCase().includes('milk'))) return false;
    const isLiquidMilk = String(i.name || '').toLowerCase().includes('milk') && convertQuantity(1, String(i.unit || ''), 'L', customUnits || []) !== null;
    return !isLiquidMilk;
  }), [items, customUnits]);

  const readingById = useMemo(() => {
    const map = new Map<string, StockReading>();
    purchasableItems.forEach((item: any) => {
      const stock = stockOf(item.id);
      map.set(item.id, readStock(item, stock.loose, stock.packs));
    });
    return map;
  }, [purchasableItems, stockOf]);

  // How often and in what unit/rate each product was last bought, in one pass over the history.
  const purchaseHistory = useMemo(() => {
    const counts = new Map<string, number>();
    const last = new Map<string, any>();
    materialPurchases.forEach((entry: any) => {
      if (!entry.item_id || entry.status === 'Cancelled') return;
      counts.set(entry.item_id, (counts.get(entry.item_id) || 0) + 1);
      if (entry.status === 'Returned') return;
      const prev = last.get(entry.item_id);
      if (!prev || Date.parse(entry.date) > Date.parse(prev.date)) last.set(entry.item_id, entry);
    });
    return { counts, last };
  }, [materialPurchases]);

  const quickAddItems = useMemo(() => purchasableItems
    .filter((item: any) => purchaseHistory.counts.has(item.id))
    .sort((a: any, b: any) => (purchaseHistory.counts.get(b.id) || 0) - (purchaseHistory.counts.get(a.id) || 0))
    .slice(0, 6), [purchaseHistory, purchasableItems]);

  const inBill = useMemo(() => new Set(lines.map(line => line.item_id)), [lines]);

  // After a product is added, its quantity cell takes the keyboard (wide screens only: on phones
  // it would pop the keyboard over the bill).
  useEffect(() => {
    const id = pendingFocus.current;
    if (id === null) return;
    pendingFocus.current = null;
    if (!isWide) return;
    billRef.current?.querySelector<HTMLInputElement>(`[data-line-qty="${id}"]`)?.focus();
  }, [lines, isWide]);

  const addItem = useCallback((itemId: string) => {
    const def = itemsById.get(itemId);
    const units = unitsFor(itemId);
    if (!def || units.length === 0) return;
    const { unit, rate } = defaultPurchaseUnit(def, units, purchaseHistory.last.get(itemId));
    const current = linesRef.current;
    const existing = current.find(line => line.item_id === itemId && line.unitKey === unit.key);
    if (existing) {
      const quantity = cleanQty((Number(existing.quantity) || 0) + 1);
      pendingFocus.current = existing.tempId;
      setLines(current.map(line => (line.tempId === existing.tempId ? { ...line, quantity, total: roundCurrency(quantity * line.rate) } : line)));
      return;
    }
    const line: BillLine = {
      tempId: nextLineId.current++, item_id: def.id, item_name: def.name, unit: unit.unit, unitKey: unit.key, base_unit: def.unit,
      conversion_factor: unit.factor, quantity: 1, rate, total: rate,
    };
    pendingFocus.current = line.tempId;
    setLines([...current, line]);
  }, [itemsById, unitsFor, purchaseHistory]);

  const patchLine = (tempId: number, patch: (line: BillLine) => BillLine) =>
    setLines(current => current.map(line => (line.tempId === tempId ? patch(line) : line)));

  const changeLineUnit = (tempId: number, unit: PurchaseUnit) => patchLine(tempId, line => {
    // Same price per base unit in the new unit; the quantity typed stays as it is.
    const converted = rateForUnit(line.rate, line.conversion_factor, unit.factor);
    const rate = converted > 0 ? converted : line.rate;
    return { ...line, unit: unit.unit, unitKey: unit.key, conversion_factor: unit.factor, rate, total: roundCurrency((Number(line.quantity) || 0) * rate) };
  });

  const setLineQty = (tempId: number, quantity: number) =>
    patchLine(tempId, line => ({ ...line, quantity, total: roundCurrency(quantity * (line.rate || 0)) }));

  const setLineRate = (tempId: number, rate: number) =>
    patchLine(tempId, line => ({ ...line, rate, total: roundCurrency((line.quantity || 0) * rate) }));

  // A typed total changes the rate, never the quantity: the quantity is what physically arrived.
  const setLineTotal = (tempId: number, total: number) => patchLine(tempId, line => {
    const rate = rateFromTotal(total, line.quantity);
    return rate === null ? line : { ...line, rate, total: roundCurrency(line.quantity * rate) };
  });

  const removeLine = (tempId: number) => setLines(current => current.filter(line => line.tempId !== tempId));

  const lineProblems = useMemo(() => {
    const problems = new Map<number, string>();
    lines.forEach(line => {
      const problem = billLineProblem(line, unitsFor(line.item_id));
      if (problem) problems.set(line.tempId, problem);
    });
    return problems;
  }, [lines, unitsFor]);

  // Stock and average cost after the bill, per product, from the lines that can be saved as they are.
  const landingFor = useCallback((billLines: BillLine[]): ItemLanding[] => {
    const groups = new Map<string, LandingLine[]>();
    billLines.forEach(line => {
      const units = unitsFor(line.item_id);
      const unit = findLineUnit(line, units);
      if (!unit || !itemsById.has(line.item_id) || billLineProblem(line, units)) return;
      const group = groups.get(line.item_id) || [];
      group.push({ quantity: line.quantity, rate: line.rate, unit });
      groups.set(line.item_id, group);
    });
    return Array.from(groups.entries()).map(([itemId, group]) => {
      const item = itemsById.get(itemId);
      return { itemId, name: item.name, unit: item.unit || 'unit', landing: landingPreview(item, stockOf(itemId), group) };
    });
  }, [itemsById, unitsFor, stockOf]);
  const landings = useMemo(() => landingFor(lines), [landingFor, lines]);

  // Rounded the way addBulkMaterialPurchase stores it, so the screen shows the saved total.
  const billTotal = roundCurrency(lines.reduce((sum, line) => sum + (line.quantity * line.rate), 0));
  // Only what the user entered; blank counts as nothing paid.
  const paid = paidText !== '' ? roundCurrency(Math.max(0, parseFloat(paidText) || 0)) : 0;
  const unpaid = Math.max(0, roundCurrency(billTotal - paid));
  const isCashPaidFull = billTotal > 0 && unpaid <= 0.01;
  const badLine = lines.find(line => lineProblems.has(line.tempId));
  const canSave = lines.length > 0 && !isSaving && (isCashPaidFull || !!vendorId) && !isLocked;
  const vendor = vendorId ? suppliersById.get(vendorId) : undefined;
  const vendorBalance = balanceOf(vendor);

  const focusLineQty = (tempId: number) => billRef.current?.querySelector<HTMLInputElement>(`[data-line-qty="${tempId}"]`)?.focus();

  const submit = async () => {
    // The state flag only blocks after a re-render; a fast double click saved the bill twice
    // (addBulkMaterialPurchase has no lock), doubling stock and the supplier ledger.
    if (savingRef.current || isSaving) return;
    if (lines.length === 0) { showToast('Please add products to the invoice first.', 'warning'); return; }
    if (badLine) {
      showToast(lineProblems.get(badLine.tempId) || 'Fix a line on the bill.', 'warning');
      focusLineQty(badLine.tempId);
      return;
    }
    if (unpaid > 0.01 && !vendorId) { showToast('Please select a Supplier for purchases on credit.', 'warning'); return; }
    if (paid > 0 && availableAccounts.length === 0) {
      showToast("No active Payment or Cash Drawer account found. Please create one in 'Bank & Cash' or save on credit.", 'warning');
      return;
    }
    if (paid > billTotal + 0.01) {
      showToast(`Paid (${formatCurrency(paid)}) is more than the bill (${formatCurrency(billTotal)}). Give the extra amount to the supplier as a separate Advance payment.`, 'warning');
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    try {
      const success = await addBulkMaterialPurchase({
        supplier_id: vendorId || null,
        date: normalizeTransactionTimestamp(billDate),
        // The save matches a ready-made pack by unit name; variant_id / stocked_as say the same thing explicitly.
        items: lines.map(line => {
          const unit = findLineUnit(line, unitsFor(line.item_id));
          return {
            item_id: line.item_id,
            item_name: line.item_name,
            unit: line.unit,
            base_unit: itemsById.get(line.item_id)?.unit || line.base_unit,
            conversion_factor: line.conversion_factor,
            quantity: line.quantity,
            rate: line.rate,
            total: roundCurrency(line.quantity * line.rate),
            variant_id: unit?.kind === 'pack' ? unit.variantId : undefined,
            stocked_as: unit?.kind === 'pack' ? 'packs' : 'loose',
          };
        }),
        purchase_type: PurchaseType.RAW_MATERIAL,
        paid_amount: paid,
        payment_mode: payMode,
        account_id: paid > 0 ? accountId : undefined,
      });
      // Keep the bill on screen when the save failed, so nothing has to be typed again.
      if (!success) return;
      showToast(vendorId ? `Purchase bill of ${formatCurrency(billTotal)} saved!` : `Cash Purchase of ${formatCurrency(billTotal)} logged!`, 'success');
      setLines([]);
      setVendorId('');
      setPaidText('');
      setPayMode('Cash');
      setBillDate(today);
    } catch (err: any) {
      showToast('Error saving purchase: ' + (err?.message || 'Failed'), 'error');
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const clearBill = async () => {
    if (await confirmAction({
      tone: 'warning',
      title: 'Clear this invoice?',
      consequences: ['All items, the supplier and the paid amount will be removed from the invoice.', 'Nothing was saved yet, so no ledger is affected.'],
      confirmLabel: 'Yes, clear',
    })) {
      setLines([]);
      setVendorId('');
      setPaidText('');
    }
  };

  // The most a line can go back is what it added and has not been returned yet, from the pile it went to.
  // Stock already used is not a limit: the return then shows the pile going below zero.
  const openReturn = useCallback((entry: any) => {
    const def = itemsById.get(entry.item_id) || items.find((i: any) => String(i.name).toLowerCase() === String(entry.item_name).toLowerCase());
    const pile = purchaseLinePile(entry, def);
    setReturnRequest({
      entry,
      type: 'material',
      maxQty: returnableQty(entry),
      supplierName: suppliersById.get(entry.supplier_id)?.name || 'Spot vendor',
      material: {
        pile,
        onHand: def ? pileOnHandInUnit(pile, pileStockOf(def, inventoryById.get(def.id))) : null,
        returned: returnedQty(entry),
      },
    });
  }, [items, itemsById, inventoryById, suppliersById]);

  const isBackDated = billDate !== today;
  const toSearch = () => searchRef.current?.focus();

  return (
    <div className="flex flex-col gap-4 pb-8 sm:gap-5">
      <ProcurementHeader
        active="purchase-supplies"
        title="Supplies & Materials"
        subtitle="Packaging, feed and other goods — with a multi-unit bill."
        actions={<Button variant="secondary" leftIcon={<History />} onClick={() => setLogOpen(true)}>Log</Button>}
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Supplies bought today">
        <StatCard label="Bills today" value={todayStats.bills} icon={<Receipt />} tone="info" hint={`${todayStats.lines} item lines`} />
        <StatCard label="Spent today" value={<Money amount={todayStats.amount} compact />} icon={<Wallet />} />
        <StatCard label="Paid today" value={<Money amount={todayStats.paid} compact />} icon={<Banknote />} tone="success" />
        <StatCard
          label="On credit today"
          value={<Money amount={Math.max(0, todayStats.amount - todayStats.paid)} compact />}
          icon={<BookOpen />}
          tone={todayStats.amount - todayStats.paid > 0.5 ? 'danger' : 'neutral'}
        />
      </section>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <div className="flex flex-col gap-4 rounded-t-card border-b border-line bg-surface-2/60 p-4 sm:p-5">
            {isLocked && (
              <div className="flex items-center gap-2.5 rounded-control bg-warning-soft p-3 text-xs font-semibold text-warning-fg ring-1 ring-inset ring-warning/25" role="alert">
                <Lock size={15} className="shrink-0" aria-hidden="true" />
                <span><strong>{prettyDate(billDate)} is locked.</strong> A supplies bill can't be saved for this day.</span>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <div>
                <SectionLabel step={1} htmlFor="supplies-vendor" aside={!vendorId && <span className="text-[11px] text-fg-subtle">Optional for a cash buy</span>}>
                  Vendor / Supplier
                </SectionLabel>
                <SupplierPicker
                  id="supplies-vendor"
                  value={vendorId}
                  onChange={setVendorId}
                  suppliers={vendorSuppliers}
                  placeholder={isCashPaidFull ? 'Cash / walk-in (optional)' : 'Search vendor…'}
                />
              </div>
              <div>
                <SectionLabel htmlFor="supplies-date" aside={isBackDated && <Badge tone="warning">Back-date</Badge>}>Bill date</SectionLabel>
                <Input
                  id="supplies-date"
                  type="date"
                  inputSize="lg"
                  leftIcon={<CalendarIcon />}
                  value={billDate}
                  max={today}
                  onChange={event => setBillDate(event.target.value || today)}
                  className="text-sm font-semibold"
                />
              </div>
            </div>
            <div>
              <SectionLabel step={2} aside={<span className="hidden text-[11px] text-fg-subtle sm:inline">↑ ↓ choose · Enter add · Enter: qty → rate → next item</span>}>Add products</SectionLabel>
              <ProductSearch items={purchasableItems} readings={readingById} inBill={inBill} onAdd={addItem} inputRef={searchRef} />
              {quickAddItems.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle"><Sparkles size={11} aria-hidden="true" /> Frequent</span>
                  {quickAddItems.map((item: any) => {
                    const reading = readingById.get(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => addItem(item.id)}
                        title={reading ? `Stock: ${stockText(reading)}` : undefined}
                        aria-label={`Add ${item.name}${reading ? ` (stock: ${stockText(reading)}${reading.status !== 'ok' ? `, ${STOCK_STATUS_LABEL[reading.status]}` : ''})` : ''}`}
                        className="flex h-7 cursor-pointer items-center gap-1 rounded-full bg-surface px-2.5 text-[11px] font-semibold text-fg-muted ring-1 ring-inset ring-line transition-colors hover:text-brand-fg hover:ring-brand/40"
                      >
                        <Plus size={11} aria-hidden="true" /> {item.name}
                        {reading && reading.status !== 'ok' && <span className={cn('size-1.5 rounded-full', reading.status === 'low' ? 'bg-warning' : 'bg-danger')} aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div ref={billRef}>
            {lines.length === 0 ? (
              <EmptyState icon={<ShoppingCart />} title="The bill is empty" description="Search above for material, packaging or feed and add it to the bill." />
            ) : (
              <>
                <div className="flex items-center justify-between px-4 pt-3 sm:px-5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{lines.length} {lines.length === 1 ? 'item' : 'items'} in bill</span>
                  <span className="text-[11px] text-fg-subtle md:hidden">Swipe to remove · tap to edit</span>
                </div>

                {!isWide ? (
                  <div className="mt-2 divide-y divide-line border-t border-line">
                    {lines.map(line => {
                      const unit = findLineUnit(line, unitsFor(line.item_id));
                      const isPack = unit?.kind === 'pack';
                      return (
                        <div key={line.tempId} className="relative overflow-hidden bg-danger">
                          <div className="absolute inset-0 flex items-center justify-between px-4 text-xs font-bold text-white" aria-hidden="true">
                            <span className="flex items-center gap-1.5"><Trash2 size={14} /> Delete</span>
                            <span className="flex items-center gap-1.5">Delete <Trash2 size={14} /></span>
                          </div>
                          <MotionDiv
                            drag="x"
                            dragDirectionLock
                            dragConstraints={{ left: 0, right: 0 }}
                            dragElastic={0.6}
                            onDragEnd={(_event: any, info: any) => {
                              if (Math.abs(info.offset.x) > 70 || Math.abs(info.velocity.x) > 350) {
                                removeLine(line.tempId);
                                showToast(`${line.item_name} removed from bill`, 'info');
                              }
                            }}
                            className="relative flex touch-pan-y items-center gap-2 bg-surface px-4 py-3"
                          >
                            <button type="button" onClick={() => setEditingLine(line)} className="min-w-0 flex-1 cursor-pointer text-left" title="Edit quantity, unit & rate">
                              <span className="block truncate text-sm font-bold text-fg">{line.item_name}</span>
                              <span className="mt-0.5 block truncate text-[11px] tabular-nums text-fg-subtle">
                                Rs {formatQty(line.rate, 2)} per <b className={cn('font-semibold', isPack ? 'text-info-fg' : 'text-fg-muted')}>{line.unit}</b>
                              </span>
                              <LineCaption line={line} unit={unit} problem={lineProblems.get(line.tempId)} />
                            </button>
                            <Stepper
                              label={line.item_name}
                              lineId={line.tempId}
                              value={line.quantity}
                              step={1}
                              invalid={lineProblems.has(line.tempId)}
                              onChange={value => setLineQty(line.tempId, value)}
                              compact
                            />
                            <Money amount={line.quantity * line.rate} className="w-20 shrink-0 text-right text-sm font-bold text-fg" />
                          </MotionDiv>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-2">
                    <Table>
                      <THead>
                        <tr>
                          <TH>Product</TH>
                          <TH className="w-44">Unit</TH>
                          <TH className="w-36 text-center">Qty</TH>
                          <TH numeric className="w-32">Rate</TH>
                          <TH numeric className="w-32">Total</TH>
                          <TH className="w-12"><span className="sr-only">Remove</span></TH>
                        </tr>
                      </THead>
                      <TBody>
                        {lines.map(line => {
                          const units = unitsFor(line.item_id);
                          const unit = findLineUnit(line, units);
                          const problem = lineProblems.get(line.tempId);
                          return (
                            <TR key={line.tempId} className="group">
                              <TD>
                                <button type="button" onClick={() => setEditingLine(line)} className="cursor-pointer text-left text-sm font-bold text-fg hover:text-brand-fg" title="Edit product">
                                  {line.item_name}
                                </button>
                                <LineCaption line={line} unit={unit} problem={problem} />
                              </TD>
                              <TD>
                                {units.length > 1 || !unit ? (
                                  <UnitSelect line={line} units={units} found={Boolean(unit)} onChange={next => changeLineUnit(line.tempId, next)} />
                                ) : (
                                  <Badge tone="neutral">{line.unit}</Badge>
                                )}
                              </TD>
                              <TD>
                                <Stepper
                                  label={line.item_name}
                                  lineId={line.tempId}
                                  value={line.quantity}
                                  step={1}
                                  invalid={Boolean(problem)}
                                  onChange={value => setLineQty(line.tempId, value)}
                                  onEnter={() => billRef.current?.querySelector<HTMLInputElement>(`[data-line-rate="${line.tempId}"]`)?.focus()}
                                />
                              </TD>
                              <TD numeric>
                                <div className="ml-auto flex max-w-[8rem] items-center rounded-control border border-line bg-surface shadow-e1 focus-within:border-brand-accent focus-within:ring-4 focus-within:ring-ring/20">
                                  <DraftNumberInput
                                    data-line-rate={line.tempId}
                                    aria-label={`${line.item_name} rate per ${line.unit}`}
                                    value={line.rate}
                                    decimals={2}
                                    onCommit={value => setLineRate(line.tempId, value)}
                                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); toSearch(); } }}
                                    className="ds-control h-8 w-full min-w-0 border-0 bg-transparent px-2 text-right text-sm font-bold tabular-nums text-fg outline-none"
                                  />
                                  <span className="max-w-[3.5rem] shrink-0 truncate pr-2 text-[10px] font-semibold text-fg-subtle" title={`per ${line.unit}`}>/{line.unit}</span>
                                </div>
                              </TD>
                              <TD numeric>
                                <DraftNumberInput
                                  aria-label={`${line.item_name} total`}
                                  value={roundCurrency(line.quantity * line.rate)}
                                  decimals={2}
                                  onCommit={value => setLineTotal(line.tempId, value)}
                                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); toSearch(); } }}
                                  className="ds-control w-28 rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-right text-sm font-bold tabular-nums text-fg outline-none transition-colors hover:border-line focus:border-brand-accent focus:bg-surface"
                                  title="Change the total (the rate adjusts itself, the quantity stays the same)"
                                />
                              </TD>
                              <TD className="text-center">
                                <IconButton size="sm" aria-label={`Remove ${line.item_name}`} icon={<Trash2 />} onClick={() => removeLine(line.tempId)} className="text-fg-faint hover:bg-danger-soft hover:text-danger-fg" />
                              </TD>
                            </TR>
                          );
                        })}
                      </TBody>
                    </Table>
                  </div>
                )}
                {landings.length > 0 && <StockLandingPanel landings={landings} />}
              </>
            )}
          </div>
        </Card>

        <Card className="lg:sticky lg:top-4 lg:col-span-4" aria-label="Bill summary">
          <div className="border-b border-line p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Bill summary</p>
            {vendor ? (
              <div className="flex items-center gap-3">
                <Avatar name={vendor.name} owed={vendorBalance > 0} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-fg">{vendor.name}</p>
                  <p className={cn('text-xs font-semibold', vendorBalance > 0 ? 'text-danger-fg' : vendorBalance < 0 ? 'text-success-fg' : 'text-fg-subtle')}>
                    {vendorBalance === 0 ? 'Ledger clear' : <><Money amount={Math.abs(vendorBalance)} /> {vendorBalance > 0 ? 'due' : 'advance'}</>}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-control border border-dashed border-line p-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-fg-faint"><User size={16} aria-hidden="true" /></span>
                <p className="text-[11px] leading-snug text-fg-subtle"><b className="text-fg-muted">Cash / walk-in buy.</b> Without a vendor the bill must be paid in full.</p>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold text-fg-subtle">Bill total</span>
              <Money amount={billTotal} className="text-2xl font-bold tracking-tight text-fg" />
            </div>
            <div>
              <label htmlFor="supplies-paid" className="mb-1.5 block text-xs font-semibold text-fg-muted">Paid now</label>
              <PaidInput id="supplies-paid" value={paidText} onChange={setPaidText} total={billTotal} paid={paid} invalid={paid > billTotal + 0.01} />
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-semibold text-fg-muted">Paid via</span>
              <PayModeControl value={payMode} onChange={setPayMode} disabled={paid <= 0} />
            </div>
            {paid > 0 && <AccountPicker accounts={availableAccounts} value={accountId} onChange={setAccountId} mode={payMode} hasShiftDrawer={hasShiftDrawer} />}
            <SettlementBar total={billTotal} paid={paid} />
            {vendor && unpaid > 0 && (
              <p className="flex items-center justify-between rounded-control bg-surface-2 px-3 py-2 text-[11px] text-fg-subtle">
                <span className="flex items-center gap-1">Vendor ledger after bill <ArrowRight size={11} aria-hidden="true" /></span>
                <Money amount={Math.abs(vendorBalance + unpaid)} className={cn('font-bold', vendorBalance + unpaid > 0 ? 'text-danger-fg' : 'text-success-fg')} />
              </p>
            )}
            {!vendorId && lines.length > 0 && !isCashPaidFull && (
              <p className="flex items-start gap-1.5 text-[11px] font-semibold text-warning-fg">
                <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden="true" /> Choose a vendor for a bill on credit, or pay it in full.
              </p>
            )}
            {lineProblems.size > 0 && (
              <p className="flex items-start gap-1.5 text-[11px] font-semibold text-danger-fg" role="status">
                <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden="true" />
                {lineProblems.size === 1 ? '1 line needs fixing' : `${lineProblems.size} lines need fixing`} (marked in red).
              </p>
            )}
          </div>

          <div className="flex gap-2 rounded-b-card border-t border-line bg-surface-2/60 p-4">
            {lines.length > 0 && (
              <IconButton variant="secondary" size="lg" aria-label="Clear bill" icon={<RotateCcw />} onClick={clearBill} />
            )}
            <Button
              size="lg"
              fullWidth
              loading={isSaving}
              disabled={!canSave}
              leftIcon={<Save />}
              onClick={submit}
              title={isLocked ? `Selected date (${billDate}) is closed & locked` : undefined}
            >
              {isSaving ? 'Saving…' : lines.length === 0 ? 'Add items' : !vendorId ? (isCashPaidFull ? 'Save cash buy' : 'Choose vendor') : 'Save purchase bill'}
            </Button>
          </div>
        </Card>
      </div>

      <Suspense fallback={null}>
        {editingLine && (
          <EditBillLineModal
            key={editingLine.tempId}
            line={editingLine}
            units={unitsFor(editingLine.item_id)}
            baseUnit={itemsById.get(editingLine.item_id)?.unit || editingLine.base_unit}
            landingFor={draft => landingFor(lines.map(line => (line.tempId === draft.tempId ? draft : line))).find(l => l.itemId === draft.item_id) || null}
            onClose={() => setEditingLine(null)}
            onSave={updated => {
              setLines(current => current.map(line => (line.tempId === updated.tempId ? updated : line)));
              setEditingLine(null);
              showToast('Product updated', 'info');
            }}
            onRemove={line => {
              removeLine(line.tempId);
              setEditingLine(null);
              showToast(`${line.item_name} removed`, 'info');
            }}
          />
        )}
        {returnRequest && (
          <ReturnPurchaseModal key={returnRequest.entry.id} request={returnRequest} onClose={() => setReturnRequest(null)} />
        )}
        {isLogOpen && (
          <PurchaseLogDrawer
            mode="supplies"
            entries={materialPurchases}
            suppliersById={suppliersById}
            itemsById={itemsById}
            today={today}
            onClose={() => setLogOpen(false)}
            onReturn={openReturn}
          />
        )}
      </Suspense>
    </div>
  );
};

/** "12 kg loose · 3 × Bag", or "0 kg" when nothing is on hand. */
function stockText(reading: StockReading): string {
  return pileBreakdown(reading).join(' · ') || formatBaseQty(0, reading.unit);
}

/** Under a bill line: where it lands ("+10 × 500 g pouch"), the conversion, or what is wrong with it. */
function LineCaption({ line, unit, problem }: { line: BillLine; unit?: PurchaseUnit; problem?: string }) {
  if (problem) {
    return (
      <span className="mt-1 flex items-start gap-1 text-[11px] font-semibold leading-snug text-danger-fg">
        <AlertTriangle size={12} className="mt-px shrink-0" aria-hidden="true" /> {problem}
      </span>
    );
  }
  if (!unit) return null;
  const base = line.base_unit;
  const perBase = unit.factor !== 1 && line.rate > 0 ? ` · ${formatCurrency(line.rate / unit.factor)}/${base}` : '';
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-fg-subtle">
      <Badge tone={unit.kind === 'pack' ? 'info' : 'success'} className="h-5 px-1.5 text-[10px]">{landingText(line.quantity, unit, base)}</Badge>
      {unit.kind !== 'base' && <span className="tabular-nums">{conversionText(line.quantity, unit, base)}{perBase}</span>}
    </span>
  );
}

/** Unit picker grouped by what the unit does to stock: base, own packs, multi-units, conversions. */
function UnitSelect({ line, units, found, onChange }: { line: BillLine; units: PurchaseUnit[]; found: boolean; onChange: (unit: PurchaseUnit) => void }) {
  const option = (unit: PurchaseUnit) => <option key={unit.key} value={unit.key}>{unit.label}</option>;
  return (
    <select
      aria-label={`Purchase unit for ${line.item_name}`}
      value={found ? line.unitKey : '__missing'}
      onChange={event => {
        const chosen = units.find(u => u.key === event.target.value);
        if (chosen) onChange(chosen);
      }}
      className={cn(controlClass, 'ds-select h-8 w-full max-w-[11rem] cursor-pointer appearance-none px-2 text-xs font-bold', !found && 'border-danger')}
      title="Which unit was it bought in? A pack goes into its own stock, the rest into loose."
    >
      {!found && <option value="__missing" disabled>{line.unit} (no longer available)</option>}
      {UNIT_KINDS.map(kind => {
        const group = units.filter(u => u.kind === kind);
        if (group.length === 0) return null;
        return kind === 'base' ? group.map(option) : <optgroup key={kind} label={UNIT_KIND_LABEL[kind]}>{group.map(option)}</optgroup>;
      })}
    </select>
  );
}

/** What each product's piles and average cost will be once this bill is saved. */
const StockLandingPanel = memo(function StockLandingPanel({ landings }: { landings: ItemLanding[] }) {
  return (
    <section className="border-t border-line px-4 py-3 sm:px-5" aria-label="Stock after this purchase">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
        <Boxes size={12} aria-hidden="true" /> Stock after this purchase
      </p>
      <ul className="mt-1 divide-y divide-line">
        {landings.map(({ itemId, name, unit, landing }) => (
          <li key={itemId} className="py-2 text-xs">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="font-bold text-fg">{name}</span>
              <span className="text-fg-subtle">Avg cost <b className="tabular-nums text-fg">{costChangeText(landing, unit)}</b></span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {landing.changes.map(change => (
                <span key={change.id} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 tabular-nums text-fg-muted ring-1 ring-inset ring-line">
                  {change.kind === 'loose' ? 'Loose' : `${change.name} packs`}: {change.beforeText}
                  <ArrowRight size={10} aria-hidden="true" />
                  <b className={cn(change.after < 0 ? 'text-danger-fg' : 'text-fg')}>{change.afterText}</b>
                </span>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-fg-subtle">Total stock: <span className="tabular-nums text-fg-muted">{landing.afterText}</span></p>
            {landing.notes.map(note => (
              <p key={note} className="mt-1 flex items-start gap-1 text-[11px] font-semibold text-warning-fg">
                <AlertTriangle size={12} className="mt-px shrink-0" aria-hidden="true" /> {note}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
});

function Stepper({ label, lineId, value, step, invalid, onChange, onEnter, compact }: {
  label: string;
  lineId: number;
  value: number;
  step: number;
  invalid?: boolean;
  onChange: (value: number) => void;
  onEnter?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={cn(
      'mx-auto flex items-center rounded-control bg-surface-2 p-0.5 ring-1 ring-inset focus-within:ring-brand-accent',
      invalid ? 'ring-danger' : 'ring-line',
      compact ? 'max-w-[104px]' : 'max-w-[128px]',
    )}>
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={!(value > step)}
        onClick={() => onChange(cleanQty(value - step))}
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-fg-muted hover:bg-surface active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Minus size={12} />
      </button>
      <DraftNumberInput
        data-line-qty={lineId}
        aria-label={`${label} quantity`}
        aria-invalid={invalid || undefined}
        value={value}
        onCommit={onChange}
        onKeyDown={event => { if (event.key === 'Enter' && onEnter) { event.preventDefault(); onEnter(); } }}
        className="ds-control w-full min-w-0 border-0 bg-transparent p-0 text-center text-xs font-bold tabular-nums text-fg outline-none"
      />
      <button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(cleanQty((value || 0) + step))} className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-fg-muted hover:bg-surface active:scale-90">
        <Plus size={12} />
      </button>
    </div>
  );
}

/** Product combobox with each product's stock. Owns its query, so typing only re-renders the search. */
const ProductSearch = memo(function ProductSearch({ items, readings, inBill, onAdd, inputRef }: {
  items: any[];
  readings: Map<string, StockReading>;
  inBill: Set<string>;
  onAdd: (id: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const results = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    // The first 80 matches are plenty for a dropdown; typing narrows the rest.
    return (needle ? items.filter(item => String(item.name).toLowerCase().includes(needle)) : items).slice(0, 80);
  }, [items, deferredQuery]);
  const showResults = open && (results.length > 0 || query.trim() !== '');
  const highlighted = Math.min(highlight, Math.max(0, results.length - 1));

  const add = (id: string) => { onAdd(id); setQuery(''); setOpen(false); };

  return (
    <div className="relative w-full" ref={rootRef}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-faint" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showResults}
          aria-controls="supply-product-results"
          aria-activedescendant={showResults && results[highlighted] ? `supply-option-${results[highlighted].id}` : undefined}
          aria-autocomplete="list"
          aria-label="Product search"
          autoComplete="off"
          className={cn(controlClass, 'h-12 pl-10 pr-10 text-[15px]')}
          placeholder="Search material, packaging or product to add…"
          value={query}
          onChange={event => { setQuery(event.target.value); setOpen(true); setHighlight(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setHighlight(Math.min(highlighted + 1, results.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlight(Math.max(highlighted - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const pick = results[highlighted];
              if (pick && showResults) add(pick.id);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {query && (
          <button aria-label="Clear search" type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg">
            <X size={14} />
          </button>
        )}
      </div>
      {showResults && (
        <div id="supply-product-results" role="listbox" aria-label="Products" className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-80 overflow-y-auto rounded-card border border-line bg-surface p-1 shadow-e2">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <Package className="mx-auto mb-1.5 text-fg-faint" size={20} aria-hidden="true" />
              <p className="text-xs font-semibold text-fg-muted">&ldquo;{query}&rdquo; not found</p>
              <p className="mt-0.5 text-[11px] text-fg-subtle">First create the item in Products &amp; Catalog (source: Supplier).</p>
            </div>
          ) : results.map((item, index) => {
            const reading = readings.get(item.id);
            return (
              <div
                key={item.id}
                id={`supply-option-${item.id}`}
                role="option"
                aria-selected={index === highlighted}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={event => event.preventDefault()}
                onClick={() => add(item.id)}
                className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-control px-3 py-2.5 transition-colors', index === highlighted ? 'bg-surface-2' : 'hover:bg-surface-2/60')}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-subtle"><Package size={14} aria-hidden="true" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-fg">{item.name}</span>
                    <span className="block truncate text-[11px] text-fg-subtle">
                      Stock: <span className={cn('tabular-nums', reading && reading.status !== 'ok' ? 'font-semibold text-fg-muted' : 'text-fg-muted')}>{reading ? stockText(reading) : '—'}</span>
                      {' · '}Cost {formatCurrency(item.cost_price || 0)}/{item.unit}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {inBill.has(item.id) && <Badge tone="brand">In bill</Badge>}
                  {reading && reading.status !== 'ok' && <Badge tone={STATUS_TONE[reading.status]} dot>{STOCK_STATUS_LABEL[reading.status]}</Badge>}
                  <Badge tone="neutral">{item.unit}</Badge>
                  <Plus size={14} className="text-brand-fg" aria-hidden="true" />
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default SuppliesPurchase;
