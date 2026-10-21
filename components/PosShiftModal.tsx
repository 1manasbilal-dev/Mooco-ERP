import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import {
  X,
  Banknote,
  LogIn,
  LogOut,
  CheckCircle2,
  AlertTriangle,
  Store,
  AlertCircle,
  LockKeyhole,
  Calendar,
  User,
  Wallet,
  Info,
} from 'lucide-react';
import {
  DenominationDialog,
  DENOMINATIONS,
  splitDenominations,
  money
} from './DenominationDialog';
import { PosShiftActivityDialog, ShiftActivityTab } from './PosShiftActivityDialog';
import { SmartNumberInput } from './SmartNumberInput';
import { ShiftCashFlow } from './ShiftCashFlow';
import { confirmAction } from './ui/ConfirmDialog';
import { syncService } from '../lib/syncService';
import { evaluateMathExpression } from '../lib/mathEvaluator';

interface PosShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Specific reasons the head can act on. "Other" needs the cashier's own words.
const QUICK_DIFFERENCE_REASONS = [
  'Wrong change given',
  'Expense paid but not entered',
  'Sale not punched',
  'Counting error',
];
const RECEIVE_ACCOUNT_KEY = 'mooco_shift_receive_account';

/** Typed cash ("5000", "5,000", "5000+3260") as a number, or null when it is not a valid amount of 0 or more. */
const parseCashAmount = (raw: string): number | null => {
  const parsed = evaluateMathExpression(raw)?.result;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export const PosShiftModal: React.FC<PosShiftModalProps> = ({ isOpen, onClose }) => {
  const {
    currentUser,
    currentRole,
    activeShiftSession,
    shiftSessions,
    cashDrawers,
    cashHandovers,
    accounts,
    settings,
    startCashierShift,
    closeCashierShift,
    getShiftTotals,
    getBusinessDate,
    deleteExpenseVendorTransaction,
    canPerform
  } = useDairy();

  const { showToast } = useToast();

  const canDeleteVendorTx = canPerform('expenses', 'delete') || currentUser?.role_id === 'role_super_admin' || currentRole?.name === 'Super Admin' || currentRole?.name === 'Admin';

  // --- Start Shift State (Using real Cash Accounts from Bank & Cash) ---
  // Only Cash accounts explicitly ENABLED as drawers — never Bank/Wallet.
  const cashAccounts = useMemo(
    () => accounts.filter(a => a.type === 'Cash' && a.isDrawer === true && a.isActive !== false),
    [accounts]
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const activeAccount = useMemo(() => {
    return cashAccounts.find(a => a.id === selectedAccountId)
      || (settings.financial?.defaultCashAccountId ? cashAccounts.find(a => a.id === settings.financial?.defaultCashAccountId) : null)
      || cashAccounts[0]
      || null;
  }, [cashAccounts, selectedAccountId, settings.financial?.defaultCashAccountId]);
  const [isStarting, setIsStarting] = useState(false);

  // Handover pending for active drawer account
  const pendingHandover = useMemo(() => {
    if (!activeAccount) return undefined;
    return cashHandovers.find(h => (h.drawer_id === activeAccount.id || (cashDrawers.find(d => d.id === h.drawer_id)?.account_id === activeAccount.id)) && h.status === 'Pending');
  }, [activeAccount, cashHandovers, cashDrawers]);

  // Check if there is an active shift currently on this drawer from today
  const currentBizDate = getBusinessDate();
  const drawerActiveShift = useMemo(() => {
    if (!activeAccount) return null;
    return shiftSessions.find(s =>
      (s.drawer_id === activeAccount.id || (cashDrawers.find(d => d.id === s.drawer_id)?.account_id === activeAccount.id)) &&
      ['Active', 'Closing', 'Pending Acceptance'].includes(s.status) &&
      (!s.business_date || s.business_date >= currentBizDate)
    ) || null;
  }, [activeAccount, shiftSessions, cashDrawers, currentBizDate]);

  // Opening cash amount: pending handover from previous cashier, or the live balance of the cash drawer account
  const defaultOpeningAmount = useMemo(() => {
    if (pendingHandover?.declared_amount !== undefined) {
      return Number(pendingHandover.declared_amount);
    }
    if (activeAccount?.balance !== undefined && activeAccount.balance !== null) {
      return Math.max(0, Number(activeAccount.balance));
    }
    const matchingDrawer = cashDrawers.find(d => d.id === activeAccount?.id || d.account_id === activeAccount?.id);
    if (matchingDrawer?.default_float !== undefined && Number(matchingDrawer.default_float) > 0) {
      return Number(matchingDrawer.default_float);
    }
    return 0;
  }, [pendingHandover, activeAccount, cashDrawers]);

  const [openingCashInput, setOpeningCashInput] = useState<string>('');
  const [isEditingOpening, setIsEditingOpening] = useState<boolean>(false);
  const [openingDenominations, setOpeningDenominations] = useState<Record<string | number, number>>({});
  const [isOpeningDenomOpen, setIsOpeningDenomOpen] = useState(false);

  useEffect(() => {
    setOpeningCashInput('');
    setIsEditingOpening(false);
    setOpeningDenominations({});
  }, [activeAccount?.id, pendingHandover?.id]);

  const openingAmount = useMemo(() => {
    if (isEditingOpening && openingCashInput.trim() !== '') {
      return parseCashAmount(openingCashInput) ?? 0;
    }
    return defaultOpeningAmount;
  }, [isEditingOpening, openingCashInput, defaultOpeningAmount]);

  // --- Close Shift State ---
  const [countedCash, setCountedCash] = useState<string>('');
  const [leaveInDrawer, setLeaveInDrawer] = useState<string>('');
  // Until the cashier types a float, "keep in drawer" follows the drawer's default float, capped at the count.
  const [leaveTouched, setLeaveTouched] = useState(false);
  const [closingDenominations, setClosingDenominations] = useState<Record<string | number, number>>({});
  const [isClosingDenomOpen, setIsClosingDenomOpen] = useState(false);
  const [differenceReason, setDifferenceReason] = useState<string>('');
  const [closeNotes, setCloseNotes] = useState<string>('');
  const [isClosing, setIsClosing] = useState(false);
  const [approveDifferenceNow, setApproveDifferenceNow] = useState(true);
  const [detailModalTab, setDetailModalTab] = useState<ShiftActivityTab | null>(null);
  const [detailModalCategory, setDetailModalCategory] = useState<string | undefined>(undefined);
  const openDetailDialog = (tab: ShiftActivityTab, category?: string) => {
    setDetailModalCategory(category);
    setDetailModalTab(tab);
  };

  const drawerAccountId = activeShiftSession
    ? (cashDrawers.find(d => d.id === activeShiftSession.drawer_id)?.account_id || activeShiftSession.account_id || activeShiftSession.drawer_id)
    : undefined;
  const defaultLeave = useMemo(() => {
    if (!activeShiftSession) return 0;
    const drawer = cashDrawers.find(d => d.id === activeShiftSession.drawer_id || d.account_id === drawerAccountId);
    const float = Number(drawer?.default_float || 0);
    return float > 0 ? float : 5000;
  }, [activeShiftSession, cashDrawers, drawerAccountId]);

  // Fresh inputs for each shift only. Keyed on the id: accounts and drawers refresh after every
  // sale sync, and that must not wipe a count the cashier is typing.
  useEffect(() => {
    setLeaveInDrawer('');
    setLeaveTouched(false);
    setCountedCash('');
    setClosingDenominations({});
    setDifferenceReason('');
    setCloseNotes('');
  }, [activeShiftSession?.id]);

  // A head who closes the shift is holding the cash already: receive it straight into an account.
  const isHead = currentUser?.role_id === 'role_super_admin' || currentUser?.role_id === 'role_manager'
    || Boolean(currentRole?.permissions?.includes('cash_control:approve' as any))
    || Boolean((currentUser?.permissions || []).includes('cash_control:approve'));
  const receivingAccounts = useMemo(
    () => accounts.filter(a =>
      a.isActive !== false &&
      a.id !== drawerAccountId &&
      a.id !== activeShiftSession?.drawer_id &&
      ['Cash', 'Bank', 'Wallet'].includes(a.type) &&
      !(a.type === 'Cash' && a.isDrawer === true)
    ),
    [accounts, drawerAccountId, activeShiftSession?.drawer_id]
  );
  const [receiveAccountId, setReceiveAccountId] = useState<string>(() => {
    try { return localStorage.getItem(RECEIVE_ACCOUNT_KEY) || ''; } catch { return ''; }
  });
  const effectiveReceiveAccountId = useMemo(() => {
    if (!isHead) return '';
    if (receiveAccountId === 'inbox') return '';
    if (receiveAccountId && receivingAccounts.some(a => a.id === receiveAccountId)) return receiveAccountId;
    const preferred = settings.financial?.defaultCashAccountId;
    return receivingAccounts.find(a => a.id === preferred)?.id
      || receivingAccounts.find(a => a.type === 'Cash')?.id
      || '';
  }, [isHead, receiveAccountId, receivingAccounts, settings.financial?.defaultCashAccountId]);

  // Bills still waiting to reach the server, and bills left in the cart, at close time.
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  useEffect(() => {
    if (!isOpen || !activeShiftSession) return;
    return syncService.subscribe(state => setPendingSyncCount(state.pendingCount + state.failedCount));
  }, [isOpen, activeShiftSession?.id]);
  const unfinishedCounter = useMemo(() => {
    if (!isOpen) return { cartLines: 0, parked: 0 };
    let cartLines = 0;
    let parked = 0;
    try {
      const draft = JSON.parse(sessionStorage.getItem('mooco_pos_cart_draft') || 'null');
      cartLines = Array.isArray(draft?.cart) ? draft.cart.length : 0;
    } catch {}
    try {
      const held = JSON.parse(localStorage.getItem('pos_held_orders') || '[]');
      parked = Array.isArray(held) ? held.length : 0;
    } catch {}
    return { cartLines, parked };
  }, [isOpen]);

  // Active shift live totals
  const shiftTotals = useMemo(() => {
    if (!activeShiftSession) {
      return {
        gross_sales: 0,
        cash_sales: 0,
        online_sales: 0,
        credit_sales: 0,
        cash_collections: 0,
        cash_refunds: 0,
        cash_expenses: 0,
        cash_purchases: 0,
        other_cash_in: 0,
        other_cash_out: 0,
        bills_count: 0,
        expectedCash: 0
      };
    }
    return getShiftTotals(activeShiftSession.id);
  }, [activeShiftSession, getShiftTotals]);

  // Reconcile the cash-only overview with the existing shift totals.
  const waterfallData = useMemo(() => {
    const openingFloat = Number(activeShiftSession?.opening_counted ?? activeShiftSession?.opening_float ?? 0);
    const grossSales = Number(shiftTotals.gross_sales || 0);
    const creditSales = Number(shiftTotals.credit_sales || 0);
    const onlineSales = Number(shiftTotals.online_sales || 0);
    const netCashSales = Number(shiftTotals.cash_sales || 0);
    const billsCount = Number(shiftTotals.bills_count || 0);

    const outflows = shiftTotals.drawer_outflows || [];
    const isVendorOrSupplier = (item: any) => {
      const g = String(item.group || '').toLowerCase();
      const c = String(item.category || '').toLowerCase();
      return (
        g.includes('vendor') ||
        g.includes('supplier') ||
        g.includes('milk') ||
        c.includes('milk purchase') ||
        c.includes('supplier payment') ||
        c.includes('vendor / staff payment')
      );
    };

    const vendorItems = outflows.filter(isVendorOrSupplier);
    const shopExpenseItems = outflows.filter(item => !isVendorOrSupplier(item));

    const totalPayouts = Number(shiftTotals.cash_expenses || 0) + Number(shiftTotals.cash_purchases || 0);
    const calculatedVendorPayouts = vendorItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    
    // In case itemized list is empty, fall back cleanly to cash_purchases
    const vendorPayouts = outflows.length > 0 ? calculatedVendorPayouts : Number(shiftTotals.cash_purchases || 0);
    const shopExpenses = Math.max(0, totalPayouts - vendorPayouts);

    const cashCollections = Number(shiftTotals.cash_collections || 0);
    const otherCashIn = Number(shiftTotals.other_cash_in || 0);
    const totalCollections = cashCollections + otherCashIn;

    const calculatedCash = openingFloat + netCashSales - vendorPayouts - shopExpenses + totalCollections;
    
    // Any other adjustments (e.g. prior shift refund, other cash out)
    const expectedCash = Number(shiftTotals.expectedCash || 0);
    const adjustments = Math.round((expectedCash - calculatedCash) * 100) / 100;

    return {
      openingFloat,
      grossSales,
      creditSales,
      onlineSales,
      netCashSales,
      billsCount,
      vendorPayouts,
      vendorItems,
      shopExpenses,
      shopExpenseItems,
      cashCollections,
      collectionsList: shiftTotals.collections_list || [],
      otherCashIn,
      totalCollections,
      adjustments,
      expectedCash
    };
  }, [activeShiftSession, shiftTotals]);

  // Closing cash counted total (from denominations or manual input)
  const closingDenomTotal = useMemo(
    () => DENOMINATIONS.reduce((sum, d) => sum + d * Number(closingDenominations[d] || 0), 0),
    [closingDenominations]
  );
  // A typo ("5000abc", "-500") used to become NaN, which matched every check and closed as "count matches".
  const countedParsed = parseCashAmount(countedCash);
  const countInvalid = closingDenomTotal <= 0 && countedCash.trim() !== '' && countedParsed === null;
  const effectiveCountedCash = closingDenomTotal > 0 ? closingDenomTotal : (countedParsed ?? 0);
  const hasCount = countedCash.trim() !== '' || closingDenomTotal > 0;
  const leaveParsed = parseCashAmount(leaveInDrawer);
  const leaveInvalid = leaveTouched && leaveInDrawer.trim() !== '' && leaveParsed === null;
  const effectiveLeaveInDrawer = leaveTouched
    ? (leaveParsed ?? 0)
    : (hasCount ? Math.min(defaultLeave, effectiveCountedCash) : defaultLeave);
  const effectiveRemitToHead = Math.max(0, Math.round((effectiveCountedCash - effectiveLeaveInDrawer) * 100) / 100);

  // Variance calculation
  const variance = useMemo(() => {
    if (!activeShiftSession) return 0;
    return Math.round((effectiveCountedCash - shiftTotals.expectedCash) * 100) / 100;
  }, [activeShiftSession, effectiveCountedCash, shiftTotals.expectedCash]);

  const hasVariance = Math.abs(variance) >= 0.01;
  // Only the Owner, on their own shift, may approve the difference while closing.
  const canApproveOwnDifference = currentUser?.role_id === 'role_super_admin' && activeShiftSession?.user_id === currentUser?.id;
  // "Other" on its own tells the head nothing; it needs the cashier's own words.
  const reasonOk = (() => {
    const reason = differenceReason.trim();
    return reason.length >= 3 && !/^other\.?$/i.test(reason);
  })();
  const closeBlocker = !hasCount
    ? 'Drawer ki cash gin kar likhein.'
    : countInvalid || leaveInvalid
      ? 'Raqam sahi likhein — sirf number (jaise 5000 ya 5000+3260).'
    : effectiveCountedCash < effectiveLeaveInDrawer
      ? 'Drawer mein rakhi raqam gini hui cash se zyada nahi ho sakti.'
      : hasVariance && !reasonOk
        ? 'Farq ki wajah likhein.'
        : '';

  // Escape key handler (a confirm dialog on top owns its own Escape)
  useEffect(() => {
    if (!isOpen || isClosingDenomOpen || isOpeningDenomOpen || Boolean(detailModalTab)) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.querySelector('[data-app-modal="true"]')) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isClosingDenomOpen, isOpeningDenomOpen, detailModalTab, onClose]);

  // --- Handlers ---
  const handleStartShift = async () => {
    if (!activeAccount) {
      showToast('No drawer-enabled Cash account found. Please enable a Cash account as a drawer in Bank & Cash.', 'error');
      return;
    }

    setIsStarting(true);
    try {
      const ok = await startCashierShift({
        drawerId: activeAccount.id,
        openingCounted: openingAmount,
        denominations: isEditingOpening ? openingDenominations : {},
        handoverId: pendingHandover?.id
      });
      if (ok) {
        onClose();
      }
    } finally {
      setIsStarting(false);
    }
  };

  const handleCloseShift = async () => {
    if (!activeShiftSession) return;

    if (closeBlocker) {
      showToast(closeBlocker, 'warning');
      return;
    }

    const receiveAccount = accounts.find(a => a.id === effectiveReceiveAccountId);
    const consequences: React.ReactNode[] = [
      `Gini hui cash: ${money(effectiveCountedCash)} (expected ${money(shiftTotals.expectedCash)})`,
      `Drawer mein agli shift ke liye: ${money(effectiveLeaveInDrawer)}`,
    ];
    if (effectiveRemitToHead > 0) {
      consequences.push(receiveAccount
        ? `${money(effectiveRemitToHead)} abhi "${receiveAccount.name}" mein receive ho jayenge`
        : `${money(effectiveRemitToHead)} Head Inbox mein jayenge (accept hone tak pending)`);
    }
    if (hasVariance) {
      consequences.push(canApproveOwnDifference && approveDifferenceNow
        ? `${variance < 0 ? 'Kami' : 'Zyada'} ${money(Math.abs(variance))} — record ho kar abhi approve ho jayega`
        : `${variance < 0 ? 'Kami' : 'Zyada'} ${money(Math.abs(variance))} — manager review ke liye record hoga`);
    }
    if (unfinishedCounter.cartLines > 0 || unfinishedCounter.parked > 0) {
      consequences.push(`Cart/parked bills (${unfinishedCounter.cartLines + unfinishedCounter.parked}) is shift ki sale mein shamil nahi honge`);
    }
    if (pendingSyncCount > 0) {
      consequences.push(`${pendingSyncCount} entry abhi server par nahi gayi — internet check kar lein`);
    }
    const confirmed = await confirmAction({
      tone: hasVariance || pendingSyncCount > 0 ? 'warning' : 'info',
      title: 'Shift close karein?',
      message: 'Close ke baad is shift mein sale nahi ho sakegi. Agli sale ke liye nayi shift start karni hogi.',
      consequences,
      confirmLabel: 'Haan, shift close karein',
    });
    if (!confirmed) return;

    setIsClosing(true);
    try {
      if (isHead) {
        try { localStorage.setItem(RECEIVE_ACCOUNT_KEY, effectiveReceiveAccountId || 'inbox'); } catch {}
      }
      const ok = await closeCashierShift({
        countedCash: effectiveCountedCash,
        leaveInDrawer: effectiveLeaveInDrawer,
        remitToHead: effectiveRemitToHead,
        denominations: {
          closing: closingDenominations,
          leave_in_drawer: splitDenominations(closingDenominations, effectiveLeaveInDrawer),
          remit_to_head: splitDenominations(closingDenominations, effectiveRemitToHead)
        },
        differenceReason: hasVariance ? differenceReason.trim() : '',
        notes: closeNotes.trim(),
        receiveIntoAccountId: effectiveReceiveAccountId || undefined,
        approveDifferenceNow: hasVariance && canApproveOwnDifference && approveDifferenceNow
      });

      if (ok) {
        onClose();
      }
    } finally {
      setIsClosing(false);
    }
  };

  const formattedStartTime = activeShiftSession?.started_at
    ? new Date(activeShiftSession.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : activeShiftSession?.start_time || '—';

  if (!isOpen) return null;

  const modalContent = (
    <>
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
        <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs" onClick={onClose} />
        
        <div role="dialog" aria-modal="true" aria-labelledby="shift-dialog-title" className={`relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full ${activeShiftSession ? 'max-w-6xl' : 'max-w-2xl'} border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[94vh] animate-in zoom-in-95 duration-200`}>
          
          {/* Top Bar Header */}
          <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-800/50 shrink-0">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center font-bold shrink-0 ${
                  activeShiftSession
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                }`}
              >
                {activeShiftSession ? <Store size={22} /> : <LogIn size={22} />}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id="shift-dialog-title" className="font-black text-base sm:text-lg text-slate-900 dark:text-white">
                    {activeShiftSession ? 'Shift cash & handover' : 'Start Shift'}
                  </h3>
                  <span
                    className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                      activeShiftSession
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400'
                    }`}
                  >
                    {activeShiftSession ? '● Active Shift' : '○ Not Started'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {activeShiftSession
                    ? 'Review cash movement, count your drawer and hand over.'
                    : 'Review opening float to start your session'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close shift dialog"
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-4 sm:p-5 overflow-y-auto flex-1 min-h-0 space-y-4 bg-slate-50/50 dark:bg-slate-950/20">
            
            {/* Cashier Info Banner */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-1 text-xs">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <User size={15} className="text-slate-400 shrink-0" />
                <span>Cashier: <strong className="text-slate-900 dark:text-white font-bold">{currentUser?.name || 'Cashier'}</strong> ({currentRole?.name || 'Staff'})</span>
                {activeShiftSession && activeShiftSession.user_id !== currentUser?.id && (
                  <span className="rounded-full bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 text-[10px] font-black text-amber-800 dark:text-amber-300">
                    Shift of {activeShiftSession.user_name || 'another cashier'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 shrink-0 font-mono text-[11px]">
                <Calendar size={13} className="text-slate-400" />
                <span>{getBusinessDate()}</span>
              </div>
            </div>

            {/* ========================================================================= */}
            {/* VIEW A: NO ACTIVE SHIFT — CLEAN 1-CLICK START SHIFT                       */}
            {/* ========================================================================= */}
            {!activeShiftSession && (
              <div className="space-y-4 py-1 max-w-xl mx-auto">
                {cashAccounts.length === 0 ? (
                  <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-center">
                    <AlertTriangle className="mx-auto text-amber-500 mb-2" size={24} />
                    <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                      No drawer-enabled Cash account found. Please enable a Cash account as a drawer in Bank &amp; Cash (Bank and digital wallet accounts cannot be used as cash drawers).
                    </p>
                  </div>
                ) : (
                  <>
                    {cashAccounts.length > 1 && (
                      <div className="text-left">
                        <label className="block text-xs font-bold text-slate-500 mb-1.5">
                          Select Cash Drawer / Account (Bank & Cash)
                        </label>
                        <select
                          value={activeAccount?.id || ''}
                          onChange={e => setSelectedAccountId(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-xs font-bold text-slate-900 dark:text-white outline-none focus:border-lime-500 cursor-pointer"
                        >
                          {cashAccounts.map(acc => (
                            <option key={acc.id} value={acc.id}>
                              {acc.name} · Live Balance: {money(acc.balance)}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Hero Opening Cash Display Card */}
                    <div className="rounded-2xl sm:rounded-3xl bg-gradient-to-br from-lime-500/10 via-emerald-500/5 to-slate-50 dark:from-lime-950/40 dark:via-slate-900 dark:to-slate-900 border border-lime-500/30 dark:border-lime-500/20 p-6 sm:p-7 text-center relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-lime-500/10 rounded-full blur-2xl pointer-events-none" />
                      
                      <div className="w-12 h-12 rounded-2xl bg-lime-500/20 text-lime-600 dark:text-lime-400 flex items-center justify-center mx-auto mb-3">
                        <Wallet size={24} />
                      </div>

                      <span className="text-xs uppercase font-black tracking-wider text-slate-400 dark:text-slate-400 block">
                        Opening Cash {activeAccount ? `· ${activeAccount.name}` : ''}
                      </span>

                      {!isEditingOpening ? (
                        <>
                          <div className="text-3xl sm:text-4xl font-black font-mono text-slate-900 dark:text-white mt-1.5">
                            {money(openingAmount)}
                          </div>

                          <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-white/80 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                              {pendingHandover ? (
                                <span>Handover from {pendingHandover.from_user_name || 'Previous Cashier'}</span>
                              ) : (
                                <span>Live Drawer Balance: {money(activeAccount?.balance || 0)}</span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setOpeningCashInput('');
                                setOpeningDenominations({});
                                setIsEditingOpening(true);
                              }}
                              className="text-xs font-bold text-lime-700 dark:text-lime-400 hover:underline px-2 py-1 cursor-pointer"
                            >
                              Cash alag hai? Gin kar likhein
                            </button>
                          </div>
                          <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                            Shift start karne se pehle drawer ki cash gin lein. Raqam alag ho to upar se likhein — farq manager ke review mein jayega.
                          </p>
                        </>
                      ) : (
                        <div className="mt-3 max-w-xs mx-auto space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <label htmlFor="shift-opening-cash" className="block text-xs font-bold text-slate-600 dark:text-slate-300">
                              Drawer mein gini hui cash (Rs)
                            </label>
                            <button
                              type="button"
                              onClick={() => setIsOpeningDenomOpen(true)}
                              className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg bg-lime-100 dark:bg-lime-950/60 border border-lime-300 dark:border-lime-800 text-lime-800 dark:text-lime-300 cursor-pointer"
                            >
                              <Banknote size={11} /> Count notes
                            </button>
                          </div>
                          <div className="relative">
                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono font-bold text-slate-400 text-sm z-10 pointer-events-none">Rs</span>
                            <SmartNumberInput
                              id="shift-opening-cash"
                              min="0"
                              step="1"
                              value={openingCashInput}
                              placeholder={String(defaultOpeningAmount)}
                              onChange={val => {
                                setOpeningCashInput(val);
                                setOpeningDenominations({});
                              }}
                              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-lime-400 dark:border-lime-500/60 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold text-lg text-center outline-none focus:ring-2 focus:ring-lime-500/30"
                              autoFocus
                            />
                          </div>
                          <div className="flex items-center justify-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                setOpeningCashInput('');
                                setOpeningDenominations({});
                                setIsEditingOpening(false);
                              }}
                              className="text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 px-3 py-1 cursor-pointer"
                            >
                              Wapas {money(defaultOpeningAmount)} rakhein
                            </button>
                          </div>
                          {openingCashInput.trim() !== '' && Math.abs(openingAmount - defaultOpeningAmount) >= 0.01 && (
                            <p role="status" className="text-[11px] font-bold text-amber-700 dark:text-amber-300">
                              {openingAmount < defaultOpeningAmount ? 'Kami' : 'Zyada'} {money(Math.abs(openingAmount - defaultOpeningAmount))} — manager review ke liye record hoga.
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {drawerActiveShift && (
                      <div className="p-3.5 sm:p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-left mt-2">
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-bold text-xs">Drawer has an unclosed active shift</p>
                            <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                              Started by <strong>{drawerActiveShift.user_name || 'Cashier'}</strong> ({drawerActiveShift.business_date || 'earlier session'}). A new shift cannot be started on this drawer until the active shift is closed.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Single 1-Click Action Button */}
                    <button
                      type="button"
                      disabled={isStarting || !activeAccount || Boolean(drawerActiveShift) || (isEditingOpening && (openingCashInput.trim() === '' || parseCashAmount(openingCashInput) === null))}
                      onClick={handleStartShift}
                      className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl bg-lime-500 hover:bg-lime-400 active:scale-[0.99] text-slate-950 font-black text-sm shadow-lg shadow-lime-500/25 transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none mt-2"
                    >
                      <CheckCircle2 size={18} />
                      <span>
                        {drawerActiveShift
                          ? 'Close Active Shift First'
                          : isStarting
                            ? 'Starting Shift...'
                            : isEditingOpening
                              ? (openingCashInput.trim() === '' ? 'Gini hui cash likhein' : `Start Shift with ${money(openingAmount)}`)
                              : `Cash ${money(openingAmount)} theek hai — Start Shift`}
                      </span>
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ========================================================================= */}
            {/* VIEW B: SHIFT ACTIVE — LIVE SUMMARY & SHIFT CLOSE/SUBMIT FORM              */}
            {/* ========================================================================= */}
            {activeShiftSession && (
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
                
                <ShiftCashFlow
                  drawerName={activeShiftSession.account_name || accounts.find(a => a.id === activeShiftSession.drawer_id || a.id === activeShiftSession.account_id)?.name || activeShiftSession.drawer_name || 'Cash Drawer'}
                  startedAt={formattedStartTime}
                  data={waterfallData}
                  onDetails={openDetailDialog}
                />
                {/* Close Shift Form Section */}
                <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-4 lg:sticky lg:top-0">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800"><LogOut size={16} className="text-slate-600 dark:text-slate-300" /></span>
                    <h4 className="font-black text-sm sm:text-base text-slate-900 dark:text-white">
                      Count & hand over
                    </h4>
                  </div>

                  {/* 1. Count your physical cash */}
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                      <label htmlFor="shift-counted-cash" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        1. Count your physical cash
                      </label>
                      <div className="flex items-center gap-1.5">
                        {/* No "use expected" shortcut: the close is only worth something when the cash is really counted. */}
                        <button
                          type="button"
                          onClick={() => setIsClosingDenomOpen(true)}
                          className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg bg-lime-100 dark:bg-lime-950/60 border border-lime-300 dark:border-lime-800 text-lime-800 dark:text-lime-300 cursor-pointer"
                        >
                          <Banknote size={11} /> Count notes
                        </button>
                      </div>
                    </div>

                    <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">Expected: <strong className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{money(shiftTotals.expectedCash)}</strong></p>
                    <div className="relative flex items-center">
                      <span className="absolute left-3.5 text-xs font-black text-slate-400 z-10 pointer-events-none">Rs</span>
                      <SmartNumberInput
                        id="shift-counted-cash"
                        min="0"
                        value={countedCash}
                        onChange={val => {
                          setCountedCash(val);
                          setClosingDenominations({});
                        }}
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-black text-slate-900 dark:text-white focus:border-emerald-500 outline-hidden"
                        placeholder="Enter amount or 5000+3260"
                      />
                    </div>
                  </div>

                  {/* 2. Keep for the next shift */}
                  <div>
                    <label htmlFor="shift-leave-cash" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      2. Keep for the next shift
                    </label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3.5 text-xs font-black text-slate-400 z-10 pointer-events-none">Rs</span>
                      <SmartNumberInput
                        id="shift-leave-cash"
                        min="0"
                        value={leaveTouched ? leaveInDrawer : String(effectiveLeaveInDrawer)}
                        onChange={val => {
                          setLeaveTouched(true);
                          setLeaveInDrawer(val);
                        }}
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-bold text-slate-900 dark:text-white focus:border-emerald-500 outline-hidden"
                        placeholder={String(defaultLeave)}
                      />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      This stays in the drawer as the next shift's opening cash{leaveTouched ? '' : ` (default ${money(defaultLeave)})`}.
                    </p>
                    {hasCount && effectiveCountedCash < effectiveLeaveInDrawer && (
                      <p role="alert" className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">Keep an amount equal to or below your counted cash.</p>
                    )}
                  </div>

                  {/* Split Preview: Counted vs Drawer vs To head office */}
                  <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-center">
                    <div>
                      <span className="text-[9px] uppercase font-bold text-slate-400 block">Total Counted</span>
                      <span className="text-xs sm:text-sm font-black font-mono text-slate-900 dark:text-white mt-0.5 block">
                        {countedCash.trim() || closingDenomTotal > 0 ? money(effectiveCountedCash) : '—'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[9px] uppercase font-bold text-slate-400 block">Drawer Float</span>
                      <span className="text-xs sm:text-sm font-black font-mono text-slate-700 dark:text-slate-300 mt-0.5 block">
                        {money(effectiveLeaveInDrawer)}
                      </span>
                    </div>

                    <div className="bg-lime-50 dark:bg-lime-950/40 rounded-lg py-0.5 border border-lime-200 dark:border-lime-900">
                      <span className="text-[9px] uppercase font-black text-lime-700 dark:text-lime-400 block">To head office</span>
                      <span className="text-xs sm:text-sm font-black font-mono text-lime-700 dark:text-lime-300 mt-0.5 block">
                        {countedCash.trim() || closingDenomTotal > 0 ? money(effectiveRemitToHead) : '—'}
                      </span>
                    </div>
                  </div>

                  {effectiveRemitToHead > 0 && (isHead ? (
                    <div>
                      <label htmlFor="shift-receive-account" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        3. Receive {money(effectiveRemitToHead)} into
                      </label>
                      <select
                        id="shift-receive-account"
                        value={effectiveReceiveAccountId || 'inbox'}
                        onChange={e => setReceiveAccountId(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-xs font-bold text-slate-900 dark:text-white outline-none focus:border-emerald-500 cursor-pointer"
                      >
                        {receivingAccounts.map(acc => (
                          <option key={acc.id} value={acc.id}>{acc.name} ({acc.type})</option>
                        ))}
                        <option value="inbox">Keep pending in Head Inbox</option>
                      </select>
                      <p className="text-[11px] text-slate-400 mt-1">
                        {effectiveReceiveAccountId
                          ? 'Aap head hain — cash close ke sath hi is account mein aa jayegi.'
                          : 'Cash "in transit" rahegi jab tak Cash Control → Head Inbox se accept na ho.'}
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] font-bold text-violet-600 dark:text-violet-400 flex items-start gap-1.5">
                      <Info size={13} className="shrink-0 mt-0.5" />
                      <span>
                        Sent to head office when you close. Pending until they accept it.
                      </span>
                    </p>
                  ))}

                  {/* Variance Indicator & Difference Reason */}
                  {hasCount && (
                    <div>
                      {!hasVariance ? (
                        <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center gap-2 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                          <CheckCircle2 size={15} className="text-emerald-600" />
                          <span>Cash count matches the expected balance.</span>
                        </div>
                      ) : (
                        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 space-y-2">
                          <div className="flex items-center justify-between text-xs font-bold text-rose-800 dark:text-rose-300">
                            <span className="flex items-center gap-1.5">
                              <AlertCircle size={15} className="text-rose-600" />
                              {variance < 0 ? 'Cash Shortage' : 'Cash Surplus'}
                            </span>
                            <span className="font-mono font-black text-sm">
                              {variance < 0 ? `-${money(Math.abs(variance))}` : `+${money(variance)}`}
                            </span>
                          </div>

                          <div>
                            <label htmlFor="shift-difference-reason" className="block text-[11px] font-bold text-rose-900 dark:text-rose-200 mb-1">
                              Difference Reason (Required) *
                            </label>
                            <input
                              id="shift-difference-reason"
                              type="text"
                              value={differenceReason}
                              onChange={e => setDifferenceReason(e.target.value)}
                              placeholder="Kya hua? e.g. Rs 500 ka khula galat diya"
                              className="w-full px-3 py-2 text-xs rounded-lg border border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:border-rose-500 outline-hidden"
                            />

                            {/* Quick reason suggestions — "Other" means typing your own reason */}
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {QUICK_DIFFERENCE_REASONS.map(r => (
                                <button
                                  key={r}
                                  type="button"
                                  aria-pressed={differenceReason === r}
                                  onClick={() => setDifferenceReason(r)}
                                  className={`text-[10px] px-2 py-0.5 rounded-md border cursor-pointer ${differenceReason === r ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white dark:bg-slate-900 border-rose-200 dark:border-rose-800/60 text-slate-700 dark:text-slate-300 hover:border-rose-400'}`}
                                >
                                  {r}
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() => {
                                  setDifferenceReason('');
                                  document.getElementById('shift-difference-reason')?.focus();
                                }}
                                className="text-[10px] px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800/60 text-slate-700 dark:text-slate-300 hover:border-rose-400 cursor-pointer"
                              >
                                Other — likhein
                              </button>
                            </div>
                            {differenceReason.trim() !== '' && !reasonOk && (
                              <p role="alert" className="mt-1 text-[11px] font-medium text-rose-700 dark:text-rose-300">Wajah thori wazeh likhein — sirf "Other" kaafi nahi.</p>
                            )}
                            {canApproveOwnDifference && (
                              <label className="mt-2 flex items-start gap-2 text-[11px] text-rose-900 dark:text-rose-200 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={approveDifferenceNow}
                                  onChange={e => setApproveDifferenceNow(e.target.checked)}
                                  className="mt-0.5 accent-rose-600"
                                />
                                <span>Farq abhi approve karein (aap owner hain). Warna Audit Trail mein review ke liye pending rahega aur din close nahi hoga.</span>
                              </label>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Notes Field (Optional) */}
                  <div>
                    <label htmlFor="shift-close-notes" className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
                      Notes (Optional)
                    </label>
                    <input
                      id="shift-close-notes"
                      type="text"
                      value={closeNotes}
                      onChange={e => setCloseNotes(e.target.value)}
                      placeholder="Any additional notes..."
                      className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:border-emerald-500 outline-hidden"
                    />
                  </div>

                  {/* Things that will not be part of this shift if it closes now */}
                  {(pendingSyncCount > 0 || unfinishedCounter.cartLines > 0 || unfinishedCounter.parked > 0) && (
                    <div role="status" className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200 space-y-0.5">
                      {unfinishedCounter.cartLines > 0 && <p>Cart mein {unfinishedCounter.cartLines} item hain — pehle bill karein ya cart khali karein.</p>}
                      {unfinishedCounter.parked > 0 && <p>{unfinishedCounter.parked} parked bill hain — ye is shift ki sale mein nahi ginay jayenge.</p>}
                      {pendingSyncCount > 0 && <p>{pendingSyncCount} entry abhi server par nahi gayi. Internet check karein.</p>}
                    </div>
                  )}

                  {/* Submit Button */}
                  {closeBlocker && hasCount && (
                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{closeBlocker}</p>
                  )}
                  <button
                    type="button"
                    // A count of 0 is allowed once it is typed (an honest empty drawer); a blank field is not a count.
                    disabled={isClosing || Boolean(closeBlocker)}
                    onClick={handleCloseShift}
                    className="w-full py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-black text-sm shadow-md shadow-emerald-500/15 transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
                  >
                    <LockKeyhole size={18} />
                    <span>
                      {isClosing ? 'Closing Shift...' : 'Close Shift & Submit Cash'}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="p-3 sm:p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-center justify-between gap-3 shrink-0 text-xs">
            <span className="text-[11px] text-slate-400">
              Cash handovers stay pending until head office accepts them.
            </span>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 px-4 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold transition-colors cursor-pointer"
            >
              Close Window
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Denomination Counter Dialog (Closing Cash Only) */}
      <DenominationDialog
        open={isClosingDenomOpen}
        onClose={() => setIsClosingDenomOpen(false)}
        value={closingDenominations}
        onChange={setClosingDenominations}
        onApply={total => {
          setCountedCash(String(total));
        }}
        title="Closing Cash Denominations"
        subtitle="Enter physical count for closing cash"
      />

      {/* Opening Cash Denomination Counter */}
      <DenominationDialog
        open={isOpeningDenomOpen}
        onClose={() => setIsOpeningDenomOpen(false)}
        value={openingDenominations}
        onChange={setOpeningDenominations}
        onApply={total => {
          setOpeningCashInput(String(total));
        }}
        title="Opening Cash Denominations"
        subtitle="Drawer ke notes gin kar likhein"
      />

      {/* Interactive Shift Activity & Breakdown Dialog (Bills, Sales, Collections, Expenses) */}
      <PosShiftActivityDialog
        isOpen={Boolean(detailModalTab)}
        onClose={() => {
          setDetailModalTab(null);
          setDetailModalCategory(undefined);
        }}
        activeTab={detailModalTab || 'expenses'}
        onSelectTab={setDetailModalTab}
        initialCategory={detailModalCategory}
        shiftTotals={shiftTotals}
        shiftInfo={{
          drawerName: activeShiftSession?.account_name || activeShiftSession?.drawer_name,
          shiftName: activeShiftSession?.shift_name,
          startedAt: activeShiftSession?.started_at
        }}
        canDelete={canDeleteVendorTx}
        onDeleteVendorTx={deleteExpenseVendorTransaction}
      />
    </>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};

export default PosShiftModal;
