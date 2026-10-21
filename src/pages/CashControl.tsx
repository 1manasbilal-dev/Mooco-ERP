import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  AlertTriangle, ArrowRightLeft, Banknote, CalendarDays,
  Check, CheckCircle2, ChevronRight, Clock3, ExternalLink, History, LockKeyhole,
  PackageSearch, Plus, RefreshCw, Settings2, Store, WalletCards, X
} from 'lucide-react';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { roundCurrency, roundQuantity } from '../lib/db';
import { isSpotSupplierPayment, materialCashPaid, purchaseCashPaid, salePaidAmount } from '../lib/moneyFlow';
import { formatCurrency } from '../lib/formatters';

const DENOMINATIONS = [5000, 1000, 500, 100, 50, 20, 10, 5, 1];
type Tab = 'head' | 'days' | 'audit' | 'drawers';

const money = (value: number | undefined | null) => formatCurrency(value);

const initials = (name?: string | null) =>
  (name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || '').join('') || '?';

const denominationTotalOf = (value: Record<string | number, number> | undefined) =>
  DENOMINATIONS.reduce((sum, denomination) => sum + denomination * Number(value?.[denomination] || 0), 0);

const denominationNotesOf = (value: Record<string | number, number> | undefined) =>
  DENOMINATIONS.reduce((sum, denomination) => sum + Number(value?.[denomination] || 0), 0);

// Compact chips listing a non-zero denomination breakdown (e.g. "2 × Rs 5,000")
const DenominationChips: React.FC<{ value: Record<string | number, number> | undefined }> = ({ value }) => {
  const entries = DENOMINATIONS
    .map(denomination => [denomination, Number(value?.[denomination] || 0)] as const)
    .filter(([, count]) => count > 0);
  if (entries.length === 0) return <span className="text-slate-400 dark:text-slate-500 italic">Not itemized</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([denomination, count]) => (
        <span key={denomination} className="inline-flex items-center gap-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-xs font-bold text-slate-600 dark:text-slate-300">
          {count} × {formatCurrency(denomination)}
        </span>
      ))}
    </div>
  );
};

// One line of the day-close readiness checklist
const CloseCheck: React.FC<{ ok: boolean; label: string; count?: number }> = ({ ok, label, count }) => (
  <div className="flex items-center gap-2 text-xs font-bold">
    {ok ? <CheckCircle2 size={14} className="text-emerald-500 shrink-0" /> : <AlertTriangle size={14} className="text-amber-500 shrink-0" />}
    <span className={ok ? 'text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-slate-100'}>{label}</span>
    {!ok && Number(count) > 0 && <span className="rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-[10px] font-black">{count}</span>}
  </div>
);

