import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Search,
  Receipt,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  ShoppingCart,
  User,
  Truck,
  Clock,
  Filter,
  CheckCircle2,
  AlertCircle,
  Tag,
  Calendar,
  Layers,
  Milk,
  Briefcase,
  Coffee,
  Package,
  Trash2
} from 'lucide-react';
import { money } from './DenominationDialog';
import { formatTransactionTime } from '../lib/formatters';

export type ShiftActivityTab = 'bills' | 'sales' | 'collections' | 'expenses';

interface PosShiftActivityDialogProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: ShiftActivityTab;
  onSelectTab: (tab: ShiftActivityTab) => void;
  initialCategory?: string;
  shiftTotals: {
    gross_sales: number;
    cash_sales: number;
    online_sales: number;
    credit_sales: number;
    cash_collections: number;
    cash_refunds: number;
    cash_expenses: number;
    cash_purchases: number;
    bills_count: number;
    expectedCash: number;
    drawer_outflows?: Array<{
      id: string;
      referenceId?: string;
      title: string;
      amount: number;
      category: string;
      group?: string;
      partyName?: string;
      details?: string;
      time?: string;
    }>;
    collections_list?: Array<{
      id: string;
      referenceId?: string;
      title: string;
      partyName?: string;
      amount: number;
      category: string;
      source: string;
      details?: string;
      time?: string;
    }>;
    cash_sales_list?: Array<{
      id: string;
      invoice_no: string;
      customer_name?: string;
      total: number;
      cash_paid: number;
      refund_amount: number;
      net_cash: number;
      status: string;
      time?: string;
    }>;
    all_bills_list?: Array<{
      id: string;
      invoice_no: string;
      customer_name?: string;
      total: number;
      payment_mode: string;
      status: string;
      time?: string;
    }>;
  };
  shiftInfo?: {
    drawerName?: string;
    shiftName?: string;
    startedAt?: string;
  };
  canDelete?: boolean;
  onDeleteVendorTx?: (id: string) => Promise<boolean | void>;
}

