import React, { Suspense, lazy, useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
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
  PencilLine,
  RotateCcw,
  WifiOff,
} from 'lucide-react';
import {
  DenominationDialog,
  DENOMINATIONS,
  splitDenominations,
  money
} from './DenominationDialog';
import type { ShiftActivityTab } from './PosShiftActivityDialog';
import { SmartNumberInput, type SmartNumberInputProps } from './SmartNumberInput';
import { ShiftCashFlow } from './ShiftCashFlow';
import { confirmAction } from './ui/ConfirmDialog';
import { Badge, Button, Card, Field, IconButton, Input, Label, Money, Select, controlClass } from './ui';
import { cn } from '../lib/cn';
import { syncService } from '../lib/syncService';
import { evaluateMathExpression } from '../lib/mathEvaluator';

// Opened on demand from the cash-flow panel, so it stays out of this dialog's chunk. It is
// prefetched as soon as a shift is open here, and a failed fetch is retried once.
const loadActivityDialog = () => import('./PosShiftActivityDialog');
const retryOnce = <T,>(load: () => Promise<T>) => () => load().catch(() => new Promise<T>((resolve, reject) => {
  window.setTimeout(() => { load().then(resolve, reject); }, 800);
}));
const PosShiftActivityDialog = lazy(() =>
  retryOnce(loadActivityDialog)().then(module => ({ default: module.PosShiftActivityDialog }))
);

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
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const CHIP =
  'inline-flex h-10 cursor-pointer items-center rounded-full border px-3.5 text-xs font-semibold transition-colors duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Typed cash ("5000", "5,000", "5000+3260") as a number, or null when it is not a valid amount of 0 or more. */
