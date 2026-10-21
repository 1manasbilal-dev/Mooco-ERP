import React, { useEffect, useMemo, useRef } from 'react';
import {
  Search, X, Filter, ChevronLeft, ChevronRight, CalendarRange, Receipt, Wallet, CreditCard,
  BookUser, Bookmark, BookmarkPlus, Edit, Trash2, Zap, StickyNote, CalendarClock, PieChart, Plus, RotateCcw,
} from 'lucide-react';
import { RichSelect } from '../RichSelect';
import { ExpenseEntry, ExpenseVendor, SavedExpense } from '../../types';
import { CategoryStructure, ExpenseDateFilterMode } from './ExpenseTypes';
import { formatCurrency } from '../../lib/formatters';
import { PillGroup, PillOption, SettlementBar, StatTile } from '../procurement/ProcurementUI';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import { LoadMoreRow } from '../ui/LoadMoreRow';
import {
  CategoryBadge, EmptyState, FilterChip, PrimaryButton, StatusPill, ToolbarButton,
  categoryTone, dayHeading, dayKey, monthLabel, paidOf, pkToday,
} from './ExpenseUI';

export interface ExpenseStats {
  total: number;
  cash: number;
  digital: number;
  onCredit: number;
  vendorDues: number;
  vendorDueCount: number;
}

interface ExpenseTransactionsTabProps {
  filteredExpenses: ExpenseEntry[];
  expenseVendors: ExpenseVendor[];
  categoryTree: CategoryStructure[];
  stats: ExpenseStats;
  searchTerm: string;
  setSearchTerm: (s: string) => void;
  filterMonth: string;
  setFilterMonth: (m: string) => void;
  dateFilterMode: ExpenseDateFilterMode;
  setDateFilterMode: (m: ExpenseDateFilterMode) => void;
  filterSingleDate: string;
  setFilterSingleDate: (d: string) => void;
  filterStartDate: string;
  setFilterStartDate: (d: string) => void;
  filterEndDate: string;
  setFilterEndDate: (d: string) => void;
  filterCategory: string;
  setFilterCategory: (c: string) => void;
  filterVendor: string;
  setFilterVendor: (v: string) => void;
  filterPaymentStatus: string;
  setFilterPaymentStatus: (p: string) => void;
  isTxFilterOpen: boolean;
  setIsTxFilterOpen: React.Dispatch<React.SetStateAction<boolean>>;
  expandedExpenseRowId: string | null;
  setExpandedExpenseRowId: React.Dispatch<React.SetStateAction<string | null>>;
  canCreate: boolean;
  canDelete: boolean;
  canEdit: boolean;
  handleOpenAddModal: () => void;
  handleEditExpense: (exp: ExpenseEntry) => void;
  handleDeleteExpense: (id: string) => void;
  savedExpenses: SavedExpense[];
  onOpenSavedExpenses: () => void;
  onUseSaved: (preset: SavedExpense) => void;
  onSaveRecorded: (expense: ExpenseEntry) => void;
  onOpenVendor: (vendorId: string) => void;
  formatDateDisplay: (date: string) => string;
}

type PeriodPill = 'today' | 'yesterday' | '7days' | 'this_month' | 'last_month' | 'all' | 'custom';

const PERIODS: PillOption<PeriodPill>[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7days', label: '7 days' },
  { value: 'this_month', label: 'Month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
];

const STATUS_OPTIONS: PillOption<string>[] = [
  { value: 'All', label: 'All' },
  { value: 'Paid', label: 'Paid', dot: 'bg-emerald-500' },
  { value: 'Partial', label: 'Partial', dot: 'bg-amber-500' },
  { value: 'Unpaid', label: 'Credit', dot: 'bg-rose-500' },
];

const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
};

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)));
};

