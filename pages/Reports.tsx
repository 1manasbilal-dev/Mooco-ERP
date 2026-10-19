import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { loadPdfRuntime } from '../lib/pdfRuntime';
import { formatCompactValue, formatCurrency } from '../lib/formatters';
import StockProfitReportView from '../components/StockProfitReport';
import { buildStockProfitReport, itemStockValue, profitDay, returnedQtyForLine, StockProfitSource } from '../lib/stockProfit';
import { saleLineStock } from '../lib/sellUnits';
import { loadStockProfitSource } from '../lib/stockProfitData';
import { motion } from 'framer-motion';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area
} from 'recharts';
import { 
  Calendar, Printer, Download, TrendingUp, TrendingDown, DollarSign, 
  ShoppingCart, Truck, Package, FileText, 
  Filter, Briefcase, Layers, CheckCircle2,
  Activity, Search, Users, Factory, AlertCircle, ArrowRightLeft, CreditCard,
  ChevronRight, RefreshCw, Eye, ArrowUpRight, ArrowDownRight, Scale, Clock, ShieldCheck,
  Droplets, Banknote, Calculator, Receipt, Coins, Sparkles, Check, X, ArrowDownLeft, HelpCircle, Info, Share2,
  Copy, SlidersHorizontal, CheckSquare, Square, FileSpreadsheet, FileDown, Loader2,
  Phone, MapPin
} from 'lucide-react';
import { exportToCSV } from '../lib/exportUtils';
import { roundCurrency, roundQuantity } from '../lib/db';
import {
  bankTxCategory, expenseCashPaid, isInternalCashTransfer, isPurchaseReturnTx,
  isSalesRefundTx, isSpotSupplierPayment, materialCashPaid, purchaseCashPaid, saleCashCollected, saleOnlineCollected, saleNetCollection
} from '../lib/moneyFlow';

const MotionDiv = motion.div as any;

/** Litres in one base unit: 1 for litre units, 0.001 for ml, 0 for anything that is not a volume. */
const litresPerBaseUnit = (unit?: string): number => {
  const u = String(unit || '').trim().toLowerCase();
  if (['l', 'ltr', 'ltrs', 'liter', 'liters', 'litre', 'litres'].includes(u)) return 1;
  if (['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'].includes(u)) return 0.001;
  return 0;
};

// --- Chart Palette ---
const CHART_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16'];

// --- Types ---
type ReportCategory = 'financial' | 'sales' | 'inventory' | 'purchase' | 'production';
type ReportType = 
  | 'stock_profit' | 'pnl' | 'balance_sheet' | 'cash_flow'
  | 'day_book' | 'sales_by_customer' | 'sales_by_item'
  | 'stock_summary' | 'item_ledger' | 'low_stock'
  | 'purchase_register' | 'supplier_summary'
  | 'production_yield';

interface ReportDefinition {
  id: ReportType;
  label: string;
  subtitle: string;
  icon: React.ElementType;
}

const REPORT_MENU: Record<ReportCategory, { label: string; icon: React.ElementType; reports: ReportDefinition[] }> = {
  financial: {
    label: 'Financial Statements',
    icon: Briefcase,
    reports: [
      { id: 'stock_profit', label: 'Actual Profit (Stock Based)', subtitle: 'Opening stock, purchases, closing stock & net profit', icon: Calculator },
      { id: 'pnl', label: 'Profit & Loss (Income)', subtitle: 'Gross margin, operating overheads & net revenue', icon: TrendingUp },
      { id: 'balance_sheet', label: 'Balance Sheet', subtitle: 'Assets, liabilities & equity equilibrium', icon: Scale },
      { id: 'cash_flow', label: 'Cash Flow Statement', subtitle: 'Operating, investing & liquid cash movement', icon: Activity },
    ]
  },
  sales: {
    label: 'Sales & Day Book',
    icon: ShoppingCart,
    reports: [
      { id: 'day_book', label: 'Day Book (Daily Summary)', subtitle: 'Comprehensive chronological activity journal', icon: FileText },
      { id: 'sales_by_customer', label: 'Customer Outstanding & Balances', subtitle: 'Customer receivables, outstanding dues & recovery statement', icon: Users },
      { id: 'sales_by_item', label: 'Item Performance', subtitle: 'Product sales volume, revenue & category share', icon: Package },
    ]
  },
  inventory: {
    label: 'Inventory Control',
    icon: Layers,
    reports: [
      { id: 'stock_summary', label: 'Stock Valuation', subtitle: 'Current inventory quantity, cost & retail worth', icon: Layers },
      { id: 'item_ledger', label: 'Item Stock Ledger', subtitle: 'In/Out movement audit trail with running balances', icon: Search },
      { id: 'low_stock', label: 'Low Stock Alerts', subtitle: 'Items below safety threshold & reorder guide', icon: AlertCircle },
    ]
  },
  purchase: {
    label: 'Procurement',
    icon: Truck,
    reports: [
      { id: 'purchase_register', label: 'Purchase Register', subtitle: 'Raw milk FAT/SNF, shift volume & material buys', icon: ShoppingCart },
      { id: 'supplier_summary', label: 'Supplier Ledger Summary', subtitle: 'Supplier milk supplied, payments & payable balances', icon: Truck },
    ]
  },
  production: {
    label: 'Manufacturing',
    icon: Factory,
    reports: [
      { id: 'production_yield', label: 'Production Yield & Cost', subtitle: 'Milk conversion ratios, processing loss & yield %', icon: Factory },
    ]
  }
};

type PresetRange = 'today' | 'yesterday' | '7days' | '30days' | 'month' | 'last_month' | 'year' | 'custom';

