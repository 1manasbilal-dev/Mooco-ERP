import React, { Suspense, lazy, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Banknote, RotateCcw, Search, ShoppingBag, Wallet } from 'lucide-react';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { POSBill } from '../types';
import { cn } from '../lib/cn';
import { saleLineStock } from '../lib/sellUnits';
import { proportionalRefund } from '../lib/moneyFlow';
import { useManagerApproval } from '../components/ui/ManagerApproval';
import {
  Button, Card, Input, LoadMoreRow, SearchInput, SegmentedControl, Select, StatCard, TBody, TH, THead, Table, TableContainer, Toolbar,
} from '../components/ui';
import { useProgressiveList } from '../hooks/useProgressiveList';
import { BREAKPOINTS, useMediaQuery } from '../hooks/useMediaQuery';
import { StatMoney } from '../components/sales/SalesBits';
import { SaleCard, SaleTableRow, SalesEmptyState } from '../components/sales/SalesList';
import {
  type ReturnItemSelection, getLocalDateString, matchSaleWithToken, saleDayKey, saleDayMatchesRange, saleModeLockReason,
} from '../components/sales/salesHistoryUtils';

// Dialogs are not part of the first screen, so they load on demand (and are preloaded shortly after mount).
const loadDetailDialog = () => import('../components/sales/SaleDetailDialog');
const loadReturnDialog = () => import('../components/sales/SaleReturnDialog');
const loadReceiptDialog = () => import('../components/sales/SaleReceiptDialog');
const loadModeDialog = () => import('../components/sales/PaymentModeDialog');
const SaleDetailDialog = lazy(loadDetailDialog);
const SaleReturnDialog = lazy(loadReturnDialog);
const SaleReceiptDialog = lazy(loadReceiptDialog);
const PaymentModeDialog = lazy(loadModeDialog);

const PAGE_SIZE = 50;
const FILTER_SELECT = 'pl-2.5 pr-7 text-xs sm:pl-3 sm:pr-9 sm:text-sm md:w-auto md:min-w-[9.5rem]';

type IndexedSale = { sale: POSBill; time: number; day: string };

function QuickFilter({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button size="sm" variant={active ? 'soft' : 'ghost'} aria-pressed={active} onClick={onClick} className="shrink-0 max-sm:h-10">
      {children}
    </Button>
  );
}