// Modal for counting cash by denomination
const DenominationDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  value: Record<string | number, number>;
  onChange: (next: Record<string | number, number>) => void;
  onApply: (total: number) => void;
  title?: string;
}> = ({ open, onClose, value, onChange, onApply, title = 'Opening Cash Count' }) => {
  if (!open) return null;

  const total = DENOMINATIONS.reduce((sum, denomination) => sum + denomination * Number(value[denomination] || 0), 0);
  const totalNotes = DENOMINATIONS.reduce((sum, denomination) => sum + Number(value[denomination] || 0), 0);

  const handleClear = () => {
    onChange({});
  };

  const handleApply = () => {
    onApply(total);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200">
        
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-lime-500/15 dark:bg-lime-950/60 text-lime-600 dark:text-lime-400 flex items-center justify-center font-bold shrink-0">
              <Banknote size={20} />
            </div>
            <div>
              <h4 className="font-black text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                {title}
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Har currency note aur sikkay ki taadaad darj karein
              </p>
            </div>
          </div>
          <button aria-label="Band karein" 
            type="button" 
            onClick={onClose} 
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 bg-gradient-to-r from-slate-900 to-slate-800 dark:from-slate-950 dark:to-slate-900 text-white shrink-0 border-b border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-black tracking-wider text-slate-400 block">
              Total Cash Count
            </span>
            <span className="text-xl sm:text-2xl font-black font-mono text-lime-400">
              {money(total)}
            </span>
          </div>
          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">
              Total Pieces
            </span>
            <span className="text-xs sm:text-sm font-bold bg-white/10 px-2.5 py-1 rounded-lg inline-block mt-0.5">
              {totalNotes} {totalNotes === 1 ? 'Piece' : 'Pieces'}
            </span>
          </div>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
            {DENOMINATIONS.map(denomination => {
              const qty = Number(value[denomination] || 0);
              const subtotal = denomination * qty;

              return (
                <div 
                  key={denomination} 
                  className={`p-3 rounded-2xl border transition-all ${
                    qty > 0 
                      ? 'border-lime-400 dark:border-lime-700/80 bg-lime-50/40 dark:bg-lime-950/20 shadow-2xs' 
                      : 'border-slate-200/90 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold mb-1.5">
                    <span className="text-slate-700 dark:text-slate-300 font-mono">
                      {formatCurrency(denomination)}
                    </span>
                    {qty > 0 && (
                      <span className="text-[10px] font-bold text-lime-700 dark:text-lime-300 font-mono">
                        = {money(subtotal)}
                      </span>
                    )}
                  </div>

                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={value[denomination] || ''}
                    onChange={event => onChange({ ...value, [denomination]: Math.max(0, Math.floor(Number(event.target.value || 0)) || 0) })}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-sm font-bold outline-none focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20 text-slate-900 dark:text-white"
                    placeholder="0"
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={handleClear}
            className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-500 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Clear
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-4 sm:px-5 py-2 rounded-xl bg-lime-600 hover:bg-lime-500 text-white text-xs font-black flex items-center gap-1.5 shadow-sm shadow-lime-600/20 transition-all cursor-pointer"
            >
              <Check size={14} />
              <span>Apply Total ({money(total)})</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

const CashControl: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const {
    currentUser, currentRole, sales, purchases, materialPurchases, supplierTransactions, customerTransactions, expenses, expenseVendorTransactions,
    accounts, dailySupplyEntries, items, inventory,
    shiftSessions, businessDays, cashDrawers, cashHandovers,
    cashRemittances, cashVariances, shiftCashEvents, cashInTransit,
    acceptHeadRemittance, resolveCashVariance,
    resolveCashHandover, closeBusinessDay, reopenBusinessDay, refreshCashControl, getBusinessDate, getShiftTotals, addDrawerOpeningCash, closeDayCash, closeDayStock,
    isDayLocked
  } = useDairy();
  const location = useLocation();
  const validTabs: Tab[] = ['head', 'days', 'audit', 'drawers'];
  const getTabFromUrl = (): Tab => {
    const params = new URLSearchParams(window.location.search);
    const qTab = params.get('tab');
    if (qTab && validTabs.includes(qTab as Tab)) return qTab as Tab;
    return 'head';
  };
  const [tab, setTab] = useState<Tab>(getTabFromUrl);

  const selectTab = (nextTab: Tab) => {
    setTab(nextTab);
    navigate(`/cash-control?tab=${nextTab}`);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const qTab = params.get('tab');
    if (qTab && validTabs.includes(qTab as Tab)) {
      setTab(qTab as Tab);
    }
  }, [location.search]);

  const [busy, setBusy] = useState(false);
  const [headCounts, setHeadCounts] = useState<Record<string, string>>({});
  const [headDenominations, setHeadDenominations] = useState<Record<string, Record<string | number, number>>>({});
  const [headNotes, setHeadNotes] = useState<Record<string, string>>({});
  const [headDestinations, setHeadDestinations] = useState<Record<string, string>>({});
  const [headDetailId, setHeadDetailId] = useState<string | null>(null);
  const [headDenomDialogId, setHeadDenomDialogId] = useState<string | null>(null);
  const [handoverDetailId, setHandoverDetailId] = useState<string | null>(null);
  const [addCashModalOpen, setAddCashModalOpen] = useState(false);
  const [addCashDrawerId, setAddCashDrawerId] = useState('');
  const [addCashAmount, setAddCashAmount] = useState('');
  const [addCashNote, setAddCashNote] = useState('');
  const [addCashDenoms, setAddCashDenoms] = useState<Record<string | number, number>>({});
  const [addCashDenomOpen, setAddCashDenomOpen] = useState(false);
  const [addCashSourceId, setAddCashSourceId] = useState('');
  const [varianceNotes, setVarianceNotes] = useState<Record<string, string>>({});
  const [dayCloseModal, setDayCloseModal] = useState<string | null>(null);
  const [dayCloseNotes, setDayCloseNotes] = useState('');
  const [dayCloseCounts, setDayCloseCounts] = useState<Record<string, string>>({});
  const [dayCloseTab, setDayCloseTab] = useState<'cash' | 'stock'>('cash');
  const [dayCashOpening, setDayCashOpening] = useState('');
  const [dayCashCounted, setDayCashCounted] = useState('');
  const [dayCashDenoms, setDayCashDenoms] = useState<Record<string | number, number>>({});
  const [dayCashDenomDialogOpen, setDayCashDenomDialogOpen] = useState(false);
  const [reopenModalDay, setReopenModalDay] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const isHead = currentUser?.role_id === 'role_super_admin' || currentUser?.role_id === 'role_manager' ||
    Boolean(currentRole?.permissions?.includes('cash_control:approve' as any)) ||
    Boolean((currentUser?.permissions || []).includes('cash_control:approve')) ||
    Boolean(currentRole?.permissions?.includes('cash_control' as any)) ||
    Boolean((currentUser?.permissions || []).includes('cash_control'));

  const todayDate = getBusinessDate ? getBusinessDate() : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  const isTodayLocked = Boolean(isDayLocked && isDayLocked(todayDate));

  // Real Cash accounts from Bank & Cash acting as drawers / tills. Only Cash
  // accounts explicitly enabled as drawers appear here, never Bank/Wallet.
  const cashAccounts = useMemo(() => accounts.filter(account => account.type === 'Cash' && account.isDrawer === true && account.isActive !== false), [accounts]);

  const pendingHandoversAll = useMemo(
    () => cashHandovers.filter(h => ['Pending', 'Disputed'].includes(h.status)),
    [cashHandovers]
  );
  const pendingRemittances = useMemo(
    () => cashRemittances
      .filter(remittance => remittance.status === 'Pending')
      .slice()
      .sort((a, b) => (a.declared_at < b.declared_at ? -1 : 1)),
    [cashRemittances]
  );
  // Possible sources for "Add Opening Cash" — any active account except the
  // drawer account being loaded.
  const addCashSourceOptions = useMemo(
    () => accounts.filter(account => account.isActive !== false && account.id !== addCashDrawerId),
    [accounts, addCashDrawerId]
  );
  // Countable rows for the day-close stock count: loose stock + one row per
  // active variant (variant ids live on the item's variants array).
  const dayCloseStockRows = useMemo(() => {
    const rows: { key: string; itemId: string; variantId?: string; label: string; unit: string; system: number }[] = [];
    for (const item of items) {
      if ((item as any).isActive === false) continue;
      const inv = inventory.find(i => i.item_id === item.id);
      if (!inv) continue;
      rows.push({ key: item.id, itemId: item.id, label: item.name, unit: item.unit || 'units', system: roundQuantity(Number(inv.quantity || 0)) });
      const variantStocks = inv.variant_stocks || {};
      for (const variant of ((item as any).variants || []) as any[]) {
        const vid = variant.id || variant.variantId;
        // Dozen/tray style units are views of the loose pile; only ready-made packs have a count of their own.
        if (!vid || variant.isActive === false || variant.deduct_from_base === true) continue;
        rows.push({
          key: `${item.id}::${vid}`,
          itemId: item.id,
          variantId: vid,
          label: `${item.name} — ${variant.name || variant.variant_name || vid}`,
          unit: 'packs',
          system: roundQuantity(Number(variantStocks[vid] || 0))
        });
      }
    }
    return rows;
  }, [items, inventory]);
  // Previous days that are still open — informational only, never blocks today.
  const summarizeBusinessDay = (dayId: string) => {
    const dayShifts = shiftSessions.filter(shift => shift.business_day_id === dayId);
    const totals = dayShifts.map(shift => getShiftTotals(shift.id));
    return {
      dayShifts,
      summary: {
        shifts: dayShifts.length,
        gross: roundCurrency(totals.reduce((sum, row) => sum + Number(row.gross_sales || 0), 0)),
        cash: roundCurrency(totals.reduce((sum, row) => sum + Number(row.cash_sales || 0), 0)),
        online: roundCurrency(totals.reduce((sum, row) => sum + Number(row.online_sales || 0), 0)),
        credit: roundCurrency(totals.reduce((sum, row) => sum + Number(row.credit_sales || 0), 0)),
        variance: roundCurrency(dayShifts.reduce((sum, shift) => sum + Number(shift.cash_difference || 0), 0))
      }
    };
  };

  const run = async (operation: () => Promise<boolean>) => {
    setBusy(true);
    try { await operation(); } finally { setBusy(false); }
  };

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'head', label: 'Head Inbox', icon: <WalletCards size={16} />, badge: pendingRemittances.length },
    { id: 'days', label: 'Business Days', icon: <CalendarDays size={16} /> },
    { id: 'audit', label: 'Audit Trail', icon: <History size={16} /> },
    { id: 'drawers', label: 'Cash Drawers & Accounts', icon: <Settings2 size={16} /> }
  ];

  if (!isHead) {
    return (
      <div className="p-8 text-center bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 max-w-lg mx-auto mt-10 shadow-sm">
        <div className="w-14 h-14 rounded-2xl bg-lime-100 dark:bg-lime-950/60 text-lime-700 dark:text-lime-400 flex items-center justify-center mx-auto mb-4">
          <Store size={28} />
        </div>
        <h3 className="text-lg font-black text-slate-900 dark:text-white">Cashier Shifts are on POS Counter</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
          Cashier shifts are started and closed directly inside the POS interface. Cash Control is reserved for Head remittance acceptance, daily closes, and audits.
        </p>
        <button
          onClick={() => navigate('/pos')}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-lime-500 hover:bg-lime-400 text-slate-950 px-5 py-3 text-xs font-black cursor-pointer shadow-md shadow-lime-500/20"
        >
          Go to POS Counter ➔
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5 pb-10">
      <div className="flex items-center justify-between gap-2 overflow-x-auto scrollbar-hide py-1 -mx-3 px-3 sm:mx-0 sm:px-0">
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {tabs.map(item => (
            <button
              key={item.id}
              onClick={() => selectTab(item.id)}
              className={`inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs font-black transition-all shrink-0 cursor-pointer ${
                tab === item.id
                  ? 'bg-lime-600 text-white shadow-md shadow-lime-600/25 dark:bg-lime-500 dark:text-slate-950'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-lime-400'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
              {Boolean(item.badge && item.badge > 0) && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${tab === item.id ? 'bg-white text-lime-700' : 'bg-amber-500 text-slate-950'}`}>
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={() => run(async () => { await refreshCashControl(); return true; })}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold text-slate-500 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-lime-400 transition-colors shrink-0 cursor-pointer"
          title="Refresh cash data"
        >
          <RefreshCw size={13} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {isTodayLocked && (
        <div className="rounded-2xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/40 p-4 text-amber-900 dark:text-amber-200 flex items-start gap-3 shadow-sm">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <span className="font-bold">Business Day Locked:</span> The current business date ({todayDate}) is locked. Financial entries, drawer adjustments, and day closing for this date cannot be modified.
          </div>
        </div>
      )}

      {tab === 'head' && isHead && (
        <section className="space-y-5">
          <div className="rounded-3xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 md:p-6 shadow-sm">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
              <div>
                <h3 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2"><WalletCards size={20} className="text-lime-600" /> Head cash inbox</h3>
                <p className="text-sm text-slate-500 mt-1 max-w-xl">Count and accept the remittances submitted by cashiers. Every difference is recorded as a tracked variance — nothing is silently adjusted.</p>
              </div>
              <div className="grid grid-cols-3 gap-3 w-full lg:w-auto">
                <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900 px-4 py-3 text-center">
                  <p className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">Pending</p>
                  <p className="text-2xl font-black text-amber-700 dark:text-amber-300">{cashInTransit.count}</p>
                </div>
                <div className="rounded-2xl bg-violet-50 dark:bg-violet-950/30 border border-violet-100 dark:border-violet-900 px-4 py-3 text-center">
                  <p className="text-[10px] font-black uppercase tracking-wider text-violet-600 dark:text-violet-400">In Transit</p>
                  <p className="text-2xl font-black text-violet-700 dark:text-violet-300">{money(cashInTransit.amount)}</p>
                </div>
                <div className="rounded-2xl bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 px-4 py-3 text-center">
                  <p className="text-[10px] font-black uppercase tracking-wider text-blue-500 dark:text-blue-400">Handovers</p>
                  <p className="text-2xl font-black text-blue-700 dark:text-blue-300">{pendingHandoversAll.length}</p>
                </div>
              </div>
            </div>
          </div>

          {pendingHandoversAll.length > 0 && (
            <div className="rounded-3xl border border-blue-200 bg-blue-50/60 dark:bg-blue-950/20 dark:border-blue-800 p-4 sm:p-5">
              <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 text-xs font-black uppercase">
                <ArrowRightLeft size={15} /> Drawer handovers — {pendingHandoversAll.length} pending
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Cash left in the drawer by previous cashiers or loaded by head — automatically becomes the next shift's opening cash (audit trail only).
              </p>
              <div className="mt-4 space-y-2.5">
                {pendingHandoversAll.map(handover => {
                  const drawerAccount = accounts.find(a => a.id === handover.drawer_id)
                    || accounts.find(a => a.id === (cashDrawers.find(d => d.id === handover.drawer_id)?.account_id));
                  const drawerName = drawerAccount?.name || cashDrawers.find(d => d.id === handover.drawer_id)?.name || handover.drawer_id;
                  const expanded = handoverDetailId === handover.id;
                  return (
                    <div key={handover.id} className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 overflow-hidden shadow-2xs">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 flex items-center justify-center font-black text-xs shrink-0">
                            {initials(handover.from_user_name)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <b className="text-sm font-black text-slate-900 dark:text-white">{money(handover.declared_amount)}</b>
                              <span className="text-xs text-slate-500 truncate">{handover.from_user_name} · {drawerName}</span>
                              <span className={`text-[10px] font-black uppercase rounded-full px-2 py-0.5 ${handover.status === 'Disputed' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'}`}>
                                {handover.status}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-0.5">Declared {new Date(handover.declared_at).toLocaleString()}</p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 self-start sm:self-auto">
                          {handover.status === 'Disputed' && (
                            <button
                              disabled={busy}
                              onClick={() => {
                                const notes = window.prompt('Enter resolution notes:');
                                if (notes === null) return; // Cancelled
                                run(() => resolveCashHandover(handover.id, 'Resolve', notes.trim() || 'Resolved by Manager'));
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 px-2.5 py-1.5 text-[11px] font-black cursor-pointer shadow-xs"
                              title="Resolve this disputed handover"
                            >
                              <Check size={13} /> Resolve
                            </button>
                          )}
                          <button
                            onClick={() => setHandoverDetailId(expanded ? null : handover.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-400 px-2.5 py-1.5 text-[11px] font-black text-slate-500 dark:text-slate-300 cursor-pointer transition-colors"
                          >
                            {expanded ? 'Hide' : 'Details'} <ChevronRight size={13} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
                          </button>
                        </div>
                      </div>

                      {expanded && (
                        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                          <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Business day</p><p className="font-bold text-slate-700 dark:text-slate-200 mt-0.5">{handover.business_day_id || '—'}</p></div>
                          <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">From shift</p><p className="font-bold text-slate-700 dark:text-slate-200 mt-0.5">{handover.from_shift_id || '—'}</p></div>
                          <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Declared at</p><p className="font-bold text-slate-700 dark:text-slate-200 mt-0.5">{new Date(handover.declared_at).toLocaleString()}</p></div>
                          <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Handover ID</p><p className="font-bold text-slate-700 dark:text-slate-200 mt-0.5 font-mono break-all">{handover.id}</p></div>
                          <div className="sm:col-span-2"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Declared denominations</p><DenominationChips value={handover.declared_denominations} /></div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {pendingRemittances.length === 0 ? (
            <EmptyState icon={<CheckCircle2 />} text="No pending remittance. All cashier deposits are reconciled." />
          ) : pendingRemittances.map(remittance => {
            const countedRaw = headCounts[remittance.id] || '';
            const hasCount = countedRaw.trim() !== '';
            const countedNum = Number(countedRaw || 0);
            const diff = roundCurrency(countedNum - Number(remittance.declared_amount || 0));
            const headDenoms = headDenominations[remittance.id] || {};
            const headDenomTotal = denominationTotalOf(headDenoms);
            const headDenomNotes = denominationNotesOf(headDenoms);
            const detailsOpen = headDetailId === remittance.id;
            const drawerAccount = accounts.find(a => a.id === remittance.drawer_id)
              || accounts.find(a => a.id === (cashDrawers.find(d => d.id === remittance.drawer_id)?.account_id));
            const drawerName = drawerAccount?.name || cashDrawers.find(d => d.id === remittance.drawer_id)?.name || remittance.drawer_id;
            const destinationId = headDestinations[remittance.id] || '';
            const destinationName = destinationId ? (accounts.find(a => a.id === destinationId)?.name || 'Selected account') : 'Head account';
            const receivingAccounts = accounts.filter(account => account.isActive !== false && account.id !== drawerAccount?.id && account.id !== remittance.drawer_id);
            return (
              <div key={remittance.id} className="rounded-3xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-5 border-b border-slate-100 dark:border-slate-800">
                  <div className="w-11 h-11 rounded-2xl bg-lime-100 dark:bg-lime-950/60 text-lime-700 dark:text-lime-300 flex items-center justify-center font-black text-sm shrink-0">{initials(remittance.cashier_name)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-black text-slate-900 dark:text-white truncate">{remittance.cashier_name}</h4>
                      <span className="text-[10px] font-black uppercase rounded-full bg-amber-100 text-amber-700 px-2 py-0.5">Pending</span>
                      {remittance.bag_reference && <span className="text-[10px] font-bold rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 px-2 py-0.5">Bag: {remittance.bag_reference}</span>}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Declared {new Date(remittance.declared_at).toLocaleString()} · Drawer: {drawerName}</p>
                  </div>
                  <div className="text-left sm:text-right shrink-0">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Declared</p>
                    <p className="text-xl font-black text-slate-900 dark:text-white">{money(remittance.declared_amount)}</p>
                  </div>
                  <button onClick={() => setHeadDetailId(detailsOpen ? null : remittance.id)} className="self-start sm:self-auto inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-lime-400 px-3 py-1.5 text-[11px] font-black text-slate-500 dark:text-slate-300 cursor-pointer transition-colors shrink-0">
                    {detailsOpen ? 'Hide details' : 'Details'} <ChevronRight size={13} className={`transition-transform ${detailsOpen ? 'rotate-90' : ''}`} />
                  </button>
                </div>

                {detailsOpen && (
                  <div className="px-5 py-4 bg-slate-50/70 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-800">
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-xs">
                      <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Remittance ID</p><p className="font-bold text-slate-700 dark:text-slate-200 mt-0.5 font-mono break-all">{remittance.id}</p></div>
                      <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Business day</p><p className="font-bold text-slate-700 dark:text-slate-200 mt-0.5">{remittance.business_day_id || '—'}</p></div>
                      <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Shift</p><p className="font-bold text-slate-700 dark:text-slate-200 mt-0.5">{remittance.shift_id || '—'}</p></div>
                      <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Drawer</p><p className="font-bold text-slate-700 dark:text-slate-200 mt-0.5">{drawerName}</p></div>
                      <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Bag reference</p><p className="font-bold text-slate-700 dark:text-slate-200 mt-0.5">{remittance.bag_reference || '—'}</p></div>
                      <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Declared at</p><p className="font-bold text-slate-700 dark:text-slate-200 mt-0.5">{new Date(remittance.declared_at).toLocaleString()}</p></div>
                      <div className="sm:col-span-2 lg:col-span-3"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Cashier's declared denominations</p><DenominationChips value={remittance.declared_denominations} /></div>
                      {remittance.notes && <div className="sm:col-span-2 lg:col-span-3"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Cashier note</p><p className="font-bold text-slate-700 dark:text-slate-200 mt-0.5">{remittance.notes}</p></div>}
                    </div>
                  </div>
                )}

                <div className="p-5 grid lg:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2">Physical counted amount (Rs)</label>
                    <div className="relative flex items-center">
                      <input
                        type="number" min="0"
                        value={countedRaw}
                        onChange={event => setHeadCounts(prev => ({ ...prev, [remittance.id]: event.target.value }))}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-3.5 pr-11 py-3 text-sm font-bold text-slate-900 dark:text-white outline-none focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20 transition-all"
                        placeholder={String(remittance.declared_amount || 0)}
                      />
                      <button aria-label="Note count — har note ginti (details)"
                        type="button"
                        onClick={() => setHeadDenomDialogId(remittance.id)}
                        className={`absolute right-1.5 p-2 rounded-lg transition-all cursor-pointer ${headDenomTotal > 0 ? 'bg-lime-500 text-slate-950 hover:bg-lime-400 shadow-xs' : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                        title="Note count — har note ginti (details)"
                      >
                        <Banknote size={18} />
                      </button>
                    </div>
                    {headDenomTotal > 0 && (
                      <p className="text-[11px] text-lime-600 dark:text-lime-400 font-bold mt-1.5 flex items-center gap-1">
                        <Banknote size={12} /> Note breakdown: {money(headDenomTotal)} · {headDenomNotes} notes
                      </p>
                    )}
                    {hasCount && (
                      <div className={`mt-2 rounded-xl px-3 py-2 text-xs font-bold flex items-center gap-2 ${diff === 0 ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' : diff > 0 ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300' : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'}`}>
                        {diff === 0 ? <CheckCircle2 size={14} className="shrink-0" /> : <AlertTriangle size={14} className="shrink-0" />}
                        {diff === 0 ? 'Exact match with declared amount.' : diff > 0 ? `Over by ${money(diff)} — will be recorded as a variance.` : `Short by ${money(Math.abs(diff))} — will be recorded as a variance.`}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2">
                      Head Receiving Account (Bank & Cash) <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={destinationId}
                      onChange={event => setHeadDestinations(prev => ({ ...prev, [remittance.id]: event.target.value }))}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-3 text-sm font-bold text-slate-900 dark:text-white outline-none focus:border-lime-500 cursor-pointer"
                    >
                      <option value="">-- Select Head Receiving Account --</option>
                      {receivingAccounts.map(account => (
                        <option key={account.id} value={account.id}>
                          {account.name} ({account.type} · {money(account.balance)})
                        </option>
                      ))}
                    </select>
                    <label className="block text-xs font-bold text-slate-500 mb-2 mt-3">Receipt notes / difference reason</label>
                    <textarea
                      value={headNotes[remittance.id] || ''}
                      onChange={event => setHeadNotes(prev => ({ ...prev, [remittance.id]: event.target.value }))}
                      rows={2}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm outline-none focus:border-lime-500"
                      placeholder="e.g. Rs 50 note was torn, verified & accepted"
                    />
                  </div>
                  <div className="lg:col-span-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                    <p className="text-[11px] text-slate-400">
                      {hasCount && destinationId
                        ? `Accepting ${money(countedNum)} from ${drawerName} into ${destinationName}.`
                        : !hasCount
                          ? 'Enter the physical count — or use the note-count icon — to enable acceptance.'
                          : 'Select a Head receiving account from Bank & Cash to proceed.'}
                    </p>
                    <button
                      disabled={busy || !hasCount || !destinationId}
                      onClick={() => run(async () => {
                        if (!destinationId) {
                          showToast('Please select the Head receiving account from Bank & Cash.', 'warning');
                          return false;
                        }
                        const ok = await acceptHeadRemittance(
                          remittance.id,
                          Number(headCounts[remittance.id] || 0),
                          headDenominations[remittance.id] || {},
                          destinationId,
                          headNotes[remittance.id] || ''
                        );
                        if (ok) {
                          setHeadCounts(prev => { const next = { ...prev }; delete next[remittance.id]; return next; });
                          setHeadDenominations(prev => { const next = { ...prev }; delete next[remittance.id]; return next; });
                          setHeadNotes(prev => { const next = { ...prev }; delete next[remittance.id]; return next; });
                          setHeadDestinations(prev => { const next = { ...prev }; delete next[remittance.id]; return next; });
                          if (headDetailId === remittance.id) setHeadDetailId(null);
                        }
                        return ok;
                      })}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 dark:bg-lime-500 text-white dark:text-slate-950 px-5 py-3 text-xs font-black disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 cursor-pointer shadow-sm"
                    >
                      <Check size={16} /> Accept Remittance
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {tab === 'days' && isHead && (
        <section className="space-y-4">
          <div className="rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                <CalendarDays size={20} className="text-lime-600" /> Business day control
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">The day can close only when every shift, remittance, handover and variance is settled — the checklist on each card shows exactly what is pending.</p>
            </div>
            <span className="self-start sm:self-auto rounded-full bg-lime-100 text-lime-700 px-3 py-1.5 text-xs font-black">
              Today: {getBusinessDate()}
            </span>
          </div>

          {businessDays.length === 0 ? (
            <EmptyState icon={<CalendarDays />} text="No business day yet. It is created with the first shift." />
          ) : (
            businessDays.map(day => {
              const { dayShifts, summary } = summarizeBusinessDay(day.id);
              const activeShifts = dayShifts.filter(shift => ['Pending Acceptance', 'Active', 'Closing', 'Pending Review'].includes(shift.status)).length;
              const pendingRemits = cashRemittances.filter(item => item.business_day_id === day.id && ['Pending', 'Disputed'].includes(item.status)).length;
              // Pending handovers = drawer mein pada cash — day close par auto-accept ho jata hai (blocker nahi).
              // Sirf DISPUTED handover blocker hai (uska variance Open hota hai).
              const pendingHandovers = cashHandovers.filter(item => item.business_day_id === day.id && item.status === 'Disputed').length;
              const openVariances = cashVariances.filter(item => item.business_day_id === day.id && item.status === 'Open').length;
              const blockers = activeShifts + pendingRemits + pendingHandovers + openVariances;
              const isClosed = day.status === 'Closed';
              return (
                <div key={day.id} className="rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 sm:p-5 shadow-sm">
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CalendarDays size={18} className="text-lime-600 shrink-0" />
                        <h4 className="font-black text-slate-900 dark:text-white">{day.business_date}</h4>
                        <span className={`text-[10px] font-black uppercase rounded-full px-2 py-0.5 ${isClosed ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-700'}`}>
                          {day.status}
                        </span>
                        {!isClosed && blockers > 0 && (
                          <span className="text-[10px] font-black uppercase rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-2 py-0.5">
                            {blockers} blocker{blockers > 1 ? 's' : ''}
                          </span>
                        )}
                        {([
                          { kind: 'cash' as const, label: 'Cash', done: Boolean(day.cash_closed_at) },
                          { kind: 'stock' as const, label: 'Stock', done: Boolean(day.stock_closed_at) }
                        ]).map(item => (
                          <button
                            key={item.kind}
                            disabled={item.done}
                            onClick={() => {
                              const firstShift = dayShifts.slice().sort((a, b) => String(a.started_at || '').localeCompare(String(b.started_at || '')))[0];
                              setDayCloseTab(item.kind); setDayCloseCounts({}); setDayCloseNotes(''); setDayCashCounted(''); setDayCashDenoms({});
                              setDayCashOpening(String(roundCurrency(Number(firstShift?.opening_counted ?? firstShift?.opening_float ?? 0))));
                              setDayCloseModal(day.id);
                            }}
                            title={item.done ? `${item.label} closing complete (${new Date((item.kind === 'cash' ? day.cash_closed_at : day.stock_closed_at) || '').toLocaleString()})` : `${item.label} closing abhi baqi hai — click karke complete karein`}
                            className={`text-[10px] font-black uppercase rounded-full px-2 py-0.5 transition-all ${item.done ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 cursor-default' : 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 hover:brightness-95 cursor-pointer'}`}
                          >
                            {item.done ? `✓ ${item.label} closed` : `${item.label} due`}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-slate-500 mt-2">
                        {dayShifts.length} shift{dayShifts.length !== 1 ? 's' : ''}
                        {isClosed && day.closed_at ? ` · closed ${new Date(day.closed_at).toLocaleString()}` : ' · in progress'}
                      </p>
                    </div>

                    <div className="flex flex-col items-stretch lg:items-end gap-3 shrink-0">
                      {!isClosed && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1.5 rounded-2xl bg-slate-50/80 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 px-4 py-3">
                          <CloseCheck ok={activeShifts === 0} label="All shifts closed" count={activeShifts} />
                          <CloseCheck ok={pendingRemits === 0} label="Remittances accepted" count={pendingRemits} />
                          <CloseCheck ok={pendingHandovers === 0} label="Handovers settled" count={pendingHandovers} />
                          <CloseCheck ok={openVariances === 0} label="Variances resolved" count={openVariances} />
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {!isClosed && (
                          <button
                            disabled={blockers > 0}
                            title={blockers > 0 ? `${blockers} item(s) still pending — see the checklist.` : 'Open the day-close summary'}
                            onClick={() => {
                              const firstShift = dayShifts.slice().sort((a, b) => String(a.started_at || '').localeCompare(String(b.started_at || '')))[0];
                              setDayCloseNotes(''); setDayCloseCounts({}); setDayCloseTab('cash');
                              setDayCashCounted(''); setDayCashDenoms({});
                              setDayCashOpening(String(roundCurrency(Number(firstShift?.opening_counted ?? firstShift?.opening_float ?? 0))));
                              setDayCloseModal(day.id);
                            }}
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 dark:bg-lime-500 text-white dark:text-slate-950 px-4 py-2.5 text-xs font-black disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                          >
                            <LockKeyhole size={15} /> Lock Day{blockers > 0 ? ` (${blockers} pending)` : ''}
                          </button>
                        )}
                        {isClosed && currentUser?.role_id === 'role_super_admin' && (
                          <button
                            onClick={() => { setReopenReason(''); setReopenModalDay(day.id); }}
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 text-rose-600 px-4 py-2.5 text-xs font-black hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                          >
                            <RefreshCw size={15} /> Reopen
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Day summary (preview for open days, final record for closed ones) */}
                  <div className="mt-4 grid grid-cols-3 lg:grid-cols-6 gap-2">
                    {[
                      { label: 'Shifts', value: String(summary.shifts) },
                      { label: 'Gross', value: money(summary.gross) },
                      { label: 'Cash', value: money(summary.cash) },
                      { label: 'Online', value: money(summary.online) },
                      { label: 'Credit', value: money(summary.credit) },
                      { label: 'Variance', value: money(summary.variance), warn: Math.abs(summary.variance) > 0.009 }
                    ].map(stat => (
                      <div key={stat.label} className={`rounded-xl border px-3 py-2 ${stat.warn ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900' : 'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40'}`}>
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{stat.label}</p>
                        <p className={`text-sm font-black mt-0.5 ${stat.warn ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900 dark:text-white'}`}>{stat.value}</p>
                      </div>
                    ))}
                  </div>
                  {isClosed && day.notes && <p className="text-xs text-slate-500 mt-3"><b className="font-black text-slate-600 dark:text-slate-300">Close notes:</b> {day.notes}</p>}
                </div>
              );
            })
          )}
        </section>
      )}

      {tab === 'audit' && isHead && (
        <section className="space-y-4">
          <div className="rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 sm:p-5">
            <h3 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              <History size={20} className="text-lime-600" /> Custody audit trail
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">Chronological view of shift statuses, handovers, remittances and variances.</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {shiftSessions.slice(0, 20).map(shift => (
              <div key={shift.id} className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Clock3 size={16} className="text-slate-400 shrink-0" />
                    <b className="text-sm text-slate-900 dark:text-white truncate">{shift.user_name}</b>
                  </div>
                  <span className="text-[10px] font-black uppercase text-slate-500 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full shrink-0">
                    {shift.status}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  {shift.date} · {shift.drawer_name || shift.drawer_id || 'Drawer'} · opening {money(shift.opening_counted ?? shift.opening_float)}
                </p>
                {shift.closed_at && (
                  <p className="text-xs text-slate-500 mt-1">
                    closed {new Date(shift.closed_at).toLocaleString()} · variance {money(shift.cash_difference)}
                  </p>
                )}
              </div>
            ))}

            <div className="rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 sm:p-5 lg:col-span-2">
              <h4 className="font-black text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-500" /> Open variances
              </h4>
              {cashVariances.filter(variance => variance.status === 'Open').length === 0 ? (
                <p className="text-sm text-slate-500">No open variance.</p>
              ) : (
                cashVariances.filter(variance => variance.status === 'Open').map(variance => (
                  <div key={variance.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 border-b border-slate-100 dark:border-slate-700 last:border-0">
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-white">
                        {variance.variance_type}: <span className={Number(variance.variance) < 0 ? 'text-rose-600' : 'text-emerald-600'}>{money(variance.variance)}</span>
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Expected {money(variance.expected_amount)} · counted {money(variance.counted_amount)}
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                      <input
                        value={varianceNotes[variance.id] || ''}
                        onChange={event => setVarianceNotes(prev => ({ ...prev, [variance.id]: event.target.value }))}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-2 text-xs bg-white dark:bg-slate-900 flex-1 sm:w-44"
                        placeholder="Resolution note"
                      />
                      <div className="flex gap-2">
                        <button
                          disabled={busy}
                          onClick={() => run(() => resolveCashVariance(variance.id, 'Approved', varianceNotes[variance.id] || 'Approved by head'))}
                          className="flex-1 sm:flex-none rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-500 cursor-pointer disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => run(() => resolveCashVariance(variance.id, 'Rejected', varianceNotes[variance.id] || 'Rejected by head'))}
                          className="flex-1 sm:flex-none rounded-lg border border-rose-200 px-3 py-2 text-xs font-black text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      {tab === 'drawers' && isHead && (
        <section className="space-y-4">
          <div className="rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Store size={20} className="text-lime-600" /> Cash Drawers & Tills (Bank & Cash)
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Cash drawers sirf wohi Cash accounts hain jo Bank &amp; Cash mein "Cash Drawer ke tor par enable" hue hain. Bank/Wallet accounts kabhi drawer nahi bante.
              </p>
            </div>
            <button
              onClick={() => navigate('/bank-cash')}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-lime-500 hover:bg-lime-400 text-slate-950 px-4 py-2.5 text-xs font-black cursor-pointer shadow-sm"
            >
              <ExternalLink size={15} /> Manage in Bank & Cash
            </button>
          </div>

          {cashAccounts.length === 0 ? (
            <EmptyState icon={<Store />} text="Koi drawer-enabled Cash account nahi mila. Bank & Cash mein kisi Cash account ko 'Cash Drawer ke tor par enable' karke wo drawer banayein — Bank/Wallet accounts drawer nahi ban sakte." />
          ) : (
            cashAccounts.map(account => (
              <div
                key={account.id}
                className="rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Store size={17} className="text-lime-600 shrink-0" />
                    <h4 className="font-black text-slate-900 dark:text-white">{account.name}</h4>
                    <span className="text-[10px] font-black uppercase rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 px-2 py-0.5">
                      Cash Account
                    </span>
                    <span className={`text-[10px] font-black uppercase rounded-full px-2 py-0.5 ${account.isActive !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                      {account.isActive !== false ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    Current Balance: <span className="font-bold text-slate-800 dark:text-white">{money(account.balance)}</span> · ID: <span className="font-mono text-[11px]">{account.id}</span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 self-start sm:self-auto">
                  <button
                    disabled={busy || account.isActive === false}
                    onClick={() => {
                      setAddCashDrawerId(account.id);
                      setAddCashAmount('');
                      setAddCashNote('');
                      setAddCashDenoms({});
                      setAddCashSourceId('');
                      setAddCashModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 text-xs font-black cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Is drawer / cash account mein opening cash load karein — agli shift isi se start hogi"
                  >
                    <Plus size={14} /> Add Opening Cash
                  </button>
                  <button
                    onClick={() => navigate('/bank-cash')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-lime-400 px-4 py-2 text-xs font-black text-slate-600 dark:text-slate-300 cursor-pointer"
                  >
                    <ExternalLink size={13} /> View Ledger
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      )}

      {/* Per-remittance head note count — the field's banknote icon opens this */}
      <DenominationDialog
        open={Boolean(headDenomDialogId)}
        onClose={() => setHeadDenomDialogId(null)}
        value={(headDenomDialogId && headDenominations[headDenomDialogId]) || {}}
        onChange={next => { if (headDenomDialogId) setHeadDenominations(prev => ({ ...prev, [headDenomDialogId]: next })); }}
        onApply={total => {
          if (headDenomDialogId) {
            setHeadCounts(prev => ({ ...prev, [headDenomDialogId]: String(total) }));
            showToast(`Counted total set to ${money(total)}`, 'success');
          }
        }}
        title="Head Physical Cash Count"
      />

      {addCashModalOpen && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs" onClick={() => setAddCashModalOpen(false)} />
          <div className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-sm border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/40 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/15 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0"><Plus size={20} /></div>
                <div>
                  <h4 className="font-black text-base text-slate-900 dark:text-white">Add Opening Cash</h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">{cashDrawers.find(d => d.id === addCashDrawerId)?.name || 'Drawer'} — agli shift isi se start hogi</p>
                </div>
              </div>
              <button aria-label="Band karein" type="button" onClick={() => setAddCashModalOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"><X size={18} /></button>
            </div>
            <div className="p-4 sm:p-5">
              <label className="block text-xs font-bold text-slate-500 mb-2">Amount (Rs)</label>
              <div className="relative flex items-center">
                <input
                  type="number" min="0"
                  value={addCashAmount}
                  onChange={event => setAddCashAmount(event.target.value)}
                  placeholder="5000"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-3.5 pr-11 py-3 text-sm font-bold text-slate-900 dark:text-white outline-none focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20"
                />
                <button aria-label="Note count — har note ginti"
                  type="button"
                  onClick={() => setAddCashDenomOpen(true)}
                  className={`absolute right-1.5 p-2 rounded-lg cursor-pointer transition-all ${denominationTotalOf(addCashDenoms) > 0 ? 'bg-lime-500 text-slate-950' : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                  title="Note count — har note ginti"
                >
                  <Banknote size={18} />
                </button>
              </div>
              {denominationTotalOf(addCashDenoms) > 0 && (
                <p className="text-[11px] text-lime-600 dark:text-lime-400 font-bold mt-1.5">Note breakdown: {money(denominationTotalOf(addCashDenoms))} · {denominationNotesOf(addCashDenoms)} notes</p>
              )}
              <label className="block text-xs font-bold text-slate-500 mt-4 mb-2">Note (optional)</label>
              <input
                value={addCashNote}
                onChange={event => setAddCashNote(event.target.value)}
                placeholder="e.g. Counter float load"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:border-lime-500"
              />

              {/* Cash source — paisa hawa se nahi aata: hamesha kisi tracked
                  account se transfer hota hai */}
              <label className="block text-xs font-bold text-slate-500 mt-4 mb-2">
                Cash kahan se aa rahi hai? (Source account) <span className="text-rose-500">*</span>
              </label>
              {addCashSourceOptions.length > 0 ? (
                <div>
                  <select
                    value={addCashSourceId}
                    onChange={event => setAddCashSourceId(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm font-bold text-slate-900 dark:text-white outline-none focus:border-lime-500 cursor-pointer"
                  >
                    <option value="">-- Source account select karein --</option>
                    {addCashSourceOptions.map(option => (
                      <option key={option.id} value={option.id}>
                        {option.name} ({option.type} · {formatCurrency(Number(option.balance || 0))})
                      </option>
                    ))}
                  </select>
                  {addCashSourceId && (() => {
                    const source = accounts.find(a => a.id === addCashSourceId);
                    const amount = denominationTotalOf(addCashDenoms) > 0 ? denominationTotalOf(addCashDenoms) : Number(addCashAmount || 0);
                    // A pending handover on this drawer is replaced, and its cash is already in the drawer,
                    // so only the difference moves from the source (same rule as addDrawerOpeningCash).
                    const replacedSum = roundCurrency(cashHandovers
                      .filter(h => h.drawer_id === addCashDrawerId && h.status === 'Pending')
                      .reduce((sum, h) => sum + Number(h.declared_amount || 0), 0));
                    const netMove = roundCurrency(Math.max(0, amount - replacedSum));
                    return (
                      <p className={`text-[11px] font-bold mt-1.5 ${source && Number(source.balance || 0) < netMove ? 'text-rose-500' : 'text-slate-500 dark:text-slate-400'}`}>
                        {source && Number(source.balance || 0) < netMove
                          ? `Source mein sirf ${formatCurrency(Number(source.balance || 0))} hai — ${formatCurrency(netMove)} transfer nahi ho sakti.`
                          : `${source?.name} -${formatCurrency(netMove)} → Drawer +${formatCurrency(netMove)} (dono taraf ledger entry).`}
                        {replacedSum > 0 && ` Drawer mein pehle se ${formatCurrency(replacedSum)} pending hai — nayi opening ${formatCurrency(amount)} us ki jagah legi.`}
                      </p>
                    );
                  })()}
                </div>
              ) : (
                <p className="text-[11px] text-rose-500 font-bold mt-2.5">
                  Koi dusra account mojood nahi — opening cash kisi account se transfer ho kar hi aa sakti hai. Pehle Bank &amp; Cash mein ek aur account banayein.
                </p>
              )}

              <p className="text-[10px] text-slate-400 mt-3">Ye cash drawer mein load ho jayegi — agli shift start hote waqt ye opening cash ban jayegi (kisi alag verify ki zaroorat nahi).</p>
            </div>
            <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2 shrink-0 bg-slate-50/70 dark:bg-slate-800/40">
              <button onClick={() => setAddCashModalOpen(false)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-xs font-black text-slate-600 dark:text-slate-300 hover:border-slate-400 cursor-pointer">Cancel</button>
              <button
                disabled={busy}
                onClick={() => run(async () => {
                  const amount = denominationTotalOf(addCashDenoms) > 0 ? denominationTotalOf(addCashDenoms) : Number(addCashAmount || 0);
                  if (!(amount > 0)) {
                    showToast('Amount 0 se zyada honi chahiye.', 'warning');
                    return false;
                  }
                  // Paisa hawa se nahi aata: opening cash hamesha kisi tracked
                  // account se transfer hogi — bina source ke add nahi hoti.
                  if (addCashSourceOptions.length === 0) {
                    showToast('Koi dusra account mojood nahi — pehle Bank & Cash mein ek aur account banayein.', 'warning');
                    return false;
                  }
                  if (!addCashSourceId) {
                    showToast('Source account select karein — cash kahan se aa rahi hai?', 'warning');
                    return false;
                  }
                  const ok = await addDrawerOpeningCash(addCashDrawerId, amount, addCashNote || undefined, addCashSourceId);
                  if (ok) { setAddCashModalOpen(false); setAddCashAmount(''); setAddCashNote(''); setAddCashDenoms({}); setAddCashSourceId(''); }
                  return ok;
                })}
                className="inline-flex items-center gap-2 rounded-xl bg-lime-500 hover:bg-lime-400 disabled:opacity-50 px-5 py-2.5 text-xs font-black text-slate-950 cursor-pointer shadow-sm"
              >
                <Plus size={15} /> Add to Drawer
              </button>
            </div>
          </div>
        </div>
      )}

      <DenominationDialog
        open={addCashDenomOpen}
        onClose={() => setAddCashDenomOpen(false)}
        value={addCashDenoms}
        onChange={setAddCashDenoms}
        onApply={total => {
          setAddCashAmount(String(total));
          showToast(`Amount set to ${money(total)}`, 'success');
        }}
        title="Opening Cash Count"
      />

      {/* Day-close cash counted — the field's banknote icon opens this */}
      <DenominationDialog
        open={dayCashDenomDialogOpen}
        onClose={() => setDayCashDenomDialogOpen(false)}
        value={dayCashDenoms}
        onChange={setDayCashDenoms}
        onApply={total => {
          setDayCashCounted(String(total));
          showToast(`Counted cash set to ${money(total)}`, 'success');
        }}
        title="Day Close — Physical Cash Count"
      />

      {/* Reopen business day — proper modal (window.prompt webview mein kaam nahi karta) */}
      {reopenModalDay && (() => {
        const day = businessDays.find(item => item.id === reopenModalDay);
        if (!day) return null;
        return (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs" onClick={() => setReopenModalDay(null)} />
            <div className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-sm border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
              <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/40 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-500/15 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0"><RefreshCw size={20} /></div>
                  <div>
                    <h4 className="font-black text-base text-slate-900 dark:text-white">Reopen business day</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">{day.business_date} — audit trail par reason record hoga</p>
                  </div>
                </div>
                <button aria-label="Band karein" type="button" onClick={() => setReopenModalDay(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"><X size={18} /></button>
              </div>
              <div className="p-4 sm:p-5">
                <label className="block text-xs font-bold text-slate-500 mb-2">Reopen reason (zaroori)</label>
                <textarea
                  value={reopenReason}
                  onChange={event => setReopenReason(event.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm outline-none focus:border-lime-500"
                  placeholder="e.g. stock closing reh gayi thi — complete karne ke liye"
                />
              </div>
              <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2 shrink-0 bg-slate-50/70 dark:bg-slate-800/40">
                <button onClick={() => setReopenModalDay(null)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-xs font-black text-slate-600 dark:text-slate-300 hover:border-slate-400 cursor-pointer">Cancel</button>
                <button
                  disabled={busy}
                  onClick={() => run(async () => {
                    if (!reopenReason.trim()) {
                      showToast('Reopen reason likhein — ye audit record hota hai.', 'warning');
                      return false;
                    }
                    const ok = await reopenBusinessDay(reopenModalDay, reopenReason);
                    if (ok) { setReopenModalDay(null); setReopenReason(''); }
                    return ok;
                  })}
                  className="inline-flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 px-5 py-2.5 text-xs font-black text-white cursor-pointer shadow-sm"
                >
                  <RefreshCw size={15} /> Reopen Day
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {dayCloseModal && (() => {
        const day = businessDays.find(item => item.id === dayCloseModal);
        if (!day) return null;
        const { summary } = summarizeBusinessDay(day.id);
        // Cash closing: sources in, outflows, expected vs counted
        const bdDate = day.business_date;
        // Every date below is compared on the Pakistan business day; stored timestamps are UTC.
        const onBusinessDay = (value?: string | null) => {
          if (!value) return false;
          const text = String(value);
          return (/^\d{4}-\d{2}-\d{2}$/.test(text) ? text : new Date(text).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })) === bdDate;
        };
        const allDaySales = sales.filter(s => s.business_day_id === day.id);
        // Refund events point at their bill as `${saleId}_xxxx`; sale ids contain underscores themselves.
        const refundEventsForSale = (saleId: string) => shiftCashEvents.filter(ev =>
          ev.business_day_id === day.id && ev.direction === 'Out' && String(ev.event_type || '').toLowerCase().includes('refund') &&
          (String(ev.source_id || '') === saleId || String(ev.source_id || '').startsWith(`${saleId}_`)));
        // Drawer cash from the day's bills: any bill that is not online (a credit bill's cash down-payment
        // counts), net of the cash refunded for it the same day.
        const dayCashSales = allDaySales.filter(s => String(s.payment_mode || '').toLowerCase() !== 'online' && salePaidAmount(s) > 0);
        const cashSalesTotal = roundCurrency(dayCashSales.reduce((sum, s) => {
          const sameDayRefund = refundEventsForSale(s.id).reduce((total, ev) => total + Number(ev.amount || 0), 0);
          return sum + Math.max(0, salePaidAmount(s) - sameDayRefund);
        }, 0));
        const dayLedger = customerTransactions.filter(t => t.type === 'Payment' && String((t as any).mode || '').toLowerCase().includes('cash') && Number(t.amount || 0) > 0 && ((t as any).business_day_id === day.id || onBusinessDay(t.date)));
        const ledgerTotal = roundCurrency(dayLedger.reduce((sum, t) => sum + Number(t.amount || 0), 0));
        const dayDelivery = dailySupplyEntries.filter(e => String(e.payment_mode || '').toLowerCase().includes('cash') && Number(e.payment_received || 0) > 0 && ((e as any).business_day_id === day.id || onBusinessDay(e.date)));
        const deliveryTotal = roundCurrency(dayDelivery.reduce((sum, e) => sum + Number(e.payment_received || 0), 0));
        const dayExpenses = expenses.filter(e => String(e.paymentMode || '').toLowerCase().includes('cash') && Number(e.paidAmount || 0) > 0 && onBusinessDay(e.date));
        const expensesTotal = roundCurrency(dayExpenses.reduce((sum, e) => sum + Number(e.paidAmount || 0), 0));

        // Milk purchases paid in cash
        const dayPurchases = purchases.filter(p => String(p.payment_mode || (p as any).details?.payment_mode || '').toLowerCase().includes('cash') && purchaseCashPaid(p) > 0 && onBusinessDay(p.date));
        const purchasesTotal = roundCurrency(dayPurchases.reduce((sum, p) => sum + purchaseCashPaid(p), 0));

        // Material purchases paid in cash (a credit line's total is not cash)
        const dayMaterialPurchases = (materialPurchases || []).filter(mp => String(mp.payment_mode || (mp as any).details?.payment_mode || '').toLowerCase().includes('cash') && materialCashPaid(mp) > 0 && onBusinessDay(mp.date));
        const materialPurchasesTotal = roundCurrency(dayMaterialPurchases.reduce((sum, mp: any) => sum + materialCashPaid(mp), 0));

        // Supplier khata cash payments; spot payments are already in the purchases above, waivers moved no cash
        const daySupplierCashTx = (supplierTransactions || []).filter(stx => stx.type === 'Payment' && String((stx as any).mode || '').toLowerCase().includes('cash') && Number(stx.amount || 0) > 0 && onBusinessDay(stx.date) && !isSpotSupplierPayment(stx) && !(stx as any).details?.waiver);
        const supplierCashTxTotal = roundCurrency(daySupplierCashTx.reduce((sum, stx) => sum + Number(stx.amount || 0), 0));

        // Expense vendor / staff khata settled in cash (the shift totals count these too; leaving them out
        // overstated expected cash and showed a false shortage).
        const dayVendorCashTx = (expenseVendorTransactions || []).filter(evt => String(evt.payment_mode || '').toLowerCase().includes('cash') && Number(evt.amount || 0) > 0 && onBusinessDay(evt.date));
        const dayVendorPayments = dayVendorCashTx.filter(evt => evt.type === 'Payment');
        const vendorPaymentsTotal = roundCurrency(dayVendorPayments.reduce((sum, evt) => sum + Number(evt.amount || 0), 0));
        const dayVendorRefunds = dayVendorCashTx.filter(evt => evt.type === 'Refund');
        const vendorRefundsTotal = roundCurrency(dayVendorRefunds.reduce((sum, evt) => sum + Number(evt.amount || 0), 0));

        const dayPriorRefunds = shiftCashEvents.filter(ev => {
          if (ev.business_day_id !== day.id || ev.direction !== 'Out' || !String(ev.event_type || '').toLowerCase().includes('refund')) return false;
          const source = String(ev.source_id || '');
          return !allDaySales.some(s => source === s.id || source.startsWith(`${s.id}_`));
        });
        const refundsTotal = roundCurrency(dayPriorRefunds.reduce((sum, ev) => sum + Number(ev.amount || 0), 0));
        const dayRemits = cashRemittances.filter(r => r.business_day_id === day.id && r.status === 'Accepted');
        const remittedTotal = roundCurrency(dayRemits.reduce((sum, r) => sum + Number(r.counted_amount ?? r.declared_amount ?? 0), 0));
        const cashInTotal = roundCurrency(cashSalesTotal + ledgerTotal + deliveryTotal + vendorRefundsTotal);
        const cashOutTotal = roundCurrency(expensesTotal + purchasesTotal + materialPurchasesTotal + supplierCashTxTotal + vendorPaymentsTotal + refundsTotal);
        const openingCashNum = roundCurrency(Number(dayCashOpening || 0));
        const expectedCash = roundCurrency(openingCashNum + cashInTotal - cashOutTotal - remittedTotal);
        const dayCountedRaw = dayCashCounted.trim();
        const dayCountedNum = dayCountedRaw ? roundCurrency(Number(dayCashCounted)) : null;
        const dayCashVariance = dayCountedNum !== null ? roundCurrency(dayCountedNum - expectedCash) : null;
        const buildCashClose = (counted: number, variance: number, source: 'physical' | 'expected') => ({
          opening: openingCashNum,
          cash_in: { pos_sales: cashSalesTotal, ledger_collections: ledgerTotal, delivery_collections: deliveryTotal, vendor_refunds: vendorRefundsTotal, total: cashInTotal, bill_count: dayCashSales.length, receipt_count: dayLedger.length, delivery_count: dayDelivery.length },
          cash_out: { expenses: expensesTotal, purchases: purchasesTotal, material_purchases: materialPurchasesTotal, supplier_payments: supplierCashTxTotal, vendor_payments: vendorPaymentsTotal, refunds: refundsTotal, total: cashOutTotal },
          remitted_to_head: remittedTotal,
          expected: expectedCash,
          counted,
          variance,
          counted_source: source,
          denominations: dayCashDenoms,
          closed_by_name: currentUser?.name || '',
          closed_at: new Date().toISOString()
        });
        const dayDenomTotal = denominationTotalOf(dayCashDenoms);
        const stockEntered = Object.keys(dayCloseCounts).filter(key => (dayCloseCounts[key] || '').trim() !== '').length;
        const stockAdjustments = dayCloseStockRows.filter(row => {
          const raw = dayCloseCounts[row.key];
          return raw !== undefined && raw.trim() !== '' && roundQuantity(Number(raw) - row.system) !== 0;
        }).length;
        const isThisDayLocked = Boolean(isDayLocked && isDayLocked(day.business_date));
        return (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs" onClick={() => setDayCloseModal(null)} />
            <div className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200">
              <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/40 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-lime-500/15 dark:bg-lime-950/60 text-lime-600 dark:text-lime-400 flex items-center justify-center shrink-0"><LockKeyhole size={20} /></div>
                  <div>
                    <h4 className="font-black text-base text-slate-900 dark:text-white">Close business day</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">{day.business_date} — locked after closing, Owner can reopen</p>
                  </div>
                </div>
                <button aria-label="Band karein" type="button" onClick={() => setDayCloseModal(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"><X size={18} /></button>
              </div>
              <div className="p-4 sm:p-5 overflow-y-auto">
                {isThisDayLocked && (
                  <div className="mb-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-3 py-2.5 text-xs font-bold text-amber-800 dark:text-amber-200 flex items-center gap-2">
                    <AlertTriangle size={15} className="shrink-0 text-amber-600 dark:text-amber-400" />
                    <span>This business date ({day.business_date}) is already locked. New closings or modifications are disabled.</span>
                  </div>
                )}
                <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2">Day summary (final)</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Shifts', value: String(summary.shifts) },
                    { label: 'Gross sales', value: money(summary.gross) },
                    { label: 'Cash sales', value: money(summary.cash) },
                    { label: 'Online sales', value: money(summary.online) },
                    { label: 'Credit sales', value: money(summary.credit) },
                    { label: 'Total variance', value: money(summary.variance), warn: Math.abs(summary.variance) > 0.009 }
                  ].map(stat => (
                    <div key={stat.label} className={`rounded-xl border px-3 py-2 ${stat.warn ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900' : 'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40'}`}>
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{stat.label}</p>
                      <p className={`text-sm font-black mt-0.5 ${stat.warn ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900 dark:text-white'}`}>{stat.value}</p>
                    </div>
                  ))}
                </div>
                {Math.abs(summary.variance) > 0.009 && (
                  <p className="mt-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-3 py-2 text-xs font-bold text-amber-700 dark:text-amber-300 flex items-center gap-2">
                    <AlertTriangle size={14} className="shrink-0" /> Is din ka shift cash variance {money(summary.variance)} hai — ye record par mehfooz rahega.
                  </p>
                )}

                <div className="mt-4 grid grid-cols-2 gap-1.5 rounded-2xl bg-slate-100 dark:bg-slate-800/60 p-1">
                  <button type="button" onClick={() => setDayCloseTab('cash')} className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black transition-all cursor-pointer ${dayCloseTab === 'cash' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>
                    <Banknote size={14} /> Cash Closing
                    {dayCashVariance !== null && dayCashVariance !== 0 && <span className="rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-[9px]">!</span>}
                  </button>
                  <button type="button" onClick={() => setDayCloseTab('stock')} className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black transition-all cursor-pointer ${dayCloseTab === 'stock' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>
                    <PackageSearch size={14} /> Stock Closing
                    {stockAdjustments > 0 && <span className="rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-[9px]">{stockAdjustments}</span>}
                  </button>
                </div>

                {dayCloseTab === 'cash' && (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                      <div className="px-4 py-2.5 bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-between">
                        <span className="text-[11px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Cash In — kahan se kitna aaya</span>
                        <span className="text-sm font-black text-emerald-700 dark:text-emerald-300">{money(cashInTotal)}</span>
                      </div>
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {[
                          { label: 'POS Cash Sales', detail: `${dayCashSales.length} bills`, amount: cashSalesTotal },
                          { label: 'Customer Khata Cash', detail: `${dayLedger.length} payments`, amount: ledgerTotal },
                          { label: 'Daily Delivery Cash', detail: `${dayDelivery.length} entries`, amount: deliveryTotal },
                          ...(vendorRefundsTotal > 0 ? [{ label: 'Vendor / Staff Refunds', detail: `${dayVendorRefunds.length} refunds`, amount: vendorRefundsTotal }] : [])
                        ].map(row => (
                          <div key={row.label} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
                            <span className="font-bold text-slate-700 dark:text-slate-200 truncate">{row.label} <span className="text-slate-400 font-normal">· {row.detail}</span></span>
                            <span className="font-black text-slate-900 dark:text-white shrink-0">{money(row.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                      <div className="px-4 py-2.5 bg-rose-50 dark:bg-rose-950/30 flex items-center justify-between">
                        <span className="text-[11px] font-black uppercase tracking-wider text-rose-700 dark:text-rose-300">Cash Out — expenses & purchases</span>
                        <span className="text-sm font-black text-rose-700 dark:text-rose-300">{money(cashOutTotal)}</span>
                      </div>
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {[
                          { label: 'Cash Expenses', detail: `${dayExpenses.length} entries`, amount: expensesTotal },
                          { label: 'Milk Cash Purchases', detail: `${dayPurchases.length} purchases`, amount: purchasesTotal },
                          { label: 'Material Cash Purchases', detail: `${dayMaterialPurchases.length} purchases`, amount: materialPurchasesTotal },
                          { label: 'Supplier Cash Payments', detail: `${daySupplierCashTx.length} payments`, amount: supplierCashTxTotal },
                          { label: 'Vendor / Staff Payments', detail: `${dayVendorPayments.length} payments`, amount: vendorPaymentsTotal },
                          { label: 'Cash Refunds', detail: `${dayPriorRefunds.length} refunds`, amount: refundsTotal }
                        ].filter(row => row.amount > 0 || row.label === 'Cash Expenses' || row.label === 'Milk Cash Purchases').map(row => (
                          <div key={row.label} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
                            <span className="font-bold text-slate-700 dark:text-slate-200 truncate">{row.label} <span className="text-slate-400 font-normal">· {row.detail}</span></span>
                            <span className="font-black text-slate-900 dark:text-white shrink-0">{money(row.amount)}</span>
                          </div>
                        ))}
                      </div>
                      {(dayExpenses.length > 0 || dayPurchases.length > 0 || dayMaterialPurchases.length > 0 || daySupplierCashTx.length > 0 || dayVendorPayments.length > 0 || dayPriorRefunds.length > 0) && (
                        <div className="max-h-36 overflow-y-auto bg-slate-50/70 dark:bg-slate-900/40 px-4 py-2 space-y-1">
                          {dayExpenses.map(expense => (
                            <p key={expense.id} className="text-[11px] text-slate-500 dark:text-slate-400 flex justify-between gap-3">
                              <span className="truncate">{expense.category || 'Expense'}{expense.vendor_name ? ` · ${expense.vendor_name}` : ''}{expense.description ? ` — ${expense.description}` : ''}</span>
                              <span className="font-bold shrink-0 text-rose-600 dark:text-rose-400">-{money(expense.paidAmount)}</span>
                            </p>
                          ))}
                          {dayPurchases.map(purchase => (
                            <p key={purchase.id} className="text-[11px] text-slate-500 dark:text-slate-400 flex justify-between gap-3">
                              <span className="truncate">Milk · {(purchase as any).supplier_name || 'Supplier'}</span>
                              <span className="font-bold shrink-0 text-rose-600 dark:text-rose-400">-{money(purchaseCashPaid(purchase))}</span>
                            </p>
                          ))}
                          {dayMaterialPurchases.map(mp => (
                            <p key={mp.id} className="text-[11px] text-slate-500 dark:text-slate-400 flex justify-between gap-3">
                              <span className="truncate">Material · {(mp as any).supplier_name || 'Supplier'} ({(mp as any).item_name || 'Supplies'})</span>
                              <span className="font-bold shrink-0 text-rose-600 dark:text-rose-400">-{money(materialCashPaid(mp))}</span>
                            </p>
                          ))}
                          {dayVendorPayments.map(evt => (
                            <p key={evt.id} className="text-[11px] text-slate-500 dark:text-slate-400 flex justify-between gap-3">
                              <span className="truncate">Vendor / Staff · {evt.vendor_name || evt.note || 'Vendor'}</span>
                              <span className="font-bold shrink-0 text-rose-600 dark:text-rose-400">-{money(evt.amount)}</span>
                            </p>
                          ))}
                          {daySupplierCashTx.map(stx => (
                            <p key={stx.id} className="text-[11px] text-slate-500 dark:text-slate-400 flex justify-between gap-3">
                              <span className="truncate">Supplier Payment · {(stx as any).note || (stx as any).supplier_name || 'Supplier'}</span>
                              <span className="font-bold shrink-0 text-rose-600 dark:text-rose-400">-{money(stx.amount)}</span>
                            </p>
                          ))}
                          {dayPriorRefunds.map(ev => (
                            <p key={ev.id} className="text-[11px] text-slate-500 dark:text-slate-400 flex justify-between gap-3">
                              <span className="truncate">Refund · {ev.event_type}</span>
                              <span className="font-bold shrink-0 text-rose-600 dark:text-rose-400">-{money(ev.amount)}</span>
                            </p>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
                      <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
                        <span className="font-bold text-slate-600 dark:text-slate-300 truncate">Remitted to head <span className="text-slate-400 font-normal">· {dayRemits.length} accepted</span></span>
                        <span className="font-black text-slate-900 dark:text-white shrink-0">-{money(remittedTotal)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
                        <span className="font-bold text-slate-600 dark:text-slate-300 shrink-0">Opening cash (edit karein)</span>
                        <input
                          type="number" min="0"
                          value={dayCashOpening}
                          onChange={event => setDayCashOpening(event.target.value)}
                          className="w-28 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs font-bold text-right text-slate-900 dark:text-white outline-none focus:border-lime-500"
                        />
                      </div>
                    </div>

                    <div className="rounded-2xl bg-slate-900 dark:bg-slate-950 text-white p-4 border border-slate-800">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-black tracking-wider text-slate-400">Expected cash in drawer</span>
                        <span className="text-lg font-black">{money(expectedCash)}</span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">Opening {money(openingCashNum)} + In {money(cashInTotal)} − Out {money(cashOutTotal)} − Remitted {money(remittedTotal)}</p>
                      <div className="mt-3">
                        <label className="text-[10px] uppercase font-black tracking-wider text-slate-400 block mb-1.5">Actual counted cash (Rs) — jo haath mein hai</label>
                        <div className="relative flex items-center">
                          <input
                            type="number" min="0"
                            value={dayCashCounted}
                            onChange={event => setDayCashCounted(event.target.value)}
                            placeholder={String(expectedCash)}
                            className="w-full rounded-xl bg-white/10 border border-white/20 pl-3.5 pr-11 py-2.5 text-sm font-bold text-white outline-none focus:border-lime-400 placeholder:text-slate-500"
                          />
                          <button aria-label="Note count — har note ginti"
                            type="button"
                            onClick={() => setDayCashDenomDialogOpen(true)}
                            className={`absolute right-1.5 p-2 rounded-lg cursor-pointer transition-all ${dayDenomTotal > 0 ? 'bg-lime-500 text-slate-950' : 'text-slate-300 hover:bg-white/10'}`}
                            title="Note count — har note ginti"
                          >
                            <Banknote size={18} />
                          </button>
                        </div>
                        {dayDenomTotal > 0 && <p className="text-[10px] text-lime-300 font-bold mt-1.5">Note breakdown: {money(dayDenomTotal)}</p>}
                        {dayCashVariance !== null && (
                          <div className={`mt-2 rounded-xl px-3 py-2 text-xs font-bold flex items-center gap-2 ${dayCashVariance === 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                            {dayCashVariance === 0 ? <CheckCircle2 size={14} className="shrink-0" /> : <AlertTriangle size={14} className="shrink-0" />}
                            {dayCashVariance === 0 ? 'Exact — counted cash expected ke barabar hai.' : `${dayCashVariance > 0 ? 'Over' : 'Short'} by ${money(Math.abs(dayCashVariance))} — variance record hoga.`}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {dayCloseTab === 'stock' && (
                  <div className="mt-3 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50/70 dark:bg-slate-800/40 flex items-center flex-wrap gap-2">
                      <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-300">Physical stock count</span>
                      {stockEntered > 0 && <span className="rounded-full bg-lime-100 dark:bg-lime-900/50 text-lime-700 dark:text-lime-300 px-2 py-0.5 text-[10px] font-black">{stockEntered} counted</span>}
                      {stockAdjustments > 0 && <span className="rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-[10px] font-black">{stockAdjustments} adjustment{stockAdjustments > 1 ? 's' : ''}</span>}
                    </div>
                    <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                      {dayCloseStockRows.map(row => {
                        const raw = dayCloseCounts[row.key] || '';
                        const hasValue = raw.trim() !== '';
                        const diff = hasValue ? roundQuantity(Number(raw) - row.system) : null;
                        return (
                          <div key={row.key} className="flex items-center gap-3 px-4 py-2">
                            <div className="min-w-0 flex-1">
                              <p className={`text-xs font-bold truncate ${row.variantId ? 'text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-white'}`}>{row.label}</p>
                              <p className="text-[10px] text-slate-400">System: {row.system} {row.unit}</p>
                            </div>
                            {diff !== null && (
                              <span className={`text-[10px] font-black rounded-full px-2 py-0.5 shrink-0 ${diff === 0 ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300' : diff > 0 ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300' : 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300'}`}>
                                {diff === 0 ? 'Match' : `${diff > 0 ? '+' : ''}${diff}`}
                              </span>
                            )}
                            <input
                              type="number" min="0"
                              value={raw}
                              onChange={event => setDayCloseCounts(prev => ({ ...prev, [row.key]: event.target.value }))}
                              placeholder="—"
                              className="w-24 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs font-bold text-right text-slate-900 dark:text-white outline-none focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20 shrink-0"
                            />
                          </div>
                        );
                      })}
                    </div>
                    <p className="px-4 py-2 text-[10px] text-slate-400 bg-slate-50/70 dark:bg-slate-800/40">Khali chhorna = koi adjustment nahi. Counted value system stock se mukhtalif ho to day close par adjustment inventory log ke sath apply hogi.</p>
                  </div>
                )}

                <label className="block text-xs font-bold text-slate-500 mt-4 mb-2">Close notes (optional)</label>
                <textarea
                  value={dayCloseNotes}
                  onChange={event => setDayCloseNotes(event.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm outline-none focus:border-lime-500"
                  placeholder="e.g. day ended clean, no discrepancy"
                />
              </div>
              <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2 shrink-0 bg-slate-50/70 dark:bg-slate-800/40">
                <button onClick={() => setDayCloseModal(null)} className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-xs font-black text-slate-600 dark:text-slate-300 hover:border-slate-400 cursor-pointer">Cancel</button>

                {/* Per-tab independent closing: sirf active tab ki closing hoti hai */}
                {dayCloseTab === 'cash' && (
                  day.cash_closed_at ? (
                    <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 px-4 py-2.5 text-xs font-black"><CheckCircle2 size={15} /> Cash closed ✓</span>
                  ) : (
                    <button
                      disabled={busy || isThisDayLocked}
                      onClick={() => run(async () => {
                        if (dayCountedNum === null) {
                          showToast('Cash close se pehle actual counted cash enter karein.', 'warning');
                          return false;
                        }
                        const ok = await closeDayCash(day.id, buildCashClose(dayCountedNum, dayCashVariance ?? 0, 'physical'), dayCloseNotes);
                        return ok;
                      })}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-900 dark:bg-lime-500 text-white dark:text-slate-950 disabled:opacity-50 px-5 py-2.5 text-xs font-black cursor-pointer shadow-sm"
                    >
                      <Banknote size={15} /> Close Cash
                    </button>
                  )
                )}
                {dayCloseTab === 'stock' && (
                  day.stock_closed_at ? (
                    <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 px-4 py-2.5 text-xs font-black"><CheckCircle2 size={15} /> Stock closed ✓</span>
                  ) : (
                    <button
                      disabled={busy || isThisDayLocked}
                      onClick={() => run(async () => {
                        const entries = Object.keys(dayCloseCounts)
                          .filter(key => (dayCloseCounts[key] || '').trim() !== '')
                          .map(key => {
                            const [itemId, variantId] = key.split('::');
                            return { itemId, variantId, counted: Number(dayCloseCounts[key]) };
                          });
                        const ok = await closeDayStock(day.id, entries);
                        if (ok) setDayCloseCounts({});
                        return ok;
                      })}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-900 dark:bg-lime-500 text-white dark:text-slate-950 disabled:opacity-50 px-5 py-2.5 text-xs font-black cursor-pointer shadow-sm"
                    >
                      <PackageSearch size={15} /> Apply & Close Stock
                    </button>
                  )
                )}

                {/* Final lock — poora din band (dono closings jo baqi hain wo complete mark ho jati hain) */}
                <button
                  disabled={busy}
                  onClick={() => run(async () => {
                    const cashClose = (!day.cash_closed_at || dayCountedNum !== null)
                      ? buildCashClose(
                        dayCountedNum ?? expectedCash,
                        dayCountedNum !== null ? (dayCashVariance ?? 0) : 0,
                        dayCountedNum !== null ? 'physical' : 'expected'
                      )
                      : undefined;
                    const ok = await closeBusinessDay(day.id, dayCloseNotes, cashClose);
                    if (ok) {
                      setDayCloseModal(null); setDayCloseNotes(''); setDayCloseCounts({});
                      setDayCashCounted(''); setDayCashDenoms({}); setDayCashOpening('');
                    }
                    return ok;
                  })}
                  className="inline-flex items-center gap-2 rounded-xl bg-lime-500 hover:bg-lime-400 disabled:opacity-50 px-5 py-2.5 text-xs font-black text-slate-950 cursor-pointer shadow-sm"
                >
                  <LockKeyhole size={15} /> Lock Day
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

const EmptyState: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => <div className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-10 text-center text-slate-400"><div className="flex justify-center mb-3">{icon}</div><p className="text-sm font-bold">{text}</p></div>;

export default CashControl;
