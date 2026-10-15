import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Moon, Search, Sun, X } from 'lucide-react';
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
  const { openTab } = useTabs();
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
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
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

  return (
    <div className="space-y-3 pb-8">
      <div className="sticky top-0 z-20 -mx-3 bg-slate-50/95 px-3 py-2 backdrop-blur-md dark:bg-slate-950/95 sm:-mx-4 sm:px-4 md:-mx-8 md:px-8">
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:flex-row lg:items-center">
          <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {PERIODS.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPeriod(item.id)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap ${
                  period === item.id
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" value={customStart} onChange={event => setCustomStart(event.target.value)} aria-label="From date" className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
              <span className="text-xs text-slate-400">to</span>
              <input type="date" value={customEnd} onChange={event => setCustomEnd(event.target.value)} aria-label="To date" className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="collection-search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search farmer, village, or phone"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-xs font-medium text-slate-800 outline-none focus:border-lime-500 focus:ring-1 focus:ring-lime-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                  <X size={14} />
                </button>
              )}
            </div>
            <select value={variety} onChange={event => setVariety(event.target.value as VarietyFilter)} aria-label="Milk variety" className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              <option value="all">All varieties</option>
              <option value="buffalo">Buffalo</option>
              <option value="cow">Cow</option>
              <option value="mixed">Mixed</option>
            </select>
            <select value={shift} onChange={event => setShift(event.target.value)} aria-label="Shift" className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              <option value="all">All shifts</option>
              {shifts.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <div className="flex h-9 shrink-0 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              {(['farmers', 'slips'] as ViewMode[]).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setView(mode)}
                  className={`rounded-md px-3 text-xs font-semibold ${view === mode ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white' : 'text-slate-500'}`}
                >
                  {mode === 'farmers' ? `Farmers ${farmers.length}` : `Slips ${slips.length}`}
                </button>
              ))}
            </div>
          </div>
          <button type="button" onClick={() => openTab('purchase')} className="h-9 shrink-0 rounded-lg bg-lime-600 px-3 text-xs font-bold text-white hover:bg-lime-700">
            Record intake
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-white">{rangeText}</span>
          <span className="mx-1.5 text-slate-300">/</span>
          {farmers.length} farmers
          <span className="mx-1.5 text-slate-300">/</span>
          {slips.length} slips
          {filtersActive && <span className="ml-2 text-xs font-semibold text-lime-700 dark:text-lime-400">Filtered view</span>}
        </p>
        <div className="flex items-center gap-3 text-xs">
          {excluded > 0 && <span className="text-slate-400">{excluded} returned {excluded === 1 ? 'slip' : 'slips'} left out</span>}
          {filtersActive && (
            <button type="button" onClick={clearFilters} className="font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white">
              Clear filters
            </button>
          )}
          <label className="flex items-center gap-1.5 font-semibold text-slate-500">
            Sort
            <select value={sortKey} onChange={event => setSortKey(event.target.value as SortKey)} className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              <option value="liters">Volume</option>
              <option value="amount">Amount</option>
              <option value="due">Unpaid</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
      </div>

      <section className="grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 dark:border-slate-800 dark:bg-slate-800 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCell label="Collected" value={`${formatQty(totals.liters)} L`} detail={`Buffalo ${formatQty(totals.buffalo)} · Cow ${formatQty(totals.cow)} · Mixed ${formatQty(totals.mixed)}`}>
          <MixBar buffalo={totals.buffalo} cow={totals.cow} mixed={totals.mixed} />
        </SummaryCell>
        <div className="bg-white px-4 py-3.5 dark:bg-slate-900 xl:col-span-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">By shift</p>
          {shiftTotals.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">No collection yet</p>
          ) : (
            <div className={`mt-2 grid gap-3 ${shiftTotals.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {shiftTotals.slice(0, 4).map(([name, liters]) => (
                <div key={name}>
                  <p className="font-mono text-xl font-semibold tracking-tight text-slate-950 dark:text-white">{formatQty(liters)} L</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                    {shiftBucket(name) === 'morning' ? <Sun size={12} className="text-amber-500" /> : shiftBucket(name) === 'evening' ? <Moon size={12} className="text-indigo-400" /> : null}
                    {name}{totals.liters > 0 ? ` · ${Math.round((liters / totals.liters) * 100)}%` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
        <SummaryCell label="Settlement" value={formatCurrency(totals.amount)} detail={`Paid ${formatCurrency(totals.paid)} · Khata ${formatCurrency(totals.due)}`}>
          <p className="mt-1 text-xs text-slate-500">Avg {totals.liters > 0 ? `Rs ${totals.rate.toFixed(1)}/L` : '—'}</p>
        </SummaryCell>
      </section>

      {slips.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center dark:border-slate-700 dark:bg-slate-900">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">No collection in this view</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">Change the dates, or clear the farmer, variety, and shift filters.</p>
          {filtersActive && (
            <button type="button" onClick={clearFilters} className="mt-4 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
              Clear filters
            </button>
          )}
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

function SummaryCell({ label, value, detail, icon, children }: { label: string; value: string; detail: string; icon?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="bg-white px-4 py-3.5 dark:bg-slate-900">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {icon}
        {label}
      </div>
      <p className="mt-1 font-mono text-xl font-semibold tracking-tight text-slate-950 dark:text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
      {children}
    </div>
  );
}

function MixBar({ buffalo, cow, mixed }: { buffalo: number; cow: number; mixed: number }) {
  const total = buffalo + cow + mixed;
  if (total <= 0) return null;
  return (
    <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true">
      <span className="bg-lime-600" style={{ width: `${(buffalo / total) * 100}%` }} />
      <span className="bg-sky-500" style={{ width: `${(cow / total) * 100}%` }} />
      <span className="bg-slate-400" style={{ width: `${(mixed / total) * 100}%` }} />
    </div>
  );
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
  const sortButton = (key: SortKey, label: string) => (
    <button type="button" onClick={() => onSort(key)} className={`font-semibold ${sortKey === key ? 'text-slate-900 dark:text-white' : 'text-slate-400 hover:text-slate-700'}`}>
      {label}
    </button>
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-left text-sm">
          <thead className="border-b border-slate-200 text-[11px] uppercase tracking-wide dark:border-slate-800">
            <tr>
              <th className="w-10 px-3 py-2.5 text-slate-400">#</th>
              <th className="px-3 py-2.5 text-left">{sortButton('name', 'Farmer')}</th>
              <th className="hidden px-3 py-2.5 text-right font-semibold text-slate-400 xl:table-cell">Buffalo</th>
              <th className="hidden px-3 py-2.5 text-right font-semibold text-slate-400 xl:table-cell">Cow</th>
              <th className="px-3 py-2.5 text-right">{sortButton('liters', 'Liters')}</th>
              <th className="px-3 py-2.5 text-right font-semibold text-slate-400">Share</th>
              <th className="px-3 py-2.5 text-right font-semibold text-slate-400">Rate</th>
              <th className="px-3 py-2.5 text-right">{sortButton('amount', 'Amount')}</th>
              <th className="px-3 py-2.5 text-right">{sortButton('due', 'Unpaid')}</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {farmers.map((farmer, index) => {
              const open = openIds.has(farmer.id);
              return (
                <React.Fragment key={farmer.id}>
                  <tr
                    className={`cursor-pointer border-b border-slate-100 text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/50 ${open ? 'bg-slate-50 dark:bg-slate-800/40' : ''}`}
                    onClick={() => onToggle(farmer.id)}
                  >
                    <td className="px-3 py-3 font-mono text-xs text-slate-400">{index + 1}</td>
                    <td className="px-3 py-3">
                      <button type="button" onClick={event => { event.stopPropagation(); onOpenSupplier(farmer.id); }} className="font-semibold text-slate-950 hover:text-lime-700 dark:text-white dark:hover:text-lime-400">
                        {farmer.name}
                      </button>
                      <p className="text-xs text-slate-400">
                        {[farmer.village, farmer.slips.length === 1 ? '1 slip' : `${farmer.slips.length} slips`].filter(Boolean).join(' · ')}
                      </p>
                    </td>
                    <td className="hidden px-3 py-3 text-right font-mono text-xs xl:table-cell">{farmer.buffalo > 0 ? formatQty(farmer.buffalo) : '—'}</td>
                    <td className="hidden px-3 py-3 text-right font-mono text-xs xl:table-cell">{farmer.cow > 0 ? formatQty(farmer.cow) : '—'}</td>
                    <td className="px-3 py-3 text-right font-mono font-semibold text-slate-950 dark:text-white">{formatQty(farmer.liters)}</td>
                    <td className="px-3 py-3">
                      <div className="ml-auto flex w-24 items-center justify-end gap-2">
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <span className="block h-1 rounded-full bg-lime-600" style={{ width: `${farmer.share}%` }} />
                        </span>
                        <span className="w-8 text-right font-mono text-xs text-slate-500">{farmer.share}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{farmer.rate.toFixed(1)}</td>
                    <td className="px-3 py-3 text-right font-mono">{formatCurrency(farmer.amount)}</td>
                    <td className={`px-3 py-3 text-right font-mono ${farmer.due > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}`}>
                      {farmer.due > 0 ? formatCurrency(farmer.due) : '—'}
                    </td>
                    <td className="px-2 py-3 text-slate-400">
                      <button type="button" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} slips for ${farmer.name}`} onClick={event => { event.stopPropagation(); onToggle(farmer.id); }} className="rounded-md p-1 hover:bg-slate-200 dark:hover:bg-slate-700">
                        <ChevronDown size={15} className={`transition ${open ? 'rotate-180' : ''}`} />
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <td colSpan={10} className="bg-slate-50 px-4 py-3 dark:bg-slate-950/40">
                        <FarmerSlips farmer={farmer} onOpenSupplier={onOpenSupplier} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 text-sm font-semibold text-slate-900 dark:bg-slate-800/60 dark:text-white">
              <td className="px-3 py-3" colSpan={2}>{farmers.length} farmers</td>
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

      <div className="divide-y divide-slate-100 dark:divide-slate-800 lg:hidden">
        {farmers.map((farmer, index) => {
          const open = openIds.has(farmer.id);
          return (
            <div key={farmer.id}>
              <button type="button" onClick={() => onToggle(farmer.id)} className="flex w-full items-start gap-3 px-3 py-3 text-left">
                <span className="mt-0.5 w-4 font-mono text-xs text-slate-400">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-950 dark:text-white">{farmer.name}</span>
                  <span className="mt-0.5 block text-xs text-slate-400">{[farmer.village, farmer.slips.length === 1 ? '1 slip' : `${farmer.slips.length} slips`, `${farmer.share}%`].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="text-right">
                  <span className="block font-mono font-semibold text-slate-950 dark:text-white">{formatQty(farmer.liters)} L</span>
                  <span className="block font-mono text-xs text-slate-500">{formatCurrency(farmer.amount)}</span>
                  {farmer.due > 0 && <span className="block font-mono text-[11px] text-rose-600">{formatCurrency(farmer.due)} unpaid</span>}
                </span>
              </button>
              {open && (
                <div className="border-t border-slate-100 bg-slate-50 px-3 py-3 dark:border-slate-800 dark:bg-slate-950/40">
                  <FarmerSlips farmer={farmer} onOpenSupplier={onOpenSupplier} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FarmerSlips({ farmer, onOpenSupplier }: { farmer: FarmerRow; onOpenSupplier: (id: string) => void }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="text-slate-500">
          {Array.from(farmer.slips.reduce((map, slip) => map.set(slip.shift, (map.get(slip.shift) || 0) + slip.liters), new Map<string, number>())).map(([name, liters]) => `${name} ${formatQty(liters)} L`).join(' · ')}
          {farmer.phone && ` · ${farmer.phone}`}
          {farmer.balance !== 0 && ` · Running khata ${formatCurrency(farmer.balance)}`}
        </span>
        {farmer.id !== 'unknown' && (
          <button type="button" onClick={() => onOpenSupplier(farmer.id)} className="font-semibold text-lime-700 hover:underline dark:text-lime-400">
            Open khata
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-1 pr-3 font-semibold">When</th>
              <th className="py-1 pr-3 font-semibold">Shift</th>
              <th className="py-1 pr-3 font-semibold">Variety</th>
              <th className="py-1 pr-3 text-right font-semibold">Liters</th>
              <th className="py-1 pr-3 text-right font-semibold">Rate</th>
              <th className="py-1 pr-3 text-right font-semibold">Amount</th>
              <th className="py-1 text-right font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {farmer.slips.map(slip => (
              <tr key={slip.id} className="border-t border-slate-200/80 dark:border-slate-800">
                <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{prettyDate(slip.day)}{slip.time ? ` · ${slip.time}` : ''}</td>
                <td className="py-2 pr-3">{slip.shift}</td>
                <td className="py-2 pr-3">
                  <VarietyText variety={slip.variety} />
                  {slip.fat > 0 && <span className="ml-1 text-slate-400">Fat {slip.fat}</span>}
                </td>
                <td className="py-2 pr-3 text-right font-mono">{formatQty(slip.liters)}</td>
                <td className="py-2 pr-3 text-right font-mono">{slip.rate.toFixed(1)}</td>
                <td className="py-2 pr-3 text-right font-mono">{formatCurrency(slip.amount)}</td>
                <td className={`py-2 text-right font-semibold ${slip.due > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{settlementLabel(slip.paid, slip.due)}</td>
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
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-400 dark:border-slate-800">
            <tr>
              <th className="px-3 py-2.5 font-semibold">When</th>
              <th className="px-3 py-2.5 font-semibold">Farmer</th>
              <th className="px-3 py-2.5 font-semibold">Shift</th>
              <th className="px-3 py-2.5 font-semibold">Variety</th>
              <th className="px-3 py-2.5 text-right font-semibold">Liters</th>
              <th className="px-3 py-2.5 text-right font-semibold">Rate</th>
              <th className="px-3 py-2.5 text-right font-semibold">Amount</th>
              <th className="px-3 py-2.5 text-right font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {slips.map(slip => (
              <tr key={slip.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2.5 text-xs text-slate-500">{prettyDate(slip.day)}{slip.time ? ` · ${slip.time}` : ''}</td>
                <td className="px-3 py-2.5">
                  <button type="button" onClick={() => onOpenSupplier(slip.supplierId)} className="font-semibold text-slate-950 hover:text-lime-700 dark:text-white">
                    {slip.supplierName}
                  </button>
                  {slip.village && <p className="text-xs text-slate-400">{slip.village}</p>}
                </td>
                <td className="px-3 py-2.5 text-xs">{slip.shift}</td>
                <td className="px-3 py-2.5 text-xs"><VarietyText variety={slip.variety} /></td>
                <td className="px-3 py-2.5 text-right font-mono font-semibold">{formatQty(slip.liters)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs">{slip.rate.toFixed(1)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{formatCurrency(slip.amount)}</td>
                <td className={`px-3 py-2.5 text-right text-xs font-semibold ${slip.due > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {settlementLabel(slip.paid, slip.due)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-semibold dark:bg-slate-800/60">
              <td className="px-3 py-3" colSpan={4}>{slips.length} slips</td>
              <td className="px-3 py-3 text-right font-mono">{formatQty(totals.liters)}</td>
              <td />
              <td className="px-3 py-3 text-right font-mono">{formatCurrency(totals.amount)}</td>
              <td className="px-3 py-3 text-right font-mono text-rose-600">{formatCurrency(totals.due)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function VarietyText({ variety }: { variety: Variety }) {
  const tone = variety === 'buffalo' ? 'text-lime-700 dark:text-lime-400' : variety === 'cow' ? 'text-sky-700 dark:text-sky-400' : 'text-slate-600 dark:text-slate-300';
  return <span className={`font-semibold ${tone}`}>{varietyLabel(variety)}</span>;
}

export default MilkCollectionDetails;
