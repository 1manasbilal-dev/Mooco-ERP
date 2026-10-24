import React, { useEffect, useMemo, useRef } from 'react';
import {
  Filter, ChevronLeft, ChevronRight, CalendarRange, Receipt, Wallet, CreditCard,
  BookUser, Bookmark, BookmarkPlus, Edit, Trash2, Zap, StickyNote, CalendarClock, PieChart, Plus, RotateCcw,
} from 'lucide-react';
import { RichSelect } from '../RichSelect';
import { ExpenseEntry, ExpenseVendor, SavedExpense } from '../../types';
import { CategoryStructure, ExpenseDateFilterMode } from './ExpenseTypes';
import { formatCurrency } from '../../lib/formatters';
import { cn } from '../../lib/cn';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import {
  Button, Card, EmptyState, IconButton, Input, Kbd, LoadMoreRow, Money, SearchInput, SegmentedControl, StatCard, Toolbar,
} from '../ui';
import type { SegmentOption } from '../ui';
import {
  CategoryBadge, DayHeader, Dot, FilterChip, STATUS_META, SettlementBar, StatusPill,
  categoryTone, dayKey, monthLabel, paidOf, pkToday, plural,
} from './ExpenseUI';
import { useStableHandler } from './useStableHandler';

export interface ExpenseStats {
  total: number;
  cash: number;
  digital: number;
  onCredit: number;
  vendorDues: number;
  vendorDueCount: number;
  /** Change in spend versus the previous period of the same length, in percent. */
  trend?: number | null;
  trendLabel?: string;
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
  /** Opens the vendors tab filtered to vendors we owe. */
  onShowVendorDues?: () => void;
  formatDateDisplay: (date: string) => string;
}

type PeriodPill = 'today' | 'yesterday' | '7days' | 'this_month' | 'last_month' | 'all' | 'custom';

