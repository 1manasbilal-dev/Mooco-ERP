import React, { useState, useMemo } from 'react';
import { 
  Search, Plus, X, Users, ArrowLeft, MessageCircle, Edit, Trash2, 
  Wallet, Printer, Info, Phone, Receipt, ArrowDownUp, ArrowUpRight, 
  ArrowDownLeft, Calendar, CalendarRange, Clock, CheckCircle2, 
  Filter, ChevronRight, FileText, CornerDownRight, Tag, ChevronDown
} from 'lucide-react';
import { ExpenseEntry, ExpenseVendor, ExpenseVendorTransaction } from '../../types';
import { LedgerRow, KhataDateRangeType, VendorPaymentLogRow, ExpenseDateFilterMode } from './ExpenseTypes';
import { formatCurrency } from '../../lib/formatters';

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
  filterVendorTabStatus: 'All' | 'With Dues' | 'Advance' | 'Active' | 'Inactive';
  setFilterVendorTabStatus: (s: 'All' | 'With Dues' | 'Advance' | 'Active' | 'Inactive') => void;
  handleOpenAddVendorModal: () => void;
  handleOpenEditVendorModal: (v: ExpenseVendor) => void;
  handleDeleteVendor: (v: ExpenseVendor) => void;
  handleOpenPaymentModal: (v: ExpenseVendor) => void;
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
  canDelete?: boolean;
  handleDeleteVendorTransaction?: (id: string) => void;
}

const ALL_PAYMENTS_DATE_FILTERS: { value: ExpenseDateFilterMode; label: string }[] = [
  { value: 'this_month', label: 'This Month' },
  { value: 'today', label: 'Today (Aaj)' },
  { value: 'yesterday', label: 'Yesterday (Kal)' },
  { value: '7days', label: 'Last 7 Days' },
  { value: '30days', label: 'Last 30 Days' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'single_date', label: 'Specific Date 📅' },
  { value: 'custom_range', label: 'Date Range (From - To) 📆' },
  { value: 'all', label: 'All Dates (All Time)' },
];

