import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Download, Droplets, Plus, RefreshCw } from 'lucide-react';
import { useDairy } from '../context/DairyContext';
import { MODULE_METADATA, useTabs } from '../context/TabContext';
import { Button, Card, IconButton, PageHeader, SegmentedControl, Skeleton, type SegmentOption } from '../components/ui';
import { BREAKPOINTS, useMediaQuery } from '../hooks/useMediaQuery';
import { cn } from '../lib/cn';
import { getRetailMilkStock } from '../lib/retailMilkStock';
import { businessDate, getDashboardPeriod, type DashboardRange } from '../lib/dashboardAnalytics';
import type { PerformanceMetric } from '../lib/dashboardPerformanceData';
import { exportToCSV } from '../lib/exportUtils';
import { listCustomerOrders, orderIsOpen } from '../lib/customerOrders';
import type { CustomerOrder } from '../types';
import SwipeRegion from '../components/dashboard/SwipeRegion';
import {
  AttentionCard, BestSellersCard, CashCard, CollectionsCard, CustomizeMenu, DebtorsCard, ExpenseBreakdownCard, KpiGrid,
  MilkJourneyCard, RecentActivityCard, RetailStockCard, type Access, type Go, type PanelKey,
} from '../components/dashboard/DashboardCards';
import {
  clockLabel, comparisonCutoff, comparisonPhrase, cutAtComparison, expenseTotal, indexItems, isCountedSupply, isLiveExpense,
  isLivePurchase, isLiveSale, milkLiters, operationalAlerts, orderAlerts, pakistanMinute, recentActivity, rowsBetween,
  salesNetTotal, shortDay, stockAlertSummary, summariseBalances, summariseExpenses, summariseMilk, summariseMilkFlow, summarisePartyFlows, summariseSales,
  topProducts, trendFor, unpaidExpenses, type Comparison,
} from '../components/dashboard/dashboardData';
import { useDashboardClock } from '../components/dashboard/useDashboardClock';

// Recharts and the procurement drill-down are the heaviest parts of the screen; the
// KPIs render first and these arrive in their own chunks.
const DashboardPerformance = lazy(() => import('../components/dashboard/DashboardPerformance'));
const loadProcurementModal = () => import('../components/dashboard/MilkProcurementDetailModal');
const MilkProcurementDetailModal = lazy(loadProcurementModal);

const RANGES: SegmentOption<DashboardRange>[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7days', label: '7 days' },
  { value: 'month', label: 'This month' },
];
const RANGE_TEXT: Record<DashboardRange, string> = { today: 'Today', yesterday: 'Yesterday', '7days': 'Last 7 days', month: 'This month' };

/** Screens the dashboard links to; their permission decides whether a link is enabled. */
const LINKED_MODULES = ['pos', 'purchase', 'sales-history', 'customer-orders', 'cash-control', 'allocation', 'production', 'inventory', 'customers', 'suppliers', 'expenses', 'bank-cash'];
const EMPTY: never[] = [];
const PANEL_STORAGE_KEY = 'mooco_dashboard_panels';

const longDateFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', weekday: 'long', day: 'numeric', month: 'long' });

function readPanels(): Record<PanelKey, boolean> {
  const panels: Record<PanelKey, boolean> = { products: true, collections: true, expenses: true, activity: true };
  try {
    const saved = JSON.parse(localStorage.getItem(PANEL_STORAGE_KEY) || '{}');
    for (const key of Object.keys(panels) as PanelKey[]) if (typeof saved?.[key] === 'boolean') panels[key] = saved[key];
  } catch { /* A damaged preference must never hide business data. */ }
  return panels;
}

function PerformanceSkeleton() {
  return (
    <Card className="flex flex-col gap-4 p-5" aria-hidden="true">
      <div className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-4 w-44" /></div>
      <Skeleton className="h-7 w-72 max-w-full" />
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-60 w-full sm:h-72 2xl:h-80" />
    </Card>
  );
}

