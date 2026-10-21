import React, { useMemo, useState } from 'react';
import {
  Search, X, Users, ArrowLeft, MessageCircle, Edit, Trash2, Printer, Phone, Receipt,
  ArrowUpRight, ArrowDownLeft, ArrowDownUp, BookUser, Wallet, UserCheck, Plus, MapPin,
  Landmark, Copy, StickyNote, ChevronDown, CalendarRange, FileText, Scale,
} from 'lucide-react';
import { ExpenseEntry, ExpenseVendor, ExpenseVendorTransaction } from '../../types';
import { LedgerRow, KhataDateRangeType, VendorPaymentLogRow } from './ExpenseTypes';
import { formatCurrency } from '../../lib/formatters';
import { Avatar, PillGroup, PillOption, SettlementBar, StatTile } from '../procurement/ProcurementUI';
import { RichSelect } from '../RichSelect';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import { LoadMoreRow } from '../ui/LoadMoreRow';
import { EmptyState, PrimaryButton, dayHeading, dayKey, paidOf, pkToday } from './ExpenseUI';
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
  canDelete?: boolean;
  handleDeleteVendorTransaction?: (id: string) => void;
}

const KHATA_PERIODS: PillOption<KhataDateRangeType>[] = [
  { value: 'today', label: 'Today' },
  { value: '7days', label: '7 days' },
  { value: 'this_month', label: 'Month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
];

type LogPeriod = 'today' | '7days' | 'this_month' | 'last_month' | 'all' | 'custom_range';
const LOG_PERIODS: PillOption<LogPeriod>[] = [
  { value: 'today', label: 'Today' },
  { value: '7days', label: '7 days' },
  { value: 'this_month', label: 'Month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'all', label: 'All' },
  { value: 'custom_range', label: 'Custom' },
];

type SortKey = 'balance' | 'name' | 'recent';

const ROW_KIND: Record<LedgerRow['type'], { icon: React.ElementType; tile: string; label: string }> = {
  'Opening Balance': { icon: Scale, tile: 'bg-slate-100 text-slate-600', label: 'Opening' },
  Bill: { icon: Receipt, tile: 'bg-rose-100 text-rose-700', label: 'Bill' },
  Payment: { icon: ArrowUpRight, tile: 'bg-emerald-100 text-emerald-700', label: 'Paid' },
  Refund: { icon: ArrowDownLeft, tile: 'bg-sky-100 text-sky-700', label: 'Received' },
};

const balanceWord = (bal: number) => (bal > 0 ? 'to pay' : bal < 0 ? 'advance' : 'settled');
const balanceText = (bal: number) => (bal > 0 ? 'text-rose-600' : bal < 0 ? 'text-sky-700' : 'text-slate-400');

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

    expenseVendorTransactions.forEach(tx => {
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
      const v = (exp.vendor_id ? vendorMap.get(exp.vendor_id) : undefined)
        || (exp.vendor_name ? vendorMap.get(exp.vendor_name.toLowerCase().trim()) : undefined);
      const isAlreadyRepresented = expenseVendorTransactions.some(tx => tx.expense_id === exp.id || (exp.referenceNo && tx.reference_no === exp.referenceNo));
      if (isAlreadyRepresented) return;

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
          accountName: 'Vendor khata',
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

  const statusCounts = useMemo(() => ({
    All: expenseVendors.length,
    'With Dues': expenseVendors.filter(v => (v.pending_balance || 0) > 0).length,
    Advance: expenseVendors.filter(v => (v.pending_balance || 0) < 0).length,
    Inactive: expenseVendors.filter(v => v.isActive === false).length,
  }), [expenseVendors]);

  const openLedger = (vendorId: string) => {
    if (!vendorId) return;
    setSelectedVendorId(vendorId);
    setView('directory');
    setIsMobileLedgerOpen(true);
  };

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

  const logWindow = useProgressiveList<VendorPaymentLogRow>(filteredLog, 60, `${logPeriod}|${logAction}|${logVendor}|${logMode}|${logSearch}|${logStart}|${logEnd}`);
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

  const viewSwitch = (
    <PillGroup
      label="Vendor view"
      value={view}
      onChange={setView}
      options={[
        { value: 'directory', label: 'Khata', icon: <BookUser size={13} /> },
        { value: 'payments', label: 'Payments log', icon: <ArrowDownUp size={13} /> },
      ]}
      className="w-full sm:w-auto"
    />
  );

  return (
    <div className="min-w-0 space-y-4">
      <div className={`grid-cols-2 gap-2.5 lg:grid-cols-4 print:hidden ${view === 'directory' && isMobileLedgerOpen ? 'hidden xl:grid' : 'grid'}`}>
        <StatTile
          icon={BookUser}
          tone="rose"
          valueTone={vendorStats.payable > 0 ? 'rose' : undefined}
          label="You owe vendors"
          value={formatCurrency(vendorStats.payable)}
          hint={vendorStats.payableCount ? `${vendorStats.payableCount} vendors to pay` : 'Nothing pending'}
        />
        <StatTile
          icon={ArrowDownLeft}
          tone="cyan"
          label="Advance given"
          value={formatCurrency(vendorStats.advance)}
          hint={vendorStats.advanceCount ? `${vendorStats.advanceCount} vendors hold advance` : 'No advances out'}
        />
        <StatTile
          icon={Wallet}
          tone="emerald"
          label="Paid this month"
          value={formatCurrency(vendorStats.paidThisMonth)}
          hint="Bills + direct payments"
        />
        <StatTile
          icon={UserCheck}
          tone="lime"
          label="Active vendors"
          value={vendorStats.active}
          hint={`${expenseVendors.length} total${statusCounts.Inactive ? ` · ${statusCounts.Inactive} inactive` : ''}`}
        />
      </div>

      {view === 'payments' ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-2.5 shadow-xs print:hidden">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              {viewSwitch}
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                <input
                  type="search"
                  value={logSearch}
                  onChange={e => setLogSearch(e.target.value)}
                  placeholder="Search vendor, note, reference…"
                  className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-8 text-xs font-semibold text-slate-800 outline-none placeholder:font-medium placeholder:text-slate-400 focus:border-lime-500 focus:bg-white"
                />
                {logSearch && (
                  <button type="button" aria-label="Search saaf karein" onClick={() => setLogSearch('')} className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-200">
                    <X size={13} />
                  </button>
                )}
              </div>
              <button type="button" onClick={() => window.print()} className="hidden h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 lg:flex">
                <Printer size={14} /> Print
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
              <div className="max-w-full overflow-x-auto scrollbar-hide">
                <PillGroup label="Period" size="sm" options={LOG_PERIODS} value={logPeriod} onChange={setLogPeriod} className="w-max" />
              </div>
              <div className="max-w-full overflow-x-auto scrollbar-hide">
                <PillGroup
                  label="Entry type"
                  size="sm"
                  value={logAction}
                  onChange={setLogAction}
                  className="w-max"
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'Payment', label: 'Paid', dot: 'bg-emerald-500' },
                    { value: 'Refund', label: 'Received', dot: 'bg-sky-500' },
                    { value: 'Bill', label: 'Credit bills', dot: 'bg-rose-500' },
                  ]}
                />
              </div>
              <PillGroup label="Mode" size="sm" value={logMode} onChange={setLogMode} options={[{ value: 'All', label: 'Any mode' }, { value: 'Cash', label: 'Cash' }, { value: 'Online', label: 'Bank' }]} />
              <div className="w-full sm:w-56">
                <RichSelect
                  compact
                  options={[{ value: 'All', label: 'All vendors' }, ...expenseVendors.map(v => ({ value: v.id, label: v.name, subLabel: v.service_type, avatarLetter: v.name.charAt(0).toUpperCase() }))]}
                  value={logVendor}
                  onChange={val => setLogVendor(val || 'All')}
                  allowClear={false}
                  placeholder="All vendors"
                  searchPlaceholder="Search vendor…"
                />
              </div>
              {logPeriod === 'custom_range' && (
                <div className="flex items-center gap-1.5">
                  <CalendarRange size={14} className="text-slate-400" />
                  <input type="date" value={logStart} onChange={e => setLogStart(e.target.value)} aria-label="Kab se" className="h-8 rounded-lg border border-slate-200 px-2 text-xs font-semibold outline-none focus:border-lime-500" />
                  <span className="text-xs text-slate-400">to</span>
                  <input type="date" value={logEnd} onChange={e => setLogEnd(e.target.value)} aria-label="Kab tak" className="h-8 rounded-lg border border-slate-200 px-2 text-xs font-semibold outline-none focus:border-lime-500" />
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="Paid out" value={logStats.paid} tone="text-emerald-700" />
            <MiniStat label="Received back" value={logStats.received} tone="text-sky-700" />
            <MiniStat label="Net outflow" value={logStats.net} tone="text-slate-900" />
            <MiniStat label="New credit bills" value={logStats.billed} tone="text-rose-600" />
          </div>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
            {filteredLog.length === 0 ? (
              <EmptyState icon={ArrowDownUp} title="No vendor payments in this view" hint="Try another period, entry type or vendor." />
            ) : (
              <>
                {logGroups.map(group => {
                  const heading = dayHeading(group.day);
                  const dayNet = group.rows.reduce((sum, r) => sum + (r.actionType === 'Payment' ? r.amount : r.actionType === 'Refund' ? -r.amount : 0), 0);
                  return (
                    <div key={group.day}>
                      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-1.5 text-[11px]">
                        <span className="font-bold text-slate-700">{heading.title}{heading.sub && <span className="ml-1.5 font-medium text-slate-400">{heading.sub}</span>}</span>
                        <span className="font-semibold text-slate-500">Net <span className="font-mono font-bold text-slate-800">{formatCurrency(dayNet)}</span></span>
                      </div>
                      <ul className="divide-y divide-slate-100">
                        {group.rows.map(row => {
                          const isPaid = row.actionType === 'Payment';
                          const isIn = row.actionType === 'Refund';
                          const tone = isPaid ? 'text-emerald-700' : isIn ? 'text-sky-700' : 'text-rose-600';
                          const label = isPaid ? 'Paid' : isIn ? 'Received' : 'Credit bill';
                          const Icon = isPaid ? ArrowUpRight : isIn ? ArrowDownLeft : Receipt;
                          const tile = isPaid ? 'bg-emerald-100 text-emerald-700' : isIn ? 'bg-sky-100 text-sky-700' : 'bg-rose-100 text-rose-700';
                          return (
                            <li key={row.id} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tile}`}><Icon size={15} /></span>
                              <div className="min-w-0 flex-1">
                                <button type="button" onClick={() => openLedger(row.vendorId)} className="block max-w-full truncate text-left text-[13px] font-bold text-slate-900 hover:text-lime-700">
                                  {row.vendorName}
                                </button>
                                <p className="truncate text-[11px] text-slate-500">{row.description}</p>
                              </div>
                              <div className="hidden w-40 min-w-0 text-[11px] text-slate-500 xl:block">
                                <p className="truncate font-semibold text-slate-700">{row.accountName}</p>
                                {row.referenceNo && <p className="truncate font-mono text-[10px] text-slate-400">Ref {row.referenceNo}</p>}
                              </div>
                              <div className="shrink-0 text-right">
                                <p className={`font-mono text-[13px] font-black tabular-nums ${tone}`}>{isPaid ? '−' : isIn ? '+' : ''}{formatCurrency(row.amount)}</p>
                                <p className="text-[10px] font-semibold text-slate-400">{label}</p>
                              </div>
                              <div className="flex w-7 justify-end print:hidden">
                                {row.isDeletable && canDelete && handleDeleteVendorTransaction && (
                                  <button type="button" aria-label="Payment delete karein" title="Delete payment" onClick={() => handleDeleteVendorTransaction(row.id)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-300 opacity-100 hover:bg-rose-50 hover:text-rose-600 xl:opacity-0 xl:group-hover:opacity-100">
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
                <LoadMoreRow sentinelRef={logWindow.sentinelRef} hiddenCount={logWindow.hiddenCount} onShowMore={logWindow.showMore} onShowAll={logWindow.showAll} />
              </>
            )}
          </section>
        </div>
      ) : (
        <div className="grid min-h-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs xl:min-h-[640px] xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className={`min-w-0 flex-col border-slate-200 bg-slate-50/40 xl:flex xl:border-r print:hidden ${isMobileLedgerOpen ? 'hidden' : 'flex'}`}>
            <div className="space-y-2 border-b border-slate-200 bg-white p-3">
              {viewSwitch}
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                  <input
                    type="search"
                    placeholder="Name, phone, service…"
                    className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-8 text-xs font-semibold text-slate-800 outline-none placeholder:font-medium placeholder:text-slate-400 focus:border-lime-500 focus:bg-white"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                  {searchTerm && (
                    <button type="button" aria-label="Search saaf karein" onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-200">
                      <X size={13} />
                    </button>
                  )}
                </div>
                <label className="relative">
                  <span className="sr-only">Sort vendors</span>
                  <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)} className="h-9 appearance-none rounded-xl border border-slate-200 bg-white pl-2.5 pr-7 text-xs font-semibold text-slate-700 outline-none focus:border-lime-500">
                    <option value="balance">Top dues</option>
                    <option value="recent">Recent</option>
                    <option value="name">A–Z</option>
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
                </label>
              </div>
              <div className="overflow-x-auto scrollbar-hide">
                <PillGroup
                  label="Vendor filter"
                  size="sm"
                  value={filterVendorTabStatus === 'Active' ? 'All' : filterVendorTabStatus}
                  onChange={value => setFilterVendorTabStatus(value)}
                  className="w-max min-w-full"
                  options={[
                    { value: 'All', label: `All ${statusCounts.All}` },
                    { value: 'With Dues', label: `To pay ${statusCounts['With Dues']}`, dot: 'bg-rose-500' },
                    { value: 'Advance', label: `Advance ${statusCounts.Advance}`, dot: 'bg-sky-500' },
                    { value: 'Inactive', label: `Inactive ${statusCounts.Inactive}`, dot: 'bg-slate-400' },
                  ]}
                />
              </div>
            </div>

            <ul className="flex-1 space-y-1 overflow-y-auto p-2 xl:max-h-[calc(100vh-300px)]">
              {sortedVendors.map(vendor => {
                const bal = vendor.pending_balance || 0;
                const selected = selectedVendor?.id === vendor.id;
                const last = lastActivity.get(vendor.id);
                return (
                  <li key={vendor.id}>
                    <button
                      type="button"
                      onClick={() => { setSelectedVendorId(vendor.id); setIsMobileLedgerOpen(true); }}
                      aria-current={selected ? 'true' : undefined}
                      className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-all ${
                        selected ? 'border-lime-400 bg-white shadow-sm ring-2 ring-lime-500/15' : 'border-transparent hover:border-slate-200 hover:bg-white'
                      } ${vendor.isActive === false ? 'opacity-60' : ''}`}
                    >
                      <Avatar name={vendor.name} owed={bal > 0} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold text-slate-900">{vendor.name}</span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {vendor.service_type || 'Vendor'}
                          {last ? ` · ${formatDateDisplay(last).replace(/ \d{4}$/, '')}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={`block font-mono text-xs font-black tabular-nums ${balanceText(bal)}`}>{bal === 0 ? '—' : formatCurrency(Math.abs(bal))}</span>
                        <span className="block text-[10px] font-semibold text-slate-400">{balanceWord(bal)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {sortedVendors.length === 0 && (
                <li>
                  <EmptyState
                    icon={Users}
                    title={expenseVendors.length ? 'No vendor matches' : 'No vendors yet'}
                    hint={expenseVendors.length ? 'Try another search or filter.' : 'Add your landlord, diesel pump, packaging supplier or staff.'}
                    action={!expenseVendors.length && <PrimaryButton onClick={handleOpenAddVendorModal}><Plus size={14} /> Add vendor</PrimaryButton>}
                  />
                </li>
              )}
            </ul>
          </aside>

          <section className={`min-w-0 flex-col xl:flex ${isMobileLedgerOpen ? 'flex' : 'hidden'}`}>
            {selectedVendor ? (
              <VendorDetail
                vendor={selectedVendor}
                onBack={() => setIsMobileLedgerOpen(false)}
                onPay={amount => handleOpenPaymentModal(selectedVendor, amount, 'payment')}
                onReceive={() => handleOpenPaymentModal(selectedVendor, undefined, 'refund')}
                onRecordBill={canCreate && onRecordBill ? () => onRecordBill(selectedVendor) : undefined}
                onWhatsApp={() => handleShareWhatsAppStatement(selectedVendor)}
                onPrint={handlePrintStatement}
                onEdit={() => handleOpenEditVendorModal(selectedVendor)}
                onDelete={() => handleDeleteVendor(selectedVendor)}
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
                icon={BookUser}
                title={selectedVendorId ? 'Vendor not found' : 'Pick a vendor'}
                hint="Choose a vendor on the left to see their khata, or add a new one."
                action={<PrimaryButton onClick={handleOpenAddVendorModal}><Plus size={14} /> Add vendor</PrimaryButton>}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
};

const MiniStat: React.FC<{ label: string; value: number; tone: string }> = ({ label, value, tone }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-xs">
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
    <p className={`mt-0.5 truncate font-mono text-sm font-black tabular-nums ${tone}`}>{formatCurrency(value)}</p>
  </div>
);

const VendorDetail: React.FC<{
  vendor: ExpenseVendor;
  onBack: () => void;
  onPay: (amount?: number) => void;
  onReceive: () => void;
  onRecordBill?: () => void;
  onWhatsApp: () => void;
  onPrint: () => void;
  onEdit: () => void;
  onDelete: () => void;
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
    ? { label: 'You owe', tone: 'from-rose-50 border-rose-200 dark:from-rose-500/15', value: 'text-rose-600 dark:text-rose-400', note: 'Pending dues to this vendor' }
    : bal < 0
      ? { label: 'Advance with vendor', tone: 'from-sky-50 border-sky-200 dark:from-sky-500/15', value: 'text-sky-700', note: 'Vendor holds your money' }
      : { label: 'All settled', tone: 'from-emerald-50 border-emerald-200 dark:from-emerald-500/15', value: 'text-emerald-700', note: 'Nothing pending either way' };

  const iconBtn = 'grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900';

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" aria-label="Wapas jayen" onClick={onBack} className={`${iconBtn} xl:hidden print:hidden`}>
            <ArrowLeft size={16} />
          </button>
          <Avatar name={vendor.name} owed={bal > 0} size="lg" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-base font-black tracking-tight text-slate-900 sm:text-lg">{vendor.name}</h2>
              {vendor.isActive === false && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">Inactive</span>}
            </div>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
              <span className="font-semibold text-slate-600">{vendor.service_type || 'Vendor'}</span>
              {vendor.phone && (
                <a href={`tel:${vendor.phone}`} className="flex items-center gap-1 font-mono hover:text-lime-700">
                  <Phone size={11} /> {vendor.phone}
                </a>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 print:hidden">
          {bal >= 0 ? (
            <PrimaryButton tone="emerald" onClick={() => onPay()} className="flex-1 sm:flex-initial">
              <ArrowUpRight size={14} /> Pay
            </PrimaryButton>
          ) : (
            <PrimaryButton tone="sky" onClick={onReceive} className="flex-1 sm:flex-initial">
              <ArrowDownLeft size={14} /> Receive
            </PrimaryButton>
          )}
          {bal >= 0 ? (
            <button type="button" onClick={onReceive} className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50" title="Refund / advance wapas">
              <ArrowDownLeft size={14} className="text-sky-600" /> <span className="hidden xl:inline">Receive</span>
            </button>
          ) : (
            <button type="button" onClick={() => onPay()} className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50" title="Pay vendor">
              <ArrowUpRight size={14} className="text-emerald-600" /> <span className="hidden xl:inline">Pay</span>
            </button>
          )}
          {onRecordBill && (
            <button type="button" onClick={onRecordBill} className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50" title="Is vendor ka naya bill likhein">
              <FileText size={14} className="text-rose-500" /> <span className="hidden sm:inline">Add bill</span>
            </button>
          )}
          <button type="button" aria-label="WhatsApp statement" title="WhatsApp statement" onClick={onWhatsApp} className={`${iconBtn} hover:!text-emerald-600`}><MessageCircle size={15} /></button>
          <button type="button" aria-label="Print statement" title="Print" onClick={onPrint} className={`${iconBtn} hidden sm:grid`}><Printer size={15} /></button>
          <button type="button" aria-label="Vendor edit karein" title="Edit vendor" onClick={onEdit} className={iconBtn}><Edit size={15} /></button>
          <button type="button" aria-label="Vendor delete karein" title="Delete vendor" onClick={onDelete} className={`${iconBtn} hover:!text-rose-600`}><Trash2 size={15} /></button>
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-4 p-4">
        <div className="grid gap-2.5 sm:grid-cols-[1.3fr_1fr]">
          <div className={`rounded-2xl border bg-gradient-to-br to-white p-4 dark:to-slate-900 ${hero.tone}`}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{hero.label}</p>
            <p className={`mt-1 font-mono text-2xl font-black tracking-tight tabular-nums sm:text-3xl ${hero.value}`}>{formatCurrency(Math.abs(bal))}</p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-slate-500">{hero.note}</p>
              {bal > 0 && (
                <button type="button" onClick={() => onPay(bal)} className="rounded-lg bg-white/80 px-2 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200 hover:bg-white print:hidden">
                  Pay full {formatCurrency(bal)}
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-col justify-between rounded-2xl border border-slate-200 p-4">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total billed</p>
                <p className="mt-0.5 truncate font-mono text-sm font-black text-slate-900">{formatCurrency(billed)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total paid</p>
                <p className="mt-0.5 truncate font-mono text-sm font-black text-emerald-700">{formatCurrency(paid)}</p>
              </div>
            </div>
            <div className="mt-3">
              {/* Bar = everything paid so far vs what is still owed, so it always agrees with the balance. */}
              {paid + Math.max(0, bal) > 0
                ? <SettlementBar total={paid + Math.max(0, bal)} paid={paid} formatMoney={formatCurrency} />
                : <p className="text-[11px] text-slate-400">No bills recorded yet.</p>}
              {(vendor.opening_balance || 0) !== 0 && (
                <p className="mt-1 text-[10px] text-slate-400">Includes opening balance of {formatCurrency(Math.abs(vendor.opening_balance || 0))} {(vendor.opening_balance || 0) > 0 ? 'owed' : 'advance'}</p>
              )}
            </div>
          </div>
        </div>

        {hasInfo && (
          <div className="rounded-2xl border border-slate-200">
            <button type="button" onClick={() => setShowInfo(!showInfo)} className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-bold text-slate-700 sm:hidden" aria-expanded={showInfo}>
              Vendor details
              <ChevronDown size={14} className={`transition-transform ${showInfo ? 'rotate-180' : ''}`} />
            </button>
            <dl className={`grid gap-x-4 gap-y-2.5 px-4 pb-3 pt-1 text-xs sm:grid sm:grid-cols-2 sm:pt-3 ${showInfo ? 'grid' : 'hidden'}`}>
              {vendor.contact_person && <InfoItem icon={Users} label="Contact" value={vendor.contact_person} />}
              {vendor.address && <InfoItem icon={MapPin} label="Address" value={vendor.address} />}
              {vendor.bank_name && <InfoItem icon={Landmark} label="Bank" value={vendor.bank_name} />}
              {accountNo && (
                <InfoItem
                  icon={Landmark}
                  label="Account / IBAN"
                  value={<span className="flex items-center gap-1.5 font-mono">{accountNo}
                    <button type="button" onClick={copyAccount} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Account number copy karein">
                      <Copy size={11} />
                    </button>
                    {copied && <span className="font-sans text-[10px] font-bold text-emerald-600">Copied</span>}
                  </span>}
                />
              )}
              {vendor.notes && <InfoItem icon={StickyNote} label="Notes" value={vendor.notes} className="sm:col-span-2" />}
            </dl>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200">
          <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-black text-slate-900">Statement</h3>
            <div className="max-w-full overflow-x-auto scrollbar-hide print:hidden">
              <PillGroup label="Statement period" size="sm" options={KHATA_PERIODS} value={khataDateRange} onChange={setKhataDateRange} className="w-max" />
            </div>
          </div>
          {khataDateRange === 'custom' && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-3 py-2 print:hidden">
              <CalendarRange size={14} className="text-slate-400" />
              <input type="date" value={khataStartDate} onChange={e => setKhataStartDate(e.target.value)} aria-label="Kab se" className="h-8 rounded-lg border border-slate-200 px-2 text-xs font-semibold outline-none focus:border-lime-500" />
              <span className="text-xs text-slate-400">to</span>
              <input type="date" value={khataEndDate} onChange={e => setKhataEndDate(e.target.value)} aria-label="Kab tak" className="h-8 rounded-lg border border-slate-200 px-2 text-xs font-semibold outline-none focus:border-lime-500" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
            {[
              { label: 'Opening', value: summary.opening, tone: balanceText(summary.opening) },
              { label: 'Bills (+)', value: summary.bills, tone: 'text-rose-600' },
              { label: 'Paid (−)', value: summary.payments, tone: 'text-emerald-700' },
              { label: 'Closing', value: summary.closing, tone: balanceText(summary.closing) },
            ].map(item => (
              <div key={item.label} className="bg-white px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{item.label}</p>
                <p className={`truncate font-mono text-[13px] font-black tabular-nums ${item.tone}`}>{formatCurrency(Math.abs(item.value))}</p>
              </div>
            ))}
          </div>

          {rows.length === 0 ? (
            <EmptyState icon={Receipt} title="No entries in this period" hint="Pick another period to see older bills and payments." />
          ) : (
            <>
              <div className="hidden grid-cols-[100px_minmax(0,1fr)_110px_110px_120px_32px] gap-3 border-y border-slate-100 bg-slate-50/70 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 2xl:grid">
                <span>Date</span>
                <span>Details</span>
                <span className="text-right">Bill (+)</span>
                <span className="text-right">Paid (−)</span>
                <span className="text-right">Balance</span>
                <span />
              </div>
              <ul className="divide-y divide-slate-100">
                {rowWindow.visibleItems.map(row => {
                  const kind = ROW_KIND[row.type];
                  const Icon = kind.icon;
                  const deletable = canDelete && onDeleteTx && (row.type === 'Payment' || row.type === 'Refund');
                  return (
                    <li key={row.id} className="group px-3 py-2.5 2xl:grid 2xl:grid-cols-[100px_minmax(0,1fr)_110px_110px_120px_32px] 2xl:items-center 2xl:gap-3">
                      <span className="hidden font-mono text-[11px] text-slate-500 2xl:block">{formatDateDisplay(row.date)}</span>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${kind.tile}`}><Icon size={14} /></span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-slate-800">{row.description}</p>
                          <p className="truncate text-[10px] text-slate-400">
                            <span className="2xl:hidden">{formatDateDisplay(row.date)} · </span>{kind.label} · {row.modeAccount}
                          </p>
                        </div>
                        <div className="shrink-0 text-right 2xl:hidden">
                          <p className={`font-mono text-xs font-black ${row.debit > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                            {row.debit > 0 ? `+${formatCurrency(row.debit)}` : ''}{row.debit > 0 && row.credit > 0 ? ' ' : ''}{row.credit > 0 ? `−${formatCurrency(row.credit)}` : ''}
                          </p>
                          <p className={`font-mono text-[10px] font-bold ${balanceText(row.runningBalance)}`}>Bal {formatCurrency(Math.abs(row.runningBalance))}</p>
                        </div>
                        <span className="flex w-7 shrink-0 justify-end 2xl:hidden print:hidden">
                          {deletable && (
                            <button type="button" aria-label="Entry delete karein" title="Delete payment" onClick={() => onDeleteTx!(row.id)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-600 sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100">
                              <Trash2 size={13} />
                            </button>
                          )}
                        </span>
                      </div>
                      <span className="hidden text-right font-mono text-xs font-bold text-rose-600 2xl:block">{row.debit > 0 ? formatCurrency(row.debit) : <span className="text-slate-300">—</span>}</span>
                      <span className="hidden text-right font-mono text-xs font-bold text-emerald-700 2xl:block">{row.credit > 0 ? formatCurrency(row.credit) : <span className="text-slate-300">—</span>}</span>
                      <span className={`hidden text-right font-mono text-xs font-black 2xl:block ${balanceText(row.runningBalance)}`}>
                        {formatCurrency(Math.abs(row.runningBalance))}
                        <span className="ml-1 font-sans text-[9px] font-semibold text-slate-400">{row.runningBalance > 0 ? 'Dr' : row.runningBalance < 0 ? 'Cr' : ''}</span>
                      </span>
                      <span className="hidden justify-end 2xl:flex print:hidden">
                        {deletable && (
                          <button type="button" aria-label="Entry delete karein" title="Delete payment" onClick={() => onDeleteTx!(row.id)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-300 opacity-0 hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </span>
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

const InfoItem: React.FC<{ icon: React.ElementType; label: string; value: React.ReactNode; className?: string }> = ({ icon: Icon, label, value, className = '' }) => (
  <div className={`flex min-w-0 items-start gap-2 ${className}`}>
    <Icon size={13} className="mt-0.5 shrink-0 text-slate-400" />
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="break-words font-semibold text-slate-700">{value}</dd>
    </div>
  </div>
);
