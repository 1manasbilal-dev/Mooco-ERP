import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { Supplier, RateType } from '../types';
import { 
  Users, Filter, DollarSign, MapPin, Phone, 
  Search, X, FileText, Edit, UserCheck,
  Wallet, Plus, Save, Trash2, AlertTriangle, Package,
  MessageCircle, Truck, ArrowLeft, ChevronDown,
  Info, Loader2, Archive, RotateCcw
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { BalanceAmount, CashPaymentDays, LedgerRangeBar } from '../components/suppliers/SupplierLedgerPanels';
import { MilkSupplierReportPanel } from '../components/suppliers/MilkSupplierReportPanel';
import { SupplierLedgerPrintModal } from '../components/suppliers/SupplierLedgerPrintModal';
import {
  DatePreset,
  buildPaymentRegister,
  buildSupplierStatement,
  printPaymentRegister,
  printPaymentVoucher,
  rangeForPreset,
  balancePhrase,
  formatLedgerDate,
  whatsappStatementText
} from '../lib/supplierStatement';
import {
  MilkGroupMode,
  buildMilkSupplierReport,
  formatMilkQty,
  formatMilkRate,
  milkReportCaption,
  milkReportSheetHtml,
  milkSlipFilename,
  printMilkSupplierReport,
  shareMilkReportImage
} from '../lib/milkSupplierReport';
import { formatCurrency } from '../lib/formatters';
import { confirmAction } from '../components/ui/ConfirmDialog';

const Suppliers: React.FC = () => {
  const { 
    suppliers, purchases, materialPurchases, supplierTransactions, 
    addSupplier, updateSupplier, 
    recordSupplierPayment, deleteSupplierTransaction,
    accounts = [], settings, items = [],
    activeShiftSession,
    canPerform,
    getDeleteAssessment,
    safeDeleteSupplier,
    reactivateEntity
  } = useDairy();
  const { showToast } = useToast();

  const isMilkVarietyActive = (variety: string) => {
    const v = (variety || '').toLowerCase();
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

  const canCreate = canPerform('suppliers', 'create');
  const canEdit = canPerform('suppliers', 'edit');
  const canPay = canPerform('suppliers', 'payment');
  
  const location = useLocation();
  const navigate = useNavigate();

  const [activeSupplierId, setActiveSupplierId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('id') || null;
  });
  const [showMobileInfo, setShowMobileInfo] = useState(false);

  const selectSupplier = (id: string | null) => {
    setActiveSupplierId(id);
    if (id) {
      navigate(`/suppliers?id=${encodeURIComponent(id)}`);
    } else {
      navigate('/suppliers');
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const targetId = params.get('id') || (location.state as any)?.supplierId;
    if (targetId) {
      setActiveSupplierId(targetId);
    } else {
      setActiveSupplierId(null);
    }
  }, [location.search, location.state]);

  // Selection requested by the Command Palette or another screen.
  useEffect(() => {
    const handleSelect = (e: any) => {
      const targetId = e?.detail?.supplierId;
      if (targetId) {
        selectSupplier(targetId);
      }
    };
    window.addEventListener('mooco-select-supplier', handleSelect);
    return () => window.removeEventListener('mooco-select-supplier', handleSelect);
  }, []);

  const handleBackToList = () => {
    selectSupplier(null);
  };

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [isPhoneWhatsapp, setIsPhoneWhatsapp] = useState<boolean>(true);
  
  const [selectedPaymentSupplierId, setSelectedPaymentSupplierId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [ledgerSearchTerm, setLedgerSearchTerm] = useState('');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState<'All' | 'Milk' | 'Material' | 'Payment'>('All');
  const [ledgerPreset, setLedgerPreset] = useState<DatePreset>('all');
  const [ledgerFrom, setLedgerFrom] = useState('');
  const [ledgerTo, setLedgerTo] = useState('');
  const [ledgerView, setLedgerView] = useState<'statement' | 'milk' | 'payments'>('statement');
  const [milkGroup, setMilkGroup] = useState<MilkGroupMode>('milk');
  const [milkTypeFilter, setMilkTypeFilter] = useState('all');
  const [milkShiftFilter, setMilkShiftFilter] = useState('all');
  const [sharingMilkImage, setSharingMilkImage] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [listView, setListView] = useState<'suppliers' | 'payments'>('suppliers');
  const [registerPreset, setRegisterPreset] = useState<DatePreset>('today');
  const [registerFrom, setRegisterFrom] = useState('');
  const [registerTo, setRegisterTo] = useState('');

  const [deleteConfig, setDeleteConfig] = useState<{isOpen: boolean, id: string | null, name: string, isBulk: boolean}>({
    isOpen: false, id: null, name: '', isBulk: false
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterType, setFilterType] = useState<string>('All');
  const [filterBalance, setFilterBalance] = useState<'All' | 'Payable' | 'Advance' | 'Settled'>('All');
  const [filterActiveStatus, setFilterActiveStatus] = useState<'Active' | 'Inactive' | 'All'>('Active');

  const [paymentData, setPaymentData] = useState({
    amount: '',
    date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
    mode: 'Cash',
    accountId: '',
    type: 'Payment', // Payment (Clear dues) or Advance (Loan)
    note: ''
  });

  const getDefaultSupplierAccount = (mode: string) => {
    const isCash = !mode || mode.toLowerCase().includes('cash');
    if (isCash) {
      return (
        activeShiftSession?.account_id ||
        activeShiftSession?.drawer_id ||
        settings?.financial?.defaultCashAccountId ||
        accounts.find(a => a.type === 'Cash' && a.isActive !== false)?.id ||
        accounts.find(a => a.isActive !== false)?.id ||
        ''
      );
    } else {
      return (
        settings?.financial?.defaultDigitalAccountId ||
        accounts.find(a => (a.type === 'Bank' || a.type === 'Wallet') && a.isActive !== false)?.id ||
        accounts.find(a => a.isActive !== false)?.id ||
        ''
      );
    }
  };

  const [formData, setFormData] = useState<Partial<Supplier>>({
    name: '',
    phone: '',
    whatsapp: '',
    village: '',
    address: '',
    city: '',
    rate_type: RateType.FAT_SNF,
    default_rate: 0,
    pending_balance: 0,
    supplier_types: ['Milk'],
    notes: '',
    isActive: true,
    default_milk_type: ''
  });

  const activeSupplier = useMemo(() => {
    return (suppliers || []).find(s => s.id === activeSupplierId) || null;
  }, [suppliers, activeSupplierId]);

  useEffect(() => {
    setMilkTypeFilter('all');
    setMilkShiftFilter('all');
  }, [activeSupplierId]);

  const activePaymentSupplier = (suppliers || []).find(s => s.id === selectedPaymentSupplierId);

  const totalSuppliers = (suppliers || []).length;
  const activeSuppliers = (suppliers || []).filter(s => s?.isActive !== false).length;
  const totalPayable = (suppliers || []).reduce((sum, s) => sum + (Number(s?.pending_balance) > 0 ? Number(s.pending_balance) : 0), 0);
  const totalAdvance = (suppliers || []).reduce((sum, s) => sum + (Number(s?.pending_balance) < 0 ? Math.abs(Number(s.pending_balance)) : 0), 0);

  const filteredSuppliers = useMemo(() => {
    return (suppliers || []).filter(s => {
      if (!s) return false;
      const query = searchTerm.toLowerCase().trim();
      const matchesSearch = !query || 
        (s.name || '').toLowerCase().includes(query) || 
        (s.village && String(s.village).toLowerCase().includes(query)) ||
        (s.city && String(s.city).toLowerCase().includes(query)) ||
        (s.phone && String(s.phone).includes(query));
      
      if (!matchesSearch) return false;

      const matchesType = filterType === 'All' || (s.supplier_types && s.supplier_types.includes(filterType));
      if (!matchesType) return false;

      const bal = Number(s.pending_balance) || 0;
      if (filterBalance === 'Payable' && bal <= 0) return false;
      if (filterBalance === 'Advance' && bal >= 0) return false;
      if (filterBalance === 'Settled' && Math.abs(bal) > 0.01) return false;

      if (filterActiveStatus === 'Active' && s.isActive === false) return false;
      if (filterActiveStatus === 'Inactive' && s.isActive !== false) return false;

      return true;
    });
  }, [suppliers, searchTerm, filterType, filterBalance, filterActiveStatus]);

  const ledgerRange = useMemo(
    () => rangeForPreset(ledgerPreset, ledgerFrom, ledgerTo),
    [ledgerPreset, ledgerFrom, ledgerTo]
  );
  const registerRange = useMemo(
    () => rangeForPreset(registerPreset, registerFrom, registerTo),
    [registerPreset, registerFrom, registerTo]
  );
  const accountNames = useMemo(() => {
    const names: Record<string, string> = {};
    (accounts || []).forEach(account => {
      if (account?.id) names[account.id] = account.name;
    });
    return names;
  }, [accounts]);

  const statementCompany = useMemo(() => ({
    name: settings?.general?.companyName || 'Mooco Dairy',
    address: settings?.general?.address || '',
    phone: settings?.general?.phone || ''
  }), [settings]);

  // Khata statement plus date-wise cash payments.
  const ledgerDetails = useMemo(() => {
    if (!activeSupplier) {
      return buildSupplierStatement({
        supplier: { id: '', name: '', pendingBalance: 0 },
        from: ledgerRange.from,
        to: ledgerRange.to
      });
    }
    return buildSupplierStatement({
      supplier: {
        id: activeSupplier.id,
        name: activeSupplier.name,
        phone: activeSupplier.phone,
        whatsapp: activeSupplier.whatsapp,
        village: activeSupplier.village,
        city: activeSupplier.city,
        address: activeSupplier.address,
        pendingBalance: Number(activeSupplier.pending_balance) || 0
      },
      purchases,
      materialPurchases,
      transactions: supplierTransactions,
      from: ledgerRange.from,
      to: ledgerRange.to,
      kind: ledgerTypeFilter,
      query: ledgerSearchTerm,
      accountNames
    });
  }, [activeSupplier, purchases, materialPurchases, supplierTransactions, ledgerTypeFilter, ledgerSearchTerm, ledgerRange, accountNames]);

  const milkShiftOrder = useMemo(() => {
    const list = settings?.general?.shifts;
    return Array.isArray(list) && list.length > 0 ? list.map(shift => String(shift)) : ['Morning', 'Evening'];
  }, [settings]);

  const milkReport = useMemo(() => {
    if (!activeSupplier) {
      return buildMilkSupplierReport({
        supplierId: '',
        from: ledgerRange.from,
        to: ledgerRange.to,
        mode: milkGroup,
        milkType: milkTypeFilter,
        shift: milkShiftFilter,
        shiftOrder: milkShiftOrder
      });
    }
    return buildMilkSupplierReport({
      purchases,
      supplierId: activeSupplier.id,
      from: ledgerRange.from,
      to: ledgerRange.to,
      mode: milkGroup,
      milkType: milkTypeFilter,
      shift: milkShiftFilter,
      shiftOrder: milkShiftOrder
    });
  }, [activeSupplier, purchases, ledgerRange, milkGroup, milkTypeFilter, milkShiftFilter, milkShiftOrder]);

  const paymentRegister = useMemo(() => buildPaymentRegister({
    suppliers: (suppliers || []).map(supplier => ({
      id: supplier.id,
      name: supplier.name,
      phone: supplier.phone,
      whatsapp: supplier.whatsapp,
      village: supplier.village,
      city: supplier.city,
      address: supplier.address,
      pendingBalance: Number(supplier.pending_balance) || 0
    })),
    purchases,
    materialPurchases,
    transactions: supplierTransactions,
    from: registerRange.from,
    to: registerRange.to,
    query: searchTerm,
    accountNames
  }), [suppliers, purchases, materialPurchases, supplierTransactions, registerRange, searchTerm, accountNames]);

  const handleOpenAddForm = () => {
    setEditingSupplier(null);
    setIsPhoneWhatsapp(true);
    setFormData({ 
      name: '', phone: '', whatsapp: '', village: '', address: '', city: '',
      rate_type: RateType.FAT_SNF, default_rate: 0, pending_balance: 0,
      supplier_types: ['Milk'], notes: '', isActive: true,
      default_milk_type: ''
    });
    setIsFormOpen(true);
  };

  const handleEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setIsPhoneWhatsapp(Boolean(supplier.whatsapp && supplier.whatsapp === supplier.phone));
    setFormData({
      ...supplier,
      phone: supplier.phone || '',
      whatsapp: supplier.whatsapp || '',
      village: supplier.village || '',
      address: supplier.address || '',
      city: supplier.city || '',
      notes: supplier.notes || '',
      default_milk_type: supplier.default_milk_type || ''
    });
    setIsFormOpen(true);
  };

  const initiateDelete = (supplier: Supplier) => {
    setDeleteConfig({ isOpen: true, id: supplier.id, name: supplier.name, isBulk: false });
  };

  const initiateBulkDelete = () => {
    setDeleteConfig({ isOpen: true, id: null, name: `${selectedIds.size} suppliers`, isBulk: true });
  };

  const handleSmartDelete = async (action: 'hard_delete' | 'deactivate' | 'settle_discount') => {
    if (!deleteConfig.id) return;
    const targetId = deleteConfig.id;
    const success = await safeDeleteSupplier(targetId, action);
    if (success) {
      if (activeSupplierId === targetId) {
        setActiveSupplierId(null);
      }
      setSelectedIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(targetId);
        return newSet;
      });
      setDeleteConfig({ isOpen: false, id: null, name: '', isBulk: false });
    }
  };

  const handleBulkDeactivate = async () => {
    for (const id of Array.from(selectedIds)) {
      await safeDeleteSupplier(id, 'deactivate');
    }
    setSelectedIds(new Set());
    setDeleteConfig({ isOpen: false, id: null, name: '', isBulk: false });
  };

  const toggleSelectAll = (isChecked: boolean) => {
    if (isChecked) {
      setSelectedIds(new Set(filteredSuppliers.map(s => s.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const isSubmittingSupplierRef = useRef(false);
  const isSubmittingSupplierPaymentRef = useRef(false);

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = formData.name?.trim();
    if (!trimmedName) {
      showToast('Supplier ka naam zaroori hai', 'warning');
      return;
    }
    if (isSubmitting || isSubmittingSupplierRef.current) return;
    
    const trimmedPhone = (formData.phone || '').trim();
    const finalWhatsApp = isPhoneWhatsapp ? trimmedPhone : (formData.whatsapp?.trim() || '');
    const parsedRate = parseFloat(formData.default_rate?.toString() || '0') || 0;

    const payload = {
      ...formData,
      name: trimmedName,
      phone: trimmedPhone || '',
      whatsapp: finalWhatsApp || undefined,
      village: formData.village?.trim() || undefined,
      address: formData.address?.trim() || undefined,
      city: formData.city?.trim() || undefined,
      default_rate: parsedRate,
      rate_type: parsedRate > 0 ? RateType.FIXED : (formData.rate_type || RateType.FAT_SNF),
      pending_balance: parseFloat(formData.pending_balance?.toString() || '0') || 0,
      notes: formData.notes?.trim() || undefined,
      isActive: formData.isActive !== false
    };
    
    isSubmittingSupplierRef.current = true;
    setIsSubmitting(true);
    try {
      if (editingSupplier) {
        // The live balance moves only through purchases, payments and returns; an edit must never
        // write it back (a purchase posted while the form was open would be wiped out).
        const { pending_balance: _ignoredBalance, ...profileOnly } = payload;
        const ok = await updateSupplier(editingSupplier.id, profileOnly);
        if (!ok) return;
        showToast('Supplier update ho gaya', 'success');
      } else {
        const ok = await addSupplier(payload as Omit<Supplier, 'id'>);
        if (!ok) return;
        showToast('Supplier add ho gaya', 'success');
      }

      setIsFormOpen(false);
      setEditingSupplier(null);
    } catch (err: any) {
      showToast('Supplier save nahi hua: ' + (err?.message || 'dobara koshish karein'), 'error');
    } finally {
      setIsSubmitting(false);
      setTimeout(() => {
        isSubmittingSupplierRef.current = false;
      }, 400);
    }
  };

  const handleOpenPaymentModal = (supplier: Supplier) => {
    setSelectedPaymentSupplierId(supplier.id);
    const initialMode = 'Cash';
    setPaymentData({
      amount: supplier.pending_balance && supplier.pending_balance > 0 ? supplier.pending_balance.toString() : '',
      date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
      mode: initialMode,
      accountId: getDefaultSupplierAccount(initialMode),
      type: 'Payment',
      note: ''
    });
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePaymentSupplier || !paymentData.amount || isSubmittingPayment || isSubmittingSupplierPaymentRef.current) return;
    
    const amountNum = parseFloat(paymentData.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      showToast('Sahi payment amount likhein', 'warning');
      return;
    }

    const activeAccounts = (accounts || []).filter(a => a.isActive !== false);
    if (activeAccounts.length === 0) {
      showToast("Koi Cash / Bank account mojood nahi hy. Pehle 'Bank & Cash' module men account banayein.", "warning");
      return;
    }

    if (!paymentData.accountId) {
      showToast("Baraye meherbani Payment Account select karein ya Settings men default account set karein.", "warning");
      return;
    }

    isSubmittingSupplierPaymentRef.current = true;
    setIsSubmittingPayment(true);
    try {
      const ok = await recordSupplierPayment(
        activePaymentSupplier.id,
        amountNum,
        paymentData.date,
        paymentData.mode,
        paymentData.type as any,
        paymentData.note,
        paymentData.accountId || undefined
      );
      if (!ok) return;

      showToast('Payment record ho gayi', 'success');
      setSelectedPaymentSupplierId(null);
    } catch (err: any) {
      showToast('Payment record nahi hui: ' + (err?.message || 'dobara koshish karein'), 'error');
    } finally {
      setIsSubmittingPayment(false);
      setTimeout(() => {
        isSubmittingSupplierPaymentRef.current = false;
      }, 400);
    }
  };

  const toggleSupplierType = (type: string) => {
    const currentTypes = formData.supplier_types || [];
    if (currentTypes.includes(type)) {
      setFormData({ ...formData, supplier_types: currentTypes.filter(t => t !== type) });
    } else {
      setFormData({ ...formData, supplier_types: [...currentTypes, type] });
    }
  };

  const handleDeleteTransaction = async (id: string) => {
     const tx: any = supplierTransactions.find(t => t.id === id);
     const supplier = tx ? suppliers.find(s => s.id === tx.supplier_id) : undefined;
     const amount = Number(tx?.amount || 0);
     const isWaiver = Boolean(tx?.details?.waiver) || /waiver|discount/i.test(String(tx?.mode || tx?.details?.mode || ''));
     const accountId = tx?.account_id || tx?.details?.account_id;
     const account = accountId ? accounts.find((a: any) => a.id === accountId) : undefined;
     const balanceNow = Number(supplier?.pending_balance || 0);
     const balanceAfter = balanceNow + amount;
     const balanceLabel = (value: number) => `${formatCurrency(Math.abs(value))} ${value > 0 ? '(dena hai)' : value < 0 ? '(advance)' : ''}`.trim();
     const confirmed = await confirmAction({
       title: `Payment ${formatCurrency(amount)} delete karein?`,
       consequences: [
         `${supplier?.name || 'Supplier'} ka khaata: ${balanceLabel(balanceNow)} → ${balanceLabel(balanceAfter)}`,
         isWaiver ? 'Ye maafi (waiver) thi, koi account nahi badlega' : account ? `${formatCurrency(amount)} wapas "${account.name}" mein aayenge` : 'Kisi account mein paisa wapas nahi aayega',
         'Ye wapas nahi hoga.',
       ],
     });
     if (!confirmed) return;
     const ok = await deleteSupplierTransaction(id);
     if (ok) showToast("Entry delete ho gayi", "success");
  };

  const statementSupplier = (supplier: Supplier) => ({
    id: supplier.id,
    name: supplier.name,
    phone: supplier.phone,
    whatsapp: supplier.whatsapp,
    village: supplier.village,
    city: supplier.city,
    address: supplier.address,
    pendingBalance: Number(supplier.pending_balance) || 0
  });

  const warnIfPrintBlocked = (opened: boolean) => {
    if (!opened) showToast('Statement print karne ke liye browser mein popups allow karein.', 'warning');
  };

  const handlePrintLedger = () => {
    if (!activeSupplier) return;
    setIsPrintModalOpen(true);
  };

  const handlePrintSupplierPayments = () => {
    if (!activeSupplier) return;
    warnIfPrintBlocked(printPaymentRegister({
      company: statementCompany,
      title: `Payments — ${activeSupplier.name}`,
      period: ledgerDetails.rangeLabel,
      days: ledgerDetails.paymentDays,
      net: ledgerDetails.cashOut - ledgerDetails.cashIn,
      cashOut: ledgerDetails.cashOut,
      cashIn: ledgerDetails.cashIn
    }));
  };

  const milkSlipInput = () => {
    if (!activeSupplier) return null;
    return {
      company: statementCompany,
      supplier: statementSupplier(activeSupplier),
      report: milkReport,
      balanceLabel: balancePhrase(ledgerDetails.closingBalance)
    };
  };

  const handlePrintMilkSlip = () => {
    const input = milkSlipInput();
    if (!input) return;
    warnIfPrintBlocked(printMilkSupplierReport(input));
  };

  const handleShareMilkImage = async () => {
    const input = milkSlipInput();
    if (!input || sharingMilkImage) return;
    setSharingMilkImage(true);
    try {
      const result = await shareMilkReportImage({
        innerHtml: milkReportSheetHtml(input),
        filename: milkSlipFilename(input.supplier.name, ledgerRange.from, ledgerRange.to),
        caption: milkReportCaption({
          companyName: statementCompany.name,
          supplierName: input.supplier.name,
          report: milkReport,
          balanceLabel: input.balanceLabel
        }),
        phone: input.supplier.whatsapp || input.supplier.phone
      });
      if (result === 'shared') showToast('Milk slip bhejne ke liye tayyar hai.', 'success');
      else if (result === 'downloaded') showToast('Milk slip ki image save ho gayi. WhatsApp mein attach karein.', 'success');
    } catch {
      showToast('Milk slip ki image nahi ban saki.', 'error');
    } finally {
      setSharingMilkImage(false);
    }
  };

  const handlePrintActiveView = () => {
    if (ledgerView === 'payments') handlePrintSupplierPayments();
    else if (ledgerView === 'milk') handlePrintMilkSlip();
    else handlePrintLedger();
  };

  const handlePrintVoucher = (line: Parameters<typeof printPaymentVoucher>[0]['line']) => {
    warnIfPrintBlocked(printPaymentVoucher({
      company: statementCompany,
      line,
      balancePhrase: activeSupplier ? balancePhrase(Number(activeSupplier.pending_balance) || 0) : undefined
    }));
  };

  const handlePrintRegister = () => {
    warnIfPrintBlocked(printPaymentRegister({
      company: statementCompany,
      title: 'Supplier Payment Register',
      period: paymentRegister.rangeLabel,
      days: paymentRegister.days,
      net: paymentRegister.net,
      cashOut: paymentRegister.cashOut,
      cashIn: paymentRegister.cashIn,
      showSupplier: true
    }));
  };

  // The print modal passes the statement for the range chosen there; without it the page range is used.
  const handleSendWhatsAppReminder = (supplier: Supplier, chosenStatement?: ReturnType<typeof buildSupplierStatement>) => {
    const cleanPhone = (supplier.whatsapp || supplier.phone || '').replace(/[^0-9]/g, '');
    if (!cleanPhone) {
      showToast('Supplier ka sahi phone number nahi hai', 'warning');
      return;
    }

    const formattedPhone = cleanPhone.startsWith('0')
      ? `92${cleanPhone.slice(1)}`
      : cleanPhone.startsWith('92')
      ? cleanPhone
      : `92${cleanPhone}`;

    const msg = whatsappStatementText({
      companyName: statementCompany.name,
      supplier: statementSupplier(supplier),
      statement: chosenStatement || buildSupplierStatement({
        supplier: statementSupplier(supplier),
        purchases,
        materialPurchases,
        transactions: supplierTransactions,
        from: ledgerRange.from,
        to: ledgerRange.to,
        accountNames
      })
    });

    window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs sm:text-sm font-medium text-slate-900 shadow-2xs focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20 outline-none transition-all";
  const labelClass = "block text-xs font-bold text-slate-700 mb-1";

  return (
    <div className="space-y-4 pb-16">
      
      {activeSupplier ? (
        <div className="space-y-3">
          
          <div className="block lg:hidden space-y-2.5">
            <div className="flex items-center justify-between bg-white p-2.5 rounded-2xl border border-slate-200/90 shadow-2xs">
              <button 
                onClick={handleBackToList}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all active:scale-95 cursor-pointer"
              >
                <ArrowLeft size={14} />
                <span>All Suppliers</span>
              </button>

              <div className="flex items-center gap-1.5">
                <button aria-label="Share WhatsApp Statement"
                  onClick={() => handleSendWhatsAppReminder(activeSupplier)}
                  className="p-2 rounded-xl text-emerald-600 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-all cursor-pointer"
                  title="Share WhatsApp Statement"
                >
                  <MessageCircle size={15} />
                </button>

                <button aria-label="Edit Supplier"
                  onClick={() => handleEdit(activeSupplier)}
                  className="p-2 rounded-xl text-slate-600 bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-all cursor-pointer"
                  title="Edit Supplier"
                >
                  <Edit size={15} />
                </button>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-3xl p-4 sm:p-5 shadow-xs border border-slate-200/80 dark:border-slate-800 space-y-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate">{activeSupplier.name}</h2>
                    <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-bold uppercase tracking-wider ${
                      activeSupplier.isActive !== false ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40' : 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-800/40'
                    }`}>
                      {activeSupplier.isActive !== false ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-400 font-medium mt-0.5">
                    {activeSupplier.village ? `${activeSupplier.village}` : ''}
                    {activeSupplier.city ? (activeSupplier.village ? ` • ${activeSupplier.city}` : activeSupplier.city) : 'Dairy Supplier'}
                  </p>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {(activeSupplier.supplier_types || ['Milk']).map(t => (
                    <span key={t} className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-100 dark:border-slate-700/60 flex items-baseline justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-400 tracking-wider block">
                    Current Net Balance
                  </span>
                  <span className={`text-2xl sm:text-3xl font-black font-mono tracking-tight ${
                    Math.abs(activeSupplier.pending_balance) < 0.01 ? 'text-slate-700 dark:text-slate-300' :
                    activeSupplier.pending_balance > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                  }`}>
                    {formatCurrency(Math.abs(activeSupplier.pending_balance))}
                  </span>
                </div>
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-xl uppercase ${
                  Math.abs(activeSupplier.pending_balance) < 0.01 ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400' :
                  activeSupplier.pending_balance > 0 ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40'
                }`}>
                  {Math.abs(activeSupplier.pending_balance) < 0.01 ? 'Settled (0)' : activeSupplier.pending_balance > 0 ? 'Payable (Dena Hai)' : 'Advance Paid'}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
                {ledgerView === 'payments' ? (
                  <>
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl border border-slate-100 dark:border-slate-700/50">
                      <span className="text-[9px] text-slate-400 block font-semibold">Cash</span>
                      <span className="font-mono font-bold text-emerald-600 text-[11px]">Rs {(ledgerDetails.cashPaid / 1000).toFixed(1)}k</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl border border-slate-100 dark:border-slate-700/50">
                      <span className="text-[9px] text-slate-400 block font-semibold">Bank</span>
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-[11px]">Rs {(ledgerDetails.otherPaid / 1000).toFixed(1)}k</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl border border-slate-100 dark:border-slate-700/50">
                      <span className="text-[9px] text-slate-400 block font-semibold">Refund</span>
                      <span className="font-mono font-bold text-amber-600 text-[11px]">Rs {(ledgerDetails.cashIn / 1000).toFixed(1)}k</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl border border-slate-100 dark:border-slate-700/50">
                      <span className="text-[9px] text-slate-400 block font-semibold">Net</span>
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-[11px]">Rs {((ledgerDetails.cashOut - ledgerDetails.cashIn) / 1000).toFixed(1)}k</span>
                    </div>
                  </>
                ) : ledgerView === 'milk' ? (
                  <>
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl border border-slate-100 dark:border-slate-700/50">
                      <span className="text-[9px] text-slate-400 block font-semibold">Litres</span>
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-[11px]">{formatMilkQty(milkReport.litres)} L</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl border border-slate-100 dark:border-slate-700/50">
                      <span className="text-[9px] text-slate-400 block font-semibold">Amount</span>
                      <span className="font-mono font-bold text-amber-600 text-xs">{formatCurrency(milkReport.amount)}</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl border border-slate-100 dark:border-slate-700/50">
                      <span className="text-[9px] text-slate-400 block font-semibold">Rate</span>
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-[11px]">{formatMilkRate(milkReport.rate)}</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl border border-slate-100 dark:border-slate-700/50">
                      <span className="text-[9px] text-slate-400 block font-semibold">Slips</span>
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-[11px]">{milkReport.slipCount}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl border border-slate-100 dark:border-slate-700/50">
                      <span className="text-[9px] text-slate-400 block font-semibold">Opening</span>
                      <span className="font-mono font-bold text-[11px]"><BalanceAmount value={ledgerDetails.openingBalance} /></span>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl border border-slate-100 dark:border-slate-700/50">
                      <span className="text-[9px] text-slate-400 block font-semibold">Supplies</span>
                      <span className="font-mono font-bold text-amber-600 text-[11px]">Rs {(ledgerDetails.totalCredit / 1000).toFixed(1)}k</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl border border-slate-100 dark:border-slate-700/50">
                      <span className="text-[9px] text-slate-400 block font-semibold">Paid</span>
                      <span className="font-mono font-bold text-emerald-600 text-[11px]">Rs {(ledgerDetails.netPaid / 1000).toFixed(1)}k</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl border border-slate-100 dark:border-slate-700/50">
                      <span className="text-[9px] text-slate-400 block font-semibold">Closing</span>
                      <span className="font-mono font-bold text-[11px]"><BalanceAmount value={ledgerDetails.closingBalance} /></span>
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => handleOpenPaymentModal(activeSupplier)}
                  className="flex-1 py-2.5 bg-lime-600 hover:bg-lime-700 active:scale-95 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer"
                >
                  <DollarSign size={14} />
                  <span>+ Record Payment</span>
                </button>

                <button aria-label="Supplier Information"
                  onClick={() => setShowMobileInfo(!showMobileInfo)}
                  className={`p-2.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer ${
                    showMobileInfo ? 'bg-lime-50 dark:bg-lime-950/40 text-lime-700 dark:text-lime-300 border-lime-200 dark:border-lime-800' : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                  title="Supplier Information"
                >
                  <Info size={15} />
                </button>
              </div>
            </div>

            {showMobileInfo && (
              <div className="bg-white rounded-2xl border border-slate-200 p-3.5 space-y-2.5 shadow-2xs text-xs animate-in fade-in duration-150">
                <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                  <span className="font-bold text-slate-700 text-[11px] uppercase tracking-wider">Contact & Procurement Terms</span>
                  <button aria-label="Hatayen" onClick={() => setShowMobileInfo(false)} className="text-slate-400 hover:text-slate-600">
                    <X size={14} />
                  </button>
                </div>

                {activeSupplier.phone && (
                  <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="font-mono font-bold text-slate-800">{activeSupplier.phone}</span>
                    <div className="flex gap-1">
                      <a href={`tel:${activeSupplier.phone}`} className="p-1 text-slate-600 hover:text-slate-900">
                        <Phone size={13} />
                      </a>
                    </div>
                  </div>
                )}

                <div className="text-[11px]">
                  <div className="p-2 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <span className="text-slate-400 font-semibold">Default Rate:</span>
                    <span className="font-bold text-slate-800">{activeSupplier.default_rate ? `Rs ${activeSupplier.default_rate}/L` : 'FAT/SNF Chart'}</span>
                  </div>
                </div>

                {(activeSupplier.village || activeSupplier.city || activeSupplier.address) && (
                  <div className="p-2 rounded-xl bg-slate-50 border border-slate-100 text-[11px] text-slate-600">
                    <span className="font-bold text-slate-700 block">Supply Location:</span>
                    <span>{[activeSupplier.village, activeSupplier.city, activeSupplier.address].filter(Boolean).join(', ')}</span>
                  </div>
                )}

                {activeSupplier.notes && (
                  <div className="p-2 rounded-xl bg-slate-50 border border-slate-100 text-[11px] text-slate-500 italic">
                    "{activeSupplier.notes}"
                  </div>
                )}
              </div>
            )}

            <LedgerRangeBar
              preset={ledgerPreset}
              from={ledgerFrom}
              to={ledgerTo}
              onPreset={setLedgerPreset}
              onFrom={setLedgerFrom}
              onTo={setLedgerTo}
              view={ledgerView}
              onView={setLedgerView}
              onPrint={handlePrintActiveView}
              onOpenPrintModal={() => setIsPrintModalOpen(true)}
              printLabel={ledgerView === 'payments' ? 'Print Payments' : ledgerView === 'milk' ? 'Print Slip' : 'Print Ledger'}
              onShare={ledgerView === 'milk' ? handleShareMilkImage : undefined}
              shareLabel="Send Image"
              sharing={sharingMilkImage}
              rangeLabel={ledgerView === 'milk' ? `${milkReport.rangeLabel} · ${milkReport.modeLabel}` : ledgerDetails.rangeLabel}
            />

            {ledgerView !== 'milk' && <div className="flex items-center gap-2 bg-white p-2.5 rounded-2xl border border-slate-200/90 shadow-2xs">
              <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 flex-1 focus-within:border-lime-500 focus-within:bg-white transition-all shadow-inner">
                <Search className="text-slate-400 shrink-0" size={15} />
                <input 
                  type="text" 
                  placeholder="Search entries, bill #, milk intake..." 
                  className="bg-transparent outline-none text-xs sm:text-sm font-semibold w-full text-slate-800 placeholder:text-slate-400"
                  value={ledgerSearchTerm}
                  onChange={e => setLedgerSearchTerm(e.target.value)}
                />
                {ledgerSearchTerm && (
                  <button aria-label="Hatayen" onClick={() => setLedgerSearchTerm('')} className="text-slate-400 hover:text-slate-600">
                    <X size={14} />
                  </button>
                )}
              </div>

              {ledgerView === 'statement' && (
              <div className="relative shrink-0">
                <select
                  value={ledgerTypeFilter}
                  onChange={e => setLedgerTypeFilter(e.target.value as any)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs py-2 px-3 pr-7 rounded-xl border border-slate-200 outline-none focus:ring-1 focus:ring-lime-500 transition-all cursor-pointer appearance-none"
                >
                  <option value="All">All Types</option>
                  <option value="Milk">Milk Supplies</option>
                  <option value="Material">Raw Materials</option>
                  <option value="Payment">Payments (Out)</option>
                </select>
                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              </div>
              )}
            </div>}

            {ledgerView === 'payments' ? (
              <CashPaymentDays
                days={ledgerDetails.paymentDays}
                onDelete={handleDeleteTransaction}
                onVoucher={handlePrintVoucher}
              />
            ) : ledgerView === 'milk' ? (
              <MilkSupplierReportPanel
                report={milkReport}
                groupBy={milkGroup}
                milkType={milkTypeFilter}
                shift={milkShiftFilter}
                onGroupBy={setMilkGroup}
                onMilkType={setMilkTypeFilter}
                onShift={setMilkShiftFilter}
              />
            ) : (
            <div className="space-y-2">
              {ledgerDetails.entries.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-2xs">
                  <FileText size={32} className="mx-auto text-slate-300 mb-2" />
                  <p className="font-bold text-xs text-slate-700">No transactions recorded</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Use Record Payment or Procurement to add records</p>
                </div>
              ) : (
                ledgerDetails.entries.map((entry, idx) => (
                  <div key={entry.id || idx} className="bg-white rounded-2xl border border-slate-200/90 p-3 shadow-2xs space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-slate-500 text-[11px]">{formatLedgerDate(entry.date)}</span>
                        <span className={`px-2 py-0.2 rounded-md text-[9px] font-bold uppercase ${
                          entry.kind === 'Milk' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                          entry.kind === 'Material' ? 'bg-purple-50 text-purple-700 border border-purple-200' :
                          entry.kind === 'Refund' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                          entry.kind === 'Charge' ? 'bg-orange-50 text-orange-700 border border-orange-200' :
                          'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}>
                          {entry.subtype === 'Advance' ? 'Advance' : entry.kind}
                        </span>
                      </div>
                      {entry.canDelete && (
                        <button
                          type="button"
                          onClick={() => handleDeleteTransaction(entry.id)}
                          className="p-1 text-slate-400 hover:text-red-600 rounded"
                          title="Payment delete karein"
                          aria-label="Payment delete karein"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>

                    <p className="text-xs font-semibold text-slate-800 leading-snug">
                      {entry.description}
                    </p>
                    {entry.note && <p className="text-[10px] text-slate-400 italic">Note: {entry.note}</p>}

                    <div className="grid grid-cols-3 gap-1 bg-slate-50 p-2 rounded-xl border border-slate-100 text-center text-xs">
                      <div>
                        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Supply (Cr)</span>
                        <span className="font-mono font-bold text-amber-600">
                          {entry.credit > 0 ? `${formatCurrency(entry.credit)}` : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Paid (Dr)</span>
                        <span className="font-mono font-bold text-emerald-600">
                          {entry.debit > 0 ? `${formatCurrency(entry.debit)}` : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Balance</span>
                        <BalanceAmount value={entry.runningBalance} className="font-mono font-black" />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            )}
          </div>

          <div className="hidden lg:flex items-start gap-5">
            
            <div className="w-80 shrink-0 space-y-3">
              <button
                onClick={handleBackToList}
                className="w-full py-2.5 px-3.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-2xl transition-all font-bold flex items-center justify-center gap-2 text-sm shadow-2xs cursor-pointer active:scale-98"
              >
                <ArrowLeft size={15} className="text-slate-500" />
                <span>Back to All Suppliers</span>
              </button>

              <div className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-2xs space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-black text-lg shadow-md shadow-blue-500/20 shrink-0">
                    <Truck size={22} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="text-base font-black text-slate-900 leading-tight truncate">{activeSupplier.name}</h3>
                      <button aria-label="Send WhatsApp Statement"
                        onClick={() => handleSendWhatsAppReminder(activeSupplier)}
                        className="p-1 text-emerald-600 hover:bg-emerald-50 bg-emerald-50/60 border border-emerald-200 rounded-lg transition-all cursor-pointer"
                        title="Send WhatsApp Statement"
                      >
                        <MessageCircle size={13} />
                      </button>
                      <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-bold border ${
                        activeSupplier.isActive !== false ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}>
                        {activeSupplier.isActive !== false ? 'Active' : 'Inactive'}
                      </span>
                      {activeSupplier.isActive === false && (
                        <button
                          onClick={() => reactivateEntity('supplier', activeSupplier.id)}
                          className="text-[10px] px-2 py-0.5 rounded-lg font-bold bg-amber-100 hover:bg-amber-200 text-amber-800 flex items-center gap-1 border border-amber-300 cursor-pointer shadow-2xs"
                          title="Reactivate Supplier"
                        >
                          <RotateCcw size={10} />
                          <span>Reactivate</span>
                        </button>
                      )}
                    </div>
                    <span className="text-xs text-slate-400 font-semibold">{activeSupplier.village || activeSupplier.city || 'Dairy Supplier'}</span>
                  </div>
                </div>

                <div className={`p-4 rounded-2xl border ${
                  Math.abs(activeSupplier.pending_balance) < 0.01 ? 'bg-slate-50 border-slate-200' :
                  activeSupplier.pending_balance > 0 ? 'bg-amber-50/80 border-amber-200' :
                  'bg-emerald-50/80 border-emerald-200'
                }`}>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    Current Net Payable Balance
                  </span>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className={`text-2xl font-black font-mono ${
                      Math.abs(activeSupplier.pending_balance) < 0.01 ? 'text-slate-700' : activeSupplier.pending_balance > 0 ? 'text-amber-600' : 'text-emerald-700'
                    }`}>
                      {formatCurrency(Math.abs(activeSupplier.pending_balance))}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase ${
                      Math.abs(activeSupplier.pending_balance) < 0.01 ? 'bg-slate-200 text-slate-600' : activeSupplier.pending_balance > 0 ? 'bg-amber-200/70 text-amber-800' : 'bg-emerald-200/70 text-emerald-800'
                    }`}>
                      {Math.abs(activeSupplier.pending_balance) < 0.01 ? 'Settled' : activeSupplier.pending_balance > 0 ? 'Payable' : 'Advance'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleOpenPaymentModal(activeSupplier)}
                    className="py-2.5 px-3 bg-lime-600 hover:bg-lime-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-lime-600/20 transition-all cursor-pointer active:scale-95 col-span-2"
                  >
                    <DollarSign size={14} />
                    <span>Record Payment</span>
                  </button>
                  <button
                    onClick={() => handleEdit(activeSupplier)}
                    className="py-2 px-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Edit size={13} />
                    <span>Edit Profile</span>
                  </button>
                  <button
                    onClick={() => initiateDelete(activeSupplier)}
                    className="py-2 px-3 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Trash2 size={13} />
                    <span>Delete</span>
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-2xs space-y-3.5 text-xs">
                <h4 className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">Procurement Terms & Contact</h4>

                <div className="space-y-2 text-slate-600">
                  <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50">
                    <span className="text-slate-400">Phone:</span>
                    <span className="font-mono font-bold text-slate-800">{activeSupplier.phone}</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50">
                    <span className="text-slate-400">Default Rate:</span>
                    <span className="font-bold text-slate-800">{activeSupplier.default_rate ? `Rs ${activeSupplier.default_rate}/L` : 'FAT/SNF Chart'}</span>
                  </div>
                  {(activeSupplier.village || activeSupplier.city) && (
                    <div className="p-2 rounded-xl bg-slate-50">
                      <span className="text-slate-400 block mb-0.5">Location:</span>
                      <span className="font-semibold text-slate-700">{[activeSupplier.village, activeSupplier.city, activeSupplier.address].filter(Boolean).join(', ')}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex-1 min-w-0 space-y-4">
              
              <LedgerRangeBar
                preset={ledgerPreset}
                from={ledgerFrom}
                to={ledgerTo}
                onPreset={setLedgerPreset}
                onFrom={setLedgerFrom}
                onTo={setLedgerTo}
                view={ledgerView}
                onView={setLedgerView}
                onPrint={handlePrintActiveView}
                onOpenPrintModal={() => setIsPrintModalOpen(true)}
                printLabel={ledgerView === 'payments' ? 'Print Payments' : ledgerView === 'milk' ? 'Print Slip' : 'Print Ledger'}
                onShare={ledgerView === 'milk' ? handleShareMilkImage : undefined}
                shareLabel="Send Image"
                sharing={sharingMilkImage}
                rangeLabel={ledgerView === 'milk'
                  ? `${milkReport.rangeLabel} · ${milkReport.modeLabel} · ${milkReport.filterLabel}`
                  : `${ledgerDetails.rangeLabel}${ledgerDetails.totalMilkLitres ? ` · ${ledgerDetails.totalMilkLitres.toLocaleString()} L milk` : ''}`}
              />

              {ledgerView !== 'milk' && <div className="flex items-center justify-between gap-3 bg-white p-3.5 rounded-3xl border border-slate-200/90 shadow-2xs">
                <div className="flex items-center gap-2 flex-1 max-w-md bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200 focus-within:border-lime-500 focus-within:bg-white transition-all shadow-inner">
                  <Search className="text-slate-400 shrink-0" size={16} />
                  <input 
                    type="text" 
                    placeholder={ledgerView === 'payments' ? 'Search payments, mode, note...' : 'Search supplier ledger entries...'} 
                    className="bg-transparent outline-none text-xs font-semibold w-full text-slate-800"
                    value={ledgerSearchTerm}
                    onChange={e => setLedgerSearchTerm(e.target.value)}
                  />
                </div>

                {ledgerView === 'statement' && (
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold text-slate-600">
                  {(['All', 'Milk', 'Material', 'Payment'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setLedgerTypeFilter(t)}
                      className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                        ledgerTypeFilter === t ? 'bg-white text-slate-900 shadow-2xs font-black' : 'hover:text-slate-900'
                      }`}
                    >
                      {t === 'All' ? 'All Records' : t === 'Milk' ? 'Milk Supplies' : t === 'Material' ? 'Raw Materials' : 'Payments'}
                    </button>
                  ))}
                </div>
                )}
              </div>}

              <div className="grid grid-cols-4 gap-3">
                {ledgerView === 'payments' ? (
                  <>
                    <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Cash Paid</span>
                      <span className="text-lg font-black text-emerald-600 font-mono mt-0.5 block">{formatCurrency(ledgerDetails.cashPaid)}</span>
                    </div>
                    <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Bank / Other</span>
                      <span className="text-lg font-black text-slate-900 font-mono mt-0.5 block">{formatCurrency(ledgerDetails.otherPaid)}</span>
                    </div>
                    <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Refunds In</span>
                      <span className="text-lg font-black text-amber-600 font-mono mt-0.5 block">{formatCurrency(ledgerDetails.cashIn)}</span>
                    </div>
                    <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Net Paid</span>
                      <span className="text-lg font-black text-slate-900 font-mono mt-0.5 block">{formatCurrency((ledgerDetails.cashOut - ledgerDetails.cashIn))}</span>
                    </div>
                  </>
                ) : ledgerView === 'milk' ? (
                  <>
                    <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Litres</span>
                      <span className="text-lg font-black text-slate-900 font-mono mt-0.5 block">{formatMilkQty(milkReport.litres)} L</span>
                      <span className="text-[10px] font-semibold text-slate-400">{milkReport.dayCount} days</span>
                    </div>
                    <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Milk Amount</span>
                      <span className="text-lg font-black text-amber-600 font-mono mt-0.5 block">{formatCurrency(milkReport.amount)}</span>
                    </div>
                    <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Average Rate</span>
                      <span className="text-lg font-black text-slate-900 font-mono mt-0.5 block">{formatMilkRate(milkReport.rate)}/L</span>
                      {milkReport.fat > 0 && <span className="text-[10px] font-semibold text-slate-400">Fat {formatMilkQty(milkReport.fat)}</span>}
                    </div>
                    <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Khata Balance</span>
                      <span className="text-lg font-black font-mono mt-0.5 block"><BalanceAmount value={ledgerDetails.closingBalance} /></span>
                      <span className="text-[10px] font-semibold text-slate-400">{milkReport.slipCount} slips</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Opening Balance</span>
                      <span className="text-lg font-black font-mono mt-0.5 block"><BalanceAmount value={ledgerDetails.openingBalance} /></span>
                    </div>
                    <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Supplies (Cr)</span>
                      <span className="text-lg font-black text-amber-600 font-mono mt-0.5 block">{formatCurrency(ledgerDetails.totalCredit)}</span>
                      <span className="text-[10px] font-semibold text-slate-400">{ledgerDetails.totalMilkLitres.toLocaleString()} L milk</span>
                    </div>
                    <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Paid Out (Dr)</span>
                      <span className="text-lg font-black text-emerald-600 font-mono mt-0.5 block">{formatCurrency(ledgerDetails.netPaid)}</span>
                      {ledgerDetails.refunds > 0 && <span className="text-xs font-semibold text-amber-600">Refund {formatCurrency(ledgerDetails.refunds)}</span>}
                    </div>
                    <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Closing Balance</span>
                      <span className="text-lg font-black font-mono mt-0.5 block"><BalanceAmount value={ledgerDetails.closingBalance} /></span>
                    </div>
                  </>
                )}
              </div>

              {ledgerView === 'payments' ? (
                <CashPaymentDays
                  days={ledgerDetails.paymentDays}
                  onDelete={handleDeleteTransaction}
                  onVoucher={handlePrintVoucher}
                />
              ) : ledgerView === 'milk' ? (
                <MilkSupplierReportPanel
                  report={milkReport}
                  groupBy={milkGroup}
                  milkType={milkTypeFilter}
                  shift={milkShiftFilter}
                  onGroupBy={setMilkGroup}
                  onMilkType={setMilkTypeFilter}
                  onShift={setMilkShiftFilter}
                />
              ) : (
              <div className="bg-white rounded-3xl border border-slate-200/90 overflow-hidden shadow-2xs">
                <div className="overflow-x-auto min-h-[350px]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      <tr>
                        <th className="px-5 py-3.5">Date</th>
                        <th className="px-5 py-3.5">Type</th>
                        <th className="px-5 py-3.5">Description & Reference</th>
                        <th className="px-5 py-3.5 text-right">Supply (Cr)</th>
                        <th className="px-5 py-3.5 text-right">Paid (Dr)</th>
                        <th className="px-5 py-3.5 text-right">Running Balance</th>
                        <th className="px-5 py-3.5 text-center w-12">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {ledgerDetails.entries.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                            No ledger entries found matching filters.
                          </td>
                        </tr>
                      ) : (
                        ledgerDetails.entries.map((entry, idx) => (
                          <tr key={entry.id || idx} className="hover:bg-slate-50/80 transition-colors">
                            <td className="px-5 py-3 font-mono font-bold text-slate-600 whitespace-nowrap">{formatLedgerDate(entry.date)}</td>
                            <td className="px-5 py-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                entry.kind === 'Milk' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                                entry.kind === 'Material' ? 'bg-purple-50 text-purple-700 border border-purple-200' :
                                entry.kind === 'Refund' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                                entry.kind === 'Charge' ? 'bg-orange-50 text-orange-700 border border-orange-200' :
                                'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              }`}>
                                {entry.subtype === 'Advance' ? 'Advance' : entry.kind}
                              </span>
                            </td>
                            <td className="px-5 py-3 font-semibold text-slate-800">
                              {entry.description}
                              {entry.note && <div className="text-[10px] font-medium text-slate-400 mt-0.5">{entry.note}</div>}
                              {entry.accountName && <div className="text-[10px] font-medium text-slate-400">{entry.accountName}</div>}
                            </td>
                            <td className="px-5 py-3 text-right font-mono font-bold text-amber-600">
                              {entry.credit > 0 ? `${formatCurrency(entry.credit)}` : '—'}
                            </td>
                            <td className="px-5 py-3 text-right font-mono font-bold text-emerald-600">
                              {entry.debit > 0 ? `${formatCurrency(entry.debit)}` : '—'}
                            </td>
                            <td className="px-5 py-3 text-right font-mono font-black">
                              <BalanceAmount value={entry.runningBalance} />
                            </td>
                            <td className="px-5 py-3 text-center">
                              {entry.canDelete && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTransaction(entry.id)}
                                  className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                                  title="Payment delete karein"
                                  aria-label="Payment delete karein"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              )}

            </div>
          </div>
        </div>
      ) : (

        <div className="space-y-4">
          
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
            <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100">
                <Users size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">Total Suppliers</p>
                <p className="text-base sm:text-lg font-black text-slate-800 font-mono mt-0.5">{totalSuppliers}</p>
              </div>
            </div>

            <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-100">
                <DollarSign size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">Payable Dues</p>
                <p className="text-base sm:text-lg font-black text-amber-600 font-mono mt-0.5 truncate">
                  Rs {(totalPayable / 1000).toFixed(1)}k
                </p>
              </div>
            </div>

            <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
                <UserCheck size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">Active Accounts</p>
                <p className="text-base sm:text-lg font-black text-emerald-600 font-mono mt-0.5">{activeSuppliers}</p>
              </div>
            </div>

            <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-lime-50 text-lime-700 flex items-center justify-center shrink-0 border border-lime-100">
                <Wallet size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">Advance Paid</p>
                <p className="text-base sm:text-lg font-black text-lime-700 font-mono mt-0.5 truncate">
                  Rs {(totalAdvance / 1000).toFixed(1)}k
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 bg-white p-2 sm:p-3 rounded-2xl border border-slate-200/90 shadow-2xs">
              <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 flex-1 sm:w-80 sm:flex-initial focus-within:border-lime-500 focus-within:bg-white transition-all shadow-inner">
                <Search className="text-slate-400 shrink-0" size={15} />
                <input 
                  type="text" 
                  placeholder={listView === 'payments' ? 'Search supplier, mode, or note...' : 'Search by name, phone, village...'} 
                  className="bg-transparent outline-none text-xs sm:text-sm font-medium w-full text-slate-800 placeholder:text-slate-400"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
                {searchTerm && (
                  <button aria-label="Hatayen" onClick={() => setSearchTerm('')} className="text-slate-400 hover:text-slate-600 cursor-pointer shrink-0">
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="bg-lime-100 text-lime-800 px-2 py-1 rounded-lg text-xs font-bold font-mono">
                      {selectedIds.size}
                    </span>
                    <button 
                      onClick={initiateBulkDelete} 
                      className="text-red-600 hover:bg-red-50 p-2 sm:px-2.5 sm:py-1 rounded-lg text-xs font-bold flex items-center gap-1 border border-red-200 cursor-pointer"
                      title="Delete Selected"
                    >
                      <Trash2 size={14}/> <span className="hidden sm:inline">Delete</span>
                    </button>
                  </div>
                )}

                <div className="hidden sm:flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600">
                  <button type="button" onClick={() => setListView('suppliers')} className={`px-2.5 py-1.5 rounded-lg cursor-pointer ${listView === 'suppliers' ? 'bg-white text-slate-900 shadow-2xs' : ''}`}>Suppliers</button>
                  <button type="button" onClick={() => setListView('payments')} className={`px-2.5 py-1.5 rounded-lg cursor-pointer ${listView === 'payments' ? 'bg-white text-slate-900 shadow-2xs' : ''}`}>Payments</button>
                </div>

                <div className="relative">
                  <button 
                    onClick={() => setIsFilterOpen(!isFilterOpen)}
                    className={`bg-white border border-slate-200 text-slate-700 p-2 sm:px-3.5 sm:py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-1.5 hover:bg-slate-50 shadow-2xs transition-all cursor-pointer ${isFilterOpen ? 'border-lime-500 ring-2 ring-lime-500/10' : ''}`}
                    title="Filter Suppliers"
                  >
                    <Filter size={15} className="text-slate-600" />
                    <span className="hidden sm:inline">Filters</span>
                  </button>
                  {isFilterOpen && (
                    <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-2xl shadow-xl border border-slate-200 z-20 overflow-hidden animate-in fade-in zoom-in-95 p-3 space-y-3">
                      <div>
                        <label className="text-xs font-bold text-slate-600 mb-1 block">Supply Type</label>
                        <select 
                          className="w-full text-xs border border-slate-200 rounded-xl p-2 outline-none focus:border-lime-500 bg-white text-slate-700 font-medium cursor-pointer"
                          value={filterType} 
                          onChange={e => setFilterType(e.target.value)}
                        >
                          <option value="All">All Types</option>
                          <option value="Milk">Milk Suppliers</option>
                          <option value="Raw Material">Raw Material</option>
                          <option value="Finished Products">Finished Goods</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-slate-600 mb-1 block">Balance Status</label>
                        <select 
                          className="w-full text-xs border border-slate-200 rounded-xl p-2 outline-none focus:border-lime-500 bg-white text-slate-700 font-medium cursor-pointer"
                          value={filterBalance} 
                          onChange={e => setFilterBalance(e.target.value as any)}
                        >
                          <option value="All">All Balances</option>
                          <option value="Payable">Payable (Dena Hai)</option>
                          <option value="Advance">Advance Paid</option>
                          <option value="Settled">Settled (0)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-slate-600 mb-1 block">Supplier Status</label>
                        <select 
                          className="w-full text-xs border border-slate-200 rounded-xl p-2 outline-none focus:border-lime-500 bg-white text-slate-700 font-medium cursor-pointer"
                          value={filterActiveStatus} 
                          onChange={e => setFilterActiveStatus(e.target.value as any)}
                        >
                          <option value="Active">Active Suppliers (Default)</option>
                          <option value="Inactive">Inactive / Archived</option>
                          <option value="All">All Suppliers</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {canCreate && (
                  <button 
                    onClick={handleOpenAddForm}
                    className="bg-lime-600 hover:bg-lime-700 text-white p-2 sm:px-4 sm:py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-1.5 shadow-md shadow-lime-500/20 transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                    title="Add Supplier"
                  >
                    <Plus size={16} />
                    <span className="hidden sm:inline">Add Supplier</span>
                  </button>
                )}
              </div>
            </div>

            {listView === 'payments' ? (
              <div className="space-y-3">
                <div className="sm:hidden flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 w-fit">
                  <button type="button" onClick={() => setListView('suppliers')} className="px-2.5 py-1.5 rounded-lg cursor-pointer">Suppliers</button>
                  <button type="button" onClick={() => setListView('payments')} className="px-2.5 py-1.5 rounded-lg bg-white text-slate-900 shadow-2xs cursor-pointer">Payments</button>
                </div>
                <LedgerRangeBar
                  preset={registerPreset}
                  from={registerFrom}
                  to={registerTo}
                  onPreset={setRegisterPreset}
                  onFrom={setRegisterFrom}
                  onTo={setRegisterTo}
                  onPrint={handlePrintRegister}
                  printLabel="Print Register"
                  rangeLabel={paymentRegister.rangeLabel}
                />
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                  <div className="bg-white p-3 rounded-2xl border border-slate-200">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Payments</p>
                    <p className="font-mono font-black text-slate-800">{paymentRegister.count}</p>
                  </div>
                  <div className="bg-white p-3 rounded-2xl border border-slate-200">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Cash</p>
                    <p className="font-mono font-black text-emerald-600">{formatCurrency(paymentRegister.cashPaid)}</p>
                  </div>
                  <div className="bg-white p-3 rounded-2xl border border-slate-200">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Bank / Other</p>
                    <p className="font-mono font-black text-slate-800">{formatCurrency(paymentRegister.otherPaid)}</p>
                  </div>
                  <div className="bg-white p-3 rounded-2xl border border-slate-200">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Net Paid</p>
                    <p className="font-mono font-black text-slate-900">{formatCurrency(paymentRegister.net)}</p>
                  </div>
                </div>
                <CashPaymentDays
                  days={paymentRegister.days}
                  showSupplier
                  onOpenSupplier={selectSupplier}
                  onVoucher={handlePrintVoucher}
                  onDelete={handleDeleteTransaction}
                  emptyText="No supplier payments in this period"
                />
              </div>
            ) : (
            <>
            <div className="sm:hidden flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 w-fit">
              <button type="button" onClick={() => setListView('suppliers')} className="px-2.5 py-1.5 rounded-lg bg-white text-slate-900 shadow-2xs cursor-pointer">Suppliers</button>
              <button type="button" onClick={() => setListView('payments')} className="px-2.5 py-1.5 rounded-lg cursor-pointer">Payments</button>
            </div>
            <div className="block md:hidden space-y-2.5">
              {filteredSuppliers.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-sm">
                  <Users size={36} className="text-slate-300 mx-auto mb-2" />
                  <p className="font-bold text-sm text-slate-700">No suppliers found</p>
                  <p className="text-xs text-slate-400 mt-0.5">Try adjusting your search or filters</p>
                </div>
              ) : (
                filteredSuppliers.map(s => {
                  const isSettled = Math.abs(s.pending_balance) < 0.01;
                  const isPayable = s.pending_balance > 0;

                  return (
                    <div 
                      key={s.id}
                      onClick={() => selectSupplier(s.id)}
                      className="bg-white rounded-2xl border border-slate-200/90 p-3 shadow-2xs active:bg-slate-50 transition-all flex items-center justify-between gap-3 cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-sm text-slate-900 truncate leading-snug">
                            {s.name}
                          </span>
                          {s.isActive !== false && (
                            <span className="w-1.5 h-1.5 rounded-full bg-lime-500 shrink-0" title="Active" />
                          )}
                          <div className="flex gap-1 shrink-0">
                            {(s.supplier_types || ['Milk']).slice(0, 2).map(t => (
                              <span key={t} className="text-[9px] px-1.5 py-0.2 rounded font-bold bg-slate-100 text-slate-600">
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 flex-wrap">
                          {s.phone && (
                            <span className="font-medium font-mono text-[11px] text-slate-600">
                              {s.phone}
                            </span>
                          )}
                          {(s.village || s.city) && (
                            <span className="text-[11px] text-slate-400 truncate">
                              • {[s.village, s.city].filter(Boolean).join(', ')}
                            </span>
                          )}
                          {s.default_rate ? (
                            <span className="text-[10px] text-emerald-700 font-bold font-mono bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                              Rs {s.default_rate}/L
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <span className={`inline-block px-2.5 py-1 rounded-xl text-xs font-bold font-mono border ${
                          isSettled ? 'bg-slate-50 text-slate-500 border-slate-200' :
                          isPayable ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}>
                          {isSettled ? 'Settled' : isPayable ? `Due ${formatCurrency(s.pending_balance)}` : `Adv ${formatCurrency(Math.abs(s.pending_balance))}`}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="hidden md:block bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
              <div className="overflow-x-auto min-h-[400px]">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase font-bold text-slate-500 tracking-wider">
                    <tr>
                      <th className="px-6 py-4 w-12 text-center">
                        <input 
                          type="checkbox" 
                          className="rounded border-slate-300 w-4 h-4 text-lime-600 focus:ring-lime-500 cursor-pointer"
                          checked={filteredSuppliers.length > 0 && selectedIds.size === filteredSuppliers.length}
                          onChange={(e) => toggleSelectAll(e.target.checked)}
                        />
                      </th>
                      <th className="px-6 py-4">Supplier Profile</th>
                      <th className="px-6 py-4">Contact</th>
                      <th className="px-6 py-4">Location</th>
                      <th className="px-6 py-4">Category</th>
                      <th className="px-6 py-4 text-right">Pending Balance</th>
                      <th className="px-6 py-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {filteredSuppliers.length === 0 ? (
                      <tr><td colSpan={7} className="p-8 text-center text-slate-400">No suppliers found.</td></tr>
                    ) : (
                      filteredSuppliers.map(s => (
                        <tr key={s.id} className={`hover:bg-slate-50/80 group transition-colors cursor-pointer ${selectedIds.has(s.id) ? 'bg-lime-50/40' : ''}`} onClick={() => selectSupplier(s.id)}>
                          <td className="px-6 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                            <input 
                              type="checkbox" 
                              className="rounded border-slate-300 w-4 h-4 text-lime-600 focus:ring-lime-500 cursor-pointer"
                              checked={selectedIds.has(s.id)}
                              onChange={() => toggleSelectOne(s.id)}
                            />
                          </td>
                          <td className="px-6 py-4 font-bold text-slate-800">
                            <div className="flex items-center gap-2">
                              <span>{s.name}</span>
                              {s.isActive && <div className="w-2 h-2 rounded-full bg-lime-500" title="Active"></div>}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-1.5 text-slate-600 font-mono font-medium text-xs">
                              <Phone size={13} className="text-slate-400"/>
                              <span>{s.phone}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-slate-600 text-xs font-medium">
                            <div className="flex items-center gap-1">
                              <MapPin size={13} className="text-slate-400" />
                              <span>{[s.village, s.city].filter(Boolean).join(', ') || '—'}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex gap-1 flex-wrap items-center">
                              {s.supplier_types?.map(t => (
                                <span key={t} className={`text-[10px] px-2 py-0.5 rounded border font-bold
                                  ${t === 'Raw Material' ? 'bg-purple-50 text-purple-700 border-purple-200' : 
                                    t === 'Milk' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                  {t}
                                </span>
                              ))}
                              {s.default_rate ? (
                                <span className="text-[10px] px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200 font-bold font-mono">
                                  Rs {s.default_rate}/L
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right font-bold font-mono">
                            <span className={s.pending_balance > 0 ? 'text-amber-600' : s.pending_balance < 0 ? 'text-emerald-600' : 'text-slate-500'}>
                              {formatCurrency(Math.abs(s.pending_balance || 0))}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1">
                              {canPay && (
                                <button aria-label="Record Payment"
                                  onClick={() => handleOpenPaymentModal(s)}
                                  className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                  title="Record Payment"
                                >
                                  <DollarSign size={15} />
                                </button>
                              )}
                              {canEdit && (
                                <button aria-label="Edit Supplier"
                                  onClick={() => handleEdit(s)}
                                  className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                                  title="Edit Supplier"
                                >
                                  <Edit size={15} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            </>
            )}
          </div>
        </div>
      )}

      {isFormOpen && (
        <div className="fixed inset-0 z-[100] overflow-hidden">
          <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm transition-opacity" onClick={() => setIsFormOpen(false)} />
          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
            <div className="relative w-screen max-w-md md:max-w-lg bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
               
               <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white flex justify-between items-center shrink-0">
                  <div className="flex items-center gap-3">
                     <div className="w-10 h-10 rounded-2xl bg-lime-100 dark:bg-lime-950/40 text-lime-700 dark:text-lime-300 flex items-center justify-center font-bold border border-lime-200/60 dark:border-lime-800/40">
                        <Truck size={20} />
                     </div>
                     <div>
                        <h3 className="font-bold text-base text-slate-900 dark:text-white">{editingSupplier ? 'Edit Supplier Profile' : 'Add New Supplier'}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Supplier profile, supply category & starting khata</p>
                     </div>
                  </div>
                  <button aria-label="Band karein" onClick={() => setIsFormOpen(false)} className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                     <X size={20}/>
                  </button>
               </div>

               <form onSubmit={handleSaveSupplier} className="flex-1 p-6 space-y-6 overflow-y-auto">
                  
                  <div className="space-y-3.5">
                     <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
                        <Phone size={15} className="text-lime-600" />
                        <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">1. Contact & Identity Details</h4>
                     </div>

                     <div>
                        <label className={labelClass}>Supplier / Dairy Farm Name *</label>
                        <input 
                          type="text" 
                          required 
                          className={inputClass} 
                          placeholder="e.g. Al-Madina Dairy Farm" 
                          value={formData.name || ''} 
                          onChange={e => setFormData({...formData, name: e.target.value})}
                        />
                     </div>

                     <div>
                        <div className="flex justify-between items-center mb-1">
                           <label className={labelClass}>Primary Phone Number</label>
                           <span className="text-[11px] text-slate-400">Click icon to set WhatsApp</span>
                        </div>

                        <div className="relative flex items-center">
                           <input 
                             type="tel" 
                             className={`${inputClass} pr-28 font-medium`} 
                             placeholder="0300-1234567" 
                             value={formData.phone || ''} 
                             onChange={e => setFormData({...formData, phone: e.target.value})}
                           />

                           <button
                             type="button"
                             onClick={() => setIsPhoneWhatsapp(!isPhoneWhatsapp)}
                             className={`absolute right-2 px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                               isPhoneWhatsapp 
                                 ? 'bg-emerald-500 text-white shadow-sm ring-1 ring-emerald-600' 
                                 : 'bg-slate-100 text-slate-400 hover:text-slate-600 border border-slate-200'
                             }`}
                             title={isPhoneWhatsapp ? "WhatsApp is Active" : "Click to mark as WhatsApp number"}
                           >
                             <MessageCircle size={13} className={isPhoneWhatsapp ? "text-white" : "text-slate-400"} />
                             <span className="text-[10px]">{isPhoneWhatsapp ? "WA Active" : "WhatsApp"}</span>
                           </button>
                        </div>
                     </div>

                     <div className="grid grid-cols-2 gap-3">
                        <div>
                           <label className={labelClass}>Town / Village</label>
                           <input 
                             type="text" 
                             className={inputClass} 
                             placeholder="e.g. Chak 123" 
                             value={formData.village || ''} 
                             onChange={e => setFormData({...formData, village: e.target.value})}
                           />
                        </div>
                        <div>
                           <label className={labelClass}>City</label>
                           <input 
                             type="text" 
                             className={inputClass} 
                             placeholder="e.g. Shorkot" 
                             value={formData.city || ''} 
                             onChange={e => setFormData({...formData, city: e.target.value})}
                           />
                        </div>
                     </div>

                     <div>
                        <label className={labelClass}>Full Address</label>
                        <input 
                          type="text" 
                          className={inputClass} 
                          placeholder="Street, Farm Location, Landmark..." 
                          value={formData.address || ''} 
                          onChange={e => setFormData({...formData, address: e.target.value})}
                        />
                     </div>
                  </div>

                  <div className="space-y-3.5 pt-1">
                     <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
                        <Package size={15} className="text-purple-600" />
                        <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">2. Supply Category & Terms</h4>
                     </div>

                     <div>
                        <label className={labelClass}>Supply Category *</label>
                        <div className="grid grid-cols-3 gap-2">
                           {[
                              { key: 'Milk', label: 'Milk' },
                              { key: 'Raw Material', label: 'Raw Material' },
                              { key: 'Finished Products', label: 'Finished Goods' }
                           ].map(cat => {
                              const isSelected = formData.supplier_types?.includes(cat.key);
                              return (
                                 <button
                                   key={cat.key}
                                   type="button"
                                   onClick={() => toggleSupplierType(cat.key)}
                                   className={`p-2.5 rounded-xl border text-xs font-semibold transition-all text-center cursor-pointer ${
                                     isSelected
                                       ? 'bg-lime-50 text-lime-800 border-lime-500 shadow-sm ring-1 ring-lime-500/20'
                                       : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                   }`}
                                 >
                                    {cat.label}
                                 </button>
                              );
                           })}
                        </div>
                     </div>

                     {formData.supplier_types?.includes('Milk') && (
                        <div className="grid grid-cols-2 gap-3">
                           <div>
                              <label className={labelClass}>Default Milk Variety</label>
                              <select 
                                className={inputClass} 
                                value={formData.default_milk_type || ''} 
                                onChange={e => setFormData({...formData, default_milk_type: e.target.value})}
                              >
                                 <option value="">Select Variety...</option>
                                 {isMilkVarietyActive('Buffalo') && <option value="Buffalo">Buffalo Milk</option>}
                                 {isMilkVarietyActive('Cow') && <option value="Cow">Cow Milk</option>}
                                 {isMilkVarietyActive('Mixed') && <option value="Mixed">Mixed Milk</option>}
                                 {formData.default_milk_type && !isMilkVarietyActive(formData.default_milk_type) && (
                                   <option value={formData.default_milk_type}>{formData.default_milk_type} Milk (Inactive)</option>
                                 )}
                              </select>
                           </div>
                           <div>
                              <label className={labelClass}>Default Rate / Liter (Rs)</label>
                              <div className="relative">
                                 <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-xs">Rs</span>
                                 <input 
                                   type="number" 
                                   min="0" 
                                   step="any" 
                                   className={`${inputClass} pl-9 font-mono font-bold`} 
                                   placeholder="e.g. 180" 
                                   value={formData.default_rate || ''} 
                                   onChange={e => setFormData({...formData, default_rate: parseFloat(e.target.value) || 0})} 
                                 />
                              </div>
                           </div>
                        </div>
                     )}
                  </div>

                  {/* Opening balance for a new supplier; on edit the current balance is read-only. */}
                  <div className="space-y-2 pt-1">
                     <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
                        <Wallet size={15} className="text-amber-600" />
                        <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">{editingSupplier ? '3. Current Balance (Rs)' : '3. Opening Balance (Rs)'}</h4>
                     </div>

                     {editingSupplier ? (
                       <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800/60">
                         <p className="font-mono font-bold text-slate-800 dark:text-slate-100">
                           {formatCurrency(Math.abs(Number(editingSupplier.pending_balance) || 0))} {Number(editingSupplier.pending_balance) > 0 ? '(Payable / Dena hai)' : Number(editingSupplier.pending_balance) < 0 ? '(Advance diya hua)' : '(Settled)'}
                         </p>
                         <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Balance yahan se nahi badalta. Purchase, payment ya return se khud update hota hai.</p>
                       </div>
                     ) : (
                     <div>
                        <div className="relative">
                           <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-sm">Rs</span>
                           <input 
                             type="number" 
                             step="any" 
                             className={`${inputClass} pl-10 font-mono font-bold`} 
                             placeholder="0.00 (e.g. 5000 for Payable, -5000 for Advance)" 
                             value={formData.pending_balance || ''} 
                             onChange={e => setFormData({...formData, pending_balance: parseFloat(e.target.value) || 0})} 
                           />
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1">Enter positive amount for Payable balance (Dena Hai), or negative (-) for Advance paid.</p>
                     </div>
                     )}
                  </div>

                  <div className="space-y-3 pt-1">
                     <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
                        <FileText size={15} className="text-slate-500" />
                        <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">4. Remarks & Account Status</h4>
                     </div>

                     <div>
                        <label className={labelClass}>Supplier Notes / Remarks</label>
                        <textarea 
                          rows={2} 
                          className={inputClass} 
                          placeholder="Special instructions, contact person, delivery schedule..." 
                          value={formData.notes || ''} 
                          onChange={e => setFormData({...formData, notes: e.target.value})}
                        />
                     </div>

                     <div className="flex items-center gap-2.5 pt-1 bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <input 
                          type="checkbox" 
                          id="isSupplierActive" 
                          className="w-4 h-4 text-lime-600 rounded focus:ring-lime-500 cursor-pointer" 
                          checked={formData.isActive !== false} 
                          onChange={e => setFormData({...formData, isActive: e.target.checked})}
                        />
                        <label htmlFor="isSupplierActive" className="text-xs font-semibold text-slate-700 cursor-pointer">
                           Supplier Account is Active & Enabled for Procurement
                        </label>
                     </div>
                  </div>

               </form>

               <div className="p-5 border-t border-slate-100 bg-slate-50 flex gap-3 shrink-0">
                  <button 
                    type="button"
                    onClick={() => setIsFormOpen(false)} 
                    className="flex-1 bg-white border border-slate-200 text-slate-700 font-semibold py-2.5 rounded-xl hover:bg-slate-100 text-sm transition-colors cursor-pointer"
                  >
                     Cancel
                  </button>
                  <button 
                    type="button"
                    onClick={handleSaveSupplier} 
                    disabled={isSubmitting}
                    className={`flex-1 font-semibold py-2.5 rounded-xl shadow-lg text-sm transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 ${
                      isSubmitting ? 'bg-slate-400 text-white cursor-not-allowed shadow-none' : 'bg-lime-600 hover:bg-lime-700 text-white shadow-lime-500/20'
                    }`}
                  >
                     {isSubmitting ? (
                       <>
                         <Loader2 size={18} className="animate-spin" /> Saving...
                       </>
                     ) : (
                       <>
                         <Save size={18} /> {editingSupplier ? 'Update Profile' : 'Save Supplier'}
                       </>
                     )}
                  </button>
               </div>
            </div>
          </div>
        </div>
      )}

      {selectedPaymentSupplierId && activePaymentSupplier && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedPaymentSupplierId(null)} />
           <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-200 overflow-hidden border border-slate-200">
              <div className="bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white px-6 py-4 flex justify-between items-center border-b border-slate-200 dark:border-slate-800">
                 <div>
                    <h3 className="font-bold text-base text-slate-900 dark:text-white">Record Payment to Supplier</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{activePaymentSupplier.name}</p>
                 </div>
                 <button aria-label="Band karein" onClick={() => setSelectedPaymentSupplierId(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded-lg"><X size={18}/></button>
              </div>

              <form onSubmit={handlePaymentSubmit} className="p-6 space-y-4">
                 <div className="bg-amber-50 p-3.5 rounded-2xl border border-amber-200 flex justify-between items-center">
                    <span className="text-xs text-amber-800 font-bold">Current Payable Balance:</span>
                    <span className="text-base font-black text-amber-700 font-mono">{formatCurrency((activePaymentSupplier.pending_balance || 0))}</span>
                 </div>

                 <div>
                    <label className={labelClass}>Payment Amount (Rs) *</label>
                    <input 
                      type="number" required min="1" step="any"
                      className={`${inputClass} text-lg font-black font-mono`} 
                      placeholder="0.00" autoFocus 
                      value={paymentData.amount} 
                      onChange={e => setPaymentData({...paymentData, amount: e.target.value})}
                    />
                 </div>

                 <div className="grid grid-cols-2 gap-3">
                     <div>
                        <label className={labelClass}>Payment Mode</label>
                        <select 
                          className={inputClass} 
                          value={paymentData.mode} 
                          onChange={e => {
                            const m = e.target.value;
                            const defaultAcc = getDefaultSupplierAccount(m);
                            setPaymentData({...paymentData, mode: m, accountId: defaultAcc});
                          }}
                        >
                           <option value="Cash">Cash</option>
                           <option value="Bank Transfer">Bank Transfer</option>
                           <option value="Online">Online / Wallet</option>
                        </select>
                     </div>

                     <div>
                        <label className={labelClass}>Payment Date</label>
                        <input 
                          type="date" required 
                          className={inputClass} 
                          value={paymentData.date} 
                          onChange={e => setPaymentData({...paymentData, date: e.target.value})}
                        />
                     </div>
                  </div>

                  <div>
                     <div className="flex items-center justify-between mb-1.5">
                       <label className={labelClass + " !mb-0"}>Paid From Financial Account *</label>
                       <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800">
                         Required
                       </span>
                     </div>
                     {(accounts || []).filter(a => a.isActive !== false).length === 0 ? (
                        <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
                           <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-600" />
                           <p className="text-[11px] text-amber-700 leading-tight">
                              Koi Cash Drawer ya Bank Account add nahi hy. Pehle <b>Bank & Cash</b> module men account create karein.
                           </p>
                        </div>
                     ) : (
                        <select 
                          className={`${inputClass} ${!paymentData.accountId ? 'border-amber-400 focus:border-amber-500' : ''}`}
                          value={paymentData.accountId}
                          required
                          onChange={e => setPaymentData({...paymentData, accountId: e.target.value})}
                        >
                           <option value="">-- Select Payment Account (Required) --</option>
                           {(accounts || []).filter(a => a.isActive !== false).map(a => {
                              const isDefaultCash = a.id === settings?.financial?.defaultCashAccountId;
                              const isDefaultDigital = a.id === settings?.financial?.defaultDigitalAccountId;
                              const isActiveTill = activeShiftSession && (a.id === activeShiftSession.drawer_id || a.id === activeShiftSession.account_id);
                              return (
                                <option key={a.id} value={a.id}>
                                   {a.name} ({a.type}) - Bal: {formatCurrency(Number(a.balance || 0))}
                                   {isActiveTill ? ' [Active Till]' : ''}
                                   {isDefaultCash ? ' ★ Default Cash' : ''}
                                   {isDefaultDigital ? ' ★ Default Digital' : ''}
                                </option>
                              );
                           })}
                        </select>
                     )}
                     {paymentData.accountId && (() => {
                       const selAcc = (accounts || []).find(a => a.id === paymentData.accountId);
                       if (!selAcc) return null;
                       return (
                         <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between">
                           <span>Deducting from: <strong className="text-slate-700 dark:text-slate-200">{selAcc.name}</strong> ({selAcc.type})</span>
                           <span className="font-semibold text-emerald-600 dark:text-emerald-400">Available Bal: {formatCurrency(Number(selAcc.balance || 0))}</span>
                         </p>
                       );
                     })()}
                  </div>

                 <div>
                    <label className={labelClass}>Note / Reference (Optional)</label>
                    <input 
                      type="text" 
                      className={inputClass} 
                      placeholder="e.g. Milk payment, Cheque #..." 
                      value={paymentData.note} 
                      onChange={e => setPaymentData({...paymentData, note: e.target.value})}
                    />
                 </div>

                 <div className="pt-2 flex gap-2">
                    <button 
                      type="button"
                      onClick={() => setSelectedPaymentSupplierId(null)}
                      className="flex-1 py-3 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-50 transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      disabled={isSubmittingPayment || (accounts || []).filter(a => a.isActive !== false).length === 0}
                      className={`flex-[2] py-3 text-white font-black rounded-xl shadow-lg text-xs transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-95 ${
                        isSubmittingPayment || (accounts || []).filter(a => a.isActive !== false).length === 0 ? 'bg-slate-400 cursor-not-allowed shadow-none' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                      }`}
                    >
                      {isSubmittingPayment ? (
                        <>
                          <Loader2 size={16} className="animate-spin" /> Saving...
                        </>
                      ) : (
                        'Confirm Payment'
                      )}
                    </button>
                 </div>
              </form>
           </div>
        </div>
      )}

      {deleteConfig.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfig({...deleteConfig, isOpen: false})} />
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200 border border-slate-200 overflow-hidden">
            {deleteConfig.isBulk ? (
              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center mb-3 text-amber-600">
                  <Archive size={24} />
                </div>
                <h3 className="text-lg font-black text-slate-900 mb-1.5">Archive {selectedIds.size} Suppliers?</h3>
                <p className="text-slate-500 text-xs mb-5 leading-relaxed">
                  QuickBooks Rule: Selected suppliers will be marked <strong>Inactive (Archived)</strong>. They will be hidden from daily milk intake while their milk collection records and ledger history remain fully preserved.
                </p>
                <div className="flex gap-2.5 w-full">
                  <button 
                    onClick={() => setDeleteConfig({...deleteConfig, isOpen: false})}
                    className="flex-1 py-2.5 rounded-xl border border-slate-200 font-bold text-xs text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleBulkDeactivate}
                    className="flex-1 py-2.5 rounded-xl bg-amber-600 font-bold text-xs text-white hover:bg-amber-700 shadow-lg shadow-amber-600/20 transition-all cursor-pointer active:scale-95"
                  >
                    Make Inactive
                  </button>
                </div>
              </div>
            ) : (() => {
              const assessment = deleteConfig.id ? getDeleteAssessment('supplier', deleteConfig.id) : null;
              if (!assessment) return null;

              if (assessment.balance !== 0) {
                const bal = assessment.balance;
                return (
                  <div>
                    <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-3 shadow-xs">
                      <AlertTriangle size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 text-center mb-1">Pending Payable Balance</h3>
                    <p className="text-xs text-slate-500 text-center mb-4">QuickBooks Rule: Accounts payable cannot be deleted with an open balance</p>

                    <div className="bg-amber-50 border border-amber-200/80 rounded-2xl p-4 mb-4 text-center">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 block">
                        {bal > 0 ? 'Pending Payable (Mooco Owes Supplier)' : 'Advance Paid (Supplier Owes Mooco)'}
                      </span>
                      <span className="text-2xl font-black font-mono text-amber-800 mt-1 block">
                        {formatCurrency(Math.abs(bal))}
                      </span>
                      <p className="text-[11px] text-amber-700/90 mt-1">
                        Deleting directly will corrupt Creditors on your Balance Sheet!
                      </p>
                    </div>

                    <div className="space-y-2.5">
                      <button
                        onClick={() => handleSmartDelete('settle_discount')}
                        className="w-full py-3 px-4 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs flex flex-col items-center justify-center gap-0.5 shadow-md shadow-amber-200 cursor-pointer transition-all"
                      >
                        <span>Settle via Discount / Waiver & Make Inactive</span>
                        <span className="text-[10px] opacity-80 font-normal">Zeros balance via settlement waiver & archives supplier</span>
                      </button>

                      <button
                        onClick={() => handleSmartDelete('deactivate')}
                        className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                      >
                        <Archive size={14} />
                        <span>Keep Payable in Ledger & Make Inactive</span>
                      </button>

                      <button
                        onClick={() => setDeleteConfig({ ...deleteConfig, isOpen: false })}
                        className="w-full py-2.5 bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200 font-bold rounded-xl text-xs cursor-pointer transition-all"
                      >
                        Cancel & Keep Active
                      </button>
                    </div>
                  </div>
                );
              }

              if (assessment.hasHistory) {
                return (
                  <div>
                    <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-3 shadow-xs">
                      <Archive size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 text-center mb-1">Archive Supplier</h3>
                    <p className="text-xs text-slate-500 text-center mb-4">QuickBooks Rule: Preserve milk collection & payment records</p>

                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 mb-4 text-xs text-slate-600 space-y-1.5">
                      <div className="flex justify-between font-medium">
                        <span>Supplier Name:</span>
                        <strong className="text-slate-800">{deleteConfig.name}</strong>
                      </div>
                      <div className="flex justify-between font-medium">
                        <span>Payable Balance:</span>
                        <span className="font-mono font-bold text-emerald-600">Rs 0 (Settled)</span>
                      </div>
                      <div className="flex justify-between font-medium">
                        <span>Past History:</span>
                        <span className="font-mono text-slate-700 font-bold">
                          {assessment.details?.purCount || 0} Milk Intakes, {assessment.details?.txCount || 0} Payments
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 mb-5 leading-relaxed">
                      This supplier will be marked <strong>Inactive</strong>. They will no longer appear in daily milk collection intake, but all historical milk slips, FAT/SNF records, and payments remain preserved.
                    </p>

                    <div className="flex gap-2.5">
                      <button
                        onClick={() => setDeleteConfig({ ...deleteConfig, isOpen: false })}
                        className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSmartDelete('deactivate')}
                        className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs shadow-md shadow-amber-200 cursor-pointer"
                      >
                        Make Inactive
                      </button>
                    </div>
                  </div>
                );
              }

              // Fresh supplier with no history and a zero balance.
              return (
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-3">
                    <Trash2 size={24} />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-1">Permanent Deletion</h3>
                  <p className="text-xs text-emerald-600 font-bold mb-3">No procurement history found (Safe to delete)</p>
                  <p className="text-xs text-slate-600 mb-6">
                    Supplier <strong className="text-slate-800">{deleteConfig.name}</strong> has zero milk intakes or payments. This will permanently remove them from the database.
                  </p>
                  <div className="flex gap-3 w-full">
                    <button
                      onClick={() => setDeleteConfig({ ...deleteConfig, isOpen: false })}
                      className="flex-1 py-2.5 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 text-xs cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleSmartDelete('hard_delete')}
                      className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 text-xs shadow-md shadow-red-200 cursor-pointer"
                    >
                      Delete Permanently
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {activeSupplier && isPrintModalOpen && (
        <SupplierLedgerPrintModal
          isOpen={isPrintModalOpen}
          onClose={() => setIsPrintModalOpen(false)}
          supplier={activeSupplier}
          company={statementCompany}
          purchases={purchases}
          materialPurchases={materialPurchases}
          transactions={supplierTransactions}
          accountNames={accountNames}
          initialPreset={ledgerPreset}
          initialFrom={ledgerFrom}
          initialTo={ledgerTo}
          initialType={ledgerTypeFilter}
          onSendWhatsApp={handleSendWhatsAppReminder}
        />
      )}

    </div>
  );
};

export default Suppliers;