const Dashboard: React.FC = () => {
  const { openTab } = useTabs();
  const {
    purchases = [], materialPurchases = [], inventory = [], sales = [], suppliers = [], customers = [], expenses = [],
    expenseVendors = [], expenseVendorTransactions = [], accounts = [], allocations = [], customerTransactions = [],
    supplierTransactions = [], cashInTransit, items = [], productionBatches = [], inventoryLogs = [], dailySupplyEntries = [],
    currentUser, hasPermission, canPerform, activeShiftSession, isDataLoading, retryLoading,
  } = useDairy();

  const rootRef = useRef<HTMLDivElement>(null);
  const now = useDashboardClock(rootRef);
  const todayKey = businessDate(now);
  const nowMinute = pakistanMinute(now);
  const roomy = useMediaQuery(BREAKPOINTS.sm);

  /* ---------------------------------------------------------- access & navigation */

  const canOpen = (id: string) => hasPermission(MODULE_METADATA[id]?.module || id);
  const canOpenRef = useRef(canOpen);
  canOpenRef.current = canOpen;
  // A string key keeps `access` (and every memoised card) stable across unrelated data changes.
  const accessKey = LINKED_MODULES.map(id => (canOpen(id) ? '1' : '0')).join('');
  const access = useMemo<Access>(() => Object.fromEntries(LINKED_MODULES.map((id, index) => [id, accessKey[index] === '1'])), [accessKey]);
  const go = useCallback<Go>(target => {
    const id = typeof target === 'string' ? target.replace(/^\//, '').split(/[/?]/)[0] : target.id;
    if (canOpenRef.current(id)) openTab(target);
  }, [openTab]);

  /* ---------------------------------------------------------- period */

  const [range, setRange] = useState<DashboardRange>('today');
  const movePeriod = (step: number) => setRange(current => {
    const index = RANGES.findIndex(option => option.value === current);
    return RANGES[Math.min(RANGES.length - 1, Math.max(0, index + step))].value;
  });
  // Derived from the business day only, so it changes at midnight and not every minute.
  const period = useMemo(() => getDashboardPeriod(range, new Date(`${todayKey}T12:00:00+05:00`)), [range, todayKey]);
  const cutoff = comparisonCutoff(period, nowMinute);
  const comparison = useMemo<Comparison>(() => ({ start: period.previousStart, end: period.previousEnd, cutoff }), [period, cutoff]);
  const periodText = RANGE_TEXT[range];
  const phrase = comparisonPhrase(range, period.days);
  const periodLabel = period.days === 1 ? shortDay(period.start) : `${shortDay(period.start)} – ${shortDay(period.end)}`;

  /* ---------------------------------------------------------- records in the period */

  const curSales = useMemo(() => rowsBetween(sales, isLiveSale, period.start, period.end), [sales, period]);
  const curPurchases = useMemo(() => rowsBetween(purchases, isLivePurchase, period.start, period.end), [purchases, period]);
  const curExpenses = useMemo(() => rowsBetween(expenses, isLiveExpense, period.start, period.end), [expenses, period]);
  const curSupplies = useMemo(() => rowsBetween(dailySupplyEntries as any[], isCountedSupply, period.start, period.end), [dailySupplyEntries, period]);

  const prevSalesDays = useMemo(() => rowsBetween(sales, isLiveSale, period.previousStart, period.previousEnd), [sales, period]);
  const prevPurchasesDays = useMemo(() => rowsBetween(purchases, isLivePurchase, period.previousStart, period.previousEnd), [purchases, period]);
  const prevExpensesDays = useMemo(() => rowsBetween(expenses, isLiveExpense, period.previousStart, period.previousEnd), [expenses, period]);
  const prevSuppliesDays = useMemo(() => rowsBetween(dailySupplyEntries as any[], isCountedSupply, period.previousStart, period.previousEnd), [dailySupplyEntries, period]);

  const previous = useMemo(() => ({
    sales: salesNetTotal(cutAtComparison(prevSalesDays, comparison), cutAtComparison(prevSuppliesDays, comparison)),
    milk: milkLiters(cutAtComparison(prevPurchasesDays, comparison)),
    expenses: expenseTotal(cutAtComparison(prevExpensesDays, comparison)),
  }), [prevSalesDays, prevSuppliesDays, prevPurchasesDays, prevExpensesDays, comparison]);

  /* ---------------------------------------------------------- aggregates */

  const itemIndex = useMemo(() => indexItems(items), [items]);
  const salesSummary = useMemo(() => summariseSales(curSales, curSupplies, itemIndex), [curSales, curSupplies, itemIndex]);
  const milkSummary = useMemo(() => summariseMilk(curPurchases), [curPurchases]);
  const expenseSummary = useMemo(() => summariseExpenses(curExpenses), [curExpenses]);
  const surplus = salesSummary.total - milkSummary.cost - expenseSummary.total;
  const margin = salesSummary.total > 0 ? (surplus / salesSummary.total) * 100 : 0;

  const salesTrend = useMemo(() => trendFor(salesSummary.total, previous.sales, phrase), [salesSummary.total, previous.sales, phrase]);
  const milkTrend = useMemo(() => trendFor(milkSummary.liters, previous.milk, phrase), [milkSummary.liters, previous.milk, phrase]);
  const expenseTrend = useMemo(() => trendFor(expenseSummary.total, previous.expenses, phrase), [expenseSummary.total, previous.expenses, phrase]);

  const retailMilk = useMemo(() => getRetailMilkStock(inventory, items), [inventory, items]);
  const balances = useMemo(() => summariseBalances(accounts, cashInTransit, suppliers, customers, expenseVendors), [accounts, cashInTransit, suppliers, customers, expenseVendors]);
  const milkFlow = useMemo(() => summariseMilkFlow(inventoryLogs, productionBatches, allocations, period, itemIndex), [inventoryLogs, productionBatches, allocations, period, itemIndex]);
  const stockAlerts = useMemo(() => stockAlertSummary(inventory, itemIndex), [inventory, itemIndex]);
  const unpaid = useMemo(() => unpaidExpenses(expenses), [expenses]);
  const flows = useMemo(() => summarisePartyFlows({
    sales: curSales, purchases: curPurchases, expenses: curExpenses, customerTransactions, supplierTransactions, materialPurchases, expenseVendorTransactions, period,
  }), [curSales, curPurchases, curExpenses, customerTransactions, supplierTransactions, materialPurchases, expenseVendorTransactions, period]);

  const [panels, setPanels] = useState(readPanels);
  const togglePanel = useCallback((key: PanelKey) => setPanels(current => {
    const next = { ...current, [key]: !current[key] };
    try { localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(next)); } catch { /* Preferences remain usable in this session. */ }
    return next;
  }), []);

  const bestSellers = useMemo(() => (panels.products ? topProducts(curSales, itemIndex, salesSummary.total) : EMPTY), [panels.products, curSales, itemIndex, salesSummary.total]);
  const debtors = useMemo(() => customers.filter(c => Number(c.balance) > 0).sort((a, b) => Number(b.balance) - Number(a.balance)).slice(0, 4), [customers]);
  const activity = useMemo(() => (panels.activity ? recentActivity(curSales, curPurchases, curExpenses) : EMPTY), [panels.activity, curSales, curPurchases, curExpenses]);

  // Chart input: the selected period plus its previous window, already narrowed.
  const chartSales = useMemo(() => prevSalesDays.concat(curSales), [prevSalesDays, curSales]);
  const chartPurchases = useMemo(() => prevPurchasesDays.concat(curPurchases), [prevPurchasesDays, curPurchases]);
  const chartExpenses = useMemo(() => prevExpensesDays.concat(curExpenses), [prevExpensesDays, curExpenses]);
  const chartSupplies = useMemo(() => prevSuppliesDays.concat(curSupplies), [prevSuppliesDays, curSupplies]);
  const liveSlot = period.days === 1 && period.end === period.todayStr && nowMinute !== null ? Math.floor(nowMinute / 30) : null;

  /* ---------------------------------------------------------- customer orders */

  const canSeeOrders = hasPermission('customer_orders');
  const canCompleteOrder = canPerform('pos', 'create');
  const [serveOrders, setServeOrders] = useState<CustomerOrder[]>([]);
  const [ordersError, setOrdersError] = useState('');

  const loadServeOrders = useCallback(async () => {
    if (!canSeeOrders) return;
    try {
      const rows = await listCustomerOrders();
      setServeOrders(rows.filter(orderIsOpen));
      setOrdersError('');
    } catch (err: any) {
      setOrdersError(err?.message || 'Orders could not be loaded.');
    }
  }, [canSeeOrders]);

  useEffect(() => {
    if (!canSeeOrders) return;
    void loadServeOrders();
    const refresh = () => void loadServeOrders();
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('mooco-customer-orders-changed', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('mooco-customer-orders-changed', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [canSeeOrders, loadServeOrders]);

  const alerts = useMemo(() => [
    ...(canSeeOrders ? orderAlerts({ orders: serveOrders, error: ordersError, todayKey, inventory, index: itemIndex, canCompleteOrder }) : []),
    ...operationalAlerts({ unallocatedLiters: milkFlow.unallocated, stock: stockAlerts, inTransit: balances.inTransit, unpaidExpenses: unpaid }),
  ], [canSeeOrders, serveOrders, ordersError, todayKey, inventory, itemIndex, canCompleteOrder, milkFlow.unallocated, stockAlerts, balances.inTransit, unpaid]);

  /* ---------------------------------------------------------- drill-down */

  const [milkOpen, setMilkOpen] = useState(false);
  const openMilk = useCallback(() => setMilkOpen(true), []);
  const closeMilk = useCallback(() => setMilkOpen(false), []);
  const onChartDetails = useCallback((metric: PerformanceMetric) => {
    if (metric === 'milk') setMilkOpen(true);
    else go(metric === 'expenses' ? 'expenses' : 'sales-history');
  }, [go]);
  const openSupplier = useCallback((supplierId: string) => {
    if (!canOpenRef.current('suppliers')) return;
    openTab({ id: 'suppliers', path: `/suppliers?id=${encodeURIComponent(supplierId)}` });
    window.dispatchEvent(new CustomEvent('mooco-select-supplier', { detail: { supplierId } }));
  }, [openTab]);

  // Fetch the drill-down while the owner reads the numbers, so the first click opens at once.
  useEffect(() => {
    const prefetch = () => { void loadProcurementModal().catch(() => {}); };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(prefetch, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(prefetch, 2500);
    return () => window.clearTimeout(id);
  }, []);

  /* ---------------------------------------------------------- export */

  const exportSummary = () => exportToCSV(`Mooco_Overview_${period.start}_${period.end}`, ['Metric', 'Value', 'Unit', 'Scope'], [
    ['Sales', salesSummary.total, 'PKR', periodText], ['Milk collected', milkSummary.liters, 'Liters', periodText],
    ['Milk procurement cost', milkSummary.cost, 'PKR', periodText], ['Operating expenses', expenseSummary.total, 'PKR', periodText],
    ['Sales less milk procurement and expenses (estimate)', surplus, 'PKR', periodText],
    ['Customer receipts', flows.customersReceived, 'PKR', periodText], ['Supplier payments', flows.suppliersPaid, 'PKR', periodText],
    ['Vendor and material payments', flows.vendorsPaid, 'PKR', periodText],
    ['Cash accounts', balances.cash, 'PKR', 'Current balance'], ['Bank and wallets', balances.bank, 'PKR', 'Current balance'],
    ['Cash in transit', balances.inTransit, 'PKR', 'Current balance'], ['Customer receivables', balances.customerReceivables, 'PKR', 'Current balance'],
    ['Supplier payables', balances.supplierPayables, 'PKR', 'Current balance'], ['Retail milk stock', retailMilk.liters, 'Liters', 'Current stock'],
  ]);

  /* ---------------------------------------------------------- render */

  const firstName = (currentUser?.name || '').trim().split(' ')[0];
  const hour = nowMinute === null ? 12 : Math.floor(nowMinute / 60);
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const shiftActive = activeShiftSession?.status === 'Active' && (!activeShiftSession.business_date || activeShiftSession.business_date === todayKey);
  const showDetails = panels.products || panels.collections || panels.expenses;

  return (
    <div ref={rootRef} className="flex min-w-0 flex-col gap-4 pb-24 pt-2 text-fg sm:gap-5 sm:pb-4">
      <PageHeader
        className="animate-fade-up"
        eyebrow="Your dairy, at a glance"
        title={<>{greeting}{firstName ? `, ${firstName}` : ''}<span className="text-brand-accent">.</span></>}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{longDateFormatter.format(now)}</span>
            <span aria-hidden="true" className="text-fg-faint">·</span>
            <button
              type="button"
              onClick={() => go('cash-control')}
              disabled={!access['cash-control']}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md font-semibold text-fg-muted hover:text-fg disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className={cn('size-1.5 rounded-full', shiftActive ? 'bg-success' : 'bg-fg-faint')} aria-hidden="true" />
              {shiftActive ? `${activeShiftSession?.shift_name || 'Counter shift'} active` : 'No shift open · Cash Control'}
            </button>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" leftIcon={<Droplets />} onClick={() => go('purchase')} disabled={!access.purchase} className="hidden sm:inline-flex">Collect milk</Button>
            {access.pos && <Button leftIcon={<Plus />} onClick={() => go('pos')} className="hidden sm:inline-flex">New sale</Button>}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-4">
          <SwipeRegion label="Reporting period navigation" onNext={() => movePeriod(1)} onPrevious={() => movePeriod(-1)} className="max-sm:w-full">
            <SegmentedControl aria-label="Reporting period" options={RANGES} value={range} onChange={setRange} fullWidth={!roomy} />
          </SwipeRegion>
          <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 text-xs text-fg-subtle">
            <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="font-semibold text-fg-muted">{periodLabel}</span>
            <span>· PKT</span>
            <span>· vs {phrase}{cutoff !== null ? ` until ${clockLabel(cutoff)}` : ''}</span>
          </p>
          <div className="ml-auto flex items-center gap-1">
            <IconButton size="sm" icon={<RefreshCw />} aria-label="Refresh dashboard" loading={isDataLoading} onClick={() => void retryLoading()} />
            <IconButton size="sm" icon={<Download />} aria-label="Export overview" onClick={exportSummary} />
            <CustomizeMenu visible={panels} onToggle={togglePanel} />
          </div>
        </div>
      </PageHeader>

      <div className="animate-fade-up">
        <KpiGrid
          sales={salesSummary} milk={milkSummary} expenses={expenseSummary} surplus={surplus} margin={margin}
          salesTrend={salesTrend} milkTrend={milkTrend} expenseTrend={expenseTrend}
          roomy={roomy} access={access} go={go} onMilk={openMilk}
        />
      </div>

      <AttentionCard alerts={alerts} access={access} go={go} />

      <div className="grid grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <Suspense fallback={<PerformanceSkeleton />}>
          <DashboardPerformance
            sales={chartSales} purchases={chartPurchases} expenses={chartExpenses}
            range={range} period={period} supplies={chartSupplies} liveSlot={liveSlot} onDetails={onChartDetails}
          />
        </Suspense>
        <RetailStockCard stock={retailMilk} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <MilkJourneyCard milk={milkSummary} flow={milkFlow} periodText={periodText} access={access} go={go} />
        <CollectionsCard sales={salesSummary} periodText={periodText} access={access} go={go} />
      </div>

      {showDetails && (
        <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
          {panels.products && <BestSellersCard products={bestSellers} periodText={periodText} access={access} go={go} />}
          {panels.collections && <DebtorsCard debtors={debtors} receivables={balances.customerReceivables} access={access} go={go} />}
          {panels.expenses && <ExpenseBreakdownCard expenses={expenseSummary} periodText={periodText} access={access} go={go} />}
        </div>
      )}

      <div className={cn('grid grid-cols-1 gap-4 sm:gap-5', panels.activity && 'xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]')}>
        {panels.activity && <RecentActivityCard entries={activity} periodText={periodText} access={access} go={go} />}
        <CashCard balances={balances} flows={flows} periodText={periodText} access={access} go={go} />
      </div>

      {/* Phones: the two daily actions stay under the thumb. */}
      <div className="fixed inset-x-0 bottom-0 z-[25] flex gap-2 border-t border-line bg-surface px-4 pt-2.5 shadow-e2 pb-[calc(0.625rem+env(safe-area-inset-bottom))] sm:hidden">
        <Button variant="secondary" size="lg" fullWidth leftIcon={<Droplets />} onClick={() => go('purchase')} disabled={!access.purchase}>Collect milk</Button>
        <Button size="lg" fullWidth leftIcon={<Plus />} onClick={() => go('pos')} disabled={!access.pos}>New sale</Button>
      </div>

      {milkOpen && (
        <Suspense fallback={null}>
          <MilkProcurementDetailModal
            isOpen
            onClose={closeMilk}
            purchases={curPurchases}
            suppliers={suppliers}
            periodLabel={periodText}
            dateRangeText={periodLabel}
            totalMilkLiters={milkSummary.liters}
            totalMilkCost={milkSummary.cost}
            avgMilkRate={milkSummary.avgRate}
            buffaloLiters={milkSummary.buffalo}
            cowLiters={milkSummary.cow}
            onOpenProcurement={() => go('purchase')}
            onNavigateToSupplier={openSupplier}
          />
        </Suspense>
      )}
    </div>
  );
};

export default Dashboard;
