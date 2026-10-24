import React, { useMemo, useState } from 'react';
import {
  Users, ArrowLeft, MessageCircle, Edit, Trash2, Printer, Phone, Receipt,
  ArrowUpRight, ArrowDownLeft, ArrowDownUp, BookUser, Wallet, UserCheck, Plus, MapPin,
  Landmark, Copy, StickyNote, ChevronDown, CalendarRange, FileText, Scale,
} from 'lucide-react';
import { ExpenseEntry, ExpenseVendor, ExpenseVendorTransaction } from '../../types';
import { LedgerRow, KhataDateRangeType, VendorPaymentLogRow } from './ExpenseTypes';
import { formatCurrency } from '../../lib/formatters';
import { cn } from '../../lib/cn';
import { RichSelect } from '../RichSelect';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import {
  Badge, Button, Card, EmptyState, IconButton, Input, LoadMoreRow, Money, SearchInput, SegmentedControl, Select, StatCard, Toolbar,
} from '../ui';
import type { SegmentOption } from '../ui';
import { Avatar, DayHeader, Dot, MiniStat, SettlementBar, dayKey, paidOf, pkToday, plural } from './ExpenseUI';
import { useStableHandler } from './useStableHandler';
import { offsetDate } from '../../lib/dashboardAnalytics';

type VendorStatusFilter = 'All' | 'With Dues' | 'Advance' | 'Active' | 'Inactive';

interface ExpenseVendorsTabProps {
  expenseVendors: ExpenseVendor[];
  filteredVendors: ExpenseVendor[];
  selectedVendor: ExpenseVendor | undefined;
  selectedVendorId: string | null;
  setSelectedVendorId: (id: string | null) => void;
  isMobileLedgerOpen: boolean;
  setIsMobileLedgerOpen: (open: boolean) => void;
  searchTerm: string;
  setSearchTerm: (s: string) => void;
  filterVendorTabStatus: VendorStatusFilter;
  setFilterVendorTabStatus: (s: VendorStatusFilter) => void;
  handleOpenAddVendorModal: () => void;
  handleOpenEditVendorModal: (v: ExpenseVendor) => void;
  handleDeleteVendor: (v: ExpenseVendor) => void;
  handleOpenPaymentModal: (v?: ExpenseVendor, prefilledAmount?: number, type?: 'payment' | 'refund') => void;
  onRecordBill?: (v: ExpenseVendor) => void;
  handleShareWhatsAppStatement: (v: ExpenseVendor) => void;
  handlePrintStatement: () => void;
  showMobileVendorInfo: boolean;
  setShowMobileVendorInfo: (open: boolean) => void;
  khataDateRange: KhataDateRangeType;
  setKhataDateRange: (r: KhataDateRangeType) => void;
  khataStartDate: string;
  setKhataStartDate: (s: string) => void;
  khataEndDate: string;
  setKhataEndDate: (e: string) => void;
  khataLedgerRows: LedgerRow[];
  formatDateDisplay: (date: string) => string;
  expenses?: ExpenseEntry[];
  expenseVendorTransactions?: ExpenseVendorTransaction[];
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  handleDeleteVendorTransaction?: (id: string) => void;
}

