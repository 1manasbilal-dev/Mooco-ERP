import React, { memo, useState, useRef, useEffect, useMemo } from 'react';
import {
  TrendingUp, Receipt, Zap, PauseCircle, User, Printer, Keyboard,
  ChevronDown, Clock, ArrowRight, Wallet, CreditCard, RotateCcw, CloudOff, RefreshCw, AlertTriangle
} from 'lucide-react';
import { isDateOnlyOrMidnight, formatCurrency } from '../../lib/formatters';
import { syncService, type SyncState } from '../../lib/syncService';
import { cn } from '../../lib/cn';
import { Badge, IconButton, Money } from '../ui';

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

const RECENT_LIMIT = 5;

const formatRelativeTime = (dateStr?: string | Date): string => {
  if (!dateStr) return '';
  try {
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    if (isNaN(date.getTime())) return '';

    // If date string has no time or is a legacy midnight UTC artifact, do not compute misleading hours
    if (typeof dateStr === 'string' && isDateOnlyOrMidnight(dateStr)) {
      return 'Today';
    }

    const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
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
  if (items.length === 2) return `${items[0].name}, ${items[1].name}`;
  return `${items[0].name} +${items.length - 1} more`;
};

const saleTime = (sale: any) => new Date(sale?.date || sale?.created_at || 0).getTime() || 0;

/** The newest few bills in one pass, without sorting the whole sales list on every update. */
const latestSales = (sales: any[] | undefined, limit: number) => {
  const top: any[] = [];
  for (const sale of sales || []) {
    if (!sale || (sale.total === undefined && sale.total_amount === undefined)) continue;
    const time = saleTime(sale);
    if (top.length === limit && time <= saleTime(top[top.length - 1])) continue;
    let index = top.findIndex(item => time > saleTime(item));
    if (index === -1) index = top.length;
    top.splice(index, 0, sale);
    if (top.length > limit) top.pop();
  }
  return top;
};

const MODE_TONE: Record<string, 'success' | 'info' | 'warning'> = { Cash: 'success', Online: 'info', Credit: 'warning' };

/** Offline / unsynced bills, so the cashier knows sales are safe on this device. */
function useSyncState() {
  const [state, setState] = useState<SyncState>(() => syncService.getState());
  useEffect(() => syncService.subscribe(setState), []);
  return state;
}

const chip = 'flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-control border border-line bg-surface px-2.5 text-xs text-fg shadow-e1 transition-colors duration-150 hover:border-line-strong hover:bg-surface-2';
const popover = 'absolute left-0 right-0 top-full z-50 mt-1.5 rounded-card border border-line bg-surface p-2 shadow-e2 animate-fade-up sm:right-auto';

export const PosHeaderAnalytics = memo(function PosHeaderAnalytics({
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
}: PosHeaderAnalyticsProps) {
  const [todayDropdownOpen, setTodayDropdownOpen] = useState(false);
  const [recentDropdownOpen, setRecentDropdownOpen] = useState(false);
  const todayDropdownRef = useRef<HTMLDivElement>(null);
  const recentDropdownRef = useRef<HTMLDivElement>(null);
  const sync = useSyncState();
  const unsynced = sync.pendingCount + sync.failedCount;

  // Re-render every 25s so relative times stay current
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 25000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!todayDropdownOpen && !recentDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (todayDropdownRef.current && !todayDropdownRef.current.contains(e.target as Node)) setTodayDropdownOpen(false);
      if (recentDropdownRef.current && !recentDropdownRef.current.contains(e.target as Node)) setRecentDropdownOpen(false);
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setTodayDropdownOpen(false); setRecentDropdownOpen(false); }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [todayDropdownOpen, recentDropdownOpen]);

  const recentSales = useMemo(() => latestSales(sales, RECENT_LIMIT), [sales]);
  const latestSale = recentSales[0];
  const latestTime = latestSale ? formatRelativeTime(latestSale.date || latestSale.created_at) : '';
  const shiftStarted = activeShiftSession?.started_at && !Number.isNaN(new Date(activeShiftSession.started_at).getTime())
    ? new Date(activeShiftSession.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';
  const otherCashierShift = activeShiftSession && activeShiftSession.user_id !== currentUser?.id;

  return (
    <div className={cn(mobileTab === 'cart' ? 'hidden lg:flex' : 'flex', 'relative z-30 shrink-0 select-none items-center justify-between gap-2 rounded-card border border-line bg-surface p-1.5 shadow-e1')}>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden sm:overflow-visible">
        {/* Today */}
        <div className="shrink-0 sm:relative" ref={todayDropdownRef}>
          <button
            type="button"
            aria-expanded={todayDropdownOpen}
            onClick={() => { setTodayDropdownOpen(prev => !prev); setRecentDropdownOpen(false); }}
            className={cn(chip, todayDropdownOpen && 'border-brand-accent ring-2 ring-ring/20')}
            title="Cash / Online / Credit breakdown dekhein"
          >
            <span className="hidden size-6 items-center justify-center rounded-md bg-brand-soft text-brand-fg sm:flex" aria-hidden="true"><TrendingUp className="size-3.5" /></span>
            <span className="hidden text-[11px] font-semibold text-fg-subtle sm:inline">Today</span>
            <Money amount={todaySummary.totalRevenue} className="text-[13px] font-bold sm:hidden" compact />
            <Money amount={todaySummary.totalRevenue} className="hidden text-[13px] font-bold sm:inline" />
            <span className="rounded-md bg-surface-2 px-1.5 text-[11px] font-semibold tabular-nums leading-5 text-fg-muted">{todaySummary.totalCount}<span className="hidden sm:inline"> bills</span></span>
            <ChevronDown className={cn('hidden size-3.5 text-fg-faint transition-transform sm:block', todayDropdownOpen && 'rotate-180')} aria-hidden="true" />
          </button>

          {todayDropdownOpen && (
            <div className={cn(popover, 'sm:w-72')}>
              <div className="mb-1.5 flex items-center justify-between border-b border-line px-1.5 pb-2">
                <span className="text-[13px] font-bold text-fg">Today's inflow</span>
                <span className="text-[11px] font-semibold tabular-nums text-fg-subtle">{todaySummary.totalCount} bills</span>
              </div>
              <dl className="space-y-0.5 text-[13px]">
                <SummaryRow icon={<Wallet />} label="Cash" amount={todaySummary.cashTotal} tone="success" />
                <SummaryRow icon={<CreditCard />} label="Online / Bank" amount={todaySummary.onlineTotal} tone="info" />
                {todaySummary.creditTotal > 0 && <SummaryRow icon={<User />} label="Credit (Udhar)" amount={todaySummary.creditTotal} tone="warning" />}
                {Boolean(todaySummary.returnedTotal && todaySummary.returnedTotal > 0) && (
                  <SummaryRow icon={<RotateCcw />} label={`Returns (${todaySummary.returnedCount})`} amount={-(todaySummary.returnedTotal || 0)} tone="danger" />
                )}
                <div className="mt-1 flex items-center justify-between border-t border-line px-1.5 pt-2">
                  <dt className="font-semibold text-fg-muted">Net sale</dt>
                  <dd><Money amount={todaySummary.totalRevenue} className="font-bold text-fg" /></dd>
                </div>
              </dl>
            </div>
          )}
        </div>

        {/* Recent bills */}
        <div className="min-w-0 sm:relative" ref={recentDropdownRef}>
          <button
            type="button"
            aria-expanded={recentDropdownOpen}
            onClick={() => { setRecentDropdownOpen(prev => !prev); setTodayDropdownOpen(false); }}
            className={cn(chip, 'max-w-full min-w-0', recentDropdownOpen && 'border-brand-accent ring-2 ring-ring/20')}
            title="Last 5 bills — kholein aur reprint karein"
            aria-label={latestSale ? 'Recent sales' : 'Recent sales: none yet'}
          >
            <Receipt className="size-4 shrink-0 text-brand-fg" aria-hidden="true" />
            <span className="hidden text-[11px] font-semibold text-fg-subtle md:inline">Last</span>
            {latestSale ? (
              <span className="hidden min-w-0 items-center gap-1.5 sm:flex">
                <span className="max-w-[120px] truncate font-semibold xl:max-w-[200px]" title={latestSale.items?.map((i: any) => `${i.qty || 1}x ${i.name}${i.variantName ? ` (${i.variantName})` : ''}`).join(', ') || latestSale.bill_number}>
                  {formatSaleProductsName(latestSale.items, latestSale.bill_number || 'Sale')}
                </span>
                <Money amount={Number(latestSale.total ?? latestSale.total_amount ?? 0)} className="font-bold text-success-fg" />
                {latestTime && <span className="hidden items-center gap-0.5 text-[11px] text-fg-subtle lg:inline-flex"><Clock className="size-3" aria-hidden="true" />{latestTime}</span>}
              </span>
            ) : (
              <span className="hidden text-[11px] text-fg-subtle sm:inline">None yet</span>
            )}
            <ChevronDown className={cn('size-3.5 shrink-0 text-fg-faint transition-transform', recentDropdownOpen && 'rotate-180')} aria-hidden="true" />
          </button>

          {recentDropdownOpen && (
            <div className={cn(popover, 'sm:w-[420px]')}>
              <div className="mb-1.5 flex items-center justify-between border-b border-line px-1.5 pb-2">
                <span className="flex items-center gap-1.5 text-[13px] font-bold text-fg">
                  <Receipt className="size-4 text-brand-fg" aria-hidden="true" />
                  Recent sales <span className="font-normal text-fg-subtle">(آخری 5 بل)</span>
                </span>
                <button
                  type="button"
                  onClick={() => { setRecentDropdownOpen(false); navigate('/sales-history'); }}
                  className="flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand-fg hover:bg-brand-soft"
                >
                  All sales <ArrowRight className="size-3.5" aria-hidden="true" />
                </button>
              </div>

              {recentSales.length === 0 ? (
                <p className="py-6 text-center text-xs text-fg-subtle">No sales recorded yet today</p>
              ) : (
                <ul className="max-h-[360px] space-y-1 overflow-y-auto">
                  {recentSales.map((sale, idx) => {
                    const billNo = sale.bill_number || sale.invoice_no || sale.id?.slice(-6) || 'INV';
                    const mode = sale.payment_mode || sale.payment_method || 'Cash';
                    const isReturned = sale.status === 'Returned';
                    const relativeTime = formatRelativeTime(sale.date || sale.created_at);
                    return (
                      <li key={sale.id || idx}>
                        <button
                          type="button"
                          onClick={() => { setRecentDropdownOpen(false); onOpenReceipt?.(sale); }}
                          className={cn(
                            'group flex w-full cursor-pointer items-center justify-between gap-3 rounded-control p-2.5 text-left transition-colors',
                            idx === 0 ? 'bg-brand-soft/60 hover:bg-brand-soft' : 'hover:bg-surface-2',
                          )}
                          title="Receipt kholein aur print karein"
                        >
                          <span className="min-w-0">
                            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="max-w-[210px] truncate text-[13px] font-semibold text-fg">{formatSaleProductsName(sale.items, billNo)}</span>
                              {isReturned ? <Badge tone="danger">Returned</Badge> : <Badge tone={MODE_TONE[mode] || 'neutral'}>{mode}</Badge>}
                            </span>
                            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-fg-subtle">
                              <span className="font-mono font-semibold">{billNo}</span>
                              <span aria-hidden="true">·</span>
                              <span className="truncate">{sale.customer_name || 'Walk-in Customer'}</span>
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2.5">
                            <span className="text-right">
                              <Money amount={Number(sale.total ?? sale.total_amount ?? 0)} className="block text-[13px] font-bold text-fg" />
                              {relativeTime && <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-fg-subtle"><Clock className="size-3" aria-hidden="true" />{relativeTime}</span>}
                            </span>
                            <Printer className="size-4 text-fg-faint group-hover:text-brand-fg" aria-hidden="true" />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {(!sync.isOnline || unsynced > 0) && (
          <span
            role="status"
            className={cn(
              'flex h-10 items-center gap-1.5 rounded-control px-2.5 text-xs font-semibold ring-1 ring-inset',
              !sync.isOnline ? 'bg-warning-soft text-warning-fg ring-warning/25' : sync.failedCount > 0 ? 'bg-danger-soft text-danger-fg ring-danger/20' : 'bg-info-soft text-info-fg ring-info/20',
            )}
            title={!sync.isOnline
              ? `Internet nahi hai. Bills isi device par save ho rahe hain${unsynced ? ` (${unsynced} sync baqi)` : ''}; internet aate hi sync honge.`
              : sync.failedCount > 0 ? `${sync.failedCount} entries sync nahi ho sakin — header ke sync badge se dekhein.` : `${unsynced} entries sync ho rahi hain.`}
          >
            {!sync.isOnline ? <CloudOff className="size-4" aria-hidden="true" /> : sync.failedCount > 0 ? <AlertTriangle className="size-4" aria-hidden="true" /> : <RefreshCw className={cn('size-4', sync.isSyncing && 'animate-spin')} aria-hidden="true" />}
            <span className="hidden sm:inline">{!sync.isOnline ? 'Offline' : sync.failedCount > 0 ? 'Sync error' : 'Syncing'}</span>
            {unsynced > 0 && <span className="tabular-nums">{unsynced}</span>}
          </span>
        )}

        {activeShiftSession ? (
          <button
            type="button"
            onClick={() => setIsShiftModalOpen(true)}
            className={chip}
            aria-label={otherCashierShift ? `${activeShiftSession.user_name || 'Cashier'}'s shift is open` : 'Shift open'}
            title={`Shift open${otherCashierShift ? ` (${activeShiftSession.user_name})` : ''} · opening ${formatCurrency(Number(activeShiftSession.opening_counted ?? activeShiftSession.opening_float ?? 0))} — cash dekhein ya shift band karein`}
          >
            <span className="size-2 shrink-0 rounded-full bg-brand-accent" aria-hidden="true" />
            <Clock className="size-4 text-fg-subtle sm:hidden" aria-hidden="true" />
            <span className="hidden max-w-[110px] truncate font-semibold sm:inline">
              {otherCashierShift ? `${activeShiftSession.user_name || 'Cashier'}'s shift` : 'Shift open'}
            </span>
            {shiftStarted && <span className="hidden text-[11px] tabular-nums text-fg-subtle xl:inline">since {shiftStarted}</span>}
            <span className="hidden text-[11px] font-semibold text-brand-fg 2xl:inline">Cash &amp; close</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setIsShiftModalOpen(true)}
            className="flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-control bg-warning px-3 text-xs font-bold text-white shadow-e1 transition-colors hover:bg-warning/90"
            title="Start a Shift"
          >
            <Zap className="size-4 fill-current" aria-hidden="true" />
            <span>Start Shift</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setHeldOrdersModalOpen(true)}
          className={chip}
          title="Held / parked bills"
          aria-label={`Parked bills: ${heldOrdersCount}`}
        >
          <PauseCircle className="size-4 shrink-0 text-warning-fg" aria-hidden="true" />
          <span className="hidden font-semibold sm:inline">Parked</span>
          <span className={cn('min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold tabular-nums leading-5', heldOrdersCount > 0 ? 'bg-warning text-white' : 'bg-surface-2 text-fg-subtle')}>
            {heldOrdersCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setIsUserSwitcherOpen(true)}
          className={chip}
          title="Switch Current Logged-in Staff"
          aria-label={`Staff: ${currentUser?.name || 'Staff'} — switch user`}
        >
          <User className="size-4 shrink-0 text-brand-fg" aria-hidden="true" />
          <span className="hidden max-w-[80px] truncate font-semibold md:inline">{currentUser?.name?.split(' ')[0] || 'Staff'}</span>
        </button>

        <div className="hidden items-center gap-0.5 border-l border-line pl-1 sm:flex">
          <IconButton aria-label="POS & Printer Settings" icon={<Printer />} onClick={() => navigate('/settings')} />
          <IconButton aria-label="Keyboard Shortcuts Guide" icon={<Keyboard />} onClick={() => setShortcutsModalOpen(true)} />
        </div>
      </div>
    </div>
  );
});

const SUMMARY_TONE = {
  success: 'bg-success-soft text-success-fg',
  info: 'bg-info-soft text-info-fg',
  warning: 'bg-warning-soft text-warning-fg',
  danger: 'bg-danger-soft text-danger-fg',
} as const;

function SummaryRow({ icon, label, amount, tone }: { icon: React.ReactNode; label: string; amount: number; tone: keyof typeof SUMMARY_TONE }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-1.5 py-1.5">
      <dt className="flex items-center gap-2 font-medium text-fg-muted">
        <span className={cn('flex size-6 items-center justify-center rounded-md [&_svg]:size-3.5', SUMMARY_TONE[tone])} aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd><Money amount={amount} className={cn('font-semibold', tone === 'danger' ? 'text-danger-fg' : 'text-fg')} /></dd>
    </div>
  );
}
