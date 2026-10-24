import React, { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import type { Customer, CustomerTransaction, POSBill } from '../types';
import { formatCurrency } from '../lib/formatters';
import { roundCurrency } from '../lib/db';
import { useMediaQuery, BREAKPOINTS } from '../hooks/useMediaQuery';
import { useProgressiveList } from '../hooks/useProgressiveList';
import { confirmAction } from '../components/ui/ConfirmDialog';
import { CustomerList, CustomerStats, type BalanceFilter, type CustomerSort, type StatusFilter } from '../components/customers/CustomerList';
import { CustomerDetail } from '../components/customers/CustomerDetail';
import { useStableCallback } from '../components/customers/CustomerBits';
import {
  EMPTY_LEDGER, balanceState, balanceWords, buildCustomerSearchIndex, buildLedger, buildSaleSearchIndex, canonicalPhone,
  customersWithMatchingBills, indexByCustomer, localDay, matchesCustomerQuery, openWhatsApp, saleCustomerId, whatsAppNumber,
  type LedgerEntry,
} from '../components/customers/customerUtils';
import type { CustomerPayload } from '../components/customers/CustomerFormModal';
import type { KhataEntryInput } from '../components/customers/PaymentModal';
import type { DeleteAction, DeleteTarget } from '../components/customers/DeleteCustomerModal';
import type { ShopInfo } from '../components/customers/printDocs';

// Dialogs and print templates load on first use, so the list renders from a small chunk.
const loadFormModal = () => import('../components/customers/CustomerFormModal');
const loadPaymentModal = () => import('../components/customers/PaymentModal');
const CustomerFormModal = lazy(loadFormModal);
const PaymentModal = lazy(loadPaymentModal);
const DeleteCustomerModal = lazy(() => import('../components/customers/DeleteCustomerModal'));
const InvoiceModal = lazy(() => import('../components/customers/EntryModals').then(m => ({ default: m.InvoiceModal })));
const VoucherModal = lazy(() => import('../components/customers/EntryModals').then(m => ({ default: m.VoucherModal })));

const BALANCE_STATE = { Due: 'due', Advance: 'advance', Settled: 'settled' } as const;

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
    reactivateEntity,
    hasLoadedData,
  } = useDairy();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  const canCreate = canPerform('customers', 'create');
  const canEdit = canPerform('customers', 'edit');
  const canDelete = canPerform('customers', 'delete');
  const canPay = canPerform('customers', 'payment');
  const canOrders = hasPermission('customer_orders');

  // ---- Selected customer (kept in the URL so back/forward and links work) ----
  const [activeCustomerId, setActiveCustomerId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('id') || null);

  const selectCustomer = useCallback((id: string | null) => {
    setActiveCustomerId(id);
    navigate(id ? `/customers?id=${encodeURIComponent(id)}` : '/customers');
  }, [navigate]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setActiveCustomerId(params.get('id') || (location.state as any)?.customerId || null);
  }, [location.search, location.state]);

  // Selection requested by the Command Palette or another screen.
  useEffect(() => {
    const handleSelect = (e: any) => {
      const targetId = e?.detail?.customerId;
      if (targetId) selectCustomer(targetId);
    };
    window.addEventListener('mooco-select-customer', handleSelect);
    return () => window.removeEventListener('mooco-select-customer', handleSelect);
  }, [selectCustomer]);

  // Warm the two dialogs people open most, once the list is on screen.
  useEffect(() => {
    const w = window as any;
    const prefetch = () => { loadPaymentModal(); loadFormModal(); };
    const handle = w.requestIdleCallback ? w.requestIdleCallback(prefetch, { timeout: 4000 }) : window.setTimeout(prefetch, 2000);
    return () => { if (w.cancelIdleCallback) w.cancelIdleCallback(handle); else window.clearTimeout(handle); };
  }, []);

  // ---- Indexes: built once per data change, so typing and opening a ledger never rescan every sale ----
  const customerList = useMemo(() => (customers || []).filter(Boolean), [customers]);
  const salesByCustomer = useMemo(() => indexByCustomer(sales || [], saleCustomerId), [sales]);
  const txByCustomer = useMemo(() => indexByCustomer<CustomerTransaction>(customerTransactions || [], tx => tx.customer_id), [customerTransactions]);
  const salesById = useMemo(() => new Map<string, POSBill>((sales || []).map(s => [s.id, s] as const)), [sales]);
  const searchIndex = useMemo(() => buildCustomerSearchIndex(customerList), [customerList]);

  const isMdScreen = useMediaQuery(BREAKPOINTS.md);
  const loading = !hasLoadedData && customerList.length === 0;

  // ---- List: search, filters, counts, sort ----
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBalance, setFilterBalance] = useState<BalanceFilter>('All');
  const [filterActiveStatus, setFilterActiveStatus] = useState<StatusFilter>('Active');
  const [sort, setSort] = useState<CustomerSort>('default');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const deferredSearch = useDeferredValue(searchTerm);
  const query = deferredSearch.toLowerCase().trim();

  // Bill numbers are only indexed while someone is searching.
  const hasQuery = query !== '';
  const saleSearchIndex = useMemo(() => (hasQuery ? buildSaleSearchIndex(sales || []) : []), [sales, hasQuery]);

  const stats = useMemo(() => {
    const s = { total: customerList.length, active: 0, inactive: 0, dueTotal: 0, dueCount: 0, advanceTotal: 0, advanceCount: 0 };
    for (const c of customerList) {
      if (c.isActive === false) s.inactive += 1;
      else s.active += 1;
      const state = balanceState(c.balance);
      if (state === 'due') { s.dueTotal += Number(c.balance); s.dueCount += 1; }
      else if (state === 'advance') { s.advanceTotal += Math.abs(Number(c.balance)); s.advanceCount += 1; }
    }
    s.dueTotal = roundCurrency(s.dueTotal);
    s.advanceTotal = roundCurrency(s.advanceTotal);
    return s;
  }, [customerList]);

  const searchMatches = useMemo(() => {
    if (!query) return customerList;
    // Digits only count as a phone search when the query has no letters ("ali 03" is a name search).
    const queryPhone = /[a-z]/i.test(query) ? '' : canonicalPhone(query);
    const billMatches = customersWithMatchingBills(query, saleSearchIndex);
    return customerList.filter(c => matchesCustomerQuery(searchIndex.get(c.id), query, queryPhone) || billMatches.has(c.id));
  }, [customerList, query, searchIndex, saleSearchIndex]);

  const statusCounts = useMemo(() => {
    let inactive = 0;
    for (const c of searchMatches) if (c.isActive === false) inactive += 1;
    return { All: searchMatches.length, Active: searchMatches.length - inactive, Inactive: inactive };
  }, [searchMatches]);

  const statusMatches = useMemo(() => {
    if (filterActiveStatus === 'All') return searchMatches;
    return searchMatches.filter(c => (filterActiveStatus === 'Inactive') === (c.isActive === false));
  }, [searchMatches, filterActiveStatus]);

  // Counts follow the search and status filter, so each pill says how many rows it will show.
  const balanceCounts = useMemo(() => {
    const counts = { All: statusMatches.length, Due: 0, Advance: 0, Settled: 0 };
    for (const c of statusMatches) {
      const state = balanceState(c.balance);
      if (state === 'due') counts.Due += 1;
      else if (state === 'advance') counts.Advance += 1;
      else counts.Settled += 1;
    }
    return counts;
  }, [statusMatches]);

  const filteredCustomers = useMemo(() => {
    const list = filterBalance === 'All' ? statusMatches : statusMatches.filter(c => balanceState(c.balance) === BALANCE_STATE[filterBalance]);
    if (sort === 'default') return list;
    const sorted = [...list];
    if (sort === 'name') sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }));
    else sorted.sort((a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0));
    return sorted;
  }, [statusMatches, filterBalance, sort]);

  const customerWindow = useProgressiveList<Customer>(filteredCustomers, 80, `${query}|${filterBalance}|${filterActiveStatus}|${sort}`);

  // Bulk actions only ever touch customers the current filter shows; a selection made under another
  // filter used to stay in the set and get archived without being on screen.
  const visibleSelected = useMemo(() => {
    const ids = new Set<string>();
    if (selectedIds.size === 0) return ids;
    for (const c of filteredCustomers) if (selectedIds.has(c.id)) ids.add(c.id);
    return ids;
  }, [filteredCustomers, selectedIds]);

  const toggleSelectOne = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = (checked: boolean) => setSelectedIds(checked ? new Set(filteredCustomers.map(c => c.id)) : new Set());

  const clearFilters = () => {
    setSearchTerm('');
    setFilterBalance('All');
    setFilterActiveStatus('Active');
  };

  const pickStat = useCallback((balance: BalanceFilter, status: StatusFilter) => {
    setFilterBalance(balance);
    setFilterActiveStatus(status);
  }, []);

  // ---- Active customer and ledger ----
  const activeCustomer = useMemo(() => customerList.find(c => c.id === activeCustomerId) || null, [customerList, activeCustomerId]);

  const ledger = useMemo(() => {
    if (!activeCustomer) return EMPTY_LEDGER;
    return buildLedger(activeCustomer, salesByCustomer.get(activeCustomer.id) || [], txByCustomer.get(activeCustomer.id) || [], salesById, canDelete);
  }, [activeCustomer, salesByCustomer, txByCustomer, salesById, canDelete]);

  const receiptShop = useMemo<ShopInfo>(() => ({
    companyName: settings?.general?.companyName || 'MOOCO DAIRY',
    address: settings?.general?.address || 'Fresh & Pure Farm Dairy',
    phone: settings?.general?.phone || '0300-1234567',
    footer: settings?.sales?.invoiceFooter || 'Thank you for your visit!',
  }), [settings]);

  // A printed statement shows only the shop details that are really set, never the receipt placeholders.
  const statementShop = useMemo<ShopInfo>(() => ({
    companyName: settings?.general?.companyName || 'MOOCO DAIRY',
    address: settings?.general?.address || '',
    phone: settings?.general?.phone || '',
    footer: '',
  }), [settings]);

  // ---- Add / edit customer ----
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const handleOpenAddForm = useCallback(() => {
    setEditingCustomer(null);
    setIsFormOpen(true);
  }, []);

  const handleEdit = useCallback((customer: Customer) => {
    setEditingCustomer(customer);
    setIsFormOpen(true);
  }, []);

  const closeForm = useCallback(() => {
    setIsFormOpen(false);
    setEditingCustomer(null);
  }, []);

  const handleSubmitCustomer = async (payload: CustomerPayload) => {
    try {
      if (editingCustomer) {
        // Balance only changes through ledger entries (payment / charge). Sending the form's copy would
        // set the balance to the figure seen when the form opened, undoing any payment or sale posted
        // since, with no ledger entry behind the change.
        const { balance: _openingOnly, ...profile } = payload;
        const ok = await updateCustomer(editingCustomer.id, profile);
        if (!ok) return false;
        showToast('Customer details updated', 'success');
      } else {
        // addCustomer shows its own success toast.
        const newId = await addCustomer(payload as any);
        if (newId === false) return false;
      }
      closeForm();
      return true;
    } catch (err: any) {
      showToast("Customer couldn't be saved: " + (err?.message || 'please try again'), 'error');
      return false;
    }
  };

  // ---- Payment / charge ----
  const [paymentCustomerId, setPaymentCustomerId] = useState<string | null>(null);
  const [sendWhatsAppReceipt, setSendWhatsAppReceipt] = useState(true);
  const paymentCustomer = useMemo(() => customerList.find(c => c.id === paymentCustomerId) || null, [customerList, paymentCustomerId]);

  const getDefaultAccountForMode = useCallback((mode: string) => {
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
    }
    return (
      settings?.financial?.defaultDigitalAccountId ||
      accounts.find(a => (a.type === 'Bank' || a.type === 'Wallet') && a.isActive !== false)?.id ||
      accounts.find(a => a.isActive !== false)?.id ||
      ''
    );
  }, [activeShiftSession, settings, accounts]);

  const tillAccountIds = useMemo(
    () => [activeShiftSession?.drawer_id, activeShiftSession?.account_id].filter(Boolean) as string[],
    [activeShiftSession?.drawer_id, activeShiftSession?.account_id],
  );

  const openPayment = useCallback((customer: Customer) => setPaymentCustomerId(customer.id), []);

  const handleRecordPayment = async (input: KhataEntryInput) => {
    const customer = paymentCustomer;
    if (!customer) return false;
    if (input.type === 'Payment' && !input.accountId) {
      showToast('Please select a deposit account, or set a default account in Settings.', 'warning');
      return false;
    }
    try {
      const ok = await recordCustomerPayment(customer.id, input.amount, input.date, input.mode, input.note, input.type, input.accountId || undefined);
      if (!ok) return false;
      // The context's own toast says "Payment" for both kinds, so a charge gets its own line.
      if (input.type === 'Charge') showToast('Charge recorded', 'success');

      if (input.sendWhatsApp) {
        const phone = whatsAppNumber(customer.whatsapp || customer.phone);
        if (phone) {
          const newBal = roundCurrency(Number(customer.balance || 0) + (input.type === 'Payment' ? -input.amount : input.amount));
          const msg = `*${receiptShop.companyName} - ${input.type === 'Payment' ? 'PAYMENT RECEIPT' : 'LEDGER CHARGE'}*\n\n` +
            `Dear *${customer.name}*,\n` +
            `${input.type === 'Payment' ? 'Amount Received: ' : 'Amount Charged: '} *${formatCurrency(input.amount)}*\n` +
            `📅 Date: ${input.date}\n` +
            `💰 Current Balance: *${balanceWords(newBal, formatCurrency)}*\n\n` +
            `Thank you!`;
          openWhatsApp(phone, msg);
        }
      }
      setPaymentCustomerId(null);
      return true;
    } catch (err: any) {
      showToast("Entry couldn't be recorded: " + (err?.message || 'please try again'), 'error');
      return false;
    }
  };

  // ---- Delete / archive ----
  const [deleteRequest, setDeleteRequest] = useState<{ id: string | null; name: string } | null>(null);
  // A second click while the first is still posting would write the balance off (or forfeit the advance) twice.
  const deleteBusyRef = useRef(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const initiateDelete = useCallback((customer: Customer) => setDeleteRequest({ id: customer.id, name: customer.name }), []);
  const closeDelete = useCallback(() => { if (!deleteBusyRef.current) setDeleteRequest(null); }, []);

  const deleteTarget = useMemo<DeleteTarget | null>(() => {
    if (!deleteRequest) return null;
    if (deleteRequest.id === null) {
      return { id: null, name: deleteRequest.name, count: visibleSelected.size, balance: 0, hasHistory: true, salesCount: 0, txCount: 0 };
    }
    const assessment = getDeleteAssessment('customer', deleteRequest.id);
    // The assessment counts bills by customer_id only; this screen also links bills through
    // details.customer_id, so it uses whichever count is higher before offering a permanent delete.
    const ownSales = salesByCustomer.get(deleteRequest.id)?.length || 0;
    const ownTx = txByCustomer.get(deleteRequest.id)?.length || 0;
    const salesCount = Math.max(Number(assessment.details?.salesCount || 0), ownSales);
    const txCount = Math.max(Number(assessment.details?.txCount || 0), ownTx);
    return {
      id: deleteRequest.id,
      name: deleteRequest.name,
      count: 1,
      balance: Number(assessment.balance) || 0,
      hasHistory: assessment.hasHistory || salesCount > 0 || txCount > 0,
      salesCount,
      txCount,
    };
  }, [deleteRequest, getDeleteAssessment, salesByCustomer, txByCustomer, visibleSelected.size]);

  const handleSmartDelete = async (action: DeleteAction) => {
    const targetId = deleteRequest?.id;
    if (!targetId || deleteBusyRef.current) return;
    if (action === 'hard_delete' && deleteTarget?.hasHistory) return;
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
      if (activeCustomerId === targetId) selectCustomer(null);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });
      setDeleteRequest(null);
    }
  };

  // Archives the selected customers with one profile update each and one toast, instead of a full
  // reload and a toast per customer (safeDeleteCustomer's "deactivate" is the same update plus those).
  const handleBulkArchive = async () => {
    if (deleteBusyRef.current) return;
    const ids = Array.from(visibleSelected);
    if (ids.length === 0) { setDeleteRequest(null); return; }
    deleteBusyRef.current = true;
    setIsDeleting(true);
    let archived = 0;
    try {
      for (const id of ids) {
        if (await updateCustomer(id, { isActive: false })) archived += 1;
      }
    } finally {
      deleteBusyRef.current = false;
      setIsDeleting(false);
    }
    if (archived > 0) showToast(`${archived} customers made inactive (archived). Their ledgers and balances are kept.`, 'info');
    if (archived < ids.length) showToast(`${ids.length - archived} customers couldn't be archived, please try again.`, 'error');
    setSelectedIds(new Set());
    setDeleteRequest(null);
  };

  const handleReactivate = useCallback((customer: Customer) => {
    if (!canEdit) return;
    reactivateEntity('customer', customer.id);
  }, [canEdit, reactivateEntity]);

  // ---- Ledger entries ----
  const [selectedInvoiceSale, setSelectedInvoiceSale] = useState<POSBill | null>(null);
  const [selectedTxEntry, setSelectedTxEntry] = useState<LedgerEntry | null>(null);
  const deletingTxRef = useRef<Set<string>>(new Set());

  const handleDeleteTransaction = useStableCallback(async (entry: LedgerEntry) => {
    const id = entry.id;
    const tx: any = customerTransactions.find(t => t.id === id);
    const customer = tx ? customerList.find(c => c.id === tx.customer_id) : undefined;
    const amount = Number(tx?.amount || 0);
    const isPayment = tx?.type === 'Payment';
    const accountId = tx?.details?.account_id || tx?.account_id;
    const account = accountId ? accounts.find(a => a.id === accountId) : undefined;
    const balanceNow = Number(customer?.balance || 0);
    const balanceAfter = balanceNow + (isPayment ? amount : -amount);
    const balanceLabel = (value: number) => `${formatCurrency(Math.abs(value))} ${value > 0 ? '(customer owes)' : value < 0 ? '(advance)' : ''}`.trim();
    const ok = await confirmAction({
      title: `Delete ${isPayment ? 'payment' : 'charge'} ${formatCurrency(amount)}?`,
      consequences: [
        `${customer?.name || 'Customer'}'s ledger: ${balanceLabel(balanceNow)} → ${balanceLabel(balanceAfter)}`,
        ...(isPayment && account ? [`${formatCurrency(amount)} will be taken out of "${account.name}"`] : isPayment ? ['No money leaves any account (this entry had no account)'] : []),
        "This can't be undone.",
      ],
    });
    if (!ok || deletingTxRef.current.has(id)) return;
    // The row stays on screen until the server answers; a second confirm must not reverse it twice.
    deletingTxRef.current.add(id);
    try {
      const deleted = await deleteCustomerTransaction(id);
      if (deleted) showToast('Entry deleted', 'success');
    } finally {
      deletingTxRef.current.delete(id);
    }
  });

  const getSaleForEntry = (entry: LedgerEntry): POSBill | null => {
    if (entry.sale) return entry.sale;
    const byId = salesById.get(entry.id) || salesById.get(entry.id.replace('sale_', '').replace('ctx_', ''));
    if (byId) return byId;
    // Last resort for old rows that only name the bill in their text: look in this customer's own bills,
    // never in another customer's.
    const match = entry.description?.match(/#([A-Za-z0-9-]+)/);
    if (match?.[1] && activeCustomer) {
      const wanted = match[1].trim().toLowerCase();
      return (salesByCustomer.get(activeCustomer.id) || []).find(s => (s.bill_number || '').toLowerCase() === wanted) || null;
    }
    return null;
  };

  const handleOpenEntryDetail = useStableCallback((entry: LedgerEntry) => {
    const sale = getSaleForEntry(entry);
    if (sale) setSelectedInvoiceSale(sale);
    else setSelectedTxEntry(entry);
  });

  const handleSendWhatsAppReminder = useCallback((customer: Customer) => {
    const phone = whatsAppNumber(customer.whatsapp || customer.phone);
    if (!phone) {
      showToast('No phone number for WhatsApp', 'warning');
      return;
    }
    const state = balanceState(customer.balance);
    const amount = formatCurrency(Math.abs(Number(customer.balance || 0)));
    // The reminder used to ask an advance (or settled) customer to "pay as soon as possible".
    const body = state === 'due'
      ? `Your current balance at ${receiptShop.companyName} is *${amount}* (due).\n\nPlease pay at your earliest convenience. Thank you!`
      : state === 'advance'
        ? `You have *${amount}* in advance at ${receiptShop.companyName}.\n\nThank you!`
        : `Your account at ${receiptShop.companyName} is clear (Rs 0).\n\nThank you!`;
    const msg = `*${receiptShop.companyName} - LEDGER STATEMENT${state === 'due' ? ' REMINDER' : ''}*\n\n` +
      `Dear *${customer.name}*,\n` +
      `${body}\n*${receiptShop.companyName}*`;
    openWhatsApp(phone, msg);
  }, [receiptShop.companyName, showToast]);

  const handleWhatsAppShareInvoice = (sale: POSBill) => {
    const phone = whatsAppNumber(activeCustomer?.whatsapp || activeCustomer?.phone);
    if (!phone) {
      showToast('No phone number on record for this customer', 'warning');
      return;
    }
    const itemLines = (sale.items || []).map((it: any) => `• ${it.name} (${it.qty} x Rs ${it.price}) = ${formatCurrency((it.total || it.qty * it.price))}`).join('\n');
    const balance = Number(activeCustomer?.balance || 0);
    const msg = `*${receiptShop.companyName} - BILL RECEIPT*\n` +
      `--------------------------------\n` +
      `*Bill #:* ${sale.bill_number || sale.id}\n` +
      // The shop's day of the bill; the stored UTC date is yesterday for bills made 00:00–05:00 PKT.
      `*Date:* ${localDay(sale.date)}\n` +
      `*Customer:* ${activeCustomer?.name}\n` +
      `*Payment Mode:* ${sale.payment_mode}\n` +
      `--------------------------------\n` +
      `*Items:*\n${itemLines}\n` +
      `--------------------------------\n` +
      `*Total Bill:* ${formatCurrency(Number(sale.total || 0))}\n` +
      (sale.discount > 0 ? `*Discount:* ${formatCurrency(sale.discount)}\n` : '') +
      (sale.payment_mode === 'Credit' ? `*Charged to Account*\n` : `*Paid on Counter*\n`) +
      `*Current Balance:* ${formatCurrency(Math.abs(balance))} ${balanceState(balance) === 'due' ? 'Dr (Due)' : balanceState(balance) === 'advance' ? 'Cr (Advance)' : '(Settled)'}\n` +
      `--------------------------------\n` +
      `${receiptShop.footer}`;
    openWhatsApp(phone, msg);
  };

  const handleBackToList = useCallback(() => selectCustomer(null), [selectCustomer]);
  const openOrders = useCallback((customer: Customer) => navigate(`/customer-orders?customer=${encodeURIComponent(customer.id)}`), [navigate]);

  return (
    <div className="space-y-4 pb-20 sm:space-y-6">
      {activeCustomer ? (
        <CustomerDetail
          key={activeCustomer.id}
          customer={activeCustomer}
          ledger={ledger}
          shop={statementShop}
          isMdScreen={isMdScreen}
          canEdit={canEdit}
          canDelete={canDelete}
          canPay={canPay}
          canOrders={canOrders}
          onBack={handleBackToList}
          onEdit={handleEdit}
          onDelete={initiateDelete}
          onReactivate={handleReactivate}
          onRecordPayment={openPayment}
          onWhatsApp={handleSendWhatsAppReminder}
          onOpenOrders={openOrders}
          onOpenEntry={handleOpenEntryDetail}
          onDeleteEntry={handleDeleteTransaction}
        />
      ) : (
        <>
          <CustomerStats stats={stats} loading={loading} compact={!isMdScreen} onPick={pickStat} />
          <CustomerList
            customers={customerWindow.visibleItems}
            totalMatching={filteredCustomers.length}
            hasAnyCustomer={customerList.length > 0}
            loading={loading}
            isTable={isMdScreen}
            search={searchTerm}
            onSearchChange={setSearchTerm}
            balanceFilter={filterBalance}
            onBalanceFilterChange={setFilterBalance}
            balanceCounts={balanceCounts}
            statusFilter={filterActiveStatus}
            onStatusFilterChange={setFilterActiveStatus}
            statusCounts={statusCounts}
            sort={sort}
            onSortChange={setSort}
            selectedIds={visibleSelected}
            selectedCount={visibleSelected.size}
            allSelected={filteredCustomers.length > 0 && visibleSelected.size === filteredCustomers.length}
            onToggleAll={toggleSelectAll}
            onBulkArchive={() => setDeleteRequest({ id: null, name: `${visibleSelected.size} customers` })}
            onClearFilters={clearFilters}
            canCreate={canCreate}
            canEdit={canEdit}
            canDelete={canDelete}
            onAdd={handleOpenAddForm}
            onOpen={selectCustomer}
            onEdit={handleEdit}
            onDelete={initiateDelete}
            onToggle={toggleSelectOne}
            window={customerWindow}
          />
        </>
      )}

      <Suspense fallback={null}>
        {isFormOpen && (
          <CustomerFormModal
            key={editingCustomer?.id || 'new'}
            customer={editingCustomer}
            customers={customerList}
            onClose={closeForm}
            onSubmit={handleSubmitCustomer}
          />
        )}

        {paymentCustomer && (
          <PaymentModal
            key={paymentCustomer.id}
            customer={paymentCustomer}
            accounts={accounts}
            defaultCashAccountId={settings?.financial?.defaultCashAccountId}
            defaultDigitalAccountId={settings?.financial?.defaultDigitalAccountId}
            tillAccountIds={tillAccountIds}
            canCharge={canEdit}
            defaultAccountForMode={getDefaultAccountForMode}
            sendWhatsApp={sendWhatsAppReceipt}
            onSendWhatsAppChange={setSendWhatsAppReceipt}
            onClose={() => setPaymentCustomerId(null)}
            onSubmit={handleRecordPayment}
          />
        )}

        {deleteTarget && canDelete && (
          <DeleteCustomerModal
            target={deleteTarget}
            busy={isDeleting}
            onClose={closeDelete}
            onAction={handleSmartDelete}
            onBulkArchive={handleBulkArchive}
          />
        )}

        {selectedInvoiceSale && (
          <InvoiceModal
            sale={selectedInvoiceSale}
            customer={activeCustomer}
            shop={receiptShop}
            onClose={() => setSelectedInvoiceSale(null)}
            onWhatsApp={handleWhatsAppShareInvoice}
          />
        )}

        {selectedTxEntry && (
          <VoucherModal
            entry={selectedTxEntry}
            customer={activeCustomer}
            shop={receiptShop}
            onClose={() => setSelectedTxEntry(null)}
            onDelete={entry => {
              setSelectedTxEntry(null);
              handleDeleteTransaction(entry);
            }}
          />
        )}
      </Suspense>
    </div>
  );
};

export default Customers;
