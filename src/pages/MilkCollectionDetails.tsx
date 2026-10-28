import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp, ArrowUpRight, BookOpen, ChevronDown, Droplets, Filter, ListOrdered, Phone, Plus, Sun, Users, Wallet, X,
} from 'lucide-react';
import {
  Avatar, PillGroup, PillOption, ProcurementHeader, SettlementBar, ShiftIcon, StatTile, VARIETY_DOT,
} from '../components/procurement/ProcurementUI';
import {
  SETTLEMENT_TEXT, dayOf, formatRate, isActiveEntry, pkTime, prettyDate, settlementLabel, settlementOf, useBusinessClock, useConfiguredShifts,
} from '../components/procurement/procurementData';
import {
  Badge, Button, EmptyState, IconButton, Input, LoadMoreRow, Money, SearchInput, SegmentedControl, Select, TBody, TD, TH, THead, TR, Table,
  StatGrid, TableContainer, Toolbar,
} from '../components/ui';
import { useDairy } from '../context/DairyContext';
import { useTabs } from '../context/TabContext';
import { BREAKPOINTS, useMediaQuery } from '../hooks/useMediaQuery';
import { useProgressiveList } from '../hooks/useProgressiveList';
import { offsetDate } from '../lib/dashboardAnalytics';
import { cn } from '../lib/cn';
import { formatQty } from '../lib/formatters';
import type { PurchaseEntry } from '../types';

type Period = 'today' | 'yesterday' | '7days' | 'month' | 'custom';
type Variety = 'buffalo' | 'cow' | 'mixed';
type VarietyFilter = 'all' | Variety;
type SortKey = 'liters' | 'amount' | 'due' | 'name';
type ViewMode = 'farmers' | 'slips';

interface SlipRow {
  id: string;
  at: number;
  day: string;
  time: string;
  shift: string;
  variety: Variety;
  liters: number;
  rate: number;
  amount: number;
  paid: number;
  due: number;
  fat: number;
  snf: number;
  supplierId: string;
  supplierName: string;
  village: string;
  phone: string;
  /** Lower-cased name, village and phone, built once so searching is a single `includes`. */
  search: string;
}

interface FarmerRow {
  id: string;
  name: string;
  village: string;
  phone: string;
  balance: number;
  liters: number;
  amount: number;
  paid: number;
  due: number;
  buffalo: number;
  cow: number;
  mixed: number;
  share: number;
  rate: number;
  slips: SlipRow[];
}

const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7days', label: '7 days' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom' },
];

const STATUS_TONE = { Paid: 'success', Partial: 'warning', Khata: 'danger' } as const;

function varietyOf(value: string): Variety {
  const type = value.toLowerCase();
  if (type.includes('buffalo')) return 'buffalo';
  if (type.includes('cow')) return 'cow';
  return 'mixed';
}

function varietyLabel(variety: Variety) {
  if (variety === 'buffalo') return 'Buffalo';
  if (variety === 'cow') return 'Cow';
  return 'Mixed';
}

function toSlip(entry: PurchaseEntry, supplier: any): SlipRow {
  const { amount, paid, due } = settlementOf(entry);
  const at = Date.parse(entry.date);
  const supplierName = supplier?.name || entry.supplier_name || 'Walk-in farmer';
  const village = supplier?.village || supplier?.city || '';
  const phone = supplier?.phone || '';
  return {
    id: entry.id,
    at: Number.isFinite(at) ? at : 0,
    day: dayOf(entry),
    time: pkTime(entry.date),
    shift: entry.shift || 'Shift',
    variety: varietyOf(entry.milk_type || ''),
    liters: Number(entry.quantity) || 0,
    rate: Number(entry.rate) || 0,
    amount,
    paid,
    due,
    fat: Number(entry.fat) || 0,
    snf: Number(entry.snf) || 0,
    supplierId: entry.supplier_id || 'unknown',
    supplierName,
    village,
    phone,
    search: `${supplierName} ${village} ${phone}`.toLowerCase(),
  };
}