const Reports: React.FC = () => {
  const { 
    sales = [], dailySupplyEntries = [], purchases = [], materialPurchases = [], 
    expenses = [], inventory = [], productionBatches = [], allocations = [],
    customers = [], suppliers = [], accounts = [], manualAccounts = [], items = [], bankTransactions = [],
    inventoryLogs = [], customerTransactions = [], supplierTransactions = [],
    expenseVendors = [], expenseVendorTransactions = [],
    shiftSessions = [], cashInTransit,
    currentUser, settings
  } = useDairy();

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as ReportType | null;
  const presetParam = searchParams.get('preset') as PresetRange | null;

  // --- Active State ---
  const [activeReport, setActiveReport] = useState<ReportType>(() => tabParam || 'pnl');
  const [timePreset, setTimePreset] = useState<PresetRange>(() => presetParam || (tabParam === 'day_book' ? 'today' : 'month'));
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date();
    const today = profitDay(now.toISOString());
    if (presetParam === 'today' || tabParam === 'day_book') {
      return { start: today, end: today };
    }
    const startOfMonth = `${today.slice(0, 7)}-01`;
    return { start: startOfMonth, end: today };
  });

  const { showToast } = useToast();
  const [profitSource, setProfitSource] = useState<StockProfitSource | null>(null);
  const [profitLoading, setProfitLoading] = useState(false);
  const [profitError, setProfitError] = useState<string | null>(null);
  const [profitRefresh, setProfitRefresh] = useState(0);
  useEffect(() => {
    if (activeReport !== 'stock_profit') return;
    let current = true;
    setProfitLoading(true);
    setProfitError(null);
    loadStockProfitSource().then(source => {
      if (current) setProfitSource(source);
    }).catch(error => {
      if (current) { setProfitSource(null); setProfitError(error instanceof Error ? error.message : 'Full stock history could not be loaded.'); }
    }).finally(() => { if (current) setProfitLoading(false); });
    return () => { current = false; };
  }, [activeReport, profitRefresh]);
  const stockProfitData = useMemo(() => profitSource ? buildStockProfitReport(profitSource, dateRange.start, dateRange.end) : null, [profitSource, dateRange]);

  const selectReport = (repId: ReportType) => {
    setActiveReport(repId);
    setMobileMenuOpen(false);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', repId);
      return next;
    }, { replace: true });
  };

  // Day Book States (Daily Business Summary & Print/PDF Studio)
  const [dayBookViewMode, setDayBookViewMode] = useState<'simple' | 'detailed'>('simple');
  const [isDayBookSlipModalOpen, setIsDayBookSlipModalOpen] = useState(false);
  const [dayBookFilterCategory, setDayBookFilterCategory] = useState<'all' | 'Income' | 'Expense' | 'Milk' | 'Credit'>('all');
  const [dayBookPrintFormat, setDayBookPrintFormat] = useState<'a4' | 'thermal'>('a4');
  const [printIncludeExpenses, setPrintIncludeExpenses] = useState(true);
  const [printIncludeSuppliers, setPrintIncludeSuppliers] = useState(true);
  const [printIncludeProducts, setPrintIncludeProducts] = useState(true);
  const [printIncludeSignatures, setPrintIncludeSignatures] = useState(true);
  const [printIncludeAccounts, setPrintIncludeAccounts] = useState(true);
  const [isWhatsAppCopied, setIsWhatsAppCopied] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  // Customer Outstanding Balances Print & PDF Studio States
  const [isCustomerBalanceModalOpen, setIsCustomerBalanceModalOpen] = useState(false);
  const [customerPrintFormat, setCustomerPrintFormat] = useState<'a4' | 'thermal'>('a4');
  const [customerPrintFilter, setCustomerPrintFilter] = useState<'dues_only' | 'all' | 'advance_only'>('dues_only');
  const [customerPrintRoute, setCustomerPrintRoute] = useState<string>('all');
  const [customerPrintSort, setCustomerPrintSort] = useState<'balance_desc' | 'name_asc' | 'route'>('balance_desc');
  const [customerPrintIncludeSalesDetails, setCustomerPrintIncludeSalesDetails] = useState(true);
  const [customerPrintIncludeRecoveryBoxes, setCustomerPrintIncludeRecoveryBoxes] = useState(true);
  const [customerPrintIncludeKPIs, setCustomerPrintIncludeKPIs] = useState(true);
  const [customerPrintIncludeSignatures, setCustomerPrintIncludeSignatures] = useState(true);
  const [customerPrintDensity, setCustomerPrintDensity] = useState<'normal' | 'compact'>('normal');
  const [isCustomerWhatsAppCopied, setIsCustomerWhatsAppCopied] = useState(false);
  const [isCustomerBalancePDFGenerating, setIsCustomerBalancePDFGenerating] = useState(false);
  const [customerInPageFilter, setCustomerInPageFilter] = useState<'all' | 'dues_only' | 'advance_only'>('all');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string>('all');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('all');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('all');
  const [transactionTypeFilter, setTransactionTypeFilter] = useState<'all' | 'Income' | 'Expense'>('all');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tabParam && tabParam !== activeReport) {
      setActiveReport(tabParam);
    }
  }, [tabParam, activeReport]);

  // --- Date Range Presets Handler ---
  const applyPreset = (preset: PresetRange) => {
    setTimePreset(preset);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', activeReport);
      next.set('preset', preset);
      return next;
    }, { replace: true });
    const todayStr = profitDay(new Date().toISOString());
    // Noon UTC keeps calendar arithmetic stable across the shop's timezone.
    const now = new Date(`${todayStr}T12:00:00Z`);
    const shiftDate = (days: number) => { const value = new Date(now); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };

    if (preset === 'today') {
      setDateRange({ start: todayStr, end: todayStr });
    } else if (preset === 'yesterday') {
      const yStr = shiftDate(-1);
      setDateRange({ start: yStr, end: yStr });
    } else if (preset === '7days') {
      setDateRange({ start: shiftDate(-6), end: todayStr });
    } else if (preset === '30days') {
      setDateRange({ start: shiftDate(-29), end: todayStr });
    } else if (preset === 'month') {
      const start = `${todayStr.slice(0, 7)}-01`;
      setDateRange({ start, end: todayStr });
    } else if (preset === 'last_month') {
      const firstDayLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 12)).toISOString().slice(0, 10);
      const lastDayLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 12)).toISOString().slice(0, 10);
      setDateRange({ start: firstDayLastMonth, end: lastDayLastMonth });
    } else if (preset === 'year') {
      const startYear = `${now.getUTCFullYear()}-01-01`;
      setDateRange({ start: startYear, end: todayStr });
    }
  };

  // --- Helpers ---
  const normalizeDate = (d?: string) => {
    if (!d) return '';
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
    } catch {
      return d.split('T')[0] || '';
    }
  };
  const isInRange = (dateStr?: string) => {
    if (!dateStr) return false;
    const d = normalizeDate(dateStr);
    return d >= dateRange.start && d <= dateRange.end;
  };

  const formatCurrency = (amount: number) => {
    return formatCurrency(Math.round(amount || 0));
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  // --- REPORT 1: Profit & Loss ---
  const pnlData = useMemo(() => {
    const validSales = sales.filter(s => isInRange(s.date) && s.status !== 'Returned' && s.status !== 'Cancelled');
    // Net of returns, so cash + online + credit always adds up to revenue.
    const keptBySale = validSales.map(s => saleNetCollection(s));
    const posRevenue = keptBySale.reduce((sum, k) => sum + k.net, 0);
    const posCash = keptBySale.reduce((sum, k) => sum + k.cash, 0);
    const posDigital = keptBySale.reduce((sum, k) => sum + k.online, 0);
    const posCredit = keptBySale.reduce((sum, k) => sum + k.credit, 0);

    const validSupplies = dailySupplyEntries.filter(s => isInRange(s.date) && s.details?.status !== 'Cancelled' && s.details?.status !== 'Pending');
    const supplyRevenue = validSupplies.reduce((sum, s) => sum + (s.total_amount || 0), 0);
    const supplyLiters = validSupplies.reduce((sum, s) => sum + (s.quantity || 0), 0);

    const totalRevenue = posRevenue + supplyRevenue;

    const validPurchases = purchases.filter(p => isInRange(p.date) && p.status !== 'Returned' && p.status !== 'Cancelled');
    const milkCost = validPurchases.reduce((sum, p) => sum + (p.total_amount || 0), 0);
    const milkLiters = validPurchases.reduce((sum, p) => sum + (p.quantity || 0), 0);

    const validMaterial = materialPurchases.filter(p => isInRange(p.date) && p.status !== 'Returned' && p.status !== 'Cancelled');
    const materialCost = validMaterial.reduce((sum, p) => sum + (p.total_amount || 0), 0);

    const totalCOGS = milkCost + materialCost;
    const grossProfit = totalRevenue - totalCOGS;
    const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    const validExpenses = expenses.filter(e => isInRange(e.date) && (e as any).status !== 'Cancelled' && (e as any).status !== 'Returned');
    const operatingCost = validExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);

    // Group expenses by category
    const expensesByCategory: Record<string, number> = {};
    validExpenses.forEach(e => {
      const cat = e.category || 'General & Overhead';
      expensesByCategory[cat] = (expensesByCategory[cat] || 0) + (e.amount || 0);
    });

    const netProfit = grossProfit - operatingCost;
    const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    // Daily trend for chart
    const trendMap: Record<string, { date: string; revenue: number; cogs: number; expenses: number; profit: number }> = {};
    validSales.forEach(s => {
      const d = normalizeDate(s.date);
      if (!trendMap[d]) trendMap[d] = { date: d, revenue: 0, cogs: 0, expenses: 0, profit: 0 };
      const refund = s.status === 'Partially Returned' ? (Number(s.refund_amount) || 0) : 0;
      trendMap[d].revenue += Math.max(0, (Number(s.total) || 0) - refund);
    });
    validSupplies.forEach(s => {
      const d = normalizeDate(s.date);
      if (!trendMap[d]) trendMap[d] = { date: d, revenue: 0, cogs: 0, expenses: 0, profit: 0 };
      trendMap[d].revenue += s.total_amount || 0;
    });
    validPurchases.forEach(p => {
      const d = normalizeDate(p.date);
      if (!trendMap[d]) trendMap[d] = { date: d, revenue: 0, cogs: 0, expenses: 0, profit: 0 };
      trendMap[d].cogs += p.total_amount || 0;
    });
    validMaterial.forEach(p => {
      const d = normalizeDate(p.date);
      if (!trendMap[d]) trendMap[d] = { date: d, revenue: 0, cogs: 0, expenses: 0, profit: 0 };
      trendMap[d].cogs += p.total_amount || 0;
    });
    validExpenses.forEach(e => {
      const d = normalizeDate(e.date);
      if (!trendMap[d]) trendMap[d] = { date: d, revenue: 0, cogs: 0, expenses: 0, profit: 0 };
      trendMap[d].expenses += e.amount || 0;
    });

    const trendData = Object.values(trendMap)
      .map(item => ({
        ...item,
        label: formatDate(item.date),
        profit: item.revenue - (item.cogs + item.expenses)
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const expensePieData = Object.entries(expensesByCategory).map(([name, value]) => ({ name, value }));

    return {
      posRevenue, posCash, posCredit, posDigital,
      supplyRevenue, supplyLiters, totalRevenue,
      milkCost, milkLiters, materialCost, totalCOGS,
      grossProfit, grossMargin,
      operatingCost, expensesByCategory,
      netProfit, netMargin,
      trendData, expensePieData
    };
  }, [sales, dailySupplyEntries, purchases, materialPurchases, expenses, dateRange]);

  // --- REPORT 2: Balance Sheet ---
  const balanceSheetData = useMemo(() => {
    // Current Assets
    const cashBank = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);
    const transitCash = cashInTransit?.amount || 0;

    // Inventory at accurate Cost Price (Loose + Packaged Variants + Unallocated Raw Milk + WIP Production)
    const stockVal = items.reduce((sum, item) => {
      const inv = inventory.find(i => i.item_id === item.id || i.name.toLowerCase() === item.name.toLowerCase());
      const looseStock = inv ? (Number(inv.quantity) || 0) : (Number(item.stock) || 0);
      const variantStocks = inv?.variant_stocks || item.variant_stocks || {};
      // Same rule as Stock Valuation: loose + active packed counts at cost, negatives valued at zero.
      return sum + itemStockValue(item, looseStock, variantStocks).costValue;
    }, 0);

    const unallocatedMilkVal = allocations
      .filter(a => a.status !== 'Fully Allocated')
      .reduce((sum, a) => {
        const remQty = a.remaining_quantity !== null && a.remaining_quantity !== undefined ? Number(a.remaining_quantity) : Number(a.original_quantity || 0);
        return sum + (Math.max(0, remQty) * (Number(a.average_rate) || 0));
      }, 0);

    const wipVal = productionBatches
      .filter(b => b.status === 'Processing' || b.status === 'Staged')
      .reduce((sum, b) => {
        const milkCost = (Number(b.quantity_input) || 0) * (Number(b.input_cost_per_unit || b.details?.input_cost_per_unit) || 0);
        return sum + milkCost;
      }, 0);

    const totalInventoryValuation = roundCurrency(stockVal + unallocatedMilkVal + wipVal);

    // Customer Debtors (Receivables)
    const debtors = customers.reduce((sum, c) => sum + ((c.balance || 0) > 0 ? c.balance : 0), 0);

    // Supplier Advances (Prepaid to Suppliers)
    const supplierAdvances = suppliers.reduce((sum, s) => sum + ((s.pending_balance || 0) < 0 ? Math.abs(s.pending_balance) : 0), 0);

    const fixedAssets = manualAccounts.filter(a => a.type === 'Asset').reduce((sum, a) => sum + (a.balance || 0), 0);
    const totalAssets = roundCurrency(cashBank + transitCash + totalInventoryValuation + debtors + supplierAdvances + fixedAssets);

    // Current Liabilities
    const creditors = suppliers.reduce((sum, s) => sum + ((s.pending_balance || 0) > 0 ? s.pending_balance : 0), 0);
    const custAdvances = customers.reduce((sum, c) => sum + ((c.balance || 0) < 0 ? Math.abs(c.balance) : 0), 0);
    const expensePayables = expenseVendors.reduce((sum, v) => sum + ((v.pending_balance || 0) > 0 ? v.pending_balance : 0), 0);
    const loans = manualAccounts.filter(a => a.type === 'Liability').reduce((sum, a) => sum + (a.balance || 0), 0);
    const totalLiabilities = roundCurrency(creditors + custAdvances + expensePayables + loans);

    // Equity
    const equityManual = manualAccounts.filter(a => a.type === 'Equity').reduce((sum, a) => sum + (a.balance || 0), 0);
    const retainedEarnings = roundCurrency(totalAssets - totalLiabilities - equityManual);
    const totalEquity = roundCurrency(equityManual + retainedEarnings);

    const totalLiabAndEquity = roundCurrency(totalLiabilities + totalEquity);
    const difference = roundCurrency(totalAssets - totalLiabAndEquity);
    const isBalanced = Math.abs(difference) < 1;

    return {
      assets: { cashBank: roundCurrency(cashBank + transitCash), stockVal: totalInventoryValuation, debtors, fixedAssets: roundCurrency(fixedAssets + supplierAdvances), totalAssets },
      liabilities: { creditors: roundCurrency(creditors + expensePayables), custAdvances, loans, totalLiabilities },
      equity: { equityManual, retainedEarnings, totalEquity },
      totalLiabAndEquity,
      difference,
      isBalanced
    };
  }, [accounts, cashInTransit, items, inventory, allocations, productionBatches, customers, suppliers, expenseVendors, manualAccounts]);

  // --- REPORT 3: Cash Flow Statement ---
  const cashFlowData = useMemo(() => {
    // Cash and digital that entered on the sale date, including bills later returned.
    const posCashSales = sales
      .filter(s => isInRange(s.date) && s.status !== 'Cancelled')
      .reduce((sum, s) => sum + saleCashCollected(s), 0);

    const posOnlineSales = sales
      .filter(s => isInRange(s.date) && s.status !== 'Cancelled')
      .reduce((sum, s) => sum + saleOnlineCollected(s), 0);

    const custPayments = customerTransactions
      .filter(t => isInRange(t.date) && t.type === 'Payment')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const dailySupplyReceipts = dailySupplyEntries
      .filter(s => isInRange(s.date) && s.details?.status !== 'Cancelled' && (Number(s.details?.payment_received) || 0) > 0)
      .reduce((sum, s) => sum + Number(s.details.payment_received), 0);

    const purchaseReturnIn = bankTransactions
      .filter(t => isInRange(t.date) && isPurchaseReturnTx(t) && !isInternalCashTransfer(t))
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    const vendorRefunds = expenseVendorTransactions
      .filter(t => isInRange(t.date) && t.type === 'Refund')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    const bankDeposits = bankTransactions
      .filter(t => isInRange(t.date) && t.type === 'Deposit' && !isInternalCashTransfer(t))
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    const totalInflows = posCashSales + posOnlineSales + custPayments + dailySupplyReceipts + purchaseReturnIn + vendorRefunds + bankDeposits;

    // 2. Operating Outflows — only money that left an account
    const milkPaid = purchases
      .filter(p => isInRange(p.date) && p.status !== 'Cancelled')
      .reduce((sum, p) => sum + purchaseCashPaid(p), 0);

    const supplierPayments = supplierTransactions
      .filter(t => isInRange(t.date) && (t.type === 'Payment' || t.type === 'Advance') && !isSpotSupplierPayment(t))
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    const materialDocPaid = materialPurchases
      .filter(p => isInRange(p.date) && p.status !== 'Returned')
      .reduce((sum, p) => sum + materialCashPaid(p), 0);
    const materialBankPaid = bankTransactions
      .filter(t => isInRange(t.date) && t.type === 'Expense' && bankTxCategory(t) === 'Purchase')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const materialPaid = Math.max(materialDocPaid, materialBankPaid);

    const expensesPaid = expenses
      .filter(e => isInRange(e.date))
      .reduce((sum, e) => sum + expenseCashPaid(e), 0);

    const vendorPayments = expenseVendorTransactions
      .filter(t => isInRange(t.date) && t.type === 'Payment')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    const salesRefunds = bankTransactions
      .filter(t => isInRange(t.date) && isSalesRefundTx(t))
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    const bankWithdrawals = bankTransactions
      .filter(t => isInRange(t.date) && t.type === 'Withdrawal' && !isInternalCashTransfer(t))
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    const totalOutflows = milkPaid + supplierPayments + materialPaid + expensesPaid + vendorPayments + salesRefunds + bankWithdrawals;
    const netCashFlow = totalInflows - totalOutflows;
    const totalLiquidAccounts = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);

    const comparisonData = [
      { category: 'Cash Inflows', amount: totalInflows, fill: '#10b981' },
      { category: 'Cash Outflows', amount: totalOutflows, fill: '#ef4444' },
      { category: 'Net Cash Flow', amount: Math.abs(netCashFlow), fill: netCashFlow >= 0 ? '#3b82f6' : '#f59e0b' }
    ];

    return {
      posCashSales, posOnlineSales, custPayments, dailySupplyReceipts, purchaseReturnIn, bankDeposits, totalInflows,
      milkPaid, supplierPayments, materialPaid, expensesPaid, vendorPayments, salesRefunds, bankWithdrawals, totalOutflows,
      netCashFlow, totalLiquidAccounts, comparisonData
    };
  }, [sales, purchases, materialPurchases, expenses, customerTransactions, supplierTransactions, expenseVendorTransactions, dailySupplyEntries, bankTransactions, accounts, dateRange]);

  // --- REPORT 4: Comprehensive Day Book (Daily Business Summary) ---
  const dayBookData = useMemo(() => {
    // 1. Filter basic entities by date range
    const validSales = sales.filter(s => isInRange(s.date) && s.status !== 'Returned' && s.status !== 'Cancelled');
    const validPurchases = purchases.filter(p => isInRange(p.date) && p.status !== 'Returned' && p.status !== 'Cancelled');
    const validMaterialPurchases = materialPurchases.filter(p => isInRange(p.date) && p.status !== 'Returned' && p.status !== 'Cancelled');
    const validExpenses = expenses.filter(e => isInRange(e.date) && (e as any).status !== 'Cancelled' && (e as any).status !== 'Returned');
    const validCustTxns = customerTransactions.filter(t => isInRange(t.date));
    const validSuppTxns = supplierTransactions.filter(t => isInRange(t.date));
    const validSupply = dailySupplyEntries.filter(s => isInRange(s.date) && s.details?.status !== 'Cancelled' && s.details?.status !== 'Pending');
    const validBatches = productionBatches.filter(b => isInRange(b.start_date || b.created_at) && b.status !== 'Cancelled');

    // 2. Milk Intake & Procurement
    let cowLitresIn = 0;
    let cowCostIn = 0;
    let buffaloLitresIn = 0;
    let buffaloCostIn = 0;
    let spotMilkCashPaid = 0;
    let milkAccruedCredit = 0;
    const milkSuppliersMap: Record<string, { name: string; cowL: number; buffL: number; totalL: number; totalAmt: number; paidAmt: number; dueAmt: number }> = {};

    validPurchases.forEach(p => {
      const sup = suppliers.find(s => s.id === p.supplier_id);
      const supName = sup?.name || p.details?.supplier_name || 'Supplier';
      const qty = Number(p.quantity || 0);
      const totalAmt = Number(p.total_amount || 0);
      const paid = purchaseCashPaid(p) || Number(p.details?.paid_amount !== undefined ? p.details.paid_amount : (p.drawer_id ? totalAmt : 0));
      const due = Number(p.details?.due_amount !== undefined ? p.details.due_amount : Math.max(0, totalAmt - paid));

      if (p.milk_type === 'Cow') {
        cowLitresIn += qty;
        cowCostIn += totalAmt;
      } else {
        buffaloLitresIn += qty;
        buffaloCostIn += totalAmt;
      }

      spotMilkCashPaid += paid;
      milkAccruedCredit += due;

      if (!milkSuppliersMap[supName]) {
        milkSuppliersMap[supName] = { name: supName, cowL: 0, buffL: 0, totalL: 0, totalAmt: 0, paidAmt: 0, dueAmt: 0 };
      }
      if (p.milk_type === 'Cow') milkSuppliersMap[supName].cowL += qty;
      else milkSuppliersMap[supName].buffL += qty;
      milkSuppliersMap[supName].totalL += qty;
      milkSuppliersMap[supName].totalAmt += totalAmt;
      milkSuppliersMap[supName].paidAmt += paid;
      milkSuppliersMap[supName].dueAmt += due;
    });

    const totalMilkInLitres = cowLitresIn + buffaloLitresIn;
    const totalMilkInCost = cowCostIn + buffaloCostIn;
    const milkSuppliersList = Object.values(milkSuppliersMap);
    spotMilkCashPaid += purchases
      .filter(p => isInRange(p.date) && p.status === 'Returned')
      .reduce((sum, p) => sum + purchaseCashPaid(p), 0);

    // 3. Milk Sales, Supplies & Production Usage
    let counterMilkLitres = 0;
    let counterMilkRevenue = 0;
    const productSalesMap: Record<string, { name: string; qty: number; unit: string; revenue: number; ordersCount: number }> = {};

    validSales.forEach(s => {
      const itemsList = Array.isArray(s.items) ? s.items : [];
      itemsList.forEach((it: any) => {
        const itName = it.name || 'Unknown Item';
        const itQty = Number(it.qty !== undefined ? it.qty : (it.quantity || 0));
        const itUnit = it.unit || 'unit';
        const grossRev = Number(it.total ?? it.customTotal ?? (itQty * (Number(it.price || it.selling_price || 0)))) || 0;
        // Refunded quantity of this exact line (same item and same pack size) is not a sale.
        const netQty = Math.max(0, itQty - returnedQtyForLine(s, it));
        const itRev = itQty > 0 ? grossRev * (netQty / itQty) : 0;
        const catalogItem = items.find(ci => ci.id === it.itemId) || items.find(ci => ci.name.toLowerCase() === itName.toLowerCase());
        const stockLine = saleLineStock({ ...it, qty: netQty }, catalogItem);

        // Group by product and sell unit so 1 kg and Pao lines are never added together.
        const key = `${it.itemId || itName}::${stockLine.variantId || (it.variantId && it.variantId !== 'loose' && !it.isLoose ? it.variantId : 'loose')}`;
        const label = it.variantName && !it.isLoose && !itName.includes(it.variantName) ? `${itName} (${it.variantName})` : itName;
        if (!productSalesMap[key]) {
          productSalesMap[key] = { name: label, qty: 0, unit: itUnit, revenue: 0, ordersCount: 0 };
        }
        productSalesMap[key].qty += netQty;
        productSalesMap[key].revenue += itRev;
        productSalesMap[key].ordersCount += 1;

        // Counter milk litres follow the product's base unit; packs contribute qty x contains.
        const baseUnit = it.baseUnit || catalogItem?.unit || (!it.variantId || it.isLoose ? itUnit : '');
        const litreFactor = litresPerBaseUnit(baseUnit);
        const milkText = `${itName} ${(catalogItem?.category || []).join(' ')}`.toLowerCase();
        const isMilk = /\b(milk|doodh)\b/.test(milkText) && !/\b(powder|shake|flavou?red|condensed)\b/.test(milkText);
        if (litreFactor > 0 && isMilk) {
          counterMilkLitres += stockLine.baseQty * litreFactor;
          counterMilkRevenue += itRev;
        }
      });
    });

    const supplyMilkLitres = validSupply.reduce((sum, d) => sum + Number(d.quantity || 0), 0);
    const supplyMilkRevenue = validSupply.reduce((sum, d) => sum + Number(d.total_amount || 0), 0);

    let productionMilkLitres = 0;
    const productionBatchesSummary: { name: string; batchNumber: string; inputQty: number; outputQty: number; status: string }[] = [];
    validBatches.forEach(b => {
      const input = Number(b.quantity_input || 0);
      productionMilkLitres += input;
      productionBatchesSummary.push({
        name: b.product_name || 'Dairy Product',
        batchNumber: b.batch_number || b.id.slice(0, 6),
        inputQty: input,
        outputQty: Number(b.quantity_output_actual || b.quantity_output_estimated || 0),
        status: b.status
      });
    });

    // Current live stock
    const cowItem = items.find(i => i.id === 'item_cow_milk' || i.name.toLowerCase() === 'cow milk');
    const buffItem = items.find(i => i.id === 'item_buffalo_milk' || i.name.toLowerCase() === 'buffalo milk');
    const liveCowStock = Number(cowItem?.stock || 0);
    const liveBuffStock = Number(buffItem?.stock || 0);
    const liveTotalMilkStock = liveCowStock + liveBuffStock;

    // 4. Inflow Calculations (Paisa Aaya)
    let posCashSales = 0;
    let posOnlineSales = 0;
    let posCreditSales = 0;
    let posCashBillsCount = 0;
    let posOnlineBillsCount = 0;
    let posCreditBillsCount = 0;
    const creditCustomersList: { customerName: string; billNo: string; amount: number }[] = [];

    validSales.forEach(s => {
      const total = Number(s.total || 0);
      const cash = saleCashCollected(s);
      const online = saleOnlineCollected(s);
      const due = Math.max(0, total - cash - online);
      posCashSales += cash;
      posOnlineSales += online;
      posCreditSales += due;
      if (cash > 0) posCashBillsCount += 1;
      if (online > 0) posOnlineBillsCount += 1;
      if (due > 0) {
        posCreditBillsCount += 1;
        creditCustomersList.push({
          customerName: s.customer_name || 'Walk-in Credit Customer',
          billNo: s.bill_number || s.id.slice(0, 6),
          amount: due
        });
      }
    });

    const customerPayments = validCustTxns.filter(t => t.type === 'Payment');
    const customerCollections = customerPayments.reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const customerCollectionsList = customerPayments.map(t => {
      const cust = customers.find(c => c.id === t.customer_id);
      return {
        customerName: cust?.name || t.details?.description || 'Customer',
        amount: Number(t.amount || 0),
        note: t.details?.note || ''
      };
    });

    const purchaseReturnsIn = bankTransactions
      .filter(t => isInRange(t.date) && isPurchaseReturnTx(t))
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const returnedSaleCash = sales
      .filter(s => isInRange(s.date) && s.status === 'Returned')
      .reduce((sum, s) => sum + saleCashCollected(s), 0);
    const totalCashInflow = posCashSales + returnedSaleCash + customerCollections + purchaseReturnsIn;
    const totalAllInflows = totalCashInflow + posOnlineSales;
    const totalRevenue = posCashSales + posOnlineSales + posCreditSales + supplyMilkRevenue;

    // 5. Outflow Calculations (Paisa Gaya)
    let totalExpenses = 0;
    const expensesByCategory: Record<string, { category: string; amount: number; count: number; items: string[] }> = {};
    validExpenses.forEach(e => {
      const amt = Number(e.amount || 0);
      const cat = e.category || 'General';
      totalExpenses += amt;
      if (!expensesByCategory[cat]) {
        expensesByCategory[cat] = { category: cat, amount: 0, count: 0, items: [] };
      }
      expensesByCategory[cat].amount += amt;
      expensesByCategory[cat].count += 1;
      if (e.description) expensesByCategory[cat].items.push(`${e.description} (Rs ${amt})`);
    });

    const supplierPaymentsList = validSuppTxns.filter(t => t.type === 'Payment' || t.type === 'Advance');
    const otherSupplierPayments = supplierPaymentsList
      .filter(t => !isSpotSupplierPayment(t))
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const materialDocPaid = validMaterialPurchases.reduce((sum, m) => sum + materialCashPaid(m), 0);
    const materialBankPaid = bankTransactions
      .filter(t => isInRange(t.date) && t.type === 'Expense' && bankTxCategory(t) === 'Purchase')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const materialCashPaidTotal = Math.max(materialDocPaid, materialBankPaid);
    const salesRefundsPaid = bankTransactions
      .filter(t => isInRange(t.date) && isSalesRefundTx(t))
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const expensesCashOut = validExpenses.reduce((sum, e) => sum + expenseCashPaid(e), 0);
    const totalCashOutflow = spotMilkCashPaid + expensesCashOut + otherSupplierPayments + materialCashPaidTotal + salesRefundsPaid;

    // 6. Cash Drawer Balance (Galle Ka Hisaab)
    const dateShifts = shiftSessions.filter(s => isInRange(s.date) || (s.business_day_id && s.business_day_id.includes(dateRange.start)));
    let shiftOpeningFloat = 0;
    let shiftCountedCash = 0;
    let hasClosedShift = false;

    if (dateShifts.length > 0) {
      shiftOpeningFloat = dateShifts.reduce((sum, s) => sum + Number(s.opening_counted || s.opening_float || 0), 0);
      const closed = dateShifts.filter(s => s.status === 'Closed' || s.status === 'Force Closed' || (s.closing_counted_cash !== null && s.closing_counted_cash !== undefined));
      if (closed.length > 0) {
        hasClosedShift = true;
        shiftCountedCash = closed.reduce((sum, s) => sum + Number(s.closing_counted_cash || 0), 0);
      } else {
        const active = dateShifts.find(s => s.status === 'Active' || s.status === 'Pending Review');
        if (active) {
          shiftCountedCash = Number(active.closing_counted_cash || active.opening_counted || 0);
        }
      }
    } else {
      shiftOpeningFloat = 0;
    }

    const expectedClosingCash = shiftOpeningFloat + totalCashInflow - totalCashOutflow;
    const cashVariance = hasClosedShift ? (shiftCountedCash - expectedClosingCash) : 0;

    const counterAccount = accounts.find(a => a.name.toLowerCase().includes('counter'));
    const cashInHandAccount = accounts.find(a => a.name.toLowerCase().includes('hand'));
    const onlineAccounts = accounts.filter(a => a.type === 'Bank');

    // 7. Estimated Net Profit & Product Margins
    const estimatedCOGS = (totalMilkInCost > 0 && totalMilkInLitres > 0)
      ? Math.round((counterMilkLitres + supplyMilkLitres + productionMilkLitres) * (totalMilkInCost / totalMilkInLitres))
      : Math.round(totalRevenue * 0.65);
    const estimatedGrossProfit = totalRevenue - estimatedCOGS;
    const estimatedNetProfit = estimatedGrossProfit - totalExpenses;
    const productSalesList = Object.values(productSalesMap).sort((a, b) => b.revenue - a.revenue);

    // 8. Raw Chronological Journal Events
    const rawEvents: {
      date: string;
      desc: string;
      category: string;
      group: 'Income' | 'Expense' | 'Milk' | 'Credit';
      ref: string;
      type: 'Income' | 'Expense';
      inflow: number;
      outflow: number;
      party?: string;
    }[] = [];

    // Sales (POS)
    validSales.forEach(s => {
      const collected = saleCashCollected(s) + saleOnlineCollected(s);
      const due = Math.max(0, Number(s.total || 0) - collected);
      rawEvents.push({
        date: s.date,
        desc: `POS Sale #${s.bill_number || s.id.slice(0, 6)} (${s.payment_mode || 'Cash'})`,
        category: due > 0 && collected === 0 ? 'Credit Sale' : 'POS Sales',
        group: due > 0 && collected === 0 ? 'Credit' : 'Income',
        ref: s.bill_number || s.id,
        type: 'Income',
        inflow: collected,
        outflow: 0,
        party: s.customer_name || 'Walk-in Customer'
      });
    });

    // Daily Supply
    validSupply.forEach(s => {
      const rec = Number(s.details?.payment_received) || 0;
      const total = Number(s.total_amount) || 0;
      const isCredit = rec < total;
      rawEvents.push({
        date: s.date,
        desc: `Milk Supply: ${s.customer_name || 'Customer'} (${s.quantity || 0} L)${isCredit ? ` [Cash: Rs ${rec}, Due: Rs ${total - rec}]` : ''}`,
        category: isCredit ? 'Credit Milk Supply' : 'Daily Supply',
        group: rec > 0 ? 'Income' : 'Credit',
        ref: s.id,
        type: 'Income',
        inflow: rec,
        outflow: 0,
        party: s.customer_name
      });
    });

    // Milk Purchases
    validPurchases.forEach(p => {
      const sup = suppliers.find(s => s.id === p.supplier_id);
      const paid = purchaseCashPaid(p);
      rawEvents.push({
        date: p.date,
        desc: `Milk Purchase: ${sup?.name || 'Supplier'} (${p.quantity || 0} L @ Rs ${p.rate || 0}) [Paid: Rs ${paid}]`,
        category: 'Milk Procurement',
        group: 'Milk',
        ref: p.id,
        type: 'Expense',
        inflow: 0,
        outflow: paid,
        party: sup?.name || p.details?.supplier_name
      });
    });
    purchases.filter(p => isInRange(p.date) && p.status === 'Returned').forEach(p => {
      const paid = purchaseCashPaid(p);
      if (paid <= 0) return;
      const sup = suppliers.find(s => s.id === p.supplier_id);
      rawEvents.push({
        date: p.date,
        desc: `Milk Purchase (later returned): ${sup?.name || 'Supplier'}`,
        category: 'Milk Procurement',
        group: 'Milk',
        ref: p.id,
        type: 'Expense',
        inflow: 0,
        outflow: paid,
        party: sup?.name
      });
    });

    // Material Purchases
    validMaterialPurchases.forEach(p => {
      const paid = materialCashPaid(p);
      if (paid <= 0) return;
      rawEvents.push({
        date: p.date,
        desc: `Material: ${p.item_name || 'Item'} (${p.quantity || 0} ${p.unit || ''})`,
        category: 'Material Procurement',
        group: 'Expense',
        ref: p.id,
        type: 'Expense',
        inflow: 0,
        outflow: paid
      });
    });

    // Operating Expenses
    validExpenses.forEach(e => {
      const paid = expenseCashPaid(e);
      if (paid <= 0) return;
      rawEvents.push({
        date: e.date,
        desc: `Expense: ${e.description || e.category || 'General'}`,
        category: e.category || 'Operational Overhead',
        group: 'Expense',
        ref: e.id,
        type: 'Expense',
        inflow: 0,
        outflow: paid,
        party: e.details?.vendor_name || undefined
      });
    });

    // Customer Receipts
    customerPayments.forEach(t => {
      const c = customers.find(x => x.id === t.customer_id);
      rawEvents.push({
        date: t.date,
        desc: `Customer Receipt: Cash Received from ${c?.name || 'Customer'}`,
        category: 'Customer Receipt',
        group: 'Credit',
        ref: t.id,
        type: 'Income',
        inflow: t.amount || 0,
        outflow: 0,
        party: c?.name
      });
    });

    // Supplier Payments
    supplierPaymentsList.forEach(t => {
      const s = suppliers.find(x => x.id === t.supplier_id);
      if (isSpotSupplierPayment(t)) return;
      rawEvents.push({
        date: t.date,
        desc: `Supplier Payment: Released to ${s?.name || 'Supplier'}`,
        category: 'Supplier Payment',
        group: 'Expense',
        ref: t.id,
        type: 'Expense',
        inflow: 0,
        outflow: t.amount || 0,
        party: s?.name
      });
    });

    bankTransactions.filter(t => isInRange(t.date) && isPurchaseReturnTx(t)).forEach(t => {
      rawEvents.push({
        date: t.date,
        desc: t.description || t.details?.description || 'Purchase return cash received',
        category: 'Purchase Return',
        group: 'Income',
        ref: t.id,
        type: 'Income',
        inflow: Number(t.amount || 0),
        outflow: 0
      });
    });
    bankTransactions.filter(t => isInRange(t.date) && isSalesRefundTx(t)).forEach(t => {
      rawEvents.push({
        date: t.date,
        desc: t.description || t.details?.description || 'Sales refund',
        category: 'Sales Refund',
        group: 'Expense',
        ref: t.id,
        type: 'Expense',
        inflow: 0,
        outflow: Number(t.amount || 0)
      });
    });

    // Sort chronologically ascending to calculate running balance accurately
    const sorted = rawEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let currentBalance = 0;
    const withRunningBalance = sorted.map(event => {
      currentBalance += (event.inflow - event.outflow);
      return { ...event, runningBalance: currentBalance };
    });

    // Return descending for display (latest first)
    let filtered = withRunningBalance.reverse();
    if (transactionTypeFilter !== 'all') {
      filtered = filtered.filter(e => e.type === transactionTypeFilter);
    }
    if (dayBookFilterCategory !== 'all') {
      filtered = filtered.filter(e => e.group === dayBookFilterCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(e => 
        e.desc.toLowerCase().includes(q) || 
        e.category.toLowerCase().includes(q) || 
        (e.party && e.party.toLowerCase().includes(q)) ||
        e.ref.toLowerCase().includes(q)
      );
    }

    const totalInflow = filtered.reduce((s, e) => s + e.inflow, 0);
    const totalOutflow = filtered.reduce((s, e) => s + e.outflow, 0);
    const netFlow = totalInflow - totalOutflow;

    return { 
      entries: filtered, 
      totalInflow, 
      totalOutflow, 
      netFlow,
      milk: {
        cowLitresIn,
        cowCostIn,
        buffaloLitresIn,
        buffaloCostIn,
        totalMilkInLitres,
        totalMilkInCost,
        spotMilkCashPaid,
        milkAccruedCredit,
        milkSuppliersList,
        counterMilkLitres,
        counterMilkRevenue,
        supplyMilkLitres,
        supplyMilkRevenue,
        productionMilkLitres,
        productionBatchesSummary,
        liveCowStock,
        liveBuffStock,
        liveTotalMilkStock
      },
      inflows: {
        posCashSales,
        posOnlineSales,
        posCreditSales,
        posCashBillsCount,
        posOnlineBillsCount,
        posCreditBillsCount,
        customerCollections,
        customerCollectionsList,
        totalCashInflow,
        totalAllInflows,
        totalSalesCount: validSales.length,
        creditCustomersList
      },
      outflows: {
        spotMilkPaid: spotMilkCashPaid,
        totalExpenses,
        expensesByCategory: Object.values(expensesByCategory),
        otherSupplierPayments,
        materialCashPaid: materialCashPaidTotal,
        totalCashOutflow
      },
      credit: {
        posCreditSales,
        posCreditBillsCount,
        creditCustomersList,
        customerCollections,
        customerCollectionsList,
        milkAccruedCredit,
        otherSupplierPayments
      },
      drawer: {
        shiftOpeningFloat,
        shiftCountedCash,
        expectedClosingCash,
        cashVariance,
        hasClosedShift,
        dateShifts,
        counterBalance: Number(counterAccount?.balance || 0),
        cashInHandBalance: Number(cashInHandAccount?.balance || 0),
        bankBalance: onlineAccounts.reduce((s, a) => s + Number(a.balance || 0), 0)
      },
      profit: {
        totalRevenue,
        estimatedCOGS,
        estimatedGrossProfit,
        totalExpenses,
        estimatedNetProfit,
        productSalesList
      }
    };
  }, [
    sales, dailySupplyEntries, purchases, materialPurchases, expenses, 
    customerTransactions, supplierTransactions, suppliers, customers, 
    items, accounts, bankTransactions, productionBatches, shiftSessions, dateRange, 
    transactionTypeFilter, dayBookFilterCategory, searchQuery
  ]);

  // --- REPORT 5: Customer Sales Analysis ---
  const customerSalesData = useMemo(() => {
    const list = customers.map(cust => {
      const pos = sales.filter(s => s.customer_id === cust.id && isInRange(s.date) && s.status !== 'Returned');
      const posRevenue = pos.reduce((s, b) => s + (b.total || 0), 0);
      const posOrders = pos.length;

      const supplies = dailySupplyEntries.filter(s => s.customer_id === cust.id && isInRange(s.date));
      const supplyRevenue = supplies.reduce((s, e) => s + (e.total_amount || 0), 0);
      const supplyLiters = supplies.reduce((s, e) => s + (e.quantity || 0), 0);

      const totalRevenue = posRevenue + supplyRevenue;
      const payments = customerTransactions
        .filter(t => t.customer_id === cust.id && isInRange(t.date) && t.type === 'Payment')
        .reduce((s, t) => s + (t.amount || 0), 0);

      return {
        id: cust.id,
        name: cust.name,
        phone: cust.phone || '-',
        type: cust.type || 'Retail',
        route: cust.route || '-',
        posRevenue,
        posOrders,
        supplyRevenue,
        supplyLiters,
        totalRevenue,
        payments,
        balance: cust.balance || 0
      };
    }).filter(c => c.totalRevenue > 0 || c.balance !== 0 || c.payments > 0);

    let filtered = list;
    if (selectedCustomerId !== 'all') {
      filtered = filtered.filter(c => c.id === selectedCustomerId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(c => 
        c.name.toLowerCase().includes(q) || 
        c.phone.includes(q) || 
        c.type.toLowerCase().includes(q) ||
        (c.route && c.route.toLowerCase().includes(q))
      );
    }

    if (customerInPageFilter === 'dues_only') {
      filtered = filtered.filter(c => c.balance > 0.01);
    } else if (customerInPageFilter === 'advance_only') {
      filtered = filtered.filter(c => c.balance < -0.01);
    }

    // Sort by highest pending balance first, then by total revenue
    filtered.sort((a, b) => b.balance - a.balance || b.totalRevenue - a.totalRevenue);

    const totalRevenue = filtered.reduce((s, c) => s + c.totalRevenue, 0);
    const totalSupplyLiters = filtered.reduce((s, c) => s + c.supplyLiters, 0);
    const totalReceivables = filtered.reduce((s, c) => s + (c.balance > 0 ? c.balance : 0), 0);
    const totalAdvances = filtered.reduce((s, c) => s + (c.balance < 0 ? Math.abs(c.balance) : 0), 0);
    const totalCollections = filtered.reduce((s, c) => s + c.payments, 0);
    const debtorCount = filtered.filter(c => c.balance > 0.01).length;
    const advanceCount = filtered.filter(c => c.balance < -0.01).length;

    const topCustomersChart = [...filtered]
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 5)
      .map(c => ({
        name: c.name.length > 12 ? c.name.slice(0, 10) + '..' : c.name,
        revenue: c.totalRevenue
      }));

    return { 
      list: filtered, 
      totalRevenue, 
      totalSupplyLiters, 
      totalReceivables, 
      totalAdvances,
      totalCollections, 
      debtorCount,
      advanceCount,
      topCustomersChart 
    };
  }, [customers, sales, dailySupplyEntries, customerTransactions, dateRange, selectedCustomerId, searchQuery, customerInPageFilter]);

  // --- REPORT 6: Item Sales Performance ---
  const itemSalesData = useMemo(() => {
    const itemMap: Record<string, {
      id: string;
      name: string;
      category: string;
      unit: string;
      quantity: number;
      revenue: number;
      orderCount: number;
      costPrice: number;
      /** Cost of the quantity sold, added line by line. */
      cost: number;
    }> = {};

    // Initialize from catalog
    items.forEach(i => {
      const cat = Array.isArray(i.category) ? i.category[0] : (i.category || 'General');
      itemMap[i.id] = {
        id: i.id,
        name: i.name,
        category: cat,
        unit: i.unit || 'Unit',
        quantity: 0,
        revenue: 0,
        orderCount: 0,
        costPrice: Number(i.cost_price) || 0,
        cost: 0
      };
    });

    // Populate from POS sales. Quantities are summed in each product's base unit.
    sales.filter(s => isInRange(s.date) && s.status !== 'Returned' && s.status !== 'Cancelled').forEach(bill => {
      const subtotal = Number(bill.subtotal || bill.total || 0);
      const discount = Number(bill.discount || 0);
      const discountRatio = subtotal > 0 ? (discount / subtotal) : 0;

      (bill.items || []).forEach(item => {
        const catalogItem = items.find(ci => ci.id === item.itemId) || items.find(ci => ci.name.toLowerCase() === item.name.toLowerCase());
        const key = catalogItem?.id || item.itemId || item.name;
        const baseCost = Number(catalogItem?.cost_price) || 0;

        if (!itemMap[key]) {
          itemMap[key] = {
            id: key,
            name: item.name,
            category: catalogItem ? (Array.isArray(catalogItem.category) ? catalogItem.category[0] : (catalogItem.category || 'Store Product')) : 'Store Product',
            unit: catalogItem?.unit || (item as any).baseUnit || (!item.variantId ? item.unit : '') || 'Unit',
            quantity: 0,
            revenue: 0,
            orderCount: 0,
            costPrice: baseCost,
            cost: 0
          };
        }

        // Returns count only against the same item and the same sell unit.
        const retQty = returnedQtyForLine(bill, item);
        const originalQty = Number(item.qty) || 0;
        const netQty = Math.max(0, originalQty - retQty);
        const lineGross = Number(item.total) || (originalQty * (Number(item.price) || 0));
        const netLineRevenue = originalQty > 0 ? ((netQty / originalQty) * lineGross * (1 - discountRatio)) : 0;
        const stockLine = saleLineStock({ ...item, qty: netQty }, catalogItem);
        // Saved cost_price is per sold unit (pack cost on pack lines); old bills fall back to catalog base cost.
        const lineUnitCost = Number((item as any).cost_price) || 0;
        const lineCost = lineUnitCost > 0 ? lineUnitCost * netQty : baseCost * stockLine.baseQty;

        itemMap[key].quantity += stockLine.baseQty;
        itemMap[key].revenue += netLineRevenue;
        itemMap[key].cost += lineCost;
        if (netQty > 0) itemMap[key].orderCount += 1;
      });
    });

    // Populate from Daily Supply (Fresh Milk)
    const validSupplyEntries = dailySupplyEntries.filter(s => isInRange(s.date) && s.details?.status !== 'Cancelled' && s.details?.status !== 'Pending');
    const totalMilkSupplyRev = validSupplyEntries.reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0);
    const totalMilkSupplyQty = validSupplyEntries.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
    if (totalMilkSupplyQty > 0) {
      const supplyKey = 'daily_supply_milk';
      const milkItem = items.find(i => i.name.toLowerCase().includes('milk'));
      const milkCost = Number(milkItem?.cost_price) || (totalMilkSupplyRev / totalMilkSupplyQty);
      itemMap[supplyKey] = {
        id: supplyKey,
        name: 'Fresh Milk (Daily Supply Delivery)',
        category: 'Milk & Dairy',
        unit: 'Liters',
        quantity: totalMilkSupplyQty,
        revenue: totalMilkSupplyRev,
        orderCount: validSupplyEntries.length,
        costPrice: milkCost,
        cost: milkCost * totalMilkSupplyQty
      };
    }

    const aggregated = Object.values(itemMap).filter(i => i.quantity > 0 || i.revenue > 0);
    const totalGrossRevenue = aggregated.reduce((s, i) => s + i.revenue, 0);

    let list = aggregated.map(i => {
      // Rate and cost are per base unit, matching the base-unit quantity.
      const avgRate = i.quantity > 0 ? (i.revenue / i.quantity) : 0;
      const estCost = i.cost;
      const estProfit = i.revenue - estCost;
      const margin = i.revenue > 0 ? (estProfit / i.revenue) * 100 : 0;
      const share = totalGrossRevenue > 0 ? (i.revenue / totalGrossRevenue) * 100 : 0;
      return { ...i, avgRate, estProfit, margin, share };
    });

    if (selectedItemId !== 'all') {
      list = list.filter(i => i.id === selectedItemId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
    }

    list.sort((a, b) => b.revenue - a.revenue);

    // Chart: Category Share
    const catMap: Record<string, number> = {};
    list.forEach(i => {
      catMap[i.category] = (catMap[i.category] || 0) + i.revenue;
    });
    const categoryPie = Object.entries(catMap).map(([name, value]) => ({ name, value }));

    // Chart: Top 5 Items
    const topItemsChart = list.slice(0, 5).map(i => ({
      name: i.name.length > 12 ? i.name.slice(0, 10) + '..' : i.name,
      revenue: i.revenue,
      quantity: Math.round(i.quantity)
    }));

    // Different base units (kg, L, pcs) are never added together; totals are kept per unit.
    const unitsSoldMap: Record<string, number> = {};
    list.forEach(i => { unitsSoldMap[i.unit] = (unitsSoldMap[i.unit] || 0) + i.quantity; });
    const unitsSold = Object.entries(unitsSoldMap).map(([unit, quantity]) => ({ unit, quantity }));
    const totalUnitsSold = unitsSold.length === 1 ? unitsSold[0].quantity : 0;

    return { list, totalRevenue: totalGrossRevenue, totalUnitsSold, unitsSold, categoryPie, topItemsChart };
  }, [sales, dailySupplyEntries, items, dateRange, selectedItemId, searchQuery]);

  // --- REPORT 7: Stock Valuation Summary ---
  const stockValuationData = useMemo(() => {
    const list = items.map(item => {
      const inv = inventory.find(i => i.item_id === item.id || i.name === item.name);
      const looseStock = inv ? (Number(inv.quantity) || 0) : (Number(item.stock) || 0);
      const variantStocks = inv?.variant_stocks || item.variant_stocks || {};
      // Only active pre-packed sizes hold their own count; multi-unit sizes draw from loose stock.
      const valuation = itemStockValue(item, looseStock, variantStocks);
      const totalVariantsUnits = valuation.packs.reduce((sum, p) => sum + p.count, 0);
      const packBreakdown = valuation.packs.filter(p => p.count !== 0).map(p => `${roundQuantity(p.count)} × ${p.name}`).join(', ');
      const totalBaseQty = roundQuantity(valuation.totalBaseQty);

      const costPrice = Number(item.cost_price) || 0;
      const sellingPrice = Number(item.selling_price) || 0;
      const costMissing = valuation.costMissing;
      const valuationCost = roundCurrency(valuation.costValue);
      const retailWorth = roundCurrency(valuation.retailValue);
      const potentialProfit = roundCurrency(retailWorth - valuationCost);

      const cat = Array.isArray(item.category) ? item.category.join(', ') : (item.category || 'General');

      return {
        id: item.id,
        name: item.name,
        category: cat,
        unit: item.unit || 'Unit',
        looseStock,
        totalVariantsUnits,
        packBreakdown,
        totalBaseQty,
        costMissing,
        costPrice,
        sellingPrice,
        valuationCost,
        retailWorth,
        potentialProfit
      };
    });

    let filtered = list;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(i => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
    }

    filtered.sort((a, b) => b.valuationCost - a.valuationCost);

    const totalValuationCost = filtered.reduce((s, i) => s + i.valuationCost, 0);
    const totalRetailWorth = filtered.reduce((s, i) => s + i.retailWorth, 0);
    const totalPotentialProfit = totalRetailWorth - totalValuationCost;
    const totalSkus = filtered.length;

    return { list: filtered, totalValuationCost, totalRetailWorth, totalPotentialProfit, totalSkus };
  }, [items, inventory, searchQuery]);

  // --- REPORT 8: Item Stock Movement Ledger ---
  const itemLedgerData = useMemo(() => {
    if (selectedItemId === 'all') return { list: [], openingStock: 0, totalIn: 0, totalOut: 0, closingStock: 0 };

    const selectedItem = items.find(i => i.id === selectedItemId);
    const itemName = selectedItem?.name || '';

    const events: {
      date: string;
      desc: string;
      type: 'IN' | 'OUT';
      ref: string;
      qtyIn: number;
      qtyOut: number;
    }[] = [];

    // This is the loose (main) stock ledger in the item's base unit.
    // Pre-packed sizes keep their own count; their movements are listed as pack rows that do not touch loose stock.
    const sinceStart = (d?: string) => !!d && normalizeDate(d) >= dateRange.start;
    const afterEnd = (d?: string) => !!d && normalizeDate(d) > dateRange.end;
    const pushLoose = (date: string, desc: string, ref: string, delta: number) => {
      if (!delta) return;
      events.push({ date, desc, type: delta >= 0 ? 'IN' : 'OUT', ref, qtyIn: delta > 0 ? delta : 0, qtyOut: delta < 0 ? -delta : 0 });
    };
    const pushPack = (date: string, desc: string, ref: string, packDelta: number, packName: string) => {
      if (!packDelta) return;
      events.push({ date, desc: `${desc} [Pack stock ${packDelta > 0 ? '+' : ''}${roundQuantity(packDelta)} × ${packName}, not loose]`, type: packDelta >= 0 ? 'IN' : 'OUT', ref, qtyIn: 0, qtyOut: 0 });
    };
    const variantName = (id?: string) => (selectedItem?.variants || []).find(v => v.id === id)?.name || 'pack';

    // Purchases (Material); quantity is already net of supplier returns, so 'Supply Return' logs are skipped below.
    materialPurchases.filter(p => (p.item_id === selectedItemId || p.item_name === itemName) && sinceStart(p.date) && p.status !== 'Returned' && p.status !== 'Cancelled').forEach(p => {
      const conv = Number((p as any).details?.conversion_factor || p.conversion_factor) || 1;
      const baseQty = roundQuantity((Number(p.quantity) || 0) * conv);
      const packId = (p as any).details?.variant_id || (p as any).variant_id;
      const desc = `Material Purchase (Supplier: ${p.supplier_id || 'Direct'})${conv > 1 ? ` (${p.quantity} ${p.unit} = ${baseQty} base units)` : ''}`;
      if (packId || (p as any).details?.stocked_as === 'packs') pushPack(p.date, desc, p.id, Number(p.quantity) || 0, variantName(packId));
      else pushLoose(p.date, desc, p.id, baseQty);
    });

    // Raw milk purchases are NOT counter stock until allocated; allocations arrive below through their stock logs.

    // POS Sales: the full sale leaves stock on the bill date; restocked returns come back through 'Sales Return' logs.
    sales.filter(s => sinceStart(s.date) && s.status !== 'Cancelled' && s.status !== 'Draft').forEach(s => {
      const matchingLines = (s.items || []).filter(i => i.itemId === selectedItemId || (!i.itemId && i.name === itemName));
      matchingLines.forEach(line => {
        const stockLine = saleLineStock(line, selectedItem);
        const desc = `POS Sale #${s.bill_number || s.id.slice(0, 6)}${line.variantId ? ` (${line.name})` : ''}`;
        if (stockLine.fromBase) pushLoose(s.date, desc, s.bill_number || s.id, -stockLine.baseQty);
        else pushPack(s.date, desc, s.bill_number || s.id, -stockLine.stockQty, line.variantName || variantName(stockLine.variantId));
      });
    });

    // Production: only completed batches, on their completion date, and only the loose part of the output.
    productionBatches.filter(b => {
      const done = String(b.status || '').toLowerCase() === 'completed';
      const sameItem = (b as any).item_id ? (b as any).item_id === selectedItemId : b.product_name === itemName;
      return done && sameItem && sinceStart(b.completed_date || b.start_date);
    }).forEach(b => {
      const output = (b as any).output_breakdown || b.details?.output_breakdown;
      const prodLog = inventoryLogs.find(l => l.id === `log_prod_${b.id}`);
      const looseOut = output && output.loose_qty !== undefined && output.loose_qty !== null
        ? Number(output.loose_qty) || 0
        : prodLog ? Number(prodLog.difference) || 0 : Number(b.quantity_output_actual) || 0;
      const date = b.completed_date || b.start_date;
      pushLoose(date, `Production Finished Yield (Batch #${b.batch_number})`, b.batch_number, looseOut);
      ((output?.variants || []) as any[]).forEach(v => pushPack(date, `Production Packed (Batch #${b.batch_number})`, b.batch_number, Number(v.count) || 0, v.variant_name || variantName(v.variantId || v.variant_id)));
    });

    // Inventory logs: adjustments, allocations, returns and usage. Documents above own purchase, production and sale movement.
    const documentReasons = ['purchase', 'production', 'sale', 'pos sale', 'supply return'];
    inventoryLogs.filter(l => l.item_id === selectedItemId && sinceStart(l.date) && !documentReasons.includes(String(l.reason || '').trim().toLowerCase())).forEach(l => {
      const desc = `Manual Adjustment / Log: ${l.reason || 'Audit'}`;
      const details = (l as any).details || {};
      if (details.variant_id) {
        pushPack(l.date, desc, 'Audit Log', Number(details.variant_delta) || 0, variantName(details.variant_id));
        pushLoose(l.date, desc, 'Audit Log', Number(details.loose_delta) || 0);
        return;
      }
      // Older pack audits stored a pack-count difference without naming the pack; keep it out of loose stock.
      if (details.loose_delta === undefined && /variant/i.test(String(l.notes || ''))) {
        if (Number(l.difference)) events.push({ date: l.date, desc: `${desc} [Pack stock ${Number(l.difference) > 0 ? '+' : ''}${roundQuantity(Number(l.difference))}, not loose]`, type: Number(l.difference) >= 0 ? 'IN' : 'OUT', ref: 'Audit Log', qtyIn: 0, qtyOut: 0 });
        return;
      }
      pushLoose(l.date, desc, 'Audit Log', Number(l.difference) || 0);
    });

    // Chronological sort
    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Current stock is today's balance. Opening = current minus every movement since the range start,
    // including movements after the range end. Negatives are shown, not hidden.
    const inv = inventory.find(i => i.item_id === selectedItemId || i.name === itemName);
    const currentStock = Number(inv ? inv.quantity : selectedItem?.stock) || 0;

    const netSinceStart = events.reduce((s, e) => s + e.qtyIn - e.qtyOut, 0);
    const openingStock = roundQuantity(currentStock - netSinceStart);
    const inRangeEvents = events.filter(e => !afterEnd(e.date));

    const totalIn = inRangeEvents.reduce((s, e) => s + e.qtyIn, 0);
    const totalOut = inRangeEvents.reduce((s, e) => s + e.qtyOut, 0);

    let running = openingStock;
    const withRunning = inRangeEvents.map(e => {
      running = roundQuantity(running + e.qtyIn - e.qtyOut);
      return { ...e, runningQty: running };
    });

    return {
      list: withRunning.reverse(),
      openingStock,
      totalIn,
      totalOut,
      closingStock: running,
      unit: selectedItem?.unit || 'Unit',
      itemName
    };
  }, [selectedItemId, items, materialPurchases, purchases, sales, productionBatches, inventoryLogs, inventory, suppliers, dateRange]);

  // --- REPORT 9: Low Stock & Reorder Alerts ---
  const lowStockData = useMemo(() => {
    const list = items.map(item => {
      const inv = inventory.find(i => i.item_id === item.id || i.name === item.name);
      const currentStock = inv ? (inv.quantity || 0) : (item.stock || 0);
      const threshold = item.lowStockThreshold || settings?.inventory?.lowStockThreshold || 10;
      const shortage = Math.max(0, threshold - currentStock);
      const suggestedReorder = shortage > 0 ? (shortage + threshold) : 0;

      let status: 'OUT_OF_STOCK' | 'CRITICAL' | 'LOW' | 'HEALTHY' = 'HEALTHY';
      if (currentStock <= 0) status = 'OUT_OF_STOCK';
      else if (currentStock <= threshold * 0.4) status = 'CRITICAL';
      else if (currentStock <= threshold) status = 'LOW';

      const cat = Array.isArray(item.category) ? item.category.join(', ') : (item.category || 'General');

      return {
        id: item.id,
        name: item.name,
        category: cat,
        unit: item.unit || 'Unit',
        currentStock,
        threshold,
        shortage,
        suggestedReorder,
        status,
        sellingPrice: item.selling_price || 0
      };
    });

    const alertOnly = list.filter(i => i.status !== 'HEALTHY');
    const outOfStockCount = list.filter(i => i.status === 'OUT_OF_STOCK').length;
    const criticalCount = list.filter(i => i.status === 'CRITICAL').length;
    const lowCount = list.filter(i => i.status === 'LOW').length;

    let filtered = alertOnly;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(i => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
    }

    filtered.sort((a, b) => a.currentStock - b.currentStock);

    return { list: filtered, allAlertsCount: alertOnly.length, outOfStockCount, criticalCount, lowCount };
  }, [items, inventory, settings, searchQuery]);

  // --- REPORT 10: Purchase Register (Milk & Materials) ---
  const purchaseRegisterData = useMemo(() => {
    const milkEntries = purchases.filter(p => isInRange(p.date) && p.status !== 'Returned' && p.status !== 'Cancelled').map(p => {
      const sup = suppliers.find(s => s.id === p.supplier_id);
      return {
        id: p.id,
        date: p.date,
        type: 'Milk',
        supplierName: sup?.name || p.supplier_name || 'Farmer',
        shift: p.shift || 'Morning',
        quantity: p.quantity || 0,
        unit: 'Liters',
        fat: p.fat || 0,
        snf: p.snf || 0,
        rate: p.rate || 0,
        totalAmount: p.total_amount || 0,
        paid: p.paid_amount || 0,
        due: (p.total_amount || 0) - (p.paid_amount || 0)
      };
    });

    const matEntries = materialPurchases.filter(p => isInRange(p.date) && p.status !== 'Returned').map(p => {
      const sup = suppliers.find(s => s.id === p.supplier_id);
      return {
        id: p.id,
        date: p.date,
        type: 'Material',
        supplierName: sup?.name || 'Material Vendor',
        shift: '-',
        quantity: p.quantity || 0,
        unit: p.unit || 'Unit',
        fat: 0,
        snf: 0,
        rate: p.rate || 0,
        totalAmount: p.total_amount || 0,
        paid: p.total_amount || 0,
        due: 0
      };
    });

    let combined = [...milkEntries, ...matEntries];
    if (selectedSupplierId !== 'all') {
      combined = combined.filter(p => {
        const found = suppliers.find(s => s.id === selectedSupplierId);
        return p.supplierName === found?.name;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      combined = combined.filter(p => p.supplierName.toLowerCase().includes(q) || p.type.toLowerCase().includes(q));
    }

    combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const totalMilkLiters = milkEntries.reduce((s, p) => s + p.quantity, 0);
    const morningLiters = milkEntries.filter(p => p.shift === 'Morning').reduce((s, p) => s + p.quantity, 0);
    const eveningLiters = milkEntries.filter(p => p.shift === 'Evening').reduce((s, p) => s + p.quantity, 0);
    const totalMilkSpend = milkEntries.reduce((s, p) => s + p.totalAmount, 0);
    const totalMaterialSpend = matEntries.reduce((s, p) => s + p.totalAmount, 0);
    const avgRatePerLiter = totalMilkLiters > 0 ? (totalMilkSpend / totalMilkLiters) : 0;

    const weightedFatSum = milkEntries.reduce((s, p) => s + (p.fat * p.quantity), 0);
    const avgFat = totalMilkLiters > 0 ? (weightedFatSum / totalMilkLiters) : 0;

    // Daily Procurement Chart
    const dailyMap: Record<string, { date: string; morning: number; evening: number; rate: number }> = {};
    milkEntries.forEach(p => {
      const d = normalizeDate(p.date);
      if (!dailyMap[d]) dailyMap[d] = { date: d, morning: 0, evening: 0, rate: p.rate };
      if (p.shift === 'Morning') dailyMap[d].morning += p.quantity;
      else dailyMap[d].evening += p.quantity;
    });

    const procurementChart = Object.values(dailyMap)
      .map(item => ({ ...item, label: formatDate(item.date) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      entries: combined,
      totalMilkLiters,
      morningLiters,
      eveningLiters,
      totalMilkSpend,
      totalMaterialSpend,
      avgRatePerLiter,
      avgFat,
      procurementChart
    };
  }, [purchases, materialPurchases, suppliers, dateRange, selectedSupplierId, searchQuery]);

  // --- REPORT 11: Supplier Ledger & Dues Summary ---
  const supplierSummaryData = useMemo(() => {
    const list = suppliers.map(sup => {
      const supPurchases = purchases.filter(p => p.supplier_id === sup.id && isInRange(p.date) && p.status !== 'Returned' && p.status !== 'Cancelled');
      const milkLiters = supPurchases.reduce((s, p) => s + (p.quantity || 0), 0);
      const totalBilled = supPurchases.reduce((s, p) => s + (p.total_amount || 0), 0);

      const payments = supplierTransactions
        .filter(t => t.supplier_id === sup.id && isInRange(t.date) && (t.type === 'Payment' || t.type === 'Advance'))
        .reduce((s, t) => s + (t.amount || 0), 0);

      return {
        id: sup.id,
        name: sup.name,
        village: sup.village || '-',
        phone: sup.phone || '-',
        milkLiters,
        totalBilled,
        payments,
        pendingBalance: sup.pending_balance || 0,
        defaultRate: sup.default_rate || 0
      };
    }).filter(s => s.milkLiters > 0 || s.totalBilled > 0 || s.pendingBalance !== 0 || s.payments > 0);

    let filtered = list;
    if (selectedSupplierId !== 'all') {
      filtered = filtered.filter(s => s.id === selectedSupplierId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(s => s.name.toLowerCase().includes(q) || s.village.toLowerCase().includes(q) || s.phone.includes(q));
    }

    filtered.sort((a, b) => b.totalBilled - a.totalBilled);

    const totalLiters = filtered.reduce((s, x) => s + x.milkLiters, 0);
    const totalBilled = filtered.reduce((s, x) => s + x.totalBilled, 0);
    const totalPaid = filtered.reduce((s, x) => s + x.payments, 0);
    const totalPendingDues = filtered.reduce((s, x) => s + x.pendingBalance, 0);

    return { list: filtered, totalLiters, totalBilled, totalPaid, totalPendingDues };
  }, [suppliers, purchases, supplierTransactions, dateRange, selectedSupplierId, searchQuery]);

  // --- REPORT 12: Production Yield & Wastage ---
  const productionYieldData = useMemo(() => {
    const list = productionBatches.filter(b => isInRange(b.start_date)).map(b => {
      const input = b.quantity_input || 0;
      const actualOut = b.quantity_output_actual || b.quantity_output_estimated || 0;
      const wastage = b.wastage || 0;
      const yieldPct = input > 0 ? (actualOut / input) * 100 : 0;
      const wastagePct = input > 0 ? (wastage / input) * 100 : 0;
      const totalCost = b.financials?.total_cost || 0;
      const salesValue = b.financials?.sales_value || 0;
      const profit = salesValue - totalCost;

      return {
        id: b.id,
        batchNumber: b.batch_number,
        productName: b.product_name,
        status: b.status,
        startDate: b.start_date,
        completedDate: b.completed_date || '-',
        inputMilk: input,
        actualOut,
        wastage,
        yieldPct,
        wastagePct,
        totalCost,
        salesValue,
        profit
      };
    });

    let filtered = list;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(b => b.batchNumber.toLowerCase().includes(q) || b.productName.toLowerCase().includes(q));
    }

    filtered.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

    const totalBatches = filtered.length;
    const totalInputMilk = filtered.reduce((s, b) => s + b.inputMilk, 0);
    const totalOutputUnits = filtered.reduce((s, b) => s + b.actualOut, 0);
    const totalWastage = filtered.reduce((s, b) => s + b.wastage, 0);
    const avgYield = totalBatches > 0 ? (filtered.reduce((s, b) => s + b.yieldPct, 0) / totalBatches) : 0;
    const totalBatchCost = filtered.reduce((s, b) => s + b.totalCost, 0);
    const totalBatchRevenue = filtered.reduce((s, b) => s + b.salesValue, 0);

    const yieldChart = filtered.slice(0, 8).map(b => ({
      batch: b.batchNumber,
      yieldPct: Number(b.yieldPct.toFixed(1)),
      product: b.productName
    }));

    return {
      batches: filtered,
      totalBatches,
      totalInputMilk,
      totalOutputUnits,
      totalWastage,
      avgYield,
      totalBatchCost,
      totalBatchRevenue,
      yieldChart
    };
  }, [productionBatches, dateRange, searchQuery]);

  // --- CSV Export Engine ---
  const handleExportCSV = () => {
    const filename = `Mooco_Dairy_${activeReport}_${dateRange.start}_to_${dateRange.end}`;

    switch (activeReport) {
      case 'stock_profit': {
        if (!stockProfitData || profitLoading || profitError || !stockProfitData.validRange) { showToast('Load a valid profit report before exporting.', 'warning'); return; }
        const p = stockProfitData;
        const headers = ['Section', 'Metric / Product', 'Location / Note', 'Unit', 'Opening Qty', 'Opening Avg Cost', 'Opening Value / Amount (PKR)', 'Closing Qty', 'Closing Avg Cost', 'Closing Value (PKR)'];
        const metrics: [string, number][] = [['Opening stock', p.openingStock], ['Gross purchases', p.grossPurchases], ['Supplier returns', p.purchaseReturns], ['Net purchases', p.netPurchases], ['Additional conversion cost', p.conversionCost], ['Stock corrections', p.stockAdjustments], ['Closing stock', p.closingStock], ['Consumed cost (includes wastage)', p.consumedCost], ['Gross sales', p.grossSales], ['Sales returns', p.salesReturns], ['Net sales', p.netSales], ['Gross profit', p.grossProfit], ['Operating expenses (paid + unpaid)', p.expenses], ['Net profit / loss', p.netProfit]];
        exportToCSV(filename, headers, [
          ['Status', p.issues.length ? 'Provisional — data needs review' : 'Recorded stock and costs reconcile', `${dateRange.start} to ${dateRange.end}`, '', '', '', '', '', '', ''],
          ...metrics.map(([label, amount]) => ['Calculation', label, '', '', '', '', amount, '', '', '']),
          ...p.rows.map(row => ['Stock', row.name, row.location, row.unit, row.openingQty, row.openingRate, row.openingValue, row.closingQty, row.closingRate, row.closingValue]),
          ...p.expenseCategories.map(category => ['Expense', category.name, '', '', '', '', category.amount, '', '', '']),
          ...p.movements.map(movement => [movement.kind, movement.description, movement.date, '', '', '', movement.amount, '', '', '']),
          ...p.issues.map(issue => ['Data check', issue.item || issue.code, issue.message, '', '', '', '', '', '', ''])
        ]);
        break;
      }
      case 'pnl': {
        const headers = ['Financial Metric', 'Amount (PKR)'];
        const rows = [
          ['POS Revenue', pnlData.posRevenue],
          ['Supply Revenue', pnlData.supplyRevenue],
          ['Total Revenue', pnlData.totalRevenue],
          ['Raw Milk Purchases (COGS)', pnlData.milkCost],
          ['Material Purchases (COGS)', pnlData.materialCost],
          ['Total COGS', pnlData.totalCOGS],
          ['Gross Profit', pnlData.grossProfit],
          ['Gross Margin %', `${pnlData.grossMargin.toFixed(2)}%`],
          ['Operating Expenses', pnlData.operatingCost],
          ['Net Profit / Loss', pnlData.netProfit],
          ['Net Margin %', `${pnlData.netMargin.toFixed(2)}%`],
          ...Object.entries(pnlData.expensesByCategory).map(([cat, amt]) => [`Expense - ${cat}`, amt])
        ];
        exportToCSV(filename, headers, rows);
        break;
      }
      case 'balance_sheet': {
        const headers = ['Category', 'Account / Item', 'Amount (PKR)'];
        const rows = [
          ['Assets', 'Cash & Bank Balances', balanceSheetData.assets.cashBank],
          ['Assets', 'Inventory Valuation', balanceSheetData.assets.stockVal],
          ['Assets', 'Accounts Receivable (Debtors)', balanceSheetData.assets.debtors],
          ['Assets', 'Fixed Assets', balanceSheetData.assets.fixedAssets],
          ['Assets', 'TOTAL ASSETS', balanceSheetData.assets.totalAssets],
          ['Liabilities', 'Accounts Payable (Creditors)', balanceSheetData.liabilities.creditors],
          ['Liabilities', 'Customer Advances', balanceSheetData.liabilities.custAdvances],
          ['Liabilities', 'Loans & Liabilities', balanceSheetData.liabilities.loans],
          ['Liabilities', 'TOTAL LIABILITIES', balanceSheetData.liabilities.totalLiabilities],
          ['Equity', 'Owner Equity Accounts', balanceSheetData.equity.equityManual],
          ['Equity', 'Retained Earnings (P&L)', balanceSheetData.equity.retainedEarnings],
          ['Equity', 'TOTAL EQUITY', balanceSheetData.equity.totalEquity],
          ['Total', 'TOTAL LIABILITIES & EQUITY', balanceSheetData.totalLiabAndEquity]
        ];
        exportToCSV(filename, headers, rows);
        break;
      }
      case 'cash_flow': {
        const headers = ['Cash Flow Activity', 'Type', 'Amount (PKR)'];
        const rows = [
          ['Cash Sales (POS)', 'Inflow', cashFlowData.posCashSales],
          ['Customer Collections', 'Inflow', cashFlowData.custPayments],
          ['Purchase Returns Received Back', 'Inflow', cashFlowData.purchaseReturnIn],
          ['Bank Deposits & Inflows', 'Inflow', cashFlowData.bankDeposits],
          ['Total Cash Inflows', 'Summary', cashFlowData.totalInflows],
          ['Milk Purchases Cash Paid', 'Outflow', cashFlowData.milkPaid],
          ['Supplier Cash Payments', 'Outflow', cashFlowData.supplierPayments],
          ['Material Purchases Paid', 'Outflow', cashFlowData.materialPaid],
          ['Operating Expenses Paid', 'Outflow', cashFlowData.expensesPaid],
          ['Sales Refunds Paid Out', 'Outflow', cashFlowData.salesRefunds],
          ['Bank Withdrawals & Outflows', 'Outflow', cashFlowData.bankWithdrawals],
          ['Total Cash Outflows', 'Summary', cashFlowData.totalOutflows],
          ['Net Cash Movement', 'Result', cashFlowData.netCashFlow],
          ['Closing Liquid Reserves', 'Reserve', cashFlowData.totalLiquidAccounts]
        ];
        exportToCSV(filename, headers, rows);
        break;
      }
      case 'day_book': {
        const headers = ['Date', 'Reference', 'Description', 'Category', 'Inflow (PKR)', 'Outflow (PKR)', 'Running Balance (PKR)'];
        const rows = dayBookData.entries.map(e => [
          normalizeDate(e.date),
          e.ref,
          e.desc,
          e.category,
          e.inflow,
          e.outflow,
          e.runningBalance
        ]);
        exportToCSV(filename, headers, rows);
        break;
      }
      case 'sales_by_customer': {
        const headers = ['Customer Name', 'Phone', 'Type', 'Route', 'POS Revenue', 'Supply Liters', 'Supply Revenue', 'Total Revenue', 'Collections Received', 'Current Balance'];
        const rows = customerSalesData.list.map(c => [
          c.name,
          c.phone,
          c.type,
          c.route,
          c.posRevenue,
          c.supplyLiters,
          c.supplyRevenue,
          c.totalRevenue,
          c.payments,
          c.balance
        ]);
        exportToCSV(filename, headers, rows);
        break;
      }
      case 'sales_by_item': {
        const headers = ['Product / Item', 'Category', 'Unit', 'Qty Sold', 'Revenue (PKR)', 'Avg Rate (PKR)', 'Revenue Share %'];
        const rows = itemSalesData.list.map(i => [
          i.name,
          i.category,
          i.unit,
          i.quantity,
          i.revenue,
          i.avgRate.toFixed(2),
          `${i.share.toFixed(1)}%`
        ]);
        exportToCSV(filename, headers, rows);
        break;
      }
      case 'stock_summary': {
        const headers = ['Item Name', 'Category', 'Unit', 'Loose Stock', 'Variant Stock', 'Total Stock', 'Cost Price (PKR)', 'Selling Price (PKR)', 'Valuation at Cost (PKR)', 'Retail Worth (PKR)'];
        const rows = stockValuationData.list.map(i => [
          i.name,
          i.category,
          i.unit,
          i.looseStock,
          i.totalVariantsUnits,
          i.totalBaseQty,
          i.costPrice,
          i.sellingPrice,
          i.valuationCost,
          i.retailWorth
        ]);
        exportToCSV(filename, headers, rows);
        break;
      }
      case 'item_ledger': {
        const headers = ['Date', 'Document / Ref', 'Activity Description', 'Quantity In (+)', 'Quantity Out (-)', 'Running Stock'];
        const rows = itemLedgerData.list.map(e => [
          normalizeDate(e.date),
          e.ref,
          e.desc,
          e.qtyIn,
          e.qtyOut,
          e.runningQty
        ]);
        exportToCSV(filename, headers, rows);
        break;
      }
      case 'low_stock': {
        const headers = ['Item Name', 'Category', 'Unit', 'Current Stock', 'Safety Threshold', 'Shortage Deficit', 'Suggested Reorder Qty', 'Urgency Status'];
        const rows = lowStockData.list.map(i => [
          i.name,
          i.category,
          i.unit,
          i.currentStock,
          i.threshold,
          i.shortage,
          i.suggestedReorder,
          i.status
        ]);
        exportToCSV(filename, headers, rows);
        break;
      }
      case 'purchase_register': {
        const headers = ['Date', 'Type', 'Supplier / Vendor', 'Shift', 'Quantity', 'Unit', 'FAT %', 'SNF %', 'Rate (PKR)', 'Total Amount (PKR)', 'Paid', 'Due'];
        const rows = purchaseRegisterData.entries.map(p => [
          normalizeDate(p.date),
          p.type,
          p.supplierName,
          p.shift,
          p.quantity,
          p.unit,
          p.fat,
          p.snf,
          p.rate,
          p.totalAmount,
          p.paid,
          p.due
        ]);
        exportToCSV(filename, headers, rows);
        break;
      }
      case 'supplier_summary': {
        const headers = ['Supplier Name', 'Village / Area', 'Phone', 'Milk Liters (L)', 'Total Billed (PKR)', 'Paid to Date (PKR)', 'Current Pending Balance (PKR)'];
        const rows = supplierSummaryData.list.map(s => [
          s.name,
          s.village,
          s.phone,
          s.milkLiters,
          s.totalBilled,
          s.payments,
          s.pendingBalance
        ]);
        exportToCSV(filename, headers, rows);
        break;
      }
      case 'production_yield': {
        const headers = ['Batch Number', 'Product Name', 'Start Date', 'Input Milk (L)', 'Actual Output', 'Wastage / Loss', 'Yield %', 'Batch Cost (PKR)', 'Sales Value (PKR)'];
        const rows = productionYieldData.batches.map(b => [
          b.batchNumber,
          b.productName,
          normalizeDate(b.startDate),
          b.inputMilk,
          b.actualOut,
          b.wastage,
          `${b.yieldPct.toFixed(1)}%`,
          b.totalCost,
          b.salesValue
        ]);
        exportToCSV(filename, headers, rows);
        break;
      }
      default:
        break;
    }
  };

  const copyWhatsAppSummary = () => {
    const dateStr = formatDate(dateRange.start) + (dateRange.start !== dateRange.end ? ` to ${formatDate(dateRange.end)}` : '');
    const lines: string[] = [];
    lines.push(`*${settings?.general?.companyName || 'MOOCO DAIRY FARM & SWEETS'}*`);
    lines.push(`*Daily Executive Closing Summary*`);
    lines.push(`📅 *Date:* ${dateStr}`);
    lines.push(`⏰ *Generated:* ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    lines.push(`👤 *Prepared By:* ${currentUser?.name || 'Administrator'}`);
    lines.push(`----------------------------------------`);
    lines.push(`🥛 *1. MILK RECONCILIATION*`);
    lines.push(`• Total Intake: *${dayBookData.milk.totalMilkInLitres.toFixed(1)} L* (${formatCurrency(Math.round(dayBookData.milk.totalMilkInCost))})`);
    lines.push(`  - Cow Milk: ${dayBookData.milk.cowLitresIn.toFixed(1)} L | Buffalo Milk: ${dayBookData.milk.buffaloLitresIn.toFixed(1)} L`);
    lines.push(`• Counter Sales: *${dayBookData.milk.counterMilkLitres.toFixed(1)} L* (${formatCurrency(Math.round(dayBookData.milk.counterMilkRevenue))})`);
    lines.push(`• Factory / Production: *${dayBookData.milk.productionMilkLitres.toFixed(1)} L*`);
    lines.push(`• Closing Chiller Stock: *${dayBookData.milk.liveTotalMilkStock.toFixed(1)} L*`);
    lines.push(``);
    lines.push(`💵 *2. MONEY IN (INFLOWS)*`);
    lines.push(`• Cash Counter Sales: +${formatCurrency(Math.round(dayBookData.inflows.posCashSales))} (${dayBookData.inflows.posCashBillsCount} bills)`);
    if (dayBookData.inflows.posOnlineSales > 0) lines.push(`• Digital / Bank Sales: +${formatCurrency(Math.round(dayBookData.inflows.posOnlineSales))}`);
    if (dayBookData.inflows.customerCollections > 0) lines.push(`• Customer Debt Recoveries: +${formatCurrency(Math.round(dayBookData.inflows.customerCollections))}`);
    lines.push(`👉 *Total Money In: +${formatCurrency(Math.round(dayBookData.inflows.totalAllInflows))}*`);
    lines.push(``);
    lines.push(`💸 *3. MONEY OUT (EXPENSES & OUTFLOWS)*`);
    lines.push(`• Spot Milk Cash: -${formatCurrency(Math.round(dayBookData.outflows.spotMilkPaid))}`);
    lines.push(`• Operating Overheads: -${formatCurrency(Math.round(dayBookData.outflows.totalExpenses))}`);
    if (dayBookData.outflows.otherSupplierPayments > 0) lines.push(`• Supplier Payments: -${formatCurrency(Math.round(dayBookData.outflows.otherSupplierPayments))}`);
    if (dayBookData.outflows.materialCashPaid > 0) lines.push(`• Material Purchases: -${formatCurrency(Math.round(dayBookData.outflows.materialCashPaid))}`);
    lines.push(`👉 *Total Money Out: -${formatCurrency(Math.round(dayBookData.outflows.totalCashOutflow))}*`);
    lines.push(``);
    lines.push(`📒 *4. CREDIT & WORKING CAPITAL*`);
    lines.push(`• New Customer Credit: ${formatCurrency(Math.round(dayBookData.credit.posCreditSales))} (${dayBookData.credit.posCreditBillsCount} bills)`);
    lines.push(`• Debt Collected: ${formatCurrency(Math.round(dayBookData.credit.customerCollections))}`);
    lines.push(`• Supplier Milk Payables Accrued: ${formatCurrency(Math.round(dayBookData.credit.milkAccruedCredit))}`);
    lines.push(``);
    lines.push(`🗄️ *5. CASH DRAWER AUDIT*`);
    lines.push(`• Opening Float: ${formatCurrency(Math.round(dayBookData.drawer.shiftOpeningFloat))}`);
    lines.push(`• Total Inflows: +${formatCurrency(Math.round(dayBookData.inflows.totalCashInflow))}`);
    lines.push(`• Total Outflows: -${formatCurrency(Math.round(dayBookData.outflows.totalCashOutflow))}`);
    lines.push(`👉 *Expected Cash in Drawer: ${formatCurrency(Math.round(dayBookData.drawer.expectedClosingCash))}*`);
    lines.push(``);
    lines.push(`📊 *6. ESTIMATED PROFIT*`);
    lines.push(`• Gross Sales Revenue: ${formatCurrency(Math.round(dayBookData.profit.totalRevenue))}`);
    lines.push(`• Cost of Goods Sold: -${formatCurrency(Math.round(dayBookData.profit.estimatedCOGS))}`);
    lines.push(`• Operating Expenses: -${formatCurrency(Math.round(dayBookData.profit.totalExpenses))}`);
    lines.push(`🏆 *Estimated Net Profit: +${formatCurrency(Math.round(dayBookData.profit.estimatedNetProfit))}*`);
    lines.push(`----------------------------------------`);
    lines.push(`_Automated Official Daily Record • Mooco Dairy ERP_`);

    const text = lines.join('\n');
    navigator.clipboard.writeText(text);
    setIsWhatsAppCopied(true);
    showToast('Daily Summary copied to clipboard! Ready to paste into WhatsApp.', 'success', 2500);
    setTimeout(() => setIsWhatsAppCopied(false), 2500);
  };

  const printDayBookDocument = (format: 'a4' | 'thermal') => {
    const previewId = format === 'a4' ? 'daybook-a4-preview' : 'daybook-thermal-preview';
    const previewEl = document.getElementById(previewId);
    if (!previewEl) {
      showToast('Document preview element not found.', 'error');
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) return;

    const companyName = settings?.general?.companyName || 'MOOCO DAIRY FARM & SWEETS';

    const printStyles = format === 'a4'
      ? `@page { size: A4 portrait; margin: 8mm 10mm; }
         * { box-sizing: border-box; }
         body { font-family: 'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; background: #ffffff; margin: 0; padding: 0; font-size: 10.5px; line-height: 1.35; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
         table { width: 100%; border-collapse: collapse; }
         th, td { border: 1px solid #cbd5e1; padding: 3px 6px; }
         tr:nth-child(even) { background-color: #f8fafc; }
         .print-avoid-break { break-inside: avoid; page-break-inside: avoid; }`
      : `@page { size: 80mm auto; margin: 3mm 4mm; }
         * { box-sizing: border-box; }
         body { font-family: 'Courier New', Courier, monospace, system-ui; color: #000000; background: #ffffff; margin: 0; padding: 0; font-size: 11px; line-height: 1.35; width: 72mm; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
         .divider { border-bottom: 1px dashed #000000; margin: 5px 0; }`;

    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Daily Closing Summary - ' + companyName + '</title><style>' + printStyles + '</style></head><body>' + previewEl.innerHTML + '</body></html>');
    doc.close();

    showToast('Print dialog initiated. You can select "Save as PDF" or your printer.', 'info', 2000);
    iframe.contentWindow?.focus();
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 1500);
    }, 350);
  };

  const downloadDayBookPDF = async () => {
    const previewId = dayBookPrintFormat === 'a4' ? 'daybook-a4-preview' : 'daybook-thermal-preview';
    const element = document.getElementById(previewId);
    if (!element) {
      showToast('Document preview element not found.', 'error');
      return;
    }

    setIsGeneratingPDF(true);
    showToast('Rendering high-resolution PDF document...', 'info', 1500);

    try {
      const { html2canvas, jsPDF } = await loadPdfRuntime();
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });

      const imgData = canvas.toDataURL('image/png');
      const filenameDate = dateRange.start || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

      if (dayBookPrintFormat === 'a4') {
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: 'a4'
        });

        const imgWidth = 210;
        const pageHeight = 297;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        let heightLeft = imgHeight;
        let position = 0;

        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
        heightLeft -= pageHeight;

        while (heightLeft > 0) {
          position = heightLeft - imgHeight;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
          heightLeft -= pageHeight;
        }

        pdf.save(`Mooco-Executive-Daily-Summary-${filenameDate}.pdf`);
      } else {
        const slipWidth = 80;
        const slipHeight = (canvas.height * slipWidth) / canvas.width;
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: [slipWidth, Math.max(slipHeight + 8, 100)]
        });

        pdf.addImage(imgData, 'PNG', 0, 0, slipWidth, slipHeight, undefined, 'FAST');
        pdf.save(`Mooco-Closing-Slip-${filenameDate}.pdf`);
      }

      showToast('PDF downloaded successfully!', 'success', 3000);
    } catch (err) {
      console.error('PDF Generation Error:', err);
      showToast('Direct download error. Opening print preview instead...', 'warning', 2500);
      printDayBookDocument(dayBookPrintFormat);
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  // --- Customer Outstanding Balance Print & PDF Helpers ---
  const customerRoutes = useMemo(() => {
    const set = new Set<string>();
    customers.forEach(c => {
      if (c.route && c.route.trim() && c.route !== '-') {
        set.add(c.route.trim());
      }
    });
    return Array.from(set).sort();
  }, [customers]);

  const customerPrintData = useMemo(() => {
    let list = customers.map(cust => {
      const pos = sales.filter(s => s.customer_id === cust.id && isInRange(s.date) && s.status !== 'Returned');
      const posRevenue = pos.reduce((s, b) => s + (b.total || 0), 0);
      const posOrders = pos.length;

      const supplies = dailySupplyEntries.filter(s => s.customer_id === cust.id && isInRange(s.date));
      const supplyRevenue = supplies.reduce((s, e) => s + (e.total_amount || 0), 0);
      const supplyLiters = supplies.reduce((s, e) => s + (e.quantity || 0), 0);

      const totalRevenue = posRevenue + supplyRevenue;
      const payments = customerTransactions
        .filter(t => t.customer_id === cust.id && isInRange(t.date) && t.type === 'Payment')
        .reduce((s, t) => s + (t.amount || 0), 0);

      const balance = Number(cust.balance) || 0;

      return {
        id: cust.id,
        name: cust.name,
        phone: cust.phone || '-',
        address: cust.address || '',
        type: cust.type || 'Retail',
        route: cust.route || '-',
        posRevenue,
        posOrders,
        supplyRevenue,
        supplyLiters,
        totalRevenue,
        payments,
        balance
      };
    });

    // Filter by customer balance status
    if (customerPrintFilter === 'dues_only') {
      list = list.filter(c => c.balance > 0.01);
    } else if (customerPrintFilter === 'advance_only') {
      list = list.filter(c => c.balance < -0.01);
    } else {
      list = list.filter(c => Math.abs(c.balance) > 0.01 || c.totalRevenue > 0 || c.payments > 0);
    }

    // Filter by Route
    if (customerPrintRoute !== 'all') {
      list = list.filter(c => c.route === customerPrintRoute);
    }

    // Filter by Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.phone.includes(q) || (c.route && c.route.toLowerCase().includes(q)));
    }

    // Sort list
    if (customerPrintSort === 'balance_desc') {
      list.sort((a, b) => b.balance - a.balance);
    } else if (customerPrintSort === 'name_asc') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (customerPrintSort === 'route') {
      list.sort((a, b) => {
        const routeCompare = (a.route || '').localeCompare(b.route || '');
        if (routeCompare !== 0) return routeCompare;
        return b.balance - a.balance;
      });
    }

    const totalReceivables = list.reduce((sum, c) => sum + (c.balance > 0 ? c.balance : 0), 0);
    const totalAdvances = list.reduce((sum, c) => sum + (c.balance < 0 ? Math.abs(c.balance) : 0), 0);
    const totalPeriodSales = list.reduce((sum, c) => sum + c.totalRevenue, 0);
    const totalPeriodCollections = list.reduce((sum, c) => sum + c.payments, 0);
    const debtorCount = list.filter(c => c.balance > 0.01).length;
    const advanceCount = list.filter(c => c.balance < -0.01).length;

    return {
      list,
      totalReceivables,
      totalAdvances,
      totalPeriodSales,
      totalPeriodCollections,
      debtorCount,
      advanceCount,
      totalCount: list.length
    };
  }, [customers, sales, dailySupplyEntries, customerTransactions, dateRange, customerPrintFilter, customerPrintRoute, customerPrintSort, searchQuery]);

  const copyCustomerWhatsAppSummary = () => {
    const lines: string[] = [];
    const dateStr = formatDate(dateRange.start) + (dateRange.start !== dateRange.end ? ` to ${formatDate(dateRange.end)}` : '');
    lines.push(`*${settings?.general?.companyName || 'MOOCO DAIRY FARM & SWEETS'}*`);
    lines.push(`📋 *CUSTOMER OUTSTANDING BALANCES REPORT*`);
    lines.push(`📅 *Date:* ${new Date().toLocaleDateString('en-GB')} (${dateStr})`);
    lines.push(`⏰ *Time:* ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    lines.push(`👤 *Prepared By:* ${currentUser?.name || 'Administrator'}`);
    lines.push(`----------------------------------------`);
    lines.push(`💰 *Total Outstanding Dues:* ${formatCurrency(Math.round(customerPrintData.totalReceivables))} Dr`);
    lines.push(`👥 *Owing Customers:* ${customerPrintData.debtorCount} of ${customerPrintData.totalCount}`);
    if (customerPrintData.totalAdvances > 0) {
      lines.push(`🛡️ *Advance Deposits (Cr):* ${formatCurrency(Math.round(customerPrintData.totalAdvances))} (${customerPrintData.advanceCount} cust)`);
    }
    if (customerPrintData.totalPeriodCollections > 0) {
      lines.push(`💵 *Period Recoveries:* ${formatCurrency(Math.round(customerPrintData.totalPeriodCollections))}`);
    }
    lines.push(`----------------------------------------`);
    lines.push(`*TOP OUTSTANDING BALANCES:*`);
    const topDebtors = customerPrintData.list.filter(c => c.balance > 0.01).slice(0, 15);
    topDebtors.forEach((c, idx) => {
      const routeText = c.route !== '-' ? ` [${c.route}]` : '';
      const phoneText = c.phone !== '-' ? ` 📱 ${c.phone}` : '';
      lines.push(`${idx + 1}. *${c.name}*${routeText}: ${formatCurrency(Math.round(c.balance))} Dr${phoneText}`);
    });
    if (customerPrintData.debtorCount > 15) {
      lines.push(`... and ${customerPrintData.debtorCount - 15} more customers.`);
    }
    lines.push(`----------------------------------------`);
    lines.push(`_Mooco Dairy Accounting & Recovery System_`);

    const text = lines.join('\n');
    navigator.clipboard.writeText(text);
    setIsCustomerWhatsAppCopied(true);
    showToast('Customer balances summary copied! Ready to paste into WhatsApp.', 'success', 2500);
    setTimeout(() => setIsCustomerWhatsAppCopied(false), 2500);
  };

  const printCustomerBalanceDocument = (format: 'a4' | 'thermal') => {
    const previewId = format === 'a4' ? 'customer-balance-a4-preview' : 'customer-balance-thermal-preview';
    const previewEl = document.getElementById(previewId);
    if (!previewEl) {
      showToast('Document preview element not found.', 'error');
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) return;

    const companyName = settings?.general?.companyName || 'MOOCO DAIRY FARM & SWEETS';

    const printStyles = format === 'a4'
      ? `@page { size: A4 portrait; margin: 8mm 10mm; }
         * { box-sizing: border-box; }
         body { font-family: 'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; background: #ffffff; margin: 0; padding: 0; font-size: 10px; line-height: 1.35; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
         table { width: 100%; border-collapse: collapse; }
         th, td { border: 1px solid #cbd5e1; padding: 4px 6px; }
         tr:nth-child(even) { background-color: #f8fafc; }
         .print-avoid-break { break-inside: avoid; page-break-inside: avoid; }`
      : `@page { size: 80mm auto; margin: 3mm 4mm; }
         * { box-sizing: border-box; }
         body { font-family: 'Courier New', Courier, monospace, system-ui; color: #000000; background: #ffffff; margin: 0; padding: 0; font-size: 11px; line-height: 1.35; width: 72mm; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
         .divider { border-bottom: 1px dashed #000000; margin: 4px 0; }`;

    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Customer Outstanding Balances - ' + companyName + '</title><style>' + printStyles + '</style></head><body>' + previewEl.innerHTML + '</body></html>');
    doc.close();

    showToast('Print dialog initiated. You can select "Save as PDF" or your printer.', 'info', 2000);
    iframe.contentWindow?.focus();
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 1500);
    }, 350);
  };

  const downloadCustomerBalancePDF = async () => {
    const previewId = customerPrintFormat === 'a4' ? 'customer-balance-a4-preview' : 'customer-balance-thermal-preview';
    const element = document.getElementById(previewId);
    if (!element) {
      showToast('Document preview element not found.', 'error');
      return;
    }

    setIsCustomerBalancePDFGenerating(true);
    showToast('Rendering high-resolution Customer Balances PDF...', 'info', 1500);

    try {
      const { html2canvas, jsPDF } = await loadPdfRuntime();
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });

      const imgData = canvas.toDataURL('image/png');
      const filenameDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

      if (customerPrintFormat === 'a4') {
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: 'a4'
        });

        const imgWidth = 210;
        const pageHeight = 297;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        let heightLeft = imgHeight;
        let position = 0;

        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
        heightLeft -= pageHeight;

        while (heightLeft > 0) {
          position = heightLeft - imgHeight;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
          heightLeft -= pageHeight;
        }

        pdf.save(`Mooco-Customer-Outstanding-Balances-${filenameDate}.pdf`);
      } else {
        const slipWidth = 80;
        const slipHeight = (canvas.height * slipWidth) / canvas.width;
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: [slipWidth, Math.max(slipHeight + 8, 100)]
        });

        pdf.addImage(imgData, 'PNG', 0, 0, slipWidth, slipHeight, undefined, 'FAST');
        pdf.save(`Mooco-Customer-Dues-Slip-${filenameDate}.pdf`);
      }

      showToast('Customer Balances PDF downloaded successfully!', 'success', 3000);
    } catch (err) {
      console.error('PDF Generation Error:', err);
      showToast('Direct download error. Opening print preview instead...', 'warning', 2500);
      printCustomerBalanceDocument(customerPrintFormat);
    } finally {
      setIsCustomerBalancePDFGenerating(false);
    }
  };

  const handlePrint = () => {
    if (activeReport === 'stock_profit' && (!stockProfitData?.validRange || profitLoading || profitError)) { showToast('Load a valid profit report before printing.', 'warning'); return; }
    if (activeReport === 'day_book') {
      setIsDayBookSlipModalOpen(true);
    } else if (activeReport === 'sales_by_customer') {
      setIsCustomerBalanceModalOpen(true);
    } else {
      window.print();
    }
  };

  // Find active definition
  const currentCategory = Object.keys(REPORT_MENU).find(k => 
    REPORT_MENU[k as ReportCategory].reports.some(r => r.id === activeReport)
  ) as ReportCategory;
  const currentDef = REPORT_MENU[currentCategory]?.reports.find(r => r.id === activeReport);

  return (
    <div data-report={activeReport} className="mooco-card reports-workspace relative flex flex-1 min-h-0 flex-col lg:flex-row h-full rounded-2xl border border-slate-200 overflow-hidden text-slate-800 dark:text-slate-100">
      
      {/* ========================================================
          SIDEBAR NAVIGATION (Categorized & Collapsible)
         ======================================================== */}
      <aside className={`w-full lg:w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col shrink-0 h-full overflow-y-auto print:hidden z-20 ${mobileMenuOpen ? 'absolute inset-0 flex lg:static' : 'hidden lg:flex'}`} aria-label="Report categories">
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white text-lg flex items-center gap-2">
              <FileText size={20} className="text-lime-600 dark:text-lime-400" /> Executive Reports
            </h3>
            <p className="text-xs text-slate-400 dark:text-slate-400 mt-0.5 font-medium">Real-time Dairy Intelligence</p>
          </div>
          <button 
            type="button"
            aria-label="Close report categories"
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        <div className="p-3 space-y-5 flex-1">
          {(Object.entries(REPORT_MENU) as [ReportCategory, { label: string; icon: React.ElementType; reports: ReportDefinition[] }][]).map(([catKey, category]) => (
            <div key={catKey}>
              <div className="px-3 text-[11px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <category.icon size={13} className="text-slate-400" />
                {category.label}
              </div>
              <div className="space-y-1">
                {category.reports.map(rep => {
                  const Icon = rep.icon;
                  const isActive = activeReport === rep.id;
                  return (
                    <button
                      key={rep.id}
                      type="button"
                      onClick={() => selectReport(rep.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-between transition-all cursor-pointer ${
                        isActive 
                          ? 'bg-lime-500 text-white shadow-md shadow-lime-500/20 font-bold' 
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <Icon size={16} className={isActive ? 'text-white' : 'text-slate-400 dark:text-slate-400'} />
                        <span className="truncate">{rep.label}</span>
                      </div>
                      {isActive && <ChevronRight size={14} className="text-white shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-[11px] text-slate-400 flex items-center justify-between">
          <span>Mooco Accounting v2.4</span>
          <span className="flex items-center gap-1 text-emerald-600 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Live
          </span>
        </div>
      </aside>

      {/* ========================================================
          MAIN REPORT CANVAS & CONTROLS
         ======================================================== */}
      <main className="flex-1 flex flex-col min-w-0 lg:h-full overflow-hidden">
        
        {/* --- TOP CONTROL & FILTER BAR --- */}
        <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-3 sm:p-4 shrink-0 print:hidden space-y-3 shadow-xs">
          
          {/* Row 1: Title, Presets & Actions */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Choose report"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Filter size={16} />
              </button>
              <div>
                <h1 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2 leading-none">
                  {currentDef?.label}
                </h1>
                <p className="text-xs text-slate-400 dark:text-slate-400 mt-1 font-medium hidden sm:block">
                  {currentDef?.subtitle}
                </p>
              </div>
            </div>

            {/* Quick Action Buttons: CSV & Print */}
            <div className="flex items-center gap-2 self-end md:self-auto">
              <button
                type="button"
                onClick={handleExportCSV}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer"
                title="Download Clean CSV for Microsoft Excel & Google Sheets"
              >
                <Download size={14} />
                <span className="hidden sm:inline">Export</span> CSV
              </button>

              <button
                type="button"
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-lime-600 hover:bg-lime-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-lime-600/20 active:scale-95 cursor-pointer"
                title="Print or Save as PDF"
              >
                <Printer size={14} />
                <span>Print <span className="hidden sm:inline">Report</span></span>
              </button>
            </div>
          </div>

          {/* Row 2: Date Presets & Custom Pickers */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 border-t border-slate-100 dark:border-slate-800">
            {/* Quick Presets Pills */}
            <div className="flex flex-wrap items-center gap-1 text-xs">
              {(['today', 'yesterday', '7days', 'month', 'last_month', 'year'] as PresetRange[]).map(preset => {
                const labels: Record<PresetRange, string> = {
                  today: 'Today',
                  yesterday: 'Yesterday',
                  '7days': 'Last 7 Days',
                  '30days': 'Last 30 Days',
                  month: 'This Month',
                  last_month: 'Last Month',
                  year: 'This Year',
                  custom: 'Custom'
                };
                const isSelected = timePreset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={`px-2.5 py-1 rounded-lg font-semibold text-xs transition-colors cursor-pointer ${
                      isSelected 
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs' 
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {labels[preset]}
                  </button>
                );
              })}
            </div>

            {/* Manual Date Inputs */}
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1 text-xs">
              <Calendar size={13} className="text-slate-400 shrink-0" />
              <input
                type="date"
                aria-label="Report start date"
                value={dateRange.start}
                onChange={e => {
                  setTimePreset('custom');
                  setDateRange({ ...dateRange, start: e.target.value });
                }}
                className="bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none text-xs"
              />
              <span className="text-slate-300 dark:text-slate-600 font-bold">to</span>
              <input
                type="date"
                aria-label="Report end date"
                value={dateRange.end}
                onChange={e => {
                  setTimePreset('custom');
                  setDateRange({ ...dateRange, end: e.target.value });
                }}
                className="bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none text-xs"
              />
            </div>
          </div>

          {/* Row 3: Contextual Sub-filters & Search */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {/* Live Search */}
            <div className="relative flex-1 min-w-[180px] max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search rows in report..."
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:border-lime-500 transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Context Dropdowns */}
            {(activeReport === 'sales_by_item' || activeReport === 'item_ledger') && (
              <select
                value={selectedItemId}
                onChange={e => setSelectedItemId(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:border-lime-500"
              >
                <option value="all">All Products / Items</option>
                {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            )}

            {activeReport === 'sales_by_customer' && (
              <select
                value={selectedCustomerId}
                onChange={e => setSelectedCustomerId(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:border-lime-500"
              >
                <option value="all">All Customers</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}

            {(activeReport === 'purchase_register' || activeReport === 'supplier_summary') && (
              <select
                value={selectedSupplierId}
                onChange={e => setSelectedSupplierId(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:border-lime-500"
              >
                <option value="all">All Milk Suppliers</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}

            {activeReport === 'day_book' && (
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl text-xs">
                {(['all', 'Income', 'Expense'] as const).map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setTransactionTypeFilter(type)}
                    className={`px-2 py-1 rounded-lg font-bold transition-colors ${
                      transactionTypeFilter === type 
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' 
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {type === 'all' ? 'All Types' : type === 'Income' ? '+ Inflow' : '- Outflow'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* --- SCROLLABLE REPORT BODY CANVAS --- */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 bg-slate-50/70 dark:bg-slate-950 print:bg-white print:p-0" ref={printRef}>
          <div className="max-w-6xl mx-auto space-y-6">

            {/* Print Header (Visible ONLY on print) */}
            <div className="hidden print:block mb-6 border-b-2 border-slate-900 pb-3">
              <div className="flex justify-between items-start">
                <div>
                  <h1 className="text-2xl font-black tracking-tight text-black">MOOCO DAIRY &amp; FARM FOODS</h1>
                  <h2 className="text-base font-bold text-slate-700 uppercase mt-0.5">{currentDef?.label}</h2>
                  <p className="text-xs text-slate-500">{currentDef?.subtitle}</p>
                </div>
                <div className="text-right text-xs text-slate-600 space-y-0.5">
                  <p><span className="font-bold">Period:</span> {formatDate(dateRange.start)} — {formatDate(dateRange.end)}</p>
                  <p><span className="font-bold">Printed:</span> {new Date().toLocaleString('en-GB')}</p>
                  <p><span className="font-bold">Generated By:</span> {currentUser?.name || 'Administrator'}</p>
                </div>
              </div>
            </div>

            {/* ================================================================
                REPORT 1: PROFIT & LOSS (INCOME STATEMENT)
               ================================================================ */}
            {activeReport === 'stock_profit' && <StockProfitReportView report={stockProfitData} loading={profitLoading} error={profitError} start={dateRange.start} end={dateRange.end} loadedAt={profitSource?.loadedAt} search={searchQuery} onRefresh={() => setProfitRefresh(value => value + 1)} />}
            {activeReport === 'pnl' && (
              <div className="space-y-6">
                {/* Executive KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block">Total Revenue</span>
                    <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1 block">
                      {formatCurrency(pnlData.totalRevenue)}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">POS: {formatCurrency(pnlData.posRevenue)} • Supply: {formatCurrency(pnlData.supplyRevenue)}</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider block">Cost of Goods (COGS)</span>
                    <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1 block">
                      {formatCurrency(pnlData.totalCOGS)}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Milk: {formatCurrency(pnlData.milkCost)} ({Math.round(pnlData.milkLiters)} L)</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-purple-600 uppercase tracking-wider block">Gross Profit</span>
                    <span className="text-xl sm:text-2xl font-black text-purple-600 dark:text-purple-400 mt-1 block">
                      {formatCurrency(pnlData.grossProfit)}
                    </span>
                    <span className="text-[11px] font-semibold text-purple-500 mt-1 block">Margin: {pnlData.grossMargin.toFixed(1)}%</span>
                  </div>

                  <div className={`p-4 rounded-2xl border shadow-xs ${
                    pnlData.netProfit >= 0 
                      ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800' 
                      : 'bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
                  }`}>
                    <span className={`text-[11px] font-bold uppercase tracking-wider block ${pnlData.netProfit >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                      Net Profit / (Loss)
                    </span>
                    <span className={`text-xl sm:text-2xl font-black mt-1 block ${pnlData.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {formatCurrency(pnlData.netProfit)}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 block font-semibold">Net Margin: {pnlData.netMargin.toFixed(1)}%</span>
                  </div>
                </div>

                {/* Visual Chart: Revenue vs Expenses Trend */}
                {pnlData.trendData.length > 0 && (
                  <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3 print:hidden">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-bold text-sm text-slate-900 dark:text-white">Revenue vs Operating Performance</h3>
                        <p className="text-xs text-slate-400">Daily financial trajectory in the selected date window</p>
                      </div>
                      <div className="flex items-center gap-3 text-xs font-bold">
                        <span className="flex items-center gap-1 text-emerald-600"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Revenue</span>
                        <span className="flex items-center gap-1 text-blue-600"><span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> COGS</span>
                        <span className="flex items-center gap-1 text-purple-600"><span className="w-2.5 h-2.5 rounded-full bg-purple-500"></span> Net Profit</span>
                      </div>
                    </div>
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={pnlData.trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} tickLine={false} />
                          <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} width={48} tickFormatter={formatCompactValue} />
                          <RechartsTooltip 
                            contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '11px' }} 
                            formatter={(value: any) => formatCurrency(Number(value))}
                          />
                          <Bar dataKey="revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="cogs" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="profit" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Structured Financial Statement Table */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                  <table className="w-full text-left text-xs sm:text-sm border-collapse">
                    <tbody>
                      {/* Revenue Section */}
                      <tr className="bg-slate-100/70 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                        <td colSpan={2} className="py-2.5 px-4 font-black text-slate-800 dark:text-slate-100 uppercase tracking-wide">
                          1. OPERATING REVENUE (INCOME)
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="py-2.5 px-4 pl-8 text-slate-600 dark:text-slate-300">Point of Sale (Retail Store Sales)</td>
                        <td className="py-2.5 px-4 text-right font-semibold">{formatCurrency(pnlData.posRevenue)}</td>
                      </tr>
                      <tr className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="py-2.5 px-4 pl-8 text-slate-600 dark:text-slate-300">Daily Milk Supply (Delivery Subscriptions)</td>
                        <td className="py-2.5 px-4 text-right font-semibold">{formatCurrency(pnlData.supplyRevenue)}</td>
                      </tr>
                      <tr className="bg-emerald-50/40 dark:bg-emerald-950/20 font-bold border-b border-slate-200 dark:border-slate-700">
                        <td className="py-2.5 px-4 text-emerald-800 dark:text-emerald-300">TOTAL OPERATING REVENUE</td>
                        <td className="py-2.5 px-4 text-right text-emerald-700 dark:text-emerald-400 font-mono font-black">{formatCurrency(pnlData.totalRevenue)}</td>
                      </tr>

                      {/* COGS Section */}
                      <tr className="bg-slate-100/70 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                        <td colSpan={2} className="py-2.5 px-4 font-black text-slate-800 dark:text-slate-100 uppercase tracking-wide pt-4">
                          2. DIRECT COST OF GOODS SOLD (COGS)
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="py-2.5 px-4 pl-8 text-slate-600 dark:text-slate-300">Raw Milk Procurement ({Math.round(pnlData.milkLiters)} Liters collected)</td>
                        <td className="py-2.5 px-4 text-right font-semibold text-slate-700 dark:text-slate-300">{formatCurrency(pnlData.milkCost)}</td>
                      </tr>
                      <tr className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="py-2.5 px-4 pl-8 text-slate-600 dark:text-slate-300">Packaging Materials, Culture &amp; Ingredients</td>
                        <td className="py-2.5 px-4 text-right font-semibold text-slate-700 dark:text-slate-300">{formatCurrency(pnlData.materialCost)}</td>
                      </tr>
                      <tr className="bg-slate-50 dark:bg-slate-800/50 font-bold border-b border-slate-200 dark:border-slate-700">
                        <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">TOTAL COST OF GOODS SOLD</td>
                        <td className="py-2.5 px-4 text-right text-slate-800 dark:text-slate-200 font-mono font-bold">{formatCurrency(pnlData.totalCOGS)}</td>
                      </tr>

                      {/* Gross Profit */}
                      <tr className="bg-purple-50/50 dark:bg-purple-950/30 border-y-2 border-purple-200 dark:border-purple-800 font-black">
                        <td className="py-3 px-4 text-purple-900 dark:text-purple-300 text-sm sm:text-base">GROSS PROFIT (Revenue - COGS)</td>
                        <td className="py-3 px-4 text-right text-purple-800 dark:text-purple-300 font-mono text-sm sm:text-base">{formatCurrency(pnlData.grossProfit)}</td>
                      </tr>

                      {/* Operating Expenses */}
                      <tr className="bg-slate-100/70 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                        <td colSpan={2} className="py-2.5 px-4 font-black text-slate-800 dark:text-slate-100 uppercase tracking-wide pt-4">
                          3. OPERATIONAL OVERHEAD &amp; EXPENSES
                        </td>
                      </tr>
                      {Object.keys(pnlData.expensesByCategory).length === 0 ? (
                        <tr className="border-b border-slate-100 dark:border-slate-800">
                          <td className="py-2 px-4 pl-8 text-slate-400 italic" colSpan={2}>No operating expenses recorded for this period.</td>
                        </tr>
                      ) : (
                        Object.entries(pnlData.expensesByCategory).map(([cat, amt]) => (
                          <tr key={cat} className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                            <td className="py-2 px-4 pl-8 text-slate-600 dark:text-slate-300">{cat}</td>
                            <td className="py-2 px-4 text-right font-semibold text-slate-700 dark:text-slate-300">{formatCurrency(Number(amt))}</td>
                          </tr>
                        ))
                      )}
                      <tr className="bg-slate-50 dark:bg-slate-800/50 font-bold border-b border-slate-200 dark:border-slate-700">
                        <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">TOTAL OPERATING EXPENSES</td>
                        <td className="py-2.5 px-4 text-right text-slate-800 dark:text-slate-200 font-mono font-bold">{formatCurrency(pnlData.operatingCost)}</td>
                      </tr>

                      {/* Net Profit */}
                      <tr className={`border-t-2 font-black ${
                        pnlData.netProfit >= 0 
                          ? 'bg-emerald-500 text-white' 
                          : 'bg-red-500 text-white'
                      }`}>
                        <td className="py-3.5 px-4 text-sm sm:text-base uppercase tracking-wide">
                          NET PROFIT / (LOSS) FOR THE PERIOD
                        </td>
                        <td className="py-3.5 px-4 text-right text-base sm:text-lg font-mono">
                          {formatCurrency(pnlData.netProfit)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ================================================================
                REPORT 2: BALANCE SHEET
               ================================================================ */}
            {activeReport === 'balance_sheet' && (
              <div className="space-y-6">
                {/* Equilibrium Status Banner */}
                <div className={`p-4 rounded-2xl border flex items-center justify-between ${
                  balanceSheetData.isBalanced 
                    ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                    : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                }`}>
                  <div className="flex items-center gap-2.5">
                    <Scale size={20} className={balanceSheetData.isBalanced ? 'text-emerald-600' : 'text-amber-600'} />
                    <div>
                      <h4 className="font-black text-sm">
                        {balanceSheetData.isBalanced ? 'Accounting Equilibrium: Perfectly Balanced' : 'Equilibrium Notice'}
                      </h4>
                      <p className="text-xs opacity-80">
                        {balanceSheetData.isBalanced 
                          ? 'Total Assets equal Total Liabilities and Equity as per fundamental accounting identity.' 
                          : `Variance of ${formatCurrency(Math.abs(balanceSheetData.difference))} detected between Assets and (Liabilities + Equity).`}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-black uppercase px-2.5 py-1 rounded-md bg-white/80 dark:bg-slate-900/80 border">
                    {balanceSheetData.isBalanced ? 'Balanced' : 'Review Needed'}
                  </span>
                </div>

                {/* Balance Sheet 2-Column Split */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* ASSETS */}
                  <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs flex flex-col justify-between">
                    <div>
                      <div className="bg-slate-100 dark:bg-slate-800 px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                        <span className="font-black text-sm text-slate-800 dark:text-white uppercase tracking-wider">ASSETS</span>
                        <span className="text-xs font-bold text-slate-500">Current &amp; Fixed</span>
                      </div>
                      <table className="w-full text-xs sm:text-sm">
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          <tr>
                            <td className="p-3.5 pl-5 text-slate-700 dark:text-slate-300">
                              <span className="font-semibold block">Liquid Cash &amp; Bank Accounts</span>
                              <span className="text-[11px] text-slate-400">Cash in hand, till drawers &amp; bank accounts</span>
                            </td>
                            <td className="p-3.5 pr-5 text-right font-mono font-bold">{formatCurrency(balanceSheetData.assets.cashBank)}</td>
                          </tr>
                          <tr>
                            <td className="p-3.5 pl-5 text-slate-700 dark:text-slate-300">
                              <span className="font-semibold block">Inventory Stock Valuation</span>
                              <span className="text-[11px] text-slate-400">Finished goods &amp; materials at cost price</span>
                            </td>
                            <td className="p-3.5 pr-5 text-right font-mono font-bold">{formatCurrency(balanceSheetData.assets.stockVal)}</td>
                          </tr>
                          <tr>
                            <td className="p-3.5 pl-5 text-slate-700 dark:text-slate-300">
                              <span className="font-semibold block">Accounts Receivable (Debtors)</span>
                              <span className="text-[11px] text-slate-400">Pending customer balances for milk &amp; items</span>
                            </td>
                            <td className="p-3.5 pr-5 text-right font-mono font-bold text-blue-600 dark:text-blue-400">{formatCurrency(balanceSheetData.assets.debtors)}</td>
                          </tr>
                          <tr>
                            <td className="p-3.5 pl-5 text-slate-700 dark:text-slate-300">
                              <span className="font-semibold block">Fixed &amp; Non-Current Assets</span>
                              <span className="text-[11px] text-slate-400">Chillers, delivery vehicles, machinery</span>
                            </td>
                            <td className="p-3.5 pr-5 text-right font-mono font-bold">{formatCurrency(balanceSheetData.assets.fixedAssets)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/80 p-4 border-t-2 border-slate-300 dark:border-slate-700 flex justify-between items-center font-black text-sm sm:text-base">
                      <span>TOTAL ASSETS</span>
                      <span className="font-mono text-emerald-600 dark:text-emerald-400">{formatCurrency(balanceSheetData.assets.totalAssets)}</span>
                    </div>
                  </div>

                  {/* LIABILITIES & EQUITY */}
                  <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs flex flex-col justify-between">
                    <div>
                      <div className="bg-slate-100 dark:bg-slate-800 px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                        <span className="font-black text-sm text-slate-800 dark:text-white uppercase tracking-wider">LIABILITIES &amp; EQUITY</span>
                        <span className="text-xs font-bold text-slate-500">Obligations &amp; Capital</span>
                      </div>
                      <table className="w-full text-xs sm:text-sm">
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          <tr className="bg-slate-50/50 dark:bg-slate-800/30">
                            <td colSpan={2} className="px-5 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Liabilities</td>
                          </tr>
                          <tr>
                            <td className="p-3 pl-6 text-slate-700 dark:text-slate-300">
                              <span className="font-semibold block">Accounts Payable (Milk Suppliers)</span>
                              <span className="text-[11px] text-slate-400">Pending dues payable to dairy farmers</span>
                            </td>
                            <td className="p-3 pr-5 text-right font-mono font-bold text-amber-600 dark:text-amber-400">{formatCurrency(balanceSheetData.liabilities.creditors)}</td>
                          </tr>
                          <tr>
                            <td className="p-3 pl-6 text-slate-700 dark:text-slate-300">
                              <span className="font-semibold block">Customer Advance Balances</span>
                              <span className="text-[11px] text-slate-400">Prepayments received from subscribers</span>
                            </td>
                            <td className="p-3 pr-5 text-right font-mono font-bold">{formatCurrency(balanceSheetData.liabilities.custAdvances)}</td>
                          </tr>
                          <tr>
                            <td className="p-3 pl-6 text-slate-700 dark:text-slate-300">
                              <span className="font-semibold block">Loans &amp; Payables</span>
                              <span className="text-[11px] text-slate-400">External borrowings &amp; short-term debt</span>
                            </td>
                            <td className="p-3 pr-5 text-right font-mono font-bold">{formatCurrency(balanceSheetData.liabilities.loans)}</td>
                          </tr>

                          <tr className="bg-slate-50/50 dark:bg-slate-800/30">
                            <td colSpan={2} className="px-5 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Equity</td>
                          </tr>
                          <tr>
                            <td className="p-3 pl-6 text-slate-700 dark:text-slate-300">
                              <span className="font-semibold block">Owner Capital Accounts</span>
                              <span className="text-[11px] text-slate-400">Invested equity by partners/directors</span>
                            </td>
                            <td className="p-3 pr-5 text-right font-mono font-bold">{formatCurrency(balanceSheetData.equity.equityManual)}</td>
                          </tr>
                          <tr>
                            <td className="p-3 pl-6 text-slate-700 dark:text-slate-300">
                              <span className="font-semibold block">Retained Earnings (Period P&amp;L)</span>
                              <span className="text-[11px] text-slate-400">Cumulative operating profits</span>
                            </td>
                            <td className="p-3 pr-5 text-right font-mono font-bold text-purple-600 dark:text-purple-400">{formatCurrency(balanceSheetData.equity.retainedEarnings)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/80 p-4 border-t-2 border-slate-300 dark:border-slate-700 flex justify-between items-center font-black text-sm sm:text-base">
                      <span>TOTAL LIAB &amp; EQUITY</span>
                      <span className="font-mono text-slate-900 dark:text-white">{formatCurrency(balanceSheetData.totalLiabAndEquity)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                REPORT 3: CASH FLOW STATEMENT
               ================================================================ */}
            {activeReport === 'cash_flow' && (
              <div className="space-y-6">
                {/* KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block">Total Cash Inflows</span>
                    <span className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1 block font-mono">
                      +{formatCurrency(cashFlowData.totalInflows)}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Sales, collections &amp; receipts</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-red-600 uppercase tracking-wider block">Total Cash Outflows</span>
                    <span className="text-xl sm:text-2xl font-black text-red-600 dark:text-red-400 mt-1 block font-mono">
                      -{formatCurrency(cashFlowData.totalOutflows)}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Procurement, expenses &amp; dues</span>
                  </div>

                  <div className={`p-4 rounded-2xl border shadow-xs ${
                    cashFlowData.netCashFlow >= 0 ? 'bg-blue-50/60 dark:bg-blue-950/20 border-blue-200' : 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200'
                  }`}>
                    <span className="text-[11px] font-bold uppercase tracking-wider block text-blue-700 dark:text-blue-400">Net Cash Movement</span>
                    <span className="text-xl sm:text-2xl font-black text-blue-600 dark:text-blue-400 mt-1 block font-mono">
                      {cashFlowData.netCashFlow >= 0 ? '+' : ''}{formatCurrency(cashFlowData.netCashFlow)}
                    </span>
                    <span className="text-[11px] text-slate-500 mt-1 block">Net delta in available liquidity</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Ending Liquidity</span>
                    <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1 block font-mono">
                      {formatCurrency(cashFlowData.totalLiquidAccounts)}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Cash in hand + bank accounts</span>
                  </div>
                </div>

                {/* Visual Inflow vs Outflow Chart */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3 print:hidden">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">Cash Movement Overview</h3>
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={cashFlowData.comparisonData} layout="vertical" margin={{ top: 10, right: 30, left: 40, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                        <XAxis type="number" stroke="#94a3b8" fontSize={11} />
                        <YAxis dataKey="category" type="category" stroke="#94a3b8" fontSize={11} width={100} />
                        <RechartsTooltip 
                          contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '11px' }} 
                          formatter={(val: any) => formatCurrency(Number(val))}
                        />
                        <Bar dataKey="amount" fill="#10b981" radius={[0, 6, 6, 0]}>
                          {cashFlowData.comparisonData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Structured Cash Flow Ledger */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                  <table className="w-full text-xs sm:text-sm">
                    <tbody>
                      <tr className="bg-emerald-50/60 dark:bg-emerald-950/40 border-b border-emerald-100 dark:border-emerald-800">
                        <td colSpan={2} className="py-2.5 px-4 font-black text-emerald-900 dark:text-emerald-300 uppercase tracking-wide">
                          A. CASH INFLOWS FROM OPERATING ACTIVITIES
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2.5 px-4 pl-8 text-slate-700 dark:text-slate-300">POS Store Cash Receipts</td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-600">+{formatCurrency(cashFlowData.posCashSales)}</td>
                      </tr>
                      <tr className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2.5 px-4 pl-8 text-slate-700 dark:text-slate-300">Customer Collections &amp; Ledger Receipts</td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-600">+{formatCurrency(cashFlowData.custPayments)}</td>
                      </tr>
                      <tr className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2.5 px-4 pl-8 text-slate-700 dark:text-slate-300">Purchase Returns Received Back</td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-600">+{formatCurrency(cashFlowData.purchaseReturnIn)}</td>
                      </tr>
                      <tr className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2.5 px-4 pl-8 text-slate-700 dark:text-slate-300">Bank Deposits &amp; Direct Credit Transfers</td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-600">+{formatCurrency(cashFlowData.bankDeposits)}</td>
                      </tr>
                      <tr className="bg-slate-50 dark:bg-slate-800/60 font-bold border-b border-slate-200 dark:border-slate-700">
                        <td className="py-2.5 px-4">TOTAL CASH GENERATED</td>
                        <td className="py-2.5 px-4 text-right font-mono font-black text-emerald-600">+{formatCurrency(cashFlowData.totalInflows)}</td>
                      </tr>

                      <tr className="bg-red-50/60 dark:bg-red-950/40 border-b border-red-100 dark:border-red-800">
                        <td colSpan={2} className="py-2.5 px-4 font-black text-red-900 dark:text-red-300 uppercase tracking-wide pt-4">
                          B. CASH OUTFLOWS FROM OPERATING ACTIVITIES
                        </td>
                      </tr>
                      <tr className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2.5 px-4 pl-8 text-slate-700 dark:text-slate-300">Raw Milk Cash Procurement Payments</td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-red-600">-{formatCurrency(cashFlowData.milkPaid)}</td>
                      </tr>
                      <tr className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2.5 px-4 pl-8 text-slate-700 dark:text-slate-300">Supplier Ledger Payments &amp; Advances</td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-red-600">-{formatCurrency(cashFlowData.supplierPayments)}</td>
                      </tr>
                      <tr className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2.5 px-4 pl-8 text-slate-700 dark:text-slate-300">Packaging &amp; Material Purchases Paid</td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-red-600">-{formatCurrency(cashFlowData.materialPaid)}</td>
                      </tr>
                      <tr className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2.5 px-4 pl-8 text-slate-700 dark:text-slate-300">Operating Overhead Expenses Paid</td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-red-600">-{formatCurrency(cashFlowData.expensesPaid)}</td>
                      </tr>
                      <tr className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2.5 px-4 pl-8 text-slate-700 dark:text-slate-300">Sales Refunds Paid Out</td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-red-600">-{formatCurrency(cashFlowData.salesRefunds)}</td>
                      </tr>
                      <tr className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2.5 px-4 pl-8 text-slate-700 dark:text-slate-300">Bank Withdrawals &amp; Direct Debits</td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-red-600">-{formatCurrency(cashFlowData.bankWithdrawals)}</td>
                      </tr>
                      <tr className="bg-slate-50 dark:bg-slate-800/60 font-bold border-b border-slate-200 dark:border-slate-700">
                        <td className="py-2.5 px-4">TOTAL CASH DISBURSED</td>
                        <td className="py-2.5 px-4 text-right font-mono font-black text-red-600">-{formatCurrency(cashFlowData.totalOutflows)}</td>
                      </tr>

                      <tr className="bg-blue-600 text-white font-black text-sm sm:text-base">
                        <td className="py-3.5 px-4">NET CASH FLOW (A - B)</td>
                        <td className="py-3.5 px-4 text-right font-mono">
                          {cashFlowData.netCashFlow >= 0 ? '+' : ''}{formatCurrency(cashFlowData.netCashFlow)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ================================================================
                REPORT 4: DAY BOOK / DAILY BUSINESS SUMMARY
               ================================================================ */}
            {activeReport === 'day_book' && (
              <div className="space-y-6">
                {/* --- Top Banner & Quick Controls --- */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-xs">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-xl bg-lime-500/15 dark:bg-lime-950/60 text-lime-600 dark:text-lime-400 flex items-center justify-center font-bold">
                          <FileText size={18} />
                        </span>
                        <h3 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
                          Daily Business Summary (Day Book)
                        </h3>
                      </div>
                      <p className="text-xs sm:text-sm text-slate-500 mt-1">
                        Comprehensive daily summary of milk reconciliation, revenue inflows, expenses, credit ledger, and drawer cash balance.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {/* View Mode Toggle */}
                      <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl border border-slate-200 dark:border-slate-700">
                        <button
                          type="button"
                          onClick={() => setDayBookViewMode('simple')}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                            dayBookViewMode === 'simple'
                              ? 'bg-lime-500 text-slate-950 shadow-sm'
                              : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          <Sparkles size={14} />
                          <span>Executive Summary</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDayBookViewMode('detailed')}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                            dayBookViewMode === 'detailed'
                              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                              : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          <FileText size={14} />
                          <span>Detailed Journal</span>
                        </button>
                      </div>

                      {/* Direct Download PDF Button */}
                      <button
                        type="button"
                        onClick={() => {
                          setDayBookPrintFormat('a4');
                          setIsDayBookSlipModalOpen(true);
                          setTimeout(() => {
                            downloadDayBookPDF();
                          }, 300);
                        }}
                        className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white rounded-2xl text-xs font-black transition-all shadow-sm hover:shadow-md cursor-pointer border border-slate-700/60"
                        title="Directly download Executive A4 PDF Report"
                      >
                        <FileDown size={14} className="text-lime-400" />
                        <span>Download PDF</span>
                      </button>

                      {/* Print / Export PDF Studio Button */}
                      <button
                        type="button"
                        onClick={() => setIsDayBookSlipModalOpen(true)}
                        className="flex items-center gap-1.5 px-3.5 py-2 bg-lime-500 hover:bg-lime-400 text-slate-950 rounded-2xl text-xs font-black transition-all shadow-sm hover:shadow-md cursor-pointer"
                        title="Open Print & PDF Studio (Executive A4 / Thermal 80mm)"
                      >
                        <Printer size={14} />
                        <span>Print &amp; Studio</span>
                      </button>
                    </div>
                  </div>

                  {/* Quick Date Range Switcher Pills */}
                  <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-bold text-slate-400 mr-1 uppercase">Date:</span>
                      {[
                        { id: 'today', label: 'Today' },
                        { id: 'yesterday', label: 'Yesterday' },
                        { id: '7days', label: 'Last 7 Days' },
                        { id: 'month', label: 'This Month' }
                      ].map(btn => (
                        <button
                          key={btn.id}
                          type="button"
                          onClick={() => applyPreset(btn.id as PresetRange)}
                          className={`px-3 py-1 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                            timePreset === btn.id
                              ? 'bg-slate-900 text-white dark:bg-lime-500 dark:text-slate-950 font-black'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                          }`}
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>

                    <div className="text-xs font-bold text-slate-500 dark:text-slate-400 flex items-center gap-2">
                      <Calendar size={14} className="text-slate-400" />
                      <span>{formatDate(dateRange.start)} {dateRange.start !== dateRange.end && `to ${formatDate(dateRange.end)}`}</span>
                    </div>
                  </div>
                </div>

                {/* --- 6 BUSINESS PILLARS (EXECUTIVE SUMMARY) --- */}
                {dayBookViewMode === 'simple' && (
                  <div className="space-y-6 animate-in fade-in duration-200">
                    
                    {/* PILLAR 1: MILK RECONCILIATION */}
                    <div className="bg-gradient-to-br from-sky-50/70 via-white to-sky-50/40 dark:from-sky-950/20 dark:via-slate-900 dark:to-sky-950/10 rounded-3xl border border-sky-200 dark:border-sky-800/60 p-4 sm:p-6 shadow-xs">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-sky-100 dark:border-sky-900/50">
                        <div className="flex items-center gap-3">
                          <span className="w-10 h-10 rounded-2xl bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center font-bold shrink-0">
                            <Droplets size={22} />
                          </span>
                          <div>
                            <h4 className="font-black text-base sm:text-lg text-slate-900 dark:text-white flex items-center gap-2">
                              1. Milk Reconciliation (Procurement &amp; Usage)
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300">
                                Litres
                              </span>
                            </h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Total milk received, counter sales, factory production usage, and closing chiller stock
                            </p>
                          </div>
                        </div>

                        <div className="text-right sm:text-right">
                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Total Milk Cost</span>
                          <span className="text-base sm:text-lg font-black font-mono text-sky-600 dark:text-sky-400">
                            {formatCurrency(dayBookData.milk.totalMilkInCost)}
                          </span>
                        </div>
                      </div>

                      {/* 5-Step Flow Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
                        {/* 1. Intake */}
                        <div className="rounded-2xl p-3 bg-white dark:bg-slate-800/80 border border-sky-100 dark:border-sky-900/40">
                          <span className="text-[10px] font-black text-sky-600 dark:text-sky-400 uppercase tracking-wider block">
                            🟢 Total Milk Received
                          </span>
                          <p className="text-lg sm:text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
                            {dayBookData.milk.totalMilkInLitres.toFixed(1)} <span className="text-xs font-bold text-slate-400">L</span>
                          </p>
                          <span className="text-[10px] text-slate-400 mt-0.5 block">
                            Cow: {dayBookData.milk.cowLitresIn.toFixed(1)}L • Buffalo: {dayBookData.milk.buffaloLitresIn.toFixed(1)}L
                          </span>
                        </div>

                        {/* 2. Counter Sales */}
                        <div className="rounded-2xl p-3 bg-white dark:bg-slate-800/80 border border-sky-100 dark:border-sky-900/40">
                          <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
                            🟡 Counter Sales
                          </span>
                          <p className="text-lg sm:text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
                            {dayBookData.milk.counterMilkLitres.toFixed(1)} <span className="text-xs font-bold text-slate-400">L</span>
                          </p>
                          <span className="text-[10px] text-emerald-600 font-bold mt-0.5 block font-mono">
                            Revenue: {formatCurrency(dayBookData.milk.counterMilkRevenue)}
                          </span>
                        </div>

                        {/* 3. Production */}
                        <div className="rounded-2xl p-3 bg-white dark:bg-slate-800/80 border border-sky-100 dark:border-sky-900/40">
                          <span className="text-[10px] font-black text-purple-600 dark:text-purple-400 uppercase tracking-wider block">
                            🔵 Factory &amp; Production
                          </span>
                          <p className="text-lg sm:text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
                            {dayBookData.milk.productionMilkLitres.toFixed(1)} <span className="text-xs font-bold text-slate-400">L</span>
                          </p>
                          <span className="text-[10px] text-slate-400 mt-0.5 block">
                            {dayBookData.milk.productionBatchesSummary.length} Batches Processed
                          </span>
                        </div>

                        {/* 4. Home Delivery */}
                        <div className="rounded-2xl p-3 bg-white dark:bg-slate-800/80 border border-sky-100 dark:border-sky-900/40">
                          <span className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-wider block">
                            🟣 Home Delivery Supply
                          </span>
                          <p className="text-lg sm:text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
                            {dayBookData.milk.supplyMilkLitres.toFixed(1)} <span className="text-xs font-bold text-slate-400">L</span>
                          </p>
                          <span className="text-[10px] text-slate-400 mt-0.5 block font-mono">
                            Revenue: {formatCurrency(dayBookData.milk.supplyMilkRevenue)}
                          </span>
                        </div>

                        {/* 5. Closing Milk */}
                        <div className="rounded-2xl p-3 bg-white dark:bg-slate-800/80 border border-sky-100 dark:border-sky-900/40 col-span-2 sm:col-span-1">
                          <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-wider block">
                            🏁 Closing Chiller Stock
                          </span>
                          <p className="text-lg sm:text-xl font-black font-mono text-blue-600 dark:text-blue-400 mt-1">
                            {dayBookData.milk.liveTotalMilkStock.toFixed(1)} <span className="text-xs font-bold text-slate-400">L</span>
                          </p>
                          <span className="text-[10px] text-slate-400 mt-0.5 block">
                            Cow: {dayBookData.milk.liveCowStock.toFixed(1)}L • Buffalo: {dayBookData.milk.liveBuffStock.toFixed(1)}L
                          </span>
                        </div>
                      </div>

                      {/* Formula Ribbon */}
                      <div className="mt-3 p-3 bg-sky-500/10 dark:bg-sky-950/40 rounded-2xl border border-sky-200/60 dark:border-sky-800/40 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-300">
                          <span className="font-mono bg-white dark:bg-slate-800 px-2 py-0.5 rounded-lg border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300">
                            Reconciliation Formula:
                          </span>
                          <span>
                            Received ({dayBookData.milk.totalMilkInLitres.toFixed(1)} L) &minus; Counter Sales ({dayBookData.milk.counterMilkLitres.toFixed(1)} L) &minus; Factory Usage ({dayBookData.milk.productionMilkLitres.toFixed(1)} L) = Net for Period ({(dayBookData.milk.totalMilkInLitres - dayBookData.milk.counterMilkLitres - dayBookData.milk.productionMilkLitres).toFixed(1)} L)
                          </span>
                        </div>
                        {dayBookData.milk.milkSuppliersList.length > 0 && (
                          <span className="text-[11px] text-slate-500">
                            {dayBookData.milk.milkSuppliersList.length} Suppliers provided milk today
                          </span>
                        )}
                      </div>

                      {/* Supplier List Accordion Chips */}
                      {dayBookData.milk.milkSuppliersList.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {dayBookData.milk.milkSuppliersList.map((s, idx) => (
                            <div key={idx} className="bg-white dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs flex items-center gap-2">
                              <span className="font-bold text-slate-800 dark:text-slate-200">{s.name}:</span>
                              <span className="font-mono text-sky-600 font-bold">{s.totalL.toFixed(1)} L</span>
                              <span className="text-slate-400 text-[11px] font-mono">({formatCurrency(s.totalAmt)})</span>
                              {s.paidAmt > 0 && (
                                <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                                  Paid Cash: {formatCurrency(s.paidAmt)}
                                </span>
                              )}
                              {s.dueAmt > 0 && (
                                <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                                  Pending Due: {formatCurrency(s.dueAmt)}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 2-COLUMN SPLIT: REVENUE INFLOWS & OPERATING OUTFLOWS */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      
                      {/* PILLAR 2: REVENUE INFLOWS */}
                      <div className="bg-gradient-to-br from-emerald-50/70 via-white to-emerald-50/40 dark:from-emerald-950/20 dark:via-slate-900 dark:to-emerald-950/10 rounded-3xl border border-emerald-200 dark:border-emerald-800/60 p-4 sm:p-6 shadow-xs flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between pb-3 border-b border-emerald-100 dark:border-emerald-900/50">
                            <div className="flex items-center gap-3">
                              <span className="w-10 h-10 rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold shrink-0">
                                <ArrowDownLeft size={22} />
                              </span>
                              <div>
                                <h4 className="font-black text-base sm:text-lg text-slate-900 dark:text-white">
                                  2. Revenue &amp; Cash Inflows
                                </h4>
                                <p className="text-xs text-slate-500">Counter cash sales, online payments, and customer credit recovery</p>
                              </div>
                            </div>
                            <span className="text-base sm:text-xl font-mono font-black text-emerald-600 dark:text-emerald-400">
                              +{formatCurrency(dayBookData.inflows.totalAllInflows)}
                            </span>
                          </div>

                          <div className="divide-y divide-emerald-100 dark:divide-emerald-900/40 text-xs sm:text-sm mt-3">
                            <div className="py-2.5 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                <span className="font-bold text-slate-700 dark:text-slate-200">Counter Cash Sales</span>
                                <span className="text-[11px] text-slate-400 font-mono">({dayBookData.inflows.posCashBillsCount} Bills)</span>
                              </div>
                              <span className="font-mono font-black text-emerald-600 dark:text-emerald-400">
                                +{formatCurrency(dayBookData.inflows.posCashSales)}
                              </span>
                            </div>

                            <div className="py-2.5 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                <span className="font-bold text-slate-700 dark:text-slate-200">Online &amp; Digital Payments</span>
                                <span className="text-[11px] text-slate-400 font-mono">({dayBookData.inflows.posOnlineBillsCount} Bills)</span>
                              </div>
                              <span className="font-mono font-black text-blue-600 dark:text-blue-400">
                                +{formatCurrency(dayBookData.inflows.posOnlineSales)}
                              </span>
                            </div>

                            <div className="py-2.5 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                <span className="font-bold text-slate-700 dark:text-slate-200">Customer Debt Collections</span>
                                <span className="text-[11px] text-slate-400 font-mono">({dayBookData.inflows.customerCollectionsList.length} Receipts)</span>
                              </div>
                              <span className="font-mono font-black text-amber-600 dark:text-amber-400">
                                +{formatCurrency(dayBookData.inflows.customerCollections)}
                              </span>
                            </div>

                            {dayBookData.milk.supplyMilkRevenue > 0 && (
                              <div className="py-2.5 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                                  <span className="font-bold text-slate-700 dark:text-slate-200">Home Delivery Cash Collected</span>
                                </div>
                                <span className="font-mono font-black text-purple-600 dark:text-purple-400">
                                  +{formatCurrency(dayBookData.milk.supplyMilkRevenue)}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Customer collections pill list */}
                          {dayBookData.inflows.customerCollectionsList.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-emerald-100 dark:border-emerald-900/40">
                              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">
                                Collected Customer Dues:
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {dayBookData.inflows.customerCollectionsList.map((c, i) => (
                                  <span key={i} className="inline-flex items-center gap-1 bg-white dark:bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300">
                                    {c.customerName}: <b className="text-emerald-600">+{formatCurrency(c.amount)}</b>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="mt-4 pt-3 border-t-2 border-emerald-200 dark:border-emerald-800 flex justify-between items-center font-black">
                          <span className="text-xs uppercase tracking-wider text-slate-600 dark:text-slate-300">Total Revenue Inflows</span>
                          <span className="text-base sm:text-lg font-mono text-emerald-700 dark:text-emerald-300">
                            +{formatCurrency(dayBookData.inflows.totalAllInflows)}
                          </span>
                        </div>
                      </div>

                      {/* PILLAR 3: OPERATING OUTFLOWS */}
                      <div className="bg-gradient-to-br from-rose-50/70 via-white to-rose-50/40 dark:from-rose-950/20 dark:via-slate-900 dark:to-rose-950/10 rounded-3xl border border-rose-200 dark:border-rose-800/60 p-4 sm:p-6 shadow-xs flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between pb-3 border-b border-rose-100 dark:border-rose-900/50">
                            <div className="flex items-center gap-3">
                              <span className="w-10 h-10 rounded-2xl bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold shrink-0">
                                <ArrowUpRight size={22} />
                              </span>
                              <div>
                                <h4 className="font-black text-base sm:text-lg text-slate-900 dark:text-white">
                                  3. Operating Outflows &amp; Expenses
                                </h4>
                                <p className="text-xs text-slate-500">Spot milk payments, operating expenses, and material procurement</p>
                              </div>
                            </div>
                            <span className="text-base sm:text-xl font-mono font-black text-rose-600 dark:text-rose-400">
                              -{formatCurrency(dayBookData.outflows.totalCashOutflow)}
                            </span>
                          </div>

                          <div className="divide-y divide-rose-100 dark:divide-rose-900/40 text-xs sm:text-sm mt-3">
                            <div className="py-2.5 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                                <span className="font-bold text-slate-700 dark:text-slate-200">Spot Milk Purchases (Cash Paid)</span>
                              </div>
                              <span className="font-mono font-black text-rose-600 dark:text-rose-400">
                                -{formatCurrency(dayBookData.outflows.spotMilkPaid)}
                              </span>
                            </div>

                            <div className="py-2.5 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                                <span className="font-bold text-slate-700 dark:text-slate-200">Operating Overheads &amp; Daily Expenses</span>
                                <span className="text-[11px] text-slate-400 font-mono">({dayBookData.outflows.expensesByCategory.reduce((s, c) => s + c.count, 0)} Items)</span>
                              </div>
                              <span className="font-mono font-black text-rose-600 dark:text-rose-400">
                                -{formatCurrency(dayBookData.outflows.totalExpenses)}
                              </span>
                            </div>

                            {dayBookData.outflows.otherSupplierPayments > 0 && (
                              <div className="py-2.5 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                  <span className="font-bold text-slate-700 dark:text-slate-200">Supplier Dues Paid</span>
                                </div>
                                <span className="font-mono font-black text-rose-600 dark:text-rose-400">
                                  -{formatCurrency(dayBookData.outflows.otherSupplierPayments)}
                                </span>
                              </div>
                            )}

                            {dayBookData.outflows.materialCashPaid > 0 && (
                              <div className="py-2.5 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                                  <span className="font-bold text-slate-700 dark:text-slate-200">Packaging &amp; Material Procurement</span>
                                </div>
                                <span className="font-mono font-black text-rose-600 dark:text-rose-400">
                                  -{formatCurrency(dayBookData.outflows.materialCashPaid)}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Itemized expense categories chips */}
                          {dayBookData.outflows.expensesByCategory.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-rose-100 dark:border-rose-900/40">
                              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">
                                Categorized Expenses:
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {dayBookData.outflows.expensesByCategory.map((c, i) => (
                                  <span key={i} className="inline-flex items-center gap-1 bg-white dark:bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300">
                                    {c.category}: <b className="text-rose-600">-{formatCurrency(c.amount)}</b>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="mt-4 pt-3 border-t-2 border-rose-200 dark:border-rose-800 flex justify-between items-center font-black">
                          <span className="text-xs uppercase tracking-wider text-slate-600 dark:text-slate-300">Total Operating Outflows</span>
                          <span className="text-base sm:text-lg font-mono text-rose-700 dark:text-rose-300">
                            -{formatCurrency(dayBookData.outflows.totalCashOutflow)}
                          </span>
                        </div>
                      </div>

                    </div>

                    {/* 2-COLUMN SPLIT: CREDIT LEDGER & CASH DRAWER RECONCILIATION */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      
                      {/* PILLAR 4: CREDIT LEDGER */}
                      <div className="bg-gradient-to-br from-amber-50/70 via-white to-amber-50/40 dark:from-amber-950/20 dark:via-slate-900 dark:to-amber-950/10 rounded-3xl border border-amber-200 dark:border-amber-800/60 p-4 sm:p-6 shadow-xs flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between pb-3 border-b border-amber-100 dark:border-amber-900/50">
                            <div className="flex items-center gap-3">
                              <span className="w-10 h-10 rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold shrink-0">
                                <Receipt size={22} />
                              </span>
                              <div>
                                <h4 className="font-black text-base sm:text-lg text-slate-900 dark:text-white">
                                  4. Credit &amp; Working Capital Ledger
                                </h4>
                                <p className="text-xs text-slate-500">New customer credit extended vs accrued supplier milk payables</p>
                              </div>
                            </div>
                            <span className="text-xs font-black uppercase px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                              Credit Activity
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                            {/* Customers Credit Given */}
                            <div className="rounded-2xl p-3 bg-white dark:bg-slate-800/80 border border-amber-100 dark:border-amber-900/40">
                              <span className="text-[10px] font-black text-amber-700 dark:text-amber-300 uppercase tracking-wider block">
                                🟠 Customer Credit Extended
                              </span>
                              <p className="text-lg font-black font-mono text-amber-700 dark:text-amber-400 mt-1">
                                {formatCurrency(dayBookData.credit.posCreditSales)}
                              </p>
                              <span className="text-[10px] text-slate-400 mt-0.5 block font-mono">
                                {dayBookData.credit.creditCustomersList.length} Bills on Credit
                              </span>

                              {dayBookData.credit.creditCustomersList.length > 0 && (
                                <div className="mt-2 space-y-1 pt-2 border-t border-slate-100 dark:border-slate-700">
                                  {dayBookData.credit.creditCustomersList.map((c, i) => (
                                    <div key={i} className="flex justify-between text-[11px]">
                                      <span className="font-semibold text-slate-700 dark:text-slate-300 truncate">{c.customerName}</span>
                                      <span className="font-mono font-bold text-amber-600">{formatCurrency(c.amount)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Suppliers Accrued */}
                            <div className="rounded-2xl p-3 bg-white dark:bg-slate-800/80 border border-amber-100 dark:border-amber-900/40">
                              <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-wider block">
                                🔵 New Supplier Milk Payable Accrued
                              </span>
                              <p className="text-lg font-black font-mono text-blue-600 dark:text-blue-400 mt-1">
                                {formatCurrency(dayBookData.credit.milkAccruedCredit)}
                              </p>
                              <span className="text-[10px] text-slate-400 mt-0.5 block">
                                Milk purchases pending payment
                              </span>

                              <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700 text-[11px] flex justify-between">
                                <span className="font-bold text-slate-500">Debt Collections:</span>
                                <span className="font-mono font-bold text-emerald-600">+{formatCurrency(dayBookData.credit.customerCollections)}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-2xl border border-amber-200/60 dark:border-amber-900/40 text-xs flex items-center justify-between font-bold">
                          <span className="text-amber-800 dark:text-amber-300">Net Customer Credit Change:</span>
                          <span className="font-mono text-amber-900 dark:text-amber-200 font-black">
                            {dayBookData.credit.posCreditSales - dayBookData.credit.customerCollections >= 0 ? '+' : ''}
                            {formatCurrency(dayBookData.credit.posCreditSales - dayBookData.credit.customerCollections)}
                          </span>
                        </div>
                      </div>

                      {/* PILLAR 5: CASH DRAWER RECONCILIATION */}
                      <div className="bg-gradient-to-br from-indigo-50/70 via-white to-indigo-50/40 dark:from-indigo-950/20 dark:via-slate-900 dark:to-indigo-950/10 rounded-3xl border border-indigo-200 dark:border-indigo-800/60 p-4 sm:p-6 shadow-xs flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between pb-3 border-b border-indigo-100 dark:border-indigo-900/50">
                            <div className="flex items-center gap-3">
                              <span className="w-10 h-10 rounded-2xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold shrink-0">
                                <Banknote size={22} />
                              </span>
                              <div>
                                <h4 className="font-black text-base sm:text-lg text-slate-900 dark:text-white">
                                  5. Cash Drawer &amp; Float Reconciliation
                                </h4>
                                <p className="text-xs text-slate-500">Opening float, net cash movement, and closing drawer balance</p>
                              </div>
                            </div>

                            <span className="text-xs font-black uppercase px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 flex items-center gap-1">
                              <CheckCircle2 size={13} />
                              <span>Zero Drift</span>
                            </span>
                          </div>

                          {/* Step-by-Step Drawer Math */}
                          <div className="divide-y divide-indigo-100 dark:divide-indigo-900/40 text-xs sm:text-sm mt-3">
                            <div className="py-2 flex items-center justify-between">
                              <span className="font-bold text-slate-600 dark:text-slate-300">Opening Drawer Float</span>
                              <span className="font-mono font-bold text-slate-800 dark:text-white">{formatCurrency(dayBookData.drawer.shiftOpeningFloat)}</span>
                            </div>
                            <div className="py-2 flex items-center justify-between">
                              <span className="font-bold text-emerald-600 dark:text-emerald-400">(+) Cash Inflows (Sales &amp; Collections)</span>
                              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">+{formatCurrency(dayBookData.inflows.totalCashInflow)}</span>
                            </div>
                            <div className="py-2 flex items-center justify-between">
                              <span className="font-bold text-rose-600 dark:text-rose-400">(&minus;) Cash Outflows (Spot Milk &amp; Expenses)</span>
                              <span className="font-mono font-bold text-rose-600 dark:text-rose-400">-{formatCurrency(dayBookData.outflows.totalCashOutflow)}</span>
                            </div>
                            <div className="py-2.5 flex items-center justify-between bg-indigo-50/50 dark:bg-indigo-950/30 px-2 rounded-xl">
                              <span className="font-black text-indigo-900 dark:text-indigo-200">(=) Expected Till Balance</span>
                              <span className="font-mono font-black text-base text-indigo-700 dark:text-indigo-300">
                                {formatCurrency(dayBookData.drawer.expectedClosingCash)}
                              </span>
                            </div>
                          </div>

                          {/* Live Account Balances */}
                          <div className="mt-3 pt-3 border-t border-indigo-100 dark:border-indigo-900/40 grid grid-cols-3 gap-2 text-center">
                            <div className="bg-white dark:bg-slate-800 p-2 rounded-xl border border-slate-200 dark:border-slate-700">
                              <span className="text-[10px] uppercase font-bold text-slate-400 block">Counter Cash</span>
                              <span className="font-mono font-black text-xs text-slate-800 dark:text-white mt-0.5 block">
                                {formatCurrency(dayBookData.drawer.counterBalance)}
                              </span>
                            </div>
                            <div className="bg-white dark:bg-slate-800 p-2 rounded-xl border border-slate-200 dark:border-slate-700">
                              <span className="text-[10px] uppercase font-bold text-slate-400 block">Safe (In Hand)</span>
                              <span className="font-mono font-black text-xs text-slate-800 dark:text-white mt-0.5 block">
                                {formatCurrency(dayBookData.drawer.cashInHandBalance)}
                              </span>
                            </div>
                            <div className="bg-white dark:bg-slate-800 p-2 rounded-xl border border-slate-200 dark:border-slate-700">
                              <span className="text-[10px] uppercase font-bold text-slate-400 block">Bank &amp; Digital</span>
                              <span className="font-mono font-black text-xs text-slate-800 dark:text-white mt-0.5 block">
                                {formatCurrency(dayBookData.drawer.bankBalance)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 text-[11px] text-slate-400 text-center">
                          Counter Cash drawer and handover records are reconciled.
                        </div>
                      </div>

                    </div>

                    {/* PILLAR 6: DAILY SALES & ESTIMATED PROFIT */}
                    <div className="bg-gradient-to-br from-emerald-500/10 via-white to-lime-500/10 dark:from-emerald-950/30 dark:via-slate-900 dark:to-lime-950/20 rounded-3xl border border-lime-300 dark:border-lime-800/60 p-4 sm:p-6 shadow-xs">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-lime-200/60 dark:border-lime-900/40">
                        <div className="flex items-center gap-3">
                          <span className="w-10 h-10 rounded-2xl bg-lime-500/20 text-lime-700 dark:text-lime-300 flex items-center justify-center font-bold shrink-0">
                            <Sparkles size={22} />
                          </span>
                          <div>
                            <h4 className="font-black text-base sm:text-lg text-slate-900 dark:text-white">
                              6. Daily Sales &amp; Estimated Profit
                            </h4>
                            <p className="text-xs text-slate-500">Gross revenue minus cost of goods sold and operating overheads</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Estimated Net Profit</span>
                            <span className="text-xl sm:text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                              +{formatCurrency(dayBookData.profit.estimatedNetProfit)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Profit Math Cards */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                        <div className="bg-white dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700">
                          <span className="text-[10px] font-black uppercase text-slate-400 block">Gross Revenue</span>
                          <span className="text-base sm:text-lg font-mono font-black text-slate-900 dark:text-white mt-1 block">
                            {formatCurrency(dayBookData.profit.totalRevenue)}
                          </span>
                          <span className="text-[10px] text-slate-400">{dayBookData.inflows.totalSalesCount} Bills Completed</span>
                        </div>

                        <div className="bg-white dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700">
                          <span className="text-[10px] font-black uppercase text-rose-500 block">(&minus;) Cost of Goods Sold</span>
                          <span className="text-base sm:text-lg font-mono font-black text-rose-600 mt-1 block">
                            -{formatCurrency(dayBookData.profit.estimatedCOGS)}
                          </span>
                          <span className="text-[10px] text-slate-400">Milk &amp; Materials</span>
                        </div>

                        <div className="bg-white dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700">
                          <span className="text-[10px] font-black uppercase text-rose-500 block">(&minus;) Operating Expenses</span>
                          <span className="text-base sm:text-lg font-mono font-black text-rose-600 mt-1 block">
                            -{formatCurrency(dayBookData.profit.totalExpenses)}
                          </span>
                          <span className="text-[10px] text-slate-400">Daily Overheads</span>
                        </div>

                        <div className="bg-lime-500/15 dark:bg-lime-950/50 p-3 rounded-2xl border border-lime-300 dark:border-lime-800">
                          <span className="text-[10px] font-black uppercase text-lime-700 dark:text-lime-300 block">(=) Estimated Net Profit</span>
                          <span className="text-base sm:text-lg font-mono font-black text-lime-700 dark:text-lime-300 mt-1 block">
                            +{formatCurrency(dayBookData.profit.estimatedNetProfit)}
                          </span>
                          <span className="text-[10px] text-lime-600 dark:text-lime-400 font-bold">Estimated Net Margin</span>
                        </div>
                      </div>

                      {/* Products Sold Table */}
                      {dayBookData.profit.productSalesList.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                          <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-2">
                            Product Sales Breakdown:
                          </span>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                            {dayBookData.profit.productSalesList.map((p, idx) => (
                              <div key={idx} className="bg-white dark:bg-slate-800 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                                <div>
                                  <p className="font-bold text-xs text-slate-900 dark:text-white truncate max-w-[130px]">{p.name}</p>
                                  <p className="text-[11px] text-slate-400 font-mono mt-0.5">{p.qty.toFixed(2)} {p.unit}</p>
                                </div>
                                <span className="font-mono font-black text-xs text-emerald-600 dark:text-emerald-400">
                                  {formatCurrency(p.revenue)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                  </div>
                )}

                {/* --- ITEMIZED TRANSACTION JOURNAL TABLE --- */}
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                    <div>
                      <h4 className="font-black text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                        <FileText size={18} className="text-lime-600" />
                        Itemized Transaction Journal ({dayBookData.entries.length} Events)
                      </h4>
                      <p className="text-xs text-slate-400">
                        Chronological audit trail of all transactions with timestamps and parties
                      </p>
                    </div>

                    {/* Filter Pills */}
                    <div className="flex flex-wrap items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl border border-slate-200 dark:border-slate-700">
                      {[
                        { id: 'all', label: 'All Activities' },
                        { id: 'Income', label: '🟢 Inflows' },
                        { id: 'Expense', label: '🔴 Outflows' },
                        { id: 'Milk', label: '🥛 Milk Procurement' },
                        { id: 'Credit', label: '📒 Credit & Dues' }
                      ].map(f => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setDayBookFilterCategory(f.id as any)}
                          className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                            dayBookFilterCategory === f.id
                              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white font-black shadow-xs'
                              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Table */}
                  <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-black uppercase text-[11px] border-b border-slate-200 dark:border-slate-700">
                          <tr>
                            <th className="px-4 py-3">Date / Time</th>
                            <th className="px-4 py-3">Transaction Description</th>
                            <th className="px-4 py-3">Party / Customer / Supplier</th>
                            <th className="px-4 py-3">Category</th>
                            <th className="px-4 py-3 text-right text-emerald-600">Money In (+)</th>
                            <th className="px-4 py-3 text-right text-red-600">Money Out (-)</th>
                            <th className="px-4 py-3 text-right">Running Balance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {dayBookData.entries.map((row, idx) => (
                            <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                              <td className="px-4 py-2.5 whitespace-nowrap font-medium text-slate-500 dark:text-slate-400">
                                {formatDate(row.date)}
                              </td>
                              <td className="px-4 py-2.5 font-bold text-slate-800 dark:text-slate-200">
                                {row.desc}
                              </td>
                              <td className="px-4 py-2.5 font-semibold text-slate-600 dark:text-slate-300">
                                {row.party || '—'}
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                                  row.group === 'Income' 
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800' 
                                    : row.group === 'Milk'
                                    ? 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:border-sky-800'
                                    : row.group === 'Credit'
                                    ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800'
                                    : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:border-red-800'
                                }`}>
                                  {row.category}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-600">
                                {row.inflow > 0 ? `+${formatCurrency(row.inflow)}` : '-'}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono font-bold text-red-600">
                                {row.outflow > 0 ? `-${formatCurrency(row.outflow)}` : '-'}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-700 dark:text-slate-300">
                                {formatCurrency(row.runningBalance)}
                              </td>
                            </tr>
                          ))}
                          {dayBookData.entries.length === 0 && (
                            <tr>
                              <td colSpan={7} className="py-12 text-center text-slate-400">
                                No financial transactions recorded for this period.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* --- DAILY CLOSING PRINT & PDF EXPORT STUDIO --- */}
                {isDayBookSlipModalOpen && (
                  <div className="fixed inset-0 z-[150] flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150">
                    <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs" onClick={() => setIsDayBookSlipModalOpen(false)} />
                    <div className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-5xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[94vh] animate-in zoom-in-95 duration-200">
                      
                      {/* Modal Header & Format Switcher */}
                      <div className="p-3 sm:p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-slate-850 shrink-0">
                        <div className="flex items-center gap-3">
                          <span className="w-9 h-9 rounded-2xl bg-lime-500/15 text-lime-600 dark:text-lime-400 flex items-center justify-center font-bold shrink-0">
                            <Printer size={18} />
                          </span>
                          <div>
                            <h4 className="font-black text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                              Print &amp; PDF Export Studio
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-lime-100 dark:bg-lime-950/60 text-lime-800 dark:text-lime-300">
                                Vector Sharp
                              </span>
                            </h4>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              Format for executive A4 PDF filing or compact 80mm thermal receipt roll
                            </p>
                          </div>
                        </div>

                        {/* Format Pills & Action Buttons */}
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Format Switcher */}
                          <div className="bg-slate-200/80 dark:bg-slate-800 p-0.5 rounded-xl flex items-center">
                            <button
                              type="button"
                              onClick={() => setDayBookPrintFormat('a4')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                                dayBookPrintFormat === 'a4'
                                  ? 'bg-slate-900 text-white dark:bg-lime-500 dark:text-slate-950 shadow-xs'
                                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                              }`}
                            >
                              <FileText size={13} />
                              <span>Executive A4 (PDF)</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDayBookPrintFormat('thermal')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                                dayBookPrintFormat === 'thermal'
                                  ? 'bg-slate-900 text-white dark:bg-lime-500 dark:text-slate-950 shadow-xs'
                                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                              }`}
                            >
                              <Receipt size={13} />
                              <span>Thermal Slip (80mm)</span>
                            </button>
                          </div>

                          {/* WhatsApp Copy */}
                          <button
                            type="button"
                            onClick={copyWhatsAppSummary}
                            className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                            title="Copy formatted summary to paste in WhatsApp"
                          >
                            {isWhatsAppCopied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                            <span>{isWhatsAppCopied ? 'Copied!' : 'WhatsApp Copy'}</span>
                          </button>

                          {/* Download PDF Direct */}
                          <button
                            type="button"
                            onClick={downloadDayBookPDF}
                            disabled={isGeneratingPDF}
                            className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-950 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-sm hover:shadow-md cursor-pointer disabled:opacity-50"
                            title="Directly download high-resolution PDF file"
                          >
                            {isGeneratingPDF ? <Loader2 size={13} className="animate-spin text-lime-400" /> : <FileDown size={13} />}
                            <span>{isGeneratingPDF ? 'Generating...' : 'Download PDF'}</span>
                          </button>

                          {/* Print / Save PDF */}
                          <button
                            type="button"
                            onClick={() => printDayBookDocument(dayBookPrintFormat)}
                            className="px-3.5 py-1.5 bg-lime-500 hover:bg-lime-400 text-slate-950 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-sm hover:shadow-md cursor-pointer"
                            title="Open native browser print and PDF export dialog"
                          >
                            <Printer size={13} />
                            <span>Print</span>
                          </button>

                          {/* Close */}
                          <button
                            type="button"
                            onClick={() => setIsDayBookSlipModalOpen(false)}
                            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <X size={18} />
                          </button>
                        </div>
                      </div>

                      {/* Section Customization Toolbar (for A4 mode) */}
                      {dayBookPrintFormat === 'a4' && (
                        <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
                          <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                            <SlidersHorizontal size={13} />
                            <span className="font-bold text-slate-700 dark:text-slate-300">Sections Included:</span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setPrintIncludeSuppliers(!printIncludeSuppliers)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                                printIncludeSuppliers 
                                  ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800' 
                                  : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              {printIncludeSuppliers ? <CheckSquare size={13} /> : <Square size={13} />}
                              <span>Supplier Milk Roster</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setPrintIncludeExpenses(!printIncludeExpenses)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                                printIncludeExpenses 
                                  ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800' 
                                  : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              {printIncludeExpenses ? <CheckSquare size={13} /> : <Square size={13} />}
                              <span>Itemized Overheads</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setPrintIncludeProducts(!printIncludeProducts)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                                printIncludeProducts 
                                  ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' 
                                  : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              {printIncludeProducts ? <CheckSquare size={13} /> : <Square size={13} />}
                              <span>Top Products</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setPrintIncludeSignatures(!printIncludeSignatures)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                                printIncludeSignatures 
                                  ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800' 
                                  : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              {printIncludeSignatures ? <CheckSquare size={13} /> : <Square size={13} />}
                              <span>Audit Signatures</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Live Realistic Preview Canvas */}
                      <div className="flex-1 overflow-y-auto bg-slate-200/60 dark:bg-slate-950/90 p-3 sm:p-6 flex justify-center">
                        
                        {/* --- FORMAT A: EXECUTIVE A4 DOCUMENT PREVIEW --- */}
                        {dayBookPrintFormat === 'a4' && (
                          <div id="daybook-a4-preview" className="mooco-print-surface w-full max-w-4xl bg-white text-slate-900 shadow-2xl rounded-sm p-6 sm:p-10 border border-slate-200 font-sans text-xs select-text space-y-5 animate-in fade-in duration-200">
                            
                            {/* Document Letterhead */}
                            <div className="border-b-2 border-slate-900 pb-3 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-2">
                              <div>
                                <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-slate-950">
                                  {settings?.general?.companyName || 'MOOCO DAIRY FARM & SWEETS'}
                                </h1>
                                <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mt-0.5">
                                  Daily Executive Closing &amp; Reconciliation Audit
                                </p>
                                <p className="text-[11px] text-slate-400 mt-1">
                                  {settings?.general?.address || 'Main Dairy Unit'} &bull; Phone: {settings?.general?.phone || '+92 300 0000000'}
                                </p>
                              </div>
                              <div className="text-left sm:text-right text-[11px] text-slate-600 space-y-0.5">
                                <p><span className="font-bold text-slate-800">Audit Date:</span> {formatDate(dateRange.start)} {dateRange.start !== dateRange.end && `to ${formatDate(dateRange.end)}`}</p>
                                <p><span className="font-bold text-slate-800">Generated:</span> {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                <p><span className="font-bold text-slate-800">Auditor:</span> {currentUser?.name || 'Administrator'}</p>
                                <span className="inline-block mt-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold uppercase">
                                  Audited &amp; Reconciled
                                </span>
                              </div>
                            </div>

                            {/* Executive KPI Summary Bar */}
                            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                              <div className="bg-sky-50/70 border border-sky-200 rounded-lg p-2.5">
                                <span className="text-[10px] font-bold text-sky-800 uppercase block">Milk Received</span>
                                <span className="text-base font-black font-mono text-sky-700 block mt-0.5">
                                  {dayBookData.milk.totalMilkInLitres.toFixed(1)} L
                                </span>
                                <span className="text-[9px] text-slate-500 font-mono">Cost: {formatCurrency(Math.round(dayBookData.milk.totalMilkInCost))}</span>
                              </div>

                              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                                <span className="text-[10px] font-bold text-slate-600 uppercase block">Gross Sales</span>
                                <span className="text-base font-black font-mono text-slate-900 block mt-0.5">
                                  {formatCurrency(Math.round(dayBookData.profit.totalRevenue))}
                                </span>
                                <span className="text-[9px] text-slate-500">{dayBookData.inflows.totalSalesCount} Invoices</span>
                              </div>

                              <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-2.5">
                                <span className="text-[10px] font-bold text-emerald-800 uppercase block">Total Cash Inflow</span>
                                <span className="text-base font-black font-mono text-emerald-700 block mt-0.5">
                                  +{formatCurrency(Math.round(dayBookData.inflows.totalCashInflow))}
                                </span>
                                <span className="text-[9px] text-slate-500">Sales + Debt Recv</span>
                              </div>

                              <div className="bg-rose-50/70 border border-rose-200 rounded-lg p-2.5">
                                <span className="text-[10px] font-bold text-rose-800 uppercase block">Total Cash Outflow</span>
                                <span className="text-base font-black font-mono text-rose-700 block mt-0.5">
                                  -{formatCurrency(Math.round(dayBookData.outflows.totalCashOutflow))}
                                </span>
                                <span className="text-[9px] text-slate-500">Milk + Expenses</span>
                              </div>

                              <div className="bg-indigo-50/70 border border-indigo-200 rounded-lg p-2.5">
                                <span className="text-[10px] font-bold text-indigo-800 uppercase block">Expected Drawer</span>
                                <span className="text-base font-black font-mono text-indigo-700 block mt-0.5">
                                  {formatCurrency(Math.round(dayBookData.drawer.expectedClosingCash))}
                                </span>
                                <span className="text-[9px] text-slate-500">Float: {formatCurrency(Math.round(dayBookData.drawer.shiftOpeningFloat))}</span>
                              </div>

                              <div className="bg-lime-50/70 border border-lime-200 rounded-lg p-2.5">
                                <span className="text-[10px] font-bold text-lime-800 uppercase block">Est. Net Profit</span>
                                <span className="text-base font-black font-mono text-lime-800 block mt-0.5">
                                  +{formatCurrency(Math.round(dayBookData.profit.estimatedNetProfit))}
                                </span>
                                <span className="text-[9px] text-slate-500">
                                  Margin: {dayBookData.profit.totalRevenue > 0 ? ((dayBookData.profit.estimatedNetProfit / dayBookData.profit.totalRevenue) * 100).toFixed(1) : 0}%
                                </span>
                              </div>
                            </div>

                            {/* Section 1: Milk Reconciliation */}
                            <div className="space-y-2">
                              <div className="bg-slate-100 px-3 py-1.5 rounded border-l-4 border-slate-900 font-bold text-xs uppercase flex justify-between items-center text-slate-800">
                                <span>1. Milk Procurement &amp; Inventory Reconciliation</span>
                                <span className="font-mono text-sky-700 font-black">Chiller Tank: {dayBookData.milk.liveTotalMilkStock.toFixed(1)} L</span>
                              </div>

                              <table className="w-full border-collapse border border-slate-200 text-xs">
                                <thead>
                                  <tr className="bg-slate-50 text-slate-600 text-[10px] font-bold uppercase">
                                    <th className="border border-slate-200 p-1.5 text-left">Activity / Category</th>
                                    <th className="border border-slate-200 p-1.5 text-right">Cow Milk (L)</th>
                                    <th className="border border-slate-200 p-1.5 text-right">Buffalo Milk (L)</th>
                                    <th className="border border-slate-200 p-1.5 text-right">Total Litres</th>
                                    <th className="border border-slate-200 p-1.5 text-right">Financial Impact</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr className="font-semibold bg-slate-50/50">
                                    <td className="border border-slate-200 p-1.5">Total Milk Intake (Procured)</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono">{dayBookData.milk.cowLitresIn.toFixed(1)} L</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono">{dayBookData.milk.buffaloLitresIn.toFixed(1)} L</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono font-bold text-slate-900">{dayBookData.milk.totalMilkInLitres.toFixed(1)} L</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono font-bold text-slate-900">Cost: {formatCurrency(Math.round(dayBookData.milk.totalMilkInCost))}</td>
                                  </tr>
                                  <tr>
                                    <td className="border border-slate-200 p-1.5">Counter Retail Sales</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono text-slate-400">-</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono text-slate-400">-</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono">{dayBookData.milk.counterMilkLitres.toFixed(1)} L</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono text-emerald-600 font-bold">+{formatCurrency(Math.round(dayBookData.milk.counterMilkRevenue))}</td>
                                  </tr>
                                  <tr>
                                    <td className="border border-slate-200 p-1.5">Factory &amp; Sweets Production</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono text-slate-400">-</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono text-slate-400">-</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono">{dayBookData.milk.productionMilkLitres.toFixed(1)} L</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono text-slate-500">{dayBookData.milk.productionBatchesSummary.length} Batches Processed</td>
                                  </tr>
                                  <tr>
                                    <td className="border border-slate-200 p-1.5">Home Delivery Distribution</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono text-slate-400">-</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono text-slate-400">-</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono">{dayBookData.milk.supplyMilkLitres.toFixed(1)} L</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono font-bold">+{formatCurrency(Math.round(dayBookData.milk.supplyMilkRevenue))}</td>
                                  </tr>
                                  <tr className="bg-sky-50 font-bold">
                                    <td className="border border-slate-200 p-1.5">Closing Physical Tank Inventory</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono">{dayBookData.milk.liveCowStock.toFixed(1)} L</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono">{dayBookData.milk.liveBuffStock.toFixed(1)} L</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono text-sky-700">{dayBookData.milk.liveTotalMilkStock.toFixed(1)} L</td>
                                    <td className="border border-slate-200 p-1.5 text-right font-mono text-slate-600">Verified Chiller Balance</td>
                                  </tr>
                                </tbody>
                              </table>

                              {/* Supplier Roster Table */}
                              {printIncludeSuppliers && dayBookData.milk.milkSuppliersList.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Farmer / Supplier Milk Breakdown:</span>
                                  <table className="w-full border-collapse border border-slate-200 text-[11px]">
                                    <thead>
                                      <tr className="bg-slate-50 text-slate-600 text-[9px] font-bold uppercase">
                                        <th className="border border-slate-200 p-1 text-left">Supplier</th>
                                        <th className="border border-slate-200 p-1 text-right">Cow (L)</th>
                                        <th className="border border-slate-200 p-1 text-right">Buff (L)</th>
                                        <th className="border border-slate-200 p-1 text-right">Total Litres</th>
                                        <th className="border border-slate-200 p-1 text-right">Total Payable</th>
                                        <th className="border border-slate-200 p-1 text-right">Spot Paid</th>
                                        <th className="border border-slate-200 p-1 text-right">Balance Due</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {dayBookData.milk.milkSuppliersList.map(s => (
                                        <tr key={s.name}>
                                          <td className="border border-slate-200 p-1 font-semibold">{s.name}</td>
                                          <td className="border border-slate-200 p-1 text-right font-mono">{s.cowL > 0 ? s.cowL.toFixed(1) : '-'}</td>
                                          <td className="border border-slate-200 p-1 text-right font-mono">{s.buffL > 0 ? s.buffL.toFixed(1) : '-'}</td>
                                          <td className="border border-slate-200 p-1 text-right font-mono font-bold">{s.totalL.toFixed(1)}</td>
                                          <td className="border border-slate-200 p-1 text-right font-mono">{formatCurrency(Math.round(s.totalAmt))}</td>
                                          <td className="border border-slate-200 p-1 text-right font-mono text-emerald-600">{formatCurrency(Math.round(s.paidAmt))}</td>
                                          <td className={`border border-slate-200 p-1 text-right font-mono ${s.dueAmt > 0 ? 'text-rose-600 font-bold' : ''}`}>{formatCurrency(Math.round(s.dueAmt))}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>

                            {/* Section 2 & 3: Cash Inflows vs Cash Outflows */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {/* Inflows */}
                              <div className="space-y-2">
                                <div className="bg-slate-100 px-3 py-1.5 rounded border-l-4 border-emerald-600 font-bold text-xs uppercase flex justify-between items-center text-slate-800">
                                  <span>2. Cash &amp; Revenue Inflows</span>
                                  <span className="font-mono text-emerald-600 font-black">+{formatCurrency(Math.round(dayBookData.inflows.totalAllInflows))}</span>
                                </div>
                                <table className="w-full border-collapse border border-slate-200 text-xs">
                                  <thead>
                                    <tr className="bg-slate-50 text-slate-600 text-[10px] font-bold uppercase">
                                      <th className="border border-slate-200 p-1.5 text-left">Inflow Source</th>
                                      <th className="border border-slate-200 p-1.5 text-center">Count</th>
                                      <th className="border border-slate-200 p-1.5 text-right">Amount (PKR)</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    <tr>
                                      <td className="border border-slate-200 p-1.5 font-medium">Counter Cash Sales</td>
                                      <td className="border border-slate-200 p-1.5 text-center font-mono">{dayBookData.inflows.posCashBillsCount}</td>
                                      <td className="border border-slate-200 p-1.5 text-right font-mono text-emerald-600 font-bold">+{formatCurrency(Math.round(dayBookData.inflows.posCashSales))}</td>
                                    </tr>
                                    <tr>
                                      <td className="border border-slate-200 p-1.5 font-medium">Digital / Online Sales</td>
                                      <td className="border border-slate-200 p-1.5 text-center font-mono">{dayBookData.inflows.posOnlineBillsCount}</td>
                                      <td className="border border-slate-200 p-1.5 text-right font-mono font-bold">+{formatCurrency(Math.round(dayBookData.inflows.posOnlineSales))}</td>
                                    </tr>
                                    <tr>
                                      <td className="border border-slate-200 p-1.5 font-medium">Customer Debt Recovery</td>
                                      <td className="border border-slate-200 p-1.5 text-center font-mono">{dayBookData.inflows.customerCollectionsList.length}</td>
                                      <td className="border border-slate-200 p-1.5 text-right font-mono text-emerald-600 font-bold">+{formatCurrency(Math.round(dayBookData.inflows.customerCollections))}</td>
                                    </tr>
                                    <tr className="bg-emerald-50 font-bold">
                                      <td className="border border-slate-200 p-1.5">TOTAL CASH INFLOWS</td>
                                      <td className="border border-slate-200 p-1.5 text-center font-mono">-</td>
                                      <td className="border border-slate-200 p-1.5 text-right font-mono text-emerald-700">+{formatCurrency(Math.round(dayBookData.inflows.totalCashInflow))}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>

                              {/* Outflows */}
                              <div className="space-y-2">
                                <div className="bg-slate-100 px-3 py-1.5 rounded border-l-4 border-rose-600 font-bold text-xs uppercase flex justify-between items-center text-slate-800">
                                  <span>3. Cash Outflows &amp; Expenses</span>
                                  <span className="font-mono text-rose-600 font-black">-{formatCurrency(Math.round(dayBookData.outflows.totalCashOutflow))}</span>
                                </div>
                                <table className="w-full border-collapse border border-slate-200 text-xs">
                                  <thead>
                                    <tr className="bg-slate-50 text-slate-600 text-[10px] font-bold uppercase">
                                      <th className="border border-slate-200 p-1.5 text-left">Outflow Category</th>
                                      <th className="border border-slate-200 p-1.5 text-center">Ref</th>
                                      <th className="border border-slate-200 p-1.5 text-right">Amount (PKR)</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    <tr>
                                      <td className="border border-slate-200 p-1.5 font-medium">Spot Milk Cash Paid</td>
                                      <td className="border border-slate-200 p-1.5 text-center font-mono">Spot Cash</td>
                                      <td className="border border-slate-200 p-1.5 text-right font-mono text-rose-600 font-bold">-{formatCurrency(Math.round(dayBookData.outflows.spotMilkPaid))}</td>
                                    </tr>
                                    <tr>
                                      <td className="border border-slate-200 p-1.5 font-medium">Daily Operating Overheads</td>
                                      <td className="border border-slate-200 p-1.5 text-center font-mono">{Object.values(dayBookData.outflows.expensesByCategory).reduce((s: number, c: any) => s + (c?.count || 0), 0)} Vouchers</td>
                                      <td className="border border-slate-200 p-1.5 text-right font-mono text-rose-600 font-bold">-{formatCurrency(Math.round(dayBookData.outflows.totalExpenses))}</td>
                                    </tr>
                                    {dayBookData.outflows.otherSupplierPayments > 0 && (
                                      <tr>
                                        <td className="border border-slate-200 p-1.5 font-medium">Supplier Settlements Paid</td>
                                        <td className="border border-slate-200 p-1.5 text-center font-mono">Bank/Cash</td>
                                        <td className="border border-slate-200 p-1.5 text-right font-mono text-rose-600 font-bold">-{formatCurrency(Math.round(dayBookData.outflows.otherSupplierPayments))}</td>
                                      </tr>
                                    )}
                                    {dayBookData.outflows.materialCashPaid > 0 && (
                                      <tr>
                                        <td className="border border-slate-200 p-1.5 font-medium">Packaging &amp; Material Paid</td>
                                        <td className="border border-slate-200 p-1.5 text-center font-mono">Cash</td>
                                        <td className="border border-slate-200 p-1.5 text-right font-mono text-rose-600 font-bold">-{formatCurrency(Math.round(dayBookData.outflows.materialCashPaid))}</td>
                                      </tr>
                                    )}
                                    <tr className="bg-rose-50 font-bold">
                                      <td className="border border-slate-200 p-1.5">TOTAL CASH DISBURSEMENTS</td>
                                      <td className="border border-slate-200 p-1.5 text-center font-mono">-</td>
                                      <td className="border border-slate-200 p-1.5 text-right font-mono text-rose-700">-{formatCurrency(Math.round(dayBookData.outflows.totalCashOutflow))}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </div>

                            {/* Itemized Expenses Table */}
                            {printIncludeExpenses && Object.keys(dayBookData.outflows.expensesByCategory).length > 0 && (
                              <div className="space-y-1">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Itemized Expense Categories:</span>
                                <table className="w-full border-collapse border border-slate-200 text-[11px]">
                                  <thead>
                                    <tr className="bg-slate-50 text-slate-600 text-[9px] font-bold uppercase">
                                      <th className="border border-slate-200 p-1 text-left">Category</th>
                                      <th className="border border-slate-200 p-1 text-center">Vouchers</th>
                                      <th className="border border-slate-200 p-1 text-left">Descriptions</th>
                                      <th className="border border-slate-200 p-1 text-right">Amount (PKR)</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {Object.values(dayBookData.outflows.expensesByCategory).map((c: any) => (
                                      <tr key={c.category}>
                                        <td className="border border-slate-200 p-1 font-semibold">{c.category}</td>
                                        <td className="border border-slate-200 p-1 text-center font-mono">{c.count}</td>
                                        <td className="border border-slate-200 p-1 text-slate-500">{c.items?.join(', ') || '-'}</td>
                                        <td className="border border-slate-200 p-1 text-right font-mono text-rose-600 font-bold">{formatCurrency(Math.round(c.amount))}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {/* Section 4 & 5: Credit Ledger & Cash Drawer Audit */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {/* Credit Ledger */}
                              <div className="space-y-2">
                                <div className="bg-slate-100 px-3 py-1.5 rounded border-l-4 border-purple-600 font-bold text-xs uppercase flex justify-between items-center text-slate-800">
                                  <span>4. Credit &amp; Receivables Ledger</span>
                                  <span className="text-slate-500 font-normal">Working Capital</span>
                                </div>
                                <table className="w-full border-collapse border border-slate-200 text-xs">
                                  <thead>
                                    <tr className="bg-slate-50 text-slate-600 text-[10px] font-bold uppercase">
                                      <th className="border border-slate-200 p-1.5 text-left">Credit Transaction</th>
                                      <th className="border border-slate-200 p-1.5 text-center">Reference</th>
                                      <th className="border border-slate-200 p-1.5 text-right">Amount</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    <tr>
                                      <td className="border border-slate-200 p-1.5">New Customer Credit Extended</td>
                                      <td className="border border-slate-200 p-1.5 text-center font-mono">{dayBookData.credit.posCreditBillsCount} bills</td>
                                      <td className="border border-slate-200 p-1.5 text-right font-mono text-rose-600 font-bold">{formatCurrency(Math.round(dayBookData.credit.posCreditSales))}</td>
                                    </tr>
                                    <tr>
                                      <td className="border border-slate-200 p-1.5">Customer Debt Collected</td>
                                      <td className="border border-slate-200 p-1.5 text-center font-mono">Collection / Recovery</td>
                                      <td className="border border-slate-200 p-1.5 text-right font-mono text-emerald-600 font-bold">{formatCurrency(Math.round(dayBookData.credit.customerCollections))}</td>
                                    </tr>
                                    <tr>
                                      <td className="border border-slate-200 p-1.5">Supplier Unpaid Milk Accrued</td>
                                      <td className="border border-slate-200 p-1.5 text-center font-mono">Payables added</td>
                                      <td className="border border-slate-200 p-1.5 text-right font-mono text-sky-700 font-bold">{formatCurrency(Math.round(dayBookData.credit.milkAccruedCredit))}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>

                              {/* Drawer Float Audit */}
                              <div className="space-y-2">
                                <div className="bg-slate-100 px-3 py-1.5 rounded border-l-4 border-indigo-600 font-bold text-xs uppercase flex justify-between items-center text-slate-800">
                                  <span>5. Cash Drawer &amp; Float Audit</span>
                                  <span className="font-mono text-indigo-700 font-bold">Expected: {formatCurrency(Math.round(dayBookData.drawer.expectedClosingCash))}</span>
                                </div>
                                <table className="w-full border-collapse border border-slate-200 text-xs">
                                  <tbody>
                                    <tr>
                                      <td className="border border-slate-200 p-1.5 font-medium">Morning Starting Float</td>
                                      <td className="border border-slate-200 p-1.5 text-right font-mono">{formatCurrency(Math.round(dayBookData.drawer.shiftOpeningFloat))}</td>
                                    </tr>
                                    <tr>
                                      <td className="border border-slate-200 p-1.5 font-medium">(+) Day Cash Receipts</td>
                                      <td className="border border-slate-200 p-1.5 text-right font-mono text-emerald-600 font-bold">+{formatCurrency(Math.round(dayBookData.inflows.totalCashInflow))}</td>
                                    </tr>
                                    <tr>
                                      <td className="border border-slate-200 p-1.5 font-medium">(&minus;) Day Cash Outflows</td>
                                      <td className="border border-slate-200 p-1.5 text-right font-mono text-rose-600 font-bold">-{formatCurrency(Math.round(dayBookData.outflows.totalCashOutflow))}</td>
                                    </tr>
                                    <tr className="bg-indigo-50 font-bold text-xs">
                                      <td className="border border-slate-200 p-1.5 text-indigo-900">EXPECTED CASH IN DRAWER</td>
                                      <td className="border border-slate-200 p-1.5 text-right font-mono text-indigo-700 text-sm">{formatCurrency(Math.round(dayBookData.drawer.expectedClosingCash))}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </div>

                            {/* Section 6: Top Selling Products */}
                            {printIncludeProducts && dayBookData.profit.productSalesList.length > 0 && (
                              <div className="space-y-1">
                                <div className="bg-slate-100 px-3 py-1.5 rounded border-l-4 border-amber-600 font-bold text-xs uppercase flex justify-between items-center text-slate-800">
                                  <span>6. Top Selling Products Breakdown</span>
                                  <span className="font-mono">Revenue: {formatCurrency(Math.round(dayBookData.profit.totalRevenue))}</span>
                                </div>
                                <table className="w-full border-collapse border border-slate-200 text-[11px]">
                                  <thead>
                                    <tr className="bg-slate-50 text-slate-600 text-[9px] font-bold uppercase">
                                      <th className="border border-slate-200 p-1 text-left">Product Name</th>
                                      <th className="border border-slate-200 p-1 text-right">Quantity Sold</th>
                                      <th className="border border-slate-200 p-1 text-center">Orders</th>
                                      <th className="border border-slate-200 p-1 text-right">Revenue (PKR)</th>
                                      <th className="border border-slate-200 p-1 text-right">Share %</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {dayBookData.profit.productSalesList.slice(0, 8).map(p => (
                                      <tr key={p.name}>
                                        <td className="border border-slate-200 p-1 font-semibold">{p.name}</td>
                                        <td className="border border-slate-200 p-1 text-right font-mono font-bold">{p.qty} {p.unit}</td>
                                        <td className="border border-slate-200 p-1 text-center font-mono">{p.ordersCount}</td>
                                        <td className="border border-slate-200 p-1 text-right font-mono font-bold text-emerald-600">{formatCurrency(Math.round(p.revenue))}</td>
                                        <td className="border border-slate-200 p-1 text-right font-mono">
                                          {dayBookData.profit.totalRevenue > 0 ? ((p.revenue / dayBookData.profit.totalRevenue) * 100).toFixed(1) : 0}%
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {/* Signatures Block */}
                            {printIncludeSignatures && (
                              <div className="pt-4 grid grid-cols-3 gap-4 text-center">
                                <div className="border border-dashed border-slate-300 rounded p-3 h-16 flex flex-col justify-between">
                                  <span className="text-[10px] font-bold text-slate-500 uppercase">Cashier / Shift In-Charge</span>
                                  <span className="border-t border-slate-200 text-[9px] text-slate-400 pt-0.5">Signature &amp; Time</span>
                                </div>
                                <div className="border border-dashed border-slate-300 rounded p-3 h-16 flex flex-col justify-between">
                                  <span className="text-[10px] font-bold text-slate-500 uppercase">Store Accountant</span>
                                  <span className="border-t border-slate-200 text-[9px] text-slate-400 pt-0.5">Signature &amp; Verification</span>
                                </div>
                                <div className="border border-dashed border-slate-300 rounded p-3 h-16 flex flex-col justify-between">
                                  <span className="text-[10px] font-bold text-slate-500 uppercase">Farm Owner / Director</span>
                                  <span className="border-t border-slate-200 text-[9px] text-slate-400 pt-0.5">Final Approval Stamp</span>
                                </div>
                              </div>
                            )}

                            {/* Document Footer */}
                            <div className="border-t border-slate-200 pt-2 flex justify-between text-[9px] text-slate-400">
                              <span>Mooco Enterprise Dairy ERP &bull; Official Daily Closing Record &bull; Confidential</span>
                              <span>Page 1 of 1 &bull; System Verified</span>
                            </div>
                          </div>
                        )}

                        {/* --- FORMAT B: THERMAL 80MM RECEIPT SLIP PREVIEW --- */}
                        {dayBookPrintFormat === 'thermal' && (
                          <div id="daybook-thermal-preview" className="mooco-print-surface w-full max-w-[340px] bg-white text-slate-900 shadow-2xl p-5 font-mono text-[11px] border border-slate-300 select-text leading-tight space-y-3 animate-in fade-in duration-200">
                            {/* Header */}
                            <div className="text-center border-b border-dashed border-slate-400 pb-3">
                              <h2 className="text-sm font-black uppercase text-slate-950">
                                {settings?.general?.companyName || 'MOOCO DAIRY FARM & SWEETS'}
                              </h2>
                              <p className="text-[10px] text-slate-500 font-bold mt-0.5">DAILY BUSINESS CLOSING SLIP</p>
                              <p className="text-[9px] text-slate-400">{settings?.general?.address || 'Main Dairy Unit'}</p>
                              <p className="text-[10px] font-bold mt-1">
                                Date: {formatDate(dateRange.start)} {dateRange.start !== dateRange.end && `to ${formatDate(dateRange.end)}`}
                              </p>
                              <p className="text-[9px] text-slate-400">Printed: {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                            </div>

                            {/* 1. Milk */}
                            <div className="border-b border-dashed border-slate-400 pb-2 space-y-0.5">
                              <p className="font-black uppercase text-slate-950 mb-1">1. MILK RECONCILIATION</p>
                              <div className="flex justify-between"><span>Total Milk In:</span><b>{dayBookData.milk.totalMilkInLitres.toFixed(1)} L</b></div>
                              <div className="flex justify-between text-slate-500"><span>&bull; Cow Milk:</span><span>{dayBookData.milk.cowLitresIn.toFixed(1)} L</span></div>
                              <div className="flex justify-between text-slate-500"><span>&bull; Buffalo Milk:</span><span>{dayBookData.milk.buffaloLitresIn.toFixed(1)} L</span></div>
                              <div className="flex justify-between"><span>Counter Sales:</span><span>{dayBookData.milk.counterMilkLitres.toFixed(1)} L</span></div>
                              <div className="flex justify-between"><span>Factory Usage:</span><span>{dayBookData.milk.productionMilkLitres.toFixed(1)} L</span></div>
                              <div className="flex justify-between font-bold text-sky-700"><span>Chiller Stock:</span><span>{dayBookData.milk.liveTotalMilkStock.toFixed(1)} L</span></div>
                            </div>

                            {/* 2. Inflows */}
                            <div className="border-b border-dashed border-slate-400 pb-2 space-y-0.5">
                              <p className="font-black uppercase text-slate-950 mb-1">2. REVENUE INFLOWS</p>
                              <div className="flex justify-between"><span>Cash Counter:</span><span>+{formatCurrency(Math.round(dayBookData.inflows.posCashSales))}</span></div>
                              <div className="flex justify-between"><span>Online / Bank:</span><span>+{formatCurrency(Math.round(dayBookData.inflows.posOnlineSales))}</span></div>
                              <div className="flex justify-between"><span>Debt Collected:</span><span>+{formatCurrency(Math.round(dayBookData.inflows.customerCollections))}</span></div>
                              <div className="flex justify-between font-black text-emerald-700 border-t border-slate-300 pt-1 mt-1">
                                <span>TOTAL INFLOWS:</span><span>+{formatCurrency(Math.round(dayBookData.inflows.totalAllInflows))}</span>
                              </div>
                            </div>

                            {/* 3. Outflows */}
                            <div className="border-b border-dashed border-slate-400 pb-2 space-y-0.5">
                              <p className="font-black uppercase text-slate-950 mb-1">3. OPERATING OUTFLOWS</p>
                              <div className="flex justify-between"><span>Spot Milk Paid:</span><span>-{formatCurrency(Math.round(dayBookData.outflows.spotMilkPaid))}</span></div>
                              <div className="flex justify-between"><span>Operating Expenses:</span><span>-{formatCurrency(Math.round(dayBookData.outflows.totalExpenses))}</span></div>
                              {dayBookData.outflows.otherSupplierPayments > 0 && (
                                <div className="flex justify-between"><span>Supplier Dues:</span><span>-{formatCurrency(Math.round(dayBookData.outflows.otherSupplierPayments))}</span></div>
                              )}
                              <div className="flex justify-between font-black text-rose-700 border-t border-slate-300 pt-1 mt-1">
                                <span>TOTAL OUTFLOWS:</span><span>-{formatCurrency(Math.round(dayBookData.outflows.totalCashOutflow))}</span>
                              </div>
                            </div>

                            {/* 4. Credit */}
                            <div className="border-b border-dashed border-slate-400 pb-2 space-y-0.5">
                              <p className="font-black uppercase text-slate-950 mb-1">4. CREDIT &amp; WORKING CAPITAL</p>
                              <div className="flex justify-between"><span>Credit Extended:</span><span>{formatCurrency(Math.round(dayBookData.credit.posCreditSales))}</span></div>
                              <div className="flex justify-between"><span>Debt Recovered:</span><span>{formatCurrency(Math.round(dayBookData.credit.customerCollections))}</span></div>
                              <div className="flex justify-between"><span>Milk Accrued:</span><span>{formatCurrency(Math.round(dayBookData.credit.milkAccruedCredit))}</span></div>
                            </div>

                            {/* 5. Cash Drawer */}
                            <div className="border-b border-dashed border-slate-400 pb-2 space-y-0.5 bg-slate-50 p-2 rounded">
                              <p className="font-black uppercase text-slate-950 mb-1">5. CASH DRAWER AUDIT</p>
                              <div className="flex justify-between"><span>Opening Float:</span><span>{formatCurrency(Math.round(dayBookData.drawer.shiftOpeningFloat))}</span></div>
                              <div className="flex justify-between text-emerald-700"><span>(+) Inflow:</span><span>+{formatCurrency(Math.round(dayBookData.inflows.totalCashInflow))}</span></div>
                              <div className="flex justify-between text-rose-700"><span>(&minus;) Outflow:</span><span>-{formatCurrency(Math.round(dayBookData.outflows.totalCashOutflow))}</span></div>
                              <div className="flex justify-between font-black text-indigo-900 border-t border-indigo-200 pt-1 mt-1">
                                <span>EXPECTED CASH:</span><span>{formatCurrency(Math.round(dayBookData.drawer.expectedClosingCash))}</span>
                              </div>
                            </div>

                            {/* 6. Profit */}
                            <div className="border-b border-dashed border-slate-400 pb-2 space-y-0.5">
                              <p className="font-black uppercase text-slate-950 mb-1">6. ESTIMATED PROFIT</p>
                              <div className="flex justify-between"><span>Gross Revenue:</span><span>{formatCurrency(Math.round(dayBookData.profit.totalRevenue))}</span></div>
                              <div className="flex justify-between text-slate-500"><span>(&minus;) COGS:</span><span>-{formatCurrency(Math.round(dayBookData.profit.estimatedCOGS))}</span></div>
                              <div className="flex justify-between text-slate-500"><span>(&minus;) Overheads:</span><span>-{formatCurrency(Math.round(dayBookData.profit.totalExpenses))}</span></div>
                              <div className="flex justify-between font-black text-emerald-700 border-t border-slate-300 pt-1 mt-1">
                                <span>EST. NET PROFIT:</span><span>+{formatCurrency(Math.round(dayBookData.profit.estimatedNetProfit))}</span>
                              </div>
                            </div>

                            {/* Signatures */}
                            <div className="pt-2 flex justify-between text-[10px] text-slate-500">
                              <div>
                                <p>Cashier</p>
                                <p className="mt-3">___________</p>
                              </div>
                              <div className="text-right">
                                <p>Owner</p>
                                <p className="mt-3">___________</p>
                              </div>
                            </div>

                            <div className="text-center pt-2 text-[9px] text-slate-400 border-t border-dashed border-slate-300">
                              Mooco Enterprise Dairy ERP
                            </div>
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                )}

              </div>
            )}

            {/* ================================================================
                REPORT 5: CUSTOMER SALES & AGING ANALYSIS
               ================================================================ */}
            {activeReport === 'sales_by_customer' && (
              <div className="space-y-6">
                {/* Customer KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block">Customer Revenue</span>
                    <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1 block font-mono">
                      {formatCurrency(customerSalesData.totalRevenue)}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">From {customerSalesData.list.length} active accounts</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider block">Milk Volume Delivered</span>
                    <span className="text-xl sm:text-2xl font-black text-blue-600 dark:text-blue-400 mt-1 block font-mono">
                      {Math.round(customerSalesData.totalSupplyLiters)} <span className="text-sm font-bold">Liters</span>
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Daily route delivery subscriptions</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-red-200 dark:border-red-950/60 shadow-xs bg-gradient-to-br from-red-50/30 to-amber-50/20 dark:from-red-950/10 dark:to-transparent">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-red-600 uppercase tracking-wider block">Total Outstanding (Dues)</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400">
                        {customerSalesData.debtorCount} Owing
                      </span>
                    </div>
                    <span className="text-xl sm:text-2xl font-black text-red-600 dark:text-red-400 mt-1 block font-mono">
                      {formatCurrency(customerSalesData.totalReceivables)}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Pending accounts receivable (Dr)</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-purple-600 uppercase tracking-wider block">Total Collected</span>
                      {customerSalesData.totalAdvances > 0 && (
                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                          Adv: {formatCurrency(customerSalesData.totalAdvances)}
                        </span>
                      )}
                    </div>
                    <span className="text-xl sm:text-2xl font-black text-purple-600 dark:text-purple-400 mt-1 block font-mono">
                      {formatCurrency(customerSalesData.totalCollections)}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Payments received in period</span>
                  </div>
                </div>

                {/* Print & PDF Studio Action Card Banner */}
                <div className="bg-gradient-to-r from-amber-500/10 via-lime-500/10 to-emerald-500/10 dark:from-amber-950/30 dark:via-lime-950/30 dark:to-emerald-950/30 border border-amber-300/80 dark:border-amber-700/60 rounded-3xl p-4 sm:p-5 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm print:hidden">
                  <div className="flex items-center gap-3.5 w-full md:w-auto">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/15 dark:bg-amber-500/25 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold shrink-0 shadow-xs">
                      <Printer size={24} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-black text-slate-900 dark:text-white text-base">
                          Customer Outstanding Balances Print Studio
                        </h4>
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 uppercase">
                          Vector A4 &amp; 80mm Slip
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Official receivables recovery audit sheet, route delivery collection rosters with signature blanks, and counter thermal receipts.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full md:w-auto shrink-0 justify-end">
                    <button
                      type="button"
                      onClick={copyCustomerWhatsAppSummary}
                      className="px-3.5 py-2 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Copy formatted customer dues statement to paste into WhatsApp"
                    >
                      {isCustomerWhatsAppCopied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                      <span>{isCustomerWhatsAppCopied ? 'Copied!' : 'WhatsApp Statement'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsCustomerBalanceModalOpen(true)}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white dark:bg-lime-500 dark:hover:bg-lime-400 dark:text-slate-950 rounded-xl font-black text-xs transition-all flex items-center gap-1.5 shadow-sm hover:shadow-md cursor-pointer"
                    >
                      <Printer size={15} />
                      <span>Open Print Studio</span>
                    </button>
                  </div>
                </div>

                {/* Top Customers Chart */}
                {customerSalesData.topCustomersChart.length > 0 && (
                  <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3 print:hidden">
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white">Top 5 Revenue Generating Customers</h3>
                    <div className="h-52 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={customerSalesData.topCustomersChart} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                          <YAxis stroke="#94a3b8" fontSize={11} width={48} tickFormatter={formatCompactValue} />
                          <RechartsTooltip 
                            contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '11px' }} 
                            formatter={(val: any) => formatCurrency(Number(val))}
                          />
                          <Bar dataKey="revenue" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Customer Table */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                  {/* Table Toolbar */}
                  <div className="p-3 sm:p-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60 dark:bg-slate-900/60">
                    <div className="flex items-center gap-1.5 bg-slate-200/80 dark:bg-slate-800 p-0.5 rounded-xl">
                      <button
                        type="button"
                        onClick={() => setCustomerInPageFilter('all')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          customerInPageFilter === 'all'
                            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        All Customers ({customers.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomerInPageFilter('dues_only')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                          customerInPageFilter === 'dues_only'
                            ? 'bg-red-600 text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400'
                        }`}
                      >
                        <span>Pending Dues Only</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 font-mono font-bold">
                          {customerSalesData.debtorCount}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomerInPageFilter('advance_only')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          customerInPageFilter === 'advance_only'
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400'
                        }`}
                      >
                        Advance Balances ({customerSalesData.advanceCount})
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerPrintFilter(customerInPageFilter);
                          setIsCustomerBalanceModalOpen(true);
                        }}
                        className="px-3 py-1.5 bg-lime-600 hover:bg-lime-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-all active:scale-95"
                      >
                        <Printer size={13} />
                        <span>Print Outstanding Sheet</span>
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-black uppercase text-[11px] border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th className="px-4 py-3">Customer</th>
                          <th className="px-4 py-3">Type / Route</th>
                          <th className="px-4 py-3 text-right">POS Sales</th>
                          <th className="px-4 py-3 text-right">Supply Liters</th>
                          <th className="px-4 py-3 text-right">Supply Sales</th>
                          <th className="px-4 py-3 text-right font-black text-slate-900 dark:text-white">Total Revenue</th>
                          <th className="px-4 py-3 text-right font-black text-amber-700 dark:text-amber-400">Current Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {customerSalesData.list.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-8 text-center text-slate-400 italic">
                              No customer records match the selected filter.
                            </td>
                          </tr>
                        ) : (
                          customerSalesData.list.map(c => (
                            <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                              <td className="px-4 py-2.5 font-bold text-slate-800 dark:text-slate-200">
                                {c.name}
                                <span className="block text-[10px] text-slate-400 font-normal">{c.phone}</span>
                              </td>
                              <td className="px-4 py-2.5">
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                  {c.type}
                                </span>
                                {c.route !== '-' && <span className="block text-[10px] text-slate-400 mt-0.5">Route: {c.route}</span>}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono font-semibold">{formatCurrency(c.posRevenue)}</td>
                              <td className="px-4 py-2.5 text-right font-mono font-semibold">{c.supplyLiters > 0 ? `${c.supplyLiters.toFixed(1)} L` : '-'}</td>
                              <td className="px-4 py-2.5 text-right font-mono font-semibold">{formatCurrency(c.supplyRevenue)}</td>
                              <td className="px-4 py-2.5 text-right font-mono font-black text-lime-600 dark:text-lime-400 text-sm">
                                {formatCurrency(c.totalRevenue)}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono font-bold">
                                {c.balance > 0.01 ? (
                                  <span className="px-2 py-0.5 rounded bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400 border border-red-200 dark:border-red-900 font-black">
                                    {formatCurrency(c.balance)} Dr
                                  </span>
                                ) : c.balance < -0.01 ? (
                                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900 font-black">
                                    {formatCurrency(Math.abs(c.balance))} Cr
                                  </span>
                                ) : (
                                  <span className="text-slate-400">Rs 0 (Settled)</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      {customerSalesData.list.length > 0 && (
                        <tfoot className="bg-slate-50 dark:bg-slate-850 border-t-2 border-slate-200 dark:border-slate-700 font-black">
                          <tr>
                            <td colSpan={2} className="px-4 py-3 uppercase text-[11px] text-slate-700 dark:text-slate-300">
                              Grand Totals ({customerSalesData.list.length} accounts):
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-slate-800 dark:text-slate-200">
                              {formatCurrency(customerSalesData.list.reduce((s, c) => s + c.posRevenue, 0))}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-blue-600 dark:text-blue-400">
                              {customerSalesData.totalSupplyLiters.toFixed(1)} L
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-slate-800 dark:text-slate-200">
                              {formatCurrency(customerSalesData.list.reduce((s, c) => s + c.supplyRevenue, 0))}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-lime-600 dark:text-lime-400 text-sm">
                              {formatCurrency(customerSalesData.totalRevenue)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-sm text-red-600 dark:text-red-400">
                              {formatCurrency(customerSalesData.totalReceivables)} Dr
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>

                {/* --- CUSTOMER OUTSTANDING BALANCES PRINT & PDF EXPORT STUDIO MODAL --- */}
                {isCustomerBalanceModalOpen && (
                  <div className="fixed inset-0 z-[150] flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150">
                    <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs" onClick={() => setIsCustomerBalanceModalOpen(false)} />
                    <div className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-5xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[94vh] animate-in zoom-in-95 duration-200">
                      
                      {/* Modal Header & Format Switcher */}
                      <div className="p-3 sm:p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-slate-850 shrink-0">
                        <div className="flex items-center gap-3">
                          <span className="w-9 h-9 rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold shrink-0">
                            <Printer size={18} />
                          </span>
                          <div>
                            <h4 className="font-black text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                              Customer Outstanding Balances Studio
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                                Vector Sharp
                              </span>
                            </h4>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              Executive A4 Recovery Audit Sheet &amp; 80mm Counter Thermal Roll
                            </p>
                          </div>
                        </div>

                        {/* Format Pills & Action Buttons */}
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Format Switcher */}
                          <div className="bg-slate-200/80 dark:bg-slate-800 p-0.5 rounded-xl flex items-center">
                            <button
                              type="button"
                              onClick={() => setCustomerPrintFormat('a4')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                                customerPrintFormat === 'a4'
                                  ? 'bg-slate-900 text-white dark:bg-lime-500 dark:text-slate-950 shadow-xs'
                                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                              }`}
                            >
                              <FileText size={13} />
                              <span>Executive A4 (PDF)</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setCustomerPrintFormat('thermal')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                                customerPrintFormat === 'thermal'
                                  ? 'bg-slate-900 text-white dark:bg-lime-500 dark:text-slate-950 shadow-xs'
                                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                              }`}
                            >
                              <Receipt size={13} />
                              <span>Thermal Slip (80mm)</span>
                            </button>
                          </div>

                          {/* WhatsApp Copy */}
                          <button
                            type="button"
                            onClick={copyCustomerWhatsAppSummary}
                            className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                            title="Copy formatted customer dues statement to paste in WhatsApp"
                          >
                            {isCustomerWhatsAppCopied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                            <span>{isCustomerWhatsAppCopied ? 'Copied!' : 'WhatsApp Copy'}</span>
                          </button>

                          {/* Download PDF Direct */}
                          <button
                            type="button"
                            onClick={downloadCustomerBalancePDF}
                            disabled={isCustomerBalancePDFGenerating}
                            className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-950 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-sm hover:shadow-md cursor-pointer disabled:opacity-50"
                            title="Directly download high-resolution PDF file"
                          >
                            {isCustomerBalancePDFGenerating ? <Loader2 size={13} className="animate-spin text-lime-400" /> : <FileDown size={13} />}
                            <span>{isCustomerBalancePDFGenerating ? 'Generating...' : 'Download PDF'}</span>
                          </button>

                          {/* Print / Save PDF */}
                          <button
                            type="button"
                            onClick={() => printCustomerBalanceDocument(customerPrintFormat)}
                            className="px-3.5 py-1.5 bg-lime-500 hover:bg-lime-400 text-slate-950 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-sm hover:shadow-md cursor-pointer"
                            title="Open native browser print and PDF export dialog"
                          >
                            <Printer size={13} />
                            <span>Print</span>
                          </button>

                          {/* Close */}
                          <button
                            type="button"
                            onClick={() => setIsCustomerBalanceModalOpen(false)}
                            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <X size={18} />
                          </button>
                        </div>
                      </div>

                      {/* Studio Filter Controls & Customization Toolbar */}
                      <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
                        {/* Scope & Route Selectors */}
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Filter Mode */}
                          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
                            <button
                              type="button"
                              onClick={() => setCustomerPrintFilter('dues_only')}
                              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${
                                customerPrintFilter === 'dues_only'
                                  ? 'bg-amber-500 text-white shadow-xs'
                                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                              }`}
                            >
                              Dues Only (Baqaya)
                            </button>
                            <button
                              type="button"
                              onClick={() => setCustomerPrintFilter('all')}
                              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${
                                customerPrintFilter === 'all'
                                  ? 'bg-slate-800 text-white dark:bg-slate-700'
                                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                              }`}
                            >
                              All Customers
                            </button>
                            <button
                              type="button"
                              onClick={() => setCustomerPrintFilter('advance_only')}
                              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${
                                customerPrintFilter === 'advance_only'
                                  ? 'bg-emerald-600 text-white'
                                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                              }`}
                            >
                              Advance (Cr)
                            </button>
                          </div>

                          {/* Route Dropdown */}
                          {customerRoutes.length > 0 && (
                            <select
                              value={customerPrintRoute}
                              onChange={e => setCustomerPrintRoute(e.target.value)}
                              className="px-2.5 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none"
                            >
                              <option value="all">All Delivery Routes</option>
                              {customerRoutes.map(r => (
                                <option key={r} value={r}>Route: {r}</option>
                              ))}
                            </select>
                          )}

                          {/* Sort Order */}
                          <select
                            value={customerPrintSort}
                            onChange={e => setCustomerPrintSort(e.target.value as any)}
                            className="px-2.5 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none"
                          >
                            <option value="balance_desc">Sort: Highest Dues First</option>
                            <option value="name_asc">Sort: Name (A-Z)</option>
                            <option value="route">Sort: Route Wise</option>
                          </select>
                        </div>

                        {/* A4 Section Toggles */}
                        {customerPrintFormat === 'a4' && (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setCustomerPrintIncludeSalesDetails(!customerPrintIncludeSalesDetails)}
                              className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                                customerPrintIncludeSalesDetails 
                                  ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800' 
                                  : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              {customerPrintIncludeSalesDetails ? <CheckSquare size={12} /> : <Square size={12} />}
                              <span>Sales &amp; Paid Cols</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setCustomerPrintIncludeRecoveryBoxes(!customerPrintIncludeRecoveryBoxes)}
                              className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                                customerPrintIncludeRecoveryBoxes 
                                  ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' 
                                  : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                              }`}
                              title="Add recovery collection notes and customer signature box for field riders"
                            >
                              {customerPrintIncludeRecoveryBoxes ? <CheckSquare size={12} /> : <Square size={12} />}
                              <span>Field Recovery Box</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setCustomerPrintIncludeKPIs(!customerPrintIncludeKPIs)}
                              className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                                customerPrintIncludeKPIs 
                                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' 
                                  : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              {customerPrintIncludeKPIs ? <CheckSquare size={12} /> : <Square size={12} />}
                              <span>KPI Summary</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setCustomerPrintIncludeSignatures(!customerPrintIncludeSignatures)}
                              className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                                customerPrintIncludeSignatures 
                                  ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800' 
                                  : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              {customerPrintIncludeSignatures ? <CheckSquare size={12} /> : <Square size={12} />}
                              <span>Signatures</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setCustomerPrintDensity(customerPrintDensity === 'normal' ? 'compact' : 'normal')}
                              className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                                customerPrintDensity === 'compact'
                                  ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800' 
                                  : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                              }`}
                              title="Fits more customer rows per page"
                            >
                              {customerPrintDensity === 'compact' ? <CheckSquare size={12} /> : <Square size={12} />}
                              <span>Compact Density</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Live Realistic Preview Canvas */}
                      <div className="flex-1 overflow-y-auto bg-slate-200/60 dark:bg-slate-950/90 p-3 sm:p-6 flex justify-center">
                        
                        {/* --- FORMAT A: EXECUTIVE A4 DOCUMENT PREVIEW --- */}
                        {customerPrintFormat === 'a4' && (
                          <div 
                            id="customer-balance-a4-preview" 
                            className={`mooco-print-surface w-full max-w-4xl bg-white text-slate-900 shadow-2xl rounded-sm border border-slate-200 font-sans select-text space-y-4 animate-in fade-in duration-200 ${
                              customerPrintDensity === 'compact' ? 'p-5 sm:p-7 text-[9.5px]' : 'p-6 sm:p-9 text-[10.5px]'
                            }`}
                          >
                            
                            {/* Document Letterhead */}
                            <div className="border-b-2 border-slate-900 pb-3 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-3">
                              <div className="flex items-start gap-3">
                                <div className="w-12 h-12 rounded-xl bg-slate-900 text-white flex flex-col items-center justify-center font-black text-xs leading-none shrink-0 shadow-sm">
                                  <span>MOO</span>
                                  <span className="text-lime-400 text-[10px]">CO</span>
                                </div>
                                <div>
                                  <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-slate-950 leading-tight">
                                    {settings?.general?.companyName || 'MOOCO DAIRY FARM & SWEETS'}
                                  </h1>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                                      Customer Outstanding Balances &amp; Recovery Audit
                                    </p>

                                  </div>
                                  <p className="text-[10px] text-slate-500 mt-0.5">
                                    {settings?.general?.address || 'Main Dairy Farm & Sweet Unit'} &bull; Phone: {settings?.general?.phone || '+92 300 0000000'}
                                    {settings?.general?.taxNumber ? ` &bull; NTN/TRN: ${settings.general.taxNumber}` : ''}
                                  </p>
                                </div>
                              </div>

                              <div className="text-left sm:text-right text-[10px] text-slate-600 space-y-0.5 shrink-0 bg-slate-50 p-2 sm:p-0 rounded border sm:border-none border-slate-200 w-full sm:w-auto">
                                <p><span className="font-bold text-slate-800">Statement As Of:</span> {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                                <p><span className="font-bold text-slate-800">Sales Period:</span> {formatDate(dateRange.start)} {dateRange.start !== dateRange.end && `to ${formatDate(dateRange.end)}`}</p>
                                <p><span className="font-bold text-slate-800">Route / Area:</span> {customerPrintRoute === 'all' ? 'All Delivery Routes' : customerPrintRoute}</p>
                                <p><span className="font-bold text-slate-800">Auditor:</span> {currentUser?.name || 'Administrator'}</p>
                                <span className="inline-block mt-0.5 px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[9px] font-black uppercase">
                                  Verified Receivables Audit
                                </span>
                              </div>
                            </div>

                            {/* Executive KPI Summary Bar */}
                            {customerPrintIncludeKPIs && (
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                <div className="bg-red-50/70 border border-red-200 rounded-lg p-2.5">
                                  <span className="text-[9.5px] font-bold text-red-800 uppercase block">Total Outstanding Dues</span>
                                  <span className="text-base font-black font-mono text-red-700 block mt-0.5">
                                    {formatCurrency(Math.round(customerPrintData.totalReceivables))} <span className="text-xs">Dr</span>
                                  </span>
                                  <span className="text-[9px] text-slate-500 font-medium">
                                    Pending across {customerPrintData.debtorCount} customers
                                  </span>
                                </div>

                                <div className="bg-blue-50/70 border border-blue-200 rounded-lg p-2.5">
                                  <span className="text-[9.5px] font-bold text-blue-800 uppercase block">Customers Owing</span>
                                  <span className="text-base font-black font-mono text-blue-800 block mt-0.5">
                                    {customerPrintData.debtorCount} <span className="text-xs font-normal text-slate-600">/ {customerPrintData.totalCount} Cust</span>
                                  </span>
                                  <span className="text-[9px] text-slate-500 font-medium">
                                    {customerPrintData.totalCount > 0 ? ((customerPrintData.debtorCount / customerPrintData.totalCount) * 100).toFixed(0) : 0}% of customer roster
                                  </span>
                                </div>

                                <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-2.5">
                                  <span className="text-[9.5px] font-bold text-emerald-800 uppercase block">Period Recoveries</span>
                                  <span className="text-base font-black font-mono text-emerald-700 block mt-0.5">
                                    +{formatCurrency(Math.round(customerPrintData.totalPeriodCollections))}
                                  </span>
                                  <span className="text-[9px] text-slate-500 font-medium">
                                    Collected in selected range
                                  </span>
                                </div>

                                <div className="bg-sky-50/70 border border-sky-200 rounded-lg p-2.5">
                                  <span className="text-[9.5px] font-bold text-sky-800 uppercase block">Advance Balances (Cr)</span>
                                  <span className="text-base font-black font-mono text-sky-700 block mt-0.5">
                                    {formatCurrency(Math.round(customerPrintData.totalAdvances))} <span className="text-xs">Cr</span>
                                  </span>
                                  <span className="text-[9px] text-slate-500 font-medium">
                                    {customerPrintData.advanceCount} customer advance deposits
                                  </span>
                                </div>
                              </div>
                            )}

                            {/* Scope and Filter Ribbon */}
                            <div className="bg-slate-100/90 px-3 py-1.5 rounded border border-slate-200 flex flex-wrap items-center justify-between text-[9.5px] text-slate-600">
                              <div>
                                <span className="font-bold text-slate-800">Filter Scope: </span>
                                {customerPrintFilter === 'dues_only' ? 'Customers with Outstanding Dues (> 0)' : customerPrintFilter === 'advance_only' ? 'Customers with Advance Balances (< 0)' : 'All Registered Customers'}
                                {customerPrintRoute !== 'all' && ` &bull; Route: ${customerPrintRoute}`}
                              </div>
                              <div className="font-mono font-bold text-slate-700">
                                Total Accounts Listed: {customerPrintData.list.length}
                              </div>
                            </div>

                            {/* High-Density Customer Dues Table */}
                            <div className="overflow-x-auto">
                              <table className="w-full border-collapse border border-slate-300 text-[10px]">
                                <thead>
                                  <tr className="bg-slate-100 text-slate-700 font-black uppercase text-[9px] border-b border-slate-300">
                                    <th className="border border-slate-300 p-1.5 text-center w-8">#</th>
                                    <th className="border border-slate-300 p-1.5 text-left">Customer Name &amp; Contact</th>
                                    <th className="border border-slate-300 p-1.5 text-left w-24">Route / Area</th>
                                    <th className="border border-slate-300 p-1.5 text-center w-20">Type</th>
                                    {customerPrintIncludeSalesDetails && (
                                      <>
                                        <th className="border border-slate-300 p-1.5 text-right w-24">Period Sales</th>
                                        <th className="border border-slate-300 p-1.5 text-right w-24">Period Paid</th>
                                      </>
                                    )}
                                    <th className="border border-slate-300 p-1.5 text-right w-32 bg-amber-50/60 font-black text-slate-900">
                                      Outstanding Balance
                                    </th>
                                    {customerPrintIncludeRecoveryBoxes && (
                                      <th className="border border-slate-300 p-1.5 text-center w-44">
                                        Field Recovery / Signature
                                      </th>
                                    )}
                                  </tr>
                                </thead>
                                <tbody>
                                  {customerPrintData.list.length === 0 ? (
                                    <tr>
                                      <td 
                                        colSpan={4 + (customerPrintIncludeSalesDetails ? 2 : 0) + 1 + (customerPrintIncludeRecoveryBoxes ? 1 : 0)} 
                                        className="border border-slate-300 p-6 text-center text-slate-400 italic"
                                      >
                                        No customer records found matching the active filters.
                                      </td>
                                    </tr>
                                  ) : (
                                    customerPrintData.list.map((c, index) => {
                                      const isDue = c.balance > 0.01;
                                      const isAdvance = c.balance < -0.01;
                                      return (
                                        <tr 
                                          key={c.id} 
                                          className={`print-avoid-break ${index % 2 === 1 ? 'bg-slate-50/60' : 'bg-white'} hover:bg-amber-50/30 transition-colors`}
                                        >
                                          {/* Serial Number */}
                                          <td className="border border-slate-300 p-1.5 text-center font-mono font-bold text-slate-500">
                                            {index + 1}
                                          </td>

                                          {/* Customer Name & Phone */}
                                          <td className="border border-slate-300 p-1.5 font-bold text-slate-900">
                                            <div className="flex items-center justify-between">
                                              <span>{c.name}</span>
                                              {c.phone !== '-' && (
                                                <span className="font-mono font-normal text-[9px] text-slate-500 ml-2">
                                                  {c.phone}
                                                </span>
                                              )}
                                            </div>
                                            {c.address && (
                                              <span className="text-[8.5px] text-slate-400 block font-normal truncate max-w-xs">
                                                {c.address}
                                              </span>
                                            )}
                                          </td>

                                          {/* Route */}
                                          <td className="border border-slate-300 p-1.5 text-slate-700">
                                            {c.route !== '-' ? (
                                              <span className="font-semibold">{c.route}</span>
                                            ) : (
                                              <span className="text-slate-400 italic">-</span>
                                            )}
                                          </td>

                                          {/* Type */}
                                          <td className="border border-slate-300 p-1.5 text-center">
                                            <span className="inline-block px-1.5 py-0.5 rounded text-[8.5px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                              {c.type}
                                            </span>
                                          </td>

                                          {/* Period Sales Details */}
                                          {customerPrintIncludeSalesDetails && (
                                            <>
                                              <td className="border border-slate-300 p-1.5 text-right font-mono text-slate-800">
                                                {c.totalRevenue > 0 ? `${formatCurrency(Math.round(c.totalRevenue))}` : '-'}
                                              </td>
                                              <td className="border border-slate-300 p-1.5 text-right font-mono text-emerald-700 font-semibold">
                                                {c.payments > 0 ? `${formatCurrency(Math.round(c.payments))}` : '-'}
                                              </td>
                                            </>
                                          )}

                                          {/* Outstanding Balance */}
                                          <td className={`border border-slate-300 p-1.5 text-right font-mono font-black ${
                                            isDue 
                                              ? 'bg-red-50/70 text-red-700' 
                                              : isAdvance 
                                                ? 'bg-emerald-50/70 text-emerald-700' 
                                                : 'text-slate-400 font-normal'
                                          }`}>
                                            {isDue ? (
                                              <span>{formatCurrency(Math.round(c.balance))} <span className="text-[9px] font-bold">Dr</span></span>
                                            ) : isAdvance ? (
                                              <span>{formatCurrency(Math.round(Math.abs(c.balance)))} <span className="text-[9px] font-bold">Cr</span></span>
                                            ) : (
                                              <span>Rs 0 (Settled)</span>
                                            )}
                                          </td>

                                          {/* Field Recovery Collection Box */}
                                          {customerPrintIncludeRecoveryBoxes && (
                                            <td className="border border-slate-300 p-1 bg-slate-50/40">
                                              <div className="border border-dashed border-slate-300 rounded p-1 text-[8.5px] bg-white">
                                                <div className="flex justify-between items-center text-slate-700">
                                                  <span>Recv: Rs ________</span>
                                                  <span className="text-[8px] text-slate-400">[ ] Cash [ ] Online</span>
                                                </div>
                                                <div className="flex justify-between items-center mt-1 text-slate-400 text-[8px]">
                                                  <span>Date: ___/___</span>
                                                  <span>Sign: _____________</span>
                                                </div>
                                              </div>
                                            </td>
                                          )}
                                        </tr>
                                      );
                                    })
                                  )}
                                </tbody>
                                <tfoot>
                                  <tr className="bg-slate-200/90 font-black text-slate-900 border-t-2 border-slate-400">
                                    <td colSpan={4} className="border border-slate-300 p-2 text-right uppercase text-[9.5px]">
                                      Grand Total ({customerPrintData.totalCount} Customers):
                                    </td>
                                    {customerPrintIncludeSalesDetails && (
                                      <>
                                        <td className="border border-slate-300 p-2 text-right font-mono text-slate-900">
                                          {formatCurrency(Math.round(customerPrintData.totalPeriodSales))}
                                        </td>
                                        <td className="border border-slate-300 p-2 text-right font-mono text-emerald-800">
                                          {formatCurrency(Math.round(customerPrintData.totalPeriodCollections))}
                                        </td>
                                      </>
                                    )}
                                    <td className="border border-slate-300 p-2 text-right font-mono text-sm font-black bg-red-100/80 text-red-800">
                                      {formatCurrency(Math.round(customerPrintData.totalReceivables))} Dr
                                    </td>
                                    {customerPrintIncludeRecoveryBoxes && (
                                      <td className="border border-slate-300 p-1.5 text-center text-[9px] text-slate-600 bg-amber-50">
                                        Total Recv: Rs _________
                                      </td>
                                    )}
                                  </tr>
                                </tfoot>
                              </table>
                            </div>

                            {/* Official Audit Signatures Block */}
                            {customerPrintIncludeSignatures && (
                              <div className="pt-6 border-t border-slate-300 print-avoid-break">
                                <div className="grid grid-cols-3 gap-6 text-center text-[10px] text-slate-600">
                                  <div className="space-y-1">
                                    <div className="border-b border-dashed border-slate-400 pb-8 text-slate-400 italic">
                                      (Stamp &amp; Signature)
                                    </div>
                                    <p className="font-bold text-slate-800">Prepared By</p>
                                    <p className="text-[9px] text-slate-500">Accountant / Cashier ({currentUser?.name || 'Admin'})</p>
                                  </div>

                                  <div className="space-y-1">
                                    <div className="border-b border-dashed border-slate-400 pb-8 text-slate-400 italic">
                                      (Stamp &amp; Signature)
                                    </div>
                                    <p className="font-bold text-slate-800">Field Recovery Incharge</p>
                                    <p className="text-[9px] text-slate-500">Delivery Rider / Route Officer</p>
                                  </div>

                                  <div className="space-y-1">
                                    <div className="border-b border-dashed border-slate-400 pb-8 text-slate-400 italic">
                                      (Stamp &amp; Signature)
                                    </div>
                                    <p className="font-bold text-slate-800">Authorized Approval</p>
                                    <p className="text-[9px] text-slate-500">Managing Director / Dairy Owner</p>
                                  </div>
                                </div>

                                <div className="mt-4 pt-2 border-t border-dashed border-slate-200 text-center text-[8.5px] text-slate-400">
                                  Official System Document &bull; Mooco Enterprise Dairy Accounting &bull; Generated: {new Date().toLocaleString()} &bull; Discrepancies must be notified within 3 business days.
                                </div>
                              </div>
                            )}

                          </div>
                        )}

                        {/* --- FORMAT B: THERMAL RECEIPT SLIP (80mm) --- */}
                        {customerPrintFormat === 'thermal' && (
                          <div 
                            id="customer-balance-thermal-preview" 
                            className="mooco-print-surface w-[72mm] bg-white text-black shadow-2xl rounded-sm p-3.5 border border-slate-300 font-mono text-[10.5px] select-text space-y-2 animate-in fade-in duration-200"
                          >
                            <div className="text-center space-y-0.5">
                              <h3 className="font-black text-sm uppercase">
                                {settings?.general?.companyName || 'MOOCO DAIRY FARM'}
                              </h3>
                              <p className="text-[10px] font-bold">CUSTOMER OUTSTANDING DUES</p>

                              <p className="text-[9px] text-slate-600">{settings?.general?.phone || '+92 300 0000000'}</p>
                            </div>

                            <div className="divider" style={{ borderBottom: '1px dashed #000', margin: '4px 0' }} />

                            <div className="text-[9.5px] space-y-0.5">
                              <div className="flex justify-between">
                                <span>Date:</span>
                                <span>{new Date().toLocaleDateString('en-GB')}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Time:</span>
                                <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Route:</span>
                                <span>{customerPrintRoute === 'all' ? 'All Routes' : customerPrintRoute}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>User:</span>
                                <span>{currentUser?.name || 'Admin'}</span>
                              </div>
                            </div>

                            <div className="divider" style={{ borderBottom: '1px dashed #000', margin: '4px 0' }} />

                            <div className="bg-slate-100 p-1.5 rounded text-center">
                              <span className="text-[9px] uppercase block font-bold">TOTAL OUTSTANDING DUES</span>
                              <span className="text-sm font-black block">
                                {formatCurrency(Math.round(customerPrintData.totalReceivables))} Dr
                              </span>
                              <span className="text-[8.5px] text-slate-600">
                                {customerPrintData.debtorCount} Owing Customers
                              </span>
                            </div>

                            <div className="divider" style={{ borderBottom: '1px dashed #000', margin: '4px 0' }} />

                            <div className="space-y-1.5 text-[9.5px]">
                              {customerPrintData.list.filter(c => c.balance > 0.01).map((c, i) => (
                                <div key={c.id} className="border-b border-dotted border-slate-300 pb-1">
                                  <div className="flex justify-between font-bold">
                                    <span>#{i + 1} {c.name.slice(0, 16)}</span>
                                    <span>{formatCurrency(Math.round(c.balance))}</span>
                                  </div>
                                  <div className="flex justify-between text-[8.5px] text-slate-600">
                                    <span>{c.route !== '-' ? c.route : c.type}</span>
                                    <span>{c.phone !== '-' ? c.phone : ''}</span>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="divider" style={{ borderBottom: '1px dashed #000', margin: '4px 0' }} />

                            <div className="flex justify-between font-black text-xs pt-1">
                              <span>GRAND TOTAL DUES:</span>
                              <span>{formatCurrency(Math.round(customerPrintData.totalReceivables))}</span>
                            </div>

                            <div className="pt-4 space-y-3 text-[9px]">
                              <div className="flex justify-between">
                                <span>Recv Today: Rs _________</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Rider Sign: _________</span>
                                <span>Cashier: _________</span>
                              </div>
                            </div>

                            <div className="text-center pt-2 text-[8px] text-slate-500 border-t border-dashed border-slate-300">
                              Mooco Enterprise Dairy ERP
                            </div>
                          </div>
                        )}

                      </div>

                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ================================================================
                REPORT 6: ITEM SALES PERFORMANCE
               ================================================================ */}
            {activeReport === 'sales_by_item' && (
              <div className="space-y-6">
                {/* Visual Charts: Top Items & Category Donut */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 print:hidden">
                  <div className="lg:col-span-7 bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white">Top 5 Products by Sales Revenue</h3>
                    <div className="h-56 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={itemSalesData.topItemsChart} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                          <YAxis stroke="#94a3b8" fontSize={11} width={48} tickFormatter={formatCompactValue} />
                          <RechartsTooltip 
                            contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '11px' }} 
                            formatter={(val: any) => formatCurrency(Number(val))}
                          />
                          <Bar dataKey="revenue" fill="#84cc16" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="lg:col-span-5 bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white">Category Revenue Share</h3>
                    <div className="h-56 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={itemSalesData.categoryPie}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={80}
                            paddingAngle={4}
                            dataKey="value"
                          >
                            {itemSalesData.categoryPie.map((_, index) => (
                              <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <RechartsTooltip 
                            contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '11px' }} 
                            formatter={(val: any) => formatCurrency(Number(val))}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                {/* Items Performance Table */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-black uppercase text-[11px] border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th className="px-4 py-3">Product Name</th>
                          <th className="px-4 py-3">Category</th>
                          <th className="px-4 py-3 text-right">Units / Vol Sold</th>
                          <th className="px-4 py-3 text-right">Avg Selling Rate</th>
                          <th className="px-4 py-3 text-right font-black text-slate-900 dark:text-white">Total Revenue</th>
                          <th className="px-4 py-3 text-right">Estimated Gross Margin</th>
                          <th className="px-4 py-3 text-right">Revenue Share</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {itemSalesData.list.map(i => (
                          <tr key={i.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="px-4 py-2.5 font-bold text-slate-800 dark:text-slate-200">
                              {i.name}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                {i.category}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-bold">
                              {i.quantity.toFixed(1)} {i.unit}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold">
                              {formatCurrency(i.avgRate)}<span className="text-[10px] text-slate-400 font-normal"> / {i.unit}</span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-black text-lime-600 dark:text-lime-400 text-sm">
                              {formatCurrency(i.revenue)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold">
                              <span className={i.margin >= 25 ? 'text-emerald-600 font-bold' : 'text-slate-600 dark:text-slate-400'}>
                                {i.margin.toFixed(1)}%
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-500">
                              {i.share.toFixed(1)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                REPORT 7: STOCK VALUATION SUMMARY
               ================================================================ */}
            {activeReport === 'stock_summary' && (
              <div className="space-y-6">
                {/* KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider block">Inventory Value (At Cost)</span>
                    <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1 block font-mono">
                      {formatCurrency(stockValuationData.totalValuationCost)}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Cost of all current warehouse stock</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block">Potential Retail Worth</span>
                    <span className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1 block font-mono">
                      {formatCurrency(stockValuationData.totalRetailWorth)}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Expected revenue upon complete sale</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-purple-600 uppercase tracking-wider block">Unrealized Gross Margin</span>
                    <span className="text-xl sm:text-2xl font-black text-purple-600 dark:text-purple-400 mt-1 block font-mono">
                      {formatCurrency(stockValuationData.totalPotentialProfit)}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Potential profit embedded in stock</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Tracked SKUs</span>
                    <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1 block font-mono">
                      {stockValuationData.totalSkus}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Catalog active products</span>
                  </div>
                </div>

                {/* Stock Valuation Table */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-black uppercase text-[11px] border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th className="px-4 py-3">Item / Product</th>
                          <th className="px-4 py-3">Category</th>
                          <th className="px-4 py-3 text-right">Loose Stock</th>
                          <th className="px-4 py-3 text-right">Packed Units</th>
                          <th className="px-4 py-3 text-right">Total Base Qty</th>
                          <th className="px-4 py-3 text-right">Cost Rate</th>
                          <th className="px-4 py-3 text-right">Selling Rate</th>
                          <th className="px-4 py-3 text-right font-black text-blue-600 dark:text-blue-400">Valuation (Cost)</th>
                          <th className="px-4 py-3 text-right font-black text-emerald-600 dark:text-emerald-400">Retail Worth</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {stockValuationData.list.map(i => (
                          <tr key={i.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="px-4 py-2.5 font-bold text-slate-800 dark:text-slate-200">
                              {i.name}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                {i.category}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold">{i.looseStock.toFixed(1)}</td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold" title={i.packBreakdown || undefined}>{i.totalVariantsUnits}</td>
                            <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900 dark:text-white">
                              {i.totalBaseQty.toFixed(1)} {i.unit}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold">
                              {formatCurrency(i.costPrice)}
                              {i.costMissing && <span className="block text-[10px] font-bold text-amber-600">Cost not set</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold">{formatCurrency(i.sellingPrice)}</td>
                            <td className="px-4 py-2.5 text-right font-mono font-bold text-blue-600 dark:text-blue-400">
                              {formatCurrency(i.valuationCost)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                              {formatCurrency(i.retailWorth)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                REPORT 8: ITEM STOCK LEDGER
               ================================================================ */}
            {activeReport === 'item_ledger' && (
              <div className="space-y-4">
                {selectedItemId === 'all' ? (
                  <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 space-y-3">
                    <Search size={36} className="mx-auto text-slate-300" />
                    <h4 className="text-base font-bold text-slate-700 dark:text-slate-300">Please Select an Item to View its Stock Ledger</h4>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto">
                      Use the item selector in the top filter bar to track complete chronological movement, purchases, returns, and sales for any specific dairy item.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Item Ledger KPIs */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Opening Stock</span>
                        <span className="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-200 mt-1 block font-mono">
                          {itemLedgerData.openingStock.toFixed(1)} {itemLedgerData.unit}
                        </span>
                        <span className="text-[11px] text-slate-400 mt-1 block">At start of selected period</span>
                      </div>

                      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                        <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block">Total Received (+IN)</span>
                        <span className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1 block font-mono">
                          +{itemLedgerData.totalIn.toFixed(1)} {itemLedgerData.unit}
                        </span>
                        <span className="text-[11px] text-slate-400 mt-1 block">Purchases &amp; production batches</span>
                      </div>

                      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                        <span className="text-[11px] font-bold text-red-600 uppercase tracking-wider block">Total Dispatched (-OUT)</span>
                        <span className="text-xl sm:text-2xl font-black text-red-600 dark:text-red-400 mt-1 block font-mono">
                          -{itemLedgerData.totalOut.toFixed(1)} {itemLedgerData.unit}
                        </span>
                        <span className="text-[11px] text-slate-400 mt-1 block">POS sales &amp; consumptions</span>
                      </div>

                      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                        <span className="text-[11px] font-bold text-purple-600 uppercase tracking-wider block">Closing Balance</span>
                        <span className="text-xl sm:text-2xl font-black text-purple-600 dark:text-purple-400 mt-1 block font-mono">
                          {itemLedgerData.closingStock.toFixed(1)} {itemLedgerData.unit}
                        </span>
                        <span className="text-[11px] text-slate-400 mt-1 block">Loose stock at end of selected period</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-1.5">
                      <Info size={12} className="mt-0.5 shrink-0" />
                      Loose stock in {itemLedgerData.unit}. Dozen/tray sales count in {itemLedgerData.unit}; pre-packed sizes keep their own count and show as pack rows without changing this balance. Raw milk purchases count only after they are allocated to the counter.
                    </p>

                    {/* Movement Audit Table */}
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead className="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-black uppercase text-[11px] border-b border-slate-200 dark:border-slate-700">
                            <tr>
                              <th className="px-4 py-3">Date</th>
                              <th className="px-4 py-3">Reference / Bill #</th>
                              <th className="px-4 py-3">Activity Description</th>
                              <th className="px-4 py-3 text-right text-emerald-600">Stock IN (+)</th>
                              <th className="px-4 py-3 text-right text-red-600">Stock OUT (-)</th>
                              <th className="px-4 py-3 text-right">Running Stock Balance</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {itemLedgerData.list.map((row, idx) => (
                              <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                <td className="px-4 py-2.5 font-medium text-slate-500 dark:text-slate-400">
                                  {formatDate(row.date)}
                                </td>
                                <td className="px-4 py-2.5 font-mono font-bold text-slate-700 dark:text-slate-300">
                                  {row.ref}
                                </td>
                                <td className="px-4 py-2.5 font-semibold text-slate-800 dark:text-slate-200">
                                  {row.desc}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-600">
                                  {row.qtyIn > 0 ? `+${row.qtyIn.toFixed(1)}` : '-'}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono font-bold text-red-600">
                                  {row.qtyOut > 0 ? `-${row.qtyOut.toFixed(1)}` : '-'}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono font-black text-slate-900 dark:text-white">
                                  {row.runningQty.toFixed(1)} {itemLedgerData.unit}
                                </td>
                              </tr>
                            ))}
                            {itemLedgerData.list.length === 0 && (
                              <tr>
                                <td colSpan={6} className="py-12 text-center text-slate-400">
                                  No stock movement recorded for this item in the selected period.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ================================================================
                REPORT 9: LOW STOCK ALERTS & REORDER GUIDE
               ================================================================ */}
            {activeReport === 'low_stock' && (
              <div className="space-y-6">
                {/* Alert Badges */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-red-50/70 dark:bg-red-950/30 p-4 rounded-2xl border border-red-200 dark:border-red-800 shadow-xs">
                    <span className="text-[11px] font-bold text-red-700 dark:text-red-400 uppercase tracking-wider block">Out of Stock</span>
                    <span className="text-2xl font-black text-red-600 dark:text-red-400 mt-1 block font-mono">
                      {lowStockData.outOfStockCount} <span className="text-xs font-semibold">SKUs</span>
                    </span>
                    <span className="text-[11px] text-red-500 mt-1 block">Zero inventory available</span>
                  </div>

                  <div className="bg-amber-50/70 dark:bg-amber-950/30 p-4 rounded-2xl border border-amber-200 dark:border-amber-800 shadow-xs">
                    <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider block">Critical Threshold</span>
                    <span className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1 block font-mono">
                      {lowStockData.criticalCount} <span className="text-xs font-semibold">SKUs</span>
                    </span>
                    <span className="text-[11px] text-amber-500 mt-1 block">Below 40% of safety limit</span>
                  </div>

                  <div className="bg-yellow-50/70 dark:bg-yellow-950/30 p-4 rounded-2xl border border-yellow-200 dark:border-yellow-800 shadow-xs">
                    <span className="text-[11px] font-bold text-yellow-700 dark:text-yellow-400 uppercase tracking-wider block">Low Stock Warning</span>
                    <span className="text-2xl font-black text-yellow-600 dark:text-yellow-400 mt-1 block font-mono">
                      {lowStockData.lowCount} <span className="text-xs font-semibold">SKUs</span>
                    </span>
                    <span className="text-[11px] text-yellow-600 mt-1 block">Approaching reorder point</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Total Attention Needed</span>
                    <span className="text-2xl font-black text-slate-800 dark:text-white mt-1 block font-mono">
                      {lowStockData.allAlertsCount} <span className="text-xs font-semibold">Items</span>
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Requires procurement or production</span>
                  </div>
                </div>

                {/* Alerts Table */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-black uppercase text-[11px] border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th className="px-4 py-3">Product Name</th>
                          <th className="px-4 py-3">Category</th>
                          <th className="px-4 py-3 text-right">Current Stock</th>
                          <th className="px-4 py-3 text-right">Safety Threshold</th>
                          <th className="px-4 py-3 text-right">Shortage Deficit</th>
                          <th className="px-4 py-3 text-right font-black text-lime-600 dark:text-lime-400">Suggested Reorder</th>
                          <th className="px-4 py-3 text-center">Urgency Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {lowStockData.list.map(item => (
                          <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="px-4 py-2.5 font-bold text-slate-800 dark:text-slate-200">
                              {item.name}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                {item.category}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-black text-red-600 dark:text-red-400">
                              {item.currentStock} {item.unit}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-500">
                              {item.threshold} {item.unit}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-bold text-amber-600">
                              {item.shortage} {item.unit}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-black text-lime-600 dark:text-lime-400 text-sm">
                              {item.suggestedReorder} {item.unit}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              {item.status === 'OUT_OF_STOCK' && (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-100 text-red-700 border border-red-200 dark:bg-red-950/60 dark:border-red-800">
                                  Out of Stock
                                </span>
                              )}
                              {item.status === 'CRITICAL' && (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:border-amber-800">
                                  Critical
                                </span>
                              )}
                              {item.status === 'LOW' && (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-yellow-100 text-yellow-700 border border-yellow-200 dark:bg-yellow-950/60 dark:border-yellow-800">
                                  Low Stock
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {lowStockData.list.length === 0 && (
                          <tr>
                            <td colSpan={7} className="py-12 text-center text-emerald-600 font-bold">
                              ✓ All catalog items have healthy stock levels above safety thresholds!
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                REPORT 10: PURCHASE REGISTER (MILK & MATERIALS)
               ================================================================ */}
            {activeReport === 'purchase_register' && (
              <div className="space-y-6">
                {/* KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider block">Raw Milk Collected</span>
                    <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1 block font-mono">
                      {Math.round(purchaseRegisterData.totalMilkLiters)} <span className="text-sm font-bold">Liters</span>
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Morning: {Math.round(purchaseRegisterData.morningLiters)} L • Evening: {Math.round(purchaseRegisterData.eveningLiters)} L</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block">Avg Procurement Rate</span>
                    <span className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1 block font-mono">
                      Rs {purchaseRegisterData.avgRatePerLiter.toFixed(1)} <span className="text-xs font-semibold">/ Liter</span>
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Weighted avg FAT: {purchaseRegisterData.avgFat.toFixed(2)}%</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-purple-600 uppercase tracking-wider block">Total Milk Spend</span>
                    <span className="text-xl sm:text-2xl font-black text-purple-600 dark:text-purple-400 mt-1 block font-mono">
                      {formatCurrency(purchaseRegisterData.totalMilkSpend)}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Direct raw milk payables</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Materials &amp; Supplies</span>
                    <span className="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-200 mt-1 block font-mono">
                      {formatCurrency(purchaseRegisterData.totalMaterialSpend)}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Packaging, bottles &amp; additives</span>
                  </div>
                </div>

                {/* Daily Milk Collection Volume Chart */}
                {purchaseRegisterData.procurementChart.length > 0 && (
                  <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3 print:hidden">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white">Daily Milk Procurement Volumes</h3>
                      <div className="flex items-center gap-3 text-xs font-bold">
                        <span className="flex items-center gap-1 text-blue-600"><span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> Morning Shift (L)</span>
                        <span className="flex items-center gap-1 text-purple-600"><span className="w-2.5 h-2.5 rounded-full bg-purple-500"></span> Evening Shift (L)</span>
                      </div>
                    </div>
                    <div className="h-56 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={purchaseRegisterData.procurementChart} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} />
                          <YAxis stroke="#94a3b8" fontSize={11} width={48} tickFormatter={formatCompactValue} />
                          <RechartsTooltip 
                            contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '11px' }} 
                            formatter={(val: any) => `${Number(val).toFixed(1)} Liters`}
                          />
                          <Bar dataKey="morning" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                          <Bar dataKey="evening" stackId="a" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Purchase Entries Table */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-black uppercase text-[11px] border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Type</th>
                          <th className="px-4 py-3">Supplier / Vendor</th>
                          <th className="px-4 py-3">Shift</th>
                          <th className="px-4 py-3 text-right">Quantity</th>
                          <th className="px-4 py-3 text-right">FAT / SNF</th>
                          <th className="px-4 py-3 text-right">Rate</th>
                          <th className="px-4 py-3 text-right font-black text-slate-900 dark:text-white">Total Amount</th>
                          <th className="px-4 py-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {purchaseRegisterData.entries.map(row => (
                          <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="px-4 py-2.5 whitespace-nowrap font-medium text-slate-500 dark:text-slate-400">
                              {formatDate(row.date)}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                                row.type === 'Milk' 
                                  ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800' 
                                  : 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:border-purple-800'
                              }`}>
                                {row.type}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 font-bold text-slate-800 dark:text-slate-200">
                              {row.supplierName}
                            </td>
                            <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                              {row.shift}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-bold">
                              {row.quantity.toFixed(1)} {row.unit}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-slate-500">
                              {row.type === 'Milk' ? `${row.fat}% / ${row.snf}%` : '-'}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold">
                              {formatCurrency(row.rate)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-black text-slate-900 dark:text-white text-sm">
                              {formatCurrency(row.totalAmount)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs">
                              {row.due === 0 ? (
                                <span className="text-emerald-600 font-bold">Paid</span>
                              ) : (
                                <span className="text-amber-600 font-bold">Due: {formatCurrency(row.due)}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                REPORT 11: SUPPLIER LEDGER & DUES SUMMARY
               ================================================================ */}
            {activeReport === 'supplier_summary' && (
              <div className="space-y-6">
                {/* KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider block">Total Milk Supplied</span>
                    <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1 block font-mono">
                      {Math.round(supplierSummaryData.totalLiters)} <span className="text-sm font-bold">L</span>
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">From {supplierSummaryData.list.length} suppliers</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-purple-600 uppercase tracking-wider block">Total Billed Procurement</span>
                    <span className="text-xl sm:text-2xl font-black text-purple-600 dark:text-purple-400 mt-1 block font-mono">
                      {formatCurrency(supplierSummaryData.totalBilled)}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Gross procurement liabilities</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block">Total Paid to Date</span>
                    <span className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1 block font-mono">
                      {formatCurrency(supplierSummaryData.totalPaid)}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Payments made in period</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-red-600 uppercase tracking-wider block">Total Outstanding Dues</span>
                    <span className="text-xl sm:text-2xl font-black text-red-600 dark:text-red-400 mt-1 block font-mono">
                      {formatCurrency(supplierSummaryData.totalPendingDues)}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Accounts payable to farmers</span>
                  </div>
                </div>

                {/* Suppliers Table */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-black uppercase text-[11px] border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th className="px-4 py-3">Supplier Name</th>
                          <th className="px-4 py-3">Village / Phone</th>
                          <th className="px-4 py-3 text-right">Milk Supplied (L)</th>
                          <th className="px-4 py-3 text-right">Default Rate</th>
                          <th className="px-4 py-3 text-right">Total Billing</th>
                          <th className="px-4 py-3 text-right">Paid to Date</th>
                          <th className="px-4 py-3 text-right font-black text-red-600 dark:text-red-400">Pending Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {supplierSummaryData.list.map(s => (
                          <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="px-4 py-2.5 font-bold text-slate-800 dark:text-slate-200">
                              {s.name}
                            </td>
                            <td className="px-4 py-2.5 text-slate-500">
                              {s.village} • {s.phone}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-bold">
                              {s.milkLiters.toFixed(1)} L
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-500">
                              Rs {s.defaultRate}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold">
                              {formatCurrency(s.totalBilled)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold text-emerald-600">
                              {formatCurrency(s.payments)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-black text-red-600 dark:text-red-400 text-sm">
                              {s.pendingBalance > 0 ? `${formatCurrency(s.pendingBalance)} Due` : 'Rs 0 (Settled)'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                REPORT 12: PRODUCTION YIELD & MANUFACTURING COST
               ================================================================ */}
            {activeReport === 'production_yield' && (
              <div className="space-y-6">
                {/* KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider block">Raw Milk Consumed</span>
                    <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1 block font-mono">
                      {Math.round(productionYieldData.totalInputMilk)} <span className="text-sm font-bold">Liters</span>
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Processed across {productionYieldData.totalBatches} batches</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block">Finished Goods Yield</span>
                    <span className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1 block font-mono">
                      {Math.round(productionYieldData.totalOutputUnits)} <span className="text-xs font-semibold">Units/Kgs</span>
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Average Yield Ratio: {productionYieldData.avgYield.toFixed(1)}%</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider block">Process Loss / Wastage</span>
                    <span className="text-xl sm:text-2xl font-black text-amber-600 dark:text-amber-400 mt-1 block font-mono">
                      {productionYieldData.totalWastage.toFixed(1)} <span className="text-xs font-semibold">L/Kg</span>
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Skimming &amp; thermal evaporation</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <span className="text-[11px] font-bold text-purple-600 uppercase tracking-wider block">Manufactured Value</span>
                    <span className="text-xl sm:text-2xl font-black text-purple-600 dark:text-purple-400 mt-1 block font-mono">
                      {formatCurrency(productionYieldData.totalBatchRevenue)}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-1 block">Total batch sales realization</span>
                  </div>
                </div>

                {/* Batch Yield Chart */}
                {productionYieldData.yieldChart.length > 0 && (
                  <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3 print:hidden">
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white">Batch Output Conversion Yield (%)</h3>
                    <div className="h-56 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={productionYieldData.yieldChart} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis dataKey="batch" stroke="#94a3b8" fontSize={11} />
                          <YAxis stroke="#94a3b8" fontSize={11} width={48} tickFormatter={formatCompactValue} />
                          <RechartsTooltip 
                            contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '11px' }} 
                            formatter={(val: any) => `${Number(val)}% Yield`}
                          />
                          <Bar dataKey="yieldPct" fill="#10b981" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Batches Table */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-black uppercase text-[11px] border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th className="px-4 py-3">Batch #</th>
                          <th className="px-4 py-3">Product Name</th>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3 text-right">Input Milk (L)</th>
                          <th className="px-4 py-3 text-right">Actual Output</th>
                          <th className="px-4 py-3 text-right">Wastage / Loss</th>
                          <th className="px-4 py-3 text-right font-bold text-emerald-600">Yield %</th>
                          <th className="px-4 py-3 text-right font-bold text-slate-900 dark:text-white">Batch Cost</th>
                          <th className="px-4 py-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {productionYieldData.batches.map(b => (
                          <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="px-4 py-2.5 font-mono font-bold text-slate-800 dark:text-slate-200">
                              {b.batchNumber}
                            </td>
                            <td className="px-4 py-2.5 font-bold text-slate-800 dark:text-slate-200">
                              {b.productName}
                            </td>
                            <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                              {formatDate(b.startDate)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-bold">
                              {b.inputMilk.toFixed(1)} L
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-600">
                              {b.actualOut.toFixed(1)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-amber-600">
                              {b.wastage > 0 ? `${b.wastage.toFixed(1)} (${b.wastagePct.toFixed(1)}%)` : '0'}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-black text-emerald-600 text-sm">
                              {b.yieldPct.toFixed(1)}%
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-700 dark:text-slate-300">
                              {formatCurrency(b.totalCost)}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                {b.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {productionYieldData.batches.length === 0 && (
                          <tr>
                            <td colSpan={9} className="py-12 text-center text-slate-400">
                              No manufacturing batches recorded in this date range.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </main>

    </div>
  );
};

export default Reports;
