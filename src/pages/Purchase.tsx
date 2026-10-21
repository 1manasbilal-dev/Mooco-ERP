import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { useTabs } from '../context/TabContext';
import { MilkType, PurchaseType } from '../types';
import {
  Save, Milk, Package, History, Trash2, Calendar as CalendarIcon,
  ChevronDown, Search, X, User, RotateCcw, Sun, Moon, Wallet, Banknote, Smartphone,
  Plus, Minus, ShoppingCart, Check, Loader2, AlertTriangle, ArrowRight, BookOpen, Lock, Receipt, Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '../context/ToastContext';
import type { RichSelectOption } from '../components/RichSelect';
import { formatQty, formatCurrency, normalizeTransactionTimestamp, getTodayLocalDate } from '../lib/formatters';
import { businessDate } from '../lib/dashboardAnalytics';
import { SmartNumberInput } from '../components/SmartNumberInput';
import { roundCurrency, roundQuantity } from '../lib/db';
import { confirmAction } from '../components/ui/ConfirmDialog';
import { Modal } from '../components/ui/Modal';
import {
  Avatar, PillGroup, PillOption, ProcurementHeader, SectionLabel, SettlementBar, ShiftIcon, StatTile, varietyDot,
} from '../components/procurement/ProcurementUI';

// Cast works around Framer Motion's prop typings.
const MotionDiv = motion.div as any;

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const SearchableSupplierDropdown: React.FC<{
  value: string;
  onChange: (id: string) => void;
  suppliers: any[];
  placeholder: string;
  inputClass?: string;
  labelClass?: string;
  focusToken?: number;
}> = ({ value, onChange, suppliers, placeholder, inputClass = '', focusToken = 0 }) => {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedSupplier = useMemo(() => suppliers.find(s => s.id === value), [value, suppliers]);

  useEffect(() => {
    if (selectedSupplier) {
      setSearch(selectedSupplier.name);
    } else {
      setSearch('');
    }
  }, [value, selectedSupplier]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch(selectedSupplier ? selectedSupplier.name : '');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedSupplier]);

  const filtered = useMemo(() => {
    if (!isOpen && selectedSupplier && search === selectedSupplier.name) {
      return suppliers;
    }
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(s => {
      const name = (s.name || '').toLowerCase();
      const village = (s.village || s.city || '').toLowerCase();
      const phone = (s.phone || s.whatsapp || '').toLowerCase();
      return name.includes(q) || village.includes(q) || phone.includes(q);
    });
  }, [suppliers, search, isOpen, selectedSupplier]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [filtered.length, isOpen]);

  useEffect(() => {
    if (!focusToken) return;
    inputRef.current?.focus();
    setIsOpen(true);
  }, [focusToken]);

  const handleSelect = (supplierId: string) => {
    const found = suppliers.find(s => s.id === supplierId);
    onChange(supplierId);
    if (found) {
      setSearch(found.name);
    } else {
      setSearch('');
    }
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev + 1 < filtered.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev - 1 >= 0 ? prev - 1 : filtered.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length > 0 && highlightedIndex >= 0 && highlightedIndex < filtered.length) {
        handleSelect(filtered[highlightedIndex].id);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      setSearch(selectedSupplier ? selectedSupplier.name : '');
    }
  };

  return (
    <div className="relative w-full" ref={dropdownRef}>
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" size={15} />
        <input
          ref={inputRef}
          type="text"
          className={`${inputClass} pl-10 pr-10 text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500`}
          placeholder={placeholder}
          value={search}
          onFocus={(e) => {
            setIsOpen(true);
            e.currentTarget.select();
          }}
          onChange={(e) => {
            setSearch(e.target.value);
            setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        {value ? (
          <button aria-label="Clear Selection"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
              setSearch('');
              inputRef.current?.focus();
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 p-1 rounded-lg transition-colors cursor-pointer"
            title="Clear Selection"
          >
            <X size={14} />
          </button>
        ) : (
          <ChevronDown
            className={`absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 transition-transform duration-200 pointer-events-none ${
              isOpen ? 'rotate-180 text-lime-600 dark:text-lime-400' : ''
            }`}
            size={15}
          />
        )}
      </div>

      {isOpen && (
        <div
          ref={listRef}
          className="absolute top-full left-0 right-0 mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl dark:shadow-2xl dark:shadow-black/70 max-h-64 overflow-y-auto z-50 divide-y divide-slate-100 dark:divide-slate-800 p-1"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-400 dark:text-slate-500">
              <User className="mx-auto mb-1.5 text-slate-300 dark:text-slate-600" size={20} />
              <p className="font-semibold">Koi supplier / gwala nahi mila</p>
              <p className="text-[11px] mt-0.5">&ldquo;{search}&rdquo; se koi match nahi hua</p>
            </div>
          ) : (
            filtered.map((s, idx) => {
              const isSelected = s.id === value;
              const isHighlighted = idx === highlightedIndex;
              const bal = Number(s.pending_balance ?? s.balance ?? 0);
              const avatarLetter = (s.name || '?').charAt(0).toUpperCase();

              return (
                <button
                  key={s.id}
                  type="button"
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center justify-between gap-2.5 text-xs cursor-pointer ${
                    isSelected
                      ? 'bg-lime-500/10 text-lime-900 dark:text-lime-200 font-semibold ring-1 ring-lime-500/30'
                      : isHighlighted
                      ? 'bg-slate-100/90 dark:bg-slate-800/80 text-slate-900 dark:text-slate-100'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-200'
                  }`}
                  onClick={() => handleSelect(s.id)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                        bal > 0
                          ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                          : 'bg-lime-100 dark:bg-lime-950/60 text-lime-700 dark:text-lime-300'
                      }`}
                    >
                      {avatarLetter}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm truncate">
                          {s.name}
                        </span>
                        {s.default_milk_type && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            {s.default_milk_type} {s.default_rate ? `@ Rs ${s.default_rate}` : ''}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-1.5 mt-0.5 truncate">
                        {s.village && <span>{s.village}</span>}
                        {s.phone && <span>• {s.phone}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0 flex items-center gap-2">
                    {bal !== 0 ? (
                      <span
                        className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-md border ${
                          bal > 0
                            ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                            : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                        }`}
                      >
                        {formatCurrency(Math.abs(bal))} {bal > 0 ? 'Due' : 'Adv'}
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                        Clear
                      </span>
                    )}
                    {isSelected && <Check size={14} className="text-lime-600 dark:text-lime-400 shrink-0" />}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

const Purchase: React.FC<{ view?: 'milk' | 'supplies' }> = ({ view = 'milk' }) => {
  const { 
    suppliers, purchases, materialPurchases, allocations, addPurchase, 
    returnPurchase, returnMaterialPurchase, addBulkMaterialPurchase, 
    items, inventory = [], settings, accounts = [], activeShiftSession, isDayLocked
  } = useDairy();
  const { showToast } = useToast();
  const { openTab } = useTabs();

  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = view === 'supplies' ? PurchaseType.RAW_MATERIAL : PurchaseType.MILK;
  const [supplierFocusToken, setSupplierFocusToken] = useState(0);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingInvoice, setIsSubmittingInvoice] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('history') === 'true';
  });
  const [historySearch, setHistorySearch] = useState('');
  const [logScope, setLogScope] = useState<'today' | 'all'>('today');

  // Older links used ?tab=milk|material on one screen. Send them to the matching submodule.
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const tabParam = sp.get('tab');
    const histParam = sp.get('history');
    if (view === 'milk' && tabParam === 'material') {
      openTab('purchase-supplies');
      return;
    }
    if (view === 'supplies' && tabParam === 'milk') {
      openTab('purchase');
      return;
    }
    const shouldHistory = histParam === 'true';
    if (shouldHistory !== isHistoryOpen) {
      setIsHistoryOpen(shouldHistory);
    }
  }, [location.search, view, isHistoryOpen, openTab]);

  const toggleHistory = (open?: boolean) => {
    const nextVal = open !== undefined ? open : !isHistoryOpen;
    setIsHistoryOpen(nextVal);
    const sp = new URLSearchParams(location.search);
    if (nextVal) {
      sp.set('history', 'true');
    } else {
      sp.delete('history');
    }
    const query = sp.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ''}`, { replace: true });
  };

  const [returnModalEntry, setReturnModalEntry] = useState<any | null>(null);
  const [returnModalType, setReturnModalType] = useState<'milk' | 'material'>('milk');
  const [returnQty, setReturnQty] = useState<number | string>(0);
  const [maxReturnQty, setMaxReturnQty] = useState<number>(0);
  const [returnReason, setReturnReason] = useState('Substandard Quality / Curdled');
  const [refundAs, setRefundAs] = useState<'cash' | 'khata'>('cash');
  const [customReturnReason, setCustomReturnReason] = useState('');
  const [isProcessingReturn, setIsProcessingReturn] = useState(false);
  const isReturningRef = useRef(false);

  // Shifts come from Settings > Company Profile > Daily Milk Collection Shifts.
  const configuredShifts = useMemo(() => {
    const list = settings?.general?.shifts;
    if (Array.isArray(list) && list.length > 0) {
      return Array.from(new Set(list.map(s => String(s).trim()).filter(Boolean)));
    }
    return ['Morning', 'Evening'];
  }, [settings?.general?.shifts]);

  const [milkForm, setMilkForm] = useState<{
    supplier_id: string;
    date: string;
    shift: string;
    milk_type: MilkType;
    quantity: number;
    rate: number;
    fat: number;
    snf: number;
  }>({
    supplier_id: '',
    date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
    shift: 'Morning',
    milk_type: MilkType.BUFFALO,
    quantity: 0,
    rate: 0,
    fat: 0,
    snf: 0
  });

  useEffect(() => {
    if (configuredShifts.length > 0 && !configuredShifts.includes(milkForm.shift)) {
      setMilkForm(prev => ({ ...prev, shift: configuredShifts[0] }));
    }
  }, [configuredShifts, milkForm.shift]);

  const [milkPaidAmount, setMilkPaidAmount] = useState<string>('');
  const [milkPaymentMode, setMilkPaymentMode] = useState<string>('Cash');
  const [milkAccountId, setMilkAccountId] = useState<string>('');

  const [invoiceSupplier, setInvoiceSupplier] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }));
  const [invoiceItems, setInvoiceItems] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [paidAmount, setPaidAmount] = useState<string>('');
  const [paymentMode, setPaymentMode] = useState<string>('Cash');
  const [materialAccountId, setMaterialAccountId] = useState<string>('');

  const isMilkDateLocked = Boolean(isDayLocked && milkForm.date && isDayLocked(milkForm.date));
  const isMaterialDateLocked = Boolean(isDayLocked && invoiceDate && isDayLocked(invoiceDate));

  const availableAccounts = useMemo(() => (accounts || []).filter(a => a.isActive !== false), [accounts]);

  // Pick the account for milk intake payments, preferring the open drawer.
  useEffect(() => {
    if (availableAccounts.length > 0) {
      const isCash = milkPaymentMode === 'Cash';
      const defaultCash = settings?.financial?.defaultCashAccountId;
      const defaultDigital = settings?.financial?.defaultDigitalAccountId;
      const activeDrawerId = activeShiftSession?.drawer_id || activeShiftSession?.account_id;
      
      if (isCash) {
        const found = (activeDrawerId && availableAccounts.find(a => a.id === activeDrawerId)) 
          || (defaultCash && availableAccounts.find(a => a.id === defaultCash)) 
          || availableAccounts.find(a => a.type === 'Cash') 
          || availableAccounts[0];
        setMilkAccountId(found ? found.id : '');
      } else {
        const found = (defaultDigital && availableAccounts.find(a => a.id === defaultDigital)) 
          || availableAccounts.find(a => a.type === 'Bank' || a.type === 'Wallet') 
          || availableAccounts[0];
        setMilkAccountId(found ? found.id : '');
      }
    } else {
      setMilkAccountId('');
    }
  }, [milkPaymentMode, availableAccounts, settings, activeShiftSession]);

  // Pick the account for material purchase payments.
  useEffect(() => {
    if (availableAccounts.length > 0) {
      const isCash = paymentMode === 'Cash';
      const defaultCash = settings?.financial?.defaultCashAccountId;
      const defaultDigital = settings?.financial?.defaultDigitalAccountId;
      const activeDrawerId = activeShiftSession?.drawer_id || activeShiftSession?.account_id;
      
      if (isCash) {
        const found = (activeDrawerId && availableAccounts.find(a => a.id === activeDrawerId)) 
          || (defaultCash && availableAccounts.find(a => a.id === defaultCash)) 
          || availableAccounts.find(a => a.type === 'Cash') 
          || availableAccounts[0];
        setMaterialAccountId(found ? found.id : '');
      } else {
        const found = (defaultDigital && availableAccounts.find(a => a.id === defaultDigital)) 
          || availableAccounts.find(a => a.type === 'Bank' || a.type === 'Wallet') 
          || availableAccounts[0];
        setMaterialAccountId(found ? found.id : '');
      }
    } else {
      setMaterialAccountId('');
    }
  }, [paymentMode, availableAccounts, settings, activeShiftSession]);

  const milkTotalPayable = useMemo(() => {
    return (milkForm.quantity || 0) * (milkForm.rate || 0);
  }, [milkForm.quantity, milkForm.rate]);

  const effectiveMilkPaid = useMemo(() => {
    return milkPaidAmount !== '' ? Math.max(0, parseFloat(milkPaidAmount) || 0) : 0;
  }, [milkPaidAmount]);

  const milkDueAmount = useMemo(() => {
    return Math.max(0, milkTotalPayable - effectiveMilkPaid);
  }, [milkTotalPayable, effectiveMilkPaid]);

  const milkHistory = useMemo(() => {
    return [...purchases].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [purchases]);

  const productHistory = useMemo(() => {
    return [...materialPurchases].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [materialPurchases]);

  const todayKey = businessDate();
  const todayMilkEntries = useMemo(() => {
    return purchases
      .filter(entry => entry.date && entry.status !== 'Cancelled' && entry.status !== 'Returned' && businessDate(entry.date) === todayKey)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [purchases, todayKey]);

  const todayMilkStats = useMemo(() => {
    let liters = 0;
    let amount = 0;
    let due = 0;
    const farmers = new Set<string>();
    todayMilkEntries.forEach(entry => {
      const qty = Number(entry.quantity) || 0;
      const total = Number(entry.total_amount) || 0;
      liters += qty;
      amount += total;
      due += Math.max(0, total - (Number(entry.paid_amount) || 0));
      if (entry.supplier_id) farmers.add(entry.supplier_id);
    });
    const shiftLiters = todayMilkEntries
      .filter(entry => String(entry.shift || '').toLowerCase() === String(milkForm.shift || '').toLowerCase())
      .reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0);
    return { liters, amount, due, farmers: farmers.size, slips: todayMilkEntries.length, shiftLiters };
  }, [todayMilkEntries, milkForm.shift]);

  const todaySupplyStats = useMemo(() => {
    const rows = materialPurchases.filter(entry => entry.date && entry.status !== 'Cancelled' && entry.status !== 'Returned' && businessDate(entry.date) === todayKey);
    // One saved bill writes one row per line, all with the same supplier and timestamp.
    const bills = new Set(rows.map(entry => `${entry.supplier_id || 'cash'}|${entry.date}`));
    return {
      bills: bills.size,
      lines: rows.length,
      amount: rows.reduce((sum, entry) => sum + (Number(entry.total_amount) || 0), 0),
      paid: rows.reduce((sum, entry: any) => sum + (Number(entry.paid_amount ?? entry.details?.paid_amount) || 0), 0),
    };
  }, [materialPurchases, todayKey]);

  const filteredSuppliers = useMemo(() => {
    return suppliers.filter(s => {
      if (s.isActive === false || s.is_active === false) return false;
      const types = (s.supplier_types || []).map((t: string) => String(t).toLowerCase());
      if (activeTab === PurchaseType.MILK) {
        return types.length === 0 || types.some((t: string) => t.includes('milk'));
      }
      return types.length === 0 || types.some((t: string) => t.includes('raw') || t.includes('material') || t.includes('finish') || t.includes('product'));
    });
  }, [suppliers, activeTab]);

  const isMilkVarietyActive = (variety: MilkType | string) => {
    const v = String(variety).toLowerCase();
    const item = items.find(i => {
      const name = (i.name || '').toLowerCase();
      const id = (i.id || '').toLowerCase();
      if (v === 'buffalo') return id === 'item_buffalo_milk' || name.includes('buffalo');
      if (v === 'cow') return id === 'item_cow_milk' || name.includes('cow');
      if (v === 'mixed') return id === 'item_mixed_milk' || name.includes('mixed');
      return name.includes(v) || id.includes(v);
    });
    return item ? item.isActive !== false : true;
  };

  const milkTypeOptions: RichSelectOption[] = useMemo(() => {
    const all = [
      { value: MilkType.BUFFALO, label: 'Buffalo Milk' },
      { value: MilkType.COW, label: 'Cow Milk' },
      { value: MilkType.MIXED, label: 'Mixed Milk' },
    ];
    return all.filter(opt => isMilkVarietyActive(opt.value));
  }, [items]);

  const selectedSupplier = useMemo(() => {
    return suppliers.find(s => s.id === milkForm.supplier_id);
  }, [milkForm.supplier_id, suppliers]);

  const supplierRecentPurchases = useMemo(() => {
    if (!milkForm.supplier_id) return [];
    return purchases
      .filter(p => p.supplier_id === milkForm.supplier_id)
      .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 3);
  }, [milkForm.supplier_id, purchases]);

  // Prefill milk type and rate from the supplier's defaults.
  useEffect(() => {
    if (milkForm.supplier_id) {
      const supplier = suppliers.find(s => s.id === milkForm.supplier_id);
      if (supplier) {
        if (supplier.default_milk_type && isMilkVarietyActive(supplier.default_milk_type)) {
          setMilkForm(prev => ({ ...prev, milk_type: supplier.default_milk_type as any }));
        }
        if (supplier.default_rate) {
          setMilkForm(prev => ({ ...prev, rate: supplier.default_rate }));
        }
      }
    }
  }, [milkForm.supplier_id, suppliers, items]);

  // Keep the selected milk type among the active options.
  useEffect(() => {
    if (milkTypeOptions.length > 0 && !milkTypeOptions.some(opt => opt.value === milkForm.milk_type)) {
      setMilkForm(prev => ({ ...prev, milk_type: milkTypeOptions[0].value as any }));
    }
  }, [milkTypeOptions, milkForm.milk_type]);

  const isSubmittingMilkRef = useRef(false);

  const handleMilkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!milkForm.supplier_id || isSubmitting || isSubmittingMilkRef.current) { 
      if (!milkForm.supplier_id) showToast("Please select a supplier / farmer", "warning"); 
      return; 
    }
    if (!isMilkVarietyActive(milkForm.milk_type)) {
      showToast(`${milkForm.milk_type} Milk variety is inactive in catalog! Reactivate it in Products & Catalog to record purchase.`, "warning");
      return;
    }
    if (milkForm.quantity <= 0 || isNaN(milkForm.quantity)) { 
      showToast("Please enter a valid volume (Liters) greater than 0", "warning"); 
      return; 
    }
    if (effectiveMilkPaid > 0) {
      if (availableAccounts.length === 0) {
        showToast("Aapka koi Payment / Cash Drawer account mojood nahi hy! Pehle 'Bank & Cash' module men account banayein ya Paid Amount ko 0 rakh ker entry ko Khata per save karein.", "warning");
        return;
      }
    }
    
    // Today -> the real moment; a back-dated entry -> noon of that Pakistan day. The old
    // `${date}T${localTime}Z` labelled local time as UTC and moved evening entries to the next day.
    const submissionDate = normalizeTransactionTimestamp(milkForm.date);

    isSubmittingMilkRef.current = true;
    setIsSubmitting(true);
    try {
      const success = await addPurchase({
        ...milkForm,
        date: submissionDate,
        paid_amount: effectiveMilkPaid,
        payment_mode: effectiveMilkPaid > 0 ? milkPaymentMode : undefined,
        account_id: effectiveMilkPaid > 0 ? milkAccountId : undefined
      });
      
      if (success) {
        // Clear the form for the next entry but keep date and shift for rapid intake.
        setMilkForm(prev => ({
          ...prev,
          supplier_id: '',
          quantity: 0,
          rate: 0,
          fat: 0,
          snf: 0
        }));
        setMilkPaidAmount('');
        setMilkPaymentMode('Cash');
        setSupplierFocusToken(token => token + 1);
      }
    } catch (err: any) {
      showToast("Error saving intake: " + (err?.message || "Failed"), "error");
    } finally {
      setIsSubmitting(false);
      setTimeout(() => {
        isSubmittingMilkRef.current = false;
      }, 400);
    }
  };

  const handleOpenReturnMilk = (entry: any) => {
    const alloc = allocations.find(a => a.purchase_id === entry.id || a.id === `alloc_${entry.id}`);
    const availableUnallocated = alloc 
      ? (alloc.remaining_quantity !== null && alloc.remaining_quantity !== undefined ? alloc.remaining_quantity : alloc.original_quantity)
      : entry.quantity;

    if (availableUnallocated <= 0) {
      showToast(`Cannot return milk: Already allocated to production stock.`, "error");
      return;
    }

    setReturnModalEntry(entry);
    setReturnModalType('milk');
    setRefundAs('cash');
    setReturnQty(availableUnallocated);
    setMaxReturnQty(availableUnallocated);
    setReturnReason('Substandard Quality / Curdled');
    setCustomReturnReason('');
  };

  const handleOpenReturnMaterial = (entry: any) => {
    const itemDef = items.find(i => i.id === entry.item_id || i.name.toLowerCase() === entry.item_name.toLowerCase());
    // The bill is in its purchase unit (e.g. 2 ctn); stock is in base units or packs. Compare like with like.
    const conversion = Number(entry.details?.conversion_factor) || 1;
    const packId = entry.details?.variant_id;
    const invRow = inventory.find(inv => inv.item_id === itemDef?.id);
    const stockInBase = Number(invRow?.quantity ?? (itemDef as any)?.stock ?? 0);
    const availableStock = !itemDef
      ? entry.quantity
      : packId
        ? Number((invRow?.variant_stocks || itemDef.variant_stocks || {})[packId] || 0)
        : roundQuantity(stockInBase / conversion);
    // With nothing on hand (stock already used or negative) the bill can still be reversed in full;
    // the stock then goes below zero, which is shown rather than hidden.
    const maxQty = availableStock > 0 ? Math.min(entry.quantity, availableStock) : entry.quantity;
    if (itemDef && availableStock <= 0) {
      showToast(`${entry.item_name} stock is ${formatQty(availableStock)}. This return will make it negative.`, "warning");
    }

    setReturnModalEntry(entry);
    setReturnModalType('material');
    setRefundAs('cash');
    setReturnQty(maxQty > 0 ? maxQty : entry.quantity);
    setMaxReturnQty(maxQty > 0 ? maxQty : entry.quantity);
    setReturnReason('Defective / Damaged Material');
    setCustomReturnReason('');
  };

  const handleConfirmReturnPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    // Enter pressed twice submits before the disabled button re-renders; a second return would
    // refund and lower the khata again.
    if (!returnModalEntry || isProcessingReturn || isReturningRef.current) return;

    const numQty = parseFloat(returnQty.toString());
    if (isNaN(numQty) || numQty <= 0) {
      showToast("Please enter a valid return quantity greater than 0", "warning");
      return;
    }

    if (numQty > maxReturnQty) {
      showToast(`Return quantity cannot exceed available limit of ${maxReturnQty}`, "warning");
      return;
    }

    const finalReason = returnReason === 'Other'
      ? (customReturnReason.trim() || 'Other Return')
      : returnReason;

    isReturningRef.current = true;
    setIsProcessingReturn(true);
    let success = false;
    try {
      if (returnModalType === 'milk') {
        success = await returnPurchase(returnModalEntry.id, numQty, finalReason, refundAs);
      } else {
        success = await returnMaterialPurchase(returnModalEntry.id, numQty, finalReason, refundAs);
      }
    } finally {
      isReturningRef.current = false;
      setIsProcessingReturn(false);
    }

    if (success) {
      setReturnModalEntry(null);
    }
  };

  const purchasableItems = useMemo(() => items.filter(i =>
    (i.isActive !== false) && (i.source === 'Supplier' || i.source === 'Both') &&
    (
      i.item_type.includes('Raw material') ||
      i.item_type.includes('Packaging material') ||
      i.item_type.includes('Sale product')
    ) &&
    !i.category.some(c => c.toLowerCase().includes('milk')) &&
    !i.name.toLowerCase().includes('milk')
  ), [items]);

  const getFilteredItems = () => {
    const q = searchQuery.toLowerCase();
    return purchasableItems.filter(i => i.name.toLowerCase().includes(q));
  };

  const getItemPurchaseUnits = (itemId: string) => {
    const itemDef = items.find(i => i.id === itemId);
    if (!itemDef) return [];
    const baseUnit = itemDef.unit || 'pcs';
    const units: { unit: string; label: string; factor: number; isBase: boolean }[] = [];
    units.push({ unit: baseUnit, label: `${baseUnit} (Base)`, factor: 1, isBase: true });

    // Only defined packaging variants added by the user for this item (e.g. Dozen = 12, Tray = 30)
    if (Array.isArray(itemDef.variants)) {
      itemDef.variants.filter((v: any) => v.isActive !== false).forEach((v: any) => {
        const factor = Number(v.quantity_in_base_unit) || 1;
        if (v.name && v.name.toLowerCase() !== baseUnit.toLowerCase()) {
          units.push({
            unit: v.name,
            // Ready-made packs are stocked as packs; dozen/tray style units go into loose stock.
            label: `${v.name} (${factor} ${baseUnit}${v.deduct_from_base === true ? '' : ', pack'})`,
            factor,
            isBase: false
          });
        }
      });
    }

    return units;
  };

  // Where a bill line lands: ready-made pack units add packs, everything else adds loose base units.
  const lineDestination = (line: { item_id: string; unit?: string; quantity?: number; conversion_factor?: number; rate?: number }) => {
    const def = items.find(i => i.id === line.item_id);
    if (!def) return null;
    const unitName = String(line.unit || '').trim().toLowerCase();
    const pack = unitName && unitName !== String(def.unit || '').trim().toLowerCase()
      ? (def.variants || []).find(v => v.isActive !== false && v.deduct_from_base !== true && String(v.name || '').trim().toLowerCase() === unitName)
      : undefined;
    const qty = Number(line.quantity) || 0;
    const conv = Number(line.conversion_factor) || 1;
    const rate = Number(line.rate) || 0;
    const perBase = conv > 0 && rate > 0 ? rate / conv : 0;
    return pack
      ? { packed: true, text: `+${formatQty(qty, 3)} ${pack.name}`, rate: '' }
      : { packed: false, text: `+${formatQty(qty * conv, 3)} ${def.unit} loose`, rate: conv !== 1 && perBase > 0 ? `${formatCurrency(perBase)}/${def.unit}` : '' };
  };

  const destinationTag = (line: any) => {
    const dest = lineDestination(line);
    if (!dest) return null;
    return (
      <span className={`inline-flex items-center gap-1 mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${dest.packed ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60' : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60'}`}>
        {dest.text}{dest.rate ? ` · ${dest.rate}` : ''}
      </span>
    );
  };

  const handleAddItem = (itemId: string) => {
    const itemDef = items.find(i => i.id === itemId);
    if (!itemDef) return;
    const existingIndex = invoiceItems.findIndex(i => i.item_id === itemId && i.unit === itemDef.unit);
    if (existingIndex >= 0) {
      const updatedItems = [...invoiceItems];
      const newQty = (updatedItems[existingIndex].quantity || 0) + 1;
      updatedItems[existingIndex] = { 
        ...updatedItems[existingIndex], 
        quantity: newQty, 
        total: roundCurrency(newQty * updatedItems[existingIndex].rate)
      };
      setInvoiceItems(updatedItems);
    } else {
      const newItem = { 
        tempId: Math.random(), 
        item_id: itemDef.id, 
        item_name: itemDef.name, 
        unit: itemDef.unit, 
        base_unit: itemDef.unit,
        conversion_factor: 1,
        quantity: 1, 
        rate: itemDef.cost_price || 0, 
        total: itemDef.cost_price || 0 
      };
      setInvoiceItems([...invoiceItems, newItem]);
    }
    setSearchQuery(''); 
  };

  const handleLineItemUnitChange = (tempId: number, nextUnit: string, nextFactor: number) => {
    setInvoiceItems(prev => prev.map(item => {
      if (item.tempId === tempId) {
        const prevFactor = Number(item.conversion_factor) || 1;
        const baseCost = (Number(item.rate) || 0) / prevFactor;
        const newEstimatedRate = roundCurrency(baseCost * nextFactor);
        const newRate = newEstimatedRate > 0 ? newEstimatedRate : item.rate;
        return {
          ...item,
          unit: nextUnit,
          conversion_factor: nextFactor,
          rate: newRate,
          total: roundCurrency((Number(item.quantity) || 0) * newRate)
        };
      }
      return item;
    }));
  };

  const [editingLineItem, setEditingLineItem] = useState<any | null>(null);
  const [editItemQty, setEditItemQty] = useState<string>('');
  const [editItemRate, setEditItemRate] = useState<string>('');
  const [editItemTotal, setEditItemTotal] = useState<string>('');
  const [editItemUnit, setEditItemUnit] = useState<string>('');
  const [editItemConversionFactor, setEditItemConversionFactor] = useState<number>(1);

  const openEditModal = (item: any) => {
    setEditingLineItem(item);
    setEditItemQty(item.quantity.toString());
    setEditItemRate(item.rate.toString());
    setEditItemTotal((item.quantity * item.rate).toString());
    setEditItemUnit(item.unit || item.base_unit || 'pcs');
    setEditItemConversionFactor(Number(item.conversion_factor) || 1);
  };

  const handleModalUnitChange = (nextUnit: string, nextFactor: number) => {
    setEditItemUnit(nextUnit);
    setEditItemConversionFactor(nextFactor);
    const prevFactor = editItemConversionFactor || 1;
    const curRate = parseFloat(editItemRate) || 0;
    const baseCost = curRate / prevFactor;
    const newRate = roundCurrency(baseCost * nextFactor);
    if (newRate > 0) {
      setEditItemRate(newRate.toString());
      const q = parseFloat(editItemQty) || 0;
      setEditItemTotal(roundCurrency(q * newRate).toString());
    }
  };

  const handleEditQtyChange = (val: string) => {
    setEditItemQty(val);
    const q = parseFloat(val) || 0;
    const r = parseFloat(editItemRate) || 0;
    setEditItemTotal((q * r).toString());
  };

  const handleEditRateChange = (val: string) => {
    setEditItemRate(val);
    const q = parseFloat(editItemQty) || 0;
    const r = parseFloat(val) || 0;
    setEditItemTotal((q * r).toString());
  };

  const handleEditTotalChange = (val: string) => {
    setEditItemTotal(val);
    const t = parseFloat(val) || 0;
    const r = parseFloat(editItemRate) || 0;
    if (r > 0) {
      setEditItemQty(Number((t / r).toFixed(2)).toString());
    }
  };

  const handleSaveEditedItem = () => {
    if (!editingLineItem) return;
    const q = parseFloat(editItemQty) || 0;
    const r = parseFloat(editItemRate) || 0;
    if (q <= 0) {
      showToast("Please enter a valid quantity greater than 0", "warning");
      return;
    }
    setInvoiceItems(prev => prev.map(item => {
      if (item.tempId === editingLineItem.tempId) {
        return {
          ...item,
          quantity: q,
          rate: r,
          unit: editItemUnit || item.unit,
          conversion_factor: editItemConversionFactor || 1,
          total: roundCurrency(q * r)
        };
      }
      return item;
    }));
    setEditingLineItem(null);
    showToast("Product updated", "info");
  };

  const updateLineTotal = (tempId: number, newTotalStr: string) => {
    const newTotal = parseFloat(newTotalStr);
    setInvoiceItems(prev => prev.map(item => {
      if (item.tempId === tempId) {
        if (isNaN(newTotal) || newTotal < 0) {
          return { ...item, total: 0 };
        }
        const rate = item.rate > 0 ? item.rate : 1;
        const newQty = Number((newTotal / rate).toFixed(2));
        return { ...item, quantity: newQty, total: newTotal };
      }
      return item;
    }));
  };

  const updateLineItem = (tempId: number, field: string, value: any) => {
    setInvoiceItems(prev => prev.map(item => {
      if (item.tempId === tempId) { 
        const updatedItem = { ...item, [field]: value }; 
        updatedItem.total = (updatedItem.quantity || 0) * (updatedItem.rate || 0); 
        return updatedItem; 
      }
      return item;
    }));
  };

  const removeLineItem = (tempId: number) => { 
    setInvoiceItems(invoiceItems.filter(i => i.tempId !== tempId)); 
  };

  const invoiceTotal = invoiceItems.reduce((sum, item) => sum + (item.quantity * item.rate), 0);
  
  // Only what the user entered; blank counts as nothing paid.
  const effectivePaid = paidAmount !== '' ? (parseFloat(paidAmount) || 0) : 0;
  
  const unpaidInvoiceBalance = Math.max(0, invoiceTotal - effectivePaid);
  const isCashPaidFull = invoiceTotal > 0 && unpaidInvoiceBalance <= 0.01;

  const isSubmittingInvoiceRef = useRef(false);

  const submitInvoice = async () => {
    // The state flag only blocks after a re-render; a fast double click saved the bill twice
    // (addBulkMaterialPurchase has no lock), doubling stock and the supplier khata.
    if (isSubmittingInvoiceRef.current) return;
    if (invoiceItems.length === 0 || isSubmittingInvoice) {
      if (invoiceItems.length === 0) showToast("Please add products to the invoice first.", "warning");
      return; 
    }

    if (unpaidInvoiceBalance > 0.01 && !invoiceSupplier) {
      showToast("Please select a Supplier for credit / khata purchases.", "warning");
      return;
    }

    if (effectivePaid > 0 && availableAccounts.length === 0) {
      showToast("No active Payment or Cash Drawer account found. Please create one in 'Bank & Cash' or save on credit.", "warning");
      return;
    }

    if (effectivePaid > invoiceTotal + 0.01) {
      showToast(`Paid (${formatCurrency(effectivePaid)}) bill (${formatCurrency(invoiceTotal)}) se zyada hai. Zyada raqam supplier ko alag Advance payment ke taur par dein.`, "warning");
      return;
    }

    const submissionDate = normalizeTransactionTimestamp(invoiceDate);

    isSubmittingInvoiceRef.current = true;
    setIsSubmittingInvoice(true);
    try {
      const success = await addBulkMaterialPurchase({
        supplier_id: invoiceSupplier || null, 
        date: submissionDate, 
        items: invoiceItems, 
        purchase_type: activeTab,
        paid_amount: effectivePaid,
        payment_mode: paymentMode,
        account_id: effectivePaid > 0 ? materialAccountId : undefined
      }); 

      // Keep the bill on screen when the save failed, so nothing has to be typed again.
      if (!success) return;
      showToast(
        invoiceSupplier
          ? `Purchase bill of ${formatCurrency(invoiceTotal)} saved!`
          : `Cash Purchase of ${formatCurrency(invoiceTotal)} logged!`,
        'success'
      );

      setInvoiceItems([]);
      setInvoiceSupplier('');
      setPaidAmount('');
      setPaymentMode('Cash');
      setInvoiceDate(getTodayLocalDate());
    } catch (err: any) {
      showToast("Error saving purchase: " + (err?.message || "Failed"), "error");
    } finally {
      isSubmittingInvoiceRef.current = false;
      setIsSubmittingInvoice(false);
    }
  };

  const selectedVendorData = suppliers.find(s => s.id === invoiceSupplier);
  const balanceOf = (supplier: any) => Number(supplier?.pending_balance ?? supplier?.balance ?? 0) || 0;

  const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 outline-none transition-all focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20 dark:text-slate-100";
  const labelClass = "mb-1 block text-xs font-semibold text-slate-700";
  const chipClass = (active: boolean) => `rounded-lg px-2 py-1 text-[10px] font-bold transition-colors ${active ? 'bg-lime-600 text-white' :'bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-900 dark:ring-slate-700'}`;

  const [isProductSearchOpen, setIsProductSearchOpen] = useState(false);
  const [productHighlight, setProductHighlight] = useState(0);
  const productSearchRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (productSearchRef.current && !productSearchRef.current.contains(e.target as Node)) {
        setIsProductSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Product search dropdown. Rendered inline (not as a nested component) so typing does not
  // remount the input, which used to drop focus and close the results after every key.
  const renderProductSearch = () => {
    const results = getFilteredItems();
    const showResults = isProductSearchOpen && (results.length > 0 || searchQuery.trim() !== '');
    const highlighted = Math.min(productHighlight, Math.max(0, results.length - 1));

    return (
      <div className="relative w-full" ref={productSearchRef}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            role="combobox"
            aria-expanded={showResults}
            aria-controls="supply-product-results"
            aria-autocomplete="list"
            className={`${inputClass} h-12 pl-10 pr-10`}
            placeholder="Search material, packaging or product to add…"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setIsProductSearchOpen(true); setProductHighlight(0); }}
            onFocus={() => setIsProductSearchOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIsProductSearchOpen(true);
                setProductHighlight(Math.min(highlighted + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setProductHighlight(Math.max(highlighted - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const pick = results[highlighted];
                if (pick) { handleAddItem(pick.id); setIsProductSearchOpen(false); }
              } else if (e.key === 'Escape') {
                setIsProductSearchOpen(false);
              }
            }}
          />
          {searchQuery && (
            <button aria-label="Search saaf karein" type="button" onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-700">
              <X size={14} />
            </button>
          )}
        </div>
        {showResults && (
          <div id="supply-product-results" role="listbox" className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl">
            {results.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <Package className="mx-auto mb-1.5 text-slate-300" size={20} />
                <p className="text-xs font-semibold text-slate-600">&ldquo;{searchQuery}&rdquo; nahi mila</p>
                <p className="mt-0.5 text-[11px] text-slate-400">Pehle Products &amp; Catalog mein item banayein (source: Supplier).</p>
              </div>
            ) : results.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={idx === highlighted}
                onMouseEnter={() => setProductHighlight(idx)}
                onClick={() => { handleAddItem(item.id); setIsProductSearchOpen(false); }}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${idx === highlighted ? 'bg-lime-50' : 'hover:bg-slate-50'}`}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500"><Package size={14} /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-slate-800">{item.name}</span>
                    <span className="block truncate text-[11px] text-slate-400">{item.category.join(', ')} · Cost Rs {item.cost_price || 0}/{item.unit}</span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {Array.isArray(item.variants) && item.variants.length > 0 && (
                    <span className="rounded-md border border-lime-200 bg-lime-50 px-1.5 py-0.5 text-[10px] font-bold text-lime-700">+{item.variants.length} units</span>
                  )}
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-600">{item.unit}</span>
                  <Plus size={14} className="text-lime-600" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const isMilk = activeTab === PurchaseType.MILK;
  const selectedBalance = balanceOf(selectedSupplier);
  const projectedBalance = selectedBalance + milkDueAmount;
  const lastDelivery = supplierRecentPurchases[0];
  const todayShiftTotals = configuredShifts.map(name => {
    const rows = todayMilkEntries.filter(entry => String(entry.shift || '').toLowerCase() === name.toLowerCase());
    return { name, slips: rows.length, liters: rows.reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0) };
  });
  const maxShiftLiters = Math.max(1, ...todayShiftTotals.map(s => s.liters));
  const milkCanSave = Boolean(milkForm.supplier_id && milkForm.quantity > 0 && milkForm.rate > 0 && !isSubmitting && milkTypeOptions.length > 0 && !isMilkDateLocked);
  const isBackDated = milkForm.date !== getTodayLocalDate();
  const milkStatus = milkTotalPayable <= 0
    ? null
    : effectiveMilkPaid >= milkTotalPayable
      ? { label: 'Fully paid', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
      : effectiveMilkPaid > 0
        ? { label: 'Partly paid', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
        : { label: 'On khata', cls: 'bg-rose-50 text-rose-700 border-rose-200' };

  const shiftPills: PillOption<string>[] = configuredShifts.map(name => ({ value: name, label: name, icon: <ShiftIcon name={name} size={13} /> }));
  const varietyPills: PillOption<string>[] = milkTypeOptions.map(opt => ({ value: String(opt.value), label: String(opt.label).replace(/\s*milk$/i, ''), dot: varietyDot(String(opt.value)) }));
  const payModePills: PillOption<string>[] = [
    { value: 'Cash', label: 'Cash', icon: <Banknote size={13} /> },
    { value: 'Online', label: 'Online', icon: <Smartphone size={13} /> },
  ];

  const resetMilkForm = () => {
    setMilkForm({
      supplier_id: '',
      date: getTodayLocalDate(),
      shift: configuredShifts[0] || 'Morning',
      milk_type: MilkType.BUFFALO,
      quantity: 0,
      rate: 0,
      fat: 0,
      snf: 0
    });
    setMilkPaidAmount('');
    setMilkPaymentMode('Cash');
  };

  const supplyCanSave = invoiceItems.length > 0 && !isSubmittingInvoice && (isCashPaidFull || !!invoiceSupplier) && !isMaterialDateLocked;
  const vendorBalance = balanceOf(selectedVendorData);
  const quickAddItems = useMemo(() => {
    const counts = new Map<string, number>();
    materialPurchases.forEach(entry => {
      if (entry.item_id && entry.status !== 'Cancelled') counts.set(entry.item_id, (counts.get(entry.item_id) || 0) + 1);
    });
    return purchasableItems
      .filter(item => counts.has(item.id))
      .sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0))
      .slice(0, 6);
  }, [materialPurchases, purchasableItems]);

  const accountPicker = (value: string, onChange: (id: string) => void, mode: string) => (
    availableAccounts.length === 0 ? (
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900" role="alert">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
        <div>
          <span className="font-bold">Koi Cash Drawer ya Bank Account nahi hai</span>
          <p className="mt-0.5 text-[11px] leading-snug text-amber-700">Pehle <b>Bank &amp; Cash</b> mein account banayein, ya paid amount <b>0</b> rakh kar khata par save karein.</p>
        </div>
      </div>
    ) : (
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
            <Wallet size={12} className="text-lime-600" /> Paid from account
          </label>
          {mode === 'Cash' && activeShiftSession && (
            <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">Shift drawer</span>
          )}
        </div>
        <select className={`${inputClass} h-10 py-0 text-xs font-semibold`} value={value} onChange={e => onChange(e.target.value)}>
          {availableAccounts.map(acc => (
            <option key={acc.id} value={acc.id}>{acc.name} ({acc.type}) — {formatCurrency(acc.balance)}</option>
          ))}
        </select>
      </div>
    )
  );

  const paidInput = (value: string, onChange: (v: string) => void, total: number, paid: number) => (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 font-mono text-xs font-semibold text-slate-400">Rs</span>
      <SmartNumberInput
        step="any"
        min="0"
        placeholder="0"
        aria-label="Paid now"
        className={`${inputClass} h-11 pl-9 pr-[7.5rem] font-mono text-base font-bold text-slate-900`}
        value={value}
        onChange={onChange}
      />
      <div className="absolute right-1.5 top-1/2 z-20 flex -translate-y-1/2 gap-1">
        <button type="button" onClick={() => onChange('')} className={chipClass(total > 0 && paid <= 0)} title="Poori raqam khata par">Khata</button>
        <button type="button" disabled={total <= 0} onClick={() => onChange(total.toString())} className={`${chipClass(total > 0 && paid >= total)} disabled:opacity-40`} title="Poori raqam abhi ada">Full</button>
      </div>
    </div>
  );

  const logCount = isMilk ? todayMilkStats.slips : todaySupplyStats.lines;

  return (
    <div className="space-y-4 pb-8">
      <ProcurementHeader
        active={isMilk ? 'purchase' : 'purchase-supplies'}
        title={isMilk ? 'Milk Collection' : 'Supplies & Materials'}
        subtitle={isMilk ? 'Farmer chunein, liter aur rate likhein, Enter dabayein.' : 'Packaging, feed aur doosra saman — multi-unit bill ke sath.'}
        actions={
          <button
            type="button"
            onClick={() => toggleHistory()}
            className={`flex h-[38px] shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold shadow-xs transition-colors ${
              isHistoryOpen ? 'border-lime-600 bg-lime-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <History size={14} />
            <span className="hidden sm:inline">Log</span>
            <span className={`rounded-full px-1.5 font-mono text-[10px] font-bold ${isHistoryOpen ? 'bg-white/20' : 'bg-slate-100 text-slate-600'}`}>{logCount}</span>
          </button>
        }
      />

      {isMilk ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile icon={Milk} tone="lime" label="Collected" value={`${formatQty(todayMilkStats.liters)} L`} hint={`${todayMilkStats.slips} slips · ${todayMilkStats.farmers} farmers`} />
          <StatTile
            icon={/evening|night|sham|raat/i.test(milkForm.shift) ? Moon : Sun}
            tone="amber"
            label={`${milkForm.shift} shift`}
            value={`${formatQty(todayMilkStats.shiftLiters)} L`}
            hint={todayMilkStats.liters > 0 ? `${Math.round((todayMilkStats.shiftLiters / todayMilkStats.liters) * 100)}% of today` : 'Abhi koi entry nahi'}
          />
          <StatTile icon={Wallet} tone="violet" label="Milk bill today" value={formatCurrency(todayMilkStats.amount)} hint={todayMilkStats.liters > 0 ? `Avg Rs ${(todayMilkStats.amount / todayMilkStats.liters).toFixed(1)}/L` : '—'} />
          <StatTile icon={BookOpen} tone="rose" valueTone={todayMilkStats.due > 0 ? 'rose' : undefined} label="On khata today" value={formatCurrency(todayMilkStats.due)} hint={`Paid ${formatCurrency(Math.max(0, todayMilkStats.amount - todayMilkStats.due))}`} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile icon={Receipt} tone="cyan" label="Bills today" value={todaySupplyStats.bills} hint={`${todaySupplyStats.lines} item lines`} />
          <StatTile icon={Wallet} tone="violet" label="Spent today" value={formatCurrency(todaySupplyStats.amount)} />
          <StatTile icon={Banknote} tone="emerald" label="Paid today" value={formatCurrency(todaySupplyStats.paid)} />
          <StatTile icon={BookOpen} tone="rose" valueTone={todaySupplyStats.amount - todaySupplyStats.paid > 0.5 ? 'rose' : undefined} label="On credit today" value={formatCurrency(Math.max(0, todaySupplyStats.amount - todaySupplyStats.paid))} />
        </div>
      )}

      {isMilk && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <form onSubmit={handleMilkSubmit} className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-xs lg:col-span-8">
            <div className="flex flex-col gap-2.5 rounded-t-2xl border-b border-slate-200 bg-slate-50 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-5">
              <label className={`flex h-[38px] items-center gap-2 rounded-xl border bg-white px-3 text-xs font-semibold shadow-xs ${isBackDated ? 'border-amber-300 text-amber-800' : 'border-slate-200 text-slate-700'}`}>
                <CalendarIcon size={14} className={isBackDated ? 'text-amber-600' : 'text-slate-400'} />
                <input
                  type="date"
                  aria-label="Collection date"
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs font-semibold outline-none focus:ring-0 dark:bg-transparent"
                  value={milkForm.date}
                  onChange={e => setMilkForm({ ...milkForm, date: e.target.value })}
                  required
                />
                {isBackDated && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700">Back-date</span>}
              </label>
              <PillGroup label="Shift" options={shiftPills} value={milkForm.shift} onChange={val => setMilkForm({ ...milkForm, shift: val })} className="overflow-x-auto scrollbar-hide sm:flex-initial" />
              {varietyPills.length > 0 ? (
                <PillGroup label="Milk variety" options={varietyPills} value={String(milkForm.milk_type)} onChange={val => setMilkForm({ ...milkForm, milk_type: val as MilkType })} className="sm:ml-auto" />
              ) : (
                <span className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700 sm:ml-auto">Catalog mein sab milk varieties inactive hain.</span>
              )}
            </div>

            <div className="flex-1 space-y-5 p-4 sm:p-5">
              {isMilkDateLocked && (
                <div className="flex items-center gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900" role="alert">
                  <Lock size={15} className="shrink-0 text-amber-600" />
                  <span><strong>{milkForm.date} band (locked) hai.</strong> Is din ki milk entry save nahi ho sakti.</span>
                </div>
              )}

              <section>
                <SectionLabel
                  step={1}
                  aside={selectedSupplier && selectedBalance !== 0 && (
                    <span className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold ${selectedBalance > 0 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                      {formatCurrency(Math.abs(selectedBalance))} {selectedBalance > 0 ? 'Due' : 'Advance'}
                    </span>
                  )}
                >
                  Farmer / Gwala
                </SectionLabel>
                <SearchableSupplierDropdown
                  value={milkForm.supplier_id}
                  onChange={id => setMilkForm({ ...milkForm, supplier_id: id })}
                  suppliers={filteredSuppliers}
                  placeholder="Naam, gaon ya phone se dhoondein…"
                  inputClass={`${inputClass} h-12`}
                  labelClass={labelClass}
                  focusToken={supplierFocusToken}
                />
                {lastDelivery && (
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-500 lg:hidden">
                    <History size={11} className="text-slate-400" />
                    Pichli: <b className="font-mono text-slate-700">{formatQty(lastDelivery.quantity)} L @ Rs {lastDelivery.rate}</b>
                    · {new Date(lastDelivery.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} {lastDelivery.shift}
                  </p>
                )}
              </section>

              <section>
                <SectionLabel step={2}>Quantity &amp; rate</SectionLabel>
                <div className="grid grid-cols-2 gap-3">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-2 z-10 text-[10px] font-bold uppercase tracking-wider text-slate-400">Liters</span>
                    <SmartNumberInput
                      step="any"
                      min="0"
                      placeholder="0.0"
                      aria-label="Liters"
                      className={`${inputClass} h-16 pb-1.5 pl-3.5 pr-9 pt-5 font-mono text-2xl font-black tracking-tight text-slate-900`}
                      value={milkForm.quantity || ''}
                      onChange={val => setMilkForm({ ...milkForm, quantity: parseFloat(val) || 0 })}
                      required
                    />
                    <span className="pointer-events-none absolute right-3.5 top-1/2 z-10 -translate-y-1/2 text-sm font-bold text-slate-400">L</span>
                  </div>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-2 z-10 text-[10px] font-bold uppercase tracking-wider text-slate-400">Rate / liter</span>
                    <span className="pointer-events-none absolute bottom-[0.85rem] left-3.5 z-10 font-mono text-sm font-bold text-slate-400">Rs</span>
                    <SmartNumberInput
                      step="any"
                      min="0"
                      placeholder="0"
                      aria-label="Rate per liter"
                      className={`${inputClass} h-16 pb-1.5 pl-10 pr-3.5 pt-5 font-mono text-2xl font-black tracking-tight text-slate-900`}
                      value={milkForm.rate || ''}
                      onChange={val => setMilkForm({ ...milkForm, rate: parseFloat(val) || 0 })}
                      required
                    />
                  </div>
                </div>
                {Number(selectedSupplier?.default_rate) > 0 &&Number(milkForm.rate) !== Number(selectedSupplier.default_rate) && (
                  <button type="button" onClick={() => setMilkForm({ ...milkForm, rate: selectedSupplier.default_rate })} className="mt-1.5 text-[11px] font-semibold text-lime-700 hover:underline">
                    Farmer ka default rate Rs {selectedSupplier.default_rate} lagayein
                  </button>
                )}
              </section>

              <section>
                <SectionLabel step={3} aside={milkStatus && <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${milkStatus.cls}`}>{milkStatus.label}</span>}>
                  Payment
                </SectionLabel>
                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <span className="mb-1 block text-[11px] font-semibold text-slate-500">Abhi ada (paid now)</span>
                      {paidInput(milkPaidAmount, setMilkPaidAmount, milkTotalPayable, effectiveMilkPaid)}
                    </div>
                    <div>
                      <span className="mb-1 block text-[11px] font-semibold text-slate-500">Paid via</span>
                      <PillGroup
                        label="Payment mode"
                        options={payModePills.map(p => ({ ...p, disabled: effectiveMilkPaid <= 0 }))}
                        value={milkPaymentMode}
                        onChange={setMilkPaymentMode}
                        className="h-11 items-stretch"
                      />
                    </div>
                  </div>
                  {effectiveMilkPaid > 0 && accountPicker(milkAccountId, setMilkAccountId, milkPaymentMode)}
                  <SettlementBar total={milkTotalPayable} paid={effectiveMilkPaid} formatMoney={formatCurrency} />
                </div>
              </section>
            </div>

            <div className="flex flex-col gap-3 rounded-b-2xl border-t border-slate-200 bg-slate-50 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="min-w-0">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Total payable</span>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-2xl font-black tracking-tight text-lime-700">{formatCurrency(milkTotalPayable)}</span>
                  {milkForm.quantity > 0 && milkForm.rate > 0 && (
                    <span className="font-mono text-xs text-slate-500">{formatQty(milkForm.quantity)} L × Rs {milkForm.rate}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={resetMilkForm} className="flex h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100">
                  <RotateCcw size={14} /> Clear
                </button>
                <button
                  type="submit"
                  disabled={!milkCanSave}
                  title={isMilkDateLocked ? `Selected date (${milkForm.date}) is closed & locked` : undefined}
                  className={`flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-5 text-sm font-bold transition-all active:scale-[0.98] sm:flex-initial ${
                    milkCanSave ? 'cursor-pointer bg-lime-600 text-white shadow-md shadow-lime-600/25 hover:bg-lime-700' : 'cursor-not-allowed bg-slate-200 text-slate-400'
                  }`}
                >
                  {isSubmitting ? (<><Loader2 size={16} className="animate-spin" /> Saving…</>) : (
                    <>
                      <Save size={16} /> Save intake
                      <kbd className="hidden rounded-md bg-white/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold sm:inline">Enter ↵</kbd>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>

          <aside className="space-y-4 lg:col-span-4">
            {selectedSupplier && (
              <div className="hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-xs lg:block">
                <div className="flex items-center gap-3">
                  <Avatar name={selectedSupplier.name} owed={selectedBalance > 0} size="lg" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-slate-900">{selectedSupplier.name}</p>
                    <p className="truncate text-[11px] text-slate-400">{[selectedSupplier.village || selectedSupplier.city, selectedSupplier.phone].filter(Boolean).join(' · ') || 'No contact saved'}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-slate-50 p-2.5">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Balance now</span>
                    <span className={`font-mono text-sm font-black ${selectedBalance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700'}`}>{formatCurrency(Math.abs(selectedBalance))}</span>
                    <span className="ml-1 text-[10px] font-semibold text-slate-400">{selectedBalance > 0 ? 'due' : selectedBalance < 0 ? 'adv' : ''}</span>
                  </div>
                  <div className={`rounded-xl p-2.5 ${milkDueAmount > 0 ? 'bg-rose-50' : 'bg-slate-50'}`}>
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">After slip <ArrowRight size={10} /></span>
                    <span className={`font-mono text-sm font-black ${projectedBalance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700'}`}>{formatCurrency(Math.abs(projectedBalance))}</span>
                    <span className="ml-1 text-[10px] font-semibold text-slate-400">{projectedBalance > 0 ? 'due' : projectedBalance < 0 ? 'adv' : ''}</span>
                  </div>
                </div>
                <p className="mb-1.5 mt-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">Recent deliveries</p>
                {supplierRecentPurchases.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 py-3 text-center text-xs text-slate-400">Pehli delivery</p>
                ) : (
                  <ul className="space-y-1.5">
                    {supplierRecentPurchases.map(p => (
                      <li key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-2.5 py-2 text-xs">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${varietyDot(p.milk_type)}`} />
                          <span className="min-w-0">
                            <span className="block font-semibold text-slate-800">{formatQty(p.quantity)} L <span className="font-normal text-slate-400">@ Rs {p.rate}</span></span>
                            <span className="block text-[10px] text-slate-400">{new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {p.shift}</span>
                          </span>
                        </span>
                        <span className="font-mono font-bold text-slate-900">{formatCurrency(p.total_amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-white shadow-xs">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime-400 opacity-60 motion-reduce:animate-none" /><span className="relative inline-flex h-2 w-2 rounded-full bg-lime-500" /></span>
                  Today&rsquo;s intake
                </h3>
                <span className="font-mono text-xs font-bold text-slate-500">{formatQty(todayMilkStats.liters)} L</span>
              </div>
              <div className="space-y-2 px-4 py-3">
                {todayShiftTotals.map(s => (
                  <div key={s.name} className="flex items-center gap-2.5 text-xs">
                    <span className="flex w-20 shrink-0 items-center gap-1.5 truncate font-semibold text-slate-600"><ShiftIcon name={s.name} size={12} />{s.name}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <span className={`block h-full rounded-full transition-all duration-500 ${s.name === milkForm.shift ? 'bg-lime-500' : 'bg-slate-300 dark:bg-slate-600'}`} style={{ width: `${(s.liters / maxShiftLiters) * 100}%` }} />
                    </span>
                    <span className="w-16 shrink-0 text-right font-mono font-bold text-slate-800">{formatQty(s.liters)} L</span>
                  </div>
                ))}
              </div>
              {todayMilkEntries.length === 0 ? (
                <div className="border-t border-slate-100 px-4 py-8 text-center">
                  <span className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-2xl bg-lime-50 text-lime-600"><Milk size={18} /></span>
                  <p className="text-xs font-semibold text-slate-600">Aaj abhi koi entry nahi</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">Pehli slip upar se record karein</p>
                </div>
              ) : (
                <ul className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto border-t border-slate-100">
                  {todayMilkEntries.slice(0, 12).map(entry => {
                    const due = Math.max(0, (Number(entry.total_amount) || 0) - (Number(entry.paid_amount) || 0));
                    const at = new Date(entry.date);
                    return (
                      <li key={entry.id} className="flex items-center gap-2.5 px-4 py-2.5 text-xs">
                        <Avatar name={entry.supplier_name || suppliers.find(s => s.id === entry.supplier_id)?.name || 'Farmer'} owed={due > 0} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-slate-800">{entry.supplier_name || suppliers.find(s => s.id === entry.supplier_id)?.name || 'Farmer'}</span>
                          <span className="flex items-center gap-1 text-[10px] text-slate-400">
                            <span className={`h-1.5 w-1.5 rounded-full ${varietyDot(entry.milk_type)}`} />
                            {formatQty(entry.quantity)} L · {entry.shift}{Number.isFinite(at.getTime()) && entry.date.includes('T') ? ` · ${timeFormatter.format(at)}` : ''}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className="block font-mono font-bold text-slate-900">{formatCurrency(entry.total_amount)}</span>
                          <span className={`block text-[10px] font-semibold ${due > 0.5 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700'}`}>{due > 0.5 ? 'Khata' : 'Paid'}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {todayMilkEntries.length > 0 && (
                <button type="button" onClick={() => toggleHistory(true)} className="flex w-full items-center justify-center gap-1.5 rounded-b-2xl border-t border-slate-100 py-2.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900">
                  Poora log dekhein <ArrowRight size={13} />
                </button>
              )}
            </div>
          </aside>
        </div>
      )}

      {!isMilk && (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          <section className="rounded-2xl border border-slate-200 bg-white shadow-xs lg:col-span-8">
            <div className="space-y-4 rounded-t-2xl border-b border-slate-200 bg-slate-50 p-4 sm:p-5">
              {isMaterialDateLocked && (
                <div className="flex items-center gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900" role="alert">
                  <Lock size={15} className="shrink-0 text-amber-600" />
                  <span><strong>{invoiceDate} band (locked) hai.</strong> Is din ka supplies bill save nahi ho sakta.</span>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
                <div>
                  <SectionLabel step={1} aside={!invoiceSupplier && <span className="text-[10px] font-semibold text-slate-400">Cash buy ke liye optional</span>}>Vendor / Supplier</SectionLabel>
                  <SearchableSupplierDropdown
                    value={invoiceSupplier}
                    onChange={val => setInvoiceSupplier(val)}
                    suppliers={filteredSuppliers}
                    placeholder={isCashPaidFull ? 'Cash / walk-in (optional)' : 'Vendor dhoondein…'}
                    inputClass={`${inputClass} h-12`}
                    labelClass={labelClass}
                  />
                </div>
                <div>
                  <SectionLabel>Bill date</SectionLabel>
                  <label className="flex h-12 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700">
                    <CalendarIcon size={15} className="text-slate-400" />
                    <input type="date" aria-label="Bill date" className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs font-semibold outline-none focus:ring-0 dark:bg-transparent" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
                  </label>
                </div>
              </div>
              <div>
                <SectionLabel step={2} aside={<span className="hidden text-[10px] font-semibold text-slate-400 sm:inline">↑ ↓ chunein · Enter add</span>}>Add products</SectionLabel>
                {renderProductSearch()}
                {quickAddItems.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400"><Sparkles size={11} /> Aksar</span>
                    {quickAddItems.map(item => (
                      <button key={item.id} type="button" onClick={() => handleAddItem(item.id)} className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:border-lime-400 hover:text-lime-700">
                        <Plus size={11} /> {item.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {invoiceItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
                <span className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-lime-50 to-cyan-50 text-lime-600 ring-1 ring-slate-200 dark:from-lime-500/10 dark:to-cyan-500/10 dark:ring-slate-700">
                  <ShoppingCart size={24} />
                </span>
                <p className="text-sm font-bold text-slate-800">Bill khaali hai</p>
                <p className="mt-1 max-w-xs text-xs text-slate-400">Material, packaging ya feed upar search kar ke bill mein add karein.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-4 pt-3 sm:px-5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{invoiceItems.length} {invoiceItems.length === 1 ? 'item' : 'items'} in bill</span>
                  <span className="text-[10px] text-slate-400 md:hidden">Swipe to remove · tap to edit</span>
                </div>

                <div className="mt-2 divide-y divide-slate-100 border-t border-slate-100 md:hidden">
                  {invoiceItems.map((item) => (
                    <div key={item.tempId} className="relative overflow-hidden bg-rose-500">
                      <div className="absolute inset-0 flex items-center justify-between px-4 text-xs font-bold text-white">
                        <span className="flex items-center gap-1.5"><Trash2 size={14} /> Delete</span>
                        <span className="flex items-center gap-1.5">Delete <Trash2 size={14} /></span>
                      </div>
                      <MotionDiv
                        drag="x"
                        dragDirectionLock
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={0.6}
                        onDragEnd={(_e: any, info: any) => {
                          if (Math.abs(info.offset.x) > 70 || Math.abs(info.velocity.x) > 350) {
                            removeLineItem(item.tempId);
                            showToast(`${item.item_name} removed from bill`, 'info');
                          }
                        }}
                        className="relative flex touch-pan-y items-center gap-2 bg-white px-4 py-3"
                      >
                        <button type="button" onClick={() => openEditModal(item)} className="min-w-0 flex-1 text-left" title="Edit quantity & rate">
                          <span className="block truncate text-sm font-bold text-slate-800">{item.item_name}</span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                            <span className="rounded-md border border-lime-200 bg-lime-50 px-1.5 py-0.5 text-[10px] font-bold text-lime-700">{item.unit}</span>
                            Rs {item.rate}
                          </span>
                          {destinationTag(item)}
                        </button>
                        <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5">
                          <button aria-label="Decrease quantity" type="button" onClick={() => updateLineItem(item.tempId, 'quantity', Math.max(0.1, (item.quantity || 1) - 1))} className="grid h-7 w-7 place-items-center rounded-lg text-slate-600 hover:bg-white active:scale-90"><Minus size={12} /></button>
                          <input type="number" step="any" min="0.1" aria-label={`${item.item_name} quantity`} value={item.quantity} onChange={e => updateLineItem(item.tempId, 'quantity', parseFloat(e.target.value) || 0)} className="w-9 border-0 bg-transparent p-0 text-center font-mono text-xs font-bold text-slate-900 outline-none dark:bg-transparent" />
                          <button aria-label="Increase quantity" type="button" onClick={() => updateLineItem(item.tempId, 'quantity', (item.quantity || 0) + 1)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-600 hover:bg-white active:scale-90"><Plus size={12} /></button>
                        </div>
                        <span className="w-20 shrink-0 text-right font-mono text-sm font-black text-slate-900">{formatCurrency(item.quantity * item.rate)}</span>
                      </MotionDiv>
                    </div>
                  ))}
                </div>

                <div className="mt-2 hidden overflow-x-auto md:block">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="border-y border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="px-5 py-2.5">Product</th>
                        <th className="w-28 px-3 py-2.5 text-center">Unit</th>
                        <th className="w-32 px-3 py-2.5 text-center">Qty</th>
                        <th className="w-32 px-3 py-2.5 text-right">Rate</th>
                        <th className="w-32 px-3 py-2.5 text-right">Total</th>
                        <th className="w-12 px-3 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {invoiceItems.map((item) => {
                        const availUnits = getItemPurchaseUnits(item.item_id);
                        return (
                          <tr key={item.tempId} className="group transition-colors hover:bg-slate-50/70">
                            <td className="px-5 py-3">
                              <button type="button" onClick={() => openEditModal(item)} className="text-left text-sm font-bold text-slate-900 hover:text-lime-700" title="Edit product">
                                {item.item_name}
                              </button>
                              <div>{destinationTag(item)}</div>
                            </td>
                            <td className="px-3 py-3 text-center">
                              {availUnits.length > 1 ? (
                                <select
                                  aria-label={`Select unit for ${item.item_name}`}
                                  value={item.unit}
                                  onChange={(e) => {
                                    const chosen = availUnits.find(u => u.unit === e.target.value);
                                    if (chosen) handleLineItemUnitChange(item.tempId, chosen.unit, chosen.factor);
                                  }}
                                  className="max-w-[7rem] cursor-pointer rounded-lg border border-lime-300 bg-lime-50 px-2 py-1 text-xs font-bold text-lime-800 outline-none"
                                  title="Change purchase unit"
                                >
                                  {availUnits.map(u => <option key={u.unit} value={u.unit}>{u.label}</option>)}
                                </select>
                              ) : (
                                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{item.unit}</span>
                              )}
                            </td>
                            <td className="px-3 py-3">
                              <div className="mx-auto flex max-w-[120px] items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5 transition-all focus-within:border-lime-500 focus-within:bg-white">
                                <button aria-label="Kam karein" type="button" onClick={() => updateLineItem(item.tempId, 'quantity', Math.max(0.1, (item.quantity || 1) - 1))} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-white active:scale-90"><Minus size={12} /></button>
                                <input type="number" min="0.1" step="any" aria-label={`${item.item_name} quantity`} className="w-full border-0 bg-transparent p-0 text-center font-mono text-xs font-bold text-slate-900 outline-none dark:bg-transparent" value={item.quantity} onChange={(e) => updateLineItem(item.tempId, 'quantity', parseFloat(e.target.value) || 0)} />
                                <button aria-label="Zyada karein" type="button" onClick={() => updateLineItem(item.tempId, 'quantity', (item.quantity || 0) + 1)} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-white active:scale-90"><Plus size={12} /></button>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <div className="relative ml-auto max-w-[120px]">
                                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[11px] font-semibold text-slate-400">Rs</span>
                                <input type="number" min="0" step="any" aria-label={`${item.item_name} rate`} className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-2 text-right font-mono text-xs font-bold text-slate-900 outline-none transition-all focus:border-lime-500 focus:bg-white" value={item.rate} onChange={(e) => updateLineItem(item.tempId, 'rate', parseFloat(e.target.value) || 0)} />
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <input
                                type="number"
                                step="any"
                                aria-label={`${item.item_name} total`}
                                value={item.quantity * item.rate}
                                onChange={e => updateLineTotal(item.tempId, e.target.value)}
                                className="w-24 rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-right font-mono text-sm font-black text-slate-900 outline-none transition-colors hover:border-slate-200 focus:border-lime-500 focus:bg-white dark:bg-transparent"
                                title="Total badlein (qty khud adjust hogi)"
                              />
                            </td>
                            <td className="px-3 py-3 text-center">
                              <button aria-label="Remove Item" type="button" onClick={() => removeLineItem(item.tempId)} className="rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600 group-hover:text-slate-400" title="Remove Item">
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <aside className="rounded-2xl border border-slate-200 bg-white shadow-xs lg:sticky lg:top-4 lg:col-span-4">
            <div className="border-b border-slate-100 p-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Bill summary</p>
              {selectedVendorData ? (
                <div className="flex items-center gap-3">
                  <Avatar name={selectedVendorData.name} owed={vendorBalance > 0} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-900">{selectedVendorData.name}</p>
                    <p className={`font-mono text-[11px] font-semibold ${vendorBalance > 0 ? 'text-rose-600 dark:text-rose-400' : vendorBalance < 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                      {vendorBalance === 0 ? 'Khata clear' : `${formatCurrency(Math.abs(vendorBalance))} ${vendorBalance > 0 ? 'due' : 'advance'}`}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 p-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400"><User size={16} /></span>
                  <p className="text-[11px] leading-snug text-slate-500"><b className="text-slate-700">Cash / walk-in buy.</b> Vendor ke baghair bill poora ada hona chahiye.</p>
                </div>
              )}
            </div>

            <div className="space-y-3 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold text-slate-500">Bill total</span>
                <span className="font-mono text-2xl font-black tracking-tight text-lime-700">{formatCurrency(invoiceTotal)}</span>
              </div>
              <div>
                <span className="mb-1 block text-[11px] font-semibold text-slate-500">Abhi ada (paid now)</span>
                {paidInput(paidAmount, setPaidAmount, invoiceTotal, effectivePaid)}
              </div>
              <div>
                <span className="mb-1 block text-[11px] font-semibold text-slate-500">Paid via</span>
                <PillGroup label="Payment mode" options={payModePills.map(p => ({ ...p, disabled: effectivePaid <= 0 }))} value={paymentMode} onChange={setPaymentMode} />
              </div>
              {effectivePaid > 0 && accountPicker(materialAccountId, setMaterialAccountId, paymentMode)}
              <SettlementBar total={invoiceTotal} paid={effectivePaid} formatMoney={formatCurrency} />
              {selectedVendorData && unpaidInvoiceBalance > 0 && (
                <p className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1">Vendor khata after bill <ArrowRight size={11} /></span>
                  <b className={`font-mono ${vendorBalance + unpaidInvoiceBalance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700'}`}>{formatCurrency(Math.abs(vendorBalance + unpaidInvoiceBalance))}</b>
                </p>
              )}
              {!invoiceSupplier && invoiceItems.length > 0 && !isCashPaidFull && (
                <p className="flex items-start gap-1.5 text-[11px] font-semibold text-amber-700">
                  <AlertTriangle size={13} className="mt-px shrink-0" /> Udhaar bill ke liye vendor chunein, ya Full paid karein.
                </p>
              )}
            </div>

            <div className="flex gap-2 rounded-b-2xl border-t border-slate-100 bg-slate-50 p-4">
              {invoiceItems.length > 0 && (
                <button
                  type="button"
                  aria-label="Bill saaf karein"
                  onClick={async () => {
                    if (await confirmAction({
                      tone: 'warning',
                      title: 'Yeh invoice saaf karein?',
                      consequences: ['Invoice ke sab items, supplier aur paid amount hat jayenge.', 'Abhi tak kuch save nahi hua, is liye kisi khaate par asar nahi hoga.'],
                      confirmLabel: 'Haan, saaf karein',
                    })) {
                      setInvoiceItems([]);
                      setInvoiceSupplier('');
                      setPaidAmount('');
                    }
                  }}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                  title="Clear bill"
                >
                  <RotateCcw size={15} />
                </button>
              )}
              <button
                type="button"
                onClick={submitInvoice}
                disabled={!supplyCanSave}
                title={isMaterialDateLocked ? `Selected date (${invoiceDate}) is closed & locked` : undefined}
                className={`flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-bold transition-all active:scale-[0.98] ${
                  supplyCanSave ? 'cursor-pointer bg-lime-600 text-white shadow-md shadow-lime-600/25 hover:bg-lime-700' : 'cursor-not-allowed bg-slate-200 text-slate-400'
                }`}
              >
                {isSubmittingInvoice ? (<><Loader2 size={16} className="animate-spin" /> Saving…</>) : (
                  <><Save size={16} /> {invoiceItems.length === 0 ? 'Items add karein' : !invoiceSupplier ? (isCashPaidFull ? 'Save cash buy' : 'Vendor chunein') : 'Save purchase bill'}</>
                )}
              </button>
            </div>
          </aside>
        </div>
      )}

      <Modal
        open={Boolean(editingLineItem)}
        onClose={() => setEditingLineItem(null)}
        size="sm"
        icon={<span className="grid h-10 w-10 place-items-center rounded-xl bg-lime-100 text-lime-700"><Package size={18} /></span>}
        title={editingLineItem?.item_name || ''}
        description={editingLineItem ? `Unit: ${editItemUnit || editingLineItem.unit}` : undefined}
        footer={editingLineItem && (
          <div className="flex w-full items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                removeLineItem(editingLineItem.tempId);
                setEditingLineItem(null);
                showToast(`${editingLineItem.item_name} removed`, 'info');
              }}
              className="flex items-center gap-1 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700 transition-colors hover:bg-red-100"
            >
              <Trash2 size={13} /> Remove
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditingLineItem(null)} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100">Cancel</button>
              <button type="button" onClick={handleSaveEditedItem} className="rounded-xl bg-lime-600 px-4 py-2 text-xs font-bold text-white shadow-xs transition-colors hover:bg-lime-700">Update</button>
            </div>
          </div>
        )}
      >
        {editingLineItem && (
          <div className="space-y-4 text-xs">
            {(() => {
              const availUnits = getItemPurchaseUnits(editingLineItem.item_id);
              if (availUnits.length <= 1) return null;
              return (
                <div>
                  <label className={labelClass}>Purchase unit / packaging</label>
                  <div className="grid max-h-36 grid-cols-2 gap-1.5 overflow-y-auto">
                    {availUnits.map(u => {
                      const isSelected = (editItemUnit || editingLineItem.unit) === u.unit;
                      const dest = lineDestination({ ...editingLineItem, unit: u.unit, conversion_factor: u.factor, quantity: 1 });
                      return (
                        <button
                          key={u.unit}
                          type="button"
                          onClick={() => handleModalUnitChange(u.unit, u.factor)}
                          className={`rounded-xl border p-2 text-left text-xs transition-all ${
                            isSelected ? 'border-lime-600 bg-lime-50 font-bold text-lime-900 ring-2 ring-lime-500/20' : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-lime-400'
                          }`}
                        >
                          <span className="flex items-center justify-between"><span className="truncate">{u.unit}</span>{isSelected && <Check size={12} className="shrink-0 text-lime-600" />}</span>
                          <span className="mt-0.5 block text-[10px] font-normal text-slate-400">{u.factor === 1 ? 'Base unit' : `= ${u.factor} ${editingLineItem.base_unit || 'base'}`}</span>
                          {dest && <span className={`mt-0.5 block text-[10px] font-bold ${dest.packed ? 'text-amber-700' : 'text-emerald-700'}`}>{dest.packed ? 'Adds packs' : 'Adds loose'}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            <div>
              <label className={labelClass}>Quantity ({editItemUnit || editingLineItem.unit})</label>
              <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1 focus-within:border-lime-500 focus-within:bg-white">
                <button type="button" aria-label="Kam karein" onClick={() => handleEditQtyChange(Math.max(0.1, (parseFloat(editItemQty) || 1) - 1).toString())} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-700 hover:bg-slate-200 active:scale-90"><Minus size={14} /></button>
                <input type="number" step="any" min="0.1" aria-label="Quantity" value={editItemQty} onChange={e => handleEditQtyChange(e.target.value)} className="w-full border-0 bg-transparent text-center font-mono text-base font-bold text-slate-900 outline-none dark:bg-transparent" />
                <button type="button" aria-label="Zyada karein" onClick={() => handleEditQtyChange(((parseFloat(editItemQty) || 0) + 1).toString())} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-700 hover:bg-slate-200 active:scale-90"><Plus size={14} /></button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {[1, 2, 5, 10, 25, 50].map(val => (
                  <button key={val} type="button" onClick={() => handleEditQtyChange(val.toString())} className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-lime-100 hover:text-lime-800">{val}</button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Rate / {editItemUnit || editingLineItem.unit}</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-slate-400">Rs</span>
                  <input type="number" step="any" min="0" value={editItemRate} onChange={e => handleEditRateChange(e.target.value)} className={`${inputClass} h-10 pl-8 font-mono font-bold`} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Total</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-slate-400">Rs</span>
                  <input type="number" step="any" min="0" value={editItemTotal} onChange={e => handleEditTotalChange(e.target.value)} className={`${inputClass} h-10 pl-8 font-mono font-bold`} />
                </div>
              </div>
            </div>
            <p className="text-[10px] text-slate-400">Total badalne se quantity khud update ho jati hai.</p>
          </div>
        )}
      </Modal>

      <AnimatePresence>
        {isHistoryOpen && (
          <MotionDiv
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex justify-end overflow-hidden"
          >
            <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-xs" onClick={() => toggleHistory(false)} />

            <MotionDiv
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 240 }}
              role="dialog"
              aria-modal="true"
              aria-label={isMilk ? 'Milk intake log' : 'Supplies purchase log'}
              className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl"
            >
              <div className="shrink-0 space-y-3 border-b border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-lime-100 text-lime-700"><History size={16} /></span>
                    <div>
                      <h3 className="text-sm font-black text-slate-900">{isMilk ? 'Milk intake log' : 'Supplies purchase log'}</h3>
                      <p className="text-[11px] text-slate-400">Galat entry ho to yahan se supplier ko return karein</p>
                    </div>
                  </div>
                  <button aria-label="Band karein" type="button" onClick={() => toggleHistory(false)} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
                    <X size={16} />
                  </button>
                </div>
                <div className="flex gap-2">
                  <PillGroup label="Log range" size="sm" options={[{ value: 'today', label: 'Today' }, { value: 'all', label: 'All dates' }]} value={logScope} onChange={setLogScope} className="w-44 shrink-0" />
                  <div className="relative min-w-0 flex-1">
                    <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder={isMilk ? 'Farmer dhoondein…' : 'Vendor ya item…'}
                      value={historySearch}
                      onChange={e => setHistorySearch(e.target.value)}
                      className="h-full w-full rounded-xl border border-slate-200 bg-white pl-8 pr-7 text-xs font-medium outline-none focus:border-lime-500"
                    />
                    {historySearch && (
                      <button aria-label="Hatayen" type="button" onClick={() => setHistorySearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={12} /></button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-3 pb-4">
                {(() => {
                  const baseList = (isMilk ? milkHistory : productHistory).filter((entry: any) => logScope !== 'today' || businessDate(entry.date) === todayKey);
                  const displayList = baseList.filter((entry: any) => {
                    if (!historySearch.trim()) return true;
                    const supplier = suppliers.find(s => s.id === entry.supplier_id);
                    const name = supplier ? supplier.name.toLowerCase() : 'spot cash purchase';
                    const itemName = (entry.item_name || '').toLowerCase();
                    const q = historySearch.toLowerCase();
                    return name.includes(q) || itemName.includes(q);
                  });

                  if (displayList.length === 0) {
                    return (
                      <div className="px-6 py-14 text-center">
                        <span className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-2xl bg-slate-100 text-slate-400"><Search size={16} /></span>
                        <p className="text-xs font-semibold text-slate-600">Koi entry nahi mili</p>
                        <p className="mt-0.5 text-[11px] text-slate-400">{logScope === 'today' ? 'All dates par switch kar ke dekhein.' : 'Search badal kar dekhein.'}</p>
                      </div>
                    );
                  }

                  let lastDay = '';
                  return displayList.map((entry: any) => {
                    const supplier = suppliers.find(s => s.id === entry.supplier_id);
                    const displayName = supplier ? supplier.name : 'Spot Cash Purchase';
                    const isReturned = entry.status === 'Returned';
                    const day = businessDate(entry.date);
                    const showDay = day !== lastDay;
                    lastDay = day;
                    const paid = Number(entry.paid_amount ?? entry.details?.paid_amount ?? 0);
                    const due = Math.max(0, (Number(entry.total_amount) || 0) - paid);

                    return (
                      <React.Fragment key={entry.id}>
                        {showDay && (
                          <p className="sticky top-0 z-10 -mx-3 bg-white/95 px-4 pb-1.5 pt-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 backdrop-blur">
                            {day === todayKey ? 'Today' : new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                          </p>
                        )}
                        <div className={`mb-2 rounded-xl border p-3 text-xs transition-colors ${isReturned ? 'border-red-200 bg-red-50/40 opacity-75' : 'border-slate-200 bg-white hover:border-lime-300'}`}>
                          <div className="flex items-start gap-2.5">
                            <Avatar name={displayName} owed={!isReturned && due > 0.5} size="sm" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate font-bold text-slate-900">{displayName}</span>
                                  {isReturned && <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-700">Returned</span>}
                                </span>
                                <span className={`shrink-0 font-mono font-bold ${isReturned ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{formatCurrency(entry.total_amount)}</span>
                              </div>
                              <p className={`mt-0.5 flex items-center gap-1.5 ${isReturned ? 'text-slate-400 line-through' : 'text-slate-600'}`}>
                                {isMilk ? (
                                  <>
                                    <span className={`h-1.5 w-1.5 rounded-full ${varietyDot(entry.milk_type)}`} />
                                    {formatQty(entry.quantity)} L · {entry.milk_type} · {entry.shift}
                                  </>
                                ) : (
                                  <>{entry.item_name} · {formatQty(entry.quantity)} {entry.unit}</>
                                )}
                              </p>
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {paid > 0 && (
                                    <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                                      Paid {formatCurrency(paid)}{entry.payment_mode || entry.details?.payment_mode ? ` · ${entry.payment_mode || entry.details?.payment_mode}` : ''}
                                    </span>
                                  )}
                                  {due > 0.5 && (
                                    <span className="rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">Khata {formatCurrency(due)}</span>
                                  )}
                                </div>
                                {!isReturned && (
                                  <button
                                    type="button"
                                    onClick={() => isMilk ? handleOpenReturnMilk(entry) : handleOpenReturnMaterial(entry)}
                                    className="flex shrink-0 items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700 transition-colors hover:bg-amber-100"
                                    title="Return to supplier"
                                  >
                                    <RotateCcw size={11} /> Return
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  });
                })()}
              </div>
            </MotionDiv>
          </MotionDiv>
        )}
      </AnimatePresence>

      <Modal
        open={Boolean(returnModalEntry)}
        onClose={() => setReturnModalEntry(null)}
        dismissible={!isProcessingReturn}
        size="md"
        icon={<span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-700"><RotateCcw size={18} /></span>}
        title="Return to supplier"
        description={returnModalEntry ? (suppliers.find(s => s.id === returnModalEntry.supplier_id)?.name || 'Spot vendor') : undefined}
      >
        {returnModalEntry && (
          <form onSubmit={handleConfirmReturnPurchase} className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs">
              <span className="text-slate-500">Original entry</span>
              <span className="font-mono font-bold text-slate-900">
                {returnModalType === 'milk'
                  ? `${formatQty(returnModalEntry.quantity)} L · ${returnModalEntry.milk_type}`
                  : `${formatQty(returnModalEntry.quantity)} ${returnModalEntry.unit} · ${returnModalEntry.item_name}`}
              </span>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className={`${labelClass} mb-0`}>Return quantity *</label>
                <span className="text-[11px] font-semibold text-slate-500">Max <b className="font-mono text-lime-700">{formatQty(maxReturnQty)}</b></span>
              </div>
              <div className="flex items-center gap-1.5">
                <input type="number" min="0.1" max={maxReturnQty} step="any" required className={`${inputClass} h-10 font-mono font-bold`} value={returnQty} onChange={e => setReturnQty(e.target.value)} />
                <button type="button" onClick={() => setReturnQty(maxReturnQty)} className="h-10 whitespace-nowrap rounded-xl bg-slate-100 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-200">Full</button>
              </div>
            </div>

            <div>
              <label className={labelClass}>Reason *</label>
              <select className={`${inputClass} h-10 py-0`} value={returnReason} onChange={e => setReturnReason(e.target.value)}>
                {returnModalType === 'milk' ? (
                  <>
                    <option value="Substandard Quality / Curdled">Substandard Quality / Curdled</option>
                    <option value="Data Entry Error / Cancel Intake">Data Entry Error / Cancel</option>
                    <option value="Other">Other Reason...</option>
                  </>
                ) : (
                  <>
                    <option value="Defective / Damaged Material">Defective / Damaged</option>
                    <option value="Quality Substandard">Quality Substandard</option>
                    <option value="Data Entry Error">Data Entry Error</option>
                    <option value="Other">Other Reason...</option>
                  </>
                )}
              </select>
              {returnReason === 'Other' && (
                <input type="text" required placeholder="Wajah likhein…" className={`${inputClass} mt-2`} value={customReturnReason} onChange={e => setCustomReturnReason(e.target.value)} />
              )}
            </div>

            {(() => {
              const entryTotal = Number(returnModalEntry.total_amount || 0) || (Number(returnModalEntry.quantity || 0) * Number(returnModalEntry.rate || 0));
              const entryPaid = Number(returnModalEntry.paid_amount ?? returnModalEntry.details?.paid_amount ?? 0);
              const hasAccount = Boolean(returnModalEntry.details?.account_id || returnModalEntry.account_id);
              const returnValue = roundCurrency((parseFloat(String(returnQty)) || 0) * Number(returnModalEntry.rate || 0));
              const cashPart = refundAs === 'cash' && hasAccount && entryTotal > 0 ? roundCurrency(Math.min(entryPaid, returnValue * (entryPaid / entryTotal))) : 0;
              const khataPart = roundCurrency(Math.max(0, returnValue - cashPart));
              return (
                <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                  {entryPaid > 0 && hasAccount && (
                    <PillGroup
                      label="Refund kaise hoga"
                      size="sm"
                      options={[{ value: 'cash', label: 'Cash wapas mila' }, { value: 'khata', label: 'Sirf khata kam' }]}
                      value={refundAs}
                      onChange={setRefundAs}
                    />
                  )}
                  <div className="flex items-baseline justify-between">
                    <span className="text-slate-500">Return value</span>
                    <b className="font-mono text-base text-slate-900">{formatCurrency(returnValue)}</b>
                  </div>
                  {cashPart > 0 && <p className="flex items-center gap-1.5 text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{formatCurrency(cashPart)} account mein wapas aayenge</p>}
                  {khataPart > 0 && <p className="flex items-center gap-1.5 text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{formatCurrency(khataPart)} supplier ke khaate se kam honge</p>}
                </div>
              );
            })()}

            <div className="flex gap-2 pt-1">
              <button type="button" disabled={isProcessingReturn} onClick={() => setReturnModalEntry(null)} className="h-10 flex-1 rounded-xl bg-slate-100 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={isProcessingReturn} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-600 text-xs font-bold text-white shadow-sm hover:bg-red-700 disabled:opacity-60">
                {isProcessingReturn ? (<><Loader2 size={14} className="animate-spin" /> Processing…</>) : (<><RotateCcw size={13} /> Confirm return</>)}
              </button>
            </div>
          </form>
        )}
      </Modal>

    </div>
  );
};

export default Purchase;
