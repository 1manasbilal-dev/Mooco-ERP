import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useDairy } from '../context/DairyContext';
import { MODULE_METADATA, useTabs } from '../context/TabContext';
import {
  Droplets, ArrowUpRight, ArrowDownRight, ArrowRight, Plus, Store, Wallet,
  Factory, Layers, Users, CheckCircle2, Receipt,
  TrendingUp, Package, ArrowDownLeft, CalendarDays, Download, RefreshCw,
  SlidersHorizontal, X, ChevronRight, AlertTriangle, CircleHelp, Activity, MoveHorizontal,
  ClipboardCheck, Truck,
} from 'lucide-react';
import MilkProcurementDetailModal from '../components/dashboard/MilkProcurementDetailModal';
import DashboardPerformance from '../components/dashboard/DashboardPerformance';
import SwipeCards from '../components/dashboard/SwipeCards';
import SwipeRegion from '../components/dashboard/SwipeRegion';
import { getRetailMilkStock, RETAIL_CHILLER_CAPACITY } from '../lib/retailMilkStock';
import { formatCurrency, formatQty, cleanNumber } from '../lib/formatters';
import { saleCashCollected, saleOnlineCollected, saleNetCollection, isSpotSupplierPayment } from '../lib/moneyFlow';
import { businessDate, getDashboardPeriod, percentageChange, DashboardRange } from '../lib/dashboardAnalytics';
import { exportToCSV } from '../lib/exportUtils';
import { listCustomerOrders, orderIsOpen } from '../lib/customerOrders';
import { CustomerOrder } from '../types';
import { availableSellUnits, saleLineStock } from '../lib/sellUnits';
import { returnedQtyForLine } from '../lib/stockProfit';

const RANGES = [
  { id: 'today', label: 'Today' }, { id: 'yesterday', label: 'Yesterday' },
  { id: '7days', label: '7 days' }, { id: 'month', label: 'This month' },
] as const;
const OPTIONAL_PANELS = { products: 'Best sellers', collections: 'Collection priorities', expenses: 'Expense breakdown', activity: 'Recent activity' };
type PanelKey = keyof typeof OPTIONAL_PANELS;

const inPeriod = (value: string | undefined, start: string, end: string) => {
  if (!value) return false;
  const day = businessDate(value);
  return day >= start && day <= end;
};
/** Supply rows are loaded with their details spread onto the row; older rows may still nest them. */
const isCountedSupply = (ds: any) => {
  const status = ds?.status ?? ds?.details?.status;
  return Boolean(ds?.date) && status !== 'Cancelled' && status !== 'Pending';
};
const isLiveExpense = (e: any) => e?.status !== 'Cancelled' && e?.status !== 'Returned';

function ChangeBadge({ current, previous, inverse = false }: { current: number; previous: number; inverse?: boolean }) {
  const change = percentageChange(current, previous);
  if (change === null) return <span className="overview-change neutral">{current > 0 ? 'New activity' : 'No activity'}</span>;
  const positive = inverse ? change <= 0 : change >= 0;
  const Icon = change < 0 ? ArrowDownRight : ArrowUpRight;
  return <span className={`overview-change ${positive ? 'positive' : 'negative'}`}><Icon size={12} />{formatQty(Math.abs(change), 1)}%</span>;
}

