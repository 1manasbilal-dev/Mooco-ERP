import type {
  AllocationEntry, BankTransaction, CashVariance, Customer, CustomerTransaction, DailySupplyEntry,
  ExpenseEntry, ExpenseVendor, ExpenseVendorTransaction, FinancialAccount, InventoryItem, InventoryLog,
  ItemDefinition, MaterialPurchaseEntry, POSBill, ProductionBatch, PurchaseEntry, RetailClosingEntry,
  ShiftSession, Supplier, SupplierTransaction, SystemSettings, CashRemittance
} from '../../types';

/** Everything a report may read. It is the same live data the rest of the app shows. */
export interface ReportData {
  sales: POSBill[];
  purchases: PurchaseEntry[];
  materialPurchases: MaterialPurchaseEntry[];
  suppliers: Supplier[];
  supplierTransactions: SupplierTransaction[];
  allocations: AllocationEntry[];
  inventory: InventoryItem[];
  items: ItemDefinition[];
  customers: Customer[];
  customerTransactions: CustomerTransaction[];
  dailySupplyEntries: DailySupplyEntry[];
  productionBatches: ProductionBatch[];
  expenses: ExpenseEntry[];
  expenseVendors: ExpenseVendor[];
  expenseVendorTransactions: ExpenseVendorTransaction[];
  accounts: FinancialAccount[];
  bankTransactions: BankTransaction[];
  inventoryLogs: InventoryLog[];
  retailClosings: RetailClosingEntry[];
  shiftSessions: ShiftSession[];
  cashVariances: CashVariance[];
  cashRemittances: CashRemittance[];
  settings: SystemSettings;
  /** Business date of "today" in Pakistan time (YYYY-MM-DD). */
  today: string;
}

export type GroupBy = 'day' | 'week' | 'month';

/** Filters chosen on the toolbar. A report reads only the ones it declares. */
export interface ReportFilters {
  from: string;
  to: string;
  groupBy: GroupBy;
  customerId?: string;
  supplierId?: string;
  itemId?: string;
  accountId?: string;
  category?: string;
  paymentMode?: string;
  cashierId?: string;
  milkType?: string;
  shift?: string;
}

export type FilterKey = 'customerId' | 'supplierId' | 'itemId' | 'accountId' | 'category' | 'paymentMode' | 'cashierId' | 'milkType' | 'shift' | 'groupBy';

export type ColumnFormat = 'text' | 'money' | 'qty' | 'number' | 'percent' | 'date' | 'datetime' | 'badge';
export type Tone = 'good' | 'bad' | 'warn' | 'info' | 'neutral';

export interface ReportColumn {
  key: string;
  label: string;
  format?: ColumnFormat;
  align?: 'left' | 'right' | 'center';
  /** Sum this column in the totals row. */
  total?: boolean;
  /** Hidden until the viewer turns it on. */
  hidden?: boolean;
  /** Unit suffix for qty columns, e.g. "L". */
  unit?: string;
  /** Colour the value: red when negative, green when positive. */
  signed?: boolean;
  /** For badge columns: value -> tone. */
  tones?: Record<string, Tone>;
  /** Narrow, wraps the text. */
  wrap?: boolean;
}

export interface ReportRow {
  [key: string]: unknown;
  /** Opens another report with these filters when the row is clicked. */
  _drill?: { report: string; filters: Partial<ReportFilters>; label?: string };
  /** Row highlight. */
  _tone?: Tone;
  /** Bold subtotal / section row. */
  _strong?: boolean;
}

export interface ReportTable {
  id: string;
  title?: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Extra footer rows (e.g. opening/closing lines). Totals are computed from `total` columns. */
  footer?: ReportRow[];
  showTotals?: boolean;
  emptyText?: string;
  /** Default sort. */
  sort?: { key: string; dir: 'asc' | 'desc' };
  /** Tint numeric cells by size, like a heat map. */
  heat?: boolean;
}

export interface ReportKpi {
  key: string;
  label: string;
  value: number;
  format?: 'money' | 'qty' | 'number' | 'percent';
  unit?: string;
  hint?: string;
  tone?: Tone;
  /** Lower is better (expenses, returns): flips the colour of the change badge. */
  inverse?: boolean;
}

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'stacked' | 'combo';

export interface ReportChartSeries {
  key: string;
  label: string;
  color?: string;
  /** combo charts: draw this series as a line. */
  asLine?: boolean;
}

export interface ReportChart {
  id: string;
  title: string;
  type: ChartType;
  data: Record<string, unknown>[];
  xKey: string;
  series: ReportChartSeries[];
  format?: 'money' | 'qty' | 'number' | 'percent';
  /** Span both columns of the chart grid. */
  wide?: boolean;
}

export interface ReportSectionLine {
  label: string;
  value: number;
  format?: 'money' | 'qty' | 'number' | 'percent';
  indent?: number;
  strong?: boolean;
  tone?: Tone;
  note?: string;
}

/** A statement block (P&L, balance sheet) shown as label/value lines. */
export interface ReportStatement {
  id: string;
  title: string;
  lines: ReportSectionLine[];
}

export interface ReportNote {
  tone: Tone;
  text: string;
}

export interface ReportResult {
  kpis?: ReportKpi[];
  charts?: ReportChart[];
  statements?: ReportStatement[];
  tables?: ReportTable[];
  notes?: ReportNote[];
  /** Short insight lines ("Best day: ..."). */
  insights?: string[];
}

export type ReportCategory = 'overview' | 'sales' | 'financial' | 'customers' | 'milk' | 'suppliers' | 'inventory' | 'production' | 'expenses' | 'cash';

export interface ReportDefinition {
  id: string;
  title: string;
  subtitle: string;
  category: ReportCategory;
  /** lucide icon name, resolved by the UI. */
  icon: string;
  keywords?: string[];
  /** Needs the "reports:financial" permission (profit, balances). */
  financial?: boolean;
  filters?: FilterKey[];
  /** A filter that must be chosen before the report can run. */
  requires?: FilterKey;
  /** The report shows the position today, not a date range. */
  snapshot?: boolean;
  /** Initial date preset when this report is opened. */
  defaultPreset?: string;
  /** Show the previous-period comparison on KPIs. */
  comparable?: boolean;
  build: (data: ReportData, filters: ReportFilters) => ReportResult;
}
