import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  TrendingUp, Receipt, Zap, PauseCircle, User, Printer, Keyboard, 
  ChevronDown, Clock, ArrowRight, Wallet, CreditCard, RotateCcw
} from 'lucide-react';

interface PosHeaderAnalyticsProps {
  todaySummary: {
    totalRevenue: number;
    totalCount: number;
    cashTotal: number;
    onlineTotal: number;
    creditTotal: number;
    returnedTotal?: number;
    returnedCount?: number;
  };
  activeShiftSession: any;
  setIsShiftModalOpen: (open: boolean) => void;
  heldOrdersCount: number;
  setHeldOrdersModalOpen: (open: boolean) => void;
  currentUser: any;
  setIsUserSwitcherOpen: (open: boolean) => void;
  navigate: (path: string) => void;
  setShortcutsModalOpen: (open: boolean) => void;
  mobileTab: 'catalog' | 'cart';
  sales?: any[];
  onOpenReceipt?: (sale: any) => void;
}

import { isDateOnlyOrMidnight, formatCurrency } from '../../lib/formatters';

const formatRelativeTime = (dateStr?: string | Date): string => {
  if (!dateStr) return '';
  try {
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    if (isNaN(date.getTime())) return '';

    // If date string has no time or is a legacy midnight UTC artifact, do not compute misleading hours
    if (typeof dateStr === 'string' && isDateOnlyOrMidnight(dateStr)) {
      return 'Today';
    }

    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSec < 0) return 'Just now';
    if (diffSec < 45) return 'Just now';
    if (diffSec < 90) return '1m ago';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

const formatSaleProductsName = (items?: any[], defaultFallback = 'Sale'): string => {
  if (!items || !Array.isArray(items) || items.length === 0) return defaultFallback;

  if (items.length === 1) {
    const it = items[0];
    const name = it.name || 'Product';
    const variant = it.variantName ? ` (${it.variantName})` : '';
    const qty = it.qty !== undefined && Number(it.qty) !== 1 ? `${it.qty}x ` : '';
    return `${qty}${name}${variant}`.trim();
  }

  if (items.length === 2) {
    return `${items[0].name}, ${items[1].name}`;
  }

  return `${items[0].name} +${items.length - 1} more`;
};

export const PosHeaderAnalytics: React.FC<PosHeaderAnalyticsProps> = ({
  todaySummary,
  activeShiftSession,
  setIsShiftModalOpen,
  heldOrdersCount,
  setHeldOrdersModalOpen,
  currentUser,
  setIsUserSwitcherOpen,
  navigate,
  setShortcutsModalOpen,
  mobileTab,
  sales,
  onOpenReceipt
}) => {
  const [todayDropdownOpen, setTodayDropdownOpen] = useState(false);
  const [recentDropdownOpen, setRecentDropdownOpen] = useState(false);
  const todayDropdownRef = useRef<HTMLDivElement>(null);
  const recentDropdownRef = useRef<HTMLDivElement>(null);

  // Re-render every 25s so relative times stay current
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 25000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (todayDropdownRef.current && !todayDropdownRef.current.contains(e.target as Node)) {
        setTodayDropdownOpen(false);
      }
      if (recentDropdownRef.current && !recentDropdownRef.current.contains(e.target as Node)) {
        setRecentDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const recentSales = useMemo(() => {
    if (!sales || !Array.isArray(sales)) return [];
    return [...sales]
      .filter(s => s && (s.total !== undefined || s.total_amount !== undefined))
      .sort((a, b) => {
        const timeA = new Date(a.date || a.created_at || 0).getTime();
        const timeB = new Date(b.date || b.created_at || 0).getTime();
        return timeB - timeA;
      })
      .slice(0, 5);
  }, [sales]);

  const latestSale = recentSales[0];

  return (
    <div className={`${mobileTab === 'cart' ? 'hidden lg:flex' : 'flex'} bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl p-2 sm:px-3 sm:py-2 shadow-xs items-center justify-between gap-2.5 shrink-0 select-none relative z-30`}>
      
      <div className="flex items-center gap-2 flex-1 py-0.5 min-w-0">
        
        <div className="relative shrink-0" ref={todayDropdownRef}>
          <button
            type="button"
            onClick={() => {
              setTodayDropdownOpen(prev => !prev);
              setRecentDropdownOpen(false);
            }}
            className="flex items-center gap-2 px-2.5 py-1 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/80 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 rounded-lg text-xs transition-all shadow-xs cursor-pointer group"
            title="Click to view Cash / Online / Credit breakdown"
          >
            <div className="w-5 h-5 rounded-md bg-lime-500/10 dark:bg-lime-400/10 flex items-center justify-center text-lime-600 dark:text-lime-400 shrink-0">
              <TrendingUp size={13} />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">Today:</span>
              <span className="text-xs font-black font-mono text-slate-900 dark:text-slate-100">
                {formatCurrency(todaySummary.totalRevenue)}
              </span>
              <span className="text-[10px] font-mono px-1 py-0.2 bg-slate-200/70 dark:bg-slate-700/60 rounded text-slate-600 dark:text-slate-300 font-bold">
                {todaySummary.totalCount} bills
              </span>
            </div>
            <ChevronDown size={11} className={`text-slate-400 transition-transform ${todayDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {todayDropdownOpen && (
            <div className="absolute left-0 mt-1.5 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl z-50 p-2.5 animate-in fade-in zoom-in-95 duration-100">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-slate-800 px-1">
                <span className="text-xs font-black text-slate-800 dark:text-slate-100">Today's Inflow</span>
                <span className="text-[10px] font-mono text-slate-400 font-bold">{todaySummary.totalCount} Bills Total</span>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between items-center py-1.5 px-2 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40">
                  <span className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300 font-bold text-[11px]">
                    <Wallet size={12} /> Cash:
                  </span>
                  <strong className="font-mono text-slate-900 dark:text-slate-100 text-xs">{formatCurrency(todaySummary.cashTotal)}</strong>
                </div>
                <div className="flex justify-between items-center py-1.5 px-2 rounded-lg bg-sky-50/70 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/40">
                  <span className="flex items-center gap-1.5 text-sky-800 dark:text-sky-300 font-bold text-[11px]">
                    <CreditCard size={12} /> Online / Bank:
                  </span>
                  <strong className="font-mono text-slate-900 dark:text-slate-100 text-xs">{formatCurrency(todaySummary.onlineTotal)}</strong>
                </div>
                {todaySummary.creditTotal > 0 && (
                  <div className="flex justify-between items-center py-1.5 px-2 rounded-lg bg-purple-50/70 dark:bg-purple-950/30 border border-purple-100 dark:border-purple-900/40">
                    <span className="flex items-center gap-1.5 text-purple-800 dark:text-purple-300 font-bold text-[11px]">
                      <User size={12} /> Credit (Udhar):
                    </span>
                    <strong className="font-mono text-slate-900 dark:text-slate-100 text-xs">{formatCurrency(todaySummary.creditTotal)}</strong>
                  </div>
                )}
                {Boolean(todaySummary.returnedTotal && todaySummary.returnedTotal > 0) && (
                  <div className="flex justify-between items-center py-1.5 px-2 rounded-lg bg-rose-50/70 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/40 text-rose-700 dark:text-rose-300">
                    <span className="flex items-center gap-1.5 font-bold text-[11px]">
                      <RotateCcw size={12} /> Returns ({todaySummary.returnedCount}):
                    </span>
                    <strong className="font-mono text-xs">- {formatCurrency(todaySummary.returnedTotal)}</strong>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="relative shrink-0" ref={recentDropdownRef}>
          <button
            type="button"
            onClick={() => {
              setRecentDropdownOpen(prev => !prev);
              setTodayDropdownOpen(false);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all shadow-xs cursor-pointer select-none group ${
              recentDropdownOpen
                ? 'bg-lime-50 dark:bg-lime-950/40 border-lime-500/80 ring-2 ring-lime-500/20 text-slate-900 dark:text-white'
                : latestSale
                  ? 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/80 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700/80 hover:border-slate-300'
                  : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-400'
            }`}
            title="Click to open recent sales dropdown (Last 5 transactions)"
          >
            <Receipt size={13} className="text-lime-600 dark:text-lime-400 shrink-0" />
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">Last:</span>

            {latestSale ? (
              <div className="flex items-center gap-1.5">
                <span 
                  className="font-bold text-xs text-slate-900 dark:text-slate-100 truncate max-w-[120px] sm:max-w-[190px]"
                  title={latestSale.items?.map((i: any) => `${i.qty || 1}x ${i.name}${i.variantName ? ` (${i.variantName})` : ''}`).join(', ') || latestSale.bill_number}
                >
                  {formatSaleProductsName(latestSale.items, latestSale.bill_number || 'Sale')}
                </span>
                <span className="font-mono font-black text-xs text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(Number(latestSale.total || 0))}
                </span>
                <span className="text-[9px] px-1 py-0.2 rounded font-bold bg-slate-200/80 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300 uppercase">
                  {latestSale.payment_mode || 'Cash'}
                </span>
                {formatRelativeTime(latestSale.date || latestSale.created_at) && (
                  <span className="hidden md:inline-flex items-center gap-0.5 text-[10px] text-slate-400">
                    <Clock size={9} />
                    {formatRelativeTime(latestSale.date || latestSale.created_at)}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[11px] text-slate-400">None yet</span>
            )}

            <div className="flex items-center gap-0.5 ml-1 pl-1 border-l border-slate-200 dark:border-slate-700">
              <span className="text-[9px] font-mono px-1 py-0.2 bg-lime-100 dark:bg-lime-950/80 text-lime-800 dark:text-lime-300 rounded font-bold">
                5
              </span>
              <ChevronDown size={12} className={`text-slate-400 transition-transform ${recentDropdownOpen ? 'rotate-180 text-lime-600' : 'group-hover:text-slate-600'}`} />
            </div>
          </button>

          {recentDropdownOpen && (
            <div className="absolute left-0 mt-1.5 w-84 sm:w-[420px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-50 p-2.5 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-slate-800 px-1">
                <div className="flex items-center gap-1.5 text-xs font-black text-slate-800 dark:text-slate-100">
                  <Receipt size={14} className="text-lime-600 dark:text-lime-400" />
                  <span>Recent Sales (آخری 5 بل)</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-lime-100 dark:bg-lime-950/60 text-lime-800 dark:text-lime-300 font-mono">
                    {recentSales.length} of 5
                  </span>
                </div>
                <button 
                  type="button" 
                  onClick={() => { setRecentDropdownOpen(false); navigate('/sales-history'); }}
                  className="flex items-center gap-1 text-[11px] font-bold text-lime-700 dark:text-lime-400 hover:text-lime-800 hover:underline cursor-pointer"
                >
                  <span>All Sales</span>
                  <ArrowRight size={11} />
                </button>
              </div>

              {recentSales.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400 font-medium">
                  No sales recorded yet today
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[360px] overflow-y-auto pr-0.5">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1 pb-0.5 flex items-center justify-between">
                    <span>Click any sale to open & reprint bill:</span>
                    <span className="text-[9px] text-lime-600 font-semibold lowercase">click to open</span>
                  </div>
                  {recentSales.map((sale, idx) => {
                    const isLatest = idx === 0;
                    const billNo = sale.bill_number || sale.invoice_no || sale.id?.slice(-6) || 'INV';
                    const customerName = sale.customer_name || 'Walk-in Customer';
                    const totalAmt = Number(sale.total ?? sale.total_amount ?? 0);
                    const mode = sale.payment_mode || sale.payment_method || 'Cash';
                    const isReturned = sale.status === 'Returned';
                    const relativeTime = formatRelativeTime(sale.date || sale.created_at);

                    return (
                      <div
                        key={sale.id || idx}
                        onClick={() => {
                          setRecentDropdownOpen(false);
                          if (onOpenReceipt) onOpenReceipt(sale);
                        }}
                        className={`flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer group active:scale-[0.99] ${
                          isLatest
                            ? 'bg-lime-50/70 hover:bg-lime-100 dark:bg-lime-950/30 dark:hover:bg-lime-950/60 border-lime-200 dark:border-lime-800/80 shadow-2xs hover:border-lime-400'
                            : 'bg-slate-50/80 hover:bg-white dark:bg-slate-800/60 dark:hover:bg-slate-800 border-slate-200/80 dark:border-slate-800 hover:border-lime-300 dark:hover:border-lime-700 shadow-2xs'
                        }`}
                        title="Click to open receipt and print"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                          <div className="flex flex-col items-center justify-center shrink-0">
                            {isLatest ? (
                              <span className="flex items-center gap-1 text-[9px] font-black uppercase text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950 px-1.5 py-0.5 rounded-md border border-emerald-300 dark:border-emerald-700">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                #1 Latest
                              </span>
                            ) : (
                              <span className="w-6 h-6 rounded-md bg-slate-200/70 dark:bg-slate-800 flex items-center justify-center text-[10px] font-black text-slate-600 dark:text-slate-300 font-mono">
                                #{idx + 1}
                              </span>
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span 
                                className="font-bold text-xs text-slate-900 dark:text-slate-100 truncate max-w-[150px] sm:max-w-[210px] group-hover:text-lime-600 dark:group-hover:text-lime-400 transition-colors"
                                title={sale.items?.map((i: any) => `${i.qty || 1}x ${i.name}${i.variantName ? ` (${i.variantName})` : ''}`).join(', ') || billNo}
                              >
                                {formatSaleProductsName(sale.items, billNo)}
                              </span>
                              {isReturned ? (
                                <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 uppercase">Returned</span>
                              ) : mode === 'Cash' ? (
                                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">Cash</span>
                              ) : mode === 'Online' ? (
                                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">Online</span>
                              ) : (
                                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">Credit</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                              <span className="font-mono text-[10px] text-slate-400 font-semibold">{billNo}</span>
                              <span>•</span>
                              <User size={10} className="shrink-0 opacity-60" />
                              <span className="truncate max-w-[110px] sm:max-w-[140px] font-medium">{customerName}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">
                          <div className="text-right">
                            <div className="font-mono font-black text-xs sm:text-sm text-slate-900 dark:text-slate-50">
                              {formatCurrency(totalAmt)}
                            </div>
                            {relativeTime && (
                              <div className="flex items-center justify-end gap-1 text-[10px] text-slate-400 mt-0.5">
                                <Clock size={9} />
                                <span>{relativeTime}</span>
                              </div>
                            )}
                          </div>
                          <div
                            className="p-1.5 text-lime-600 dark:text-lime-400 group-hover:bg-lime-500 group-hover:text-white dark:group-hover:text-slate-950 rounded-lg transition-all"
                            title="Open bill receipt"
                          >
                            <Printer size={14} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        
        {activeShiftSession ? (
          <button
            type="button"
            onClick={() => setIsShiftModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 hover:bg-lime-50 dark:bg-slate-800/80 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-lime-400 dark:hover:border-lime-600 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 transition-all shadow-xs cursor-pointer"
            title={`Shift open${activeShiftSession.user_id !== currentUser?.id ? ` (${activeShiftSession.user_name})` : ''} · opening ${formatCurrency(Number(activeShiftSession.opening_counted ?? activeShiftSession.opening_float ?? 0))} — click to see cash or close the shift`}
          >
            <span className="w-2 h-2 rounded-full bg-lime-500 animate-pulse shrink-0" />
            <span className="text-xs font-bold text-slate-800 dark:text-slate-100 max-w-[110px] truncate">
              {activeShiftSession.user_id !== currentUser?.id
                ? `${activeShiftSession.user_name || 'Cashier'}'s shift`
                : 'Shift open'}
            </span>
            {activeShiftSession.started_at && !Number.isNaN(new Date(activeShiftSession.started_at).getTime()) && (
              <span className="hidden sm:inline text-[11px] font-mono text-slate-500 dark:text-slate-400">
                since {new Date(activeShiftSession.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <span className="hidden md:inline text-[10px] font-bold text-lime-700 dark:text-lime-400">Cash &amp; close</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setIsShiftModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs transition-all shadow-xs cursor-pointer"
            title="Start a Shift"
          >
            <Zap size={13} className="fill-current" />
            <span>Start Shift</span>
          </button>
        )}

        <button 
          type="button"
          onClick={() => setHeldOrdersModalOpen(true)}
          className="relative px-2 py-1 bg-slate-50 hover:bg-amber-50 dark:bg-slate-800/80 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1 transition-all shadow-xs cursor-pointer"
          title="Held / Parked Bills (F8)"
        >
          <PauseCircle size={13} className="text-amber-500 shrink-0" />
          <span className="hidden sm:inline">Parked</span>
          {heldOrdersCount > 0 ? (
            <span className="px-1.5 py-0.2 bg-amber-500 text-slate-950 font-black rounded-full text-[10px] animate-pulse font-mono">
              {heldOrdersCount}
            </span>
          ) : (
            <span className="text-[10px] text-slate-400 font-mono">0</span>
          )}
          <kbd className="hidden md:inline-block text-[9px] bg-slate-200/80 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1 rounded font-mono">F8</kbd>
        </button>

        <button 
          type="button"
          onClick={() => setIsUserSwitcherOpen(true)}
          className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/80 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 transition-all shadow-xs cursor-pointer"
          title="Switch Current Logged-in Staff"
        >
          <User size={13} className="text-lime-600 dark:text-lime-400 shrink-0" />
          <span className="max-w-[70px] truncate font-bold text-slate-800 dark:text-slate-100">{currentUser?.name?.split(' ')[0] || 'Staff'}</span>
        </button>

        <div className="hidden sm:flex items-center gap-0.5 border-l border-slate-200 dark:border-slate-700 pl-1">
          <button aria-label="POS & Printer Settings" 
            type="button"
            onClick={() => navigate('/settings')}
            className="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title="POS & Printer Settings"
          >
            <Printer size={13} />
          </button>
          <button aria-label="Keyboard Shortcuts Guide" 
            type="button"
            onClick={() => setShortcutsModalOpen(true)}
            className="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title="Keyboard Shortcuts Guide"
          >
            <Keyboard size={13} />
          </button>
        </div>

      </div>
    </div>
  );
};