export const PosShiftActivityDialog: React.FC<PosShiftActivityDialogProps> = ({
  isOpen,
  onClose,
  activeTab,
  onSelectTab,
  initialCategory,
  shiftTotals,
  shiftInfo,
  canDelete = false,
  onDeleteVendorTx
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(initialCategory || 'All');

  // Sync category if initialCategory changes
  React.useEffect(() => {
    if (initialCategory) {
      setSelectedCategory(initialCategory);
    }
  }, [initialCategory, isOpen]);

  // Reset filter when tab changes
  const handleTabChange = (tab: ShiftActivityTab) => {
    setSelectedCategory('All');
    setSearchTerm('');
    onSelectTab(tab);
  };

  const totalPayouts = Number(shiftTotals.cash_expenses || 0) + Number(shiftTotals.cash_purchases || 0);

  // --- Expenses Data & Filtering ---
  const outflows = shiftTotals.drawer_outflows || [];
  
  // Dynamic categories for Expenses
  const expenseCategories = useMemo(() => {
    const cats = new Set<string>();
    outflows.forEach(item => {
      if (item.group) cats.add(item.group);
      else if (item.category) cats.add(item.category);
    });
    return ['All', ...Array.from(cats)];
  }, [outflows]);

  const filteredOutflows = useMemo(() => {
    return outflows.filter(item => {
      const matchesSearch =
        !searchTerm.trim() ||
        item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.partyName && item.partyName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (item.details && item.details.toLowerCase().includes(searchTerm.toLowerCase())) ||
        item.category.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesCat =
        selectedCategory === 'All' ||
        item.group === selectedCategory ||
        item.category === selectedCategory;

      return matchesSearch && matchesCat;
    });
  }, [outflows, searchTerm, selectedCategory]);

  // Expenses sub-totals
  const expenseBreakdown = useMemo(() => {
    let milk = 0;
    let vendor = 0;
    let petty = 0;
    let material = 0;

    outflows.forEach(item => {
      if (item.category === 'Milk Purchase' || item.group === 'Milk Intake') milk += item.amount;
      else if (item.category === 'Vendor / Staff Payment' || item.group === 'Vendor & Staff') vendor += item.amount;
      else if (item.category === 'Purchase' || item.group === 'Material Purchases') material += item.amount;
      else petty += item.amount;
    });

    return { milk, vendor, petty, material };
  }, [outflows]);

  // --- Collections Data & Filtering ---
  const collections = shiftTotals.collections_list || [];
  
  const collectionCategories = useMemo(() => {
    const cats = new Set<string>();
    collections.forEach(item => {
      if (item.source) cats.add(item.source);
      else if (item.category) cats.add(item.category);
    });
    return ['All', ...Array.from(cats)];
  }, [collections]);

  const filteredCollections = useMemo(() => {
    return collections.filter(item => {
      const matchesSearch =
        !searchTerm.trim() ||
        item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.partyName && item.partyName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (item.details && item.details.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesCat =
        selectedCategory === 'All' ||
        item.source === selectedCategory ||
        item.category === selectedCategory;

      return matchesSearch && matchesCat;
    });
  }, [collections, searchTerm, selectedCategory]);

  // Collections breakdown
  const collectionBreakdown = useMemo(() => {
    let ledger = 0;
    let delivery = 0;
    let refunds = 0;

    collections.forEach(item => {
      if (item.source === 'Customer Ledger' || item.category === 'Customer Ledger') ledger += item.amount;
      else if (item.source === 'Daily Delivery' || item.category === 'Daily Delivery') delivery += item.amount;
      else refunds += item.amount;
    });

    return { ledger, delivery, refunds };
  }, [collections]);

  // --- Cash Sales Data & Filtering ---
  const cashSalesList = shiftTotals.cash_sales_list || [];

  const filteredCashSales = useMemo(() => {
    return cashSalesList.filter(item => {
      const matchesSearch =
        !searchTerm.trim() ||
        item.invoice_no.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.customer_name && item.customer_name.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesCat =
        selectedCategory === 'All' ||
        (selectedCategory === 'Returns' && (item.refund_amount > 0 || item.status === 'Partially Returned')) ||
        (selectedCategory === 'Completed' && item.status === 'Completed' && item.refund_amount === 0);

      return matchesSearch && matchesCat;
    });
  }, [cashSalesList, searchTerm, selectedCategory]);

  // --- All Bills Data & Filtering ---
  const allBillsList = shiftTotals.all_bills_list || [];

  const filteredAllBills = useMemo(() => {
    return allBillsList.filter(item => {
      const matchesSearch =
        !searchTerm.trim() ||
        item.invoice_no.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.customer_name && item.customer_name.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesCat =
        selectedCategory === 'All' ||
        String(item.payment_mode).toLowerCase() === selectedCategory.toLowerCase();

      return matchesSearch && matchesCat;
    });
  }, [allBillsList, searchTerm, selectedCategory]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Helper for category badge icons
  const getCategoryIcon = (category: string) => {
    const c = category.toLowerCase();
    if (c.includes('milk')) return <Milk size={13} className="text-amber-500" />;
    if (c.includes('vendor') || c.includes('staff')) return <Briefcase size={13} className="text-indigo-500" />;
    if (c.includes('hospitality') || c.includes('kheer') || c.includes('chai')) return <Coffee size={13} className="text-rose-500" />;
    if (c.includes('material') || c.includes('raw')) return <Package size={13} className="text-emerald-500" />;
    return <Tag size={13} className="text-slate-400" />;
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xs" onClick={onClose} />

      {/* Dialog Window */}
      <div className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-3xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/60 dark:bg-slate-800/40">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-xl bg-lime-100 dark:bg-lime-950/60 text-lime-800 dark:text-lime-400">
                <Receipt size={18} />
              </span>
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                Shift Activity & Breakdown
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 ml-8">
              Complete audit of transactions recorded in this active shift session
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>

        {/* 4 Interactive Segmented Tabs */}
        <div className="px-4 sm:px-5 pt-3 pb-2 bg-slate-50/40 dark:bg-slate-800/20 border-b border-slate-100 dark:border-slate-800">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-slate-200/70 dark:bg-slate-800 p-1 rounded-2xl">
            <button
              type="button"
              onClick={() => handleTabChange('bills')}
              className={`px-3 py-2 rounded-xl text-xs font-black transition-all flex flex-col items-center justify-center cursor-pointer ${
                activeTab === 'bills'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs border border-slate-200/80 dark:border-slate-700'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span className="text-[10px] uppercase font-bold text-slate-400">Bills Count</span>
              <span className="font-mono text-xs sm:text-sm font-black">{shiftTotals.bills_count} bills</span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange('sales')}
              className={`px-3 py-2 rounded-xl text-xs font-black transition-all flex flex-col items-center justify-center cursor-pointer ${
                activeTab === 'sales'
                  ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs border border-emerald-200 dark:border-emerald-800/50'
                  : 'text-emerald-600/80 dark:text-emerald-400/80 hover:text-emerald-700'
              }`}
            >
              <span className="text-[10px] uppercase font-bold text-emerald-600/70 dark:text-emerald-400/70">Cash Sales</span>
              <span className="font-mono text-xs sm:text-sm font-black">+{money(shiftTotals.cash_sales)}</span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange('collections')}
              className={`px-3 py-2 rounded-xl text-xs font-black transition-all flex flex-col items-center justify-center cursor-pointer ${
                activeTab === 'collections'
                  ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-xs border border-blue-200 dark:border-blue-800/50'
                  : 'text-blue-600/80 dark:text-blue-400/80 hover:text-blue-700'
              }`}
            >
              <span className="text-[10px] uppercase font-bold text-blue-600/70 dark:text-blue-400/70">Collections</span>
              <span className="font-mono text-xs sm:text-sm font-black">+{money(shiftTotals.cash_collections)}</span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange('expenses')}
              className={`px-3 py-2 rounded-xl text-xs font-black transition-all flex flex-col items-center justify-center cursor-pointer ${
                activeTab === 'expenses'
                  ? 'bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-400 shadow-xs border border-rose-200 dark:border-rose-800/50'
                  : 'text-rose-600/80 dark:text-rose-400/80 hover:text-rose-700'
              }`}
            >
              <span className="text-[10px] uppercase font-bold text-rose-600/70 dark:text-rose-400/70">Expenses/Purchases</span>
              <span className="font-mono text-xs sm:text-sm font-black">-{money(totalPayouts)}</span>
            </button>
          </div>
        </div>

        {/* Main Body with Search & Filters */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          
          {/* ========================================================================= */}
          {/* TAB 4: EXPENSES & PURCHASES                                              */}
          {/* ========================================================================= */}
          {activeTab === 'expenses' && (
            <div className="space-y-4">
              
              {/* Top Quick Summary Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-3 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/40">
                  <span className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                    <Milk size={12} /> Milk Purchases
                  </span>
                  <span className="text-sm sm:text-base font-black font-mono text-amber-900 dark:text-amber-200 block mt-0.5">
                    Rs {expenseBreakdown.milk.toLocaleString()}
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-900/40">
                  <span className="text-[10px] uppercase font-bold text-indigo-700 dark:text-indigo-400 flex items-center gap-1">
                    <Briefcase size={12} /> Vendor & Staff
                  </span>
                  <span className="text-sm sm:text-base font-black font-mono text-indigo-900 dark:text-indigo-200 block mt-0.5">
                    Rs {expenseBreakdown.vendor.toLocaleString()}
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-900/40">
                  <span className="text-[10px] uppercase font-bold text-rose-700 dark:text-rose-400 flex items-center gap-1">
                    <Tag size={12} /> Petty Expenses
                  </span>
                  <span className="text-sm sm:text-base font-black font-mono text-rose-900 dark:text-rose-200 block mt-0.5">
                    Rs {expenseBreakdown.petty.toLocaleString()}
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-900/40">
                  <span className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                    <Package size={12} /> Materials
                  </span>
                  <span className="text-sm sm:text-base font-black font-mono text-emerald-900 dark:text-emerald-200 block mt-0.5">
                    Rs {expenseBreakdown.material.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Search and Category Filter Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search expenses, payee, or milk supplier..."
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-rose-500"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
                  {expenseCategories.map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap transition-colors cursor-pointer ${
                        selectedCategory === cat
                          ? 'bg-rose-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Itemized List */}
              <div className="space-y-2">
                {filteredOutflows.length === 0 ? (
                  <div className="py-10 text-center text-slate-400">
                    <Receipt size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-xs font-medium">No payouts matching your search/filter</p>
                  </div>
                ) : (
                  filteredOutflows.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-rose-300 dark:hover:border-rose-800/60 transition-all flex items-center justify-between gap-3 shadow-2xs"
                    >
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <span className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-100 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5">
                          {getCategoryIcon(item.category)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h5 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white truncate">
                              {item.title}
                            </h5>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-bold text-slate-700 dark:text-slate-300">
                              {item.category}
                            </span>
                            {item.details && item.details !== item.category && (
                              <span className="text-slate-400">· {item.details}</span>
                            )}
                            {item.time && formatTransactionTime(item.time) ? (
                              <span className="flex items-center gap-0.5 text-slate-400">
                                <Clock size={10} />
                                {formatTransactionTime(item.time)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <div className="text-right">
                          <span className="text-sm sm:text-base font-black font-mono text-rose-600 dark:text-rose-400">
                            -{money(item.amount)}
                          </span>
                          <span className="text-[10px] text-slate-400 font-medium block">
                            Drawer Cash
                          </span>
                        </div>
                        {canDelete && onDeleteVendorTx && item.referenceId && (item.category === 'Vendor / Staff Payment' || item.group === 'Vendor & Staff') && (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm("Are you sure you want to delete this vendor payment record? Financial accounts and vendor dues will be automatically restored.")) {
                                onDeleteVendorTx(item.referenceId!);
                              }
                            }}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-100 dark:bg-slate-800 dark:hover:bg-rose-950/50 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                            title="Delete Vendor Payment"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 3: COLLECTIONS                                                       */}
          {/* ========================================================================= */}
          {activeTab === 'collections' && (
            <div className="space-y-4">
              
              {/* Top Quick Summary Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="p-3 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900/40">
                  <span className="text-[10px] uppercase font-bold text-blue-700 dark:text-blue-400 flex items-center gap-1">
                    <User size={12} /> Customer Ledger
                  </span>
                  <span className="text-sm sm:text-base font-black font-mono text-blue-900 dark:text-blue-200 block mt-0.5">
                    Rs {collectionBreakdown.ledger.toLocaleString()}
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-cyan-50/70 dark:bg-cyan-950/30 border border-cyan-200/80 dark:border-cyan-900/40">
                  <span className="text-[10px] uppercase font-bold text-cyan-700 dark:text-cyan-400 flex items-center gap-1">
                    <Truck size={12} /> Delivery Collections
                  </span>
                  <span className="text-sm sm:text-base font-black font-mono text-cyan-900 dark:text-cyan-200 block mt-0.5">
                    Rs {collectionBreakdown.delivery.toLocaleString()}
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-violet-50/70 dark:bg-violet-950/30 border border-violet-200/80 dark:border-violet-900/40">
                  <span className="text-[10px] uppercase font-bold text-violet-700 dark:text-violet-400 flex items-center gap-1">
                    <ArrowDownLeft size={12} /> Vendor Refunds
                  </span>
                  <span className="text-sm sm:text-base font-black font-mono text-violet-900 dark:text-violet-200 block mt-0.5">
                    Rs {collectionBreakdown.refunds.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Search customer name or collection note..."
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>

              {/* Itemized List */}
              <div className="space-y-2">
                {filteredCollections.length === 0 ? (
                  <div className="py-10 text-center text-slate-400">
                    <Receipt size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-xs font-medium">No collections recorded in this shift</p>
                  </div>
                ) : (
                  filteredCollections.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-800/60 transition-all flex items-center justify-between gap-3 shadow-2xs"
                    >
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <span className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-100 dark:border-blue-900/40 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">
                          <ArrowDownLeft size={14} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h5 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white truncate">
                            {item.title}
                          </h5>
                          <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                            <span className="px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold">
                              {item.source}
                            </span>
                            {item.details && item.details !== item.title && (
                              <span className="text-slate-400 truncate">· {item.details}</span>
                            )}
                            {item.time && formatTransactionTime(item.time) ? (
                              <span className="flex items-center gap-0.5 text-slate-400">
                                <Clock size={10} />
                                {formatTransactionTime(item.time)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <div className="text-right">
                          <span className="text-sm sm:text-base font-black font-mono text-blue-600 dark:text-blue-400">
                            +{money(item.amount)}
                          </span>
                          <span className="text-[10px] text-slate-400 font-medium block">
                            Cash In
                          </span>
                        </div>
                        {canDelete && onDeleteVendorTx && item.referenceId && (item.category === 'Vendor Refund' || item.source === 'Vendor / Staff Refund') && (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm("Are you sure you want to delete this vendor refund record? Financial accounts and vendor dues will be automatically restored.")) {
                                onDeleteVendorTx(item.referenceId!);
                              }
                            }}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-100 dark:bg-slate-800 dark:hover:bg-rose-950/50 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                            title="Delete Vendor Refund"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 2: POS CASH SALES                                                    */}
          {/* ========================================================================= */}
          {activeTab === 'sales' && (
            <div className="space-y-4">
              
              {/* Top Quick Summary Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="p-3 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-900/40">
                  <span className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                    <ShoppingCart size={12} /> Net Cash Sales
                  </span>
                  <span className="text-sm sm:text-base font-black font-mono text-emerald-900 dark:text-emerald-200 block mt-0.5">
                    +{money(shiftTotals.cash_sales)}
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/40">
                  <span className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                    <ArrowUpRight size={12} /> Cash Returns Issued
                  </span>
                  <span className="text-sm sm:text-base font-black font-mono text-amber-900 dark:text-amber-200 block mt-0.5">
                    -{money(shiftTotals.cash_refunds || 0)}
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Receipt size={12} /> Cash Bills
                  </span>
                  <span className="text-sm sm:text-base font-black font-mono text-slate-800 dark:text-slate-200 block mt-0.5">
                    {cashSalesList.length} bills
                  </span>
                </div>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Search invoice number or customer name..."
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-emerald-500"
                />
              </div>

              {/* Itemized List */}
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {filteredCashSales.length === 0 ? (
                  <div className="py-10 text-center text-slate-400">
                    <Receipt size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-xs font-medium">No cash sales found</p>
                  </div>
                ) : (
                  filteredCashSales.map(item => (
                    <div
                      key={item.id}
                      className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-emerald-300 dark:hover:border-emerald-800/60 transition-all flex items-center justify-between gap-3 shadow-2xs"
                    >
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-100 dark:border-emerald-900/40 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
                          <ShoppingCart size={14} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h5 className="text-xs sm:text-sm font-black font-mono text-slate-900 dark:text-white truncate">
                              #{item.invoice_no}
                            </h5>
                            <span className={`px-2 py-0.2 rounded-full text-[9px] font-bold ${
                              item.status === 'Partially Returned'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                            }`}>
                              {item.status}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                            <span>{item.customer_name || 'Walk-in Customer'}</span>
                            {item.time && formatTransactionTime(item.time) ? (
                              <span className="flex items-center gap-0.5 text-slate-400">
                                <Clock size={10} />
                                {formatTransactionTime(item.time)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-sm sm:text-base font-black font-mono text-emerald-600 dark:text-emerald-400">
                          +{money(item.net_cash)}
                        </span>
                        {item.refund_amount > 0 && (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium block">
                            Return: -{money(item.refund_amount)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 1: BILLS COUNT                                                       */}
          {/* ========================================================================= */}
          {activeTab === 'bills' && (
            <div className="space-y-4">
              
              {/* Top Quick Summary Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Total Bills</span>
                  <span className="text-sm sm:text-base font-black font-mono text-slate-900 dark:text-white block mt-0.5">
                    {allBillsList.length} bills
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-900/40">
                  <span className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400">Cash Bills</span>
                  <span className="text-sm sm:text-base font-black font-mono text-emerald-900 dark:text-emerald-200 block mt-0.5">
                    {allBillsList.filter(b => String(b.payment_mode).toLowerCase() === 'cash').length}
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/40">
                  <span className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-400">Credit Bills</span>
                  <span className="text-sm sm:text-base font-black font-mono text-amber-900 dark:text-amber-200 block mt-0.5">
                    {allBillsList.filter(b => String(b.payment_mode).toLowerCase() === 'credit').length}
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200/80 dark:border-purple-900/40">
                  <span className="text-[10px] uppercase font-bold text-purple-700 dark:text-purple-400">Online Bills</span>
                  <span className="text-sm sm:text-base font-black font-mono text-purple-900 dark:text-purple-200 block mt-0.5">
                    {allBillsList.filter(b => String(b.payment_mode).toLowerCase() === 'online').length}
                  </span>
                </div>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Search invoice number or customer name..."
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-slate-500"
                />
              </div>

              {/* Itemized List */}
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {filteredAllBills.length === 0 ? (
                  <div className="py-10 text-center text-slate-400">
                    <Receipt size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-xs font-medium">No bills found</p>
                  </div>
                ) : (
                  filteredAllBills.map(item => (
                    <div
                      key={item.id}
                      className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 transition-all flex items-center justify-between gap-3 shadow-2xs"
                    >
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <span className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0 mt-0.5">
                          <Receipt size={14} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h5 className="text-xs sm:text-sm font-black font-mono text-slate-900 dark:text-white truncate">
                              #{item.invoice_no}
                            </h5>
                            <span className={`px-2 py-0.2 rounded-full text-[9px] font-bold ${
                              String(item.payment_mode).toLowerCase() === 'cash'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                                : String(item.payment_mode).toLowerCase() === 'credit'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                                : 'bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300'
                            }`}>
                              {item.payment_mode}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                            <span>{item.customer_name || 'Walk-in Customer'}</span>
                            {item.time && formatTransactionTime(item.time) ? (
                              <span className="flex items-center gap-0.5 text-slate-400">
                                <Clock size={10} />
                                {formatTransactionTime(item.time)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-sm sm:text-base font-black font-mono text-slate-900 dark:text-white">
                          {money(item.total)}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium block">
                          Total Bill
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer Summary */}
        <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block">
              {activeTab === 'expenses' && 'Total Shift Payouts'}
              {activeTab === 'collections' && 'Total Shift Collections'}
              {activeTab === 'sales' && 'Net POS Cash Sales'}
              {activeTab === 'bills' && 'Total Shift Bills'}
            </span>
            <span className="text-sm sm:text-base font-black font-mono text-slate-900 dark:text-white">
              {activeTab === 'expenses' && `-${money(totalPayouts)}`}
              {activeTab === 'collections' && `+${money(shiftTotals.cash_collections)}`}
              {activeTab === 'sales' && `+${money(shiftTotals.cash_sales)}`}
              {activeTab === 'bills' && `${shiftTotals.bills_count} bills`}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-950 text-xs font-bold transition-all cursor-pointer shadow-xs"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