const KHATA_PERIODS: SegmentOption<KhataDateRangeType>[] = [
  { value: 'today', label: 'Today' },
  { value: '7days', label: '7 days' },
  { value: 'this_month', label: 'Month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
];

type LogPeriod = 'today' | '7days' | 'this_month' | 'last_month' | 'all' | 'custom_range';
const LOG_PERIODS: SegmentOption<LogPeriod>[] = [
  { value: 'today', label: 'Today' },
  { value: '7days', label: '7 days' },
  { value: 'this_month', label: 'Month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'all', label: 'All' },
  { value: 'custom_range', label: 'Custom' },
];

const LOG_ACTIONS: SegmentOption<'all' | 'Payment' | 'Refund' | 'Bill'>[] = [
  { value: 'all', label: 'All' },
  { value: 'Payment', label: 'Paid', icon: <Dot className="bg-success" /> },
  { value: 'Refund', label: 'Received', icon: <Dot className="bg-info" /> },
  { value: 'Bill', label: 'Credit bills', icon: <Dot className="bg-danger" /> },
];

const LOG_MODES: SegmentOption<'All' | 'Cash' | 'Online'>[] = [
  { value: 'All', label: 'Any mode' },
  { value: 'Cash', label: 'Cash' },
  { value: 'Online', label: 'Bank' },
];

const VIEW_OPTIONS: SegmentOption<'directory' | 'payments'>[] = [
  { value: 'directory', label: 'Ledger', icon: <BookUser /> },
  { value: 'payments', label: 'Payments log', icon: <ArrowDownUp /> },
];

type SortKey = 'balance' | 'name' | 'recent';

const ROW_KIND: Record<LedgerRow['type'], { icon: React.ElementType; tile: string; label: string }> = {
  'Opening Balance': { icon: Scale, tile: 'bg-surface-2 text-fg-muted', label: 'Opening' },
  Bill: { icon: Receipt, tile: 'bg-danger-soft text-danger-fg', label: 'Bill' },
  Payment: { icon: ArrowUpRight, tile: 'bg-success-soft text-success-fg', label: 'Paid' },
  Refund: { icon: ArrowDownLeft, tile: 'bg-info-soft text-info-fg', label: 'Received' },
};

const LOG_KIND: Record<VendorPaymentLogRow['actionType'], { icon: React.ElementType; tile: string; text: string; label: string; sign: string }> = {
  Payment: { icon: ArrowUpRight, tile: 'bg-success-soft text-success-fg', text: 'text-success-fg', label: 'Paid', sign: '−' },
  Refund: { icon: ArrowDownLeft, tile: 'bg-info-soft text-info-fg', text: 'text-info-fg', label: 'Received', sign: '+' },
  Bill: { icon: Receipt, tile: 'bg-danger-soft text-danger-fg', text: 'text-danger-fg', label: 'Credit bill', sign: '' },
};

const balanceWord = (bal: number) => (bal > 0 ? 'to pay' : bal < 0 ? 'advance' : 'settled');
// Ledger colours (design-system Money tone="balance"): due = danger, advance = success.
const balanceText = (bal: number) => (bal > 0 ? 'text-danger-fg' : bal < 0 ? 'text-success-fg' : 'text-fg-subtle');

const StatMoney: React.FC<{ amount: number }> = ({ amount }) => <Money amount={amount} className="text-xl sm:text-2xl lg:text-[28px]" />;

export const ExpenseVendorsTab: React.FC<ExpenseVendorsTabProps> = ({
  expenseVendors,
  filteredVendors,
  selectedVendor,
  selectedVendorId,
  setSelectedVendorId,
  isMobileLedgerOpen,
  setIsMobileLedgerOpen,
  searchTerm,
  setSearchTerm,
  filterVendorTabStatus,
  setFilterVendorTabStatus,
  handleOpenAddVendorModal,
  handleOpenEditVendorModal,
  handleDeleteVendor,
  handleOpenPaymentModal,
  onRecordBill,
  handleShareWhatsAppStatement,
  handlePrintStatement,
  showMobileVendorInfo,
  setShowMobileVendorInfo,
  khataDateRange,
  setKhataDateRange,
  khataStartDate,
  setKhataStartDate,
  khataEndDate,
  setKhataEndDate,
  khataLedgerRows,
  formatDateDisplay,
  expenses = [],
  expenseVendorTransactions = [],
  canCreate = true,
  canEdit = true,
  canDelete = false,
  handleDeleteVendorTransaction,
}) => {
  const [view, setView] = useState<'directory' | 'payments'>('directory');
  const [sortKey, setSortKey] = useState<SortKey>('balance');

  const [logPeriod, setLogPeriod] = useState<LogPeriod>('this_month');
  const [logStart, setLogStart] = useState(() => `${pkToday().slice(0, 7)}-01`);
  const [logEnd, setLogEnd] = useState(() => pkToday());
  const [logAction, setLogAction] = useState<'all' | 'Payment' | 'Refund' | 'Bill'>('all');
  const [logVendor, setLogVendor] = useState('All');
  const [logSearch, setLogSearch] = useState('');
  const [logMode, setLogMode] = useState<'All' | 'Cash' | 'Online'>('All');

  // One register of everything that moved money with a vendor: direct payments/refunds plus expense bills.
  const allVendorTransactions = useMemo<VendorPaymentLogRow[]>(() => {
    const rows: VendorPaymentLogRow[] = [];
    const vendorMap = new Map<string, ExpenseVendor>();
    expenseVendors.forEach(v => {
      vendorMap.set(v.id, v);
      vendorMap.set(v.name.toLowerCase().trim(), v);
    });

    // Expenses that already have a vendor transaction row are not listed twice.
    const representedExpenseIds = new Set<string>();
    const representedRefs = new Set<string>();
    expenseVendorTransactions.forEach(tx => {
      if (tx.expense_id) representedExpenseIds.add(tx.expense_id);
      if (tx.reference_no) representedRefs.add(tx.reference_no);

      const v = vendorMap.get(tx.vendor_id) || (tx.vendor_name ? vendorMap.get(tx.vendor_name.toLowerCase().trim()) : undefined);
      const isRefund = tx.type === 'Refund';
      rows.push({
        id: tx.id,
        sourceType: 'vendor_tx',
        date: tx.date,
        vendorId: tx.vendor_id,
        vendorName: tx.vendor_name || v?.name || 'Vendor',
        vendorServiceType: v?.service_type || 'Vendor',
        vendorPhone: v?.phone,
        actionType: isRefund ? 'Refund' : 'Payment',
        direction: isRefund ? 'in' : 'out',
        amount: tx.amount,
        paidAmount: tx.paid_amount !== undefined ? tx.paid_amount : tx.amount,
        paymentMode: tx.payment_mode || 'Cash',
        accountName: tx.account_name || tx.payment_mode || 'Cash Drawer',
        description: tx.note || (isRefund ? 'Refund received from vendor' : 'Payment to vendor'),
        referenceNo: tx.reference_no,
        note: tx.note,
        isDeletable: true,
      });
    });

    expenses.forEach(exp => {
      if (!exp.vendor_id && !exp.vendor_name) return;
      if (representedExpenseIds.has(exp.id) || (exp.referenceNo && representedRefs.has(exp.referenceNo))) return;
      const v = (exp.vendor_id ? vendorMap.get(exp.vendor_id) : undefined)
        || (exp.vendor_name ? vendorMap.get(exp.vendor_name.toLowerCase().trim()) : undefined);

      const billed = Number(exp.amount || 0);
      const paid = paidOf(exp);
      const base = {
        sourceType: 'expense_bill' as const,
        date: exp.date,
        vendorId: exp.vendor_id || v?.id || '',
        vendorName: exp.vendor_name || v?.name || 'Vendor',
        vendorServiceType: v?.service_type || exp.category || 'Vendor',
        vendorPhone: v?.phone,
        direction: 'out' as const,
        referenceNo: exp.referenceNo,
        note: exp.notes,
        isDeletable: false,
      };

      if (paid > 0) {
        rows.push({
          ...base,
          id: `exp_paid_${exp.id}`,
          actionType: 'Payment',
          amount: paid,
          paidAmount: paid,
          paymentMode: exp.paymentMode || (exp as any).payment_mode || 'Cash',
          accountName: exp.account_name || exp.paymentMode || 'Cash Drawer',
          description: exp.description ? `${exp.description}${exp.category ? ` · ${exp.category}` : ''}` : (exp.category || 'Expense payment'),
        });
      }
      if (billed > paid) {
        rows.push({
          ...base,
          id: `exp_bill_${exp.id}`,
          actionType: 'Bill',
          amount: billed - paid,
          paidAmount: 0,
          paymentMode: 'Credit',
          accountName: 'Vendor ledger',
          description: `${exp.description || 'Bill'} · on credit`,
        });
      }
    });

    return rows.sort((a, b) => dayKey(b.date).localeCompare(dayKey(a.date)) || String(b.date).localeCompare(String(a.date)));
  }, [expenseVendorTransactions, expenses, expenseVendors]);

  const lastActivity = useMemo(() => {
    const map = new Map<string, string>();
    allVendorTransactions.forEach(row => {
      const key = dayKey(row.date);
      if (row.vendorId && (!map.has(row.vendorId) || key > map.get(row.vendorId)!)) map.set(row.vendorId, key);
    });
    return map;
  }, [allVendorTransactions]);

  const today = pkToday();
  const currentMonth = today.slice(0, 7);

  const vendorStats = useMemo(() => {
    let payable = 0, payableCount = 0, advance = 0, advanceCount = 0, active = 0;
    expenseVendors.forEach(v => {
      const bal = v.pending_balance || 0;
      if (v.isActive !== false) active += 1;
      if (bal > 0) { payable += bal; payableCount += 1; }
      if (bal < 0) { advance += Math.abs(bal); advanceCount += 1; }
    });
    const paidThisMonth = allVendorTransactions
      .filter(row => row.actionType === 'Payment' && dayKey(row.date).startsWith(currentMonth))
      .reduce((sum, row) => sum + row.amount, 0);
    return { payable, payableCount, advance, advanceCount, active, paidThisMonth };
  }, [expenseVendors, allVendorTransactions, currentMonth]);

  const sortedVendors = useMemo(() => {
    const list = [...filteredVendors];
    if (sortKey === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortKey === 'recent') list.sort((a, b) => (lastActivity.get(b.id) || '').localeCompare(lastActivity.get(a.id) || ''));
    else list.sort((a, b) => (b.pending_balance || 0) - (a.pending_balance || 0) || a.name.localeCompare(b.name));
    return list;
  }, [filteredVendors, sortKey, lastActivity]);

  const statusCounts = useMemo(() => {
    const counts = { All: expenseVendors.length, 'With Dues': 0, Advance: 0, Inactive: 0 };
    expenseVendors.forEach(v => {
      const bal = v.pending_balance || 0;
      if (bal > 0) counts['With Dues'] += 1;
      if (bal < 0) counts.Advance += 1;
      if (v.isActive === false) counts.Inactive += 1;
    });
    return counts;
  }, [expenseVendors]);

  const statusOptions = useMemo<SegmentOption<VendorStatusFilter>[]>(() => [
    { value: 'All', label: 'All', count: statusCounts.All },
    { value: 'With Dues', label: 'To pay', count: statusCounts['With Dues'], icon: <Dot className="bg-danger" /> },
    { value: 'Advance', label: 'Advance', count: statusCounts.Advance, icon: <Dot className="bg-success" /> },
    { value: 'Inactive', label: 'Inactive', count: statusCounts.Inactive, icon: <Dot className="bg-fg-faint" /> },
  ], [statusCounts]);

  const openLedger = (vendorId: string) => {
    if (!vendorId) return;
    setSelectedVendorId(vendorId);
    setView('directory');
    setIsMobileLedgerOpen(true);
  };

  const onPickVendor = useStableHandler((vendorId: string) => {
    setSelectedVendorId(vendorId);
    setIsMobileLedgerOpen(true);
  });
  const onOpenLedger = useStableHandler(openLedger);
  const onDeleteLogRow = useStableHandler((id: string) => handleDeleteVendorTransaction?.(id));
  const formatDate = useStableHandler(formatDateDisplay);

  const filteredLog = useMemo(() => {
    const q = logSearch.toLowerCase().trim();
    const prevMonth = (() => {
      const [y, m] = currentMonth.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 2, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    })();
    const weekStart = offsetDate(today, -6);
    return allVendorTransactions.filter(row => {
      if (q) {
        const hit = row.vendorName.toLowerCase().includes(q)
          || row.description?.toLowerCase().includes(q)
          || row.referenceNo?.toLowerCase().includes(q)
          || row.accountName?.toLowerCase().includes(q)
          || row.vendorPhone?.includes(q);
        if (!hit) return false;
      }
      if (logAction !== 'all' && row.actionType !== logAction) return false;
      if (logVendor !== 'All' && row.vendorId !== logVendor) return false;
      if (logMode === 'Cash' && row.paymentMode !== 'Cash') return false;
      if (logMode === 'Online' && (row.paymentMode === 'Cash' || row.actionType === 'Bill')) return false;
      const day = dayKey(row.date);
      switch (logPeriod) {
        case 'today': return day === today;
        case '7days': return day >= weekStart && day <= today;
        case 'this_month': return day.startsWith(currentMonth);
        case 'last_month': return day.startsWith(prevMonth);
        case 'custom_range': return (!logStart || day >= logStart) && (!logEnd || day <= logEnd);
        default: return true;
      }
    });
  }, [allVendorTransactions, logSearch, logAction, logVendor, logMode, logPeriod, logStart, logEnd, today, currentMonth]);

  const logStats = useMemo(() => {
    let paid = 0, received = 0, billed = 0;
    filteredLog.forEach(r => {
      if (r.actionType === 'Payment') paid += r.amount;
      else if (r.actionType === 'Refund') received += r.amount;
      else billed += r.amount;
    });
    return { paid, received, billed, net: paid - received };
  }, [filteredLog]);

  const logWindow = useProgressiveList<VendorPaymentLogRow>(filteredLog, 50, `${logPeriod}|${logAction}|${logVendor}|${logMode}|${logSearch}|${logStart}|${logEnd}`);
  const logGroups = useMemo(() => {
    const groups: { day: string; rows: VendorPaymentLogRow[] }[] = [];
    logWindow.visibleItems.forEach(row => {
      const key = dayKey(row.date);
      const last = groups[groups.length - 1];
      if (last && last.day === key) last.rows.push(row);
      else groups.push({ day: key, rows: [row] });
    });
    return groups;
  }, [logWindow.visibleItems]);

  const logVendorOptions = useMemo(() => [
    { value: 'All', label: 'All vendors' },
    ...expenseVendors.map(v => ({ value: v.id, label: v.name, subLabel: v.service_type, avatarLetter: v.name.charAt(0).toUpperCase() })),
  ], [expenseVendors]);

  const viewSwitch = (
    <SegmentedControl aria-label="Vendor view" value={view} onChange={setView} options={VIEW_OPTIONS} className="w-full sm:w-fit" />
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className={cn('grid-cols-2 gap-3 lg:grid-cols-4 print:hidden', view === 'directory' && isMobileLedgerOpen ? 'hidden xl:grid' : 'grid')}>
        <StatCard
          icon={<BookUser />}
          tone={vendorStats.payable > 0 ? 'danger' : 'success'}
          label="You owe vendors"
          value={<StatMoney amount={vendorStats.payable} />}
          hint={vendorStats.payableCount ? `${plural(vendorStats.payableCount, 'vendor')} to pay` : 'Nothing pending'}
          onClick={vendorStats.payableCount ? () => { setView('directory'); setFilterVendorTabStatus('With Dues'); } : undefined}
        />
        <StatCard
          icon={<ArrowDownLeft />}
          tone="success"
          label="Advance given"
          value={<StatMoney amount={vendorStats.advance} />}
          hint={vendorStats.advanceCount ? `${plural(vendorStats.advanceCount, 'vendor')} ${vendorStats.advanceCount === 1 ? 'holds' : 'hold'} advance` : 'No advances out'}
        />
        <StatCard
          icon={<Wallet />}
          label="Paid this month"
          value={<StatMoney amount={vendorStats.paidThisMonth} />}
          hint="Bills + direct payments"
        />
        <StatCard
          icon={<UserCheck />}
          tone="brand"
          label="Active vendors"
          value={<span className="text-xl sm:text-2xl lg:text-[28px]">{vendorStats.active}</span>}
          hint={`${expenseVendors.length} total${statusCounts.Inactive ? ` · ${statusCounts.Inactive} inactive` : ''}`}
        />
      </div>

      {view === 'payments' ? (
        <div className="flex flex-col gap-3">
          <Toolbar className="print:hidden">
            {viewSwitch}
            <SearchInput
              value={logSearch}
              onChange={setLogSearch}
              placeholder="Search vendor, note, reference…"
              aria-label="Search payments"
              className="min-w-0 flex-1 basis-full sm:basis-56"
            />
            <Button variant="secondary" leftIcon={<Printer />} onClick={() => window.print()} className="hidden lg:inline-flex">Print</Button>
            <div className="flex w-full flex-wrap items-center gap-2 border-t border-line px-1 pt-2">
              <SegmentedControl aria-label="Period" size="sm" options={LOG_PERIODS} value={logPeriod} onChange={setLogPeriod} />
              <SegmentedControl aria-label="Entry type" size="sm" options={LOG_ACTIONS} value={logAction} onChange={setLogAction} />
              <SegmentedControl aria-label="Mode" size="sm" options={LOG_MODES} value={logMode} onChange={setLogMode} />
              <div className="w-full sm:w-56">
                <RichSelect
                  compact
                  options={logVendorOptions}
                  value={logVendor}
                  onChange={val => setLogVendor(val || 'All')}
                  allowClear={false}
                  placeholder="All vendors"
                  searchPlaceholder="Search vendor…"
                />
              </div>
              {logPeriod === 'custom_range' && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <CalendarRange size={14} className="text-fg-faint" aria-hidden="true" />
                  <Input inputSize="sm" type="date" value={logStart} max={logEnd || today} onChange={e => setLogStart(e.target.value)} aria-label="From date" className="w-auto" />
                  <span className="text-xs text-fg-subtle">to</span>
                  <Input inputSize="sm" type="date" value={logEnd} min={logStart || undefined} onChange={e => setLogEnd(e.target.value)} aria-label="To date" className="w-auto" />
                </div>
              )}
            </div>
          </Toolbar>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="Paid out" value={<Money amount={logStats.paid} />} tone="success" />
            <MiniStat label="Received back" value={<Money amount={logStats.received} />} tone="info" />
            <MiniStat label="Net outflow" value={<Money amount={logStats.net} />} />
            <MiniStat label="New credit bills" value={<Money amount={logStats.billed} />} tone="danger" />
          </div>

          <Card className="overflow-hidden">
            {filteredLog.length === 0 ? (
              <EmptyState icon={<ArrowDownUp />} title="No vendor payments in this view" description="Try another period, entry type or vendor." />
            ) : (
              <>
                {logGroups.map(group => {
                  const dayNet = group.rows.reduce((sum, r) => sum + (r.actionType === 'Payment' ? r.amount : r.actionType === 'Refund' ? -r.amount : 0), 0);
                  return (
                    <div key={group.day}>
                      <DayHeader day={group.day}>Net <Money amount={dayNet} className="font-bold text-fg" /></DayHeader>
                      <ul className="divide-y divide-line/70">
                        {group.rows.map(row => (
                          <LogRow
                            key={row.id}
                            row={row}
                            canDelete={Boolean(row.isDeletable && canDelete && handleDeleteVendorTransaction)}
                            onOpenLedger={onOpenLedger}
                            onDelete={onDeleteLogRow}
                          />
                        ))}
                      </ul>
                    </div>
                  );
                })}
                <LoadMoreRow sentinelRef={logWindow.sentinelRef} hiddenCount={logWindow.hiddenCount} onShowMore={logWindow.showMore} onShowAll={logWindow.showAll} />
              </>
            )}
          </Card>
        </div>
      ) : (
        <Card className="grid min-h-0 overflow-hidden xl:min-h-[640px] xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className={cn('min-w-0 flex-col border-line bg-surface-2/40 xl:flex xl:border-r print:hidden', isMobileLedgerOpen ? 'hidden' : 'flex')}>
            <div className="flex flex-col gap-2 border-b border-line bg-surface p-3">
              {viewSwitch}
              <div className="flex items-center gap-2">
                <SearchInput
                  value={searchTerm}
                  onChange={setSearchTerm}
                  placeholder="Name, phone, service…"
                  aria-label="Search vendors"
                  className="min-w-0 flex-1"
                />
                <Select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)} aria-label="Sort vendors" className="w-auto shrink-0 text-xs">
                  <option value="balance">Top dues</option>
                  <option value="recent">Recent</option>
                  <option value="name">A–Z</option>
                </Select>
              </div>
              <SegmentedControl
                aria-label="Vendor filter"
                size="sm"
                value={filterVendorTabStatus === 'Active' ? 'All' : filterVendorTabStatus}
                onChange={value => setFilterVendorTabStatus(value)}
                options={statusOptions}
                className="w-full"
              />
            </div>

            <ul className="flex flex-1 flex-col gap-1 overflow-y-auto p-2 xl:max-h-[calc(100vh-300px)]">
              {sortedVendors.map(vendor => (
                <VendorListItem
                  key={vendor.id}
                  vendor={vendor}
                  selected={selectedVendor?.id === vendor.id}
                  lastDay={lastActivity.get(vendor.id)}
                  onSelect={onPickVendor}
                  formatDateDisplay={formatDate}
                />
              ))}
              {sortedVendors.length === 0 && (
                <li>
                  <EmptyState
                    size="compact"
                    icon={<Users />}
                    title={expenseVendors.length ? 'No vendor matches' : 'No vendors yet'}
                    description={expenseVendors.length ? 'Try another search or filter.' : 'Add your landlord, diesel pump, packaging supplier or staff.'}
                    action={!expenseVendors.length && canCreate && <Button size="sm" leftIcon={<Plus />} onClick={handleOpenAddVendorModal}>Add vendor</Button>}
                  />
                </li>
              )}
            </ul>
          </aside>

          <section className={cn('min-w-0 flex-col xl:flex', isMobileLedgerOpen ? 'flex' : 'hidden')}>
            {selectedVendor ? (
              <VendorDetail
                vendor={selectedVendor}
                onBack={() => setIsMobileLedgerOpen(false)}
                onPay={canCreate ? amount => handleOpenPaymentModal(selectedVendor, amount, 'payment') : undefined}
                onReceive={canCreate ? () => handleOpenPaymentModal(selectedVendor, undefined, 'refund') : undefined}
                onRecordBill={canCreate && onRecordBill ? () => onRecordBill(selectedVendor) : undefined}
                onWhatsApp={() => handleShareWhatsAppStatement(selectedVendor)}
                onPrint={handlePrintStatement}
                onEdit={canEdit ? () => handleOpenEditVendorModal(selectedVendor) : undefined}
                onDelete={canDelete ? () => handleDeleteVendor(selectedVendor) : undefined}
                showInfo={showMobileVendorInfo}
                setShowInfo={setShowMobileVendorInfo}
                khataDateRange={khataDateRange}
                setKhataDateRange={setKhataDateRange}
                khataStartDate={khataStartDate}
                setKhataStartDate={setKhataStartDate}
                khataEndDate={khataEndDate}
                setKhataEndDate={setKhataEndDate}
                rows={khataLedgerRows}
                formatDateDisplay={formatDateDisplay}
                canDelete={canDelete}
                onDeleteTx={handleDeleteVendorTransaction}
              />
            ) : (
              <EmptyState
                icon={<BookUser />}
                title={selectedVendorId ? 'Vendor not found' : 'Pick a vendor'}
                description="Choose a vendor on the left to see their ledger, or add a new one."
                action={canCreate && <Button leftIcon={<Plus />} onClick={handleOpenAddVendorModal}>Add vendor</Button>}
              />
            )}
          </section>
        </Card>
      )}
    </div>
  );
};

