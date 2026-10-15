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

interface PosShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const QUICK_DIFFERENCE_REASONS = [
  'Counting error',
  'Change discrepancy',
  'Unrecorded petty expense',
  'Incorrect change given',
  'Other'
];

export const PosShiftModal: React.FC<PosShiftModalProps> = ({ isOpen, onClose }) => {
  const {
    currentUser,
    currentRole,
    activeShiftSession,
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

  useEffect(() => {
    setOpeningCashInput('');
    setIsEditingOpening(false);
  }, [activeAccount?.id, pendingHandover?.id]);

  const openingAmount = useMemo(() => {
    if (isEditingOpening && openingCashInput.trim() !== '') {
      const parsed = Number(openingCashInput);
      return isNaN(parsed) || parsed < 0 ? 0 : parsed;
    }
    return defaultOpeningAmount;
  }, [isEditingOpening, openingCashInput, defaultOpeningAmount]);

  // --- Close Shift State ---
  const [countedCash, setCountedCash] = useState<string>('');
  const [leaveInDrawer, setLeaveInDrawer] = useState<string>('');
  const [closingDenominations, setClosingDenominations] = useState<Record<string | number, number>>({});
  const [isClosingDenomOpen, setIsClosingDenomOpen] = useState(false);
  const [differenceReason, setDifferenceReason] = useState<string>('');
  const [closeNotes, setCloseNotes] = useState<string>('');
  const [isClosing, setIsClosing] = useState(false);
  const [detailModalTab, setDetailModalTab] = useState<ShiftActivityTab | null>(null);
  const [detailModalCategory, setDetailModalCategory] = useState<string | undefined>(undefined);
  const openDetailDialog = (tab: ShiftActivityTab, category?: string) => {
    setDetailModalCategory(category);
    setDetailModalTab(tab);
  };

  // Initialize Close Shift inputs when shift becomes active
  useEffect(() => {
    if (activeShiftSession) {
      const drawer = cashDrawers.find(d => d.id === activeShiftSession.drawer_id)
        || accounts.find(a => a.id === activeShiftSession.drawer_id || a.id === activeShiftSession.account_id);
      const defaultLeave = (drawer as any)?.default_float ? Number((drawer as any).default_float) : 5000;
      setLeaveInDrawer(String(defaultLeave));
      setCountedCash('');
      setClosingDenominations({});
      setDifferenceReason('');
      setCloseNotes('');
    }
  }, [activeShiftSession, cashDrawers, accounts]);

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
  const effectiveCountedCash = closingDenomTotal > 0 ? closingDenomTotal : Number(countedCash || 0);
  const effectiveLeaveInDrawer = Math.max(0, Number(leaveInDrawer || 0));
  const effectiveRemitToHead = Math.max(0, effectiveCountedCash - effectiveLeaveInDrawer);

  // Variance calculation
  const variance = useMemo(() => {
    if (!activeShiftSession) return 0;
    return effectiveCountedCash - shiftTotals.expectedCash;
  }, [activeShiftSession, effectiveCountedCash, shiftTotals.expectedCash]);

  const hasVariance = Math.abs(variance) >= 0.01;

  if (!isOpen) return null;

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

    if (effectiveCountedCash <= 0 && !countedCash.trim()) {
      showToast('Please enter the closing counted cash amount.', 'warning');
      return;
    }

    if (hasVariance && !differenceReason.trim()) {
      showToast('A difference reason is required when counted cash does not match expected cash.', 'warning');
      return;
    }

    if (effectiveCountedCash < effectiveLeaveInDrawer) {
      showToast('Counted cash cannot be less than the amount left in drawer.', 'warning');
      return;
    }

    setIsClosing(true);
    try {
      const ok = await closeCashierShift({
        countedCash: effectiveCountedCash,
        leaveInDrawer: effectiveLeaveInDrawer,
        remitToHead: effectiveRemitToHead,
        denominations: {
          closing: closingDenominations,
          leave_in_drawer: splitDenominations(closingDenominations, effectiveLeaveInDrawer),
          remit_to_head: splitDenominations(closingDenominations, effectiveRemitToHead)
        },
        differenceReason: differenceReason.trim(),
        notes: closeNotes.trim()
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
                                setOpeningCashInput(String(defaultOpeningAmount));
                                setIsEditingOpening(true);
                              }}
                              className="text-xs font-bold text-lime-700 dark:text-lime-400 hover:underline px-2 py-1 cursor-pointer"
                            >
                              Edit Counted Float
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="mt-3 max-w-xs mx-auto space-y-2">
                          <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
                            Physical Counted Opening Cash (Rs)
                          </label>
                          <div className="relative">
                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono font-bold text-slate-400 text-sm z-10 pointer-events-none">Rs</span>
                            <SmartNumberInput
                              min="0"
                              step="1"
                              value={openingCashInput}
                              onChange={val => setOpeningCashInput(val)}
                              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-lime-400 dark:border-lime-500/60 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold text-lg text-center outline-none focus:ring-2 focus:ring-lime-500/30"
                              autoFocus
                            />
                          </div>
                          <div className="flex items-center justify-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                setOpeningCashInput('');
                                setIsEditingOpening(false);
                              }}
                              className="text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 px-3 py-1 cursor-pointer"
                            >
                              Reset to Live Balance ({money(defaultOpeningAmount)})
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Single 1-Click Action Button */}
                    <button
                      type="button"
                      disabled={isStarting || !activeAccount}
                      onClick={handleStartShift}
                      className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl bg-lime-500 hover:bg-lime-400 active:scale-[0.99] text-slate-950 font-black text-sm shadow-lg shadow-lime-500/25 transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none mt-2"
                    >
                      <CheckCircle2 size={18} />
                      <span>{isStarting ? 'Starting Shift...' : 'Start Shift'}</span>
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
                        <button
                          type="button"
                          onClick={() => {
                            setCountedCash(String(shiftTotals.expectedCash));
                            setClosingDenominations({});
                          }}
                          className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-slate-200/80 dark:bg-slate-700 hover:bg-slate-300 text-slate-700 dark:text-slate-200 cursor-pointer"
                        >
                          Use expected
                        </button>
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
                        value={leaveInDrawer}
                        onChange={val => setLeaveInDrawer(val)}
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-bold text-slate-900 dark:text-white focus:border-emerald-500 outline-hidden"
                        placeholder="5000"
                      />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      This amount will remain in the drawer as the opening float for the next shift.
                    </p>
                    {(countedCash.trim() !== '' || closingDenomTotal > 0) && effectiveCountedCash < effectiveLeaveInDrawer && (
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

                  {effectiveRemitToHead > 0 && (
                    <p className="text-[11px] font-bold text-violet-600 dark:text-violet-400 flex items-start gap-1.5">
                      <Info size={13} className="shrink-0 mt-0.5" />
                      <span>
                        Sent to head office when you close. Pending until they accept it.
                      </span>
                    </p>
                  )}

                  {/* Variance Indicator & Difference Reason */}
                  {(countedCash.trim() !== '' || closingDenomTotal > 0) && (
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
                              placeholder="Reason for cash difference..."
                              className="w-full px-3 py-2 text-xs rounded-lg border border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:border-rose-500 outline-hidden"
                            />
                            
                            {/* Quick reason suggestions */}
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {QUICK_DIFFERENCE_REASONS.map((r, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => setDifferenceReason(r)}
                                  className="text-[10px] px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800/60 text-slate-700 dark:text-slate-300 hover:border-rose-400 cursor-pointer"
                                >
                                  {r}
                                </button>
                              ))}
                            </div>
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

                  {/* Submit Button */}
                  <button
                    type="button"
                    disabled={isClosing || effectiveCountedCash <= 0 || effectiveCountedCash < effectiveLeaveInDrawer || (hasVariance && !differenceReason.trim())}
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
