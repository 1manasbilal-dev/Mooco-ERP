import React, { useState, useMemo } from 'react';
import {
  Printer,
  X,
  Calendar,
  Filter,
  FileText,
  Layers,
  MessageCircle,
  CheckCircle2,
  Sparkles,
  Info
} from 'lucide-react';
import {
  DatePreset,
  LedgerTypeFilter,
  StatementCompany,
  StatementSupplier,
  SupplierStatement,
  buildSupplierStatement,
  printSupplierLedger,
  rangeForPreset,
  formatMoney,
  balancePhrase
} from '../../lib/supplierStatement';
import { Supplier } from '../../types';

interface RawPurchase {
  id: string;
  supplier_id?: string;
  date?: string;
  quantity?: number;
  milk_type?: string;
  shift?: string;
  rate?: number;
  fat?: number;
  snf?: number;
  total_amount?: number;
  paid_amount?: number;
  status?: string;
  details?: { paid_amount?: number; due_amount?: number };
}

interface RawMaterial {
  id: string;
  supplier_id?: string;
  date?: string;
  item_name?: string;
  quantity?: number;
  unit?: string;
  total_amount?: number;
  paid_amount?: number;
  status?: string;
  details?: { paid_amount?: number };
}

interface RawTx {
  id: string;
  supplier_id?: string;
  date?: string;
  type?: string;
  amount?: number;
  mode?: string;
  note?: string;
  account_id?: string;
  details?: {
    mode?: string;
    note?: string;
    purchase_id?: string;
    cash_refund?: number;
    account_id?: string;
  };
}

export interface SupplierLedgerPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  supplier: Supplier;
  company: StatementCompany;
  purchases: RawPurchase[];
  materialPurchases: RawMaterial[];
  transactions: RawTx[];
  accountNames: Record<string, string>;
  initialPreset?: DatePreset;
  initialFrom?: string;
  initialTo?: string;
  initialType?: LedgerTypeFilter;
  onSendWhatsApp?: (supplier: Supplier, statement: SupplierStatement) => void;
}

const MODAL_PRESETS: { id: DatePreset; label: string; desc: string }[] = [
  { id: 'all', label: 'All Time', desc: 'Full History' },
  { id: 'today', label: 'Today', desc: 'Today Only' },
  { id: 'week', label: 'This Week', desc: 'Last 7 Days' },
  { id: 'tendays', label: '10 Days Cycle', desc: 'Dahha Billing' },
  { id: 'fifteendays', label: '15 Days Cycle', desc: 'Fortnightly' },
  { id: 'month', label: 'This Month', desc: 'Current Month' },
  { id: 'lastmonth', label: 'Last Month', desc: 'Previous Month' },
  { id: 'custom', label: 'Custom Range', desc: 'Selected Dates' }
];

