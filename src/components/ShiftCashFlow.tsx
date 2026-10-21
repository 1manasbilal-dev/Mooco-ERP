import React, { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowRight, Banknote, ChevronDown, Clock, Receipt, ShoppingCart, Truck, Wallet, CircleHelp } from 'lucide-react';
import { money } from './DenominationDialog';
import type { ShiftActivityTab } from './PosShiftActivityDialog';

interface FlowItem {
  id: string;
  title: string;
  partyName?: string;
  amount: number;
  category?: string;
  source?: string;
}

interface ShiftCashFlowProps {
  drawerName: string;
  startedAt: string;
  data: {
    openingFloat: number;
    grossSales: number;
    creditSales: number;
    onlineSales: number;
    netCashSales: number;
    billsCount: number;
    vendorPayouts: number;
    vendorItems: FlowItem[];
    shopExpenses: number;
    shopExpenseItems: FlowItem[];
    cashCollections: number;
    collectionsList: FlowItem[];
    otherCashIn: number;
    totalCollections: number;
    adjustments: number;
    expectedCash: number;
  };
  onDetails: (tab: ShiftActivityTab, category?: string) => void;
}

/** Cash-only overview. Net sales already include this shift's sales returns. */
export function ShiftCashFlow({ drawerName, startedAt, data: d, onDetails }: ShiftCashFlowProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const adjustmentIn = Math.max(0, d.adjustments);
  const adjustmentOut = Math.max(0, -d.adjustments);
  const listedOtherIn = d.collectionsList
    .filter(item => item.source !== 'Customer Ledger' && item.category !== 'Customer Ledger' && item.source !== 'Daily Delivery' && item.category !== 'Daily Delivery')
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const unlistedOtherIn = Math.round((d.otherCashIn - listedOtherIn) * 100) / 100;
  const cashIn = d.netCashSales + d.totalCollections + adjustmentIn;
  const cashOut = d.vendorPayouts + d.shopExpenses + adjustmentOut;
  const keys = ['sales', 'collections', 'vendors', 'expenses', ...(d.adjustments ? ['adjustments'] : [])];
  const allExpanded = keys.every(key => expanded[key]);
  const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500';

  const detailLink = (label: string, tab: ShiftActivityTab, category?: string) => (
    <button type="button" onClick={() => onDetails(tab, category)} className={`inline-flex items-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-slate-700 hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-400 ${focus}`}>
      {label}<ArrowRight size={13} />
    </button>
  );

  const items = (entries: FlowItem[], direction: 'in' | 'out', empty: string) => (
    <div className="space-y-2">
      {entries.length ? entries.slice(0, 5).map(item => (
        <div key={item.id} className="flex items-start justify-between gap-3 text-xs">
          <div className="min-w-0">
            <p className="font-medium text-slate-700 dark:text-slate-200 break-words">{item.partyName || item.title}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{item.category || item.source}</p>
          </div>
          <span className="shrink-0 tabular-nums font-semibold text-slate-700 dark:text-slate-300">{direction === 'in' ? '+' : '−'}{money(item.amount)}</span>
        </div>
      )) : <p className="text-xs text-slate-500">{empty}</p>}
      {entries.length > 5 && <p className="text-[11px] text-slate-500">{entries.length - 5} more transactions in full details</p>}
    </div>
  );

  const row = (key: string, title: string, subtitle: string, amount: number, direction: 'in' | 'out', Icon: typeof Receipt, children: React.ReactNode) => (
    <div className="border-t border-slate-100 first:border-t-0 dark:border-slate-800">
      <button type="button" aria-expanded={!!expanded[key]} aria-controls={`shift-flow-${key}`} onClick={() => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))}
        className={`flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60 sm:px-4 ${focus}`}>
        <span className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl min-[400px]:flex ${direction === 'in' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400' : 'bg-rose-50 text-rose-500 dark:bg-rose-950/40 dark:text-rose-400'}`}><Icon size={17} /></span>
        <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">{title}</span><span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{subtitle}</span></span>
        <span className={`shrink-0 text-sm font-bold tabular-nums ${amount === 0 ? 'text-slate-400' : direction === 'in' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{amount === 0 ? '' : direction === 'in' ? '+' : '−'}{money(amount)}</span>
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform motion-reduce:transition-none ${expanded[key] ? 'rotate-180' : ''}`} />
      </button>
      {expanded[key] && <div id={`shift-flow-${key}`} className="mx-3.5 mb-3.5 rounded-xl bg-slate-50 p-3.5 dark:bg-slate-800/60 sm:ml-16">{children}</div>}
    </div>
  );

  const adjustments = row('adjustments', adjustmentIn ? 'Other cash adjustments' : 'Returns & other cash out', 'Additional movements affecting this drawer', Math.abs(d.adjustments), adjustmentIn ? 'in' : 'out', ArrowUpRight,
    <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">Includes prior-shift cash returns and other drawer movements. Returns already included in net cash sales are not deducted again.</p>);

  return (
    <section className="min-w-0 space-y-3" aria-label="Shift cash overview">
      <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 px-4 py-3 dark:border-emerald-900/60 sm:px-5">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100"><Wallet size={16} className="text-emerald-600" />{drawerName}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400"><Clock size={12} />Since {startedAt}</span>
        </div>
        <div className="px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-800 dark:text-emerald-400">Expected cash in drawer</p><p className="mt-1.5 text-3xl [overflow-wrap:anywhere] font-bold tracking-tight tabular-nums text-emerald-900 dark:text-emerald-300 sm:text-4xl">{money(d.expectedCash)}</p></div>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-200 bg-white/70 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-900/40"><Banknote size={25} /></span>
          </div>
          <div className="mt-3 grid grid-cols-3 divide-x divide-emerald-200/70 rounded-xl border border-emerald-200/70 bg-white/80 py-3 dark:divide-emerald-900 dark:border-emerald-900 dark:bg-slate-900/70">
            {[
              { label: 'Opening', value: d.openingFloat, symbol: '=', color: 'text-slate-700 dark:text-slate-200' },
              { label: 'Cash in', value: cashIn, symbol: '+', color: 'text-emerald-700 dark:text-emerald-400' },
              { label: 'Cash out', value: cashOut, symbol: '−', color: 'text-rose-600 dark:text-rose-400' },
            ].map(item => <div key={item.label} className="min-w-0 px-2 sm:px-4"><p className={`text-[10px] font-semibold uppercase tracking-wide ${item.color}`}><span className="mr-1">{item.symbol}</span>{item.label}</p><p className={`mt-1 text-xs [overflow-wrap:anywhere] font-bold tabular-nums min-[400px]:text-sm sm:text-base ${item.color}`}>{money(item.value)}</p></div>)}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-0.5"><div><h4 className="text-sm font-bold text-slate-900 dark:text-white">How cash moved</h4><p className="mt-0.5 text-[11px] text-slate-500">Tap a row to see its breakdown</p></div><button type="button" onClick={() => setExpanded(allExpanded ? {} : Object.fromEntries(keys.map(key => [key, true])))} className={`rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${focus}`}>{allExpanded ? 'Collapse all' : 'Expand all'}</button></div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between bg-emerald-50/70 px-4 py-2.5 dark:bg-emerald-950/30"><span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-400"><ArrowDownLeft size={15} />Cash in</span><span className="text-xs font-bold tabular-nums text-emerald-700 dark:text-emerald-400">+{money(cashIn)}</span></div>
        {row('sales', 'Cash from sales', `${d.billsCount} total bills · after sales returns`, d.netCashSales, 'in', ShoppingCart, <>
          <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
            {([['Total sales', d.grossSales], ['Credit / khata', d.creditSales], ['Online / bank', d.onlineSales]] as const).map(([label, value]) => <div key={label} className="flex justify-between gap-3"><span>{label}</span><span className="font-semibold tabular-nums">{money(value)}</span></div>)}
            <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 font-bold text-emerald-700 dark:border-slate-700 dark:text-emerald-400"><span>Net drawer cash</span><span className="tabular-nums">{money(d.netCashSales)}</span></div>
          </div><p className="mt-2 text-[11px] text-slate-500">Credit and online payments do not add cash to this drawer.</p><div className="mt-1 flex flex-wrap gap-x-4">{detailLink('All bills', 'bills')}{detailLink('Cash sales', 'sales')}</div>
        </>)}
        {row('collections', 'Collections & other receipts', `${d.collectionsList.length} receipts · customer dues & other cash in`, d.totalCollections, 'in', Receipt, <>{items(d.collectionsList, 'in', 'No customer collections in this shift.')}{Math.abs(unlistedOtherIn) >= 0.01 && <div className="mt-2 flex justify-between gap-2 text-xs text-slate-600 dark:text-slate-300"><span>Other cash received</span><span className="font-semibold tabular-nums">+{money(unlistedOtherIn)}</span></div>}{detailLink('View receipts', 'collections')}</>)}
        {adjustmentIn > 0 && adjustments}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between bg-rose-50/70 px-4 py-2.5 dark:bg-rose-950/20"><span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400"><ArrowUpRight size={15} />Cash out</span><span className="text-xs font-bold tabular-nums text-rose-600 dark:text-rose-400">−{money(cashOut)}</span></div>
        {row('vendors', 'Vendors & suppliers', 'Milk purchases & supplier payments', d.vendorPayouts, 'out', Truck, <>{items(d.vendorItems, 'out', d.vendorPayouts ? 'Purchase total included; itemized payouts are unavailable.' : 'No vendor or supplier payouts in this shift.')}{detailLink('View payouts', 'expenses')}</>)}
        {row('expenses', 'Shop expenses & purchases', 'Petty cash, supplies & packaging', d.shopExpenses, 'out', Wallet, <>{items(d.shopExpenseItems, 'out', d.shopExpenses ? 'Expense total included; itemized payouts are unavailable.' : 'No shop expenses in this shift.')}{detailLink('View expenses', 'expenses')}</>)}
        {adjustmentOut > 0 && adjustments}
      </div>
      <p className="flex items-start gap-1.5 px-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400"><CircleHelp size={13} className="mt-0.5 shrink-0" /><span>Only physical cash affects this balance. Credit / khata: <strong className="font-semibold">{money(d.creditSales)}</strong> · Online / bank: <strong className="font-semibold">{money(d.onlineSales)}</strong></span></p>
    </section>
  );
}