const SalesHistory: React.FC = () => {
  const {
    sales, customers, accounts, settings, items, processSalesReturn, updateSalePaymentMode, canPerform, activeShiftSession, cashDrawers,
    currentUser, shiftSessions, isDayLocked,
  } = useDairy();
  const { showToast } = useToast();
  const { requestApproval, approvalDialog } = useManagerApproval();
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery(BREAKPOINTS.md);

  const canReturn = canPerform('sales_history', 'return');
  const canChangeMode = canPerform('sales_history', 'edit');

  const customerMap = useMemo(() => {
    const map = new Map<string, { phone: string; name: string }>();
    (customers || []).forEach(c => {
      if (c?.id) {
        map.set(c.id, {
          phone: c.phone || c.whatsapp || '',
          name: c.name || ''
        });
      }
    });
    return map;
  }, [customers]);

  const [searchTerm, setSearchTerm] = useState(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('search') || sp.get('q') || '';
  });
  const [searchAcrossAllDates, setSearchAcrossAllDates] = useState<boolean>(true);
  const [filterMode, setFilterMode] = useState<string>(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('mode') || 'All';
  });
  const [filterStatus, setFilterStatus] = useState<string>(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('status') || 'All';
  });
  const [filterDateRange, setFilterDateRange] = useState<string>(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('range') || 'today';
  });
  const [customDate, setCustomDate] = useState<string>('');

  const [expandedSaleIds, setExpandedSaleIds] = useState<Record<string, boolean>>({});

  const toggleExpand = useCallback((id: string) => {
    setExpandedSaleIds(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const [selectedDetailSale, setSelectedDetailSale] = useState<POSBill | null>(null);
  const [selectedReceiptSale, setSelectedReceiptSale] = useState<POSBill | null>(null);
  const [returnModalSale, setReturnModalSale] = useState<POSBill | null>(null);

  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const detailId = sp.get('id');
    const receiptId = sp.get('receipt');

    if (detailId && sales.length > 0) {
      const found = sales.find(s => s.id === detailId);
      if (found && selectedDetailSale?.id !== detailId) {
        setSelectedDetailSale(found);
      }
    } else if (!detailId && selectedDetailSale) {
      setSelectedDetailSale(null);
    }

    if (receiptId && sales.length > 0) {
      const found = sales.find(s => s.id === receiptId);
      if (found && selectedReceiptSale?.id !== receiptId) {
        setSelectedReceiptSale(found);
      }
    } else if (!receiptId && selectedReceiptSale) {
      setSelectedReceiptSale(null);
    }

    const rangeParam = sp.get('range');
    if (rangeParam && rangeParam !== filterDateRange) setFilterDateRange(rangeParam);

    const modeParam = sp.get('mode');
    if (modeParam && modeParam !== filterMode) setFilterMode(modeParam);

    const statusParam = sp.get('status');
    if (statusParam && statusParam !== filterStatus) setFilterStatus(statusParam);
  }, [location.search, sales]);

  // ?id= (detail) and ?receipt= (receipt preview) are written in one navigate, so switching from the
  // detail to the receipt cannot leave a stale ?id= behind that re-opens the detail.
  const setDialogParams = (updates: { id?: string | null; receipt?: string | null }) => {
    const sp = new URLSearchParams(location.search);
    (Object.entries(updates) as Array<[string, string | null]>).forEach(([key, value]) => {
      if (value) sp.set(key, value); else sp.delete(key);
    });
    const q = sp.toString();
    navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true });
  };

  const openDetailSale = (sale: POSBill | null) => {
    setSelectedDetailSale(sale);
    setDialogParams({ id: sale ? sale.id : null });
  };

  const openReceiptSale = (sale: POSBill | null) => {
    setSelectedReceiptSale(sale);
    setDialogParams({ receipt: sale ? sale.id : null });
  };

  const openReceiptFromDetail = (sale: POSBill) => {
    setSelectedDetailSale(null);
    setSelectedReceiptSale(sale);
    setDialogParams({ id: null, receipt: sale.id });
  };

  const updateFilters = (updates: { range?: string; mode?: string; status?: string }) => {
    const sp = new URLSearchParams(location.search);
    if (updates.range !== undefined) {
      setFilterDateRange(updates.range);
      if (updates.range !== 'today') sp.set('range', updates.range); else sp.delete('range');
    }
    if (updates.mode !== undefined) {
      setFilterMode(updates.mode);
      if (updates.mode !== 'All') sp.set('mode', updates.mode); else sp.delete('mode');
    }
    if (updates.status !== undefined) {
      setFilterStatus(updates.status);
      if (updates.status !== 'All') sp.set('status', updates.status); else sp.delete('status');
    }
    const q = sp.toString();
    navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true });
  };
  const [returnReason, setReturnReason] = useState('Customer Changed Mind');
  const [customReturnReason, setCustomReturnReason] = useState('');
  const [returnAction, setReturnAction] = useState<'refund' | 'replace'>('refund');
  const [restockOption, setRestockOption] = useState<'restock' | 'scrap_spoilage'>('restock');
  const [refundAccountId, setRefundAccountId] = useState('');
  const [refundPaymentMode, setRefundPaymentMode] = useState<'Cash' | 'Online'>('Cash');
  const [correctOriginalSaleMode, setCorrectOriginalSaleMode] = useState<boolean>(false);
  const [isProcessingReturn, setIsProcessingReturn] = useState(false);
  // State updates are not instant, so a ref also blocks a second submit while the first is in flight.
  const returnSubmittingRef = useRef(false);

  const [modeEditSale, setModeEditSale] = useState<POSBill | null>(null);
  const [targetMode, setTargetMode] = useState<'Cash' | 'Online'>('Online');
  const [targetAccountId, setTargetAccountId] = useState<string>('');
  const [isUpdatingMode, setIsUpdatingMode] = useState(false);
  const modeSubmittingRef = useRef(false);

  const [returnItems, setReturnItems] = useState<ReturnItemSelection[]>([]);

  const openReturnModal = (sale: POSBill) => {
    setReturnModalSale(sale);
    setReturnReason('Customer Changed Mind');
    setCustomReturnReason('');
    setReturnAction('refund');
    setRestockOption('restock');
    setCorrectOriginalSaleMode(false);

    const initialRefundMode = sale.payment_mode === 'Online' ? 'Online' : 'Cash';
    setRefundPaymentMode(initialRefundMode);

    const previouslyReturned = ((sale as any).returned_items || (sale as any).details?.returned_items || []) as Array<{ name: string; qty: number; itemId?: string; variantId?: string; lineIndex?: number }>;

    // Give each earlier return to exactly one bill line. Two lines of the same item and pack
    // share a key, so a return without a saved line index fills them in order and is never counted twice.
    const saleLines = sale.items || [];
    const returnedByLine = saleLines.map(() => 0);
    const sameLine = (r: { name: string; itemId?: string; variantId?: string }, it: any) => (r.itemId && it.itemId)
      ? r.itemId === it.itemId && (r.variantId || '') === (it.variantId || '')
      : (r.name || '').toLowerCase() === (it.name || '').toLowerCase();
    const indexed = previouslyReturned.filter(r => Number.isInteger(r.lineIndex) && saleLines[r.lineIndex as number]);
    indexed.forEach(r => { returnedByLine[r.lineIndex as number] += Number(r.qty) || 0; });
    previouslyReturned.filter(r => !indexed.includes(r)).forEach(r => {
      let left = Number(r.qty) || 0;
      saleLines.forEach((it, index) => {
        if (left <= 0 || !sameLine(r, it)) return;
        const take = Math.min(left, Math.max(0, (Number(it.qty) || 0) - returnedByLine[index]));
        returnedByLine[index] += take;
        left -= take;
      });
    });

    const itemsList: ReturnItemSelection[] = saleLines.map((it, index) => {
      const remainingQty = Math.max(0, it.qty - returnedByLine[index]);
      const line: any = it;
      const itemDef = (items || []).find(i => i.id === it.itemId);
      const wholeOnly = saleLineStock(line, itemDef as any).fromBase === false;

      return {
        itemId: it.itemId,
        name: it.name,
        soldQty: it.qty,
        remainingQty,
        returnQty: remainingQty > 0 ? remainingQty : 0,
        price: it.price,
        unit: line.variantName ? line.variantName : (line.unit || 'Unit'),
        variantId: it.variantId,
        isSelected: remainingQty > 0,
        lineIndex: index,
        lineUnit: line.unit,
        baseUnit: line.baseUnit,
        stockDeduction: line.stockDeduction,
        deductFromBase: line.deductFromBase,
        isLoose: line.isLoose,
        wholeOnly
      };
    });

    setReturnItems(itemsList);
    setRefundAccountId(defaultRefundAccount(initialRefundMode));
  };

  // Cash refunds leave the drawer that is open now; head cash is a deliberate manual choice.
  const drawerAccountFor = (drawerId?: string | null) => {
    if (!drawerId) return '';
    if (accounts.some(a => a.id === drawerId)) return drawerId;
    return cashDrawers.find(d => d.id === drawerId)?.account_id || '';
  };
  const digitalAccountDefault = () => settings.financial?.defaultDigitalAccountId || accounts.find(a => (a.type === 'Bank' || a.type === 'Wallet') && a.isActive !== false)?.id || accounts.find(a => a.type === 'Bank' || a.type === 'Wallet')?.id || '';
  const defaultRefundAccount = (mode: 'Cash' | 'Online') => {
    if (mode === 'Online') return digitalAccountDefault();
    const shift = activeShiftSession?.status === 'Active' ? activeShiftSession : null;
    return (shift && (shift.account_id || drawerAccountFor(shift.drawer_id))) || '';
  };

  const handleRefundModeChange = (mode: 'Cash' | 'Online') => {
    setRefundPaymentMode(mode);
    setRefundAccountId(defaultRefundAccount(mode));
  };

  // Cash -> the drawer that took the bill, so the money moves back into the till it is sitting in.
  const modeTargetDefault = (sale: POSBill, mode: 'Cash' | 'Online') =>
    mode === 'Online' ? digitalAccountDefault() : (drawerAccountFor(sale.drawer_id) || defaultRefundAccount('Cash'));

  const openModeEditModal = (sale: POSBill) => {
    setModeEditSale(sale);
    const newMode: 'Cash' | 'Online' = sale.payment_mode === 'Cash' ? 'Online' : 'Cash';
    setTargetMode(newMode);
    setTargetAccountId(modeTargetDefault(sale, newMode));
  };

  const handleTargetModeChange = (mode: 'Cash' | 'Online') => {
    setTargetMode(mode);
    if (modeEditSale) setTargetAccountId(modeTargetDefault(modeEditSale, mode));
  };

  const handleConfirmModeChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modeEditSale || modeSubmittingRef.current) return;
    modeSubmittingRef.current = true;
    setIsUpdatingMode(true);
    try {
      const success = await updateSalePaymentMode(modeEditSale.id, targetMode, targetAccountId || undefined);
      if (success) {
        setModeEditSale(null);
      }
    } finally {
      modeSubmittingRef.current = false;
      setIsUpdatingMode(false);
    }
  };

  const toggleItemSelection = (index: number) => {
    setReturnItems(prev => prev.map((item, idx) => {
      if (idx === index) {
        const maxQty = item.remainingQty !== undefined ? item.remainingQty : item.soldQty;
        // A line that already came back in full has nothing left to select.
        if (maxQty <= 0) return item.isSelected ? { ...item, isSelected: false, returnQty: 0 } : item;
        const nextSelected = !item.isSelected;
        return {
          ...item,
          isSelected: nextSelected,
          returnQty: nextSelected && item.returnQty === 0 ? maxQty : item.returnQty
        };
      }
      return item;
    }));
  };

  const updateItemReturnQty = (index: number, newQty: number) => {
    setReturnItems(prev => prev.map((item, idx) => {
      if (idx === index) {
        const maxQty = item.remainingQty !== undefined ? item.remainingQty : item.soldQty;
        const clamped = isNaN(newQty) ? 0 : Math.min(maxQty, Math.max(0, newQty));
        const validated = item.wholeOnly ? Math.floor(clamped + 1e-9) : clamped;
        return {
          ...item,
          returnQty: validated,
          isSelected: validated > 0
        };
      }
      return item;
    }));
  };

  const selectAllReturnItems = (select: boolean) => {
    setReturnItems(prev => prev.map(item => {
      const maxQty = item.remainingQty !== undefined ? item.remainingQty : item.soldQty;
      // Fully returned lines stay unselected: there is nothing left on them to return.
      return { ...item, isSelected: select && maxQty > 0, returnQty: select ? maxQty : 0 };
    }));
  };

  const handleReturnActionChange = (action: 'refund' | 'replace') => {
    setReturnAction(action);
    if (action === 'replace') setRestockOption('scrap_spoilage');
  };

  const handleReturnReasonChange = (reason: string) => {
    setReturnReason(reason);
    if (reason === 'Defective / Spoiled Product') {
      setRestockOption('scrap_spoilage');
    }
  };

  const handleCorrectOriginalChange = (checked: boolean) => {
    setCorrectOriginalSaleMode(checked);
    if (checked) {
      handleRefundModeChange('Online');
    }
  };

  const activeReturnItems = useMemo(() => {
    return returnItems.filter(i => i.isSelected && i.returnQty > 0);
  }, [returnItems]);

  // Same figure the return posts: line prices are before the bill discount, so the refund keeps that discount.
  const currentRefundAmount = useMemo(() => {
    return proportionalRefund(returnModalSale, activeReturnItems.map(i => ({ qty: i.returnQty, price: i.price })));
  }, [activeReturnItems, returnModalSale]);

  // Bills sorted newest first once per data change, with each bill's time and shop day worked out once;
  // filtering keeps this order, so typing never re-sorts or re-parses dates.
  const indexedSales = useMemo<IndexedSale[]>(() => {
    const rows = sales.map((sale: POSBill) => ({
      sale,
      time: new Date(sale.date || 0).getTime(),
      day: sale.date ? saleDayKey(sale.date) : '',
    }));
    rows.sort((a: IndexedSale, b: IndexedSale) => b.time - a.time || b.sale.id.localeCompare(a.sale.id));
    return rows;
  }, [sales]);

  // The input stays instant; the list filters against the deferred value in the background.
  const deferredSearch = useDeferredValue(searchTerm);
  const activeSearch = deferredSearch.trim();
  const isSearchStale = searchTerm !== deferredSearch;

  const searchTokens = useMemo(() => {
    return deferredSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
  }, [deferredSearch]);

  // One pass: search, mode and status are checked once per bill, and the date check is kept as a flag,
  // so the result list and both "search scope" counts come from the same loop.
  const matched = useMemo(() => {
    const today = getLocalDateString(new Date());
    const isSearching = searchTokens.length > 0;
    const rows: Array<{ sale: POSBill; inRange: boolean }> = [];
    let inRangeCount = 0;
    for (const { sale, day } of indexedSales) {
      if (isSearching && !searchTokens.every(tok => matchSaleWithToken(sale, tok, customerMap))) continue;
      if (filterMode !== 'All' && sale.payment_mode !== filterMode) continue;
      if (filterStatus !== 'All' && sale.status !== filterStatus) continue;
      const inRange = saleDayMatchesRange(sale.date, day, filterDateRange, customDate, today);
      if (inRange) inRangeCount++;
      rows.push({ sale, inRange });
    }
    return { rows, inRangeCount, isSearching };
  }, [indexedSales, searchTokens, customerMap, filterMode, filterStatus, filterDateRange, customDate]);

  // While searching across all dates the date filter is skipped.
  const searchAllDates = matched.isSearching && searchAcrossAllDates;
  const filteredSales = useMemo(() => {
    const out: POSBill[] = [];
    for (const row of matched.rows) {
      if (searchAllDates || row.inRange) out.push(row.sale);
    }
    return out;
  }, [matched, searchAllDates]);

  const matchingAllDatesCount = matched.isSearching ? matched.rows.length : sales.length;
  const matchingCurrentDateCount = matched.isSearching ? matched.inRangeCount : 0;

  const stats = useMemo(() => {
    let count = 0;
    let completed = 0;
    let returned = 0;
    let gross = 0;
    let refunded = 0;
    for (const s of filteredSales) {
      const status = String((s as any).status || '');
      if (status === 'Cancelled') continue;
      count++;
      if (status !== 'Returned') completed++;
      if (status === 'Returned' || status === 'Partially Returned') returned++;
      gross += Number(s.total) || 0;
      if (status === 'Returned') refunded += Number(s.total) || Number(s.refund_amount) || 0;
      else if (status === 'Partially Returned') refunded += Number(s.refund_amount || 0);
    }
    return { count, completed, returned, gross, refunded, net: Math.max(0, gross - refunded) };
  }, [filteredSales]);

  const { todayCount, monthCount } = useMemo(() => {
    const todayLocal = getLocalDateString(new Date());
    const monthLocal = todayLocal.slice(0, 7);

    let todayC = 0;
    let monthC = 0;

    for (const { sale, day } of indexedSales) {
      if (!sale.date) continue;
      if (day === todayLocal) {
        todayC++;
      }
      if (day.startsWith(monthLocal)) {
        monthC++;
      }
    }
    return { todayCount: todayC, monthCount: monthC };
  }, [indexedSales]);

  const listResetKey = `${filterDateRange}|${customDate}|${filterMode}|${filterStatus}|${searchAllDates}|${searchTokens.join(' ')}`;
  const { visibleItems, hiddenCount, sentinelRef, showMore, showAll } = useProgressiveList<POSBill>(filteredSales, PAGE_SIZE, listResetKey);

  // Whether a bill may switch Cash ⇄ Online: the same refusals updateSalePaymentMode makes.
  const shiftById = useMemo(
    () => new Map<string, { status?: string }>((shiftSessions || []).map((s: any) => [s.id, s])),
    [shiftSessions],
  );
  const modeLockFor = useMemo(() => {
    const cache = new WeakMap<POSBill, string | null>();
    return (sale: POSBill): string | null => {
      let reason = cache.get(sale);
      if (reason === undefined) {
        reason = saleModeLockReason(sale, { canEdit: canChangeMode, isDayLocked, shiftById });
        cache.set(sale, reason);
      }
      return reason;
    };
  }, [canChangeMode, isDayLocked, shiftById]);

  // Dialogs show the live bill, so a sync or an edit made elsewhere is reflected while one is open.
  const detailSale = useMemo(
    () => (selectedDetailSale ? sales.find((s: POSBill) => s.id === selectedDetailSale.id) || selectedDetailSale : null),
    [sales, selectedDetailSale],
  );
  const receiptSale = useMemo(
    () => (selectedReceiptSale ? sales.find((s: POSBill) => s.id === selectedReceiptSale.id) || selectedReceiptSale : null),
    [sales, selectedReceiptSale],
  );

  const handleConfirmReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnModalSale || returnSubmittingRef.current) return;

    const selectedToReturn = returnItems
      .filter(it => it.isSelected && it.returnQty > 0)
      .map(it => ({
        itemId: it.itemId,
        name: it.name,
        qty: it.returnQty,
        price: it.price,
        unit: it.lineUnit ?? it.unit,
        variantId: it.variantId,
        // The bill's own snapshot, so the context restocks the pile and size the sale used.
        lineIndex: it.lineIndex,
        baseUnit: it.baseUnit,
        stockDeduction: it.stockDeduction,
        deductFromBase: it.deductFromBase,
        isLoose: it.isLoose
      }));

    if (selectedToReturn.length === 0) {
      showToast("Please select at least one item to return", "warning");
      return;
    }

    const finalReason = returnReason === 'Other'
      ? (customReturnReason.trim() || 'Other return')
      : returnReason;

    returnSubmittingRef.current = true;
    try {
      // Staff without the return right, or every return when the owner asks for it, needs a manager PIN.
      const isApprover = currentUser?.role_id === 'role_super_admin' || canPerform('approvals', 'return');
      if (!isApprover && (!canReturn || settings.security?.returnNeedsApproval)) {
        const approvedBy = await requestApproval({
          permission: 'approvals:return',
          title: 'Return ke liye manager approval',
          reason: `Bill ${returnModalSale.bill_number || ''} — ${finalReason}`,
        });
        if (!approvedBy) return;
        showToast(`Return ${approvedBy} ne approve kiya.`, 'success');
      }

      setIsProcessingReturn(true);
      const success = await processSalesReturn(
        returnModalSale.id,
        finalReason,
        refundAccountId || undefined,
        returnAction,
        restockOption,
        selectedToReturn,
        refundPaymentMode,
        correctOriginalSaleMode
      );

      if (success) {
        setReturnModalSale(null);
        setReturnReason('Customer Changed Mind');
        setCustomReturnReason('');
        setReturnAction('refund');
        setRestockOption('restock');
        setRefundAccountId('');
        setRefundPaymentMode('Cash');
        setCorrectOriginalSaleMode(false);
        setReturnItems([]);
      }
    } finally {
      returnSubmittingRef.current = false;
      setIsProcessingReturn(false);
    }
  };

  const copyInvoiceNumber = (e: React.MouseEvent, billNumber: string) => {
    e.stopPropagation();
    const clean = billNumber.startsWith('#') ? billNumber : `#${billNumber}`;
    try {
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(clean);
      }
      showToast(`Copied ${clean} to clipboard!`, 'success');
    } catch {
      showToast(`Invoice: ${clean}`, 'info');
    }
  };

  // Stable callbacks for the memoised rows; they always call the latest handlers (fresh URL and state).
  const handlers = useRef({ openDetailSale, openReceiptSale, openModeEditModal, openReturnModal, copyInvoiceNumber });
  useLayoutEffect(() => {
    handlers.current = { openDetailSale, openReceiptSale, openModeEditModal, openReturnModal, copyInvoiceNumber };
  });
  const onOpenDetail = useCallback((sale: POSBill) => handlers.current.openDetailSale(sale), []);
  const onOpenReceipt = useCallback((sale: POSBill) => handlers.current.openReceiptSale(sale), []);
  const onOpenMode = useCallback((sale: POSBill) => handlers.current.openModeEditModal(sale), []);
  const onOpenReturn = useCallback((sale: POSBill) => handlers.current.openReturnModal(sale), []);
  const onCopyInvoice = useCallback((e: React.MouseEvent, billNumber: string) => handlers.current.copyInvoiceNumber(e, billNumber), []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDetailDialog();
      void loadReceiptDialog();
      void loadReturnDialog();
      void loadModeDialog();
    }, 2000);
    return () => window.clearTimeout(timer);
  }, []);

  const scopeLabel = filterDateRange === 'today' ? 'Today' : filterDateRange === 'month' ? 'This Month' : filterDateRange === 'custom' ? (customDate || 'Custom') : 'Filtered';

  const emptyState = (
    <SalesEmptyState
      search={activeSearch}
      matchingAllDatesCount={matchingAllDatesCount}
      searchAcrossAllDates={searchAcrossAllDates}
      totalSales={sales.length}
      filterDateRange={filterDateRange}
      onShowAllDates={() => setSearchAcrossAllDates(true)}
      onClearSearch={() => {
        setSearchTerm('');
        setSearchAcrossAllDates(true);
      }}
      onViewAll={() => {
        updateFilters({ range: 'all', mode: 'All', status: 'All' });
        setSearchTerm('');
      }}
    />
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 pb-20">
      {approvalDialog}

      <section aria-label="Sales summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Invoices"
          value={stats.count}
          icon={<ShoppingBag />}
          hint={`${stats.completed} Active / ${stats.returned} Ret`}
        />
        <StatCard label="Gross" value={<StatMoney amount={stats.gross} />} icon={<Banknote />} hint="Active Sales" />
        <StatCard
          label="Refunded"
          value={<StatMoney amount={stats.refunded} />}
          icon={<RotateCcw />}
          tone={stats.refunded > 0 ? 'danger' : 'neutral'}
          hint={`${stats.returned} Returned`}
        />
        <StatCard label="Net" value={<StatMoney amount={stats.net} />} icon={<Wallet />} tone="success" hint="Net Turnover" />
      </section>

      <Toolbar>
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search invoice # (e.g. #INV-..., 3E3CE7), customer, item, phone, amount (Rs 780)..."
          aria-label="Search sales"
          className="w-full md:w-auto md:min-w-[18rem] md:flex-1"
        />

        <div className="grid w-full grid-cols-3 gap-2 md:flex md:w-auto md:items-center">
          <Select
            aria-label="Date range"
            className={FILTER_SELECT}
            value={filterDateRange}
            onChange={e => updateFilters({ range: e.target.value })}
          >
            <option value="today">Today ({todayCount})</option>
            <option value="all">All Dates ({sales.length})</option>
            <option value="month">This Month ({monthCount})</option>
            <option value="custom">Custom Date...</option>
          </Select>

          <Select
            aria-label="Payment mode"
            className={FILTER_SELECT}
            value={filterMode}
            onChange={e => updateFilters({ mode: e.target.value })}
          >
            <option value="All">All Modes</option>
            <option value="Cash">Cash</option>
            <option value="Online">Online</option>
            <option value="Credit">Credit</option>
          </Select>

          <Select
            aria-label="Status"
            className={FILTER_SELECT}
            value={filterStatus}
            onChange={e => updateFilters({ status: e.target.value })}
          >
            <option value="All">All Status</option>
            <option value="Completed">Completed</option>
            <option value="Partially Returned">Partially Returned</option>
            <option value="Returned">Returned</option>
          </Select>

          {filterDateRange === 'custom' && (
            <Input
              type="date"
              aria-label="Custom date"
              className="col-span-3 md:w-44"
              value={customDate}
              onChange={e => setCustomDate(e.target.value)}
            />
          )}
        </div>

        <div className="flex w-full flex-wrap items-center justify-between gap-2 border-t border-line px-1 pt-2">
          {activeSearch ? (
            <>
              <div className="flex min-w-0 items-center gap-2 text-sm text-fg-muted">
                <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-fg">
                  <Search className="size-3.5" />
                </span>
                <span className="min-w-0" aria-live="polite">
                  Results for{' '}
                  <strong className="inline-block max-w-[14rem] truncate align-bottom font-mono font-semibold text-fg">&quot;{activeSearch}&quot;</strong>:{' '}
                  <strong className="font-bold tabular-nums text-fg">{filteredSales.length}</strong> {filteredSales.length === 1 ? 'sale' : 'sales'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden text-xs font-semibold text-fg-subtle sm:inline">Search Scope:</span>
                <SegmentedControl
                  aria-label="Search scope"
                  value={searchAcrossAllDates ? 'all' : 'range'}
                  onChange={value => setSearchAcrossAllDates(value === 'all')}
                  options={[
                    { value: 'all', label: 'All Dates', count: matchingAllDatesCount },
                    { value: 'range', label: `Only ${scopeLabel}`, count: matchingCurrentDateCount },
                  ]}
                />
              </div>
            </>
          ) : (
            <>
              <div className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 scrollbar-hide">
                <span className="mr-1 shrink-0 text-xs font-semibold text-fg-subtle">Quick Filters:</span>
                <QuickFilter
                  active={filterDateRange === 'today' && filterMode === 'All'}
                  onClick={() => updateFilters({ range: 'today', mode: 'All', status: 'All' })}
                >
                  Today ({todayCount})
                </QuickFilter>
                <QuickFilter
                  active={filterDateRange === 'all' && filterMode === 'All'}
                  onClick={() => updateFilters({ range: 'all', mode: 'All', status: 'All' })}
                >
                  All Invoices ({sales.length})
                </QuickFilter>
                <QuickFilter active={filterMode === 'Credit'} onClick={() => updateFilters({ mode: 'Credit' })}>
                  Credit / Khata
                </QuickFilter>
                <QuickFilter active={filterMode === 'Online'} onClick={() => updateFilters({ mode: 'Online' })}>
                  Online
                </QuickFilter>
                <QuickFilter active={filterStatus === 'Returned'} onClick={() => updateFilters({ status: 'Returned' })}>
                  Returns
                </QuickFilter>
              </div>
              <span className="hidden text-xs text-fg-subtle lg:inline">
                Tip: Search by #INV, customer, item, phone, or amount across all dates.
              </span>
            </>
          )}
        </div>
      </Toolbar>

      {/* Dims only when filtering takes a while (the delay), so fast keystrokes never flicker. */}
      <div aria-busy={isSearchStale || undefined} className={cn('transition-opacity duration-150', isSearchStale && 'opacity-60 delay-200')}>
        {isDesktop ? (
          <TableContainer>
            <Table>
              <THead>
                <tr>
                  <TH>Invoice #</TH>
                  <TH>Date</TH>
                  <TH>Customer</TH>
                  <TH numeric>Amount</TH>
                  <TH className="text-center">Payment</TH>
                  <TH className="text-center">Status</TH>
                  <TH className="text-right">Actions</TH>
                </tr>
              </THead>
              <TBody>
                {visibleItems.map(sale => (
                  <SaleTableRow
                    key={sale.id}
                    sale={sale}
                    modeLock={modeLockFor(sale)}
                    onOpenDetail={onOpenDetail}
                    onOpenReceipt={onOpenReceipt}
                    onOpenMode={onOpenMode}
                    onOpenReturn={onOpenReturn}
                    onCopy={onCopyInvoice}
                  />
                ))}
                <LoadMoreRow colSpan={7} sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} />
                {filteredSales.length === 0 && (
                  <tr>
                    <td colSpan={7}>{emptyState}</td>
                  </tr>
                )}
              </TBody>
            </Table>
          </TableContainer>
        ) : (
          <div className="flex flex-col gap-2">
            {visibleItems.map(sale => (
              <SaleCard
                key={sale.id}
                sale={sale}
                modeLock={modeLockFor(sale)}
                expanded={!!expandedSaleIds[sale.id]}
                onToggle={toggleExpand}
                onOpenDetail={onOpenDetail}
                onOpenReceipt={onOpenReceipt}
                onOpenMode={onOpenMode}
                onOpenReturn={onOpenReturn}
                onCopy={onCopyInvoice}
              />
            ))}
            <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} />
            {filteredSales.length === 0 && <Card>{emptyState}</Card>}
          </div>
        )}
      </div>

      {detailSale && (
        <Suspense fallback={null}>
          <SaleDetailDialog
            sale={detailSale}
            modeLock={modeLockFor(detailSale)}
            onClose={() => openDetailSale(null)}
            onCopy={copyInvoiceNumber}
            onChangeMode={(sale: POSBill) => {
              openDetailSale(null);
              openModeEditModal(sale);
            }}
            onReturn={(sale: POSBill) => {
              openDetailSale(null);
              openReturnModal(sale);
            }}
            onReceipt={openReceiptFromDetail}
          />
        </Suspense>
      )}

      {returnModalSale && (
        <Suspense fallback={null}>
          <SaleReturnDialog
            sale={returnModalSale}
            items={returnItems}
            selectedCount={activeReturnItems.length}
            refundAmount={currentRefundAmount}
            returnAction={returnAction}
            restockOption={restockOption}
            returnReason={returnReason}
            customReturnReason={customReturnReason}
            refundPaymentMode={refundPaymentMode}
            refundAccountId={refundAccountId}
            correctOriginalSaleMode={correctOriginalSaleMode}
            canCorrectOriginalMode={!modeLockFor(returnModalSale)}
            accounts={accounts}
            processing={isProcessingReturn}
            onToggleItem={toggleItemSelection}
            onQtyChange={updateItemReturnQty}
            onSelectAll={selectAllReturnItems}
            onReturnActionChange={handleReturnActionChange}
            onRestockChange={setRestockOption}
            onReasonChange={handleReturnReasonChange}
            onCustomReasonChange={setCustomReturnReason}
            onRefundModeChange={handleRefundModeChange}
            onRefundAccountChange={setRefundAccountId}
            onCorrectOriginalChange={handleCorrectOriginalChange}
            onSubmit={handleConfirmReturn}
            onClose={() => setReturnModalSale(null)}
          />
        </Suspense>
      )}

      {receiptSale && (
        <Suspense fallback={null}>
          <SaleReceiptDialog sale={receiptSale} settings={settings} onClose={() => openReceiptSale(null)} />
        </Suspense>
      )}

      {modeEditSale && (
        <Suspense fallback={null}>
          <PaymentModeDialog
            sale={modeEditSale}
            targetMode={targetMode}
            targetAccountId={targetAccountId}
            accounts={accounts}
            saving={isUpdatingMode}
            onTargetModeChange={handleTargetModeChange}
            onTargetAccountChange={setTargetAccountId}
            onSubmit={handleConfirmModeChange}
            onClose={() => setModeEditSale(null)}
          />
        </Suspense>
      )}
    </div>
  );
};

export default SalesHistory;