export const ExpenseTransactionsTab: React.FC<ExpenseTransactionsTabProps> = ({
  filteredExpenses,
  expenseVendors,
  categoryTree,
  stats,
  searchTerm,
  setSearchTerm,
  filterMonth,
  setFilterMonth,
  dateFilterMode,
  setDateFilterMode,
  filterSingleDate,
  setFilterSingleDate,
  filterStartDate,
  setFilterStartDate,
  filterEndDate,
  setFilterEndDate,
  filterCategory,
  setFilterCategory,
  filterVendor,
  setFilterVendor,
  filterPaymentStatus,
  setFilterPaymentStatus,
  isTxFilterOpen,
  setIsTxFilterOpen,
  expandedExpenseRowId,
  setExpandedExpenseRowId,
  canCreate,
  canDelete,
  canEdit,
  handleOpenAddModal,
  handleEditExpense,
  handleDeleteExpense,
  savedExpenses,
  onOpenSavedExpenses,
  onUseSaved,
  onSaveRecorded,
  onOpenVendor,
  formatDateDisplay,
}) => {
  const searchRef = useRef<HTMLInputElement>(null);
  const today = pkToday();
  const currentMonth = today.slice(0, 7);

  // Keyboard: "/" jumps to search, "N" records a new expense.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      if (document.querySelector('[data-app-modal]')) return;
      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      } else if ((event.key === 'n' || event.key === 'N') && canCreate) {
        event.preventDefault();
        handleOpenAddModal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canCreate, handleOpenAddModal]);

  const periodValue: PeriodPill = dateFilterMode === 'single_date' || dateFilterMode === 'custom_range'
    ? 'custom'
    : (dateFilterMode as PeriodPill);

  const setPeriod = (value: PeriodPill) => {
    if (value === 'custom') {
      setDateFilterMode('custom_range');
      return;
    }
    if (value === 'this_month') setFilterMonth(currentMonth);
    setDateFilterMode(value);
  };

  const periodText = (() => {
    switch (dateFilterMode) {
      case 'today': return 'Today';
      case 'yesterday': return 'Yesterday';
      case '7days': return 'Last 7 days';
      case '30days': return 'Last 30 days';
      case 'this_month': return filterMonth === currentMonth ? 'This month' : monthLabel(filterMonth);
      case 'last_month': return 'Last month';
      case 'single_date': return formatDateDisplay(filterSingleDate);
      case 'custom_range': return `${formatDateDisplay(filterStartDate)} – ${formatDateDisplay(filterEndDate)}`;
      default: return 'All time';
    }
  })();

  const vendorName = (id: string) => expenseVendors.find(v => v.id === id)?.name || 'Vendor';
  const extraFilterCount = [filterCategory !== 'All', filterVendor !== 'All', filterPaymentStatus !== 'All'].filter(Boolean).length;
  const isDefaultPeriod = dateFilterMode === 'this_month' && filterMonth === currentMonth;
  const hasAnyFilter = extraFilterCount > 0 || Boolean(searchTerm) || !isDefaultPeriod;

  const resetAll = () => {
    setDateFilterMode('this_month');
    setFilterMonth(currentMonth);
    setFilterSingleDate(today);
    setFilterStartDate(`${currentMonth}-01`);
    setFilterEndDate(today);
    setFilterCategory('All');
    setFilterVendor('All');
    setFilterPaymentStatus('All');
    setSearchTerm('');
  };

  // Newest first; same-day entries keep the most recently created on top.
  const sortedExpenses = useMemo(() => {
    return [...filteredExpenses].sort((a, b) => {
      const byDay = dayKey(b.date).localeCompare(dayKey(a.date));
      if (byDay !== 0) return byDay;
      return String(b.created_at || b.date || '').localeCompare(String(a.created_at || a.date || ''));
    });
  }, [filteredExpenses]);

  const listWindow = useProgressiveList<ExpenseEntry>(sortedExpenses, 60, `${dateFilterMode}|${filterMonth}|${filterCategory}|${filterVendor}|${filterPaymentStatus}|${searchTerm}`);

  const dayGroups = useMemo(() => {
    const totals = new Map<string, { total: number; count: number }>();
    sortedExpenses.forEach(exp => {
      const key = dayKey(exp.date);
      const entry = totals.get(key) || { total: 0, count: 0 };
      entry.total += Number(exp.amount || 0);
      entry.count += 1;
      totals.set(key, entry);
    });
    const groups: { day: string; items: ExpenseEntry[]; total: number; count: number }[] = [];
    listWindow.visibleItems.forEach(exp => {
      const key = dayKey(exp.date);
      let group = groups[groups.length - 1];
      if (!group || group.day !== key) {
        const meta = totals.get(key) || { total: 0, count: 0 };
        group = { day: key, items: [], ...meta };
        groups.push(group);
      }
      group.items.push(exp);
    });
    return groups;
  }, [sortedExpenses, listWindow.visibleItems]);

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; amount: number; count: number }>();
    filteredExpenses.forEach(exp => {
      const name = exp.category || 'Uncategorised';
      const entry = map.get(name) || { name, amount: 0, count: 0 };
      entry.amount += Number(exp.amount || 0);
      entry.count += 1;
      map.set(name, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [filteredExpenses]);

  const statusSplit = useMemo(() => {
    const split = { Paid: { count: 0, amount: 0 }, Partial: { count: 0, amount: 0 }, Unpaid: { count: 0, amount: 0 } };
    filteredExpenses.forEach(exp => {
      const status = (exp.paymentStatus || 'Paid') as keyof typeof split;
      if (!split[status]) return;
      split[status].count += 1;
      split[status].amount += Number(exp.amount || 0);
    });
    return split;
  }, [filteredExpenses]);

  const paidTotal = stats.cash + stats.digital;
  const daysInView = new Set(filteredExpenses.map(exp => dayKey(exp.date))).size;
  const topCategories = categoryBreakdown.slice(0, 6);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile
          icon={Receipt}
          tone="rose"
          label={`Spent · ${periodText}`}
          value={formatCurrency(stats.total)}
          hint={filteredExpenses.length ? `${filteredExpenses.length} entries · ${formatCurrency(Math.round(stats.total / Math.max(1, daysInView)))}/day` : 'No entries yet'}
        />
        <StatTile
          icon={Wallet}
          tone="amber"
          label="Paid in cash"
          value={formatCurrency(stats.cash)}
          hint={paidTotal > 0 ? `${Math.round((stats.cash / paidTotal) * 100)}% of paid` : 'Cash drawer'}
        />
        <StatTile
          icon={CreditCard}
          tone="cyan"
          label="Paid digital"
          value={formatCurrency(stats.digital)}
          hint={paidTotal > 0 ? `${Math.round((stats.digital / paidTotal) * 100)}% · bank & wallets` : 'Bank & wallets'}
        />
        <StatTile
          icon={BookUser}
          tone="rose"
          valueTone={stats.vendorDues > 0 ? 'rose' : undefined}
          label="Vendor khata"
          value={formatCurrency(stats.vendorDues)}
          hint={stats.vendorDueCount > 0 ? `${stats.vendorDueCount} vendors to pay${stats.onCredit > 0 ? ` · ${formatCurrency(stats.onCredit)} new` : ''}` : 'All vendors settled'}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-2.5 shadow-xs print:hidden">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search description, vendor, sub-category…"
              className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-14 text-xs font-semibold text-slate-800 outline-none transition-colors placeholder:font-medium placeholder:text-slate-400 focus:border-lime-500 focus:bg-white"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setSearchTerm(''); (e.target as HTMLInputElement).blur(); } }}
            />
            {searchTerm ? (
              <button type="button" aria-label="Search saaf karein" onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                <X size={13} />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 text-[10px] font-bold text-slate-400 sm:block">/</kbd>
            )}
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1 overflow-x-auto scrollbar-hide lg:flex-initial">
              <PillGroup label="Period" options={PERIODS} value={periodValue} onChange={setPeriod} size="sm" className="w-max min-w-full" />
            </div>
            <ToolbarButton active={isTxFilterOpen || extraFilterCount > 0} onClick={() => setIsTxFilterOpen(open => !open)} aria-expanded={isTxFilterOpen}>
              <Filter size={14} />
              <span className="hidden sm:inline">Filters</span>
              {extraFilterCount > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-lime-600 px-1 text-[10px] font-black text-white">{extraFilterCount}</span>}
            </ToolbarButton>
          </div>
        </div>

        {(dateFilterMode === 'this_month' || periodValue === 'custom') && (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
            {dateFilterMode === 'this_month' && (
              <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-0.5">
                <button type="button" aria-label="Pichla mahina" onClick={() => setFilterMonth(shiftMonth(filterMonth, -1))} className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-900">
                  <ChevronLeft size={14} />
                </button>
                <label className="relative cursor-pointer px-1.5 text-xs font-bold text-slate-800">
                  {monthLabel(filterMonth)}
                  <input type="month" value={filterMonth} onChange={e => e.target.value && setFilterMonth(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Mahina chunein" />
                </label>
                <button type="button" aria-label="Agla mahina" disabled={filterMonth >= currentMonth} onClick={() => setFilterMonth(shiftMonth(filterMonth, 1))} className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-30">
                  <ChevronRight size={14} />
                </button>
              </div>
            )}

            {periodValue === 'custom' && (
              <>
                <PillGroup
                  label="Custom date type"
                  size="sm"
                  value={dateFilterMode === 'single_date' ? 'single_date' : 'custom_range'}
                  onChange={value => setDateFilterMode(value)}
                  options={[{ value: 'custom_range', label: 'Range' }, { value: 'single_date', label: 'One day' }]}
                />
                {dateFilterMode === 'single_date' ? (
                  <input type="date" value={filterSingleDate} max={today} onChange={e => setFilterSingleDate(e.target.value)} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-800 outline-none focus:border-lime-500" />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <CalendarRange size={14} className="text-slate-400" />
                    <input type="date" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)} aria-label="Kab se" className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-800 outline-none focus:border-lime-500" />
                    <span className="text-xs text-slate-400">to</span>
                    <input type="date" value={filterEndDate} onChange={e => setFilterEndDate(e.target.value)} aria-label="Kab tak" className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-800 outline-none focus:border-lime-500" />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {isTxFilterOpen && (
          <div className="mt-2 grid gap-2 border-t border-slate-100 pt-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] animate-in fade-in slide-in-from-top-1 duration-150">
            <RichSelect
              options={[
                { value: 'All', label: 'All categories' },
                ...categoryTree.map(c => ({ value: c.name, label: c.name, subLabel: c.isActive ? `${c.subcategories.length} sub-categories` : 'Disabled' })),
              ]}
              value={filterCategory}
              onChange={val => setFilterCategory(val || 'All')}
              allowClear={false}
              placeholder="All categories"
              searchPlaceholder="Search category…"
            />
            <RichSelect
              options={[
                { value: 'All', label: 'All vendors' },
                ...expenseVendors.map(v => ({
                  value: v.id,
                  label: v.name,
                  subLabel: v.service_type || 'Vendor',
                  avatarLetter: v.name.charAt(0).toUpperCase(),
                  badge: (v.pending_balance || 0) > 0 ? { text: formatCurrency(v.pending_balance), variant: 'red' as const } : undefined,
                })),
              ]}
              value={filterVendor}
              onChange={val => setFilterVendor(val || 'All')}
              allowClear={false}
              placeholder="All vendors"
              searchPlaceholder="Search vendor…"
            />
            <PillGroup label="Payment status" options={STATUS_OPTIONS} value={filterPaymentStatus} onChange={setFilterPaymentStatus} size="sm" className="sm:col-span-2 lg:col-span-1" />
          </div>
        )}

        {hasAnyFilter && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
            {!isDefaultPeriod && <FilterChip label={periodText} onClear={() => { setDateFilterMode('this_month'); setFilterMonth(currentMonth); }} />}
            {filterCategory !== 'All' && <FilterChip label={filterCategory} onClear={() => setFilterCategory('All')} />}
            {filterVendor !== 'All' && <FilterChip label={vendorName(filterVendor)} onClear={() => setFilterVendor('All')} />}
            {filterPaymentStatus !== 'All' && <FilterChip label={filterPaymentStatus === 'Unpaid' ? 'On credit' : filterPaymentStatus} onClear={() => setFilterPaymentStatus('All')} />}
            {searchTerm && <FilterChip label={`“${searchTerm}”`} onClear={() => setSearchTerm('')} />}
            <button type="button" onClick={resetAll} className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100 hover:text-rose-600">
              <RotateCcw size={11} /> Reset
            </button>
          </div>
        )}
      </div>

      {(savedExpenses.length > 0 || topCategories.length > 1) && (
        <div className="space-y-2 xl:hidden print:hidden">
          {canCreate && savedExpenses.length > 0 && (
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 scrollbar-hide">
              <span className="flex shrink-0 items-center gap-1 pr-1 text-[10px] font-bold uppercase tracking-wider text-slate-400"><Zap size={12} className="text-amber-500" /> Quick</span>
              {savedExpenses.slice(0, 8).map(preset => (
                <button key={preset.id} type="button" onClick={() => onUseSaved(preset)} className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-xs active:scale-95">
                  <CategoryBadge name={preset.category} size="sm" />
                  <span className="max-w-[9rem] truncate">{preset.name}</span>
                  <span className="font-mono text-[11px] font-bold text-slate-500">{formatCurrency(preset.amount)}</span>
                </button>
              ))}
            </div>
          )}
          {topCategories.length > 1 && (
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 scrollbar-hide">
              {topCategories.map(cat => {
                const selected = filterCategory === cat.name;
                return (
                  <button key={cat.name} type="button" onClick={() => setFilterCategory(selected ? 'All' : cat.name)} className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${selected ? 'border-lime-500 bg-lime-50 text-lime-800' : 'border-slate-200 bg-white text-slate-600'}`}>
                    <span className={`h-2 w-2 rounded-full ${categoryTone(cat.name).bar}`} />
                    {cat.name}
                    <span className="font-mono font-bold text-slate-400">{stats.total > 0 ? Math.round((cat.amount / stats.total) * 100) : 0}%</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section aria-label="Expense entries" className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          {sortedExpenses.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title={hasAnyFilter ? 'No expenses match these filters' : 'No expenses this month yet'}
              hint={hasAnyFilter ? 'Try another period or clear the filters.' : 'Record diesel, rent, salaries or any bill. Press N to start.'}
              action={hasAnyFilter
                ? <button type="button" onClick={resetAll} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Clear filters</button>
                : canCreate && <PrimaryButton onClick={handleOpenAddModal}><Plus size={14} /> Record expense</PrimaryButton>}
            />
          ) : (
            <>
              <div className="hidden grid-cols-[minmax(0,1fr)_150px_130px_96px] gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 2xl:grid">
                <span>Expense</span>
                <span>Paid from</span>
                <span className="text-right">Amount</span>
                <span className="text-right print:hidden">Actions</span>
              </div>

              {dayGroups.map(group => {
                const heading = dayHeading(group.day);
                return (
                  <div key={group.day}>
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-1.5">
                      <span className="text-[11px] font-bold text-slate-700">
                        {heading.title}
                        {heading.sub && <span className="ml-1.5 font-medium text-slate-400">{heading.sub}</span>}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500">
                        {group.count} · <span className="font-mono font-bold text-slate-800">{formatCurrency(group.total)}</span>
                      </span>
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {group.items.map(exp => (
                        <ExpenseRow
                          key={exp.id}
                          exp={exp}
                          expanded={expandedExpenseRowId === exp.id}
                          onToggle={() => setExpandedExpenseRowId(current => current === exp.id ? null : exp.id)}
                          canEdit={canEdit}
                          canDelete={canDelete}
                          canCreate={canCreate}
                          onEdit={() => handleEditExpense(exp)}
                          onDelete={() => handleDeleteExpense(exp.id)}
                          onBookmark={() => onSaveRecorded(exp)}
                          onOpenVendor={exp.vendor_id && expenseVendors.some(v => v.id === exp.vendor_id) ? () => onOpenVendor(exp.vendor_id!) : undefined}
                          formatDateDisplay={formatDateDisplay}
                        />
                      ))}
                    </ul>
                  </div>
                );
              })}
              <LoadMoreRow sentinelRef={listWindow.sentinelRef} hiddenCount={listWindow.hiddenCount} onShowMore={listWindow.showMore} onShowAll={listWindow.showAll} />
              <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-xs">
                <span className="font-semibold text-slate-500">{sortedExpenses.length} entries · {periodText}</span>
                <span className="font-mono font-black text-slate-900">{formatCurrency(stats.total)}</span>
              </div>
            </>
          )}
        </section>

        <aside className="hidden space-y-4 xl:block print:hidden">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-800"><PieChart size={14} className="text-rose-500" /> Where it went</h3>
              <span className="text-[10px] font-semibold text-slate-400">{periodText}</span>
            </div>
            {categoryBreakdown.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400">Nothing spent in this period.</p>
            ) : (
              <ul className="space-y-1">
                {topCategories.map(cat => {
                  const pct = stats.total > 0 ? (cat.amount / stats.total) * 100 : 0;
                  const selected = filterCategory === cat.name;
                  return (
                    <li key={cat.name}>
                      <button
                        type="button"
                        onClick={() => setFilterCategory(selected ? 'All' : cat.name)}
                        aria-pressed={selected}
                        className={`w-full rounded-xl px-2 py-1.5 text-left transition-colors ${selected ? 'bg-lime-50 ring-1 ring-lime-300' : 'hover:bg-slate-50'}`}
                      >
                        <div className="flex items-center gap-2">
                          <CategoryBadge name={cat.name} size="sm" />
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">{cat.name}</span>
                          <span className="font-mono text-xs font-bold text-slate-900">{formatCurrency(cat.amount)}</span>
                        </div>
                        <div className="ml-9 mt-1 flex items-center gap-2">
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <span className={`block h-full rounded-full ${categoryTone(cat.name).bar}`} style={{ width: `${Math.max(2, pct)}%` }} />
                          </span>
                          <span className="w-8 text-right text-[10px] font-bold text-slate-400">{Math.round(pct)}%</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {categoryBreakdown.length > topCategories.length && (
              <p className="mt-2 px-2 text-[11px] text-slate-400">+{categoryBreakdown.length - topCategories.length} more categories</p>
            )}

            {filteredExpenses.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-slate-100 pt-3">
                {(['Paid', 'Partial', 'Unpaid'] as const).map(status => {
                  const selected = filterPaymentStatus === status;
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setFilterPaymentStatus(selected ? 'All' : status)}
                      className={`rounded-xl border px-2 py-1.5 text-left transition-colors ${selected ? 'border-lime-400 bg-lime-50' : 'border-slate-200 hover:bg-slate-50'}`}
                    >
                      <StatusPill status={status} className="!px-1.5" />
                      <p className="mt-1 font-mono text-[11px] font-bold text-slate-800">{statusSplit[status].count}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {canCreate && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-800"><Zap size={14} className="text-amber-500" /> Quick record</h3>
                <button type="button" onClick={onOpenSavedExpenses} className="text-[11px] font-bold text-lime-700 hover:text-lime-800">Manage</button>
              </div>
              {savedExpenses.length === 0 ? (
                <p className="rounded-xl bg-slate-50 px-3 py-3 text-[11px] leading-relaxed text-slate-500">
                  Bookmark any entry (<BookmarkPlus size={11} className="inline" />) or tick “Save for next time” to re-record it in one tap.
                </p>
              ) : (
                <ul className="space-y-1">
                  {savedExpenses.slice(0, 5).map(preset => (
                    <li key={preset.id}>
                      <button type="button" onClick={() => onUseSaved(preset)} className="group flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-slate-50">
                        <CategoryBadge name={preset.category} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-slate-800">{preset.name}</span>
                          <span className="block truncate text-[10px] text-slate-400">{preset.vendor_name || preset.category}</span>
                        </span>
                        <span className="font-mono text-xs font-bold text-slate-700">{formatCurrency(preset.amount)}</span>
                        <Plus size={13} className="text-slate-300 group-hover:text-lime-600" />
                      </button>
                    </li>
                  ))}
                  {savedExpenses.length > 5 && (
                    <li>
                      <button type="button" onClick={onOpenSavedExpenses} className="flex w-full items-center justify-center gap-1 rounded-xl px-2 py-1.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50">
                        <Bookmark size={12} /> {savedExpenses.length - 5} more saved
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}

          <p className="px-1 text-[11px] text-slate-400">
            Shortcuts: <kbd className="rounded border border-slate-200 bg-white px-1 font-bold">N</kbd> new expense · <kbd className="rounded border border-slate-200 bg-white px-1 font-bold">/</kbd> search
          </p>
        </aside>
      </div>
    </div>
  );
};

const ExpenseRow: React.FC<{
  exp: ExpenseEntry;
  expanded: boolean;
  onToggle: () => void;
  canEdit: boolean;
  canDelete: boolean;
  canCreate: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onBookmark: () => void;
  onOpenVendor?: () => void;
  formatDateDisplay: (date: string) => string;
}> = ({ exp, expanded, onToggle, canEdit, canDelete, canCreate, onEdit, onDelete, onBookmark, onOpenVendor, formatDateDisplay }) => {
  const status = exp.paymentStatus || 'Paid';
  const paid = paidOf(exp);
  const due = Math.max(0, Number(exp.amount || 0) - paid);
  const tone = categoryTone(exp.category);
  const mode = exp.paymentMode || (exp as any).payment_mode || 'Cash';
  const ModeIcon = mode === 'Cash' ? Wallet : CreditCard;

  const actions = (
    <>
      {canCreate && (
        <button type="button" aria-label="Quick record ke liye save karein" title="Save for quick record" onClick={e => { e.stopPropagation(); onBookmark(); }} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-amber-50 hover:text-amber-600">
          <BookmarkPlus size={14} />
        </button>
      )}
      {canEdit && (
        <button type="button" aria-label="Edit karein" title="Edit" onClick={e => { e.stopPropagation(); onEdit(); }} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-lime-50 hover:text-lime-700">
          <Edit size={14} />
        </button>
      )}
      {canDelete && (
        <button type="button" aria-label="Delete karein" title="Delete" onClick={e => { e.stopPropagation(); onDelete(); }} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
          <Trash2 size={14} />
        </button>
      )}
    </>
  );

  return (
    <li className={`group ${expanded ? 'bg-slate-50/60' : ''}`}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className="flex cursor-pointer items-center gap-3 px-4 py-2.5 outline-none transition-colors hover:bg-slate-50 focus-visible:bg-lime-50/60 2xl:grid 2xl:grid-cols-[minmax(0,1fr)_150px_130px_96px]"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <CategoryBadge name={exp.category} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-slate-900">{exp.description || exp.category}</p>
            <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-slate-500">
              <span className={`truncate font-semibold ${tone.text}`}>{exp.category}</span>
              {exp.subcategory && (
                <>
                  <ChevronRight size={10} className="shrink-0 text-slate-300" />
                  <span className="truncate">{exp.subcategory}</span>
                </>
              )}
              {exp.vendor_name && (
                <>
                  <span className="shrink-0 text-slate-300">·</span>
                  {onOpenVendor ? (
                    <button type="button" onClick={e => { e.stopPropagation(); onOpenVendor(); }} title="Vendor khata kholein" className="truncate font-semibold text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-lime-700 hover:decoration-lime-500">
                      {exp.vendor_name}
                    </button>
                  ) : (
                    <span className="truncate font-semibold text-slate-700">{exp.vendor_name}</span>
                  )}
                </>
              )}
            </p>
          </div>
        </div>

        <div className="hidden min-w-0 items-center gap-1.5 text-[11px] text-slate-500 2xl:flex">
          {paid > 0 ? (
            <>
              <ModeIcon size={13} className="shrink-0 text-slate-400" />
              <span className="truncate">{exp.account_name || mode}</span>
            </>
          ) : (
            <span className="truncate font-semibold text-rose-600">Vendor khata</span>
          )}
        </div>

        <div className="shrink-0 text-right">
          <p className="font-mono text-[13px] font-black tabular-nums text-slate-900">{formatCurrency(exp.amount)}</p>
          {status !== 'Paid' ? (
            <p className="mt-0.5 text-[10px] font-bold text-rose-600">{formatCurrency(due)} baqi</p>
          ) : (
            <p className="mt-0.5 text-[10px] font-semibold text-slate-400 2xl:hidden">{mode}</p>
          )}
        </div>

        <div className="hidden justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 2xl:flex print:hidden">
          {actions}
        </div>
      </div>

      {expanded && (
        <div className="grid gap-3 px-4 pb-3 pl-16 text-xs animate-in fade-in slide-in-from-top-1 duration-150 sm:grid-cols-2">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <StatusPill status={status} />
              {exp.dueDate && status !== 'Paid' && (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-700"><CalendarClock size={12} /> Due {formatDateDisplay(exp.dueDate)}</span>
              )}
            </div>
            {status !== 'Paid' && <SettlementBar total={Number(exp.amount || 0)} paid={paid} formatMoney={formatCurrency} />}
            <p className="text-[11px] text-slate-500">
              {paid > 0 ? <>Paid {formatCurrency(paid)} by {mode}{exp.account_name ? ` from ${exp.account_name}` : ''}</> : 'Nothing paid yet — full amount is on the vendor khata.'}
            </p>
            {exp.notes && (
              <p className="flex items-start gap-1.5 rounded-lg bg-amber-50/70 px-2 py-1.5 text-[11px] text-amber-900"><StickyNote size={12} className="mt-0.5 shrink-0" />{exp.notes}</p>
            )}
          </div>
          <div className="flex items-end justify-between gap-2 sm:justify-end">
            <span className="text-[10px] font-mono text-slate-400 sm:hidden">#{(exp.referenceNo || exp.id).slice(-6).toUpperCase()}</span>
            <div className="flex gap-1 2xl:hidden">{actions}</div>
            <span className="hidden text-[10px] font-mono text-slate-400 sm:block">Ref #{(exp.referenceNo || exp.id).slice(-6).toUpperCase()}</span>
          </div>
        </div>
      )}
    </li>
  );
};
