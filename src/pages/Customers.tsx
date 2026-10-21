import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { Customer, POSBill } from '../types';
import { 
  Users, UserPlus, Filter, DollarSign, MapPin, Phone, ShoppingCart,
  Search, X, FileText, Edit, UserCheck, 
  Wallet, Plus, Trash2, AlertTriangle, MessageCircle, Printer,
  ArrowLeft, CheckCircle2,
  Receipt, Clock, Calendar, ExternalLink, Layers, 
  ChevronDown, Info, Loader2, Archive, RotateCcw,
  Eye
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { salePaidAmount } from '../lib/moneyFlow';
import { roundCurrency } from '../lib/db';
import { getTodayLocalDate, formatCurrency } from '../lib/formatters';
import { businessDate } from '../lib/dashboardAnalytics';
import { useMediaQuery, BREAKPOINTS } from '../hooks/useMediaQuery';
import { useProgressiveList } from '../hooks/useProgressiveList';
import { LoadMoreRow } from '../components/ui/LoadMoreRow';
import { confirmAction } from '../components/ui/ConfirmDialog';

// The shop's own day of an entry. Stored timestamps are UTC, so their "YYYY-MM-DD" prefix is the
// previous day for anything posted between 00:00 and 05:00 PKT; a plain date is kept as written.
// Pakistan time (businessDate), not the device clock, like the rest of the reporting.
const localDay = (value?: string): string => {
  if (!value) return '';
  const trimmed = String(value).trim();
  return businessDate(trimmed.replace(' ', 'T')) || trimmed.slice(0, 10);
};

interface AdditionalPhone {
  phone: string;
  is_whatsapp: boolean;
  label: string;
}

const Customers: React.FC = () => {
  const { 
    customers, 
    customerTransactions, 
    sales,
    addCustomer, 
    updateCustomer, 
    recordCustomerPayment, 
    deleteCustomerTransaction,
    accounts,
    settings,
    activeShiftSession,
    canPerform,
    hasPermission,
    getDeleteAssessment,
    safeDeleteCustomer,
    reactivateEntity
  } = useDairy();
  const { showToast } = useToast();
  
  const location = useLocation();
  const navigate = useNavigate();

  const [activeCustomerId, setActiveCustomerId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('id') || null;
  });
  const [showMobileInfo, setShowMobileInfo] = useState(false);

  const selectCustomer = (id: string | null) => {
    setActiveCustomerId(id);
    if (id) {
      navigate(`/customers?id=${encodeURIComponent(id)}`);
    } else {
      navigate('/customers');
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const targetId = params.get('id') || (location.state as any)?.customerId;
    if (targetId) {
      setActiveCustomerId(targetId);
    } else {
      setActiveCustomerId(null);
    }
  }, [location.search, location.state]);

  // Selection requested by the Command Palette or another screen.
  useEffect(() => {
    const handleSelect = (e: any) => {
      const targetId = e?.detail?.customerId;
      if (targetId) {
        selectCustomer(targetId);
      }
    };
    window.addEventListener('mooco-select-customer', handleSelect);
    return () => window.removeEventListener('mooco-select-customer', handleSelect);
  }, []);

  const handleBackToList = () => {
    selectCustomer(null);
  };

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [selectedPaymentCustomerId, setSelectedPaymentCustomerId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const canCreate = canPerform('customers', 'create');
  const canEdit = canPerform('customers', 'edit');
  const canDelete = canPerform('customers', 'delete');
  const canPay = canPerform('customers', 'payment');
  const [ledgerSearchTerm, setLedgerSearchTerm] = useState('');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState<'All' | 'Sale' | 'Payment' | 'Charge' | 'Return'>('All');

  const [selectedInvoiceSale, setSelectedInvoiceSale] = useState<POSBill | null>(null);
  const [selectedTxEntry, setSelectedTxEntry] = useState<any | null>(null);

  const [deleteConfig, setDeleteConfig] = useState<{isOpen: boolean, id: string | null, name: string, isBulk: boolean}>({
    isOpen: false, id: null, name: '', isBulk: false
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterBalance, setFilterBalance] = useState<'All' | 'Due' | 'Advance' | 'Settled'>('All');
  const [filterActiveStatus, setFilterActiveStatus] = useState<'Active' | 'Inactive' | 'All'>('Active');

  const [paymentType, setPaymentType] = useState<'Payment' | 'Charge'>('Payment');
  const [sendWhatsAppReceipt, setSendWhatsAppReceipt] = useState(true);

  const getDefaultAccountForMode = (mode: string) => {
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

  const [paymentData, setPaymentData] = useState({
    amount: '',
    date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
    mode: 'Cash',
    accountId: '',
    note: ''
  });

  const [formData, setFormData] = useState<{
    name: string;
    phone: string;
    is_phone_whatsapp: boolean;
    whatsapp: string;
    additional_phones: AdditionalPhone[];
    address: string;
    city: string;
    balance: number;
    notes: string;
    isActive: boolean;
  }>({
    name: '',
    phone: '',
    is_phone_whatsapp: true,
    whatsapp: '',
    additional_phones: [],
    address: '',
    city: '',
    balance: 0,
    notes: '',
    isActive: true
  });

  const activeCustomer = useMemo(() => {
    return (customers || []).find(c => c.id === activeCustomerId) || null;
  }, [customers, activeCustomerId]);

  const activePaymentCustomer = (customers || []).find(c => c.id === selectedPaymentCustomerId);

  const totalCustomers = (customers || []).length;
  const activeCustomers = (customers || []).filter(c => c?.isActive !== false).length;
  const totalReceivables = (customers || []).reduce((sum, c) => sum + (Number(c?.balance) > 0 ? Number(c.balance) : 0), 0);
  const totalAdvance = (customers || []).reduce((sum, c) => sum + (Number(c?.balance) < 0 ? Math.abs(Number(c.balance)) : 0), 0);

  const filteredCustomers = useMemo(() => {
    return (customers || []).filter(c => {
      if (!c) return false;
      const query = searchTerm.toLowerCase().trim();
      const cleanQuery = query.replace(/^[#\s]+/, '').trim();
      const alphaQuery = query.replace(/[^a-z0-9]/g, '');

      const matchesInvoice = Boolean(
        query && cleanQuery.length >= 2 && sales.some(s => 
          (s.customer_id === c.id || (s.details && s.details.customer_id === c.id)) && (
            (s.bill_number && (s.bill_number.toLowerCase().includes(cleanQuery) || cleanQuery.includes(s.bill_number.toLowerCase()))) ||
            (alphaQuery.length >= 2 && s.bill_number && (s.bill_number.toLowerCase().replace(/[^a-z0-9]/g, '').includes(alphaQuery) || alphaQuery.includes(s.bill_number.toLowerCase().replace(/[^a-z0-9]/g, '')))) ||
            (alphaQuery.length >= 3 && s.id.toLowerCase().replace(/[^a-z0-9]/g, '').includes(alphaQuery))
          )
        )
      );

      const matchesSearch = !query || 
        (c.name || '').toLowerCase().includes(query) || 
        (c.phone && String(c.phone).includes(query)) ||
        (c.city && String(c.city).toLowerCase().includes(query)) ||
        (c.address && String(c.address).toLowerCase().includes(query)) ||
        matchesInvoice;
      
      if (!matchesSearch) return false;

      const bal = Number(c.balance) || 0;
      if (filterBalance === 'Due' && bal <= 0) return false;
      if (filterBalance === 'Advance' && bal >= 0) return false;
      if (filterBalance === 'Settled' && Math.abs(bal) > 0.01) return false;

      if (filterActiveStatus === 'Active' && c.isActive === false) return false;
      if (filterActiveStatus === 'Inactive' && c.isActive !== false) return false;

      return true;
    });
  }, [customers, sales, searchTerm, filterBalance, filterActiveStatus]);

  const ledgerDetails = useMemo(() => {
    if (!activeCustomer) return { entries: [], totalDebit: 0, totalCredit: 0, netBalance: 0 };

    const entries: {
      id: string;
      date: string;
      timestamp?: string;
      description: string;
      debit: number;
      credit: number;
      type: 'Sale' | 'Payment' | 'Charge' | 'Return';
      mode?: string;
      note?: string;
      status?: string;
      return_reason?: string;
      refund_amount?: number;
      isReturned?: boolean;
      isPartiallyReturned?: boolean;
      canDelete: boolean;
      runningBalance?: number;
      sale?: POSBill;
      rawTx?: any;
    }[] = [];

    const posSaleIds = new Set<string>();
    const posBillNumbers = new Set<string>();

    sales
      .filter(s => (s.customer_id === activeCustomer.id || (s.details && s.details.customer_id === activeCustomer.id)) && s.status !== 'Cancelled')
      .forEach(s => {
        posSaleIds.add(s.id);
        if (s.bill_number) posBillNumbers.add(s.bill_number);
        const itemNames = s.items.map(i => `${i.qty}x ${i.name}`).join(', ');
        const isReturned = s.status === 'Returned';
        const isPartiallyReturned = s.status === 'Partially Returned';

        entries.push({
          id: s.id,
          date: localDay(s.date),
          timestamp: s.date,
          description: `POS Bill #${s.bill_number} (${itemNames || 'Dairy Items'})`,
          debit: s.total || 0,
          // What was actually collected on the bill; the unpaid part stays on khata (the matching
          // ctx_ charge row is skipped below, so it must not be counted as paid here).
          credit: salePaidAmount(s),
          type: isReturned ? 'Return' : 'Sale',
          mode: s.payment_mode,
          status: s.status,
          return_reason: s.return_reason,
          refund_amount: s.refund_amount ? Number(s.refund_amount) : undefined,
          isReturned,
          isPartiallyReturned,
          canDelete: false,
          sale: s
        });
      });

    customerTransactions
      .filter(tx => tx.customer_id === activeCustomer.id)
      .forEach(tx => {
        // Skip duplicate debit charge if already represented by POS sale above
        const isDuplicateSaleCharge = 
          (tx.type === 'Charge' || tx.type === 'Debit') && (
            (tx.id.startsWith('ctx_') && posSaleIds.has(tx.id.replace('ctx_', ''))) ||
            (Boolean(tx.note) && Array.from(posBillNumbers).some(bn => tx.note?.includes(bn)))
          );
        if (isDuplicateSaleCharge) return;

        const matchedSale = sales.find(s => 
          (s.bill_number && tx.note?.includes(s.bill_number)) || 
          s.id === (tx as any).details?.sale_id || 
          s.id === (tx as any).details?.order_id
        );

        const isReturn = (tx.type as string) === 'Return';
        const isPayment = tx.type === 'Payment';
        const isCharge = tx.type === 'Charge' || tx.type === 'Debit';

        const isOpeningBalance = (tx as any).details?.mode === 'Opening Balance' || tx.mode === 'Opening Balance' || tx.id.startsWith('ctx_op_');
        const noteText = tx.note || (tx as any).details?.note || ((tx as any).details?.mode === 'Balance Adjustment' ? 'Unrecorded Delivery Sales Adjustment' : '');
        let description = `Khata Charge: ${noteText || 'Manual Debit'}`;
        if (isOpeningBalance) {
          description = `Sabqa Baqaya (Opening Balance)${noteText && !noteText.toLowerCase().includes('opening balance') ? `: ${noteText}` : ''}`;
        } else if (isPayment) {
          description = `Payment Received (${tx.mode || (tx as any).details?.mode || 'Cash'})`;
        } else if (isReturn) {
          description = `Sales Return / Credit: ${noteText || 'Items Returned'}`;
        }

        entries.push({
          id: tx.id,
          date: localDay(tx.date),
          timestamp: (tx as any).created_at || tx.date,
          description,
          debit: isCharge ? tx.amount : 0,
          credit: (isPayment || isReturn) ? tx.amount : 0,
          type: tx.type as any,
          mode: tx.mode,
          note: tx.note,
          status: isReturn ? 'Returned' : undefined,
          isReturned: isReturn,
          // Returns are undone from Sales History; an order advance is refunded, not deleted.
          // Deleting an entry moves khata and account money back, so it needs the delete right.
          canDelete: canDelete && !isReturn && (tx as any).details?.source !== 'customer_order_advance' && !String(tx.id).startsWith('ctx_adv_'),
          sale: matchedSale,
          rawTx: tx
        });
      });

    // Sort chronologically ascending to compute running balance
    const sortedAsc = [...entries].sort((a: any, b: any) => new Date(a.timestamp || a.date).getTime() - new Date(b.timestamp || b.date).getTime());
    let running = 0;
    let totalDebit = 0;
    let totalCredit = 0;

    const withRunningBalance = sortedAsc.map(entry => {
      totalDebit += entry.debit;
      totalCredit += entry.credit;
      running = running + entry.debit - entry.credit;
      return {
        ...entry,
        runningBalance: running
      };
    });

    const returnedEntries = entries.filter(e => e.isReturned);
    // Value returned, once per bill. The khata Return row of a bill is the same goods as the bill's
    // refund, so adding both (or a returned bill's full debit) counted the return twice.
    const returnedAmount = roundCurrency(entries
      .filter(e => e.sale && !e.rawTx && (e.isReturned || e.isPartiallyReturned))
      .reduce((sum, e) => sum + (Number(e.refund_amount || 0) || (e.isReturned ? e.debit : 0)), 0));

    const filtered = withRunningBalance
      .reverse()
      .filter(entry => {
        const matchesType = 
          ledgerTypeFilter === 'All' || 
          (ledgerTypeFilter === 'Sale' && entry.type === 'Sale' && !entry.isReturned) ||
          (ledgerTypeFilter === 'Return' && (entry.type === 'Return' || entry.isReturned || entry.isPartiallyReturned)) ||
          entry.type === ledgerTypeFilter;

        const q = ledgerSearchTerm.toLowerCase().trim();
        const cleanQ = q.replace(/^[#\s]+/, '').trim();
        const alphaQ = q.replace(/[^a-z0-9]/g, '');
        const numQ = parseFloat(q.replace(/^(rs\.?|pkr)\s*/i, '').replace(/,/g, ''));

        const descLower = entry.description.toLowerCase();
        const noteLower = (entry.note || '').toLowerCase();
        const reasonLower = (entry.return_reason || '').toLowerCase();
        const billLower = (entry.sale?.bill_number || '').toLowerCase();

        const matchesQuery = !q || 
          descLower.includes(q) ||
          (cleanQ && descLower.includes(cleanQ)) ||
          noteLower.includes(q) ||
          reasonLower.includes(q) ||
          entry.date.includes(q) ||
          (cleanQ && billLower && (billLower.includes(cleanQ) || cleanQ.includes(billLower))) ||
          (alphaQ.length >= 2 && (
            descLower.replace(/[^a-z0-9]/g, '').includes(alphaQ) ||
            billLower.replace(/[^a-z0-9]/g, '').includes(alphaQ)
          )) ||
          (!isNaN(numQ) && numQ > 0 && (
            Math.abs(entry.debit - numQ) < 0.01 ||
            Math.abs(entry.credit - numQ) < 0.01
          ));
        return matchesType && matchesQuery;
      });

    return {
      entries: filtered,
      totalDebit,
      totalCredit,
      netBalance: activeCustomer.balance,
      // Stored khata balance minus what the loaded entries add up to; non-zero means the history is
      // incomplete or an entry is wrong, so the screen says so instead of showing two different numbers.
      ledgerGap: roundCurrency(Number(activeCustomer.balance || 0) - running),
      returnedCount: returnedEntries.length,
      returnedAmount
    };
  }, [activeCustomer, sales, customerTransactions, ledgerTypeFilter, ledgerSearchTerm, canDelete]);

  // Render only the layout for the current screen, and long lists a page at a time.
  const isLgScreen = useMediaQuery(BREAKPOINTS.lg);
  const isMdScreen = useMediaQuery(BREAKPOINTS.md);
  const ledgerWindow = useProgressiveList<(typeof ledgerDetails.entries)[number]>(ledgerDetails.entries, 60, `${activeCustomer?.id}|${ledgerTypeFilter}|${ledgerSearchTerm}`);
  const customerWindow = useProgressiveList<Customer>(filteredCustomers, 80, `${searchTerm}|${filterBalance}|${filterActiveStatus}`);

  const handleOpenAddForm = () => {
    setEditingCustomer(null);
    setFormData({
      name: '',
      phone: '',
      is_phone_whatsapp: true,
      whatsapp: '',
      additional_phones: [],
      address: '',
      city: '',
      balance: 0,
      notes: '',
      isActive: true
    });
    setIsFormOpen(true);
  };

  const handleEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name || '',
      phone: customer.phone || '',
      is_phone_whatsapp: customer.is_phone_whatsapp !== undefined ? customer.is_phone_whatsapp : Boolean(customer.whatsapp && customer.whatsapp === customer.phone),
      whatsapp: customer.whatsapp || '',
      additional_phones: customer.additional_phones || (customer.secondary_phone ? [{ phone: customer.secondary_phone, is_whatsapp: Boolean(customer.is_secondary_whatsapp), label: 'Secondary' }] : []),
      address: customer.address || '',
      city: customer.city || '',
      balance: customer.balance || 0,
      notes: customer.notes || '',
      isActive: customer.isActive !== false
    });
    setIsFormOpen(true);
  };

  const initiateDelete = (customer: Customer) => {
    setDeleteConfig({ isOpen: true, id: customer.id, name: customer.name, isBulk: false });
  };

  const initiateBulkDelete = () => {
    setDeleteConfig({ isOpen: true, id: null, name: `${selectedIds.size} customers`, isBulk: true });
  };

  // A second click while the first is still posting would write the khata off (or forfeit the advance) twice.
  const deleteBusyRef = useRef(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSmartDelete = async (action: 'hard_delete' | 'deactivate' | 'write_off_bad_debt') => {
    if (!deleteConfig.id || deleteBusyRef.current) return;
    const targetId = deleteConfig.id;
    deleteBusyRef.current = true;
    setIsDeleting(true);
    let success = false;
    try {
      success = await safeDeleteCustomer(targetId, action);
    } finally {
      deleteBusyRef.current = false;
      setIsDeleting(false);
    }
    if (success) {
      if (activeCustomerId === targetId) {
        setActiveCustomerId(null);
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
    if (deleteBusyRef.current) return;
    deleteBusyRef.current = true;
    setIsDeleting(true);
    try {
      for (const id of Array.from(selectedIds)) {
        await safeDeleteCustomer(id, 'deactivate');
      }
    } finally {
      deleteBusyRef.current = false;
      setIsDeleting(false);
    }
    setSelectedIds(new Set());
    setDeleteConfig({ isOpen: false, id: null, name: '', isBulk: false });
  };

  const toggleSelectAll = (isChecked: boolean) => {
    if (isChecked) {
      setSelectedIds(new Set(filteredCustomers.map(c => c.id)));
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

  const handleAddPhoneField = () => {
    setFormData(prev => ({
      ...prev,
      additional_phones: [
        ...prev.additional_phones,
        { phone: '', is_whatsapp: false, label: 'Secondary' }
      ]
    }));
  };

  const handleUpdatePhoneField = (index: number, field: keyof AdditionalPhone, value: any) => {
    setFormData(prev => {
      const updated = [...prev.additional_phones];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, additional_phones: updated };
    });
  };

  const handleRemovePhoneField = (index: number) => {
    setFormData(prev => ({
      ...prev,
      additional_phones: prev.additional_phones.filter((_, i) => i !== index)
    }));
  };

  const isSubmittingCustomerRef = useRef(false);
  const isSubmittingPaymentRef = useRef(false);

  const handleSubmitCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || isSubmitting || isSubmittingCustomerRef.current) {
      if (!formData.name.trim()) showToast('Customer ka naam zaroori hai', 'warning');
      return;
    }

    const payload = {
      name: formData.name.trim(),
      phone: formData.phone.trim(),
      is_phone_whatsapp: formData.is_phone_whatsapp,
      whatsapp: formData.is_phone_whatsapp ? formData.phone.trim() : formData.whatsapp.trim(),
      additional_phones: formData.additional_phones.filter(p => p.phone.trim() !== ''),
      address: formData.address.trim(),
      city: formData.city.trim(),
      balance: Number(formData.balance) || 0,
      notes: formData.notes.trim(),
      isActive: formData.isActive
    };

    isSubmittingCustomerRef.current = true;
    setIsSubmitting(true);
    try {
      if (editingCustomer) {
        // Balance only changes through khata entries (payment / charge). Sending the form's copy would
        // set the khata to the figure seen when the form opened, undoing any payment or sale posted
        // since, with no ledger entry behind the change.
        const { balance: _openingOnly, ...profile } = payload;
        const ok = await updateCustomer(editingCustomer.id, profile);
        if (!ok) return;
        showToast('Customer ki maloomat update ho gayi', 'success');
      } else {
        const newId = await addCustomer(payload as any);
        if (newId === false) return;
        showToast('Naya customer add ho gaya', 'success');
      }

      setIsFormOpen(false);
      setEditingCustomer(null);
    } catch (err: any) {
      showToast('Customer save nahi hua: ' + (err?.message || 'dobara koshish karein'), 'error');
    } finally {
      setIsSubmitting(false);
      setTimeout(() => {
        isSubmittingCustomerRef.current = false;
      }, 400);
    }
  };

  const handleRecordPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePaymentCustomer || isSubmittingPayment || isSubmittingPaymentRef.current) return;

    const amountNum = parseFloat(paymentData.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      showToast('Sahi amount likhein', 'warning');
      return;
    }

    if (paymentType === 'Payment' && !paymentData.accountId) {
      showToast('Baraye meherbani Deposit Account select karein ya Settings men default account set karein.', 'warning');
      return;
    }

    isSubmittingPaymentRef.current = true;
    setIsSubmittingPayment(true);
    try {
      const ok = await recordCustomerPayment(
        activePaymentCustomer.id,
        amountNum,
        paymentData.date,
        paymentData.mode,
        paymentData.note,
        paymentType,
        paymentData.accountId || undefined
      );
      if (!ok) return;

      showToast(paymentType === 'Payment' ? 'Payment record ho gayi' : 'Charge record ho gaya', 'success');

      if (sendWhatsAppReceipt && (activePaymentCustomer.whatsapp || activePaymentCustomer.phone)) {
        const rawPhone = activePaymentCustomer.whatsapp || activePaymentCustomer.phone;
        const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
        const phoneWithCode = cleanPhone.startsWith('0') ? `92${cleanPhone.slice(1)}` : cleanPhone;
        const newBal = activePaymentCustomer.balance + (paymentType === 'Payment' ? -amountNum : amountNum);
        const msg = `*MOOCO DAIRY - ${paymentType === 'Payment' ? 'PAYMENT RECEIPT' : 'KHATA CHARGE'}*\n\n` +
          `Assalam-o-Alaikum *${activePaymentCustomer.name}*,\n` +
          `${paymentType === 'Payment' ? 'Amount Received: ' : 'Amount Charged: '} *${formatCurrency(amountNum)}*\n` +
          `📅 Date: ${paymentData.date}\n` +
          `💰 Current Balance: *${formatCurrency(newBal)}*\n\n` +
          `Shukriya!`;
        window.open(`https://wa.me/${phoneWithCode}?text=${encodeURIComponent(msg)}`, '_blank');
      }

      setSelectedPaymentCustomerId(null);
      setPaymentData({ amount: '', date: getTodayLocalDate(), mode: 'Cash', accountId: '', note: '' });
    } catch (err: any) {
      showToast('Entry record nahi hui: ' + (err?.message || 'dobara koshish karein'), 'error');
    } finally {
      setIsSubmittingPayment(false);
      setTimeout(() => {
        isSubmittingPaymentRef.current = false;
      }, 400);
    }
  };

  const deletingTxRef = useRef<Set<string>>(new Set());
  const handleDeleteTransaction = async (id: string) => {
     const tx: any = customerTransactions.find(t => t.id === id);
     const customer = tx ? customers.find(c => c.id === tx.customer_id) : undefined;
     const amount = Number(tx?.amount || 0);
     const isPayment = tx?.type === 'Payment';
     const accountId = tx?.details?.account_id || tx?.account_id;
     const account = accountId ? accounts.find(a => a.id === accountId) : undefined;
     const balanceNow = Number(customer?.balance || 0);
     const balanceAfter = balanceNow + (isPayment ? amount : -amount);
     const balanceLabel = (value: number) => `${formatCurrency(Math.abs(value))} ${value > 0 ? '(customer ne dena hai)' : value < 0 ? '(advance)' : ''}`.trim();
     const ok = await confirmAction({
       title: `${isPayment ? 'Payment' : 'Charge'} ${formatCurrency(amount)} delete karein?`,
       consequences: [
         `${customer?.name || 'Customer'} ka khaata: ${balanceLabel(balanceNow)} → ${balanceLabel(balanceAfter)}`,
         ...(isPayment && account ? [`"${account.name}" se ${formatCurrency(amount)} nikal jayenge`] : isPayment ? ['Kisi account se paisa nahi niklega (is entry ka account nahi tha)'] : []),
         'Ye wapas nahi hoga.',
       ],
     });
     if (!ok || deletingTxRef.current.has(id)) return;
     // The row stays on screen until the server answers; a second confirm must not reverse it twice.
     deletingTxRef.current.add(id);
     try {
       const deleted = await deleteCustomerTransaction(id);
       if (deleted) showToast("Entry delete ho gayi", "success");
     } finally {
       deletingTxRef.current.delete(id);
     }
  };

  const handleSendWhatsAppReminder = (customer: Customer) => {
    const rawPhone = customer.whatsapp || customer.phone;
    if (!rawPhone) {
      showToast("WhatsApp ke liye phone number nahi hai", "warning");
      return;
    }
    const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
    const phoneWithCode = cleanPhone.startsWith('0') ? `92${cleanPhone.slice(1)}` : cleanPhone;
    const msg = `*MOOCO DAIRY - KHATA STATEMENT REMINDER*\n\n` +
      `Assalam-o-Alaikum *${customer.name}* sahib,\n` +
      `Aapka Mooco Dairy mein current khata balance *${formatCurrency(customer.balance)}* hai.\n\n` +
      `Baraye meherbani jald az jald adaigi farmaiye. Shukriya!\n*Mooco Dairy*`;
    window.open(`https://wa.me/${phoneWithCode}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const formatSaleDateTime = (dateStr?: string, timeStr?: string) => {
    if (!dateStr) return { date: 'N/A', time: timeStr || '' };
    try {
      const raw = typeof dateStr === 'string' ? dateStr.trim().replace(' ', 'T') : dateStr;
      const d = new Date(raw);
      if (isNaN(d.getTime())) {
        const fallback = new Date(dateStr);
        if (isNaN(fallback.getTime())) return { date: dateStr, time: timeStr || '' };
        const dateFormatted = fallback.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        const timeFormatted = fallback.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        return { date: dateFormatted, time: timeFormatted };
      }
      const dateFormatted = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      let timeFormatted = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      if (!timeFormatted && timeStr) timeFormatted = timeStr;
      return { date: dateFormatted, time: timeFormatted };
    } catch {
      return { date: dateStr, time: timeStr || '' };
    }
  };

  const getSaleForEntry = (entry: any): POSBill | null => {
    if (entry.sale) return entry.sale;
    if (!sales || sales.length === 0) return null;
    const byId = sales.find(s => s.id === entry.id || s.id === entry.id.replace('sale_', '').replace('ctx_', ''));
    if (byId) return byId;
    const match = entry.description?.match(/#([A-Za-z0-9-]+)/);
    if (match && match[1]) {
      const cleanBill = match[1].trim();
      const byBill = sales.find(s => s.bill_number === cleanBill || (s.bill_number && s.bill_number.toLowerCase() === cleanBill.toLowerCase()));
      if (byBill) return byBill;
    }
    return null;
  };

  const handleOpenEntryDetail = (entry: any) => {
    const sale = getSaleForEntry(entry);
    if (sale) {
      setSelectedInvoiceSale(sale);
    } else {
      setSelectedTxEntry(entry);
    }
  };

  const handlePrintInvoiceReceipt = (sale: POSBill) => {
    const companyName = settings?.general?.companyName || 'MOOCO DAIRY';
    const companyAddress = settings?.general?.address || 'Fresh & Pure Farm Dairy';
    const companyPhone = settings?.general?.phone || '0300-1234567';
    const footerMsg = settings?.sales?.invoiceFooter || 'Thank you for your visit!';

    const dt = formatSaleDateTime(sale.date || (sale as any).created_at, (sale as any).time || sale.details?.time);
    
    const popup = window.open('', '_blank', 'width=420,height=650');
    if (!popup) {
      window.print();
      return;
    }

    const itemsHtml = (sale.items || []).map((it: any) => {
      const lineTotal = it.total || (it.qty * it.price);
      const variantStr = it.variantName ? ` (${it.variantName})` : '';
      return `
        <tr>
          <td style="padding: 4px 0; border-bottom: 1px dashed #cbd5e1; font-size: 11px;">
            <strong>${it.name}${variantStr}</strong>
          </td>
          <td style="padding: 4px 0; border-bottom: 1px dashed #cbd5e1; text-align: center; font-size: 11px;">
            ${it.qty} ${it.unit || ''}
          </td>
          <td style="padding: 4px 0; border-bottom: 1px dashed #cbd5e1; text-align: right; font-size: 11px;">
            ${formatCurrency(Number(it.price || 0))}
          </td>
          <td style="padding: 4px 0; border-bottom: 1px dashed #cbd5e1; text-align: right; font-size: 11px; font-weight: bold;">
            ${formatCurrency(Number(lineTotal || 0))}
          </td>
        </tr>
      `;
    }).join('');

    popup.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Receipt - ${sale.bill_number || sale.id}</title>
          <style>
            @page { size: 80mm auto; margin: 4mm; }
            body {
              font-family: 'Courier New', Courier, monospace;
              font-size: 12px;
              color: #0f172a;
              margin: 0;
              padding: 10px;
              background: #fff;
            }
            .text-center { text-align: center; }
            .divider { border-bottom: 1px dashed #64748b; margin: 8px 0; }
            table { width: 100%; border-collapse: collapse; }
            .btn-print {
              display: block;
              width: 100%;
              background: #65a30d;
              color: white;
              border: none;
              padding: 8px;
              font-size: 12px;
              font-weight: bold;
              border-radius: 6px;
              cursor: pointer;
              margin-top: 12px;
            }
            @media print {
              .btn-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="text-center">
            <h2 style="margin: 0; font-size: 16px; font-weight: 900; letter-spacing: 1px;">${companyName}</h2>
            <p style="margin: 2px 0; font-size: 10px; color: #475569;">${companyAddress}</p>
            <p style="margin: 2px 0; font-size: 10px; color: #475569;">Tel: ${companyPhone}</p>
            ${sale.status === 'Returned' ? '<div style="margin: 4px auto; padding: 2px 6px; background: #fee2e2; color: #b91c1c; font-weight: bold; font-size: 10px; display: inline-block;">*** RETURNED (WAPAS) ***</div>' : ''}
          </div>
          <div class="divider"></div>
          <div style="font-size: 11px; line-height: 1.4;">
            <div style="display: flex; justify-content: space-between;"><span>Inv #:</span> <strong>${sale.bill_number || sale.id}</strong></div>
            <div style="display: flex; justify-content: space-between;"><span>Date:</span> <span>${dt.date} ${dt.time}</span></div>
            <div style="display: flex; justify-content: space-between;"><span>Customer:</span> <strong>${sale.customer_name || activeCustomer?.name || 'Customer'}</strong></div>
            <div style="display: flex; justify-content: space-between;"><span>Payment:</span> <strong>${sale.payment_mode}</strong></div>
          </div>
          <div class="divider"></div>
          <table>
            <thead>
              <tr style="border-bottom: 1px dashed #64748b; font-size: 10px; text-transform: uppercase;">
                <th style="text-align: left; padding-bottom: 4px;">Item</th>
                <th style="text-align: center; padding-bottom: 4px;">Qty</th>
                <th style="text-align: right; padding-bottom: 4px;">Rate</th>
                <th style="text-align: right; padding-bottom: 4px;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
          <div class="divider"></div>
          <div style="font-size: 11px; line-height: 1.5;">
            <div style="display: flex; justify-content: space-between;"><span>Subtotal:</span> <span>${formatCurrency(Number(sale.subtotal || sale.total))}</span></div>
            ${sale.discount > 0 ? `<div style="display: flex; justify-content: space-between; color: #059669;"><span>Discount:</span> <span>- ${formatCurrency(Number(sale.discount))}</span></div>` : ''}
            ${sale.refund_amount && sale.refund_amount > 0 ? `<div style="display: flex; justify-content: space-between; color: #dc2626;"><span>Refunded:</span> <span>- ${formatCurrency(Number(sale.refund_amount))}</span></div>` : ''}
            <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 900; margin-top: 4px; border-top: 1px solid #0f172a; padding-top: 4px;">
              <span>TOTAL:</span> <span>${formatCurrency(Number(sale.total || 0))}</span>
            </div>
            ${sale.payment_mode === 'Credit' && salePaidAmount(sale) > 0 ? `<div style="display: flex; justify-content: space-between;"><span>Paid:</span> <span>${formatCurrency(salePaidAmount(sale))}</span></div>` : ''}
            ${sale.payment_mode === 'Credit' ? `<div style="display: flex; justify-content: space-between; color: #d97706; font-weight: bold;"><span>Charged to Khata:</span> <span>${formatCurrency(roundCurrency(Math.max(0, Number(sale.total || 0) - salePaidAmount(sale))))}</span></div>` : ''}
            ${sale.return_reason ? `<div style="margin-top: 4px; padding: 4px; background: #fee2e2; color: #991b1b; font-size: 10px;"><strong>Reason:</strong> ${sale.return_reason}</div>` : ''}
          </div>
          <div class="divider"></div>
          <div class="text-center" style="font-size: 10px; color: #64748b; margin-top: 8px;">
            <p style="margin: 2px 0; font-weight: bold; color: #1e293b;">${footerMsg}</p>
            <p style="margin: 2px 0;">Mooco Dairy Accounting & POS</p>
          </div>
          <button class="btn-print" onclick="window.print()">Print Receipt</button>
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    setTimeout(() => {
      popup.print();
    }, 250);
  };

  const handleWhatsAppShareInvoice = (sale: POSBill) => {
    const phone = activeCustomer?.whatsapp || activeCustomer?.phone;
    if (!phone) {
      showToast('Customer ka phone number record nahi hai', 'warning');
      return;
    }
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const targetPhone = cleanPhone.startsWith('0') ? `92${cleanPhone.slice(1)}` : cleanPhone;
    const itemLines = (sale.items || []).map((it: any) => `• ${it.name} (${it.qty} x Rs ${it.price}) = ${formatCurrency((it.total || it.qty * it.price))}`).join('\n');
    const msg = `*${settings?.general?.companyName || 'MOOCO DAIRY'} - BILL RECEIPT*\n` +
      `--------------------------------\n` +
      `*Bill #:* ${sale.bill_number || sale.id}\n` +
      `*Date:* ${sale.date ? sale.date.slice(0, 10) : ''}\n` +
      `*Customer:* ${activeCustomer?.name}\n` +
      `*Payment Mode:* ${sale.payment_mode}\n` +
      `--------------------------------\n` +
      `*Items:*\n${itemLines}\n` +
      `--------------------------------\n` +
      `*Total Bill:* ${formatCurrency(Number(sale.total || 0))}\n` +
      (sale.discount > 0 ? `*Discount:* ${formatCurrency(sale.discount)}\n` : '') +
      (sale.payment_mode === 'Credit' ? `*Charged to Khata Balance*\n` : `*Paid on Counter*\n`) +
      `*Current Khata Balance:* ${formatCurrency(Math.abs(activeCustomer?.balance || 0))} ${activeCustomer && activeCustomer.balance > 0 ? 'Dr (Due)' : 'Cr'}\n` +
      `--------------------------------\n` +
      `Thank you for your visit!`;

    window.open(`https://wa.me/${targetPhone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const handlePrintVoucher = (entry: any) => {
    const companyName = settings?.general?.companyName || 'MOOCO DAIRY';
    const popup = window.open('', '_blank', 'width=420,height=550');
    if (!popup) return;
    const isCredit = (entry.credit || 0) > 0;
    const amount = isCredit ? entry.credit : entry.debit;
    popup.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Voucher - ${entry.id}</title>
          <style>
            @page { size: 80mm auto; margin: 5mm; }
            body { font-family: 'Courier New', Courier, monospace; font-size: 12px; color: #0f172a; padding: 10px; }
            .text-center { text-align: center; }
            .divider { border-bottom: 1px dashed #64748b; margin: 8px 0; }
            table { width: 100%; border-collapse: collapse; }
            td { padding: 4px 0; font-size: 11px; }
            .btn-print { display: block; width: 100%; background: #65a30d; color: white; border: none; padding: 8px; font-weight: bold; border-radius: 6px; cursor: pointer; margin-top: 12px; }
            @media print { .btn-print { display: none; } }
          </style>
        </head>
        <body>
          <div class="text-center">
            <h2 style="margin: 0; font-size: 16px;">${companyName}</h2>
            <p style="margin: 2px 0; font-size: 11px; font-weight: bold;">${entry.type === 'Payment' ? 'PAYMENT RECEIPT VOUCHER' : 'TRANSACTION VOUCHER'}</p>
          </div>
          <div class="divider"></div>
          <table>
            <tr><td>Date:</td><td style="text-align: right; font-weight: bold;">${entry.date}</td></tr>
            <tr><td>Customer:</td><td style="text-align: right; font-weight: bold;">${activeCustomer?.name}</td></tr>
            <tr><td>Mode:</td><td style="text-align: right;">${entry.mode || 'Cash'}</td></tr>
            <tr><td>Type:</td><td style="text-align: right;">${entry.type}</td></tr>
          </table>
          <div class="divider"></div>
          <div style="font-size: 13px; font-weight: bold; display: flex; justify-content: space-between; padding: 6px 0;">
            <span>AMOUNT:</span>
            <span>${formatCurrency(Number(amount || 0))}</span>
          </div>
          ${entry.note ? `<div style="font-size: 10px; color: #475569; padding: 4px 0;">Note: ${entry.note}</div>` : ''}
          ${entry.runningBalance !== undefined ? `<div style="font-size: 11px; font-weight: bold; margin-top: 4px;">Balance after entry: ${formatCurrency(Math.abs(entry.runningBalance))} ${entry.runningBalance > 0 ? 'Dr' : 'Cr'}</div>` : ''}
          <div class="divider"></div>
          <div class="text-center" style="font-size: 10px; color: #64748b; margin-top: 10px;">
            <p>Thank you for your transaction!</p>
          </div>
          <button class="btn-print" onclick="window.print()">Print Voucher</button>
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    setTimeout(() => popup.print(), 250);
  };

  const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs sm:text-sm font-medium text-slate-900 shadow-sm focus:border-lime-500 focus:ring-1 focus:ring-lime-500 outline-none transition-all";
  const labelClass = "block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5";

  return (
    <div className="space-y-4 sm:space-y-6 pb-20">
      
      {activeCustomer ? (
        (() => {
          const hasWhatsApp = Boolean(activeCustomer.whatsapp || activeCustomer.is_phone_whatsapp);
          const isSettled = Math.abs(activeCustomer.balance) < 0.01;
          const isDue = activeCustomer.balance > 0;
          const additionalPhones = activeCustomer.additional_phones || [];

          return (
            <div className="space-y-3.5 sm:space-y-5 animate-in fade-in duration-200">
              
              {!isLgScreen && <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-850 px-3 py-2.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs">
                  <button
                    onClick={handleBackToList}
                    className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold flex items-center gap-1 text-xs cursor-pointer active:scale-95"
                  >
                    <ArrowLeft size={15} />
                    <span>Back</span>
                  </button>

                  <div className="min-w-0 text-center flex-1 px-1">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="font-black text-sm text-slate-900 dark:text-white truncate">{activeCustomer.name}</span>
                      {activeCustomer.isActive !== false && <div className="w-1.5 h-1.5 rounded-full bg-lime-500 shrink-0" />}
                    </div>
                    <span className="text-[10px] text-slate-400 font-medium block truncate">{activeCustomer.city || 'Dairy Client'}</span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {hasPermission('customer_orders') && <button type="button" title="Customer Orders" aria-label="Customer Orders" onClick={() => navigate(`/customer-orders?customer=${encodeURIComponent(activeCustomer.id)}`)} className="rounded-xl border border-lime-200 bg-lime-50 p-1.5 text-lime-700 dark:border-lime-800 dark:bg-lime-950/40 dark:text-lime-300"><ShoppingCart size={14} /></button>}
                    {hasWhatsApp && (
                      <button aria-label="WhatsApp Statement"
                        onClick={() => handleSendWhatsAppReminder(activeCustomer)}
                        className="p-1.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 rounded-xl cursor-pointer"
                        title="WhatsApp Statement"
                      >
                        <MessageCircle size={14} />
                      </button>
                    )}
                    {canEdit && (
                      <button aria-label="Edit"
                        onClick={() => handleEdit(activeCustomer)}
                        className="p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl cursor-pointer"
                        title="Edit"
                      >
                        <Edit size={14} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-3xl p-4 sm:p-5 shadow-xs border border-slate-200/80 dark:border-slate-800 space-y-3.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-widest block">Net Khata Balance</span>
                      <div className="flex items-baseline gap-1.5 mt-0.5">
                        <span className={`text-2xl sm:text-3xl font-black font-mono tracking-tight ${isSettled ? 'text-slate-700 dark:text-slate-300' : isDue ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          {formatCurrency(Math.abs(activeCustomer.balance))}
                        </span>
                        <span className={`text-[10px] font-bold uppercase ${isDue ? 'text-rose-600 dark:text-rose-400' : isSettled ? 'text-slate-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          {isDue ? 'Dr' : isSettled ? 'Settled' : 'Cr'}
                        </span>
                      </div>
                    </div>

                    <span className={`px-2.5 py-1 rounded-xl text-[10px] font-bold uppercase ${
                      isSettled ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400' :
                      isDue ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/40' :
                      'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40'
                    }`}>
                      {isSettled ? 'Settled (Rs 0)' : isDue ? 'Due Receivable' : 'Advance Credit'}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 bg-slate-50 dark:bg-slate-800/60 p-2.5 sm:p-3 rounded-2xl border border-slate-100 dark:border-slate-700/60 text-center text-xs">
                    <div>
                      <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider block">Total Billed</span>
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                        Rs {(ledgerDetails.totalDebit / 1000).toFixed(1)}k
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider block">Total Paid</span>
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        Rs {(ledgerDetails.totalCredit / 1000).toFixed(1)}k
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider block">Entries</span>
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                        {ledgerDetails.entries.length} Txns
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-0.5">
                    {canPay && (
                      <button
                        onClick={() => {
                          setSelectedPaymentCustomerId(activeCustomer.id);
                          setPaymentType('Payment');
                          const defaultAcc = getDefaultAccountForMode('Cash');
                          setPaymentData({ 
                            amount: activeCustomer.balance > 0 ? activeCustomer.balance.toString() : '', 
                            date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }), 
                            mode: 'Cash', 
                            accountId: defaultAcc, 
                            note: '' 
                          });
                        }}
                        className="flex-1 py-2.5 bg-lime-600 hover:bg-lime-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-xs active:scale-95 transition-all cursor-pointer"
                      >
                        <Plus size={15} />
                        <span>Record Payment</span>
                      </button>
                    )}

                    <button aria-label="Print Statement"
                      onClick={() => window.print()}
                      className="px-3 py-2.5 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 active:scale-95 transition-all cursor-pointer border border-slate-200 dark:border-slate-700"
                      title="Print Statement"
                    >
                      <Printer size={14} />
                    </button>

                    <button aria-label="Contact & Details"
                      onClick={() => setShowMobileInfo(!showMobileInfo)}
                      className={`px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer border ${showMobileInfo ? 'bg-lime-50 dark:bg-lime-950/40 text-lime-700 dark:text-lime-300 border-lime-200 dark:border-lime-800' : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                      title="Contact & Details"
                    >
                      <Info size={14} />
                    </button>
                  </div>
                </div>

                {showMobileInfo && (
                  <div className="bg-white dark:bg-slate-850 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5 shadow-2xs text-xs animate-in fade-in duration-150">
                    <div className="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="font-bold text-slate-700 dark:text-slate-200 text-[11px] uppercase tracking-wider">Contact & Address</span>
                      <button aria-label="Hatayen" onClick={() => setShowMobileInfo(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                        <X size={14} />
                      </button>
                    </div>

                    {activeCustomer.phone && (
                      <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                        <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{activeCustomer.phone}</span>
                        <div className="flex gap-1">
                          <a href={`tel:${activeCustomer.phone}`} className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200">
                            <Phone size={13} />
                          </a>
                        </div>
                      </div>
                    )}

                    {(activeCustomer.city || activeCustomer.address) && (
                      <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
                        <span className="font-bold text-slate-700 dark:text-slate-200 block">Delivery Address:</span>
                        <span>{activeCustomer.city ? `${activeCustomer.city} — ` : ''}{activeCustomer.address || ''}</span>
                      </div>
                    )}

                    {activeCustomer.notes && (
                      <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 italic">
                        "{activeCustomer.notes}"
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2 bg-white dark:bg-slate-850 p-2.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs">
                  <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/80 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 flex-1 focus-within:border-lime-500 focus-within:bg-white dark:focus-within:bg-slate-800 transition-all shadow-inner">
                    <Search className="text-slate-400 shrink-0" size={15} />
                    <input 
                      type="text" 
                      placeholder="Search entries, bill #, note..." 
                      className="bg-transparent outline-none text-xs sm:text-sm font-semibold w-full text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                      value={ledgerSearchTerm}
                      onChange={e => setLedgerSearchTerm(e.target.value)}
                    />
                    {ledgerSearchTerm && (
                      <button aria-label="Hatayen" onClick={() => setLedgerSearchTerm('')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  <div className="relative shrink-0">
                    <select
                      value={ledgerTypeFilter}
                      onChange={e => setLedgerTypeFilter(e.target.value as any)}
                      className="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs py-2 px-3 pr-7 rounded-xl border border-slate-200 dark:border-slate-700 outline-none focus:ring-1 focus:ring-lime-500 transition-all cursor-pointer appearance-none"
                    >
                      <option value="All">All Types</option>
                      <option value="Sale">Sales / Bills</option>
                      <option value="Payment">Payments (In)</option>
                      <option value="Charge">Charges (Dr)</option>
                      <option value="Return">Returns (Wapasi)</option>
                    </select>
                    <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-2">
                  {ledgerDetails.entries.length === 0 ? (
                    <div className="bg-white dark:bg-slate-850 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center shadow-2xs">
                      <FileText size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                      <p className="font-bold text-xs text-slate-700 dark:text-slate-200">No transactions recorded</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Use Record Payment or POS Sale to add records</p>
                    </div>
                  ) : (
                    ledgerWindow.visibleItems.map((entry, idx) => {
                      const isRet = entry.isReturned || entry.type === 'Return';
                      const isPartRet = entry.isPartiallyReturned;

                      return (
                        <div 
                          key={entry.id || idx} 
                          className={`rounded-2xl border p-3 shadow-2xs space-y-2 transition-colors ${
                            isRet 
                              ? 'border-rose-200 dark:border-rose-900/50 bg-rose-50/20 dark:bg-rose-950/25' 
                              : isPartRet 
                                ? 'border-amber-200 dark:border-amber-900/50 bg-amber-50/20 dark:bg-amber-950/25' 
                                : 'bg-white dark:bg-slate-850 border-slate-200/90 dark:border-slate-800'
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-slate-500 dark:text-slate-400 text-[11px]">{entry.date}</span>
                              <span className={`inline-flex items-center gap-1 px-2 py-0.2 rounded-md text-[9px] font-bold uppercase ${
                                isRet ? 'bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800' :
                                isPartRet ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800' :
                                entry.type === 'Sale' ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800' :
                                entry.type === 'Payment' ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' :
                                'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                              }`}>
                                {(isRet || isPartRet) && <RotateCcw size={9} />}
                                {isRet ? 'Returned' : isPartRet ? 'Part. Ret' : entry.type}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleOpenEntryDetail(entry)}
                                className="text-[10px] font-bold text-lime-700 dark:text-lime-300 bg-lime-50 dark:bg-lime-950/60 hover:bg-lime-100 dark:hover:bg-lime-900/60 px-2 py-0.5 rounded-lg border border-lime-200 dark:border-lime-800 flex items-center gap-1 active:scale-95 cursor-pointer shadow-2xs"
                              >
                                <Eye size={10} />
                                <span>{entry.type === 'Sale' || entry.sale || entry.description.includes('POS Bill') ? 'Bill' : 'Voucher'}</span>
                              </button>
                              {entry.canDelete && (
                                <button aria-label="Delete Manual Transaction"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteTransaction(entry.id);
                                  }}
                                  className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-rose-400 rounded cursor-pointer"
                                  title="Delete Manual Transaction"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          </div>

                          <div 
                            onClick={() => handleOpenEntryDetail(entry)}
                            className="space-y-1 cursor-pointer group active:opacity-75"
                            title="Tap to view bill details"
                          >
                            <p className={`text-xs font-semibold leading-snug group-hover:text-lime-600 dark:group-hover:text-lime-400 transition-colors flex items-center justify-between gap-1.5 ${isRet ? 'text-slate-400 dark:text-slate-400 line-through opacity-75' : 'text-slate-800 dark:text-slate-200'}`}>
                              <span>{entry.description}</span>
                              <ExternalLink size={11} className="opacity-40 group-hover:opacity-100 text-lime-600 dark:text-lime-400 shrink-0" />
                            </p>
                            {isRet && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-200 border border-rose-300 dark:border-rose-700/80 shadow-2xs">
                                <RotateCcw size={10} /> Bill Returned (Wapas)
                              </span>
                            )}
                            {isPartRet && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-200 border border-amber-300 dark:border-amber-700/80 shadow-2xs">
                                <RotateCcw size={10} /> Partial Return
                              </span>
                            )}
                            {entry.return_reason && (
                              <p className="text-[10px] text-rose-700 dark:text-rose-300 font-semibold">
                                <span className="font-bold">Reason:</span> {entry.return_reason}
                              </p>
                            )}
                            {entry.note && <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">Note: {entry.note}</p>}
                          </div>

                          <div className="grid grid-cols-3 gap-1 bg-slate-50 dark:bg-slate-800/60 p-2 rounded-xl border border-slate-100 dark:border-slate-800 text-center text-xs">
                            <div>
                              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Debit</span>
                              <span className={`font-mono font-bold ${isRet ? 'text-slate-400 dark:text-slate-400 line-through opacity-75' : 'text-rose-600 dark:text-rose-400'}`}>
                                {entry.debit > 0 ? `${formatCurrency(entry.debit)}` : '—'}
                              </span>
                            </div>
                            <div>
                              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Credit</span>
                              <span className={`font-mono font-bold ${isRet ? 'text-slate-400 dark:text-slate-400 line-through opacity-75' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                {entry.credit > 0 ? `${formatCurrency(entry.credit)}` : '—'}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Balance</span>
                              <span className={`font-mono font-black ${entry.runningBalance && entry.runningBalance > 0 ? 'text-rose-600 dark:text-rose-400' : entry.runningBalance && entry.runningBalance < 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200'}`}>
                                {entry.runningBalance !== undefined ? `${formatCurrency(Math.abs(entry.runningBalance))} ${entry.runningBalance > 0 ? 'Dr' : entry.runningBalance < 0 ? 'Cr' : ''}`.trim() : '—'}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <LoadMoreRow sentinelRef={ledgerWindow.sentinelRef} hiddenCount={ledgerWindow.hiddenCount} onShowMore={ledgerWindow.showMore} onShowAll={ledgerWindow.showAll} />
                </div>
              </div>}

              {isLgScreen && <div className="flex items-start gap-5">
                
                <div className="w-80 shrink-0 space-y-3">
                  <button
                    onClick={handleBackToList}
                    className="w-full py-2.5 px-3.5 bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 rounded-2xl transition-all font-bold flex items-center justify-center gap-2 text-sm shadow-2xs cursor-pointer active:scale-98"
                  >
                    <ArrowLeft size={15} className="text-slate-500 dark:text-slate-400" />
                    <span>Back to All Customers</span>
                  </button>

                  <div className="bg-white dark:bg-slate-850 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-5 shadow-2xs space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-lime-500 to-emerald-600 text-white flex items-center justify-center font-black text-lg shadow-md shadow-lime-500/20 shrink-0">
                        {activeCustomer.name.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-base font-black text-slate-900 dark:text-white leading-tight truncate">{activeCustomer.name}</h3>
                          {hasWhatsApp && (
                            <button aria-label="Send WhatsApp Statement"
                              onClick={() => handleSendWhatsAppReminder(activeCustomer)}
                              className="p-1 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-lg transition-all cursor-pointer"
                              title="Send WhatsApp Statement"
                            >
                              <MessageCircle size={13} />
                            </button>
                          )}
                          <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-bold border ${
                            activeCustomer.isActive !== false ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60' : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60'
                          }`}>
                            {activeCustomer.isActive !== false ? 'Active' : 'Inactive'}
                          </span>
                          {activeCustomer.isActive === false && (
                            <button
                              onClick={() => reactivateEntity('customer', activeCustomer.id)}
                              className="text-[10px] px-2 py-0.5 rounded-lg font-bold bg-amber-100 dark:bg-amber-950/60 hover:bg-amber-200 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-300 flex items-center gap-1 border border-amber-300 dark:border-amber-800 cursor-pointer shadow-2xs"
                              title="Reactivate Customer"
                            >
                              <RotateCcw size={10} />
                              <span>Reactivate</span>
                            </button>
                          )}
                        </div>
                        <span className="text-xs text-slate-400 font-semibold">{activeCustomer.city || 'Dairy Client'}</span>
                      </div>
                    </div>

                    <div className={`p-4 rounded-2xl border transition-all ${
                      isSettled ? 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60' :
                      isDue ? 'bg-rose-50/90 dark:bg-rose-950/50 border-rose-200 dark:border-rose-900/80 dark:shadow-[inset_0_1px_0_rgba(244,63,94,0.15)]' :
                      'bg-emerald-50/90 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900/80 dark:shadow-[inset_0_1px_0_rgba(16,185,129,0.15)]'
                    }`}>
                      <span className={`text-[10px] font-bold uppercase tracking-wider block ${
                        isSettled ? 'text-slate-500 dark:text-slate-400' : isDue ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'
                      }`}>
                        Current Khata Balance
                      </span>
                      <div className="flex items-baseline justify-between mt-1">
                        <span className={`text-2xl font-black font-mono tracking-tight ${
                          isSettled ? 'text-slate-700 dark:text-slate-100' : isDue ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'
                        }`}>
                          {formatCurrency(Math.abs(activeCustomer.balance))}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase border ${
                          isSettled 
                            ? 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' 
                            : isDue 
                              ? 'bg-rose-200/80 text-rose-900 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800/80 shadow-xs' 
                              : 'bg-emerald-200/80 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800/80 shadow-xs'
                        }`}>
                          {isSettled ? 'Settled' : isDue ? 'Due Receivable' : 'Advance Credit'}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Contact Information</span>
                      
                      {activeCustomer.phone ? (
                        <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                          <div className="flex items-center gap-2">
                            <Phone size={13} className="text-slate-400" />
                            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{activeCustomer.phone}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <a 
                              href={`tel:${activeCustomer.phone}`} 
                              className="p-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 rounded" 
                              title="Call"
                            >
                              <Phone size={12} />
                            </a>
                          </div>
                        </div>
                      ) : (
                        <p className="text-slate-400 italic">No primary phone recorded</p>
                      )}

                      {additionalPhones.map((p, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                          <div>
                            <span className="font-mono text-slate-700 dark:text-slate-300 font-semibold">{p.phone}</span>
                            <span className="text-[10px] text-slate-400 ml-1.5">({p.label})</span>
                          </div>
                          <a href={`tel:${p.phone}`} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                            <Phone size={12} />
                          </a>
                        </div>
                      ))}

                      {(activeCustomer.city || activeCustomer.address) && (
                        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 space-y-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                            <MapPin size={11} /> Delivery Address
                          </span>
                          <p className="text-slate-700 dark:text-slate-300 font-medium leading-snug">
                            {activeCustomer.city ? <strong>{activeCustomer.city}</strong> : ''}
                            {activeCustomer.city && activeCustomer.address ? ' — ' : ''}
                            {activeCustomer.address}
                          </p>
                        </div>
                      )}

                      {activeCustomer.notes && (
                        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 space-y-0.5">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">Remarks</span>
                          <p className="text-slate-600 dark:text-slate-300 italic leading-snug">{activeCustomer.notes}</p>
                        </div>
                      )}
                    </div>

                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex gap-2">
                      <button
                        onClick={() => handleEdit(activeCustomer)}
                        className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 border border-transparent dark:border-slate-700 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                      >
                        <Edit size={13} /> Edit Customer
                      </button>
                      <button aria-label="Delete Customer Record"
                        onClick={() => initiateDelete(activeCustomer)}
                        className="p-2.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 border border-rose-200/60 dark:border-rose-900/50 font-bold rounded-xl text-xs transition-all cursor-pointer"
                        title="Delete Customer Record"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex-1 w-full space-y-3">

                  {Math.abs(ledgerDetails.ledgerGap || 0) >= 1 && (
                    <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-300">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>Khaate ka balance ({formatCurrency(Number(ledgerDetails.netBalance || 0))}) neeche ki entries ke jor se {formatCurrency(Math.abs(ledgerDetails.ledgerGap || 0))} {(ledgerDetails.ledgerGap || 0) > 0 ? 'zyada' : 'kam'} hai. Purani entries load nahi huin ya koi entry ghalat hai. Report par bharosa karne se pehle check karein.</span>
                    </div>
                  )}

                  <div className="grid grid-cols-4 gap-3">
                    <div className="bg-white dark:bg-slate-850 p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Invoiced</span>
                      <p className="text-lg font-black text-slate-900 dark:text-white font-mono mt-0.5">
                        {formatCurrency(ledgerDetails.totalDebit)}
                      </p>
                      <div className="flex items-center justify-between text-[10px] mt-0.5">
                        <span className="font-semibold text-slate-400">Total Debit</span>
                        {(ledgerDetails.returnedAmount || 0) > 0 && (
                          <span className="font-bold text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 px-1.5 py-0.2 rounded border border-rose-200 dark:border-rose-800/80">
                            {formatCurrency(ledgerDetails.returnedAmount)} Ret.
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="bg-white dark:bg-slate-850 p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Received</span>
                      <p className="text-lg font-black text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                        {formatCurrency(ledgerDetails.totalCredit)}
                      </p>
                      <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 font-mono">Total Credit</span>
                    </div>

                    <div className="bg-white dark:bg-slate-850 p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Net Balance</span>
                      <p className={`text-lg font-black font-mono mt-0.5 ${
                        isDue ? 'text-rose-600 dark:text-rose-400' : isSettled ? 'text-slate-700 dark:text-slate-200' : 'text-emerald-700 dark:text-emerald-400'
                      }`}>
                        {formatCurrency(Math.abs(activeCustomer.balance))}
                      </p>
                      <span className={`text-[10px] font-bold ${isDue ? 'text-rose-600 dark:text-rose-400' : isSettled ? 'text-slate-400 dark:text-slate-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {isDue ? 'Due' : isSettled ? 'Settled' : 'Advance'}
                      </span>
                    </div>

                    <div className="bg-white dark:bg-slate-850 p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Entries</span>
                      <p className="text-lg font-black text-slate-800 dark:text-white font-mono mt-0.5">
                        {ledgerDetails.entries.length}
                      </p>
                      <span className="text-[10px] font-semibold text-slate-400">Transactions</span>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-850 p-3 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs flex items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 w-52 focus-within:border-lime-500 focus-within:bg-white dark:focus-within:bg-slate-800 transition-all shadow-inner">
                        <Search className="text-slate-400 shrink-0" size={14} />
                        <input 
                          type="text" 
                          placeholder="Search entries..." 
                          className="bg-transparent outline-none text-xs font-semibold w-full py-1 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                          value={ledgerSearchTerm}
                          onChange={e => setLedgerSearchTerm(e.target.value)}
                        />
                        {ledgerSearchTerm && (
                          <button aria-label="Hatayen" onClick={() => setLedgerSearchTerm('')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer">
                            <X size={13} />
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        {[
                          { key: 'All', label: 'All' },
                          { key: 'Sale', label: 'Invoices' },
                          { key: 'Payment', label: 'Payments' },
                          { key: 'Charge', label: 'Charges' },
                          { key: 'Return', label: 'Returns' }
                        ].map(tab => (
                          <button
                            key={tab.key}
                            type="button"
                            onClick={() => setLedgerTypeFilter(tab.key as any)}
                            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                              ledgerTypeFilter === tab.key
                                ? tab.key === 'Return' ? 'bg-rose-600 text-white shadow-xs' : 'bg-lime-600 text-white shadow-xs'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => window.print()}
                        className="px-3 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
                        title="Print Ledger Statement"
                      >
                        <Printer size={14} className="text-slate-500 dark:text-slate-400" />
                        <span>Print</span>
                      </button>

                      {canPay && (
                      <button
                        onClick={() => {
                          setSelectedPaymentCustomerId(activeCustomer.id);
                          setPaymentType('Payment');
                          const defaultAcc = getDefaultAccountForMode('Cash');
                          setPaymentData({
                            amount: activeCustomer.balance > 0 ? activeCustomer.balance.toString() : '',
                            date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
                            mode: 'Cash',
                            accountId: defaultAcc,
                            note: ''
                          });
                        }}
                        className="bg-lime-600 hover:bg-lime-700 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-lime-500/20 transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                      >
                        <Plus size={15} />
                        <span>Record Payment</span>
                      </button>
                      )}
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-850 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-2xs overflow-hidden">
                    <div className="overflow-x-auto min-h-[350px]">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-slate-50/90 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wider">
                          <tr>
                            <th className="px-4 py-3.5">Date</th>
                            <th className="px-4 py-3.5">Description / Items</th>
                            <th className="px-3 py-3.5 text-center">Type</th>
                            <th className="px-4 py-3.5 text-right font-mono">Debit (Sale)</th>
                            <th className="px-4 py-3.5 text-right font-mono">Credit (Paid)</th>
                            <th className="px-4 py-3.5 text-right font-mono">Running Balance</th>
                            <th className="px-3 py-3.5 text-center w-16">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                          {ledgerDetails.entries.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="py-16 text-center text-slate-400">
                                <FileText size={36} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                                <p className="font-bold text-sm text-slate-700 dark:text-slate-200">No ledger records found</p>
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Use Record Payment or POS Billing to start entries</p>
                              </td>
                            </tr>
                          ) : (
                            ledgerWindow.visibleItems.map((entry, idx) => {
                              const isRet = entry.isReturned || entry.type === 'Return';
                              const isPartRet = entry.isPartiallyReturned;

                              return (
                                <tr 
                                  key={entry.id || idx} 
                                  className={`transition-colors ${
                                    isRet 
                                      ? 'bg-rose-50/50 dark:bg-rose-950/30 hover:bg-rose-50/80 dark:hover:bg-rose-950/45' 
                                      : isPartRet 
                                        ? 'bg-amber-50/30 dark:bg-amber-950/20 hover:bg-amber-50/60 dark:hover:bg-amber-950/35' 
                                        : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                                  }`}
                                >
                                  <td className="px-4 py-3 font-mono font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                    {entry.date}
                                  </td>
                                  <td className="px-4 py-3 text-slate-800 dark:text-slate-200 font-medium">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenEntryDetail(entry)}
                                      className="text-left w-full group/desc focus:outline-hidden cursor-pointer"
                                      title="Click to view details"
                                    >
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className={`font-semibold group-hover/desc:text-lime-700 dark:group-hover/desc:text-lime-400 transition-colors inline-flex items-center gap-1.5 ${
                                          isRet ? 'text-slate-400 dark:text-slate-400 line-through opacity-75' : 'text-slate-800 dark:text-slate-100'
                                        }`}>
                                          <span>{entry.description}</span>
                                          <ExternalLink size={12} className="opacity-0 group-hover/desc:opacity-100 text-lime-600 dark:text-lime-400 transition-opacity shrink-0" />
                                        </span>
                                        {isRet && (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-200 border border-rose-300 dark:border-rose-700/80 shadow-2xs">
                                            <RotateCcw size={10} /> Returned (Wapasi)
                                          </span>
                                        )}
                                        {isPartRet && (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-200 border border-amber-300 dark:border-amber-700/80 shadow-2xs">
                                            <RotateCcw size={10} /> Partial Return
                                          </span>
                                        )}
                                      </div>
                                      {entry.return_reason && (
                                        <div className="text-[11px] mt-1 flex items-center gap-1.5 flex-wrap">
                                          <span className="bg-rose-100 dark:bg-rose-900/70 text-rose-800 dark:text-rose-200 px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider border border-rose-300 dark:border-rose-700/70">
                                            Reason
                                          </span>
                                          <span className="text-rose-700 dark:text-rose-300 font-medium">{entry.return_reason}</span>
                                        </div>
                                      )}
                                      {entry.refund_amount !== undefined && entry.refund_amount > 0 && (
                                        <div className="text-xs text-rose-600 dark:text-rose-400 font-mono mt-0.5 font-semibold">
                                          Refund: {formatCurrency(entry.refund_amount)}
                                        </div>
                                      )}
                                      {entry.note && <div className="text-[10px] text-slate-400 dark:text-slate-500 italic mt-0.5">Note: {entry.note}</div>}
                                    </button>
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    {isRet ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-200 border border-rose-300 dark:border-rose-700/80 shadow-2xs">
                                        <RotateCcw size={10} />
                                        Returned
                                      </span>
                                    ) : isPartRet ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700/80 shadow-2xs">
                                        <RotateCcw size={10} />
                                        Part. Ret
                                      </span>
                                    ) : entry.type === 'Sale' ? (
                                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/80">
                                        Sale
                                      </span>
                                    ) : entry.type === 'Payment' ? (
                                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80">
                                        Payment
                                      </span>
                                    ) : (
                                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/80">
                                        Charge
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                                    {isRet ? (
                                      <span className="text-slate-400 dark:text-slate-400 line-through opacity-75" title="Returned Bill">
                                        {formatCurrency(entry.debit)}
                                      </span>
                                    ) : entry.debit > 0 ? (
                                      `${formatCurrency(entry.debit)}`
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                    {isRet ? (
                                      <span className="text-slate-400 dark:text-slate-400 line-through opacity-75" title="Refunded Cash/Credit">
                                        {entry.credit > 0 ? `${formatCurrency(entry.credit)}` : '—'}
                                      </span>
                                    ) : entry.credit > 0 ? (
                                      `${formatCurrency(entry.credit)}`
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                  <td className={`px-4 py-3 text-right font-mono font-black ${
                                    isRet 
                                      ? 'bg-rose-100/30 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400' 
                                      : 'bg-slate-50/50 dark:bg-slate-800/30 text-slate-900 dark:text-white'
                                  }`}>
                                    {entry.runningBalance !== undefined ? (
                                      <span className={entry.runningBalance > 0 ? 'text-rose-600 dark:text-rose-400' : entry.runningBalance < 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400'}>
                                        {formatCurrency(Math.abs(entry.runningBalance))} {entry.runningBalance > 0 ? 'Dr' : entry.runningBalance < 0 ? 'Cr' : ''}
                                      </span>
                                    ) : '—'}
                                  </td>
                                  <td className="px-3 py-3 text-center whitespace-nowrap">
                                    <div className="flex items-center justify-center gap-1.5">
                                      {entry.type === 'Sale' || entry.sale || entry.description.includes('POS Bill') ? (
                                        <button
                                          type="button"
                                          onClick={() => handleOpenEntryDetail(entry)}
                                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-lime-50 hover:bg-lime-100 dark:bg-lime-950/40 dark:hover:bg-lime-900/60 text-lime-700 dark:text-lime-300 border border-lime-200 dark:border-lime-800/60 shadow-2xs transition-all active:scale-95 cursor-pointer"
                                          title="Open POS Bill Invoice"
                                        >
                                          <FileText size={11} />
                                          <span>POS Bill</span>
                                        </button>
                                      ) : isRet ? (
                                        <button
                                          type="button"
                                          onClick={() => handleOpenEntryDetail(entry)}
                                          className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 dark:text-rose-200 bg-rose-100 hover:bg-rose-200 dark:bg-rose-900/50 dark:hover:bg-rose-900/70 px-2 py-0.5 rounded border border-rose-300 dark:border-rose-700/80 shadow-2xs cursor-pointer transition-all active:scale-95"
                                          title="View Returned Details"
                                        >
                                          <RotateCcw size={10} />
                                          <span>Returned</span>
                                        </button>
                                      ) : isPartRet ? (
                                        <button
                                          type="button"
                                          onClick={() => handleOpenEntryDetail(entry)}
                                          className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-200 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/50 dark:hover:bg-amber-900/70 px-2 py-0.5 rounded border border-amber-300 dark:border-amber-700/80 shadow-2xs cursor-pointer transition-all active:scale-95"
                                          title="View Partial Return Details"
                                        >
                                          <RotateCcw size={10} />
                                          <span>Partial</span>
                                        </button>
                                      ) : (
                                        <button aria-label="View Voucher Details"
                                          type="button"
                                          onClick={() => handleOpenEntryDetail(entry)}
                                          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
                                          title="View Voucher Details"
                                        >
                                          <FileText size={13} />
                                        </button>
                                      )}

                                      {entry.canDelete && (
                                        <button aria-label="Delete Manual Transaction"
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteTransaction(entry.id);
                                          }}
                                          className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 rounded transition-colors cursor-pointer"
                                          title="Delete Manual Transaction"
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
                          <LoadMoreRow colSpan={7} sentinelRef={ledgerWindow.sentinelRef} hiddenCount={ledgerWindow.hiddenCount} onShowMore={ledgerWindow.showMore} onShowAll={ledgerWindow.showAll} />
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>}

            </div>
          );
        })()
      ) : (
        <div className="space-y-4 sm:space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
            <div className="bg-white dark:bg-slate-850 p-3 sm:p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 border border-blue-100 dark:border-blue-900/50">
                <Users size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">Total Clients</p>
                <p className="text-base sm:text-lg font-black text-blue-600 dark:text-blue-400 font-mono mt-0.5">{totalCustomers}</p>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-850 p-3 sm:p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0 border border-rose-100 dark:border-rose-900/50">
                <DollarSign size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">Due Receivables</p>
                <p className="text-base sm:text-lg font-black text-rose-600 dark:text-rose-400 font-mono mt-0.5 truncate">
                  Rs {(totalReceivables / 1000).toFixed(1)}k
                </p>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-850 p-3 sm:p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-100 dark:border-emerald-900/50">
                <UserCheck size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">Active Accounts</p>
                <p className="text-base sm:text-lg font-black text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">{activeCustomers}</p>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-850 p-3 sm:p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-lime-50 dark:bg-lime-950/40 text-lime-700 dark:text-lime-400 flex items-center justify-center shrink-0 border border-lime-100 dark:border-lime-900/50">
                <Wallet size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">Advance Prepaid</p>
                <p className="text-base sm:text-lg font-black text-lime-700 dark:text-lime-400 font-mono mt-0.5 truncate">
                  Rs {(totalAdvance / 1000).toFixed(1)}k
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
             <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-850 p-2 sm:p-3 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs">
                <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/80 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 flex-1 sm:w-80 sm:flex-initial focus-within:border-lime-500 focus-within:bg-white dark:focus-within:bg-slate-800 transition-all shadow-inner">
                   <Search className="text-slate-400 shrink-0" size={15} />
                   <input 
                     type="text" 
                     placeholder="Search by name, phone, city..." 
                     className="bg-transparent outline-none text-xs sm:text-sm font-medium w-full text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                     value={searchTerm}
                     onChange={e => setSearchTerm(e.target.value)}
                   />
                   {searchTerm && (
                      <button aria-label="Hatayen" onClick={() => setSearchTerm('')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0">
                         <X size={14} />
                      </button>
                   )}
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                   {canDelete && selectedIds.size > 0 && (
                      <div className="flex items-center gap-1.5">
                         <span className="bg-lime-100 dark:bg-lime-950/60 text-lime-800 dark:text-lime-300 px-2 py-1 rounded-lg text-xs font-bold font-mono">
                            {selectedIds.size}
                         </span>
                         <button 
                           onClick={initiateBulkDelete} 
                           className="text-red-600 dark:text-rose-400 hover:bg-red-50 dark:hover:bg-rose-950/40 p-2 sm:px-2.5 sm:py-1 rounded-lg text-xs font-bold flex items-center gap-1 border border-red-200 dark:border-rose-900/50 cursor-pointer"
                           title="Delete Selected"
                         >
                            <Trash2 size={14}/> <span className="hidden sm:inline">Delete</span>
                         </button>
                      </div>
                   )}

                   <div className="relative">
                      <button 
                        onClick={() => setIsFilterOpen(!isFilterOpen)}
                        className={`bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-750 text-slate-700 dark:text-slate-200 p-2 sm:px-3.5 sm:py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-2xs transition-all cursor-pointer ${isFilterOpen ? 'border-lime-500 ring-2 ring-lime-500/10' : ''}`}
                        title="Filter Customers"
                      >
                         <Filter size={15} className="text-slate-600 dark:text-slate-400" />
                         <span className="hidden sm:inline">Filters</span>
                      </button>
                      {isFilterOpen && (
                         <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-slate-850 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 z-20 overflow-hidden animate-in fade-in zoom-in-95">
                            <div className="p-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                               Filter by Balance
                            </div>
                            <div className="p-2.5">
                               <select 
                                 className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-xl p-2 outline-none focus:border-lime-500 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium cursor-pointer"
                                 value={filterBalance} 
                                 onChange={e => setFilterBalance(e.target.value as any)}
                               >
                                  <option value="All">All Balances</option>
                                  <option value="Due">Due / Baqaya</option>
                                  <option value="Advance">Advance</option>
                                  <option value="Settled">Settled (0)</option>
                               </select>
                            </div>
                             <div className="p-2.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                Customer Status
                             </div>
                             <div className="p-2.5">
                                <select 
                                  className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-xl p-2 outline-none focus:border-lime-500 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium cursor-pointer"
                                  value={filterActiveStatus} 
                                  onChange={e => setFilterActiveStatus(e.target.value as any)}
                                >
                                   <option value="Active">Active Customers (Default)</option>
                                   <option value="Inactive">Inactive / Archived</option>
                                   <option value="All">All Customers</option>
                                </select>
                             </div>
                         </div>
                      )}
                   </div>

                   {canCreate && (
                     <button 
                       onClick={handleOpenAddForm}
                       className="bg-lime-600 hover:bg-lime-700 text-white p-2 sm:px-4 sm:py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-1.5 shadow-md shadow-lime-500/20 transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                       title="Add Customer"
                     >
                        <Plus size={16} />
                        <span className="hidden sm:inline">Add Customer</span>
                     </button>
                   )}
                </div>
             </div>

             {!isMdScreen && <div className="space-y-2.5">
                {filteredCustomers.length === 0 ? (
                  <div className="bg-white dark:bg-slate-850 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center shadow-sm">
                    <Users size={36} className="text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                    <p className="font-bold text-sm text-slate-700 dark:text-slate-200">No customers found</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Try adjusting your search or balance filter</p>
                  </div>
                ) : (
                  customerWindow.visibleItems.map(c => {
                    const isSettled = Math.abs(c.balance) < 0.01;
                    const isDue = c.balance > 0;

                    return (
                      <div 
                        key={c.id}
                        onClick={() => selectCustomer(c.id)}
                        className="bg-white dark:bg-slate-850 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-3 shadow-2xs active:bg-slate-50 dark:active:bg-slate-800 transition-all flex items-center justify-between gap-3 cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-sm text-slate-900 dark:text-white truncate leading-snug">
                              {c.name}
                            </span>
                            {c.isActive !== false && (
                              <span className="w-1.5 h-1.5 rounded-full bg-lime-500 shrink-0" title="Active" />
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                            {c.phone && (
                              <span className="font-medium font-mono text-[11px] text-slate-600 dark:text-slate-300">
                                {c.phone}
                              </span>
                            )}
                            {c.city && (
                              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                                • {c.city}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="shrink-0 text-right">
                          <span className={`inline-block px-2.5 py-1 rounded-xl text-xs font-bold font-mono border ${
                            isSettled ? 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700' :
                            isDue ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900/50' :
                            'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50'
                          }`}>
                            {isSettled ? 'Settled' : isDue ? `Due ${formatCurrency(c.balance)}` : `Adv ${formatCurrency(Math.abs(c.balance))}`}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
                <LoadMoreRow sentinelRef={customerWindow.sentinelRef} hiddenCount={customerWindow.hiddenCount} onShowMore={customerWindow.showMore} onShowAll={customerWindow.showAll} />
             </div>}

             {isMdScreen && <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xs">
                <div className="overflow-x-auto min-h-[400px]">
                   <table className="w-full text-left">
                      <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider">
                         <tr>
                            <th className="px-6 py-4 w-12 text-center">
                               <input 
                                 type="checkbox" 
                                 className="rounded border-slate-300 dark:border-slate-600 w-4 h-4 text-lime-600 focus:ring-lime-500 cursor-pointer bg-white dark:bg-slate-700"
                                 checked={filteredCustomers.length > 0 && selectedIds.size === filteredCustomers.length}
                                 onChange={(e) => toggleSelectAll(e.target.checked)}
                               />
                            </th>
                            <th className="px-6 py-4">Customer Profile</th>
                            <th className="px-6 py-4">Contact</th>
                            <th className="px-6 py-4">City & Area</th>
                            <th className="px-6 py-4 text-right">Net Balance</th>
                            <th className="px-6 py-4 text-center">Actions</th>
                         </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                         {customerWindow.visibleItems.map(c => {
                            const hasWhatsApp = Boolean(c.whatsapp || c.is_phone_whatsapp);
                            const additionalPhones = c.additional_phones || (c.secondary_phone ? [{ phone: c.secondary_phone, is_whatsapp: Boolean(c.is_secondary_whatsapp), label: 'Sec' }] : []);

                            return (
                            <tr 
                              key={c.id} 
                              onClick={() => selectCustomer(c.id)}
                              className={`hover:bg-lime-50/40 dark:hover:bg-slate-800/50 group transition-colors cursor-pointer ${selectedIds.has(c.id) ? 'bg-lime-50/60 dark:bg-lime-950/30' : ''}`}
                            >
                               <td className="px-6 py-4 text-center" onClick={e => e.stopPropagation()}>
                                  <input 
                                    type="checkbox" 
                                    className="rounded border-slate-300 dark:border-slate-600 w-4 h-4 text-lime-600 focus:ring-lime-500 cursor-pointer bg-white dark:bg-slate-700"
                                    checked={selectedIds.has(c.id)}
                                    onChange={() => toggleSelectOne(c.id)}
                                  />
                               </td>
                               <td className="px-6 py-4">
                                  <div className="flex items-center gap-3">
                                     <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 group-hover:bg-lime-100 dark:group-hover:bg-lime-950/50 text-slate-600 dark:text-slate-300 group-hover:text-lime-700 dark:group-hover:text-lime-300 flex items-center justify-center font-bold text-sm shrink-0 transition-colors">
                                        {c.name.charAt(0)}
                                     </div>
                                     <div>
                                        <div className="flex items-center gap-2">
                                           <span className="font-bold text-slate-900 dark:text-white group-hover:text-lime-800 dark:group-hover:text-lime-300 transition-colors">{c.name}</span>
                                           {c.isActive !== false && <div className="w-2 h-2 rounded-full bg-lime-500" title="Active"></div>}
                                        </div>
                                        <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">{c.city || 'Client'}</p>
                                     </div>
                                  </div>
                               </td>
                               <td className="px-6 py-4">
                                  <div className="flex flex-col">
                                     <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                                        <Phone size={12} className="text-slate-400"/> 
                                        <span className="font-medium font-mono">{c.phone || '—'}</span>
                                        {hasWhatsApp && (
                                           <span className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-1 py-0.5 rounded font-bold flex items-center gap-0.5" title="WhatsApp Connected">
                                              <MessageCircle size={9}/> WA
                                           </span>
                                        )}
                                     </div>
                                     {additionalPhones.length > 0 && (
                                        <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono">
                                           {additionalPhones[0].phone} ({additionalPhones[0].label})
                                        </div>
                                     )}
                                  </div>
                               </td>
                               <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                                  <div className="flex items-center gap-1 font-medium text-slate-700 dark:text-slate-200">
                                    <MapPin size={13} className="text-slate-400" /> {c.city || '—'}
                                  </div>
                                  <div className="text-xs text-slate-400 dark:text-slate-500 pl-4 truncate max-w-[180px]">{c.address || 'No street address'}</div>
                               </td>
                               <td className="px-6 py-4 text-right">
                                  {Math.abs(c.balance) < 0.01 ? (
                                    <span className="text-slate-400 dark:text-slate-500 font-medium text-xs">Settled (Rs 0)</span>
                                  ) : c.balance > 0 ? (
                                    <span className="text-rose-600 dark:text-rose-300 font-bold bg-rose-50 dark:bg-rose-950/60 px-2.5 py-1 rounded-lg border border-rose-200 dark:border-rose-800/80 font-mono text-xs">Due {formatCurrency(c.balance)}</span>
                                  ) : (
                                    <span className="text-emerald-700 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800/80 font-mono text-xs">Adv {formatCurrency(Math.abs(c.balance))}</span>
                                  )}
                                </td>
                               <td className="px-6 py-4 text-center" onClick={e => e.stopPropagation()}>
                                  <div className="flex items-center justify-center gap-1.5">
                                     <button aria-label="View Statement Ledger" 
                                       onClick={() => selectCustomer(c.id)}
                                       className="p-1.5 text-slate-400 hover:text-lime-700 dark:hover:text-lime-400 hover:bg-lime-50 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                       title="View Statement Ledger"
                                     >
                                        <FileText size={16} />
                                     </button>
                                     {canEdit && (
                                        <button aria-label="Edit Customer" 
                                          onClick={() => handleEdit(c)}
                                          className="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                          title="Edit Customer"
                                        >
                                           <Edit size={16} />
                                        </button>
                                      )}
                                      {canDelete && (
                                        <button aria-label="Delete Customer" 
                                          onClick={() => initiateDelete(c)}
                                          className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-rose-400 hover:bg-red-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                                          title="Delete Customer"
                                        >
                                           <Trash2 size={16} />
                                        </button>
                                      )}
                                  </div>
                               </td>
                             </tr>
                          );
                       })}
                       <LoadMoreRow colSpan={6} sentinelRef={customerWindow.sentinelRef} hiddenCount={customerWindow.hiddenCount} onShowMore={customerWindow.showMore} onShowAll={customerWindow.showAll} />
                       </tbody>
                   </table>
                </div>
             </div>}
          </div>
        </div>
      )}

      {isFormOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsFormOpen(false)} />
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 flex flex-col max-h-[90vh] z-10 animate-in zoom-in-95 duration-150">
            <div className="px-6 py-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
              <h3 className="font-black text-lg text-slate-800 flex items-center gap-2">
                <UserPlus size={20} className="text-lime-600"/> {editingCustomer ? 'Edit Customer' : 'Add New Customer'}
              </h3>
              <button aria-label="Band karein" onClick={() => setIsFormOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">
                <X size={20}/>
              </button>
            </div>

            <form onSubmit={handleSubmitCustomer} className="p-6 overflow-y-auto space-y-4 flex-1">
              <div>
                <label className={labelClass}>Customer Name *</label>
                <input 
                  type="text" 
                  required
                  placeholder="e.g. Haji Muhammad Ali"
                  className={inputClass}
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                />
              </div>

              <div>
                <label className={labelClass}>Primary Phone Number</label>
                <input 
                  type="tel" 
                  placeholder="03001234567"
                  className={inputClass}
                  value={formData.phone}
                  onChange={e => setFormData({...formData, phone: e.target.value})}
                />
              </div>

              <div className="flex items-center gap-2">
                <input 
                  type="checkbox"
                  id="phone_is_whatsapp"
                  className="rounded border-slate-300 text-lime-600 focus:ring-lime-500 w-4 h-4 cursor-pointer"
                  checked={formData.is_phone_whatsapp}
                  onChange={e => setFormData({...formData, is_phone_whatsapp: e.target.checked})}
                />
                <label htmlFor="phone_is_whatsapp" className="text-xs font-semibold text-slate-700 cursor-pointer">
                  Primary phone is also WhatsApp
                </label>
              </div>

              {!formData.is_phone_whatsapp && (
                <div>
                  <label className={labelClass}>WhatsApp Number</label>
                  <input 
                    type="tel" 
                    placeholder="03001234567"
                    className={inputClass}
                    value={formData.whatsapp}
                    onChange={e => setFormData({...formData, whatsapp: e.target.value})}
                  />
                </div>
              )}

              {formData.additional_phones.map((phoneItem, index) => (
                <div key={index} className="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-600">Secondary Contact #{index + 1}</span>
                    <button aria-label="Hatayen" 
                      type="button" 
                      onClick={() => handleRemovePhoneField(index)}
                      className="text-red-500 hover:text-red-700 p-1 cursor-pointer"
                    >
                      <X size={14}/>
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input 
                      type="tel" 
                      placeholder="Phone number"
                      className={inputClass}
                      value={phoneItem.phone}
                      onChange={e => handleUpdatePhoneField(index, 'phone', e.target.value)}
                    />
                    <input 
                      type="text" 
                      placeholder="Label (e.g. Home, Brother)"
                      className={inputClass}
                      value={phoneItem.label}
                      onChange={e => handleUpdatePhoneField(index, 'label', e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox"
                      id={`additional_wa_${index}`}
                      className="rounded border-slate-300 text-lime-600 focus:ring-lime-500 w-3.5 h-3.5 cursor-pointer"
                      checked={phoneItem.is_whatsapp}
                      onChange={e => handleUpdatePhoneField(index, 'is_whatsapp', e.target.checked)}
                    />
                    <label htmlFor={`additional_wa_${index}`} className="text-xs text-slate-600 cursor-pointer">
                      Has WhatsApp
                    </label>
                  </div>
                </div>
              ))}

              <button 
                type="button" 
                onClick={handleAddPhoneField}
                className="text-xs text-blue-600 hover:text-blue-700 font-bold flex items-center gap-1 cursor-pointer"
              >
                <Plus size={14}/> Add Another Phone Number
              </button>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div>
                  <label className={labelClass}>City / Area</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Lahore"
                    className={inputClass}
                    value={formData.city}
                    onChange={e => setFormData({...formData, city: e.target.value})}
                  />
                </div>
                <div>
                  <label className={labelClass}>{editingCustomer ? 'Current Balance (Rs)' : 'Initial Balance (Rs)'}</label>
                  <input
                    type="number"
                    placeholder="0"
                    className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-500`}
                    value={formData.balance}
                    disabled={!!editingCustomer}
                    title={editingCustomer ? 'Balance khaate ki entries (Payment / Charge) se badalta hai' : undefined}
                    onChange={e => setFormData({...formData, balance: parseFloat(e.target.value) || 0})}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Complete Address</label>
                <input 
                  type="text" 
                  placeholder="Shop #, Street, Colony..."
                  className={inputClass}
                  value={formData.address}
                  onChange={e => setFormData({...formData, address: e.target.value})}
                />
              </div>

              <div>
                <label className={labelClass}>Notes / Remarks</label>
                <textarea 
                  rows={2}
                  placeholder="Special instructions, delivery timing, etc."
                  className={inputClass}
                  value={formData.notes}
                  onChange={e => setFormData({...formData, notes: e.target.value})}
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input 
                  type="checkbox"
                  id="customer_is_active"
                  className="rounded border-slate-300 text-lime-600 focus:ring-lime-500 w-4 h-4 cursor-pointer"
                  checked={formData.isActive}
                  onChange={e => setFormData({...formData, isActive: e.target.checked})}
                />
                <label htmlFor="customer_is_active" className="text-xs font-semibold text-slate-700 cursor-pointer">
                  Active Customer Account
                </label>
              </div>

              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button 
                  type="button" 
                  onClick={() => setIsFormOpen(false)}
                  className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 text-sm cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={isSubmitting}
                  className={`flex-1 py-3 text-white font-bold rounded-xl text-sm shadow-lg flex items-center justify-center gap-2 cursor-pointer ${
                    isSubmitting ? 'bg-slate-400 cursor-not-allowed shadow-none' : 'bg-lime-600 hover:bg-lime-700 shadow-lime-200'
                  }`}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Saving...
                    </>
                  ) : (
                    editingCustomer ? 'Update Customer' : 'Save Customer'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedPaymentCustomerId && activePaymentCustomer && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setSelectedPaymentCustomerId(null)} />
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 z-10 animate-in zoom-in-95 duration-150">
            <div className="px-6 py-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <div>
                <h3 className="font-black text-lg text-slate-900 flex items-center gap-2">
                  <DollarSign size={20} className="text-emerald-600"/> Record Khata Transaction
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">{activePaymentCustomer.name}</p>
              </div>
              <button aria-label="Band karein" onClick={() => setSelectedPaymentCustomerId(null)} className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">
                <X size={20}/>
              </button>
            </div>

            <form onSubmit={handleRecordPaymentSubmit} className="p-6 space-y-4">
              {/* A khata Charge needs customers:edit (the context refuses it otherwise): payment-only users get no toggle. */}
              {canEdit && (
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-2xl">
                <button 
                  type="button" 
                  onClick={() => setPaymentType('Payment')}
                  className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${paymentType === 'Payment' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Payment (Received)
                </button>
                <button 
                  type="button" 
                  onClick={() => setPaymentType('Charge')}
                  className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${paymentType === 'Charge' ? 'bg-red-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Charge (Debit Khata)
                </button>
              </div>
              )}

              <div>
                <label className={labelClass}>Amount (Rs) *</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-sm">Rs</span>
                  <input 
                    type="number" 
                    step="any"
                    required
                    placeholder="0.00"
                    className={`${inputClass} pl-10 text-lg font-bold font-mono`}
                    value={paymentData.amount}
                    onChange={e => setPaymentData({...paymentData, amount: e.target.value})}
                    autoFocus
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Date</label>
                  <input 
                    type="date" 
                    className={inputClass}
                    value={paymentData.date}
                    onChange={e => setPaymentData({...paymentData, date: e.target.value})}
                  />
                </div>
                <div>
                  <label className={labelClass}>Payment Mode</label>
                  <select 
                    className={inputClass}
                    value={paymentData.mode}
                    onChange={e => {
                      const newMode = e.target.value;
                      const nextAccId = getDefaultAccountForMode(newMode);
                      setPaymentData({...paymentData, mode: newMode, accountId: nextAccId});
                    }}
                  >
                    <option value="Cash">Cash</option>
                    <option value="Online">Online Transfer</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                </div>
              </div>

              {paymentType === 'Payment' ? (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className={labelClass + " !mb-0"}>Deposit To Financial Account *</label>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800">
                      Required
                    </span>
                  </div>
                  <select 
                    className={`${inputClass} ${!paymentData.accountId ? 'border-amber-400 focus:border-amber-500' : ''}`}
                    value={paymentData.accountId}
                    required
                    onChange={e => setPaymentData({...paymentData, accountId: e.target.value})}
                  >
                    <option value="">-- Select Financial Account (Required) --</option>
                    {accounts.filter(a => a.isActive !== false).map(acc => {
                      const isDefaultCash = acc.id === settings?.financial?.defaultCashAccountId;
                      const isDefaultDigital = acc.id === settings?.financial?.defaultDigitalAccountId;
                      const isActiveTill = activeShiftSession && (acc.id === activeShiftSession.drawer_id || acc.id === activeShiftSession.account_id);
                      return (
                        <option key={acc.id} value={acc.id}>
                          {acc.name} ({acc.type}) - Bal: {formatCurrency(Number(acc.balance || 0))}
                          {isActiveTill ? ' [Active Till]' : ''}
                          {isDefaultCash ? ' ★ Default Cash' : ''}
                          {isDefaultDigital ? ' ★ Default Digital' : ''}
                        </option>
                      );
                    })}
                  </select>
                  {paymentData.accountId ? (() => {
                    const selAcc = accounts.find(a => a.id === paymentData.accountId);
                    if (!selAcc) return null;
                    return (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between">
                        <span>Selected: <strong className="text-slate-700 dark:text-slate-200">{selAcc.name}</strong> ({selAcc.type})</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">Current Bal: {formatCurrency(Number(selAcc.balance || 0))}</span>
                      </p>
                    );
                  })() : (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 font-medium">
                      ⚠️ Baraye meherbani account select karein jahan payment deposit karni hai.
                    </p>
                  )}
                </div>
              ) : (
                <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-2xl border border-red-200 dark:border-red-900/40 text-xs">
                  <div className="font-bold text-red-800 dark:text-red-300 flex items-center gap-1.5 mb-1">
                    <Info size={14} className="shrink-0" />
                    Khata Charge (Customer Udhaar)
                  </div>
                  <p className="text-red-700/90 dark:text-red-400 text-[11px] leading-relaxed">
                    Yeh raqam customer ke ledger khata balance mein izafa karegi (customer ke zimme udhaar barh jayega). Cash ya Bank account par koi asar nahi parega.
                  </p>
                </div>
              )}

              <div>
                <label className={labelClass}>Notes / Description</label>
                <input 
                  type="text" 
                  placeholder={paymentType === 'Payment' ? 'e.g. Paid in full via cash' : 'e.g. Delivery charges / Extra milk supply'}
                  className={inputClass}
                  value={paymentData.note}
                  onChange={e => setPaymentData({...paymentData, note: e.target.value})}
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input 
                  type="checkbox"
                  id="send_whatsapp_receipt_2"
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                  checked={sendWhatsAppReceipt}
                  onChange={e => setSendWhatsAppReceipt(e.target.checked)}
                />
                <label htmlFor="send_whatsapp_receipt_2" className="text-xs font-semibold text-slate-700 cursor-pointer">
                  Send instant WhatsApp receipt to customer
                </label>
              </div>

              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button 
                  type="button" 
                  onClick={() => setSelectedPaymentCustomerId(null)}
                  className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 text-sm cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={isSubmittingPayment}
                  className={`flex-1 py-3 text-white font-bold rounded-xl text-sm transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer ${
                    paymentType === 'Payment' 
                      ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20' 
                      : 'bg-red-600 hover:bg-red-700 shadow-red-500/20'
                  }`}
                >
                  {isSubmittingPayment ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Saving...
                    </>
                  ) : (
                    paymentType === 'Payment' ? 'Save Payment (Deposit)' : 'Save Khata Charge'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteConfig.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setDeleteConfig({...deleteConfig, isOpen: false})} />
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-150 border border-slate-200 z-10 overflow-hidden">
            {deleteConfig.isBulk ? (
              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mb-4 text-amber-600">
                  <Archive size={24} />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">Archive {selectedIds.size} Customers?</h3>
                <p className="text-xs text-slate-600 mb-6 leading-relaxed">
                  QuickBooks Rule: Selected customers will be marked <strong>Inactive (Archived)</strong>. They will be hidden from POS & daily routes while their financial history and ledger records remain fully preserved.
                </p>
                <div className="flex gap-3 w-full">
                  <button 
                    onClick={() => setDeleteConfig({...deleteConfig, isOpen: false})}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleBulkDeactivate}
                    disabled={isDeleting}
                    className="flex-1 py-2.5 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-700 text-xs shadow-md shadow-amber-200 cursor-pointer"
                  >
                    Make Inactive
                  </button>
                </div>
              </div>
            ) : (() => {
              const assessment = deleteConfig.id ? getDeleteAssessment('customer', deleteConfig.id) : null;
              if (!assessment) return null;

              if (assessment.balance !== 0) {
                const bal = assessment.balance;
                return (
                  <div>
                    <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 rounded-full flex items-center justify-center mx-auto mb-3 shadow-xs">
                      <AlertTriangle size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white text-center mb-1">Open Balance Warning</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 text-center mb-4">QuickBooks Rule: Financial records cannot be deleted with an open balance</p>

                    <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200/80 dark:border-rose-900/60 rounded-2xl p-4 mb-4 text-center">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 block">
                        {bal > 0 ? 'Receivable Khata (Customer Owes)' : 'Advance Credit (Mooco Owes)'}
                      </span>
                      <span className="text-2xl font-black font-mono text-rose-700 dark:text-rose-300 mt-1 block">
                        {formatCurrency(Math.abs(bal))}
                      </span>
                      <p className="text-[11px] text-rose-600/90 dark:text-rose-400/90 mt-1">
                        Deleting directly will break the Balance Sheet!
                      </p>
                    </div>

                    <div className="space-y-2.5">
                      <button
                        onClick={() => handleSmartDelete('write_off_bad_debt')}
                        disabled={isDeleting}
                        className="w-full py-3 px-4 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs flex flex-col items-center justify-center gap-0.5 shadow-md shadow-rose-200 cursor-pointer transition-all"
                      >
                        <span>Write Off as Bad Debt & Make Inactive</span>
                        <span className="text-[10px] opacity-80 font-normal">Auto-posts loss expense & preserves Balance Sheet equilibrium</span>
                      </button>

                      <button
                        onClick={() => handleSmartDelete('deactivate')}
                        disabled={isDeleting}
                        className="w-full py-2.5 px-4 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                      >
                        <Archive size={14} />
                        <span>Keep Khata & Make Inactive (Hide from POS)</span>
                      </button>

                      <button
                        onClick={() => setDeleteConfig({ ...deleteConfig, isOpen: false })}
                        className="w-full py-2.5 bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold rounded-xl text-xs cursor-pointer transition-all"
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
                    <h3 className="text-lg font-bold text-slate-900 text-center mb-1">Archive Customer</h3>
                    <p className="text-xs text-slate-500 text-center mb-4">QuickBooks Rule: Preserve historical sales & ledger audit trails</p>

                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 mb-4 text-xs text-slate-600 space-y-1.5">
                      <div className="flex justify-between font-medium">
                        <span>Customer Name:</span>
                        <strong className="text-slate-800">{deleteConfig.name}</strong>
                      </div>
                      <div className="flex justify-between font-medium">
                        <span>Khata Balance:</span>
                        <span className="font-mono font-bold text-emerald-600">Rs 0 (Settled)</span>
                      </div>
                      <div className="flex justify-between font-medium">
                        <span>Past History:</span>
                        <span className="font-mono text-slate-700 font-bold">
                          {assessment.details?.salesCount || 0} Bills, {assessment.details?.txCount || 0} Txns
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 mb-5 leading-relaxed">
                      This customer will be marked <strong>Inactive</strong>. They will be hidden from new POS sales and route delivery dropdowns, but all historical bills, receipts, and reports remain 100% intact.
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
                        disabled={isDeleting}
                        className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs shadow-md shadow-amber-200 cursor-pointer"
                      >
                        Make Inactive
                      </button>
                    </div>
                  </div>
                );
              }

              // Fresh customer with no history and a zero balance.
              return (
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-3">
                    <Trash2 size={24} />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-1">Permanent Deletion</h3>
                  <p className="text-xs text-emerald-600 font-bold mb-3">No transaction history found (Safe to delete)</p>
                  <p className="text-xs text-slate-600 mb-6">
                    Customer <strong className="text-slate-800">{deleteConfig.name}</strong> has no sales, deliveries, or balance. This will permanently remove them from the database.
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
                      disabled={isDeleting}
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

      {selectedInvoiceSale && (() => {
        const saleDateTime = formatSaleDateTime(
          selectedInvoiceSale.date || (selectedInvoiceSale as any).created_at,
          (selectedInvoiceSale as any).time || selectedInvoiceSale.details?.time
        );
        const hasCustomerPhone = Boolean(activeCustomer?.whatsapp || activeCustomer?.phone);

        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-150">
              
              <div className="px-5 py-4 bg-slate-50 dark:bg-slate-800/80 text-slate-900 dark:text-white flex justify-between items-center border-b border-slate-200 dark:border-slate-800 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-lime-100 dark:bg-lime-950/50 text-lime-700 dark:text-lime-300 flex items-center justify-center font-bold border border-lime-200 dark:border-lime-800/40 shadow-xs">
                    <Receipt size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-mono font-black text-base sm:text-lg text-slate-900 dark:text-white">
                        {selectedInvoiceSale.bill_number ? `#${selectedInvoiceSale.bill_number}` : `INV-${selectedInvoiceSale.id.slice(-6)}`}
                      </h3>
                      <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 ${
                        selectedInvoiceSale.status === 'Returned'
                          ? 'bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                          : (selectedInvoiceSale as any).status === 'Partially Returned'
                          ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                          : 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                      }`}>
                        {selectedInvoiceSale.status === 'Returned' ? (
                          <>
                            <RotateCcw size={10} />
                            <span>Returned</span>
                          </>
                        ) : (selectedInvoiceSale as any).status === 'Partially Returned' ? (
                          <>
                            <RotateCcw size={10} />
                            <span>Partial Return</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={10} />
                            <span>Completed</span>
                          </>
                        )}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 dark:text-slate-400 font-mono mt-0.5 flex items-center gap-1.5">
                      <Calendar size={11} />
                      <span>{saleDateTime.date}</span>
                      {saleDateTime.time && (
                        <>
                          <span>•</span>
                          <Clock size={11} />
                          <span>{saleDateTime.time}</span>
                        </>
                      )}
                    </p>
                  </div>
                </div>
                <button aria-label="Close Dialog" 
                  onClick={() => setSelectedInvoiceSale(null)} 
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Close Dialog"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-4 sm:p-5 space-y-4 overflow-y-auto max-h-[calc(90vh-140px)] flex-1">
                
                <div className="grid grid-cols-2 gap-2.5 bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-xs">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">Customer</span>
                    <span className="font-black text-slate-900 dark:text-white block truncate text-sm">
                      {selectedInvoiceSale.customer_name || activeCustomer?.name || 'Customer'}
                    </span>
                    {activeCustomer?.phone && (
                      <span className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                        <Phone size={10} /> {activeCustomer.phone}
                      </span>
                    )}
                    <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-md font-bold bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60">
                      Khata Account
                    </span>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">Payment Mode</span>
                    <div className="flex items-center gap-1.5 justify-end">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                        selectedInvoiceSale.payment_mode === 'Cash'
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                          : selectedInvoiceSale.payment_mode === 'Online'
                          ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                          : 'bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                      }`}>
                        {selectedInvoiceSale.payment_mode}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <span className="text-[10px] text-slate-400 block">Ledger Posting:</span>
                      <span className={`text-[11px] font-bold ${
                        selectedInvoiceSale.payment_mode === 'Credit' 
                          ? 'text-rose-600 dark:text-rose-400' 
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}>
                        {selectedInvoiceSale.payment_mode === 'Credit' ? 'Charged to Khata (Due)' : 'Paid on Counter'}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
                      <Layers size={13} className="text-lime-600" />
                      <span>Billed Items ({selectedInvoiceSale.items?.length || 0})</span>
                    </span>
                  </div>
                  
                  <div className="bg-white dark:bg-slate-850 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-50 dark:bg-slate-800/80 text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="px-3.5 py-2.5">Item</th>
                          <th className="px-2.5 py-2.5 text-center">Qty</th>
                          <th className="px-2.5 py-2.5 text-right">Rate</th>
                          <th className="px-3.5 py-2.5 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {selectedInvoiceSale.items && selectedInvoiceSale.items.length > 0 ? (
                          selectedInvoiceSale.items.map((it, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                              <td className="px-3.5 py-2.5">
                                <span className="font-bold text-slate-900 dark:text-white block">{it.name}</span>
                                {(it as any).variantName && (
                                  <span className="text-[10px] text-slate-400 block">{(it as any).variantName}</span>
                                )}
                              </td>
                              <td className="px-2.5 py-2.5 text-center font-bold text-slate-800 dark:text-slate-200 font-mono">
                                {it.qty} <span className="text-[10px] font-normal text-slate-400">{(it as any).variantName ? 'Pack' : ((it as any).unit || 'Unit')}</span>
                              </td>
                              <td className="px-2.5 py-2.5 text-right font-mono text-slate-600 dark:text-slate-400">
                                {formatCurrency(it.price)}
                              </td>
                              <td className="px-3.5 py-2.5 text-right font-mono font-black text-slate-900 dark:text-white">
                                {formatCurrency((it.total || (it.qty * it.price)))}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={4} className="p-4 text-center text-slate-400 italic">No item details recorded</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-600 dark:text-slate-400">
                    <span>Subtotal:</span>
                    <span className="font-mono font-bold">{formatCurrency((selectedInvoiceSale.subtotal || selectedInvoiceSale.total))}</span>
                  </div>
                  {selectedInvoiceSale.discount > 0 && (
                    <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                      <span>Discount:</span>
                      <span className="font-mono">- {formatCurrency(selectedInvoiceSale.discount)}</span>
                    </div>
                  )}
                  {selectedInvoiceSale.refund_amount !== undefined && selectedInvoiceSale.refund_amount > 0 && (
                    <div className="flex justify-between text-rose-600 dark:text-rose-400 font-semibold">
                      <span>Refunded Amount:</span>
                      <span className="font-mono">- {formatCurrency(selectedInvoiceSale.refund_amount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center font-black text-slate-900 dark:text-white pt-2 border-t border-slate-200 dark:border-slate-700">
                    <span className="text-sm">Grand Total:</span>
                    <span className="text-lg font-mono text-lime-700 dark:text-lime-400">{formatCurrency((selectedInvoiceSale.total || 0))}</span>
                  </div>

                  {selectedInvoiceSale.return_reason && (
                    <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl text-rose-700 dark:text-rose-300 text-xs mt-2">
                      <strong>Return Reason:</strong> {selectedInvoiceSale.return_reason}
                    </div>
                  )}
                </div>

              </div>

              <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedInvoiceSale(null)}
                  className="px-4 py-2 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                >
                  Close
                </button>

                <div className="flex items-center gap-2">
                  {hasCustomerPhone && (
                    <button
                      type="button"
                      onClick={() => handleWhatsAppShareInvoice(selectedInvoiceSale)}
                      className="px-3.5 py-2 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Share Receipt on WhatsApp"
                    >
                      <MessageCircle size={14} />
                      <span className="hidden sm:inline">WhatsApp</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handlePrintInvoiceReceipt(selectedInvoiceSale)}
                    className="px-4 py-2 bg-lime-600 hover:bg-lime-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md shadow-lime-600/20 transition-all cursor-pointer active:scale-95"
                  >
                    <Printer size={14} />
                    <span>Print Receipt</span>
                  </button>
                </div>
              </div>

            </div>
          </div>
        );
      })()}

      {selectedTxEntry && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
            
            <div className="px-5 py-4 bg-slate-50 dark:bg-slate-800/80 text-slate-900 dark:text-white flex justify-between items-center border-b border-slate-200 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold border shadow-xs ${
                  selectedTxEntry.type === 'Payment'
                    ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                    : selectedTxEntry.type === 'Return'
                    ? 'bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                    : 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                }`}>
                  <FileText size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
                    {selectedTxEntry.type === 'Payment' ? 'Payment Receipt Voucher' : selectedTxEntry.type === 'Return' ? 'Sales Return Voucher' : 'Khata Charge Voucher'}
                  </h3>
                  <p className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
                    <Calendar size={11} /> {selectedTxEntry.date}
                  </p>
                </div>
              </div>
              <button aria-label="Close Dialog" 
                onClick={() => setSelectedTxEntry(null)} 
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title="Close Dialog"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div className="text-center p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Voucher Amount</span>
                <p className={`text-2xl font-black font-mono tracking-tight ${
                  selectedTxEntry.credit > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}>
                  {formatCurrency((selectedTxEntry.credit || selectedTxEntry.debit || 0))}
                </p>
                <span className={`inline-block px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                  selectedTxEntry.credit > 0 
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60' 
                    : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60'
                }`}>
                  {selectedTxEntry.credit > 0 ? 'Credit (Payment Received)' : 'Debit (Customer Charge)'}
                </span>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/40 rounded-2xl p-3.5 border border-slate-200 dark:border-slate-800 space-y-2.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400 font-medium">Customer:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{activeCustomer?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-medium">Payment Mode:</span>
                  <span className="font-bold font-mono text-slate-800 dark:text-slate-200">{selectedTxEntry.mode || 'Cash'}</span>
                </div>
                <div className="flex justify-between items-start gap-2">
                  <span className="text-slate-400 font-medium shrink-0">Description:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 text-right">{selectedTxEntry.description}</span>
                </div>
                {selectedTxEntry.note && (
                  <div className="flex justify-between items-start gap-2 border-t border-slate-200 dark:border-slate-700/60 pt-2">
                    <span className="text-slate-400 font-medium shrink-0">Note:</span>
                    <span className="italic text-slate-600 dark:text-slate-300 text-right">{selectedTxEntry.note}</span>
                  </div>
                )}
                {selectedTxEntry.runningBalance !== undefined && (
                  <div className="flex justify-between border-t border-slate-200 dark:border-slate-700/60 pt-2">
                    <span className="text-slate-400 font-medium">Running Balance:</span>
                    <span className="font-bold font-mono text-slate-900 dark:text-white">
                      {formatCurrency(Math.abs(selectedTxEntry.runningBalance))} {selectedTxEntry.runningBalance > 0 ? 'Dr' : 'Cr'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setSelectedTxEntry(null)}
                className="px-4 py-2 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
              >
                Close
              </button>

              <div className="flex items-center gap-2">
                {selectedTxEntry.canDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      const id = selectedTxEntry.id;
                      setSelectedTxEntry(null);
                      handleDeleteTransaction(id);
                    }}
                    className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 rounded-xl text-xs font-bold border border-rose-200 dark:border-rose-800 flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Delete Transaction"
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handlePrintVoucher(selectedTxEntry)}
                  className="px-4 py-2 bg-lime-600 hover:bg-lime-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md shadow-lime-600/20 transition-all cursor-pointer active:scale-95"
                >
                  <Printer size={13} />
                  <span>Print Voucher</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default Customers;
