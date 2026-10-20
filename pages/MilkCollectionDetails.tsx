import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp, ArrowUpRight, BookOpen, CalendarDays, ChevronDown, Droplets, Filter, ListOrdered, Phone, Plus, Search, Sun, Users, Wallet, X,
} from 'lucide-react';
import {
  Avatar, PillGroup, PillOption, ProcurementHeader, SettlementBar, ShiftIcon, StatTile, VARIETY_DOT,
} from '../components/procurement/ProcurementUI';
import { useDairy } from '../context/DairyContext';
import { useTabs } from '../context/TabContext';
import { businessDate, offsetDate } from '../lib/dashboardAnalytics';
import { formatCurrency, formatQty } from '../lib/formatters';
import type { PurchaseEntry, Supplier } from '../types';

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
  morning: number;
  evening: number;
  share: number;
  rate: number;
  slips: SlipRow[];
}

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7days', label: '7 days' },
  { id: 'month', label: 'This month' },
  { id: 'custom', label: 'Custom' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function prettyDate(iso: string) {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

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

function shiftBucket(shift: string) {
  const value = shift.toLowerCase();
  if (value.includes('morning') || value.includes('subah')) return 'morning';
  if (value.includes('evening') || value.includes('night') || value.includes('sham') || value.includes('raat')) return 'evening';
  return 'other';
}

function moneyOf(entry: PurchaseEntry) {
  const amount = Math.max(0, Number(entry.total_amount) || 0);
  const paid = Math.min(amount, Math.max(0, Number(entry.paid_amount) || 0));
  return { amount, paid, due: Math.max(0, amount - paid) };
}

function toSlip(entry: PurchaseEntry, suppliers: Supplier[]): SlipRow {
  const supplier = suppliers.find(item => item.id === entry.supplier_id);
  const { amount, paid, due } = moneyOf(entry);
  const parsed = new Date(entry.date);
  const valid = Number.isFinite(parsed.getTime());
  return {
    id: entry.id,
    at: valid ? parsed.getTime() : 0,
    day: businessDate(entry.date),
    time: valid && entry.date.includes('T') ? timeFormatter.format(parsed) : '',
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
    supplierName: supplier?.name || entry.supplier_name || 'Walk-in farmer',
    village: supplier?.village || supplier?.city || '',
    phone: supplier?.phone || '',
  };
}

function settlementLabel(paid: number, due: number) {
  if (due <= 0.5 && paid > 0) return 'Paid';
  if (paid <= 0.5) return 'Khata';
  return 'Partial';
}

const MilkCollectionDetails: React.FC = () => {
  const { purchases, suppliers, settings } = useDairy();
  const { openTab, activeTabId } = useTabs();
  // This page stays mounted while hidden; its '/' shortcut must only act while it is on screen.
  const pageActiveRef = useRef(true);
  pageActiveRef.current = activeTabId === 'purchase-details';
  const today = businessDate();
  const [period, setPeriod] = useState<Period>('today');
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [query, setQuery] = useState('');
  const [variety, setVariety] = useState<VarietyFilter>('all');
  const [shift, setShift] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('liters');
  const [view, setView] = useState<ViewMode>('farmers');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const shifts = useMemo(() => {
    const list = settings?.general?.shifts;
    const names = Array.isArray(list) ? list.map(item => String(item).trim()).filter(Boolean) : [];
    return names.length ? Array.from(new Set(names)) : ['Morning', 'Evening'];
  }, [settings?.general?.shifts]);

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

  const periodPurchases = useMemo(() => purchases.filter(entry => {
    if (!entry.date) return false;
    const day = businessDate(entry.date);
    return day >= range.start && day <= range.end;
  }), [purchases, range.start, range.end]);

  const excluded = periodPurchases.filter(entry => entry.status === 'Cancelled' || entry.status === 'Returned').length;

  const slips = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return periodPurchases
      .filter(entry => entry.status !== 'Cancelled' && entry.status !== 'Returned')
      .map(entry => toSlip(entry, suppliers))
      .filter(slip => {
        if (variety !== 'all' && slip.variety !== variety) return false;
        if (shift !== 'all' && slip.shift.toLowerCase() !== shift.toLowerCase()) return false;
        if (!needle) return true;
        return slip.supplierName.toLowerCase().includes(needle)
          || slip.village.toLowerCase().includes(needle)
          || slip.phone.toLowerCase().includes(needle);
      })
      .sort((a, b) => b.at - a.at);
  }, [periodPurchases, suppliers, query, variety, shift]);

  const totals = useMemo(() => {
    const next = { liters: 0, amount: 0, paid: 0, due: 0, buffalo: 0, cow: 0, mixed: 0, morning: 0, evening: 0, other: 0 };
    slips.forEach(slip => {
      next.liters += slip.liters;
      next.amount += slip.amount;
      next.paid += slip.paid;
      next.due += slip.due;
      next[slip.variety] += slip.liters;
      const bucket = shiftBucket(slip.shift);
      if (bucket === 'morning') next.morning += slip.liters;
      else if (bucket === 'evening') next.evening += slip.liters;
      else next.other += slip.liters;
    });
    return { ...next, rate: next.liters > 0 ? next.amount / next.liters : 0 };
  }, [slips]);

  const shiftTotals = useMemo(() => {
    const map = new Map<string, number>();
    slips.forEach(slip => map.set(slip.shift, (map.get(slip.shift) || 0) + slip.liters));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [slips]);

  const farmers = useMemo(() => {
    const map = new Map<string, FarmerRow>();
    slips.forEach(slip => {
      const current = map.get(slip.supplierId) || {
        id: slip.supplierId,
        name: slip.supplierName,
        village: slip.village,
        phone: slip.phone,
        balance: Number(suppliers.find(item => item.id === slip.supplierId)?.pending_balance || 0),
        liters: 0, amount: 0, paid: 0, due: 0, buffalo: 0, cow: 0, mixed: 0, morning: 0, evening: 0,
        share: 0, rate: 0, slips: [],
      };
      current.liters += slip.liters;
      current.amount += slip.amount;
      current.paid += slip.paid;
      current.due += slip.due;
      current[slip.variety] += slip.liters;
      const bucket = shiftBucket(slip.shift);
      if (bucket === 'morning') current.morning += slip.liters;
      else if (bucket === 'evening') current.evening += slip.liters;
      current.slips.push(slip);
      map.set(slip.supplierId, current);
    });
    const rows = Array.from(map.values()).map(row => ({
      ...row,
      rate: row.liters > 0 ? row.amount / row.liters : 0,
      share: totals.liters > 0 ? Math.round((row.liters / totals.liters) * 100) : 0,
    }));
    rows.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'amount') return b.amount - a.amount;
      if (sortKey === 'due') return b.due - a.due;
      return b.liters - a.liters;
    });
    return rows;
  }, [slips, suppliers, totals.liters, sortKey]);

  const filtersActive = Boolean(query.trim()) || variety !== 'all' || shift !== 'all';
  const rangeText = range.start === range.end ? prettyDate(range.start) : `${prettyDate(range.start)} – ${prettyDate(range.end)}`;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!pageActiveRef.current || event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      event.preventDefault();
      document.getElementById('collection-search')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openSupplier = (supplierId: string) => {
    if (!supplierId || supplierId === 'unknown') return;
    openTab({ id: 'suppliers', path: `/suppliers?id=${encodeURIComponent(supplierId)}` });
    window.dispatchEvent(new CustomEvent('mooco-select-supplier', { detail: { supplierId } }));
  };

  const toggleFarmer = (id: string) => {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearFilters = () => {
    setQuery('');
    setVariety('all');
    setShift('all');
  };

  const maxShift = Math.max(1, ...shiftTotals.map(([, liters]) => liters));
  const varietyPills: PillOption<VarietyFilter>[] = [
    { value: 'all', label: 'All' },
    { value: 'buffalo', label: 'Buffalo', dot: VARIETY_DOT.buffalo },
    { value: 'cow', label: 'Cow', dot: VARIETY_DOT.cow },
    { value: 'mixed', label: 'Mixed', dot: VARIETY_DOT.mixed },
  ];
  const selectClass = 'h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 outline-none focus:border-lime-500';

  return (
    <div className="space-y-4 pb-8">
      <ProcurementHeader
        active="purchase-details"
        title="Collection Details"
        subtitle={`${rangeText} · ${farmers.length} farmers · ${slips.length} slips`}
        actions={
          <button type="button" onClick={() => openTab('purchase')} className="flex h-[38px] shrink-0 items-center gap-1.5 rounded-xl bg-lime-600 px-3 text-xs font-bold text-white shadow-md shadow-lime-600/25 hover:bg-lime-700">
            <Plus size={14} /> <span className="hidden sm:inline">Record intake</span>
          </button>
        }
      />

      {/* Filters */}
      <div className="z-20 -mx-3 px-3 py-1 sm:-mx-4 sm:px-4 md:-mx-8 md:px-8 lg:sticky lg:top-0 lg:bg-slate-50/95 lg:backdrop-blur-md lg:dark:bg-slate-950/95">
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <PillGroup label="Period" options={PERIODS.map(item => ({ value: item.id, label: item.label }))} value={period} onChange={setPeriod} className="overflow-x-auto scrollbar-hide lg:flex-initial" />
            {period === 'custom' && (
              <div className="flex items-center gap-2">
                <label className="flex h-9 flex-1 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700">
                  <CalendarDays size={13} className="text-slate-400" />
                  <input type="date" value={customStart} onChange={event => setCustomStart(event.target.value)} aria-label="From date" className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs font-semibold outline-none dark:bg-transparent" />
                </label>
                <span className="text-xs text-slate-400">to</span>
                <label className="flex h-9 flex-1 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700">
                  <input type="date" value={customEnd} onChange={event => setCustomEnd(event.target.value)} aria-label="To date" className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs font-semibold outline-none dark:bg-transparent" />
                </label>
              </div>
            )}
            <div className="relative min-w-0 flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="collection-search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Farmer, gaon ya phone dhoondein"
                className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-14 text-xs font-medium text-slate-800 outline-none focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20"
              />
              {query ? (
                <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-700">
                  <X size={14} />
                </button>
              ) : (
                <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-slate-200 px-1.5 font-mono text-[10px] text-slate-400 sm:block">/</kbd>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PillGroup label="Milk variety" size="sm" options={varietyPills} value={variety} onChange={setVariety} className="overflow-x-auto scrollbar-hide" />
            <select value={shift} onChange={event => setShift(event.target.value)} aria-label="Shift" className={selectClass}>
              <option value="all">All shifts</option>
              {shifts.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              <ArrowDownUp size={13} className="text-slate-400" />
              <select value={sortKey} onChange={event => setSortKey(event.target.value as SortKey)} aria-label="Sort" className={selectClass}>
                <option value="liters">Volume</option>
                <option value="amount">Amount</option>
                <option value="due">Unpaid</option>
                <option value="name">Name</option>
              </select>
            </label>
            <PillGroup
              label="View"
              size="sm"
              options={[
                { value: 'farmers', label: `Farmers ${farmers.length}`, icon: <Users size={12} /> },
                { value: 'slips', label: `Slips ${slips.length}`, icon: <ListOrdered size={12} /> },
              ]}
              value={view}
              onChange={setView}
              className="ml-auto"
            />
          </div>
        </div>
      </div>

      {(filtersActive || excluded > 0) && (
        <div className="flex flex-wrap items-center gap-2 px-1 text-xs">
          {filtersActive && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-lime-200 bg-lime-50 px-2.5 py-1 font-semibold text-lime-700">
              <Filter size={11} /> Filtered view
              <button type="button" onClick={clearFilters} aria-label="Clear filters" className="rounded-full p-0.5 hover:bg-lime-100"><X size={11} /></button>
            </span>
          )}
          {excluded > 0 && <span className="text-slate-400">{excluded} returned {excluded === 1 ? 'slip' : 'slips'} shamil nahi</span>}
        </div>
      )}

      {/* Summary */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile className="col-span-2 sm:col-span-1" icon={Droplets} tone="lime" label="Collected" value={`${formatQty(totals.liters)} L`} hint={`${slips.length} slips · ${farmers.length} farmers`}>
          <MixBar buffalo={totals.buffalo} cow={totals.cow} mixed={totals.mixed} />
        </StatTile>
        <StatTile icon={Wallet} tone="violet" label="Milk bill" value={formatCurrency(totals.amount)} hint={totals.liters > 0 ? `Avg Rs ${totals.rate.toFixed(1)}/L` : 'No collection yet'} />
        <StatTile icon={BookOpen} tone="rose" label="Settlement" value={formatCurrency(totals.due)} valueTone={totals.due > 0 ? 'rose' : undefined} hint="Khata (unpaid) in this view">
          <div className="mt-2"><SettlementBar total={totals.amount} paid={totals.paid} formatMoney={formatCurrency} /></div>
        </StatTile>
        <div className="col-span-2 min-w-0 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs sm:col-span-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">By shift</span>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-100 text-amber-700"><Sun size={14} /></span>
          </div>
          {shiftTotals.length === 0 ? (
            <p className="mt-3 text-xs text-slate-400">No collection yet</p>
          ) : (
            <div className="mt-2 space-y-2">
              {shiftTotals.slice(0, 4).map(([name, liters]) => (
                <div key={name} className="flex items-center gap-2 text-xs">
                  <span className="flex w-20 shrink-0 items-center gap-1.5 truncate font-semibold text-slate-600"><ShiftIcon name={name} size={12} />{name}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-amber-400" style={{ width: `${(liters / maxShift) * 100}%` }} />
                  </span>
                  <span className="w-20 shrink-0 text-right font-mono font-bold text-slate-800">
                    {formatQty(liters)} L
                    <span className="ml-1 font-sans text-[10px] font-semibold text-slate-400">{totals.liters > 0 ? `${Math.round((liters / totals.liters) * 100)}%` : ''}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {slips.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-lime-50 text-lime-600"><Droplets size={22} /></span>
          <p className="text-sm font-bold text-slate-800">Is view mein koi collection nahi</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">Dates badlein, ya farmer, variety aur shift filters hata dein.</p>
          <div className="mt-4 flex justify-center gap-2">
            {filtersActive && (
              <button type="button" onClick={clearFilters} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Clear filters</button>
            )}
            <button type="button" onClick={() => openTab('purchase')} className="rounded-xl bg-lime-600 px-3 py-2 text-xs font-bold text-white hover:bg-lime-700">Record intake</button>
          </div>
        </div>
      ) : view === 'farmers' ? (
        <FarmerLedger
          farmers={farmers}
          openIds={openIds}
          onToggle={toggleFarmer}
          onOpenSupplier={openSupplier}
          sortKey={sortKey}
          onSort={setSortKey}
          totals={totals}
        />
      ) : (
        <SlipLedger slips={slips} onOpenSupplier={openSupplier} totals={totals} />
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
    <div className="mt-2">
      <div className="flex h-1.5 gap-px overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        {parts.map(part => part.liters > 0 && (
          <span key={part.key} className={VARIETY_DOT[part.key]} style={{ width: `${(part.liters / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] font-semibold text-slate-500">
        {parts.filter(part => part.liters > 0).map(part => (
          <span key={part.key} className="flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${VARIETY_DOT[part.key]}`} />
            {varietyLabel(part.key)} {formatQty(part.liters)}
          </span>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ paid, due }: { paid: number; due: number }) {
  const label = settlementLabel(paid, due);
  const cls = label === 'Paid'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : label === 'Khata'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : 'border-amber-200 bg-amber-50 text-amber-700';
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>;
}

function FarmerLedger({
  farmers, openIds, onToggle, onOpenSupplier, sortKey, onSort, totals,
}: {
  farmers: FarmerRow[];
  openIds: Set<string>;
  onToggle: (id: string) => void;
  onOpenSupplier: (id: string) => void;
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
  totals: { liters: number; amount: number; due: number };
}) {
  const sortButton = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <button
      type="button"
      onClick={() => onSort(key)}
      aria-pressed={sortKey === key}
      className={`inline-flex items-center gap-1 font-bold uppercase tracking-wider ${align === 'right' ? 'flex-row-reverse' : ''} ${sortKey === key ? 'text-slate-900' : 'text-slate-400 hover:text-slate-700'}`}
    >
      {label}
      <ChevronDown size={11} className={sortKey === key ? 'opacity-100' : 'opacity-0'} />
    </button>
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[860px] border-collapse text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[10px]">
            <tr>
              <th className="w-10 px-4 py-2.5 font-bold text-slate-400">#</th>
              <th className="px-3 py-2.5 text-left">{sortButton('name', 'Farmer', 'left')}</th>
              <th className="hidden px-3 py-2.5 text-right font-bold uppercase tracking-wider text-slate-400 xl:table-cell">Buffalo</th>
              <th className="hidden px-3 py-2.5 text-right font-bold uppercase tracking-wider text-slate-400 xl:table-cell">Cow</th>
              <th className="px-3 py-2.5 text-right">{sortButton('liters', 'Liters')}</th>
              <th className="px-3 py-2.5 text-right font-bold uppercase tracking-wider text-slate-400">Share</th>
              <th className="px-3 py-2.5 text-right font-bold uppercase tracking-wider text-slate-400">Rate</th>
              <th className="px-3 py-2.5 text-right">{sortButton('amount', 'Amount')}</th>
              <th className="px-3 py-2.5 text-right">{sortButton('due', 'Unpaid')}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {farmers.map((farmer, index) => {
              const open = openIds.has(farmer.id);
              return (
                <React.Fragment key={farmer.id}>
                  <tr
                    className={`cursor-pointer border-b border-slate-100 text-slate-700 transition-colors hover:bg-slate-50 ${open ? 'bg-lime-50/40' : ''}`}
                    onClick={() => onToggle(farmer.id)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{index + 1}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={farmer.name} owed={farmer.due > 0} size="sm" />
                        <div className="min-w-0">
                          <button type="button" onClick={event => { event.stopPropagation(); onOpenSupplier(farmer.id); }} className="block truncate font-bold text-slate-900 hover:text-lime-700">
                            {farmer.name}
                          </button>
                          <p className="text-[11px] text-slate-400">
                            {[farmer.village, farmer.slips.length === 1 ? '1 slip' : `${farmer.slips.length} slips`].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 text-right font-mono text-xs xl:table-cell">{farmer.buffalo > 0 ? formatQty(farmer.buffalo) : <span className="text-slate-300">—</span>}</td>
                    <td className="hidden px-3 py-3 text-right font-mono text-xs xl:table-cell">{farmer.cow > 0 ? formatQty(farmer.cow) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-3 text-right font-mono font-bold text-slate-900">{formatQty(farmer.liters)}</td>
                    <td className="px-3 py-3">
                      <div className="ml-auto flex w-28 items-center justify-end gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <span className="block h-full rounded-full bg-lime-500" style={{ width: `${farmer.share}%` }} />
                        </span>
                        <span className="w-8 text-right font-mono text-xs text-slate-500">{farmer.share}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{farmer.rate.toFixed(1)}</td>
                    <td className="px-3 py-3 text-right font-mono">{formatCurrency(farmer.amount)}</td>
                    <td className={`px-3 py-3 text-right font-mono ${farmer.due > 0 ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-slate-300'}`}>
                      {farmer.due > 0 ? formatCurrency(farmer.due) : '—'}
                    </td>
                    <td className="px-2 py-3 text-slate-400">
                      <button type="button" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} slips for ${farmer.name}`} onClick={event => { event.stopPropagation(); onToggle(farmer.id); }} className="rounded-lg p-1 hover:bg-slate-200">
                        <ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b border-slate-100">
                      <td colSpan={10} className="bg-slate-50 px-5 py-4">
                        <FarmerSlips farmer={farmer} onOpenSupplier={onOpenSupplier} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 text-sm font-bold text-slate-900">
              <td className="px-4 py-3" colSpan={2}>{farmers.length} farmers</td>
              <td className="hidden xl:table-cell" />
              <td className="hidden xl:table-cell" />
              <td className="px-3 py-3 text-right font-mono">{formatQty(totals.liters)}</td>
              <td />
              <td />
              <td className="px-3 py-3 text-right font-mono">{formatCurrency(totals.amount)}</td>
              <td className="px-3 py-3 text-right font-mono text-rose-600 dark:text-rose-400">{formatCurrency(totals.due)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="divide-y divide-slate-100 lg:hidden">
        {farmers.map((farmer) => {
          const open = openIds.has(farmer.id);
          return (
            <div key={farmer.id} className={open ? 'bg-lime-50/30' : ''}>
              <button type="button" aria-expanded={open} onClick={() => onToggle(farmer.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <Avatar name={farmer.name} owed={farmer.due > 0} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-slate-900">{farmer.name}</span>
                  <span className="mt-0.5 block text-[11px] text-slate-400">{[farmer.village, farmer.slips.length === 1 ? '1 slip' : `${farmer.slips.length} slips`, `${farmer.share}%`].filter(Boolean).join(' · ')}</span>
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-lime-500" style={{ width: `${farmer.share}%` }} />
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono font-black text-slate-900">{formatQty(farmer.liters)} L</span>
                  <span className="block font-mono text-xs text-slate-500">{formatCurrency(farmer.amount)}</span>
                  {farmer.due > 0 && <span className="block font-mono text-[11px] font-semibold text-rose-600 dark:text-rose-400">{formatCurrency(farmer.due)} unpaid</span>}
                </span>
                <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                  <FarmerSlips farmer={farmer} onOpenSupplier={onOpenSupplier} />
                </div>
              )}
            </div>
          );
        })}
        <div className="flex items-center justify-between bg-slate-50 px-4 py-3 text-xs font-bold text-slate-900">
          <span>{farmers.length} farmers</span>
          <span className="font-mono">{formatQty(totals.liters)} L · {formatCurrency(totals.amount)}</span>
        </div>
      </div>
    </section>
  );
}

function FarmerSlips({ farmer, onOpenSupplier }: { farmer: FarmerRow; onOpenSupplier: (id: string) => void }) {
  const byShift = Array.from(farmer.slips.reduce((map, slip) => map.set(slip.shift, (map.get(slip.shift) || 0) + slip.liters), new Map<string, number>()));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {byShift.map(([name, liters]) => (
            <span key={name} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-600">
              <ShiftIcon name={name} size={11} /> {name} <b className="font-mono text-slate-900">{formatQty(liters)} L</b>
            </span>
          ))}
          {farmer.phone && (
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-600"><Phone size={11} /> {farmer.phone}</span>
          )}
          {farmer.balance !== 0 && (
            <span className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${farmer.balance > 0 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
              Running khata {formatCurrency(farmer.balance)}
            </span>
          )}
        </div>
        {farmer.id !== 'unknown' && (
          <button type="button" onClick={() => onOpenSupplier(farmer.id)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-bold text-lime-700 hover:bg-lime-50">
            Open khata <ArrowUpRight size={13} />
          </button>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-3 py-2 font-bold">When</th>
              <th className="px-3 py-2 font-bold">Shift</th>
              <th className="px-3 py-2 font-bold">Variety</th>
              <th className="px-3 py-2 text-right font-bold">Liters</th>
              <th className="px-3 py-2 text-right font-bold">Rate</th>
              <th className="px-3 py-2 text-right font-bold">Amount</th>
              <th className="px-3 py-2 text-right font-bold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {farmer.slips.map(slip => (
              <tr key={slip.id}>
                <td className="px-3 py-2 text-slate-700">{prettyDate(slip.day)}{slip.time ? <span className="text-slate-400"> · {slip.time}</span> : ''}</td>
                <td className="px-3 py-2"><span className="inline-flex items-center gap-1"><ShiftIcon name={slip.shift} size={11} />{slip.shift}</span></td>
                <td className="px-3 py-2">
                  <VarietyText variety={slip.variety} />
                  {slip.fat > 0 && <span className="ml-1 text-slate-400">Fat {slip.fat}</span>}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{formatQty(slip.liters)}</td>
                <td className="px-3 py-2 text-right font-mono">{slip.rate.toFixed(1)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatCurrency(slip.amount)}</td>
                <td className="px-3 py-2 text-right"><StatusPill paid={slip.paid} due={slip.due} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SlipLedger({ slips, onOpenSupplier, totals }: { slips: SlipRow[]; onOpenSupplier: (id: string) => void; totals: { liters: number; amount: number; due: number } }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-2.5 font-bold">When</th>
              <th className="px-3 py-2.5 font-bold">Farmer</th>
              <th className="px-3 py-2.5 font-bold">Shift</th>
              <th className="px-3 py-2.5 font-bold">Variety</th>
              <th className="px-3 py-2.5 text-right font-bold">Liters</th>
              <th className="px-3 py-2.5 text-right font-bold">Rate</th>
              <th className="px-3 py-2.5 text-right font-bold">Amount</th>
              <th className="px-4 py-2.5 text-right font-bold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {slips.map(slip => (
              <tr key={slip.id} className="transition-colors hover:bg-slate-50">
                <td className="px-4 py-2.5 text-xs text-slate-500">{prettyDate(slip.day)}{slip.time ? ` · ${slip.time}` : ''}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Avatar name={slip.supplierName} owed={slip.due > 0} size="sm" />
                    <div className="min-w-0">
                      <button type="button" onClick={() => onOpenSupplier(slip.supplierId)} className="block truncate font-bold text-slate-900 hover:text-lime-700">
                        {slip.supplierName}
                      </button>
                      {slip.village && <p className="text-[11px] text-slate-400">{slip.village}</p>}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs"><span className="inline-flex items-center gap-1"><ShiftIcon name={slip.shift} size={12} />{slip.shift}</span></td>
                <td className="px-3 py-2.5 text-xs"><VarietyText variety={slip.variety} /></td>
                <td className="px-3 py-2.5 text-right font-mono font-bold">{formatQty(slip.liters)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs">{slip.rate.toFixed(1)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{formatCurrency(slip.amount)}</td>
                <td className="px-4 py-2.5 text-right"><StatusPill paid={slip.paid} due={slip.due} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-bold">
              <td className="px-4 py-3" colSpan={4}>{slips.length} slips</td>
              <td className="px-3 py-3 text-right font-mono">{formatQty(totals.liters)}</td>
              <td />
              <td className="px-3 py-3 text-right font-mono">{formatCurrency(totals.amount)}</td>
              <td className="px-4 py-3 text-right font-mono text-rose-600 dark:text-rose-400">{formatCurrency(totals.due)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <ul className="divide-y divide-slate-100 md:hidden">
        {slips.map(slip => (
          <li key={slip.id} className="flex items-center gap-3 px-4 py-3">
            <Avatar name={slip.supplierName} owed={slip.due > 0} size="sm" />
            <div className="min-w-0 flex-1">
              <button type="button" onClick={() => onOpenSupplier(slip.supplierId)} className="block truncate text-sm font-bold text-slate-900">{slip.supplierName}</button>
              <p className="flex items-center gap-1 text-[11px] text-slate-400">
                <span className={`h-1.5 w-1.5 rounded-full ${VARIETY_DOT[slip.variety]}`} />
                {slip.shift} · {prettyDate(slip.day)}{slip.time ? ` · ${slip.time}` : ''}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-sm font-black text-slate-900">{formatQty(slip.liters)} L</p>
              <p className="font-mono text-[11px] text-slate-500">{formatCurrency(slip.amount)}</p>
            </div>
            <StatusPill paid={slip.paid} due={slip.due} />
          </li>
        ))}
        <li className="flex items-center justify-between bg-slate-50 px-4 py-3 text-xs font-bold text-slate-900">
          <span>{slips.length} slips</span>
          <span className="font-mono">{formatQty(totals.liters)} L · {formatCurrency(totals.amount)}</span>
        </li>
      </ul>
    </section>
  );
}

function VarietyText({ variety }: { variety: Variety }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
      <span className={`h-2 w-2 rounded-full ${VARIETY_DOT[variety]}`} />
      {varietyLabel(variety)}
    </span>
  );
}

export default MilkCollectionDetails;
