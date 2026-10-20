
export enum PriorityLevel {
  LOW = 'Low',
  MEDIUM = 'Medium',
  HIGH = 'High',
  URGENT = 'Urgent'
}

export enum MilkType {
  BUFFALO = 'Buffalo',
  COW = 'Cow',
  MIXED = 'Mixed'
}

export enum Shift {
  MORNING = 'Morning',
  EVENING = 'Evening'
}

export enum StockType {
  UNALLOCATED = 'Unallocated',
  FINISHED_GOODS = 'Finished Goods',
  RETAIL_STOCK = 'Retail Stock',
  PACKAGING = 'Packaging',
  RAW_MATERIAL = 'Raw Material'
}

export enum AllocationStatus {
  UNALLOCATED = 'Unallocated',
  PARTIALLY_ALLOCATED = 'Partially Allocated',
  FULLY_ALLOCATED = 'Fully Allocated',
  ALLOCATED_FOR_SUPPLY = 'Allocated for Supply',
  COMPLETED = 'Completed'
}

export enum ProductionStage {
  PROCESSING = 'Processing',
  QUALITY = 'Quality Check',
  PACKAGING = 'Packaging',
  COMPLETED = 'Completed',
  CANCELLED = 'Cancelled'
}

export enum DestinationType {
  RETAIL = 'Retail Counter',
  SUPPLY = 'Home Delivery',
  PRODUCTION = 'Production'
}

export enum RateType {
  FIXED = 'Fixed Rate',
  FAT_SNF = 'Fat/SNF Based'
}

export enum PurchaseType {
  MILK = 'Milk',
  RAW_MATERIAL = 'Raw Material',
  FINISHED_GOODS = 'Finished Goods'
}

export enum AdjustmentReason {
  DATA_ENTRY_ERROR = 'Data Entry Error',
  SPOILAGE = 'Spoilage / Wastage',
  INTERNAL_USE = 'Internal Consumption',
  THEFT_LOSS = 'Theft / Loss',
  STOCK_COUNT = 'Stock Count Correction',
  SUPPLY_RETURN = 'Supply Return',
  SALES_RETURN = 'Sales Return',
  PRODUCTION_CANCEL = 'Production Cancellation',
  PRODUCTION_USAGE = 'Production Usage'
}

export type ProductSource = 'Supplier' | 'Production' | 'Both';
export type ItemType = 'Raw material' | 'Packaging material' | 'Sale product';

export enum EmployeeRole {
  WORKER = 'Worker',
  MANAGER = 'Manager',
  DRIVER = 'Driver',
  SALES = 'Salesman'
}

export enum AttendanceStatus {
  PRESENT = 'Present',
  ABSENT = 'Absent',
  HALF_DAY = 'Half Day',
  LEAVE = 'Leave',
  LATE = 'Late'
}

export type AccountType = 'Cash' | 'Bank' | 'Wallet' | 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense';

export interface SecuritySettings {
  /** Books are closed on and before this date (YYYY-MM-DD): no new, edited or deleted entries. */
  lockDate?: string;
  /** Lock the terminal after this many idle minutes; 0 or empty = never. */
  autoLockMinutes?: number;
  /** Highest bill discount (% of the bill) a cashier may give without a manager PIN; empty = no limit. */
  maxDiscountPercent?: number;
  /** Every sales return needs a manager PIN, even from staff who may process returns. */
  returnNeedsApproval?: boolean;
}

export interface SystemSettings {
  general: {
    companyName: string;
    address: string;
    phone: string;
    email: string;
    /** NTN / sales-tax registration, printed on receipts when set. */
    taxId: string;
    shifts?: string[];
  };
  financial: {
    defaultCashAccountId: string;
    defaultDigitalAccountId: string;
  };
  sales: {
    invoicePrefix: string;
    invoiceFooter: string;
    showPosSearch?: boolean;
    showPosCategories?: boolean;
  };
  inventory: {
    allowNegativeStock: boolean;
    customUnits?: UnitDefinition[];
  };
  security?: SecuritySettings;
  expenses?: {
    inactiveCategories?: string[];
    inactiveSubcategories?: string[];
    deletedCategories?: string[];
    deletedSubcategories?: string[];
    renamedCategories?: Record<string, string>;
    renamedSubcategories?: Record<string, string>;
    savedExpenses?: SavedExpense[];
  };
}

