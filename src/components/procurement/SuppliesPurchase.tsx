import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Banknote, BookOpen, Calendar as CalendarIcon, History, Lock, Minus, Package, Plus, Receipt, RotateCcw,
  Save, Search, ShoppingCart, Sparkles, Trash2, User, Wallet, X,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useDairy } from '../../context/DairyContext';
import { useTabs } from '../../context/TabContext';
import { useToast } from '../../context/ToastContext';
import { BREAKPOINTS, useMediaQuery } from '../../hooks/useMediaQuery';
import { PurchaseType } from '../../types';
import { cn } from '../../lib/cn';
import { roundCurrency, roundQuantity } from '../../lib/db';
import { formatCurrency, formatQty, normalizeTransactionTimestamp } from '../../lib/formatters';
import {
  Badge, Button, Card, confirmAction, controlClass, EmptyState, IconButton, Input, Money, StatCard, TBody, TD, TH, THead, TR, Table,
} from '../ui';
import { Avatar, ProcurementHeader, SectionLabel, SettlementBar } from './ProcurementUI';
import { SupplierPicker } from './SupplierPicker';
import { AccountPicker, PaidInput, PayModeControl, usePaymentAccount } from './PaymentFields';
import { balanceOf, dayOf, isActiveEntry, prettyDate, useBusinessClock, useHistoryParam } from './procurementData';
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
  unit: string;
  base_unit: string;
  conversion_factor: number;
  quantity: number;
  rate: number;
  total: number;
}

export interface PurchaseUnit { unit: string; label: string; factor: number; isBase: boolean }