const VendorListItem: React.FC<{
  vendor: ExpenseVendor;
  selected: boolean;
  lastDay?: string;
  onSelect: (vendorId: string) => void;
  formatDateDisplay: (date: string) => string;
}> = React.memo(({ vendor, selected, lastDay, onSelect, formatDateDisplay }) => {
  const bal = vendor.pending_balance || 0;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(vendor.id)}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex w-full cursor-pointer items-center gap-2.5 rounded-control border px-2.5 py-2 text-left transition-[background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          selected ? 'border-brand-accent bg-surface shadow-e1 ring-2 ring-brand/15' : 'border-transparent hover:border-line hover:bg-surface',
          vendor.isActive === false && 'opacity-60',
        )}
      >
        <Avatar name={vendor.name} owed={bal > 0} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold text-fg">{vendor.name}</span>
          <span className="block truncate text-[11px] text-fg-subtle">
            {vendor.service_type || 'Vendor'}
            {lastDay ? ` · ${formatDateDisplay(lastDay).replace(/ \d{4}$/, '')}` : ''}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className={cn('block text-xs font-bold tabular-nums', balanceText(bal))}>{bal === 0 ? '—' : formatCurrency(Math.abs(bal))}</span>
          <span className="block text-[10px] font-semibold text-fg-subtle">{balanceWord(bal)}</span>
        </span>
      </button>
    </li>
  );
});
VendorListItem.displayName = 'VendorListItem';