export interface PurchaseEntry {
  id: string;
  supplier_id: string;
  supplier_name?: string;
  date: string;
  shift: Shift | string;
  milk_type: MilkType;
  quantity: number;
  rate: number;
  fat?: number;
  snf?: number;
  total_amount: number;
  paid_amount?: number;
  due_amount?: number;
  payment_mode?: string;
  account_id?: string;
  status: string;
  return_reason?: string;
  returned_at?: string;
  details?: any;
  business_day_id?: string;
  shift_session_id?: string;
  drawer_id?: string;
  cashier_id?: string;
  created_at?: string;
}

export interface MaterialPurchaseEntry {
  id: string;
  date: string;
  supplier_id: string;
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  rate: number;
  total_amount: number;
  purchase_type: PurchaseType;
  status: string;
  business_day_id?: string;
  shift_session_id?: string;
  drawer_id?: string;
  cashier_id?: string;
  created_at?: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  whatsapp?: string;
  village?: string;
  address?: string;
  city?: string;
  rate_type: RateType;
  default_rate: number;
  pending_balance: number;
  balance?: number;
  supplier_types: string[]; 
  payment_term?: string;
  last_purchase_date?: string;
  total_purchases?: number;
  paid_amount?: number;
  notes?: string;
  isActive: boolean;
  default_milk_type?: MilkType | string;
}

export interface InventoryItem {
  id: string;
  item_id?: string;
  name: string;
  category: string;
  stock_type: StockType;
  quantity: number;
  unit: string;
  price: number;
  variant_stocks?: Record<string, number>; // New field
}

export interface AllocationEntry {
  id: string;
  purchase_id: string;
  date: string;
  supplier_name: string;
  milk_type: MilkType | string;
  original_quantity: number;
  allocated_quantity: number | null;
  remaining_quantity: number | null;
  status: AllocationStatus | string | null;
  destination?: DestinationType;
  average_rate?: number;
  destination_details?: {
    customer_id?: string;
    customer_name?: string;
    route?: string;
  };
  details?: any;
}

export interface ProductionBatch {
  id: string;
  batch_number: string;
  product_name: string;
  status: ProductionStage;
  priority: PriorityLevel;
  quantity_input: number;
  input_cost_per_unit?: number;
  quantity_output_estimated: number;
  quantity_output_actual?: number;
  wastage: number;
  start_date: string;
  completed_date?: string;
  logs: { stage: ProductionStage; message: string; timestamp: string }[];
  output_breakdown?: {
    loose_qty: number;
    variants: { variant_name: string; count: number; base_qty_each: number; total_base_qty: number; variantId?: string }[];
  };
  financials?: {
    milk_cost: number;
    additives_cost: number;
    packaging_cost?: number;
    total_cost: number;
    sales_value: number;
    gross_profit: number;
  };
  details?: any;
}

export interface POSBill {
  id: string;
  bill_number: string;
  date: string;
  customer_name?: string;
  customer_id?: string;
  subtotal: number;
  discount: number;
  total: number;
  payment_mode: 'Cash' | 'Online' | 'Credit';
  status: 'Completed' | 'Returned';
  shift_session_id?: string;
  shift_name?: string;
  business_day_id?: string;
  drawer_id?: string;
  cashier_id?: string;
  cashier_name?: string;
  return_reason?: string;
  returned_at?: string;
  refund_amount?: number;
  return_type?: 'refund' | 'replace';
  restock_action?: 'restock' | 'scrap_spoilage';
  items: {
    itemId?: string;
    name: string;
    qty: number;
    price: number;
    total: number;
    variantId?: string; // New field
  }[];
  paid_amount?: number;
  due_amount?: number;
  details?: any;
}

export interface Customer {
  id: string;
  name: string;
  type?: string;
  phone: string;
  whatsapp?: string;
  is_phone_whatsapp?: boolean;
  secondary_phone?: string;
  is_secondary_whatsapp?: boolean;
  additional_phones?: { phone: string; is_whatsapp?: boolean; label?: string }[];
  address?: string;
  city?: string;
  route?: string;
  daily_contract_qty?: number;
  default_rate?: number;
  balance: number;
  credit_limit?: number;
  custom_prices?: Record<string, number>;
  notes?: string;
  isActive: boolean;
}

export type CustomerOrderStatus = 'Pending' | 'Confirmed' | 'Ready' | 'Completed' | 'Cancelled';
export type CustomerOrderPaymentStatus = 'Unpaid' | 'Partial' | 'Paid';
export type CustomerOrderPaymentMode = 'Cash' | 'Online' | 'Bank' | 'Unpaid';