const KHATA_STATEMENT_DATE_FILTERS: { value: KhataDateRangeType; label: string }[] = [
  { value: 'this_month', label: 'This Month' },
  { value: 'today', label: 'Today (Aaj)' },
  { value: 'yesterday', label: 'Yesterday (Kal)' },
  { value: '7days', label: '7 Days' },
  { value: 'last_30_days', label: '30 Days' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'single_date', label: 'Specific Date 📅' },
  { value: 'custom', label: 'Custom Range 📆' },
  { value: 'all', label: 'All Time' },
];

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
  canDelete = false,
  handleDeleteVendorTransaction
}) => {
  // Top View Mode: 'all_payments' (Kis Ko Di / Li Log) vs 'directory' (Individual Ledgers)
  const [vendorViewMode, setVendorViewMode] = useState<'all_payments' | 'directory'>(() => {
    return selectedVendorId ? 'directory' : 'all_payments';
  });

  // State for All Payments Log view
  const [paymentsDateMode, setPaymentsDateMode] = useState<ExpenseDateFilterMode>('this_month');
  const [paymentsSingleDate, setPaymentsSingleDate] = useState<string>(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }));
  const [paymentsStartDate, setPaymentsStartDate] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [paymentsEndDate, setPaymentsEndDate] = useState<string>(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }));
  const [paymentsActionFilter, setPaymentsActionFilter] = useState<'all' | 'Payment' | 'Refund' | 'Bill'>('all');
  const [paymentsVendorFilter, setPaymentsVendorFilter] = useState<string>('All');
  const [paymentsSearchTerm, setPaymentsSearchTerm] = useState<string>('');
  const [paymentsModeFilter, setPaymentsModeFilter] = useState<string>('All');

  // Build unified vendor payments & receipts log
  const allVendorTransactions = useMemo<VendorPaymentLogRow[]>(() => {
    const rows: VendorPaymentLogRow[] = [];
    const vendorMap = new Map<string, ExpenseVendor>();
    (expenseVendors || []).forEach(v => {
      vendorMap.set(v.id, v);
      vendorMap.set(v.name.toLowerCase().trim(), v);
    });

    // 1. Direct Vendor Payments & Refunds (from expenseVendorTransactions)
    (expenseVendorTransactions || []).forEach(tx => {
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
        direction: isRefund ? 'in' : 'out', // Refund = Payment Li (received), Payment = Payment Di (paid)
        amount: tx.amount,
        paidAmount: tx.paid_amount !== undefined ? tx.paid_amount : tx.amount,
        paymentMode: tx.payment_mode || 'Cash',
        accountName: tx.account_name || tx.payment_mode || 'Cash Drawer',
        description: tx.note ? `Vendor Payment: ${tx.note}` : (isRefund ? 'Vendor Refund Received' : 'Payment to Vendor / Staff'),
        referenceNo: tx.reference_no,
        note: tx.note,
        isDeletable: true
      });
    });

    // 2. Expenses linked to Vendors (from expenses)
    (expenses || []).forEach(exp => {
      if (!exp.vendor_id && !exp.vendor_name) return;
      const v = (exp.vendor_id ? vendorMap.get(exp.vendor_id) : undefined) || 
                (exp.vendor_name ? vendorMap.get(exp.vendor_name.toLowerCase().trim()) : undefined);
      
      // Prevent duplicates if already recorded in direct transactions
      const isAlreadyRepresented = (expenseVendorTransactions || []).some(tx => tx.expense_id === exp.id || (exp.referenceNo && tx.reference_no === exp.referenceNo));
      if (isAlreadyRepresented) return;

      const billed = Number(exp.amount || 0);
      const isUnpaid = exp.paymentStatus === 'Unpaid' || (exp as any).payment_status === 'Unpaid';
      const paid = isUnpaid 
        ? 0 
        : (exp.paidAmount !== undefined && exp.paidAmount !== null 
            ? Number(exp.paidAmount) 
            : ((exp as any).paid_amount !== undefined && (exp as any).paid_amount !== null ? Number((exp as any).paid_amount) : billed));

      if (paid > 0) {
        rows.push({
          id: `exp_paid_${exp.id}`,
          sourceType: 'expense_bill',
          date: exp.date,
          vendorId: exp.vendor_id || v?.id || '',
          vendorName: exp.vendor_name || v?.name || 'Vendor',
          vendorServiceType: v?.service_type || exp.category || 'Vendor',
          vendorPhone: v?.phone,
          actionType: 'Payment',
          direction: 'out',
          amount: paid,
          paidAmount: paid,
          paymentMode: exp.paymentMode || (exp as any).payment_mode || 'Cash',
          accountName: exp.account_name || exp.paymentMode || 'Cash Drawer',
          description: exp.description ? `${exp.description}${exp.category ? ` (${exp.category})` : ''}` : (exp.category || 'Expense Payment'),
          referenceNo: exp.referenceNo,
          note: exp.notes,
          isDeletable: false
        });
      }

      if (isUnpaid || (exp.paymentStatus === 'Partial' && billed > paid)) {
        rows.push({
          id: `exp_bill_${exp.id}`,
          sourceType: 'expense_bill',
          date: exp.date,
          vendorId: exp.vendor_id || v?.id || '',
          vendorName: exp.vendor_name || v?.name || 'Vendor',
          vendorServiceType: v?.service_type || exp.category || 'Vendor',
          vendorPhone: v?.phone,
          actionType: 'Bill',
          direction: 'out',
          amount: billed - paid,
          paidAmount: 0,
          paymentMode: 'Credit (Payable)',
          accountName: 'Vendor Khata (Payable)',
          description: `${exp.description || 'Bill'} (Credit Due)`,
          referenceNo: exp.referenceNo,
          note: exp.notes,
          isDeletable: false
        });
      }
    });

    return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [expenseVendorTransactions, expenses, expenseVendors]);

  // Filtered Payments for the All Payments Register
  const filteredPaymentLogs = useMemo(() => {
    // Filter edges and row dates are all compared on the Pakistan business day.
    const pkDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
    const todayStr = pkDay(new Date());
    const yday = new Date();
    yday.setDate(yday.getDate() - 1);
    const ydayStr = pkDay(yday);

    const d7 = new Date();
    d7.setDate(d7.getDate() - 6);
    const d7Str = pkDay(d7);

    const d30 = new Date();
    d30.setDate(d30.getDate() - 29);
    const d30Str = pkDay(d30);

    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevMonthStr = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);

    return allVendorTransactions.filter(row => {
      // 1. Search Query
      const q = paymentsSearchTerm.toLowerCase().trim();
      if (q) {
        const matchesQ = 
          row.vendorName.toLowerCase().includes(q) ||
          (row.description && row.description.toLowerCase().includes(q)) ||
          (row.referenceNo && row.referenceNo.toLowerCase().includes(q)) ||
          (row.accountName && row.accountName.toLowerCase().includes(q)) ||
          (row.vendorPhone && row.vendorPhone.includes(q));
        if (!matchesQ) return false;
      }

      // 2. Action Filter
      if (paymentsActionFilter !== 'all' && row.actionType !== paymentsActionFilter) {
        return false;
      }

      // 3. Vendor Filter
      if (paymentsVendorFilter !== 'All' && row.vendorId !== paymentsVendorFilter) {
        return false;
      }

      // 4. Payment Mode Filter
      if (paymentsModeFilter !== 'All') {
        if (paymentsModeFilter === 'Cash' && row.paymentMode !== 'Cash') return false;
        if (paymentsModeFilter === 'Online' && row.paymentMode === 'Cash') return false;
      }

      // 5. Date Filter
      const rawDate = row.date || '';
      const rDate = rawDate.includes('T') ? pkDay(new Date(rawDate)) : rawDate.slice(0, 10);

      if (paymentsDateMode === 'all') return true;
      if (paymentsDateMode === 'today') return rDate === todayStr;
      if (paymentsDateMode === 'yesterday') return rDate === ydayStr;
      if (paymentsDateMode === '7days') return rDate >= d7Str && rDate <= todayStr;
      if (paymentsDateMode === '30days') return rDate >= d30Str && rDate <= todayStr;
      if (paymentsDateMode === 'this_month') return rDate.startsWith(currentMonthStr);
      if (paymentsDateMode === 'last_month') return rDate.startsWith(prevMonthStr);
      if (paymentsDateMode === 'single_date') return rDate === paymentsSingleDate;
      if (paymentsDateMode === 'custom_range') {
        if (paymentsStartDate && paymentsEndDate) return rDate >= paymentsStartDate && rDate <= paymentsEndDate;
        if (paymentsStartDate) return rDate >= paymentsStartDate;
        if (paymentsEndDate) return rDate <= paymentsEndDate;
      }

      return true;
    });
  }, [
    allVendorTransactions, paymentsSearchTerm, paymentsActionFilter, 
    paymentsVendorFilter, paymentsModeFilter, paymentsDateMode, 
    paymentsSingleDate, paymentsStartDate, paymentsEndDate
  ]);

  // KPI Metrics for All Payments
  const paymentsStats = useMemo(() => {
    let totalPaid = 0;      // Payment Di
    let totalReceived = 0;  // Payment Li / Refund
    let totalBilled = 0;    // Bills

    filteredPaymentLogs.forEach(r => {
      if (r.actionType === 'Payment') {
        totalPaid += r.amount;
      } else if (r.actionType === 'Refund') {
        totalReceived += r.amount;
      } else if (r.actionType === 'Bill') {
        totalBilled += r.amount;
      }
    });

    return {
      totalPaid,
      totalReceived,
      netPayout: totalPaid - totalReceived,
      totalBilled,
      count: filteredPaymentLogs.length
    };
  }, [filteredPaymentLogs]);

  // Jump from All Payments table directly to that vendor's ledger
  const handleSelectVendorFromRow = (vendorId: string) => {
    setSelectedVendorId(vendorId);
    setVendorViewMode('directory');
    setIsMobileLedgerOpen(true);
  };

  return (
    <div className="space-y-3 sm:space-y-4 min-w-0">
      {/* --- TOP VIEW SWITCHER: ALL PAYMENTS (KIS KO DI / LI) vs VENDOR LEDGERS --- */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-2 sm:p-2.5 shadow-2xs flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 min-w-0">
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl min-w-0">
          <button
            onClick={() => setVendorViewMode('all_payments')}
            className={`flex-1 min-w-0 px-2 sm:px-3.5 py-2 rounded-lg text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              vendorViewMode === 'all_payments'
                ? 'bg-white dark:bg-slate-900 text-lime-700 dark:text-lime-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ArrowDownUp size={15} className={`shrink-0 ${vendorViewMode === 'all_payments' ? 'text-lime-600 dark:text-lime-400' : 'text-slate-400'}`} />
            <span className="truncate">
              <span className="sm:hidden">Payments</span>
              <span className="hidden sm:inline">Tamam Payments (Kisko Di / Li)</span>
            </span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-lime-100 dark:bg-lime-950/60 text-lime-800 dark:text-lime-300 shrink-0">
              {filteredPaymentLogs.length}
            </span>
          </button>

          <button
            onClick={() => setVendorViewMode('directory')}
            className={`flex-1 min-w-0 px-2 sm:px-3.5 py-2 rounded-lg text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              vendorViewMode === 'directory'
                ? 'bg-white dark:bg-slate-900 text-lime-700 dark:text-lime-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Users size={15} className={`shrink-0 ${vendorViewMode === 'directory' ? 'text-lime-600 dark:text-lime-400' : 'text-slate-400'}`} />
            <span className="truncate">
              <span className="sm:hidden">Directory</span>
              <span className="hidden sm:inline">Vendor Khata & Profiles</span>
            </span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 shrink-0">
              {expenseVendors.length}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenAddVendorModal}
            className="flex-1 sm:flex-initial justify-center px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Plus size={14} />
            <span className="sm:hidden">New</span>
            <span className="hidden sm:inline">New Vendor</span>
          </button>

          <button
            onClick={() => {
              const defaultV = selectedVendor || expenseVendors[0];
              if (defaultV) handleOpenPaymentModal(defaultV);
              else handleOpenAddVendorModal();
            }}
            className="flex-1 sm:flex-initial justify-center px-3 sm:px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
          >
            <Wallet size={14} className="shrink-0" />
            <span className="sm:hidden">Pay / Receive</span>
            <span className="hidden sm:inline">Record Payment (Di / Li)</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODE 1: ALL PAYMENTS JOURNAL (KISKO DI / LI) - JUST LIKE EXPENSES TABLE    */}
      {/* ========================================================================= */}
      {vendorViewMode === 'all_payments' && (
        <div className="space-y-3.5">
          {/* 1. KPI Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
            <div className="bg-white dark:bg-slate-900 p-2.5 sm:p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <ArrowUpRight size={18} />
              </div>
              <div className="min-w-0">
                <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider block leading-tight">Payment Di</span>
                <span className="text-base sm:text-xl font-black font-mono text-emerald-600 dark:text-emerald-400 block mt-0.5 truncate">
                  {formatCurrency(paymentsStats.totalPaid)}
                </span>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-2.5 sm:p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                <ArrowDownLeft size={18} />
              </div>
              <div className="min-w-0">
                <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider block leading-tight">Payment Li</span>
                <span className="text-base sm:text-xl font-black font-mono text-blue-600 dark:text-blue-400 block mt-0.5 truncate">
                  {formatCurrency(paymentsStats.totalReceived)}
                </span>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-2.5 sm:p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0">
                <Wallet size={18} />
              </div>
              <div className="min-w-0">
                <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider block leading-tight">Net Outflow</span>
                <span className="text-base sm:text-xl font-black font-mono text-slate-900 dark:text-white block mt-0.5 truncate">
                  {formatCurrency(paymentsStats.netPayout)}
                </span>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-2.5 sm:p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <Receipt size={18} />
              </div>
              <div className="min-w-0">
                <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider block leading-tight">Total Billed</span>
                <span className="text-base sm:text-xl font-black font-mono text-rose-600 dark:text-rose-400 block mt-0.5 truncate">
                  {formatCurrency(paymentsStats.totalBilled)}
                </span>
              </div>
            </div>
          </div>

          {/* 2. Advanced Date & Search Filtering Bar */}
          <div className="bg-white dark:bg-slate-900 p-3.5 sm:p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-3">
            {/* Date filter pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide text-xs font-semibold">
              <div className="flex items-center gap-1 text-slate-400 mr-1 shrink-0">
                <Calendar size={13} />
                <span className="text-[11px] font-bold uppercase tracking-wider">Date:</span>
              </div>
              {ALL_PAYMENTS_DATE_FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => setPaymentsDateMode(f.value)}
                  className={`px-3 py-1.5 rounded-xl shrink-0 transition-all cursor-pointer ${
                    paymentsDateMode === f.value
                      ? 'bg-lime-600 text-white font-bold shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Live Date Inputs when specific date or range is active */}
            {paymentsDateMode === 'single_date' && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-300 shrink-0">Specific Date:</span>
                <input
                  type="date"
                  value={paymentsSingleDate}
                  onChange={e => setPaymentsSingleDate(e.target.value)}
                  className="w-full sm:w-auto px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg font-mono text-xs font-semibold text-slate-800 dark:text-slate-100 outline-none focus:border-lime-500"
                />
              </div>
            )}

            {paymentsDateMode === 'custom_range' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2.5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                <label className="flex flex-col gap-1 min-w-0">
                  <span className="font-bold text-slate-700 dark:text-slate-300">From Date</span>
                  <input
                    type="date"
                    value={paymentsStartDate}
                    onChange={e => setPaymentsStartDate(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg font-mono text-xs font-semibold text-slate-800 dark:text-slate-100 outline-none focus:border-lime-500"
                  />
                </label>
                <label className="flex flex-col gap-1 min-w-0">
                  <span className="font-bold text-slate-700 dark:text-slate-300">To Date</span>
                  <input
                    type="date"
                    value={paymentsEndDate}
                    onChange={e => setPaymentsEndDate(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg font-mono text-xs font-semibold text-slate-800 dark:text-slate-100 outline-none focus:border-lime-500"
                  />
                </label>
              </div>
            )}

            {/* Search, Action Filter, and Vendor Filter Controls */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5 pt-1 border-t border-slate-100 dark:border-slate-800">
              {/* Search Bar */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input
                  type="text"
                  placeholder="Search vendor name, voucher #, notes..."
                  value={paymentsSearchTerm}
                  onChange={e => setPaymentsSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:border-lime-500 transition-all"
                />
                {paymentsSearchTerm && (
                  <button onClick={() => setPaymentsSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer">
                    <X size={13} />
                  </button>
                )}
              </div>

              {/* Action Filter Pills: Di vs Li vs Bill */}
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-[11px] sm:text-xs font-semibold overflow-x-auto scrollbar-hide w-full md:w-auto">
                <button
                  onClick={() => setPaymentsActionFilter('all')}
                  className={`px-2.5 py-1.5 rounded-lg transition-all cursor-pointer shrink-0 whitespace-nowrap ${
                    paymentsActionFilter === 'all'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-bold shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  All ({allVendorTransactions.length})
                </button>
                <button
                  onClick={() => setPaymentsActionFilter('Payment')}
                  className={`px-2.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1 shrink-0 whitespace-nowrap ${
                    paymentsActionFilter === 'Payment'
                      ? 'bg-emerald-600 text-white font-bold shadow-xs'
                      : 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                  }`}
                >
                  <ArrowUpRight size={13} />
                  <span>Payment Di</span>
                </button>
                <button
                  onClick={() => setPaymentsActionFilter('Refund')}
                  className={`px-2.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1 shrink-0 whitespace-nowrap ${
                    paymentsActionFilter === 'Refund'
                      ? 'bg-blue-600 text-white font-bold shadow-xs'
                      : 'text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40'
                  }`}
                >
                  <ArrowDownLeft size={13} />
                  <span>Payment Li</span>
                </button>
                <button
                  onClick={() => setPaymentsActionFilter('Bill')}
                  className={`px-2.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1 shrink-0 whitespace-nowrap ${
                    paymentsActionFilter === 'Bill'
                      ? 'bg-rose-600 text-white font-bold shadow-xs'
                      : 'text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                  }`}
                >
                  <Receipt size={13} />
                  <span>Bills</span>
                </button>
              </div>

              {/* Vendor Selector Dropdown */}
              <div className="w-full md:w-auto md:shrink-0">
                <select
                  value={paymentsVendorFilter}
                  onChange={e => setPaymentsVendorFilter(e.target.value)}
                  className="w-full md:w-auto px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 outline-none focus:border-lime-500"
                >
                  <option value="All">All Vendors ({expenseVendors.length})</option>
                  {expenseVendors.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.service_type || 'Vendor'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Payment Mode Selector */}
              <div className="w-full md:w-auto md:shrink-0">
                <select
                  value={paymentsModeFilter}
                  onChange={e => setPaymentsModeFilter(e.target.value)}
                  className="w-full md:w-auto px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 outline-none focus:border-lime-500"
                >
                  <option value="All">All Accounts (Cash + Bank)</option>
                  <option value="Cash">Cash Drawer Only</option>
                  <option value="Online">Bank / Online Only</option>
                </select>
              </div>

              {/* Print Report */}
              <button
                onClick={() => window.print()}
                className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 rounded-xl transition-colors cursor-pointer shrink-0"
                title="Print Payments Register"
              >
                <Printer size={15} />
              </button>
            </div>
          </div>

          {/* 3. The Transactions Register (Desktop Table) */}
          <div className="hidden md:block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50/90 dark:bg-slate-850 text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Vendor / Party (Kis Ko Di / Li)</th>
                    <th className="px-4 py-3 text-center">Action Type</th>
                    <th className="px-4 py-3">Description & Notes</th>
                    <th className="px-4 py-3">Paid From / Mode</th>
                    <th className="px-4 py-3 text-right">Amount (Raqam)</th>
                    <th className="px-4 py-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium text-slate-700 dark:text-slate-200">
                  {filteredPaymentLogs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                        <Users size={32} className="mx-auto text-slate-300 mb-2 opacity-50" />
                        <p className="font-bold text-sm text-slate-700 dark:text-slate-300">No vendor payments found</p>
                        <p className="text-xs text-slate-400 mt-0.5">Try adjusting your date filters or search terms</p>
                      </td>
                    </tr>
                  ) : (
                    filteredPaymentLogs.map(row => {
                      const isPaymentDi = row.actionType === 'Payment';
                      const isPaymentLi = row.actionType === 'Refund';
                      const isBill = row.actionType === 'Bill';

                      return (
                        <tr key={row.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-850/50 transition-colors">
                          {/* Date */}
                          <td className="px-4 py-3 whitespace-nowrap font-mono text-slate-600 dark:text-slate-400 text-xs">
                            <span className="font-semibold block text-slate-900 dark:text-slate-100">
                              {formatDateDisplay(row.date)}
                            </span>
                            {row.date.includes('T') && (
                              <span className="text-[10px] text-slate-400 flex items-center gap-0.5 mt-0.5">
                                <Clock size={10} />
                                {new Date(row.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
                              </span>
                            )}
                          </td>

                          {/* Vendor / Party */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                                isPaymentDi
                                  ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                  : isPaymentLi
                                  ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                              }`}>
                                {row.vendorName.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <button
                                  type="button"
                                  onClick={() => row.vendorId && handleSelectVendorFromRow(row.vendorId)}
                                  className="font-bold text-xs text-slate-900 dark:text-slate-100 hover:text-lime-600 dark:hover:text-lime-400 transition-colors text-left truncate block cursor-pointer"
                                  title="View this vendor's full ledger"
                                >
                                  {row.vendorName}
                                </button>
                                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                                  <span className="px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 font-medium">
                                    {row.vendorServiceType || 'Vendor'}
                                  </span>
                                  {row.vendorPhone && (
                                    <span className="font-mono">{row.vendorPhone}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Action Type Badge (Di vs Li vs Bill) */}
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            {isPaymentDi && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                <ArrowUpRight size={12} className="text-emerald-600 dark:text-emerald-400" />
                                <span>Payment Di (Paid)</span>
                              </span>
                            )}
                            {isPaymentLi && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                <ArrowDownLeft size={12} className="text-blue-600 dark:text-blue-400" />
                                <span>Payment Li (Refund)</span>
                              </span>
                            )}
                            {isBill && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                                <Receipt size={12} className="text-rose-600 dark:text-rose-400" />
                                <span>Bill (Kharidari)</span>
                              </span>
                            )}
                          </td>

                          {/* Description & Reference */}
                          <td className="px-4 py-3">
                            <p className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                              {row.description}
                            </p>
                            {row.referenceNo && (
                              <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                                Ref: {row.referenceNo}
                              </span>
                            )}
                          </td>

                          {/* Paid From / Account */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                              {row.accountName}
                            </span>
                            <span className="text-[10px] text-slate-400 font-medium">
                              Mode: {row.paymentMode}
                            </span>
                          </td>

                          {/* Amount */}
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <span className={`font-mono font-black text-sm block ${
                              isPaymentDi
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : isPaymentLi
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}>
                              {isPaymentDi ? '- ' : isPaymentLi ? '+ ' : ''}{formatCurrency(row.amount)}
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => row.vendorId && handleSelectVendorFromRow(row.vendorId)}
                                className="p-1.5 bg-slate-100 hover:bg-lime-100 text-slate-600 hover:text-lime-800 rounded-lg transition-colors cursor-pointer"
                                title="View Vendor Ledger"
                              >
                                <ChevronRight size={14} />
                              </button>

                              {row.isDeletable && canDelete && handleDeleteVendorTransaction && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteVendorTransaction(row.id)}
                                  className="p-1.5 bg-slate-100 hover:bg-rose-100 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                                  title="Delete Payment Entry"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 4. Mobile payment cards */}
          <div className="md:hidden space-y-2.5">
            {filteredPaymentLogs.length === 0 ? (
              <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-slate-400">
                <Users size={28} className="mx-auto text-slate-300 mb-1.5" />
                <p className="font-bold text-sm text-slate-700 dark:text-slate-300">No vendor payments found</p>
                <p className="text-xs text-slate-400 mt-0.5">Try adjusting your date filters or search</p>
              </div>
            ) : (
              filteredPaymentLogs.map(row => {
                const isPaymentDi = row.actionType === 'Payment';
                const isPaymentLi = row.actionType === 'Refund';
                const isBill = row.actionType === 'Bill';

                return (
                  <div
                    key={row.id}
                    className="p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => row.vendorId && handleSelectVendorFromRow(row.vendorId)}
                        className="min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <span className="text-[10px] font-mono font-bold text-slate-400">{formatDateDisplay(row.date)}</span>
                        <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate mt-0.5">{row.vendorName}</h4>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {row.vendorServiceType || 'Vendor'}
                          {row.vendorPhone ? ` • ${row.vendorPhone}` : ''}
                        </p>
                      </button>
                      <div className="text-right shrink-0">
                        <span className={`font-mono font-black text-sm block ${
                          isPaymentDi
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : isPaymentLi
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}>
                          {isPaymentDi ? '- ' : isPaymentLi ? '+ ' : ''}{formatCurrency(row.amount)}
                        </span>
                        <span className={`mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          isPaymentDi
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                            : isPaymentLi
                            ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                            : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                        }`}>
                          {isPaymentDi && <ArrowUpRight size={11} />}
                          {isPaymentLi && <ArrowDownLeft size={11} />}
                          {isBill && <Receipt size={11} />}
                          {isPaymentDi ? 'Di' : isPaymentLi ? 'Li' : 'Bill'}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 leading-snug break-words">{row.description}</p>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                      <span className="text-slate-400 truncate min-w-0">{row.accountName} • {row.paymentMode}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => row.vendorId && handleSelectVendorFromRow(row.vendorId)}
                          className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-lime-100 text-slate-600 hover:text-lime-800 rounded-lg transition-colors cursor-pointer"
                          title="View Vendor Ledger"
                        >
                          <ChevronRight size={14} />
                        </button>
                        {row.isDeletable && canDelete && handleDeleteVendorTransaction && (
                          <button
                            type="button"
                            onClick={() => handleDeleteVendorTransaction(row.id)}
                            className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-rose-100 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                            title="Delete Payment Entry"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 2: VENDOR PROFILES & INDIVIDUAL LEDGERS (INFRADI KHATA)               */}
      {/* ========================================================================= */}
      {vendorViewMode === 'directory' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col lg:flex-row min-h-0 lg:min-h-[680px]">
          
          {/* LEFT PANE: Vendor Master Directory List */}
          <div className={`w-full lg:w-[360px] xl:w-[380px] min-w-0 border-r border-slate-200 dark:border-slate-800 flex flex-col bg-slate-50/50 dark:bg-slate-950/40 shrink-0 ${
            isMobileLedgerOpen ? 'hidden lg:flex' : 'flex'
          }`}>
            <div className="p-2.5 sm:p-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                  <input
                    type="text"
                    placeholder="Search vendor by name, phone..."
                    className="w-full pl-9 pr-7 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:border-lime-500 transition-all shadow-inner"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                  {searchTerm && (
                    <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer">
                      <X size={13} />
                    </button>
                  )}
                </div>

                <button
                  onClick={handleOpenAddVendorModal}
                  className="px-3.5 py-2 bg-lime-600 hover:bg-lime-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all shrink-0 cursor-pointer active:scale-95"
                  title="Add New Vendor / Staff"
                >
                  <Plus size={14} />
                  <span>Add</span>
                </button>
              </div>

              <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-hide text-[11px] font-semibold">
                <button
                  onClick={() => setFilterVendorTabStatus('All')}
                  className={`px-2.5 py-1 rounded-lg shrink-0 transition-all cursor-pointer ${
                    filterVendorTabStatus === 'All' ? 'bg-lime-600 text-white font-bold' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  All ({expenseVendors.length})
                </button>
                <button
                  onClick={() => setFilterVendorTabStatus('With Dues')}
                  className={`px-2.5 py-1 rounded-lg shrink-0 transition-all cursor-pointer ${
                    filterVendorTabStatus === 'With Dues' ? 'bg-rose-600 text-white font-bold' : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100'
                  }`}
                >
                  Dues ({expenseVendors.filter(v => (v.pending_balance || 0) > 0).length})
                </button>
                <button
                  onClick={() => setFilterVendorTabStatus('Advance')}
                  className={`px-2.5 py-1 rounded-lg shrink-0 transition-all cursor-pointer ${
                    filterVendorTabStatus === 'Advance' ? 'bg-blue-600 text-white font-bold' : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100'
                  }`}
                >
                  Advance ({expenseVendors.filter(v => (v.pending_balance || 0) < 0).length})
                </button>
                <button
                  onClick={() => setFilterVendorTabStatus('Active')}
                  className={`px-2.5 py-1 rounded-lg shrink-0 transition-all cursor-pointer ${
                    filterVendorTabStatus === 'Active' ? 'bg-emerald-700 text-white font-bold' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  Active
                </button>
              </div>
            </div>

            {/* Quick Switch to All Payments Log Button inside the left panel */}
            <div className="p-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
              <button
                type="button"
                onClick={() => setVendorViewMode('all_payments')}
                className="w-full p-2.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800 rounded-xl text-xs font-bold flex items-center justify-between transition-all cursor-pointer shadow-2xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ArrowDownUp size={15} className="text-blue-600 dark:text-blue-400 shrink-0" />
                  <span className="truncate">
                    <span className="sm:hidden">All Payments Log</span>
                    <span className="hidden sm:inline">Tamam Payments Log (Kisko Di / Li)</span>
                  </span>
                </div>
                <ChevronRight size={14} className="text-blue-500 shrink-0" />
              </button>
            </div>

            {/* Scrollable Vendor List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 max-h-[70vh] lg:max-h-[calc(100vh-290px)] lg:min-h-[460px]">
              {filteredVendors.map(vendor => {
                const isSelected = selectedVendor?.id === vendor.id;
                const bal = vendor.pending_balance || 0;
                const hasDues = bal > 0;
                const hasAdvance = bal < 0;

                return (
                  <div
                    key={vendor.id}
                    onClick={() => {
                      setSelectedVendorId(vendor.id);
                      setIsMobileLedgerOpen(true);
                    }}
                    className={`p-3 rounded-2xl cursor-pointer transition-all border ${
                      isSelected
                        ? 'bg-white dark:bg-slate-850 border-lime-500 shadow-sm ring-2 ring-lime-500/20'
                        : 'bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                          hasDues
                            ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300'
                            : hasAdvance
                            ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}>
                          {vendor.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className={`text-xs font-semibold truncate ${isSelected ? 'text-lime-900 dark:text-lime-300' : 'text-slate-800 dark:text-slate-100'}`}>{vendor.name}</h4>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{vendor.service_type || 'Vendor'}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`text-xs font-bold font-mono ${hasDues ? 'text-rose-600 dark:text-rose-400' : hasAdvance ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`}>
                          {formatCurrency(Math.abs(bal))}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {filteredVendors.length === 0 && (
                <div className="py-12 text-center text-slate-400">
                  <Users size={28} className="mx-auto text-slate-300 mb-1.5" />
                  <p className="font-semibold text-xs text-slate-600 dark:text-slate-400">No matching vendors found</p>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT PANE: Live Ledger Statement */}
          <div className={`flex-1 min-w-0 flex flex-col bg-white dark:bg-slate-900 overflow-hidden ${
            !isMobileLedgerOpen ? 'hidden lg:flex' : 'flex'
          }`}>
            {selectedVendor ? (
              <div className="flex flex-col h-full min-w-0">
                {/* Vendor Header */}
                <div className="p-3 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-3 min-w-0">
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                    <button
                      onClick={() => setIsMobileLedgerOpen(false)}
                      className="lg:hidden p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 shrink-0"
                    >
                      <ArrowLeft size={16} />
                    </button>

                    <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center font-black text-sm shrink-0 shadow-xs ${
                      (selectedVendor.pending_balance || 0) > 0
                        ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300'
                        : (selectedVendor.pending_balance || 0) < 0
                        ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300'
                        : 'bg-lime-100 dark:bg-lime-950/60 text-lime-800 dark:text-lime-300'
                    }`}>
                      {selectedVendor.name.charAt(0).toUpperCase()}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="font-bold text-sm sm:text-lg text-slate-900 dark:text-slate-100 truncate">{selectedVendor.name}</h3>
                        <span className="text-[10px] font-bold bg-slate-200 dark:bg-slate-750 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full shrink-0 truncate max-w-[7rem] sm:max-w-none">
                          {selectedVendor.service_type || 'Vendor'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {selectedVendor.contact_person && <span className="truncate max-w-full">Contact: {selectedVendor.contact_person}</span>}
                        {selectedVendor.phone && (
                          <span className="flex items-center gap-1 font-mono">
                            <Phone size={11} className="text-slate-400" /> {selectedVendor.phone}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 w-full lg:w-auto">
                    <button
                      onClick={() => handleOpenPaymentModal(selectedVendor)}
                      className="flex-1 lg:flex-initial justify-center px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                    >
                      <Wallet size={14} /> Pay / Receive
                    </button>

                    <button
                      onClick={() => handleShareWhatsAppStatement(selectedVendor)}
                      className="px-2.5 py-2 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                      title="Share Statement via WhatsApp"
                    >
                      <MessageCircle size={14} className="text-emerald-600 dark:text-emerald-400" />
                      <span className="hidden sm:inline">WhatsApp</span>
                    </button>

                    <button
                      onClick={handlePrintStatement}
                      className="px-2.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                      title="Print Ledger Statement"
                    >
                      <Printer size={14} />
                      <span className="hidden sm:inline">Print</span>
                    </button>

                    <button
                      onClick={() => handleOpenEditVendorModal(selectedVendor)}
                      className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 rounded-xl transition-colors cursor-pointer"
                      title="Edit Profile"
                    >
                      <Edit size={14} />
                    </button>

                    <button
                      onClick={() => handleDeleteVendor(selectedVendor)}
                      className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-xl transition-colors cursor-pointer"
                      title="Delete Vendor"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Financial Summary KPIs */}
                <div className="p-3 sm:p-5 space-y-3 sm:space-y-4 flex-1 overflow-y-auto min-w-0">
                  <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-2 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 min-w-0">
                      <span className="text-[9px] sm:text-[11px] text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider block leading-tight">Billed</span>
                      <span className="text-xs sm:text-xl font-bold font-mono text-slate-900 dark:text-slate-100 block mt-1 truncate">
                        {formatCurrency((selectedVendor.total_billed || 0))}
                      </span>
                    </div>

                    <div className="bg-emerald-50/60 dark:bg-emerald-950/20 p-2 sm:p-4 rounded-xl sm:rounded-2xl border border-emerald-200 dark:border-emerald-800/60 min-w-0">
                      <span className="text-[9px] sm:text-[11px] text-emerald-800 dark:text-emerald-300 font-semibold uppercase tracking-wider block leading-tight">Paid</span>
                      <span className="text-xs sm:text-xl font-bold font-mono text-emerald-700 dark:text-emerald-400 block mt-1 truncate">
                        {formatCurrency((selectedVendor.total_paid || 0))}
                      </span>
                    </div>

                    <div className={`p-2 sm:p-4 rounded-xl sm:rounded-2xl border min-w-0 ${
                      (selectedVendor.pending_balance || 0) > 0
                        ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                        : (selectedVendor.pending_balance || 0) < 0
                        ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200'
                        : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100'
                    }`}>
                      <span className="text-[9px] sm:text-[11px] font-semibold uppercase tracking-wider block opacity-80 leading-tight">
                        {(selectedVendor.pending_balance || 0) < 0 ? 'Advance' : 'Dues'}
                      </span>
                      <span className={`text-xs sm:text-xl font-bold font-mono block mt-1 truncate ${
                        (selectedVendor.pending_balance || 0) > 0
                          ? 'text-rose-700 dark:text-rose-400'
                          : (selectedVendor.pending_balance || 0) < 0
                          ? 'text-blue-700 dark:text-blue-400'
                          : 'text-slate-800 dark:text-slate-200'
                      }`}>
                        {formatCurrency(Math.abs(selectedVendor.pending_balance || 0))}
                      </span>
                    </div>
                  </div>

                  {/* Comprehensive Date Filter Strip */}
                  <div className="space-y-2 bg-slate-50 dark:bg-slate-850 p-2.5 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold overflow-x-auto scrollbar-hide">
                      {KHATA_STATEMENT_DATE_FILTERS.map(range => (
                        <button
                          key={range.value}
                          onClick={() => setKhataDateRange(range.value)}
                          className={`px-3 py-1.5 rounded-lg transition-all shrink-0 cursor-pointer ${
                            khataDateRange === range.value 
                              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs font-bold' 
                              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
                          }`}
                        >
                          {range.label}
                        </button>
                      ))}
                    </div>

                    {/* Interactive Date Pickers for Single Date and Custom Range */}
                    {khataDateRange === 'single_date' && (
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                        <span className="font-bold text-slate-700 dark:text-slate-300 shrink-0">Specific Date:</span>
                        <input
                          type="date"
                          value={khataStartDate}
                          onChange={e => {
                            setKhataStartDate(e.target.value);
                            setKhataEndDate(e.target.value);
                          }}
                          className="w-full sm:w-auto px-2.5 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg font-mono text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-lime-500"
                        />
                      </div>
                    )}

                    {khataDateRange === 'custom' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                        <label className="flex flex-col gap-1">
                          <span className="font-bold text-slate-700 dark:text-slate-300">From Date</span>
                          <input
                            type="date"
                            value={khataStartDate}
                            onChange={e => setKhataStartDate(e.target.value)}
                            className="w-full px-2.5 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg font-mono text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-lime-500"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="font-bold text-slate-700 dark:text-slate-300">To Date</span>
                          <input
                            type="date"
                            value={khataEndDate}
                            onChange={e => setKhataEndDate(e.target.value)}
                            className="w-full px-2.5 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg font-mono text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-lime-500"
                          />
                        </label>
                      </div>
                    )}
                  </div>

                  {/* Statement Ledger Table with Clear Di / Li indicators */}
                  <div className="hidden md:block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xs">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/90 dark:bg-slate-850 text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Type</th>
                          <th className="px-4 py-3">Description & Account</th>
                          <th className="px-4 py-3 text-right">Debit (Bill)</th>
                          <th className="px-4 py-3 text-right">Credit (Paid)</th>
                          <th className="px-4 py-3 text-right">Running Balance</th>
                          {canDelete && <th className="px-3 py-3 text-center">Action</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium text-slate-700 dark:text-slate-200">
                        {khataLedgerRows.length === 0 ? (
                          <tr>
                            <td colSpan={canDelete ? 7 : 6} className="px-4 py-8 text-center text-slate-400">
                              No transaction history found for this period
                            </td>
                          </tr>
                        ) : (
                          khataLedgerRows.map(row => (
                            <tr key={row.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                              <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">
                                {formatDateDisplay(row.date)}
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase inline-flex items-center gap-1 ${
                                  row.type === 'Bill'
                                    ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                                    : row.type === 'Payment'
                                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                    : row.type === 'Refund'
                                    ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                                }`}>
                                  {row.type === 'Payment' && <ArrowUpRight size={10} />}
                                  {row.type === 'Refund' && <ArrowDownLeft size={10} />}
                                  {row.type === 'Payment' ? 'Payment Di' : row.type === 'Refund' ? 'Payment Li' : row.type}
                                </span>
                              </td>
                              <td className="px-4 py-2.5">
                                <p className="font-semibold text-slate-800 dark:text-slate-100">{row.description}</p>
                                {row.modeAccount && <span className="text-[10px] text-slate-400 font-normal">Account: {row.modeAccount}</span>}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                                {row.debit > 0 ? `${formatCurrency(row.debit)}` : '—'}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                {row.credit > 0 ? `${formatCurrency(row.credit)}` : '—'}
                              </td>
                              <td className={`px-4 py-2.5 text-right font-mono font-black ${
                                row.runningBalance > 0 ? 'text-rose-600 dark:text-rose-400' : row.runningBalance < 0 ? 'text-blue-600 dark:text-blue-400' : 'text-slate-800 dark:text-slate-200'
                              }`}>
                                {formatCurrency(Math.abs(row.runningBalance))}
                              </td>
                              {canDelete && (
                                <td className="px-3 py-2.5 text-center whitespace-nowrap">
                                  {handleDeleteVendorTransaction && (row.type === 'Payment' || row.type === 'Refund') ? (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteVendorTransaction(row.id)}
                                      className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-rose-100 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                                      title="Delete Vendor Transaction"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  ) : (
                                    <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                                  )}
                                </td>
                              )}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="md:hidden space-y-2">
                    {khataLedgerRows.length === 0 ? (
                      <div className="px-4 py-8 text-center text-slate-400 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
                        No transaction history found for this period
                      </div>
                    ) : (
                      khataLedgerRows.map(row => (
                        <div key={row.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 space-y-2 shadow-2xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-mono font-bold text-slate-500">{formatDateDisplay(row.date)}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase inline-flex items-center gap-1 ${
                                row.type === 'Bill'
                                  ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                                  : row.type === 'Payment'
                                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                  : row.type === 'Refund'
                                  ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                              }`}>
                                {row.type === 'Payment' && <ArrowUpRight size={10} />}
                                {row.type === 'Refund' && <ArrowDownLeft size={10} />}
                                {row.type === 'Payment' ? 'Payment Di' : row.type === 'Refund' ? 'Payment Li' : row.type}
                              </span>
                              {canDelete && handleDeleteVendorTransaction && (row.type === 'Payment' || row.type === 'Refund') && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteVendorTransaction(row.id)}
                                  className="p-1 bg-slate-100 dark:bg-slate-800 hover:bg-rose-100 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                                  title="Delete Vendor Transaction"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-xs text-slate-800 dark:text-slate-100 break-words">{row.description}</p>
                            {row.modeAccount && <span className="text-[10px] text-slate-400 font-normal">Account: {row.modeAccount}</span>}
                          </div>
                          <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-center">
                            <div className="min-w-0">
                              <span className="block text-[9px] font-bold uppercase text-slate-400">Bill</span>
                              <span className="block text-[11px] font-mono font-bold text-rose-600 dark:text-rose-400 truncate">
                                {row.debit > 0 ? `${formatCurrency(row.debit)}` : '—'}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <span className="block text-[9px] font-bold uppercase text-slate-400">Paid</span>
                              <span className="block text-[11px] font-mono font-bold text-emerald-600 dark:text-emerald-400 truncate">
                                {row.credit > 0 ? `${formatCurrency(row.credit)}` : '—'}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <span className="block text-[9px] font-bold uppercase text-slate-400">Balance</span>
                              <span className={`block text-[11px] font-mono font-black truncate ${
                                row.runningBalance > 0 ? 'text-rose-600 dark:text-rose-400' : row.runningBalance < 0 ? 'text-blue-600 dark:text-blue-400' : 'text-slate-800 dark:text-slate-200'
                              }`}>
                                {formatCurrency(Math.abs(row.runningBalance))}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* Fallback when directory mode is open but no vendor selected: show All Payments */
              <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12 text-slate-400 space-y-3">
                <Users size={40} className="text-slate-300 mb-1" />
                <p className="font-bold text-base text-slate-700 dark:text-slate-300">Koi Vendor Select Nahi Hai</p>
                <p className="text-xs text-slate-400 max-w-sm text-center">
                  Left panel se kisi vendor ko select karein unka mukammal khata dekhnay ke liye, ya tamam payments dekhnay ke liye upar <strong>"Tamam Payments"</strong> par click karein.
                </p>
                <button
                  onClick={() => setVendorViewMode('all_payments')}
                  className="px-4 py-2 bg-lime-600 hover:bg-lime-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
                >
                  Tamam Payments Log Dekhein
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