/** Supplies & Materials: a multi-line, multi-unit purchase bill paid now or on the vendor's khata. */
const SuppliesPurchase: React.FC = () => {
  const {
    suppliers, materialPurchases, inventory = [], items, addBulkMaterialPurchase, isDayLocked,
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
  const [search, setSearch] = useState('');
  const [paidText, setPaidText] = useState('');
  const [payMode, setPayMode] = useState('Cash');
  const { availableAccounts, accountId, setAccountId, hasShiftDrawer } = usePaymentAccount(payMode);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const [editingLine, setEditingLine] = useState<BillLine | null>(null);
  const [returnRequest, setReturnRequest] = useState<ReturnRequest | null>(null);
  const [isLogOpen, setLogOpen] = useHistoryParam(isActive);

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
  const suppliersById = useMemo(() => new Map<string, any>(suppliers.map((s: any) => [s.id, s])), [suppliers]);

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

  const purchasableItems = useMemo(() => items.filter((i: any) =>
    (i.isActive !== false) && (i.source === 'Supplier' || i.source === 'Both') &&
    (i.item_type.includes('Raw material') || i.item_type.includes('Packaging material') || i.item_type.includes('Sale product')) &&
    !i.category.some((c: string) => c.toLowerCase().includes('milk')) &&
    !i.name.toLowerCase().includes('milk'),
  ), [items]);

  const quickAddItems = useMemo(() => {
    const counts = new Map<string, number>();
    materialPurchases.forEach((entry: any) => {
      if (entry.item_id && entry.status !== 'Cancelled') counts.set(entry.item_id, (counts.get(entry.item_id) || 0) + 1);
    });
    return purchasableItems
      .filter((item: any) => counts.has(item.id))
      .sort((a: any, b: any) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0))
      .slice(0, 6);
  }, [materialPurchases, purchasableItems]);

  const unitsFor = useCallback((itemId: string): PurchaseUnit[] => {
    const def = itemsById.get(itemId);
    if (!def) return [];
    const baseUnit = def.unit || 'pcs';
    const units: PurchaseUnit[] = [{ unit: baseUnit, label: `${baseUnit} (Base)`, factor: 1, isBase: true }];
    // Only packaging variants defined for this item (e.g. Dozen = 12, Tray = 30).
    if (Array.isArray(def.variants)) {
      def.variants.filter((v: any) => v.isActive !== false).forEach((v: any) => {
        const factor = Number(v.quantity_in_base_unit) || 1;
        if (v.name && v.name.toLowerCase() !== baseUnit.toLowerCase()) {
          // Ready-made packs are stocked as packs; dozen/tray style units go into loose stock.
          units.push({ unit: v.name, label: `${v.name} (${factor} ${baseUnit}${v.deduct_from_base === true ? '' : ', pack'})`, factor, isBase: false });
        }
      });
    }
    return units;
  }, [itemsById]);

  // Where a bill line lands: ready-made pack units add packs, everything else adds loose base units.
  const lineDestination = useCallback((line: { item_id: string; unit?: string; quantity?: number; conversion_factor?: number; rate?: number }) => {
    const def = itemsById.get(line.item_id);
    if (!def) return null;
    const unitName = String(line.unit || '').trim().toLowerCase();
    const pack = unitName && unitName !== String(def.unit || '').trim().toLowerCase()
      ? (def.variants || []).find((v: any) => v.isActive !== false && v.deduct_from_base !== true && String(v.name || '').trim().toLowerCase() === unitName)
      : undefined;
    const qty = Number(line.quantity) || 0;
    const conv = Number(line.conversion_factor) || 1;
    const rate = Number(line.rate) || 0;
    const perBase = conv > 0 && rate > 0 ? rate / conv : 0;
    return pack
      ? { packed: true, text: `+${formatQty(qty, 3)} ${pack.name}`, rate: '' }
      : { packed: false, text: `+${formatQty(qty * conv, 3)} ${def.unit} loose`, rate: conv !== 1 && perBase > 0 ? `${formatCurrency(perBase)}/${def.unit}` : '' };
  }, [itemsById]);

  const addItem = (itemId: string) => {
    const def = itemsById.get(itemId);
    if (!def) return;
    setLines(current => {
      const index = current.findIndex(line => line.item_id === itemId && line.unit === def.unit);
      if (index >= 0) {
        const next = [...current];
        const quantity = (next[index].quantity || 0) + 1;
        next[index] = { ...next[index], quantity, total: roundCurrency(quantity * next[index].rate) };
        return next;
      }
      return [...current, {
        tempId: Math.random(), item_id: def.id, item_name: def.name, unit: def.unit, base_unit: def.unit, conversion_factor: 1,
        quantity: 1, rate: def.cost_price || 0, total: def.cost_price || 0,
      }];
    });
    setSearch('');
  };

  const changeLineUnit = (tempId: number, unit: string, factor: number) => {
    setLines(current => current.map(line => {
      if (line.tempId !== tempId) return line;
      const baseCost = (Number(line.rate) || 0) / (Number(line.conversion_factor) || 1);
      const estimated = roundCurrency(baseCost * factor);
      const rate = estimated > 0 ? estimated : line.rate;
      return { ...line, unit, conversion_factor: factor, rate, total: roundCurrency((Number(line.quantity) || 0) * rate) };
    }));
  };

  const updateLine = (tempId: number, field: 'quantity' | 'rate', value: number) => {
    setLines(current => current.map(line => {
      if (line.tempId !== tempId) return line;
      const next = { ...line, [field]: value };
      next.total = roundCurrency((next.quantity || 0) * (next.rate || 0));
      return next;
    }));
  };

  const updateLineTotal = (tempId: number, text: string) => {
    const total = parseFloat(text);
    setLines(current => current.map(line => {
      if (line.tempId !== tempId) return line;
      if (isNaN(total) || total < 0) return { ...line, total: 0 };
      const rate = line.rate > 0 ? line.rate : 1;
      return { ...line, quantity: Number((total / rate).toFixed(2)), total };
    }));
  };

  const removeLine = (tempId: number) => setLines(current => current.filter(line => line.tempId !== tempId));

  // Rounded the way addBulkMaterialPurchase stores it, so the screen shows the saved total.
  const billTotal = roundCurrency(lines.reduce((sum, line) => sum + (line.quantity * line.rate), 0));
  // Only what the user entered; blank counts as nothing paid.
  const paid = paidText !== '' ? roundCurrency(Math.max(0, parseFloat(paidText) || 0)) : 0;
  const unpaid = Math.max(0, roundCurrency(billTotal - paid));
  const isCashPaidFull = billTotal > 0 && unpaid <= 0.01;
  const badLine = lines.find(line => !(Number(line.quantity) > 0) || Number(line.rate) < 0);
  const canSave = lines.length > 0 && !isSaving && (isCashPaidFull || !!vendorId) && !isLocked;
  const vendor = vendorId ? suppliersById.get(vendorId) : undefined;
  const vendorBalance = balanceOf(vendor);

  const submit = async () => {
    // The state flag only blocks after a re-render; a fast double click saved the bill twice
    // (addBulkMaterialPurchase has no lock), doubling stock and the supplier khata.
    if (savingRef.current || isSaving) return;
    if (lines.length === 0) { showToast('Please add products to the invoice first.', 'warning'); return; }
    if (badLine) {
      showToast(`"${badLine.item_name}" ki quantity 0 se zyada aur rate minus ke baghair hona chahiye.`, 'warning');
      return;
    }
    if (unpaid > 0.01 && !vendorId) { showToast('Please select a Supplier for credit / khata purchases.', 'warning'); return; }
    if (paid > 0 && availableAccounts.length === 0) {
      showToast("No active Payment or Cash Drawer account found. Please create one in 'Bank & Cash' or save on credit.", 'warning');
      return;
    }
    if (paid > billTotal + 0.01) {
      showToast(`Paid (${formatCurrency(paid)}) bill (${formatCurrency(billTotal)}) se zyada hai. Zyada raqam supplier ko alag Advance payment ke taur par dein.`, 'warning');
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    try {
      const success = await addBulkMaterialPurchase({
        supplier_id: vendorId || null,
        date: normalizeTransactionTimestamp(billDate),
        items: lines,
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
      title: 'Yeh invoice saaf karein?',
      consequences: ['Invoice ke sab items, supplier aur paid amount hat jayenge.', 'Abhi tak kuch save nahi hua, is liye kisi khaate par asar nahi hoga.'],
      confirmLabel: 'Haan, saaf karein',
    })) {
      setLines([]);
      setVendorId('');
      setPaidText('');
    }
  };

  const openReturn = (entry: any) => {
    const def = items.find((i: any) => i.id === entry.item_id || String(i.name).toLowerCase() === String(entry.item_name).toLowerCase());
    // The bill is in its purchase unit (e.g. 2 ctn); stock is in base units or packs. Compare like with like.
    const conversion = Number(entry.details?.conversion_factor) || 1;
    const packId = entry.details?.variant_id;
    const invRow = inventory.find((inv: any) => inv.item_id === def?.id);
    const stockInBase = Number(invRow?.quantity ?? def?.stock ?? 0);
    const availableStock = !def
      ? entry.quantity
      : packId
        ? Number((invRow?.variant_stocks || def.variant_stocks || {})[packId] || 0)
        : roundQuantity(stockInBase / conversion);
    // With nothing on hand (stock already used or negative) the bill can still be reversed in full;
    // the stock then goes below zero, which is shown rather than hidden.
    const maxQty = availableStock > 0 ? Math.min(entry.quantity, availableStock) : entry.quantity;
    if (def && availableStock <= 0) {
      showToast(`${entry.item_name} stock is ${formatQty(availableStock)}. This return will make it negative.`, 'warning');
    }
    setReturnRequest({
      entry,
      type: 'material',
      maxQty: maxQty > 0 ? maxQty : entry.quantity,
      supplierName: suppliersById.get(entry.supplier_id)?.name || 'Spot vendor',
    });
  };

  const isBackDated = billDate !== today;

  return (
    <div className="flex flex-col gap-4 pb-8 sm:gap-5">
      <ProcurementHeader
        active="purchase-supplies"
        title="Supplies & Materials"
        subtitle="Packaging, feed aur doosra saman — multi-unit bill ke sath."
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
                <span><strong>{prettyDate(billDate)} band (locked) hai.</strong> Is din ka supplies bill save nahi ho sakta.</span>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <div>
                <SectionLabel step={1} htmlFor="supplies-vendor" aside={!vendorId && <span className="text-[11px] text-fg-subtle">Cash buy ke liye optional</span>}>
                  Vendor / Supplier
                </SectionLabel>
                <SupplierPicker
                  id="supplies-vendor"
                  value={vendorId}
                  onChange={setVendorId}
                  suppliers={vendorSuppliers}
                  placeholder={isCashPaidFull ? 'Cash / walk-in (optional)' : 'Vendor dhoondein…'}
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
              <SectionLabel step={2} aside={<span className="hidden text-[11px] text-fg-subtle sm:inline">↑ ↓ chunein · Enter add</span>}>Add products</SectionLabel>
              <ProductSearch items={purchasableItems} query={search} onQuery={setSearch} onAdd={addItem} />
              {quickAddItems.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle"><Sparkles size={11} aria-hidden="true" /> Aksar</span>
                  {quickAddItems.map((item: any) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => addItem(item.id)}
                      className="flex h-7 cursor-pointer items-center gap-1 rounded-full bg-surface px-2.5 text-[11px] font-semibold text-fg-muted ring-1 ring-inset ring-line transition-colors hover:text-brand-fg hover:ring-brand/40"
                    >
                      <Plus size={11} aria-hidden="true" /> {item.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {lines.length === 0 ? (
            <EmptyState icon={<ShoppingCart />} title="Bill khaali hai" description="Material, packaging ya feed upar search kar ke bill mein add karein." />
          ) : (
            <>
              <div className="flex items-center justify-between px-4 pt-3 sm:px-5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{lines.length} {lines.length === 1 ? 'item' : 'items'} in bill</span>
                <span className="text-[11px] text-fg-subtle md:hidden">Swipe to remove · tap to edit</span>
              </div>

              {!isWide ? (
                <div className="mt-2 divide-y divide-line border-t border-line">
                  {lines.map(line => (
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
                        <button type="button" onClick={() => setEditingLine(line)} className="min-w-0 flex-1 cursor-pointer text-left" title="Edit quantity & rate">
                          <span className="block truncate text-sm font-bold text-fg">{line.item_name}</span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg-subtle">
                            <Badge tone="brand" className="h-5 px-1.5 text-[10px]">{line.unit}</Badge>
                            Rs {formatQty(line.rate, 2)}
                          </span>
                          <DestinationTag dest={lineDestination(line)} />
                        </button>
                        <Stepper
                          label={line.item_name}
                          value={line.quantity}
                          onChange={value => updateLine(line.tempId, 'quantity', value)}
                          compact
                        />
                        <Money amount={line.quantity * line.rate} className="w-20 shrink-0 text-right text-sm font-bold text-fg" />
                      </MotionDiv>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2">
                  <Table>
                    <THead>
                      <tr>
                        <TH>Product</TH>
                        <TH className="w-32 text-center">Unit</TH>
                        <TH className="w-36 text-center">Qty</TH>
                        <TH numeric className="w-32">Rate</TH>
                        <TH numeric className="w-32">Total</TH>
                        <TH className="w-12"><span className="sr-only">Remove</span></TH>
                      </tr>
                    </THead>
                    <TBody>
                      {lines.map(line => {
                        const units = unitsFor(line.item_id);
                        return (
                          <TR key={line.tempId} className="group">
                            <TD>
                              <button type="button" onClick={() => setEditingLine(line)} className="cursor-pointer text-left text-sm font-bold text-fg hover:text-brand-fg" title="Edit product">
                                {line.item_name}
                              </button>
                              <div><DestinationTag dest={lineDestination(line)} /></div>
                            </TD>
                            <TD className="text-center">
                              {units.length > 1 ? (
                                <select
                                  aria-label={`Select unit for ${line.item_name}`}
                                  value={line.unit}
                                  onChange={event => {
                                    const chosen = units.find(u => u.unit === event.target.value);
                                    if (chosen) changeLineUnit(line.tempId, chosen.unit, chosen.factor);
                                  }}
                                  className={cn(controlClass, 'ds-select h-8 max-w-[8rem] cursor-pointer appearance-none px-2 text-xs font-bold')}
                                  title="Change purchase unit"
                                >
                                  {units.map(u => <option key={u.unit} value={u.unit}>{u.label}</option>)}
                                </select>
                              ) : (
                                <Badge tone="neutral">{line.unit}</Badge>
                              )}
                            </TD>
                            <TD><Stepper label={line.item_name} value={line.quantity} onChange={value => updateLine(line.tempId, 'quantity', value)} /></TD>
                            <TD numeric>
                              <Input
                                type="number"
                                min="0"
                                step="any"
                                inputSize="sm"
                                aria-label={`${line.item_name} rate`}
                                value={line.rate}
                                onChange={event => updateLine(line.tempId, 'rate', parseFloat(event.target.value) || 0)}
                                className="ml-auto max-w-[7.5rem] text-right font-bold tabular-nums"
                              />
                            </TD>
                            <TD numeric>
                              <input
                                type="number"
                                step="any"
                                aria-label={`${line.item_name} total`}
                                value={roundCurrency(line.quantity * line.rate)}
                                onChange={event => updateLineTotal(line.tempId, event.target.value)}
                                className="ds-control w-28 rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-right text-sm font-bold tabular-nums text-fg outline-none transition-colors hover:border-line focus:border-brand-accent focus:bg-surface"
                                title="Total badlein (qty khud adjust hogi)"
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
            </>
          )}
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
                    {vendorBalance === 0 ? 'Khata clear' : <><Money amount={Math.abs(vendorBalance)} /> {vendorBalance > 0 ? 'due' : 'advance'}</>}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-control border border-dashed border-line p-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-fg-faint"><User size={16} aria-hidden="true" /></span>
                <p className="text-[11px] leading-snug text-fg-subtle"><b className="text-fg-muted">Cash / walk-in buy.</b> Vendor ke baghair bill poora ada hona chahiye.</p>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold text-fg-subtle">Bill total</span>
              <Money amount={billTotal} className="text-2xl font-bold tracking-tight text-fg" />
            </div>
            <div>
              <label htmlFor="supplies-paid" className="mb-1.5 block text-xs font-semibold text-fg-muted">Abhi ada (paid now)</label>
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
                <span className="flex items-center gap-1">Vendor khata after bill <ArrowRight size={11} aria-hidden="true" /></span>
                <Money amount={Math.abs(vendorBalance + unpaid)} className={cn('font-bold', vendorBalance + unpaid > 0 ? 'text-danger-fg' : 'text-success-fg')} />
              </p>
            )}
            {!vendorId && lines.length > 0 && !isCashPaidFull && (
              <p className="flex items-start gap-1.5 text-[11px] font-semibold text-warning-fg">
                <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden="true" /> Udhaar bill ke liye vendor chunein, ya Full paid karein.
              </p>
            )}
          </div>

          <div className="flex gap-2 rounded-b-card border-t border-line bg-surface-2/60 p-4">
            {lines.length > 0 && (
              <IconButton variant="secondary" size="lg" aria-label="Bill saaf karein" icon={<RotateCcw />} onClick={clearBill} />
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
              {isSaving ? 'Saving…' : lines.length === 0 ? 'Items add karein' : !vendorId ? (isCashPaidFull ? 'Save cash buy' : 'Vendor chunein') : 'Save purchase bill'}
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
            destinationFor={unit => lineDestination({ ...editingLine, unit: unit.unit, conversion_factor: unit.factor, quantity: 1 })}
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
            today={today}
            onClose={() => setLogOpen(false)}
            onReturn={openReturn}
          />
        )}
      </Suspense>
    </div>
  );
};

function DestinationTag({ dest }: { dest: { packed: boolean; text: string; rate: string } | null }) {
  if (!dest) return null;
  return (
    <Badge tone={dest.packed ? 'warning' : 'success'} className="mt-1 h-5 px-1.5 text-[10px]">
      {dest.text}{dest.rate ? ` · ${dest.rate}` : ''}
    </Badge>
  );
}

function Stepper({ label, value, onChange, compact }: { label: string; value: number; onChange: (value: number) => void; compact?: boolean }) {
  return (
    <div className={cn('mx-auto flex items-center rounded-control bg-surface-2 p-0.5 ring-1 ring-inset ring-line focus-within:ring-brand-accent', compact ? 'max-w-[104px]' : 'max-w-[128px]')}>
      <button type="button" aria-label={`${label} kam karein`} onClick={() => onChange(Math.max(0.1, (value || 1) - 1))} className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-fg-muted hover:bg-surface active:scale-90">
        <Minus size={12} />
      </button>
      <input
        type="number"
        min="0.1"
        step="any"
        inputMode="decimal"
        aria-label={`${label} quantity`}
        value={value}
        onChange={event => onChange(parseFloat(event.target.value) || 0)}
        className="ds-control w-full min-w-0 border-0 bg-transparent p-0 text-center text-xs font-bold tabular-nums text-fg outline-none"
      />
      <button type="button" aria-label={`${label} zyada karein`} onClick={() => onChange((value || 0) + 1)} className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-fg-muted hover:bg-surface active:scale-90">
        <Plus size={12} />
      </button>
    </div>
  );
}

/** Product combobox. Kept as its own component so typing only re-renders the search, not the bill. */
function ProductSearch({ items, query, onQuery, onAdd }: { items: any[]; query: string; onQuery: (value: string) => void; onAdd: (id: string) => void }) {
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
    const needle = query.toLowerCase();
    // The first 80 matches are plenty for a dropdown; typing narrows the rest.
    return items.filter(item => String(item.name).toLowerCase().includes(needle)).slice(0, 80);
  }, [items, query]);
  const showResults = open && (results.length > 0 || query.trim() !== '');
  const highlighted = Math.min(highlight, Math.max(0, results.length - 1));

  const add = (id: string) => { onAdd(id); setOpen(false); };

  return (
    <div className="relative w-full" ref={rootRef}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-faint" aria-hidden="true" />
        <input
          type="text"
          role="combobox"
          aria-expanded={showResults}
          aria-controls="supply-product-results"
          aria-autocomplete="list"
          aria-label="Product search"
          autoComplete="off"
          className={cn(controlClass, 'h-12 pl-10 pr-10 text-[15px]')}
          placeholder="Search material, packaging or product to add…"
          value={query}
          onChange={event => { onQuery(event.target.value); setOpen(true); setHighlight(0); }}
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
              if (pick) add(pick.id);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {query && (
          <button aria-label="Search saaf karein" type="button" onClick={() => onQuery('')} className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg">
            <X size={14} />
          </button>
        )}
      </div>
      {showResults && (
        <div id="supply-product-results" role="listbox" aria-label="Products" className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-72 overflow-y-auto rounded-card border border-line bg-surface p-1 shadow-e2">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <Package className="mx-auto mb-1.5 text-fg-faint" size={20} aria-hidden="true" />
              <p className="text-xs font-semibold text-fg-muted">&ldquo;{query}&rdquo; nahi mila</p>
              <p className="mt-0.5 text-[11px] text-fg-subtle">Pehle Products &amp; Catalog mein item banayein (source: Supplier).</p>
            </div>
          ) : results.map((item, index) => (
            <div
              key={item.id}
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
                  <span className="block truncate text-[11px] text-fg-subtle">{item.category.join(', ')} · Cost Rs {item.cost_price || 0}/{item.unit}</span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {Array.isArray(item.variants) && item.variants.length > 0 && <Badge tone="brand">+{item.variants.length} units</Badge>}
                <Badge tone="neutral">{item.unit}</Badge>
                <Plus size={14} className="text-brand-fg" aria-hidden="true" />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default SuppliesPurchase;