export interface CustomerOrderLine {
  itemId: string;
  name: string;
  qty: number;
  price: number;
  unit: string;
  variantId?: string;
  variantName?: string;
}

export interface CustomerOrder {
  id: string;
  order_number: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  fulfillment: 'Pickup' | 'Delivery';
  due_date: string;
  due_time: string;
  address: string;
  notes: string;
  items: CustomerOrderLine[];
  subtotal: number;
  discount: number;
  total: number;
  advance_paid?: number;
  /** Part of advance_paid already posted to the customer khata and an account (set by the server). */
  advance_posted?: number;
  payment_mode?: CustomerOrderPaymentMode;
  payment_status?: CustomerOrderPaymentStatus;
  payment_notes?: string;
  status: CustomerOrderStatus;
  revision: number;
  sale_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface DailySupplyEntry {
  id: string;
  date: string;
  shift: Shift;
  route: string;
  customer_id: string;
  customer_name: string;
  allocation_id: string;
  allocated_qty: number;
  delivered_qty: number;
  returned_qty: number;
  net_qty: number;
  rate: number;
  total_amount: number;
  payment_received: number;
  payment_mode: string;
  status: 'Completed' | 'Pending';
  business_day_id?: string;
  shift_session_id?: string;
  drawer_id?: string;
  cashier_id?: string;
}

export interface RetailClosingItem {
  product_id?: string;
  product_name: string;
  variant_id?: string;
  variant_name?: string;
  unit?: string;
  price?: number;
  system_qty: number;
  physical_qty: number;
  difference: number;
  pos_sold_qty?: number;
  wastage_qty?: number;
  spoilage_qty?: number;
  internal_use_qty?: number;
  calculated_sold_qty?: number;
  unrecorded_sold_qty?: number;
  calculated_revenue?: number;
  unrecorded_revenue?: number;
  loss_value?: number;
}

export interface RetailClosingCashReconciliation {
  opening_cash?: number;
  pos_cash_sales?: number;
  customer_cash_payments?: number;
  purchases_cash_paid?: number;
  expenses_cash_paid?: number;
  unrecorded_cash_sales?: number;
  expected_total_cash?: number;
  actual_physical_cash?: number;
  cash_difference?: number;
  difference_reason?: string;
  account_id?: string;
  account_name?: string;
  cashier_id?: string;
  cashier_name?: string;
  handover_to?: string;
  denominations?: Record<string | number, number>;
}

export interface ShiftSession {
  id: string;
  date: string; // YYYY-MM-DD
  shift_name: 'Morning' | 'Evening' | 'Night' | string;
  user_id: string;
  user_name: string;
  role_name?: string;
  account_id?: string; // Linked Cash Drawer Account
  account_name?: string;
  opening_float: number;
  start_time: string;
  end_time?: string;
  business_day_id?: string;
  business_date?: string; // YYYY-MM-DD (Pakistan business day the shift belongs to)
  drawer_id?: string;
  drawer_name?: string;
  opening_source?: 'Head Float' | 'Drawer Handover' | 'Carry Forward' | 'Manual Adjustment' | string;
  opening_declared?: number;
  opening_counted?: number;
  opening_variance?: number;
  opening_denominations?: Record<string | number, number>;
  started_at?: string;
  status: 'Pending Acceptance' | 'Active' | 'Closing' | 'Pending Review' | 'Closed' | 'Force Closed';
  // Financial Summary at closing
  gross_sales?: number;
  cash_sales?: number;
  online_sales?: number;
  credit_sales?: number;
  bills_count?: number;
  khata_cash_recovered?: number;
  drawer_expenses_paid?: number;
  spot_purchases_paid?: number;
  expected_drawer_cash?: number;
  actual_physical_cash?: number;
  cash_difference?: number;
  difference_reason?: string;
  handover_to?: string;
  denominations?: Record<string | number, number>;
  stock_items?: RetailClosingItem[];
  notes?: string;
  created_at?: string;
  closed_at?: string;
  closing_started_at?: string;
  closing_counted_cash?: number;
  closing_variance?: number;
  closing_denominations?: Record<string | number, number>;
  leave_in_drawer?: number;
  remit_to_head?: number;
}

export type BusinessDayStatus = 'Open' | 'Pending Close' | 'Ready to Close' | 'Closed' | 'Reopened';

export interface BusinessDay {
  id: string;
  business_date: string;
  status: BusinessDayStatus;
  opened_at: string;
  opened_by?: string;
  pending_at?: string;
  closed_at?: string;
  closed_by?: string;
  cash_closed_at?: string;
  stock_closed_at?: string;
  reopened_at?: string;
  reopened_by?: string;
  reopen_reason?: string;
  notes?: string;
  summary?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface CashDrawer {
  id: string;
  name: string;
  code: string;
  account_id?: string;
  location?: string;
  is_active: boolean;
  default_float: number;
  settings?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export type CashHandoverStatus = 'Pending' | 'Accepted' | 'Disputed' | 'Resolved' | 'Cancelled';

export interface CashHandover {
  id: string;
  business_day_id: string;
  drawer_id: string;
  from_shift_id: string;
  to_shift_id?: string;
  from_user_id: string;
  from_user_name: string;
  accepted_by_user_id?: string;
  accepted_by_user_name?: string;
  declared_amount: number;
  counted_amount?: number;
  variance?: number;
  declared_denominations?: Record<string | number, number>;
  accepted_denominations?: Record<string | number, number>;
  status: CashHandoverStatus;
  declared_at: string;
  accepted_at?: string;
  resolved_at?: string;
  resolution_notes?: string;
}

export type CashRemittanceStatus = 'Pending' | 'Accepted' | 'Disputed' | 'Resolved' | 'Rejected';

export interface CashRemittance {
  id: string;
  business_day_id: string;
  drawer_id: string;
  shift_id: string;
  cashier_id: string;
  cashier_name: string;
  declared_amount: number;
  counted_amount?: number;
  variance?: number;
  declared_denominations?: Record<string | number, number>;
  counted_denominations?: Record<string | number, number>;
  status: CashRemittanceStatus;
  bag_reference?: string;
  destination_account_id?: string;
  accepted_by_user_id?: string;
  accepted_by_user_name?: string;
  declared_at: string;
  accepted_at?: string;
  resolved_at?: string;
  notes?: string;
}

export interface CashVariance {
  id: string;
  business_day_id: string;
  shift_id?: string;
  handover_id?: string;
  remittance_id?: string;
  variance_type: 'Opening Handover' | 'Opening Mismatch' | 'Shift Closing' | 'Head Remittance';
  expected_amount: number;
  counted_amount: number;
  variance: number;
  reason?: string;
  status: 'Open' | 'Approved' | 'Adjusted' | 'Rejected';
  reported_by?: string;
  resolved_by?: string;
  resolved_at?: string;
  resolution_notes?: string;
  created_at: string;
}

export interface ShiftCashEvent {
  id: string;
  business_day_id: string;
  shift_id?: string;
  drawer_id?: string;
  event_type: string;
  direction: 'In' | 'Out' | 'Neutral';
  amount: number;
  payment_mode?: string;
  source_type?: string;
  source_id?: string;
  description?: string;
  occurred_at: string;
  created_by?: string;
  metadata?: Record<string, any>;
}

export interface DayClosingEntry {
  id: string;
  date: string; // YYYY-MM-DD
  closed_by_user_id: string;
  closed_by_user_name: string;
  closed_at: string;
  status: 'Locked' | 'Closed';
  // Shifts Summary Included
  shifts_count: number;
  shift_ids: string[];
  // Consolidated Sales & Tenders
  gross_sales: number;
  total_discount: number;
  total_refunds: number;
  net_sales: number;
  bills_count: number;
  cash_sales_total: number;
  online_sales_total: number;
  credit_sales_total: number;
  khata_wasooli_total: number;
  drawer_expenses_total: number;
  spot_purchases_total: number;
  // Vault & Safe Cash Drop
  total_cash_in_drawers: number;
  retained_float_for_tomorrow: number;
  cash_drop_amount: number;
  deposit_account_id?: string;
  deposit_account_name?: string;
  journal_entry_id?: string;
  // Milk Mass-Balance Summary
  raw_milk_purchased_liters?: number;
  raw_milk_cost_total?: number;
  milk_sold_retail_liters?: number;
  milk_delivered_liters?: number;
  milk_processed_liters?: number;
  milk_wastage_liters?: number;
  notes?: string;
}

export interface RetailClosingEntry {
  id: string;
  date: string;
  shift?: string;
  shift_session_id?: string;
  status: string;
  items: RetailClosingItem[];
  cash_reconciliation?: RetailClosingCashReconciliation;
  total_revenue?: number;
  total_unrecorded_revenue?: number;
  total_loss_value?: number;
  auto_posted_sale_id?: string;
  notes?: string;
  created_at?: string;
  details?: any;
}

export interface CustomerTransaction {
  id: string;
  customer_id: string;
  date: string;
  type: 'Charge' | 'Payment' | 'Return';
  amount: number;
  mode?: string;
  note?: string;
  business_day_id?: string;
  shift_session_id?: string;
  drawer_id?: string;
  cashier_id?: string;
  created_at?: string;
}

export interface SupplierTransaction {
  id: string;
  supplier_id: string;
  date: string;
  type: 'Payment' | 'Advance' | 'Supply';
  amount: number;
  mode: string;
  note?: string;
  created_at?: string;
}

export interface UnitDefinition {
  id: string;
  name: string;
  symbol: string;
  factor: number;
  isBase: boolean;
  type?: 'Volume' | 'Mass' | 'Count';
  description?: string;
  urduName?: string;
  isSystem?: boolean;
}

export interface UnitGroup {
  id: string;
  name: string;
  baseUnitSymbol: string;
  units: UnitDefinition[];
}

export interface RecipeIngredient {
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  type: 'Ingredient' | 'Packaging';
}

export interface ItemVariant {
  id: string;
  name: string;
  packaging_item_id: string;
  packaging_item_name?: string;
  packaging_qty: number;
  quantity_in_base_unit: number;
  selling_price?: number;
  /** True: selling 1 of this unit removes quantity_in_base_unit from main stock. False/missing: it removes 1 packed unit. */
  deduct_from_base?: boolean;
  isActive: boolean;
}

export interface ItemDefinition {
  id: string;
  name: string;
  category: string[];
  item_type: ItemType[];
  unit: string;
  unit_group_id?: string;
  source: ProductSource;
  cost_price: number;
  selling_price: number;
  reorder_level: number;
  description?: string;
  isActive: boolean;
  isSystem?: boolean;
  recipe?: RecipeIngredient[];
  recipe_base_item_id?: string;
  recipe_base_quantity?: number;
  recipe_expected_output?: number;
  variants?: ItemVariant[];
  variant_stocks?: Record<string, number>; // New field for specific variant inventory
  quick_amounts?: number[]; // Custom POS amount shortcuts (e.g. [50, 100, 150, 200])
  pos_primary_mode?: 'amount' | 'qty'; // 'amount' = Rupee Hero Priority, 'qty' = Quantity Hero Priority
  allow_loose_sale?: boolean; // If false, item can only be sold as pre-packaged variants (e.g. Kheer pack)
  image_url?: string; // Product photo URL or optimized base64 data URL
  sort_order?: number; // POS Grid display sequence number (1, 2, 3...)
}

export interface ExpenseEntry {
  id: string;
  date: string;
  category: string;
  subcategory?: string;
  description: string;
  amount: number;
  paidAmount: number;
  paymentStatus?: 'Paid' | 'Partial' | 'Unpaid';
  dueDate?: string;
  account_id?: string;
  account_name?: string;
  vendor_id?: string;
  vendor_name?: string;
  paymentMode: string;
  referenceNo?: string;
  attachmentUrl?: string;
  notes?: string;
  isRecurring?: boolean;
  linkedRecurringId?: string;
  business_day_id?: string;
  shift_session_id?: string;
  drawer_id?: string;
  cashier_id?: string;
  created_at?: string;
}

export interface SavedExpense {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  description: string;
  amount: number;
  paidAmount: number;
  paymentStatus: 'Paid' | 'Partial' | 'Unpaid';
  paymentMode: string;
  account_id?: string;
  vendor_id?: string;
  vendor_name?: string;
  notes?: string;
}

export interface RecurringExpense {
  id: string;
  name: string;
  description?: string;
  amount: number;
  category: string;
  subcategory?: string;
  frequency: 'Monthly' | 'Weekly' | 'Yearly';
  vendor_id?: string;
  vendor_name?: string;
  isActive: boolean;
  startDate: string;
  lastProcessedDate?: string;
  reminderDays: number;
  autoCreate: boolean;
  notes?: string;
}

export interface ExpenseVendor {
  id: string;
  name: string;
  service_type: string;
  phone?: string;
  contact_person?: string;
  address?: string;
  notes?: string;
  total_paid: number;
  total_billed?: number;
  pending_balance?: number;
  opening_balance?: number;
  bank_name?: string;
  account_number?: string;
  iban?: string;
  isActive?: boolean;
}

export interface ExpenseVendorTransaction {
  id: string;
  vendor_id: string;
  vendor_name?: string;
  date: string;
  type: 'Bill' | 'Payment' | 'Opening Balance' | 'Adjustment' | 'Refund';
  amount: number;
  paid_amount?: number;
  balance_after?: number;
  payment_mode?: string;
  account_id?: string;
  account_name?: string;
  reference_no?: string;
  note?: string;
  expense_id?: string;
}

export interface Employee {
  id: string;
  name: string;
  phone: string;
  role: EmployeeRole;
  salary_type: 'Monthly' | 'Daily';
  base_salary: number;
  pay_day: number;
  join_date: string;
  isActive: boolean;
  balance: number;
}

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  date: string;
  status: AttendanceStatus;
}

export interface EmployeeTransaction {
  id: string;
  employee_id: string;
  date: string;
  type: 'Salary Credit' | 'Payment' | 'Advance' | 'Bonus' | 'Deduction';
  amount: number;
  mode?: 'Cash' | 'Bank Transfer' | 'System';
  note?: string;
}

export interface InventoryLog {
  id: string;
  date: string;
  item_id: string;
  item_name: string;
  old_quantity: number;
  new_quantity: number;
  difference: number;
  reason: AdjustmentReason | string;
  notes?: string;
}

export interface FinancialAccount {
  id: string;
  name: string;
  type: 'Cash' | 'Bank' | 'Wallet';
  balance: number;
  account_number?: string;
  bank_name?: string;
  is_default?: boolean;
  /** Cash accounts only: enabled to act as a Cash Drawer (shifts, handovers,
   *  remittances). Only isDrawer Cash accounts appear in drawer lists. */
  isDrawer?: boolean;
  isActive: boolean;
}

export interface BankTransaction {
  id: string;
  date: string;
  account_id: string;
  related_account_id?: string;
  type: 'Deposit' | 'Withdrawal' | 'Transfer_In' | 'Transfer_Out' | 'Income' | 'Expense' | 'Journal';
  category?: string;
  amount: number;
  description: string;
  reference_id?: string;
  business_day_id?: string;
  shift_session_id?: string;
  drawer_id?: string;
  cashier_id?: string;
  created_at?: string;
}

export interface ManualAccount {
  id: string;
  name: string;
  type: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense';
  balance: number;
  description?: string;
  parentId?: string;
  isActive?: boolean;
}

export interface JournalLine {
  id: string;
  accountId: string;
  accountName: string;
  accountType: string;
  debit: number;
  credit: number;
  description?: string;
}

export interface JournalEntry {
  id: string;
  date: string;
  referenceNo?: string;
  narration: string;
  lines: JournalLine[];
  totalAmount: number;
  createdAt: string;
}

// --- Role-Based Access Control (RBAC) & User Management ---

export type PermissionModule =
  | 'dashboard'
  | 'purchase'
  | 'allocation'
  | 'pos'
  | 'sales_history'
  | 'customer_orders'
  | 'retail_stock'
  | 'cash_control'
  | 'production'
  | 'items'
  | 'inventory'
  | 'customers'
  | 'suppliers'
  | 'expenses'
  | 'bank_cash'
  | 'accounts'
  | 'reports'
  | 'settings'
  | 'user_management';

export interface AppRole {
  id: string;
  name: string;
  description?: string;
  is_system?: boolean;
  permissions: (PermissionModule | string)[];
  created_at?: string;
}

export interface AppUser {
  id: string;
  name: string;
  username: string;
  /** Never populated on the client: PINs are hashed server-side and only ever
   *  verified through the app_login / app_verify_pin RPCs. Optional so callers
   *  can pass a new PIN into addUser/updateUser (it is stripped before state). */
  pin?: string;
  role_id: string;
  phone?: string;
  is_active: boolean;
  /** Extra module accesses granted directly on this user (merged with the
   *  role's permissions, e.g. ["cash_control"]). */
  permissions?: string[];
  avatar?: string;
  last_login?: string;
  created_at?: string;
}

export interface UserSession {
  user: AppUser;
  role: AppRole;
  loginTime: string;
}