const MilkCollectionDetails: React.FC = () => {
  const { purchases, suppliers, settings } = useDairy();
  const { openTab, activeTabId } = useTabs();
  // This page stays mounted while hidden; its '/' shortcut must only act while it is on screen.
  const pageActiveRef = useRef(true);
  pageActiveRef.current = activeTabId === 'purchase-details';
  const { today } = useBusinessClock();
  const [period, setPeriod] = useState<Period>('today');
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [variety, setVariety] = useState<VarietyFilter>('all');
  const [shift, setShift] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('liters');
  const [view, setView] = useState<ViewMode>('farmers');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const shifts = useConfiguredShifts(settings?.general?.shifts);

  const range = useMemo(() => {
    if (period === 'yesterday') {
      const day = offsetDate(today, -1);
      return { start: day, end: day };
    }
    if (period === '7days') return { start: offsetDate(today, -6), end: today };
    if (period === 'month') return { start: `${today.slice(0, 7)}-01`, end: today };
    if (period === 'custom') {
      const start = customStart <= customEnd ? customStart : customEnd;
      const end = customStart <= customEnd ? customEnd : customStart;
      return { start, end };
    }
    return { start: today, end: today };
  }, [period, customStart, customEnd, today]);

  const suppliersById = useMemo(() => new Map<string, any>(suppliers.map((s: any) => [s.id, s])), [suppliers]);

  // Period rows turned into slips once; search and filters below only narrow this list.
  const { periodSlips, excluded } = useMemo(() => {
    const rows: SlipRow[] = [];
    let skipped = 0;
    purchases.forEach((entry: PurchaseEntry) => {
      if (!entry.date) return;
      const day = dayOf(entry);
      if (day < range.start || day > range.end) return;
      if (!isActiveEntry(entry)) { skipped += 1; return; }
      rows.push(toSlip(entry, suppliersById.get(entry.supplier_id)));
    });
    rows.sort((a, b) => b.at - a.at);
    return { periodSlips: rows, excluded: skipped };
  }, [purchases, range.start, range.end, suppliersById]);

  const slips = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    const shiftNeedle = shift.toLowerCase();
    if (!needle && variety === 'all' && shift === 'all') return periodSlips;
    return periodSlips.filter(slip => {
      if (variety !== 'all' && slip.variety !== variety) return false;
      if (shift !== 'all' && slip.shift.toLowerCase() !== shiftNeedle) return false;
      return !needle || slip.search.includes(needle);
    });
  }, [periodSlips, deferredQuery, variety, shift]);

  const totals = useMemo(() => {
    const next = { liters: 0, amount: 0, paid: 0, due: 0, buffalo: 0, cow: 0, mixed: 0 };
    const byShift = new Map<string, number>();
    slips.forEach(slip => {
      next.liters += slip.liters;
      next.amount += slip.amount;
      next.paid += slip.paid;
      next.due += slip.due;
      next[slip.variety] += slip.liters;
      byShift.set(slip.shift, (byShift.get(slip.shift) || 0) + slip.liters);
    });
    return {
      ...next,
      rate: next.liters > 0 ? next.amount / next.liters : 0,
      shiftTotals: Array.from(byShift.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [slips]);

  const farmers = useMemo(() => {
    const map = new Map<string, FarmerRow>();
    slips.forEach(slip => {
      let row = map.get(slip.supplierId);
      if (!row) {
        row = {
          id: slip.supplierId,
          name: slip.supplierName,
          village: slip.village,
          phone: slip.phone,
          balance: Number(suppliersById.get(slip.supplierId)?.pending_balance || 0),
          liters: 0, amount: 0, paid: 0, due: 0, buffalo: 0, cow: 0, mixed: 0, share: 0, rate: 0, slips: [],
        };
        map.set(slip.supplierId, row);
      }
      row.liters += slip.liters;
      row.amount += slip.amount;
      row.paid += slip.paid;
      row.due += slip.due;
      row[slip.variety] += slip.liters;
      row.slips.push(slip);
    });
    const rows = Array.from(map.values());
    rows.forEach(row => {
      row.rate = row.liters > 0 ? row.amount / row.liters : 0;
      row.share = totals.liters > 0 ? Math.round((row.liters / totals.liters) * 100) : 0;
    });
    rows.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'amount') return b.amount - a.amount;
      if (sortKey === 'due') return b.due - a.due;
      return b.liters - a.liters;
    });
    return rows;
  }, [slips, suppliersById, totals.liters, sortKey]);

  const filtersActive = Boolean(query.trim()) || variety !== 'all' || shift !== 'all';
  const rangeText = range.start === range.end ? prettyDate(range.start) : `${prettyDate(range.start)} – ${prettyDate(range.end)}`;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!pageActiveRef.current || event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      event.preventDefault();
      document.getElementById('collection-search')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openSupplier = useCallback((supplierId: string) => {
    if (!supplierId || supplierId === 'unknown') return;
    openTab({ id: 'suppliers', path: `/suppliers?id=${encodeURIComponent(supplierId)}` });
    window.dispatchEvent(new CustomEvent('mooco-select-supplier', { detail: { supplierId } }));
  }, [openTab]);

  const toggleFarmer = useCallback((id: string) => {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearFilters = () => {
    setQuery('');
    setVariety('all');
    setShift('all');
  };

  const varietyPills: PillOption<VarietyFilter>[] = [
    { value: 'all', label: 'All' },
    { value: 'buffalo', label: 'Buffalo', dot: VARIETY_DOT.buffalo },
    { value: 'cow', label: 'Cow', dot: VARIETY_DOT.cow },
    { value: 'mixed', label: 'Mixed', dot: VARIETY_DOT.mixed },
  ];
  const maxShift = Math.max(1, ...totals.shiftTotals.map(([, liters]) => liters));

  return (
    <div className="flex flex-col gap-4 pb-8 sm:gap-5">
      <ProcurementHeader
        active="purchase-details"
        title="Collection Details"
        subtitle={`${rangeText} · ${farmers.length} farmers · ${slips.length} slips`}
        actions={<Button leftIcon={<Plus />} onClick={() => openTab('purchase')}>Record intake</Button>}
      />

      <Toolbar className="flex-col flex-nowrap items-stretch gap-2 lg:sticky lg:top-0 lg:z-20">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <SegmentedControl aria-label="Period" value={period} onChange={setPeriod} options={PERIODS} />
          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <Input type="date" aria-label="From date" value={customStart} max={today} onChange={event => setCustomStart(event.target.value || today)} className="w-[10.5rem] text-xs font-semibold" />
              <span className="text-xs text-fg-subtle">to</span>
              <Input type="date" aria-label="To date" value={customEnd} max={today} onChange={event => setCustomEnd(event.target.value || today)} className="w-[10.5rem] text-xs font-semibold" />
            </div>
          )}
          <SearchInput
            id="collection-search"
            value={query}
            onChange={setQuery}
            placeholder="Search farmer, village or phone"
            shortcut="/"
            className="w-full lg:ml-auto lg:max-w-xs"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PillGroup label="Milk variety" size="sm" options={varietyPills} value={variety} onChange={setVariety} className="overflow-x-auto scrollbar-hide" />
          <Select value={shift} onChange={event => setShift(event.target.value)} aria-label="Shift" className="h-9 w-auto text-xs font-semibold">
            <option value="all">All shifts</option>
            {shifts.map(name => <option key={name} value={name}>{name}</option>)}
          </Select>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-fg-subtle">
            <ArrowDownUp size={13} aria-hidden="true" />
            <span className="sr-only">Sort</span>
            <Select value={sortKey} onChange={event => setSortKey(event.target.value as SortKey)} aria-label="Sort" className="h-9 w-auto text-xs font-semibold">
              <option value="liters">Volume</option>
              <option value="amount">Amount</option>
              <option value="due">Unpaid</option>
              <option value="name">Name</option>
            </Select>
          </label>
          <SegmentedControl<ViewMode>
            aria-label="View"
            size="sm"
            value={view}
            onChange={setView}
            className="sm:ml-auto"
            options={[
              { value: 'farmers', label: 'Farmers', icon: <Users />, count: farmers.length },
              { value: 'slips', label: 'Slips', icon: <ListOrdered />, count: slips.length },
            ]}
          />
        </div>
      </Toolbar>

      {(filtersActive || excluded > 0) && (
        <div className="-mt-1 flex flex-wrap items-center gap-2 px-1 text-xs">
          {filtersActive && (
            <Badge tone="brand" icon={<Filter />}>
              Filtered view
              <button type="button" onClick={clearFilters} aria-label="Clear filters" className="-mr-1 cursor-pointer rounded-full p-0.5 hover:bg-brand/15"><X size={11} /></button>
            </Badge>
          )}
          {excluded > 0 && <span className="text-fg-subtle">{excluded} returned {excluded === 1 ? 'slip' : 'slips'} not included</span>}
        </div>
      )}

      <StatGrid
        label="Collection totals"
        storageKey="collection-details"
        gridClassName="lg:grid-cols-2 xl:grid-cols-4"
        peek={[
          { value: `${formatQty(totals.liters)} L`, label: 'collected' },
          { value: <Money amount={totals.due} compact />, label: 'on credit', tone: totals.due > 0.5 ? 'danger' : undefined },
        ]}
      >
        <StatTile className="col-span-2 sm:col-span-1" icon={Droplets} tone="lime" label="Collected" value={`${formatQty(totals.liters)} L`} hint={`${slips.length} slips · ${farmers.length} farmers`}>
          <MixBar buffalo={totals.buffalo} cow={totals.cow} mixed={totals.mixed} />
        </StatTile>
        <StatTile icon={Wallet} label="Milk bill" value={<Money amount={totals.amount} />} hint={totals.liters > 0 ? `Avg Rs ${formatRate(totals.rate)}/L` : 'No collection yet'} />
        <StatTile icon={BookOpen} tone="rose" label="Settlement" value={<Money amount={totals.due} />} valueTone={totals.due > 0.5 ? 'rose' : undefined} hint="On credit (unpaid) in this view">
          <div className="mt-1"><SettlementBar total={totals.amount} paid={totals.paid} /></div>
        </StatTile>
        <div className="col-span-2 flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-4 shadow-e1 sm:col-span-1">
          <div className="flex items-center gap-2.5">
            <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning-fg sm:flex"><Sun size={16} aria-hidden="true" /></span>
            <span className="truncate text-[13px] font-semibold text-fg-subtle">By shift</span>
          </div>
          {totals.shiftTotals.length === 0 ? (
            <p className="text-xs text-fg-subtle">No collection yet</p>
          ) : (
            <div className="flex flex-col gap-2">
              {totals.shiftTotals.slice(0, 4).map(([name, liters]) => (
                <div key={name} className="flex items-center gap-2 text-xs">
                  <span className="flex w-20 shrink-0 items-center gap-1.5 truncate font-semibold text-fg-muted"><ShiftIcon name={name} size={12} />{name}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                    <span className="block h-full rounded-full bg-warning" style={{ width: `${(liters / maxShift) * 100}%` }} />
                  </span>
                  <span className="w-24 shrink-0 text-right font-bold tabular-nums text-fg">
                    {formatQty(liters)} L
                    <span className="ml-1 text-[10px] font-semibold text-fg-subtle">{totals.liters > 0 ? `${Math.round((liters / totals.liters) * 100)}%` : ''}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </StatGrid>

      {slips.length === 0 ? (
        <TableContainer>
          <EmptyState
            icon={<Droplets />}
            title="No collection in this view"
            description="Change the dates, or clear the farmer, variety and shift filters."
            action={
              <div className="flex justify-center gap-2">
                {filtersActive && <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
                <Button onClick={() => openTab('purchase')}>Record intake</Button>
              </div>
            }
          />
        </TableContainer>
      ) : view === 'farmers' ? (
        <FarmerLedger
          farmers={farmers}
          openIds={openIds}
          onToggle={toggleFarmer}
          onOpenSupplier={openSupplier}
          sortKey={sortKey}
          onSort={setSortKey}
          totals={totals}
          resetKey={`${range.start}|${range.end}|${deferredQuery}|${variety}|${shift}|${sortKey}`}
        />
      ) : (
        <SlipLedger slips={slips} onOpenSupplier={openSupplier} totals={totals} resetKey={`${range.start}|${range.end}|${deferredQuery}|${variety}|${shift}`} />
      )}
    </div>
  );
};

function MixBar({ buffalo, cow, mixed }: { buffalo: number; cow: number; mixed: number }) {
  const total = buffalo + cow + mixed;
  if (total <= 0) return null;
  const parts: { key: Variety; liters: number }[] = [
    { key: 'buffalo', liters: buffalo },
    { key: 'cow', liters: cow },
    { key: 'mixed', liters: mixed },
  ];
  return (
    <div className="mt-1">
      <div className="flex h-1.5 gap-px overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
        {parts.map(part => part.liters > 0 && (
          <span key={part.key} className={VARIETY_DOT[part.key]} style={{ width: `${(part.liters / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] font-semibold text-fg-subtle">
        {parts.filter(part => part.liters > 0).map(part => (
          <span key={part.key} className="flex items-center gap-1 tabular-nums">
            <span className={cn('size-1.5 rounded-full', VARIETY_DOT[part.key])} aria-hidden="true" />
            {varietyLabel(part.key)} {formatQty(part.liters)}
          </span>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ paid, due }: { paid: number; due: number }) {
  const label = settlementLabel(paid, due);
  return <Badge tone={STATUS_TONE[label]} dot>{SETTLEMENT_TEXT[label]}</Badge>;
}

function VarietyText({ variety }: { variety: Variety }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold text-fg-muted">
      <span className={cn('size-2 rounded-full', VARIETY_DOT[variety])} aria-hidden="true" />
      {varietyLabel(variety)}
    </span>
  );
}

type LedgerTotals = { liters: number; amount: number; due: number };

function SortHeader({ label, sortKey, active, onSort, align = 'right' }: { label: string; sortKey: SortKey; active: SortKey; onSort: (key: SortKey) => void; align?: 'left' | 'right' }) {
  const isActive = active === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-pressed={isActive}
      className={cn(
        'inline-flex cursor-pointer items-center gap-1 font-semibold uppercase tracking-wider',
        align === 'right' && 'flex-row-reverse',
        isActive ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
      )}
    >
      {label}
      <ChevronDown size={11} className={isActive ? 'opacity-100' : 'opacity-0'} aria-hidden="true" />
    </button>
  );
}

function FarmerLedger({
  farmers, openIds, onToggle, onOpenSupplier, sortKey, onSort, totals, resetKey,
}: {
  farmers: FarmerRow[];
  openIds: Set<string>;
  onToggle: (id: string) => void;
  onOpenSupplier: (id: string) => void;
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
  totals: LedgerTotals;
  resetKey: string;
}) {
  const { visibleItems, hiddenCount, sentinelRef, showMore, showAll } = useProgressiveList<FarmerRow>(farmers, 50, resetKey);
  // One layout at a time: rendering both and hiding one doubled the rows and left the
  // load-more sentinel attached to the hidden copy.
  const isWide = useMediaQuery(BREAKPOINTS.lg);

  return (
    <TableContainer>
      {isWide ? (
        <Table className="min-w-[860px]">
          <THead>
            <tr>
              <TH className="w-12">#</TH>
              <TH><SortHeader label="Farmer" sortKey="name" active={sortKey} onSort={onSort} align="left" /></TH>
              <TH numeric className="hidden xl:table-cell">Buffalo</TH>
              <TH numeric className="hidden xl:table-cell">Cow</TH>
              <TH numeric><SortHeader label="Liters" sortKey="liters" active={sortKey} onSort={onSort} /></TH>
              <TH numeric>Share</TH>
              <TH numeric>Rate</TH>
              <TH numeric><SortHeader label="Amount" sortKey="amount" active={sortKey} onSort={onSort} /></TH>
              <TH numeric><SortHeader label="Unpaid" sortKey="due" active={sortKey} onSort={onSort} /></TH>
              <TH className="w-12"><span className="sr-only">Slips</span></TH>
            </tr>
          </THead>
          <TBody>
            {visibleItems.map((farmer, index) => (
              <FarmerTableRow key={farmer.id} farmer={farmer} index={index} open={openIds.has(farmer.id)} onToggle={onToggle} onOpenSupplier={onOpenSupplier} />
            ))}
            <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} colSpan={10} />
          </TBody>
          <tfoot className="bg-surface-2/80 text-sm font-bold text-fg">
            <tr>
              <td className="py-3 pl-5 pr-4" colSpan={2}>{farmers.length} farmers</td>
              <td className="hidden xl:table-cell" />
              <td className="hidden xl:table-cell" />
              <td className="px-4 py-3 text-right tabular-nums">{formatQty(totals.liters)}</td>
              <td />
              <td />
              <td className="px-4 py-3 text-right"><Money amount={totals.amount} /></td>
              <td className="px-4 py-3 text-right text-danger-fg"><Money amount={totals.due} /></td>
              <td />
            </tr>
          </tfoot>
        </Table>
      ) : (
        <div className="divide-y divide-line">
          {visibleItems.map(farmer => (
            <FarmerCard key={farmer.id} farmer={farmer} open={openIds.has(farmer.id)} onToggle={onToggle} onOpenSupplier={onOpenSupplier} />
          ))}
          <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} />
          <div className="flex items-center justify-between bg-surface-2/80 px-4 py-3 text-xs font-bold text-fg">
            <span>{farmers.length} farmers</span>
            <span className="tabular-nums">{formatQty(totals.liters)} L · <Money amount={totals.amount} /></span>
          </div>
        </div>
      )}
    </TableContainer>
  );
}

const FarmerTableRow = memo(function FarmerTableRow({
  farmer, index, open, onToggle, onOpenSupplier,
}: { farmer: FarmerRow; index: number; open: boolean; onToggle: (id: string) => void; onOpenSupplier: (id: string) => void }) {
  return (
    <>
      <TR interactive selected={open} onClick={() => onToggle(farmer.id)}>
        <TD className="text-xs tabular-nums text-fg-subtle">{index + 1}</TD>
        <TD>
          <div className="flex items-center gap-2.5">
            <Avatar name={farmer.name} owed={farmer.due > 0} size="sm" />
            <div className="min-w-0">
              <button
                type="button"
                onClick={event => { event.stopPropagation(); onOpenSupplier(farmer.id); }}
                className="block cursor-pointer truncate text-left font-bold text-fg hover:text-brand-fg"
              >
                {farmer.name}
              </button>
              <p className="text-[11px] text-fg-subtle">
                {[farmer.village, farmer.slips.length === 1 ? '1 slip' : `${farmer.slips.length} slips`].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
        </TD>
        <TD numeric className="hidden text-xs font-medium xl:table-cell">{farmer.buffalo > 0 ? formatQty(farmer.buffalo) : <span className="text-fg-faint">—</span>}</TD>
        <TD numeric className="hidden text-xs font-medium xl:table-cell">{farmer.cow > 0 ? formatQty(farmer.cow) : <span className="text-fg-faint">—</span>}</TD>
        <TD numeric className="font-bold">{formatQty(farmer.liters)}</TD>
        <TD>
          <div className="ml-auto flex w-28 items-center justify-end gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
              <span className="block h-full rounded-full bg-brand-accent" style={{ width: `${farmer.share}%` }} />
            </span>
            <span className="w-8 text-right text-xs tabular-nums text-fg-subtle">{farmer.share}%</span>
          </div>
        </TD>
        <TD numeric className="text-xs font-medium text-fg-muted">{formatRate(farmer.rate)}</TD>
        <TD numeric className="font-medium"><Money amount={farmer.amount} /></TD>
        <TD numeric className={farmer.due > 0 ? 'text-danger-fg' : 'font-normal text-fg-faint'}>
          {farmer.due > 0 ? <Money amount={farmer.due} /> : '—'}
        </TD>
        <TD className="text-fg-subtle">
          <IconButton
            size="sm"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} slips for ${farmer.name}`}
            icon={<ChevronDown className={cn('transition-transform duration-200', open && 'rotate-180')} />}
            onClick={event => { event.stopPropagation(); onToggle(farmer.id); }}
          />
        </TD>
      </TR>
      {open && (
        <tr className="border-b border-line/70">
          <td colSpan={10} className="bg-surface-2/60 px-5 py-4">
            <FarmerSlips farmer={farmer} onOpenSupplier={onOpenSupplier} />
          </td>
        </tr>
      )}
    </>
  );
});

const FarmerCard = memo(function FarmerCard({
  farmer, open, onToggle, onOpenSupplier,
}: { farmer: FarmerRow; open: boolean; onToggle: (id: string) => void; onOpenSupplier: (id: string) => void }) {
  return (
    <div className={cn(open && 'bg-brand-soft/30')}>
      <button type="button" aria-expanded={open} onClick={() => onToggle(farmer.id)} className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left">
        <Avatar name={farmer.name} owed={farmer.due > 0} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold text-fg">{farmer.name}</span>
          <span className="mt-0.5 block truncate text-[11px] text-fg-subtle">
            {[farmer.village, farmer.slips.length === 1 ? '1 slip' : `${farmer.slips.length} slips`, `${farmer.share}%`].filter(Boolean).join(' · ')}
          </span>
          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full rounded-full bg-brand-accent" style={{ width: `${farmer.share}%` }} />
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-bold tabular-nums text-fg">{formatQty(farmer.liters)} L</span>
          <Money amount={farmer.amount} className="block text-xs text-fg-subtle" />
          {farmer.due > 0 && <span className="block text-[11px] font-semibold text-danger-fg"><Money amount={farmer.due} /> unpaid</span>}
        </span>
        <ChevronDown size={15} className={cn('shrink-0 text-fg-faint transition-transform duration-200', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && (
        <div className="border-t border-line bg-surface-2/60 px-4 py-3">
          <FarmerSlips farmer={farmer} onOpenSupplier={onOpenSupplier} />
        </div>
      )}
    </div>
  );
});

function FarmerSlips({ farmer, onOpenSupplier }: { farmer: FarmerRow; onOpenSupplier: (id: string) => void }) {
  const byShift = Array.from(farmer.slips.reduce((map, slip) => map.set(slip.shift, (map.get(slip.shift) || 0) + slip.liters), new Map<string, number>()));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {byShift.map(([name, liters]) => (
            <Badge key={name} tone="neutral" icon={<ShiftIcon name={name} size={11} />}>
              {name} <b className="tabular-nums text-fg">{formatQty(liters)} L</b>
            </Badge>
          ))}
          {farmer.phone && <Badge tone="neutral" icon={<Phone />}>{farmer.phone}</Badge>}
          {farmer.balance !== 0 && (
            <Badge tone={farmer.balance > 0 ? 'danger' : 'success'}>Running balance <Money amount={farmer.balance} /></Badge>
          )}
        </div>
        {farmer.id !== 'unknown' && (
          <Button variant="ghost" size="sm" rightIcon={<ArrowUpRight />} onClick={() => onOpenSupplier(farmer.id)} className="text-brand-fg">
            Open ledger
          </Button>
        )}
      </div>
      <div className="overflow-hidden rounded-control border border-line bg-surface">
        <Table className="min-w-[640px] text-xs">
          <THead>
            <tr>
              <TH>When</TH>
              <TH>Shift</TH>
              <TH>Variety</TH>
              <TH numeric>Liters</TH>
              <TH numeric>Rate</TH>
              <TH numeric>Amount</TH>
              <TH className="text-right">Status</TH>
            </tr>
          </THead>
          <TBody>
            {farmer.slips.map(slip => (
              <TR key={slip.id}>
                <TD className="py-2 text-fg-muted">{prettyDate(slip.day)}{slip.time && <span className="text-fg-subtle"> · {slip.time}</span>}</TD>
                <TD className="py-2"><span className="inline-flex items-center gap-1"><ShiftIcon name={slip.shift} size={11} />{slip.shift}</span></TD>
                <TD className="py-2">
                  <VarietyText variety={slip.variety} />
                  {slip.fat > 0 && <span className="ml-1 text-fg-subtle">Fat {slip.fat}</span>}
                </TD>
                <TD numeric className="py-2">{formatQty(slip.liters)}</TD>
                <TD numeric className="py-2 font-medium">{formatRate(slip.rate)}</TD>
                <TD numeric className="py-2 font-medium"><Money amount={slip.amount} /></TD>
                <TD className="py-2 text-right"><StatusPill paid={slip.paid} due={slip.due} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

function SlipLedger({ slips, onOpenSupplier, totals, resetKey }: { slips: SlipRow[]; onOpenSupplier: (id: string) => void; totals: LedgerTotals; resetKey: string }) {
  const { visibleItems, hiddenCount, sentinelRef, showMore, showAll } = useProgressiveList<SlipRow>(slips, 60, resetKey);
  const isWide = useMediaQuery(BREAKPOINTS.md);
  return (
    <TableContainer>
      {isWide ? (
        <Table className="min-w-[760px]">
          <THead>
            <tr>
              <TH>When</TH>
              <TH>Farmer</TH>
              <TH>Shift</TH>
              <TH>Variety</TH>
              <TH numeric>Liters</TH>
              <TH numeric>Rate</TH>
              <TH numeric>Amount</TH>
              <TH className="text-right">Status</TH>
            </tr>
          </THead>
          <TBody>
            {visibleItems.map(slip => <SlipTableRow key={slip.id} slip={slip} onOpenSupplier={onOpenSupplier} />)}
            <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} colSpan={8} />
          </TBody>
          <tfoot className="bg-surface-2/80 text-sm font-bold text-fg">
            <tr>
              <td className="py-3 pl-5 pr-4" colSpan={4}>{slips.length} slips</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatQty(totals.liters)}</td>
              <td />
              <td className="px-4 py-3 text-right"><Money amount={totals.amount} /></td>
              <td className="py-3 pl-4 pr-5 text-right text-danger-fg"><Money amount={totals.due} /></td>
            </tr>
          </tfoot>
        </Table>
      ) : (
        <ul className="divide-y divide-line">
          {visibleItems.map(slip => <SlipListItem key={slip.id} slip={slip} onOpenSupplier={onOpenSupplier} />)}
          <li><LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} /></li>
          <li className="flex items-center justify-between bg-surface-2/80 px-4 py-3 text-xs font-bold text-fg">
            <span>{slips.length} slips</span>
            <span className="tabular-nums">{formatQty(totals.liters)} L · <Money amount={totals.amount} /></span>
          </li>
        </ul>
      )}
    </TableContainer>
  );
}

const SlipTableRow = memo(function SlipTableRow({ slip, onOpenSupplier }: { slip: SlipRow; onOpenSupplier: (id: string) => void }) {
  return (
    <TR>
      <TD className="whitespace-nowrap text-xs text-fg-subtle">{prettyDate(slip.day)}{slip.time ? ` · ${slip.time}` : ''}</TD>
      <TD>
        <div className="flex items-center gap-2">
          <Avatar name={slip.supplierName} owed={slip.due > 0} size="sm" />
          <div className="min-w-0">
            <button type="button" onClick={() => onOpenSupplier(slip.supplierId)} className="block cursor-pointer truncate text-left font-bold text-fg hover:text-brand-fg">
              {slip.supplierName}
            </button>
            {slip.village && <p className="text-[11px] text-fg-subtle">{slip.village}</p>}
          </div>
        </div>
      </TD>
      <TD className="text-xs"><span className="inline-flex items-center gap-1"><ShiftIcon name={slip.shift} size={12} />{slip.shift}</span></TD>
      <TD className="text-xs"><VarietyText variety={slip.variety} /></TD>
      <TD numeric>{formatQty(slip.liters)}</TD>
      <TD numeric className="text-xs font-medium text-fg-muted">{formatRate(slip.rate)}</TD>
      <TD numeric className="font-medium"><Money amount={slip.amount} /></TD>
      <TD className="text-right"><StatusPill paid={slip.paid} due={slip.due} /></TD>
    </TR>
  );
});

const SlipListItem = memo(function SlipListItem({ slip, onOpenSupplier }: { slip: SlipRow; onOpenSupplier: (id: string) => void }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Avatar name={slip.supplierName} owed={slip.due > 0} size="sm" />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => onOpenSupplier(slip.supplierId)} className="block max-w-full cursor-pointer truncate text-left text-sm font-bold text-fg">{slip.supplierName}</button>
        <p className="flex items-center gap-1 truncate text-[11px] text-fg-subtle">
          <span className={cn('size-1.5 shrink-0 rounded-full', VARIETY_DOT[slip.variety])} aria-hidden="true" />
          {slip.shift} · {prettyDate(slip.day)}{slip.time ? ` · ${slip.time}` : ''}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold tabular-nums text-fg">{formatQty(slip.liters)} L</p>
        <Money amount={slip.amount} className="block text-[11px] text-fg-subtle" />
      </div>
      <StatusPill paid={slip.paid} due={slip.due} />
    </li>
  );
});

export default MilkCollectionDetails;
