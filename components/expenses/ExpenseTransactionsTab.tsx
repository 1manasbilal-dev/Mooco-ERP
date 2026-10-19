import React from 'react';
import { 
  Search, Calendar, FolderTree, Plus, Tag, CornerDownRight, Users, 
  Paperclip, Edit, Trash2, CheckCircle2, Clock, AlertCircle, X, 
  ChevronDown, Filter, ChevronRight, FileText, BookmarkPlus, Bookmark,
  CalendarRange, ArrowRight, RotateCcw
} from 'lucide-react';
import { RichSelect } from '../RichSelect';
import { ExpenseEntry, ExpenseVendor, SavedExpense } from '../../types';
import { CategoryStructure, ExpenseDateFilterMode } from './ExpenseTypes';
import { formatCurrency } from '../../lib/formatters';

const DATE_FILTER_OPTIONS: { value: ExpenseDateFilterMode; label: string }[] = [
  { value: 'this_month', label: 'This Month' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7days', label: 'Last 7 Days' },
  { value: '30days', label: 'Last 30 Days' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'single_date', label: 'Specific Date 📅' },
  { value: 'custom_range', label: 'Date Range (From - To) 📆' },
  { value: 'all', label: 'All Dates (All Time)' },
];

interface ExpenseTransactionsTabProps {
  expenses: ExpenseEntry[];
  filteredExpenses: ExpenseEntry[];
  expenseVendors: ExpenseVendor[];
  categoryTree: CategoryStructure[];
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
  handleOpenAddModal: () => void;
  handleEditExpense: (exp: ExpenseEntry) => void;
  handleDeleteExpense: (id: string) => void;
  savedExpenses: SavedExpense[];
  onOpenSavedExpenses: () => void;
  onSaveRecorded: (expense: ExpenseEntry) => void;
  setIsCategoryModalOpen: (open: boolean) => void;
  setSelectedVendorId: (id: string) => void;
  setActiveTab: (tab: 'transactions' | 'vendors') => void;
  setIsMobileLedgerOpen: (open: boolean) => void;
  formatDateDisplay: (date: string) => string;
}

export const ExpenseTransactionsTab: React.FC<ExpenseTransactionsTabProps> = ({
  expenses,
  filteredExpenses,
  expenseVendors,
  categoryTree,
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
  handleOpenAddModal,
  handleEditExpense,
  handleDeleteExpense,
  savedExpenses,
  onOpenSavedExpenses,
  onSaveRecorded,
  setIsCategoryModalOpen,
  setSelectedVendorId,
  setActiveTab,
  setIsMobileLedgerOpen,
  formatDateDisplay
}) => {
  return (
    <div className="space-y-3.5">
      {/* 1. Mobile Action & Filter Header */}
      <div className="md:hidden bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input 
              type="text" 
              placeholder="Search expenses..." 
              className="w-full pl-8 pr-7 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:border-lime-500 transition-all" 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)} 
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 p-0.5 cursor-pointer">
                <X size={12} />
              </button>
            )}
          </div>
          <button
            onClick={() => setIsTxFilterOpen(prev => !prev)}
            className={`p-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              isTxFilterOpen || filterCategory !== 'All' || filterVendor !== 'All' || filterPaymentStatus !== 'All' || dateFilterMode !== 'this_month'
                ? 'bg-lime-50 dark:bg-lime-950/40 border-lime-300 dark:border-lime-700 text-lime-700 dark:text-lime-300'
                : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
            }`}
            title="Filters"
          >
            <Filter size={14} />
            {(filterCategory !== 'All' || filterVendor !== 'All' || filterPaymentStatus !== 'All' || dateFilterMode !== 'this_month') && (
              <span className="w-2 h-2 rounded-full bg-lime-500" />
            )}
          </button>
        </div>

        {/* Mobile Fast Action Buttons */}
        <div className="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
          {canCreate && (
            <button
              onClick={handleOpenAddModal}
              className="flex-1 py-2.5 px-3 bg-lime-600 hover:bg-lime-700 active:scale-95 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow-md shadow-lime-600/30 transition-all cursor-pointer"
            >
              <Plus size={16} />
              <span>Record Expense</span>
            </button>
          )}
          {canCreate && (
            <button
              onClick={onOpenSavedExpenses}
              className="px-3 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shrink-0"
              title="Saved expenses"
            >
              <Bookmark size={14} className="text-lime-600 dark:text-lime-400" />
              <span>Saved</span>
              {savedExpenses.length > 0 && (
                <span className="min-w-4 rounded-full bg-lime-600 px-1 text-[10px] font-black text-white">{savedExpenses.length}</span>
              )}
            </button>
          )}
          <button
            onClick={() => setIsCategoryModalOpen(true)}
            className="px-3 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shrink-0"
            title="Manage Categories"
          >
            <FolderTree size={14} className="text-lime-600 dark:text-lime-400" />
            <span className="hidden xs:inline">Categories</span>
          </button>
        </div>

        {isTxFilterOpen && (
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2.5 animate-in fade-in">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Date Preset / Mode:</span>
              <RichSelect
                options={DATE_FILTER_OPTIONS.map(opt => ({
                  value: opt.value,
                  label: opt.label
                }))}
                value={dateFilterMode}
                onChange={val => setDateFilterMode(val as ExpenseDateFilterMode)}
                placeholder="Date Filter"
              />
            </div>

            {/* Conditional input based on selected date filter mode */}
            {dateFilterMode === 'this_month' && (
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1.5">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider w-16">Month:</span>
                <input 
                  type="month" 
                  className="bg-transparent text-xs font-bold text-slate-800 dark:text-slate-100 flex-1 outline-none cursor-pointer" 
                  value={filterMonth} 
                  onChange={e => setFilterMonth(e.target.value)} 
                />
              </div>
            )}

            {dateFilterMode === 'single_date' && (
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 border border-lime-300 dark:border-lime-700 rounded-xl px-2.5 py-1.5">
                <Calendar size={14} className="text-lime-600" />
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider w-14">Date:</span>
                <input 
                  type="date" 
                  className="bg-transparent text-xs font-bold text-slate-800 dark:text-slate-100 flex-1 outline-none cursor-pointer" 
                  value={filterSingleDate} 
                  onChange={e => setFilterSingleDate(e.target.value)} 
                />
              </div>
            )}

            {dateFilterMode === 'custom_range' && (
              <div className="space-y-1.5 bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-lime-300 dark:border-lime-700">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider w-12">From:</span>
                  <input 
                    type="date" 
                    className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-semibold text-slate-800 dark:text-slate-100 flex-1 outline-none cursor-pointer" 
                    value={filterStartDate} 
                    onChange={e => setFilterStartDate(e.target.value)} 
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider w-12">To:</span>
                  <input 
                    type="date" 
                    className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-semibold text-slate-800 dark:text-slate-100 flex-1 outline-none cursor-pointer" 
                    value={filterEndDate} 
                    onChange={e => setFilterEndDate(e.target.value)} 
                  />
                </div>
              </div>
            )}

            <RichSelect
              options={[
                { value: 'All', label: 'All Categories' },
                ...categoryTree.map(c => ({ value: c.name, label: c.name }))
              ]}
              value={filterCategory}
              onChange={val => setFilterCategory(val)}
              placeholder="All Categories"
            />
            <RichSelect
              options={[
                { value: 'All', label: 'All Vendors' },
                ...expenseVendors.map(v => ({ value: v.id, label: v.name }))
              ]}
              value={filterVendor}
              onChange={val => setFilterVendor(val)}
              placeholder="All Vendors"
            />
            <RichSelect
              options={[
                { value: 'All', label: 'All Payment Statuses' },
                { value: 'Paid', label: 'Paid Full' },
                { value: 'Partial', label: 'Partial' },
                { value: 'Unpaid', label: 'Unpaid' }
              ]}
              value={filterPaymentStatus}
              onChange={val => setFilterPaymentStatus(val)}
              placeholder="All Statuses"
            />

            {(dateFilterMode !== 'this_month' || filterCategory !== 'All' || filterVendor !== 'All' || filterPaymentStatus !== 'All' || searchTerm) && (
              <button
                type="button"
                onClick={() => {
                  setDateFilterMode('this_month');
                  setFilterSingleDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }));
                  setFilterStartDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }));
                  setFilterEndDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }));
                  setFilterCategory('All');
                  setFilterVendor('All');
                  setFilterPaymentStatus('All');
                  setSearchTerm('');
                }}
                className="w-full py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <RotateCcw size={12} />
                <span>Reset All Filters</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 2. Desktop Toolbar */}
      <div className="hidden md:block bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-3">
        {/* Top Row: Search and Action Buttons */}
        <div className="flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-lg">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input 
              type="text" 
              placeholder="Search expenses by description, amount, reference..." 
              className="w-full pl-9 pr-8 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:border-lime-500 transition-all shadow-inner" 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)} 
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer">
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {canCreate && (
              <button
                onClick={onOpenSavedExpenses}
                className="px-3.5 py-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer"
                title="Saved expenses"
              >
                <Bookmark size={14} className="text-lime-600 dark:text-lime-400" />
                <span>Saved</span>
                {savedExpenses.length > 0 && (
                  <span className="min-w-4 rounded-full bg-lime-600 px-1.5 text-[10px] font-black text-white">{savedExpenses.length}</span>
                )}
              </button>
            )}
            <button 
              onClick={() => setIsCategoryModalOpen(true)} 
              className="px-3.5 py-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer"
              title="Manage Categories"
            >
              <FolderTree size={14} className="text-lime-600 dark:text-lime-400"/> <span>Categories</span>
            </button>

            {canCreate && (
              <button 
                onClick={handleOpenAddModal} 
                className="px-4 py-2 bg-lime-600 hover:bg-lime-700 active:scale-95 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-lime-600/20 transition-all cursor-pointer"
              >
                <Plus size={15}/> <span>Record Expense</span>
              </button>
            )}
          </div>
        </div>

        {/* Middle Row: Date Quick Presets & Range Selection */}
        <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1 flex items-center gap-1">
              <Calendar size={12} /> Date:
            </span>
            {[
              { id: 'this_month', label: 'This Month' },
              { id: 'today', label: 'Today' },
              { id: 'yesterday', label: 'Yesterday' },
              { id: '7days', label: 'Last 7 Days' },
              { id: '30days', label: 'Last 30 Days' },
              { id: 'single_date', label: 'Specific Date' },
              { id: 'custom_range', label: 'Date Range' },
              { id: 'all', label: 'All' }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDateFilterMode(tab.id as ExpenseDateFilterMode)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  dateFilterMode === tab.id
                    ? 'bg-lime-600 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Dynamic Date Pickers depending on selected mode */}
          <div className="flex items-center gap-2">
            {dateFilterMode === 'this_month' && (
              <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-xl text-xs font-semibold">
                <span className="text-[10px] text-slate-400 font-bold uppercase">Month:</span>
                <input
                  type="month"
                  value={filterMonth}
                  onChange={e => setFilterMonth(e.target.value)}
                  className="bg-transparent text-xs font-bold text-slate-800 dark:text-slate-100 outline-none cursor-pointer"
                />
              </div>
            )}

            {dateFilterMode === 'single_date' && (
              <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 border border-lime-400 dark:border-lime-600 px-2.5 py-1 rounded-xl text-xs font-semibold ring-2 ring-lime-500/10">
                <Calendar size={13} className="text-lime-600 dark:text-lime-400" />
                <span className="text-[10px] text-slate-400 font-bold uppercase">Select Date:</span>
                <input
                  type="date"
                  value={filterSingleDate}
                  onChange={e => setFilterSingleDate(e.target.value)}
                  className="bg-transparent text-xs font-bold text-slate-800 dark:text-slate-100 outline-none cursor-pointer"
                />
              </div>
            )}

            {dateFilterMode === 'custom_range' && (
              <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 border border-lime-400 dark:border-lime-600 px-2.5 py-1 rounded-xl text-xs font-semibold ring-2 ring-lime-500/10">
                <CalendarRange size={13} className="text-lime-600 dark:text-lime-400" />
                <span className="text-[10px] text-slate-400 font-bold uppercase">From:</span>
                <input
                  type="date"
                  value={filterStartDate}
                  onChange={e => setFilterStartDate(e.target.value)}
                  className="bg-transparent text-xs font-bold text-slate-800 dark:text-slate-100 outline-none cursor-pointer"
                />
                <ArrowRight size={11} className="text-slate-400" />
                <span className="text-[10px] text-slate-400 font-bold uppercase">To:</span>
                <input
                  type="date"
                  value={filterEndDate}
                  onChange={e => setFilterEndDate(e.target.value)}
                  className="bg-transparent text-xs font-bold text-slate-800 dark:text-slate-100 outline-none cursor-pointer"
                />
              </div>
            )}

            {(dateFilterMode !== 'this_month' || filterCategory !== 'All' || filterVendor !== 'All' || filterPaymentStatus !== 'All' || searchTerm) && (
              <button
                type="button"
                onClick={() => {
                  setDateFilterMode('this_month');
                  setFilterSingleDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }));
                  setFilterStartDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }));
                  setFilterEndDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }));
                  setFilterCategory('All');
                  setFilterVendor('All');
                  setFilterPaymentStatus('All');
                  setSearchTerm('');
                }}
                className="text-[11px] font-bold text-slate-400 hover:text-rose-600 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title="Reset all filters"
              >
                <RotateCcw size={11} />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 pt-2.5 border-t border-slate-100 dark:border-slate-800">
          <RichSelect
            options={[
              { value: 'All', label: `All Categories (${categoryTree.length})`, icon: <Tag size={12} /> },
              ...categoryTree.map(c => ({
                value: c.name,
                label: c.name,
                badge: !c.isActive ? 'Disabled' : `${c.subcategories.length}`,
                badgeColor: !c.isActive ? 'slate' : 'lime' as const,
                icon: <Tag size={12} />
              }))
            ]}
            value={filterCategory}
            onChange={val => setFilterCategory(val)}
            placeholder="All Categories"
            searchPlaceholder="Search category..."
          />

          <RichSelect
            options={[
              { value: 'All', label: `All Vendors (${expenseVendors.length})`, icon: <Users size={12} /> },
              ...expenseVendors.map(v => ({
                value: v.id,
                label: v.name,
                subtext: v.service_type || 'Vendor',
                badge: v.pending_balance && v.pending_balance > 0 ? `${formatCurrency(v.pending_balance)}` : undefined,
                badgeColor: (v.pending_balance && v.pending_balance > 0 ? 'red' : 'emerald') as any,
                icon: <Users size={12} />
              }))
            ]}
            value={filterVendor}
            onChange={val => setFilterVendor(val)}
            placeholder="All Vendors"
            searchPlaceholder="Search vendor..."
          />

          <RichSelect
            options={[
              { value: 'All', label: 'All Payment Statuses' },
              { value: 'Paid', label: 'Paid Full', badge: 'Paid', badgeColor: 'emerald', icon: <CheckCircle2 size={12} className="text-emerald-600" /> },
              { value: 'Partial', label: 'Partial', badge: 'Partial', badgeColor: 'amber', icon: <Clock size={12} className="text-amber-600" /> },
              { value: 'Unpaid', label: 'Unpaid', badge: 'Due', badgeColor: 'red', icon: <AlertCircle size={12} className="text-rose-600" /> }
            ]}
            value={filterPaymentStatus}
            onChange={val => setFilterPaymentStatus(val)}
            placeholder="All Statuses"
          />
        </div>
      </div>

      {/* 3. Desktop Table View */}
      <div className="hidden md:block bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/90 dark:bg-slate-850 text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Classification</th>
              <th className="px-4 py-3">Description & Party</th>
              <th className="px-4 py-3 text-right">Amount (Rs)</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-center">Paid Account</th>
              <th className="px-4 py-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium text-slate-700 dark:text-slate-200">
            {filteredExpenses.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  No expense records found matching current filters
                </td>
              </tr>
            ) : (
              filteredExpenses.map((exp) => {
                const isFullPaid = !exp.paymentStatus || exp.paymentStatus === 'Paid';
                const isPartial = exp.paymentStatus === 'Partial';
                const isUnpaid = exp.paymentStatus === 'Unpaid';
                const remainingDue = Math.max(0, exp.amount - (exp.paidAmount !== undefined ? exp.paidAmount : (isUnpaid ? 0 : exp.amount)));
                const matchedVendor = expenseVendors.find(v => v.id === exp.vendor_id);

                return (
                  <tr key={exp.id} className="hover:bg-lime-50/20 dark:hover:bg-lime-950/20 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-semibold text-slate-800 dark:text-slate-200 font-mono text-[11px] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
                        {formatDateDisplay(exp.date)}
                      </span>
                      {exp.dueDate && (
                        <span className="block text-[10px] text-amber-600 font-bold mt-0.5">Due: {exp.dueDate}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                          <Tag size={11} className="text-lime-600 shrink-0"/> {exp.category}
                        </span>
                        {exp.subcategory && (
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1 ml-3 mt-0.5">
                            <CornerDownRight size={9} className="text-slate-400 shrink-0"/> {exp.subcategory}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-bold text-slate-800 dark:text-slate-100 text-xs">{exp.description}</p>
                        {exp.vendor_name && (
                          <button 
                            type="button"
                            onClick={() => {
                              if (matchedVendor) {
                                setSelectedVendorId(matchedVendor.id);
                                setActiveTab('vendors');
                                setIsMobileLedgerOpen(true);
                              }
                            }}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 mt-0.5 bg-slate-100 dark:bg-slate-800 hover:bg-lime-100 dark:hover:bg-lime-950/50 hover:text-lime-900 text-slate-700 dark:text-slate-300 rounded text-[10px] font-bold transition-colors cursor-pointer"
                            title="View Vendor Khata"
                          >
                            <Users size={9}/> {exp.vendor_name}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-black text-slate-900 dark:text-slate-100 text-xs whitespace-nowrap">
                      {formatCurrency(exp.amount)}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <div className="flex flex-col items-center">
                        {isFullPaid ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/90 dark:border-emerald-800 shadow-2xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Paid Full
                          </span>
                        ) : isPartial ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/90 dark:border-amber-800 shadow-2xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Partial
                            </span>
                            <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold">{formatCurrency(remainingDue)} Due</span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200/90 dark:border-rose-800 shadow-2xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> Unpaid
                            </span>
                            <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold">{formatCurrency(remainingDue)} Due</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap text-[11px]">
                      {exp.paymentMode || 'Cash'}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => onSaveRecorded(exp)}
                          className="p-1.5 text-slate-400 hover:text-lime-600 hover:bg-lime-50 dark:hover:bg-lime-950/40 rounded-lg transition-colors cursor-pointer"
                          title="Save for quick record"
                        >
                          <BookmarkPlus size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEditExpense(exp)}
                          className="p-1.5 text-slate-400 hover:text-lime-600 hover:bg-lime-50 dark:hover:bg-lime-950/40 rounded-lg transition-colors cursor-pointer"
                          title="Edit Expense"
                        >
                          <Edit size={14} />
                        </button>
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => handleDeleteExpense(exp.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
                            title="Delete Expense"
                          >
                            <Trash2 size={14} />
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

      {/* 4. Mobile Card View */}
      <div className="md:hidden space-y-2.5">
        {filteredExpenses.length === 0 ? (
          <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-slate-400 text-xs">
            No expenses found
          </div>
        ) : (
          filteredExpenses.map((exp) => (
            <div 
              key={exp.id} 
              className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] font-mono text-slate-400 font-bold">{formatDateDisplay(exp.date)}</span>
                  <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm mt-0.5">{exp.description}</h4>
                  <p className="text-xs text-lime-700 dark:text-lime-400 font-medium">{exp.category}{exp.subcategory ? ` • ${exp.subcategory}` : ''}</p>
                </div>
                <div className="text-right">
                  <span className="font-mono font-black text-sm text-slate-900 dark:text-slate-100 block">{formatCurrency(exp.amount)}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-block mt-1 ${
                    exp.paymentStatus === 'Unpaid' 
                      ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300' 
                      : exp.paymentStatus === 'Partial' 
                      ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300' 
                      : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                  }`}>
                    {exp.paymentStatus || 'Paid'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                <span className="text-slate-400 text-[11px]">{exp.paymentMode || 'Cash'}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onSaveRecorded(exp)}
                    className="p-1 text-slate-400 hover:text-lime-600 cursor-pointer"
                    title="Save for quick record"
                  >
                    <BookmarkPlus size={14} />
                  </button>
                  <button
                    onClick={() => handleEditExpense(exp)}
                    className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <Edit size={14} />
                  </button>
                  {canDelete && (
                    <button
                      onClick={() => handleDeleteExpense(exp.id)}
                      className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