const LogRow: React.FC<{
  row: VendorPaymentLogRow;
  canDelete: boolean;
  onOpenLedger: (vendorId: string) => void;
  onDelete: (id: string) => void;
}> = React.memo(({ row, canDelete, onOpenLedger, onDelete }) => {
  const kind = LOG_KIND[row.actionType];
  const Icon = kind.icon;
  return (
    <li className="group flex items-center gap-3 px-4 py-2.5 transition-colors duration-100 hover:bg-surface-2/70">
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-[10px]', kind.tile)}><Icon size={15} /></span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpenLedger(row.vendorId)}
          className="block max-w-full cursor-pointer truncate text-left text-[13px] font-bold text-fg hover:text-brand-fg focus-visible:outline-none focus-visible:underline"
        >
          {row.vendorName}
        </button>
        <p className="truncate text-[11px] text-fg-subtle">{row.description}</p>
      </div>
      <div className="hidden w-40 min-w-0 text-[11px] text-fg-subtle xl:block">
        <p className="truncate font-semibold text-fg-muted">{row.accountName}</p>
        {row.referenceNo && <p className="truncate font-mono text-[10px] text-fg-faint">Ref {row.referenceNo}</p>}
      </div>
      <div className="shrink-0 text-right">
        <p className={cn('text-[13px] font-bold tabular-nums', kind.text)}>{kind.sign}{formatCurrency(row.amount)}</p>
        <p className="text-[10px] font-semibold text-fg-subtle">{kind.label}</p>
      </div>
      <div className="flex w-8 justify-end print:hidden">
        {canDelete && (
          <IconButton
            size="sm"
            aria-label="Delete payment"
            title="Delete payment"
            icon={<Trash2 />}
            onClick={() => onDelete(row.id)}
            className="text-fg-faint hover:bg-danger-soft hover:text-danger-fg xl:opacity-0 xl:focus-visible:opacity-100 xl:group-hover:opacity-100"
          />
        )}
      </div>
    </li>
  );
});
LogRow.displayName = 'LogRow';

