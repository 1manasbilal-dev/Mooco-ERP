import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { ExpenseEntry, ExpenseVendor, SavedExpense } from '../types';
import { 
  Receipt, Users, FolderTree, Wallet, CreditCard, Plus 
} from 'lucide-react';
import { RichSelectOption } from '../components/RichSelect';
import { 
  CategoryStructure, SubcategoryStructure, LedgerRow, 
  DEFAULT_EXPENSE_STRUCTURE, ExpenseDateFilterMode, KhataDateRangeType 
} from '../components/expenses/ExpenseTypes';
import { ExpenseTransactionsTab } from '../components/expenses/ExpenseTransactionsTab';
import { ExpenseVendorsTab } from '../components/expenses/ExpenseVendorsTab';
import { 
  ExpenseCategoryModal, ExpenseFormModal, SavedExpensesModal,
  ExpenseVendorModal, VendorPaymentModal 
} from '../components/expenses/ExpenseModals';

const Expenses: React.FC = () => {
  const { 
    expenses, expenseVendors, expenseVendorTransactions,
    addExpense, deleteExpense, 
    addExpenseVendor, updateExpenseVendor, deleteExpenseVendor, 
    recordExpenseVendorPayment, deleteExpenseVendorTransaction,
    manualAccounts, addManualAccount, deleteManualAccount, updateManualAccount,
    accounts, settings, updateSettings, canPerform,
    getDeleteAssessment, safeDeleteExpense
  } = useDairy();
  
  const { showToast } = useToast();

  const canCreate = canPerform('expenses', 'create');
  const canDelete = canPerform('expenses', 'delete');
  const location = useLocation();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'transactions' | 'vendors'>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tab') === 'vendors' ? 'vendors' : 'transactions';
  });

  // Vendor editing & viewing state
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

  // Modals and Form States
  const [isAddMode, setIsAddMode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [isSubmittingVendor, setIsSubmittingVendor] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);

  // Search & Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [isSavedExpensesOpen, setIsSavedExpensesOpen] = useState(false);
  const [rememberExpense, setRememberExpense] = useState(false);
  const [rememberName, setRememberName] = useState('');
  const [isTxFilterOpen, setIsTxFilterOpen] = useState(false);
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterVendor, setFilterVendor] = useState('All');
  const [filterPaymentStatus, setFilterPaymentStatus] = useState('All');
  const [filterVendorTabStatus, setFilterVendorTabStatus] = useState<'All' | 'With Dues' | 'Advance' | 'Active' | 'Inactive'>('All');
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [dateFilterMode, setDateFilterMode] = useState<ExpenseDateFilterMode>('this_month');
  const [filterSingleDate, setFilterSingleDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [filterStartDate, setFilterStartDate] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [filterEndDate, setFilterEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [expandedExpenseRowId, setExpandedExpenseRowId] = useState<string | null>(null);

  // Khata Statement Date Filters
  const [khataDateRange, setKhataDateRange] = useState<KhataDateRangeType>('this_month');
  const [khataStartDate, setKhataStartDate] = useState('');
  const [khataEndDate, setKhataEndDate] = useState('');

  // Form Data for Recording Expense
  const [formData, setFormData] = useState<Partial<ExpenseEntry> & { 
    paymentStatus: 'Paid' | 'Partial' | 'Unpaid';
    account_id?: string;
    dueDate?: string;
  }>({
    date: new Date().toISOString().split('T')[0],
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

  // Form Data for Vendor Add/Edit
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

  // Form Data for Direct Vendor Payment
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
    date: new Date().toISOString().split('T')[0],
    mode: 'Cash',
    account_id: settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id || accounts[0]?.id || '',
    reference_no: '',
    note: ''
  });

  // Quick Add states inside Record Expense modal
  const [isModalCreatingCat, setIsModalCreatingCat] = useState(false);
  const [modalNewCatInput, setModalNewCatInput] = useState('');
  const [isModalCreatingSub, setIsModalCreatingSub] = useState(false);
  const [modalNewSubInput, setModalNewSubInput] = useState('');
  const [isModalCreatingVendor, setIsModalCreatingVendor] = useState(false);
  const [quickVendorName, setQuickVendorName] = useState('');
  const [quickVendorPhone, setQuickVendorPhone] = useState('');

  // Category Modal Specific states
  const [modalNewCategoryName, setModalNewCategoryName] = useState('');
  const [isModalCreatingMainCat, setIsModalCreatingMainCat] = useState(false);
  const [modalCatFilter, setModalCatFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [newSubcatInputs, setNewSubcatInputs] = useState<Record<string, string>>({});
  const [categorySearch, setCategorySearch] = useState('');
  const [expandedCatsInModal, setExpandedCatsInModal] = useState<Record<string, boolean>>({});

  // Inline Category & Subcategory Edit State
  const [editingCatName, setEditingCatName] = useState<string | null>(null);
  const [editCatInput, setEditCatInput] = useState('');
  const [editingSubcatKey, setEditingSubcatKey] = useState<string | null>(null);
  const [editSubcatInput, setEditSubcatInput] = useState('');

  // --- Category Tree Logic ---
  const inactiveCats = useMemo(() => settings.expenses?.inactiveCategories || [], [settings.expenses]);
  const inactiveSubcats = useMemo(() => settings.expenses?.inactiveSubcategories || [], [settings.expenses]);
  const deletedCats = useMemo(() => settings.expenses?.deletedCategories || [], [settings.expenses]);
  const deletedSubcats = useMemo(() => settings.expenses?.deletedSubcategories || [], [settings.expenses]);
  const renamedCats = useMemo(() => settings.expenses?.renamedCategories || {}, [settings.expenses]);
  const renamedSubcats = useMemo(() => settings.expenses?.renamedSubcategories || {}, [settings.expenses]);

  const categoryTree = useMemo<CategoryStructure[]>(() => {
    const map: Record<string, CategoryStructure> = {};

    // 1. Populate Defaults
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

    // 2. Merge Manual Accounts
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

  // Active Categories
  const activeCategoryList = useMemo(() => {
    return categoryTree.filter(c => c.isActive);
  }, [categoryTree]);

  const activeCategoryNames = useMemo(() => {
    return activeCategoryList.map(c => c.name);
  }, [activeCategoryList]);

  // Active Subcategories for currently selected Category
  const activeSubcategoryList = useMemo(() => {
    if (!formData.category) return [];
    const foundCat = categoryTree.find(c => c.name.toLowerCase() === formData.category?.toLowerCase());
    if (!foundCat) return [];
    return foundCat.subcategories.filter(s => s.isActive);
  }, [categoryTree, formData.category]);

  // Selected Payment Account helper
  const selectedPaymentAccount = useMemo(() => {
    return accounts.find(a => a.id === formData.account_id) || accounts[0];
  }, [accounts, formData.account_id]);

  const selectedDirectPaymentAccount = useMemo(() => {
    return accounts.find(a => a.id === paymentFormData.account_id) || accounts[0];
  }, [accounts, paymentFormData.account_id]);

  // Usage Audit Checkers
  const getCategoryUsageCount = (catName: string) => {
    return expenses.filter(e => e.category?.toLowerCase() === catName.toLowerCase()).length;
  };

  const getSubcategoryUsageCount = (catName: string, subcatName: string) => {
    return expenses.filter(e => 
      e.category?.toLowerCase() === catName.toLowerCase() && 
      e.subcategory?.toLowerCase() === subcatName.toLowerCase()
    ).length;
  };

  // Filtered Expenses with Date & Date Range Support
  const filteredExpenses = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const yday = new Date();
    yday.setDate(yday.getDate() - 1);
    const ydayStr = yday.toISOString().split('T')[0];

    const d7 = new Date();
    d7.setDate(d7.getDate() - 6);
    const d7Str = d7.toISOString().split('T')[0];

    const d30 = new Date();
    d30.setDate(d30.getDate() - 29);
    const d30Str = d30.toISOString().split('T')[0];

    const now = new Date();
    const prevMonthStr = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);

    return expenses.filter(exp => {
      const matchesSearch = 
        exp.description.toLowerCase().includes(searchTerm.toLowerCase()) || 
        (exp.vendor_name && exp.vendor_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (exp.subcategory && exp.subcategory.toLowerCase().includes(searchTerm.toLowerCase()));
      
      const matchesCategory = filterCategory === 'All' || exp.category === filterCategory;
      const matchesVendor = filterVendor === 'All' || exp.vendor_id === filterVendor;
      const matchesStatus = filterPaymentStatus === 'All' || (exp.paymentStatus || 'Paid') === filterPaymentStatus;

      const rawDate = exp.date || '';
      const expDate = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate.slice(0, 10);

      let matchesDate = true;
      if (dateFilterMode === 'all') {
        matchesDate = true;
      } else if (dateFilterMode === 'today') {
        matchesDate = expDate === todayStr;
      } else if (dateFilterMode === 'yesterday') {
        matchesDate = expDate === ydayStr;
      } else if (dateFilterMode === '7days') {
        matchesDate = Boolean(expDate && expDate >= d7Str && expDate <= todayStr);
      } else if (dateFilterMode === '30days') {
        matchesDate = Boolean(expDate && expDate >= d30Str && expDate <= todayStr);
      } else if (dateFilterMode === 'this_month') {
        matchesDate = Boolean(expDate && expDate.startsWith(filterMonth));
      } else if (dateFilterMode === 'last_month') {
        matchesDate = Boolean(expDate && expDate.startsWith(prevMonthStr));
      } else if (dateFilterMode === 'single_date') {
        matchesDate = Boolean(filterSingleDate && expDate === filterSingleDate);
      } else if (dateFilterMode === 'custom_range') {
        if (filterStartDate && filterEndDate) {
          matchesDate = Boolean(expDate && expDate >= filterStartDate && expDate <= filterEndDate);
        } else if (filterStartDate) {
          matchesDate = Boolean(expDate && expDate >= filterStartDate);
        } else if (filterEndDate) {
          matchesDate = Boolean(expDate && expDate <= filterEndDate);
        }
      }

      return matchesSearch && matchesCategory && matchesVendor && matchesStatus && matchesDate;
    });
  }, [
    expenses, searchTerm, filterCategory, filterVendor, filterPaymentStatus,
    dateFilterMode, filterSingleDate, filterStartDate, filterEndDate, filterMonth
  ]);

  // Filtered Vendors
  const filteredVendors = useMemo(() => {
    return expenseVendors.filter(v => {
      const matchesSearch = 
        v.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        (v.service_type && v.service_type.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (v.phone && v.phone.includes(searchTerm)) ||
        (v.contact_person && v.contact_person.toLowerCase().includes(searchTerm.toLowerCase()));
      
      if (!matchesSearch) return false;

      if (filterVendorTabStatus === 'Active') return v.isActive !== false;
      if (filterVendorTabStatus === 'Inactive') return v.isActive === false;
      if (filterVendorTabStatus === 'With Dues') return (v.pending_balance || 0) > 0;
      if (filterVendorTabStatus === 'Advance') return (v.pending_balance || 0) < 0;
      return true;
    }).map(v => {
      const vendorExpenses = expenses.filter(e => e.vendor_id === v.id || (e.vendor_name && e.vendor_name.toLowerCase() === v.name.toLowerCase()));
      const liveTotalBilled = vendorExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
      const liveExpensesPaid = vendorExpenses.reduce((sum, e) => {
        const isUnpaid = e.paymentStatus === 'Unpaid' || (e as any).payment_status === 'Unpaid';
        if (isUnpaid) return sum;
        const paid = e.paidAmount !== undefined && e.paidAmount !== null 
          ? Number(e.paidAmount) 
          : ((e as any).paid_amount !== undefined && (e as any).paid_amount !== null ? Number((e as any).paid_amount) : Number(e.amount || 0));
        return sum + paid;
      }, 0);
      const directPayments = expenseVendorTransactions
        .filter(t => t.vendor_id === v.id && t.type === 'Payment')
        .reduce((sum, t) => sum + (t.amount || 0), 0);
      const directRefunds = expenseVendorTransactions
        .filter(t => t.vendor_id === v.id && t.type === 'Refund')
        .reduce((sum, t) => sum + (t.amount || 0), 0);
      
      const totalPaidCalc = Math.max(0, liveExpensesPaid + directPayments - directRefunds);

      return {
        ...v,
        total_billed: liveTotalBilled > 0 ? liveTotalBilled : (v.total_billed || 0),
        total_paid: totalPaidCalc > 0 ? totalPaidCalc : (v.total_paid || 0),
        pending_balance: v.pending_balance !== undefined ? v.pending_balance : 0
      };
    });
  }, [expenseVendors, expenses, expenseVendorTransactions, searchTerm, filterVendorTabStatus]);

  // Selected Active Vendor
  const selectedVendor = useMemo(() => {
    if (selectedVendorId) {
      const found = filteredVendors.find(v => v.id === selectedVendorId) || expenseVendors.find(v => v.id === selectedVendorId);
      if (found) return found;
    }
    return filteredVendors[0] || undefined;
  }, [selectedVendorId, filteredVendors, expenseVendors]);

  // KPI Calculations
  const totalExpense = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
  const actualPaidExpense = filteredExpenses.reduce((sum, e) => {
    const isUnpaid = e.paymentStatus === 'Unpaid' || (e as any).payment_status === 'Unpaid';
    if (isUnpaid) return sum;
    const paid = e.paidAmount !== undefined && e.paidAmount !== null 
      ? Number(e.paidAmount) 
      : ((e as any).paid_amount !== undefined && (e as any).paid_amount !== null ? Number((e as any).paid_amount) : Number(e.amount || 0));
    return sum + paid;
  }, 0);
  const cashExpense = filteredExpenses.filter(e => (e.paymentMode === 'Cash' || (e as any).payment_mode === 'Cash') && e.paymentStatus !== 'Unpaid' && (e as any).payment_status !== 'Unpaid').reduce((sum, e) => {
    const paid = e.paidAmount !== undefined && e.paidAmount !== null 
      ? Number(e.paidAmount) 
      : ((e as any).paid_amount !== undefined && (e as any).paid_amount !== null ? Number((e as any).paid_amount) : Number(e.amount || 0));
    return sum + paid;
  }, 0);
  const onlineExpense = actualPaidExpense - cashExpense;

  const totalOutstandingVendorDues = useMemo(() => {
    return expenseVendors
      .filter(v => v.isActive !== false)
      .reduce((sum, v) => sum + Math.max(0, v.pending_balance || 0), 0);
  }, [expenseVendors]);

  // Rich Select Options
  const vendorRichOptions: RichSelectOption[] = useMemo(() => {
    return expenseVendors.filter(v => v.isActive !== false).map(v => {
      const bal = v.pending_balance || 0;
      return {
        value: v.id,
        label: v.name,
        subLabel: v.service_type || 'Vendor/Staff',
        badge: bal !== 0 ? {
          text: `Rs ${Math.abs(bal).toLocaleString()} ${bal > 0 ? 'Due' : 'Advance'}`,
          variant: bal > 0 ? 'red' : 'green'
        } : {
          text: 'Cleared',
          variant: 'slate'
        },
        avatarLetter: v.name.charAt(0).toUpperCase(),
        avatarBg: bal > 0 ? 'bg-rose-100 text-rose-800' : 'bg-lime-100 text-lime-800'
      };
    });
  }, [expenseVendors]);

  const accountRichOptions: RichSelectOption[] = useMemo(() => {
    return accounts.filter(a => a.isActive !== false).map(a => ({
      value: a.id,
      label: a.name,
      subLabel: a.type,
      badge: {
        text: `Rs ${a.balance.toLocaleString()}`,
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

  // --- Handlers: Category Toggle & Rename ---
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

    showToast(`Category "${cat.name}" is now ${newStatus ? 'Active' : 'Inactive'}`, newStatus ? 'success' : 'info');
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

    showToast(`Sub-category "${sub.name}" is now ${newStatus ? 'Active' : 'Inactive'}`, newStatus ? 'success' : 'info');
  };

  const handleCreateMainCategory = async (name: string): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed) {
      showToast("Category name cannot be empty", "warning");
      return null;
    }

    if (categoryTree.some(c => c.name.toLowerCase() === trimmed.toLowerCase())) {
      showToast(`Category "${trimmed}" already exists`, "info");
      return trimmed;
    }

    const success = await addManualAccount({
      name: trimmed,
      type: 'Expense',
      balance: 0,
      description: 'Parent Expense Category',
      isActive: true
    });

    if (success) {
      showToast(`Category "${trimmed}" created successfully!`, 'success');
      return trimmed;
    } else {
      showToast("Failed to save category. Try again.", "error");
      return null;
    }
  };

  const handleCreateSubcategory = async (parentCatName: string, subcatName: string): Promise<string | null> => {
    const trimmedSub = subcatName.trim();
    if (!trimmedSub) {
      showToast("Sub-category name cannot be empty", "warning");
      return null;
    }

    let parentAcc = manualAccounts.find(a => a.type === 'Expense' && a.name.toLowerCase() === parentCatName.toLowerCase() && !a.parentId);
    let parentId = parentAcc?.id;

    if (!parentId) {
      const generatedId = `ma_${Date.now()}_root`;
      await addManualAccount({
        id: generatedId,
        name: parentCatName,
        type: 'Expense',
        balance: 0,
        description: 'Parent Expense Category',
        isActive: true
      });
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
      showToast(`Sub-category "${trimmedSub}" added under "${parentCatName}"!`, 'success');
      return trimmedSub;
    } else {
      showToast("Failed to save sub-category", "error");
      return null;
    }
  };

  const handleModalAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalNewCategoryName.trim()) return;
    const res = await handleCreateMainCategory(modalNewCategoryName);
    if (res) {
      setModalNewCategoryName('');
    }
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
      showToast(`Category "${trimmed}" already exists`, "warning");
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
    showToast(`Category renamed to "${trimmed}"`, 'success');
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
    showToast(`Sub-category renamed to "${trimmed}"`, 'success');
  };

  const handleDeleteCategory = async (cat: CategoryStructure) => {
    const usageCount = getCategoryUsageCount(cat.name);
    if (usageCount > 0) {
      showToast(`Cannot delete "${cat.name}": ${usageCount} transaction(s) recorded!`, "warning");
      return;
    }

    if (confirm(`Are you sure you want to delete category "${cat.name}"?`)) {
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

      showToast(`Category "${cat.name}" deleted successfully`, 'info');
    }
  };

  const handleDeleteSubcategory = async (parentCatName: string, sub: SubcategoryStructure) => {
    const subUsage = getSubcategoryUsageCount(parentCatName, sub.name);
    if (subUsage > 0) {
      showToast(`Cannot delete "${sub.name}": ${subUsage} transaction(s) recorded!`, "warning");
      return;
    }

    if (confirm(`Are you sure you want to delete sub-category "${sub.name}"?`)) {
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

      showToast(`Sub-category "${sub.name}" deleted successfully`, 'info');
    }
  };

  const handleOpenAddModal = () => {
    const defaultAcc = settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id || accounts[0]?.id || '';
    setFormData({ 
      date: new Date().toISOString().split('T')[0], 
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
      notes: '' 
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

  const savedExpenses = settings.expenses?.savedExpenses || [];

  const upsertSavedExpense = async (draft: Omit<SavedExpense, 'id'> & { id?: string }) => {
    const name = draft.name.trim();
    if (!name || !draft.category || !draft.description || draft.amount <= 0) {
      showToast('A saved expense needs a name, category, and amount', 'warning');
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
    showToast(`${name} saved. Open Saved to record it again.`, 'success');
    return true;
  };

  const deleteSavedExpense = async (id: string) => {
    const current = settings.expenses?.savedExpenses || [];
    const target = current.find(item => item.id === id);
    if (!target) return;
    if (!window.confirm(`Remove "${target.name}" from saved expenses?`)) return;
    await updateSettings({
      expenses: { savedExpenses: current.filter(item => item.id !== id) }
    });
    showToast(`${target.name} removed`, 'info');
  };

  const localToday = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
      showToast('That vendor is no longer in the list. Pick another before saving.', 'warning');
    }
  };

  const handleEditExpense = (exp: ExpenseEntry) => {
    setFormData({
      date: exp.date,
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
    if (!formData.amount || formData.amount <= 0 || !formData.description || isSubmitting || isSubmittingExpenseRef.current) {
      if (!formData.amount || formData.amount <= 0 || !formData.description) {
        showToast("Please enter valid amount and description", "warning");
      }
      return;
    }

    if (!formData.category) {
      showToast("Please select an expense category", "warning");
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

    if ((formData.paymentStatus === 'Unpaid' || formData.paymentStatus === 'Partial') && !formData.vendor_id) {
      showToast("Please select a vendor to track unpaid dues in their Khata ledger", "warning");
      return;
    }

    let vendorName = '';
    if (formData.vendor_id) { 
      vendorName = expenseVendors.find(v => v.id === formData.vendor_id)?.name || ''; 
    }
    
    const chosenAccount = accounts.find(a => a.id === formData.account_id);

    isSubmittingExpenseRef.current = true;
    setIsSubmitting(true);
    try {
      const ok = await addExpense({
        ...formData,
        amount: formData.amount,
        paidAmount: actualPaid,
        paymentStatus: formData.paymentStatus,
        dueDate: formData.dueDate,
        category: formData.category,
        subcategory: formData.subcategory || '',
        account_id: actualPaid > 0 ? formData.account_id : undefined,
        account_name: actualPaid > 0 && chosenAccount ? chosenAccount.name : undefined,
        vendor_id: formData.vendor_id || undefined,
        vendor_name: vendorName
      } as Omit<ExpenseEntry, 'id'>);
      if (!ok) return;

      if (rememberExpense) {
        await upsertSavedExpense({
          name: (rememberName || formData.description || '').trim(),
          category: formData.category,
          subcategory: formData.subcategory || '',
          description: formData.description,
          amount: formData.amount,
          paidAmount: actualPaid,
          paymentStatus: formData.paymentStatus,
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
        showToast(`Expense of Rs ${formData.amount.toLocaleString()} recorded. Paid: Rs ${actualPaid.toLocaleString()}, Due to ${vendorName}: Rs ${remainingDues.toLocaleString()}`, 'success');
      } else {
        showToast(`Expense of Rs ${formData.amount.toLocaleString()} recorded from ${chosenAccount?.name || 'Account'}`, 'success');
      }
      setIsAddMode(false);
      setIsSavedExpensesOpen(false);
    } catch (err: any) {
      showToast("Error recording expense: " + (err?.message || "Failed"), "error");
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
      paidAmount: expense.paidAmount || (expense.paymentStatus === 'Unpaid' ? 0 : expense.amount),
      paymentStatus: expense.paymentStatus || 'Paid',
      paymentMode: expense.paymentMode || 'Cash',
      account_id: expense.account_id,
      vendor_id: expense.vendor_id,
      vendor_name: expense.vendor_name,
      notes: expense.notes || ''
    });
  };

  const handleOpenAddVendorModal = () => {
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

  const handleVendorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorFormData.name?.trim() || isSubmittingVendor) {
      if (!vendorFormData.name?.trim()) showToast("Vendor name is required", "warning");
      return;
    }

    setIsSubmittingVendor(true);
    try {
      if (editingVendor) {
        const success = await updateExpenseVendor(editingVendor.id, vendorFormData);
        if (success) {
          setIsVendorModalOpen(false);
          setEditingVendor(null);
        }
      } else {
        const success = await addExpenseVendor(vendorFormData as Omit<ExpenseVendor, 'id' | 'total_paid'>);
        if (success) {
          setIsVendorModalOpen(false);
        }
      }
    } catch (err: any) {
      showToast("Error saving vendor: " + (err?.message || "Failed"), "error");
    } finally {
      setIsSubmittingVendor(false);
    }
  };

  const handleDeleteVendor = (vendor: ExpenseVendor) => {
    const assessment = getDeleteAssessment('vendor', vendor.id);
    if (assessment.balance !== 0) {
      showToast(`Cannot delete vendor with outstanding balance of Rs ${Math.abs(assessment.balance).toLocaleString()}. Please settle the balance first.`, 'error');
      return;
    }
    if (assessment.hasHistory) {
      if (confirm(`Vendor "${vendor.name}" has ${assessment.details?.expCount} expense records. To preserve audit history, this vendor will be marked Inactive. Proceed?`)) {
        updateExpenseVendor(vendor.id, { isActive: false });
        showToast(`Vendor "${vendor.name}" marked Inactive`, 'info');
      }
      return;
    }
    if (confirm(`Are you sure you want to permanently delete vendor "${vendor.name}"?`)) {
      deleteExpenseVendor(vendor.id);
    }
  };

  const handleQuickCreateVendor = async () => {
    if (!quickVendorName.trim()) {
      showToast("Please enter vendor name", "warning");
      return;
    }

    const createdId = await addExpenseVendor({
      name: quickVendorName.trim(),
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
  };

  const handleDeleteExpense = async (id: string) => {
    if (!canDelete) {
      showToast("You do not have permission to delete expenses.", "warning");
      return;
    }
    const assessment = getDeleteAssessment('expense', id);
    if (assessment.isLocked) {
      showToast("Closed Period Lock: This expense belongs to a closed shift or locked business day.", "error");
      return;
    }
    if (confirm('Are you sure you want to delete this expense? Any paid amount will be refunded back to the account and vendor balance will be adjusted.')) {
      const success = await safeDeleteExpense(id);
      if (success) {
        showToast("Expense deleted and accounts adjusted", 'info');
      }
    }
  };

  const handleOpenPaymentModal = (vendor?: ExpenseVendor, prefilledAmount?: number, defaultType: 'payment' | 'refund' = 'payment') => {
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
      date: new Date().toISOString().split('T')[0],
      mode: 'Cash',
      account_id: defaultAcc,
      reference_no: '',
      note: ''
    });
    setIsPaymentModalOpen(true);
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingPayment) return;

    const amt = parseFloat(paymentFormData.amount as string);
    if (!amt || amt <= 0) {
      showToast("Please enter a valid amount", "warning");
      return;
    }

    if (!paymentFormData.vendor_id) {
      showToast("Please select a vendor / staff member", "warning");
      return;
    }

    if (!paymentFormData.account_id) {
      showToast("Please select a financial account", "warning");
      return;
    }

    const isRefund = paymentFormData.type === 'refund';
    const chosenAccount = accounts.find(a => a.id === paymentFormData.account_id);
    if (!isRefund && chosenAccount && chosenAccount.balance < amt) {
      if (!confirm(`Warning: Account "${chosenAccount.name}" has Rs ${chosenAccount.balance.toLocaleString()} which is less than payment amount Rs ${amt.toLocaleString()}. Proceed anyway?`)) {
        return;
      }
    }

    setIsSubmittingPayment(true);
    try {
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
      showToast("Error recording payment: " + (err?.message || "Failed"), "error");
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const handleDeleteVendorTx = async (txId: string) => {
    if (!canDelete) {
      showToast("Access Denied: Only Admins can delete vendor payment transactions.", "error");
      return;
    }
    if (!window.confirm("Are you sure you want to delete this vendor payment record? Financial accounts and vendor dues will be automatically restored.")) {
      return;
    }
    await deleteExpenseVendorTransaction(txId);
  };

  // Vendor Khata Ledger Generator
  const khataLedgerRows = useMemo<LedgerRow[]>(() => {
    const targetVendor = selectedVendor;
    if (!targetVendor) return [];

    const rows: LedgerRow[] = [];
    const vId = targetVendor.id;
    const vName = targetVendor.name.toLowerCase();

    // 1. Opening Balance Row
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

    // 2. All Expense Bills
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

    // 3. Direct Payments & Refunds
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

    rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let currentBalance = 0;
    const computedRows = rows.map(r => {
      currentBalance = currentBalance + r.debit - r.credit;
      return {
        ...r,
        runningBalance: currentBalance
      };
    });

    if (khataDateRange === 'all') return computedRows;

    const now = new Date();
    let startDateLimit = '';
    let endDateLimit = '';

    const todayStr = new Date().toISOString().split('T')[0];
    const yday = new Date();
    yday.setDate(yday.getDate() - 1);
    const ydayStr = yday.toISOString().split('T')[0];
    const d7 = new Date();
    d7.setDate(d7.getDate() - 6);
    const d7Str = d7.toISOString().split('T')[0];

    if (khataDateRange === 'today') {
      startDateLimit = todayStr;
      endDateLimit = todayStr;
    } else if (khataDateRange === 'yesterday') {
      startDateLimit = ydayStr;
      endDateLimit = ydayStr;
    } else if (khataDateRange === '7days') {
      startDateLimit = d7Str;
      endDateLimit = todayStr;
    } else if (khataDateRange === 'single_date') {
      startDateLimit = khataStartDate;
      endDateLimit = khataStartDate;
    } else if (khataDateRange === 'this_month') {
      startDateLimit = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    } else if (khataDateRange === 'last_month') {
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
      startDateLimit = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-01`;
      endDateLimit = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    } else if (khataDateRange === 'last_30_days') {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      startDateLimit = thirtyDaysAgo.toISOString().split('T')[0];
    } else if (khataDateRange === 'custom') {
      startDateLimit = khataStartDate;
      endDateLimit = khataEndDate;
    }

    return computedRows.filter(r => {
      if (r.type === 'Opening Balance') return true;
      const rDate = r.date ? (r.date.includes('T') ? r.date.split('T')[0] : r.date.slice(0, 10)) : '';
      if (startDateLimit && rDate < startDateLimit) return false;
      if (endDateLimit && rDate > endDateLimit) return false;
      return true;
    });
  }, [selectedVendor, expenses, expenseVendorTransactions, khataDateRange, khataStartDate, khataEndDate]);

  // WhatsApp Statement Link Generator
  const handleShareWhatsAppStatement = (vendor: ExpenseVendor) => {
    const phoneClean = (vendor.phone || '').replace(/[^0-9]/g, '');
    if (!phoneClean) {
      showToast("Vendor phone number is missing", "warning");
      return;
    }

    const companyName = settings.general?.companyName || 'Mooco Dairy';
    const totalBilled = vendor.total_billed || 0;
    const totalPaid = vendor.total_paid || 0;
    const pendingDues = vendor.pending_balance || 0;

    let text = `*${companyName} - Vendor Account Statement*\n`;
    text += `To: *${vendor.name}* (${vendor.service_type || 'Vendor'})\n`;
    text += `Date: ${new Date().toLocaleDateString('en-GB')}\n\n`;
    text += `📊 *Summary*\n`;
    text += `• Total Billed: Rs ${totalBilled.toLocaleString()}\n`;
    text += `• Total Paid: Rs ${totalPaid.toLocaleString()}\n`;
    text += `• *Net Outstanding Dues:* Rs ${pendingDues.toLocaleString()}\n\n`;
    text += `*Last Activity:*\n`;
    
    khataLedgerRows.slice(-5).forEach(r => {
      text += `• ${r.date} | ${r.description} | Bill: Rs ${r.debit.toLocaleString()} | Paid: Rs ${r.credit.toLocaleString()}\n`;
    });

    text += `\nThank you!`;

    const encoded = encodeURIComponent(text);
    const url = `https://wa.me/${phoneClean.startsWith('0') ? '92' + phoneClean.slice(1) : phoneClean}?text=${encoded}`;
    window.open(url, '_blank');
  };

  const handlePrintStatement = () => {
    window.print();
  };

  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return '-';
    const cleanStr = dateStr.split('T')[0];
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

  return (
    <div className="space-y-2.5 sm:space-y-4 pb-20 max-w-7xl mx-auto px-2 sm:px-4">
      {/* Top Tab Switcher */}
      <div className="flex bg-slate-200/70 dark:bg-slate-800 p-1 rounded-xl sm:rounded-2xl max-w-md mx-auto w-full border border-slate-300/60 dark:border-slate-700 shadow-2xs">
        <button 
          onClick={() => switchTab('transactions')} 
          className={`flex-1 py-1.5 rounded-lg sm:rounded-xl text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer ${
            activeTab === 'transactions' 
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' 
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Receipt size={14} className={activeTab === 'transactions' ? 'text-lime-600' : 'text-slate-400'} />
          <span>Expense Entries</span>
        </button>
        <button 
          onClick={() => switchTab('vendors')} 
          className={`flex-1 py-1.5 rounded-lg sm:rounded-xl text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer ${
            activeTab === 'vendors' 
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' 
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Users size={14} className={activeTab === 'vendors' ? 'text-lime-600' : 'text-slate-400'} />
          <span>Vendors Directory</span>
        </button>
      </div>

      {/* Ultra-Compact 1-Row Summary Cards */}
      {activeTab === 'transactions' && (
        <div className="grid grid-cols-4 gap-1.5 sm:gap-3">
          <div className="bg-white dark:bg-slate-900 p-2 sm:p-3 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col justify-center">
            <span className="text-[9px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-wider truncate">Total</span>
            <h3 className="text-xs sm:text-lg font-black text-slate-900 dark:text-slate-100 font-mono mt-0.5 truncate">
              <span className="sm:hidden">Rs {(totalExpense > 99999 ? (totalExpense/1000).toFixed(0) + 'k' : totalExpense.toLocaleString())}</span>
              <span className="hidden sm:inline">Rs {totalExpense.toLocaleString()}</span>
            </h3>
            <span className="text-[9px] text-slate-400 font-medium hidden sm:block mt-0.5">{filteredExpenses.length} txns</span>
          </div>

          <div className="bg-white dark:bg-slate-900 p-2 sm:p-3 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col justify-center">
            <span className="text-[9px] sm:text-[11px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider truncate">Cash</span>
            <h3 className="text-xs sm:text-lg font-black text-amber-800 dark:text-amber-300 font-mono mt-0.5 truncate">
              <span className="sm:hidden">Rs {(cashExpense > 99999 ? (cashExpense/1000).toFixed(0) + 'k' : cashExpense.toLocaleString())}</span>
              <span className="hidden sm:inline">Rs {cashExpense.toLocaleString()}</span>
            </h3>
            <span className="text-[9px] text-amber-600 dark:text-amber-400 font-bold hidden sm:block mt-0.5">{totalExpense > 0 ? ((cashExpense/totalExpense)*100).toFixed(0) : 0}% total</span>
          </div>

          <div className="bg-white dark:bg-slate-900 p-2 sm:p-3 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col justify-center">
            <span className="text-[9px] sm:text-[11px] font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider truncate">Digital</span>
            <h3 className="text-xs sm:text-lg font-black text-blue-800 dark:text-blue-300 font-mono mt-0.5 truncate">
              <span className="sm:hidden">Rs {(onlineExpense > 99999 ? (onlineExpense/1000).toFixed(0) + 'k' : onlineExpense.toLocaleString())}</span>
              <span className="hidden sm:inline">Rs {onlineExpense.toLocaleString()}</span>
            </h3>
            <span className="text-[9px] text-blue-500 font-medium hidden sm:block mt-0.5">Accounts</span>
          </div>

          <div className={`p-2 sm:p-3 rounded-xl sm:rounded-2xl border shadow-2xs flex flex-col justify-center ${
            totalOutstandingVendorDues > 0 ? 'bg-rose-50/40 dark:bg-rose-950/30 border-rose-200/80 dark:border-rose-900' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
          }`}>
            <span className={`text-[9px] sm:text-[11px] font-bold uppercase tracking-wider truncate ${totalOutstandingVendorDues > 0 ? 'text-rose-700 dark:text-rose-400' : 'text-slate-400'}`}>
              Dues
            </span>
            <h3 className={`text-xs sm:text-lg font-black font-mono mt-0.5 truncate ${totalOutstandingVendorDues > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-200'}`}>
              <span className="sm:hidden">Rs {(totalOutstandingVendorDues > 99999 ? (totalOutstandingVendorDues/1000).toFixed(0) + 'k' : totalOutstandingVendorDues.toLocaleString())}</span>
              <span className="hidden sm:inline">Rs {totalOutstandingVendorDues.toLocaleString()}</span>
            </h3>
            <span className="text-[9px] text-rose-500 font-medium hidden sm:block mt-0.5">{expenseVendors.filter(v => (v.pending_balance || 0) > 0).length} parties</span>
          </div>
        </div>
      )}

      {/* 1. Transactions Tab */}
      {activeTab === 'transactions' && (
        <ExpenseTransactionsTab
          expenses={expenses}
          filteredExpenses={filteredExpenses}
          expenseVendors={expenseVendors}
          categoryTree={categoryTree}
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
          handleOpenAddModal={handleOpenAddModal}
          handleEditExpense={handleEditExpense}
          handleDeleteExpense={handleDeleteExpense}
          savedExpenses={savedExpenses}
          onOpenSavedExpenses={() => setIsSavedExpensesOpen(true)}
          onSaveRecorded={saveRecordedExpense}
          setIsCategoryModalOpen={setIsCategoryModalOpen}
          setSelectedVendorId={setSelectedVendorId}
          setActiveTab={setActiveTab}
          setIsMobileLedgerOpen={setIsMobileLedgerOpen}
          formatDateDisplay={formatDateDisplay}
        />
      )}

      {/* 2. Vendors Tab */}
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
          canDelete={canDelete}
          handleDeleteVendorTransaction={handleDeleteVendorTx}
        />
      )}

      {/* --- MODAL 1: CATEGORIES --- */}
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

      <SavedExpensesModal
        isOpen={isSavedExpensesOpen}
        onClose={() => setIsSavedExpensesOpen(false)}
        savedExpenses={savedExpenses}
        accounts={accounts}
        onUse={handleUseSavedExpense}
        onDelete={deleteSavedExpense}
      />

      {/* --- MODAL 2: RECORD / EDIT EXPENSE --- */}
      <ExpenseFormModal
        isOpen={isAddMode}
        onClose={() => setIsAddMode(false)}
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
        accounts={accounts}
        settings={settings}
        rememberExpense={rememberExpense}
        setRememberExpense={setRememberExpense}
        rememberName={rememberName}
        setRememberName={setRememberName}
      />

      {/* --- MODAL 3: ADD / EDIT VENDOR --- */}
      <ExpenseVendorModal
        isOpen={isVendorModalOpen}
        onClose={() => setIsVendorModalOpen(false)}
        vendorFormData={vendorFormData}
        setVendorFormData={setVendorFormData}
        handleVendorSubmit={handleVendorSubmit}
        isSubmittingVendor={isSubmittingVendor}
        editingVendor={editingVendor}
      />

      {/* --- MODAL 4: PAY VENDOR / REFUND --- */}
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

      {/* Mobile Floating Action Button (FAB) for instant expense recording */}
      {canCreate && activeTab === 'transactions' && (
        <button
          onClick={handleOpenAddModal}
          className="md:hidden fixed bottom-6 right-4 z-40 bg-lime-600 hover:bg-lime-700 active:scale-95 text-white px-4 py-3 rounded-2xl shadow-xl shadow-lime-600/40 flex items-center gap-2 text-xs font-black cursor-pointer border border-lime-500/50 animate-in zoom-in-95 duration-150"
          title="Record New Expense"
        >
          <Plus size={18} className="stroke-[3]" />
          <span>Record Expense</span>
        </button>
      )}
    </div>
  );
};

export default Expenses;
