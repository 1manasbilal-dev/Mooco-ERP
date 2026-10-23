import React, { useState, useMemo, useRef, useEffect, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { ExpenseEntry, ExpenseVendor, SavedExpense } from '../types';
import {
  FolderTree, Wallet, CreditCard, Plus, Bookmark, UserPlus, ArrowUpRight
} from 'lucide-react';
import { ExpensesHeader, dayKey, paidOf, pkToday } from '../components/expenses/ExpenseUI';
import { Button } from '../components/ui';
import { RichSelectOption } from '../components/RichSelect';
import {
  CategoryStructure, SubcategoryStructure, LedgerRow,
  DEFAULT_EXPENSE_STRUCTURE, ExpenseDateFilterMode, KhataDateRangeType
} from '../components/expenses/ExpenseTypes';
import { ExpenseStats, ExpenseTransactionsTab } from '../components/expenses/ExpenseTransactionsTab';
import { ExpenseVendorsTab } from '../components/expenses/ExpenseVendorsTab';
import { inRange, periodRange, previousPeriod } from '../components/expenses/expensePeriods';
import { formatCurrency } from '../lib/formatters';
import { confirmAction } from '../components/ui/ConfirmDialog';

// The dialogs (~1,200 lines) load in their own chunk: prefetched once the screen is idle and
// mounted only while open, so they are not part of the screen's first paint.
const loadExpenseModals = () => import('../components/expenses/ExpenseModals');
const ExpenseCategoryModal = lazy(() => loadExpenseModals().then(m => ({ default: m.ExpenseCategoryModal })));
const ExpenseFormModal = lazy(() => loadExpenseModals().then(m => ({ default: m.ExpenseFormModal })));
const SavedExpensesModal = lazy(() => loadExpenseModals().then(m => ({ default: m.SavedExpensesModal })));
const ExpenseVendorModal = lazy(() => loadExpenseModals().then(m => ({ default: m.ExpenseVendorModal })));
const VendorPaymentModal = lazy(() => loadExpenseModals().then(m => ({ default: m.VendorPaymentModal })));

const Expenses: React.FC = () => {
  const { 
    expenses, expenseVendors, expenseVendorTransactions,
    addExpense, updateExpense, 
    addExpenseVendor, updateExpenseVendor, deleteExpenseVendor, 
    recordExpenseVendorPayment, deleteExpenseVendorTransaction,
    manualAccounts, addManualAccount, deleteManualAccount, updateManualAccount,
    accounts, settings, updateSettings, canPerform,
    getDeleteAssessment, safeDeleteExpense, isDayLocked
  } = useDairy();
  
  const { showToast } = useToast();

  const canCreate = canPerform('expenses', 'create');
  const canDelete = canPerform('expenses', 'delete');
  const canEdit = canPerform('expenses', 'edit');
  const location = useLocation();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'transactions' | 'vendors'>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tab') === 'vendors' ? 'vendors' : 'transactions';
  });

  const [editingVendor, setEditingVendor] = useState<ExpenseVendor | null>(null);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('vendorId') || null;
  });
  const [isMobileLedgerOpen, setIsMobileLedgerOpen] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return Boolean(params.get('vendorId'));
  });
  const [showMobileVendorInfo, setShowMobileVendorInfo] = useState(false);
  const [, setSelectedPaymentVendor] = useState<ExpenseVendor | null>(null);

  const switchTab = (tab: 'transactions' | 'vendors') => {
    setActiveTab(tab);
    setIsMobileLedgerOpen(false);
    setSearchTerm('');
    if (tab === 'vendors') {
      const q = selectedVendorId ? `?tab=vendors&vendorId=${encodeURIComponent(selectedVendorId)}` : '?tab=vendors';
      navigate(`/expenses${q}`);
    } else {
      navigate('/expenses?tab=transactions');
    }
  };

  const selectVendor = (vendorId: string | null) => {
    setSelectedVendorId(vendorId);
    if (vendorId) {
      setIsMobileLedgerOpen(true);
      navigate(`/expenses?tab=vendors&vendorId=${encodeURIComponent(vendorId)}`);
    } else {
      setIsMobileLedgerOpen(false);
      navigate('/expenses?tab=vendors');
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    if (tabParam === 'vendors' || tabParam === 'transactions') {
      setActiveTab(tabParam);
    }
    const vId = params.get('vendorId');
    setSelectedVendorId(vId || null);
    if (vId) {
      setIsMobileLedgerOpen(true);
    }
  }, [location.search]);

  // Warm the dialogs chunk while the screen is idle, so the first "Record expense" opens at once.
  useEffect(() => {
    const prefetch = () => { loadExpenseModals().catch(() => { /* opening a dialog loads it again */ }); };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(prefetch, { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(prefetch, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  const [isAddMode, setIsAddMode] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [isSubmittingVendor, setIsSubmittingVendor] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [isSavedExpensesOpen, setIsSavedExpensesOpen] = useState(false);
  const [rememberExpense, setRememberExpense] = useState(false);
  const [rememberName, setRememberName] = useState('');
  const [isTxFilterOpen, setIsTxFilterOpen] = useState(false);
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterVendor, setFilterVendor] = useState('All');
  const [filterPaymentStatus, setFilterPaymentStatus] = useState('All');
  const [filterVendorTabStatus, setFilterVendorTabStatus] = useState<'All' | 'With Dues' | 'Advance' | 'Active' | 'Inactive'>('All');
  // Pakistan month: a UTC slice showed last month between 00:00 and 05:00 on the 1st.
  const [filterMonth, setFilterMonth] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }).slice(0, 7));
  const [dateFilterMode, setDateFilterMode] = useState<ExpenseDateFilterMode>('this_month');
  const [filterSingleDate, setFilterSingleDate] = useState<string>(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }));
  const [filterStartDate, setFilterStartDate] = useState<string>(() => `${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }).slice(0, 7)}-01`);
  const [filterEndDate, setFilterEndDate] = useState<string>(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }));
  const [expandedExpenseRowId, setExpandedExpenseRowId] = useState<string | null>(null);

  const [khataDateRange, setKhataDateRange] = useState<KhataDateRangeType>('this_month');
  const [khataStartDate, setKhataStartDate] = useState('');
  const [khataEndDate, setKhataEndDate] = useState('');

  const [formData, setFormData] = useState<Partial<ExpenseEntry> & { 
    paymentStatus: 'Paid' | 'Partial' | 'Unpaid';
    account_id?: string;
    dueDate?: string;
  }>({
    date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
    category: '', 
    subcategory: '',
    description: '', 
    vendor_id: '', 
    amount: 0, 
    paidAmount: 0, 
    paymentStatus: 'Paid',
    dueDate: '',
    paymentMode: 'Cash', 
    account_id: settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id || accounts[0]?.id || '',
    notes: ''
  });

  const [vendorFormData, setVendorFormData] = useState<Partial<ExpenseVendor>>({
    name: '', 
    service_type: 'Other', 
    contact_person: '',
    phone: '', 
    address: '', 
    opening_balance: 0,
    bank_name: '',
    account_number: '',
    iban: '',
    notes: '', 
    isActive: true
  });

  const [paymentFormData, setPaymentFormData] = useState<{
    type: 'payment' | 'refund';
    vendor_id: string;
    amount: string | number;
    date: string;
    mode: string;
    account_id: string;
    reference_no: string;
    note: string;
  }>({
    type: 'payment',
    vendor_id: '',
    amount: '',
    date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
    mode: 'Cash',
    account_id: settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id || accounts[0]?.id || '',
    reference_no: '',
    note: ''
  });

  const [isModalCreatingCat, setIsModalCreatingCat] = useState(false);
  const [modalNewCatInput, setModalNewCatInput] = useState('');
  const [isModalCreatingSub, setIsModalCreatingSub] = useState(false);
  const [modalNewSubInput, setModalNewSubInput] = useState('');
  const [isModalCreatingVendor, setIsModalCreatingVendor] = useState(false);
  const [quickVendorName, setQuickVendorName] = useState('');
  const [quickVendorPhone, setQuickVendorPhone] = useState('');

  const [modalNewCategoryName, setModalNewCategoryName] = useState('');
  const [isModalCreatingMainCat, setIsModalCreatingMainCat] = useState(false);
  const [modalCatFilter, setModalCatFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [newSubcatInputs, setNewSubcatInputs] = useState<Record<string, string>>({});
  const [categorySearch, setCategorySearch] = useState('');
  const [expandedCatsInModal, setExpandedCatsInModal] = useState<Record<string, boolean>>({});

  const [editingCatName, setEditingCatName] = useState<string | null>(null);
  const [editCatInput, setEditCatInput] = useState('');
  const [editingSubcatKey, setEditingSubcatKey] = useState<string | null>(null);
  const [editSubcatInput, setEditSubcatInput] = useState('');

  const inactiveCats = useMemo(() => settings.expenses?.inactiveCategories || [], [settings.expenses]);
  const inactiveSubcats = useMemo(() => settings.expenses?.inactiveSubcategories || [], [settings.expenses]);
  const deletedCats = useMemo(() => settings.expenses?.deletedCategories || [], [settings.expenses]);
  const deletedSubcats = useMemo(() => settings.expenses?.deletedSubcategories || [], [settings.expenses]);
  const renamedCats = useMemo(() => settings.expenses?.renamedCategories || {}, [settings.expenses]);
  const renamedSubcats = useMemo(() => settings.expenses?.renamedSubcategories || {}, [settings.expenses]);

  const categoryTree = useMemo<CategoryStructure[]>(() => {
    const map: Record<string, CategoryStructure> = {};

    Object.entries(DEFAULT_EXPENSE_STRUCTURE).forEach(([defaultCatName, subcats]) => {
      const catName = renamedCats[defaultCatName] || defaultCatName;
      if (deletedCats.includes(defaultCatName) || deletedCats.includes(catName)) {
        return;
      }

      const isCatActive = !inactiveCats.includes(catName) && !inactiveCats.includes(defaultCatName);

      const filteredSubs: SubcategoryStructure[] = [];
      subcats.forEach(defaultSub => {
        const subKey = `${defaultCatName}::${defaultSub}`;
        const renSubKey = `${catName}::${defaultSub}`;
        const subName = renamedSubcats[subKey] || renamedSubcats[renSubKey] || defaultSub;

        if (
          deletedSubcats.includes(subKey) || 
          deletedSubcats.includes(`${catName}::${subName}`) || 
          deletedSubcats.includes(`${defaultCatName}::${subName}`)
        ) {
          return;
        }

        const isSubActive = isCatActive && !inactiveSubcats.includes(subKey) && !inactiveSubcats.includes(`${catName}::${subName}`);
        filteredSubs.push({
          name: subName,
          originalName: defaultSub,
          isCustom: false,
          isActive: isSubActive
        });
      });

      map[catName] = {
        name: catName,
        originalName: defaultCatName,
        isCustom: false,
        isActive: isCatActive,
        subcategories: filteredSubs
      };
    });

    const expenseManualAccounts = manualAccounts.filter(a => a.type === 'Expense');
    const rootManuals = expenseManualAccounts.filter(a => !a.parentId);
    const childManuals = expenseManualAccounts.filter(a => !!a.parentId);

    rootManuals.forEach(root => {
      const isDeleted = deletedCats.includes(root.name) || (root.id && deletedCats.includes(root.id));
      if (isDeleted) return;

      const isCatActive = root.isActive !== false && !inactiveCats.includes(root.name) && (!root.id || !inactiveCats.includes(root.id));

      if (!map[root.name]) {
        map[root.name] = {
          name: root.name,
          isCustom: true,
          accountId: root.id,
          isActive: isCatActive,
          subcategories: []
        };
      } else {
        map[root.name].accountId = root.id;
        map[root.name].isActive = isCatActive;
      }
    });

    childManuals.forEach(child => {
      const parent = manualAccounts.find(p => p.id === child.parentId);
      if (!parent) return;

      const parentName = parent.name;
      const subKey = `${parentName}::${child.name}`;
      const isSubDeleted = deletedSubcats.includes(subKey) || (child.id && deletedSubcats.includes(child.id));
      if (isSubDeleted) return;

      const isSubActive = child.isActive !== false && !inactiveSubcats.includes(subKey) && (!child.id || !inactiveSubcats.includes(child.id));

      if (map[parentName]) {
        const existingIdx = map[parentName].subcategories.findIndex(s => s.name.toLowerCase() === child.name.toLowerCase());
        if (existingIdx >= 0) {
          map[parentName].subcategories[existingIdx].accountId = child.id;
          map[parentName].subcategories[existingIdx].isActive = isSubActive && map[parentName].isActive;
        } else {
          map[parentName].subcategories.push({
            name: child.name,
            isCustom: true,
            accountId: child.id,
            isActive: isSubActive && map[parentName].isActive
          });
        }
      }
    });

    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [manualAccounts, inactiveCats, inactiveSubcats, deletedCats, deletedSubcats, renamedCats, renamedSubcats]);

  const activeCategoryList = useMemo(() => {
    return categoryTree.filter(c => c.isActive);
  }, [categoryTree]);

  const activeCategoryNames = useMemo(() => {
    return activeCategoryList.map(c => c.name);
  }, [activeCategoryList]);

  const activeSubcategoryList = useMemo(() => {
    if (!formData.category) return [];
    const foundCat = categoryTree.find(c => c.name.toLowerCase() === formData.category?.toLowerCase());
    if (!foundCat) return [];
    return foundCat.subcategories.filter(s => s.isActive);
  }, [categoryTree, formData.category]);

  const selectedPaymentAccount = useMemo(() => {
    return accounts.find(a => a.id === formData.account_id) || accounts[0];
  }, [accounts, formData.account_id]);

  const selectedDirectPaymentAccount = useMemo(() => {
    return accounts.find(a => a.id === paymentFormData.account_id) || accounts[0];
  }, [accounts, paymentFormData.account_id]);

  // Entries per category and per category::sub-category, counted once instead of per row of the dialog.
  const categoryUsage = useMemo(() => {
    const byCategory = new Map<string, number>();
    const bySub = new Map<string, number>();
    expenses.forEach(e => {
      const cat = (e.category || '').toLowerCase();
      if (!cat) return;
      byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
      if (e.subcategory) {
        const key = `${cat}::${e.subcategory.toLowerCase()}`;
        bySub.set(key, (bySub.get(key) || 0) + 1);
      }
    });
    return { byCategory, bySub };
  }, [expenses]);

  // Renaming a category does not rewrite past entries: they keep the old name. Counting only the
  // new name let a renamed category with entries pass the delete guard ("no entries") and hid
  // its old entries from the category filter. Lower-cased current name -> every name it has had.
  const categoryNames = useMemo(() => {
    const finalName = (name: string) => {
      let current = name;
      const seen = new Set<string>();
      while (renamedCats[current] && !seen.has(current)) { seen.add(current); current = renamedCats[current]; }
      return current;
    };
    const names = new Map<string, Set<string>>();
    const add = (target: string, alias: string) => {
      const key = target.toLowerCase();
      if (!names.has(key)) names.set(key, new Set([key]));
      names.get(key)!.add(alias.toLowerCase());
    };
    categoryTree.forEach(c => { add(c.name, c.name); if (c.originalName) add(c.name, c.originalName); });
    Object.keys(renamedCats).forEach(from => add(finalName(from), from));
    return names;
  }, [categoryTree, renamedCats]);

  const namesOfCategory = (name: string) => categoryNames.get(name.toLowerCase()) || new Set([name.toLowerCase()]);

  const getCategoryUsageCount = (catName: string) => {
    let count = 0;
    namesOfCategory(catName).forEach(name => { count += categoryUsage.byCategory.get(name) || 0; });
    return count;
  };

  const getSubcategoryUsageCount = (catName: string, subcatName: string) => {
    const cats = namesOfCategory(catName);
    const subs = new Set([subcatName.toLowerCase()]);
    const original = categoryTree.find(c => c.name === catName)?.subcategories.find(s => s.name === subcatName)?.originalName;
    if (original) subs.add(original.toLowerCase());
    Object.entries(renamedSubcats as Record<string, string>).forEach(([key, to]) => {
      const [fromCat, ...fromSub] = key.split('::');
      if (String(to).toLowerCase() === subcatName.toLowerCase() && cats.has(fromCat.toLowerCase())) subs.add(fromSub.join('::').toLowerCase());
    });
    let count = 0;
    cats.forEach(cat => subs.forEach(sub => { count += categoryUsage.bySub.get(`${cat}::${sub}`) || 0; }));
    return count;
  };

  // Day key and lower-cased search text per expense, worked out once per data change, not per keystroke.
  const indexedExpenses = useMemo(() => expenses.map(exp => ({
    exp,
    day: dayKey(exp.date),
    text: [exp.description, exp.vendor_name, exp.category, exp.subcategory, exp.notes, exp.referenceNo]
      .filter(Boolean).join(' ').toLowerCase(),
  })), [expenses]);

  const today = pkToday();
  const periodInput = useMemo(() => ({
    mode: dateFilterMode, today, month: filterMonth, singleDate: filterSingleDate, startDate: filterStartDate, endDate: filterEndDate,
  }), [dateFilterMode, today, filterMonth, filterSingleDate, filterStartDate, filterEndDate]);

  const { filteredExpenses, previousTotal, previousLabel } = useMemo(() => {
    // Every comparison uses the Pakistan business day, for the filter edges and the expense alike.
    const range = periodRange(periodInput);
    const previous = previousPeriod(periodInput);
    const needle = searchTerm.trim().toLowerCase();
    const categoryFilter = filterCategory === 'All' ? null : (categoryNames.get(filterCategory.toLowerCase()) || new Set([filterCategory.toLowerCase()]));
    const matches = (exp: ExpenseEntry, text: string) =>
      (!needle || text.includes(needle)) &&
      (!categoryFilter || categoryFilter.has((exp.category || '').toLowerCase())) &&
      (filterVendor === 'All' || exp.vendor_id === filterVendor) &&
      (filterPaymentStatus === 'All' || (exp.paymentStatus || 'Paid') === filterPaymentStatus);

    const list: ExpenseEntry[] = [];
    let prevTotal = 0;
    indexedExpenses.forEach(({ exp, day, text }) => {
      const inCurrent = inRange(day, range);
      const inPrevious = previous ? inRange(day, previous.range) : false;
      if (!inCurrent && !inPrevious) return;
      if (!matches(exp, text)) return;
      if (inCurrent) list.push(exp);
      if (inPrevious) prevTotal += Number(exp.amount || 0);
    });
    return { filteredExpenses: list, previousTotal: previous ? prevTotal : null, previousLabel: previous?.label };
  }, [indexedExpenses, periodInput, searchTerm, filterCategory, categoryNames, filterVendor, filterPaymentStatus]);

  // Billed / paid per vendor in one pass over expenses and vendor payments (was one pass per vendor).
  const vendorsWithTotals = useMemo(() => {
    const idsByName = new Map<string, string[]>();
    expenseVendors.forEach(v => {
      const key = v.name.toLowerCase();
      idsByName.set(key, [...(idsByName.get(key) || []), v.id]);
    });
    const totals = new Map<string, { billed: number; paid: number; direct: number }>();
    const bucket = (id: string) => {
      let entry = totals.get(id);
      if (!entry) { entry = { billed: 0, paid: 0, direct: 0 }; totals.set(id, entry); }
      return entry;
    };
    expenses.forEach(e => {
      // Same match as the khata: the vendor id, or (older rows) the vendor's name.
      const ids = new Set<string>();
      if (e.vendor_id) ids.add(e.vendor_id);
      if (e.vendor_name) (idsByName.get(e.vendor_name.toLowerCase()) || []).forEach(id => ids.add(id));
      if (!ids.size) return;
      const billed = e.amount || 0;
      const paid = paidOf(e);
      ids.forEach(id => { const entry = bucket(id); entry.billed += billed; entry.paid += paid; });
    });
    expenseVendorTransactions.forEach(t => {
      if (t.type === 'Payment') bucket(t.vendor_id).direct += t.amount || 0;
      else if (t.type === 'Refund') bucket(t.vendor_id).direct -= t.amount || 0;
    });

    return expenseVendors.map(v => {
      const entry = totals.get(v.id);
      const liveTotalBilled = entry?.billed || 0;
      const totalPaidCalc = Math.max(0, (entry?.paid || 0) + (entry?.direct || 0));
      return {
        ...v,
        total_billed: liveTotalBilled > 0 ? liveTotalBilled : (v.total_billed || 0),
        total_paid: totalPaidCalc > 0 ? totalPaidCalc : (v.total_paid || 0),
        pending_balance: v.pending_balance !== undefined ? v.pending_balance : 0
      };
    });
  }, [expenseVendors, expenses, expenseVendorTransactions]);

  const filteredVendors = useMemo(() => {
    const needle = searchTerm.toLowerCase();
    return vendorsWithTotals.filter(v => {
      const matchesSearch =
        v.name.toLowerCase().includes(needle) ||
        (v.service_type && v.service_type.toLowerCase().includes(needle)) ||
        (v.phone && v.phone.includes(searchTerm)) ||
        (v.contact_person && v.contact_person.toLowerCase().includes(needle));

      if (!matchesSearch) return false;

      if (filterVendorTabStatus === 'Active') return v.isActive !== false;
      if (filterVendorTabStatus === 'Inactive') return v.isActive === false;
      if (filterVendorTabStatus === 'With Dues') return (v.pending_balance || 0) > 0;
      if (filterVendorTabStatus === 'Advance') return (v.pending_balance || 0) < 0;
      return true;
    });
  }, [vendorsWithTotals, searchTerm, filterVendorTabStatus]);

  const selectedVendor = useMemo(() => {
    if (selectedVendorId) {
      const found = vendorsWithTotals.find(v => v.id === selectedVendorId);
      if (found) return found;
    }
    // Nothing picked yet: open the vendor we owe the most, matching the list's default order.
    return [...filteredVendors].sort((a, b) => (b.pending_balance || 0) - (a.pending_balance || 0) || a.name.localeCompare(b.name))[0];
  }, [selectedVendorId, filteredVendors, vendorsWithTotals]);

  // Every vendor we owe, inactive ones too: switching a vendor off does not settle its dues. This
  // tile left them out while the vendors tab and the Reports balance sheet count them.
  const totalOutstandingVendorDues = useMemo(() => {
    return expenseVendors.reduce((sum, v) => sum + Math.max(0, v.pending_balance || 0), 0);
  }, [expenseVendors]);

  const vendorsWithDuesCount = useMemo(() => expenseVendors.filter(v => (v.pending_balance || 0) > 0).length, [expenseVendors]);

  const expenseStats = useMemo<ExpenseStats>(() => {
    let total = 0, paid = 0, cash = 0, onCredit = 0;
    filteredExpenses.forEach(e => {
      const amount = Number(e.amount || 0);
      const paidPart = paidOf(e);
      total += amount;
      paid += paidPart;
      if ((e.paymentMode || (e as any).payment_mode) === 'Cash') cash += paidPart;
      onCredit += Math.max(0, amount - paidPart);
    });
    return {
      total,
      cash,
      digital: paid - cash,
      onCredit,
      vendorDues: totalOutstandingVendorDues,
      vendorDueCount: vendorsWithDuesCount,
      trend: previousTotal && previousTotal > 0 ? ((total - previousTotal) / previousTotal) * 100 : null,
      trendLabel: previousTotal && previousTotal > 0 ? previousLabel : undefined,
    };
  }, [filteredExpenses, totalOutstandingVendorDues, vendorsWithDuesCount, previousTotal, previousLabel]);
  const totalExpense = expenseStats.total;

  const vendorRichOptions: RichSelectOption[] = useMemo(() => {
    return expenseVendors.filter(v => v.isActive !== false).map(v => {
      const bal = v.pending_balance || 0;
      return {
        value: v.id,
        label: v.name,
        subLabel: v.service_type || 'Vendor/Staff',
        badge: bal !== 0 ? {
          text: `${formatCurrency(Math.abs(bal))} ${bal > 0 ? 'Due' : 'Advance'}`,
          variant: bal > 0 ? 'red' : 'green'
        } : {
          text: 'Cleared',
          variant: 'slate'
        },
        avatarLetter: v.name.charAt(0).toUpperCase(),
        avatarBg: bal > 0 ? 'bg-danger-soft text-danger-fg' : 'bg-brand-soft text-brand-fg'
      };
    });
  }, [expenseVendors]);

  const accountRichOptions: RichSelectOption[] = useMemo(() => {
    return accounts.filter(a => a.isActive !== false).map(a => ({
      value: a.id,
      label: a.name,
      subLabel: a.type,
      badge: {
        text: `${formatCurrency(a.balance)}`,
        variant: a.balance >= 0 ? 'slate' : 'red'
      },
      icon: a.type === 'Cash' ? <Wallet size={15} /> : <CreditCard size={15} />
    }));
  }, [accounts]);

  const categoryRichOptions: RichSelectOption[] = useMemo(() => {
    return activeCategoryNames.map(cat => ({
      value: cat,
      label: cat,
      icon: <FolderTree size={14} />
    }));
  }, [activeCategoryNames]);

  const handleToggleCategoryActive = async (cat: CategoryStructure) => {
    const newStatus = !cat.isActive;
    let updatedInactiveCats = [...inactiveCats];

    if (!newStatus) {
      if (!updatedInactiveCats.includes(cat.name)) {
        updatedInactiveCats.push(cat.name);
      }
    } else {
      updatedInactiveCats = updatedInactiveCats.filter(name => name !== cat.name);
    }

    if (cat.accountId) {
      await updateManualAccount(cat.accountId, { isActive: newStatus });
    }

    await updateSettings({
      expenses: {
        ...(settings.expenses || {}),
        inactiveCategories: updatedInactiveCats
      }
    });

    showToast(`Category "${cat.name}" ab ${newStatus ? 'Active' : 'Inactive'} hai`, newStatus ? 'success' : 'info');
  };

  const handleToggleSubcategoryActive = async (parentCatName: string, sub: SubcategoryStructure) => {
    const key = `${parentCatName}::${sub.name}`;
    const newStatus = !sub.isActive;
    let updatedInactiveSubcats = [...inactiveSubcats];

    if (!newStatus) {
      if (!updatedInactiveSubcats.includes(key)) {
        updatedInactiveSubcats.push(key);
      }
    } else {
      updatedInactiveSubcats = updatedInactiveSubcats.filter(k => k !== key);
    }

    if (sub.accountId) {
      await updateManualAccount(sub.accountId, { isActive: newStatus });
    }

    await updateSettings({
      expenses: {
        ...(settings.expenses || {}),
        inactiveSubcategories: updatedInactiveSubcats
      }
    });

    showToast(`Sub-category "${sub.name}" ab ${newStatus ? 'Active' : 'Inactive'} hai`, newStatus ? 'success' : 'info');
  };

  // One category write at a time: a double Enter created the same category or sub-category twice,
  // because the duplicate check reads the list before the first save has reached it.
  const categoryWriteRef = useRef(false);

  const handleCreateMainCategory = async (name: string): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed) {
      showToast("Category ka naam likhein", "warning");
      return null;
    }

    if (categoryTree.some(c => c.name.toLowerCase() === trimmed.toLowerCase())) {
      showToast(`Category "${trimmed}" pehle se mojood hai`, "info");
      return trimmed;
    }

    if (categoryWriteRef.current) return null;
    categoryWriteRef.current = true;
    try {
      const success = await addManualAccount({
        name: trimmed,
        type: 'Expense',
        balance: 0,
        description: 'Parent Expense Category',
        isActive: true
      });

      if (success) {
        showToast(`Category "${trimmed}" ban gayi`, 'success');
        return trimmed;
      }
      showToast("Category save nahi hui, dobara koshish karein", "error");
      return null;
    } finally {
      categoryWriteRef.current = false;
    }
  };

  const handleCreateSubcategory = async (parentCatName: string, subcatName: string): Promise<string | null> => {
    const trimmedSub = subcatName.trim();
    if (!trimmedSub) {
      showToast("Sub-category ka naam likhein", "warning");
      return null;
    }

    // Adding a name that already exists created a second ledger account with the same name.
    const existing = categoryTree
      .find(c => c.name.toLowerCase() === parentCatName.toLowerCase())
      ?.subcategories.find(s => s.name.toLowerCase() === trimmedSub.toLowerCase());
    if (existing) {
      showToast(`Sub-category "${existing.name}" pehle se "${parentCatName}" mein mojood hai`, "info");
      return existing.name;
    }

    if (categoryWriteRef.current) return null;
    categoryWriteRef.current = true;
    try {
      const parentAcc = manualAccounts.find(a => a.type === 'Expense' && a.name.toLowerCase() === parentCatName.toLowerCase() && !a.parentId);
      let parentId = parentAcc?.id;

      if (!parentId) {
        const generatedId = `ma_${Date.now()}_root`;
        const rootSaved = await addManualAccount({
          id: generatedId,
          name: parentCatName,
          type: 'Expense',
          balance: 0,
          description: 'Parent Expense Category',
          isActive: true
        });
        // Without its parent account the sub-category would be saved but never shown.
        if (!rootSaved) {
          showToast("Sub-category save nahi hui", "error");
          return null;
        }
        parentId = generatedId;
      }

      const success = await addManualAccount({
        name: trimmedSub,
        type: 'Expense',
        balance: 0,
        parentId: parentId,
        description: `Sub-category under ${parentCatName}`,
        isActive: true
      });

      if (success) {
        showToast(`Sub-category "${trimmedSub}" "${parentCatName}" ke neeche add ho gayi`, 'success');
        return trimmedSub;
      }
      showToast("Sub-category save nahi hui", "error");
      return null;
    } finally {
      categoryWriteRef.current = false;
    }
  };

  /** Resolves to false when nothing was saved, so the dialog keeps the typed name open. */
  const handleModalAddCategory = async (e: React.FormEvent): Promise<boolean> => {
    e.preventDefault();
    if (!modalNewCategoryName.trim()) return false;
    const res = await handleCreateMainCategory(modalNewCategoryName);
    if (res) {
      setModalNewCategoryName('');
      return true;
    }
    return false;
  };

  const handleModalAddSubcat = async (parentCatName: string) => {
    const subName = newSubcatInputs[parentCatName];
    if (!subName || !subName.trim()) return;
    const res = await handleCreateSubcategory(parentCatName, subName);
    if (res) {
      setNewSubcatInputs(prev => ({ ...prev, [parentCatName]: '' }));
    }
  };

  const handleStartEditCategory = (cat: CategoryStructure) => {
    setEditingCatName(cat.name);
    setEditCatInput(cat.name);
  };

  const handleSaveEditCategory = async (cat: CategoryStructure) => {
    const trimmed = editCatInput.trim();
    if (!trimmed || trimmed === cat.name) {
      setEditingCatName(null);
      return;
    }

    if (categoryTree.some(c => c.name.toLowerCase() === trimmed.toLowerCase() && c.name !== cat.name)) {
      showToast(`Category "${trimmed}" pehle se mojood hai`, "warning");
      return;
    }

    if (cat.accountId) {
      await updateManualAccount(cat.accountId, { name: trimmed });
    }

    const currentRenamed = { ...(settings.expenses?.renamedCategories || {}) };
    currentRenamed[cat.name] = trimmed;
    if (cat.originalName) {
      currentRenamed[cat.originalName] = trimmed;
    }

    await updateSettings({
      expenses: {
        ...(settings.expenses || {}),
        renamedCategories: currentRenamed
      }
    });

    setEditingCatName(null);
    showToast(`Category ka naya naam "${trimmed}"`, 'success');
  };

  const handleStartEditSubcategory = (parentCatName: string, sub: SubcategoryStructure) => {
    setEditingSubcatKey(`${parentCatName}::${sub.name}`);
    setEditSubcatInput(sub.name);
  };

  const handleSaveEditSubcategory = async (parentCatName: string, sub: SubcategoryStructure) => {
    const trimmed = editSubcatInput.trim();
    if (!trimmed || trimmed === sub.name) {
      setEditingSubcatKey(null);
      return;
    }

    if (sub.accountId) {
      await updateManualAccount(sub.accountId, { name: trimmed });
    }

    const currentRenamedSubs = { ...(settings.expenses?.renamedSubcategories || {}) };
    currentRenamedSubs[`${parentCatName}::${sub.name}`] = trimmed;
    if (sub.originalName) {
      currentRenamedSubs[`${parentCatName}::${sub.originalName}`] = trimmed;
    }

    await updateSettings({
      expenses: {
        ...(settings.expenses || {}),
        renamedSubcategories: currentRenamedSubs
      }
    });

    setEditingSubcatKey(null);
    showToast(`Sub-category ka naya naam "${trimmed}"`, 'success');
  };

  const handleDeleteCategory = async (cat: CategoryStructure) => {
    const usageCount = getCategoryUsageCount(cat.name);
    if (usageCount > 0) {
      showToast(`"${cat.name}" delete nahi ho sakti: is mein ${usageCount} transaction(s) record hain`, "warning");
      return;
    }

    const ok = await confirmAction({
      title: `Category "${cat.name}" delete karein?`,
      message: 'Is category mein koi kharcha record nahi hai.',
      consequences: ['Category aur us ka ledger account list se hat jayenge.', 'Naye kharche mein yeh category nazar nahi aayegi.'],
    });
    if (ok) {
      if (cat.accountId) {
        await deleteManualAccount(cat.accountId);
      }

      const newDeletedCats = [...(settings.expenses?.deletedCategories || [])];
      if (!newDeletedCats.includes(cat.name)) newDeletedCats.push(cat.name);
      if (cat.originalName && !newDeletedCats.includes(cat.originalName)) newDeletedCats.push(cat.originalName);

      await updateSettings({
        expenses: {
          ...(settings.expenses || {}),
          deletedCategories: newDeletedCats
        }
      });

      showToast(`Category "${cat.name}" delete ho gayi`, 'info');
    }
  };

  const handleDeleteSubcategory = async (parentCatName: string, sub: SubcategoryStructure) => {
    const subUsage = getSubcategoryUsageCount(parentCatName, sub.name);
    if (subUsage > 0) {
      showToast(`"${sub.name}" delete nahi ho sakti: is mein ${subUsage} transaction(s) record hain`, "warning");
      return;
    }

    const ok = await confirmAction({
      title: `Sub-category "${sub.name}" delete karein?`,
      message: `"${parentCatName}" ke neeche is sub-category mein koi kharcha record nahi hai.`,
      consequences: ['Sub-category aur us ka ledger account list se hat jayenge.'],
    });
    if (ok) {
      if (sub.accountId) {
        await deleteManualAccount(sub.accountId);
      }

      const key = `${parentCatName}::${sub.name}`;
      const newDeletedSubcats = [...(settings.expenses?.deletedSubcategories || [])];
      if (!newDeletedSubcats.includes(key)) newDeletedSubcats.push(key);
      if (sub.originalName) {
        const origKey = `${parentCatName}::${sub.originalName}`;
        if (!newDeletedSubcats.includes(origKey)) newDeletedSubcats.push(origKey);
      }

      await updateSettings({
        expenses: {
          ...(settings.expenses || {}),
          deletedSubcategories: newDeletedSubcats
        }
      });

      showToast(`Sub-category "${sub.name}" delete ho gayi`, 'info');
    }
  };

  const openExpenseForm = (overrides: Partial<typeof formData> = {}) => {
    setEditingExpenseId(null);
    const defaultAcc = settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id || accounts[0]?.id || '';
    setFormData({
      date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
      category: '',
      subcategory: '',
      description: '',
      vendor_id: '',
      amount: 0,
      paidAmount: 0,
      paymentStatus: 'Paid',
      dueDate: '',
      paymentMode: 'Cash',
      account_id: defaultAcc,
      notes: '',
      ...overrides
    });
    setIsModalCreatingCat(false);
    setModalNewCatInput('');
    setIsModalCreatingSub(false);
    setModalNewSubInput('');
    setIsModalCreatingVendor(false);
    setQuickVendorName('');
    setQuickVendorPhone('');
    setRememberExpense(false);
    setRememberName('');
    setIsAddMode(true);
  };

  const handleOpenAddModal = () => openExpenseForm();

  // A vendor's bill usually arrives before it is paid, so it opens on credit.
  const handleRecordVendorBill = (vendor: ExpenseVendor) => {
    openExpenseForm({ vendor_id: vendor.id, paymentStatus: 'Unpaid', paidAmount: 0 });
  };

  const openVendorKhata = (vendorId: string) => {
    setActiveTab('vendors');
    setSearchTerm('');
    selectVendor(vendorId);
  };

  const savedExpenses = settings.expenses?.savedExpenses || [];

  const upsertSavedExpense = async (draft: Omit<SavedExpense, 'id'> & { id?: string }) => {
    const name = draft.name.trim();
    if (!name || !draft.category || !draft.description || draft.amount <= 0) {
      showToast('Saved expense ke liye naam, category aur amount zaroori hain', 'warning');
      return false;
    }
    const current = settings.expenses?.savedExpenses || [];
    const existing = current.find(item => item.id === draft.id || item.name.toLowerCase() === name.toLowerCase());
    const nextItem: SavedExpense = {
      ...draft,
      id: existing?.id || crypto.randomUUID(),
      name,
      subcategory: draft.subcategory || '',
      paidAmount: draft.paidAmount || 0,
      paymentStatus: draft.paymentStatus || 'Paid',
      paymentMode: draft.paymentMode || 'Cash'
    };
    const next = existing
      ? current.map(item => item.id === existing.id ? nextItem : item)
      : [nextItem, ...current];
    await updateSettings({ expenses: { savedExpenses: next } });
    showToast(`${name} save ho gaya. Dobara record karne ke liye Saved kholein.`, 'success');
    return true;
  };

  const deleteSavedExpense = async (id: string) => {
    const current = settings.expenses?.savedExpenses || [];
    const target = current.find(item => item.id === id);
    if (!target) return;
    if (!(await confirmAction({
      title: `"${target.name}" saved list se hatayen?`,
      message: 'Sirf saved shortcut hatega; pehle se record kiye gaye kharche waise hi rahenge.',
      confirmLabel: 'Haan, hatayen',
    }))) return;
    await updateSettings({
      expenses: { savedExpenses: current.filter(item => item.id !== id) }
    });
    showToast(`${target.name} hata diya gaya`, 'info');
  };

  const localToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

  const toPkDay = (value?: string) => {
    const text = String(value || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(text.slice(0, 10)) && text.length <= 10) return text;
    const parsed = new Date(text.replace(' ', 'T'));
    return isNaN(parsed.getTime()) ? text.slice(0, 10) : parsed.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  };

  const handleUseSavedExpense = (preset: SavedExpense) => {
    const status = preset.paymentStatus || 'Paid';
    const amount = preset.amount || 0;
    const paidAmount = status === 'Paid' ? amount : status === 'Unpaid' ? 0 : Math.min(amount, preset.paidAmount || 0);
    const mode = preset.paymentMode || 'Cash';
    const fallbackAccount = mode === 'Cash'
      ? (settings.financial?.defaultCashAccountId || accounts.find(account => account.type === 'Cash')?.id || accounts[0]?.id || '')
      : (settings.financial?.defaultDigitalAccountId || accounts.find(account => account.type === 'Bank' || account.type === 'Wallet')?.id || accounts[0]?.id || '');
    const vendorStillExists = !preset.vendor_id || expenseVendors.some(vendor => vendor.id === preset.vendor_id);

    setFormData({
      date: localToday(),
      category: preset.category || '',
      subcategory: preset.subcategory || '',
      description: preset.description || '',
      vendor_id: vendorStillExists ? (preset.vendor_id || '') : '',
      amount,
      paidAmount,
      paymentStatus: status,
      dueDate: '',
      paymentMode: mode,
      account_id: preset.account_id || fallbackAccount,
      notes: preset.notes || ''
    });
    setIsModalCreatingCat(false);
    setModalNewCatInput('');
    setIsModalCreatingSub(false);
    setModalNewSubInput('');
    setIsModalCreatingVendor(false);
    setQuickVendorName('');
    setQuickVendorPhone('');
    setRememberExpense(false);
    setRememberName(preset.name || '');
    setIsAddMode(true);

    if (!vendorStillExists) {
      showToast('Yeh vendor ab list mein nahi hai. Save se pehle koi aur vendor chunein.', 'warning');
    }
  };

  const handleEditExpense = (exp: ExpenseEntry) => {
    if (!canEdit) {
      showToast("Aap ko is kaam ki ijazat nahi hai.", "warning");
      return;
    }
    setEditingExpenseId(exp.id);
    setFormData({
      // Stored dates are full timestamps; the date input only accepts YYYY-MM-DD and showed blank.
      date: toPkDay(exp.date),
      category: exp.category,
      subcategory: exp.subcategory || '',
      description: exp.description,
      vendor_id: exp.vendor_id || '',
      amount: exp.amount,
      paidAmount: exp.paidAmount || 0,
      paymentStatus: exp.paymentStatus || 'Paid',
      dueDate: exp.dueDate || '',
      paymentMode: exp.paymentMode || 'Cash',
      account_id: exp.account_id || '',
      notes: exp.notes || ''
    });
    setRememberExpense(false);
    setRememberName('');
    setIsAddMode(true);
  };

  const isSubmittingExpenseRef = useRef(false);

  const handleSubmitExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingExpenseId ? !canEdit : !canCreate) {
      showToast("Aap ko is kaam ki ijazat nahi hai.", "warning");
      return;
    }
    const description = (formData.description || '').trim();
    if (!formData.amount || formData.amount <= 0 || !description || isSubmitting || isSubmittingExpenseRef.current) {
      if (!formData.amount || formData.amount <= 0 || !description) {
        showToast("Sahi amount aur tafseel likhein", "warning");
      }
      return;
    }

    if (!formData.category) {
      showToast("Kharche ki category chunein", "warning");
      return;
    }

    // A cleared date input sent '' and the entry was stamped with the current time instead.
    if (!formData.date) {
      showToast("Kharche ki tareekh chunein", "warning");
      return;
    }

    // The disabled Save button is not enough: Ctrl+Enter calls requestSubmit(), and addExpense only checks the books lock date.
    if (isDayLocked && isDayLocked(formData.date)) {
      showToast(`${formData.date} ka din lock hai — is tareekh par kharcha save nahi ho sakta.`, "error");
      return;
    }

    let actualPaid = 0;
    if (formData.paymentStatus === 'Paid') {
      actualPaid = formData.amount;
    } else if (formData.paymentStatus === 'Partial') {
      actualPaid = Math.min(formData.amount, Math.max(0, formData.paidAmount || 0));
    } else {
      actualPaid = 0;
    }

    // "Partial" with nothing paid used to be saved as Partial with no money moved; with the full
    // amount paid it stayed Partial forever (the loader keeps a stored Partial), showing a bill that was settled.
    if (formData.paymentStatus === 'Partial' && actualPaid <= 0) {
      showToast("Partial mein abhi ada ki gayi raqam likhein, ya 'On credit' chunein", "warning");
      return;
    }
    const paymentStatus: 'Paid' | 'Partial' | 'Unpaid' = actualPaid >= formData.amount ? 'Paid' : formData.paymentStatus;

    if ((paymentStatus === 'Unpaid' || paymentStatus === 'Partial') && !formData.vendor_id) {
      showToast("Baqi raqam khata mein likhne ke liye vendor chunein", "warning");
      return;
    }

    let vendorName = '';
    if (formData.vendor_id) {
      vendorName = expenseVendors.find(v => v.id === formData.vendor_id)?.name || '';
    }

    const chosenAccount = accounts.find(a => a.id === formData.account_id);
    // A paid amount with no account would be recorded as paid while no balance moves.
    if (actualPaid > 0 && !chosenAccount) {
      showToast("Paisa kis account se diya gaya? Account chunein", "warning");
      return;
    }
    // Same day as before: keep the original timestamp instead of re-stamping the entry.
    const originalExpense = editingExpenseId ? expenses.find(item => item.id === editingExpenseId) : undefined;
    const submitDate = originalExpense && toPkDay(originalExpense.date) === formData.date ? originalExpense.date : formData.date;

    isSubmittingExpenseRef.current = true;
    setIsSubmitting(true);
    try {
      const expensePayload = {
        ...formData,
        description,
        date: submitDate,
        amount: formData.amount,
        paidAmount: actualPaid,
        paymentStatus,
        // A "pay by" date only means something while part of the bill is still owed.
        dueDate: paymentStatus === 'Paid' ? '' : formData.dueDate,
        category: formData.category,
        subcategory: formData.subcategory || '',
        account_id: actualPaid > 0 ? formData.account_id : undefined,
        account_name: actualPaid > 0 && chosenAccount ? chosenAccount.name : undefined,
        vendor_id: formData.vendor_id || undefined,
        vendor_name: vendorName
      };

      if (editingExpenseId) {
        const ok = await updateExpense(editingExpenseId, expensePayload as Partial<ExpenseEntry>);
        if (!ok) return;
        showToast("Kharcha update ho gaya", "success");
      } else {
        const ok = await addExpense(expensePayload as Omit<ExpenseEntry, 'id'>);
        if (!ok) return;

        if (rememberExpense) {
          await upsertSavedExpense({
            name: (rememberName || description).trim(),
            category: formData.category,
            subcategory: formData.subcategory || '',
            description,
            amount: formData.amount,
            paidAmount: actualPaid,
            paymentStatus,
            paymentMode: formData.paymentMode || 'Cash',
            account_id: formData.account_id,
            vendor_id: formData.vendor_id || undefined,
            vendor_name: vendorName || undefined,
            notes: formData.notes || ''
          });
          setRememberExpense(false);
          setRememberName('');
        }

        const remainingDues = formData.amount - actualPaid;
        if (remainingDues > 0 && vendorName) {
          showToast(`${formatCurrency(formData.amount)} ka kharcha record ho gaya. Ada: ${formatCurrency(actualPaid)}, ${vendorName} ka baqi: ${formatCurrency(remainingDues)}`, 'success');
        } else {
          showToast(`${formatCurrency(formData.amount)} ka kharcha ${chosenAccount?.name || 'account'} se record ho gaya`, 'success');
        }
      }
      setIsAddMode(false);
      setEditingExpenseId(null);
      setIsSavedExpensesOpen(false);
    } catch (err: any) {
      showToast("Kharcha record nahi hua: " + (err?.message || "dobara koshish karein"), "error");
    } finally {
      setIsSubmitting(false);
      setTimeout(() => {
        isSubmittingExpenseRef.current = false;
      }, 400);
    }
  };

  const saveRecordedExpense = async (expense: ExpenseEntry) => {
    await upsertSavedExpense({
      name: expense.description,
      category: expense.category,
      subcategory: expense.subcategory || '',
      description: expense.description,
      amount: expense.amount,
      // paidOf: a Partial bill with 0 paid used to be saved as fully paid (0 || amount).
      paidAmount: paidOf(expense),
      paymentStatus: expense.paymentStatus || 'Paid',
      paymentMode: expense.paymentMode || 'Cash',
      account_id: expense.account_id,
      vendor_id: expense.vendor_id,
      vendor_name: expense.vendor_name,
      notes: expense.notes || ''
    });
  };

  const handleOpenAddVendorModal = () => {
    if (!canCreate) {
      showToast("Aap ko naya vendor banane ki ijazat nahi.", "warning");
      return;
    }
    setEditingVendor(null);
    setVendorFormData({
      name: '',
      service_type: 'Other',
      contact_person: '',
      phone: '',
      address: '',
      opening_balance: 0,
      bank_name: '',
      account_number: '',
      iban: '',
      notes: '',
      isActive: true
    });
    setIsVendorModalOpen(true);
  };

  const handleOpenEditVendorModal = (vendor: ExpenseVendor) => {
    if (!canEdit) {
      showToast("Aap ko is kaam ki ijazat nahi hai.", "warning");
      return;
    }
    setEditingVendor(vendor);
    setVendorFormData({
      name: vendor.name,
      service_type: vendor.service_type || 'Other',
      contact_person: vendor.contact_person || '',
      phone: vendor.phone || '',
      address: vendor.address || '',
      opening_balance: vendor.opening_balance || 0,
      bank_name: vendor.bank_name || '',
      account_number: vendor.account_number || '',
      iban: vendor.iban || '',
      notes: vendor.notes || '',
      isActive: vendor.isActive !== false
    });
    setIsVendorModalOpen(true);
  };

  // State alone let a fast double submit through (both clicks ran before the re-render disabled Save).
  const isSubmittingVendorRef = useRef(false);

  /** Another vendor (any status) already using this name; the khata also matches entries by name. */
  const findVendorByName = (name: string, exceptId?: string) => {
    const key = name.trim().toLowerCase();
    return expenseVendors.find(v => v.id !== exceptId && v.name.trim().toLowerCase() === key);
  };

  const handleVendorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = vendorFormData.name?.trim() || '';
    if (!name || isSubmittingVendor || isSubmittingVendorRef.current) {
      if (!name) showToast("Vendor ka naam zaroori hai", "warning");
      return;
    }
    if (editingVendor ? !canEdit : !canCreate) {
      showToast("Aap ko is kaam ki ijazat nahi hai.", "warning");
      return;
    }
    const duplicate = findVendorByName(name, editingVendor?.id);
    if (duplicate) {
      showToast(`"${duplicate.name}" naam ka vendor pehle se mojood hai${duplicate.isActive === false ? ' (Inactive)' : ''}. Doosra naam rakhein.`, "warning");
      return;
    }

    isSubmittingVendorRef.current = true;
    setIsSubmittingVendor(true);
    try {
      if (editingVendor) {
        const success = await updateExpenseVendor(editingVendor.id, { ...vendorFormData, name });
        if (success) {
          setIsVendorModalOpen(false);
          setEditingVendor(null);
        }
      } else {
        const success = await addExpenseVendor({ ...vendorFormData, name } as Omit<ExpenseVendor, 'id' | 'total_paid'>);
        if (success) {
          setIsVendorModalOpen(false);
        }
      }
    } catch (err: any) {
      showToast("Vendor save nahi hua: " + (err?.message || "dobara koshish karein"), "error");
    } finally {
      isSubmittingVendorRef.current = false;
      setIsSubmittingVendor(false);
    }
  };

  // Ids whose delete is already running: a second click during the network call reversed the money twice.
  const pendingDeletesRef = useRef(new Set<string>());

  const handleDeleteVendor = async (vendor: ExpenseVendor) => {
    if (!canDelete) {
      showToast("Aap ko vendor delete karne ki ijazat nahi.", "warning");
      return;
    }
    if (pendingDeletesRef.current.has(vendor.id)) return;
    const assessment = getDeleteAssessment('vendor', vendor.id);
    if (assessment.balance !== 0) {
      showToast(`Vendor delete nahi ho sakta: ${formatCurrency(Math.abs(assessment.balance))} baqi hain. Pehle hisaab barabar karein.`, 'error');
      return;
    }
    if (assessment.hasHistory) {
      if (vendor.isActive === false) {
        showToast(`"${vendor.name}" pehle se Inactive hai. Record wale vendor delete nahi hote.`, 'info');
        return;
      }
      const deactivate = await confirmAction({
        tone: 'warning',
        title: `"${vendor.name}" Inactive karein?`,
        message: `Is vendor ke ${assessment.details?.expCount} kharche record hain, is liye yeh delete nahi hoga balkay Inactive ho jayega.`,
        consequences: ['Purane kharche aur khata waise hi rahenge.', 'Naye kharche mein yeh vendor nazar nahi aayega.'],
        confirmLabel: 'Haan, Inactive karein',
      });
      if (!deactivate) return;
      pendingDeletesRef.current.add(vendor.id);
      try {
        // Was fire-and-forget: the "Inactive ho gaya" toast showed even when the save failed.
        if (await updateExpenseVendor(vendor.id, { isActive: false })) {
          showToast(`Vendor "${vendor.name}" Inactive ho gaya`, 'info');
        }
      } finally {
        pendingDeletesRef.current.delete(vendor.id);
      }
      return;
    }
    const hardDelete = await confirmAction({
      title: `Vendor "${vendor.name}" delete karein?`,
      message: 'Is vendor ka koi record nahi, is liye yeh hamesha ke liye hat jayega.',
      consequences: ['Yeh kaam wapas nahi ho sakta.'],
    });
    if (!hardDelete) return;
    pendingDeletesRef.current.add(vendor.id);
    try {
      // The detail pane kept pointing at the deleted vendor ("Vendor not found").
      if (await deleteExpenseVendor(vendor.id) && selectedVendorId === vendor.id) selectVendor(null);
    } finally {
      pendingDeletesRef.current.delete(vendor.id);
    }
  };

  const [isCreatingQuickVendor, setIsCreatingQuickVendor] = useState(false);
  const isCreatingQuickVendorRef = useRef(false);

  const handleQuickCreateVendor = async () => {
    const name = quickVendorName.trim();
    if (!name) {
      showToast("Vendor ka naam likhein", "warning");
      return;
    }
    if (isCreatingQuickVendorRef.current) return;
    if (!canCreate) {
      showToast("Aap ko naya vendor banane ki ijazat nahi.", "warning");
      return;
    }

    // Enter on an existing name used to create a second vendor with the same khata name.
    const existing = findVendorByName(name);
    if (existing) {
      if (existing.isActive === false) {
        showToast(`"${existing.name}" Inactive vendor hai. Vendors tab se use Active karein.`, "warning");
        return;
      }
      setFormData(prev => ({ ...prev, vendor_id: existing.id }));
      setQuickVendorName('');
      setQuickVendorPhone('');
      setIsModalCreatingVendor(false);
      showToast(`"${existing.name}" pehle se mojood hai, wohi chun liya`, "info");
      return;
    }

    isCreatingQuickVendorRef.current = true;
    setIsCreatingQuickVendor(true);
    try {
      const createdId = await addExpenseVendor({
        name,
        service_type: 'Other',
        phone: quickVendorPhone.trim(),
        isActive: true,
        pending_balance: 0,
        opening_balance: 0
      } as any);

      if (createdId && typeof createdId === 'string') {
        setFormData(prev => ({ ...prev, vendor_id: createdId }));
        setQuickVendorName('');
        setQuickVendorPhone('');
        setIsModalCreatingVendor(false);
      }
    } finally {
      isCreatingQuickVendorRef.current = false;
      setIsCreatingQuickVendor(false);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    if (!canDelete) {
      showToast("Aap ko kharcha delete karne ki ijazat nahi.", "warning");
      return;
    }
    if (pendingDeletesRef.current.has(id)) return;
    const assessment = getDeleteAssessment('expense', id);
    if (assessment.isLocked) {
      showToast("Yeh kharcha band shift ya lock din ka hai, is liye delete nahi ho sakta.", "error");
      return;
    }
    const ok = await confirmAction({
      title: 'Yeh kharcha delete karein?',
      consequences: [
        'Jo raqam ada ki gayi thi woh wapas usi account mein aa jayegi.',
        'Vendor ka baqi balance usi hisaab se theek ho jayega.',
        'Yeh kaam wapas nahi ho sakta.',
      ],
    });
    if (!ok || pendingDeletesRef.current.has(id)) return;
    pendingDeletesRef.current.add(id);
    try {
      const success = await safeDeleteExpense(id);
      if (success) {
        showToast("Kharcha delete ho gaya, accounts theek kar diye gaye", 'info');
      }
    } finally {
      pendingDeletesRef.current.delete(id);
    }
  };

  const handleOpenPaymentModal = (vendor?: ExpenseVendor, prefilledAmount?: number, defaultType: 'payment' | 'refund' = 'payment') => {
    if (!canCreate) {
      showToast("Aap ko vendor payment ki ijazat nahi hai.", "warning");
      return;
    }
    const defaultAcc = settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id || accounts[0]?.id || '';
    const targetVendor = vendor || (expenseVendors.find(v => v.isActive !== false) || null);

    let initialType = defaultType;
    let initialAmt: string | number = '';

    if (prefilledAmount !== undefined) {
      initialAmt = Math.abs(prefilledAmount);
    } else if (targetVendor) {
      const bal = targetVendor.pending_balance || 0;
      if (bal > 0) {
        initialAmt = bal;
        initialType = 'payment';
      } else if (bal < 0) {
        initialAmt = Math.abs(bal);
        initialType = 'refund';
      }
    }

    setSelectedPaymentVendor(targetVendor);
    setPaymentFormData({
      type: initialType,
      vendor_id: targetVendor ? targetVendor.id : '',
      amount: initialAmt,
      date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
      mode: 'Cash',
      account_id: defaultAcc,
      reference_no: '',
      note: ''
    });
    setIsPaymentModalOpen(true);
  };

  // Held from the first check until the save ends, including while the low-balance confirm is open.
  const isSubmittingPaymentRef = useRef(false);

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingPayment || isSubmittingPaymentRef.current) return;
    if (!canCreate) {
      showToast("Aap ko vendor payment ki ijazat nahi hai.", "warning");
      return;
    }

    const amt = parseFloat(paymentFormData.amount as string);
    if (!amt || amt <= 0) {
      showToast("Sahi amount likhein", "warning");
      return;
    }

    if (!paymentFormData.vendor_id) {
      showToast("Vendor / staff chunein", "warning");
      return;
    }

    if (!paymentFormData.account_id) {
      showToast("Account chunein", "warning");
      return;
    }

    if (!paymentFormData.date) {
      showToast("Payment ki tareekh chunein", "warning");
      return;
    }

    // Ctrl+Enter submits past the disabled button, and the payment engine only checks the books lock date.
    if (isDayLocked && isDayLocked(paymentFormData.date)) {
      showToast(`${paymentFormData.date} ka din lock hai — is tareekh par payment save nahi ho sakti.`, "error");
      return;
    }

    isSubmittingPaymentRef.current = true;
    try {
      const isRefund = paymentFormData.type === 'refund';
      const chosenAccount = accounts.find(a => a.id === paymentFormData.account_id);
      if (!isRefund && chosenAccount && chosenAccount.balance < amt) {
        if (!(await confirmAction({
          tone: 'warning',
          title: 'Account mein itna balance nahi',
          message: `"${chosenAccount.name}" mein ${formatCurrency(chosenAccount.balance)} hain, aur payment ${formatCurrency(amt)} ki hai.`,
          consequences: [`Payment ke baad "${chosenAccount.name}" ka balance ${formatCurrency(chosenAccount.balance - amt)} (minus) ho jayega.`],
          confirmLabel: 'Phir bhi payment karein',
        }))) {
          return;
        }
      }

      setIsSubmittingPayment(true);
      const success = await recordExpenseVendorPayment(
        paymentFormData.vendor_id,
        amt,
        paymentFormData.date,
        paymentFormData.mode,
        paymentFormData.account_id,
        paymentFormData.note,
        paymentFormData.reference_no,
        paymentFormData.type
      );

      if (success) {
        setIsPaymentModalOpen(false);
        setSelectedVendorId(paymentFormData.vendor_id);
      }
    } catch (err: any) {
      showToast("Payment record nahi hui: " + (err?.message || "dobara koshish karein"), "error");
    } finally {
      isSubmittingPaymentRef.current = false;
      setIsSubmittingPayment(false);
    }
  };

  const handleDeleteVendorTx = async (txId: string) => {
    if (!canDelete) {
      showToast("Sirf Admin vendor payment delete kar sakta hai.", "error");
      return;
    }
    if (pendingDeletesRef.current.has(txId)) return;
    // Reversing a payment from a closed day would change that day's reconciled cash.
    const vendorTx = expenseVendorTransactions.find(t => t.id === txId);
    if (vendorTx?.date && isDayLocked && isDayLocked(vendorTx.date)) {
      showToast("Yeh payment lock din ki hai, is liye delete nahi ho sakti.", "error");
      return;
    }
    if (!(await confirmAction({
      title: 'Yeh vendor payment delete karein?',
      consequences: [
        'Payment ki raqam wapas usi account mein aa jayegi.',
        'Vendor ka baqi balance pehle jaisa ho jayega.',
        'Yeh kaam wapas nahi ho sakta.',
      ],
    }))) {
      return;
    }
    if (pendingDeletesRef.current.has(txId)) return;
    pendingDeletesRef.current.add(txId);
    try {
      await deleteExpenseVendorTransaction(txId);
    } finally {
      pendingDeletesRef.current.delete(txId);
    }
  };

  const khataLedgerRows = useMemo<LedgerRow[]>(() => {
    // Only the vendors tab shows the khata; skip the work while the expenses list is open.
    const targetVendor = activeTab === 'vendors' ? selectedVendor : undefined;
    if (!targetVendor) return [];

    const rows: LedgerRow[] = [];
    const vId = targetVendor.id;
    const vName = targetVendor.name.toLowerCase();

    if (targetVendor.opening_balance && targetVendor.opening_balance !== 0) {
      rows.push({
        id: `ob_${vId}`,
        date: '2024-01-01',
        type: 'Opening Balance',
        description: 'Opening / Previous Balance',
        modeAccount: 'System Opening',
        refNo: 'OB-001',
        debit: targetVendor.opening_balance > 0 ? targetVendor.opening_balance : 0,
        credit: targetVendor.opening_balance < 0 ? Math.abs(targetVendor.opening_balance) : 0,
        runningBalance: 0
      });
    }

    const vendorExpenses = expenses.filter(e => e.vendor_id === vId || (e.vendor_name && e.vendor_name.toLowerCase() === vName));
    vendorExpenses.forEach(exp => {
      const billed = Number(exp.amount || 0);
      const isUnpaid = exp.paymentStatus === 'Unpaid' || (exp as any).payment_status === 'Unpaid';
      const paid = isUnpaid 
        ? 0 
        : (exp.paidAmount !== undefined && exp.paidAmount !== null 
            ? Number(exp.paidAmount) 
            : ((exp as any).paid_amount !== undefined && (exp as any).paid_amount !== null ? Number((exp as any).paid_amount) : billed));

      rows.push({
        id: exp.id,
        date: exp.date,
        type: 'Bill',
        description: `${exp.description}${exp.category ? ` (${exp.category})` : ''}`,
        modeAccount: paid > 0 ? `${exp.paymentMode || (exp as any).payment_mode || 'Cash'}${exp.account_name ? ` • ${exp.account_name}` : ''}` : 'Unpaid Bill (On Credit)',
        refNo: exp.referenceNo || exp.id.slice(-6).toUpperCase(),
        debit: billed,
        credit: paid,
        runningBalance: 0
      });
    });

    const directTransactions = expenseVendorTransactions.filter(t => t.vendor_id === vId);
    directTransactions.forEach(tx => {
      if (tx.type === 'Payment') {
        rows.push({
          id: tx.id,
          date: tx.date,
          type: 'Payment',
          description: `Payment to Vendor / Staff${tx.note ? ` (${tx.note})` : ''}`,
          modeAccount: `${tx.payment_mode || 'Cash'}${tx.account_name ? ` • ${tx.account_name}` : ''}`,
          refNo: tx.reference_no || tx.id.slice(-6).toUpperCase(),
          debit: 0,
          credit: tx.amount,
          runningBalance: 0
        });
      } else if (tx.type === 'Refund') {
        rows.push({
          id: tx.id,
          date: tx.date,
          type: 'Refund',
          description: `Refund / Return Received${tx.note ? ` (${tx.note})` : ''}`,
          modeAccount: `${tx.payment_mode || 'Cash'}${tx.account_name ? ` • ${tx.account_name}` : ''}`,
          refNo: tx.reference_no || tx.id.slice(-6).toUpperCase(),
          debit: tx.amount,
          credit: 0,
          runningBalance: 0
        });
      }
    });

    // Opening balance first, then by Pakistan day, then by time. Comparing Date objects put a
    // date-only entry (read as 05:00 PKT) after a same-day timestamp from the early morning.
    const rowDay = (r: LedgerRow) => (r.id === `ob_${vId}` ? '' : dayKey(r.date));
    rows.sort((a, b) => rowDay(a).localeCompare(rowDay(b)) || String(a.date).localeCompare(String(b.date)));

    // Same Pakistan-day ranges as the expense list, so "This month" ends on the month's last day and a
    // reversed custom range still works.
    const KHATA_MODE: Record<KhataDateRangeType, ExpenseDateFilterMode> = {
      today: 'today', yesterday: 'yesterday', '7days': '7days', '30days': '30days', last_30_days: '30days',
      this_month: 'this_month', last_month: 'last_month', single_date: 'single_date', custom: 'custom_range', all: 'all',
    };
    const range = periodRange({
      mode: KHATA_MODE[khataDateRange] || 'all',
      today,
      month: today.slice(0, 7),
      singleDate: khataStartDate,
      startDate: khataStartDate,
      endDate: khataEndDate,
    });
    const startDateLimit = range?.start || '';
    const endDateLimit = range?.end || '';

    if (!startDateLimit && !endDateLimit) {
      let currentBalance = 0;
      return rows.map(r => {
        currentBalance = currentBalance + r.debit - r.credit;
        return {
          ...r,
          runningBalance: currentBalance
        };
      });
    }

    let priorBalance = 0;
    const periodRows: LedgerRow[] = [];

    rows.forEach(r => {
      // The opening balance (day '') always counts before the period; it was dropped when a custom
      // range started before its placeholder date.
      const rDate = rowDay(r);
      if (startDateLimit && rDate < startDateLimit) {
        priorBalance = priorBalance + r.debit - r.credit;
      } else if (!endDateLimit || rDate <= endDateLimit) {
        periodRows.push(r);
      }
    });

    const resultRows: LedgerRow[] = [];
    if (startDateLimit) {
      resultRows.push({
        id: `prior_ob_${vId}`,
        date: startDateLimit,
        type: 'Opening Balance',
        description: 'Baqaya / Opening Balance (B/F)',
        modeAccount: 'Balance B/F',
        refNo: 'B/F',
        debit: priorBalance > 0 ? priorBalance : 0,
        credit: priorBalance < 0 ? Math.abs(priorBalance) : 0,
        runningBalance: priorBalance
      });
    }

    let currentBalance = priorBalance;
    periodRows.forEach(r => {
      if (r.type === 'Opening Balance' && startDateLimit) return;
      currentBalance = currentBalance + r.debit - r.credit;
      resultRows.push({
        ...r,
        runningBalance: currentBalance
      });
    });

    return resultRows;
  }, [activeTab, selectedVendor, expenses, expenseVendorTransactions, khataDateRange, khataStartDate, khataEndDate, today]);

  /** International number for wa.me: 0300…, 300…, +92 300… and 0092 300… all become 92300…. */
  const whatsAppNumber = (phone: string) => {
    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.startsWith('0092')) return digits.slice(2);
    if (digits.startsWith('92')) return digits;
    if (digits.startsWith('0')) return `92${digits.slice(1)}`;
    // A local mobile number typed without the leading 0 opened a chat with a non-existent number.
    if (digits.length === 10 && digits.startsWith('3')) return `92${digits}`;
    return digits;
  };

  const handleShareWhatsAppStatement = (vendor: ExpenseVendor) => {
    const phoneClean = whatsAppNumber(vendor.phone || '');
    if (!phoneClean) {
      showToast("Vendor ka phone number nahi hai", "warning");
      return;
    }

    const companyName = settings.general?.companyName || 'Mooco Dairy';
    const totalBilled = vendor.total_billed || 0;
    const totalPaid = vendor.total_paid || 0;
    const pendingDues = vendor.pending_balance || 0;
    // An advance used to read "Net Outstanding Dues: -Rs 3,000".
    const balanceLine = pendingDues > 0
      ? `*Net Outstanding Dues:* ${formatCurrency(pendingDues)}`
      : pendingDues < 0
        ? `*Advance with you:* ${formatCurrency(Math.abs(pendingDues))}`
        : '*Balance:* Settled';

    let text = `*${companyName} - Vendor Account Statement*\n`;
    text += `To: *${vendor.name}* (${vendor.service_type || 'Vendor'})\n`;
    // Pakistan date, like every other date here (the device date could be a day off).
    text += `Date: ${formatDateDisplay(pkToday())}\n\n`;
    text += `📊 *Summary*\n`;
    text += `• Total Billed: ${formatCurrency(totalBilled)}\n`;
    text += `• Total Paid: ${formatCurrency(totalPaid)}\n`;
    text += `• ${balanceLine}\n\n`;
    text += `*Last Activity:*\n`;

    // Readable dates instead of raw ISO timestamps (2026-10-21T09:12:44.000Z).
    khataLedgerRows.slice(-5).forEach(r => {
      text += `• ${formatDateDisplay(r.date)} | ${r.description} | Bill: ${formatCurrency(r.debit)} | Paid: ${formatCurrency(r.credit)}\n`;
    });

    text += `\nThank you!`;

    const encoded = encodeURIComponent(text);
    window.open(`https://wa.me/${phoneClean}?text=${encoded}`, '_blank');
  };

  const handlePrintStatement = () => {
    window.print();
  };

  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return '-';
    // Pakistan day: the UTC part of a timestamp is the previous day for entries before 05:00.
    const cleanStr = toPkDay(dateStr);
    try {
      const parts = cleanStr.split('-');
      if (parts.length === 3) {
        const y = parts[0];
        const m = parseInt(parts[1], 10) - 1;
        const d = parseInt(parts[2], 10);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        if (months[m]) return `${d} ${months[m]} ${y}`;
      }
      return cleanStr;
    } catch {
      return cleanStr;
    }
  };

  const headerSubtitle = activeTab === 'transactions'
    ? `${filteredExpenses.length} entries · ${formatCurrency(totalExpense)} spent`
    : `${expenseVendors.length} vendors · ${formatCurrency(totalOutstandingVendorDues)} to pay`;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 pb-24 md:pb-8">
      <ExpensesHeader
        active={activeTab}
        onChange={switchTab}
        subtitle={headerSubtitle}
        counts={{ vendors: vendorsWithDuesCount }}
        actions={activeTab === 'transactions' ? (
          <>
            {canCreate && (
              <Button variant="secondary" leftIcon={<Bookmark />} onClick={() => setIsSavedExpensesOpen(true)} title="Saved quick records" aria-label="Saved quick records">
                <span className="hidden sm:inline">Saved</span>
                {savedExpenses.length > 0 && <span className="min-w-5 rounded-full bg-warning-soft px-1.5 text-[10px] font-bold tabular-nums leading-5 text-warning-fg">{savedExpenses.length}</span>}
              </Button>
            )}
            <Button variant="secondary" leftIcon={<FolderTree />} onClick={() => setIsCategoryModalOpen(true)} title="Manage categories" aria-label="Categories">
              <span className="hidden sm:inline">Categories</span>
            </Button>
            {canCreate && (
              <Button leftIcon={<Plus />} onClick={handleOpenAddModal} title="Record expense (N)" className="hidden md:inline-flex">
                Record expense
              </Button>
            )}
          </>
        ) : (
          canCreate && (
            <>
              <Button variant="secondary" leftIcon={<UserPlus />} onClick={handleOpenAddVendorModal} title="Add vendor" aria-label="New vendor">
                <span className="hidden sm:inline">New vendor</span>
              </Button>
              <Button
                leftIcon={<ArrowUpRight />}
                onClick={() => {
                  const target = selectedVendor || expenseVendors.find(v => v.isActive !== false);
                  if (target) handleOpenPaymentModal(target);
                  else handleOpenAddVendorModal();
                }}
              >
                <span className="hidden sm:inline">Pay / Receive</span><span className="sm:hidden">Pay</span>
              </Button>
            </>
          )
        )}
      />

      {activeTab === 'transactions' && (
        <ExpenseTransactionsTab
          filteredExpenses={filteredExpenses}
          expenseVendors={expenseVendors}
          categoryTree={categoryTree}
          stats={expenseStats}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          filterMonth={filterMonth}
          setFilterMonth={setFilterMonth}
          dateFilterMode={dateFilterMode}
          setDateFilterMode={setDateFilterMode}
          filterSingleDate={filterSingleDate}
          setFilterSingleDate={setFilterSingleDate}
          filterStartDate={filterStartDate}
          setFilterStartDate={setFilterStartDate}
          filterEndDate={filterEndDate}
          setFilterEndDate={setFilterEndDate}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          filterVendor={filterVendor}
          setFilterVendor={setFilterVendor}
          filterPaymentStatus={filterPaymentStatus}
          setFilterPaymentStatus={setFilterPaymentStatus}
          isTxFilterOpen={isTxFilterOpen}
          setIsTxFilterOpen={setIsTxFilterOpen}
          expandedExpenseRowId={expandedExpenseRowId}
          setExpandedExpenseRowId={setExpandedExpenseRowId}
          canCreate={canCreate}
          canDelete={canDelete}
          canEdit={canEdit}
          handleOpenAddModal={handleOpenAddModal}
          handleEditExpense={handleEditExpense}
          handleDeleteExpense={handleDeleteExpense}
          savedExpenses={savedExpenses}
          onOpenSavedExpenses={() => setIsSavedExpensesOpen(true)}
          onUseSaved={handleUseSavedExpense}
          onSaveRecorded={saveRecordedExpense}
          onOpenVendor={openVendorKhata}
          onShowVendorDues={() => { setFilterVendorTabStatus('With Dues'); switchTab('vendors'); }}
          formatDateDisplay={formatDateDisplay}
        />
      )}

      {activeTab === 'vendors' && (
        <ExpenseVendorsTab
          expenseVendors={expenseVendors}
          filteredVendors={filteredVendors}
          selectedVendor={selectedVendor}
          selectedVendorId={selectedVendorId}
          setSelectedVendorId={selectVendor}
          isMobileLedgerOpen={isMobileLedgerOpen}
          setIsMobileLedgerOpen={setIsMobileLedgerOpen}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          filterVendorTabStatus={filterVendorTabStatus}
          setFilterVendorTabStatus={setFilterVendorTabStatus}
          handleOpenAddVendorModal={handleOpenAddVendorModal}
          handleOpenEditVendorModal={handleOpenEditVendorModal}
          handleDeleteVendor={handleDeleteVendor}
          handleOpenPaymentModal={handleOpenPaymentModal}
          onRecordBill={handleRecordVendorBill}
          handleShareWhatsAppStatement={handleShareWhatsAppStatement}
          handlePrintStatement={handlePrintStatement}
          showMobileVendorInfo={showMobileVendorInfo}
          setShowMobileVendorInfo={setShowMobileVendorInfo}
          khataDateRange={khataDateRange}
          setKhataDateRange={setKhataDateRange}
          khataStartDate={khataStartDate}
          setKhataStartDate={setKhataStartDate}
          khataEndDate={khataEndDate}
          setKhataEndDate={setKhataEndDate}
          khataLedgerRows={khataLedgerRows}
          formatDateDisplay={formatDateDisplay}
          expenses={expenses}
          expenseVendorTransactions={expenseVendorTransactions}
          canCreate={canCreate}
          canEdit={canEdit}
          canDelete={canDelete}
          handleDeleteVendorTransaction={handleDeleteVendorTx}
        />
      )}

      {isCategoryModalOpen && (
        <Suspense fallback={null}>
          <ExpenseCategoryModal
            isOpen={isCategoryModalOpen}
            onClose={() => setIsCategoryModalOpen(false)}
            categoryTree={categoryTree}
            categorySearch={categorySearch}
            setCategorySearch={setCategorySearch}
            modalCatFilter={modalCatFilter}
            setModalCatFilter={setModalCatFilter}
            isModalCreatingMainCat={isModalCreatingMainCat}
            setIsModalCreatingMainCat={setIsModalCreatingMainCat}
            modalNewCategoryName={modalNewCategoryName}
            setModalNewCategoryName={setModalNewCategoryName}
            handleModalAddCategory={handleModalAddCategory}
            handleToggleCategoryActive={handleToggleCategoryActive}
            handleStartEditCategory={handleStartEditCategory}
            handleSaveEditCategory={handleSaveEditCategory}
            editingCatName={editingCatName}
            setEditingCatName={setEditingCatName}
            editCatInput={editCatInput}
            setEditCatInput={setEditCatInput}
            handleDeleteCategory={handleDeleteCategory}
            getCategoryUsageCount={getCategoryUsageCount}
            expandedCatsInModal={expandedCatsInModal}
            setExpandedCatsInModal={setExpandedCatsInModal}
            getSubcategoryUsageCount={getSubcategoryUsageCount}
            editingSubcatKey={editingSubcatKey}
            setEditingSubcatKey={setEditingSubcatKey}
            editSubcatInput={editSubcatInput}
            setEditSubcatInput={setEditSubcatInput}
            handleStartEditSubcategory={handleStartEditSubcategory}
            handleSaveEditSubcategory={handleSaveEditSubcategory}
            handleToggleSubcategoryActive={handleToggleSubcategoryActive}
            handleDeleteSubcategory={handleDeleteSubcategory}
            newSubcatInputs={newSubcatInputs}
            setNewSubcatInputs={setNewSubcatInputs}
            handleModalAddSubcat={handleModalAddSubcat}
          />
        </Suspense>
      )}

      {isSavedExpensesOpen && (
        <Suspense fallback={null}>
          <SavedExpensesModal
            isOpen={isSavedExpensesOpen}
            onClose={() => setIsSavedExpensesOpen(false)}
            savedExpenses={savedExpenses}
            accounts={accounts}
            onUse={handleUseSavedExpense}
            onDelete={deleteSavedExpense}
          />
        </Suspense>
      )}

      {isAddMode && (
        <Suspense fallback={null}>
          <ExpenseFormModal
            isOpen={isAddMode}
            onClose={() => setIsAddMode(false)}
            isEditing={Boolean(editingExpenseId)}
            formData={formData}
            setFormData={setFormData}
            handleSubmitExpense={handleSubmitExpense}
            isSubmitting={isSubmitting}
            categoryRichOptions={categoryRichOptions}
            activeSubcategoryList={activeSubcategoryList}
            vendorRichOptions={vendorRichOptions}
            accountRichOptions={accountRichOptions}
            selectedPaymentAccount={selectedPaymentAccount}
            isModalCreatingCat={isModalCreatingCat}
            setIsModalCreatingCat={setIsModalCreatingCat}
            modalNewCatInput={modalNewCatInput}
            setModalNewCatInput={setModalNewCatInput}
            handleCreateMainCategory={handleCreateMainCategory}
            isModalCreatingSub={isModalCreatingSub}
            setIsModalCreatingSub={setIsModalCreatingSub}
            modalNewSubInput={modalNewSubInput}
            setModalNewSubInput={setModalNewSubInput}
            handleCreateSubcategory={handleCreateSubcategory}
            isModalCreatingVendor={isModalCreatingVendor}
            setIsModalCreatingVendor={setIsModalCreatingVendor}
            quickVendorName={quickVendorName}
            setQuickVendorName={setQuickVendorName}
            quickVendorPhone={quickVendorPhone}
            setQuickVendorPhone={setQuickVendorPhone}
            handleQuickCreateVendor={handleQuickCreateVendor}
            isCreatingQuickVendor={isCreatingQuickVendor}
            accounts={accounts}
            settings={settings}
            rememberExpense={rememberExpense}
            setRememberExpense={setRememberExpense}
            rememberName={rememberName}
            setRememberName={setRememberName}
          />
        </Suspense>
      )}

      {isVendorModalOpen && (
        <Suspense fallback={null}>
          <ExpenseVendorModal
            isOpen={isVendorModalOpen}
            onClose={() => setIsVendorModalOpen(false)}
            vendorFormData={vendorFormData}
            setVendorFormData={setVendorFormData}
            handleVendorSubmit={handleVendorSubmit}
            isSubmittingVendor={isSubmittingVendor}
            editingVendor={editingVendor}
          />
        </Suspense>
      )}

      {isPaymentModalOpen && (
        <Suspense fallback={null}>
          <VendorPaymentModal
            isOpen={isPaymentModalOpen}
            onClose={() => setIsPaymentModalOpen(false)}
            paymentFormData={paymentFormData}
            setPaymentFormData={setPaymentFormData}
            handlePaymentSubmit={handlePaymentSubmit}
            isSubmittingPayment={isSubmittingPayment}
            expenseVendors={expenseVendors}
            vendorRichOptions={vendorRichOptions}
            accountRichOptions={accountRichOptions}
            selectedDirectPaymentAccount={selectedDirectPaymentAccount}
            setSelectedPaymentVendor={setSelectedPaymentVendor}
            accounts={accounts}
            settings={settings}
          />
        </Suspense>
      )}

      {canCreate && activeTab === 'transactions' && (
        <Button
          size="lg"
          leftIcon={<Plus />}
          onClick={handleOpenAddModal}
          title="Record expense"
          className="fixed bottom-6 right-4 z-40 rounded-card shadow-e3 animate-in zoom-in-95 duration-150 md:hidden print:hidden"
        >
          Record expense
        </Button>
      )}
    </div>
  );
};

export default Expenses;