export function SupplierLedgerPrintModal(props: SupplierLedgerPrintModalProps) {
  if (!props.isOpen) return null;

  const [preset, setPreset] = useState<DatePreset>(props.initialPreset || 'all');
  const [from, setFrom] = useState<string>(() => {
    if (props.initialFrom) return props.initialFrom;
    return rangeForPreset(props.initialPreset || 'all').from;
  });
  const [to, setTo] = useState<string>(() => {
    if (props.initialTo) return props.initialTo;
    return rangeForPreset(props.initialPreset || 'all').to;
  });
  const [typeFilter, setTypeFilter] = useState<LedgerTypeFilter>(props.initialType || 'All');
  const [viewMode, setViewMode] = useState<'detailed' | 'daily_summary'>('detailed');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const handleSelectPreset = (newPreset: DatePreset) => {
    setPreset(newPreset);
    if (newPreset !== 'custom') {
      const range = rangeForPreset(newPreset);
      setFrom(range.from);
      setTo(range.to);
    }
  };

  const statementSupplier: StatementSupplier = useMemo(() => ({
    id: props.supplier.id,
    name: props.supplier.name,
    phone: props.supplier.phone,
    whatsapp: props.supplier.whatsapp,
    village: props.supplier.village,
    city: props.supplier.city,
    address: props.supplier.address,
    pendingBalance: Number(props.supplier.pending_balance) || 0
  }), [props.supplier]);

  const statement = useMemo(() => {
    return buildSupplierStatement({
      supplier: statementSupplier,
      purchases: props.purchases,
      materialPurchases: props.materialPurchases,
      transactions: props.transactions,
      from,
      to,
      kind: typeFilter,
      query: searchQuery,
      accountNames: props.accountNames
    });
  }, [statementSupplier, props.purchases, props.materialPurchases, props.transactions, from, to, typeFilter, searchQuery, props.accountNames]);

  const handlePrint = () => {
    printSupplierLedger({
      company: props.company,
      supplier: statementSupplier,
      statement,
      typeFilter,
      viewMode
    });
    props.onClose();
  };

  const handleWhatsApp = () => {
    if (props.onSendWhatsApp) {
      props.onSendWhatsApp(props.supplier, statement);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-lime-400">
              <Printer size={20} />
            </div>
            <div>
              <h3 className="text-base font-black tracking-tight">Print & Export Supplier Ledger</h3>
              <p className="text-xs text-slate-300 font-medium mt-0.5">
                {props.supplier.name} {props.supplier.phone ? `· ${props.supplier.phone}` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={props.onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-slate-800 dark:text-slate-100">
          
          {/* Section 1: Date Range Filter */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Calendar size={14} className="text-slate-400" />
                <span>1. Select Date Range</span>
              </label>
              <span className="text-[11px] font-semibold text-lime-700 dark:text-lime-400 bg-lime-50 dark:bg-lime-950/50 px-2.5 py-0.5 rounded-full border border-lime-200 dark:border-lime-900">
                {statement.rangeLabel}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {MODAL_PRESETS.map(p => {
                const active = preset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectPreset(p.id)}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      active
                        ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                        : 'bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="font-bold text-xs">{p.label}</div>
                    <div className={`text-[10px] mt-0.5 ${active ? 'text-slate-300' : 'text-slate-400'}`}>
                      {p.desc}
                    </div>
                  </button>
                );
              })}
            </div>

            {preset === 'custom' && (
              <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[140px]">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">From Date</label>
                  <input
                    type="date"
                    value={from}
                    onChange={e => setFrom(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 bg-white dark:bg-slate-800 dark:border-slate-600 text-slate-800 dark:text-white"
                  />
                </div>
                <div className="flex-1 min-w-[140px]">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">To Date</label>
                  <input
                    type="date"
                    value={to}
                    onChange={e => setTo(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 bg-white dark:bg-slate-800 dark:border-slate-600 text-slate-800 dark:text-white"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Transaction Category Filter */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 mb-2">
              <Filter size={14} className="text-slate-400" />
              <span>2. Record Type</span>
            </label>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'All', title: 'All Records', desc: 'Full Ledger' },
                { id: 'Milk', title: 'Milk Only', desc: 'Milk Supply' },
                { id: 'Payment', title: 'Payments Only', desc: 'Cash & Bank' },
                { id: 'Material', title: 'Materials / Feed', desc: 'Feed & Items' }
              ].map(t => {
                const active = typeFilter === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTypeFilter(t.id as LedgerTypeFilter)}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      active
                        ? 'bg-lime-600 text-white border-lime-600 shadow-sm'
                        : 'bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="font-bold text-xs">{t.title}</div>
                    <div className={`text-[10px] mt-0.5 ${active ? 'text-lime-100' : 'text-slate-400'}`}>
                      {t.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 3: Layout Style */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 mb-2">
              <Layers size={14} className="text-slate-400" />
              <span>3. Print Layout Style</span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setViewMode('detailed')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  viewMode === 'detailed'
                    ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                    : 'bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div className="font-bold text-xs">Detailed Chronological Ledger</div>
                <div className={`text-[10px] mt-0.5 ${viewMode === 'detailed' ? 'text-slate-300' : 'text-slate-400'}`}>
                  Shows every purchase, material delivery, and cash/bank voucher in order
                </div>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('daily_summary')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  viewMode === 'daily_summary'
                    ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                    : 'bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div className="font-bold text-xs">Daily Consolidated Summary</div>
                <div className={`text-[10px] mt-0.5 ${viewMode === 'daily_summary' ? 'text-slate-300' : 'text-slate-400'}`}>
                  One line per date combining Morning + Evening milk (Fits 1 page)
                </div>
              </button>
            </div>
          </div>

          {/* Section 4: Live Summary Preview */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300">
              <span className="flex items-center gap-1.5">
                <Info size={14} className="text-lime-600" />
                <span>Live Statement Preview</span>
              </span>
              <span className="text-[11px] font-semibold text-slate-400">
                {statement.printRows.length} entries to print
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                <span className="text-[9px] uppercase font-bold text-slate-400 block">Opening</span>
                <span className="font-mono font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-200 mt-0.5 block">
                  {formatMoney(Math.abs(statement.openingBalance))}
                </span>
              </div>
              <div className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                <span className="text-[9px] uppercase font-bold text-amber-600 block">Supplies (Cr)</span>
                <span className="font-mono font-bold text-xs sm:text-sm text-amber-600 mt-0.5 block">
                  {formatMoney(statement.totalCredit)}
                </span>
              </div>
              <div className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                <span className="text-[9px] uppercase font-bold text-emerald-600 block">Paid (Dr)</span>
                <span className="font-mono font-bold text-xs sm:text-sm text-emerald-600 mt-0.5 block">
                  {formatMoney(statement.netPaid)}
                </span>
              </div>
              <div className={`p-2.5 rounded-xl border font-bold ${
                statement.closingBalance > 0.5
                  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 text-amber-800 dark:text-amber-300'
                  : statement.closingBalance < -0.5
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 text-emerald-800 dark:text-emerald-300'
                  : 'bg-white dark:bg-slate-900 border-slate-200 text-slate-700'
              }`}>
                <span className="text-[9px] uppercase font-bold opacity-80 block">Net Balance</span>
                <span className="font-mono font-black text-xs sm:text-sm mt-0.5 block">
                  {balancePhrase(statement.closingBalance)}
                </span>
              </div>
            </div>

            {statement.milkStats && statement.milkStats.totalLitres > 0 && (
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 flex items-center justify-between pt-1 border-t border-slate-200 dark:border-slate-700">
                <span>🥛 Milk Received: <strong className="text-slate-900 dark:text-white">{statement.milkStats.totalLitres.toLocaleString()} L</strong></span>
                <span>🌅 Morning: <strong className="text-slate-900 dark:text-white">{statement.milkStats.morningLitres} L</strong></span>
                <span>🌆 Evening: <strong className="text-slate-900 dark:text-white">{statement.milkStats.eveningLitres} L</strong></span>
                <span>💰 Avg Rate: <strong className="text-slate-900 dark:text-white">Rs {statement.milkStats.avgRate}/L</strong></span>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={props.onClose}
            className="px-4 py-2.5 rounded-xl font-bold text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700 transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            {props.onSendWhatsApp && (
              <button
                type="button"
                onClick={handleWhatsApp}
                className="px-4 py-2.5 rounded-xl font-bold text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300 flex items-center gap-1.5 transition-all cursor-pointer"
                title="Send WhatsApp Statement"
              >
                <MessageCircle size={15} />
                <span>WhatsApp</span>
              </button>
            )}

            <button
              type="button"
              onClick={handlePrint}
              className="px-5 py-2.5 rounded-xl font-black text-xs bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-2 shadow-md shadow-slate-900/20 active:scale-98 transition-all cursor-pointer"
            >
              <Printer size={16} />
              <span>Print Ledger</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