const PERIODS: SegmentOption<PeriodPill>[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7days', label: '7 days' },
  { value: 'this_month', label: 'Month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
];

const STATUS_OPTIONS: SegmentOption<string>[] = [
  { value: 'All', label: 'All' },
  { value: 'Paid', label: 'Paid', icon: <Dot className="bg-success" /> },
  { value: 'Partial', label: 'Partial', icon: <Dot className="bg-warning" /> },
  { value: 'Unpaid', label: 'Credit', icon: <Dot className="bg-danger" /> },
];

const CUSTOM_KIND: SegmentOption<'custom_range' | 'single_date'>[] = [
  { value: 'custom_range', label: 'Range' },
  { value: 'single_date', label: 'One day' },
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

/** Stat-card money: one size smaller on phones so two cards fit side by side. */
const StatMoney: React.FC<{ amount: number }> = ({ amount }) => <Money amount={amount} className="text-xl sm:text-2xl lg:text-[28px]" />;

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
  onShowVendorDues,
  formatDateDisplay,
}) => {
  const searchRef = useRef<HTMLInputElement>(null);
  const today = pkToday();
  const currentMonth = today.slice(0, 7);

  // Stable identities so the memoised rows only re-render when their own entry changes.
  const openAdd = useStableHandler(handleOpenAddModal);
  const onEdit = useStableHandler(handleEditExpense);
  const onDelete = useStableHandler(handleDeleteExpense);
  const onBookmark = useStableHandler(onSaveRecorded);
  const onVendor = useStableHandler(onOpenVendor);
  const formatDate = useStableHandler(formatDateDisplay);
  const onToggle = useStableHandler((id: string) => setExpandedExpenseRowId(current => (current === id ? null : id)));

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
        openAdd();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canCreate, openAdd]);

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

  const vendorIds = useMemo(() => new Set(expenseVendors.map(v => v.id)), [expenseVendors]);
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

  const listWindow = useProgressiveList<ExpenseEntry>(sortedExpenses, 50, `${dateFilterMode}|${filterMonth}|${filterSingleDate}|${filterStartDate}|${filterEndDate}|${filterCategory}|${filterVendor}|${filterPaymentStatus}|${searchTerm}`);

  // Day totals cover the whole day, even when only part of it is rendered yet.
  const dayTotals = useMemo(() => {
    const totals = new Map<string, { total: number; count: number }>();
    sortedExpenses.forEach(exp => {
      const key = dayKey(exp.date);
      const entry = totals.get(key) || { total: 0, count: 0 };
      entry.total += Number(exp.amount || 0);
      entry.count += 1;
      totals.set(key, entry);
    });
    return totals;
  }, [sortedExpenses]);

  const dayGroups = useMemo(() => {
    const groups: { day: string; items: ExpenseEntry[]; total: number; count: number }[] = [];
    listWindow.visibleItems.forEach(exp => {
      const key = dayKey(exp.date);
      let group = groups[groups.length - 1];
      if (!group || group.day !== key) {
        group = { day: key, items: [], ...(dayTotals.get(key) || { total: 0, count: 0 }) };
        groups.push(group);
      }
      group.items.push(exp);
    });
    return groups;
  }, [dayTotals, listWindow.visibleItems]);

  const { categoryBreakdown, statusSplit, daysInView } = useMemo(() => {
    const map = new Map<string, { name: string; amount: number; count: number }>();
    const split = { Paid: { count: 0, amount: 0 }, Partial: { count: 0, amount: 0 }, Unpaid: { count: 0, amount: 0 } };
    const days = new Set<string>();
    filteredExpenses.forEach(exp => {
      const name = exp.category || 'Uncategorised';
      const entry = map.get(name) || { name, amount: 0, count: 0 };
      entry.amount += Number(exp.amount || 0);
      entry.count += 1;
      map.set(name, entry);
      const status = (exp.paymentStatus || 'Paid') as keyof typeof split;
      if (split[status]) {
        split[status].count += 1;
        split[status].amount += Number(exp.amount || 0);
      }
      days.add(dayKey(exp.date));
    });
    return {
      categoryBreakdown: Array.from(map.values()).sort((a, b) => b.amount - a.amount),
      statusSplit: split,
      daysInView: days.size,
    };
  }, [filteredExpenses]);

  const paidTotal = stats.cash + stats.digital;
  const topCategories = categoryBreakdown.slice(0, 6);

  const categoryOptions = useMemo(() => [
    { value: 'All', label: 'All categories' },
    ...categoryTree.map(c => ({ value: c.name, label: c.name, subLabel: c.isActive ? `${c.subcategories.length} sub-categories` : 'Disabled' })),
  ], [categoryTree]);

  const vendorOptions = useMemo(() => [
    { value: 'All', label: 'All vendors' },
    ...expenseVendors.map(v => ({
      value: v.id,
      label: v.name,
      subLabel: v.service_type || 'Vendor',
      avatarLetter: v.name.charAt(0).toUpperCase(),
      badge: (v.pending_balance || 0) > 0 ? { text: formatCurrency(v.pending_balance), variant: 'red' as const } : undefined,
    })),
  ], [expenseVendors]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<Receipt />}
          tone="brand"
          label={<>Spent<span className="hidden sm:inline"> · {periodText}</span></>}
          value={<StatMoney amount={stats.total} />}
          trend={stats.trend}
          trendGoodWhen="down"
          trendLabel={stats.trendLabel}
          hint={filteredExpenses.length ? `${filteredExpenses.length} entries · ${formatCurrency(Math.round(stats.total / Math.max(1, daysInView)))}/day` : 'No entries yet'}
        />
        <StatCard
          icon={<Wallet />}
          label="Paid in cash"
          value={<StatMoney amount={stats.cash} />}
          hint={paidTotal > 0 ? `${Math.round((stats.cash / paidTotal) * 100)}% of paid` : 'Cash drawer'}
        />
        <StatCard
          icon={<CreditCard />}
          tone="info"
          label="Paid digital"
          value={<StatMoney amount={stats.digital} />}
          hint={paidTotal > 0 ? `${Math.round((stats.digital / paidTotal) * 100)}% · bank & wallets` : 'Bank & wallets'}
        />
        <StatCard
          icon={<BookUser />}
          tone={stats.vendorDues > 0 ? 'danger' : 'success'}
          label="Vendor ledger"
          value={<StatMoney amount={stats.vendorDues} />}
          onClick={onShowVendorDues}
          hint={stats.vendorDueCount > 0 ? `${plural(stats.vendorDueCount, 'vendor')} to pay${stats.onCredit > 0 ? ` · ${formatCurrency(stats.onCredit)} new` : ''}` : 'All vendors settled'}
        />
      </div>

      <Toolbar className="print:hidden">
        <SearchInput
          ref={searchRef}
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search description, vendor, category…"
          shortcut="/"
          aria-label="Search expenses"
          className="min-w-0 flex-1 basis-full sm:basis-64"
        />
        <div className="flex min-w-0 max-w-full flex-1 items-center gap-2 sm:flex-initial">
          <SegmentedControl aria-label="Period" options={PERIODS} value={periodValue} onChange={setPeriod} className="min-w-0 flex-1 sm:flex-initial" />
          <Button
            variant={isTxFilterOpen || extraFilterCount > 0 ? 'soft' : 'secondary'}
            leftIcon={<Filter />}
            onClick={() => setIsTxFilterOpen(open => !open)}
            aria-expanded={isTxFilterOpen}
            aria-label="Filters"
            className="shrink-0 px-3"
          >
            <span className="hidden sm:inline">Filters</span>
            {extraFilterCount > 0 && <span className="flex size-5 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-brand-on">{extraFilterCount}</span>}
          </Button>
        </div>

        {(dateFilterMode === 'this_month' || periodValue === 'custom') && (
          <div className="flex w-full flex-wrap items-center gap-2 border-t border-line px-1 pt-2">
            {dateFilterMode === 'this_month' && (
              <div className="flex items-center gap-0.5 rounded-control bg-surface-2 p-1 ring-1 ring-inset ring-line/70">
                <IconButton size="sm" aria-label="Previous month" icon={<ChevronLeft />} onClick={() => setFilterMonth(shiftMonth(filterMonth, -1))} />
                <label className="relative flex h-8 min-w-[5.5rem] cursor-pointer items-center justify-center rounded-lg px-2 text-xs font-bold text-fg hover:bg-surface">
                  {monthLabel(filterMonth)}
                  <input type="month" value={filterMonth} max={currentMonth} onChange={e => e.target.value && setFilterMonth(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Choose month" />
                </label>
                <IconButton size="sm" aria-label="Next month" icon={<ChevronRight />} disabled={filterMonth >= currentMonth} onClick={() => setFilterMonth(shiftMonth(filterMonth, 1))} />
              </div>
            )}

            {periodValue === 'custom' && (
              <>
                <SegmentedControl
                  aria-label="Custom date type"
                  size="sm"
                  value={dateFilterMode === 'single_date' ? 'single_date' : 'custom_range'}
                  onChange={value => setDateFilterMode(value)}
                  options={CUSTOM_KIND}
                />
                {dateFilterMode === 'single_date' ? (
                  <Input inputSize="sm" type="date" value={filterSingleDate} max={today} onChange={e => setFilterSingleDate(e.target.value)} aria-label="Choose day" className="w-auto" />
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CalendarRange size={14} className="text-fg-faint" aria-hidden="true" />
                    <Input inputSize="sm" type="date" value={filterStartDate} max={filterEndDate || today} onChange={e => setFilterStartDate(e.target.value)} aria-label="From date" className="w-auto" />
                    <span className="text-xs text-fg-subtle">to</span>
                    <Input inputSize="sm" type="date" value={filterEndDate} min={filterStartDate || undefined} onChange={e => setFilterEndDate(e.target.value)} aria-label="To date" className="w-auto" />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {isTxFilterOpen && (
          <div className="grid w-full gap-2 border-t border-line px-1 pt-2 animate-in fade-in slide-in-from-top-1 duration-150 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
            <RichSelect
              options={categoryOptions}
              value={filterCategory}
              onChange={val => setFilterCategory(val || 'All')}
              allowClear={false}
              placeholder="All categories"
              searchPlaceholder="Search category…"
            />
            <RichSelect
              options={vendorOptions}
              value={filterVendor}
              onChange={val => setFilterVendor(val || 'All')}
              allowClear={false}
              placeholder="All vendors"
              searchPlaceholder="Search vendor…"
            />
            <SegmentedControl aria-label="Payment status" options={STATUS_OPTIONS} value={filterPaymentStatus} onChange={setFilterPaymentStatus} className="sm:col-span-2 lg:col-span-1" />
          </div>
        )}

        {hasAnyFilter && (
          <div className="flex w-full flex-wrap items-center gap-1.5 border-t border-line px-1 pt-2">
            {!isDefaultPeriod && <FilterChip label={periodText} onClear={() => { setDateFilterMode('this_month'); setFilterMonth(currentMonth); }} />}
            {filterCategory !== 'All' && <FilterChip label={filterCategory} onClear={() => setFilterCategory('All')} />}
            {filterVendor !== 'All' && <FilterChip label={vendorName(filterVendor)} onClear={() => setFilterVendor('All')} />}
            {filterPaymentStatus !== 'All' && <FilterChip label={filterPaymentStatus === 'Unpaid' ? 'On credit' : filterPaymentStatus} onClear={() => setFilterPaymentStatus('All')} />}
            {searchTerm && <FilterChip label={`“${searchTerm}”`} onClear={() => setSearchTerm('')} />}
            <Button variant="ghost" size="sm" leftIcon={<RotateCcw />} onClick={resetAll} className="ml-auto">Reset</Button>
          </div>
        )}
      </Toolbar>

      {((canCreate && savedExpenses.length > 0) || topCategories.length > 1) && (
        <div className="flex flex-col gap-2 xl:hidden print:hidden">
          {canCreate && savedExpenses.length > 0 && (
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 scrollbar-hide">
              <span className="flex shrink-0 items-center gap-1 pr-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle"><Zap size={12} className="text-warning" /> Quick</span>
              {savedExpenses.slice(0, 8).map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onUseSaved(preset)}
                  className="flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-control border border-line bg-surface px-2.5 text-xs font-semibold text-fg-muted shadow-e1 transition-colors hover:border-line-strong hover:text-fg active:scale-[.98]"
                >
                  <CategoryBadge name={preset.category} size="sm" />
                  <span className="max-w-[9rem] truncate">{preset.name}</span>
                  <Money amount={preset.amount} className="text-[11px] font-bold text-fg-subtle" />
                </button>
              ))}
            </div>
          )}
          {topCategories.length > 1 && (
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 scrollbar-hide">
              {topCategories.map(cat => {
                const selected = filterCategory === cat.name;
                return (
                  <button
                    key={cat.name}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setFilterCategory(selected ? 'All' : cat.name)}
                    className={cn(
                      'flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition-colors',
                      selected ? 'border-brand-accent bg-brand-soft text-brand-fg' : 'border-line bg-surface text-fg-muted hover:text-fg',
                    )}
                  >
                    <span className={cn('size-2 rounded-full', categoryTone(cat.name).bar)} />
                    {cat.name}
                    <span className="font-bold tabular-nums text-fg-subtle">{stats.total > 0 ? Math.round((cat.amount / stats.total) * 100) : 0}%</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card aria-label="Expense entries" className="min-w-0 overflow-hidden">
          {sortedExpenses.length === 0 ? (
            <EmptyState
              icon={<Receipt />}
              title={hasAnyFilter ? 'No expenses match these filters' : 'No expenses this month yet'}
              description={hasAnyFilter ? 'Try another period or clear the filters.' : 'Record diesel, rent, salaries or any bill. Press N to start.'}
              action={hasAnyFilter
                ? <Button variant="secondary" leftIcon={<RotateCcw />} onClick={resetAll}>Clear filters</Button>
                : canCreate && <Button leftIcon={<Plus />} onClick={handleOpenAddModal}>Record expense</Button>}
            />
          ) : (
            <>
              <div className="hidden h-9 grid-cols-[minmax(0,1fr)_150px_130px_104px] items-center gap-3 border-b border-line bg-surface-2/70 px-4 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle 2xl:grid">
                <span>Expense</span>
                <span>Paid from</span>
                <span className="text-right">Amount</span>
                <span className="text-right print:hidden">Actions</span>
              </div>

              {dayGroups.map(group => (
                <div key={group.day}>
                  <DayHeader day={group.day}>
                    {group.count} · <Money amount={group.total} className="font-bold text-fg" />
                  </DayHeader>
                  <ul className="divide-y divide-line/70">
                    {group.items.map(exp => (
                      <ExpenseRow
                        key={exp.id}
                        exp={exp}
                        expanded={expandedExpenseRowId === exp.id}
                        onToggle={onToggle}
                        canEdit={canEdit}
                        canDelete={canDelete}
                        canCreate={canCreate}
                        onEdit={onEdit}
                        onDelete={onDelete}
                        onBookmark={onBookmark}
                        onOpenVendor={exp.vendor_id && vendorIds.has(exp.vendor_id) ? onVendor : undefined}
                        formatDateDisplay={formatDate}
                      />
                    ))}
                  </ul>
                </div>
              ))}
              <LoadMoreRow sentinelRef={listWindow.sentinelRef} hiddenCount={listWindow.hiddenCount} onShowMore={listWindow.showMore} onShowAll={listWindow.showAll} />
              <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-2/60 px-4 py-2.5 text-xs">
                <span className="truncate font-semibold text-fg-subtle">{sortedExpenses.length} entries · {periodText}</span>
                <Money amount={stats.total} className="text-sm font-bold text-fg" />
              </div>
            </>
          )}
        </Card>

        <aside className="hidden flex-col gap-4 xl:flex print:hidden">
          <Card padded className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-[15px] font-bold text-fg"><PieChart size={15} className="text-fg-subtle" /> Where it went</h3>
              <span className="truncate text-[11px] font-semibold text-fg-subtle">{periodText}</span>
            </div>
            {categoryBreakdown.length === 0 ? (
              <p className="py-4 text-center text-xs text-fg-subtle">Nothing spent in this period.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {topCategories.map(cat => {
                  const pct = stats.total > 0 ? (cat.amount / stats.total) * 100 : 0;
                  const selected = filterCategory === cat.name;
                  return (
                    <li key={cat.name}>
                      <button
                        type="button"
                        onClick={() => setFilterCategory(selected ? 'All' : cat.name)}
                        aria-pressed={selected}
                        className={cn(
                          'w-full cursor-pointer rounded-control px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          selected ? 'bg-brand-soft ring-1 ring-brand/30' : 'hover:bg-surface-2',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <CategoryBadge name={cat.name} size="sm" />
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-fg-muted">{cat.name}</span>
                          <Money amount={cat.amount} className="text-xs font-bold text-fg" />
                        </div>
                        <div className="ml-9 mt-1 flex items-center gap-2">
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                            <span className={cn('block h-full rounded-full', categoryTone(cat.name).bar)} style={{ width: `${Math.max(2, pct)}%` }} />
                          </span>
                          <span className="w-8 text-right text-[10px] font-bold tabular-nums text-fg-subtle">{Math.round(pct)}%</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {categoryBreakdown.length > topCategories.length && (
              <p className="mt-2 px-2 text-[11px] text-fg-subtle">+{categoryBreakdown.length - topCategories.length} more categories</p>
            )}

            {filteredExpenses.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-line pt-3">
                {(['Paid', 'Partial', 'Unpaid'] as const).map(status => {
                  const selected = filterPaymentStatus === status;
                  return (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setFilterPaymentStatus(selected ? 'All' : status)}
                      className={cn(
                        'min-w-0 cursor-pointer rounded-control border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        selected ? 'border-brand-accent bg-brand-soft' : 'border-line hover:bg-surface-2',
                      )}
                    >
                      <span className="flex items-center gap-1 text-[10px] font-bold text-fg-subtle">
                        <span className={cn('size-1.5 rounded-full', STATUS_META[status].dot)} />
                        {STATUS_META[status].label}
                      </span>
                      <span className="mt-0.5 block text-sm font-bold tabular-nums text-fg">{statusSplit[status].count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {canCreate && (
            <Card padded className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-[15px] font-bold text-fg"><Zap size={15} className="text-warning" /> Quick record</h3>
                <Button variant="ghost" size="sm" onClick={onOpenSavedExpenses} className="-mr-2">Manage</Button>
              </div>
              {savedExpenses.length === 0 ? (
                <p className="rounded-control bg-surface-2 px-3 py-3 text-[11px] leading-relaxed text-fg-subtle">
                  Bookmark any entry (<BookmarkPlus size={11} className="inline" aria-hidden="true" />) or tick “Save for quick record” to re-record it in one tap.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {savedExpenses.slice(0, 5).map(preset => (
                    <li key={preset.id}>
                      <button
                        type="button"
                        onClick={() => onUseSaved(preset)}
                        className="group flex w-full cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <CategoryBadge name={preset.category} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-fg">{preset.name}</span>
                          <span className="block truncate text-[10px] text-fg-subtle">{preset.vendor_name || preset.category}</span>
                        </span>
                        <Money amount={preset.amount} className="text-xs font-bold text-fg-muted" />
                        <Plus size={13} className="text-fg-faint group-hover:text-brand-fg" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                  {savedExpenses.length > 5 && (
                    <li>
                      <Button variant="ghost" size="sm" fullWidth leftIcon={<Bookmark />} onClick={onOpenSavedExpenses}>
                        {savedExpenses.length - 5} more saved
                      </Button>
                    </li>
                  )}
                </ul>
              )}
            </Card>
          )}

          <p className="flex flex-wrap items-center gap-1 px-1 text-[11px] text-fg-subtle">
            Shortcuts: <Kbd>N</Kbd> new expense · <Kbd>/</Kbd> search
          </p>
        </aside>
      </div>
    </div>
  );
};

interface ExpenseRowProps {
  exp: ExpenseEntry;
  expanded: boolean;
  onToggle: (id: string) => void;
  canEdit: boolean;
  canDelete: boolean;
  canCreate: boolean;
  onEdit: (exp: ExpenseEntry) => void;
  onDelete: (id: string) => void;
  onBookmark: (exp: ExpenseEntry) => void;
  onOpenVendor?: (vendorId: string) => void;
  formatDateDisplay: (date: string) => string;
}

const ExpenseRow: React.FC<ExpenseRowProps> = React.memo(({
  exp, expanded, onToggle, canEdit, canDelete, canCreate, onEdit, onDelete, onBookmark, onOpenVendor, formatDateDisplay,
}) => {
  const status = exp.paymentStatus || 'Paid';
  const paid = paidOf(exp);
  const due = Math.max(0, Number(exp.amount || 0) - paid);
  const mode = exp.paymentMode || (exp as any).payment_mode || 'Cash';
  const ModeIcon = mode === 'Cash' ? Wallet : CreditCard;
  const ref = (exp.referenceNo || exp.id).slice(-6).toUpperCase();

  const actions = (
    <>
      {canCreate && (
        <IconButton
          size="sm"
          aria-label="Save for quick record"
          title="Save for quick record"
          icon={<BookmarkPlus />}
          onClick={e => { e.stopPropagation(); onBookmark(exp); }}
          className="hover:bg-warning-soft hover:text-warning-fg"
        />
      )}
      {canEdit && (
        <IconButton
          size="sm"
          aria-label="Edit"
          title="Edit"
          icon={<Edit />}
          onClick={e => { e.stopPropagation(); onEdit(exp); }}
          className="hover:bg-brand-soft hover:text-brand-fg"
        />
      )}
      {canDelete && (
        <IconButton
          size="sm"
          aria-label="Delete"
          title="Delete"
          icon={<Trash2 />}
          onClick={e => { e.stopPropagation(); onDelete(exp.id); }}
          className="hover:bg-danger-soft hover:text-danger-fg"
        />
      )}
    </>
  );

  return (
    <li className={cn('group', expanded && 'bg-surface-2/50')}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => onToggle(exp.id)}
        onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle(exp.id); } }}
        className="flex cursor-pointer items-center gap-3 px-4 py-2.5 outline-none transition-colors duration-100 hover:bg-surface-2/70 focus-visible:bg-brand-soft/60 2xl:grid 2xl:grid-cols-[minmax(0,1fr)_150px_130px_104px]"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <CategoryBadge name={exp.category} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-fg">{exp.description || exp.category}</p>
            <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-fg-subtle">
              <span className="truncate font-semibold text-fg-muted">{exp.category}</span>
              {exp.subcategory && (
                <>
                  <ChevronRight size={10} className="shrink-0 text-fg-faint" aria-hidden="true" />
                  <span className="truncate">{exp.subcategory}</span>
                </>
              )}
              {exp.vendor_name && (
                <>
                  <span className="shrink-0 text-fg-faint" aria-hidden="true">·</span>
                  {onOpenVendor ? (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onOpenVendor(exp.vendor_id!); }}
                      title="Open vendor ledger"
                      className="cursor-pointer truncate font-semibold text-fg-muted underline decoration-line-strong underline-offset-2 hover:text-brand-fg hover:decoration-brand-accent"
                    >
                      {exp.vendor_name}
                    </button>
                  ) : (
                    <span className="truncate font-semibold text-fg-muted">{exp.vendor_name}</span>
                  )}
                </>
              )}
            </p>
          </div>
        </div>

        <div className="hidden min-w-0 items-center gap-1.5 text-[11px] text-fg-subtle 2xl:flex">
          {paid > 0 ? (
            <>
              <ModeIcon size={13} className="shrink-0 text-fg-faint" aria-hidden="true" />
              <span className="truncate">{exp.account_name || mode}</span>
            </>
          ) : (
            <span className="truncate font-semibold text-danger-fg">On credit</span>
          )}
        </div>

        <div className="shrink-0 text-right">
          <Money amount={exp.amount} className="block text-[13px] font-bold text-fg" />
          {status !== 'Paid' ? (
            <p className="mt-0.5 text-[10px] font-bold tabular-nums text-danger-fg">{formatCurrency(due)} due</p>
          ) : (
            <p className="mt-0.5 text-[10px] font-semibold text-fg-subtle 2xl:hidden">{mode}</p>
          )}
        </div>

        <div className="hidden justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 2xl:flex print:hidden">
          {actions}
        </div>
      </div>

      {expanded && (
        <div className="grid gap-3 px-4 pb-3 pl-16 text-xs animate-in fade-in slide-in-from-top-1 duration-150 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={status} />
              {exp.dueDate && status !== 'Paid' && (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-warning-fg"><CalendarClock size={12} aria-hidden="true" /> Due {formatDateDisplay(exp.dueDate)}</span>
              )}
            </div>
            {status !== 'Paid' && <SettlementBar total={Number(exp.amount || 0)} paid={paid} formatMoney={formatCurrency} />}
            <p className="text-[11px] text-fg-subtle">
              {paid > 0 ? <>Paid {formatCurrency(paid)} by {mode}{exp.account_name ? ` from ${exp.account_name}` : ''}</> : 'Nothing paid yet — full amount is on the vendor ledger.'}
            </p>
            {exp.notes && (
              <p className="flex items-start gap-1.5 rounded-lg bg-warning-soft px-2 py-1.5 text-[11px] text-warning-fg"><StickyNote size={12} className="mt-0.5 shrink-0" aria-hidden="true" />{exp.notes}</p>
            )}
          </div>
          <div className="flex items-end justify-between gap-2 sm:justify-end">
            <span className="font-mono text-[10px] text-fg-faint sm:hidden">#{ref}</span>
            <div className="flex gap-1 2xl:hidden print:hidden">{actions}</div>
            <span className="hidden font-mono text-[10px] text-fg-faint sm:block">Ref #{ref}</span>
          </div>
        </div>
      )}
    </li>
  );
});
ExpenseRow.displayName = 'ExpenseRow';