const Dashboard: React.FC = () => {
  const { openTab } = useTabs();
  const { 
    purchases = [], 
    materialPurchases = [],
    inventory = [], 
    sales = [], 
    suppliers = [], 
    customers = [], 
    expenses = [], 
    expenseVendors = [],
    expenseVendorTransactions = [],
    accounts = [],
    allocations = [],
    customerTransactions = [],
    supplierTransactions = [],
    cashInTransit,
    items = [],
    currentUser, hasPermission, canPerform, activeShiftSession, isDataLoading, retryLoading,
    productionBatches = [],
    inventoryLogs = [],
    dailySupplyEntries = []
  } = useDairy();

  // Physical stock stays current, independent of the reporting date range.
  const retailMilk = useMemo(() => getRetailMilkStock(inventory, items), [inventory, items]);
  const retailFill = Math.min(100, Math.max(0, retailMilk.liters / RETAIL_CHILLER_CAPACITY * 100));

  // Time Range Filter State
  const [timeRange, setTimeRange] = useState<DashboardRange>('today');
  const movePeriod = (direction: number) => setTimeRange(current => RANGES[Math.min(RANGES.length - 1, Math.max(0, RANGES.findIndex(range => range.id === current) + direction))].id);
  const [isMilkProcurementModalOpen, setIsMilkProcurementModalOpen] = useState(false);
  const closeProcurement = useCallback(() => setIsMilkProcurementModalOpen(false), []);

  const firstName = (currentUser?.name || '').trim().split(' ')[0];

  // 1. Date Range Boundaries
  const todayKey = businessDate();
  const canSeeOrders = hasPermission('customer_orders');
  const canCompleteOrder = canPerform('pos', 'create');
  const [serveOrders, setServeOrders] = useState<CustomerOrder[]>([]);
  const [ordersError, setOrdersError] = useState('');
  const dateFilter = useMemo(() => getDashboardPeriod(timeRange), [timeRange, todayKey]);

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

  const timeRangeText = useMemo(() => {
    if (timeRange === 'today') return 'Today';
    if (timeRange === 'yesterday') return 'Yesterday';
    if (timeRange === '7days') return 'Last 7 days';
    return 'This month';
  }, [timeRange]);

  // 2. Filtered Range Purchases, Sales, Allocations & Expenses
  const rangePurchases = useMemo(() => {
    return purchases.filter(p => {
      if (!p.date || p.status === 'Cancelled' || p.status === 'Returned') return false;
      const pDate = businessDate(p.date);
      return pDate >= dateFilter.start && pDate <= dateFilter.end;
    });
  }, [purchases, dateFilter]);

  const prevPurchases = useMemo(() => {
    const previousStart = dateFilter.previousStart;
    return purchases.filter(p => {
      if (!p.date || p.status === 'Cancelled' || p.status === 'Returned') return false;
      const date = businessDate(p.date); return date >= previousStart && date <= dateFilter.previousEnd;
    });
  }, [purchases, dateFilter]);

  const rangeSales = useMemo(() => {
    return sales.filter(s => {
      if (!s.date || s.status === 'Returned' || s.status === 'Cancelled') return false;
      const sDate = businessDate(s.date);
      return sDate >= dateFilter.start && sDate <= dateFilter.end;
    });
  }, [sales, dateFilter]);

  const prevSales = useMemo(() => {
    const previousStart = dateFilter.previousStart;
    return sales.filter(s => {
      if (!s.date || s.status === 'Returned' || s.status === 'Cancelled') return false;
      const date = businessDate(s.date); return date >= previousStart && date <= dateFilter.previousEnd;
    });
  }, [sales, dateFilter]);

  const rangeExpenses = useMemo(() => {
    return expenses.filter(e => {
      if (!e.date || (e as any).status === 'Cancelled' || (e as any).status === 'Returned') return false;
      const eDate = businessDate(e.date);
      return eDate >= dateFilter.start && eDate <= dateFilter.end;
    });
  }, [expenses, dateFilter]);

  const rangeAllocations = useMemo(() => {
    return allocations.filter(a => {
      if (!a.date) return false;
      const aDate = businessDate(a.date);
      return aDate >= dateFilter.start && aDate <= dateFilter.end;
    });
  }, [allocations, dateFilter]);

  // 3. Core Business & Dairy Analytics Aggregation
  const stats = useMemo(() => {
    // Milk Procurement Calculations
    let totalMilkLiters = 0;
    let totalMilkCost = 0;
    let buffaloLiters = 0;
    let cowLiters = 0;
    let mixedLiters = 0;
    let totalFatPoints = 0;
    let fatCount = 0;

    rangePurchases.forEach(p => {
      const qty = Number(p.quantity) || 0;
      totalMilkLiters += qty;
      totalMilkCost += Number(p.total_amount) || 0;

      const type = (p.milk_type || '').toLowerCase();
      if (type.includes('buffalo')) buffaloLiters += qty;
      else if (type.includes('cow')) cowLiters += qty;
      else mixedLiters += qty;

      if (p.fat && Number(p.fat) > 0) {
        totalFatPoints += (Number(p.fat) * qty);
        fatCount += qty;
      }
    });

    const avgMilkRate = totalMilkLiters > 0 ? (totalMilkCost / totalMilkLiters) : 0;
    const avgFat = fatCount > 0 ? (totalFatPoints / fatCount) : 0;

    // Sales Calculations
    let totalSalesAmount = 0;
    // kg, L and pcs are never added together: sold quantity is kept per base unit.
    const soldUnitsByUnit: Record<string, number> = {};
    const addSold = (unit: string, qty: number) => { soldUnitsByUnit[unit] = cleanNumber((soldUnitsByUnit[unit] || 0) + qty, 3); };
    let cashSalesAmount = 0;
    let onlineSalesAmount = 0;
    let creditSalesAmount = 0;

    rangeSales.forEach(s => {
      // Net of returns: a refund first reverses khata, then the cash/online that was paid back.
      const kept = saleNetCollection(s);
      totalSalesAmount += kept.net;
      cashSalesAmount += kept.cash;
      onlineSalesAmount += kept.online;
      creditSalesAmount += kept.credit;

      (s.items || []).forEach((item: any) => {
        // Sold quantity in the product's base unit, net of refunds on this exact line.
        const netQty = Math.max(0, (Number(item.qty) || 0) - returnedQtyForLine(s, item));
        const master = items.find(def => def.id === item.itemId) || items.find(def => def.name === item.name);
        const unit = master?.unit || item.baseUnit || (!item.variantId ? item.unit : '') || 'units';
        addSold(unit, saleLineStock({ ...item, qty: netQty }, master).baseQty);
      });
    });

    const rangeSupplies = (dailySupplyEntries || []).filter(ds => isCountedSupply(ds) && inPeriod(ds.date, dateFilter.start, dateFilter.end));
    rangeSupplies.forEach(ds => {
      const supplyAmt = Number(ds.total_amount) || 0;
      totalSalesAmount += supplyAmt;
      // Supply rows are loaded with their details spread onto the row.
      const rec = Number((ds as any).payment_received ?? (ds as any).details?.payment_received) || 0;
      cashSalesAmount += rec;
      creditSalesAmount += Math.max(0, supplyAmt - rec);
      addSold('L', Number((ds as any).net_qty ?? (ds as any).quantity ?? (ds as any).details?.net_qty) || 0);
    });
    // A single headline number only exists when every sale shares one unit.
    const soldUnitKeys = Object.keys(soldUnitsByUnit);
    const totalSoldUnits = soldUnitKeys.length === 1 ? soldUnitsByUnit[soldUnitKeys[0]] : 0;

    const avgBillValue = (rangeSales.length + rangeSupplies.length) > 0 ? (totalSalesAmount / (rangeSales.length + rangeSupplies.length)) : 0;

    // Expenses & Profitability
    const totalExpensesAmount = rangeExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const estimatedGrossProfit = totalSalesAmount - totalMilkCost;
    const estimatedNetProfit = totalSalesAmount - totalMilkCost - totalExpensesAmount;
    const netProfitMargin = totalSalesAmount > 0 ? ((estimatedNetProfit / totalSalesAmount) * 100) : 0;

    // Liquidity & Accounts Balances
    let totalLiquidCash = 0;
    let totalBankBalance = 0;
    accounts.forEach(acc => {
      const bal = Number(acc.balance) || 0;
      if (acc.type === 'Cash') totalLiquidCash += bal;
      else if (acc.type === 'Bank' || acc.type === 'Wallet') totalBankBalance += bal;
    });

    const inTransitCash = Number(cashInTransit?.amount) || 0;
    const totalLiquidity = totalLiquidCash + totalBankBalance + inTransitCash;

    // Suppliers & Customers Working Capital
    let totalSupplierPayables = 0;
    suppliers.forEach(s => {
      const due = Number((s as any).pending_balance ?? s.total_due ?? s.balance ?? 0);
      if (due > 0) totalSupplierPayables += due;
    });

    let totalCustomerReceivables = 0;
    customers.forEach(c => {
      const bal = Number(c.balance) || 0;
      if (bal > 0) totalCustomerReceivables += bal;
    });

    // Milk Flow Pipeline (Intake -> Storage -> POS / Production)
    // 1. Counter: Milk allocated to Retail Counter in selected range
    let rangeCounterAllocatedLiters = 0;
    inventoryLogs.forEach(l => {
      if (!l.date || l.reason !== 'Allocation') return;
      const lDate = businessDate(l.date);
      if (lDate >= dateFilter.start && lDate <= dateFilter.end) {
        const name = (l.item_name || '').toLowerCase();
        const isMilk = name.includes('milk') || name.includes('doodh') || name.includes('buffalo') || name.includes('cow');
        if (isMilk && Number(l.difference) > 0) {
          rangeCounterAllocatedLiters += Number(l.difference);
        }
      }
    });

    // 1. Production: Milk utilized in processing batches in selected range
    const rangeBatches = productionBatches.filter(b => {
      if (!b.start_date || b.status === 'Cancelled') return false;
      const bDate = businessDate(b.start_date);
      return bDate >= dateFilter.start && bDate <= dateFilter.end;
    });

    const batchProductionLiters = rangeBatches.reduce(
      (sum, b) => sum + (Number(b.quantity_input) || 0),
      0
    );

    let allocProductionLiters = 0;
    rangeAllocations.forEach(a => {
      const dest = String(a.destination || '').toLowerCase();
      if (dest.includes('prod') || dest.includes('processing')) {
        allocProductionLiters += Number(a.allocated_quantity ?? a.original_quantity ?? 0);
      }
    });

    const productionAllocatedLiters = Math.max(batchProductionLiters, allocProductionLiters);

    // 2. Counter: Milk allocated to Retail Counter in selected range
    let allocRetailLiters = 0;
    rangeAllocations.forEach(a => {
      const dest = String(a.destination || '').toLowerCase();
      if (dest.includes('retail') || dest.includes('counter') || dest.includes('pos')) {
        allocRetailLiters += Number(a.allocated_quantity ?? a.original_quantity ?? 0);
      }
    });

    const retailAllocatedLiters = rangeCounterAllocatedLiters > 0 
      ? rangeCounterAllocatedLiters 
      : Math.max(0, allocRetailLiters);

    // 3. Unallocated Raw Milk in Storage / Chilling Tanks
    const unallocatedMilkLiters = allocations.reduce((sum, a) => {
      const status = String(a.status || '').toLowerCase();
      if (status.includes('fully') || status.includes('completed') || status.includes('supply')) {
        return sum;
      }
      const rem = (a.remaining_quantity !== null && a.remaining_quantity !== undefined)
        ? Number(a.remaining_quantity)
        : (Number(a.original_quantity) - Number(a.allocated_quantity || 0));
      return sum + Math.max(0, rem || 0);
    }, 0);

    // Low stock inventory items detection
    const lowStockItems = inventory.filter(item => {
      const matchedDef = items.find(d => d.id === item.item_id || d.id === item.id);
      const threshold = matchedDef?.reorder_level ?? 10;
      return (Number(item.quantity) || 0) <= threshold && threshold > 0;
    });

    return {
      totalMilkLiters,
      totalMilkCost,
      buffaloLiters,
      cowLiters,
      mixedLiters,
      avgMilkRate,
      avgFat,
      totalSalesAmount,
      totalSoldUnits,
      soldUnitsByUnit,
      cashSalesAmount,
      onlineSalesAmount,
      creditSalesAmount,
      avgBillValue,
      totalExpensesAmount,
      estimatedGrossProfit,
      estimatedNetProfit,
      netProfitMargin,
      totalLiquidCash,
      totalBankBalance,
      inTransitCash,
      totalLiquidity,
      totalSupplierPayables,
      totalCustomerReceivables,
      retailAllocatedLiters,
      productionAllocatedLiters,
      unallocatedMilkLiters,
      lowStockItems,
      salesCount: rangeSales.length,
      purchaseCount: rangePurchases.length,
      expenseCount: rangeExpenses.length
    };
  }, [
    rangePurchases, rangeSales, rangeExpenses, rangeAllocations, 
    accounts, suppliers, customers, inventory, cashInTransit, items,
    productionBatches, inventoryLogs, allocations, dateFilter, dailySupplyEntries
  ]);

  // 4. In-Depth Operational Expense Analytics
  const expenseStats = useMemo(() => {
    let totalAmount = 0;
    let cashPaid = 0;
    let bankPaid = 0;
    let pendingAmount = 0;
    const categoryMap: Record<string, { amount: number; count: number }> = {};

    rangeExpenses.forEach(e => {
      const amt = Number(e.amount) || 0;
      const paid = Number(e.paidAmount ?? (e.paymentStatus === 'Unpaid' ? 0 : amt));
      const due = Math.max(0, amt - paid);

      totalAmount += amt;
      pendingAmount += due;

      const mode = (e.paymentMode || 'Cash').toLowerCase();
      // Non-cash settlements (bad-debt write-off) are fully "paid" but no money left any account.
      if (mode === 'adjustment') {
        // neither cash nor bank
      } else if (mode.includes('bank') || mode.includes('online') || mode.includes('digital')) {
        bankPaid += paid;
      } else {
        cashPaid += paid;
      }

      const cat = (e.category || 'General Overhead').trim();
      if (!categoryMap[cat]) {
        categoryMap[cat] = { amount: 0, count: 0 };
      }
      categoryMap[cat].amount += amt;
      categoryMap[cat].count += 1;
    });

    const categoriesSorted = Object.entries(categoryMap)
      .map(([name, data]) => ({
        name,
        amount: data.amount,
        count: data.count,
        percent: totalAmount > 0 ? Math.round((data.amount / totalAmount) * 100) : 0
      }))
      .sort((a, b) => b.amount - a.amount);

    const topCategory = categoriesSorted[0] || null;
    const expenseToSalesRatio = stats.totalSalesAmount > 0 
      ? ((totalAmount / stats.totalSalesAmount) * 100).toFixed(1) 
      : '0.0';

    return {
      totalAmount,
      cashPaid,
      bankPaid,
      pendingAmount,
      categoriesSorted,
      topCategory,
      expenseToSalesRatio,
      count: rangeExpenses.length
    };
  }, [rangeExpenses, stats.totalSalesAmount]);

  // 4. Top Selling Products
  const topProducts = useMemo(() => {
    const prodMap: Record<string, { name: string; qty: number; revenue: number; unit: string }> = {};

    rangeSales.forEach(s => {
      const billSubtotal = (s.items || []).reduce((sum: number, it: any) => sum + (Number(it.total) || (Number(it.qty) * Number(it.price)) || 0), 0);
      const billDiscount = Number(s.discount) || 0;
      const discountRatio = billSubtotal > 0 ? Math.max(0, 1 - (billDiscount / billSubtotal)) : 1;
      (s.items || []).forEach((item: any) => {
        const master = items.find(def => def.id === item.itemId) || items.find(def => def.name === item.name);
        // Group by product (not line name, which differs per pack size); quantity in the base unit.
        const key = master?.id || item.itemId || (item.name || '').trim();
        if (!key) return;

        const itemQty = Math.max(0, (Number(item.qty) || 0) - returnedQtyForLine(s, item));
        if (itemQty <= 0) return;

        const itemUnit = master?.unit || item.baseUnit || (!item.variantId ? item.unit : '') || 'units';
        const baseQty = saleLineStock({ ...item, qty: itemQty }, master).baseQty;

        const lineRawTotal = (item.total || (Number(item.qty) * (item.price || 0)) || 0);
        const lineDiscountedTotal = lineRawTotal * discountRatio;
        const origQty = Number(item.qty) || 1;
        const lineNetRevenue = (lineDiscountedTotal / origQty) * itemQty;

        if (!prodMap[key]) {
          prodMap[key] = { name: master?.name || (item.name || '').trim(), qty: 0, revenue: 0, unit: itemUnit };
        }
        prodMap[key].qty = cleanNumber(prodMap[key].qty + baseQty, 2);
        prodMap[key].revenue += lineNetRevenue;
      });
    });

    const sorted = Object.values(prodMap).sort((a, b) => b.revenue - a.revenue);
    const maxRev = sorted[0]?.revenue || 1;

    return sorted.slice(0, 5).map(item => ({
      ...item,
      share: Math.round((item.revenue / (stats.totalSalesAmount || 1)) * 100),
      barWidth: Math.round((item.revenue / maxRev) * 100)
    }));
  }, [rangeSales, stats.totalSalesAmount, items]);

  // 5. Next-Level Counterparty Cashflow Analytics (Customers Received, Suppliers Paid, Vendors Paid)
  const partyCashFlows = useMemo(() => {
    // 1. CUSTOMERS RECEIVED (Wasooli)
    let customerSalesCollected = 0;
    let customerSalesCount = 0;
    const posSaleIds = new Set<string>();

    rangeSales.forEach(s => {
      posSaleIds.add(s.id);
      const cash = saleCashCollected(s);
      const online = saleOnlineCollected(s);
      const totalCol = cash + online;
      if (totalCol > 0) {
        customerSalesCollected += totalCol;
        customerSalesCount++;
      }
    });

    let customerLedgerReceived = 0;
    let customerLedgerCount = 0;

    customerTransactions.forEach(tx => {
      if (!tx.date) return;
      const d = businessDate(tx.date);
      if (d < dateFilter.start || d > dateFilter.end) return;

      // Skip duplicate POS sale entries
      if (tx.id && tx.id.startsWith('ctx_') && posSaleIds.has(tx.id.replace('ctx_', ''))) return;

      const type = String(tx.type || '').toLowerCase();
      if (type === 'payment' || type === 'credit') {
        const amt = cleanNumber(tx.amount);
        if (amt > 0) {
          customerLedgerReceived += amt;
          customerLedgerCount++;
        }
      }
    });

    const totalCustomerReceived = customerSalesCollected + customerLedgerReceived;
    const totalCustomerTransactions = customerSalesCount + customerLedgerCount;

    // 2. MILK SUPPLIERS PAID (Doodh Adaigi)
    let supplierIntakePaid = 0;
    let supplierIntakeCount = 0;

    rangePurchases.forEach(p => {
      const paid = cleanNumber(p.paid_amount ?? (p.status === 'Paid' ? p.total_amount : 0));
      if (paid > 0) {
        supplierIntakePaid += paid;
        supplierIntakeCount++;
      }
    });

    let supplierLedgerPaid = 0;
    let supplierLedgerCount = 0;

    supplierTransactions.forEach(tx => {
      if (!tx.date) return;
      if (isSpotSupplierPayment(tx)) return;
      const d = businessDate(tx.date);
      if (d < dateFilter.start || d > dateFilter.end) return;

      const type = String(tx.type || '').toLowerCase();
      if (type === 'payment' || type === 'advance') {
        const amt = cleanNumber(tx.amount);
        if (amt > 0) {
          supplierLedgerPaid += amt;
          supplierLedgerCount++;
        }
      }
    });

    const totalSupplierPaid = supplierIntakePaid + supplierLedgerPaid;
    const totalSupplierTransactions = supplierIntakeCount + supplierLedgerCount;

    // 3. VENDORS & MATERIALS PAID (Material, Feed & Expense Vendors)
    let materialPaid = 0;
    let materialCount = 0;

    materialPurchases.forEach(mp => {
      if (!mp.date) return;
      const d = businessDate(mp.date);
      if (d < dateFilter.start || d > dateFilter.end) return;

      const paid = cleanNumber((mp as any).paid_amount ?? (mp.status === 'Paid' ? mp.total_amount : 0));
      if (paid > 0) {
        materialPaid += paid;
        materialCount++;
      }
    });

    let expenseVendorPaid = 0;
    let expenseVendorCount = 0;

    expenseVendorTransactions.forEach(tx => {
      if (!tx.date) return;
      const d = businessDate(tx.date);
      if (d < dateFilter.start || d > dateFilter.end) return;

      if (tx.type === 'Payment') {
        const amt = cleanNumber(tx.amount || tx.paid_amount);
        if (amt > 0) {
          expenseVendorPaid += amt;
          expenseVendorCount++;
        }
      }
    });

    let directVendorExpensePaid = 0;
    rangeExpenses.forEach(e => {
      if (e.vendor && typeof e.vendor === 'string' && e.vendor.trim() !== '') {
        if (!e.vendor_id || expenseVendorTransactions.length === 0) {
          const amt = cleanNumber(e.paidAmount ?? (e.paymentStatus === 'Unpaid' ? 0 : e.amount));
          if (amt > 0) {
            directVendorExpensePaid += amt;
          }
        }
      }
    });

    const totalVendorPaid = materialPaid + expenseVendorPaid + directVendorExpensePaid;
    const totalVendorTransactions = materialCount + expenseVendorCount + (directVendorExpensePaid > 0 ? 1 : 0);

    let totalVendorPayables = 0;
    expenseVendors.forEach(v => {
      const bal = cleanNumber(v.pending_balance);
      if (bal > 0) totalVendorPayables += bal;
    });

    const totalOutflow = totalSupplierPaid + totalVendorPaid;
    const netCashflow = totalCustomerReceived - totalOutflow;

    const totalVolume = totalCustomerReceived + totalOutflow;
    const inflowPercent = totalVolume > 0 ? Math.round((totalCustomerReceived / totalVolume) * 100) : 50;
    const outflowPercent = totalVolume > 0 ? (100 - inflowPercent) : 50;

    return {
      customers: {
        totalReceived: totalCustomerReceived,
        count: totalCustomerTransactions,
        salesCollected: customerSalesCollected,
        ledgerReceived: customerLedgerReceived
      },
      suppliers: {
        totalPaid: totalSupplierPaid,
        count: totalSupplierTransactions,
        intakePaid: supplierIntakePaid,
        ledgerPaid: supplierLedgerPaid
      },
      vendors: {
        totalPaid: totalVendorPaid,
        count: totalVendorTransactions,
        totalPayable: totalVendorPayables
      },
      totalInflow: totalCustomerReceived,
      totalOutflow,
      netCashflow,
      inflowPercent,
      outflowPercent
    };
  }, [
    rangeSales, customerTransactions, dateFilter, rangePurchases, 
    supplierTransactions, materialPurchases, expenseVendorTransactions, 
    rangeExpenses, expenseVendors
  ]);



  // Same basis as the current period: bills net of returns plus delivery supply.
  const previousSalesTotal = prevSales.reduce((sum, sale) => sum + saleNetCollection(sale).net, 0)
    + (dailySupplyEntries || []).filter(ds => isCountedSupply(ds) && inPeriod(ds.date, dateFilter.previousStart, dateFilter.previousEnd))
      .reduce((sum, ds) => sum + (Number(ds.total_amount) || 0), 0);
  const previousMilkTotal = prevPurchases.reduce((sum, purchase) => sum + Number(purchase.quantity || 0), 0);
  const previousExpensesTotal = expenses.filter(e => isLiveExpense(e) && inPeriod(e.date, dateFilter.previousStart, dateFilter.previousEnd))
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const collected = stats.cashSalesAmount + stats.onlineSalesAmount;
  const collectionRate = stats.totalSalesAmount > 0 ? (collected / stats.totalSalesAmount) * 100 : 0;
  const allUnpaidExpenses = expenses.filter(isLiveExpense).reduce((sum, e) => sum + Math.max(0, Number(e.amount || 0) - Number(e.paidAmount ?? (e.paymentStatus === 'Unpaid' ? 0 : e.amount))), 0);
  const debtors = useMemo(() => customers.filter(c => Number(c.balance) > 0).sort((a, b) => Number(b.balance) - Number(a.balance)).slice(0, 4), [customers]);
  const [visiblePanels, setVisiblePanels] = useState<Record<PanelKey, boolean>>(() => {
    const defaults = { products: true, collections: true, expenses: true, activity: true };
    try {
      const saved = JSON.parse(localStorage.getItem('mooco_dashboard_panels') || '{}');
      for (const key of Object.keys(defaults) as PanelKey[]) if (typeof saved?.[key] === 'boolean') defaults[key] = saved[key];
    } catch { /* A damaged preference must never hide business data. */ }
    return defaults;
  });
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const customizeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!customizeOpen) return;
    const close = (event: MouseEvent) => { if (!customizeRef.current?.contains(event.target as Node)) setCustomizeOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setCustomizeOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [customizeOpen]);
  const togglePanel = (key: PanelKey) => {
    const next = { ...visiblePanels, [key]: !visiblePanels[key] }; setVisiblePanels(next);
    try { localStorage.setItem('mooco_dashboard_panels', JSON.stringify(next)); } catch { /* Preferences remain usable in this session. */ }
  };
  const canOpen = (id: string) => hasPermission(MODULE_METADATA[id]?.module || id);
  const go = (id: string) => { if (canOpen(id)) openTab(id); };
  const recentActivity = useMemo(() => [
    ...rangeSales.map(s => ({ id: `s-${s.id}`, date: s.date, title: s.customer_name || 'Walk-in customer', detail: `Sale · ${s.bill_number || s.id}`, amount: Number(s.total || 0), mode: s.payment_mode, icon: Store, module: 'sales-history', incoming: true })),
    ...rangePurchases.map(p => ({ id: `p-${p.id}`, date: p.date, title: p.supplier_name || 'Milk supplier', detail: `Milk collection · ${formatQty(p.quantity)} L`, amount: Number(p.total_amount || 0), mode: p.status || 'Recorded', icon: Droplets, module: 'purchase', incoming: false })),
    ...rangeExpenses.map(e => ({ id: `e-${e.id}`, date: e.date, title: e.category || 'Expense', detail: e.description || 'Operating expense', amount: Number(e.amount || 0), mode: e.paymentStatus || 'Recorded', icon: Receipt, module: 'expenses', incoming: false })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5), [rangeSales, rangePurchases, rangeExpenses]);
  const orderAlerts = useMemo(() => {
    if (!canSeeOrders) return [];
    if (ordersError) return [{ id: 'orders-error', title: 'Orders could not be checked', detail: 'Open orders and try again', module: 'customer-orders', icon: ClipboardCheck, path: '/customer-orders' }];
    const tomorrow = new Date(`${todayKey}T12:00:00`);
    tomorrow.setDate(tomorrow.getDate() + 2);
    const horizonKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const available = (line: CustomerOrder['items'][number]) => {
      const stock = inventory.find(row => row.item_id === line.itemId);
      const product = items.find(row => row.id === line.itemId);
      const variant = line.variantId ? product?.variants?.find(row => row.id === line.variantId) : undefined;
      return availableSellUnits(Number(stock?.quantity) || 0, Number(stock?.variant_stocks?.[line.variantId || ''] || 0), variant);
    };
    const late = serveOrders.filter(order => order.due_date < todayKey);
    const today = serveOrders.filter(order => order.due_date === todayKey);
    const near = serveOrders.filter(order => order.due_date > todayKey && order.due_date <= horizonKey);
    const soon = serveOrders.filter(order => order.due_date <= horizonKey);
    const short = soon.filter(order => order.items.some(line => line.qty > available(line)));
    const deliveries = serveOrders.filter(order => order.fulfillment === 'Delivery' && order.due_date <= todayKey);
    const pending = soon.filter(order => order.status === 'Pending');
    const ready = serveOrders.filter(order => order.status === 'Ready' || (order.status === 'Confirmed' && order.due_date <= todayKey));
    const nameOf = (orders: CustomerOrder[], single: (order: CustomerOrder) => string, many: (count: number) => string) => orders.length === 1 ? single(orders[0]) : many(orders.length);
    const chips: Array<{ id: string; title: string; detail: string; module: string; icon: typeof ClipboardCheck; path?: string }> = [];
    if (late.length) chips.push({ id: 'orders-late', title: nameOf(late, order => `${order.customer_name}'s order is late`, count => `${count} orders are late`), detail: 'Serve these before newer bookings', module: 'customer-orders', icon: AlertTriangle, path: '/customer-orders' });
    if (today.length) chips.push({ id: 'orders-today', title: nameOf(today, order => `${order.customer_name}'s order is due today`, count => `${count} orders are due today`), detail: 'Pickup and delivery for today', module: 'customer-orders', icon: CalendarDays, path: '/customer-orders' });
    if (near.length) chips.push({ id: 'orders-near', title: nameOf(near, order => `${order.customer_name}'s order is near`, count => `${count} orders are near`), detail: near.length === 1 ? `Due ${new Date(`${near[0].due_date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Due in the next 2 days', module: 'customer-orders', icon: ClipboardCheck, path: '/customer-orders' });
    if (short.length) {
      const missing = short.length === 1 ? short[0].items.find(line => line.qty > available(line))?.name : '';
      chips.push({ id: 'orders-stock', title: nameOf(short, order => `Complete stock for ${order.customer_name}`, count => `Complete stock for ${count} orders`), detail: missing || 'Prepare the booked items first', module: 'inventory', icon: Package, path: '/inventory' });
    }
    if (deliveries.length) chips.push({ id: 'orders-delivery', title: nameOf(deliveries, order => `Send ${order.customer_name}'s delivery`, count => `${count} deliveries to send`), detail: 'Due today or already late', module: 'customer-orders', icon: Truck, path: '/customer-orders' });
    if (pending.length) chips.push({ id: 'orders-pending', title: nameOf(pending, order => `Confirm ${order.customer_name}'s booking`, count => `${count} bookings need confirm`), detail: 'Still pending', module: 'customer-orders', icon: ClipboardCheck, path: '/customer-orders' });
    if (ready.length) chips.push({ id: 'orders-ready', title: nameOf(ready, order => `${order.customer_name}'s order is ready to complete`, count => `${count} orders ready to complete`), detail: 'Open the bill when the customer arrives', module: ready.length === 1 && canCompleteOrder ? 'pos' : 'customer-orders', icon: CheckCircle2, path: ready.length === 1 && canCompleteOrder ? `/pos?order=${encodeURIComponent(ready[0].id)}` : '/customer-orders' });
    return chips;
  }, [canSeeOrders, ordersError, serveOrders, todayKey, inventory, items, canCompleteOrder]);
  const alerts = [
    ...orderAlerts,
    stats.unallocatedMilkLiters > 0 ? { id: 'milk', title: 'Milk ready to allocate', detail: `${formatQty(stats.unallocatedMilkLiters)} L in your tank`, module: 'allocation', icon: Droplets } : null,
    stats.lowStockItems.length > 0 ? { id: 'stock', title: 'Stock needs attention', detail: `${stats.lowStockItems.length} items at reorder level`, module: 'inventory', icon: Package } : null,
    stats.inTransitCash > 0 ? { id: 'transit', title: 'Cash awaiting receipt', detail: `${formatCurrency(stats.inTransitCash)} in transit`, module: 'cash-control', icon: Wallet } : null,
    allUnpaidExpenses > 0 ? { id: 'bills', title: 'Expenses to settle', detail: `${formatCurrency(allUnpaidExpenses)} outstanding`, module: 'expenses', icon: Receipt } : null,
  ].filter((alert): alert is NonNullable<typeof alert> => Boolean(alert));
  const exportSummary = () => exportToCSV(`Mooco_Overview_${dateFilter.start}_${dateFilter.end}`, ['Metric', 'Value', 'Unit', 'Scope'], [
    ['Sales', stats.totalSalesAmount, 'PKR', timeRangeText], ['Milk collected', stats.totalMilkLiters, 'Liters', timeRangeText],
    ['Milk procurement cost', stats.totalMilkCost, 'PKR', timeRangeText], ['Operating expenses', stats.totalExpensesAmount, 'PKR', timeRangeText],
    ['Sales less milk procurement and expenses (estimate)', stats.estimatedNetProfit, 'PKR', timeRangeText],
    ['Customer receipts', partyCashFlows.totalInflow, 'PKR', timeRangeText], ['Supplier payments', partyCashFlows.suppliers.totalPaid, 'PKR', timeRangeText],
    ['Vendor and material payments', partyCashFlows.vendors.totalPaid, 'PKR', timeRangeText],
    ['Cash accounts', stats.totalLiquidCash, 'PKR', 'Current balance'], ['Bank and wallets', stats.totalBankBalance, 'PKR', 'Current balance'],
    ['Cash in transit', stats.inTransitCash, 'PKR', 'Current balance'], ['Customer receivables', stats.totalCustomerReceivables, 'PKR', 'Current balance'],
    ['Supplier payables', stats.totalSupplierPayables, 'PKR', 'Current balance'], ['Retail milk stock', retailMilk.liters, 'Liters', 'Current stock'],
  ]);
  const reportDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const periodLabel = dateFilter.days === 1 ? reportDate(dateFilter.start) : `${reportDate(dateFilter.start)} – ${reportDate(dateFilter.end)}`;
  const greetingHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  const greeting = greetingHour < 12 ? 'Good morning' : greetingHour < 17 ? 'Good afternoon' : 'Good evening';

  return <div className="mooco-overview">
    <div className="overview-welcome">
      <div><div className="overview-eyebrow"><span className="overview-brand-dot" />YOUR DAIRY, AT A GLANCE</div><h1>{greeting}{firstName ? `, ${firstName}` : ''}<span className="overview-greeting-dot">.</span></h1><p>Every litre. Every rupee. A clearer picture of your business.</p></div>
      <div className="overview-welcome-actions">
        <button className="overview-button secondary" onClick={exportSummary} aria-label="Export overview"><Download size={16} /><span>Export overview</span></button>
        {canOpen('pos') && <button className="overview-button primary" onClick={() => go('pos')}><Plus size={17} />New sale<ArrowUpRight size={15} /></button>}
      </div>
    </div>

    <div className="overview-toolbar">
      <SwipeRegion className="overview-period-swipe" label="Reporting period navigation" onNext={() => movePeriod(1)} onPrevious={() => movePeriod(-1)}><div className="overview-segments range-segments" role="group" aria-label="Reporting period">{RANGES.map(option => <button key={option.id} aria-pressed={timeRange === option.id} onClick={() => setTimeRange(option.id)}>{option.label}</button>)}</div><span className="overview-date-swipe-hint"><MoveHorizontal size={12} />Swipe to switch dates</span></SwipeRegion>
      <span className="overview-date"><CalendarDays size={14} />{periodLabel}<span>· PKT</span></span>
      <div className="overview-toolbar-actions">
        <button className="overview-icon-button" onClick={() => void retryLoading()} disabled={isDataLoading} aria-label="Refresh dashboard" aria-busy={isDataLoading} title="Refresh dashboard"><RefreshCw size={16} className={isDataLoading ? 'animate-spin' : ''} /></button>
        <div className="overview-customize" ref={customizeRef}><button className="overview-button quiet" onClick={() => setCustomizeOpen(v => !v)} aria-label="Customize" aria-expanded={customizeOpen} aria-controls="dashboard-customize"><SlidersHorizontal size={15} /><span>Customize</span></button>
          {customizeOpen && <div className="overview-customize-menu" id="dashboard-customize"><div><strong>Make it yours</strong><button className="overview-icon-button" onClick={() => setCustomizeOpen(false)} aria-label="Close customization"><X size={14} /></button></div><p>Choose what appears in your overview.</p>{(Object.entries(OPTIONAL_PANELS) as [PanelKey, string][]).map(([key, label]) => <label key={key}><input type="checkbox" checked={visiblePanels[key]} onChange={() => togglePanel(key)} />{label}</label>)}</div>}
        </div>
      </div>
    </div>

    <SwipeCards className="overview-kpis" label="Business summaries" labels={["Total sales", "Milk collected", "Operating expenses", "Operating surplus"]}>
      <button data-carousel-slide className="overview-kpi featured" onClick={() => go('sales-history')} disabled={!canOpen('sales-history')}>
        <div className="overview-kpi-top"><span><Store size={15} />Total sales</span><ArrowUpRight size={16} /></div>
        <strong>{formatCurrency(stats.totalSalesAmount)}</strong><div className="overview-kpi-bottom"><ChangeBadge current={stats.totalSalesAmount} previous={previousSalesTotal} /><span>vs previous {dateFilter.days === 1 ? 'day' : `${dateFilter.days} days`}</span></div><div className="overview-kpi-foot">{stats.salesCount} bills<span>Avg. {formatCurrency(stats.avgBillValue)}</span></div>
      </button>
      <button data-carousel-slide className="overview-kpi" onClick={() => setIsMilkProcurementModalOpen(true)}>
        <div className="overview-kpi-top"><span><Droplets size={15} />Milk collected</span><ArrowUpRight size={16} /></div>
        <strong>{formatQty(stats.totalMilkLiters)}<small> L</small></strong><div className="overview-kpi-bottom"><ChangeBadge current={stats.totalMilkLiters} previous={previousMilkTotal} /><span>vs previous period</span></div><div className="overview-kpi-foot">{stats.purchaseCount} collections<span>{formatCurrency(stats.avgMilkRate)} / L</span></div>
      </button>
      <button data-carousel-slide className="overview-kpi" onClick={() => go('expenses')} disabled={!canOpen('expenses')}>
        <div className="overview-kpi-top"><span><Receipt size={15} />Operating expenses</span><ArrowUpRight size={16} /></div>
        <strong>{formatCurrency(stats.totalExpensesAmount)}</strong><div className="overview-kpi-bottom"><ChangeBadge current={stats.totalExpensesAmount} previous={previousExpensesTotal} inverse /><span>vs previous period</span></div><div className="overview-kpi-foot">{stats.expenseCount} entries<span>{expenseStats.expenseToSalesRatio}% of sales</span></div>
      </button>
      <div data-carousel-slide className="overview-kpi surplus-kpi">
        <div className="overview-kpi-top"><span><TrendingUp size={15} />Operating surplus</span><span className="overview-help" tabIndex={0} aria-label="Estimate: sales minus milk procurement and operating expenses. Excludes inventory timing, material costs, returns and tax." title="Estimate: sales less milk procurement and operating expenses; excludes inventory timing, material costs, returns and tax."><CircleHelp size={16} /></span></div>
        <strong className={stats.estimatedNetProfit < 0 ? 'overview-negative' : ''}>{formatCurrency(stats.estimatedNetProfit)}</strong><div className="overview-kpi-bottom"><span className={`overview-change ${stats.estimatedNetProfit < 0 ? 'negative' : 'positive'}`}>{formatQty(stats.netProfitMargin, 1)}% margin</span><span>Estimate</span></div><div className="overview-kpi-foot">Sales − milk cost − expenses</div>
      </div>
    </SwipeCards>

    <div className="overview-main-grid">
      <DashboardPerformance sales={sales} purchases={purchases} expenses={expenses} range={timeRange} period={dateFilter} onDetails={metric => metric === 'milk' ? setIsMilkProcurementModalOpen(true) : go(metric === 'expenses' ? 'expenses' : 'sales-history')} />
      <section className="overview-panel stock-panel" aria-label="Current retail milk stock">
        <div className="overview-panel-heading"><div><span className="overview-eyebrow">READY FOR THE COUNTER</span><h2>Retail milk stock</h2></div><span className="overview-current-badge"><i />Current</span></div>
        <div className="stock-display"><div><strong>{formatQty(retailMilk.liters)}<small> L</small></strong><span>Available to sell now</span></div><div className="overview-milk-vessel" aria-hidden="true"><div className="vessel-cap" /><div className="vessel-body"><div className="vessel-liquid" style={{ height: `${retailFill}%` }} /><Droplets size={27} /></div><div className="vessel-base" /></div></div>
        <div className={`stock-capacity ${retailMilk.liters < 0 || retailMilk.liters > RETAIL_CHILLER_CAPACITY ? 'overview-negative' : ''}`}><span>{retailMilk.liters < 0 ? 'Negative balance · check stock' : retailMilk.liters > RETAIL_CHILLER_CAPACITY ? `${formatQty(retailMilk.liters - RETAIL_CHILLER_CAPACITY)} L over capacity` : `${formatQty(retailFill, 1)}% of ${RETAIL_CHILLER_CAPACITY} L tank`}</span><div className="overview-progress"><span style={{ width: `${retailFill}%` }} /></div></div>
        <div className="stock-varieties">{retailMilk.rows.length > 0 ? retailMilk.rows.map(row => <div key={row.id}><span><i />{row.name}</span><b>{formatQty(row.liters)} <small>L</small></b><div className="overview-progress"><span style={{ width: `${Math.min(100, Math.max(0, row.percentOfTotal))}%` }} /></div></div>) : <div className="overview-empty compact"><Droplets size={20} /><span>No retail milk in stock</span></div>}</div>
        <div className="stock-value"><span>Retail stock value</span><strong>{formatCurrency(retailMilk.totalValue)}</strong></div>
      </section>
    </div>

    <section className="overview-payments" aria-label="Sales payment breakdown">
      <div className="overview-payment-heading"><span className="overview-step-icon"><Wallet size={18} /></span><div><h2>Sales collections</h2><span>{timeRangeText} · {formatQty(collectionRate, 1)}% collected</span></div></div>
      <div className="overview-payment-item"><span><i />Cash</span><strong>{formatCurrency(stats.cashSalesAmount)}</strong></div>
      <div className="overview-payment-item"><span><i />Online</span><strong>{formatCurrency(stats.onlineSalesAmount)}</strong></div>
      <button className="overview-payment-item" onClick={() => go('customers')} disabled={!canOpen('customers')}><span><i />Credit / khata<ArrowUpRight size={12} /></span><strong className="overview-negative">{formatCurrency(stats.creditSalesAmount)}</strong></button>
      <div className="overview-payment-progress" aria-hidden="true"><span style={{ width: `${stats.totalSalesAmount > 0 ? Math.min(100, stats.cashSalesAmount / stats.totalSalesAmount * 100) : 0}%` }} /><span style={{ width: `${stats.totalSalesAmount > 0 ? Math.min(100, stats.onlineSalesAmount / stats.totalSalesAmount * 100) : 0}%` }} /></div>
    </section>

    <section className="overview-panel milk-flow-panel">
      <div className="overview-panel-heading"><div><span className="overview-eyebrow">FROM COLLECTION TO COUNTER</span><h2>The milk journey</h2></div><button className="overview-text-button" onClick={() => go('allocation')} disabled={!canOpen('allocation')}>Manage allocation<ArrowUpRight size={15} /></button></div>
      <SwipeCards className="overview-milk-flow" label="Milk journey" labels={["Milk collected", "Chilling tank", "Retail allocation", "Production input"]}>{[
        { title: 'Milk collected', amount: stats.totalMilkLiters, note: `${stats.purchaseCount} entries · ${timeRangeText.toLowerCase()}`, icon: Droplets, module: 'purchase' },
        { title: 'In chilling tank', amount: stats.unallocatedMilkLiters, note: 'Current · awaiting allocation', icon: Layers, module: 'allocation' },
        { title: 'Sent to retail', amount: stats.retailAllocatedLiters, note: `Allocated · ${timeRangeText.toLowerCase()}`, icon: Store, module: 'allocation' },
        { title: 'Production input', amount: stats.productionAllocatedLiters, note: `Milk used · ${timeRangeText.toLowerCase()}`, icon: Factory, module: 'production' },
      ].map((step, index) => <React.Fragment key={step.title}>{index > 0 && <ArrowRight className="milk-flow-arrow" size={18} />}<button data-carousel-slide className="milk-flow-step" onClick={() => go(step.module)} disabled={!canOpen(step.module)}><div><span className="overview-step-icon"><step.icon size={19} /></span><span className="milk-step-number">0{index + 1}</span></div><span>{step.title}</span><strong>{formatQty(step.amount)} <small>L</small></strong><p>{step.note}</p></button></React.Fragment>)}</SwipeCards>
    </section>

    <section className={`overview-priorities ${alerts.length === 0 ? 'all-clear' : ''}`} aria-label="Business priorities">
      <div className="overview-priorities-title">{alerts.length ? <AlertTriangle size={18} /> : <CheckCircle2 size={19} />}<div><h2>{alerts.length ? 'Needs your attention' : 'You’re all caught up'}</h2><span>{alerts.length ? `${alerts.length} things to keep your dairy moving` : 'No stock, order, allocation or cash alerts.'}</span></div></div>
      <SwipeCards className="overview-priority-items" label="Business priorities" labels={alerts.map(alert => alert.title)}>{alerts.map(alert => <button data-carousel-slide key={alert.id} onClick={() => { if (canOpen(alert.module)) openTab('path' in alert && alert.path ? alert.path : alert.module); }} disabled={!canOpen(alert.module)}><alert.icon size={17} /><span><strong>{alert.title}</strong><small>{alert.detail}</small></span><ArrowUpRight size={15} /></button>)}</SwipeCards>
    </section>

    <SwipeCards className="overview-detail-grid" label="Business insights" labels={(["products", "collections", "expenses"] as const).filter(key => visiblePanels[key]).map(key => OPTIONAL_PANELS[key])}>
      {visiblePanels.products && <section data-carousel-slide className="overview-panel products-panel"><div className="overview-panel-heading"><div><span className="overview-eyebrow">WHAT YOUR CUSTOMERS LOVE</span><h2>Best sellers</h2></div><span className="overview-period-badge">{timeRangeText}</span></div><div className="overview-product-list">{topProducts.length ? topProducts.map((product, index) => <div className="overview-product" key={product.name}><span className="overview-product-rank">{String(index + 1).padStart(2, '0')}</span><div><div><b>{product.name}</b><strong>{formatCurrency(product.revenue)}</strong></div><span>{formatQty(product.qty)} {product.unit} sold <span>{product.share}% of sales</span></span><div className="overview-progress"><span style={{ width: `${product.barWidth}%` }} /></div></div></div>) : <div className="overview-empty"><Package size={25} /><b>Your next best seller starts here</b><span>Products appear after a sale in this period.</span></div>}</div><button className="overview-panel-link" disabled={!canOpen('sales-history')} onClick={() => go('sales-history')}>Explore sales history<ArrowRight size={15} /></button></section>}
      {visiblePanels.collections && <section data-carousel-slide className="overview-panel collections-panel"><div className="overview-panel-heading"><div><span className="overview-eyebrow">TURN BALANCES INTO CASH</span><h2>Collection priorities</h2></div><Users size={18} className="overview-muted" /></div><div className="overview-collection-total"><span>Customer receivables · current</span><strong>{formatCurrency(stats.totalCustomerReceivables)}</strong></div><div className="overview-debtors">{debtors.length ? debtors.map(customer => <button key={customer.id} onClick={() => { if (canOpen('customers')) openTab({ id: 'customers', path: `/customers?id=${encodeURIComponent(customer.id)}` }); }} disabled={!canOpen('customers')}><span className="overview-avatar">{customer.name.slice(0, 2).toUpperCase()}</span><span><b>{customer.name}</b><small>{Number(customer.credit_limit) > 0 && Number(customer.balance) > Number(customer.credit_limit) ? 'Credit limit exceeded' : customer.route || 'Outstanding balance'}</small></span><strong>{formatCurrency(customer.balance)}</strong><ChevronRight size={13} /></button>) : <div className="overview-empty compact"><CheckCircle2 size={24} /><span>No customer dues. Looking good.</span></div>}</div><button className="overview-panel-link" disabled={!canOpen('customers')} onClick={() => go('customers')}>Open customer khata<ArrowRight size={15} /></button></section>}
      {visiblePanels.expenses && <section data-carousel-slide className="overview-panel expense-panel"><div className="overview-panel-heading"><div><span className="overview-eyebrow">KNOW WHERE IT GOES</span><h2>Expense breakdown</h2></div><Receipt size={18} className="overview-muted" /></div><div className="overview-expense-total"><strong>{formatCurrency(expenseStats.totalAmount)}</strong><span>{timeRangeText} · {expenseStats.count} entries</span></div><div className="overview-expense-list">{expenseStats.categoriesSorted.length ? expenseStats.categoriesSorted.slice(0, 4).map(category => <div key={category.name}><div><span>{category.name}</span><b>{formatCurrency(category.amount)}</b></div><div className="overview-progress"><span style={{ width: `${category.percent}%` }} /></div><small>{category.percent}% of expenses</small></div>) : <div className="overview-empty compact"><Receipt size={24} /><span>No expenses in this period.</span></div>}</div><div className="overview-expense-footer"><span>Pending in this period</span><strong className="overview-negative">{formatCurrency(expenseStats.pendingAmount)}</strong></div><button className="overview-panel-link" disabled={!canOpen('expenses')} onClick={() => go('expenses')}>Manage expenses<ArrowRight size={15} /></button></section>}
    </SwipeCards>

    <div className={`overview-bottom-grid ${!visiblePanels.activity ? 'without-activity' : ''}`}>
      {visiblePanels.activity && <section className="overview-panel activity-panel"><div className="overview-panel-heading"><div><span className="overview-eyebrow">THE LATEST IN YOUR BUSINESS</span><h2>Recent activity</h2></div><span className="overview-period-badge">{timeRangeText}</span></div><div className="overview-activity-head"><span>Transaction</span><span>Payment / status</span><span>Amount</span></div>{recentActivity.length ? recentActivity.map(entry => <button className="overview-activity-row" key={entry.id} onClick={() => go(entry.module)} disabled={!canOpen(entry.module)}><span className={`overview-activity-icon ${entry.incoming ? 'incoming' : ''}`}><entry.icon size={17} /></span><span className="activity-description"><b>{entry.title}</b><small>{entry.detail}</small></span><span className={`overview-status ${entry.mode === 'Credit' || entry.mode === 'Unpaid' ? 'due' : ''}`}>{entry.mode}</span><span className="activity-amount"><strong>{formatCurrency(entry.amount)}</strong><small>{reportDate(businessDate(entry.date))}</small></span></button>) : <div className="overview-empty"><Activity size={25} /><b>A fresh page for your business</b><span>Sales, milk collections and expenses will appear here.</span></div>}</section>}
      <section className="overview-panel cash-panel"><div className="overview-panel-heading"><div><span className="overview-eyebrow">CASH & COMMITMENTS</span><h2>Your money, in focus</h2></div><Wallet size={18} className="overview-muted" /></div><div className="overview-cash-total"><span>Cash + bank + wallets · current</span><strong>{formatCurrency(stats.totalLiquidCash + stats.totalBankBalance)}</strong></div><div className="overview-cash-accounts"><button onClick={() => go('bank-cash')} disabled={!canOpen('bank-cash')}><span>Cash accounts</span><strong>{formatCurrency(stats.totalLiquidCash)}</strong></button><button onClick={() => go('bank-cash')} disabled={!canOpen('bank-cash')}><span>Bank & wallets</span><strong>{formatCurrency(stats.totalBankBalance)}</strong></button><button onClick={() => go('cash-control')} disabled={!canOpen('cash-control')}><span>In transit <small>separate</small></span><strong>{formatCurrency(stats.inTransitCash)}</strong></button></div><div className="overview-cash-movement"><span>Party payments · {timeRangeText.toLowerCase()}</span><div><span><ArrowDownLeft size={14} />Customers received</span><b>{formatCurrency(partyCashFlows.customers.totalReceived)}</b></div><div><span><ArrowUpRight size={14} />Suppliers paid</span><b>{formatCurrency(partyCashFlows.suppliers.totalPaid)}</b></div><div><span><ArrowUpRight size={14} />Vendors & materials paid</span><b>{formatCurrency(partyCashFlows.vendors.totalPaid)}</b></div></div><button className="overview-panel-link" onClick={() => go('suppliers')} disabled={!canOpen('suppliers')}>Supplier payables<strong className="overview-negative">{formatCurrency(stats.totalSupplierPayables)}</strong><ArrowRight size={14} /></button></section>
    </div>

    <div className="overview-footer"><span><span className="overview-brand-dot" />MOOCO <span>· A little clarity goes a long way.</span></span><span>{activeShiftSession?.status === 'Active' && (!activeShiftSession.business_date || activeShiftSession.business_date === todayKey) ? `${activeShiftSession.shift_name || 'Counter shift'} active` : 'Manage your shift in Cash Control'}<button onClick={() => go('cash-control')} disabled={!canOpen('cash-control')} aria-label="Open Cash Control"><ArrowUpRight size={14} /></button></span></div>
    <div className="overview-mobile-actions"><button className="overview-button secondary" onClick={() => go('purchase')} disabled={!canOpen('purchase')}><Droplets size={17} />Collect milk</button><button className="overview-button primary" onClick={() => go('pos')} disabled={!canOpen('pos')}><Plus size={18} />New sale</button></div>

    <MilkProcurementDetailModal isOpen={isMilkProcurementModalOpen} onClose={closeProcurement} purchases={rangePurchases} suppliers={suppliers} periodLabel={timeRangeText} dateRangeText={`${dateFilter.start} to ${dateFilter.end}`} totalMilkLiters={stats.totalMilkLiters} totalMilkCost={stats.totalMilkCost} avgMilkRate={stats.avgMilkRate} buffaloLiters={stats.buffaloLiters} cowLiters={stats.cowLiters} onOpenProcurement={() => go('purchase')} onNavigateToSupplier={supplierId => { if (canOpen('suppliers')) { openTab({ id: 'suppliers', path: `/suppliers?id=${encodeURIComponent(supplierId)}` }); window.dispatchEvent(new CustomEvent('mooco-select-supplier', { detail: { supplierId } })); } }} />
  </div>;
};
export default Dashboard;
