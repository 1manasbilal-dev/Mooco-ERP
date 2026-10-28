import React, { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Archive, ArrowLeft, Banknote, FilterX, HandCoins, Landmark, Milk, Plus, Receipt, Scale, Truck, Users, Wallet, X
} from 'lucide-react';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { Supplier } from '../types';
import {
  Button, Card, EmptyState, LoadMoreRow, Money, PageHeader, SearchInput, SegmentedControl, Select, Skeleton, StatCard, StatGrid,
  TBody, TH, THead, Table, TableContainer, Toolbar, confirmAction
} from '../components/ui';
import { CashPaymentDays, LedgerRangeBar, LedgerView } from '../components/suppliers/SupplierLedgerPanels';
import { SupplierLedgerTable } from '../components/suppliers/SupplierLedgerTable';
import { SupplierListSkeleton, SupplierPhoneCard, SupplierTableRow } from '../components/suppliers/SupplierListRows';
import { SupplierProfileCard } from '../components/suppliers/SupplierProfileCard';
import { SETTLED_EPSILON, SupplierBalance, toStatementSupplier } from '../components/suppliers/supplierUi';
import { useProgressiveList } from '../hooks/useProgressiveList';
import { BREAKPOINTS, useMediaQuery } from '../hooks/useMediaQuery';
import {
  CashLine,
  DatePreset,
  LedgerTypeFilter,
  SupplierStatement,
  balancePhrase,
  buildPaymentRegister,
  buildSupplierStatement,
  ledgerDay,
  printPaymentRegister,
  printPaymentVoucher,
  rangeForPreset,
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
import { formatCurrency, formatQty, getTodayLocalDate } from '../lib/formatters';

// Dialogs, the print setup and the milk report are not needed for the first paint of the list.
const loadPaymentModal = () => import('../components/suppliers/SupplierPaymentModal');
const loadFormModal = () => import('../components/suppliers/SupplierFormModal');
const SupplierPaymentModal = lazy(loadPaymentModal);
const SupplierFormModal = lazy(loadFormModal);
const SupplierDeleteDialog = lazy(() => import('../components/suppliers/SupplierDeleteDialog'));
const SupplierLedgerPrintModal = lazy(() => import('../components/suppliers/SupplierLedgerPrintModal'));
const MilkSupplierReportPanel = lazy(() => import('../components/suppliers/MilkSupplierReportPanel'));

type BalanceFilter = 'All' | 'Payable' | 'Advance' | 'Settled';
type StatusFilter = 'Active' | 'Inactive' | 'All';
type ListView = 'suppliers' | 'payments';

const LEDGER_TYPES = [
  { value: 'All' as const, label: 'All' },
  { value: 'Milk' as const, label: 'Milk' },
  { value: 'Material' as const, label: 'Material' },
  { value: 'Payment' as const, label: 'Payments' },
];

const isVoidStatus = (status?: string) => /^(returned|cancelled|canceled)$/i.test(String(status || ''));

const Suppliers: React.FC = () => {
  const {
    suppliers, purchases, materialPurchases, supplierTransactions,
    deleteSupplierTransaction,
    accounts = [], settings,
    canPerform,
    reactivateEntity,
    hasLoadedData
  } = useDairy();
  const { showToast } = useToast();

  const canCreate = canPerform('suppliers', 'create');
  const canEdit = canPerform('suppliers', 'edit');
  const canDelete = canPerform('suppliers', 'delete');
  const canPay = canPerform('suppliers', 'payment');

  const location = useLocation();
  const navigate = useNavigate();
  const isPhone = !useMediaQuery(BREAKPOINTS.sm);
  const isWide = useMediaQuery(BREAKPOINTS.md);

  const [activeSupplierId, setActiveSupplierId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('id') || null;
  });

  const selectSupplier = useCallback((id: string | null) => {
    setActiveSupplierId(id);
    navigate(id ? `/suppliers?id=${encodeURIComponent(id)}` : '/suppliers');
  }, [navigate]);

  useEffect(() => {
    // This page stays mounted (hidden) while other tabs are open; their URLs are not ours to read.
    if (!location.pathname.startsWith('/suppliers')) return;
    const params = new URLSearchParams(location.search);
    const targetId = params.get('id') || (location.state as any)?.supplierId;
    setActiveSupplierId(targetId || null);
  }, [location.pathname, location.search, location.state]);

  // Selection requested by the Command Palette or another screen.
  useEffect(() => {
    const handleSelect = (e: any) => {
      const targetId = e?.detail?.supplierId;
      if (targetId) selectSupplier(targetId);
    };
    window.addEventListener('mooco-select-supplier', handleSelect);
    return () => window.removeEventListener('mooco-select-supplier', handleSelect);
  }, [selectSupplier]);

  // Warm the two dialogs people open most, once the screen is idle.
  useEffect(() => {
    const warm = () => { void loadPaymentModal().catch(() => {}); void loadFormModal().catch(() => {}); };
    const idle = (window as any).requestIdleCallback as ((cb: () => void) => number) | undefined;
    if (idle) {
      const id = idle(warm);
      return () => (window as any).cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  // Dialogs
  const [formState, setFormState] = useState<{ open: boolean; supplier: Supplier | null }>({ open: false, supplier: null });
  const [paymentSupplierId, setPaymentSupplierId] = useState<string | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // List state (kept here so it survives opening a supplier and coming back)
  const [searchTerm, setSearchTerm] = useState('');
  const [listView, setListView] = useState<ListView>('suppliers');
  const [filterType, setFilterType] = useState<string>('All');
  const [filterBalance, setFilterBalance] = useState<BalanceFilter>('All');
  const [filterActiveStatus, setFilterActiveStatus] = useState<StatusFilter>('Active');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [registerPreset, setRegisterPreset] = useState<DatePreset>('today');
  const [registerFrom, setRegisterFrom] = useState('');
  const [registerTo, setRegisterTo] = useState('');

  // Ledger (detail) state
  const [ledgerSearchTerm, setLedgerSearchTerm] = useState('');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState<LedgerTypeFilter>('All');
  const [ledgerPreset, setLedgerPreset] = useState<DatePreset>('all');
  const [ledgerFrom, setLedgerFrom] = useState('');
  const [ledgerTo, setLedgerTo] = useState('');
  const [ledgerView, setLedgerView] = useState<LedgerView>('statement');
  const [milkGroup, setMilkGroup] = useState<MilkGroupMode>('milk');
  const [milkTypeFilter, setMilkTypeFilter] = useState('all');
  const [milkShiftFilter, setMilkShiftFilter] = useState('all');
  const [sharingMilkImage, setSharingMilkImage] = useState(false);

  const supplierList = useMemo(() => (suppliers || []).filter(Boolean), [suppliers]);

  const activeSupplier = useMemo(
    () => supplierList.find(s => s.id === activeSupplierId) || null,
    [supplierList, activeSupplierId]
  );
  const paymentSupplier = useMemo(
    () => (paymentSupplierId ? supplierList.find(s => s.id === paymentSupplierId) || null : null),
    [supplierList, paymentSupplierId]
  );

  useEffect(() => {
    setMilkTypeFilter('all');
    setMilkShiftFilter('all');
  }, [activeSupplierId]);

  // Typing stays instant; the heavy filtering and statements follow a frame later.
  const deferredSearch = useDeferredValue(searchTerm);
  const deferredLedgerSearch = useDeferredValue(ledgerSearchTerm);

  const stats = useMemo(() => {
    let active = 0, payable = 0, payableCount = 0, advance = 0, advanceCount = 0;
    supplierList.forEach(s => {
      if (s.isActive !== false) active += 1;
      const bal = Number(s.pending_balance) || 0;
      if (bal > 0) { payable += bal; if (bal >= SETTLED_EPSILON) payableCount += 1; }
      else if (bal < 0) { advance += Math.abs(bal); if (bal <= -SETTLED_EPSILON) advanceCount += 1; }
    });
    return { total: supplierList.length, active, payable, payableCount, advance, advanceCount };
  }, [supplierList]);

  // Milk received this calendar month (Pakistan business days), for the header card.
  const monthMilk = useMemo(() => {
    const today = getTodayLocalDate();
    const monthStart = `${today.slice(0, 8)}01`;
    let litres = 0, amount = 0;
    const from = new Set<string>();
    (purchases || []).forEach((p: any) => {
      if (isVoidStatus(p?.status)) return;
      const day = ledgerDay(p?.date);
      if (!day || day < monthStart || day > today) return;
      litres += Number(p.quantity) || 0;
      amount += Number(p.total_amount) || 0;
      if (p.supplier_id) from.add(p.supplier_id);
    });
    return { litres, amount, suppliers: from.size };
  }, [purchases]);

  // Everything except the balance filter, so the balance tabs can show live counts.
  const baseFiltered = useMemo(() => {
    const query = deferredSearch.toLowerCase().trim();
    return supplierList.filter(s => {
      if (query) {
        const matches = (s.name || '').toLowerCase().includes(query) ||
          String(s.village || '').toLowerCase().includes(query) ||
          String(s.city || '').toLowerCase().includes(query) ||
          String(s.phone || '').includes(query);
        if (!matches) return false;
      }
      if (filterType !== 'All' && !(s.supplier_types || []).includes(filterType)) return false;
      if (filterActiveStatus === 'Active' && s.isActive === false) return false;
      if (filterActiveStatus === 'Inactive' && s.isActive !== false) return false;
      return true;
    });
  }, [supplierList, deferredSearch, filterType, filterActiveStatus]);

  const balanceCounts = useMemo(() => {
    const counts = { All: baseFiltered.length, Payable: 0, Advance: 0, Settled: 0 };
    baseFiltered.forEach(s => {
      const bal = Number(s.pending_balance) || 0;
      if (bal >= SETTLED_EPSILON) counts.Payable += 1;
      else if (bal <= -SETTLED_EPSILON) counts.Advance += 1;
      else counts.Settled += 1;
    });
    return counts;
  }, [baseFiltered]);

  // One rule for the tabs, the badges and the counts: under half a rupee is settled.
  const filteredSuppliers = useMemo(() => {
    if (filterBalance === 'All') return baseFiltered;
    return baseFiltered.filter(s => {
      const bal = Number(s.pending_balance) || 0;
      if (filterBalance === 'Payable') return bal >= SETTLED_EPSILON;
      if (filterBalance === 'Advance') return bal <= -SETTLED_EPSILON;
      return Math.abs(bal) < SETTLED_EPSILON;
    });
  }, [baseFiltered, filterBalance]);

  const listKey = `${deferredSearch}|${filterType}|${filterBalance}|${filterActiveStatus}`;
  const supplierPages = useProgressiveList<Supplier>(filteredSuppliers, 60, listKey);

  // Bulk actions only ever touch suppliers that are on screen under the current filters.
  const visibleSelectedIds = useMemo(
    () => filteredSuppliers.filter(s => selectedIds.has(s.id)).map(s => s.id),
    [filteredSuppliers, selectedIds]
  );

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

  const activeStatementSupplier = useMemo(() => (activeSupplier ? toStatementSupplier(activeSupplier) : null), [activeSupplier]);

  // Ledger statement plus date-wise cash payments, only while a supplier is open.
  const ledgerDetails = useMemo(() => {
    if (!activeStatementSupplier) return null;
    return buildSupplierStatement({
      supplier: activeStatementSupplier,
      purchases,
      materialPurchases,
      transactions: supplierTransactions,
      from: ledgerRange.from,
      to: ledgerRange.to,
      kind: ledgerTypeFilter,
      query: deferredLedgerSearch,
      accountNames
    });
  }, [activeStatementSupplier, purchases, materialPurchases, supplierTransactions, ledgerTypeFilter, deferredLedgerSearch, ledgerRange, accountNames]);

  const milkShiftOrder = useMemo(() => {
    const list = settings?.general?.shifts;
    return Array.isArray(list) && list.length > 0 ? list.map(shift => String(shift)) : ['Morning', 'Evening'];
  }, [settings]);

  // The milk report is only built while the Milk view is open.
  const milkReport = useMemo(() => {
    if (!activeSupplier || ledgerView !== 'milk') return null;
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
  }, [activeSupplier, ledgerView, purchases, ledgerRange, milkGroup, milkTypeFilter, milkShiftFilter, milkShiftOrder]);

  // The register builds a statement for every supplier, so it only runs while its tab is on screen.
  const paymentRegister = useMemo(() => {
    if (activeSupplier || listView !== 'payments') return null;
    return buildPaymentRegister({
      suppliers: supplierList.map(toStatementSupplier),
      purchases,
      materialPurchases,
      transactions: supplierTransactions,
      from: registerRange.from,
      to: registerRange.to,
      query: deferredSearch,
      accountNames
    });
  }, [activeSupplier, listView, supplierList, purchases, materialPurchases, supplierTransactions, registerRange, deferredSearch, accountNames]);

  const openAdd = useCallback(() => setFormState({ open: true, supplier: null }), []);
  const openEdit = useCallback((supplier: Supplier) => setFormState({ open: true, supplier }), []);
  const openPayment = useCallback((supplier: Supplier) => setPaymentSupplierId(supplier.id), []);
  const openDelete = useCallback((supplier: Supplier) => setDeleteIds([supplier.id]), []);
  const reactivate = useCallback((supplier: Supplier) => { void reactivateEntity('supplier', supplier.id); }, [reactivateEntity]);

  const toggleSelectOne = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(filteredSuppliers.map(s => s.id)) : new Set());
  };

  const handleDeleteDone = useCallback((ids: string[]) => {
    setSelectedIds(prev => {
      if (!ids.some(id => prev.has(id))) return prev;
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });
    if (activeSupplierId && ids.includes(activeSupplierId)) selectSupplier(null);
  }, [activeSupplierId, selectSupplier]);

  const clearListFilters = () => {
    setSearchTerm('');
    setFilterType('All');
    setFilterBalance('All');
    setFilterActiveStatus('Active');
  };

  const handleDeleteTransaction = useCallback(async (id: string) => {
    const tx: any = supplierTransactions.find(t => t.id === id);
    if (!tx) {
      showToast('This entry was not found. Please refresh the screen.', 'warning');
      return;
    }
    const supplier = supplierList.find(s => s.id === tx.supplier_id);
    const amount = Number(tx.amount || 0);
    const isWaiver = Boolean(tx.details?.waiver) || /waiver|discount/i.test(String(tx.mode || tx.details?.mode || ''));
    const accountId = tx.account_id || tx.details?.account_id;
    const account = accountId ? accounts.find((a: any) => a.id === accountId) : undefined;
    const balanceNow = Number(supplier?.pending_balance || 0);
    const balanceAfter = balanceNow + amount;
    const describe = (value: number) => (Math.abs(value) < SETTLED_EPSILON ? 'Rs 0 (settled)' : `${formatCurrency(Math.abs(value))} ${value > 0 ? '(payable)' : '(advance)'}`);
    const confirmed = await confirmAction({
      title: `Delete payment ${formatCurrency(amount)}?`,
      consequences: [
        `${supplier?.name || 'Supplier'} ledger: ${describe(balanceNow)} → ${describe(balanceAfter)}`,
        isWaiver ? 'This was a waiver, so no account will change' : account ? `${formatCurrency(amount)} goes back into "${account.name}"` : 'No money goes back into any account',
        "This can't be undone.",
      ],
    });
    if (!confirmed) return;
    const ok = await deleteSupplierTransaction(id);
    if (ok) showToast('Entry deleted', 'success');
  }, [supplierTransactions, supplierList, accounts, deleteSupplierTransaction, showToast]);

  const warnIfPrintBlocked = useCallback((opened: boolean) => {
    if (!opened) showToast('Allow popups in the browser to print.', 'warning');
  }, [showToast]);

  const handlePrintVoucher = useCallback((line: CashLine) => {
    // The voucher shows that supplier's current ledger balance, also from the all-supplier register.
    const supplier = supplierList.find(s => s.id === line.supplierId);
    warnIfPrintBlocked(printPaymentVoucher({
      company: statementCompany,
      line,
      balancePhrase: supplier ? balancePhrase(Number(supplier.pending_balance) || 0) : undefined
    }));
  }, [supplierList, statementCompany, warnIfPrintBlocked]);

  const handlePrintRegister = () => {
    if (!paymentRegister) return;
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

  const milkSlipInput = () => {
    if (!activeStatementSupplier || !milkReport || !ledgerDetails) return null;
    return {
      company: statementCompany,
      supplier: activeStatementSupplier,
      report: milkReport,
      balanceLabel: balancePhrase(ledgerDetails.closingBalance)
    };
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
          report: input.report,
          balanceLabel: input.balanceLabel
        }),
        phone: input.supplier.whatsapp || input.supplier.phone
      });
      if (result === 'shared') showToast('Milk slip is ready to send.', 'success');
      else if (result === 'downloaded') showToast('Milk slip image saved. Attach it in WhatsApp.', 'success');
    } catch {
      showToast("Couldn't make the milk slip image.", 'error');
    } finally {
      setSharingMilkImage(false);
    }
  };

  const handlePrintActiveView = () => {
    if (!activeSupplier || !ledgerDetails) return;
    if (ledgerView === 'payments') {
      warnIfPrintBlocked(printPaymentRegister({
        company: statementCompany,
        title: `Payments — ${activeSupplier.name}`,
        period: ledgerDetails.rangeLabel,
        days: ledgerDetails.paymentDays,
        net: ledgerDetails.cashOut - ledgerDetails.cashIn,
        cashOut: ledgerDetails.cashOut,
        cashIn: ledgerDetails.cashIn
      }));
    } else if (ledgerView === 'milk') {
      const input = milkSlipInput();
      if (input) warnIfPrintBlocked(printMilkSupplierReport(input));
    } else {
      setIsPrintModalOpen(true);
    }
  };

  // The print dialog passes the statement for the range chosen there; without it the page range is used.
  const handleSendWhatsAppReminder = useCallback((supplier: Supplier, chosenStatement?: SupplierStatement) => {
    const cleanPhone = (supplier.whatsapp || supplier.phone || '').replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10) {
      showToast('Supplier has no valid phone / WhatsApp number', 'warning');
      return;
    }
    const formattedPhone = cleanPhone.startsWith('0')
      ? `92${cleanPhone.slice(1)}`
      : cleanPhone.startsWith('92')
      ? cleanPhone
      : `92${cleanPhone}`;

    const statementSupplier = toStatementSupplier(supplier);
    const msg = whatsappStatementText({
      companyName: statementCompany.name,
      supplier: statementSupplier,
      statement: chosenStatement || buildSupplierStatement({
        supplier: statementSupplier,
        purchases,
        materialPurchases,
        transactions: supplierTransactions,
        from: ledgerRange.from,
        to: ledgerRange.to,
        accountNames
      })
    });

    window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  }, [showToast, statementCompany, purchases, materialPurchases, supplierTransactions, ledgerRange, accountNames]);

  const isLoading = !hasLoadedData && supplierList.length === 0;
  const onDeleteTx = canDelete ? handleDeleteTransaction : undefined;

  const dialogs = (
    <Suspense fallback={null}>
      {formState.open && (
        <SupplierFormModal supplier={formState.supplier} onClose={() => setFormState({ open: false, supplier: null })} />
      )}
      {paymentSupplier && (
        <SupplierPaymentModal key={paymentSupplier.id} supplier={paymentSupplier} onClose={() => setPaymentSupplierId(null)} />
      )}
      {deleteIds && deleteIds.length > 0 && (
        <SupplierDeleteDialog ids={deleteIds} onClose={() => setDeleteIds(null)} onDone={handleDeleteDone} />
      )}
      {activeSupplier && isPrintModalOpen && (
        <SupplierLedgerPrintModal
          isOpen
          onClose={() => setIsPrintModalOpen(false)}
          supplier={activeSupplier}
          company={statementCompany}
          purchases={purchases}
          materialPurchases={materialPurchases}
          transactions={supplierTransactions}
          accountNames={accountNames}
          initialPreset={ledgerPreset}
          initialFrom={ledgerRange.from}
          initialTo={ledgerRange.to}
          initialType={ledgerTypeFilter}
          onSendWhatsApp={handleSendWhatsAppReminder}
        />
      )}
    </Suspense>
  );

  if (activeSupplier && ledgerDetails) {
    const filteredLedger = Boolean(deferredLedgerSearch.trim()) || ledgerTypeFilter !== 'All';
    const ledgerKey = `${activeSupplier.id}|${ledgerRange.from}|${ledgerRange.to}|${ledgerTypeFilter}|${deferredLedgerSearch}`;
    const rangeLabel = ledgerView === 'milk' && milkReport
      ? `${milkReport.rangeLabel} · ${milkReport.modeLabel} · ${milkReport.filterLabel}`
      : `${ledgerDetails.rangeLabel}${ledgerView === 'statement' && ledgerDetails.totalMilkLitres ? ` · ${formatQty(ledgerDetails.totalMilkLitres)} L milk` : ''}`;

    return (
      <div className="flex flex-col gap-4 pb-16">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" leftIcon={<ArrowLeft />} onClick={() => selectSupplier(null)}>All suppliers</Button>
          <span className="hidden text-xs font-medium text-fg-subtle sm:block">Supplier ledger</span>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[22rem_minmax(0,1fr)]">
          <div className="lg:sticky lg:top-4">
            <SupplierProfileCard
              supplier={activeSupplier}
              canPay={canPay}
              canEdit={canEdit}
              canDelete={canDelete}
              onPay={openPayment}
              onEdit={openEdit}
              onDelete={openDelete}
              onReactivate={reactivate}
              onWhatsApp={handleSendWhatsAppReminder}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-4">
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
              printLabel={ledgerView === 'payments' ? 'Print payments' : ledgerView === 'milk' ? 'Print slip' : 'Print ledger'}
              onShare={ledgerView === 'milk' && milkReport ? handleShareMilkImage : undefined}
              shareLabel="Send image"
              sharing={sharingMilkImage}
              rangeLabel={rangeLabel}
            />

            <StatGrid
              label={ledgerView === 'payments' ? 'Payments summary' : ledgerView === 'milk' ? 'Milk summary' : 'Ledger summary'}
              storageKey="supplier-ledger"
              gridClassName="lg:grid-cols-2 xl:grid-cols-4"
              peek={ledgerView === 'payments' ? [
                { value: <Money amount={ledgerDetails.cashOut - ledgerDetails.cashIn} compact />, label: 'net paid' },
              ] : ledgerView === 'milk' ? (milkReport ? [
                { value: `${formatQty(milkReport.litres)} L`, label: 'milk' },
                { value: <Money amount={milkReport.amount} compact /> },
              ] : undefined) : [
                { value: <SupplierBalance value={ledgerDetails.closingBalance} compact />, label: 'at close' },
              ]}
            >
              {ledgerView === 'payments' ? (
                <>
                  <StatCard label="Cash paid" icon={<Banknote />} tone="success" value={<Money amount={ledgerDetails.cashPaid} compact={isPhone} />} />
                  <StatCard label="Bank / other" icon={<Landmark />} value={<Money amount={ledgerDetails.otherPaid} compact={isPhone} />} />
                  <StatCard label="Refunds in" icon={<Receipt />} tone={ledgerDetails.cashIn > 0 ? 'warning' : 'neutral'} value={<Money amount={ledgerDetails.cashIn} compact={isPhone} />} />
                  <StatCard label="Net paid" icon={<Wallet />} value={<Money amount={ledgerDetails.cashOut - ledgerDetails.cashIn} compact={isPhone} />} hint={`${ledgerDetails.paymentCount} payments`} />
                </>
              ) : ledgerView === 'milk' ? (
                <>
                  <StatCard label="Litres" icon={<Milk />} tone="info" value={milkReport ? `${formatQty(milkReport.litres)} L` : '—'} hint={milkReport ? `${milkReport.dayCount} days` : undefined} loading={!milkReport} />
                  <StatCard label="Milk amount" icon={<HandCoins />} value={<Money amount={milkReport?.amount || 0} compact={isPhone} />} loading={!milkReport} />
                  <StatCard label="Average rate" icon={<Scale />} value={milkReport ? `${formatMilkRate(milkReport.rate)}/L` : '—'} hint={milkReport && milkReport.fat > 0 ? `Fat ${formatMilkQty(milkReport.fat)}` : undefined} loading={!milkReport} />
                  <StatCard label="Ledger balance" icon={<Wallet />} value={<SupplierBalance value={ledgerDetails.closingBalance} compact={isPhone} />} hint={milkReport ? `${milkReport.slipCount} slips` : undefined} />
                </>
              ) : (
                <>
                  <StatCard label="Opening balance" icon={<Scale />} value={<SupplierBalance value={ledgerDetails.openingBalance} compact={isPhone} />} />
                  <StatCard
                    label="Supplies (Cr)"
                    icon={<Milk />}
                    tone="info"
                    value={<Money amount={ledgerDetails.totalCredit} compact={isPhone} />}
                    hint={ledgerDetails.totalMilkLitres > 0 ? `${formatQty(ledgerDetails.totalMilkLitres)} L milk` : undefined}
                  />
                  <StatCard
                    label="Paid out (Dr)"
                    icon={<Banknote />}
                    tone="success"
                    value={<Money amount={ledgerDetails.netPaid} compact={isPhone} />}
                    hint={ledgerDetails.refunds > 0 ? `Refund ${formatCurrency(ledgerDetails.refunds)}` : undefined}
                  />
                  <StatCard label="Closing balance" icon={<Wallet />} value={<SupplierBalance value={ledgerDetails.closingBalance} compact={isPhone} />} />
                </>
              )}
            </StatGrid>

            {ledgerView !== 'milk' && (
              <Toolbar>
                <SearchInput
                  value={ledgerSearchTerm}
                  onChange={setLedgerSearchTerm}
                  placeholder={ledgerView === 'payments' ? 'Payment, mode, note...' : 'Entry, milk, note, account...'}
                  aria-label="Search ledger"
                  className="w-full sm:w-72"
                />
                {ledgerView === 'statement' && (
                  <SegmentedControl aria-label="Entry type" size="sm" value={ledgerTypeFilter} onChange={setLedgerTypeFilter} options={LEDGER_TYPES} />
                )}
              </Toolbar>
            )}

            {ledgerView === 'payments' ? (
              <CashPaymentDays days={ledgerDetails.paymentDays} onDelete={onDeleteTx} onVoucher={handlePrintVoucher} resetKey={ledgerKey} />
            ) : ledgerView === 'milk' ? (
              <Suspense fallback={<Card className="space-y-3 p-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 w-full" /></Card>}>
                {milkReport && (
                  <MilkSupplierReportPanel
                    report={milkReport}
                    groupBy={milkGroup}
                    milkType={milkTypeFilter}
                    shift={milkShiftFilter}
                    onGroupBy={setMilkGroup}
                    onMilkType={setMilkTypeFilter}
                    onShift={setMilkShiftFilter}
                    resetKey={ledgerKey}
                  />
                )}
              </Suspense>
            ) : (
              <SupplierLedgerTable entries={ledgerDetails.entries} onDelete={onDeleteTx} resetKey={ledgerKey} filtered={filteredLedger} />
            )}
          </div>
        </div>
        {dialogs}
      </div>
    );
  }

  const selectable = canDelete;
  const allVisibleSelected = filteredSuppliers.length > 0 && visibleSelectedIds.length === filteredSuppliers.length;

  return (
    <div className="flex flex-col gap-4 pb-16">
      <PageHeader
        eyebrow="Supplier ledgers"
        description="Balances for milk and material suppliers: who we owe, who has an advance, and every payment."
        actions={canCreate ? <Button leftIcon={<Plus />} onClick={openAdd}>Add supplier</Button> : undefined}
      >
        <SegmentedControl
          aria-label="Suppliers section"
          variant="underline"
          value={listView}
          onChange={setListView}
          options={[
            { value: 'suppliers', label: 'Suppliers', icon: <Users />, count: stats.total },
            { value: 'payments', label: 'Payment register', icon: <Receipt /> },
          ]}
        />
      </PageHeader>

      {listView === 'payments' ? (
        <>
          <Toolbar>
            <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Supplier, mode or note..." aria-label="Search payments" className="w-full sm:w-80" />
          </Toolbar>
          <LedgerRangeBar
            preset={registerPreset}
            from={registerFrom}
            to={registerTo}
            onPreset={setRegisterPreset}
            onFrom={setRegisterFrom}
            onTo={setRegisterTo}
            onPrint={handlePrintRegister}
            printLabel="Print register"
            rangeLabel={paymentRegister?.rangeLabel || ''}
          />
          <StatGrid
            label="Payments in this period"
            storageKey="supplier-payments"
            peek={paymentRegister ? [
              { value: <Money amount={paymentRegister.net} compact />, label: 'paid' },
              { value: paymentRegister.count, label: paymentRegister.count === 1 ? 'payment' : 'payments' },
            ] : undefined}
          >
            <StatCard label="Payments" icon={<Receipt />} value={paymentRegister?.count ?? 0} loading={!paymentRegister} />
            <StatCard label="Cash" icon={<Banknote />} tone="success" value={<Money amount={paymentRegister?.cashPaid || 0} compact={isPhone} />} loading={!paymentRegister} />
            <StatCard label="Bank / other" icon={<Landmark />} value={<Money amount={paymentRegister?.otherPaid || 0} compact={isPhone} />} loading={!paymentRegister} />
            <StatCard label="Net paid" icon={<Wallet />} value={<Money amount={paymentRegister?.net || 0} compact={isPhone} />} loading={!paymentRegister} />
          </StatGrid>
          {paymentRegister && (
            <CashPaymentDays
              days={paymentRegister.days}
              showSupplier
              onOpenSupplier={selectSupplier}
              onVoucher={handlePrintVoucher}
              onDelete={onDeleteTx}
              emptyText="No supplier payments in this period"
              resetKey={`${registerRange.from}|${registerRange.to}|${deferredSearch}`}
            />
          )}
        </>
      ) : (
        <>
          <StatGrid
            label="Supplier summary"
            storageKey="suppliers"
            peek={isLoading ? undefined : [
              { value: <Money amount={stats.payable} compact />, label: 'payable', tone: stats.payable > 0.5 ? 'danger' : undefined },
              { value: <Money amount={stats.advance} compact />, label: 'advance', tone: stats.advance > 0.5 ? 'success' : undefined },
            ]}
          >
            <StatCard
              label="Payable"
              icon={<Wallet />}
              tone="danger"
              value={<Money amount={stats.payable} compact={isPhone} />}
              hint={`Owed to ${stats.payableCount}`}
              loading={isLoading}
              onClick={() => { setFilterBalance('Payable'); setFilterActiveStatus('All'); }}
            />
            <StatCard
              label="Advance"
              icon={<HandCoins />}
              tone="success"
              value={<Money amount={stats.advance} compact={isPhone} />}
              hint={`Paid ahead to ${stats.advanceCount}`}
              loading={isLoading}
              onClick={() => { setFilterBalance('Advance'); setFilterActiveStatus('All'); }}
            />
            <StatCard
              label="Active suppliers"
              icon={<Truck />}
              tone="brand"
              value={stats.active}
              hint={`${stats.total - stats.active} inactive`}
              loading={isLoading}
              onClick={() => { setFilterActiveStatus('Active'); setFilterBalance('All'); }}
            />
            <StatCard
              label="Milk this month"
              icon={<Milk />}
              tone="info"
              value={`${formatQty(monthMilk.litres)} L`}
              hint={<Money amount={monthMilk.amount} compact />}
              loading={isLoading}
            />
          </StatGrid>

          <Toolbar>
            <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Name, phone, village..." aria-label="Supplier search" className="w-full sm:w-72" />
            <SegmentedControl
              aria-label="Balance filter"
              size="sm"
              value={filterBalance}
              onChange={setFilterBalance}
              options={[
                { value: 'All', label: 'All', count: balanceCounts.All },
                { value: 'Payable', label: 'Payable', count: balanceCounts.Payable },
                { value: 'Advance', label: 'Advance', count: balanceCounts.Advance },
                { value: 'Settled', label: 'Settled', count: balanceCounts.Settled },
              ]}
            />
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <Select aria-label="Supply type" value={filterType} onChange={e => setFilterType(e.target.value)} className="h-8 w-auto text-xs">
                <option value="All">All types</option>
                <option value="Milk">Milk</option>
                <option value="Raw Material">Raw material</option>
                <option value="Finished Products">Finished goods</option>
              </Select>
              <Select aria-label="Supplier status" value={filterActiveStatus} onChange={e => setFilterActiveStatus(e.target.value as StatusFilter)} className="h-8 w-auto text-xs">
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
                <option value="All">All status</option>
              </Select>
            </div>
          </Toolbar>

          {selectable && visibleSelectedIds.length > 0 && (
            <Card className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span className="text-[13px] font-semibold text-fg">{visibleSelectedIds.length} selected</span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" leftIcon={<X />} onClick={() => setSelectedIds(new Set())}>Clear</Button>
                <Button variant="danger-soft" size="sm" leftIcon={<Archive />} onClick={() => setDeleteIds(visibleSelectedIds)}>Make inactive</Button>
              </div>
            </Card>
          )}

          {isLoading ? (
            <SupplierListSkeleton wide={isWide} />
          ) : filteredSuppliers.length === 0 ? (
            <Card>
              {supplierList.length === 0 ? (
                <EmptyState
                  icon={<Truck />}
                  title="No suppliers yet"
                  description="Add your first milk or material supplier, and their ledger will show here."
                  action={canCreate ? <Button leftIcon={<Plus />} onClick={openAdd}>Add supplier</Button> : undefined}
                />
              ) : (
                <EmptyState
                  icon={<FilterX />}
                  title="No suppliers match this filter"
                  description="Try a different search or filters."
                  action={<Button variant="secondary" onClick={clearListFilters}>Clear filters</Button>}
                />
              )}
            </Card>
          ) : isWide ? (
            <TableContainer>
              <Table>
                <THead>
                  <tr>
                    {selectable && (
                      <TH className="w-12">
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          className="size-4 cursor-pointer accent-brand"
                          checked={allVisibleSelected}
                          onChange={e => toggleSelectAll(e.target.checked)}
                        />
                      </TH>
                    )}
                    <TH>Supplier</TH>
                    <TH>Phone</TH>
                    <TH>Category</TH>
                    <TH numeric title="Payable = we owe, Advance = we paid ahead">Balance</TH>
                    <TH className="w-28 text-right">Actions</TH>
                  </tr>
                </THead>
                <TBody>
                  {supplierPages.visibleItems.map(s => (
                    <SupplierTableRow
                      key={s.id}
                      supplier={s}
                      selected={selectedIds.has(s.id)}
                      selectable={selectable}
                      canPay={canPay}
                      canEdit={canEdit}
                      onOpen={selectSupplier}
                      onToggle={toggleSelectOne}
                      onPay={openPayment}
                      onEdit={openEdit}
                    />
                  ))}
                  <LoadMoreRow
                    sentinelRef={supplierPages.sentinelRef}
                    hiddenCount={supplierPages.hiddenCount}
                    onShowMore={supplierPages.showMore}
                    onShowAll={supplierPages.showAll}
                    colSpan={selectable ? 6 : 5}
                  />
                </TBody>
              </Table>
            </TableContainer>
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-line/70">
                {supplierPages.visibleItems.map(s => <SupplierPhoneCard key={s.id} supplier={s} onOpen={selectSupplier} />)}
              </ul>
              <LoadMoreRow
                sentinelRef={supplierPages.sentinelRef}
                hiddenCount={supplierPages.hiddenCount}
                onShowMore={supplierPages.showMore}
                onShowAll={supplierPages.showAll}
              />
            </Card>
          )}

          {!isLoading && filteredSuppliers.length > 0 && (
            <p className="text-center text-xs text-fg-subtle">
              {filteredSuppliers.length} of {stats.total} suppliers
            </p>
          )}
        </>
      )}
      {dialogs}
    </div>
  );
};

export default Suppliers;
