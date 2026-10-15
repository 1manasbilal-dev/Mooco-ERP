import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { useTabs } from '../context/TabContext';
import { MilkType, Shift, RateType, PurchaseType } from '../types';
import { 
  Save, Milk, Package, History, Trash2, Calendar as CalendarIcon, ClipboardCheck, 
  ChevronDown, Search, X, User, RotateCcw, Sun, Moon, Wallet, CreditCard, Building2,
  Plus, Minus, ShoppingCart, Check, Loader2, AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '../context/ToastContext';
import { RichSelect, RichSelectOption } from '../components/RichSelect';
import { SegmentedControl } from '../components/SegmentedControl';
import { formatQty, formatCurrency, cleanNumber, cleanQty } from '../lib/formatters';
import { businessDate } from '../lib/dashboardAnalytics';
import { SmartNumberInput } from '../components/SmartNumberInput';
import { roundCurrency, roundQuantity } from '../lib/db';

// Fix Framer Motion Types
const MotionDiv = motion.div as any;

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
          <button
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
                        Rs {Math.abs(bal).toLocaleString()} {bal > 0 ? 'Due' : 'Adv'}
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
    items, settings, accounts = [], canPerform, activeShiftSession
  } = useDairy();
  const { showToast } = useToast();
  const { openTab } = useTabs();

  const canCreate = canPerform('purchase', 'create');
  const canDelete = canPerform('purchase', 'delete');
  
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

  // Return to Supplier Modal State
  const [returnModalEntry, setReturnModalEntry] = useState<any | null>(null);
  const [returnModalType, setReturnModalType] = useState<'milk' | 'material'>('milk');
  const [returnQty, setReturnQty] = useState<number | string>(0);
  const [maxReturnQty, setMaxReturnQty] = useState<number>(0);
  const [returnReason, setReturnReason] = useState('Substandard Quality / Curdled');
  const [customReturnReason, setCustomReturnReason] = useState('');
  const [isProcessingReturn, setIsProcessingReturn] = useState(false);

  // Configured shifts from Settings (Company Profile -> Daily Milk Collection Shifts)
  const configuredShifts = useMemo(() => {
    const list = settings?.general?.shifts;
    if (Array.isArray(list) && list.length > 0) {
      return Array.from(new Set(list.map(s => String(s).trim()).filter(Boolean)));
    }
    return ['Morning', 'Evening'];
  }, [settings?.general?.shifts]);

  // Milk Form State
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
    date: new Date().toISOString().split('T')[0],
    shift: 'Morning',
    milk_type: MilkType.BUFFALO,
    quantity: 0,
    rate: 0,
    fat: 0,
    snf: 0
  });

  // Keep milkForm.shift in sync if configured shifts change
  useEffect(() => {
    if (configuredShifts.length > 0 && !configuredShifts.includes(milkForm.shift)) {
      setMilkForm(prev => ({ ...prev, shift: configuredShifts[0] }));
    }
  }, [configuredShifts, milkForm.shift]);

  const [milkPaidAmount, setMilkPaidAmount] = useState<string>('');
  const [milkPaymentMode, setMilkPaymentMode] = useState<string>('Cash');
  const [milkAccountId, setMilkAccountId] = useState<string>('');

  // Other Products / Materials Invoice State
  const [invoiceSupplier, setInvoiceSupplier] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [invoiceItems, setInvoiceItems] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [paidAmount, setPaidAmount] = useState<string>('');
  const [paymentMode, setPaymentMode] = useState<string>('Cash');
  const [materialAccountId, setMaterialAccountId] = useState<string>('');

  const availableAccounts = useMemo(() => (accounts || []).filter(a => a.isActive !== false), [accounts]);

  // Auto select appropriate account for Milk Intake (prioritizing active drawer)
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

  // Auto select appropriate account for Material Purchases
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

  // Milk Financial Calculations
  const milkTotalPayable = useMemo(() => {
    return (milkForm.quantity || 0) * (milkForm.rate || 0);
  }, [milkForm.quantity, milkForm.rate]);

  const effectiveMilkPaid = useMemo(() => {
    return milkPaidAmount !== '' ? Math.max(0, parseFloat(milkPaidAmount) || 0) : 0;
  }, [milkPaidAmount]);

  const milkDueAmount = useMemo(() => {
    return Math.max(0, milkTotalPayable - effectiveMilkPaid);
  }, [milkTotalPayable, effectiveMilkPaid]);

  // --- Derived History Lists ---
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
    return {
      bills: rows.length,
      amount: rows.reduce((sum, entry) => sum + (Number(entry.total_amount) || 0), 0),
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

  const supplierOptions: RichSelectOption[] = useMemo(() => {
    return filteredSuppliers.map(s => {
      const bal = s.pending_balance || 0;
      return {
        value: s.id,
        label: s.name,
        subLabel: s.village ? `${s.village}${s.phone ? ` • ${s.phone}` : ''}` : s.phone || undefined,
        badge: bal !== 0 ? {
          text: `Rs ${Math.abs(bal).toLocaleString()} ${bal > 0 ? 'Due' : 'Advance'}`,
          variant: bal > 0 ? 'red' : 'green'
        } : undefined,
        avatarLetter: s.name.charAt(0).toUpperCase(),
        avatarBg: bal > 0 ? 'bg-rose-100 text-rose-800' : 'bg-lime-100 text-lime-800'
      };
    });
  }, [filteredSuppliers]);

  const shiftOptions: RichSelectOption[] = useMemo(() => {
    return configuredShifts.map(shiftName => {
      const lower = shiftName.toLowerCase();
      let icon = <Sun size={14} className="text-amber-500" />;
      if (lower.includes('evening') || lower.includes('night') || lower.includes('sham') || lower.includes('raat')) {
        icon = <Moon size={14} className="text-indigo-400" />;
      } else if (lower.includes('noon') || lower.includes('afternoon') || lower.includes('dopehar')) {
        icon = <Sun size={14} className="text-orange-500" />;
      }
      return {
        value: shiftName,
        label: shiftName,
        icon
      };
    });
  }, [configuredShifts]);

  // Check if a milk variety is active in Items catalog
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

  // Derived Selected Supplier and recent logs
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

  // Auto-set default milk type & default rate from Supplier profile
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

  // Ensure selected milk_type is always an active option
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
    
    // Construct timestamp with exact current time if entry is for today, so ledger sorts correctly
    const todayYMD = new Date().toISOString().split('T')[0];
    const submissionDate = milkForm.date === todayYMD 
      ? new Date().toISOString() 
      : `${milkForm.date}T${new Date().toTimeString().slice(0, 8)}Z`;

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
        // Reset Form for next entry while preserving Date and Shift for rapid intake
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
    setReturnQty(availableUnallocated);
    setMaxReturnQty(availableUnallocated);
    setReturnReason('Substandard Quality / Curdled');
    setCustomReturnReason('');
  };

  const handleOpenReturnMaterial = (entry: any) => {
    const itemDef = items.find(i => i.id === entry.item_id || i.name.toLowerCase() === entry.item_name.toLowerCase());
    const availableStock = itemDef ? (itemDef.stock || 0) : entry.quantity;
    const maxQty = Math.min(entry.quantity, availableStock > 0 ? availableStock : entry.quantity);

    setReturnModalEntry(entry);
    setReturnModalType('material');
    setReturnQty(maxQty > 0 ? maxQty : entry.quantity);
    setMaxReturnQty(maxQty > 0 ? maxQty : entry.quantity);
    setReturnReason('Defective / Damaged Material');
    setCustomReturnReason('');
  };

  const handleConfirmReturnPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnModalEntry) return;

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

    setIsProcessingReturn(true);
    let success = false;
    if (returnModalType === 'milk') {
      success = await returnPurchase(returnModalEntry.id, numQty, finalReason);
    } else {
      success = await returnMaterialPurchase(returnModalEntry.id, numQty, finalReason);
    }
    setIsProcessingReturn(false);

    if (success) {
      setReturnModalEntry(null);
    }
  };

  // Materials / Products Logic
  const getFilteredItems = () => {
    const purchasableItems = items.filter(i => (i.isActive !== false) && (i.source === 'Supplier' || i.source === 'Both'));
    return purchasableItems.filter(i => 
      (
        i.item_type.includes('Raw material') || 
        i.item_type.includes('Packaging material') || 
        i.item_type.includes('Sale product')
      ) &&
      !i.category.some(c => c.toLowerCase().includes('milk')) &&
      !i.name.toLowerCase().includes('milk') &&
      i.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
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
            label: `${v.name} (${factor} ${baseUnit})`,
            factor,
            isBase: false
          });
        }
      });
    }

    return units;
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

  // Edit Line Item Modal State & Handlers
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
  
  // Effective paid calculation: strictly what the user entered (or 0 if left blank)
  const effectivePaid = paidAmount !== '' ? (parseFloat(paidAmount) || 0) : 0;
  
  const unpaidInvoiceBalance = Math.max(0, invoiceTotal - effectivePaid);
  const isCashPaidFull = invoiceTotal > 0 && unpaidInvoiceBalance <= 0.01;

  const submitInvoice = async () => { 
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

    const todayYMD = new Date().toISOString().split('T')[0];
    const submissionDate = invoiceDate === todayYMD 
      ? new Date().toISOString() 
      : `${invoiceDate}T${new Date().toTimeString().slice(0, 8)}Z`;

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

      if (success) {
        showToast(
          invoiceSupplier 
            ? `Purchase bill of Rs ${invoiceTotal.toLocaleString()} saved!` 
            : `Cash Purchase of Rs ${invoiceTotal.toLocaleString()} logged!`,
          'success'
        );
      }

      setInvoiceItems([]); 
      setInvoiceSupplier(''); 
      setPaidAmount(''); 
      setPaymentMode('Cash');
      setInvoiceDate(new Date().toISOString().split('T')[0]);
    } catch (err: any) {
      showToast("Error saving purchase: " + (err?.message || "Failed"), "error");
    } finally {
      setIsSubmittingInvoice(false);
    }
  };

  const selectedVendorData = suppliers.find(s => s.id === invoiceSupplier);

  // Standard Compact Input Tokens
  const inputClass = "w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-100 focus:border-lime-500 dark:focus:border-lime-400 focus:ring-1 focus:ring-lime-500 outline-none transition-all";
  const labelClass = "block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1";

  // Product Search Dropdown Component
  const ProductSearchDropdown = () => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const results = getFilteredItems();

    useEffect(() => { 
      const handleClickOutside = (e: MouseEvent) => { 
        if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
          setIsOpen(false); 
        }
      }; 
      document.addEventListener('mousedown', handleClickOutside); 
      return () => document.removeEventListener('mousedown', handleClickOutside); 
    }, []);

    return (
      <div className="relative w-full" ref={dropdownRef}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <input 
            type="text" 
            className={`${inputClass} pl-9 pr-9`} 
            placeholder="Search material, packaging or products..." 
            value={searchQuery} 
            onChange={(e) => { setSearchQuery(e.target.value); setIsOpen(true); }} 
            onFocus={() => setIsOpen(true)} 
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1">
              <X size={13} />
            </button>
          )}
        </div>
        {isOpen && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-56 overflow-y-auto z-50 divide-y divide-slate-100">
            {results.map(item => (
              <button 
                key={item.id} 
                className="w-full text-left px-3.5 py-2.5 hover:bg-lime-50/60 transition-colors flex justify-between items-center group text-xs" 
                onClick={() => { handleAddItem(item.id); setIsOpen(false); }}
              >
                <div>
                  <p className="font-semibold text-slate-800 text-xs sm:text-sm">{item.name}</p>
                  <p className="text-[11px] text-slate-400 font-normal">{item.category.join(', ')} • Cost: Rs {item.cost_price || 0}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {Array.isArray(item.variants) && item.variants.length > 0 && (
                    <span className="text-[10px] font-bold text-lime-700 bg-lime-50 border border-lime-200 px-1.5 py-0.5 rounded">
                      +{item.variants.length} units
                    </span>
                  )}
                  <span className="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded font-semibold group-hover:bg-white transition-colors">
                    {item.unit}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3 pb-8">
      
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:px-4 sm:py-3 shadow-sm flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Procurement</p>
            <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white tracking-tight">
              {activeTab === PurchaseType.MILK ? 'Milk Collection' : 'Supplies & Materials'}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {activeTab === PurchaseType.MILK
                ? 'Select supplier, specify volume and rate, and press enter to log intake.'
                : 'Purchase packaging, feed, and other products with multi-unit support.'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {activeTab === PurchaseType.MILK && (
              <button
                type="button"
                onClick={() => openTab('purchase-details')}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 cursor-pointer"
              >
                <ClipboardCheck size={14} />
                Details
              </button>
            )}
            <button 
              onClick={() => toggleHistory()} 
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all shadow-xs shrink-0 ${
                isHistoryOpen ? 'bg-lime-600 text-white border-lime-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
              }`}
            >
              <History size={14} /> 
              <span>Log</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                isHistoryOpen ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-100'
              }`}>
                {activeTab === PurchaseType.MILK ? purchases.length : materialPurchases.length}
              </span>
            </button>
          </div>
        </div>

        {activeTab === PurchaseType.MILK ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 px-3 py-2">
              <span className="text-[10px] font-bold uppercase text-slate-400">{milkForm.shift} shift</span>
              <p className="font-mono font-black text-slate-900 dark:text-white">{formatQty(todayMilkStats.shiftLiters)} L</p>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 px-3 py-2">
              <span className="text-[10px] font-bold uppercase text-slate-400">Today total</span>
              <p className="font-mono font-black text-slate-900 dark:text-white">{formatQty(todayMilkStats.liters)} L</p>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 px-3 py-2">
              <span className="text-[10px] font-bold uppercase text-slate-400">{todayMilkStats.farmers} farmers</span>
              <p className="font-mono font-black text-lime-700 dark:text-lime-400">{formatCurrency(todayMilkStats.amount)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 px-3 py-2">
              <span className="text-[10px] font-bold uppercase text-slate-400">On khata today</span>
              <p className="font-mono font-black text-rose-600 dark:text-rose-400">{formatCurrency(todayMilkStats.due)}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 px-3 py-2">
              <span className="text-[10px] font-bold uppercase text-slate-400">Bills today</span>
              <p className="font-mono font-black text-slate-900 dark:text-white">{todaySupplyStats.bills}</p>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 px-3 py-2">
              <span className="text-[10px] font-bold uppercase text-slate-400">Spent today</span>
              <p className="font-mono font-black text-lime-700 dark:text-lime-400">{formatCurrency(todaySupplyStats.amount)}</p>
            </div>
          </div>
        )}
      </div>

      {/* 2. MAIN WORKSPACE */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        
        {/* --- TAB 1: MILK PROCUREMENT FORM --- */}
        {activeTab === PurchaseType.MILK && (
          <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[380px]">
            
            {/* Left Column: Form */}
            <form onSubmit={handleMilkSubmit} className="col-span-12 lg:col-span-8 p-3.5 sm:p-5 flex flex-col justify-between lg:border-r border-slate-200 space-y-4">
              <div className="space-y-3.5">
                
                {/* Row 1: Session Meta (Date, Shift Dropdown, Milk Variety Dropdown) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
                  {/* Date */}
                  <div>
                    <label className={labelClass}>Date *</label>
                    <input 
                      type="date" 
                      className={inputClass} 
                      value={milkForm.date} 
                      onChange={e => setMilkForm({...milkForm, date: e.target.value})} 
                      required
                    />
                  </div>

                  {/* Shift & Milk Variety in 1 Row on Mobile */}
                  <div className="grid grid-cols-2 gap-2.5 sm:col-span-2 sm:gap-3">
                    {/* Shift Dropdown Menu */}
                    <div>
                      <label className={labelClass}>Shift *</label>
                      <RichSelect
                        options={shiftOptions}
                        value={milkForm.shift}
                        onChange={val => setMilkForm({ ...milkForm, shift: val as string })}
                        enableSearch={false}
                        allowClear={false}
                        compact={true}
                        placeholder="Select Shift"
                      />
                    </div>

                    {/* Milk Variety Dropdown Menu */}
                    <div>
                      <label className={labelClass}>Milk Variety *</label>
                      {milkTypeOptions.length > 0 ? (
                        <RichSelect
                          options={milkTypeOptions}
                          value={milkForm.milk_type}
                          onChange={val => setMilkForm({ ...milkForm, milk_type: val as MilkType })}
                          enableSearch={false}
                          allowClear={false}
                          compact={true}
                          placeholder="Select Milk Variety"
                        />
                      ) : (
                        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 font-medium">
                          All milk varieties inactive in catalog.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Row 2: Gwala / Farmer / Supplier */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className={`${labelClass} mb-0`}>Gwala / Farmer / Supplier *</label>
                    {selectedSupplier && (Number(selectedSupplier.pending_balance ?? selectedSupplier.balance ?? 0)) !== 0 && (
                      <span className={`text-[10px] font-bold font-mono px-1.5 py-0.2 rounded border ${
                        (Number(selectedSupplier.pending_balance ?? selectedSupplier.balance ?? 0)) > 0 
                          ? 'bg-rose-50 text-rose-700 border-rose-200' 
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}>
                        Rs {Math.abs(Number(selectedSupplier.pending_balance ?? selectedSupplier.balance ?? 0)).toLocaleString()} {(Number(selectedSupplier.pending_balance ?? selectedSupplier.balance ?? 0)) > 0 ? 'Due' : 'Advance'}
                      </span>
                    )}
                  </div>
                  <SearchableSupplierDropdown
                    value={milkForm.supplier_id}
                    onChange={id => setMilkForm({...milkForm, supplier_id: id})}
                    suppliers={filteredSuppliers}
                    placeholder="Search or select Gwala / Farmer... (Type name or phone)"
                    inputClass={inputClass}
                    labelClass={labelClass}
                    focusToken={supplierFocusToken}
                  />
                </div>

                {/* Row 3: Volume (Qty in Liters) and Rate / Liter (Rs) - 1 Row on Mobile and Desktop */}
                <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                  {/* Volume Input */}
                  <div>
                    <label className={`${labelClass} mb-1 block`}>Volume (Qty in Liters) *</label>
                    <div className="relative">
                      <SmartNumberInput 
                        step="any" 
                        min="0" 
                        placeholder="0.0" 
                        className={`${inputClass} text-base sm:text-lg font-bold h-11 pl-3 pr-8 font-mono text-slate-900 focus:border-lime-500 focus:ring-1 focus:ring-lime-400`} 
                        value={milkForm.quantity || ''} 
                        onChange={val => setMilkForm({...milkForm, quantity: parseFloat(val) || 0})} 
                        required 
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-xs pointer-events-none z-10">L</span>
                    </div>
                  </div>

                  {/* Rate per Liter Input */}
                  <div>
                    <label className={`${labelClass} mb-1 block`}>Rate / Liter (Rs) *</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-semibold font-mono pointer-events-none z-10">Rs</span>
                      <SmartNumberInput 
                        step="any" 
                        min="0" 
                        placeholder="0" 
                        className={`${inputClass} pl-8 pr-8 text-base sm:text-lg font-bold h-11 font-mono text-slate-900 focus:border-lime-500 focus:ring-1 focus:ring-lime-400`} 
                        value={milkForm.rate || ''} 
                        onChange={val => setMilkForm({...milkForm, rate: parseFloat(val) || 0})} 
                        required 
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-xs pointer-events-none z-10">/L</span>
                    </div>
                  </div>
                </div>

                {/* Row 4: Professional Payment Settlement Card */}
                <div className="bg-slate-50/90 rounded-xl p-3 sm:p-3.5 border border-slate-200/90 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">Payment Settlement</span>
                    
                    {/* Status Badge */}
                    {milkTotalPayable > 0 && (
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                        effectiveMilkPaid >= milkTotalPayable
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : effectiveMilkPaid > 0
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}>
                        {effectiveMilkPaid >= milkTotalPayable ? 'Fully Paid' : effectiveMilkPaid > 0 ? `Partial (Rs ${effectiveMilkPaid.toLocaleString()})` : 'On Khata (Unpaid)'}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                    {/* Paid Amount Input */}
                    <div className="sm:col-span-6">
                      <label className="text-xs font-semibold text-slate-700 mb-1 block">Amount Paid (Rs)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-semibold font-mono pointer-events-none z-10">Rs</span>
                        <SmartNumberInput 
                          step="any" 
                          min="0" 
                          placeholder="0"
                          className={`${inputClass} pl-8 pr-14 text-sm font-bold font-mono text-slate-900`} 
                          value={milkPaidAmount} 
                          onChange={setMilkPaidAmount} 
                        />
                        {milkTotalPayable > 0 && (
                          <button
                            type="button"
                            onClick={() => setMilkPaidAmount(milkTotalPayable.toString())}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-lime-700 hover:text-lime-800 bg-lime-100/90 hover:bg-lime-200 px-2 py-0.5 rounded transition-colors z-20 cursor-pointer"
                            title="Pay Full Amount"
                          >
                            Full
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Payment Mode (Only Cash or Online) */}
                    <div className="sm:col-span-6">
                      <label className="text-xs font-semibold text-slate-700 mb-1 block">Payment Mode</label>
                      <SegmentedControl
                        options={[
                          { value: 'Cash', label: 'Cash' },
                          { value: 'Online', label: 'Online' }
                        ]}
                        value={milkPaymentMode}
                        onChange={val => setMilkPaymentMode(val)}
                        size="md"
                        disabled={effectiveMilkPaid <= 0}
                      />
                    </div>

                    {/* Account Selector or Warning when paid > 0 */}
                    {effectiveMilkPaid > 0 && (
                      <div className="sm:col-span-12 pt-1 border-t border-slate-200/60">
                        {availableAccounts.length === 0 ? (
                          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2 animate-in fade-in">
                            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600" />
                            <div>
                              <span className="font-bold">⚠️ Koi Cash Drawer ya Bank Account add nahi hy!</span>
                              <p className="mt-0.5 text-[11px] text-amber-700 leading-tight">
                                Raqam deduct kerne k liye pehle <b>'Bank & Cash'</b> module men account banayein, ya <b>Amount Paid</b> ko <b>0</b> rakh ker entry ko <b>Khata (Unpaid)</b> per record karein.
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                                <Wallet size={13} className="text-lime-700" />
                                <span>Deduct From Account / Cash Drawer *</span>
                              </label>
                              {milkPaymentMode === 'Cash' && activeShiftSession && (
                                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                  Active Shift Drawer
                                </span>
                              )}
                            </div>
                            <select
                              className={`${inputClass} text-xs font-semibold bg-white border-slate-300`}
                              value={milkAccountId}
                              onChange={e => setMilkAccountId(e.target.value)}
                            >
                              {availableAccounts.map(acc => (
                                <option key={acc.id} value={acc.id}>
                                  {acc.name} ({acc.type}) — Balance: Rs {acc.balance.toLocaleString()}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Financial Breakdown Badges */}
                  {milkTotalPayable > 0 && (
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200/60 text-center">
                      <div className="bg-white p-2 rounded-lg border border-slate-200/80 shadow-2xs">
                        <span className="text-[9px] font-bold text-slate-400 uppercase block">Total Bill</span>
                        <span className="text-xs sm:text-sm font-bold font-mono text-slate-900">Rs {milkTotalPayable.toLocaleString()}</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200/80 shadow-2xs">
                        <span className="text-[9px] font-bold text-emerald-600 uppercase block">Paid Now</span>
                        <span className="text-xs sm:text-sm font-bold font-mono text-emerald-700">Rs {effectiveMilkPaid.toLocaleString()}</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200/80 shadow-2xs">
                        <span className="text-[9px] font-bold text-rose-600 uppercase block">Added to Khata</span>
                        <span className="text-xs sm:text-sm font-bold font-mono text-rose-700">Rs {milkDueAmount.toLocaleString()}</span>
                      </div>
                    </div>
                  )}
                </div>

              </div>

              {/* Bottom Action Bar */}
              <div className="pt-3.5 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Total Payable</span>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xl sm:text-2xl font-bold font-mono text-lime-700 leading-tight">
                      Rs {milkTotalPayable.toLocaleString()}
                    </span>
                    {effectiveMilkPaid > 0 && (
                      <span className="text-xs text-slate-500 font-medium">
                        (Paid: <strong className="text-emerald-700 font-mono">Rs {effectiveMilkPaid.toLocaleString()}</strong> • Due: <strong className="text-rose-700 font-mono">Rs {milkDueAmount.toLocaleString()}</strong>)
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button 
                    type="button"
                    onClick={() => {
                      setMilkForm({
                        supplier_id: '',
                        date: new Date().toISOString().split('T')[0],
                        shift: configuredShifts[0] || 'Morning',
                        milk_type: MilkType.BUFFALO,
                        quantity: 0,
                        rate: 0,
                        fat: 0,
                        snf: 0
                      });
                      setMilkPaidAmount('');
                      setMilkPaymentMode('Cash');
                    }}
                    className="px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 font-semibold text-xs transition-colors"
                  >
                    Clear
                  </button>
                  <button 
                    type="submit" 
                    disabled={!milkForm.supplier_id || milkForm.quantity <= 0 || milkForm.rate <= 0 || isSubmitting || milkTypeOptions.length === 0}
                    className={`font-bold text-xs sm:text-sm px-5 py-2.5 rounded-xl shadow-sm transition-all active:scale-95 flex items-center justify-center gap-1.5 whitespace-nowrap ${
                      milkForm.supplier_id && milkForm.quantity > 0 && milkForm.rate > 0 && !isSubmitting && milkTypeOptions.length > 0
                        ? 'bg-lime-600 hover:bg-lime-700 text-white cursor-pointer'
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 size={15} className="animate-spin" /> Saving...
                      </>
                    ) : (
                      <>
                        <Save size={15} /> Save Intake
                      </>
                    )}
                  </button>
                </div>
              </div>

            </form>

            {/* Right Column: Vendor Snapshot */}
            <div className="hidden lg:flex lg:col-span-4 bg-slate-50/70 p-4 sm:p-5 flex-col justify-between space-y-3.5">
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-200">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Vendor Overview</h4>
                  <span className="text-[10px] font-semibold bg-slate-200 text-slate-700 px-1.5 py-0.2 rounded">Live</span>
                </div>

                {selectedSupplier ? (
                  <div className="space-y-2.5">
                    {/* Supplier Card */}
                    <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-bold text-slate-900 text-sm">{selectedSupplier.name}</h4>
                          <p className="text-[11px] text-slate-400">{selectedSupplier.phone || selectedSupplier.village || 'No contact specified'}</p>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-lime-100 text-lime-800 font-bold text-xs flex items-center justify-center">
                          {selectedSupplier.name.charAt(0).toUpperCase()}
                        </div>
                      </div>

                      <div className="space-y-1.5 pt-1.5 border-t border-slate-100 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-500">Current Due:</span>
                          {(() => {
                            const bal = Number(selectedSupplier.pending_balance ?? selectedSupplier.balance ?? 0) || 0;
                            return (
                              <span className={`font-bold font-mono ${bal > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                                Rs {bal.toLocaleString()}
                              </span>
                            );
                          })()}
                        </div>

                        {milkTotalPayable > 0 && (
                          <div className="flex justify-between items-center pt-1 border-t border-dashed border-slate-200">
                            <span className="text-slate-500 font-medium">Projected Due:</span>
                            {(() => {
                              const bal = Number(selectedSupplier.pending_balance ?? selectedSupplier.balance ?? 0) || 0;
                              const proj = bal + milkDueAmount;
                              return (
                                <span className={`font-bold font-mono ${proj > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                                  Rs {proj.toLocaleString()}
                                </span>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Recent Deliveries */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Recent Deliveries</span>
                      {supplierRecentPurchases.length === 0 ? (
                        <p className="text-xs text-slate-400 italic text-center py-3 bg-white rounded-lg border border-slate-200">No recent entries found</p>
                      ) : (
                        supplierRecentPurchases.map(p => (
                          <div key={p.id} className="bg-white p-2.5 rounded-lg border border-slate-200 text-xs flex justify-between items-center hover:border-slate-300 transition-colors">
                            <div>
                              <span className="font-semibold text-slate-800 block">{formatQty(p.quantity)}L • {p.milk_type}</span>
                              <span className="text-slate-400 text-[10px]">{new Date(p.date).toLocaleDateString()} ({p.shift})</span>
                            </div>
                            <span className="font-bold font-mono text-slate-900">{formatCurrency(p.total_amount)}</span>
                          </div>
                        ))
                      )}
                    </div>

                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Latest intakes today</span>
                    {todayMilkEntries.length === 0 ? (
                      <div className="py-8 text-center opacity-70 bg-white/60 rounded-xl border border-dashed border-slate-200">
                        <Milk size={22} className="mx-auto mb-1.5 text-slate-400" />
                        <p className="text-xs font-semibold text-slate-600">No milk intakes recorded today</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">Select a farmer and enter volume in liters</p>
                      </div>
                    ) : (
                      todayMilkEntries.slice(0, 6).map(entry => (
                        <div key={entry.id} className="bg-white p-2.5 rounded-lg border border-slate-200 text-xs flex justify-between items-center">
                          <div className="min-w-0">
                            <span className="font-semibold text-slate-800 block truncate">{entry.supplier_name || 'Farmer'}</span>
                            <span className="text-slate-400 text-[10px]">{formatQty(entry.quantity)}L · {entry.milk_type} · {entry.shift}</span>
                          </div>
                          <span className="font-bold font-mono text-slate-900 shrink-0">{formatCurrency(entry.total_amount)}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

        {/* --- TAB 2: RAW MATERIALS & SUPPLIES INVOICE --- */}
        {activeTab !== PurchaseType.MILK && (
          <div className="flex flex-col h-full divide-y divide-slate-200">
            
            {/* Top Invoice Controls */}
            <div className="p-3 sm:p-4 bg-slate-50 space-y-3">
              <div className="flex items-end gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-1">
                    <label className={`${labelClass} mb-0`}>Vendor / Supplier</label>
                    {selectedVendorData && (Number(selectedVendorData.pending_balance ?? selectedVendorData.balance ?? 0)) !== 0 && (
                      <span className={`text-[10px] font-bold font-mono px-1.5 py-0.2 rounded border ${
                        (Number(selectedVendorData.pending_balance ?? selectedVendorData.balance ?? 0)) > 0 
                          ? 'bg-rose-50 text-rose-700 border-rose-200' 
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}>
                        Rs {Math.abs(Number(selectedVendorData.pending_balance ?? selectedVendorData.balance ?? 0)).toLocaleString()} {(Number(selectedVendorData.pending_balance ?? selectedVendorData.balance ?? 0)) > 0 ? 'Due' : 'Advance'}
                      </span>
                    )}
                  </div>
                  <SearchableSupplierDropdown
                    value={invoiceSupplier}
                    onChange={val => setInvoiceSupplier(val)}
                    suppliers={filteredSuppliers}
                    placeholder={isCashPaidFull ? 'Cash / Walk-in Buy (Optional)' : 'Search or select Vendor...'}
                    inputClass={inputClass}
                    labelClass={labelClass}
                  />
                </div>

                <div className="shrink-0" title={`Invoice Date: ${invoiceDate}`}>
                  <label className={`${labelClass} mb-1 block invisible select-none`}>Date</label>
                  <div className="relative w-10 h-10 flex items-center justify-center bg-white hover:bg-slate-100/80 border border-slate-200 rounded-lg cursor-pointer shadow-2xs transition-colors group">
                    <CalendarIcon size={18} className="text-slate-600 group-hover:text-lime-600 transition-colors pointer-events-none" />
                    <input 
                      type="date" 
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" 
                      value={invoiceDate} 
                      onChange={e => setInvoiceDate(e.target.value)} 
                      title={`Date: ${invoiceDate}`}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className={`${labelClass} mb-1 block`}>Search & Add Products to Bill</label>
                <ProductSearchDropdown />
              </div>
            </div>

            {/* Line Items Container */}
            <div className="flex-1 overflow-y-auto min-h-[260px] bg-white">
              
              {/* Empty State */}
              {invoiceItems.length === 0 ? (
                <div className="p-10 text-center text-slate-400 flex flex-col items-center justify-center">
                  <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 mb-2.5 shadow-2xs">
                    <Package size={26} className="text-lime-600 opacity-60" />
                  </div>
                  <p className="text-xs sm:text-sm font-bold text-slate-700">No Supplies Added Yet</p>
                  <p className="text-[11px] text-slate-400 mt-0.5 max-w-xs">
                    Search material, packaging, or cattle feed above to add items to this purchase invoice.
                  </p>
                </div>
              ) : (
                <>
                  {/* --- MOBILE VIEW: EXACT POS CART-STYLE COMPACT TABLE (< md screens) --- */}
                  <div className="md:hidden">
                    {/* Mobile Table Header */}
                    <div className="grid grid-cols-12 px-3 py-2 bg-slate-50 border-b border-slate-100 text-[10px] uppercase font-bold text-slate-400 tracking-wider items-center">
                      <span className="col-span-5">Item</span>
                      <span className="col-span-4 text-center">Qty</span>
                      <div className="col-span-3 flex justify-between items-center">
                        <span className="w-full text-right">Total</span>
                      </div>
                    </div>

                    {/* Mobile Table Rows with Swipe-to-Delete */}
                    <div className="divide-y divide-slate-100">
                      {invoiceItems.map((item) => (
                        <div key={item.tempId} className="relative overflow-hidden bg-red-500">
                          {/* Background Reveal when swiping */}
                          <div className="absolute inset-0 flex items-center justify-between px-4 text-white text-xs font-bold">
                            <span className="flex items-center gap-1.5"><Trash2 size={14} /> Delete</span>
                            <span className="flex items-center gap-1.5">Delete <Trash2 size={14} /></span>
                          </div>

                          {/* Draggable Swipe Row */}
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
                            className="relative bg-white px-3 py-2.5 grid grid-cols-12 items-center gap-1.5 touch-pan-y"
                          >
                            {/* Col 1: Item Name & Unit / Rate (col-span-5) - Clicking opens Edit Modal */}
                            <div 
                              onClick={() => openEditModal(item)}
                              className="col-span-5 min-w-0 pr-1 cursor-pointer active:opacity-70 group"
                              title="Click to edit quantity & rate"
                            >
                              <p className="font-bold text-slate-800 text-xs truncate leading-tight group-hover:text-lime-600 transition-colors">
                                {item.item_name}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="bg-lime-50 text-lime-800 border border-lime-200 text-[10px] font-bold px-1.5 py-0.5 rounded">
                                  {item.unit}
                                </span>
                                <span className="text-[10px] text-slate-400 font-medium">
                                  • Rs {item.rate}
                                </span>
                              </div>
                            </div>

                            {/* Col 2: Quantity Stepper (col-span-4) */}
                            <div className="col-span-4 flex items-center justify-center">
                              <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200/60">
                                <button 
                                  type="button"
                                  onClick={() => updateLineItem(item.tempId, 'quantity', Math.max(0.1, (item.quantity || 1) - 1))} 
                                  className="w-6 h-6 rounded-md hover:bg-white text-slate-700 active:scale-90 flex items-center justify-center transition-all"
                                  title="Decrease Qty"
                                >
                                  <Minus size={11} />
                                </button>
                                <input 
                                  type="number"
                                  step="any"
                                  min="0.1"
                                  value={item.quantity}
                                  onChange={e => updateLineItem(item.tempId, 'quantity', parseFloat(e.target.value) || 0)}
                                  className="w-8 text-center text-xs font-bold font-mono text-slate-900 bg-transparent outline-none"
                                />
                                <button 
                                  type="button"
                                  onClick={() => updateLineItem(item.tempId, 'quantity', (item.quantity || 0) + 1)} 
                                  className="w-6 h-6 rounded-md hover:bg-white text-slate-700 active:scale-90 flex items-center justify-center transition-all"
                                  title="Increase Qty"
                                >
                                  <Plus size={11} />
                                </button>
                              </div>
                            </div>

                            {/* Col 3: Line Total (Editable auto-calculates qty) */}
                            <div className="col-span-3 text-right">
                              <div className="flex items-center justify-end">
                                <span className="text-[10px] text-slate-400 mr-0.5 font-mono">Rs</span>
                                <input
                                  type="number"
                                  step="any"
                                  value={item.quantity * item.rate}
                                  onChange={e => updateLineTotal(item.tempId, e.target.value)}
                                  className="w-14 text-right text-xs font-black font-mono bg-transparent border border-transparent hover:border-slate-200 focus:border-lime-500 focus:bg-white rounded px-1 py-0.5 outline-none text-slate-900 transition-colors"
                                  title="Click to edit total amount (auto-calculates quantity)"
                                />
                              </div>
                            </div>
                          </MotionDiv>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* --- DESKTOP VIEW: STRUCTURED DATA TABLE (>= md screens) --- */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-50 text-slate-500 sticky top-0 z-10 uppercase font-bold text-[11px] tracking-wider border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-2.5">Product Name</th>
                          <th className="px-3 py-2.5 w-24 text-center">Unit</th>
                          <th className="px-3 py-2.5 w-32 text-center">Quantity</th>
                          <th className="px-3 py-2.5 w-36 text-right">Unit Rate (Rs)</th>
                          <th className="px-4 py-2.5 w-36 text-right">Total</th>
                          <th className="px-3 py-2.5 w-12 text-center"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {invoiceItems.map((item) => (
                          <tr key={item.tempId} className="hover:bg-slate-50/80 transition-colors">
                            <td className="px-4 py-3">
                              <span 
                                onClick={() => openEditModal(item)}
                                className="font-bold text-slate-900 text-xs sm:text-sm cursor-pointer hover:text-lime-700"
                                title="Click to edit product"
                              >
                                {item.item_name}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-center">
                              {(() => {
                                const availUnits = getItemPurchaseUnits(item.item_id);
                                if (availUnits.length > 1) {
                                  return (
                                    <div className="relative inline-block">
                                      <select
                                        aria-label={`Select unit for ${item.item_name}`}
                                        value={item.unit}
                                        onChange={(e) => {
                                          const chosen = availUnits.find(u => u.unit === e.target.value);
                                          if (chosen) {
                                            handleLineItemUnitChange(item.tempId, chosen.unit, chosen.factor);
                                          }
                                        }}
                                        className="bg-lime-50/80 hover:bg-lime-100 text-lime-900 font-bold px-2 py-1 rounded-lg text-xs border border-lime-300 dark:bg-slate-800 dark:text-lime-300 dark:border-lime-700 outline-none cursor-pointer transition-all shadow-2xs"
                                        title="Change purchase unit"
                                      >
                                        {availUnits.map(u => (
                                          <option key={u.unit} value={u.unit}>
                                            {u.unit} {u.factor !== 1 ? `(${u.factor} ${item.base_unit || 'base'})` : ''}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  );
                                }
                                return (
                                  <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px] font-semibold border border-slate-200">
                                    {item.unit}
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center bg-slate-50 rounded-lg border border-slate-200 p-0.5 focus-within:border-lime-500 focus-within:bg-white transition-all max-w-[120px] mx-auto">
                                <button
                                  type="button"
                                  onClick={() => updateLineItem(item.tempId, 'quantity', Math.max(0.1, (item.quantity || 1) - 1))}
                                  className="w-6 h-6 rounded hover:bg-white text-slate-700 active:scale-90 flex items-center justify-center transition-all"
                                >
                                  <Minus size={11} />
                                </button>
                                <input 
                                  type="number" 
                                  min="0.1" 
                                  step="any" 
                                  className="w-full text-center font-bold font-mono text-xs text-slate-900 bg-transparent outline-none" 
                                  value={item.quantity} 
                                  onChange={(e) => updateLineItem(item.tempId, 'quantity', parseFloat(e.target.value) || 0)} 
                                />
                                <button
                                  type="button"
                                  onClick={() => updateLineItem(item.tempId, 'quantity', (item.quantity || 0) + 1)}
                                  className="w-6 h-6 rounded hover:bg-white text-slate-700 active:scale-90 flex items-center justify-center transition-all"
                                >
                                  <Plus size={11} />
                                </button>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <div className="relative max-w-[120px] ml-auto">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[11px] font-mono font-semibold">Rs</span>
                                <input 
                                  type="number" 
                                  min="0" 
                                  step="any" 
                                  className="w-full h-8 bg-slate-50 focus:bg-white border border-slate-200 rounded-lg text-right pr-2 pl-7 font-bold font-mono text-xs text-slate-900 outline-none focus:border-lime-500 transition-all" 
                                  value={item.rate} 
                                  onChange={(e) => updateLineItem(item.tempId, 'rate', parseFloat(e.target.value) || 0)} 
                                />
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-bold font-mono text-slate-900 text-xs sm:text-sm">
                              <input
                                type="number"
                                step="any"
                                value={item.quantity * item.rate}
                                onChange={e => updateLineTotal(item.tempId, e.target.value)}
                                className="w-24 text-right font-bold font-mono bg-transparent border border-transparent hover:border-slate-200 focus:border-lime-500 focus:bg-white rounded px-1 py-0.5 outline-none text-slate-900 transition-colors"
                                title="Click to edit total amount"
                              />
                            </td>
                            <td className="px-3 py-3 text-center">
                              <button 
                                onClick={() => removeLineItem(item.tempId)} 
                                className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                                title="Remove Item"
                              >
                                <Trash2 size={14}/>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

            </div>

            {/* Bottom Finalization & Payment Settlement Bar */}
            <div className="p-3 sm:p-4 bg-slate-50 shrink-0 space-y-3">
              <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-3">
                
                {/* Left: Financial Totals */}
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Total Purchase Bill</span>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xl sm:text-2xl font-bold font-mono text-lime-700 leading-tight">
                      Rs {invoiceTotal.toLocaleString()}
                    </span>
                    <span className="text-xs font-semibold text-slate-500">
                      ({invoiceItems.length} {invoiceItems.length === 1 ? 'product' : 'products'})
                    </span>
                    {effectivePaid > 0 && (
                      <span className="text-xs text-slate-500 font-medium">
                        • Paid: <strong className="text-emerald-700 font-mono">Rs {effectivePaid.toLocaleString()}</strong>
                        {unpaidInvoiceBalance > 0 && (
                          <> • Due: <strong className="text-rose-700 font-mono">Rs {unpaidInvoiceBalance.toLocaleString()}</strong></>
                        )}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: Payment Settlement & Actions */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-2.5">
                    {/* Paid Amount Input with internal minimal Full button */}
                    <div className="w-full sm:w-36">
                      <label className="text-xs font-semibold text-slate-700 mb-1 block">Amount Paid</label>
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-semibold font-mono pointer-events-none z-10">Rs</span>
                        <SmartNumberInput 
                          min="0" 
                          className={`${inputClass} pl-8 pr-14 text-xs sm:text-sm font-bold font-mono text-slate-900`} 
                          placeholder="0" 
                          value={paidAmount} 
                          onChange={setPaidAmount} 
                        />
                        {invoiceTotal > 0 && (
                          <button
                            type="button"
                            onClick={() => setPaidAmount(invoiceTotal.toString())}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-lime-700 hover:text-lime-800 bg-lime-100/90 hover:bg-lime-200 px-2 py-0.5 rounded transition-colors z-20 cursor-pointer"
                            title="Pay Full Amount"
                          >
                            Full
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Payment Mode Switcher */}
                    <div className="w-full sm:w-44">
                      <span className="text-xs font-semibold text-slate-700 block mb-1">Payment Mode</span>
                      <SegmentedControl
                        options={[
                          { value: 'Cash', label: 'Cash' },
                          { value: 'Online', label: 'Online' }
                        ]}
                        value={paymentMode}
                        onChange={val => setPaymentMode(val)}
                        size="md"
                        disabled={effectivePaid <= 0}
                      />
                    </div>

                    {/* Account Selector or Warning for Material Purchase */}
                    {effectivePaid > 0 && availableAccounts.length > 0 && (
                      <div className="w-full sm:w-48">
                        <span className="text-xs font-semibold text-slate-700 block mb-1">Account</span>
                        <select
                          className={`${inputClass} text-xs font-medium bg-slate-50 py-1.5`}
                          value={materialAccountId}
                          onChange={e => setMaterialAccountId(e.target.value)}
                        >
                          {availableAccounts.map(acc => (
                            <option key={acc.id} value={acc.id}>
                              {acc.name} ({acc.type}) — Rs {acc.balance.toLocaleString()}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Warning if paying without accounts */}
                  {effectivePaid > 0 && availableAccounts.length === 0 && (
                    <div className="mt-2.5 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2 animate-in fade-in">
                      <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600" />
                      <div>
                        <span className="font-bold">⚠️ Koi Cash Drawer ya Bank Account add nahi hy!</span>
                        <p className="mt-0.5 text-[11px] text-amber-700 leading-tight">
                          Pehle 'Bank & Cash' module men account banayein ya bill ko Khata per save karein.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Submit Action Button */}
                  <div className="flex items-center gap-2 pt-1 sm:pt-4">
                    {invoiceItems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm("Clear current invoice?")) {
                            setInvoiceItems([]);
                            setInvoiceSupplier('');
                            setPaidAmount('');
                          }
                        }}
                        className="px-3 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 font-semibold text-xs transition-colors"
                      >
                        Clear
                      </button>
                    )}
                    <button 
                      onClick={submitInvoice} 
                      disabled={invoiceItems.length === 0 || isSubmittingInvoice || (!isCashPaidFull && !invoiceSupplier)} 
                      className={`font-bold text-xs sm:text-sm px-5 py-2.5 rounded-xl shadow-sm transition-all active:scale-95 flex items-center justify-center gap-1.5 whitespace-nowrap flex-1 sm:flex-initial ${
                        invoiceItems.length > 0 && !isSubmittingInvoice && (isCashPaidFull || !!invoiceSupplier)
                          ? 'bg-lime-600 hover:bg-lime-700 text-white cursor-pointer' 
                          : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      }`}
                    >
                      {isSubmittingInvoice ? (
                        <>
                          <Loader2 size={15} className="animate-spin" /> Saving...
                        </>
                      ) : (
                        <>
                          <Save size={15} /> {!invoiceSupplier ? (isCashPaidFull ? 'Save Cash Buy' : 'Select Vendor to Save') : 'Save Purchase Bill'}
                        </>
                      )}
                    </button>
                  </div>
                </div>

              </div>
            </div>

          </div>
        )}

      </div>

      {/* --- MODAL: EDIT PURCHASE LINE ITEM DIALOG --- */}
      {editingLineItem && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-xs">
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
            <div className="px-4 py-3.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white flex justify-between items-center border-b border-slate-200 dark:border-slate-700">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">{editingLineItem.item_name}</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Unit: <strong className="text-lime-700 dark:text-lime-400 font-bold">{editItemUnit || editingLineItem.unit}</strong>
                </p>
              </div>
              <button onClick={() => setEditingLineItem(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded-lg">
                <X size={16} />
              </button>
            </div>

            <div className="p-4 space-y-3.5 text-xs">
              {/* Unit & Packaging Selector */}
              {(() => {
                const availUnits = getItemPurchaseUnits(editingLineItem.item_id);
                if (availUnits.length <= 1) return null;
                return (
                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      Purchase Unit / Packaging
                    </label>
                    <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto">
                      {availUnits.map(u => {
                        const isSelected = (editItemUnit || editingLineItem.unit) === u.unit;
                        return (
                          <button
                            key={u.unit}
                            type="button"
                            onClick={() => handleModalUnitChange(u.unit, u.factor)}
                            className={`p-2 rounded-xl text-left border text-xs transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-lime-50/90 dark:bg-lime-950/40 border-lime-600 text-lime-900 dark:text-lime-200 font-bold ring-2 ring-lime-500/20'
                                : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-lime-400'
                            }`}
                          >
                            <div className="flex justify-between items-center">
                              <span className="truncate">{u.unit}</span>
                              {isSelected && <Check size={12} className="text-lime-600 shrink-0" />}
                            </div>
                            <span className="text-[10px] text-slate-400 font-normal block mt-0.5">
                              {u.factor === 1 ? 'Base unit' : `= ${u.factor} ${editingLineItem.base_unit || 'base'}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Quantity */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">Quantity ({editItemUnit || editingLineItem.unit})</label>
                <div className="flex items-center bg-slate-50 rounded-xl border border-slate-200 p-1 focus-within:border-lime-500 focus-within:bg-white">
                  <button
                    type="button"
                    onClick={() => handleEditQtyChange(Math.max(0.1, (parseFloat(editItemQty) || 1) - 1).toString())}
                    className="w-8 h-8 rounded-lg hover:bg-slate-200 text-slate-700 active:scale-90 flex items-center justify-center text-sm font-bold shrink-0"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    step="any"
                    min="0.1"
                    value={editItemQty}
                    onChange={e => handleEditQtyChange(e.target.value)}
                    className="w-full text-center font-bold font-mono text-sm text-slate-900 bg-transparent outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleEditQtyChange(((parseFloat(editItemQty) || 0) + 1).toString())}
                    className="w-8 h-8 rounded-lg hover:bg-slate-200 text-slate-700 active:scale-90 flex items-center justify-center text-sm font-bold shrink-0"
                  >
                    +
                  </button>
                </div>
                {/* Quick Qty Chips */}
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {[1, 2, 5, 10, 25, 50].map(val => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => handleEditQtyChange(val.toString())}
                      className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-lime-100 hover:text-lime-800 text-[10px] font-semibold text-slate-600 transition-colors"
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>

              {/* Unit Rate */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">Purchase Rate (Rs / {editItemUnit || editingLineItem.unit})</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-xs">Rs</span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={editItemRate}
                    onChange={e => handleEditRateChange(e.target.value)}
                    className="w-full h-9 bg-slate-50 focus:bg-white border border-slate-200 rounded-xl pl-8 pr-3 text-sm font-bold font-mono text-slate-900 outline-none focus:border-lime-500"
                  />
                </div>
              </div>

              {/* Line Total (Editable) */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">Total Amount (Rs)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-xs">Rs</span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={editItemTotal}
                    onChange={e => handleEditTotalChange(e.target.value)}
                    className="w-full h-9 bg-slate-50 focus:bg-white border border-slate-200 rounded-xl pl-8 pr-3 text-sm font-bold font-mono text-slate-900 outline-none focus:border-lime-500"
                  />
                </div>
                <span className="text-[10px] text-slate-400 block mt-0.5">Changing total automatically updates quantity.</span>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-between items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  removeLineItem(editingLineItem.tempId);
                  setEditingLineItem(null);
                  showToast(`${editingLineItem.item_name} removed`, 'info');
                }}
                className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 font-bold rounded-xl text-xs flex items-center gap-1 transition-colors"
              >
                <Trash2 size={13} /> Remove
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingLineItem(null)}
                  className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 font-semibold rounded-xl text-xs border border-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditedItem}
                  className="px-4 py-2 bg-lime-600 hover:bg-lime-700 text-white font-bold rounded-xl text-xs transition-colors shadow-xs"
                >
                  Update
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Slide-Over Procurement Audit Drawer */}
      <AnimatePresence>
        {isHistoryOpen && (
          <MotionDiv 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] overflow-hidden flex justify-end"
          >
            <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-xs" onClick={() => toggleHistory(false)} />
            
            <MotionDiv 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-full max-w-md bg-white h-full shadow-2xl z-10 flex flex-col border-l border-slate-200"
            >
              {/* Drawer Header */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white flex justify-between items-center border-b border-slate-200 dark:border-slate-700 shrink-0">
                <div>
                  <h3 className="font-bold text-sm sm:text-base flex items-center gap-2 text-slate-900 dark:text-white">
                    <History size={16} className="text-lime-600 dark:text-lime-400" />
                    {activeTab === PurchaseType.MILK ? 'Milk Intake Log' : 'Supplies Purchase Log'}
                  </h3>
                  <div className="mt-2 flex items-center gap-1">
                    <button type="button" onClick={() => setLogScope('today')} className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${logScope === 'today' ? 'bg-lime-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-500 border border-slate-200 dark:border-slate-700'}`}>Today</button>
                    <button type="button" onClick={() => setLogScope('all')} className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${logScope === 'all' ? 'bg-lime-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-500 border border-slate-200 dark:border-slate-700'}`}>All dates</button>
                  </div>
                </div>
                <button onClick={() => toggleHistory(false)} className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors">
                  <X size={16} />
                </button>
              </div>

              {/* Search filter in drawer */}
              <div className="p-2.5 bg-slate-50 border-b border-slate-200">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search logs by supplier..."
                    value={historySearch}
                    onChange={e => setHistorySearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium outline-none focus:border-lime-500"
                  />
                  {historySearch && (
                    <button onClick={() => setHistorySearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Drawer Body */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {(() => {
                  const baseList = (activeTab === PurchaseType.MILK ? milkHistory : productHistory).filter((entry: any) => {
                    if (logScope !== 'today') return true;
                    return businessDate(entry.date) === todayKey;
                  });
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
                      <div className="p-8 text-center text-slate-400 italic text-xs">
                        No entries matched.
                      </div>
                    );
                  }

                  return displayList.map((entry: any) => {
                    const supplier = suppliers.find(s => s.id === entry.supplier_id);
                    const displayName = supplier ? supplier.name : 'Spot Cash Purchase';
                    const isReturned = entry.status === 'Returned';
                    
                    return (
                      <div key={entry.id} className={`p-3 rounded-lg border transition-all text-xs ${
                        isReturned 
                          ? 'border-red-200 bg-red-50/40 opacity-80' 
                          : 'border-slate-200 bg-white hover:border-lime-400'
                      }`}>
                        <div className="flex justify-between items-start mb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-900">{displayName}</span>
                            {isReturned && (
                              <span className="text-[9px] bg-red-100 text-red-700 px-1 py-0.2 rounded font-bold">
                                Returned
                              </span>
                            )}
                          </div>
                          <span className={`font-bold font-mono ${isReturned ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                            {formatCurrency(entry.total_amount)}
                          </span>
                        </div>

                        <div className="flex justify-between items-end text-slate-500">
                          <div>
                            <p className="font-mono text-slate-400 text-[10px]">{new Date(entry.date).toLocaleDateString()}</p>
                            {activeTab === PurchaseType.MILK ? (
                              <>
                                <p className={`font-medium ${isReturned ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                                  {formatQty(entry.quantity)}L • {entry.milk_type} • {entry.shift}
                                </p>
                                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                  {entry.paid_amount > 0 ? (
                                    <span className="text-[9px] bg-emerald-50 text-emerald-700 px-1.5 py-0.2 rounded font-bold border border-emerald-200">
                                      Paid: {formatCurrency(entry.paid_amount)} ({entry.payment_mode || 'Cash'})
                                    </span>
                                  ) : (
                                    <span className="text-[9px] bg-rose-50 text-rose-700 px-1.5 py-0.2 rounded font-semibold border border-rose-100">
                                      On Khata (Due)
                                    </span>
                                  )}
                                  {entry.due_amount > 0 && entry.paid_amount > 0 && (
                                    <span className="text-[9px] bg-amber-50 text-amber-700 px-1.5 py-0.2 rounded font-semibold border border-amber-200">
                                      Due: {formatCurrency(entry.due_amount)}
                                    </span>
                                  )}
                                </div>
                              </>
                            ) : (
                              <p className={`font-medium ${isReturned ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                                {entry.item_name} ({formatQty(entry.quantity)} {entry.unit})
                              </p>
                            )}
                          </div>

                          {!isReturned && (
                            <button 
                              onClick={() => activeTab === PurchaseType.MILK ? handleOpenReturnMilk(entry) : handleOpenReturnMaterial(entry)}
                              className="px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded text-[10px] font-semibold flex items-center gap-1 transition-all"
                              title="Return to supplier"
                            >
                              <RotateCcw size={11}/> Return
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </MotionDiv>
          </MotionDiv>
        )}
      </AnimatePresence>

      {/* 4. RETURN TO SUPPLIER MODAL */}
      <AnimatePresence>
        {returnModalEntry && (
          <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center z-[100] p-4">
            <MotionDiv
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md overflow-hidden"
            >
              {/* Header */}
              <div className="px-5 py-3.5 border-b bg-slate-50 flex justify-between items-center">
                <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                  <RotateCcw size={15} className="text-amber-600" /> Return to Supplier
                </h3>
                <button onClick={() => setReturnModalEntry(null)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
                  <X size={16} />
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleConfirmReturnPurchase} className="p-4 sm:p-5 space-y-3">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Supplier:</span>
                    <span className="font-semibold text-slate-900">
                      {suppliers.find(s => s.id === returnModalEntry.supplier_id)?.name || 'Spot Vendor'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Original Qty:</span>
                    <span className="font-semibold text-slate-900">
                      {returnModalType === 'milk' 
                        ? `${formatQty(returnModalEntry.quantity)} L (${returnModalEntry.milk_type})` 
                        : `${formatQty(returnModalEntry.quantity)} ${returnModalEntry.unit}`}
                    </span>
                  </div>
                </div>

                {/* Return Quantity */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className={labelClass}>Return Quantity *</label>
                    <span className="text-[11px] font-semibold text-slate-500">
                      Max: <strong className="font-mono text-lime-700">{formatQty(maxReturnQty)}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="0.1"
                      max={maxReturnQty}
                      step="any"
                      required
                      className={`${inputClass} font-bold font-mono`}
                      value={returnQty}
                      onChange={e => setReturnQty(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setReturnQty(maxReturnQty)}
                      className="h-9 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg whitespace-nowrap"
                    >
                      Full
                    </button>
                  </div>
                </div>

                {/* Reason */}
                <div>
                  <label className={labelClass}>Reason *</label>
                  <select
                    className={inputClass}
                    value={returnReason}
                    onChange={e => setReturnReason(e.target.value)}
                  >
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
                </div>

                {returnReason === 'Other' && (
                  <div>
                    <input
                      type="text"
                      required
                      placeholder="Specify reason..."
                      className={inputClass}
                      value={customReturnReason}
                      onChange={e => setCustomReturnReason(e.target.value)}
                    />
                  </div>
                )}

                {/* Buttons */}
                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setReturnModalEntry(null)}
                    className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isProcessingReturn}
                    className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg text-xs shadow-sm flex items-center justify-center gap-1 cursor-pointer"
                  >
                    {isProcessingReturn ? (
                      <>
                        <Loader2 size={14} className="animate-spin" /> Processing...
                      </>
                    ) : (
                      'Confirm Return'
                    )}
                  </button>
                </div>
              </form>
            </MotionDiv>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};

export default Purchase;
