import React, { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowRight, Banknote, ChevronDown, Clock, Receipt, ShoppingCart, Truck, Wallet, CircleHelp } from 'lucide-react';
import { Button, Money } from './ui';
import { cn } from '../lib/cn';
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

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

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

  const detailLink = (label: string, tab: ShiftActivityTab, category?: string) => (
    <button type="button" onClick={() => onDetails(tab, category)} className={cn('inline-flex items-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-fg-muted hover:text-brand-fg', FOCUS)}>
      {label}<ArrowRight size={13} />
    </button>
  );

  const items = (entries: FlowItem[], direction: 'in' | 'out', empty: string) => (
    <div className="space-y-2">
      {entries.length ? entries.slice(0, 5).map(item => (
        <div key={item.id} className="flex items-start justify-between gap-3 text-xs">
          <div className="min-w-0">
            <p className="break-words font-medium text-fg-muted">{item.partyName || item.title}</p>
            <p className="mt-0.5 text-[11px] text-fg-subtle">{item.category || item.source}</p>
          </div>
          <Money amount={direction === 'in' ? item.amount : -Number(item.amount || 0)} tone="signed" className="shrink-0 font-semibold" />
        </div>
      )) : <p className="text-xs text-fg-subtle">{empty}</p>}
      {entries.length > 5 && <p className="text-[11px] text-fg-subtle">{entries.length - 5} more transactions in full details</p>}
    </div>
  );

  const row = (key: string, title: string, subtitle: string, amount: number, direction: 'in' | 'out', Icon: typeof Receipt, children: React.ReactNode) => (
    <div className="border-t border-line first:border-t-0">
      <button
        type="button"
        aria-expanded={!!expanded[key]}
        aria-controls={`shift-flow-${key}`}
        onClick={() => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))}
        className={cn('flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-2/70 sm:px-4', FOCUS)}
      >
        <span className={cn('hidden size-9 shrink-0 items-center justify-center rounded-xl min-[400px]:flex', direction === 'in' ? 'bg-success-soft text-success-fg' : 'bg-danger-soft text-danger-fg')}>
          <Icon size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-fg">{title}</span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-fg-subtle">{subtitle}</span>
        </span>
        <Money amount={direction === 'in' ? amount : -amount} tone="signed" className="shrink-0 text-sm font-bold" />
        <ChevronDown size={15} className={cn('shrink-0 text-fg-faint transition-transform motion-reduce:transition-none', expanded[key] && 'rotate-180')} />
      </button>
      {expanded[key] && <div id={`shift-flow-${key}`} className="mx-3.5 mb-3.5 rounded-control bg-surface-2 p-3.5 ring-1 ring-inset ring-line/70 sm:ml-16">{children}</div>}
    </div>
  );

  const adjustments = row('adjustments', adjustmentIn ? 'Other cash adjustments' : 'Returns & other cash out', 'Additional movements affecting this drawer', Math.abs(d.adjustments), adjustmentIn ? 'in' : 'out', ArrowUpRight,
    <p className="text-xs leading-relaxed text-fg-subtle">Includes prior-shift cash returns and other drawer movements. Returns already included in net cash sales are not deducted again.</p>);

  return (
    <section className="min-w-0 space-y-3" aria-label="Shift cash overview">
      <div className="overflow-hidden rounded-card border border-line bg-surface shadow-e1">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
            <Wallet size={16} className="shrink-0 text-brand-accent" />
            <span className="truncate">{drawerName}</span>
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-fg-subtle"><Clock size={12} />Since {startedAt}</span>
        </div>
        <div className="px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Expected cash in drawer</p>
              <p className="mt-1.5 text-3xl font-bold tracking-tight tabular-nums text-fg [overflow-wrap:anywhere] sm:text-4xl"><Money amount={d.expectedCash} /></p>
            </div>
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand-fg"><Banknote size={24} /></span>
          </div>
          <div className="mt-4 grid grid-cols-3 divide-x divide-line rounded-control bg-surface-2 py-3 ring-1 ring-inset ring-line/70">
            {[
              { label: 'Opening', symbol: '=', amount: d.openingFloat, tone: 'plain' as const },
              { label: 'Cash in', symbol: '+', amount: cashIn, tone: 'signed' as const },
              { label: 'Cash out', symbol: '−', amount: -cashOut, tone: 'signed' as const },
            ].map(item => (
              <div key={item.label} className="min-w-0 px-2 sm:px-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle"><span className="mr-1" aria-hidden="true">{item.symbol}</span>{item.label}</p>
                <p className="mt-1 text-xs font-bold [overflow-wrap:anywhere] min-[400px]:text-sm sm:text-base">
                  <Money amount={item.amount} tone={item.tone} className={cn('whitespace-normal', item.tone === 'plain' && 'text-fg')} />
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-0.5">
        <div>
          <h4 className="text-sm font-bold text-fg">How cash moved</h4>
          <p className="mt-0.5 text-[11px] text-fg-subtle">Tap a row to see its breakdown</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setExpanded(allExpanded ? {} : Object.fromEntries(keys.map(key => [key, true])))}>
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </Button>
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-surface shadow-e1">
        <div className="flex items-center justify-between border-b border-line bg-success-soft/60 px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-success-fg"><ArrowDownLeft size={15} />Cash in</span>
          <Money amount={cashIn} tone="signed" className="text-xs font-bold" />
        </div>
        {row('sales', 'Cash from sales', `${d.billsCount} total bills · after sales returns`, d.netCashSales, 'in', ShoppingCart, <>
          <div className="space-y-2 text-xs text-fg-muted">
            {([['Total sales', d.grossSales], ['Credit / khata', d.creditSales], ['Online / bank', d.onlineSales]] as const).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3"><span>{label}</span><Money amount={value} className="font-semibold" /></div>
            ))}
            <div className="flex justify-between gap-3 border-t border-line pt-2 font-bold text-success-fg"><span>Net drawer cash</span><Money amount={d.netCashSales} /></div>
          </div>
          <p className="mt-2 text-[11px] text-fg-subtle">Credit and online payments do not add cash to this drawer.</p>
          <div className="mt-1 flex flex-wrap gap-x-4">{detailLink('All bills', 'bills')}{detailLink('Cash sales', 'sales')}</div>
        </>)}
        {row('collections', 'Collections & other receipts', `${d.collectionsList.length} receipts · customer dues & other cash in`, d.totalCollections, 'in', Receipt, <>
          {items(d.collectionsList, 'in', 'No customer collections in this shift.')}
          {Math.abs(unlistedOtherIn) >= 0.01 && (
            <div className="mt-2 flex justify-between gap-2 text-xs text-fg-muted"><span>Other cash received</span><Money amount={unlistedOtherIn} tone="signed" className="font-semibold" /></div>
          )}
          {detailLink('View receipts', 'collections')}
        </>)}
        {adjustmentIn > 0 && adjustments}
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-surface shadow-e1">
        <div className="flex items-center justify-between border-b border-line bg-danger-soft/60 px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-danger-fg"><ArrowUpRight size={15} />Cash out</span>
          <Money amount={-cashOut} tone="signed" className="text-xs font-bold" />
        </div>
        {row('vendors', 'Vendors & suppliers', 'Milk purchases & supplier payments', d.vendorPayouts, 'out', Truck, <>
          {items(d.vendorItems, 'out', d.vendorPayouts ? 'Purchase total included; itemized payouts are unavailable.' : 'No vendor or supplier payouts in this shift.')}
          {detailLink('View payouts', 'expenses')}
        </>)}
        {row('expenses', 'Shop expenses & purchases', 'Petty cash, supplies & packaging', d.shopExpenses, 'out', Wallet, <>
          {items(d.shopExpenseItems, 'out', d.shopExpenses ? 'Expense total included; itemized payouts are unavailable.' : 'No shop expenses in this shift.')}
          {detailLink('View expenses', 'expenses')}
        </>)}
        {adjustmentOut > 0 && adjustments}
      </div>
      <p className="flex items-start gap-1.5 px-1 text-[11px] leading-relaxed text-fg-subtle">
        <CircleHelp size={13} className="mt-0.5 shrink-0" />
        <span>Only physical cash affects this balance. Credit / khata: <Money amount={d.creditSales} className="font-semibold text-fg-muted" /> · Online / bank: <Money amount={d.onlineSales} className="font-semibold text-fg-muted" /></span>
      </p>
    </section>
  );
}