const parseCashAmount = (raw: string): number | null => {
  const parsed = evaluateMathExpression(raw)?.result;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const subscribeOnline = (callback: () => void) => {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
};
const readOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

/** Cash amount field: "Rs" prefix, big tabular figures, sums like 5000+3260 still work. */
function CashInput({ inputSize = 'md', className, ...props }: SmartNumberInputProps & { inputSize?: 'md' | 'lg' }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-xs font-bold text-fg-subtle">Rs</span>
      <SmartNumberInput
        {...props}
        className={cn(controlClass, inputSize === 'lg' ? 'h-12 text-lg' : 'h-11 text-base', 'pl-10 pr-3 font-bold tabular-nums', className)}
      />
    </div>
  );
}

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
  const online = useSyncExternalStore(subscribeOnline, readOnline, () => true);

  const canDeleteVendorTx = canPerform('expenses', 'delete') || currentUser?.role_id === 'role_super_admin' || currentRole?.name === 'Super Admin' || currentRole?.name === 'Admin';

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
  // State updates land a render later; refs stop a fast double click from starting or closing twice.
  const startingRef = useRef(false);
  const closingRef = useRef(false);

  const pendingHandover = useMemo(() => {
    if (!activeAccount) return undefined;
    return cashHandovers.find(h => (h.drawer_id === activeAccount.id || (cashDrawers.find(d => d.id === h.drawer_id)?.account_id === activeAccount.id)) && h.status === 'Pending');
  }, [activeAccount, cashHandovers, cashDrawers]);

  // An active shift on this drawer from today
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

  // The note-count dialogs edit their counts live. Cancel must put the old counts back, otherwise
  // the abandoned counts silently override the typed amount (closing) or are saved against a
  // different opening amount (opening).
  const denomSnapshotRef = useRef<Record<string | number, number>>({});
  const denomAppliedRef = useRef(false);
  const openOpeningDenom = () => {
    denomSnapshotRef.current = openingDenominations;
    denomAppliedRef.current = false;
    setIsOpeningDenomOpen(true);
  };
  const openClosingDenom = () => {
    denomSnapshotRef.current = closingDenominations;
    denomAppliedRef.current = false;
    setIsClosingDenomOpen(true);
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
  const activeShiftId = activeShiftSession?.id;
  useEffect(() => {
    setLeaveInDrawer('');
    setLeaveTouched(false);
    setCountedCash('');
    setClosingDenominations({});
    setDifferenceReason('');
    setCloseNotes('');
  }, [activeShiftId]);

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
    if (!isOpen || !activeShiftId) return;
    return syncService.subscribe(state => setPendingSyncCount(state.pendingCount + state.failedCount));
  }, [isOpen, activeShiftId]);
  useEffect(() => {
    if (isOpen && activeShiftId) void loadActivityDialog().catch(() => {});
  }, [isOpen, activeShiftId]);
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

    // If the itemized list is empty, fall back to cash_purchases
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
  // A typo ("5000abc", "-500") would otherwise become NaN, which slips past every check and closes as "count matches".
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

  const reasonInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const busy = isStarting || isClosing;
  const requestClose = () => {
    // Leaving while the shift is being started or closed hides the result of a money action.
    if (startingRef.current || closingRef.current) return;
    onClose();
  };

  // Move focus into the dialog when it opens and give it back to the opener when it closes.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => panelRef.current?.focus({ preventScroll: true }), 0);
    return () => {
      window.clearTimeout(timer);
      if (previous && previous !== document.body && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [isOpen]);

  // A dialog on top (note count, activity, confirm) owns its own Escape. Capture phase, so the POS
  // page's Escape handler behind this dialog cannot close it while a shift is being started or closed.
  useEffect(() => {
    if (!isOpen || isClosingDenomOpen || isOpeningDenomOpen || Boolean(detailModalTab)) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[data-app-modal="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      if (startingRef.current || closingRef.current) return;
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, isClosingDenomOpen, isOpeningDenomOpen, detailModalTab, onClose]);

  // Keep Tab inside the dialog (aria-modal). Dialogs stacked on top are portals outside this panel.
  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const nodes = (Array.from(panelRef.current.querySelectorAll(FOCUSABLE)) as HTMLElement[]).filter(node => node.getClientRects().length > 0);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const handleStartShift = async () => {
    if (startingRef.current) return;
    if (!activeAccount) {
      showToast('No drawer-enabled Cash account found. Please enable a Cash account as a drawer in Bank & Cash.', 'error');
      return;
    }

    startingRef.current = true;
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
      startingRef.current = false;
      setIsStarting(false);
    }
  };

  const handleCloseShift = async () => {
    if (!activeShiftSession || closingRef.current) return;

    if (closeBlocker) {
      showToast(closeBlocker, 'warning');
      return;
    }

    closingRef.current = true;
    try {
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
      closingRef.current = false;
      setIsClosing(false);
    }
  };

  const formattedStartTime = activeShiftSession?.started_at
    ? new Date(activeShiftSession.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : activeShiftSession?.start_time || '—';

  if (!isOpen) return null;

  const isActive = Boolean(activeShiftSession);
  const openingInputInvalid = isEditingOpening && (openingCashInput.trim() === '' || parseCashAmount(openingCashInput) === null);
  const openingDifference = openingAmount - defaultOpeningAmount;
  const showStartButton = !isActive && cashAccounts.length > 0;
  const startLabel = drawerActiveShift
    ? 'Close Active Shift First'
    : isStarting
      ? 'Starting Shift...'
      : isEditingOpening
        ? (openingCashInput.trim() === '' ? 'Gini hui cash likhein' : `Start Shift with ${money(openingAmount)}`)
        : `Cash ${money(openingAmount)} theek hai — Start Shift`;
  const varianceShort = variance < 0;

  const modalContent = (
    <>
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150">
        <div className="absolute inset-0 bg-slate-950/50" aria-hidden="true" onClick={requestClose} />

        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="shift-dialog-title"
          aria-busy={busy || undefined}
          tabIndex={-1}
          onKeyDown={handlePanelKeyDown}
          className={cn(
            'relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-e3 outline-none animate-in zoom-in-95 duration-200',
            isActive ? 'max-w-6xl' : 'max-w-2xl'
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-control [&_svg]:size-5',
                  isActive ? 'bg-success-soft text-success-fg' : 'bg-warning-soft text-warning-fg'
                )}
                aria-hidden="true"
              >
                {isActive ? <Store /> : <LogIn />}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="shift-dialog-title" className="text-base font-bold tracking-tight text-fg sm:text-lg">
                    {isActive ? 'Shift cash & handover' : 'Start Shift'}
                  </h2>
                  <Badge tone={isActive ? 'success' : 'warning'} dot>
                    {isActive ? 'Active Shift' : 'Not Started'}
                  </Badge>
                  {!online && <Badge tone="warning" icon={<WifiOff />}>Offline</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  {isActive
                    ? 'Review cash movement, count your drawer and hand over.'
                    : 'Review opening float to start your session'}
                </p>
              </div>
            </div>

            <IconButton aria-label="Close shift dialog" icon={<X />} onClick={requestClose} disabled={busy} className="-mr-1 shrink-0" />
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-canvas p-3 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-fg-muted">
                <User size={15} className="shrink-0 text-fg-faint" aria-hidden="true" />
                <span>Cashier: <strong className="font-bold text-fg">{currentUser?.name || 'Cashier'}</strong> ({currentRole?.name || 'Staff'})</span>
                {activeShiftSession && activeShiftSession.user_id !== currentUser?.id && (
                  <Badge tone="warning" className="max-w-full"><span className="truncate">Shift of {activeShiftSession.user_name || 'another cashier'}</span></Badge>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold tabular-nums text-fg-subtle">
                <Calendar size={13} className="text-fg-faint" aria-hidden="true" />
                <span>{currentBizDate}</span>
              </div>
            </div>

            {!online && (
              <div role="status" className="flex items-start gap-2.5 rounded-control border border-warning/30 bg-warning-soft px-3.5 py-3 text-xs font-medium text-warning-fg">
                <WifiOff size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>Internet nahi hai. Shift start ya close karne ke liye internet zaroori hai.</span>
              </div>
            )}

            {!isActive && (
              <div className="mx-auto max-w-xl space-y-4">
                {cashAccounts.length === 0 ? (
                  <div role="alert" className="rounded-card border border-warning/30 bg-warning-soft p-5 text-center text-warning-fg">
                    <AlertTriangle className="mx-auto mb-2" size={24} aria-hidden="true" />
                    <p className="text-sm font-semibold">
                      No drawer-enabled Cash account found. Please enable a Cash account as a drawer in Bank &amp; Cash (Bank and digital wallet accounts cannot be used as cash drawers).
                    </p>
                  </div>
                ) : (
                  <>
                    {cashAccounts.length > 1 && (
                      <Field label="Select Cash Drawer / Account (Bank & Cash)">
                        {control => (
                          <Select {...control} value={activeAccount?.id || ''} onChange={e => setSelectedAccountId(e.target.value)} disabled={isStarting}>
                            {cashAccounts.map(acc => (
                              <option key={acc.id} value={acc.id}>
                                {acc.name} · Live Balance: {money(acc.balance)}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    )}

                    <Card className="px-5 py-6 text-center sm:px-7 sm:py-7">
                      <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-control bg-brand-soft text-brand-fg" aria-hidden="true">
                        <Wallet size={24} />
                      </span>

                      <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                        Opening Cash {activeAccount ? `· ${activeAccount.name}` : ''}
                      </p>

                      {!isEditingOpening ? (
                        <>
                          <Money amount={openingAmount} className="mt-1.5 block text-4xl font-bold leading-tight tracking-tight text-fg sm:text-[44px]" />

                          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                            <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-fg-muted ring-1 ring-inset ring-line">
                              <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
                              {pendingHandover ? (
                                <span className="min-w-0">Handover from {pendingHandover.from_user_name || 'Previous Cashier'}</span>
                              ) : (
                                <span className="min-w-0 tabular-nums">Live Drawer Balance: {money(activeAccount?.balance || 0)}</span>
                              )}
                            </span>
                            <Button
                              variant="ghost"
                              leftIcon={<PencilLine />}
                              className="text-brand-fg hover:text-brand-fg"
                              onClick={() => {
                                setOpeningCashInput('');
                                setOpeningDenominations({});
                                setIsEditingOpening(true);
                              }}
                            >
                              Cash alag hai? Gin kar likhein
                            </Button>
                          </div>
                          <p className="mx-auto mt-3 max-w-md text-xs text-fg-subtle">
                            Shift start karne se pehle drawer ki cash gin lein. Raqam alag ho to upar se likhein — farq manager ke review mein jayega.
                          </p>
                        </>
                      ) : (
                        <div className="mx-auto mt-3 max-w-xs space-y-3 text-left">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Label htmlFor="shift-opening-cash" className="mb-0">
                              Drawer mein gini hui cash (Rs)
                            </Label>
                            <Button variant="soft" leftIcon={<Banknote />} onClick={openOpeningDenom}>
                              Count notes
                            </Button>
                          </div>
                          <CashInput
                            id="shift-opening-cash"
                            inputSize="lg"
                            min="0"
                            step="1"
                            value={openingCashInput}
                            placeholder={String(defaultOpeningAmount)}
                            aria-invalid={openingCashInput.trim() !== '' && parseCashAmount(openingCashInput) === null ? true : undefined}
                            onChange={val => {
                              setOpeningCashInput(val);
                              setOpeningDenominations({});
                            }}
                            className="text-center"
                            autoFocus
                          />
                          {openingCashInput.trim() !== '' && Math.abs(openingDifference) >= 0.01 && (
                            <p role="status" className="text-center text-xs font-semibold text-warning-fg">
                              {openingDifference < 0 ? 'Kami' : 'Zyada'} {money(Math.abs(openingDifference))} — manager review ke liye record hoga.
                            </p>
                          )}
                          <div className="flex justify-center">
                            <Button
                              variant="ghost"
                              leftIcon={<RotateCcw />}
                              onClick={() => {
                                setOpeningCashInput('');
                                setOpeningDenominations({});
                                setIsEditingOpening(false);
                              }}
                            >
                              Wapas {money(defaultOpeningAmount)} rakhein
                            </Button>
                          </div>
                        </div>
                      )}
                    </Card>

                    {drawerActiveShift && (
                      <div role="alert" className="flex items-start gap-2.5 rounded-card border border-warning/30 bg-warning-soft p-4 text-warning-fg">
                        <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                        <div>
                          <p className="text-sm font-bold">Drawer has an unclosed active shift</p>
                          <p className="mt-0.5 text-xs">
                            Started by <strong>{drawerActiveShift.user_name || 'Cashier'}</strong> ({drawerActiveShift.business_date || 'earlier session'}). A new shift cannot be started on this drawer until the active shift is closed.
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {activeShiftSession && (
              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-5">
                <ShiftCashFlow
                  drawerName={activeShiftSession.account_name || accounts.find(a => a.id === activeShiftSession.drawer_id || a.id === activeShiftSession.account_id)?.name || activeShiftSession.drawer_name || 'Cash Drawer'}
                  startedAt={formattedStartTime}
                  data={waterfallData}
                  onDetails={openDetailDialog}
                />

                <Card className="space-y-4 p-4 sm:p-5 lg:sticky lg:top-0">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-9 items-center justify-center rounded-control bg-surface-2 text-fg-muted" aria-hidden="true">
                      <LogOut size={17} />
                    </span>
                    <h3 className="text-[15px] font-bold tracking-tight text-fg">Count & hand over</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Card variant="inset" className="rounded-control px-3 py-2.5">
                      <p className="text-[11px] font-semibold text-fg-subtle">Expected cash</p>
                      <Money amount={shiftTotals.expectedCash} className="mt-0.5 block text-xl font-bold tracking-tight text-fg" />
                    </Card>
                    <Card variant="inset" className="rounded-control px-3 py-2.5">
                      <p className="text-[11px] font-semibold text-fg-subtle">Total counted</p>
                      {hasCount
                        ? <Money amount={effectiveCountedCash} className="mt-0.5 block text-xl font-bold tracking-tight text-fg" />
                        : <span className="mt-0.5 block text-xl font-bold text-fg-faint">—</span>}
                    </Card>
                  </div>

                  <div>
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="shift-counted-cash" className="mb-0">1. Count your physical cash</Label>
                      {/* No "use expected" shortcut: the close is only worth something when the cash is really counted. */}
                      <Button variant="soft" leftIcon={<Banknote />} onClick={openClosingDenom} disabled={isClosing}>
                        Count notes
                      </Button>
                    </div>
                    <CashInput
                      id="shift-counted-cash"
                      inputSize="lg"
                      min="0"
                      value={countedCash}
                      disabled={isClosing}
                      aria-invalid={countInvalid ? true : undefined}
                      onChange={val => {
                        setCountedCash(val);
                        setClosingDenominations({});
                      }}
                      placeholder="Enter amount or 5000+3260"
                    />
                  </div>

                  {hasCount && (!hasVariance ? (
                    <div role="status" className="flex items-center gap-2 rounded-control border border-success/25 bg-success-soft px-3 py-2.5 text-xs font-semibold text-success-fg">
                      <CheckCircle2 size={16} className="shrink-0" aria-hidden="true" />
                      <span>Cash count matches the expected balance.</span>
                    </div>
                  ) : (
                    <div className={cn('space-y-3 rounded-control border p-3', varianceShort ? 'border-danger/25 bg-danger-soft' : 'border-warning/30 bg-warning-soft')}>
                      <div className={cn('flex items-center justify-between gap-2 text-sm font-bold', varianceShort ? 'text-danger-fg' : 'text-warning-fg')}>
                        <span className="flex items-center gap-1.5">
                          <AlertCircle size={16} aria-hidden="true" />
                          {varianceShort ? 'Cash Shortage' : 'Cash Surplus'}
                        </span>
                        <span className="text-lg tabular-nums">
                          {varianceShort ? '-' : '+'}<Money amount={Math.abs(variance)} />
                        </span>
                      </div>

                      <Field
                        label="Difference reason"
                        required
                        error={differenceReason.trim() !== '' && !reasonOk ? 'Wajah thori wazeh likhein — sirf "Other" kaafi nahi.' : undefined}
                      >
                        {control => (
                          <Input
                            {...control}
                            ref={reasonInputRef}
                            value={differenceReason}
                            disabled={isClosing}
                            onChange={e => setDifferenceReason(e.target.value)}
                            placeholder="Kya hua? e.g. Rs 500 ka khula galat diya"
                          />
                        )}
                      </Field>

                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick reasons">
                        {QUICK_DIFFERENCE_REASONS.map(r => {
                          const selected = differenceReason === r;
                          return (
                            <button
                              key={r}
                              type="button"
                              aria-pressed={selected}
                              disabled={isClosing}
                              onClick={() => setDifferenceReason(r)}
                              className={cn(CHIP, selected ? 'border-brand/30 bg-brand-soft text-brand-fg' : 'border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg')}
                            >
                              {r}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          disabled={isClosing}
                          onClick={() => {
                            setDifferenceReason('');
                            reasonInputRef.current?.focus();
                          }}
                          className={cn(CHIP, 'border-dashed border-line-strong bg-surface text-fg-muted hover:text-fg')}
                        >
                          Other — likhein
                        </button>
                      </div>

                      {canApproveOwnDifference && (
                        <label className={cn('flex cursor-pointer items-start gap-2.5 text-xs', varianceShort ? 'text-danger-fg' : 'text-warning-fg')}>
                          <input
                            type="checkbox"
                            checked={approveDifferenceNow}
                            disabled={isClosing}
                            onChange={e => setApproveDifferenceNow(e.target.checked)}
                            className="mt-0.5 size-4 shrink-0 accent-[rgb(var(--brand))]"
                          />
                          <span>Farq abhi approve karein (aap owner hain). Warna Audit Trail mein review ke liye pending rahega aur din close nahi hoga.</span>
                        </label>
                      )}
                    </div>
                  ))}

                  <div>
                    <Label htmlFor="shift-leave-cash">2. Keep for the next shift</Label>
                    <CashInput
                      id="shift-leave-cash"
                      min="0"
                      disabled={isClosing}
                      value={leaveTouched ? leaveInDrawer : String(effectiveLeaveInDrawer)}
                      aria-invalid={leaveInvalid || (hasCount && effectiveCountedCash < effectiveLeaveInDrawer) ? true : undefined}
                      onChange={val => {
                        setLeaveTouched(true);
                        setLeaveInDrawer(val);
                      }}
                      placeholder={String(defaultLeave)}
                    />
                    <p className="mt-1.5 text-xs text-fg-subtle">
                      This stays in the drawer as the next shift's opening cash{leaveTouched ? '' : ` (default ${money(defaultLeave)})`}.
                    </p>
                    {hasCount && effectiveCountedCash < effectiveLeaveInDrawer && (
                      <p role="alert" className="mt-1.5 text-xs font-semibold text-danger-fg">Keep an amount equal to or below your counted cash.</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Card variant="inset" className="rounded-control px-3 py-2.5">
                      <p className="text-[11px] font-semibold text-fg-subtle">Drawer float</p>
                      <Money amount={effectiveLeaveInDrawer} className="mt-0.5 block text-base font-bold text-fg-muted" />
                    </Card>
                    <div className="rounded-control border border-brand/25 bg-brand-soft px-3 py-2.5">
                      <p className="text-[11px] font-semibold text-brand-fg">To head office</p>
                      {hasCount
                        ? <Money amount={effectiveRemitToHead} className="mt-0.5 block text-base font-bold text-brand-fg" />
                        : <span className="mt-0.5 block text-base font-bold text-brand-fg/60">—</span>}
                    </div>
                  </div>

                  {effectiveRemitToHead > 0 && (isHead ? (
                    <Field
                      label={`3. Receive ${money(effectiveRemitToHead)} into`}
                      hint={effectiveReceiveAccountId
                        ? 'Aap head hain — cash close ke sath hi is account mein aa jayegi.'
                        : 'Cash "in transit" rahegi jab tak Cash Control → Head Inbox se accept na ho.'}
                    >
                      {control => (
                        <Select {...control} value={effectiveReceiveAccountId || 'inbox'} disabled={isClosing} onChange={e => setReceiveAccountId(e.target.value)}>
                          {receivingAccounts.map(acc => (
                            <option key={acc.id} value={acc.id}>{acc.name} ({acc.type})</option>
                          ))}
                          <option value="inbox">Keep pending in Head Inbox</option>
                        </Select>
                      )}
                    </Field>
                  ) : (
                    <p className="flex items-start gap-1.5 text-xs font-semibold text-info-fg">
                      <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>Sent to head office when you close. Pending until they accept it.</span>
                    </p>
                  ))}

                  <Field label="Notes (Optional)">
                    {control => (
                      <Input
                        {...control}
                        value={closeNotes}
                        disabled={isClosing}
                        onChange={e => setCloseNotes(e.target.value)}
                        placeholder="Any additional notes..."
                      />
                    )}
                  </Field>

                  {/* Things that will not be part of this shift if it closes now */}
                  {(pendingSyncCount > 0 || unfinishedCounter.cartLines > 0 || unfinishedCounter.parked > 0) && (
                    <div role="status" className="space-y-1 rounded-control border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning-fg">
                      {unfinishedCounter.cartLines > 0 && <p>Cart mein {unfinishedCounter.cartLines} item hain — pehle bill karein ya cart khali karein.</p>}
                      {unfinishedCounter.parked > 0 && <p>{unfinishedCounter.parked} parked bill hain — ye is shift ki sale mein nahi ginay jayenge.</p>}
                      {pendingSyncCount > 0 && <p>{pendingSyncCount} entry abhi server par nahi gayi. Internet check karein.</p>}
                    </div>
                  )}
                </Card>
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-surface px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className={cn('min-w-0 text-xs', isActive && closeBlocker ? 'font-semibold text-fg-muted' : 'hidden text-fg-subtle sm:block')} aria-live="polite">
              {isActive && closeBlocker ? closeBlocker : 'Cash handovers stay pending until head office accepts them.'}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" size="lg" className="hidden sm:inline-flex" onClick={requestClose} disabled={busy}>
                Close Window
              </Button>
              {isActive ? (
                <Button
                  size="lg"
                  fullWidth
                  className="sm:w-auto"
                  leftIcon={<LockKeyhole />}
                  loading={isClosing}
                  // A count of 0 is allowed once it is typed (an honest empty drawer); a blank field is not a count.
                  disabled={Boolean(closeBlocker)}
                  onClick={handleCloseShift}
                >
                  {isClosing ? 'Closing Shift...' : 'Close Shift & Submit Cash'}
                </Button>
              ) : showStartButton ? (
                <Button
                  size="lg"
                  fullWidth
                  className="h-auto min-h-12 whitespace-normal py-2.5 text-center sm:w-auto"
                  leftIcon={<CheckCircle2 />}
                  loading={isStarting}
                  disabled={!activeAccount || Boolean(drawerActiveShift) || openingInputInvalid}
                  onClick={handleStartShift}
                >
                  {startLabel}
                </Button>
              ) : (
                <Button variant="secondary" size="lg" fullWidth className="sm:hidden" onClick={requestClose}>
                  Close Window
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <DenominationDialog
        open={isClosingDenomOpen}
        onClose={() => {
          if (!denomAppliedRef.current) setClosingDenominations(denomSnapshotRef.current);
          setIsClosingDenomOpen(false);
        }}
        value={closingDenominations}
        onChange={setClosingDenominations}
        onApply={total => {
          denomAppliedRef.current = true;
          setCountedCash(String(total));
        }}
        title="Closing Cash Denominations"
        subtitle="Enter physical count for closing cash"
      />

      <DenominationDialog
        open={isOpeningDenomOpen}
        onClose={() => {
          if (!denomAppliedRef.current) setOpeningDenominations(denomSnapshotRef.current);
          setIsOpeningDenomOpen(false);
        }}
        value={openingDenominations}
        onChange={setOpeningDenominations}
        onApply={total => {
          denomAppliedRef.current = true;
          setOpeningCashInput(String(total));
        }}
        title="Opening Cash Denominations"
        subtitle="Drawer ke notes gin kar likhein"
      />

      {detailModalTab && (
        <Suspense fallback={null}>
          <PosShiftActivityDialog
            isOpen
            onClose={() => {
              setDetailModalTab(null);
              setDetailModalCategory(undefined);
            }}
            activeTab={detailModalTab}
            onSelectTab={setDetailModalTab}
            initialCategory={detailModalCategory}
            shiftTotals={shiftTotals}
            canDelete={canDeleteVendorTx}
            onDeleteVendorTx={deleteExpenseVendorTransaction}
          />
        </Suspense>
      )}
    </>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
