import React, { memo, useEffect, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarDays, CheckCircle2, ChevronRight,
  CircleHelp, ClipboardCheck, Droplets, Factory, Layers, Package, Receipt, SlidersHorizontal, Store, TrendingUp,
  Truck, Users, Wallet, X,
} from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, IconButton, Money, StatCard, type Tone } from '../ui';
import { cn } from '../../lib/cn';
import { formatCurrency, formatQty } from '../../lib/formatters';
import { RETAIL_CHILLER_CAPACITY, type RetailMilkStockSummary } from '../../lib/retailMilkStock';
import type { Customer } from '../../types';
import type {
  ActivityEntry, AlertIcon, BalanceSummary, DashboardAlert, ExpenseSummary, MilkFlow, MilkSummary, PartyFlows, SalesSummary, TopProduct,
} from './dashboardData';
import { dayKey, shortDay } from './dashboardData';

/** Module ids the dashboard links to; `true` when the signed-in user may open them. */
export type Access = Record<string, boolean>;
export type Go = (target: string | { id: string; path: string }) => void;

const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0);

/** Thin meter: the fill carries the value, the track is a lighter step of the same colour. */
function Meter({ value, tone = 'brand', className, label }: { value: number; tone?: 'brand' | 'danger' | 'info'; className?: string; label?: string }) {
  const fill = tone === 'danger' ? 'bg-danger' : tone === 'info' ? 'bg-info' : 'bg-brand-accent';
  const track = tone === 'danger' ? 'bg-danger/15' : tone === 'info' ? 'bg-info/15' : 'bg-brand-accent/15';
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full', track, className)} role={label ? 'meter' : undefined} aria-label={label} aria-valuenow={label ? Math.round(value) : undefined} aria-valuemin={label ? 0 : undefined} aria-valuemax={label ? 100 : undefined}>
      <div className={cn('h-full rounded-full transition-[width] duration-500 ease-out-expo', fill)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

/** Row link used inside cards: label left, value right, chevron when it navigates. */
const LinkRow: React.FC<{ label: React.ReactNode; value: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string }> = ({ label, value, onClick, disabled, className }) => {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
      className={cn(
        'flex w-full min-w-0 items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-[13px] text-fg-muted',
        onClick && 'cursor-pointer transition-colors hover:bg-surface-2 hover:text-fg disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">{label}</span>
      <span className="flex shrink-0 items-center gap-1 font-semibold tabular-nums text-fg">{value}{onClick && !disabled && <ChevronRight className="size-3.5 text-fg-faint" aria-hidden="true" />}</span>
    </Comp>
  );
};

/** Card footer link ("Explore sales history →"). */
function CardLink({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="mt-auto border-t border-line px-3 py-2">
      <Button variant="ghost" size="sm" fullWidth className="justify-between" rightIcon={<ArrowRight />} onClick={onClick} disabled={disabled}>{children}</Button>
    </div>
  );
}

/* ------------------------------------------------------------------ hero tools */

export const PANELS = { products: 'Best sellers', collections: 'Collection priorities', expenses: 'Expense breakdown', activity: 'Recent activity' } as const;
export type PanelKey = keyof typeof PANELS;

export const CustomizeMenu = memo(function CustomizeMenu({ visible, onToggle }: { visible: Record<PanelKey, boolean>; onToggle: (key: PanelKey) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="sm" leftIcon={<SlidersHorizontal />} onClick={() => setOpen(v => !v)} aria-expanded={open} aria-controls="dashboard-customize" aria-label="Customize">
        <span className="hidden sm:inline">Customize</span>
      </Button>
      {open && (
        <div id="dashboard-customize" className="absolute right-0 top-10 z-30 w-64 rounded-card border border-line bg-surface p-4 shadow-e2 animate-fade-up">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-fg">Make it yours</p>
            <IconButton size="sm" icon={<X />} aria-label="Close customization" onClick={() => setOpen(false)} />
          </div>
          <p className="mb-2 text-xs text-fg-subtle">Choose what appears in your overview.</p>
          {(Object.entries(PANELS) as [PanelKey, string][]).map(([key, label]) => (
            <label key={key} className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2 text-[13px] text-fg-muted hover:text-fg">
              <input type="checkbox" className="size-4 accent-brand" checked={visible[key]} onChange={() => onToggle(key)} />
              {label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ KPIs */

interface KpiProps {
  sales: SalesSummary;
  milk: MilkSummary;
  expenses: ExpenseSummary;
  surplus: number;
  margin: number;
  salesTrend: { trend: number | null; trendLabel: string };
  milkTrend: { trend: number | null; trendLabel: string };
  expenseTrend: { trend: number | null; trendLabel: string };
  /** Wide screens have room for averages next to the counts. */
  roomy: boolean;
  access: Access;
  go: Go;
  onMilk: () => void;
}

/** Phones get "Rs 1.2M" for seven-figure amounts so the tile never cuts the number; the exact value stays in the tooltip. */
const KpiMoney = ({ amount, roomy }: { amount: number; roomy: boolean }) => <Money amount={amount} compact={!roomy && Math.abs(amount) >= 1_000_000} />;

const SURPLUS_HELP = 'Estimate: sales less milk procurement and operating expenses. Excludes inventory timing, material costs and tax.';

export const KpiGrid = memo(function KpiGrid({ sales, milk, expenses, surplus, margin, salesTrend, milkTrend, expenseTrend, roomy, access, go, onMilk }: KpiProps) {
  const bills = `${sales.billCount} ${sales.billCount === 1 ? 'bill' : 'bills'}${sales.supplyCount ? ` + ${sales.supplyCount} supply` : ''}`;
  const expenseShare = sales.total > 0 ? `${formatQty((expenses.total / sales.total) * 100, 1)}% of sales` : `${expenses.count} entries`;
  // Phone tiles are ~140px wide: the badge and a count fit; "vs yesterday" lives in the period line above.
  const label = (trend: { trend: number | null; trendLabel: string }) => (roomy || trend.trend === null ? trend.trendLabel : undefined);
  return (
    <section aria-label="Business summaries" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label={roomy ? 'Total sales' : 'Sales'} icon={<Store />} tone="brand"
        value={<KpiMoney amount={sales.total} roomy={roomy} />}
        trend={salesTrend.trend} trendLabel={label(salesTrend)}
        hint={roomy && sales.avgBill > 0 ? `${bills} · avg ${formatCurrency(Math.round(sales.avgBill))}` : bills}
        onClick={access['sales-history'] ? () => go('sales-history') : undefined}
      />
      <StatCard
        label="Milk collected" icon={<Droplets />} tone="info"
        value={<>{formatQty(milk.liters)}<span className="ml-1 text-base font-semibold text-fg-subtle">L</span></>}
        trend={milkTrend.trend} trendLabel={label(milkTrend)}
        hint={roomy && milk.avgRate > 0 ? `${milk.count} collections · ${formatCurrency(Math.round(milk.avgRate))}/L` : roomy ? `${milk.count} collections` : `${milk.count} slips`}
        onClick={onMilk}
      />
      <StatCard
        label={roomy ? 'Operating expenses' : 'Expenses'} icon={<Receipt />} tone="neutral"
        value={<KpiMoney amount={expenses.total} roomy={roomy} />}
        trend={expenseTrend.trend} trendGoodWhen="down" trendLabel={label(expenseTrend)}
        hint={roomy ? expenseShare : undefined}
        onClick={access.expenses ? () => go('expenses') : undefined}
      />
      <StatCard
        label={<span className="inline-flex items-center gap-1" title={SURPLUS_HELP}>{roomy ? 'Operating surplus' : 'Surplus'}<CircleHelp className="size-3.5 shrink-0 text-fg-faint" aria-label={SURPLUS_HELP} /></span>}
        icon={<TrendingUp />} tone={surplus < 0 ? 'danger' : 'brand'}
        value={<KpiMoney amount={surplus} roomy={roomy} />}
        trendLabel={sales.total > 0 ? `${formatQty(margin, 1)}% margin` : 'No sales yet'}
        hint={roomy ? 'Estimate' : undefined}
      />
    </section>
  );
});

/* ------------------------------------------------------------------ attention */

const ALERT_ICONS: Record<AlertIcon, React.ElementType> = {
  late: AlertTriangle, today: CalendarDays, order: ClipboardCheck, stock: Package, delivery: Truck,
  ready: CheckCircle2, milk: Droplets, cash: Wallet, bills: Receipt, error: AlertTriangle,
};
const ALERT_TONES: Record<DashboardAlert['tone'], string> = {
  danger: 'bg-danger-soft text-danger-fg', warning: 'bg-warning-soft text-warning-fg', info: 'bg-info-soft text-info-fg', neutral: 'bg-surface-2 text-fg-muted',
};

export const AttentionCard = memo(function AttentionCard({ alerts, access, go }: { alerts: DashboardAlert[]; access: Access; go: Go }) {
  if (!alerts.length) {
    return (
      <div className="flex items-center gap-3 rounded-card border border-success/20 bg-success-soft px-4 py-3 text-success-fg" role="status">
        <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
        <p className="text-[13px]"><span className="font-bold">You’re all caught up.</span> <span className="opacity-80">No stock, order, allocation or cash alerts.</span></p>
      </div>
    );
  }
  return (
    <Card aria-label="Business priorities">
      <CardHeader
        icon={<AlertTriangle />}
        title="Needs your attention"
        description={`${alerts.length} ${alerts.length === 1 ? 'thing' : 'things'} to keep your dairy moving`}
      />
      <CardBody>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {alerts.map(alert => {
            const Icon = ALERT_ICONS[alert.icon];
            const allowed = Boolean(access[alert.module]);
            return (
              <li key={alert.id}>
                <button
                  type="button"
                  disabled={!allowed}
                  onClick={() => go(alert.path || alert.module)}
                  className="group flex h-full w-full cursor-pointer items-center gap-3 rounded-control border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-surface-2 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-[18px]', ALERT_TONES[alert.tone])}><Icon aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-fg">{alert.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-fg-subtle">{alert.detail}</span>
                  </span>
                  {allowed && <ChevronRight className="size-4 shrink-0 text-fg-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
});

/* ------------------------------------------------------------------ retail stock */

export const RetailStockCard = memo(function RetailStockCard({ stock }: { stock: RetailMilkStockSummary }) {
  const fill = pct(stock.liters, RETAIL_CHILLER_CAPACITY);
  const negative = stock.liters < 0;
  const over = stock.liters > RETAIL_CHILLER_CAPACITY;
  return (
    <Card aria-label="Current retail milk stock" className="flex flex-col">
      <CardHeader eyebrow="Ready for the counter" title="Retail milk stock" actions={<Badge tone="brand" dot>Current</Badge>} />
      <CardBody className="flex flex-1 flex-col gap-5">
        <div>
          <p className={cn('text-4xl font-bold tracking-tight', negative ? 'text-danger-fg' : 'text-fg')}>
            {formatQty(stock.liters)}<span className="ml-1 text-lg font-semibold text-fg-subtle">L</span>
          </p>
          <p className="mt-1 text-[13px] text-fg-subtle">Available to sell now</p>
        </div>
        <div className="space-y-2">
          <Meter value={fill} tone={negative || over ? 'danger' : 'brand'} label="Retail tank fill" />
          <p className={cn('text-xs', negative || over ? 'font-semibold text-danger-fg' : 'text-fg-subtle')}>
            {negative ? 'Negative balance · check stock'
              : over ? `${formatQty(stock.liters - RETAIL_CHILLER_CAPACITY)} L over capacity`
                : `${formatQty(fill, 1)}% of ${RETAIL_CHILLER_CAPACITY} L tank`}
          </p>
        </div>
        {stock.rows.length > 0 ? (
          <ul className="max-h-56 space-y-3 overflow-y-auto pr-1">
            {stock.rows.map(row => (
              <li key={row.id} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate text-fg-muted">{row.name}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-fg">{formatQty(row.liters)} <span className="text-xs font-medium text-fg-subtle">L</span></span>
                </div>
                <Meter value={row.percentOfTotal} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState size="compact" icon={<Droplets />} title="No retail milk in stock" description="Allocate milk to the counter to start selling." />
        )}
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-4 text-[13px]">
          <span className="text-fg-subtle">Retail stock value</span>
          <Money amount={stock.totalValue} className="font-bold text-fg" />
        </div>
      </CardBody>
    </Card>
  );
});

/* ------------------------------------------------------------------ collections */

export const CollectionsCard = memo(function CollectionsCard({ sales, periodText, access, go }: { sales: SalesSummary; periodText: string; access: Access; go: Go }) {
  const collected = sales.cash + sales.online;
  const rate = pct(collected, sales.total);
  const parts = [
    { key: 'cash', label: 'Cash', amount: sales.cash, swatch: 'bg-brand-accent' },
    { key: 'online', label: 'Online', amount: sales.online, swatch: 'bg-info' },
    { key: 'credit', label: 'Credit / khata', amount: sales.credit, swatch: 'bg-danger' },
  ];
  return (
    <Card aria-label="Sales payment breakdown">
      <CardHeader icon={<Wallet />} title="Sales collections" description={`${periodText} · ${formatQty(rate, 1)}% collected`} />
      <CardBody className="space-y-4">
        {/* Part-to-whole: 2px surface gaps separate the segments. */}
        <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
          {sales.total > 0 && parts.map(part => part.amount > 0 && (
            <span key={part.key} className={cn('h-full first:rounded-l-full last:rounded-r-full', part.swatch)} style={{ width: `${pct(part.amount, sales.total)}%` }} />
          ))}
        </div>
        {/* Three columns while the card is full width; a list once it sits in the narrow column (xl). */}
        <div className="-mx-2 grid gap-1 sm:grid-cols-3 sm:gap-3 xl:grid-cols-1 xl:gap-0">
          {parts.map(part => {
            const label = <><span className={cn('size-2 shrink-0 rounded-full', part.swatch)} aria-hidden="true" /><span className="whitespace-nowrap">{part.label}</span><span className="text-xs text-fg-faint tabular-nums">{formatQty(pct(part.amount, sales.total), 0)}%</span></>;
            const value = <Money amount={part.amount} className={part.key === 'credit' && part.amount > 0 ? 'text-danger-fg' : undefined} />;
            const layout = 'sm:flex-col sm:items-start sm:gap-1 xl:flex-row xl:items-center xl:gap-3';
            return part.key === 'credit'
              ? <LinkRow key={part.key} label={label} value={value} onClick={() => go('customers')} disabled={!access.customers} className={layout} />
              : <LinkRow key={part.key} label={label} value={value} className={layout} />;
          })}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line pt-3 text-[13px]">
          <span className="text-fg-subtle">Total sales</span>
          <Money amount={sales.total} className="font-bold text-fg" />
        </div>
      </CardBody>
    </Card>
  );
});

/* ------------------------------------------------------------------ milk journey */

export const MilkJourneyCard = memo(function MilkJourneyCard({ milk, flow, periodText, access, go }: { milk: MilkSummary; flow: MilkFlow; periodText: string; access: Access; go: Go }) {
  const period = periodText.toLowerCase();
  const steps = [
    { title: 'Milk collected', amount: milk.liters, note: `${milk.count} entries · ${period}`, icon: Droplets, module: 'purchase' },
    { title: 'In chilling tank', amount: flow.unallocated, note: 'Current · awaiting allocation', icon: Layers, module: 'allocation' },
    { title: 'Sent to retail', amount: flow.retailAllocated, note: `Allocated · ${period}`, icon: Store, module: 'allocation' },
    { title: 'Production input', amount: flow.productionInput, note: `Milk used · ${period}`, icon: Factory, module: 'production' },
  ];
  return (
    <Card aria-label="Milk journey">
      <CardHeader
        eyebrow="From collection to counter" title="The milk journey"
        actions={<Button variant="ghost" size="sm" rightIcon={<ArrowUpRight />} onClick={() => go('allocation')} disabled={!access.allocation}>Manage allocation</Button>}
      />
      <CardBody>
        <ol className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {steps.map((step, index) => (
            <li key={step.title}>
              <button
                type="button"
                onClick={() => go(step.module)}
                disabled={!access[step.module]}
                className="flex h-full w-full cursor-pointer flex-col gap-3 rounded-control border border-line/70 bg-surface-2 p-3.5 text-left transition-colors hover:border-line-strong disabled:cursor-default disabled:hover:border-line/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4"
              >
                <span className="flex items-center justify-between">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-surface text-info-fg shadow-e1 [&_svg]:size-4"><step.icon aria-hidden="true" /></span>
                  <span className="text-[11px] font-semibold tabular-nums text-fg-faint">0{index + 1}</span>
                </span>
                <span className="text-xs font-semibold text-fg-muted">{step.title}</span>
                <span className="text-2xl font-bold tracking-tight text-fg">{formatQty(step.amount)}<span className="ml-1 text-sm font-semibold text-fg-subtle">L</span></span>
                <span className="text-[11px] leading-snug text-fg-subtle">{step.note}</span>
              </button>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
});

/* ------------------------------------------------------------------ detail panels */

export const BestSellersCard = memo(function BestSellersCard({ products, periodText, access, go }: { products: TopProduct[]; periodText: string; access: Access; go: Go }) {
  return (
    <Card className="flex flex-col" aria-label="Best sellers">
      <CardHeader eyebrow="What your customers love" title="Best sellers" actions={<Badge>{periodText}</Badge>} />
      <CardBody className="flex-1">
        {products.length ? (
          <ol className="space-y-4">
            {products.map((product, index) => (
              <li key={product.key} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-2 text-[11px] font-bold tabular-nums text-fg-subtle">{index + 1}</span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="min-w-0 truncate font-semibold text-fg">{product.name}</span>
                    <Money amount={product.revenue} className="shrink-0 font-semibold text-fg" />
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-[color:var(--glass-violet)]" style={{ width: `${product.barWidth}%` }} />
                  </div>
                  <p className="flex justify-between gap-2 text-[11px] text-fg-subtle"><span>{formatQty(product.qty)} {product.unit} sold</span><span className="tabular-nums">{product.share}% of sales</span></p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState size="compact" icon={<Package />} title="Your next best seller starts here" description="Products appear after a sale in this period." />
        )}
      </CardBody>
      <CardLink onClick={() => go('sales-history')} disabled={!access['sales-history']}>Explore sales history</CardLink>
    </Card>
  );
});

export const DebtorsCard = memo(function DebtorsCard({ debtors, receivables, access, go }: { debtors: Customer[]; receivables: number; access: Access; go: Go }) {
  return (
    <Card className="flex flex-col" aria-label="Collection priorities">
      <CardHeader eyebrow="Turn balances into cash" title="Collection priorities" icon={<Users />} />
      <CardBody className="flex-1 space-y-3">
        <div>
          <p className="text-xs text-fg-subtle">Customer receivables · current</p>
          <Money amount={receivables} tone="balance" className="text-2xl font-bold tracking-tight" />
        </div>
        {debtors.length ? (
          <ul className="-mx-2 divide-y divide-line">
            {debtors.map(customer => {
              const overLimit = Number(customer.credit_limit) > 0 && Number(customer.balance) > Number(customer.credit_limit);
              return (
                <li key={customer.id}>
                  <button
                    type="button"
                    disabled={!access.customers}
                    onClick={() => go({ id: 'customers', path: `/customers?id=${encodeURIComponent(customer.id)}` })}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-bold text-fg-muted" aria-hidden="true">{customer.name.slice(0, 2).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-fg">{customer.name}</span>
                      <span className={cn('block truncate text-[11px]', overLimit ? 'font-semibold text-danger-fg' : 'text-fg-subtle')}>{overLimit ? 'Credit limit exceeded' : customer.route || 'Outstanding balance'}</span>
                    </span>
                    <Money amount={customer.balance} tone="balance" className="shrink-0 text-[13px] font-semibold" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState size="compact" icon={<CheckCircle2 />} title="No customer dues" description="Looking good." />
        )}
      </CardBody>
      <CardLink onClick={() => go('customers')} disabled={!access.customers}>Open customer khata</CardLink>
    </Card>
  );
});

export const ExpenseBreakdownCard = memo(function ExpenseBreakdownCard({ expenses, periodText, access, go }: { expenses: ExpenseSummary; periodText: string; access: Access; go: Go }) {
  return (
    <Card className="flex flex-col" aria-label="Expense breakdown">
      <CardHeader eyebrow="Know where it goes" title="Expense breakdown" icon={<Receipt />} />
      <CardBody className="flex-1 space-y-4">
        <div>
          <Money amount={expenses.total} className="text-2xl font-bold tracking-tight text-fg" />
          <p className="text-xs text-fg-subtle">{periodText} · {expenses.count} {expenses.count === 1 ? 'entry' : 'entries'}</p>
        </div>
        {expenses.categories.length ? (
          <ul className="space-y-3">
            {expenses.categories.slice(0, 4).map(category => (
              <li key={category.name} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate text-fg-muted">{category.name}</span>
                  <Money amount={category.amount} className="shrink-0 font-semibold text-fg" />
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-[color:var(--glass-rose)]" style={{ width: `${category.percent}%` }} />
                </div>
                <p className="text-[11px] tabular-nums text-fg-subtle">{category.percent}% of expenses</p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState size="compact" icon={<Receipt />} title="No expenses in this period" />
        )}
        <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2 text-xs">
          <span className="text-fg-subtle">Pending in this period</span>
          <Money amount={expenses.pending} className={cn('font-bold', expenses.pending > 0 ? 'text-danger-fg' : 'text-fg-muted')} />
        </div>
      </CardBody>
      <CardLink onClick={() => go('expenses')} disabled={!access.expenses}>Manage expenses</CardLink>
    </Card>
  );
});

/* ------------------------------------------------------------------ activity & cash */

const ACTIVITY_ICONS = { sale: Store, milk: Droplets, expense: Receipt } as const;
const DUE_MODES = new Set(['Credit', 'Unpaid']);

export const RecentActivityCard = memo(function RecentActivityCard({ entries, periodText, access, go }: { entries: ActivityEntry[]; periodText: string; access: Access; go: Go }) {
  return (
    <Card className="flex flex-col" aria-label="Recent activity">
      <CardHeader eyebrow="The latest in your business" title="Recent activity" actions={<Badge>{periodText}</Badge>} />
      <CardBody className="flex-1">
        {entries.length ? (
          <ul className="-mx-2 divide-y divide-line">
            {entries.map(entry => {
              const Icon = ACTIVITY_ICONS[entry.kind];
              const tone: Tone = DUE_MODES.has(entry.mode) ? 'danger' : 'neutral';
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => go(entry.module)}
                    disabled={!access[entry.module]}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4', entry.kind === 'sale' ? 'bg-brand-soft text-brand-fg' : 'bg-surface-2 text-fg-muted')}><Icon aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-fg">{entry.title}</span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-2">
                        <span className="truncate text-xs text-fg-subtle">{entry.detail}</span>
                        <Badge tone={tone} className="sm:hidden">{entry.mode}</Badge>
                      </span>
                    </span>
                    <Badge tone={tone} className="hidden sm:inline-flex">{entry.mode}</Badge>
                    <span className="w-24 shrink-0 text-right">
                      <Money amount={entry.amount} className="block text-[13px] font-semibold text-fg" />
                      <span className="text-[11px] text-fg-subtle">{shortDay(dayKey(entry.date))}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={<Activity />} title="A fresh page for your business" description="Sales, milk collections and expenses will appear here." />
        )}
      </CardBody>
    </Card>
  );
});

export const CashCard = memo(function CashCard({ balances, flows, periodText, access, go }: { balances: BalanceSummary; flows: PartyFlows; periodText: string; access: Access; go: Go }) {
  return (
    <Card className="flex flex-col" aria-label="Cash and commitments">
      <CardHeader eyebrow="Cash & commitments" title="Your money, in focus" icon={<Wallet />} />
      <CardBody className="flex-1 space-y-4">
        <div>
          <p className="text-xs text-fg-subtle">Cash + bank + wallets · current</p>
          <Money amount={balances.cash + balances.bank} className="text-3xl font-bold tracking-tight text-fg" />
        </div>
        <div className="-mx-2">
          <LinkRow label="Cash accounts" value={<Money amount={balances.cash} />} onClick={() => go('bank-cash')} disabled={!access['bank-cash']} />
          <LinkRow label="Bank & wallets" value={<Money amount={balances.bank} />} onClick={() => go('bank-cash')} disabled={!access['bank-cash']} />
          <LinkRow label={<>In transit <Badge>separate</Badge></>} value={<Money amount={balances.inTransit} />} onClick={() => go('cash-control')} disabled={!access['cash-control']} />
        </div>
        <div className="space-y-1 border-t border-line pt-3">
          <p className="pb-1 text-xs text-fg-subtle">Party payments · {periodText.toLowerCase()}</p>
          <div className="flex items-center justify-between gap-3 text-[13px]"><span className="flex items-center gap-2 text-fg-muted"><ArrowDownLeft className="size-3.5 text-success" aria-hidden="true" />Customers received</span><Money amount={flows.customersReceived} className="font-semibold text-fg" /></div>
          <div className="flex items-center justify-between gap-3 text-[13px]"><span className="flex items-center gap-2 text-fg-muted"><ArrowUpRight className="size-3.5 text-fg-faint" aria-hidden="true" />Suppliers paid</span><Money amount={flows.suppliersPaid} className="font-semibold text-fg" /></div>
          <div className="flex items-center justify-between gap-3 text-[13px]"><span className="flex items-center gap-2 text-fg-muted"><ArrowUpRight className="size-3.5 text-fg-faint" aria-hidden="true" />Vendors & materials paid</span><Money amount={flows.vendorsPaid} className="font-semibold text-fg" /></div>
        </div>
      </CardBody>
      <div className="mt-auto border-t border-line px-3 py-2">
        <LinkRow label="Supplier payables" value={<Money amount={balances.supplierPayables} className={balances.supplierPayables > 0 ? 'text-danger-fg' : undefined} />} onClick={() => go('suppliers')} disabled={!access.suppliers} />
      </div>
    </Card>
  );
});