const VendorDetail: React.FC<{
  vendor: ExpenseVendor;
  onBack: () => void;
  onPay?: (amount?: number) => void;
  onReceive?: () => void;
  onRecordBill?: () => void;
  onWhatsApp: () => void;
  onPrint: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  showInfo: boolean;
  setShowInfo: (open: boolean) => void;
  khataDateRange: KhataDateRangeType;
  setKhataDateRange: (r: KhataDateRangeType) => void;
  khataStartDate: string;
  setKhataStartDate: (s: string) => void;
  khataEndDate: string;
  setKhataEndDate: (s: string) => void;
  rows: LedgerRow[];
  formatDateDisplay: (date: string) => string;
  canDelete: boolean;
  onDeleteTx?: (id: string) => void;
}> = ({
  vendor, onBack, onPay, onReceive, onRecordBill, onWhatsApp, onPrint, onEdit, onDelete, showInfo, setShowInfo,
  khataDateRange, setKhataDateRange, khataStartDate, setKhataStartDate, khataEndDate, setKhataEndDate,
  rows, formatDateDisplay, canDelete, onDeleteTx,
}) => {
  const [copied, setCopied] = useState(false);
  const bal = vendor.pending_balance || 0;
  const billed = vendor.total_billed || 0;
  const paid = vendor.total_paid || 0;
  const rowWindow = useProgressiveList<LedgerRow>(rows, 80, `${vendor.id}|${khataDateRange}|${khataStartDate}|${khataEndDate}`);

  const summary = useMemo(() => {
    const opening = rows[0]?.type === 'Opening Balance' ? rows[0].runningBalance || (rows[0].debit - rows[0].credit) : 0;
    let bills = 0, payments = 0;
    rows.forEach((row, index) => {
      if (index === 0 && row.type === 'Opening Balance') return;
      bills += row.debit;
      payments += row.credit;
    });
    const closing = rows.length ? rows[rows.length - 1].runningBalance : 0;
    return { opening, bills, payments, closing };
  }, [rows]);

  const hasInfo = Boolean(vendor.contact_person || vendor.address || vendor.bank_name || vendor.account_number || vendor.iban || vendor.notes);
  const accountNo = vendor.iban || vendor.account_number;

  const copyAccount = async () => {
    if (!accountNo) return;
    try {
      await navigator.clipboard.writeText(accountNo);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  const hero = bal > 0
    ? { label: 'You owe', box: 'border-danger/25 bg-danger-soft', value: 'text-danger-fg', note: 'Pending dues to this vendor' }
    : bal < 0
      ? { label: 'Advance with vendor', box: 'border-success/25 bg-success-soft', value: 'text-success-fg', note: 'Vendor holds your money' }
      : { label: 'All settled', box: 'border-line bg-surface-2', value: 'text-success-fg', note: 'Nothing pending either way' };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b border-line p-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <IconButton variant="secondary" aria-label="Go back" icon={<ArrowLeft />} onClick={onBack} className="shrink-0 xl:hidden print:hidden" />
          <Avatar name={vendor.name} owed={bal > 0} size="lg" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-base font-bold tracking-tight text-fg sm:text-lg">{vendor.name}</h2>
              {vendor.isActive === false && <Badge>Inactive</Badge>}
            </div>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-subtle">
              <span className="font-semibold text-fg-muted">{vendor.service_type || 'Vendor'}</span>
              {vendor.phone && (
                <a href={`tel:${vendor.phone}`} className="flex items-center gap-1 font-mono hover:text-brand-fg">
                  <Phone size={11} aria-hidden="true" /> {vendor.phone}
                </a>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 print:hidden">
          {onPay && onReceive && (bal >= 0 ? (
            <>
              <Button leftIcon={<ArrowUpRight />} onClick={() => onPay()} className="flex-1 sm:flex-initial">Pay</Button>
              <Button variant="secondary" leftIcon={<ArrowDownLeft />} onClick={onReceive} title="Refund / advance returned" aria-label="Receive">
                <span className="hidden xl:inline">Receive</span>
              </Button>
            </>
          ) : (
            <>
              <Button leftIcon={<ArrowDownLeft />} onClick={onReceive} className="flex-1 sm:flex-initial">Receive</Button>
              <Button variant="secondary" leftIcon={<ArrowUpRight />} onClick={() => onPay()} title="Pay vendor" aria-label="Pay">
                <span className="hidden xl:inline">Pay</span>
              </Button>
            </>
          ))}
          {onRecordBill && (
            <Button variant="secondary" leftIcon={<FileText />} onClick={onRecordBill} title="Add a new bill for this vendor" aria-label="Add bill">
              <span className="hidden sm:inline">Add bill</span>
            </Button>
          )}
          <IconButton variant="secondary" aria-label="WhatsApp statement" icon={<MessageCircle />} onClick={onWhatsApp} className="hover:text-success-fg" />
          <IconButton variant="secondary" aria-label="Print statement" icon={<Printer />} onClick={onPrint} className="hidden sm:inline-flex" />
          {onEdit && <IconButton variant="secondary" aria-label="Edit vendor" icon={<Edit />} onClick={onEdit} />}
          {onDelete && <IconButton variant="secondary" aria-label="Delete vendor" icon={<Trash2 />} onClick={onDelete} className="hover:border-danger/30 hover:text-danger-fg" />}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
        <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
          <div className={cn('rounded-card border p-4', hero.box)}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{hero.label}</p>
            <Money amount={Math.abs(bal)} className={cn('mt-1 block text-2xl font-bold tracking-tight sm:text-3xl', hero.value)} />
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-fg-subtle">{hero.note}</p>
              {bal > 0 && onPay && (
                <Button size="sm" variant="secondary" onClick={() => onPay(bal)} className="print:hidden">
                  Pay full {formatCurrency(bal)}
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-col justify-between rounded-card border border-line p-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-fg-subtle">Total billed</p>
                <Money amount={billed} className="mt-0.5 block truncate text-sm font-bold text-fg" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-fg-subtle">Total paid</p>
                <Money amount={paid} className="mt-0.5 block truncate text-sm font-bold text-success-fg" />
              </div>
            </div>
            <div className="mt-3">
              {/* Bar = everything paid so far vs what is still owed, so it always agrees with the balance. */}
              {paid + Math.max(0, bal) > 0
                ? <SettlementBar total={paid + Math.max(0, bal)} paid={paid} formatMoney={formatCurrency} />
                : <p className="text-[11px] text-fg-subtle">No bills recorded yet.</p>}
              {(vendor.opening_balance || 0) !== 0 && (
                <p className="mt-1 text-[10px] text-fg-subtle">Includes opening balance of {formatCurrency(Math.abs(vendor.opening_balance || 0))} {(vendor.opening_balance || 0) > 0 ? 'owed' : 'advance'}</p>
              )}
            </div>
          </div>
        </div>

        {hasInfo && (
          <div className="rounded-card border border-line">
            <button
              type="button"
              onClick={() => setShowInfo(!showInfo)}
              className="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-xs font-bold text-fg-muted sm:hidden"
              aria-expanded={showInfo}
            >
              Vendor details
              <ChevronDown size={14} className={cn('transition-transform', showInfo && 'rotate-180')} aria-hidden="true" />
            </button>
            <dl className={cn('gap-x-4 gap-y-2.5 px-4 pb-3 pt-1 text-xs sm:grid sm:grid-cols-2 sm:pt-3', showInfo ? 'grid' : 'hidden')}>
              {vendor.contact_person && <InfoItem icon={Users} label="Contact" value={vendor.contact_person} />}
              {vendor.address && <InfoItem icon={MapPin} label="Address" value={vendor.address} />}
              {vendor.bank_name && <InfoItem icon={Landmark} label="Bank" value={vendor.bank_name} />}
              {accountNo && (
                <InfoItem
                  icon={Landmark}
                  label="Account / IBAN"
                  value={<span className="flex items-center gap-1.5 font-mono">{accountNo}
                    <IconButton size="sm" aria-label="Copy account number" icon={<Copy />} onClick={copyAccount} className="size-6" />
                    {copied && <span className="font-sans text-[10px] font-bold text-success-fg">Copied</span>}
                  </span>}
                />
              )}
              {vendor.notes && <InfoItem icon={StickyNote} label="Notes" value={vendor.notes} className="sm:col-span-2" />}
            </dl>
          </div>
        )}

        <div className="rounded-card border border-line">
          <div className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-[15px] font-bold text-fg">Statement</h3>
            <SegmentedControl aria-label="Statement period" size="sm" options={KHATA_PERIODS} value={khataDateRange} onChange={setKhataDateRange} className="print:hidden" />
          </div>
          {khataDateRange === 'custom' && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2 print:hidden">
              <CalendarRange size={14} className="text-fg-faint" aria-hidden="true" />
              <Input inputSize="sm" type="date" value={khataStartDate} max={khataEndDate || undefined} onChange={e => setKhataStartDate(e.target.value)} aria-label="From date" className="w-auto" />
              <span className="text-xs text-fg-subtle">to</span>
              <Input inputSize="sm" type="date" value={khataEndDate} min={khataStartDate || undefined} onChange={e => setKhataEndDate(e.target.value)} aria-label="To date" className="w-auto" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
            {[
              { label: 'Opening', value: summary.opening, tone: balanceText(summary.opening) },
              { label: 'Bills (+)', value: summary.bills, tone: 'text-danger-fg' },
              { label: 'Paid (−)', value: summary.payments, tone: 'text-success-fg' },
              { label: 'Closing', value: summary.closing, tone: balanceText(summary.closing) },
            ].map(item => (
              <div key={item.label} className="min-w-0 bg-surface px-3 py-2">
                <p className="text-[11px] font-semibold text-fg-subtle">{item.label}</p>
                <p className={cn('truncate text-[13px] font-bold tabular-nums', item.tone)}>{formatCurrency(Math.abs(item.value))}</p>
              </div>
            ))}
          </div>

          {rows.length === 0 ? (
            <EmptyState size="compact" icon={<Receipt />} title="No entries in this period" description="Pick another period to see older bills and payments." />
          ) : (
            <>
              <div className="hidden h-9 grid-cols-[100px_minmax(0,1fr)_110px_110px_120px_32px] items-center gap-3 border-y border-line bg-surface-2/70 px-3 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle 2xl:grid">
                <span>Date</span>
                <span>Details</span>
                <span className="text-right">Bill (+)</span>
                <span className="text-right">Paid (−)</span>
                <span className="text-right">Balance</span>
                <span />
              </div>
              <ul className="divide-y divide-line/70">
                {rowWindow.visibleItems.map(row => {
                  const kind = ROW_KIND[row.type];
                  const Icon = kind.icon;
                  const deletable = canDelete && onDeleteTx && (row.type === 'Payment' || row.type === 'Refund');
                  const deleteButton = deletable && (
                    <IconButton
                      size="sm"
                      aria-label="Delete entry"
                      title="Delete payment"
                      icon={<Trash2 />}
                      onClick={() => onDeleteTx!(row.id)}
                      className="text-fg-faint hover:bg-danger-soft hover:text-danger-fg sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
                    />
                  );
                  return (
                    <li key={row.id} className="group px-3 py-2.5 2xl:grid 2xl:grid-cols-[100px_minmax(0,1fr)_110px_110px_120px_32px] 2xl:items-center 2xl:gap-3">
                      <span className="hidden font-mono text-[11px] text-fg-subtle 2xl:block">{formatDateDisplay(row.date)}</span>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', kind.tile)}><Icon size={14} /></span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-fg">{row.description}</p>
                          <p className="truncate text-[10px] text-fg-subtle">
                            <span className="2xl:hidden">{formatDateDisplay(row.date)} · </span>{kind.label} · {row.modeAccount}
                          </p>
                        </div>
                        <div className="shrink-0 text-right 2xl:hidden">
                          <p className={cn('text-xs font-bold tabular-nums', row.debit > 0 ? 'text-danger-fg' : 'text-success-fg')}>
                            {row.debit > 0 ? `+${formatCurrency(row.debit)}` : ''}{row.debit > 0 && row.credit > 0 ? ' ' : ''}{row.credit > 0 ? `−${formatCurrency(row.credit)}` : ''}
                          </p>
                          <p className={cn('text-[10px] font-bold tabular-nums', balanceText(row.runningBalance))}>Bal {formatCurrency(Math.abs(row.runningBalance))}</p>
                        </div>
                        <span className="flex w-8 shrink-0 justify-end 2xl:hidden print:hidden">{deleteButton}</span>
                      </div>
                      <span className="hidden text-right text-xs font-bold tabular-nums text-danger-fg 2xl:block">{row.debit > 0 ? formatCurrency(row.debit) : <span className="text-fg-faint">—</span>}</span>
                      <span className="hidden text-right text-xs font-bold tabular-nums text-success-fg 2xl:block">{row.credit > 0 ? formatCurrency(row.credit) : <span className="text-fg-faint">—</span>}</span>
                      <span className={cn('hidden text-right text-xs font-bold tabular-nums 2xl:block', balanceText(row.runningBalance))}>
                        {formatCurrency(Math.abs(row.runningBalance))}
                        <span className="ml-1 font-sans text-[9px] font-semibold text-fg-subtle">{row.runningBalance > 0 ? 'Dr' : row.runningBalance < 0 ? 'Cr' : ''}</span>
                      </span>
                      <span className="hidden justify-end 2xl:flex print:hidden">{deleteButton}</span>
                    </li>
                  );
                })}
              </ul>
              <LoadMoreRow sentinelRef={rowWindow.sentinelRef} hiddenCount={rowWindow.hiddenCount} onShowMore={rowWindow.showMore} onShowAll={rowWindow.showAll} />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const InfoItem: React.FC<{ icon: React.ElementType; label: string; value: React.ReactNode; className?: string }> = ({ icon: Icon, label, value, className }) => (
  <div className={cn('flex min-w-0 items-start gap-2', className)}>
    <Icon size={13} className="mt-0.5 shrink-0 text-fg-faint" aria-hidden="true" />
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold text-fg-subtle">{label}</dt>
      <dd className="break-words font-semibold text-fg-muted">{value}</dd>
    </div>
  </div>
);
