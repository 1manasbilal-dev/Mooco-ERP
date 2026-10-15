
import React, { createContext, useContext, useState, useEffect, useMemo, useRef, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { db, generateUUID, generateInvoiceNumber, LocalOrder, LocalOrderItem, LocalCustomer, OutboxActionType, roundCurrency, roundQuantity } from '../lib/db';
import { actionLock } from '../lib/actionLock';
import { loadRead, withDeadline } from '../lib/loadRequest';
import { saleItemSnapshot } from '../lib/saleSnapshot';
import { syncService } from '../lib/syncService';
import { isPermanentSyncError } from '../lib/syncErrors';
import { currentEpoch, emptyBases, mapCatalogCache, noteLocalWrite, projectLedger, readUnsyncedWork, toCustomer, toPosBill } from '../lib/unsyncedProjection';
import {
  adjustAccountBalance, adjustCustomerBalance, adjustSupplierBalance,
  adjustItemStock, adjustExpenseVendorStats, transferBetweenAccounts,
  procureMilkIntake, recordSupplierPaymentEffects, recordExpenseEffects
} from '../lib/atomic';
import { useToast } from './ToastContext';
import { normalizeTransactionTimestamp, formatTransactionTime } from '../lib/formatters';
import { netPurchaseReturnRefunds, proportionalRefund, salePaidAmount, splitRefund } from '../lib/moneyFlow';
import { buildStandardUnitGroups } from '../lib/unitConversion';
import { 
  PriorityLevel, MilkType, Shift, StockType, AllocationStatus, ProductionStage, DestinationType, 
  RateType, PurchaseType, AdjustmentReason, ProductSource, ItemType, EmployeeRole, AttendanceStatus, 
  AccountType, SystemSettings, PurchaseEntry, MaterialPurchaseEntry, Supplier, InventoryItem, 
  AllocationEntry, ProductionBatch, POSBill, Customer, DailySupplyEntry, RetailClosingEntry, 
  CustomerTransaction, SupplierTransaction, UnitDefinition, UnitGroup, RecipeIngredient, ItemVariant, 
  ItemDefinition, ExpenseEntry, RecurringExpense, ExpenseVendor, ExpenseVendorTransaction, Employee, AttendanceRecord, 
  EmployeeTransaction, InventoryLog, FinancialAccount, BankTransaction, ManualAccount, JournalLine, JournalEntry,
  AppUser, AppRole, PermissionModule, UserSession, ShiftSession, DayClosingEntry,
  BusinessDay, CashDrawer, CashHandover, CashHandoverStatus, CashRemittance, CashVariance, ShiftCashEvent
} from '../types';

export const DEFAULT_SYSTEM_ROLES: AppRole[] = [
  {
    id: 'role_super_admin',
    name: 'Super Admin / Owner',
    description: 'Full unrestricted access to all modules, settings, reports, and user administration.',
    is_system: true,
    permissions: ['dashboard', 'purchase', 'allocation', 'pos', 'sales_history', 'customer_orders', 'retail_stock', 'cash_control', 'production', 'items', 'inventory', 'customers', 'suppliers', 'expenses', 'bank_cash', 'accounts', 'reports', 'settings', 'user_management']
  },
  {
    id: 'role_manager',
    name: 'Manager / Accountant',
    description: 'Access to financial management, bills, khata ledgers, and reports.',
    is_system: true,
    permissions: ['dashboard', 'purchase', 'allocation', 'pos', 'sales_history', 'customer_orders', 'retail_stock', 'cash_control', 'production', 'items', 'inventory', 'customers', 'suppliers', 'expenses', 'bank_cash', 'accounts', 'reports']
  },
  {
    id: 'role_cashier',
    name: 'POS Cashier',
    description: 'Point of Sale billing, sales history, returns, and counter daily closing.',
    is_system: true,
    permissions: ['pos', 'sales_history', 'customer_orders', 'retail_stock', 'cash_control', 'customers']
  },
  {
    id: 'role_procurement',
    name: 'Milk Procurement Incharge',
    description: 'Milk collection intake, material purchases, allocation, and supplier ledger.',
    is_system: true,
    permissions: ['purchase', 'allocation', 'suppliers']
  },
  {
    id: 'role_production',
    name: 'Production Supervisor',
    description: 'Milk processing batches, recipe management, and inventory stock.',
    is_system: true,
    permissions: ['allocation', 'production', 'inventory', 'items']
  }
];

export const DEFAULT_SYSTEM_MANUAL_ACCOUNTS: Array<{
  id: string;
  name: string;
  type: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense';
  balance: number;
  is_active: boolean;
  details: {
    is_system: boolean;
    parentId?: string;
    description?: string;
  };
}> = [
  {
    id: 'ma_owner_capital',
    name: 'Owner Capital / Investment',
    type: 'Equity',
    balance: 0,
    is_active: true,
    details: {
      is_system: true,
      parentId: 'sys_eq_cap_group',
      description: 'Capital and equity funds invested into the business by the owner.'
    }
  },
  {
    id: 'ma_owner_drawings',
    name: 'Owner Drawings / Personal Use',
    type: 'Equity',
    balance: 0,
    is_active: true,
    details: {
      is_system: true,
      parentId: 'sys_eq_draw_group',
      description: 'Cash or funds drawn from the business by the owner for personal use.'
    }
  },
  {
    id: 'ma_bank_loan',
    name: 'Bank Loan / Borrowing',
    type: 'Liability',
    balance: 0,
    is_active: true,
    details: {
      is_system: true,
      parentId: '2400',
      description: 'Principal loan borrowed from bank or commercial lender.'
    }
  },
  {
    id: 'ma_director_loan',
    name: 'Director / Partner Loan',
    type: 'Liability',
    balance: 0,
    is_active: true,
    details: {
      is_system: true,
      parentId: '2400',
      description: 'Temporary loans or Qarz-e-Hasana from directors or partners.'
    }
  },
  {
    id: 'ma_machinery_equipment',
    name: 'Machinery & Dairy Equipment',
    type: 'Asset',
    balance: 0,
    is_active: true,
    details: {
      is_system: true,
      parentId: '1400',
      description: 'Chillers, separators, milking units, and processing machines.'
    }
  },
  {
    id: 'ma_furniture_fixtures',
    name: 'Furniture & Shop Fixtures',
    type: 'Asset',
    balance: 0,
    is_active: true,
    details: {
      is_system: true,
      parentId: '1400',
      description: 'Counters, racks, cold display, signage, and furniture.'
    }
  },
  {
    id: 'ma_other_income',
    name: 'Other / Miscellaneous Income',
    type: 'Income',
    balance: 0,
    is_active: true,
    details: {
      is_system: true,
      parentId: '4000',
      description: 'Incidental revenue, scrap sales, commissions, or rebates.'
    }
  }
];



interface DairyContextType {
  // Users & RBAC Data & State
  users: AppUser[];
  roles: AppRole[];
  currentUser: AppUser | null;
  currentRole: AppRole | null;
  isUserSwitcherOpen: boolean;
  /** True only while operator access is being verified. */
  isBooting: boolean;
  sessionError: string | null;
  isDataLoading: boolean;
  hasLoadedData: boolean;
  dataLoadError: string | null;
  retryLoading: () => Promise<void>;
  setIsUserSwitcherOpen: (open: boolean) => void;
  loginWithCredentials: (username: string, pin: string) => Promise<{ success: boolean; message?: string; user?: AppUser }>;
  switchUserWithPin: (pin: string) => Promise<{ success: boolean; message?: string; user?: AppUser }>;
  switchUserByIdAndPin: (userId: string, pin: string) => Promise<{ success: boolean; message?: string; user?: AppUser }>;
  setCurrentUserDirectly: (user: AppUser) => void;
  logoutUser: () => void;
  addUser: (userData: Omit<AppUser, 'id'>) => Promise<boolean>;
  updateUser: (id: string, updates: Partial<AppUser>) => Promise<boolean>;
  deleteUser: (id: string) => Promise<boolean>;
  createRole: (roleData: Omit<AppRole, 'id'>) => Promise<boolean>;
  updateRole: (id: string, updates: Partial<AppRole>) => Promise<boolean>;
  deleteRole: (id: string) => Promise<boolean>;
  hasPermission: (moduleKey: PermissionModule | string) => boolean;
  canPerform: (moduleKey: string, action?: string) => boolean;

  // Data
  purchases: PurchaseEntry[];
  materialPurchases: MaterialPurchaseEntry[];
  suppliers: Supplier[];
  allocations: AllocationEntry[];
  inventory: InventoryItem[];
  items: ItemDefinition[];
  sales: POSBill[];
  customers: Customer[];
  productionBatches: ProductionBatch[];
  expenses: ExpenseEntry[];
  recurringExpenses: RecurringExpense[];
  expenseVendors: ExpenseVendor[];
  expenseVendorTransactions: ExpenseVendorTransaction[];
  accounts: FinancialAccount[];
  bankTransactions: BankTransaction[];
  manualAccounts: ManualAccount[];
  journalEntries: JournalEntry[];
  settings: SystemSettings;
  categories: string[];
  unitGroups: UnitGroup[];
  retailClosings: RetailClosingEntry[];
  shiftSessions: ShiftSession[];
  dayClosings: DayClosingEntry[];
  activeShiftSession: ShiftSession | null;
  businessDays: BusinessDay[];
  cashDrawers: CashDrawer[];
  cashHandovers: CashHandover[];
  cashRemittances: CashRemittance[];
  cashVariances: CashVariance[];
  shiftCashEvents: ShiftCashEvent[];
  /** Cash submitted to head at shift close but not yet received into any
   *  account — "darmiyan" / pending receive. Out of the drawer, in no account. */
  cashInTransit: { count: number; amount: number };
  refreshCashControl: () => Promise<void>;
  getShiftTotals: (shiftId: string) => {
    gross_sales: number;
    cash_sales: number;
    online_sales: number;
    credit_sales: number;
    cash_collections: number;
    cash_refunds: number;
    cash_expenses: number;
    cash_purchases: number;
    other_cash_in: number;
    other_cash_out: number;
    bills_count: number;
    expectedCash: number;
    drawer_outflows?: Array<{ id: string; title: string; amount: number; category: string; group?: string; partyName?: string; details?: string; time?: string }>;
    collections_list?: Array<{ id: string; title: string; partyName?: string; amount: number; category: string; source: string; details?: string; time?: string }>;
    cash_sales_list?: Array<{ id: string; invoice_no: string; customer_name?: string; total: number; cash_paid: number; refund_amount: number; net_cash: number; status: string; time?: string }>;
    all_bills_list?: Array<{ id: string; invoice_no: string; customer_name?: string; total: number; payment_mode: string; status: string; time?: string }>;
  };
  startCashierShift: (data: { drawerId: string; openingCounted: number; denominations?: Record<string | number, number>; handoverId?: string }) => Promise<boolean>;
  closeCashierShift: (data: { countedCash: number; leaveInDrawer: number; remitToHead: number; denominations?: Record<string | number, number>; differenceReason?: string; notes?: string }) => Promise<boolean>;
  acceptHeadRemittance: (remittanceId: string, countedAmount: number, denominations?: Record<string | number, number>, destinationAccountId?: string, notes?: string) => Promise<boolean>;
  resolveCashVariance: (varianceId: string, status: 'Approved' | 'Adjusted' | 'Rejected', notes: string) => Promise<boolean>;
  resolveCashHandover: (handoverId: string, action: 'Accept' | 'Resolve' | 'Cancel', notes?: string) => Promise<boolean>;
  closeBusinessDay: (businessDayId: string, notes?: string, cashClose?: Record<string, unknown>) => Promise<boolean>;
  closeDayCash: (businessDayId: string, cashClose: Record<string, unknown>, notes?: string) => Promise<boolean>;
  closeDayStock: (businessDayId: string, counts: { itemId: string; variantId?: string; counted: number }[]) => Promise<boolean>;
  reopenBusinessDay: (businessDayId: string, reason: string) => Promise<boolean>;
  upsertCashDrawer: (drawer: { id?: string; name: string; code: string; location?: string; account_id?: string | null; default_float: number; is_active: boolean }) => Promise<boolean>;
  /** Load opening cash into a drawer. The cash always comes from another
   *  tracked Bank & Cash account — sourceAccountId is required; the amount is
   *  transferred (source minus, drawer plus) with ledger rows on both sides. */
  addDrawerOpeningCash: (drawerId: string, amount: number, note?: string, sourceAccountId?: string | null) => Promise<boolean>;
  getBusinessDate: () => string;
  openShiftSession: (shiftName: string, openingFloat: number, accountId?: string) => Promise<ShiftSession>;
  closeShiftSession: (shiftId: string, closingData: any) => Promise<boolean>;
  performDayClosing: (data: any) => Promise<boolean>;
  reopenDayClosing: (dayClosingId: string) => Promise<boolean>;
  isDayLocked: (dateStr: string) => boolean;
  inventoryLogs: InventoryLog[];
  customerTransactions: CustomerTransaction[];
  supplierTransactions: SupplierTransaction[];
  dailySupplyEntries: DailySupplyEntry[];

  addPurchase: (entry: any) => Promise<boolean>;
  returnPurchase: (purchaseId: string, returnQty?: number, reason?: string) => Promise<boolean>;
  deletePurchase: (id: string) => Promise<boolean>;
  returnMaterialPurchase: (purchaseId: string, returnQty?: number, reason?: string) => Promise<boolean>;
  deleteMaterialPurchase: (id: string) => Promise<boolean>;
  addBulkMaterialPurchase: (data: any) => Promise<boolean>;
  
  addSupplier: (supplier: Omit<Supplier, 'id'>) => Promise<boolean>;
  updateSupplier: (id: string, updates: Partial<Supplier>) => Promise<boolean>;
  deleteSupplier: (id: string) => Promise<boolean>;
  deleteSupplierTransaction: (id: string) => Promise<boolean>;

  allocateBulkMilk: (items: { allocationId: string, quantity: number }[], destination: string, details: any) => Promise<boolean>;
  allocateFromRetailStock: (items: any[], destination: string, details: any) => Promise<boolean>;
  setAllocations: React.Dispatch<React.SetStateAction<AllocationEntry[]>>;

  addItem: (item: Omit<ItemDefinition, 'id'>) => Promise<boolean>;
  updateItem: (id: string, updates: Partial<ItemDefinition>) => Promise<boolean>;
  deleteItem: (id: string) => Promise<boolean>;
  reorderItems: (orderedItems: { id: string; sort_order: number }[]) => Promise<boolean>;
  adjustStock: (itemId: string, newQty: number, reason: AdjustmentReason | string, notes?: string, variantId?: string) => Promise<boolean>;
  syncItemAndInventoryStock: (itemId: string, newStock: number, newVariantStocks?: Record<string, number>) => void;
  reconcileAllLedgers: () => Promise<boolean>;
  setInventory: React.Dispatch<React.SetStateAction<InventoryItem[]>>;

  setProductionBatches: React.Dispatch<React.SetStateAction<ProductionBatch[]>>;
  createBatch: (productName: string, quantity: number, notes?: string, priority?: PriorityLevel, inputCostPerUnit?: number, estimatedOutput?: number, details?: any) => Promise<boolean>;
  updateBatchStage: (batchId: string, newStage: ProductionStage, logMessage?: string, outputData?: { variants: { variantId: string, count: number }[], looseQty: number }) => Promise<boolean>;
  cancelBatch: (batchId: string, reason: string) => Promise<boolean>;

  addSale: (cart: any[], customer: any, subtotal: number, discount: number, total: number, paymentMode: 'Cash' | 'Online' | 'Credit', paidAmount?: number) => Promise<boolean>;
  processSalesReturn: (saleId: string, returnReason: string, refundAccountId?: string, returnAction?: 'refund' | 'replace', restockOption?: 'restock' | 'scrap_spoilage', returnedItemsList?: Array<{ itemId?: string; name: string; qty: number; price: number; variantId?: string; unit?: string }>, refundPaymentMode?: 'Cash' | 'Online', correctOriginalSaleMode?: boolean) => Promise<boolean>;
  updateSalePaymentMode: (saleId: string, newPaymentMode: 'Cash' | 'Online', targetAccountId?: string) => Promise<boolean>;
  recordDailySupply: (entries: any[]) => Promise<boolean>;
  processCreditSaleTransaction: (customerId: string, date: string, items: any[], status: 'Present' | 'Absent') => Promise<boolean>;
  performRetailClosing: (data: any) => Promise<boolean>;
  postClosingStockSale: (data: any) => Promise<boolean>;

  addCustomer: (customer: Omit<Customer, 'id'>) => Promise<string | boolean>;
  updateCustomer: (id: string, updates: Partial<Customer>) => Promise<boolean>;
  deleteCustomer: (id: string) => Promise<boolean>;
  recordCustomerPayment: (customerId: string, amount: number, date: string, mode: string, note?: string, type?: 'Payment' | 'Charge', accountId?: string) => Promise<boolean>;
  deleteCustomerTransaction: (id: string) => Promise<boolean>;
  recordSupplierPayment: (supplierId: string, amount: number, date: string, mode: string, type: any, note?: string, accountId?: string) => Promise<boolean>;

  addExpense: (expense: Omit<ExpenseEntry, 'id'>) => Promise<boolean>;
  deleteExpense: (id: string) => Promise<boolean>;
  addRecurringExpense: (expense: Omit<RecurringExpense, 'id'>) => Promise<boolean>;
  deleteRecurringExpense: (id: string) => Promise<boolean>;
  generateRecurringExpense: (id: string) => Promise<boolean>;
  addExpenseVendor: (vendor: Omit<ExpenseVendor, 'id' | 'total_paid'> & { id?: string }) => Promise<string | boolean>;
  updateExpenseVendor: (id: string, updates: Partial<ExpenseVendor>) => Promise<boolean>;
  deleteExpenseVendor: (id: string) => Promise<boolean>;
  recordExpenseVendorPayment: (vendorId: string, amount: number, date: string, mode: string, accountId: string, note?: string, referenceNo?: string, transactionType?: 'payment' | 'refund') => Promise<boolean>;
  deleteExpenseVendorTransaction: (id: string) => Promise<boolean>;

  addAccount: (account: any) => Promise<boolean>;
  updateAccount: (id: string, updates: Partial<FinancialAccount>) => Promise<boolean>;
  deleteAccount: (id: string) => Promise<boolean>;
  recordBankTransaction: (data: any) => Promise<boolean>;
  transferFunds: (fromId: string, toId: string, amount: number, date: string, description: string) => Promise<boolean>;
  addManualAccount: (account: any) => Promise<boolean>;
  deleteManualAccount: (id: string) => Promise<boolean>;
  updateManualAccount: (id: string, data: any) => Promise<boolean>;
  addJournalEntry: (entry: any) => Promise<boolean>;

  updateSettings: (newSettings: Partial<SystemSettings>) => Promise<void>;
  resetSystem: () => Promise<void>;
  clearData: (module: string) => Promise<void>;
  addCategory: (name: string) => void;
  removeCategory: (name: string) => void;
  
  addUnit: (unit: any) => Promise<boolean>;
  updateUnit: (unitId: string, updatedUnit: Partial<UnitDefinition>) => Promise<boolean>;
  deleteUnit: (unitId: string) => Promise<boolean>;

  // QuickBooks-Style Smart Deletion & Financial Protection
  getDeleteAssessment: (entityType: 'customer' | 'supplier' | 'item' | 'expense' | 'account' | 'vendor', id: string) => DeleteAssessment;
  safeDeleteCustomer: (id: string, action: 'hard_delete' | 'deactivate' | 'write_off_bad_debt') => Promise<boolean>;
  safeDeleteSupplier: (id: string, action: 'hard_delete' | 'deactivate' | 'settle_discount') => Promise<boolean>;
  safeDeleteItem: (id: string, action: 'hard_delete' | 'deactivate' | 'write_off_spoilage') => Promise<boolean>;
  safeDeleteExpense: (id: string) => Promise<boolean>;
  safeDeleteAccount: (id: string, action: 'hard_delete' | 'deactivate') => Promise<boolean>;
  reactivateEntity: (entityType: 'customer' | 'supplier' | 'item' | 'account' | 'vendor', id: string) => Promise<boolean>;
}

export interface DeleteAssessment {
  canHardDelete: boolean;
  canDeactivate: boolean;
  hasHistory: boolean;
  balance: number;
  stock: number;
  isLocked: boolean;
  blockingReasons: string[];
  entityName: string;
  details?: any;
}

const DairyContext = createContext<DairyContextType | undefined>(undefined);

const getErrorMessage = (err: any): string => {
  if (typeof err === 'string') return err;
  if (err?.message) return err.message;
  if (err?.error_description) return err.error_description;
  if (err?.details) return err.details;
  try { return JSON.stringify(err); } catch (e) { return "Unknown error occurred"; }
};

const parsePostgresArray = (val: any): string[] => {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    if (val.startsWith('{') && val.endsWith('}')) {
      return val.slice(1, -1).split(',').map(s => s.trim().replace(/^"|"$/g, ''));
    }
    return [val];
  }
  return [];
};

export const DairyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { showToast } = useToast(); 

  const [purchases, setPurchases] = useState<PurchaseEntry[]>([]);
  const [materialPurchases, setMaterialPurchases] = useState<MaterialPurchaseEntry[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [allocations, setAllocations] = useState<AllocationEntry[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [items, setItems] = useState<ItemDefinition[]>([]);
  const [sales, setSales] = useState<POSBill[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [productionBatches, setProductionBatches] = useState<ProductionBatch[]>([]);
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);
  const [expenseVendors, setExpenseVendors] = useState<ExpenseVendor[]>([]);
  const [expenseVendorTransactions, setExpenseVendorTransactions] = useState<ExpenseVendorTransaction[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [bankTransactions, setBankTransactions] = useState<BankTransaction[]>([]);
  const [manualAccounts, setManualAccounts] = useState<ManualAccount[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [settings, setSettings] = useState<SystemSettings>({
    general: { companyName: 'My Dairy', address: '', phone: '', email: '', taxId: '', fiscalYearStart: '01-01', currencySymbol: 'Rs', showOnboarding: false, shifts: ['Morning', 'Evening'] },
    financial: { enabledPaymentModes: ['Cash'], visibleAccountIds: [], defaultCashAccountId: '', defaultDigitalAccountId: '', defaultSalesAccount: '', defaultPurchaseAccount: '', defaultInventoryAccount: '', defaultCostOfGoodsSoldAccount: '' },
    sales: { invoicePrefix: 'INV-', defaultTaxRate: 0, enableTax: false, termsAndConditions: '', invoiceFooter: '' },
    inventory: { allowNegativeStock: true, lowStockThreshold: 10, enableBatchTracking: false, customUnits: [] },
    expenses: { inactiveCategories: [], inactiveSubcategories: [] }
  });
  const [categories, setCategories] = useState<string[]>(['Milk', 'Yogurt', 'Ghee', 'Packaging']);
  const [unitGroups, setUnitGroups] = useState<UnitGroup[]>([]);
  const [retailClosings, setRetailClosings] = useState<RetailClosingEntry[]>([]);
  const [shiftSessions, setShiftSessions] = useState<ShiftSession[]>(() => {
    try {
      const saved = localStorage.getItem('mooco_shift_sessions');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [dayClosings, setDayClosings] = useState<DayClosingEntry[]>(() => {
    try {
      const saved = localStorage.getItem('mooco_day_closings');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [activeShiftSession, setActiveShiftSession] = useState<ShiftSession | null>(() => {
    try {
      const saved = localStorage.getItem('mooco_active_shift_session');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [businessDays, setBusinessDays] = useState<BusinessDay[]>([]);
  const [cashDrawers, setCashDrawers] = useState<CashDrawer[]>([]);
  const [cashHandovers, setCashHandovers] = useState<CashHandover[]>([]);
  const [cashRemittances, setCashRemittances] = useState<CashRemittance[]>([]);
  const [cashVariances, setCashVariances] = useState<CashVariance[]>([]);
  const [shiftCashEvents, setShiftCashEvents] = useState<ShiftCashEvent[]>([]);
  const [inventoryLogs, setInventoryLogs] = useState<InventoryLog[]>([]);
  const [customerTransactions, setCustomerTransactions] = useState<CustomerTransaction[]>([]);
  const [supplierTransactions, setSupplierTransactions] = useState<SupplierTransaction[]>([]);
  const [dailySupplyEntries, setDailySupplyEntries] = useState<DailySupplyEntry[]>([]);

  // RBAC & Users State
  // Boot locked: no user is signed in until a valid PIN unlocks the terminal
  // (or a previously remembered session is restored by fetchData).
  const [roles, setRoles] = useState<AppRole[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_SYSTEM_ROLES;
    try {
      const cached = localStorage.getItem('mooco_cached_roles');
      return cached ? JSON.parse(cached) : DEFAULT_SYSTEM_ROLES;
    } catch {
      return DEFAULT_SYSTEM_ROLES;
    }
  });
  const [users, setUsers] = useState<AppUser[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const cached = localStorage.getItem('mooco_cached_users');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const savedUser = localStorage.getItem('mooco_active_user_data');
      return savedUser ? JSON.parse(savedUser) : null;
    } catch {
      return null;
    }
  });
  const [isBooting, setIsBooting] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return !localStorage.getItem('mooco_active_user_data');
  });
  const [isUserSwitcherOpen, setIsUserSwitcherOpen] = useState<boolean>(
    () => typeof window !== 'undefined' && !localStorage.getItem('mooco_active_user_id')
  );

  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const [dataLoadError, setDataLoadError] = useState<string | null>(null);
  const sessionReady = useRef(false);
  const initialFetchStarted = useRef(false);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const ledgerBases = useRef(emptyBases());
  const refreshAgain = useRef(false);

  const restoreOperator = async () => {
    setSessionError(null);
    if (!sessionReady.current && !currentUser) setIsBooting(true);

    const attemptFetch = async (timeoutMs: number) => {
      return await Promise.allSettled([
        loadRead(supabase.from('app_roles').select('*'), timeoutMs),
        loadRead(supabase.rpc('app_list_users'), timeoutMs)
      ]);
    };

    try {
      // First attempt with 20s timeout to survive high mobile network latency
      let [rolesRes, usersRes] = await attemptFetch(20000);

      // If either call was rejected or had an error, retry once after 600ms
      const needsRetry = (rolesRes.status !== 'fulfilled' || rolesRes.value.error || !rolesRes.value.data?.length) ||
                         (usersRes.status !== 'fulfilled' || usersRes.value.error || !usersRes.value.data);
      if (needsRetry) {
        await new Promise(r => setTimeout(r, 600));
        const [r2, u2] = await attemptFetch(25000);
        if (r2.status === 'fulfilled' && !r2.value.error && r2.value.data?.length) rolesRes = r2;
        if (u2.status === 'fulfilled' && !u2.value.error && u2.value.data) usersRes = u2;
      }

      // Process RBAC Roles & Users if returned by server
      if (rolesRes.status === 'fulfilled' && rolesRes.value.data && rolesRes.value.data.length > 0) {
        const dbRoles: AppRole[] = rolesRes.value.data.map((r: any) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          is_system: r.is_system,
          permissions: Array.isArray(r.permissions) ? r.permissions : (typeof r.permissions === 'string' ? JSON.parse(r.permissions) : [])
        }));
        setRoles(dbRoles);
        if (typeof window !== 'undefined') {
          try { localStorage.setItem('mooco_cached_roles', JSON.stringify(dbRoles)); } catch (_) {}
        }
      }

      if (usersRes.status === 'fulfilled' && usersRes.value.data) {
        const dbUsers: AppUser[] = (usersRes.value.data as any[]).map(mapRpcUser);
        setUsers(dbUsers);
        if (typeof window !== 'undefined') {
          try { localStorage.setItem('mooco_cached_users', JSON.stringify(dbUsers)); } catch (_) {}
        }

        // Restore the previously signed-in user (device "remember me").
        const savedUserId = typeof window !== 'undefined' ? localStorage.getItem('mooco_active_user_id') : null;
        let matched = dbUsers.find(u => u.id === savedUserId && u.is_active);

        // If no user was saved yet on this browser, auto-select the Super Admin
        if (!matched && !savedUserId && dbUsers.length > 0) {
          const defaultAdmin = dbUsers.find(u => u.role_id === 'role_super_admin' && u.is_active) || dbUsers[0];
          if (defaultAdmin) {
            matched = defaultAdmin;
            if (typeof window !== 'undefined') {
              localStorage.setItem('mooco_active_user_id', defaultAdmin.id);
            }
          }
        }

        if (matched) {
          setCurrentUser(matched);
          if (typeof window !== 'undefined') {
            localStorage.setItem('mooco_active_user_data', JSON.stringify(matched));
          }
        } else if (typeof window !== 'undefined') {
          localStorage.removeItem('mooco_active_user_id');
          localStorage.removeItem('mooco_active_user_data');
          setCurrentUser(null);
          // Saved session is no longer valid — lock the terminal.
          setIsUserSwitcherOpen(true);
        }

        sessionReady.current = true;
        setSessionError(null);
        return;
      }

      // If server could not be reached, use cached/offline user data if available
      const savedUserRaw = typeof window !== 'undefined' ? localStorage.getItem('mooco_active_user_data') : null;
      if (savedUserRaw) {
        try {
          const cachedUser = JSON.parse(savedUserRaw);
          if (cachedUser && cachedUser.id) {
            setCurrentUser(cachedUser);
            sessionReady.current = true;
            setSessionError(null);
            console.info('[Session restore] Active operator session preserved from local cache');
            return;
          }
        } catch (_) {}
      }

      const cachedUsersRaw = typeof window !== 'undefined' ? localStorage.getItem('mooco_cached_users') : null;
      if (cachedUsersRaw) {
        try {
          const cachedUsers: AppUser[] = JSON.parse(cachedUsersRaw);
          if (cachedUsers && cachedUsers.length > 0) {
            setUsers(cachedUsers);
            const savedUserId = typeof window !== 'undefined' ? localStorage.getItem('mooco_active_user_id') : null;
            const matched = cachedUsers.find(u => u.id === savedUserId && u.is_active) ||
                            cachedUsers.find(u => u.role_id === 'role_super_admin' && u.is_active) ||
                            cachedUsers[0];
            if (matched) {
              setCurrentUser(matched);
              if (typeof window !== 'undefined') {
                localStorage.setItem('mooco_active_user_id', matched.id);
                localStorage.setItem('mooco_active_user_data', JSON.stringify(matched));
              }
              sessionReady.current = true;
              setSessionError(null);
              console.info('[Session restore] Operator restored from cached users directory');
              return;
            }
          }
        } catch (_) {}
      }

      // If genuinely no network AND no cached operator exists
      throw new Error('Could not verify operator access. Check your connection and retry.');
    } catch (error) {
      if (currentUser) {
        sessionReady.current = true;
        setSessionError(null);
        console.warn('[Session restore] Network check failed but currentUser is active; keeping session alive');
      } else {
        sessionReady.current = false;
        setSessionError('Could not verify operator access. Check your connection and retry.');
        console.warn('[Session restore]', error);
      }
    } finally {
      setIsBooting(false);
    }
  };

  const reapplyLedger = async () => {
    const seen = currentEpoch();
    let work;
    try {
      work = await readUnsyncedWork();
    } catch (err) {
      console.warn('[Ledger] Could not read the local journal', err);
      return;
    }
    if (currentEpoch() !== seen) return;
    const view = projectLedger(ledgerBases.current, work);
    const publish = (setter: (value: any) => void, next: any[] | null) => {
      if (!next) return;
      setter((prev: any[]) => {
        if (currentEpoch() !== seen) return prev;
        const ids = new Set(next.map(row => row?.id).filter(Boolean));
        const extras = (prev || []).filter(row => row?.id && !ids.has(row.id));
        return [...next, ...extras];
      });
    };
    publish(setSales, view.sales);
    publish(setCustomers, view.customers);
    publish(setInventory, view.inventory);
    publish(setItems, view.items);
    publish(setAccounts, view.accounts);
    publish(setSuppliers, view.suppliers);
    publish(setExpenses, view.expenses);
    publish(setExpenseVendors, view.expenseVendors);
    publish(setPurchases, view.purchases);
    publish(setAllocations, view.allocations);
    publish(setCustomerTransactions, view.customerTransactions);
    publish(setSupplierTransactions, view.supplierTransactions);
    publish(setBankTransactions, view.bankTransactions);
    publish(setRetailClosings, view.retailClosings);
  };

  const fetchFullTable = async (tableName: string, orderCol = 'date', maxPages = 20): Promise<{ data: any[]; error: any }> => {
    try {
      const pageSize = 1000;
      const firstPage = await loadRead(
        supabase.from(tableName).select('*').order(orderCol, { ascending: false }).range(0, pageSize - 1),
        35000
      );
      if (firstPage.error) return { data: [], error: firstPage.error };
      const rows: any[] = [...(firstPage.data || [])];
      
      if (firstPage.data && firstPage.data.length === pageSize) {
        let pageOffset = 1;
        while (pageOffset < maxPages) {
          const chunkPages: number[] = [];
          for (let p = pageOffset; p < Math.min(pageOffset + 5, maxPages); p++) {
            chunkPages.push(p);
          }
          const chunkResults = await Promise.all(
            chunkPages.map(p =>
              loadRead(
                supabase.from(tableName).select('*').order(orderCol, { ascending: false }).range(p * pageSize, (p + 1) * pageSize - 1),
                35000
              )
            )
          );
          let hasMore = true;
          for (const res of chunkResults) {
            if (res.data && res.data.length > 0) {
              rows.push(...res.data);
            }
            if (!res.data || res.data.length < pageSize) {
              hasMore = false;
              break;
            }
          }
          if (!hasMore) break;
          pageOffset += 5;
        }
      }
      return { data: rows, error: null };
    } catch (err) {
      console.warn(`[Workspace load] fetchFullTable for ${tableName} error:`, err);
      return { data: [], error: err };
    }
  };

  const loadData = async () => {
      setIsDataLoading(true);
      setDataLoadError(null);
      // Start access checks immediately, independently of business history/cache reads.
      const operatorRequest = restoreOperator();
      try {
        const businessDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
        const fullSalesPromise = fetchFullTable('sales', 'date');
        const fullBankPromise = fetchFullTable('bank_transactions', 'date');
        const results = await Promise.allSettled([
          supabase.from('suppliers').select('*'),
          supabase.from('customers').select('*'),
          supabase.from('items').select('*').order('sort_order', { ascending: true, nullsFirst: false }).order('name', { ascending: true }),
          supabase.from('sales').select('*').gte('date', businessDate).order('date', { ascending: false }).limit(300),
          supabase.from('purchases').select('*').order('date', { ascending: false }),
          supabase.from('material_purchases').select('*').order('date', { ascending: false }),
          supabase.from('allocations').select('*').order('date', { ascending: false }),
          supabase.from('production_batches').select('*').order('start_date', { ascending: false }),
          supabase.from('daily_supply').select('*').order('date', { ascending: false }),
          supabase.from('retail_closings').select('*').order('date', { ascending: false }),
          supabase.from('expenses').select('*').order('date', { ascending: false }),
          supabase.from('recurring_expenses').select('*'),
          supabase.from('expense_vendors').select('*'),
          supabase.from('financial_accounts').select('*'),
          supabase.from('bank_transactions').select('*').order('date', { ascending: false }),
          supabase.from('manual_accounts').select('*'),
          supabase.from('journal_entries').select('*').order('date', { ascending: false }),
          supabase.from('inventory_logs').select('*').order('date', { ascending: false }),
          supabase.from('customer_transactions').select('*').order('date', { ascending: false }),
          supabase.from('supplier_transactions').select('*').order('date', { ascending: false }),
          supabase.from('app_settings').select('*').eq('id', 'global_settings').single(),
          supabase.from('expense_vendor_transactions').select('*'),
          null,
          null,
          supabase.from('business_days').select('*').order('business_date', { ascending: false }),
          supabase.from('cash_drawers').select('*').order('name'),
          supabase.from('cash_shifts').select('*').order('started_at', { ascending: false }),
          supabase.from('drawer_handovers').select('*').order('declared_at', { ascending: false }),
          supabase.from('cash_remittances').select('*').order('declared_at', { ascending: false }),
          supabase.from('cash_variances').select('*').order('created_at', { ascending: false }),
          supabase.from('shift_cash_events').select('*').order('occurred_at', { ascending: false }),
          supabase.from('day_closings').select('*')
        ].map(query => query ? loadRead(query, 35000) : Promise.resolve({ data: null, error: null })));
        const failedReads = results.filter(result => result.status === 'rejected' || result.value.error);
        if (failedReads.length) {
          console.warn('[Workspace load] Failed reads', JSON.stringify(results.flatMap((result, index) => {
            const error = result.status === 'rejected' ? result.reason : result.value.error;
            return error ? [{ index, message: error.message || String(error) }] : [];
          })));
          setDataLoadError('Some records could not be loaded. Figures may be incomplete; retry before making changes.');
        }


        const [
          sRes, cRes, iRes, saleRes, purRes, mpRes, alRes, pbRes, dsRes, rcRes, 
          exRes, reRes, evRes, faRes, btRes, maRes, jeRes, 
          ilRes, ctRes, stRes, setRes, evtRes, rolesRes, usersRes,
          bdRes, drawersRes, shiftsRes, handoversRes, remittancesRes, variancesRes, cashEventsRes, dcRes
        ] = results;

        if (sRes.status === 'fulfilled' && sRes.value.data && !sRes.value.error) {
          const serverSuppliers = sRes.value.data.map((s: any) => {
            const bal = roundCurrency(Number(s.balance !== undefined ? s.balance : (s.pending_balance || 0)) || 0);
            return {
              id: s.id,
              name: s.name || 'Unknown',
              phone: s.phone || '',
              isActive: s.is_active,
              ...s.data,
              balance: bal,
              pending_balance: bal
            };
          });
          ledgerBases.current.suppliers = serverSuppliers;
          setSuppliers(serverSuppliers);
        }
        
        if (setRes.status === 'fulfilled' && setRes.value.data) {
           const dbSettings = setRes.value.data;
           setSettings(prev => ({
              general: { ...prev.general, ...dbSettings.general, shifts: dbSettings.general?.shifts || prev.general.shifts },
              financial: { ...prev.financial, ...dbSettings.financial },
              sales: { ...prev.sales, ...dbSettings.sales },
              inventory: { ...prev.inventory, ...dbSettings.inventory },
              expenses: { ...prev.expenses, ...dbSettings.expenses },
           }));
        }
        
        // Fetch pending local Dexie records to ensure zero UI loss on re-fetch
        let pendingOrders: POSBill[] = [];
        let pendingCustomers: Customer[] = [];
        let pendingPurchases: any[] = [];
        let pendingSupplierTx: any[] = [];
        let pendingExpenses: any[] = [];
        try {
          const unsynced = await withDeadline(() => readUnsyncedWork(), 3000);
          const localPendingOrders = unsynced.orders;
          const localPendingCustomers = unsynced.customers;
          const localPendingOutbox = unsynced.outbox;
          pendingOrders = localPendingOrders.map(o => ({
            id: o.id,
            bill_number: o.bill_number,
            date: o.date,
            customer_id: o.customer_id,
            customer_name: o.customer_name,
            subtotal: o.subtotal,
            discount: o.discount,
            total: o.total,
            payment_mode: o.payment_mode,
            status: o.status,
            business_day_id: o.business_day_id,
            shift_session_id: o.shift_session_id,
            shift_name: o.shift_name,
            drawer_id: o.drawer_id,
            cashier_id: o.cashier_id,
            cashier_name: o.cashier_name,
            items: o.items,
            paid_amount: o.details?.paid_amount !== undefined ? o.details.paid_amount : o.total,
            due_amount: o.details?.due_amount || 0,
            details: o.details
          }));


          pendingCustomers = localPendingCustomers.map(c => ({
            id: c.id,
            name: c.name,
            phone: c.phone || '',
            address: c.address || '',
            route: c.route || '',
            type: c.type || 'Regular',
            balance: c.balance || 0,
            isActive: c.is_active !== false
          }));


          pendingPurchases = localPendingOutbox
            .filter(i => i.action_type === 'milk_purchase')
            .map(i => ({
              id: i.payload.purchase_id,
              supplier_id: i.payload.supplier_id,
              supplier_name: i.payload.supplier_name,
              date: i.payload.date,
              shift: i.payload.shift,
              milk_type: i.payload.milk_type,
              quantity: i.payload.quantity,
              rate: i.payload.rate,
              fat: i.payload.fat,
              snf: i.payload.snf,
              total_amount: i.payload.total_amount,
              paid_amount: i.payload.paid_amount,
              due_amount: i.payload.due_amount,
              payment_mode: i.payload.payment_mode || 'Cash',
              status: 'Completed',
              details: i.payload
            }));

          pendingSupplierTx = localPendingOutbox
            .filter(i => i.action_type === 'supplier_payment')
            .map(i => ({
              id: i.payload.tx_id,
              supplier_id: i.payload.supplier_id,
              date: i.payload.date,
              type: i.payload.type || 'Payment',
              amount: i.payload.amount,
              mode: i.payload.mode,
              note: i.payload.note,
              account_id: i.payload.account_id
            }));

          pendingExpenses = localPendingOutbox
            .filter(i => i.action_type === 'expense')
            .map(i => ({
              id: i.payload.expense_id,
              date: i.payload.date,
              category: i.payload.category,
              amount: i.payload.amount || 0,
              paidAmount: i.payload.paid_amount || 0,
              paymentStatus: i.payload.payment_status || 'Paid',
              description: i.payload.description || '',
              account_id: i.payload.account_id,
              account_name: i.payload.account_name,
              vendor_id: i.payload.vendor_id,
              vendor_name: i.payload.vendor_name,
              details: i.payload
            }));
        } catch (dexieErr) {
          console.warn('[Dexie Merge Warning]', dexieErr);
          throw new Error('Local pending records could not be read. Retry loading to keep offline changes safe.');
        }

        if (cRes.status === 'fulfilled' && cRes.value.data) {
          const serverCustomers = cRes.value.data.map((c: any) => ({ 
            id: c.id, 
            name: c.name || 'Unknown', 
            phone: c.phone || '', 
            address: c.address || '', 
            route: c.route || '', 
            type: c.type || 'Regular', 
            balance: roundCurrency(c.balance || 0), 
            isActive: c.is_active, 
            ...c.data 
          }));
          const serverCustIds = new Set(serverCustomers.map((c: any) => c.id));
          const unmergedPending = pendingCustomers.filter(p => !serverCustIds.has(p.id));
          ledgerBases.current.customers = serverCustomers;
          setCustomers([...unmergedPending, ...serverCustomers]);
        } else {
          try {
            const cachedCustomers = await db.customers.toArray();
            const mapped = cachedCustomers.map(toCustomer);
            if (mapped.length) {
              ledgerBases.current.customers = mapped;
              setCustomers(mapped);
            }
          } catch (err) {
            console.warn('[Customer cache]', err);
          }
        }

        if (iRes.status === 'fulfilled' && iRes.value.data) {
          const mappedItems: ItemDefinition[] = iRes.value.data.map((i: any) => {
            const parsedTypes = parsePostgresArray(i.type);
            return { 
              id: i.id, name: i.name || 'Unknown', category: Array.isArray(i.category) ? i.category : [i.category || 'Uncategorized'], 
              item_type: (parsedTypes.length > 0 ? parsedTypes : ['Sale product']) as any, 
              unit: i.unit || 'units', cost_price: roundCurrency(i.cost_price || 0), selling_price: roundCurrency(i.selling_price || 0), 
              isActive: i.is_active, isSystem: i.is_system, source: i.source || 'Both', reorder_level: i.reorder_level || 10,
              description: i.description || '',
              recipe: i.recipe || [], variants: i.variants || [],
              recipe_base_item_id: i.recipe_base_item_id,
              recipe_base_quantity: i.recipe_base_quantity !== undefined ? roundQuantity(i.recipe_base_quantity) : undefined,
              recipe_expected_output: i.recipe_expected_output !== undefined ? roundQuantity(i.recipe_expected_output) : undefined,
              unit_group_id: i.unit_group_id,
              variant_stocks: i.variant_stocks || {},
              quick_amounts: i.quick_amounts || [],
              pos_primary_mode: i.pos_primary_mode || 'amount',
              allow_loose_sale: i.allow_loose_sale !== false,
              image_url: i.image_url || undefined,
              sort_order: i.sort_order !== undefined && i.sort_order !== null ? Number(i.sort_order) : 999
            };
          });

          mappedItems.sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || a.name.localeCompare(b.name));

          const mappedInventory: InventoryItem[] = iRes.value.data.map((i: any) => {
            const parsedTypes = parsePostgresArray(i.type);
            const isRaw = parsedTypes.includes('Raw material') || parsedTypes.includes('Packaging material');
            return { 
              id: `inv_${i.id}`, 
              item_id: i.id, 
              name: i.name || 'Unknown', 
              category: Array.isArray(i.category) ? i.category[0] : i.category, 
              stock_type: isRaw ? StockType.RAW_MATERIAL : StockType.RETAIL_STOCK, 
              quantity: roundQuantity(i.stock || 0), 
              unit: i.unit || 'units', 
              price: roundCurrency(i.selling_price || i.cost_price || 0), 
              variant_stocks: i.variant_stocks || {} 
            };
          });

          ledgerBases.current.items = mappedItems;
          ledgerBases.current.inventory = mappedInventory;
          setItems(mappedItems);
          setInventory(mappedInventory);
        } else {
          try {
            const cached = mapCatalogCache(await db.catalog_cache.toArray());
            if (cached.items.length) {
              ledgerBases.current.items = cached.items;
              ledgerBases.current.inventory = cached.inventory;
              setItems(cached.items);
              setInventory(cached.inventory);
            }
          } catch (err) {
            console.warn('[Catalog cache]', err);
          }
        }

        let saleDataRows = (saleRes.status === 'fulfilled' && saleRes.value?.data) ? saleRes.value.data : null;
        if (!saleDataRows) {
          try {
            console.warn('[Workspace load] Retrying sales fetch individually...');
            const directSaleRes = await fetchFullTable('sales', 'date');
            if (directSaleRes.data && directSaleRes.data.length > 0) {
              saleDataRows = directSaleRes.data;
            }
          } catch (retryErr) {
            console.warn('[Workspace load] Targeted sales retry failed:', retryErr);
          }
        }

        const applyServerSales = (rows: any[]) => {
          const serverSales = rows.map((s: any) => ({ 
            ...s, 
            paid_amount: s.paid_amount !== undefined ? roundCurrency(s.paid_amount) : (s.details?.paid_amount !== undefined ? roundCurrency(s.details.paid_amount) : roundCurrency(s.total)),
            due_amount: s.due_amount !== undefined ? roundCurrency(s.due_amount) : roundCurrency(s.details?.due_amount || 0),
            total: roundCurrency(s.total || 0),
            items: (s.items || []).map((it: any) => ({
              ...it,
              qty: roundQuantity(it.qty || 0),
              price: roundCurrency(it.price || 0),
              total: roundCurrency(it.total || ((it.qty || 0) * (it.price || 0)))
            }))
          }));
          const serverSaleIds = new Set(serverSales.map((s: any) => s.id));
          const unmergedOrders = pendingOrders.filter(p => !serverSaleIds.has(p.id));
          ledgerBases.current.sales = serverSales;
          setSales([...unmergedOrders, ...serverSales]);
        };
        if (saleDataRows) applyServerSales(saleDataRows);
        else {
          try {
            const cachedOrders = await db.orders.toArray();
            if (cachedOrders.length) {
              ledgerBases.current.sales = cachedOrders.map(toPosBill);
              setSales(ledgerBases.current.sales);
            }
          } catch (err) {
            console.warn('[Sales cache]', err);
          }
        }
        if (purRes.status === 'fulfilled' && purRes.value.data) {
          const serverPurchases = purRes.value.data.map((p: any) => ({
            ...p,
            quantity: roundQuantity(p.quantity || 0),
            rate: roundCurrency(p.rate || 0),
            total_amount: roundCurrency(p.total_amount || 0),
            paid_amount: p.paid_amount !== undefined ? roundCurrency(p.paid_amount) : roundCurrency(p.details?.paid_amount || 0),
            due_amount: p.due_amount !== undefined ? roundCurrency(p.due_amount) : (p.details?.due_amount !== undefined ? roundCurrency(p.details.due_amount) : roundCurrency(Math.max(0, (p.total_amount || 0) - (p.details?.paid_amount || 0)))),
            payment_mode: p.payment_mode || p.details?.payment_mode || 'Cash',
            ...p.details
          }));
          const serverPurIds = new Set(serverPurchases.map((p: any) => p.id));
          const unmergedPurchases = pendingPurchases.filter(p => !serverPurIds.has(p.id));
          ledgerBases.current.purchases = serverPurchases;
          setPurchases([...unmergedPurchases, ...serverPurchases]);
        }
        if (mpRes.status === 'fulfilled' && mpRes.value.data) {
          setMaterialPurchases(mpRes.value.data.map((mp: any) => ({
            ...mp,
            quantity: roundQuantity(mp.quantity || 0),
            rate: roundCurrency(mp.rate || 0),
            total_amount: roundCurrency(mp.total_amount || 0),
            paid_amount: mp.details?.paid_amount !== undefined && mp.details?.paid_amount !== null ? roundCurrency(Number(mp.details.paid_amount)) : undefined,
            due_amount: mp.details?.due_amount !== undefined && mp.details?.due_amount !== null ? roundCurrency(Number(mp.details.due_amount)) : undefined,
            account_id: mp.account_id || mp.details?.account_id
          })));
        }
        if (alRes.status === 'fulfilled' && alRes.value.data) {
          const serverAllocations = alRes.value.data.map((a: any) => ({
            ...a,
            original_quantity: roundQuantity(a.original_quantity || 0),
            allocated_quantity: roundQuantity(a.allocated_quantity || 0),
            remaining_quantity: a.remaining_quantity !== null && a.remaining_quantity !== undefined 
              ? roundQuantity(a.remaining_quantity) 
              : roundQuantity(a.original_quantity || 0)
          }));
          ledgerBases.current.allocations = serverAllocations;
          setAllocations(serverAllocations);
        }
        if (pbRes.status === 'fulfilled' && pbRes.value.data) setProductionBatches(pbRes.value.data);
        if (dsRes.status === 'fulfilled' && dsRes.value.data) setDailySupplyEntries(dsRes.value.data.map((ds: any) => ({ id: ds.id, date: ds.date, customer_id: ds.customer_id, total_amount: ds.total_amount, ...ds.details })));
        if (rcRes.status === 'fulfilled' && rcRes.value.data) {
          const serverClosings = rcRes.value.data.map((rc: any) => ({ id: rc.id, date: rc.date, status: rc.status, ...rc.details }));
          ledgerBases.current.retailClosings = serverClosings;
          setRetailClosings(serverClosings);
        }
        if (exRes.status === 'fulfilled' && exRes.value.data) {
          const serverExpenses = exRes.value.data.map((ex: any) => {
            const d = ex.details || {};
            const totalAmt = Number(ex.amount ?? d.amount ?? 0);
            
            // Check status: check ex.payment_status or d.payment_status (snake_case) or d.paymentStatus (camelCase)
            const rawStatus = (ex.payment_status || d.payment_status || d.paymentStatus || '').toString();
            const isUnpaid = rawStatus.toLowerCase() === 'unpaid';

            // Check paidAmount: check ex.paid_amount or d.paid_amount (snake_case) or d.paidAmount (camelCase)
            let paidAmt: number;
            if (isUnpaid) {
              paidAmt = 0;
            } else if (ex.paid_amount !== undefined && ex.paid_amount !== null) {
              paidAmt = Number(ex.paid_amount);
            } else if (d.paid_amount !== undefined && d.paid_amount !== null) {
              paidAmt = Number(d.paid_amount);
            } else if (d.paidAmount !== undefined && d.paidAmount !== null) {
              paidAmt = Number(d.paidAmount);
            } else {
              paidAmt = totalAmt;
            }

            const status = isUnpaid ? 'Unpaid' : (rawStatus === 'Partial' || (paidAmt > 0 && paidAmt < totalAmt) ? 'Partial' : 'Paid');

            return {
              id: ex.id,
              date: ex.date,
              category: ex.category || d.category || 'General',
              dueDate: ex.due_date || d.due_date || d.dueDate || '',
              description: ex.description || d.description || '',
              account_id: ex.account_id || d.account_id,
              account_name: ex.account_name || d.account_name,
              vendor_id: ex.vendor_id || d.vendor_id,
              vendor_name: ex.vendor_name || d.vendor_name,
              paymentMode: ex.payment_mode || d.payment_mode || d.paymentMode || 'Cash',
              business_day_id: ex.business_day_id || d.business_day_id,
              shift_session_id: ex.shift_session_id || d.shift_session_id,
              drawer_id: ex.drawer_id || d.drawer_id,
              cashier_id: ex.cashier_id || d.cashier_id,
              ...d,
              amount: totalAmt,
              paidAmount: paidAmt,
              paymentStatus: status
            };
          });
          const serverExpIds = new Set(serverExpenses.map((e: any) => e.id));
          const unmergedExpenses = pendingExpenses.filter(e => !serverExpIds.has(e.id));
          ledgerBases.current.expenses = serverExpenses;
          setExpenses([...unmergedExpenses, ...serverExpenses]);
        }
        if (reRes.status === 'fulfilled' && reRes.value.data) setRecurringExpenses(reRes.value.data.map((re: any) => ({ id: re.id, name: re.name, amount: re.amount || 0, ...re.details })));
        if (evRes.status === 'fulfilled' && evRes.value.data) {
          const serverVendors = evRes.value.data.map((ev: any) => ({ 
          id: ev.id, 
          name: ev.name || 'Unknown', 
          service_type: ev.service_type || ev.details?.service_type || 'Other', 
          phone: ev.phone || ev.details?.phone || '', 
          contact_person: ev.contact_person || ev.details?.contact_person || '',
          address: ev.address || ev.details?.address || '', 
          notes: ev.notes || ev.details?.notes || '', 
          total_paid: ev.total_paid !== undefined ? ev.total_paid : (ev.details?.total_paid || 0), 
          total_billed: ev.total_billed !== undefined ? ev.total_billed : (ev.details?.total_billed || 0),
          pending_balance: ev.pending_balance !== undefined ? ev.pending_balance : (ev.balance !== undefined ? ev.balance : (ev.details?.pending_balance || 0)),
          opening_balance: ev.opening_balance !== undefined ? ev.opening_balance : (ev.details?.opening_balance || 0),
          bank_name: ev.bank_name || ev.details?.bank_name || '',
          account_number: ev.account_number || ev.details?.account_number || '',
          iban: ev.iban || ev.details?.iban || '',
          isActive: ev.is_active !== undefined ? ev.is_active : (ev.details?.isActive !== undefined ? ev.details.isActive : true), 
          ...ev.details 
        }));
          ledgerBases.current.expenseVendors = serverVendors;
          setExpenseVendors(serverVendors);
        }
        if (evtRes && evtRes.status === 'fulfilled' && evtRes.value?.data) {
          setExpenseVendorTransactions(evtRes.value.data.map((evt: any) => ({
            id: evt.id,
            vendor_id: evt.vendor_id,
            date: evt.date,
            type: evt.type || 'Payment',
            amount: evt.amount || 0,
            paid_amount: evt.paid_amount || evt.amount || 0,
            balance_after: evt.balance_after || evt.details?.balance_after,
            payment_mode: evt.payment_mode || evt.details?.payment_mode || 'Cash',
            account_id: evt.account_id || evt.details?.account_id,
            account_name: evt.account_name || evt.details?.account_name,
            reference_no: evt.reference_no || evt.details?.reference_no,
            note: evt.note || evt.details?.note,
            ...evt.details
          })));
        }
        if (faRes.status === 'fulfilled' && faRes.value.data && !faRes.value.error) {
          const serverAccounts = faRes.value.data.map((a: any) => ({ id: a.id, name: a.name, type: a.type, balance: a.balance || 0, isActive: a.is_active, ...a.details }));
          ledgerBases.current.accounts = serverAccounts;
          setAccounts(serverAccounts);
          try { localStorage.setItem('mooco_accounts_snapshot', JSON.stringify(serverAccounts)); } catch { /* ignore quota */ }
        } else {
          try {
            const saved = localStorage.getItem('mooco_accounts_snapshot');
            const cachedAccounts = saved ? JSON.parse(saved) : [];
            if (Array.isArray(cachedAccounts) && cachedAccounts.length) {
              ledgerBases.current.accounts = cachedAccounts;
              setAccounts(cachedAccounts);
            }
          } catch (err) {
            console.warn('[Account cache]', err);
          }
        }
        if (btRes.status === 'fulfilled' && btRes.value.data) {
          ledgerBases.current.bankTransactions = btRes.value.data;
          setBankTransactions(btRes.value.data);
        }
        if (maRes.status === 'fulfilled' && maRes.value.data) {
          const rawAccounts = maRes.value.data;
          // Ensure standard system accounts exist
          const missingAccounts = DEFAULT_SYSTEM_MANUAL_ACCOUNTS.filter(
            def => !rawAccounts.some((a: any) => a.id === def.id)
          );
          if (missingAccounts.length > 0) {
            supabase.from('manual_accounts').upsert(missingAccounts).then(() => {});
          }
          const allAccounts = [...rawAccounts, ...missingAccounts.filter(m => !rawAccounts.some((a: any) => a.id === m.id))];
          setManualAccounts(allAccounts.map((a: any) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            balance: a.balance || 0,
            isActive: a.is_active !== undefined ? a.is_active : (a.details?.isActive !== false),
            ...a.details
          })));
        }
        if (jeRes.status === 'fulfilled' && jeRes.value.data) setJournalEntries(jeRes.value.data.map((j: any) => ({ id: j.id, date: j.date, totalAmount: j.total_amount, createdAt: j.created_at, ...j.details })));
        if (ilRes.status === 'fulfilled' && ilRes.value.data) setInventoryLogs(ilRes.value.data);
        if (ctRes.status === 'fulfilled' && ctRes.value.data) {
          const serverCustomerTx = ctRes.value.data.map((ct: any) => ({ id: ct.id, customer_id: ct.customer_id, date: ct.date, type: ct.type, amount: ct.amount || 0, mode: ct.mode || ct.details?.mode, note: ct.note || ct.details?.note, ...ct.details }));
          ledgerBases.current.customerTransactions = serverCustomerTx;
          setCustomerTransactions(serverCustomerTx);
        }
        if (stRes.status === 'fulfilled' && stRes.value.data) {
          const serverSupplierTx = stRes.value.data.map((st: any) => ({ id: st.id, supplier_id: st.supplier_id, date: st.date, type: st.type, amount: st.amount || 0, mode: st.mode || st.details?.mode, note: st.note || st.details?.note, ...st.details }));
          const serverStxIds = new Set(serverSupplierTx.map((s: any) => s.id));
          const unmergedStx = pendingSupplierTx.filter(s => !serverStxIds.has(s.id));
          ledgerBases.current.supplierTransactions = serverSupplierTx;
          setSupplierTransactions([...unmergedStx, ...serverSupplierTx]);
        }

        if (bdRes.status === 'fulfilled' && bdRes.value.data) setBusinessDays(bdRes.value.data as BusinessDay[]);
        if (drawersRes.status === 'fulfilled' && drawersRes.value.data) setCashDrawers(drawersRes.value.data as CashDrawer[]);
        if (shiftsRes.status === 'fulfilled' && shiftsRes.value.data) {
          setShiftSessions(shiftsRes.value.data.map((row: any) => ({
            ...row,
            date: row.business_date,
            shift_name: row.shift_name || `Shift ${new Date(row.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
            opening_float: Number(row.opening_counted || 0),
            start_time: row.started_at,
            end_time: row.closed_at,
            expected_drawer_cash: Number(row.expected_closing_cash || 0),
            actual_physical_cash: row.closing_counted_cash === null ? undefined : Number(row.closing_counted_cash),
            cash_difference: row.closing_variance === null ? undefined : Number(row.closing_variance),
            khata_cash_recovered: Number(row.cash_collections || 0),
            drawer_expenses_paid: Number(row.cash_expenses || 0),
            spot_purchases_paid: Number(row.cash_purchases || 0)
          })));
        }
        if (handoversRes.status === 'fulfilled' && handoversRes.value.data) setCashHandovers(handoversRes.value.data as CashHandover[]);
        if (remittancesRes.status === 'fulfilled' && remittancesRes.value.data) setCashRemittances(remittancesRes.value.data as CashRemittance[]);
        if (variancesRes.status === 'fulfilled' && variancesRes.value.data) setCashVariances(variancesRes.value.data as CashVariance[]);
        if (cashEventsRes.status === 'fulfilled' && cashEventsRes.value.data) setShiftCashEvents(cashEventsRes.value.data as ShiftCashEvent[]);

        // Day locks from the cloud so a day locked on one counter is locked
        // on every device; localStorage entries are merged in by id.
        try {
          const dcRows = dcRes.status === 'fulfilled' ? dcRes.value.data : null;
          if (dcRows) {
            const serverDayClosings: DayClosingEntry[] = dcRows.map((r: any) => ({
              ...((r.details || {}) as DayClosingEntry),
              id: r.id,
              date: r.date,
              status: r.status || 'Locked'
            }));
            setDayClosings(prev => {
              const byId = new Map<string, DayClosingEntry>();
              [...prev, ...serverDayClosings].forEach(c => byId.set(c.id, c));
              return Array.from(byId.values());
            });
          }
        } catch (dcErr) {
          console.warn('[Day Closings Fetch] operating offline:', dcErr);
        }

        await reapplyLedger();

        // Background cache update into Dexie
        syncService.cacheCatalogFromSupabase({
          items: iRes.status === 'fulfilled' ? iRes.value.data : undefined,
          customers: cRes.status === 'fulfilled' ? cRes.value.data : undefined
        });

        // Allow workspace to render as long as core tables (suppliers, customers, items, accounts) loaded
        const coreFailed = [results[0], results[1], results[2], results[13]].some(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error));
        if (!coreFailed) {
          setHasLoadedData(true);
        } else if (!failedReads.length) {
          setHasLoadedData(true);
        }

        try {
          const fullSaleRes = await fullSalesPromise;
          if (fullSaleRes?.data && fullSaleRes.data.length > 0) {
            applyServerSales(fullSaleRes.data);
            await reapplyLedger();
          }
        } catch (fullSalesErr) {
          console.warn('[Workspace load] Full sales history failed:', fullSalesErr);
        }

        try {
          const fullBankRes = await fullBankPromise;
          if (fullBankRes?.data && fullBankRes.data.length > 0) {
            ledgerBases.current.bankTransactions = fullBankRes.data;
            setBankTransactions(fullBankRes.data);
          }
        } catch (fullBankErr) {
          console.warn('[Workspace load] Full bank transactions history failed:', fullBankErr);
        }

      } catch (error) {
        console.warn("Supabase fetch notice (operating offline):", error);
        setDataLoadError(error instanceof Error ? error.message : 'Records could not be loaded. Please retry.');
        // Load offline fallback from Dexie
        try {
          const cachedItems = await withDeadline(() => db.catalog_cache.toArray(), 3000);
          if (cachedItems && cachedItems.length > 0) {
            setItems(cachedItems.map((i: any) => ({
              id: i.id,
              name: i.name,
              category: i.category,
              item_type: i.item_type,
              unit: i.unit,
              cost_price: i.cost_price,
              selling_price: i.selling_price,
              isActive: i.is_active,
              isSystem: false,
              source: 'Both',
              reorder_level: 10,
              description: '',
              variants: i.variants || [],
              variant_stocks: i.variant_stocks || {},
              quick_amounts: i.quick_amounts || [],
              pos_primary_mode: i.pos_primary_mode || 'amount',
              allow_loose_sale: i.allow_loose_sale,
              image_url: i.image_url
            })));
            setInventory(cachedItems.map((i: any) => ({
              id: `inv_${i.id}`,
              item_id: i.id,
              name: i.name,
              category: i.category[0] || 'Dairy products',
              stock_type: StockType.RETAIL_STOCK,
              quantity: i.stock,
              unit: i.unit,
              price: i.selling_price,
              variant_stocks: i.variant_stocks || {}
            })));
          }

          const cachedCustomers = await withDeadline(() => db.customers.toArray(), 3000);
          if (cachedCustomers && cachedCustomers.length > 0) {
            setCustomers(cachedCustomers.map((c: any) => ({
              id: c.id,
              name: c.name,
              phone: c.phone || '',
              address: c.address || '',
              route: c.route || '',
              type: c.type || 'Retail Counter',
              balance: c.balance || 0,
              isActive: c.is_active,
              ...(c.data || {})
            })));
          }

          const cachedOrders = await withDeadline(() => db.orders.toArray(), 3000);
          if (cachedOrders && cachedOrders.length > 0) {
            setSales(cachedOrders.map((o: any) => ({
              id: o.id,
              bill_number: o.bill_number,
              date: o.date,
              customer_id: o.customer_id,
              customer_name: o.customer_name,
              subtotal: o.subtotal,
              discount: o.discount,
              total: o.total,
              payment_mode: o.payment_mode,
              status: o.status,
              items: o.items,
              paid_amount: o.details?.paid_amount || o.total,
              due_amount: o.details?.due_amount || 0
            })));
          }
          if (!ledgerBases.current.items) {
            const cached = mapCatalogCache(await db.catalog_cache.toArray());
            if (cached.items.length) {
              ledgerBases.current.items = cached.items;
              ledgerBases.current.inventory = cached.inventory;
            }
          }
          if (!ledgerBases.current.customers) {
            const cachedCustomers = await db.customers.toArray();
            if (cachedCustomers.length) ledgerBases.current.customers = cachedCustomers.map(toCustomer);
          }
          if (!ledgerBases.current.sales) {
            const cachedOrders = await db.orders.toArray();
            if (cachedOrders.length) ledgerBases.current.sales = cachedOrders.map(toPosBill);
          }
          await reapplyLedger();
        } catch (dexieErr) {
          console.error("Dexie offline fallback error:", dexieErr);
        }
      } finally {
        setIsDataLoading(false);
        await operatorRequest;
      }
    };

  const fetchData = (): Promise<void> => {
    if (refreshInFlight.current) {
      refreshAgain.current = true;
      return refreshInFlight.current;
    }
    const request = (async () => {
      do {
        refreshAgain.current = false;
        await loadData();
      } while (refreshAgain.current);
    })().finally(() => { refreshInFlight.current = null; });
    refreshInFlight.current = request;
    return request;
  };

  const retryLoading = async () => {
    setSessionError(null);
    setDataLoadError(null);
    setIsBooting(true);
    try {
      await restoreOperator();
    } catch (_) {}
    await fetchData();
  };

  const saveWithOutbox = async (
    action: OutboxActionType,
    payload: any,
    key: string,
    send: () => PromiseLike<any> & { abortSignal?: (signal: AbortSignal) => PromiseLike<any> }
  ) => {
    const queue = () => syncService.queueAction(action, payload, key);
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await queue();
        return;
      }
      const result = await loadRead(send(), 20000);
      if (result?.error) {
        if (isPermanentSyncError(result.error)) throw result.error;
        await queue();
      }
    } catch (err) {
      if (isPermanentSyncError(err)) {
        noteLocalWrite();
        void fetchData();
        throw err;
      }
      await queue();
    }
  };

  useEffect(() => {
    // StrictMode replays effects; do not send a second full startup batch.
    const onLedgerSynced = () => { void fetchData(); };
    window.addEventListener('mooco-ledger-synced', onLedgerSynced);
    if (!initialFetchStarted.current) {
      initialFetchStarted.current = true;
      void fetchData();
    }
    return () => window.removeEventListener('mooco-ledger-synced', onLedgerSynced);
  }, []);

  // Real-time Cross-Tab & Device Shift Synchronization via BroadcastChannel & Storage Event
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'mooco_active_shift_session') {
        try {
          const updated = e.newValue ? JSON.parse(e.newValue) : null;
          setActiveShiftSession(updated);
        } catch (err) {
          console.warn('[ShiftSync] Failed to parse updated shift session from storage event:', err);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);

    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel('mooco_shift_channel');
      channel.onmessage = (event) => {
        if (event.data?.type === 'SHIFT_STARTED' || event.data?.type === 'SHIFT_CLOSED' || event.data?.type === 'SHIFT_UPDATED') {
          refreshCashControl();
        }
      };
    }

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      if (channel) channel.close();
    };
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setActiveShiftSession(null);
      localStorage.removeItem('mooco_active_shift_session');
      return;
    }
    const currentBizDate = getBusinessDate();
    // Prioritize active shift matching current user and today's business date
    const active = shiftSessions.find(shift =>
      (shift.user_id === currentUser.id || currentUser.role_id === 'role_super_admin') &&
      Boolean(shift.drawer_id) &&
      ['Pending Acceptance', 'Active', 'Closing'].includes(shift.status) &&
      (!shift.business_date || shift.business_date === currentBizDate)
    ) || shiftSessions.find(shift =>
      Boolean(shift.drawer_id) &&
      ['Pending Acceptance', 'Active', 'Closing'].includes(shift.status) &&
      (!shift.business_date || shift.business_date === currentBizDate)
    ) || null;

    setActiveShiftSession(active);
    if (active) localStorage.setItem('mooco_active_shift_session', JSON.stringify(active));
    else localStorage.removeItem('mooco_active_shift_session');
  }, [currentUser?.id, shiftSessions]);

  useEffect(() => {
    const customUnits = settings.inventory?.customUnits || [];
    setUnitGroups(buildStandardUnitGroups(customUnits));
  }, [settings.inventory?.customUnits]);

  const addUnit = async (unit: any): Promise<boolean> => {
    try {
      const cleanSymbol = (unit.symbol || '').trim();
      const cleanName = (unit.name || '').trim();
      if (!cleanSymbol || !cleanName) {
        showToast("Unit name and symbol are required", "warning");
        return false;
      }

      const existing = settings.inventory?.customUnits || [];
      const isDuplicate = existing.some(
        (u: any) => (u.symbol || '').toLowerCase() === cleanSymbol.toLowerCase()
      );
      if (isDuplicate) {
        showToast(`Unit with symbol "${cleanSymbol}" already exists`, "warning");
        return false;
      }

      const newUnit: UnitDefinition = {
        id: unit.id || `u_cust_${Date.now()}`,
        name: cleanName,
        symbol: cleanSymbol,
        factor: Number(unit.factor) > 0 ? Number(unit.factor) : 1,
        isBase: Boolean(unit.isBase),
        type: unit.type || 'Count',
        description: unit.description || '',
        urduName: unit.urduName || '',
        isSystem: false
      };

      const updated = [...existing, newUnit];
      await updateSettings({
        inventory: {
          ...settings.inventory,
          customUnits: updated
        }
      });
      showToast(`Unit "${newUnit.name} (${newUnit.symbol})" added successfully`, "success");
      return true;
    } catch (e: any) {
      showToast("Failed to add unit: " + (e?.message || "Error"), "error");
      return false;
    }
  };

  const updateUnit = async (unitId: string, updatedUnit: Partial<UnitDefinition>): Promise<boolean> => {
    try {
      const existing = settings.inventory?.customUnits || [];
      const targetIndex = existing.findIndex((u: any) => u.id === unitId);
      if (targetIndex === -1) {
        showToast("System standard units cannot be modified", "warning");
        return false;
      }

      const current = existing[targetIndex];
      const merged: UnitDefinition = {
        ...current,
        ...updatedUnit,
        id: unitId,
        factor: Number(updatedUnit.factor) > 0 ? Number(updatedUnit.factor) : current.factor,
        isSystem: false
      };

      const updated = [...existing];
      updated[targetIndex] = merged;

      await updateSettings({
        inventory: {
          ...settings.inventory,
          customUnits: updated
        }
      });
      showToast(`Unit "${merged.name}" updated successfully`, "success");
      return true;
    } catch (e: any) {
      showToast("Failed to update unit", "error");
      return false;
    }
  };
  // Unified stock synchronizer for items and inventory
  const syncItemAndInventoryStock = (itemId: string, newStock: number, newVariantStocks?: Record<string, number>) => {
    const cleanStock = roundQuantity(newStock);
    setItems(prev => prev.map(i => {
      if (i.id === itemId) {
        return {
          ...i,
          stock: cleanStock,
          variant_stocks: newVariantStocks !== undefined ? newVariantStocks : i.variant_stocks
        };
      }
      return i;
    }));

    setInventory(prev => prev.map(inv => {
      if (inv.item_id === itemId || inv.id === `inv_${itemId}` || inv.id === itemId) {
        return {
          ...inv,
          quantity: cleanStock,
          variant_stocks: newVariantStocks !== undefined ? newVariantStocks : inv.variant_stocks
        };
      }
      return inv;
    }));
  };

  // Self-healing ledger reconciler
  const reconcileAllLedgers = async (): Promise<boolean> => {
    const result = await actionLock.runExclusive('reconcile_all_ledgers', async () => {
      try {
        const { data: allCusts } = await supabase.from('customers').select('id, name, balance');
        const { data: allSales } = await supabase.from('sales').select('customer_id, total, details, status').not('customer_id', 'is', null);
        const { data: allPayments } = await supabase.from('customer_transactions').select('customer_id, amount, type, details');

        if (allCusts && allSales && allPayments) {
          for (const cust of allCusts) {
            const custSalesDue = allSales
              .filter(s => s.customer_id === cust.id && s.status !== 'Returned')
              .reduce((sum, s) => sum + (s.details?.due_amount || 0), 0);
            
            const custPayments = allPayments
              .filter(p => p.customer_id === cust.id && p.type === 'Payment')
              .reduce((sum, p) => sum + (p.amount || 0), 0);

            const custDebits = allPayments
              .filter(p => p.customer_id === cust.id && (p.type === 'Debit' || (p.type === 'Charge' && (!p.details?.note || !p.details.note.includes('Sale #')))))
              .reduce((sum, p) => sum + (p.amount || 0), 0);

            const expectedBalance = roundCurrency(custSalesDue + custDebits - custPayments);
            if (Math.abs((cust.balance || 0) - expectedBalance) > 1 && expectedBalance >= 0) {
              console.log(`[Ledger Heal] Customer ${cust.name} balance adjusted: ${cust.balance} -> ${expectedBalance}`);
              await supabase.from('customers').update({ balance: expectedBalance }).eq('id', cust.id);
            }
          }
        }

        // 2. Reconcile Supplier Balances from purchases & supplier_transactions
        const { data: allSupps } = await supabase.from('suppliers').select('id, name, balance');
        const { data: allPurchases } = await supabase.from('purchases').select('supplier_id, total_amount, details, status');
        const { data: allSuppPayments } = await supabase.from('supplier_transactions').select('supplier_id, amount, type');

        if (allSupps && allPurchases && allSuppPayments) {
          for (const supp of allSupps) {
            const suppPurchasesDue = allPurchases
              .filter(p => p.supplier_id === supp.id && p.status !== 'Returned')
              .reduce((sum, p) => sum + (p.details?.due_amount !== undefined ? Number(p.details.due_amount) : Number(p.total_amount || 0)), 0);
            
            const suppPayments = allSuppPayments
              .filter(p => p.supplier_id === supp.id && (p.type === 'Payment' || p.type === 'Debit'))
              .reduce((sum, p) => sum + Number(p.amount || 0), 0);

            const expectedSuppBalance = roundCurrency(Math.max(0, suppPurchasesDue - suppPayments));
            if (Math.abs((Number(supp.balance) || 0) - expectedSuppBalance) > 1) {
              console.log(`[Ledger Heal] Supplier ${supp.name} balance adjusted: ${supp.balance} -> ${expectedSuppBalance}`);
              await supabase.from('suppliers').update({ balance: expectedSuppBalance }).eq('id', supp.id);
            }
          }
        }
        return true;
      } catch (e) {
        console.warn('[Ledger Heal Error]', e);
        return false;
      }
    });

    return result !== null ? result : false;
  };

  const deleteUnit = async (id: string): Promise<boolean> => {
    try {
      const existing = settings.inventory?.customUnits || [];
      const target = existing.find((u: any) => u.id === id);
      if (!target) {
        showToast("System standard units are protected and cannot be deleted", "warning");
        return false;
      }

      // Check if any items are currently using this unit
      const symbol = target.symbol.toLowerCase();
      const usedByItems = items.filter(i => (i.unit || '').toLowerCase() === symbol);
      if (usedByItems.length > 0) {
        showToast(`Cannot delete: Unit "${target.symbol}" is currently in use by ${usedByItems.length} product(s)`, "warning");
        return false;
      }

      const updated = existing.filter((u: any) => u.id !== id);
      await updateSettings({
        inventory: {
          ...settings.inventory,
          customUnits: updated
        }
      });
      showToast(`Unit "${target.name} (${target.symbol})" deleted successfully`, "info");
      return true;
    } catch (e: any) {
      showToast("Failed to delete unit: " + (e?.message || "Error"), "error");
      return false;
    }
  };

  // === DATA MODIFICATION FUNCTIONS WITH OPTIMISTIC UPDATES ===

  const addPurchase = async (
    entry: any, 
    paid_amount_arg?: number, 
    due_amount_arg?: number, 
    payment_mode_arg?: string, 
    account_id_arg?: string
  ): Promise<boolean> => {
    const lockResult = await actionLock.runExclusive(`add_purchase_${entry.supplier_id}_${entry.date}_${entry.shift}`, async () => {
      try {
        const id = generateUUID();
        const total_amount = roundCurrency((Number(entry.quantity) || 0) * (Number(entry.rate) || 0));
        
        // Robust extraction of paid_amount and due_amount from entry object OR positional arguments
        const rawPaid = entry.paid_amount !== undefined 
          ? entry.paid_amount 
          : (paid_amount_arg !== undefined ? paid_amount_arg : 0);
        const paid_amount = roundCurrency(Math.max(0, Number(rawPaid) || 0));

        const rawDue = entry.due_amount !== undefined 
          ? entry.due_amount 
          : (due_amount_arg !== undefined ? due_amount_arg : Math.max(0, total_amount - paid_amount));
        const due_amount = roundCurrency(Math.max(0, Number(rawDue) || 0));

        const payment_mode = entry.payment_mode || payment_mode_arg || (paid_amount > 0 ? 'Cash' : undefined);
        const account_id = entry.account_id || account_id_arg;
        const supplierName = suppliers.find(s => s.id === entry.supplier_id)?.name || 'Unknown';
        const normalizedPurchaseDate = normalizeTransactionTimestamp(entry.date);

        const allocationData = {
          id: `alloc_${id}`,
          purchase_id: id,
          date: normalizedPurchaseDate,
          supplier_name: supplierName,
          milk_type: entry.milk_type,
          original_quantity: Number(entry.quantity) || 0,
          remaining_quantity: Number(entry.quantity) || 0,
          allocated_quantity: 0,
          status: AllocationStatus.UNALLOCATED,
          average_rate: Number(entry.rate) || 0
        };

        const dbPurchase = {
          id,
          supplier_id: entry.supplier_id,
          date: normalizedPurchaseDate,
          shift: entry.shift,
          milk_type: entry.milk_type,
          quantity: Number(entry.quantity) || 0,
          rate: Number(entry.rate) || 0,
          fat: entry.fat !== undefined ? Number(entry.fat) || 0 : 0,
          snf: entry.snf !== undefined ? Number(entry.snf) || 0 : 0,
          total_amount,
          status: 'Completed',
          business_day_id: activeShiftSession?.business_day_id,
          shift_session_id: activeShiftSession?.id,
          drawer_id: activeShiftSession?.drawer_id,
          cashier_id: activeShiftSession?.user_id,
          details: {
            paid_amount,
            due_amount,
            payment_mode: paid_amount > 0 ? payment_mode : undefined,
            account_id,
            business_day_id: activeShiftSession?.business_day_id,
            shift_session_id: activeShiftSession?.id,
            drawer_id: activeShiftSession?.drawer_id,
            cashier_id: activeShiftSession?.user_id
          }
        };

        const purchaseData: PurchaseEntry = {
          ...dbPurchase,
          supplier_name: supplierName,
          shift: entry.shift,
          paid_amount,
          due_amount,
          payment_mode: paid_amount > 0 ? payment_mode : undefined,
          account_id
        };

        // Resolve payment account if paid_amount > 0
        let targetAccId: string | null = null;
        if (paid_amount > 0) {
          const isCashMode = !payment_mode || payment_mode.toLowerCase().includes('cash');
          const activeDrawerId = activeShiftSession?.drawer_id || activeShiftSession?.account_id;
          targetAccId = account_id || (
            isCashMode 
              ? (activeDrawerId || settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash' && a.isActive !== false)?.id || accounts.find(a => a.isActive !== false)?.id)
              : (settings.financial?.defaultDigitalAccountId || accounts.find(a => (a.type === 'Bank' || a.type === 'Wallet') && a.isActive !== false)?.id || accounts.find(a => a.isActive !== false)?.id)
          ) || null;

          if (!targetAccId) {
            throw new Error("Payment account nahi mila! Pehle 'Bank & Cash' module men Cash Drawer ya Bank Account banayein, ya phir is purchase ko Khata (Unpaid) per record karein.");
          }
        }

        const intakePayload = {
          purchase_id: id,
          supplier_id: entry.supplier_id,
          supplier_name: supplierName,
          date: entry.date,
          shift: entry.shift,
          milk_type: entry.milk_type,
          quantity: Number(entry.quantity) || 0,
          rate: Number(entry.rate) || 0,
          fat: entry.fat !== undefined ? Number(entry.fat) || 0 : 0,
          snf: entry.snf !== undefined ? Number(entry.snf) || 0 : 0,
          total_amount,
          paid_amount,
          due_amount,
          payment_mode: paid_amount > 0 ? payment_mode : undefined,
          account_id: targetAccId,
          business_day_id: activeShiftSession?.business_day_id,
          shift_session_id: activeShiftSession?.id,
          drawer_id: activeShiftSession?.drawer_id,
          cashier_id: activeShiftSession?.user_id
        };

        noteLocalWrite();
        // 1. Optimistic UI Updates (Immediate 0ms response)
        setPurchases(prev => [purchaseData, ...prev]);
        setAllocations(prev => [allocationData, ...prev]);

        if (due_amount > 0) {
          setSuppliers(prev => prev.map(s => s.id === entry.supplier_id ? {
            ...s,
            pending_balance: (s.pending_balance || 0) + due_amount,
            balance: (s.balance || 0) + due_amount
          } : s));
        }

        if (paid_amount > 0) {
          setSupplierTransactions(prev => [{
            id: `stx_pur_${id}`,
            supplier_id: entry.supplier_id,
            date: normalizedPurchaseDate,
            type: 'Payment',
            amount: paid_amount,
            details: {
              mode: payment_mode,
              note: `Spot Payment for Milk Intake (${entry.quantity}L ${entry.milk_type})`,
              purchase_id: id
            }
          }, ...prev]);

          if (targetAccId) {
            setAccounts(prev => prev.map(a => a.id === targetAccId ? { ...a, balance: (a.balance || 0) - paid_amount } : a));
            setBankTransactions(prev => [{
              id: `btx_pur_${id}`,
              account_id: targetAccId!,
              amount: paid_amount,
              date: normalizedPurchaseDate,
              type: 'Expense',
              category: 'Milk Purchase',
              description: `Milk Intake Payment - ${supplierName} (${entry.quantity}L ${entry.milk_type})`,
              business_day_id: activeShiftSession?.business_day_id,
              shift_session_id: activeShiftSession?.id,
              drawer_id: activeShiftSession?.drawer_id,
              cashier_id: activeShiftSession?.user_id
            } as any, ...prev]);
          }
        }

        await saveWithOutbox('milk_purchase', intakePayload, id, () => procureMilkIntake(intakePayload));

        showToast(
          paid_amount > 0
            ? `Milk Intake of ${entry.quantity}L recorded! (Paid: Rs ${paid_amount.toLocaleString()}, Due: Rs ${due_amount.toLocaleString()})`
            : `Milk Intake of ${entry.quantity}L recorded on Khata (Due: Rs ${total_amount.toLocaleString()})`,
          "success"
        );
        return true;
      } catch (err) {
        showToast(`Error adding purchase: ${getErrorMessage(err)}`, "error");
        return false;
      }
    });

    return lockResult !== null ? lockResult : false;
  };

  const addSale = async (cart: any[], customer: any, subtotal: number, discount: number, total: number, paymentMode: 'Cash' | 'Online' | 'Credit', paidAmount?: number): Promise<boolean> => {
    try {
      const currentBusinessDate = getBusinessDate();
      if (businessDays.some(day => day.business_date === currentBusinessDate && day.status === 'Closed')) {
        showToast("Business Day has been closed & locked! Reopen day or contact Owner to punch bills.", "error");
        return false;
      }
      let shiftToUse = activeShiftSession;

      // Validate that the shift is genuinely active and belongs to the current business day
      const isShiftStale = !shiftToUse ||
        shiftToUse.status !== 'Active' ||
        (shiftToUse.date && shiftToUse.date !== currentBusinessDate) ||
        (shiftToUse.business_date && shiftToUse.business_date !== currentBusinessDate);

      // Attempt to resolve real active shift from live shiftSessions state
      const liveActiveShift = shiftSessions.find(s =>
        (s.user_id === (currentUser?.id || shiftToUse?.user_id) || currentUser?.role_id === 'role_super_admin') &&
        Boolean(s.drawer_id) &&
        ['Pending Acceptance', 'Active', 'Closing'].includes(s.status) &&
        (!s.business_date || s.business_date === currentBusinessDate)
      ) || shiftSessions.find(s =>
        Boolean(s.drawer_id) &&
        ['Pending Acceptance', 'Active', 'Closing'].includes(s.status) &&
        (!s.business_date || s.business_date === currentBusinessDate)
      );

      if (liveActiveShift) {
        shiftToUse = liveActiveShift;
        if (activeShiftSession?.id !== liveActiveShift.id) {
          setActiveShiftSession(liveActiveShift);
          if (typeof window !== 'undefined') {
            localStorage.setItem('mooco_active_shift_session', JSON.stringify(liveActiveShift));
          }
        }
      } else if (isShiftStale) {
        showToast("Shift active nahi hai ya purani date ki hai! Sale karne se pehle active shift start karein.", "warning");
        return false;
      }

      if (!shiftToUse || shiftToUse.status !== 'Active') {
        showToast("Start your shift in Cash Control before making a sale.", "warning");
        return false;
      }

      const saleId = generateUUID();
      const roundedSubtotal = roundCurrency(subtotal);
      const roundedDiscount = roundCurrency(discount);
      const roundedTotal = roundCurrency(total);
      const actualPaid = roundCurrency(paidAmount !== undefined ? Math.max(0, paidAmount) : (paymentMode === 'Credit' ? 0 : roundedTotal));
      const dueAmount = roundCurrency(customer.id ? Math.max(0, roundedTotal - actualPaid) : 0);
      const receivedToPost = roundCurrency(Math.min(actualPaid, roundedTotal));
      const invoiceNumber = generateInvoiceNumber(settings.sales.invoicePrefix || 'INV-');
      const saleDate = new Date().toISOString();

      // Resolve the receipt account NOW and store it with the order, so the
      // background sync deposits into the same account. Cash, and cash handed
      // over against a credit bill, both land in the open drawer — not the
      // default cash account, which may be a different till.
      let receiptAccountId: string | null = null;
      if (actualPaid > 0) {
        receiptAccountId = paymentMode === 'Online'
          ? (settings.financial?.defaultDigitalAccountId || accounts.find(a => a.type === 'Bank' || a.type === 'Wallet')?.id || null)
          : (shiftToUse?.account_id || shiftToUse?.drawer_id || settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id || null);
      }

      const saleData = {
        id: saleId,
        bill_number: invoiceNumber,
        date: saleDate,
        customer_id: customer.id || null,
        customer_name: customer.name || 'Walk-in Customer',
        subtotal: roundedSubtotal,
        discount: roundedDiscount,
        total: roundedTotal,
        paid_amount: actualPaid,
        due_amount: dueAmount,
        payment_mode: paymentMode,
        status: 'Completed' as const,
        items: saleItemSnapshot(cart),
        business_day_id: shiftToUse.business_day_id,
        shift_session_id: shiftToUse.id,
        drawer_id: shiftToUse.drawer_id,
        cashier_id: currentUser?.id || shiftToUse.user_id,
        cashier_name: currentUser?.name || shiftToUse.user_name,
        details: {
          paid_amount: actualPaid,
          due_amount: dueAmount,
          customer_phone: customer.phone,
          cash_given: customer.cashGiven,
          change_return: customer.changeReturn,
          business_day_id: shiftToUse.business_day_id,
          shift_session_id: shiftToUse.id,
          drawer_id: shiftToUse.drawer_id,
          cashier_id: currentUser?.id || shiftToUse.user_id,
          cashier_name: currentUser?.name || shiftToUse.user_name
        }
      };

      // 1. Save locally to Dexie (Offline First)
      const orderRecord: LocalOrder = {
        ...saleData,
        receipt_account_id: receiptAccountId,
        sync_status: 'pending',
        created_at: saleDate
      };
      await db.orders.put(orderRecord);
      noteLocalWrite();

      const orderItems: LocalOrderItem[] = cart.map((item: any) => ({
        id: generateUUID(),
        order_id: saleId,
        item_id: item.itemId || item.id,
        name: item.name,
        qty: item.qty,
        price: item.price,
        total: item.total || (item.qty * item.price),
        variant_id: item.variantId,
        unit: item.unit || (item.variantId ? (item.variantName || 'Pack') : 'Unit'),
        sync_status: 'pending',
        created_at: saleDate
      }));
      if (orderItems.length > 0) {
        await db.order_items.bulkPut(orderItems);
      }

      // 2. Optimistic Update Local UI States (Immediate 0ms response)
      setSales(prev => [saleData, ...prev]);

      // Deduct Inventory in-memory
      const updatesMap: Record<string, { looseDeduction: number, variantDeductions: Record<string, number>, logDetails: string[], name: string }> = {};
      for (const item of cart) {
         const inventoryItem = inventory.find(i => i.item_id === item.id || i.name === item.name);
         if (inventoryItem) {
             const parentId = inventoryItem.item_id!;
             if (!updatesMap[parentId]) {
                 updatesMap[parentId] = { looseDeduction: 0, variantDeductions: {}, logDetails: [], name: inventoryItem.name };
             }
             if (item.variantId && item.deductFromBase !== true) {
                 updatesMap[parentId].variantDeductions[item.variantId] = (updatesMap[parentId].variantDeductions[item.variantId] || 0) + item.qty;
             } else {
                 const contains = item.deductFromBase === true ? (Number(item.stockDeduction) || 1) : 1;
                 updatesMap[parentId].looseDeduction += (Number(item.qty) || 0) * contains;
             }
             updatesMap[parentId].logDetails.push(`${item.qty} x ${item.name}`);
         }
      }

      for (const [parentId, data] of Object.entries(updatesMap)) {
        setInventory(prev => prev.map(i => {
          if (i.item_id === parentId) {
            const newLooseStock = roundQuantity((i.quantity || 0) - data.looseDeduction);
            const newVariantStocks = { ...(i.variant_stocks || {}) };
            for (const [vId, qty] of Object.entries(data.variantDeductions)) {
              newVariantStocks[vId] = roundQuantity((newVariantStocks[vId] || 0) - (qty as number));
            }
            return { ...i, quantity: newLooseStock, variant_stocks: newVariantStocks };
          }
          return i;
        }));

        setItems(prev => prev.map(item => {
          if (item.id === parentId) {
            const newLooseStock = roundQuantity((item.stock || 0) - data.looseDeduction);
            const newVariantStocks = { ...(item.variant_stocks || {}) };
            for (const [vId, qty] of Object.entries(data.variantDeductions)) {
              newVariantStocks[vId] = roundQuantity((newVariantStocks[vId] || 0) - (qty as number));
            }
            return { ...item, stock: newLooseStock, variant_stocks: newVariantStocks };
          }
          return item;
        }));
      }

      // Customer Balance in-memory
      if (customer.id && dueAmount > 0) {
        setCustomers(prev => prev.map(c => c.id === customer.id ? { ...c, balance: (c.balance || 0) + dueAmount } : c));
        setCustomerTransactions(prev => [{
          id: `ctx_${saleId}`,
          customer_id: customer.id,
          date: saleDate.split('T')[0],
          type: 'Charge',
          amount: dueAmount,
          note: `Sale #${invoiceNumber}`,
          business_day_id: activeShiftSession.business_day_id,
          shift_session_id: activeShiftSession.id,
          drawer_id: activeShiftSession.drawer_id,
          cashier_id: currentUser?.id
        }, ...prev]);
      }

      // Same account the sync will credit, so the till balance matches the drawer before reload.
      if (receiptAccountId && receivedToPost > 0) {
        setAccounts(prev => prev.map(a => a.id === receiptAccountId ? { ...a, balance: (a.balance || 0) + receivedToPost } : a));
      }

      // 3. Trigger Non-blocking Background Sync
      syncService.notifyPendingChange().catch(err => console.warn('[POS Sync] Background sync notice:', err));

      showToast("Sale Recorded Successfully", "success");
      return true;
    } catch (err: any) {
      console.error(err);
      showToast("Sale Failed: " + getErrorMessage(err), "error");
      return false;
    }
  };

  const addItem = async (item: Omit<ItemDefinition, 'id'>) => {
    try {
      const trimmedName = (item.name || '').trim();
      if (!trimmedName) {
        showToast("Item name is required", "warning");
        return false;
      }
      if (items.some(i => i.name.trim().toLowerCase() === trimmedName.toLowerCase())) {
        showToast(`An item with the name "${trimmedName}" already exists!`, "error");
        return false;
      }

      const id = `item_${generateUUID()}`;
      const { item_type, isActive, isSystem, category, sort_order, ...rest } = item;
      const dbItem = {
        id,
        type: item_type,
        is_active: isActive !== undefined ? isActive : true,
        is_system: isSystem !== undefined ? isSystem : false,
        stock: 0,
        category: Array.isArray(category) ? category[0] : (category || 'Uncategorized'),
        sort_order: sort_order != null ? Number(sort_order) : 999,
        ...rest
      };
      const { error } = await supabase.from('items').insert([dbItem]);
      if (error) throw error;
      showToast("Item added successfully", "success");
      fetchData();
      return true;
    } catch(e: any) {
      console.error("Error adding item:", e);
      showToast(`Failed to add item: ${e.message || 'Error'}`, "error");
      return false;
    }
  };
  const updateItem = async (id: string, updates: any) => {
    try {
      if (updates.name) {
        const trimmedName = updates.name.trim();
        if (!trimmedName) {
          showToast("Item name cannot be empty", "warning");
          return false;
        }
        if (items.some(i => i.id !== id && i.name.trim().toLowerCase() === trimmedName.toLowerCase())) {
          showToast(`An item with the name "${trimmedName}" already exists!`, "error");
          return false;
        }
      }

      const { item_type, isActive, isSystem, category, sort_order, ...rest } = updates;
      const dbUpdates: any = { ...rest };
      if (item_type !== undefined) dbUpdates.type = item_type;
      if (isActive !== undefined) dbUpdates.is_active = isActive;
      if (isSystem !== undefined) dbUpdates.is_system = isSystem;
      if (category !== undefined) {
        dbUpdates.category = Array.isArray(category) ? category[0] : category;
      }
      if (sort_order !== undefined) {
        dbUpdates.sort_order = sort_order != null ? Number(sort_order) : 999;
      }
      
      const { error } = await supabase.from('items').update(dbUpdates).eq('id', id);
      if (error) throw error;
      showToast("Item updated successfully", "success");
      fetchData();
      return true;
    } catch(e: any) {
      console.error("Error updating item:", e);
      showToast(`Failed to update item: ${e.message || 'Error'}`, "error");
      return false;
    }
  };
  const deleteItem = async (id: string) => {
    try {
      const item = items.find(i => i.id === id);
      if (item?.isSystem || ['item_buffalo_milk', 'item_cow_milk', 'item_mixed_milk'].includes(id) || ['Buffalo Milk', 'Cow Milk', 'Mixed Milk'].includes(item?.name || '')) {
        showToast("System milk varieties cannot be deleted! You can deactivate them in catalog to disable selling and purchasing.", "warning");
        return false;
      }
      const { error } = await supabase.from('items').delete().eq('id', id);
      if (error) throw error;
      showToast("Product deleted successfully", "success");
      fetchData();
      return true;
    } catch(e: any) {
      showToast(`Failed to delete product: ${e.message || 'Error'}`, "error");
      return false;
    }
  };

  const reorderItems = async (orderedItems: { id: string; sort_order: number }[]) => {
    try {
      setItems(prevItems => {
        const orderMap = new Map(orderedItems.map(x => [x.id, x.sort_order]));
        return prevItems.map(item => {
          if (orderMap.has(item.id)) {
            return { ...item, sort_order: orderMap.get(item.id)! };
          }
          return item;
        }).sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || a.name.localeCompare(b.name));
      });

      const updatePromises = orderedItems.map(({ id, sort_order }) =>
        supabase.from('items').update({ sort_order }).eq('id', id)
      );
      await Promise.all(updatePromises);
      showToast("Catalog order updated", "success");
      return true;
    } catch (err: any) {
      console.error("Error reordering items:", err);
      showToast("Failed to save product order", "error");
      fetchData();
      return false;
    }
  };
  
  // === ALLOCATION & PRODUCTION PIPELINE ===
  const allocateBulkMilk = async (itemsList: { allocationId: string, quantity: number }[], destination: string, details: any) => {
    const lockResult = await actionLock.runExclusive(`allocate_bulk_${destination}`, async () => {
      try {
        const updatedAllocations = [...allocations]; 

        for (const item of itemsList) {
          const index = updatedAllocations.findIndex(a => a.id === item.allocationId || a.purchase_id === item.allocationId);
          if (index === -1) continue;

          const allocRecord = updatedAllocations[index];
          const rawRem = (allocRecord.remaining_quantity !== null && allocRecord.remaining_quantity !== undefined)
            ? Number(allocRecord.remaining_quantity)
            : (Number(allocRecord.original_quantity || 0) - Number(allocRecord.allocated_quantity || 0));
          const currentRemaining = isNaN(rawRem) ? 0 : rawRem;
          const deductQty = roundQuantity(Number(item.quantity) || 0);
          const newRemaining = roundQuantity(Math.max(0, currentRemaining - deductQty));
          const newAllocated = roundQuantity((Number(allocRecord.allocated_quantity) || 0) + deductQty);
          
          const isFullyAllocated = newRemaining <= 0.01;
          const status = isFullyAllocated ? AllocationStatus.FULLY_ALLOCATED : AllocationStatus.PARTIALLY_ALLOCATED;
          const finalRemaining = isFullyAllocated ? 0 : newRemaining;

          const currentDetails = (allocRecord.details && typeof allocRecord.details === 'object') ? allocRecord.details : {};
          const prevHistory = Array.isArray(currentDetails.allocation_history) ? currentDetails.allocation_history : [];
          const updatedHistory = [
            ...prevHistory,
            {
              allocated_at: new Date().toISOString(),
              quantity: deductQty,
              destination: destination,
              rate: allocRecord.average_rate || details?.rate
            }
          ];

          const updatedDetails = {
            ...currentDetails,
            allocation_history: updatedHistory,
            last_allocated_at: new Date().toISOString(),
            last_destination: destination
          };

          const destinationToSave = isFullyAllocated 
            ? (destination as DestinationType)
            : (allocRecord.destination || (destination as DestinationType));

          // DB Update
          const { error: updateError } = await supabase.from('allocations').update({ 
              remaining_quantity: finalRemaining,
              allocated_quantity: newAllocated,
              status: status,
              destination: destinationToSave,
              details: updatedDetails
          }).eq('id', allocRecord.id);

          if (updateError) throw updateError;

          // Optimistic State Update
          updatedAllocations[index] = {
              ...allocRecord,
              remaining_quantity: finalRemaining,
              allocated_quantity: newAllocated,
              status: status,
              destination: destinationToSave,
              details: updatedDetails
          };

          if (destination === DestinationType.RETAIL) {
              const typeLower = (allocRecord.milk_type || 'Mixed').toLowerCase();
              const itemDef = items.find(i => {
                  const nameLower = i.name.toLowerCase();
                  return nameLower.includes(typeLower) && nameLower.includes('milk');
              }) || items.find(i => i.name.toLowerCase().includes('milk'));

              if (itemDef) {
                  const { data: currItem } = await supabase.from('items').select('stock, cost_price').eq('id', itemDef.id).single();
                  const currentStock = currItem ? currItem.stock : 0;
                  const newStock = roundQuantity(currentStock + item.quantity);
                  const incomingRate = allocRecord.average_rate || details?.rate || itemDef.cost_price;

                  await supabase.from('items').update({ 
                    stock: newStock,
                    cost_price: incomingRate || itemDef.cost_price 
                  }).eq('id', itemDef.id);

                  // Unified Stock Parity Update across items and inventory
                  syncItemAndInventoryStock(itemDef.id, newStock);
                  
                  await supabase.from('inventory_logs').insert([{
                      id: `log_alloc_${allocRecord.id}_${itemDef.id}_${generateUUID()}`, 
                      date: new Date().toISOString(),
                      item_id: itemDef.id, 
                      item_name: itemDef.name, 
                      old_quantity: currentStock,
                      new_quantity: newStock, 
                      difference: item.quantity, 
                      reason: 'Allocation', 
                      notes: `Allocated to Counter from ${allocRecord.supplier_name || 'Milk Tank'} (Purchase #${allocRecord.purchase_id || 'N/A'})`
                  }]);
              }
          }
        }
        
        setAllocations(updatedAllocations);
        fetchData();
        return true;
      } catch (e) {
        console.error(e);
        showToast("Allocation failed: " + getErrorMessage(e), "error");
        return false;
      }
    });

    return lockResult !== null ? lockResult : false;
  };

  const createBatch = async (
    productName: string, 
    quantity: number, 
    notesOrPriority?: any, 
    priorityOrNotes?: any, 
    inputCostPerUnit?: number,
    estimatedOutput?: number,
    details?: any
  ) => {
    const lockResult = await actionLock.runExclusive(`create_batch_${productName}_${quantity}`, async () => {
      try {
          const id = `batch_${generateUUID()}`;

          const priority = (typeof notesOrPriority === 'string' && Object.values(PriorityLevel).includes(notesOrPriority as any)) 
            ? notesOrPriority 
            : ((typeof priorityOrNotes === 'string' && Object.values(PriorityLevel).includes(priorityOrNotes as any)) 
              ? priorityOrNotes 
              : PriorityLevel.MEDIUM);
              
          const notes = (typeof notesOrPriority === 'string' && !Object.values(PriorityLevel).includes(notesOrPriority as any)) 
            ? notesOrPriority 
            : ((typeof priorityOrNotes === 'string' && !Object.values(PriorityLevel).includes(priorityOrNotes as any)) 
              ? priorityOrNotes 
              : undefined);

          // Dynamic Recipe / Yield Estimation if not passed
          let estOutput = estimatedOutput;
          if (estOutput === undefined || estOutput <= 0) {
            const itemDef = items.find(i => i.name === productName);
            if (itemDef?.recipe_expected_output && itemDef?.recipe_base_quantity && itemDef.recipe_base_quantity > 0) {
              estOutput = (quantity / itemDef.recipe_base_quantity) * itemDef.recipe_expected_output;
            } else {
              estOutput = quantity * 0.85; // Standard 85% default yield
            }
          }

          const safeProductName = productName || 'Dahi (Yogurt)';
          const milkTypeLabel = details?.milk_type ? `${details.milk_type} Milk ` : '';

          const dbBatch: any = {
              id,
              batch_number: `B-${generateUUID().slice(0, 6).toUpperCase()}`,
              product_name: safeProductName,
              status: ProductionStage.PROCESSING,
              priority: priority || PriorityLevel.MEDIUM,
              quantity_input: quantity,
              input_cost_per_unit: inputCostPerUnit || 0,
              quantity_output_estimated: roundQuantity(estOutput || 0), 
              wastage: 0,
              start_date: new Date().toISOString(),
              details: { ...(details || {}), input_cost_per_unit: inputCostPerUnit || 0 },
              logs: [{ 
                stage: ProductionStage.PROCESSING, 
                message: notes ? `Batch Started: ${notes}` : `Batch Started from Milk Allocation (${quantity}L ${milkTypeLabel}@ Rs ${inputCostPerUnit ? inputCostPerUnit.toFixed(1) : 'Avg'})`, 
                timestamp: new Date().toISOString() 
              }]
          };

          // 1. Optimistic Update
          setProductionBatches(prev => [dbBatch as ProductionBatch, ...prev]);

          // 2. DB Insert
          const { error } = await supabase.from('production_batches').insert([dbBatch]);
          if (error) {
              console.error("Failed to create batch in Supabase:", error);
              showToast(`Failed to create batch in DB: ${error.message || 'Error'}`, "error");
              setProductionBatches(prev => prev.filter(b => b.id !== id)); // Revert
              return false;
          }
          
          showToast(`Production batch ${dbBatch.batch_number} for ${safeProductName} created!`, "success");
          fetchData();
          return true;
      } catch (e: any) {
          console.error(e);
          showToast(`Batch creation error: ${e.message || 'Error'}`, "error");
          return false;
      }
    });

    return lockResult !== null ? lockResult : false;
  };

  const allocateFromRetailStock = async (itemsList: any[], destination: string, details: any) => {
    const lockResult = await actionLock.runExclusive(`alloc_retail_${destination}`, async () => {
      try {
          const updatedInventory = [...inventory];
          const updatedItems = [...items];

          for (const item of itemsList) {
              const rawId = item.itemId || item.id || '';
              const actualItemId = rawId.startsWith('inv_') ? rawId.replace('inv_', '') : rawId;
              
              // Robust matching by item ID or name
              let itemDef = updatedItems.find(i => i.id === actualItemId || i.id === rawId || i.name.toLowerCase() === (item.name || '').toLowerCase());
              if (!itemDef) {
                 itemDef = items.find(i => i.id === actualItemId || i.id === rawId);
              }
              if (!itemDef) continue;
              
              const targetId = itemDef.id;
              const { data: currItem } = await supabase.from('items').select('stock, name').eq('id', targetId).single();

              const currentStock = currItem ? roundQuantity(currItem.stock || 0) : roundQuantity(itemDef.cost_price || 0);
              const deductQty = roundQuantity(item.quantity || 0);
              const newStock = roundQuantity(Math.max(0, currentStock - deductQty));

              const { error: allocStockError } = await adjustItemStock(targetId, -deductQty);
              if (allocStockError) throw allocStockError;
              
              // Optimistic Inventory & Items Update
              const idxInv = updatedInventory.findIndex(i => i.item_id === targetId || i.id === `inv_${targetId}`);
              if (idxInv >= 0) {
                 updatedInventory[idxInv] = { ...updatedInventory[idxInv], quantity: newStock };
              }

              const idxItem = updatedItems.findIndex(i => i.id === targetId);
              if (idxItem >= 0) {
                 // @ts-ignore
                 updatedItems[idxItem] = { ...updatedItems[idxItem], stock: newStock };
              }

              await supabase.from('inventory_logs').insert([{
                  id: `log_alloc_ret_${generateUUID()}`, 
                  date: new Date().toISOString(), 
                  item_id: targetId,
                  item_name: itemDef.name, 
                  old_quantity: currentStock, 
                  new_quantity: newStock, 
                  difference: -deductQty, 
                  reason: 'Allocation', 
                  notes: `Leftover Milk Allocated to ${destination}`
              }]);
          }
          setInventory(updatedInventory);
          setItems(updatedItems);
          fetchData();
          return true;
      } catch (e) { 
        console.error("allocateFromRetailStock error:", e); 
        return false; 
      }
    });

    return lockResult !== null ? lockResult : false;
  };
  
  const updateBatchStage = async (batchId: string, newStage: ProductionStage, logMessage?: string, outputData?: { variants: { variantId: string, count: number }[], looseQty: number }) => {
    const lockResult = await actionLock.runExclusive(`update_batch_stage_${batchId}`, async () => {
      try {
        const batchIndex = productionBatches.findIndex(b => b.id === batchId);
        if (batchIndex === -1) return false;
        
        const batch = productionBatches[batchIndex];

        // 1. In-Memory Idempotency Check: If already in requested terminal stage, skip
        if (batch.status === newStage) {
          console.warn(`[Batch Idempotency] Batch ${batchId} is already in stage ${newStage}. Skipping duplicate.`);
          return true;
        }

        // 2. Database Idempotency Check: Check Supabase DB to prevent race conditions
        const { data: dbBatch } = await supabase.from('production_batches').select('status').eq('id', batchId).maybeSingle();
        if (dbBatch && dbBatch.status === newStage) {
          console.warn(`[Batch DB Idempotency] Batch ${batchId} is already ${newStage} in database. Skipping duplicate.`);
          return true;
        }

        const newLogs = [...(batch.logs || []), { stage: newStage, message: logMessage || `Moved to ${newStage}`, timestamp: new Date().toISOString() }];
        const updatePayload: any = { status: newStage, logs: newLogs };

        if (newStage === ProductionStage.COMPLETED) {
            updatePayload.completed_date = new Date().toISOString();
            
            const variantsList: any[] = outputData?.variants || [];
            const hasVariants = variantsList.length > 0;

            // 1. Calculate variant base weight in kg/units
            const variantBaseKg = variantsList.reduce((sum, v) => {
              const qtyEach = v.base_qty_each !== undefined ? Number(v.base_qty_each) || 0 : (v.total_base_qty ? (Number(v.total_base_qty) || 0) / (Number(v.count) || 1) : 0);
              const totalBase = v.total_base_qty !== undefined ? Number(v.total_base_qty) || 0 : (qtyEach * (Number(v.count) || 0));
              return sum + totalBase;
            }, 0);

            // 2. Loose quantity in base units (kg/L)
            const looseQty = outputData?.looseQty !== undefined 
              ? (Number(outputData.looseQty) || 0) 
              : (hasVariants ? 0 : (batch.quantity_output_estimated || (batch.quantity_input ? batch.quantity_input * 0.85 : 0)));

            // 3. Total actual production output in base units (e.g. 11.5 kg = 0.5kg loose + 11kg packaged)
            let actualTotalOutput = roundQuantity(looseQty + variantBaseKg);
            if (actualTotalOutput <= 0) {
               actualTotalOutput = roundQuantity(batch.quantity_output_estimated || (batch.quantity_input ? batch.quantity_input * 0.85 : 0));
            }

            updatePayload.quantity_output_actual = actualTotalOutput;
            // Keep pack sizes/counts as they were at completion. A later catalog edit
            // must not change the historical stock-profit report.
            const costProduct = items.find(i => i.name.trim().toLowerCase() === String(batch.product_name || '').trim().toLowerCase());
            const recipeInputs = (costProduct?.recipe || []).map(ingredient => {
              const material = items.find(i => i.id === ingredient.item_id);
              const scale = costProduct?.recipe_base_quantity ? (batch.quantity_input || 0) / costProduct.recipe_base_quantity : 0;
              return { item_id: ingredient.item_id, name: ingredient.item_name, quantity: roundQuantity(ingredient.quantity * scale), unit: ingredient.unit, unit_cost: material?.cost_price || 0 };
            });
            const packagingInputs = variantsList.flatMap(v => {
              const variant = costProduct?.variants?.find(def => def.id === v.variantId);
              const material = items.find(i => i.id === variant?.packaging_item_id);
              return variant?.packaging_item_id ? [{ item_id: variant.packaging_item_id, name: material?.name || variant.packaging_item_name, quantity: roundQuantity((Number(v.count) || 0) * (variant.packaging_qty || 0)), unit: material?.unit, unit_cost: material?.cost_price || 0 }] : [];
            });
            updatePayload.details = {
              ...(batch.details || {}),
              output_breakdown: { loose_qty: hasVariants ? looseQty : actualTotalOutput, variants: variantsList },
              cost_snapshot: {
                saved_at: updatePayload.completed_date,
                milk_cost: (batch.quantity_input || 0) * (batch.input_cost_per_unit || batch.details?.input_cost_per_unit || 0),
                ingredients: recipeInputs,
                packaging: packagingInputs,
                // Existing production does not post these consumptions to stock.
                // Preserve that fact so the profit report requests reconciliation.
                materials_posted: ![...recipeInputs, ...packagingInputs].some(input => input.quantity > 0),
                external_conversion_cost: 0
              }
            };
            
            // Deterministic log ID for this batch completion to prevent double-increment
            const deterministicLogId = `log_prod_${batch.id}`;
            
            // Check if log already exists in Supabase (idempotency guard)
            const { data: existingLog } = await supabase.from('inventory_logs').select('id').eq('id', deterministicLogId).maybeSingle();
            
            if (!existingLog) {
                // STOCK UPDATE in Inventory & Items
                const batchProdName = (batch.product_name || '').trim().toLowerCase();
                let item = items.find(i => i.name.trim().toLowerCase() === batchProdName) 
                        || items.find(i => i.name.toLowerCase().includes(batchProdName) || batchProdName.includes(i.name.toLowerCase()));

                if (item) {
                    const { data: currentItem } = await supabase.from('items').select('stock, variant_stocks').eq('id', item.id).single();
                    const currentStock = currentItem ? (currentItem.stock || 0) : 0;

                    // Loose stock is updated with ONLY the loose quantity produced (if item has variants, loose stock only gets looseQty)
                    const looseToAdd = hasVariants ? looseQty : actualTotalOutput;
                    const newLooseStock = roundQuantity(currentStock + looseToAdd);

                    // Variant stocks are updated with the count of each packaged variant
                    const variantDeltas: Record<string, number> = {};
                    if (hasVariants) {
                        variantsList.forEach(v => {
                          if (v.variantId) {
                            variantDeltas[v.variantId] = roundQuantity((variantDeltas[v.variantId] || 0) + (Number(v.count) || 0));
                          }
                        });
                    }

                    const { error: prodStockError } = await adjustItemStock(item.id, looseToAdd, variantDeltas);
                    if (prodStockError) throw prodStockError;
                    const newVariantStocks = currentItem?.variant_stocks ? { ...currentItem.variant_stocks } : {};
                    Object.entries(variantDeltas).forEach(([vId, qty]) => {
                      newVariantStocks[vId] = roundQuantity((newVariantStocks[vId] || 0) + qty);
                    });
                    
                    // Optimistic Stock Update for both inventory and items
                    setInventory(prev => prev.map(i => i.item_id === item!.id ? { ...i, quantity: newLooseStock, variant_stocks: newVariantStocks } : i));
                    setItems(prev => prev.map(i => i.id === item!.id ? { ...i, stock: newLooseStock, variant_stocks: newVariantStocks } : i));

                    const variantLogSummary = hasVariants
                      ? ` [Packaged: ${variantsList.map(v => `${v.count}x ${v.variant_name}`).join(', ')}]`
                      : '';
                    const logNote = `Batch #${batch.batch_number} (${batch.product_name}) Completed: ${looseQty > 0 ? `${looseQty}${item.unit} loose` : ''}${variantLogSummary} (Total: ${actualTotalOutput}${item.unit})`;

                    await supabase.from('inventory_logs').insert([{
                        id: deterministicLogId, 
                        date: new Date().toISOString(), 
                        item_id: item.id, 
                        item_name: item.name,
                        old_quantity: currentStock, 
                        new_quantity: newLooseStock, 
                        difference: looseToAdd,
                        reason: 'Production', 
                        notes: logNote.trim()
                    }]);
                } else {
                    // Auto-create item in items master if it doesn't exist yet
                    const newItemId = `item_${batch.product_name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${generateUUID().slice(0, 8)}`;
                    const initialVariantStocks: Record<string, number> = {};
                    if (hasVariants) {
                      variantsList.forEach(v => {
                        if (v.variantId) initialVariantStocks[v.variantId] = Number(v.count) || 0;
                      });
                    }
                    const newItemPayload: any = {
                        id: newItemId,
                        name: batch.product_name,
                        category: 'Dairy products',
                        type: ['Sale product', 'Dairy products'],
                        stock: hasVariants ? looseQty : actualTotalOutput,
                        cost_price: 180,
                        selling_price: 240,
                        unit: 'kg',
                        is_active: true,
                        is_system: false,
                        source: 'Production',
                        recipe: [],
                        variants: [],
                        variant_stocks: initialVariantStocks
                    };
                    await supabase.from('items').insert([newItemPayload]);
                    
                    await supabase.from('inventory_logs').insert([{
                        id: deterministicLogId, 
                        date: new Date().toISOString(), 
                        item_id: newItemId, 
                        item_name: batch.product_name,
                        old_quantity: 0, 
                        new_quantity: actualTotalOutput, 
                        difference: actualTotalOutput,
                        reason: 'Production', 
                        notes: `Batch #${batch.batch_number} (${batch.product_name}) Initial Output Stock`
                    }]);
                }
            }
        } else if (newStage === ProductionStage.CANCELLED) {
            updatePayload.completed_date = new Date().toISOString(); 

            // Return input milk back to unallocated pool if not already cancelled and quantity > 0
            if (batch.status !== ProductionStage.CANCELLED && batch.quantity_input && batch.quantity_input > 0) {
                const returnAllocId = `alloc_ret_batch_${batch.id}`;
                
                // Idempotency check on allocation return
                const { data: existingAlloc } = await supabase.from('allocations').select('id').eq('id', returnAllocId).maybeSingle();
                if (!existingAlloc) {
                    // Determine exact return milk type:
                    // 1. If batch details has explicit milk_type ('Cow' | 'Buffalo' | 'Mixed')
                    // 2. If milk breakdown contains only Cow -> Cow, only Buffalo -> Buffalo
                    // 3. If mixed or both Cow & Buffalo -> Mixed
                    // 4. Check batch logs or product name for Cow/Buffalo
                    let returnMilkType: MilkType = MilkType.MIXED;
                    const bDetails = batch.details || (batch as any).details;
                    const rawType = bDetails?.milk_type || (batch as any).milk_type;

                    if (rawType) {
                      const lower = String(rawType).toLowerCase();
                      if (lower.includes('buffalo')) returnMilkType = MilkType.BUFFALO;
                      else if (lower.includes('cow')) returnMilkType = MilkType.COW;
                      else returnMilkType = MilkType.MIXED;
                    } else if (bDetails?.milk_breakdown && Array.isArray(bDetails.milk_breakdown) && bDetails.milk_breakdown.length > 0) {
                      const types = Array.from(new Set(bDetails.milk_breakdown.map((m: any) => String(m.milkType || '').toLowerCase())));
                      const hasCow = types.some((t: string) => t.includes('cow'));
                      const hasBuffalo = types.some((t: string) => t.includes('buffalo'));
                      if (hasCow && !hasBuffalo) returnMilkType = MilkType.COW;
                      else if (hasBuffalo && !hasCow) returnMilkType = MilkType.BUFFALO;
                      else returnMilkType = MilkType.MIXED;
                    } else {
                      const logsText = (batch.logs || []).map(l => l.message).join(' ').toLowerCase();
                      const prodText = (batch.product_name || '').toLowerCase();
                      if (logsText.includes('cow milk') || prodText.includes('cow')) {
                        returnMilkType = MilkType.COW;
                      } else if (logsText.includes('buffalo milk') || prodText.includes('buffalo')) {
                        returnMilkType = MilkType.BUFFALO;
                      } else {
                        returnMilkType = MilkType.MIXED;
                      }
                    }

                    const returnRecord: AllocationEntry = {
                        id: returnAllocId,
                        purchase_id: `ret_batch_${batch.id}`,
                        date: new Date().toISOString(),
                        supplier_name: `Return: Batch #${batch.batch_number} (${batch.product_name})`,
                        milk_type: returnMilkType,
                        original_quantity: batch.quantity_input,
                        allocated_quantity: 0,
                        remaining_quantity: batch.quantity_input,
                        status: AllocationStatus.UNALLOCATED,
                        average_rate: batch.input_cost_per_unit || 0,
                        details: { 
                            returned_from_batch_id: batch.id, 
                            batch_number: batch.batch_number, 
                            product_name: batch.product_name,
                            milk_type: returnMilkType,
                            cancel_reason: logMessage || 'Batch Cancelled' 
                        }
                    };

                    const { error: allocErr } = await supabase.from('allocations').insert([returnRecord]);
                    if (allocErr) {
                        console.error("Failed to insert returned milk allocation:", allocErr);
                    }

                    setAllocations(prev => [returnRecord, ...prev]);
                    showToast(`Batch #${batch.batch_number} cancelled. ${batch.quantity_input} L returned to Unallocated ${returnMilkType} Milk.`, "success");
                }
            }
        }

        // Optimistic Update
        const updatedBatch = { ...batch, ...updatePayload };
        setProductionBatches(prev => {
            const newList = [...prev];
            newList[batchIndex] = updatedBatch;
            return newList;
        });

        await supabase.from('production_batches').update(updatePayload).eq('id', batchId);
        if (newStage !== ProductionStage.CANCELLED) {
            showToast("Batch Updated & Inventory Synced", "success");
        }
        fetchData();
        return true;
      } catch (e) {
        console.error(e);
        return false;
      }
    });

    return lockResult !== null ? lockResult : false;
  };

  const cancelBatch = async (id: string, reason: string) => {
      return updateBatchStage(id, ProductionStage.CANCELLED, `Cancelled: ${reason}`);
  };
  
  const returnPurchase = async (purchaseId: string, returnQty?: number, reason: string = 'Milk Return to Supplier'): Promise<boolean> => {
    try {
      const purchase = purchases.find(p => p.id === purchaseId);
      if (!purchase) {
        showToast("Purchase record not found", "error");
        return false;
      }

      if (purchase.status === 'Returned') {
        showToast("This purchase entry is already fully returned", "warning");
        return false;
      }

      const totalPurchaseQty = purchase.quantity || 0;
      const actualReturnQty = (returnQty !== undefined && returnQty > 0 && returnQty <= totalPurchaseQty) 
        ? returnQty 
        : totalPurchaseQty;
      
      const isFullReturn = actualReturnQty >= totalPurchaseQty;
      const returnAmount = Math.round(actualReturnQty * (purchase.rate || 0));
      const remainingAcceptedQty = Number((totalPurchaseQty - actualReturnQty).toFixed(3));
      const remainingAcceptedAmount = Math.round(remainingAcceptedQty * (purchase.rate || 0));

      // 1. Check allocation status: Is enough unallocated milk available to return?
      const alloc = allocations.find(a => a.purchase_id === purchaseId || a.id === `alloc_${purchaseId}`);
      if (alloc) {
        const remainingUnallocated = alloc.remaining_quantity !== null && alloc.remaining_quantity !== undefined 
          ? alloc.remaining_quantity 
          : alloc.original_quantity;
        
        if (remainingUnallocated < actualReturnQty) {
          showToast(`Cannot return ${actualReturnQty} L: Only ${remainingUnallocated} L remains unallocated. (${alloc.allocated_quantity || 0} L was already allocated to processing).`, "error");
          return false;
        }
      }

      const returnDate = new Date().toISOString().split('T')[0];
      const returnTimestamp = new Date().toISOString();

      if (isFullReturn) {
        // Full Return
        const { error: purErr } = await supabase.from('purchases').update({
          status: 'Returned',
          return_reason: reason,
          returned_at: returnTimestamp,
          details: {
            ...((purchase as any).details || {}),
            returned: true,
            returned_quantity: totalPurchaseQty,
            return_reason: reason,
            returned_at: returnTimestamp,
            original_quantity: totalPurchaseQty
          }
        }).eq('id', purchaseId);

        if (purErr) throw purErr;

        setPurchases(prev => prev.map(p => p.id === purchaseId ? {
          ...p,
          status: 'Returned',
          return_reason: reason,
          returned_at: returnTimestamp
        } : p));

        // Remove from Allocations pool
        if (alloc) {
          await supabase.from('allocations').delete().eq('id', alloc.id);
          setAllocations(prev => prev.filter(a => a.id !== alloc.id));
        }
      } else {
        // Partial Return
        const prevDetails = ((purchase as any).details || {}) as any;
        const origPaidForRemainder = Number(purchase.paid_amount || prevDetails.paid_amount || 0);
        const billBeforeReturn = Number(purchase.total_amount || 0) || (totalPurchaseQty * (purchase.rate || 0));
        const paidRatioForRemainder = billBeforeReturn > 0 ? origPaidForRemainder / billBeforeReturn : 0;
        const cashAlreadyRefunded = roundCurrency(Math.min(origPaidForRemainder, returnAmount * paidRatioForRemainder));
        const remainingPaid = roundCurrency(Math.max(0, origPaidForRemainder - cashAlreadyRefunded));
        const updatedDetails = {
          ...prevDetails,
          partial_returned: true,
          returned_quantity: (Number(prevDetails.returned_quantity) || 0) + actualReturnQty,
          last_return_reason: reason,
          last_returned_at: returnTimestamp,
          original_intake_quantity: prevDetails.original_intake_quantity || totalPurchaseQty,
          original_paid_amount: prevDetails.original_paid_amount ?? origPaidForRemainder,
          paid_amount: remainingPaid,
          due_amount: roundCurrency(Math.max(0, remainingAcceptedAmount - remainingPaid)),
          account_id: prevDetails.account_id || (purchase as any).account_id,
          payment_mode: prevDetails.payment_mode || (purchase as any).payment_mode
        };

        const { error: purErr } = await supabase.from('purchases').update({
          quantity: remainingAcceptedQty,
          total_amount: remainingAcceptedAmount,
          status: 'Completed',
          return_reason: `Partial Return: ${actualReturnQty}L returned (${reason})`,
          details: updatedDetails
        }).eq('id', purchaseId);

        if (purErr) throw purErr;

        setPurchases(prev => prev.map(p => p.id === purchaseId ? {
          ...p,
          quantity: remainingAcceptedQty,
          total_amount: remainingAcceptedAmount,
          paid_amount: remainingPaid,
          due_amount: roundCurrency(Math.max(0, remainingAcceptedAmount - remainingPaid)),
          return_reason: `Partial Return: ${actualReturnQty}L returned (${reason})`,
          details: updatedDetails
        } : p));

        // Update Allocations pool
        if (alloc) {
          const newAllocRemaining = roundQuantity(Math.max(0, (alloc.remaining_quantity || alloc.original_quantity) - actualReturnQty));
          const newAllocOriginal = roundQuantity(Math.max(0, alloc.original_quantity - actualReturnQty));
          await supabase.from('allocations').update({
            original_quantity: newAllocOriginal,
            remaining_quantity: newAllocRemaining
          }).eq('id', alloc.id);

          setAllocations(prev => prev.map(a => a.id === alloc.id ? {
            ...a,
            original_quantity: newAllocOriginal,
            remaining_quantity: newAllocRemaining
          } : a));
        }
      }

      // 2. Financial Reversal:
      // If purchase was paid on the spot (spot cash/bank), refund the paid amount back to the financial account
      const origPaidAmount = Number(purchase.paid_amount || (purchase as any).details?.paid_amount || 0);
      const paymentAccountId = (purchase as any).details?.account_id || (purchase as any).account_id;
      const totalAmount = Number(purchase.total_amount || 0) || (totalPurchaseQty * (purchase.rate || 0));
      
      let cashRefundAmount = 0;
      if (origPaidAmount > 0 && paymentAccountId) {
        const paidRatio = totalAmount > 0 ? (origPaidAmount / totalAmount) : 0;
        cashRefundAmount = roundCurrency(Math.min(origPaidAmount, returnAmount * paidRatio));
        
        if (cashRefundAmount > 0) {
          const { error: accRefundErr } = await adjustAccountBalance(paymentAccountId, cashRefundAmount);
          if (!accRefundErr) {
            setAccounts(prev => prev.map(a => a.id === paymentAccountId ? { ...a, balance: (a.balance || 0) + cashRefundAmount } : a));
            
            const btxRefundId = `btx_purret_${generateUUID()}`;
            const btxRecord = {
              id: btxRefundId,
              account_id: paymentAccountId,
              amount: cashRefundAmount,
              date: returnTimestamp,
              type: 'Income',
              category: 'Purchase Return',
              description: `Milk Return Cash Refund: ${suppliers.find(s => s.id === purchase.supplier_id)?.name || 'Gwala'} (${actualReturnQty}L)`,
              reference_id: purchase.id,
              business_day_id: activeShiftSession?.business_day_id,
              shift_session_id: activeShiftSession?.id,
              drawer_id: activeShiftSession?.drawer_id,
              cashier_id: activeShiftSession?.user_id
            };
            await supabase.from('bank_transactions').insert([btxRecord]);
            setBankTransactions(prev => [btxRecord as any, ...prev]);
          }
        }
      }

      // Reverse Supplier Pending Balance by the remaining credit portion
      const creditToReduce = roundCurrency(Math.max(0, returnAmount - cashRefundAmount));
      const supplier = suppliers.find(s => s.id === purchase.supplier_id);
      if (supplier && creditToReduce > 0) {
        const newBal = roundCurrency((supplier.pending_balance || 0) - creditToReduce);
        const { error: suppRevError } = await adjustSupplierBalance(supplier.id, -creditToReduce);
        if (suppRevError) throw suppRevError;
        setSuppliers(prev => prev.map(s => s.id === supplier.id ? { ...s, pending_balance: newBal, balance: newBal } : s));
      }

      if (supplier) {
        // Log in supplier_transactions
        await supabase.from('supplier_transactions').insert([{
          id: `stx_ret_${generateUUID()}`,
          supplier_id: supplier.id,
          date: returnTimestamp,
          type: 'Return',
          amount: returnAmount,
          details: {
            note: `${isFullReturn ? 'Full' : 'Partial'} Milk Return: ${actualReturnQty}L @ Rs ${purchase.rate}/L (${reason})${cashRefundAmount > 0 ? ` (Cash Refunded: Rs ${cashRefundAmount})` : ''}`,
            purchase_id: purchase.id,
            cash_refund: cashRefundAmount,
            account_id: paymentAccountId
          }
        }]);
      }

      // 3. Log in inventory_logs
      await supabase.from('inventory_logs').insert([{
        id: `log_pur_ret_${generateUUID()}`,
        date: returnTimestamp,
        item_id: 'milk_raw',
        item_name: `${purchase.milk_type} Milk (Raw)`,
        old_quantity: totalPurchaseQty,
        new_quantity: remainingAcceptedQty,
        difference: -actualReturnQty,
        reason: AdjustmentReason.SUPPLY_RETURN,
        notes: `${isFullReturn ? 'Full' : 'Partial'} Return to Supplier (${supplier?.name || 'Gwala'}): ${actualReturnQty}L (${reason})`
      }]);

      showToast(
        isFullReturn 
          ? `Full milk purchase of ${actualReturnQty}L returned to supplier! Balance reduced by Rs ${returnAmount.toLocaleString()}.` 
          : `Partial return of ${actualReturnQty}L processed! ${remainingAcceptedQty}L kept (Rs ${returnAmount.toLocaleString()} deducted from supplier).`,
        "success"
      );

      fetchData();
      return true;
    } catch (err: any) {
      console.error("returnPurchase error:", err);
      showToast(`Failed to return milk purchase: ${err?.message || 'Error'}`, "error");
      return false;
    }
  };

  const returnMaterialPurchase = async (purchaseId: string, returnQty?: number, reason: string = 'Material Return to Supplier'): Promise<boolean> => {
    try {
      const mp = materialPurchases.find(p => p.id === purchaseId);
      if (!mp) {
        showToast("Material purchase record not found", "error");
        return false;
      }

      if (mp.status === 'Returned') {
        showToast("This material purchase is already returned", "warning");
        return false;
      }

      const totalPurchaseQty = mp.quantity || 0;
      const actualReturnQty = (returnQty !== undefined && returnQty > 0 && returnQty <= totalPurchaseQty) 
        ? returnQty 
        : totalPurchaseQty;
      
      const isFullReturn = actualReturnQty >= totalPurchaseQty;
      const returnAmount = Math.round(actualReturnQty * (mp.rate || 0));
      const remainingAcceptedQty = Number((totalPurchaseQty - actualReturnQty).toFixed(3));
      const remainingAcceptedAmount = Math.round(remainingAcceptedQty * (mp.rate || 0));

      const returnTimestamp = new Date().toISOString();
      const prevDetails = ((mp as any).details || {}) as any;
      const origPaidAmount = Number((mp as any).paid_amount || prevDetails.paid_amount || 0);
      const paymentAccountId = prevDetails.account_id || (mp as any).account_id;
      const totalAmount = Number(mp.total_amount || 0) || (totalPurchaseQty * (mp.rate || 0));
      const paidRatio = totalAmount > 0 ? (origPaidAmount / totalAmount) : 0;
      const cashRefundAmount = origPaidAmount > 0 && paymentAccountId
        ? roundCurrency(Math.min(origPaidAmount, returnAmount * paidRatio))
        : 0;
      const remainingPaid = roundCurrency(Math.max(0, origPaidAmount - cashRefundAmount));

      // Check stock availability
      const itemDef = items.find(i => i.id === mp.item_id || i.name.toLowerCase() === mp.item_name.toLowerCase());

      if (isFullReturn) {
        // Keep the original payment details. Replacing details used to wipe
        // paid_amount and the drawer account, so the return could not be tied
        // back to the cash that left.
        const returnedDetails = {
          ...prevDetails,
          returned: true,
          return_reason: reason,
          returned_at: returnTimestamp,
          returned_quantity: totalPurchaseQty,
          original_paid_amount: prevDetails.original_paid_amount ?? origPaidAmount,
          paid_amount: remainingPaid,
          account_id: paymentAccountId,
          cash_refund: cashRefundAmount
        };
        const { error: mpErr } = await supabase.from('material_purchases').update({
          status: 'Returned',
          details: returnedDetails
        }).eq('id', purchaseId);

        if (mpErr) throw mpErr;

        setMaterialPurchases(prev => prev.map(p => p.id === purchaseId ? {
          ...p,
          status: 'Returned',
          paid_amount: remainingPaid,
          details: returnedDetails
        } : p));
      } else {
        const partialDetails = {
          ...prevDetails,
          partial_returned: true,
          returned_quantity: (Number(prevDetails.returned_quantity) || 0) + actualReturnQty,
          return_reason: reason,
          returned_at: returnTimestamp,
          original_paid_amount: prevDetails.original_paid_amount ?? origPaidAmount,
          paid_amount: remainingPaid,
          due_amount: roundCurrency(Math.max(0, remainingAcceptedAmount - remainingPaid)),
          account_id: paymentAccountId,
          cash_refund: roundCurrency((Number(prevDetails.cash_refund) || 0) + cashRefundAmount)
        };
        const { error: mpErr } = await supabase.from('material_purchases').update({
          quantity: remainingAcceptedQty,
          total_amount: remainingAcceptedAmount,
          status: 'Completed',
          details: partialDetails
        }).eq('id', purchaseId);

        if (mpErr) throw mpErr;

        setMaterialPurchases(prev => prev.map(p => p.id === purchaseId ? {
          ...p,
          quantity: remainingAcceptedQty,
          total_amount: remainingAcceptedAmount,
          paid_amount: remainingPaid,
          details: partialDetails
        } : p));
      }

      // 2. Deduct stock from items & inventory
      if (itemDef) {
        const returnConversion = Number(prevDetails.conversion_factor) || 1;
        const actualReturnBaseQty = roundQuantity(actualReturnQty * returnConversion);
        const newStock = roundQuantity(Math.max(0, (itemDef.stock || 0) - actualReturnBaseQty));
        const { error: mpStockError } = await adjustItemStock(itemDef.id, -actualReturnBaseQty);
        if (mpStockError) throw mpStockError;
        setInventory(prev => prev.map(inv => inv.item_id === itemDef.id ? { ...inv, quantity: newStock } : inv));

        // Log in inventory_logs
        await supabase.from('inventory_logs').insert([{
          id: `log_mp_ret_${generateUUID()}`,
          date: returnTimestamp,
          item_id: itemDef.id,
          item_name: itemDef.name,
          old_quantity: itemDef.stock || 0,
          new_quantity: newStock,
          difference: -actualReturnBaseQty,
          reason: AdjustmentReason.SUPPLY_RETURN,
          notes: `${isFullReturn ? 'Full' : 'Partial'} Material Return to Supplier: ${actualReturnQty} ${mp.unit} (${reason})`
        }]);
      }

      // 3. Financial Reversal:
      // If material purchase was paid (spot cash/bank), refund the paid amount back to the financial account
      if (cashRefundAmount > 0 && paymentAccountId) {
          const { error: accRefundErr } = await adjustAccountBalance(paymentAccountId, cashRefundAmount);
          if (!accRefundErr) {
            setAccounts(prev => prev.map(a => a.id === paymentAccountId ? { ...a, balance: (a.balance || 0) + cashRefundAmount } : a));

            const btxRefundId = `btx_mpret_${generateUUID()}`;
            const btxRecord = {
              id: btxRefundId,
              account_id: paymentAccountId,
              amount: cashRefundAmount,
              date: returnTimestamp,
              type: 'Income',
              category: 'Purchase Return',
              description: `Material Return Cash Refund: ${mp.item_name} (${actualReturnQty} ${mp.unit})`,
              reference_id: mp.id,
              business_day_id: activeShiftSession?.business_day_id,
              shift_session_id: activeShiftSession?.id,
              drawer_id: activeShiftSession?.drawer_id,
              cashier_id: activeShiftSession?.user_id
            };
            await supabase.from('bank_transactions').insert([btxRecord]);
            setBankTransactions(prev => [btxRecord as any, ...prev]);
          }
      }

      // Reverse supplier pending balance by remaining credit portion
      const creditToReduce = roundCurrency(Math.max(0, returnAmount - cashRefundAmount));
      if (mp.supplier_id && creditToReduce > 0) {
        const supplier = suppliers.find(s => s.id === mp.supplier_id);
        if (supplier) {
          const newBal = roundCurrency((supplier.pending_balance || 0) - creditToReduce);
          const { error: mpSuppError } = await adjustSupplierBalance(supplier.id, -creditToReduce);
          if (mpSuppError) throw mpSuppError;
          setSuppliers(prev => prev.map(s => s.id === supplier.id ? { ...s, pending_balance: newBal, balance: newBal } : s));
        }
      }

      if (mp.supplier_id) {
        const supplier = suppliers.find(s => s.id === mp.supplier_id);
        await supabase.from('supplier_transactions').insert([{
          id: `stx_mpret_${generateUUID()}`,
          supplier_id: supplier ? supplier.id : mp.supplier_id,
          date: returnTimestamp,
          type: 'Return',
          amount: returnAmount,
          details: {
            note: `${isFullReturn ? 'Full' : 'Partial'} Material Return: ${actualReturnQty} ${mp.unit} of ${mp.item_name} (${reason})${cashRefundAmount > 0 ? ` (Cash Refunded: Rs ${cashRefundAmount})` : ''}`,
            purchase_id: mp.id,
            cash_refund: cashRefundAmount,
            account_id: paymentAccountId
          }
        }]);
      }

      showToast(
        isFullReturn 
          ? `Full material purchase of ${actualReturnQty} ${mp.unit} returned to supplier!` 
          : `Partial return of ${actualReturnQty} ${mp.unit} returned! ${remainingAcceptedQty} ${mp.unit} kept.`,
        "success"
      );

      fetchData();
      return true;
    } catch (err: any) {
      console.error("returnMaterialPurchase error:", err);
      showToast(`Failed to return material purchase: ${err?.message || 'Error'}`, "error");
      return false;
    }
  };

  const deletePurchase = async (id: string) => { return returnPurchase(id, undefined, 'Deleted by user'); };
  const deleteMaterialPurchase = async (id: string) => { return returnMaterialPurchase(id, undefined, 'Deleted by user'); };
  
  const addBulkMaterialPurchase = async (data: any) => { 
      try {
          const { supplier_id, date, items: cartItems, purchase_type, paid_amount, payment_mode, account_id } = data;
          const totalBill = roundCurrency(cartItems.reduce((sum: number, item: any) => sum + (Number(item.quantity) || 0) * (Number(item.rate) || 0), 0));
          const effectivePaid = roundCurrency(paid_amount !== undefined ? paid_amount : (!supplier_id ? totalBill : 0));

          let resolvedTargetAccId: string | undefined = undefined;
          if (effectivePaid > 0) {
            const isCashMode = !payment_mode || payment_mode.toLowerCase().includes('cash');
            resolvedTargetAccId = account_id || (
              isCashMode
                ? (activeShiftSession?.account_id || activeShiftSession?.drawer_id || settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash' && a.isActive !== false)?.id || accounts.find(a => a.isActive !== false)?.id)
                : (settings.financial?.defaultDigitalAccountId || accounts.find(a => (a.type === 'Bank' || a.type === 'Wallet') && a.isActive !== false)?.id || accounts.find(a => a.isActive !== false)?.id)
            );
            if (!resolvedTargetAccId) {
              throw new Error("Payment account nahi mila! Pehle 'Bank & Cash' module men account banayein ya bill ko Khata per save karein.");
            }
          }

          const lineTotals = cartItems.map((item: any) => roundCurrency((Number(item.quantity) || 0) * (Number(item.rate) || 0)));
          let paidRemaining = effectivePaid;
          const linePaids = lineTotals.map((lineTotal: number, index: number) => {
            if (index === lineTotals.length - 1) return roundCurrency(Math.max(0, paidRemaining));
            const share = totalBill > 0 ? roundCurrency((lineTotal / totalBill) * effectivePaid) : 0;
            paidRemaining = roundCurrency(paidRemaining - share);
            return share;
          });

          const createdMaterialIds: string[] = [];
          for (let index = 0; index < cartItems.length; index++) {
              const item = cartItems[index];
              const lineTotal = lineTotals[index];
              const linePaid = linePaids[index];
              const lineDue = roundCurrency(Math.max(0, lineTotal - linePaid));
              const materialId = `mp_${generateUUID()}`;
              createdMaterialIds.push(materialId);

              const mpEntry = {
                  id: materialId,
                  date, 
                  supplier_id: supplier_id || null, 
                  item_id: item.item_id, 
                  item_name: item.item_name,
                  quantity: item.quantity, 
                  unit: item.unit, 
                  rate: item.rate,
                  total_amount: lineTotal,
                  paid_amount: linePaid,
                  due_amount: lineDue,
                  business_day_id: activeShiftSession?.business_day_id,
                  shift_session_id: activeShiftSession?.id,
                  drawer_id: activeShiftSession?.drawer_id,
                  cashier_id: activeShiftSession?.user_id,
                  purchase_type, 
                  status: 'Completed',
                  details: {
                    paid_amount: linePaid,
                    due_amount: lineDue,
                    payment_mode: linePaid > 0 ? (payment_mode || 'Cash') : undefined,
                    account_id: linePaid > 0 ? resolvedTargetAccId : undefined,
                    conversion_factor: Number(item.conversion_factor) || 1,
                    base_quantity: roundQuantity((Number(item.quantity) || 0) * (Number(item.conversion_factor) || 1)),
                    base_unit: item.base_unit || item.unit
                  }
              };

              const { paid_amount: _linePaid, due_amount: _lineDue, ...materialRow } = mpEntry;
              await supabase.from('material_purchases').insert([materialRow]);
              setMaterialPurchases(prev => [mpEntry as any, ...prev]);

              const { data: currItem } = await supabase.from('items').select('stock').eq('id', item.item_id).single();
              const currentStock = currItem ? roundQuantity(currItem.stock) : 0;
              const conversion = Number(item.conversion_factor) || 1;
              const stockIncrease = roundQuantity((Number(item.quantity) || 0) * conversion);
              const newStock = roundQuantity(currentStock + stockIncrease);

              const { error: mpInStockError } = await adjustItemStock(item.item_id, stockIncrease);
              if (mpInStockError) throw mpInStockError;
              setInventory(prev => prev.map(i => i.item_id === item.item_id ? { ...i, quantity: newStock } : i));

              await supabase.from('inventory_logs').insert([{
                  id: `log_purch_${generateUUID()}`,
                  date: new Date().toISOString(),
                  item_id: item.item_id, 
                  item_name: item.item_name, 
                  old_quantity: currentStock,
                  new_quantity: newStock, 
                  difference: stockIncrease, 
                  reason: 'Purchase', 
                  notes: supplier_id 
                    ? `Vendor: ${supplier_id}${conversion > 1 ? ` (${item.quantity} ${item.unit} = ${stockIncrease} base units)` : ''}`
                    : `Spot Cash Purchase${conversion > 1 ? ` (${item.quantity} ${item.unit} = ${stockIncrease} base units)` : ''}`
              }]);
          }

          // Supplier balance update if credit / unpaid balance exists
          const unpaid = roundCurrency(Math.max(0, totalBill - effectivePaid));

          if (supplier_id && unpaid > 0) {
              const { data: sup } = await supabase.from('suppliers').select('balance').eq('id', supplier_id).single();
              if (sup) {
                  const newBal = roundCurrency((sup.balance || 0) + unpaid);
                  setSuppliers(prev => prev.map(s => s.id === supplier_id ? { ...s, pending_balance: newBal, balance: newBal } : s));
                  const { error: supUnpaidError } = await adjustSupplierBalance(supplier_id, unpaid);
                  if (supUnpaidError) throw supUnpaidError;
              }
          }

          if (effectivePaid > 0 && resolvedTargetAccId) {
            const acc = accounts.find(a => a.id === resolvedTargetAccId);
            if (acc) {
              const { error: mpAccError } = await adjustAccountBalance(resolvedTargetAccId, -effectivePaid);
              if (mpAccError) throw mpAccError;
              setAccounts(prev => prev.map(a => a.id === resolvedTargetAccId ? { ...a, balance: roundCurrency((a.balance || 0) - effectivePaid) } : a));
              const supplierName = supplier_id ? (suppliers.find(s => s.id === supplier_id)?.name || 'Supplier') : 'Spot Vendor';
              const isDrawerMaterialAccount = Boolean(
                activeShiftSession?.drawer_id &&
                resolvedTargetAccId &&
                (resolvedTargetAccId === activeShiftSession.drawer_id || resolvedTargetAccId === resolveDrawerAccountId(activeShiftSession.drawer_id))
              );
              const activeDrawerId = isDrawerMaterialAccount ? activeShiftSession?.drawer_id : null;
              const normalizedMpDate = normalizeTransactionTimestamp(date);
              const btxRecord = {
                id: `btx_mp_${generateUUID()}`,
                account_id: resolvedTargetAccId,
                amount: effectivePaid,
                date: normalizedMpDate,
                type: 'Expense',
                category: 'Purchase',
                description: `Material Purchase (${purchase_type}) - ${supplierName}`,
                reference_id: createdMaterialIds.join(','),
                business_day_id: activeShiftSession?.business_day_id,
                shift_session_id: isDrawerMaterialAccount ? activeShiftSession?.id : null,
                drawer_id: activeDrawerId,
                cashier_id: activeShiftSession?.user_id
              };
              await supabase.from('bank_transactions').insert([btxRecord]);
              setBankTransactions(prev => [btxRecord as any, ...prev]);
            }
          }

          // If payment was made on the spot for a linked supplier, record payment in supplier_transactions
          if (supplier_id && effectivePaid > 0) {
            const stxId = `stx_mp_${generateUUID()}`;
            const normalizedMpDate = normalizeTransactionTimestamp(date);
            const stxRecord = {
              id: stxId,
              supplier_id,
              date: normalizedMpDate,
              type: 'Payment',
              amount: effectivePaid,
              mode: payment_mode || 'Cash',
              note: `Spot Payment for Material Purchase (${cartItems.map((i: any) => `${i.quantity} ${i.unit || ''} ${i.item_name}`).join(', ')})`,
              account_id: resolvedTargetAccId
            };
            await supabase.from('supplier_transactions').insert([stxRecord]);
            setSupplierTransactions(prev => [stxRecord as any, ...prev]);
          }

          fetchData();
          return true;
      } catch (e: any) { 
        console.error(e); 
        showToast(e?.message || 'Error saving material purchase', 'error');
        return false; 
      }
  };

  const recordSupplierPayment = async (
    supplierId: string, 
    amount: number, 
    date: string, 
    mode: string, 
    type: any = 'Payment', 
    note?: string,
    accountId?: string
  ) => { 
      try {
        const supplier = suppliers.find(s => s.id === supplierId);
        if (supplier) {
            const isCashMode = !mode || mode.toLowerCase().includes('cash');
            const sourceAccountId = accountId || (
              isCashMode 
                ? (activeShiftSession?.account_id || activeShiftSession?.drawer_id || settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash' && a.isActive !== false)?.id || accounts.find(a => a.isActive !== false)?.id) 
                : (settings.financial?.defaultDigitalAccountId || accounts.find(a => (a.type === 'Bank' || a.type === 'Wallet') && a.isActive !== false)?.id || accounts.find(a => a.isActive !== false)?.id)
            );

            if ((type === 'Payment' || type === 'Advance') && amount > 0 && !sourceAccountId) {
              throw new Error("Payment account nahi mila! Pehle 'Bank & Cash' module men account banayein.");
            }

            const isDrawerAccount = Boolean(
              activeShiftSession?.status === 'Active' &&
              activeShiftSession?.drawer_id &&
              sourceAccountId &&
              (sourceAccountId === activeShiftSession.drawer_id || sourceAccountId === resolveDrawerAccountId(activeShiftSession.drawer_id))
            );
            const activeDrawerId = isDrawerAccount ? activeShiftSession?.drawer_id : null;
            const shiftSessionId = isDrawerAccount ? activeShiftSession?.id : null;
            const businessDayId = isDrawerAccount ? activeShiftSession?.business_day_id : null;
            const cashierId = isDrawerAccount ? activeShiftSession?.user_id : (currentUser?.id || null);

            const txId = `stx_${generateUUID()}`;
            const normalizedDate = normalizeTransactionTimestamp(date);
            const paymentPayload = {
              tx_id: txId,
              supplier_id: supplierId,
              supplier_name: supplier.name,
              amount: roundCurrency(amount),
              date: normalizedDate,
              type,
              mode,
              note,
              account_id: sourceAccountId || null,
              business_day_id: businessDayId,
              shift_session_id: shiftSessionId,
              drawer_id: activeDrawerId,
              cashier_id: cashierId
            };

            noteLocalWrite();
            // 1. Optimistic UI updates (Immediate 0ms response)
            const newBal = (supplier.pending_balance || 0) - amount;
            setSuppliers(prev => prev.map(s => s.id === supplierId ? { ...s, pending_balance: newBal, balance: newBal } : s));

            setSupplierTransactions(prev => [{
              id: txId,
              supplier_id: supplierId,
              date: normalizedDate,
              type,
              amount,
              mode,
              note,
              account_id: sourceAccountId
            }, ...prev]);

            if (sourceAccountId && (type === 'Payment' || type === 'Advance') && amount > 0) {
              setAccounts(prev => prev.map(a => a.id === sourceAccountId ? { ...a, balance: (a.balance || 0) - amount } : a));
              setBankTransactions(prev => [{
                id: `btx_${txId}`,
                account_id: sourceAccountId,
                amount: amount,
                date: normalizedDate,
                type: 'Expense',
                category: 'Supplier Payment',
                description: `Supplier Payment: ${supplier.name}${note ? ` (${note})` : ''}`,
                reference_id: txId,
                business_day_id: businessDayId,
                shift_session_id: shiftSessionId,
                drawer_id: activeDrawerId,
                cashier_id: cashierId
              } as any, ...prev]);
            }

            await saveWithOutbox('supplier_payment', paymentPayload, txId, () => recordSupplierPaymentEffects(paymentPayload));

            showToast("Supplier Payment Recorded Successfully", "success");
            return true;
        }
        return false;
      } catch (err: any) {
        console.error("recordSupplierPayment error:", err);
        showToast("Payment failed: " + (err?.message || "Error"), "error");
        return false;
      }
  };
  
  const addSupplier = async (s: Omit<Supplier, 'id'>) => {
    try {
      const id = `sup_${generateUUID()}`;
      const { name, phone, pending_balance, isActive, ...extraData } = s;
      const dbSupplier = {
         id,
         name,
         phone,
         balance: pending_balance || 0,
         is_active: isActive !== undefined ? isActive : true,
         data: extraData
      };
      const { error } = await supabase.from('suppliers').insert([dbSupplier]);
      if (error) {
         showToast("Failed to save supplier: " + error.message, 'error');
         return false;
      }
      showToast("Supplier added successfully", 'success');
      fetchData();
      return true;
    } catch(e: any) {
      showToast("Failed to save supplier", "error");
      return false;
    }
  };

  const updateSupplier = async (id: string, u: Partial<Supplier>) => {
    try {
      // Optimistic local state update so UI updates immediately
      setSuppliers(prev => prev.map(s => s.id === id ? { ...s, ...u } : s));

      const { name, phone, pending_balance, isActive, ...extraData } = u;
      const dbUpdates: any = {};
      if (name !== undefined) dbUpdates.name = name;
      if (phone !== undefined) dbUpdates.phone = phone !== undefined ? (phone || '') : undefined;
      if (pending_balance !== undefined) dbUpdates.balance = pending_balance;
      if (isActive !== undefined) dbUpdates.is_active = isActive;
      
      if (Object.keys(extraData).length > 0) {
         const { data: existing } = await supabase.from('suppliers').select('data').eq('id', id).maybeSingle();
         dbUpdates.data = { ...(existing?.data || {}), ...extraData };
      }
      
      const { error } = await supabase.from('suppliers').update(dbUpdates).eq('id', id);
      if (error) {
         showToast("Failed to update supplier: " + error.message, 'error');
         fetchData();
         return false;
      }
      fetchData();
      return true;
    } catch(e: any) {
      console.error("updateSupplier error:", e);
      showToast("Failed to update supplier: " + (e?.message || "Error"), 'error');
      fetchData();
      return false;
    }
  };
  const deleteSupplier = async (id: string): Promise<boolean> => {
    try {
      const hasPurchases = purchases.some(p => p.supplier_id === id);
      const hasMaterialPurchases = materialPurchases.some(mp => mp.supplier_id === id);
      const hasTransactions = supplierTransactions.some(tx => tx.supplier_id === id);

      if (hasPurchases || hasMaterialPurchases || hasTransactions) {
        showToast("Cannot delete: this supplier has purchase/ledger history. Set them inactive instead.", "error");
        return false;
      }

      // Delete supplier itself
      const { error: supplierErr } = await supabase.from('suppliers').delete().eq('id', id);
      if (supplierErr) {
        showToast(
          supplierErr.code === '23503'
            ? 'Cannot delete: this supplier has purchase/ledger history. Set them inactive instead.'
            : "Failed to delete supplier: " + supplierErr.message,
          'error'
        );
        fetchData();
        return false;
      }

      // Optimistic updates
      setSuppliers(prev => prev.filter(s => s.id !== id));
      showToast("Supplier deleted successfully", "success");
      fetchData();
      return true;
    } catch (error: any) {
      console.error("Error deleting supplier:", error);
      showToast("Failed to delete supplier: " + getErrorMessage(error), "error");
      return false;
    }
  };

  const deleteSupplierTransaction = async (id: string): Promise<boolean> => {
    try {
      const tx = supplierTransactions.find(t => t.id === id);
      if (tx) {
        const supp = suppliers.find(s => s.id === tx.supplier_id);
        if (supp) {
          // If deleted transaction was a Payment/Advance, supplier balance increases back
          const balanceReversal = (tx.type === 'Payment' || tx.type === 'Advance') ? tx.amount : -tx.amount;
          const newBalance = (supp.pending_balance || 0) + balanceReversal;
          const { error: suppRevError } = await adjustSupplierBalance(tx.supplier_id, balanceReversal);
          if (suppRevError) throw suppRevError;
          setSuppliers(prev => prev.map(s => s.id === tx.supplier_id ? { ...s, pending_balance: newBalance } : s));
        }

        // If it was a Payment/Advance, refund the money back to the financial account
        if (tx.type === 'Payment' || tx.type === 'Advance') {
          const isCashMode = !tx.mode || tx.mode.toLowerCase().includes('cash');
          const sourceAccountId = tx.account_id || (
            isCashMode
              ? (settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id)
              : (settings.financial?.defaultDigitalAccountId || accounts.find(a => a.type === 'Bank' || a.type === 'Wallet')?.id)
          );

          if (sourceAccountId) {
            const acc = accounts.find(a => a.id === sourceAccountId);
            if (acc) {
              const { error: accRevError } = await adjustAccountBalance(sourceAccountId, tx.amount);
              if (accRevError) throw accRevError;
            }
            await supabase.from('bank_transactions').delete().eq('reference_id', id);
          }
        }
      }

      await supabase.from('supplier_transactions').delete().eq('id', id);
      setSupplierTransactions(prev => prev.filter(t => t.id !== id));
      fetchData();
      return true;
    } catch (e) {
      console.error("deleteSupplierTransaction error:", e);
      return false;
    }
  };
  
  const adjustStock = async (itemId: string, newQty: number, reason: AdjustmentReason | string, notes?: string, variantId: string = 'loose') => {
     try {
        const invItem = inventory.find(i => i.id === itemId);
        if (!invItem || !invItem.item_id) return false;

        const { data: currentItem, error } = await supabase.from('items').select('*').eq('id', invItem.item_id).single();
        if (error || !currentItem) return false;

        let diff = 0;
        let oldQty = 0;
        let updatePayload = {};
        let logItemName = invItem.name;

        if (variantId && variantId !== 'loose') {
            const variantStocks = currentItem.variant_stocks || {};
            oldQty = variantStocks[variantId] || 0;
            diff = newQty - oldQty;
            const newVariantStocks = { ...variantStocks, [variantId]: newQty };
            updatePayload = { variant_stocks: newVariantStocks };
            
            // Optimistic Update
            setInventory(prev => prev.map(i => i.item_id === invItem.item_id ? { ...i, variant_stocks: newVariantStocks } : i));
        } else {
            oldQty = currentItem.stock;
            diff = newQty - oldQty;
            updatePayload = { stock: newQty };
            
            // Optimistic Update
            setInventory(prev => prev.map(i => i.item_id === invItem.item_id ? { ...i, quantity: newQty } : i));
        }

        const { error: updateError } = await supabase.from('items').update(updatePayload).eq('id', invItem.item_id);
        if (updateError) throw updateError;

        await supabase.from('inventory_logs').insert([{ 
            id: `log_${generateUUID()}`, date: new Date().toISOString(), item_id: invItem.item_id, 
            item_name: logItemName, old_quantity: oldQty, new_quantity: newQty, difference: diff, 
            reason, notes: notes || (variantId !== 'loose' ? 'Variant Audit' : 'Loose Stock Audit')
        }]);
        
        fetchData();
        return true;
     } catch(err) { console.error(err); return false; }
  };

  const processSalesReturn = async (
    saleId: string, 
    returnReason: string, 
    refundAccountId?: string,
    returnAction: 'refund' | 'replace' = 'refund',
    restockOption: 'restock' | 'scrap_spoilage' = 'restock',
    returnedItemsList?: Array<{ itemId?: string; name: string; qty: number; price: number; variantId?: string; unit?: string }>,
    refundPaymentMode?: 'Cash' | 'Online',
    correctOriginalSaleMode?: boolean
  ) => {
    try {
      const sale = sales.find(s => s.id === saleId);
      if (!sale) {
        showToast("Sale record not found", "error");
        return false;
      }

      if (sale.status === 'Returned') {
        showToast("This sale has already been fully returned", "warning");
        return false;
      }

      const returnDate = new Date().toISOString().split('T')[0];
      const returnTimestamp = new Date().toISOString();
      const isReplacement = returnAction === 'replace';
      const isSpoiledScrap = restockOption === 'scrap_spoilage' || returnReason.toLowerCase().includes('spoil') || returnReason.toLowerCase().includes('defect') || returnReason.toLowerCase().includes('kharab');

      // Determine which items and quantities are being returned
      const itemsToReturn = (returnedItemsList && returnedItemsList.length > 0)
        ? returnedItemsList.filter(i => i.qty > 0)
        : (sale.items || []);

      if (itemsToReturn.length === 0) {
        showToast("No items selected for return", "warning");
        return false;
      }

      // Line prices are before the bill discount. The refund keeps that discount
      // and is split so khata is reversed before any cash leaves the drawer.
      const calculatedRefundAmount = isReplacement ? 0 : proportionalRefund(sale, itemsToReturn);
      const refundSplit = splitRefund(sale, calculatedRefundAmount);

      // Check if this is a partial return or full return
      const totalOriginalQty = (sale.items || []).reduce((sum, it) => sum + (it.qty || 0), 0);
      const previouslyReturnedQty = ((sale as any).returned_items || []).reduce((sum: number, it: any) => sum + (it.qty || 0), 0);
      const currentReturningQty = itemsToReturn.reduce((sum, it) => sum + (it.qty || 0), 0);
      const isFullReturn = (previouslyReturnedQty + currentReturningQty) >= totalOriginalQty;

      const newStatus = isFullReturn ? 'Returned' : 'Partially Returned';
      const accumulatedRefundAmount = ((sale.refund_amount || 0) + calculatedRefundAmount);

      const existingReturnedItems = (sale as any).returned_items || [];
      const updatedReturnedItems = [
        ...existingReturnedItems,
        ...itemsToReturn.map(it => ({
          ...it,
          returnDate: returnTimestamp,
          reason: returnReason,
          action: returnAction,
          restock: restockOption
        }))
      ];

      // 1. Update sale record status in DB & local state
      const saleUpdatePayload: any = {
        status: newStatus,
        return_reason: `${returnReason} (${isReplacement ? 'Replacement' : (isSpoiledScrap ? 'Spoiled' : 'Restocked')})`,
        returned_at: returnTimestamp,
        refund_amount: accumulatedRefundAmount,
        details: {
          ...((sale as any).details || {}),
          return_type: returnAction,
          restock_action: restockOption,
          returned_items: updatedReturnedItems
        }
      };

      const { error: saleErr } = await supabase.from('sales').update(saleUpdatePayload).eq('id', saleId);
      if (saleErr) throw saleErr;

      setSales(prev => prev.map(s => s.id === saleId ? {
        ...s,
        status: newStatus as any,
        return_reason: saleUpdatePayload.return_reason,
        returned_at: returnTimestamp,
        refund_amount: accumulatedRefundAmount,
        return_type: returnAction,
        restock_action: restockOption,
        returned_items: updatedReturnedItems
      } : s));

      // 2. Inventory Handling for Returned Items
      for (const item of itemsToReturn) {
        const itemId = item.itemId;
        const qty = item.qty || 1;
        const variantId = item.variantId;
        const itemDef = items.find(i => i.id === itemId || i.name.toLowerCase() === item.name.toLowerCase());

        if (itemDef) {
          const returnVariant = variantId ? (itemDef.variants || []).find(v => v.id === variantId) : undefined;
          const returnFromBase = !returnVariant || returnVariant.deduct_from_base === true;
          const returnQty = returnFromBase ? roundQuantity(qty * (Number(returnVariant?.quantity_in_base_unit) || 1)) : qty;
          if (isReplacement) {
            // Option B: Exchange / Replacement -> Deduct fresh stock
            const currentStock = roundQuantity(itemDef.stock || 0);
            const newStock = roundQuantity(Math.max(0, currentStock - returnQty));
            const { error: repStockError } = await adjustItemStock(itemDef.id, -returnQty);
            if (repStockError) throw repStockError;
            setInventory(prev => prev.map(inv => inv.item_id === itemDef.id ? { ...inv, quantity: newStock } : inv));

            await supabase.from('inventory_logs').insert([{
              id: `log_rep_${generateUUID()}`,
              date: returnTimestamp,
              item_id: itemDef.id,
              item_name: item.name || itemDef.name,
              old_quantity: currentStock,
              new_quantity: newStock,
              difference: -returnQty,
              reason: AdjustmentReason.SPOILAGE,
              notes: `Customer Replacement: ${qty} ${itemDef.unit || 'L'} spoiled milk returned and fresh milk issued for Invoice #${sale.bill_number}`
            }]);
          } else if (isSpoiledScrap) {
            // Option A-1: Spoiled / Defective Milk Discarded (log only)
            await supabase.from('inventory_logs').insert([{
              id: `log_spoil_${generateUUID()}`,
              date: returnTimestamp,
              item_id: itemDef.id,
              item_name: item.name || itemDef.name,
              old_quantity: itemDef.stock || 0,
              new_quantity: itemDef.stock || 0,
              difference: 0,
              reason: AdjustmentReason.SPOILAGE,
              notes: `Customer Return (Scrapped Spoilage): ${qty} ${itemDef.unit || 'L'} from #${sale.bill_number} discarded`
            }]);
          } else {
            // Option A-2: Good Item Restocked to Inventory
            if (variantId && variantId !== 'loose' && !returnFromBase && itemDef.variant_stocks) {
              const currentVarStock = roundQuantity(itemDef.variant_stocks[variantId] || 0);
              const newVarStock = roundQuantity(currentVarStock + qty);
              const { error: retVarError } = await adjustItemStock(itemDef.id, 0, { [variantId]: qty });
              if (retVarError) throw retVarError;
              setInventory(prev => prev.map(inv => inv.item_id === itemDef.id ? { ...inv, variant_stocks: { ...inv.variant_stocks, [variantId]: newVarStock } } : inv));
            } else {
              const currentStock = roundQuantity(itemDef.stock || 0);
              const newStock = roundQuantity(currentStock + returnQty);
              const { error: retStockError } = await adjustItemStock(itemDef.id, returnQty);
              if (retStockError) throw retStockError;
              setInventory(prev => prev.map(inv => inv.item_id === itemDef.id ? { ...inv, quantity: newStock } : inv));
            }

            await supabase.from('inventory_logs').insert([{
              id: `log_ret_${generateUUID()}`,
              date: returnTimestamp,
              item_id: itemDef.id,
              item_name: item.name || itemDef.name,
              old_quantity: itemDef.stock || 0,
              new_quantity: returnFromBase ? roundQuantity((itemDef.stock || 0) + returnQty) : (itemDef.stock || 0),
              difference: returnFromBase ? returnQty : qty,
              reason: AdjustmentReason.SALES_RETURN,
              notes: `Returned to counter stock from Invoice #${sale.bill_number}: ${qty}x ${item.name} (${returnReason})`
            }]);
          }
        }
      }

      // 3. Financial reversal. Khata absorbs the unpaid part; only money that
      // was collected leaves the drawer or bank that received it.
      if (!isReplacement && calculatedRefundAmount > 0) {
        if (refundSplit.khata > 0 && sale.customer_id) {
          const cust = customers.find(c => c.id === sale.customer_id);
          if (cust) {
            const newBal = roundCurrency((cust.balance || 0) - refundSplit.khata);
            const { error: custRefundErr } = await adjustCustomerBalance(cust.id, -refundSplit.khata);
            if (custRefundErr) throw custRefundErr;
            setCustomers(prev => prev.map(c => c.id === sale.customer_id ? { ...c, balance: newBal } : c));

            await supabase.from('customer_transactions').insert([{
              id: `ctx_ret_${generateUUID()}`,
              customer_id: sale.customer_id,
              date: returnDate,
              type: 'Return',
              amount: refundSplit.khata,
              details: {
                mode: 'Credit',
                note: `Return (${itemsToReturn.map(i => `${i.qty}x ${i.name}`).join(', ')}) for Invoice #${sale.bill_number}: ${returnReason}`
              }
            }]);
          }
        }

        if (refundSplit.cash > 0) {
          const effectiveRefundMode = refundPaymentMode || (String(sale.payment_mode || '').toLowerCase() === 'online' ? 'Online' : 'Cash');
          const isOnlineRefund = effectiveRefundMode === 'Online';
          const drawerAccountId = resolveDrawerAccountId(sale.drawer_id) || sale.drawer_id;
          const targetAccId = refundAccountId || (
            isOnlineRefund
              ? (settings.financial?.defaultDigitalAccountId || accounts.find(a => a.type === 'Bank' || a.type === 'Wallet')?.id)
              : (drawerAccountId || activeShiftSession?.account_id || resolveDrawerAccountId(activeShiftSession?.drawer_id) || activeShiftSession?.drawer_id || settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id)
          );

          if (targetAccId && accounts.some(a => a.id === targetAccId)) {
            const refundNote = `Sales Refund (${effectiveRefundMode}) for #${sale.bill_number} (${itemsToReturn.map(i => `${i.qty}x ${i.name}`).join(', ')})`;
            const { error: refundAccError } = await adjustAccountBalance(targetAccId, -refundSplit.cash);
            if (refundAccError) throw refundAccError;
            setAccounts(prev => prev.map(a => a.id === targetAccId ? { ...a, balance: roundCurrency((a.balance || 0) - refundSplit.cash) } : a));
            await supabase.from('bank_transactions').insert([{
              id: `btx_ret_${generateUUID()}`,
              account_id: targetAccId,
              amount: refundSplit.cash,
              date: returnDate,
              type: 'Expense',
              category: isOnlineRefund ? 'Online Sales Return' : 'Sales Return',
              description: refundNote,
              reference_id: sale.id,
              business_day_id: activeShiftSession?.business_day_id,
              shift_session_id: activeShiftSession?.id,
              drawer_id: isOnlineRefund ? null : activeShiftSession?.drawer_id,
              cashier_id: activeShiftSession?.user_id
            }]);
            if (!isOnlineRefund && activeShiftSession?.business_day_id && activeShiftSession.drawer_id) {
              await supabase.from('shift_cash_events').insert([{
                id: `sce_refund_${generateUUID()}`,
                business_day_id: activeShiftSession.business_day_id,
                shift_id: activeShiftSession.id,
                drawer_id: activeShiftSession.drawer_id,
                event_type: 'Cash Refund',
                direction: 'Out',
                amount: refundSplit.cash,
                payment_mode: 'Cash',
                source_type: 'sales_return',
                source_id: `${sale.id}_${generateUUID().slice(0, 8)}`,
                description: `Refund for invoice ${sale.bill_number}`,
                occurred_at: returnTimestamp,
                created_by: currentUser?.id
              }]);
            }
          }
        }

        // Optional: Correct original sale payment mode from Cash to Online if marked during return
        if (correctOriginalSaleMode && sale.payment_mode === 'Cash') {
          const updatedDetails = {
            ...((sale as any).details || {}),
            previous_payment_mode: 'Cash',
            payment_mode: 'Online',
            corrected_during_return: true,
            corrected_at: returnTimestamp
          };
          await supabase.from('sales').update({
            payment_mode: 'Online',
            details: updatedDetails
          }).eq('id', sale.id);

          setSales(prev => prev.map(s => s.id === sale.id ? { ...s, payment_mode: 'Online', details: updatedDetails } : s));
        }
      }

      showToast(
        isReplacement 
          ? `Replacement processed for ${itemsToReturn.length} item(s) on #${sale.bill_number}!` 
          : `Refund of Rs ${calculatedRefundAmount.toLocaleString()} processed for ${itemsToReturn.length} item(s)!`,
        "success"
      );

      fetchData();
      return true;
    } catch (err: any) {
      console.error("processSalesReturn error:", err);
      showToast(`Failed to process return: ${err?.message || 'Error'}`, "error");
      return false;
    }
  };

  const updateSalePaymentMode = async (
    saleId: string, 
    newPaymentMode: 'Cash' | 'Online', 
    targetAccountId?: string
  ): Promise<boolean> => {
    const lockKey = `update_sale_payment_${saleId}`;
    const lockResult = await actionLock.runExclusive(lockKey, async () => {
      try {
        const sale = sales.find(s => s.id === saleId);
        if (!sale) {
          showToast("Sale record not found", "error");
          return false;
        }

        const oldPaymentMode = sale.payment_mode || 'Cash';
        if (oldPaymentMode === newPaymentMode) {
          showToast(`Sale is already marked as ${newPaymentMode}`, "info");
          return true;
        }

        const paidAmount = roundCurrency(salePaidAmount(sale));

        // 1. Resolve Accounts involved
        let oldAccountId: string | null = null;
        let newAccountId: string | null = targetAccountId || null;

        const existingBtx = bankTransactions.find(b => b.reference_id === sale.id || b.id === `btx_${sale.id}`);
        if (existingBtx && existingBtx.account_id) {
          oldAccountId = existingBtx.account_id;
        } else if (oldPaymentMode === 'Cash') {
          oldAccountId = resolveDrawerAccountId(sale.drawer_id) || sale.drawer_id || settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id || null;
        } else if (oldPaymentMode === 'Online') {
          oldAccountId = settings.financial?.defaultDigitalAccountId || accounts.find(a => a.type === 'Bank' || a.type === 'Wallet')?.id || null;
        }

        if (!newAccountId) {
          if (newPaymentMode === 'Online') {
            newAccountId = settings.financial?.defaultDigitalAccountId || accounts.find(a => a.type === 'Bank' || a.type === 'Wallet')?.id || null;
          } else {
            newAccountId = resolveDrawerAccountId(sale.drawer_id) || sale.drawer_id || activeShiftSession?.drawer_id || settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id || null;
          }
        }

        // 2. Financial Re-balancing (if paidAmount > 0 and accounts are known)
        if (paidAmount > 0 && oldAccountId && newAccountId && oldAccountId !== newAccountId) {
          await adjustAccountBalance(oldAccountId, -paidAmount);
          await adjustAccountBalance(newAccountId, paidAmount);

          setAccounts(prev => prev.map(acc => {
            if (acc.id === oldAccountId) return { ...acc, balance: roundCurrency((acc.balance || 0) - paidAmount) };
            if (acc.id === newAccountId) return { ...acc, balance: roundCurrency((acc.balance || 0) + paidAmount) };
            return acc;
          }));
        }

        // 3. Update or Insert Bank Transaction
        const btxId = `btx_${sale.id}`;
        const newCategory = newPaymentMode === 'Online' ? 'Online Sale' : 'POS Sale';
        const newDescription = `POS ${newPaymentMode} Sale #${sale.bill_number}`;

        if (paidAmount > 0 && newAccountId) {
          if (existingBtx) {
            await supabase.from('bank_transactions').update({
              account_id: newAccountId,
              category: newCategory,
              description: newDescription
            }).eq('id', existingBtx.id);

            setBankTransactions(prev => prev.map(b => b.id === existingBtx.id ? {
              ...b,
              account_id: newAccountId!,
              category: newCategory,
              description: newDescription
            } : b));
          } else {
            const newBtx = {
              id: btxId,
              account_id: newAccountId,
              amount: paidAmount,
              date: sale.date || new Date().toISOString(),
              type: 'Income',
              category: newCategory,
              description: newDescription,
              reference_id: sale.id,
              business_day_id: sale.business_day_id || activeShiftSession?.business_day_id,
              shift_session_id: sale.shift_session_id || activeShiftSession?.id,
              drawer_id: newPaymentMode === 'Cash' ? (sale.drawer_id || activeShiftSession?.drawer_id) : null,
              cashier_id: sale.cashier_id || activeShiftSession?.user_id
            };
            await supabase.from('bank_transactions').insert([newBtx]);
            setBankTransactions(prev => [newBtx as any, ...prev]);
          }
        }

        // 4. Update Shift Cash Events (Drawer correction)
        const effectiveDayId = sale.business_day_id || activeShiftSession?.business_day_id;
        const effectiveShiftId = sale.shift_session_id || activeShiftSession?.id;
        const effectiveDrawerId = sale.drawer_id || activeShiftSession?.drawer_id;

        if (paidAmount > 0 && effectiveDayId && effectiveDrawerId) {
          if (oldPaymentMode === 'Cash' && newPaymentMode === 'Online') {
            await supabase.from('shift_cash_events').insert([{
              id: `sce_corr_${generateUUID()}`,
              business_day_id: effectiveDayId,
              shift_id: effectiveShiftId,
              drawer_id: effectiveDrawerId,
              event_type: 'Payment Mode Correction',
              direction: 'Out',
              amount: paidAmount,
              payment_mode: 'Cash',
              source_type: 'payment_correction',
              source_id: sale.id,
              description: `Correction: Invoice #${sale.bill_number} changed from Cash to Online`,
              occurred_at: new Date().toISOString(),
              created_by: currentUser?.id
            }]);
          } else if (oldPaymentMode === 'Online' && newPaymentMode === 'Cash') {
            await supabase.from('shift_cash_events').insert([{
              id: `sce_corr_${generateUUID()}`,
              business_day_id: effectiveDayId,
              shift_id: effectiveShiftId,
              drawer_id: effectiveDrawerId,
              event_type: 'Payment Mode Correction',
              direction: 'In',
              amount: paidAmount,
              payment_mode: 'Cash',
              source_type: 'payment_correction',
              source_id: sale.id,
              description: `Correction: Invoice #${sale.bill_number} changed from Online to Cash`,
              occurred_at: new Date().toISOString(),
              created_by: currentUser?.id
            }]);
          }
        }

        // 5. Update Sale in Supabase
        const updatedDetails = {
          ...((sale as any).details || {}),
          previous_payment_mode: oldPaymentMode,
          payment_mode: newPaymentMode,
          payment_mode_changed_at: new Date().toISOString(),
          account_id: newAccountId
        };

        const { error: saleUpError } = await supabase.from('sales').update({
          payment_mode: newPaymentMode,
          details: updatedDetails
        }).eq('id', sale.id);

        if (saleUpError) throw saleUpError;

        // 6. Update local Dexie Order
        try {
          await db.orders.update(sale.id, {
            payment_mode: newPaymentMode,
            receipt_account_id: newAccountId
          });
        } catch (dexErr) {
          console.warn('[Dexie] Order payment mode update notice:', dexErr);
        }

        // 7. Optimistic State Update
        setSales(prev => prev.map(s => s.id === sale.id ? {
          ...s,
          payment_mode: newPaymentMode,
          details: updatedDetails
        } : s));

        showToast(`Invoice #${sale.bill_number} payment mode updated to ${newPaymentMode}!`, "success");
        fetchData();
        return true;
      } catch (err: any) {
        console.error("updateSalePaymentMode error:", err);
        showToast("Failed to update payment mode: " + getErrorMessage(err), "error");
        return false;
      }
    });

    return lockResult !== null ? lockResult : false;
  };
  const recordDailySupply = async (entries: any[]) => { 
      try {
          const dbEntries = entries.map((entry: any) => {
              const { id, date, customer_id, total_amount, ...extraDetails } = entry;
              return {
                  id: id || `ds_${generateUUID()}`,
                  date,
                  customer_id,
                  total_amount: total_amount || 0,
                  business_day_id: activeShiftSession?.business_day_id,
                  shift_session_id: activeShiftSession?.id,
                  drawer_id: activeShiftSession?.drawer_id,
                  cashier_id: activeShiftSession?.user_id,
                  details: {
                    ...extraDetails,
                    business_day_id: activeShiftSession?.business_day_id,
                    shift_session_id: activeShiftSession?.id,
                    drawer_id: activeShiftSession?.drawer_id,
                    cashier_id: activeShiftSession?.user_id
                  }
              };
          });
          const { error } = await supabase.from('daily_supply').insert(dbEntries);
          if (error) throw error;
          fetchData();
          return true;
      } catch (e) { console.error(e); return false; }
  };
  const processCreditSaleTransaction = async (customerId: string, date: string, items: any[], status: 'Present' | 'Absent') => { return true; };
  const performRetailClosing = async (data: any) => { 
      try {
          const closingId = generateUUID();
          const shiftName = data.shift || 'General';

          // 1. If Auto-Post Unrecorded Sales is enabled, create balancing sale
          let autoPostedSaleId: string | undefined = undefined;
          if (data.auto_post_unrecorded_sale && Array.isArray(data.unrecorded_items) && data.unrecorded_items.length > 0) {
              const unrecordedCart = data.unrecorded_items.filter((u: any) => (u.unrecorded_sold_qty || 0) > 0).map((u: any) => ({
                  id: u.product_id,
                  itemId: u.product_id,
                  name: u.variant_name ? `${u.product_name} (${u.variant_name})` : u.product_name,
                  qty: roundQuantity(u.unrecorded_sold_qty),
                  price: roundCurrency(u.price || 0),
                  total: roundCurrency((u.unrecorded_sold_qty || 0) * (u.price || 0)),
                  variantId: u.variant_id
              }));

              const totalUnrecordedAmount = roundCurrency(unrecordedCart.reduce((sum: number, i: any) => sum + i.total, 0));
              if (totalUnrecordedAmount > 0 && unrecordedCart.length > 0) {
                  await addSale(
                      unrecordedCart,
                      { name: `Direct Counter Sales (${shiftName} Closing)` },
                      totalUnrecordedAmount,
                      0,
                      totalUnrecordedAmount,
                      'Cash',
                      totalUnrecordedAmount
                  );
              }
          }

          // 2. Adjust Live Inventory for counted Loose & Variant stocks
          for (const item of (data.items || [])) {
              const itemDef = items.find(i => i.name.toLowerCase() === item.product_name.toLowerCase() || i.id === item.product_id);
              if (itemDef) {
                  const targetVariant = item.variant_id && item.variant_id !== 'loose' ? item.variant_id : 'loose';
                  
                  // Adjust physical inventory to the exact counted quantity
                  await adjustStock(
                      `inv_${itemDef.id}`, 
                      roundQuantity(item.physical_qty), 
                      'Stock Count Correction', 
                      `Shift Closing (${shiftName}) on ${data.date}`, 
                      targetVariant
                  );

                  // Log dedicated Loss/Wastage inventory entries for reporting
                  if (item.spoilage_qty && item.spoilage_qty > 0) {
                      await supabase.from('inventory_logs').insert([{ 
                          id: `log_spoil_${closingId}_${itemDef.id}`, 
                          date: new Date().toISOString(), 
                          item_id: itemDef.id, 
                          item_name: item.variant_name ? `${item.product_name} (${item.variant_name})` : item.product_name, 
                          old_quantity: item.system_qty, 
                          new_quantity: item.physical_qty, 
                          difference: -roundQuantity(item.spoilage_qty), 
                          reason: 'Spoilage / Wastage', 
                          notes: `Kharab/Sour Milk - Shift Closing (${shiftName}) on ${data.date}`
                      }]);
                  }

                  if (item.wastage_qty && item.wastage_qty > 0) {
                      await supabase.from('inventory_logs').insert([{ 
                          id: `log_waste_${closingId}_${itemDef.id}`, 
                          date: new Date().toISOString(), 
                          item_id: itemDef.id, 
                          item_name: item.variant_name ? `${item.product_name} (${item.variant_name})` : item.product_name, 
                          old_quantity: item.system_qty, 
                          new_quantity: item.physical_qty, 
                          difference: -roundQuantity(item.wastage_qty), 
                          reason: 'Spoilage / Wastage', 
                          notes: `Boiling/Measurement Loss - Shift Closing (${shiftName}) on ${data.date}`
                      }]);
                  }

                  if (item.internal_use_qty && item.internal_use_qty > 0) {
                      await supabase.from('inventory_logs').insert([{ 
                          id: `log_tea_${closingId}_${itemDef.id}`, 
                          date: new Date().toISOString(), 
                          item_id: itemDef.id, 
                          item_name: item.variant_name ? `${item.product_name} (${item.variant_name})` : item.product_name, 
                          old_quantity: item.system_qty, 
                          new_quantity: item.physical_qty, 
                          difference: -roundQuantity(item.internal_use_qty), 
                          reason: 'Internal Consumption', 
                          notes: `Staff Tea / Internal Usage - Shift Closing (${shiftName}) on ${data.date}`
                      }]);
                  }
              }
          }

          // 3. Save Closing Record to Supabase
          const closingDetails = {
              shift: shiftName,
              items: data.items,
              cash_reconciliation: data.cash_reconciliation,
              total_revenue: data.total_revenue,
              total_unrecorded_revenue: data.total_unrecorded_revenue,
              total_loss_value: data.total_loss_value,
              auto_posted_sale: Boolean(data.auto_post_unrecorded_sale),
              notes: data.notes,
              created_at: new Date().toISOString()
          };

          const { error } = await supabase.from('retail_closings').insert([{
              id: closingId, 
              date: data.date, 
              status: 'Closed', 
              details: closingDetails
          }]);
          if (error) throw error;

          // Optimistic local state update
          setRetailClosings(prev => [{
              id: closingId,
              date: data.date,
              shift: shiftName,
              status: 'Closed',
              items: data.items,
              cash_reconciliation: data.cash_reconciliation,
              total_revenue: data.total_revenue,
              total_unrecorded_revenue: data.total_unrecorded_revenue,
              total_loss_value: data.total_loss_value,
              notes: data.notes,
              created_at: new Date().toISOString(),
              details: closingDetails
          }, ...prev]);

          fetchData();
          return true;
      } catch (e) { 
          console.error('[Retail Closing Error]', e); 
          return false; 
      }
  };

  const postClosingStockSale = async (data: {
    date: string;
    shiftName?: string;
    notes?: string;
    paymentMode?: 'Cash' | 'Online';
    accountId?: string;
    items: Array<{
      itemId: string;
      name: string;
      unit: string;
      price: number;
      openingStock: number;
      posSoldQty: number;
      closingSoldQty: number;
      remainingQty: number;
      autoSaleQty: number;
      totalAmount: number;
      variantId?: string;
      variantName?: string;
    }>;
  }): Promise<boolean> => {
    try {
      const validItems = (data.items || []).filter(i => (i.autoSaleQty || 0) > 0);
      if (validItems.length === 0) {
        showToast("No sales to post. Remaining stock matches or exceeds current stock.", "info");
        return false;
      }

      const totalAmount = roundCurrency(validItems.reduce((sum, item) => sum + (item.totalAmount || (item.autoSaleQty * item.price)), 0));
      const saleId = generateUUID();
      const invoiceNumber = generateInvoiceNumber('CS-');
      const nowIso = new Date().toISOString();
      const saleDate = data.date ? `${data.date}T${new Date().toTimeString().slice(0, 8)}` : nowIso;
      const shiftLabel = data.shiftName || activeShiftSession?.shift_name || 'Counter Closing';
      const paymentMode = data.paymentMode || 'Cash';

      const cart = validItems.map(item => ({
        id: item.itemId,
        itemId: item.itemId,
        name: item.variantName ? `${item.name} (${item.variantName})` : item.name,
        qty: roundQuantity(item.autoSaleQty),
        price: roundCurrency(item.price),
        total: roundCurrency(item.totalAmount || (item.autoSaleQty * item.price)),
        variantId: item.variantId,
        unit: item.unit || 'Unit'
      }));

      // Resolve receipt account
      let receiptAccountId: string | null = data.accountId || null;
      if (!receiptAccountId) {
        receiptAccountId = paymentMode === 'Cash'
          ? (activeShiftSession?.account_id || activeShiftSession?.drawer_id || settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id || null)
          : (settings.financial?.defaultDigitalAccountId || accounts.find(a => a.type === 'Bank' || a.type === 'Wallet')?.id || null);
      }

      const saleData: POSBill = {
        id: saleId,
        bill_number: invoiceNumber,
        date: saleDate,
        customer_name: 'Counter Closing Sale',
        subtotal: totalAmount,
        discount: 0,
        total: totalAmount,
        payment_mode: paymentMode,
        status: 'Completed',
        shift_session_id: activeShiftSession?.id,
        shift_name: shiftLabel,
        business_day_id: activeShiftSession?.business_day_id,
        drawer_id: activeShiftSession?.drawer_id,
        cashier_id: currentUser?.id,
        cashier_name: currentUser?.name || 'Admin',
        items: cart,
        details: {
          source: 'closing_reconciliation',
          is_closing_module: true,
          closing_date: data.date,
          shift: shiftLabel,
          notes: data.notes || `Counter Closing Sale on ${data.date}`,
          paid_amount: totalAmount,
          due_amount: 0,
          reconciled_items: data.items
        } as any
      };

      // One journal entry. Stock and cash move only when this order syncs.
      await db.orders.put({
        ...saleData,
        receipt_account_id: receiptAccountId,
        sync_status: 'pending',
        created_at: nowIso
      } as any);

      const orderItems = cart.map(item => ({
        id: generateUUID(),
        order_id: saleId,
        item_id: item.itemId,
        name: item.name,
        qty: item.qty,
        price: item.price,
        total: item.total,
        variant_id: item.variantId,
        unit: item.unit,
        sync_status: 'pending' as const,
        created_at: nowIso
      }));
      if (orderItems.length > 0) {
        await db.order_items.bulkPut(orderItems as any);
      }
      noteLocalWrite();

      setSales(prev => [saleData, ...prev]);
      setInventory(prev => prev.map(inv => {
        let quantity = roundQuantity(inv.quantity || 0);
        const variant_stocks = { ...(inv.variant_stocks || {}) };
        for (const line of cart) {
          const lineId = line.itemId || line.id;
          if (inv.item_id !== lineId && inv.name !== line.name) continue;
          if (line.variantId) variant_stocks[line.variantId] = roundQuantity((Number(variant_stocks[line.variantId]) || 0) - line.qty);
          else quantity = roundQuantity(quantity - line.qty);
        }
        return { ...inv, quantity, variant_stocks };
      }));
      setItems(prev => prev.map(item => {
        let next = item;
        for (const line of cart) {
          const lineId = line.itemId || line.id;
          if (item.id !== lineId && item.name !== line.name) continue;
          const variant_stocks = { ...(next.variant_stocks || {}) };
          let stock = roundQuantity(next.stock || 0);
          if (line.variantId) variant_stocks[line.variantId] = roundQuantity((Number(variant_stocks[line.variantId]) || 0) - line.qty);
          else stock = roundQuantity(stock - line.qty);
          next = { ...next, stock, variant_stocks };
        }
        return next;
      }));
      if (receiptAccountId && totalAmount > 0) {
        setAccounts(prev => prev.map(a => a.id === receiptAccountId ? { ...a, balance: (a.balance || 0) + totalAmount } : a));
      }

      const closingSnapshot = {
        id: generateUUID(),
        date: data.date,
        shift: shiftLabel,
        status: 'Closed',
        items: data.items.map(i => ({
          product_id: i.itemId,
          product_name: i.name,
          variant_id: i.variantId,
          variant_name: i.variantName,
          unit: i.unit,
          price: i.price,
          system_qty: roundQuantity(i.openingStock - i.posSoldQty),
          physical_qty: roundQuantity(i.remainingQty),
          difference: roundQuantity(i.autoSaleQty),
          pos_sold_qty: roundQuantity(i.posSoldQty),
          module_sold_qty: roundQuantity(i.closingSoldQty),
          calculated_sold_qty: roundQuantity(i.autoSaleQty),
          calculated_revenue: roundCurrency(i.totalAmount)
        })),
        total_revenue: totalAmount,
        auto_posted_sale_id: saleId,
        notes: data.notes,
        created_at: nowIso
      };

      setRetailClosings(prev => [closingSnapshot as any, ...prev]);
      try {
        await saveWithOutbox('retail_closing', closingSnapshot, closingSnapshot.id, () => supabase.from('retail_closings').upsert([{
          id: closingSnapshot.id,
          date: closingSnapshot.date,
          status: 'Closed',
          details: closingSnapshot
        }]));
      } catch (snapshotErr) {
        console.warn('[Closing snapshot]', snapshotErr);
      }

      syncService.notifyPendingChange().catch(err => console.warn('[Closing Sale Sync]:', err));

      showToast(`Counter closing sale recorded successfully! Amount: Rs ${totalAmount.toLocaleString()}`, "success");
      return true;
    } catch (err: any) {
      console.error('[postClosingStockSale Error]', err);
      showToast("Failed to record closing sale: " + (err.message || 'Error'), "error");
      return false;
    }
  };

  const getBusinessDate = (): string => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const part = (type: string) => parts.find(p => p.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  };

  const mapCashShift = (row: any): ShiftSession => {
    const acc = accounts.find(a => a.id === row.drawer_id)
      || accounts.find(a => a.id === (cashDrawers.find(d => d.id === row.drawer_id)?.account_id));
    const drawerName = acc?.name || cashDrawers.find(d => d.id === row.drawer_id)?.name || row.drawer_name || 'Cash Drawer';
    return {
      ...row,
      account_id: acc?.id || row.account_id || row.drawer_id,
      account_name: acc?.name || row.account_name,
      drawer_name: drawerName,
      date: row.business_date,
      shift_name: row.shift_name || `Shift ${new Date(row.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      opening_float: Number(row.opening_counted || 0),
      start_time: row.started_at,
      end_time: row.closed_at,
      expected_drawer_cash: Number(row.expected_closing_cash || 0),
      actual_physical_cash: row.closing_counted_cash === null ? undefined : Number(row.closing_counted_cash),
      cash_difference: row.closing_variance === null ? undefined : Number(row.closing_variance),
      khata_cash_recovered: Number(row.cash_collections || 0),
      drawer_expenses_paid: Number(row.cash_expenses || 0),
      spot_purchases_paid: Number(row.cash_purchases || 0)
    };
  };

  // Custody drawer ids are cash_drawers ids; resolve the financial account a
  // drawer maps to (drawers created from Bank & Cash share the account id).
  const resolveDrawerAccountId = (drawerId?: string | null): string | undefined => {
    if (!drawerId) return undefined;
    if (accounts.some(a => a.id === drawerId)) return drawerId;
    return cashDrawers.find(d => d.id === drawerId)?.account_id || undefined;
  };

  // Cash submitted to head but not yet received into any account — the money
  // sits "darmiyan": out of the drawer, in no account, pending receive.
  const cashInTransit = useMemo(() => {
    const pending = cashRemittances.filter(r => r.status === 'Pending');
    return {
      count: pending.length,
      amount: roundCurrency(pending.reduce((sum, r) => sum + Number(r.declared_amount || 0), 0))
    };
  }, [cashRemittances]);

  const refreshCashControl = async (): Promise<void> => {
    const [days, drawers, shifts, handovers, remittances, variances, events, faRes, btxRes] = await Promise.all([
      supabase.from('business_days').select('*').order('business_date', { ascending: false }),
      supabase.from('cash_drawers').select('*').order('name'),
      supabase.from('cash_shifts').select('*').order('started_at', { ascending: false }),
      supabase.from('drawer_handovers').select('*').order('declared_at', { ascending: false }),
      supabase.from('cash_remittances').select('*').order('declared_at', { ascending: false }),
      supabase.from('cash_variances').select('*').order('created_at', { ascending: false }),
      supabase.from('shift_cash_events').select('*').order('occurred_at', { ascending: false }),
      supabase.from('financial_accounts').select('*'),
      supabase.from('bank_transactions').select('*').order('date', { ascending: false })
    ]);
    if (days.data) setBusinessDays(days.data as BusinessDay[]);
    if (drawers.data) setCashDrawers(drawers.data as CashDrawer[]);
    if (shifts.data) setShiftSessions(shifts.data.map(mapCashShift));
    if (handovers.data) setCashHandovers(handovers.data as CashHandover[]);
    if (remittances.data) setCashRemittances(remittances.data as CashRemittance[]);
    if (variances.data) setCashVariances(variances.data as CashVariance[]);
    if (events.data) setShiftCashEvents(events.data as ShiftCashEvent[]);
    if (faRes.data) setAccounts(faRes.data.map((a: any) => ({ id: a.id, name: a.name, type: a.type, balance: a.balance || 0, isActive: a.is_active, ...a.details })));
    if (btxRes.data) setBankTransactions(btxRes.data as BankTransaction[]);
  };

  const startCashierShift = async (data: {
    drawerId: string;
    openingCounted: number;
    denominations?: Record<string | number, number>;
    handoverId?: string;
  }): Promise<boolean> => {
    if (!currentUser) {
      showToast('Please log in first.', 'warning');
      return false;
    }
    if (activeShiftSession) {
      showToast('You already have an active shift.', 'warning');
      return false;
    }
    if (shiftSessions.some(s => s.drawer_id === data.drawerId && ['Active', 'Closing', 'Pending Acceptance'].includes(s.status))) {
      showToast('Another cashier’s shift is active on this drawer.', 'warning');
      return false;
    }

    // Shifts only run on Cash accounts explicitly enabled as drawers —
    // Bank/Wallet accounts can never host a shift.
    const targetAccount = accounts.find(a => a.id === data.drawerId);
    if (targetAccount && (targetAccount.type !== 'Cash' || targetAccount.isDrawer !== true)) {
      showToast('Shifts can only run on drawer-enabled Cash accounts. Please enable a Cash account as a drawer in Bank & Cash.', 'warning');
      return false;
    }

    // Ensure the cash drawer entry exists for this account so foreign keys are satisfied
    const drawerAcc = accounts.find(a => a.id === data.drawerId);
    const existingDrawer = cashDrawers.find(d => d.id === data.drawerId || d.account_id === data.drawerId);
    if (drawerAcc) {
      await supabase.from('cash_drawers').upsert([{
        id: drawerAcc.id,
        name: drawerAcc.name,
        code: (drawerAcc.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) || 'CASH').toUpperCase(),
        account_id: drawerAcc.id,
        is_active: drawerAcc.isActive !== false,
        default_float: existingDrawer?.default_float !== undefined ? existingDrawer.default_float : 0
      }]);
    }

    const businessDate = getBusinessDate();
    const shiftId = `shift_${businessDate}_${generateUUID().slice(0, 12)}`;
    const { data: started, error } = await supabase.rpc('cash_control_start_shift', {
      p_shift_id: shiftId,
      p_business_day_id: `bd_${businessDate}`,
      p_business_date: businessDate,
      p_drawer_id: data.drawerId,
      p_user_id: currentUser.id,
      p_user_name: currentUser.name,
      p_role_name: currentRole?.name || 'Cashier',
      p_opening_counted: roundCurrency(data.openingCounted),
      p_denominations: data.denominations || {},
      p_handover_id: data.handoverId || null
    });
    if (error) {
      showToast(`Shift could not start: ${error.message}`, 'error');
      return false;
    }

    const startedRow = Array.isArray(started) ? started[0] : started;
    if (!startedRow) {
      showToast('Empty response from the server. Please verify the database setup.', 'error');
      return false;
    }
    const shift = mapCashShift(startedRow);
    setShiftSessions(prev => [shift, ...prev.filter(s => s.id !== shift.id)]);
    setActiveShiftSession(shift);
    localStorage.setItem('mooco_active_shift_session', JSON.stringify(shift));

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        const bc = new BroadcastChannel('mooco_shift_channel');
        bc.postMessage({ type: 'SHIFT_STARTED', shiftId: shift.id });
        bc.close();
      } catch (err) {}
    }

    await refreshCashControl();
    showToast(`Shift started — opening cash Rs ${data.openingCounted.toLocaleString()}`, 'success');
    return true;
  };

  const getShiftTotals = (shiftId: string) => {
    const shift = shiftSessions.find(s => s.id === shiftId) || activeShiftSession;
    const drawerAccountId = resolveDrawerAccountId(shift?.drawer_id) || shift?.drawer_id;

    const shiftStartTime = shift?.started_at ? new Date(shift.started_at).getTime() : 0;
    const shiftEndTime = shift?.closed_at ? new Date(shift.closed_at).getTime() : Infinity;
    const shiftDate = shift?.business_date || (shift?.started_at ? shift.started_at.split('T')[0] : '');

    const allShiftSales = sales.filter(s => {
      // 1. Direct match by shift session ID
      if (s.shift_session_id === shiftId) return true;

      // 2. Safe Auto-Healing: Include orphan or misplaced bill on the same drawer & timeframe
      if (!s.date) return false;
      const saleTime = new Date(s.date).getTime();
      const saleDate = s.date.split('T')[0];

      const matchesTime = shiftStartTime > 0 && saleTime >= (shiftStartTime - 60000) && saleTime <= (shiftEndTime + 60000);
      const matchesDrawer = !s.drawer_id || !drawerAccountId || s.drawer_id === drawerAccountId || s.drawer_id === shift?.drawer_id;
      const matchesDate = !shiftDate || saleDate === shiftDate;

      if (matchesTime && matchesDrawer && matchesDate) {
        if (!s.shift_session_id) return true;
        const assignedShift = shiftSessions.find(sh => sh.id === s.shift_session_id);
        if (assignedShift && assignedShift.business_date && assignedShift.business_date !== shiftDate) {
          return true;
        }
      }
      return false;
    });

    const shiftSales = allShiftSales.filter(s => s.status !== 'Returned');
    const grossSales = roundCurrency(shiftSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0));

    // Cash that left the drawer on THIS shift for a given sale (khata reversals are not cash).
    const sameShiftCashRefund = (saleId: string) => roundCurrency(shiftCashEvents
      .filter(e => e.shift_id === shiftId && e.direction === 'Out' && String(e.event_type || '').toLowerCase().includes('refund'))
      .filter(e => {
        const source = String(e.source_id || '');
        return source === saleId || source.startsWith(`${saleId}_`);
      })
      .reduce((sum, e) => sum + Number(e.amount || 0), 0));

    // Drawer cash from this shift's bills, including a cash down-payment on a credit bill.
    // A refund is subtracted only when the cash actually left during this shift, so a
    // later shift's return does not rewrite this shift's expected cash.
    const cashSales = roundCurrency(allShiftSales.reduce((sum, sale) => {
      const mode = String(sale.payment_mode || '').toLowerCase();
      if (mode === 'online') return sum;
      const paid = salePaidAmount(sale);
      return sum + Math.max(0, paid - sameShiftCashRefund(sale.id));
    }, 0));

    const onlineSales = roundCurrency(shiftSales
      .filter(s => String(s.payment_mode).toLowerCase() === 'online')
      .reduce((sum, sale) => sum + salePaidAmount(sale), 0));

    const creditSales = roundCurrency(shiftSales.reduce((sum, sale) => {
      return sum + Math.max(0, Number(sale.total || 0) - salePaidAmount(sale));
    }, 0));

    const ledgerCashCollections = roundCurrency(customerTransactions
      .filter(t => t.shift_session_id === shiftId && t.type === 'Payment' && String(t.mode || '').toLowerCase().includes('cash'))
      .filter(t => !t.account_id || !drawerAccountId || t.account_id === drawerAccountId)
      .reduce((sum, t) => sum + Number(t.amount || 0), 0));

    const deliveryCashCollections = roundCurrency(dailySupplyEntries
      .filter(entry => entry.shift_session_id === shiftId && String(entry.payment_mode || '').toLowerCase().includes('cash'))
      .reduce((sum, entry) => sum + Number(entry.payment_received || 0), 0));

    // Material, Supplier, and Expense Vendor Cash In (Refunds / Returns / Advance Returns) received specifically into THIS drawer
    const validMaterialAndSupplierRefundBtx = bankTransactions
      .filter((t: any) =>
        (t.shift_session_id === shiftId || (
          !t.shift_session_id && shiftStartTime > 0 &&
          new Date(t.date).getTime() >= (shiftStartTime - 60000) &&
          new Date(t.date).getTime() <= (shiftEndTime + 60000)
        )) &&
        (t.type === 'Income' || t.type === 'Deposit') &&
        ['Vendor / Staff Refund', 'Supplier Refund', 'Vendor Refund'].includes(t.category)
      )
      .filter((t: any) => !drawerAccountId || t.account_id === drawerAccountId);

    const vendorAndSupplierRefundCashIn = roundCurrency(validMaterialAndSupplierRefundBtx.reduce((sum, t: any) => sum + Number(t.amount || 0), 0));

    const cashCollections = roundCurrency(ledgerCashCollections + deliveryCashCollections + vendorAndSupplierRefundCashIn);

    // Cash expenses paid specifically from THIS drawer
    const validShiftExpenses = expenses
      .filter(e => e.shift_session_id === shiftId && String(e.paymentMode || '').toLowerCase().includes('cash'))
      .filter(e => !e.account_id || !drawerAccountId || e.account_id === drawerAccountId);
    const cashExpenses = roundCurrency(validShiftExpenses.reduce((sum, e) => sum + Number(e.paidAmount || 0), 0));

    // Direct Cash Purchases (Milk Purchases) paid specifically from THIS drawer
    const validMilkPurchases = purchases
      .filter(p => p.shift_session_id === shiftId && String(p.payment_mode || '').toLowerCase().includes('cash'))
      .filter(p => {
        const pAcc = p.account_id || (p as any).details?.account_id;
        return !pAcc || !drawerAccountId || pAcc === drawerAccountId;
      })
      .filter(p => Number(p.paid_amount ?? (p as any).amount_paid ?? (p as any).total_amount ?? 0) > 0);
    const directCashPurchases = roundCurrency(validMilkPurchases.reduce((sum, p: any) => sum + Number(p.paid_amount ?? p.amount_paid ?? p.total_amount ?? 0), 0));

    const countedPurchaseIds = new Set(validMilkPurchases.map(p => p.id));
    const countedExpenseIds = new Set(validShiftExpenses.map(e => e.id));

    // Material, Supplier, and Expense Vendor Cash Out paid specifically out of THIS drawer
    const validMaterialAndSupplierBtx = bankTransactions
      .filter((t: any) => t.shift_session_id === shiftId && t.type === 'Expense' && ['Purchase', 'Supplier Payment', 'Vendor / Staff Payment'].includes(t.category))
      .filter((t: any) => !drawerAccountId || t.account_id === drawerAccountId)
      .filter((t: any) => !t.reference_id || (!countedPurchaseIds.has(t.reference_id) && !countedExpenseIds.has(t.reference_id)));

    const materialAndSupplierCashOut = roundCurrency(validMaterialAndSupplierBtx.reduce((sum, t: any) => sum + Number(t.amount || 0), 0));

    const cashPurchases = roundCurrency(directCashPurchases + materialAndSupplierCashOut);

    // Itemized drawer outflows for UI transparency
    const drawer_outflows: Array<{
      id: string;
      referenceId?: string;
      title: string;
      amount: number;
      category: string;
      group?: string;
      partyName?: string;
      details?: string;
      time?: string;
    }> = [
      ...validMilkPurchases.map(p => ({
        id: p.id,
        referenceId: p.id,
        title: `Milk Purchase: ${p.supplier_name || 'Supplier'}`,
        amount: Number(p.paid_amount ?? p.amount_paid ?? p.total_amount ?? 0),
        category: 'Milk Purchase',
        group: 'Milk Intake',
        partyName: p.supplier_name || 'Supplier',
        details: `${p.quantity || 0}L ${p.milk_type || 'Milk'}`,
        time: (p as any).created_at || p.date
      })),
      ...validMaterialAndSupplierBtx.map((t: any) => {
        const isVendorStaff = t.category === 'Vendor / Staff Payment';
        const isSupplier = t.category === 'Supplier Payment';
        const party = isVendorStaff
          ? (t.description?.replace(/^Payment to:\s*/i, '') || 'Vendor/Staff')
          : (t.description || t.category);
        
        // Prioritize precise event timestamp (from linked vendor tx or created_at)
        let btxTime = t.created_at || t.date;
        if (isVendorStaff && t.reference_id) {
          const evt = expenseVendorTransactions.find(x => x.id === t.reference_id);
          if (evt && (evt.created_at || evt.date)) {
            btxTime = evt.created_at || evt.date;
          }
        }
        return {
          id: t.id,
          referenceId: t.reference_id,
          title: t.description || t.category,
          amount: Number(t.amount || 0),
          category: t.category,
          group: isVendorStaff ? 'Vendor & Staff' : (isSupplier ? 'Supplier Payments' : 'Material Purchases'),
          partyName: party,
          details: t.category,
          time: btxTime
        };
      }),
      ...validShiftExpenses.map(e => ({
        id: e.id,
        referenceId: e.id,
        title: e.description || e.category || 'Petty Expense',
        amount: Number(e.paidAmount || 0),
        category: e.category || 'Expense',
        group: 'Direct Expenses',
        partyName: e.vendor_name || 'Counter Expense',
        details: e.category,
        time: (e as any).created_at || e.date
      }))
    ].filter(item => item.amount > 0);

    // Cash that came back on a purchase return. Same-shift returns cancel the
    // original payout (a returned bill must not stay in shop expenses). Cash
    // from an earlier shift's return is money received in this shift.
    const purchaseReturnNet = netPurchaseReturnRefunds({
      outflows: drawer_outflows,
      refunds: bankTransactions.filter((t: any) =>
        t.shift_session_id === shiftId &&
        (!t.account_id || !drawerAccountId || t.account_id === drawerAccountId || t.account_id === shift?.drawer_id)
      ),
      purchases,
      materialPurchases,
      suppliers,
      expenseLinks: validMaterialAndSupplierBtx.map((t: any) => ({ id: t.id, reference_id: t.reference_id }))
    });
    const netDrawerOutflows = purchaseReturnNet.outflows;
    const netCashPurchases = roundCurrency(Math.max(0, cashPurchases - purchaseReturnNet.netted));

    // Itemized Collections list for UI detail dialog
    const validLedgerCollections = customerTransactions
      .filter(t => t.shift_session_id === shiftId && t.type === 'Payment' && String(t.mode || '').toLowerCase().includes('cash'))
      .filter(t => !t.account_id || !drawerAccountId || t.account_id === drawerAccountId);

    const validDeliveryCollections = dailySupplyEntries
      .filter(entry => entry.shift_session_id === shiftId && String(entry.payment_mode || '').toLowerCase().includes('cash') && Number(entry.payment_received || 0) > 0);

    const validRefundEvents = shiftCashEvents
      .filter(e => e.shift_id === shiftId && e.direction === 'In' && !e.event_type.toLowerCase().includes('sale') && !e.event_type.toLowerCase().includes('collection') && !e.event_type.toLowerCase().includes('vendor') && e.source_type !== 'expense_vendor_transaction' && Number(e.amount || 0) > 0);

    const collections_list = [
      ...validLedgerCollections.map(t => {
        const cust = customers.find(c => c.id === t.customer_id);
        const name = cust?.name || (t.details as any)?.customer_name || 'Customer';
        return {
          id: t.id,
          title: t.description || `Customer Receipt: ${name}`,
          partyName: name,
          amount: Number(t.amount || 0),
          category: 'Customer Ledger',
          source: 'Customer Ledger',
          details: (t.details as any)?.note || t.description || 'Ledger Cash Payment',
          time: (t as any).created_at || t.date
        };
      }),
      ...validDeliveryCollections.map(entry => ({
        id: entry.id,
        title: `Delivery Cash: ${entry.customer_name || 'Customer'}`,
        partyName: entry.customer_name || 'Customer',
        amount: Number(entry.payment_received || 0),
        category: 'Daily Delivery',
        source: 'Daily Delivery',
        details: entry.notes || 'Delivery payment received in cash',
        time: (entry as any).created_at || entry.date
      })),
      ...validMaterialAndSupplierRefundBtx.map((t: any) => {
        const evt = expenseVendorTransactions.find(x => x.id === t.reference_id);
        const vendor = evt ? expenseVendors.find(v => v.id === evt.vendor_id) : undefined;
        const party = vendor?.name || evt?.vendor_name || t.description?.replace(/^Refund \/ Return from:\s*/i, '') || 'Vendor / Staff';
        return {
          id: t.id,
          referenceId: t.reference_id,
          title: t.description || `Refund from ${party}`,
          partyName: party,
          amount: Number(t.amount || 0),
          category: 'Vendor Refund',
          source: 'Vendor / Staff Refund',
          details: (evt as any)?.note || t.description || 'Vendor refund / return received in cash',
          time: evt?.date || (t as any).created_at || t.date
        };
      }),
      ...validRefundEvents.map(e => ({
        id: e.id,
        title: e.description || 'Cash Inflow',
        partyName: e.source_type || 'Refund / Inflow',
        amount: Number(e.amount || 0),
        category: e.event_type || 'Other Inflow',
        source: 'Other Inflow',
        details: e.description || '',
        time: e.occurred_at || e.created_at
      })),
      ...purchaseReturnNet.cashIn
    ].filter(c => c.amount > 0);

    // Itemized Cash Sales list
    const cash_sales_list = allShiftSales
      .filter(s => {
        const mode = String(s.payment_mode || '').toLowerCase();
        if (mode === 'online') return false;
        return salePaidAmount(s) > 0 || sameShiftCashRefund(s.id) > 0;
      })
      .map(s => {
        const paid = salePaidAmount(s);
        const refund = sameShiftCashRefund(s.id);
        return {
          id: s.id,
          invoice_no: s.invoice_no || (s as any).invoice_number || (s as any).bill_number || s.id.slice(0, 10),
          customer_name: s.customer_name || 'Walk-in Customer',
          total: Number(s.total || 0),
          cash_paid: paid,
          refund_amount: refund,
          net_cash: Math.max(0, paid - refund),
          status: s.status || 'Completed',
          time: s.created_at || (s as any).date
        };
      });

    // Itemized All Bills list
    const all_bills_list = allShiftSales.map(s => ({
      id: s.id,
      invoice_no: s.invoice_no || (s as any).invoice_number || (s as any).bill_number || s.id.slice(0, 10),
      customer_name: s.customer_name || 'Walk-in Customer',
      total: Number(s.total || 0),
      payment_mode: s.payment_mode || 'Cash',
      status: s.status || 'Completed',
      time: s.created_at || (s as any).date
    }));

    // Total cash refunds issued during this shift
    const cashRefunds = roundCurrency(shiftCashEvents
      .filter(e => e.shift_id === shiftId && e.direction === 'Out' && e.event_type.toLowerCase().includes('refund') && !e.event_type.toLowerCase().includes('vendor') && e.source_type !== 'expense_vendor_transaction')
      .reduce((sum, e) => sum + Number(e.amount || 0), 0));

    // Refunds for sales originating in PRIOR shifts or external returns.
    // (Returns on this shift's cash sales are already net-zeroed in cashSales above to prevent double-deduction).
    const thisShiftSaleIds = new Set(allShiftSales.map(s => s.id));
    const priorShiftCashRefunds = roundCurrency(shiftCashEvents
      .filter(e => {
        if (e.shift_id !== shiftId || e.direction !== 'Out' || !e.event_type.toLowerCase().includes('refund')) return false;
        if (e.source_type === 'expense_vendor_transaction' || e.event_type.toLowerCase().includes('vendor')) return false;
        const saleId = e.source_id?.split('_')[0];
        if (saleId && thisShiftSaleIds.has(saleId)) return false;
        return true;
      })
      .reduce((sum, e) => sum + Number(e.amount || 0), 0));

    const otherCashIn = roundCurrency(shiftCashEvents
      .filter(e => e.shift_id === shiftId && e.direction === 'In' && !e.event_type.toLowerCase().includes('sale') && !e.event_type.toLowerCase().includes('collection') && !e.event_type.toLowerCase().includes('vendor') && e.source_type !== 'expense_vendor_transaction')
      .reduce((sum, e) => sum + Number(e.amount || 0), 0)
      + purchaseReturnNet.cashIn.reduce((sum, item) => sum + Number(item.amount || 0), 0));

    const otherCashOut = roundCurrency(shiftCashEvents
      .filter(e => e.shift_id === shiftId && e.direction === 'Out' && !e.event_type.toLowerCase().includes('refund') && !e.event_type.toLowerCase().includes('expense') && !e.event_type.toLowerCase().includes('purchase') && !e.event_type.toLowerCase().includes('vendor') && e.source_type !== 'expense_vendor_transaction')
      .reduce((sum, e) => sum + Number(e.amount || 0), 0));

    const expectedCash = roundCurrency(
      Number(shift?.opening_counted ?? shift?.opening_float ?? 0)
      + cashSales
      + cashCollections
      + otherCashIn
      - priorShiftCashRefunds
      - cashExpenses
      - netCashPurchases
      - otherCashOut
    );

    return {
      gross_sales: grossSales,
      cash_sales: cashSales,
      online_sales: onlineSales,
      credit_sales: creditSales,
      cash_collections: cashCollections,
      cash_refunds: cashRefunds,
      cash_expenses: cashExpenses,
      cash_purchases: netCashPurchases,
      other_cash_in: otherCashIn,
      other_cash_out: otherCashOut,
      bills_count: shiftSales.length,
      expectedCash,
      drawer_outflows: netDrawerOutflows,
      collections_list,
      cash_sales_list,
      all_bills_list
    };
  };

  const closeCashierShift = async (data: {
    countedCash: number;
    leaveInDrawer: number;
    remitToHead: number;
    denominations?: Record<string | number, number>;
    differenceReason?: string;
    notes?: string;
  }): Promise<boolean> => {
    if (!activeShiftSession || activeShiftSession.status !== 'Active') {
      showToast('No active shift found.', 'warning');
      return false;
    }
    const counted = roundCurrency(data.countedCash);
    const leave = roundCurrency(data.leaveInDrawer);
    const remit = roundCurrency(data.remitToHead);
    if (Math.abs(counted - leave - remit) >= 0.01) {
      showToast('Counted cash must equal the drawer float plus the head remittance.', 'error');
      return false;
    }
    const totals = getShiftTotals(activeShiftSession.id);
    if (Math.abs(counted - totals.expectedCash) >= 0.01 && !data.differenceReason?.trim()) {
      showToast('A difference reason is required when cash does not match.', 'warning');
      return false;
    }

    const remittanceId = `remit_${generateUUID()}`;
    const { error } = await supabase.rpc('cash_control_close_shift', {
      p_shift_id: activeShiftSession.id,
      p_expected_cash: totals.expectedCash,
      p_counted_cash: counted,
      p_leave_in_drawer: leave,
      p_remit_to_head: remit,
      p_denominations: data.denominations || {},
      p_difference_reason: data.differenceReason || '',
      p_notes: data.notes || '',
      p_totals: totals,
      p_handover_id: `handover_${generateUUID()}`,
      p_remittance_id: remittanceId
    });
    if (error) {
      showToast(`Could not close shift: ${error.message}`, 'error');
      return false;
    }

    // Cash in transit & variance: the server RPC adjusted variance and moved
    // the remitted amount OUT of the drawer account at submit time.
    // Mirror that locally so the drawer balance equals the physical cash left in the drawer.
    const variance = roundCurrency(counted - totals.expectedCash);
    const drawerAccountId = resolveDrawerAccountId(activeShiftSession.drawer_id);
    if (drawerAccountId) {
      if (Math.abs(variance) >= 0.01) {
        setBankTransactions(prev => [{
          id: `btx_var_close_${activeShiftSession.id}`,
          date: new Date().toISOString(),
          account_id: drawerAccountId,
          amount: Math.abs(variance),
          type: variance > 0 ? 'Income' : 'Expense',
          category: 'Cash Over / Short',
          description: (variance > 0 ? 'Cash Surplus (Over) on shift close' : 'Cash Shortage on shift close') + (data.differenceReason ? `: ${data.differenceReason}` : ''),
          business_day_id: activeShiftSession.business_day_id,
          shift_session_id: activeShiftSession.id,
          drawer_id: activeShiftSession.drawer_id,
          cashier_id: activeShiftSession.user_id
        } as BankTransaction, ...prev]);
      }
      if (remit > 0) {
        setBankTransactions(prev => [{
          id: `btx_remit_out_${remittanceId}`,
          date: new Date().toISOString(),
          account_id: drawerAccountId,
          amount: remit,
          type: 'Transfer_Out',
          category: 'Cash Remittance',
          description: 'Cash submitted to Head — pending receive (in transit)',
          reference_id: remittanceId,
          business_day_id: activeShiftSession.business_day_id,
          shift_session_id: activeShiftSession.id,
          drawer_id: activeShiftSession.drawer_id,
          cashier_id: activeShiftSession.user_id
        } as BankTransaction, ...prev]);
      }
      // Drawer balance equals the physical cash left in the drawer
      setAccounts(prev => prev.map(a => a.id === drawerAccountId ? { ...a, balance: leave } : a));
    }

    const closingShiftId = activeShiftSession.id;
    setActiveShiftSession(null);
    localStorage.removeItem('mooco_active_shift_session');

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        const bc = new BroadcastChannel('mooco_shift_channel');
        bc.postMessage({ type: 'SHIFT_CLOSED', shiftId: closingShiftId });
        bc.close();
      } catch (err) {}
    }

    await refreshCashControl();
    showToast(
      remit > 0
        ? `Shift closed. Rs ${remit.toLocaleString()} remitted to Head Office (pending acceptance in Head Inbox).`
        : 'Shift closed. Drawer cash and records updated successfully.',
      'success'
    );
    return true;
  };

  const acceptHeadRemittance = async (
    remittanceId: string,
    countedAmount: number,
    denominations: Record<string | number, number> = {},
    destinationAccountId?: string,
    notes: string = ''
  ): Promise<boolean> => {
    if (!currentUser) return false;
    const pendingRemittance = cashRemittances.find(remittance => remittance.id === remittanceId);
    if (pendingRemittance && pendingRemittance.declared_amount > 0 && countedAmount <= 0) {
      showToast('Enter the physical counted amount to accept.', 'warning');
      return false;
    }
    const { error } = await supabase.rpc('cash_control_accept_remittance', {
      p_remittance_id: remittanceId,
      p_user_id: currentUser.id,
      p_user_name: currentUser.name,
      p_counted_amount: roundCurrency(countedAmount),
      p_denominations: denominations,
      p_destination_account_id: destinationAccountId || null,
      p_notes: notes
    });
    if (error) {
      showToast(`Head receipt accept nahi hui: ${error.message}`, 'error');
      return false;
    }
    if (pendingRemittance) {
      // In-transit clearing: the drawer already lost this cash at shift-close
      // submit time (btx_remit_out_). Receiving credits ONLY the head's chosen
      // destination account — the drawer is never touched again, so a double
      // deduction is impossible. The server RPC performs the real movement;
      // the updates below mirror it in local state for instant UI.
      const drawer = cashDrawers.find(item => item.id === pendingRemittance.drawer_id);
      const sourceAccountId = accounts.find(a => a.id === pendingRemittance.drawer_id)?.id
        || drawer?.account_id
        || settings.financial?.defaultCashAccountId
        || accounts.find(account => account.type === 'Cash' && account.isActive !== false)?.id;
      const destinationId = destinationAccountId
        || accounts.find(account => account.id !== sourceAccountId && (account.type === 'Cash' || account.type === 'Bank' || account.type === 'Wallet') && account.isActive !== false)?.id;

      const amount = roundCurrency(countedAmount);
      if (amount > 0 && destinationId) {
        const destinationAccount = accounts.find(account => account.id === destinationId);
        if (destinationAccount) {
          setAccounts(prev => prev.map(account => account.id === destinationId
            ? { ...account, balance: roundCurrency((account.balance || 0) + amount) }
            : account));
          setBankTransactions(prev => {
            const entry: BankTransaction = {
              id: `btx_remit_in_${remittanceId}`,
              date: new Date().toISOString(),
              account_id: destinationId,
              amount,
              type: 'Transfer_In',
              category: 'Cash Remittance',
              description: `Cash remittance received from ${pendingRemittance.cashier_name} (in transit cleared)`,
              reference_id: remittanceId,
              business_day_id: pendingRemittance.business_day_id,
              shift_session_id: pendingRemittance.shift_id,
              drawer_id: pendingRemittance.drawer_id,
              cashier_id: pendingRemittance.cashier_id
            };
            const existing = prev.findIndex(tx => tx.id === entry.id);
            if (existing >= 0) {
              const next = [...prev];
              next[existing] = entry;
              return next;
            }
            return [entry, ...prev];
          });
        }
      }
    }
    await refreshCashControl();
    showToast('Remittance received — darmiyan cash ab account mein aa gaya.', 'success');
    return true;
  };

  const resolveCashVariance = async (varianceId: string, status: 'Approved' | 'Adjusted' | 'Rejected', notes: string): Promise<boolean> => {
    const canApproveCash = currentUser?.role_id === 'role_super_admin' || currentUser?.role_id === 'role_manager' || currentRole?.permissions?.includes('cash_control:approve' as any) || (currentUser?.permissions || []).includes('cash_control:approve');
    if (!currentUser || !canApproveCash) {
      showToast('Only a manager/owner can resolve a cash difference.', 'error');
      return false;
    }
    const variance = cashVariances.find(v => v.id === varianceId);
    if (!variance) return false;
    const { error } = await supabase.from('cash_variances').update({
      status, resolution_notes: notes, resolved_by: currentUser.id, resolved_at: new Date().toISOString()
    }).eq('id', varianceId);
    if (error) {
      showToast(`Difference resolve nahi hua: ${error.message}`, 'error');
      return false;
    }
    if (variance.handover_id) await supabase.from('drawer_handovers').update({ status: 'Resolved', resolution_notes: notes, resolved_at: new Date().toISOString() }).eq('id', variance.handover_id);
    if (variance.remittance_id) await supabase.from('cash_remittances').update({ status: 'Resolved', notes, resolved_at: new Date().toISOString() }).eq('id', variance.remittance_id);
    if (variance.shift_id) {
      const { count } = await supabase.from('cash_variances').select('id', { count: 'exact', head: true }).eq('shift_id', variance.shift_id).eq('status', 'Open');
      if (!count) await supabase.from('cash_shifts').update({ status: 'Closed' }).eq('id', variance.shift_id).eq('status', 'Pending Review');
    }
    await refreshCashControl();
    showToast('Cash difference resolved.', 'success');
    return true;
  };

  // Head loads opening cash into a drawer. The cash ALWAYS transfers from
  // another tracked Bank & Cash account — no source, no load. Lands as a
  // Pending handover from the head — the next shift auto-accepts it at start
  // (counted = declared, no variance, no separate verification step needed).
  const addDrawerOpeningCash = async (drawerId: string, amount: number, note?: string, sourceAccountId?: string | null): Promise<boolean> => {
    const canApprove = currentUser?.role_id === 'role_super_admin' || currentUser?.role_id === 'role_manager' || currentRole?.permissions?.includes('cash_control:approve' as any) || (currentUser?.permissions || []).includes('cash_control:approve');
    if (!currentUser || !canApprove) {
      showToast('Only a manager/owner can add opening cash to a drawer.', 'error');
      return false;
    }
    try {
      if (!drawerId) {
        showToast('Drawer select karein.', 'warning');
        return false;
      }
      const amt = roundCurrency(amount);
      if (!(amt > 0)) {
        showToast('Amount 0 se zyada honi chahiye.', 'warning');
        return false;
      }
      const drawerAccountId = resolveDrawerAccountId(drawerId);
      const sourceAcc = sourceAccountId ? accounts.find(a => a.id === sourceAccountId) : null;
      if (!sourceAcc) {
        showToast('Source account zaroori hai — opening cash kisi account se transfer ho kar hi aati hai.', 'warning');
        return false;
      }
      if (!drawerAccountId || sourceAcc.id === drawerAccountId) {
        showToast('Source account aur drawer alag hone chahiye.', 'warning');
        return false;
      }
      const businessDate = getBusinessDate();

      // Only one pending handover per drawer is allowed (unique partial
      // index). The head's fresh cash REPLACES any existing pending handover;
      // the replaced row stays in the audit trail as Cancelled.
      const { data: existingPending, error: pendingError } = await supabase
        .from('drawer_handovers').select('id, declared_amount').eq('drawer_id', drawerId).eq('status', 'Pending');
      if (pendingError) throw pendingError;

      // The replaced handover's cash is still physically in the drawer (and in
      // its account balance), so only the NET new cash moves from the source.
      const replacedSum = roundCurrency((existingPending || []).reduce((sum, h) => sum + Number(h.declared_amount || 0), 0));
      const netCredit = roundCurrency(amt - replacedSum);
      if (sourceAcc && netCredit > 0 && Number(sourceAcc.balance || 0) < netCredit) {
        showToast(
          `Source account "${sourceAcc.name}" mein sirf Rs ${Number(sourceAcc.balance || 0).toLocaleString()} hai — ` +
          `Rs ${netCredit.toLocaleString()} transfer nahi ho sakti. Pehle source account mein raqam rakhein ya kam raqam declared karein.`,
          'error'
        );
        return false;
      }

      let replacedCount = 0;
      if (existingPending && existingPending.length > 0) {
        replacedCount = existingPending.length;
        const { error: cancelError } = await supabase.from('drawer_handovers').update({
          status: 'Cancelled',
          accepted_by_user_id: currentUser.id,
          accepted_by_user_name: currentUser.name,
          accepted_at: new Date().toISOString(),
          resolved_at: new Date().toISOString(),
          resolution_notes: `Replaced by new opening cash Rs ${amt.toLocaleString()} added by head`
        }).eq('drawer_id', drawerId).eq('status', 'Pending');
        if (cancelError) throw cancelError;
      }

      const row = {
        id: `handover_add_${generateUUID().slice(0, 12)}`,
        business_day_id: `bd_${businessDate}`,
        drawer_id: drawerId,
        from_shift_id: null,
        from_user_id: currentUser.id,
        from_user_name: currentUser.name,
        declared_amount: amt,
        declared_denominations: {},
        status: 'Pending',
        declared_at: new Date().toISOString()
      };
      const { error } = await supabase.from('drawer_handovers').insert([row]);
      if (error) throw error;

      if (netCredit > 0) {
        // Transfer from a tracked account: one atomic RPC moves both
        // balances and writes both Transfer_Out/Transfer_In ledger rows.
        const { error: transferError } = await transferBetweenAccounts(
          sourceAcc.id, drawerAccountId!, netCredit,
          new Date().toISOString().split('T')[0],
          `Opening Float → drawer (from ${sourceAcc.name})${note ? ` — ${note}` : ''}`
        );
        if (transferError) {
          // Compensate so no handover is ever declared without its cash
          // actually moving: cancel the new handover and restore the
          // replaced ones to Pending.
          await supabase.from('drawer_handovers').update({
            status: 'Cancelled',
            accepted_by_user_id: currentUser.id,
            accepted_by_user_name: currentUser.name,
            accepted_at: new Date().toISOString(),
            resolved_at: new Date().toISOString(),
            resolution_notes: `Rolled back: source transfer failed — ${transferError.message}`
          }).eq('id', row.id);
          const replacedIds = (existingPending || []).map(h => h.id);
          if (replacedIds.length > 0) {
            await supabase.from('drawer_handovers').update({ status: 'Pending' }).in('id', replacedIds);
          }
          await refreshCashControl();
          showToast(`Opening cash transfer nahi hui: ${transferError.message}`, 'error');
          return false;
        }
        setAccounts(prev => prev.map(a => {
          if (a.id === sourceAcc.id) return { ...a, balance: roundCurrency((a.balance || 0) - netCredit) };
          if (a.id === drawerAccountId) return { ...a, balance: roundCurrency((a.balance || 0) + netCredit) };
          return a;
        }));
      }

      await refreshCashControl();
      showToast(
        `Opening cash Rs ${amt.toLocaleString()} drawer mein add ho gayi — agli shift isi se start hogi.` +
        ` (Source: ${sourceAcc.name} - Rs ${netCredit.toLocaleString()} transfer.)` +
        (replacedCount > 0 ? ` (Purani pending handover Rs ${Number(existingPending[0].declared_amount).toLocaleString()} replace ho gayi.)` : ''),
        'success'
      );
      return true;
    } catch (e) {
      console.error('addDrawerOpeningCash error:', e);
      showToast('Opening cash add nahi hui: ' + getErrorMessage(e), 'error');
      return false;
    }
  };

  const resolveCashHandover = async (
    handoverId: string,
    action: 'Accept' | 'Resolve' | 'Cancel',
    notes: string = ''
  ): Promise<boolean> => {
    const canApprove = currentUser?.role_id === 'role_super_admin' || currentUser?.role_id === 'role_manager' || currentRole?.permissions?.includes('cash_control:approve' as any) || (currentUser?.permissions || []).includes('cash_control:approve');
    if (!currentUser || !canApprove) {
      showToast('Only a manager/owner can acknowledge/resolve handovers.', 'error');
      return false;
    }
    const handover = cashHandovers.find(h => h.id === handoverId);
    if (!handover) return false;

    const newStatus: CashHandoverStatus = action === 'Accept' ? 'Accepted' : action === 'Cancel' ? 'Cancelled' : 'Resolved';
    const { error } = await supabase.from('drawer_handovers').update({
      status: newStatus,
      accepted_by_user_id: currentUser.id,
      accepted_by_user_name: currentUser.name,
      accepted_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
      resolution_notes: notes || `Handover marked as ${newStatus} by ${currentUser.name}`
    }).eq('id', handoverId);

    if (error) {
      showToast(`Handover update nahi hua: ${error.message}`, 'error');
      return false;
    }
    await refreshCashControl();
    showToast(`Handover marked as ${newStatus}.`, 'success');
    return true;
  };

  const upsertCashDrawer = async (drawer: { id?: string; name: string; code: string; location?: string; account_id?: string | null; default_float: number; is_active: boolean }): Promise<boolean> => {
    const canManage = currentUser?.role_id === 'role_super_admin' || currentUser?.role_id === 'role_manager' || currentRole?.permissions?.includes('cash_control:approve' as any) || (currentUser?.permissions || []).includes('cash_control:approve');
    if (!currentUser || !canManage) {
      showToast('Only a manager/owner can manage drawer setup.', 'error');
      return false;
    }
    if (!drawer.name.trim() || !drawer.code.trim()) {
      showToast('Drawer name and code are required.', 'warning');
      return false;
    }
    const payload = {
      name: drawer.name.trim(),
      code: drawer.code.trim().toUpperCase().replace(/\s+/g, '_'),
      location: drawer.location?.trim() || null,
      account_id: drawer.account_id || null,
      default_float: roundCurrency(Number(drawer.default_float) || 0),
      is_active: drawer.is_active !== false
    };
    const { data, error } = drawer.id
      ? await supabase.from('cash_drawers').update(payload).eq('id', drawer.id).select()
      : await supabase.from('cash_drawers').insert({ ...payload, id: `drawer_${generateUUID().slice(0, 12)}` }).select();
    if (error) {
      showToast(`Drawer save nahi hua: ${error.message}`, 'error');
      return false;
    }
    const savedRow = Array.isArray(data) ? data[0] : data;
    if (savedRow) setCashDrawers(prev => drawer.id ? prev.map(d => d.id === drawer.id ? (savedRow as CashDrawer) : d) : [savedRow as CashDrawer, ...prev]);
    await refreshCashControl();
    showToast(drawer.id ? 'Drawer updated.' : 'New drawer created.', 'success');
    return true;
  };

  // Candela-style day-close stock count: applies physical-count corrections
  // through one atomic Postgres RPC. Idempotent per day+item (deterministic
  // guard rows), so a retry can never double-adjust the stock.
  const submitDayCloseStockCount = async (
    businessDayId: string,
    counts: { itemId: string; variantId?: string; counted: number }[]
  ): Promise<{ adjusted: number; skipped: number; no_change: number } | null> => {
    const canCloseDay = currentUser?.role_id === 'role_super_admin' || currentUser?.role_id === 'role_manager' || currentRole?.permissions?.includes('cash_control:approve' as any) || (currentUser?.permissions || []).includes('cash_control:approve');
    if (!currentUser || !canCloseDay) {
      showToast('Only a manager/owner can apply the day-close stock count.', 'error');
      return null;
    }
    try {
      if (!counts || counts.length === 0) return { adjusted: 0, skipped: 0, no_change: 0 };
      const payload = counts.map(entry => ({
        item_id: entry.itemId,
        variant_id: entry.variantId || null,
        counted: roundQuantity(entry.counted)
      }));
      const { data, error } = await supabase.rpc('dayclose_stock_count', {
        p_business_day_id: businessDayId,
        p_counts: payload
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      await fetchData();
      const adjusted = Number(result?.adjusted || 0);
      if (adjusted > 0) {
        showToast(`Stock count applied: ${adjusted} item(s) adjusted.`, 'success');
      }
      return {
        adjusted,
        skipped: Number(result?.skipped || 0),
        no_change: Number(result?.no_change || 0)
      };
    } catch (e) {
      console.error('submitDayCloseStockCount error:', e);
      showToast('Stock count apply nahi hui: ' + getErrorMessage(e), 'error');
      return null;
    }
  };

  // Cash closing — independent of the stock closing. Records the snapshot in
  // day_closings and marks business_days.cash_closed_at. This is a record
  // only: sales stay open until Lock Day sets business_days.status = Closed.
  const closeDayCash = async (businessDayId: string, cashClose: Record<string, unknown>, notes: string = ''): Promise<boolean> => {
    const canCloseDay = currentUser?.role_id === 'role_super_admin' || currentUser?.role_id === 'role_manager' || currentRole?.permissions?.includes('cash_control:approve' as any) || (currentUser?.permissions || []).includes('cash_control:approve');
    if (!currentUser || !canCloseDay) {
      showToast('Only a manager/owner can close the cash.', 'error');
      return false;
    }
    try {
      const day = businessDays.find(d => d.id === businessDayId);
      if (!day) return false;
      const { error: eodError } = await supabase.from('day_closings').upsert([{
        id: `eod_${businessDayId}`,
        date: day.business_date,
        status: 'Recorded',
        details: { ...cashClose, notes }
      }]);
      if (eodError) throw eodError;
      const closedAt = new Date().toISOString();
      const { data: row, error: readError } = await supabase.from('business_days').select('summary').eq('id', businessDayId).single();
      if (readError) throw readError;
      const { error } = await supabase.from('business_days').update({
        cash_closed_at: closedAt,
        summary: { ...((row as any)?.summary || {}), cash: { ...cashClose, notes } }
      }).eq('id', businessDayId);
      if (error) throw error;
      setBusinessDays(prev => prev.map(d => d.id === businessDayId ? { ...d, cash_closed_at: closedAt } as BusinessDay : d));
      showToast('Cash closing complete ho gayi.', 'success');
      return true;
    } catch (e) {
      console.error('closeDayCash error:', e);
      showToast('Cash closing fail hui: ' + getErrorMessage(e), 'error');
      return false;
    }
  };

  // Stock closing — applies the physical count corrections (atomic RPC) then
  // marks business_days.stock_closed_at. Independent of the cash closing.
  const closeDayStock = async (businessDayId: string, counts: { itemId: string; variantId?: string; counted: number }[]): Promise<boolean> => {
    const result = await submitDayCloseStockCount(businessDayId, counts);
    if (!result) return false;
    try {
      const closedAt = new Date().toISOString();
      const { error } = await supabase.from('business_days').update({ stock_closed_at: closedAt }).eq('id', businessDayId);
      if (error) throw error;
      setBusinessDays(prev => prev.map(d => d.id === businessDayId ? { ...d, stock_closed_at: closedAt } as BusinessDay : d));
      showToast('Stock closing complete ho gayi.', 'success');
      return true;
    } catch (e) {
      console.error('closeDayStock error:', e);
      showToast('Stock closing mark nahi hui: ' + getErrorMessage(e), 'error');
      return false;
    }
  };

  const closeBusinessDay = async (businessDayId: string, notes: string = '', cashClose?: Record<string, unknown>): Promise<boolean> => {
    const canCloseDay = currentUser?.role_id === 'role_super_admin' || currentUser?.role_id === 'role_manager' || currentRole?.permissions?.includes('cash_control:approve' as any) || (currentUser?.permissions || []).includes('cash_control:approve');
    if (!currentUser || !canCloseDay) {
      showToast('Only a manager/owner can close the day.', 'error');
      return false;
    }
    const day = businessDays.find(d => d.id === businessDayId);
    if (!day) return false;
    const activeCount = shiftSessions.filter(s => s.business_day_id === businessDayId && ['Pending Acceptance', 'Active', 'Closing', 'Pending Review'].includes(s.status)).length;
    const pendingRemits = cashRemittances.filter(r => r.business_day_id === businessDayId && ['Pending', 'Disputed'].includes(r.status)).length;
    // Pending handovers = cash physically left in the drawer (or head-loaded
    // opening cash). They never block the close — they are auto-accepted
    // below. Only DISPUTED handovers (real count mismatch) block, and those
    // already surface as an Open variance.
    const disputedHandovers = cashHandovers.filter(h => h.business_day_id === businessDayId && h.status === 'Disputed').length;
    const openVariances = cashVariances.filter(v => v.business_day_id === businessDayId && v.status === 'Open').length;
    if (activeCount || pendingRemits || disputedHandovers || openVariances) {
      showToast(`Day is not ready to close: ${activeCount} shift, ${pendingRemits} remittance, ${disputedHandovers} disputed handover, ${openVariances} difference pending.`, 'warning');
      return false;
    }
    // Auto-accept whatever is still pending in the drawer — the cash simply
    // stays there overnight. No custody bookkeeping left dangling.
    await supabase.from('drawer_handovers').update({
      status: 'Accepted',
      accepted_by_user_id: currentUser.id,
      accepted_by_user_name: currentUser.name,
      accepted_at: new Date().toISOString(),
      resolution_notes: 'Auto-accepted: cash left in drawer at day close'
    }).eq('business_day_id', businessDayId).eq('status', 'Pending');
    const dayShifts = shiftSessions.filter(s => s.business_day_id === businessDayId);
    const liveTotals = dayShifts.map(s => getShiftTotals(s.id));
    const summary = {
      shifts_count: dayShifts.length,
      gross_sales: roundCurrency(liveTotals.reduce((sum, row) => sum + Number(row.gross_sales || 0), 0)),
      cash_sales: roundCurrency(liveTotals.reduce((sum, row) => sum + Number(row.cash_sales || 0), 0)),
      online_sales: roundCurrency(liveTotals.reduce((sum, row) => sum + Number(row.online_sales || 0), 0)),
      credit_sales: roundCurrency(liveTotals.reduce((sum, row) => sum + Number(row.credit_sales || 0), 0)),
      total_variance: roundCurrency(dayShifts.reduce((sum, s) => sum + Number(s.cash_difference || 0), 0))
    };
    // Locking the day fills any closing that is still missing so both
    // closings always read complete after the lock.
    const updatePayload: Record<string, unknown> = {
      status: 'Closed', closed_at: new Date().toISOString(), closed_by: currentUser.id, notes,
      cash_closed_at: day.cash_closed_at || new Date().toISOString(),
      stock_closed_at: day.stock_closed_at || new Date().toISOString(),
      summary: { ...summary, ...(cashClose ? { cash: cashClose } : {}) }
    };
    const { error } = await supabase.from('business_days').update(updatePayload)
      .eq('id', businessDayId).neq('status', 'Closed');
    if (error) {
      showToast(`Day close nahi hua: ${error.message}`, 'error');
      return false;
    }
    // Cash-closing snapshot (Candela-style EOD Z-report) into day_closings.
    // Deterministic id → reopen + close again overwrites, never duplicates.
    if (cashClose) {
      const { error: eodError } = await supabase.from('day_closings').upsert([{
        id: `eod_${businessDayId}`,
        date: day.business_date,
        status: 'Locked',
        details: cashClose
      }]);
      if (eodError) {
        console.error('[Day Closing] EOD snapshot save nahi hua:', eodError);
        showToast('Warning: cash-closing snapshot save nahi hui — ' + eodError.message, 'error');
      }
    }
    await refreshCashControl();
    showToast(`${day.business_date} ka business day close ho gaya.`, 'success');
    return true;
  };

  const reopenBusinessDay = async (businessDayId: string, reason: string): Promise<boolean> => {
    if (!currentUser || currentUser.role_id !== 'role_super_admin') {
      showToast('Only the Owner / Super Admin can reopen a business day.', 'error');
      return false;
    }
    if (!reason.trim()) {
      showToast('A reopen reason is required.', 'warning');
      return false;
    }
    const day = businessDays.find(d => d.id === businessDayId);
    const { error } = await supabase.from('business_days').update({
      status: 'Open',
      reopened_at: new Date().toISOString(),
      reopened_by: currentUser.id,
      reopen_reason: reason,
      cash_closed_at: null,
      stock_closed_at: null,
      closed_at: null,
      closed_by: null
    }).eq('id', businessDayId).eq('status', 'Closed');
    if (error) {
      showToast(`Day reopen nahi hua: ${error.message}`, 'error');
      return false;
    }
    const businessDate = day?.business_date;
    await supabase.from('day_closings').delete().eq('id', `eod_${businessDayId}`);
    if (businessDate) {
      await supabase.from('day_closings').delete().eq('date', businessDate).in('status', ['Locked', 'Recorded']);
    }
    setDayClosings(prev => {
      const next = prev.filter(entry => entry.id !== `eod_${businessDayId}` && !(businessDate && entry.date === businessDate));
      localStorage.setItem('mooco_day_closings', JSON.stringify(next));
      return next;
    });
    await refreshCashControl();
    showToast('Business day reopened with an audit trail entry.', 'success');
    return true;
  };

  const openShiftSession = async (shiftName: string, openingFloat: number, accountId?: string): Promise<ShiftSession> => {
    const today = new Date().toISOString().split('T')[0];
    const shiftId = `shift_${today}_${shiftName.toLowerCase()}_${generateUUID().slice(0, 8)}`;
    const acc = accounts.find(a => a.id === accountId) || accounts.find(a => a.type === 'Cash') || accounts[0];

    const newShift: ShiftSession = {
      id: shiftId,
      date: today,
      shift_name: shiftName,
      user_id: currentUser?.id || 'user_admin_default',
      user_name: currentUser?.name || 'Cashier',
      role_name: currentRole?.name || 'POS Cashier',
      account_id: acc?.id,
      account_name: acc?.name,
      opening_float: openingFloat,
      start_time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'Active',
      created_at: new Date().toISOString()
    };

    setActiveShiftSession(newShift);
    setShiftSessions(prev => [newShift, ...prev]);
    localStorage.setItem('mooco_active_shift_session', JSON.stringify(newShift));
    localStorage.setItem('counter_opening_float', openingFloat.toString());
    localStorage.setItem('mooco_shift_sessions', JSON.stringify([newShift, ...shiftSessions]));

    // Sync to Supabase
    try {
      await supabase.from('shift_sessions').insert([{
        id: shiftId,
        date: today,
        status: 'Active',
        details: newShift
      }]);
    } catch (err) {
      console.warn('[Supabase Shift Insert Notice]', err);
    }

    showToast(`Shift ${shiftName} started with Float Rs ${openingFloat.toLocaleString()}`, 'success');
    return newShift;
  };

  const closeShiftSession = async (shiftId: string, closingData: Partial<ShiftSession>): Promise<boolean> => {
    try {
      const now = new Date();
      const endTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const closedAt = now.toISOString();

      const baseShift = activeShiftSession?.id === shiftId 
        ? activeShiftSession 
        : (shiftSessions.find(s => s.id === shiftId) || {} as ShiftSession);

      const updatedShift: ShiftSession = {
        ...baseShift,
        ...closingData,
        id: shiftId,
        end_time: endTime,
        closed_at: closedAt,
        status: 'Closed'
      };

      // Update local state
      setShiftSessions(prev => prev.map(s => s.id === shiftId ? updatedShift : s));
      if (activeShiftSession?.id === shiftId) {
        setActiveShiftSession(null);
        localStorage.removeItem('mooco_active_shift_session');
      }
      localStorage.setItem('mooco_shift_sessions', JSON.stringify(
        shiftSessions.map(s => s.id === shiftId ? updatedShift : s)
      ));

      // Also create Retail Closing record if stock items included
      if (closingData.stock_items && closingData.stock_items.length > 0) {
        await performRetailClosing({
          date: updatedShift.date,
          shift: updatedShift.shift_name,
          shift_session_id: shiftId,
          items: closingData.stock_items,
          cash_reconciliation: {
            opening_cash: updatedShift.opening_float,
            pos_cash_sales: updatedShift.cash_sales,
            customer_cash_payments: updatedShift.khata_cash_recovered,
            purchases_cash_paid: updatedShift.spot_purchases_paid,
            expenses_cash_paid: updatedShift.drawer_expenses_paid,
            expected_total_cash: updatedShift.expected_drawer_cash,
            actual_physical_cash: updatedShift.actual_physical_cash,
            cash_difference: updatedShift.cash_difference,
            difference_reason: updatedShift.difference_reason,
            account_id: updatedShift.account_id,
            account_name: updatedShift.account_name,
            cashier_id: updatedShift.user_id,
            cashier_name: updatedShift.user_name,
            handover_to: updatedShift.handover_to,
            denominations: updatedShift.denominations
          },
          total_revenue: updatedShift.gross_sales,
          notes: updatedShift.notes
        });
      }

      // Sync to Supabase
      try {
        await supabase.from('shift_sessions').upsert([{
          id: shiftId,
          date: updatedShift.date,
          status: 'Closed',
          details: updatedShift
        }]);
      } catch (err) {
        console.warn('[Supabase Shift Close Notice]', err);
      }

      showToast(`Shift ${updatedShift.shift_name} closed successfully!`, 'success');
      return true;
    } catch (e) {
      console.error('[Close Shift Session Error]', e);
      return false;
    }
  };

  const performDayClosing = async (dayClosingData: Omit<DayClosingEntry, 'id' | 'closed_at' | 'status'>): Promise<boolean> => {
    try {
      const now = new Date();
      const dayClosingId = `eod_${dayClosingData.date}_${generateUUID().slice(0, 8)}`;
      
      // Auto-record Cash Drop transfer if cash_drop_amount > 0 and deposit_account_id is chosen
      let journalId: string | undefined;
      if (dayClosingData.cash_drop_amount > 0 && dayClosingData.deposit_account_id) {
        const fromAcc = accounts.find(a => a.type === 'Cash') || accounts[0];
        const toAcc = accounts.find(a => a.id === dayClosingData.deposit_account_id);
        
        if (fromAcc && toAcc && fromAcc.id !== toAcc.id) {
          await transferFunds(
            fromAcc.id,
            toAcc.id,
            dayClosingData.cash_drop_amount,
            dayClosingData.date,
            `EOD Cash Drop / Vault Transfer - Day Closing ${dayClosingData.date}`
          );
        }
      }

      const newDayClosing: DayClosingEntry = {
        ...dayClosingData,
        id: dayClosingId,
        closed_at: now.toISOString(),
        status: 'Locked',
        journal_entry_id: journalId
      };

      setDayClosings(prev => [newDayClosing, ...prev]);
      localStorage.setItem('mooco_day_closings', JSON.stringify([newDayClosing, ...dayClosings]));

      // Sync to Supabase — the shared day lock MUST persist, otherwise other
      // devices can keep selling into a locked day. supabase-js resolves with
      // an error object instead of throwing, so check it explicitly.
      const { error: dcError } = await supabase.from('day_closings').insert([{
        id: dayClosingId,
        date: dayClosingData.date,
        status: 'Locked',
        details: newDayClosing
      }]);
      if (dcError) {
        console.error('[Supabase Day Closing Error]', dcError);
        showToast('Warning: day lock could not be saved to the cloud — other devices will NOT see this day as locked.', 'error');
      }

      showToast(`Day Closing (EOD Z-Report) finalized for ${dayClosingData.date}!`, 'success');
      return true;
    } catch (e) {
      console.error('[Day Closing Error]', e);
      return false;
    }
  };

  const isDayLocked = (dateStr: string): boolean => {
    const d = dateStr.split('T')[0];
    return businessDays.some(day => day.business_date === d && day.status === 'Closed');
  };

  const reopenDayClosing = async (dayClosingId: string): Promise<boolean> => {
    if (!canPerform('settings', 'delete') && currentUser?.role_id !== 'role_super_admin') {
      showToast('Only Owner / Super Admin can reopen a locked business day!', 'error');
      return false;
    }

    setDayClosings(prev => prev.filter(c => c.id !== dayClosingId));
    localStorage.setItem('mooco_day_closings', JSON.stringify(dayClosings.filter(c => c.id !== dayClosingId)));
    const { error: dcDelError } = await supabase.from('day_closings').delete().eq('id', dayClosingId);
    if (dcDelError) {
      console.error('[Supabase Day Reopen Error]', dcDelError);
      showToast('Warning: cloud day lock could not be removed — other devices may still see this day as locked.', 'error');
      fetchData();
      return false;
    }
    showToast('Day closing unlocked & reopened successfully', 'info');
    return true;
  };
  
  // Updated addCustomer to use crypto.randomUUID() & offline-first Dexie store
  const addCustomer = async (c: Omit<Customer, 'id'>): Promise<string | boolean> => {
    try {
      const id = generateUUID();
      const { name, phone, address, route, type, balance, isActive, ...extraData } = c;
      const initialBalance = parseFloat(balance?.toString() || '0') || 0;
      const createdDate = new Date().toISOString();

      const newCustObj: Customer = {
        id,
        name,
        phone: phone || '',
        address: address || '',
        route: route || '',
        type: type || 'Retail Counter',
        balance: initialBalance,
        isActive: isActive !== undefined ? isActive : true,
        ...extraData
      };

      // 1. Save locally to Dexie (Offline First)
      const localCust: LocalCustomer = {
        id,
        name,
        phone: phone || '',
        address: address || '',
        route: route || '',
        type: type || 'Retail Counter',
        balance: initialBalance,
        is_active: isActive !== undefined ? isActive : true,
        data: extraData,
        sync_status: 'pending',
        created_at: createdDate
      };
      await db.customers.put(localCust);
      noteLocalWrite();

      // 2. Optimistic UI update (Instant)
      setCustomers(prev => [...prev, newCustObj]);

      // If initial opening balance exists, log in customer_transactions
      if (initialBalance !== 0) {
        setCustomerTransactions(prev => [{
          id: `ctx_op_${id}`,
          customer_id: id,
          date: createdDate.split('T')[0],
          type: initialBalance > 0 ? 'Charge' : 'Payment',
          amount: Math.abs(initialBalance),
          mode: 'Opening Balance',
          note: initialBalance > 0 ? 'Opening Balance (Initial Receivable)' : 'Opening Balance (Initial Advance/Credit)'
        }, ...prev]);
      }

      // 3. Trigger Non-blocking Background Sync
      syncService.notifyPendingChange().catch(err => console.warn('[Customer Sync] Background sync notice:', err));

      showToast("Customer added successfully", 'success');
      return id;
    } catch(e: any) { 
      console.error(e);
      showToast("Failed to save customer", "error"); 
      return false; 
    }
  };

  const updateCustomer = async (id: string, u: Partial<Customer>) => {
    try {
      setCustomers(prev => prev.map(c => c.id === id ? { ...c, ...u } : c));

      const { name, phone, address, route, type, balance, isActive, ...extraData } = u;
      const dbUpdates: any = {};
      if (name !== undefined) dbUpdates.name = name;
      if (phone !== undefined) dbUpdates.phone = phone;
      if (address !== undefined) dbUpdates.address = address;
      if (route !== undefined) dbUpdates.route = route;
      if (type !== undefined) dbUpdates.type = type;
      if (isActive !== undefined) dbUpdates.is_active = isActive;

      // Balance edits go through the atomic delta RPC, not a full-row
      // overwrite — a direct UPDATE would clobber a concurrent sale/payment
      // applied by another device between our fetch and write.
      if (balance !== undefined) {
        const current = customers.find(c => c.id === id);
        const delta = roundCurrency(Number(balance || 0) - Number(current?.balance || 0));
        if (delta !== 0) {
          const { error: balError } = await adjustCustomerBalance(id, delta);
          if (balError) {
            showToast("Failed to update customer balance: " + balError.message, 'error');
            fetchData();
            return false;
          }
        }
      }

      if (Object.keys(extraData).length > 0) {
        const { data: existing } = await supabase.from('customers').select('data').eq('id', id).single();
        dbUpdates.data = { ...(existing?.data || {}), ...extraData };
      }

      if (Object.keys(dbUpdates).length > 0) {
        const { error } = await supabase.from('customers').update(dbUpdates).eq('id', id);
        if (error) {
          showToast("Failed to update customer: " + error.message, 'error');
          fetchData();
          return false;
        }
      }
      return true;
    } catch (e) { return false; }
  };

  const deleteCustomer = async (id: string) => {
    try {
      setCustomers(prev => prev.filter(c => c.id !== id));
      const { error } = await supabase.from('customers').delete().eq('id', id);
      if (error) {
        // FK is ON DELETE RESTRICT: a customer with sales/ledger history
        // cannot be deleted — surface that instead of silently failing.
        showToast(
          error.code === '23503'
            ? 'Cannot delete: this customer has sales/ledger history. Set them inactive instead.'
            : "Failed to delete customer: " + error.message,
          'error'
        );
        fetchData();
        return false;
      }
      return true;
    } catch (e) { return false; }
  };

  const recordCustomerPayment = async (
    customerId: string, 
    amount: number, 
    date: string, 
    mode: string, 
    note?: string, 
    type: 'Payment' | 'Charge' = 'Payment',
    accountId?: string
  ) => { 
      try {
          const cust = customers.find(c => c.id === customerId);
          if (cust) {
              const balanceDelta = type === 'Payment' ? -amount : amount;
              const newBalance = roundCurrency(cust.balance + balanceDelta);
              const txId = `ctx_${generateUUID()}`;
              const normalizedDate = normalizeTransactionTimestamp(date);

              const isCashMode = !mode || mode.toLowerCase().includes('cash');
              const targetAccountId = accountId || (
                isCashMode
                  ? (activeShiftSession?.account_id || activeShiftSession?.drawer_id || settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash' && a.isActive !== false)?.id || accounts.find(a => a.isActive !== false)?.id)
                  : (settings.financial?.defaultDigitalAccountId || accounts.find(a => (a.type === 'Bank' || a.type === 'Wallet') && a.isActive !== false)?.id || accounts.find(a => a.isActive !== false)?.id)
              );

              if (type === 'Payment' && amount > 0 && !targetAccountId) {
                showToast("Payment account select karna zaroori hai! Pehle Bank & Cash men account banayein.", "warning");
                return false;
              }

              const isDrawerAccount = Boolean(
                activeShiftSession?.status === 'Active' &&
                targetAccountId &&
                (targetAccountId === activeShiftSession?.drawer_id || targetAccountId === resolveDrawerAccountId(activeShiftSession?.drawer_id))
              );
              const activeDrawerId = isDrawerAccount ? activeShiftSession?.drawer_id : null;
              const shiftSessionId = isDrawerAccount ? activeShiftSession?.id : null;
              const businessDayId = isDrawerAccount ? activeShiftSession?.business_day_id : null;
              const cashierId = isDrawerAccount ? activeShiftSession?.user_id : (currentUser?.id || null);

              const customerPaymentPayload = {
                p_tx_id: txId,
                p_customer_id: customerId,
                p_amount: roundCurrency(amount),
                p_date: normalizedDate,
                p_type: type,
                p_details: {
                  mode, note, account_id: targetAccountId || accountId,
                  description: `Customer Receipt: ${cust.name}${note ? ` (${note})` : ''}`
                },
                p_account_id: type === 'Payment' ? targetAccountId : null,
                p_business_day_id: businessDayId,
                p_shift_session_id: shiftSessionId,
                p_drawer_id: activeDrawerId,
                p_cashier_id: cashierId
              };

              noteLocalWrite();
              // Optimistic UI updates
              setCustomers(prev => prev.map(c => c.id === customerId ? { ...c, balance: newBalance } : c));
              setCustomerTransactions(prev => [{
                id: txId,
                customer_id: customerId,
                date: normalizedDate,
                type,
                amount: roundCurrency(amount),
                mode,
                note,
                account_id: targetAccountId || accountId,
                details: customerPaymentPayload.p_details
              } as any, ...prev]);

              if (type === 'Payment' && targetAccountId && amount > 0) {
                setAccounts(prev => prev.map(a => a.id === targetAccountId ? { ...a, balance: (a.balance || 0) + amount } : a));
                setBankTransactions(prev => [{
                  id: `btx_${txId}`,
                  account_id: targetAccountId,
                  amount: roundCurrency(amount),
                  date: normalizedDate,
                  type: 'Income',
                  category: 'Customer Receipt',
                  description: `Customer Receipt: ${cust.name}${note ? ` (${note})` : ''}`,
                  reference_id: txId,
                  business_day_id: businessDayId,
                  shift_session_id: shiftSessionId,
                  drawer_id: activeDrawerId,
                  cashier_id: cashierId
                } as any, ...prev]);
              }

              await saveWithOutbox(
                'customer_payment',
                customerPaymentPayload,
                txId,
                () => supabase.rpc('record_customer_payment_effects', customerPaymentPayload)
              );

              showToast("Customer Payment Recorded Successfully", "success");
              return true;
          }
          return false;
      } catch (e) { 
        console.error("recordCustomerPayment error:", e);
        showToast("Customer payment failed: " + getErrorMessage(e), "error");
        return false; 
      }
  };

  const deleteCustomerTransaction = async (id: string) => {
    try {
      const tx = customerTransactions.find(t => t.id === id);
      let fallbackAccountId: string | null = null;
      if (tx && tx.type === 'Payment') {
        const isCashMode = !(tx as any).mode || (tx as any).mode.toLowerCase().includes('cash');
        fallbackAccountId = (tx as any).account_id || (
          isCashMode
            ? (settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id)
            : (settings.financial?.defaultDigitalAccountId || accounts.find(a => a.type === 'Bank' || a.type === 'Wallet')?.id)
        ) || null;
      }

      // Balance reversal (khata + account + linked bank tx) happens in ONE
      // atomic Postgres transaction, keyed off the stored ledger row.
      const { error: delError } = await supabase.rpc('delete_customer_transaction_effects', {
        p_tx_id: id,
        p_fallback_account_id: fallbackAccountId
      });
      if (delError) throw delError;

      if (tx) {
        const cust = customers.find(c => c.id === tx.customer_id);
        if (cust) {
          const balanceReversal = tx.type === 'Payment' ? tx.amount : -tx.amount;
          setCustomers(prev => prev.map(c => c.id === tx.customer_id ? { ...c, balance: roundCurrency(cust.balance + balanceReversal) } : c));
        }
      }
      setCustomerTransactions(prev => prev.filter(t => t.id !== id));
      fetchData();
      return true;
    } catch (e) {
      console.error("deleteCustomerTransaction error:", e);
      showToast("Transaction delete failed: " + getErrorMessage(e), "error");
      fetchData();
      return false;
    }
  };
  
  const addExpense = async (e: Omit<ExpenseEntry, 'id'>) => {
    try {
      const id = `exp_${generateUUID()}`;
      const { date, category, amount, paidAmount, paymentStatus, description, account_id, account_name, vendor_id, vendor_name, ...extraDetails } = e as any;
      
      const totalAmt = amount || 0;
      const actualPaidAmount = paymentStatus === 'Unpaid' 
        ? 0 
        : (paymentStatus === 'Partial' ? (paidAmount || 0) : (paidAmount !== undefined ? paidAmount : totalAmt));
      const status = paymentStatus || (actualPaidAmount >= totalAmt ? 'Paid' : (actualPaidAmount > 0 ? 'Partial' : 'Unpaid'));
      const unpaidPortion = Math.max(0, totalAmt - actualPaidAmount);
      const selectedAccount = accounts.find(a => a.id === account_id);

      const isDrawerExpenseAccount = Boolean(
        activeShiftSession?.status === 'Active' &&
        activeShiftSession?.drawer_id &&
        account_id &&
        (account_id === activeShiftSession.drawer_id || account_id === resolveDrawerAccountId(activeShiftSession.drawer_id))
      );
      const activeDrawerId = isDrawerExpenseAccount ? activeShiftSession?.drawer_id : null;
      const shiftSessionId = isDrawerExpenseAccount ? (activeShiftSession?.id || null) : null;
      const businessDayId = isDrawerExpenseAccount ? (activeShiftSession?.business_day_id || null) : null;
      const cashierId = isDrawerExpenseAccount ? activeShiftSession?.user_id : (currentUser?.id || null);
      const normalizedDate = normalizeTransactionTimestamp(date);

      const expensePayload = {
        expense_id: id,
        date: normalizedDate,
        category: category || 'Expense',
        amount: totalAmt,
        paid_amount: actualPaidAmount,
        payment_status: status,
        description: description || '',
        account_id: account_id || null,
        account_name: account_name || null,
        vendor_id: vendor_id || null,
        vendor_name: vendor_name || null,
        business_day_id: businessDayId,
        shift_session_id: shiftSessionId,
        drawer_id: activeDrawerId,
        cashier_id: cashierId,
        ...extraDetails
      };

      noteLocalWrite();
      // 1. Optimistic update for expenses
      setExpenses(prev => [{ 
        id, 
        date: expensePayload.date, 
        category: expensePayload.category, 
        amount: totalAmt, 
        paidAmount: actualPaidAmount,
        paymentStatus: status,
        description, 
        account_id, 
        account_name, 
        vendor_id, 
        vendor_name, 
        business_day_id: businessDayId || undefined,
        shift_session_id: shiftSessionId || undefined,
        drawer_id: activeDrawerId || undefined,
        cashier_id: cashierId || undefined,
        ...extraDetails 
      } as ExpenseEntry, ...prev]);

      // If vendor is specified, update vendor in-memory stats
      if (vendor_id && unpaidPortion > 0) {
        setExpenseVendors(prev => prev.map(v => v.id === vendor_id ? {
          ...v,
          pending_balance: (v.pending_balance || 0) + unpaidPortion,
          total_billed: (v.total_billed || 0) + totalAmt,
          total_paid: (v.total_paid || 0) + actualPaidAmount
        } : v));
      } else if (vendor_id && totalAmt > 0) {
        setExpenseVendors(prev => prev.map(v => v.id === vendor_id ? {
          ...v,
          total_billed: (v.total_billed || 0) + totalAmt,
          total_paid: (v.total_paid || 0) + actualPaidAmount
        } : v));
      }

      // Auto deduct paid amount from selected Cash or Bank Account in-memory
      if (account_id && actualPaidAmount > 0) {
        setAccounts(prev => prev.map(a => a.id === account_id ? { ...a, balance: (a.balance || 0) - actualPaidAmount } : a));
        setBankTransactions(prev => [{
          id: `btx_${id}`,
          account_id,
          amount: actualPaidAmount,
          date: expensePayload.date,
          type: 'Expense',
          category: category || 'Expense',
          description: `Expense: ${description}${vendor_name ? ` (${vendor_name})` : ''}`,
          related_expense_id: id,
          business_day_id: businessDayId || undefined,
          shift_session_id: shiftSessionId || undefined,
          drawer_id: activeDrawerId || undefined,
          cashier_id: cashierId || undefined
        } as any, ...prev]);
      }

      await saveWithOutbox('expense', expensePayload, id, () => recordExpenseEffects(expensePayload));

      showToast("Expense Recorded Successfully", "success");
      return true;
    } catch (err) {
      console.error("addExpense error:", err);
      showToast("Expense failed: " + getErrorMessage(err), "error");
      return false;
    }
  };

  const deleteExpense = async (id: string) => { 
    try {
      const exp = expenses.find(e => e.id === id);
      if (exp) {
        // QuickBooks Period Lock check: closed shifts or locked business days cannot be altered
        const dayLocked = exp.date ? isDayLocked(exp.date) : false;
        const shiftLocked = exp.shift_session_id ? shiftSessions.some(s => s.id === exp.shift_session_id && (s.status === 'Closed' || s.status === 'Force Closed')) : false;
        if (dayLocked || shiftLocked) {
          showToast('Closed Period Lock: This expense belongs to a closed shift or locked business day. Physical drawer cash was already reconciled. Please post an Expense Reversal.', 'error');
          return false;
        }

        const paid = exp.paidAmount !== undefined ? exp.paidAmount : exp.amount;
        const accountId = exp.account_id || (exp as any)?.details?.account_id;
        
        // 1. Restore cash/bank balance if money was paid
        if (accountId && paid > 0) {
          const acc = accounts.find(a => a.id === accountId);
          if (acc) {
            const { error: expAccError } = await adjustAccountBalance(accountId, paid);
            if (expAccError) throw expAccError;
          }
          await supabase.from('bank_transactions').delete().eq('related_expense_id', id);
        }

        // 2. Adjust vendor balance if unpaid portion was added
        if (exp.vendor_id) {
          const vendor = expenseVendors.find(v => v.id === exp.vendor_id);
          if (vendor) {
            const unpaidPortion = Math.max(0, (exp.amount || 0) - paid);
            const newPending = Math.max(0, (vendor.pending_balance || 0) - unpaidPortion);
            const newPaid = Math.max(0, (vendor.total_paid || 0) - paid);
            const newBilled = Math.max(0, (vendor.total_billed || 0) - (exp.amount || 0));

            setExpenseVendors(prev => prev.map(v => v.id === exp.vendor_id ? {
              ...v,
              pending_balance: newPending,
              total_paid: newPaid,
              total_billed: newBilled
            } : v));

            await adjustExpenseVendorStats(vendor.id, -unpaidPortion, -(exp.amount || 0), -paid);
          }
        }
      }
      setExpenses(prev => prev.filter(e => e.id !== id));
      await supabase.from('expenses').delete().eq('id', id); 
      fetchData(); 
      return true; 
    } catch(e) {
      console.error("deleteExpense error:", e);
      return false;
    }
  };
  
  const addRecurringExpense = async (e: Omit<RecurringExpense, 'id'>) => {
    try {
      const id = `re_${generateUUID()}`;
      const { name, amount, ...extraDetails } = e;
      const dbRecurring = {
        id,
        name,
        amount: amount || 0,
        details: extraDetails
      };
      await supabase.from('recurring_expenses').insert([dbRecurring]);
      fetchData();
      return true;
    } catch (err) { return false; }
  };

  const deleteRecurringExpense = async (id: string) => { await supabase.from('recurring_expenses').delete().eq('id', id); fetchData(); return true; };
  const generateRecurringExpense = async (id: string) => { return true; };
  
  const addExpenseVendor = async (v: Omit<ExpenseVendor, 'id' | 'total_paid'> & { id?: string }): Promise<string | false> => {
    try {
      const id = (v as any).id || `ev_${generateUUID()}`;
      const { name, service_type, phone, contact_person, address, notes, isActive, opening_balance, bank_name, account_number, iban, ...extraDetails } = v as any;
      const initialPending = opening_balance || 0;
      
      const dbVendor = {
        id,
        name: name || 'Vendor',
        details: { 
          service_type: service_type || 'Other',
          phone: phone || '',
          contact_person: contact_person || '',
          address: address || '',
          notes: notes || '',
          isActive: isActive !== undefined ? isActive : true,
          total_paid: 0,
          total_billed: 0,
          pending_balance: initialPending,
          opening_balance: initialPending,
          bank_name: bank_name || '',
          account_number: account_number || '',
          iban: iban || '',
          ...extraDetails 
        }
      };

      setExpenseVendors(prev => [{ 
        id, 
        name: name || 'Vendor', 
        service_type: service_type || 'Other', 
        phone: phone || '', 
        contact_person: contact_person || '',
        address: address || '', 
        notes: notes || '', 
        isActive: isActive !== undefined ? isActive : true, 
        total_paid: 0,
        total_billed: 0,
        pending_balance: initialPending,
        opening_balance: initialPending,
        bank_name: bank_name || '',
        account_number: account_number || '',
        iban: iban || '',
        ...extraDetails 
      } as ExpenseVendor, ...prev]);

      const { error } = await supabase.from('expense_vendors').insert([dbVendor]);
      if (error) throw error;
      showToast(`Vendor "${name}" created successfully!`, "success");
      fetchData();
      return id;
    } catch (e: any) { 
      console.error("addExpenseVendor error:", e);
      showToast(`Failed to add vendor: ${e?.message || 'Error'}`, "error");
      return false; 
    }
  };

  const updateExpenseVendor = async (id: string, updates: Partial<ExpenseVendor>) => {
    try {
      const existing = expenseVendors.find(v => v.id === id);
      if (!existing) return false;

      const merged = { ...existing, ...updates };
      const { name, service_type, phone, contact_person, address, notes, isActive, total_paid, total_billed, pending_balance, opening_balance, bank_name, account_number, iban, ...extraDetails } = merged as any;

      let finalPending = pending_balance !== undefined ? pending_balance : 0;
      if (updates.opening_balance !== undefined && updates.opening_balance !== existing.opening_balance) {
        const delta = (updates.opening_balance || 0) - (existing.opening_balance || 0);
        finalPending = (existing.pending_balance || 0) + delta;
        merged.pending_balance = finalPending;
      }

      const dbUpdates = {
        name: name || existing.name,
        details: {
          service_type: service_type || 'Other',
          phone: phone || '',
          contact_person: contact_person || '',
          address: address || '',
          notes: notes || '',
          isActive: isActive !== undefined ? isActive : true,
          total_paid: total_paid || 0,
          total_billed: total_billed || 0,
          pending_balance: finalPending,
          opening_balance: opening_balance || 0,
          bank_name: bank_name || '',
          account_number: account_number || '',
          iban: iban || '',
          ...extraDetails
        }
      };

      setExpenseVendors(prev => prev.map(v => v.id === id ? merged : v));

      const { error } = await supabase.from('expense_vendors').update(dbUpdates).eq('id', id);
      if (error) throw error;

      // If vendor name was changed, sync related expenses in local state
      if (updates.name && updates.name !== existing.name) {
        setExpenses(prev => prev.map(exp => exp.vendor_id === id ? { ...exp, vendor_name: updates.name } : exp));
      }

      showToast(`Vendor "${name || existing.name}" updated successfully!`, "success");
      fetchData();
      return true;
    } catch (e: any) {
      console.error("updateExpenseVendor error:", e);
      showToast(`Failed to update vendor: ${e?.message || 'Error'}`, "error");
      return false;
    }
  };

  const deleteExpenseVendor = async (id: string) => {
    try {
      const vendor = expenseVendors.find(v => v.id === id);
      setExpenseVendors(prev => prev.filter(v => v.id !== id));
      const { error } = await supabase.from('expense_vendors').delete().eq('id', id);
      if (error) throw error;

      showToast(`Vendor "${vendor?.name || ''}" deleted successfully`, "info");
      fetchData();
      return true;
    } catch (e: any) { 
      console.error("deleteExpenseVendor error:", e);
      showToast(`Failed to delete vendor: ${e?.message || 'Error'}`, "error");
      return false; 
    }
  };

  const recordExpenseVendorPayment = async (
    vendorId: string, 
    amount: number, 
    date: string, 
    mode: string, 
    accountId: string, 
    note?: string, 
    referenceNo?: string,
    transactionType: 'payment' | 'refund' = 'payment'
  ): Promise<boolean> => {
    try {
      const vendor = expenseVendors.find(v => v.id === vendorId);
      if (!vendor) {
        showToast("Vendor not found", "error");
        return false;
      }

      if (amount <= 0) {
        showToast("Please enter a valid amount", "warning");
        return false;
      }

      const isRefund = transactionType === 'refund';
      const txId = `evt_${generateUUID()}`;
      const currentPending = vendor.pending_balance || 0;
      
      // If Payment (Money Out): reduces vendor balance (or creates/increases advance)
      // If Refund (Money In): increases vendor balance back towards 0 (recovering advance)
      const newPending = isRefund ? (currentPending + amount) : (currentPending - amount);
      const newTotalPaid = isRefund 
        ? Math.max(0, (vendor.total_paid || 0) - amount)
        : (vendor.total_paid || 0) + amount;

      // 1. Optimistic Update Vendor
      setExpenseVendors(prev => prev.map(v => v.id === vendorId ? {
        ...v,
        pending_balance: newPending,
        total_paid: newTotalPaid
      } : v));

      // 2. Update Vendor in Supabase (atomic JSONB stat deltas)
      const pendingDelta = isRefund ? amount : -amount;
      const paidDelta = isRefund ? -amount : amount;
      const { error: statsError } = await adjustExpenseVendorStats(vendorId, pendingDelta, 0, paidDelta);
      if (statsError) throw statsError;

      // 3. Update Financial Account (Cash/Bank)
      const isCashMode = !mode || mode.toLowerCase().includes('cash');
      const targetAccountId = accountId || (
        isCashMode
          ? (activeShiftSession?.account_id || activeShiftSession?.drawer_id || settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash' && a.isActive !== false)?.id || accounts.find(a => a.isActive !== false)?.id)
          : (settings.financial?.defaultDigitalAccountId || accounts.find(a => (a.type === 'Bank' || a.type === 'Wallet') && a.isActive !== false)?.id || accounts.find(a => a.isActive !== false)?.id)
      );
      const chosenAccount = accounts.find(a => a.id === targetAccountId);
      if (chosenAccount) {
        // If Payment (Money Out): balance decreases
        // If Refund (Money In): balance increases
        const newAccBal = isRefund
          ? (chosenAccount.balance + amount)
          : (chosenAccount.balance - amount);

        setAccounts(prev => prev.map(a => a.id === targetAccountId ? { ...a, balance: newAccBal } : a));
        const { error: evtAccError } = await adjustAccountBalance(targetAccountId, isRefund ? amount : -amount);
        if (evtAccError) throw evtAccError;

        // 4. Record Bank Transaction
        const btxId = `btx_${txId}`;
        const btxType = isRefund ? 'Income' : 'Expense';
        const btxCategory = isRefund ? 'Vendor / Staff Refund' : 'Vendor / Staff Payment';
        const btxDesc = isRefund
          ? `Refund / Return from: ${vendor.name}${note ? ` (${note})` : ''}`
          : `Payment to: ${vendor.name}${note ? ` (${note})` : ''}`;

        const isDrawerAccount = Boolean(
          activeShiftSession?.status === 'Active' && (
            chosenAccount.id === activeShiftSession?.drawer_id ||
            chosenAccount.id === resolveDrawerAccountId(activeShiftSession?.drawer_id) ||
            chosenAccount.isDrawer === true ||
            chosenAccount.type === 'Cash' ||
            isCashMode
          )
        );
        const shiftSessionId = isDrawerAccount ? (activeShiftSession?.id || null) : null;
        const businessDayId = isDrawerAccount ? (activeShiftSession?.business_day_id || null) : null;
        const drawerId = isDrawerAccount ? (activeShiftSession?.drawer_id || targetAccountId) : null;
        const cashierId = activeShiftSession?.user_id || currentUser?.id || null;
        const normalizedDate = normalizeTransactionTimestamp(date);

        const { error: btxError } = await supabase.from('bank_transactions').insert([{
          id: btxId,
          account_id: targetAccountId,
          amount: amount,
          date: normalizedDate,
          type: btxType,
          category: btxCategory,
          description: btxDesc,
          reference_id: txId,
          business_day_id: businessDayId,
          shift_session_id: shiftSessionId,
          drawer_id: drawerId,
          cashier_id: cashierId
        }]);
        if (btxError) throw btxError;

        setBankTransactions(prev => [{
          id: btxId,
          account_id: targetAccountId,
          amount: amount,
          date: normalizedDate,
          type: btxType,
          category: btxCategory,
          description: btxDesc,
          reference_id: txId,
          business_day_id: businessDayId,
          shift_session_id: shiftSessionId,
          drawer_id: drawerId,
          cashier_id: cashierId
        } as BankTransaction, ...prev]);
      }

      // 5. Create ExpenseVendorTransaction Record
      const normalizedTxDate = normalizeTransactionTimestamp(date);
      const newTx: ExpenseVendorTransaction = {
        id: txId,
        vendor_id: vendorId,
        vendor_name: vendor.name,
        date: normalizedTxDate,
        type: isRefund ? 'Refund' : 'Payment',
        amount: amount,
        paid_amount: amount,
        balance_after: newPending,
        payment_mode: mode,
        account_id: targetAccountId,
        account_name: chosenAccount?.name || mode,
        reference_no: referenceNo || '',
        note: note || ''
      };

      setExpenseVendorTransactions(prev => [newTx, ...prev]);

      {
        // supabase-js resolves with an error object instead of throwing — an
        // unchecked insert here silently dropped the vendor's ledger row.
        const { error: evtInsertError } = await supabase.from('expense_vendor_transactions').insert([{
          id: txId,
          vendor_id: vendorId,
          date: newTx.date,
          type: isRefund ? 'Refund' : 'Payment',
          amount: amount,
          details: {
            payment_mode: mode,
            account_id: targetAccountId,
            account_name: chosenAccount?.name || mode,
            reference_no: referenceNo,
            note,
            balance_after: newPending
          }
        }]);
        if (evtInsertError) throw evtInsertError;
      }

      showToast(
        isRefund 
          ? `Refund of Rs ${amount.toLocaleString()} received from ${vendor.name} and added to ${chosenAccount?.name || 'Account'}!`
          : `Payment of Rs ${amount.toLocaleString()} recorded for ${vendor.name}!`,
        "success"
      );
      fetchData();
      return true;
    } catch (err: any) {
      console.error("recordExpenseVendorPayment error:", err);
      showToast(`Failed to record transaction: ${err?.message || 'Error'}`, "error");
      return false;
    }
  };

  const deleteExpenseVendorTransaction = async (id: string): Promise<boolean> => {
    try {
      const tx = expenseVendorTransactions.find(t => t.id === id);
      if (tx) {
        const vendor = expenseVendors.find(v => v.id === tx.vendor_id);
        const isRefund = tx.type === 'Refund';

        if (vendor) {
          const newPending = isRefund 
            ? (vendor.pending_balance || 0) - tx.amount
            : (vendor.pending_balance || 0) + tx.amount;
          const newPaid = isRefund
            ? (vendor.total_paid || 0) + tx.amount
            : Math.max(0, (vendor.total_paid || 0) - tx.amount);

          setExpenseVendors(prev => prev.map(v => v.id === tx.vendor_id ? {
            ...v,
            pending_balance: newPending,
            total_paid: newPaid
          } : v));

          const pendingDelta = isRefund ? -tx.amount : tx.amount;
          const paidDelta = isRefund ? tx.amount : -tx.amount;
          const { error: statsRevError } = await adjustExpenseVendorStats(tx.vendor_id, pendingDelta, 0, paidDelta);
          if (statsRevError) throw statsRevError;

          // Reverse money in financial account
          const accId = tx.account_id || (tx as any).details?.account_id;
          if (accId) {
            const acc = accounts.find(a => a.id === accId);
            if (acc) {
              const newAccBal = isRefund
                ? (acc.balance - tx.amount)
                : (acc.balance + tx.amount);
              setAccounts(prev => prev.map(a => a.id === accId ? { ...a, balance: newAccBal } : a));
              const { error: evtAccRevError } = await adjustAccountBalance(accId, isRefund ? -tx.amount : tx.amount);
              if (evtAccRevError) throw evtAccRevError;
            }
          }

          // Delete linked bank transaction
          const { error: btxDelError } = await supabase.from('bank_transactions').delete().eq('reference_id', id);
          if (btxDelError) console.warn('[deleteExpenseVendorTransaction] bank_transaction delete notice:', btxDelError);
          setBankTransactions(prev => prev.filter(b => b.reference_id !== id));

          // Delete linked shift cash event if any
          try {
            await supabase.from('shift_cash_events').delete().eq('source_id', id);
            setShiftCashEvents(prev => prev.filter(e => e.source_id !== id));
          } catch (sceDelErr) {
            console.warn('[deleteExpenseVendorTransaction] shift_cash_events delete notice:', sceDelErr);
          }
        }
      }

      setExpenseVendorTransactions(prev => prev.filter(t => t.id !== id));
      {
        const { error: evtDelError } = await supabase.from('expense_vendor_transactions').delete().eq('id', id);
        if (evtDelError) throw evtDelError;
      }

      showToast("Vendor transaction deleted and balance restored", "info");
      fetchData();
      return true;
    } catch (e) {
      console.error("deleteExpenseVendorTransaction error:", e);
      return false;
    }
  };
  
  const addAccount = async (a: any) => {
    try {
      const id = a.id || `acc_${generateUUID()}`;
      const { name, type, balance, isActive, ...extraDetails } = a;
      const dbAccount = {
        id,
        name,
        type,
        balance: balance || 0,
        is_active: isActive !== undefined ? isActive : true,
        details: extraDetails
      };
      setAccounts(prev => [{ id, name, type, balance: balance || 0, isActive: isActive !== undefined ? isActive : true, ...extraDetails } as FinancialAccount, ...prev]);
      if (type === 'Cash') {
        const drawerPayload = {
          id,
          name,
          code: (name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) || 'CASH').toUpperCase(),
          account_id: id,
          is_active: isActive !== undefined ? isActive : true,
          default_float: 0
        };
        setCashDrawers(prev => [drawerPayload as any, ...prev.filter(d => d.id !== id)]);
      }
      const { error } = await supabase.from('financial_accounts').insert([dbAccount]);
      if (error) {
        setAccounts(prev => prev.filter(acc => acc.id !== id));
        if (type === 'Cash') setCashDrawers(prev => prev.filter(d => d.id !== id));
        showToast("Failed to create account: " + error.message, 'error');
        return false;
      }

      // Automatically post Opening Balance ledger entry so account balance and transactions match 100%
      if (balance && Number(balance) !== 0) {
        const opTxId = `btx_op_${id}`;
        await supabase.from('bank_transactions').insert([{
          id: opTxId,
          account_id: id,
          date: new Date().toISOString(),
          amount: Math.abs(Number(balance)),
          type: Number(balance) > 0 ? 'Deposit' : 'Withdrawal',
          category: 'Opening Balance',
          description: `Opening Balance for ${name}`,
          reference_id: id
        }]);
      }
      fetchData();
      return true;
    } catch(e) { 
      console.error("addAccount error:", e);
      return false; 
    }
  };

  const updateAccount = async (id: string, updates: Partial<FinancialAccount>) => {
    try {
      const { name, type, balance, isActive, ...extraDetails } = updates;
      const dbUpdates: any = {};
      if (name !== undefined) dbUpdates.name = name;
      if (type !== undefined) dbUpdates.type = type;
      if (balance !== undefined) dbUpdates.balance = balance;
      if (isActive !== undefined) dbUpdates.is_active = isActive;

      if (Object.keys(extraDetails).length > 0) {
        const { data: existing } = await supabase.from('financial_accounts').select('details').eq('id', id).single();
        dbUpdates.details = { ...(existing?.details || {}), ...extraDetails };
      }

      setAccounts(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
      if (name !== undefined || isActive !== undefined) {
        setCashDrawers(prev => prev.map(d => (d.id === id || d.account_id === id) ? { ...d, name: name ?? d.name, is_active: isActive !== undefined ? isActive : d.is_active } : d));
      }
      const { error } = await supabase.from('financial_accounts').update(dbUpdates).eq('id', id);
      if (error) throw error;
      fetchData();
      return true;
    } catch (e) {
      console.error("updateAccount error:", e);
      return false;
    }
  };

  const deleteAccount = async (id: string) => {
    try {
      setAccounts(prev => prev.filter(a => a.id !== id));
      const { error } = await supabase.from('financial_accounts').delete().eq('id', id);
      if (error) throw error;
      fetchData();
      return true;
    } catch (e) {
      console.error("deleteAccount error:", e);
      return false;
    }
  };
  const recordBankTransaction = async (data: any) => {
      try {
          const taggedTransaction = {
            ...data,
            date: normalizeTransactionTimestamp(data.date),
            business_day_id: data.business_day_id || activeShiftSession?.business_day_id,
            shift_session_id: data.shift_session_id || activeShiftSession?.id,
            drawer_id: data.drawer_id || activeShiftSession?.drawer_id,
            cashier_id: data.cashier_id || activeShiftSession?.user_id,
            id: `btx_${generateUUID()}`
          };
          await supabase.from('bank_transactions').insert([taggedTransaction]);
          // Atomic delta — no client-side read-modify-write on the balance.
          const impact = data.type === 'Deposit' || data.type === 'Income' || data.type === 'Transfer_In' ? data.amount : -data.amount;
          await adjustAccountBalance(data.account_id, impact);
          fetchData();
          return true;
      } catch(e) { return false; }
  };
  const transferFunds = async (fromId: string, toId: string, amount: number, date: string, description: string) => {
      try {
          // Single atomic RPC: locks both rows, moves the money, writes both
          // bank_transactions in one transaction.
          const normalizedDate = normalizeTransactionTimestamp(date);
          const { error } = await transferBetweenAccounts(fromId, toId, amount, normalizedDate, description);
          if (error) throw error;
          fetchData();
          return true;
      } catch(e: any) { 
          showToast("Transfer failed: " + getErrorMessage(e), "error");
          return false; 
      }
  };
  const addManualAccount = async (a: any) => {
    try {
      const id = a.id || `ma_${generateUUID()}`;
      const { name, type, balance, ...extraDetails } = a;
      const dbAccount = {
        id,
        name,
        type,
        balance: balance || 0,
        details: extraDetails
      };
      setManualAccounts(prev => [...prev, { id, name, type, balance: balance || 0, ...extraDetails }]);
      const { error } = await supabase.from('manual_accounts').insert([dbAccount]);
      if (error) throw error;
      fetchData();
      return true;
    } catch(e) { 
      console.error(e);
      return false; 
    }
  };
  const deleteManualAccount = async (id: string) => { 
    try {
      setManualAccounts(prev => prev.filter(a => a.id !== id));
      await supabase.from('manual_accounts').delete().eq('id', id); 
      fetchData(); 
      return true; 
    } catch(e) {
      console.error(e);
      return false;
    }
  };
  const updateManualAccount = async (id: string, data: any) => {
    try {
      const { name, type, balance, ...extraDetails } = data;
      const dbUpdates: any = {};
      if (name !== undefined) dbUpdates.name = name;
      if (type !== undefined) dbUpdates.type = type;
      if (balance !== undefined) dbUpdates.balance = balance;
      if (Object.keys(extraDetails).length > 0) {
        const { data: existing } = await supabase.from('manual_accounts').select('details').eq('id', id).single();
        dbUpdates.details = { ...(existing?.details || {}), ...extraDetails };
      }
      await supabase.from('manual_accounts').update(dbUpdates).eq('id', id);
      fetchData();
      return true;
    } catch(e) { return false; }
  };
  const addJournalEntry = async (entry: any) => {
    try {
      const id = entry.id || `je_${generateUUID()}`;
      const { date, totalAmount, ...extraDetails } = entry;
      const dbEntry = {
        id,
        date,
        total_amount: totalAmount || 0,
        details: extraDetails
      };
      await supabase.from('journal_entries').insert([dbEntry]);
      fetchData();
      return true;
    } catch(e) { return false; }
  };

  // =========================================================================
  // --- QUICKBOOKS-STYLE SMART DELETION & FINANCIAL PROTECTION ENGINE ---
  // =========================================================================

  const getDeleteAssessment = (
    entityType: 'customer' | 'supplier' | 'item' | 'expense' | 'account' | 'vendor',
    id: string
  ): DeleteAssessment => {
    const blockingReasons: string[] = [];

    if (entityType === 'customer') {
      const cust = customers.find(c => c.id === id);
      const name = cust?.name || 'Customer';
      const bal = Number(cust?.balance || 0);
      const salesCount = sales.filter(s => s.customer_id === id).length;
      const supplyCount = dailySupplyEntries.filter(d => d.customer_id === id).length;
      const txCount = customerTransactions.filter(t => t.customer_id === id).length;
      const hasHistory = salesCount > 0 || supplyCount > 0 || txCount > 0;

      if (bal !== 0) {
        blockingReasons.push(`Customer has an open balance of Rs ${Math.abs(bal).toLocaleString()} (${bal > 0 ? 'Receivable Khata' : 'Advance Credit'}).`);
      }
      if (hasHistory) {
        blockingReasons.push(`Customer has ${salesCount} sales bills, ${supplyCount} deliveries, and ${txCount} khata transactions.`);
      }

      return {
        canHardDelete: !hasHistory && bal === 0,
        canDeactivate: true,
        hasHistory,
        balance: bal,
        stock: 0,
        isLocked: false,
        blockingReasons,
        entityName: name,
        details: { salesCount, supplyCount, txCount }
      };
    }

    if (entityType === 'supplier') {
      const supp = suppliers.find(s => s.id === id);
      const name = supp?.name || 'Supplier';
      const bal = Number(supp?.pending_balance || 0);
      const purCount = purchases.filter(p => p.supplier_id === id).length;
      const matCount = materialPurchases.filter(m => m.supplier_id === id).length;
      const txCount = supplierTransactions.filter(t => t.supplier_id === id).length;
      const hasHistory = purCount > 0 || matCount > 0 || txCount > 0;

      if (bal !== 0) {
        blockingReasons.push(`Supplier has a pending payable balance of Rs ${bal.toLocaleString()}.`);
      }
      if (hasHistory) {
        blockingReasons.push(`Supplier has ${purCount} milk intake records, ${matCount} material purchases, and ${txCount} payment transactions.`);
      }

      return {
        canHardDelete: !hasHistory && bal === 0,
        canDeactivate: true,
        hasHistory,
        balance: bal,
        stock: 0,
        isLocked: false,
        blockingReasons,
        entityName: name,
        details: { purCount, matCount, txCount }
      };
    }

    if (entityType === 'item') {
      const item = items.find(i => i.id === id);
      const name = item?.name || 'Product';
      const isSystem = item?.isSystem || ['item_buffalo_milk', 'item_cow_milk', 'item_mixed_milk'].includes(id) || ['Buffalo Milk', 'Cow Milk', 'Mixed Milk'].includes(name);
      const inv = inventory.find(i => i.item_id === id);
      const stock = Number(inv?.quantity || (item as any)?.stock || 0);
      const salesCount = sales.filter(s => s.items?.some(it => it.itemId === id)).length;
      const purCount = materialPurchases.filter(m => m.item_id === id).length;
      const logCount = inventoryLogs.filter(l => l.item_id === id).length;
      const recipesUsing = items.filter(other => other.id !== id && other.recipe?.some(r => r.item_id === id)).map(o => o.name);
      const hasHistory = salesCount > 0 || purCount > 0 || logCount > 0 || recipesUsing.length > 0;

      if (isSystem) {
        blockingReasons.push('System milk varieties cannot be permanently deleted. You can mark them Inactive to disable selling and purchasing.');
      }
      if (recipesUsing.length > 0) {
        blockingReasons.push(`Item is required as recipe ingredient for: ${recipesUsing.join(', ')}.`);
      }
      if (stock > 0) {
        blockingReasons.push(`Item has ${stock} ${item?.unit || 'units'} in current stock (Valuation: Rs ${(stock * (item?.cost_price || item?.selling_price || 0)).toLocaleString()}).`);
      }
      if (hasHistory && recipesUsing.length === 0) {
        blockingReasons.push(`Item has ${salesCount} sales bills and ${purCount} material purchases in history.`);
      }

      return {
        canHardDelete: !isSystem && !hasHistory && stock === 0 && recipesUsing.length === 0,
        canDeactivate: recipesUsing.length === 0,
        hasHistory,
        balance: 0,
        stock,
        isLocked: false,
        blockingReasons,
        entityName: name,
        details: { isSystem, recipesUsing, salesCount, purCount, stock }
      };
    }

    if (entityType === 'account') {
      const acc = accounts.find(a => a.id === id);
      const name = acc?.name || 'Account';
      const bal = Number(acc?.balance || 0);
      const isSystem = acc?.is_default || acc?.id === settings.financial?.defaultCashAccountId || acc?.id === settings.financial?.defaultDigitalAccountId;
      const txCount = bankTransactions.filter(t => t.account_id === id || t.related_account_id === id).length;
      const hasHistory = txCount > 0;

      if (isSystem) {
        blockingReasons.push('Default system financial account cannot be deleted or archived.');
      }
      if (bal !== 0) {
        blockingReasons.push(`Account currently has a balance of Rs ${bal.toLocaleString()}. You must transfer this balance to another account first.`);
      }
      if (hasHistory) {
        blockingReasons.push(`Account has ${txCount} historical bank and cash transactions.`);
      }

      return {
        canHardDelete: !isSystem && !hasHistory && bal === 0,
        canDeactivate: !isSystem && bal === 0,
        hasHistory,
        balance: bal,
        stock: 0,
        isLocked: false,
        blockingReasons,
        entityName: name,
        details: { isSystem, txCount }
      };
    }

    if (entityType === 'expense') {
      const exp = expenses.find(e => e.id === id);
      const desc = exp?.description || exp?.category || 'Expense';
      const amt = Number(exp?.amount || 0);
      const dayLocked = exp?.date ? isDayLocked(exp.date) : false;
      const shiftLocked = exp?.shift_session_id ? shiftSessions.some(s => s.id === exp.shift_session_id && (s.status === 'Closed' || s.status === 'Force Closed')) : false;
      const isLocked = dayLocked || shiftLocked;

      if (isLocked) {
        blockingReasons.push(`Closed Period Lock: This expense was posted during a closed shift/business day. Physical cash has already been reconciled.`);
      }

      return {
        canHardDelete: !isLocked,
        canDeactivate: false,
        hasHistory: true,
        balance: amt,
        stock: 0,
        isLocked,
        blockingReasons,
        entityName: desc,
        details: { dayLocked, shiftLocked }
      };
    }

    if (entityType === 'vendor') {
      const ven = expenseVendors.find(v => v.id === id);
      const name = ven?.name || 'Vendor';
      const bal = Number(ven?.pending_balance || 0);
      const expCount = expenses.filter(e => e.vendor_id === id).length;
      const txCount = expenseVendorTransactions.filter(t => t.vendor_id === id).length;
      const hasHistory = expCount > 0 || txCount > 0;

      if (bal !== 0) {
        blockingReasons.push(`Vendor has an unpaid balance of Rs ${bal.toLocaleString()}.`);
      }
      if (hasHistory) {
        blockingReasons.push(`Vendor has ${expCount} linked expense bills and ${txCount} transactions.`);
      }

      return {
        canHardDelete: !hasHistory && bal === 0,
        canDeactivate: true,
        hasHistory,
        balance: bal,
        stock: 0,
        isLocked: false,
        blockingReasons,
        entityName: name,
        details: { expCount, txCount }
      };
    }

    return {
      canHardDelete: false,
      canDeactivate: false,
      hasHistory: false,
      balance: 0,
      stock: 0,
      isLocked: false,
      blockingReasons: ['Unknown entity'],
      entityName: ''
    };
  };

  const safeDeleteCustomer = async (
    id: string,
    action: 'hard_delete' | 'deactivate' | 'write_off_bad_debt'
  ): Promise<boolean> => {
    try {
      const cust = customers.find(c => c.id === id);
      if (!cust) return false;

      if (action === 'write_off_bad_debt') {
        const bal = Number(cust.balance || 0);
        if (bal > 0) {
          // Customer owes money: Write off as Bad Debt Expense
          const txId = `ctx_wo_${generateUUID()}`;
          await supabase.from('customer_transactions').insert([{
            id: txId,
            customer_id: id,
            date: new Date().toISOString(),
            type: 'Payment',
            amount: bal,
            details: {
              mode: 'Bad Debt Write-Off',
              note: 'Khata balance written off as bad debt expense (Customer Archived)',
              is_write_off: true
            }
          }]);

          // Record write off expense to keep Balance Sheet in exact equilibrium
          await supabase.from('expenses').insert([{
            id: `exp_wo_${generateUUID()}`,
            date: new Date().toISOString().split('T')[0],
            category: 'Bad Debt & Write-off',
            description: `Bad debt write-off for customer: ${cust.name}`,
            amount: bal,
            paid_amount: 0,
            payment_mode: 'Adjustment',
            payment_status: 'Paid',
            details: { customer_id: id, write_off: true }
          }]);

          await adjustCustomerBalance(id, -bal);
        } else if (bal < 0) {
          // Unclaimed customer advance: Forfeit advance
          const absBal = Math.abs(bal);
          await supabase.from('customer_transactions').insert([{
            id: `ctx_wo_${generateUUID()}`,
            customer_id: id,
            date: new Date().toISOString(),
            type: 'Charge',
            amount: absBal,
            details: {
              mode: 'Advance Forfeited',
              note: 'Unclaimed customer advance forfeited upon archival',
              is_write_off: true
            }
          }]);
          await adjustCustomerBalance(id, absBal);
        }

        await updateCustomer(id, { isActive: false });
        showToast(`Customer "${cust.name}" balance written off and marked Inactive!`, 'success');
        fetchData();
        return true;
      }

      if (action === 'deactivate') {
        await updateCustomer(id, { isActive: false });
        showToast(`Customer "${cust.name}" marked Inactive (Archived). Ledger and balance sheet preserved.`, 'info');
        fetchData();
        return true;
      }

      if (action === 'hard_delete') {
        const assessment = getDeleteAssessment('customer', id);
        if (!assessment.canHardDelete) {
          showToast(`Cannot permanently delete: ${assessment.blockingReasons[0]} Use 'Make Inactive' instead.`, 'error');
          return false;
        }
        setCustomers(prev => prev.filter(c => c.id !== id));
        const { error } = await supabase.from('customers').delete().eq('id', id);
        if (error) {
          showToast("Failed to delete customer: " + error.message, 'error');
          fetchData();
          return false;
        }
        showToast("Customer permanently deleted successfully", 'success');
        fetchData();
        return true;
      }

      return false;
    } catch (e: any) {
      console.error("safeDeleteCustomer error:", e);
      showToast("Operation failed: " + getErrorMessage(e), 'error');
      return false;
    }
  };

  const safeDeleteSupplier = async (
    id: string,
    action: 'hard_delete' | 'deactivate' | 'settle_discount'
  ): Promise<boolean> => {
    try {
      const supp = suppliers.find(s => s.id === id);
      if (!supp) return false;

      if (action === 'settle_discount') {
        const bal = Number(supp.pending_balance || 0);
        if (bal > 0) {
          await supabase.from('supplier_transactions').insert([{
            id: `stx_wo_${generateUUID()}`,
            supplier_id: id,
            date: new Date().toISOString().split('T')[0],
            type: 'Payment',
            amount: bal,
            details: {
              mode: 'Supplier Waiver / Discount',
              note: 'Payable balance settled via discount waiver prior to vendor archival'
            }
          }]);
          await adjustSupplierBalance(id, -bal);
        }
        await updateSupplier(id, { isActive: false });
        showToast(`Supplier "${supp.name}" balance settled via waiver and marked Inactive!`, 'success');
        fetchData();
        return true;
      }

      if (action === 'deactivate') {
        await updateSupplier(id, { isActive: false });
        showToast(`Supplier "${supp.name}" marked Inactive (Archived). Historical records preserved.`, 'info');
        fetchData();
        return true;
      }

      if (action === 'hard_delete') {
        const assessment = getDeleteAssessment('supplier', id);
        if (!assessment.canHardDelete) {
          showToast(`Cannot permanently delete: ${assessment.blockingReasons[0]} Use 'Make Inactive' instead.`, 'error');
          return false;
        }
        setSuppliers(prev => prev.filter(s => s.id !== id));
        const { error } = await supabase.from('suppliers').delete().eq('id', id);
        if (error) {
          showToast("Failed to delete supplier: " + error.message, 'error');
          fetchData();
          return false;
        }
        showToast("Supplier permanently deleted successfully", 'success');
        fetchData();
        return true;
      }

      return false;
    } catch (e: any) {
      console.error("safeDeleteSupplier error:", e);
      showToast("Operation failed: " + getErrorMessage(e), 'error');
      return false;
    }
  };

  const safeDeleteItem = async (
    id: string,
    action: 'hard_delete' | 'deactivate' | 'write_off_spoilage'
  ): Promise<boolean> => {
    try {
      const item = items.find(i => i.id === id);
      if (!item) return false;

      if (action === 'write_off_spoilage') {
        const inv = inventory.find(i => i.item_id === id);
        const stock = Number(inv?.quantity || (item as any)?.stock || 0);
        if (stock > 0) {
          await adjustItemStock(id, -stock);
          await supabase.from('inventory_logs').insert([{
            id: `log_sp_${generateUUID()}`,
            date: new Date().toISOString(),
            item_id: id,
            item_name: item.name,
            old_quantity: stock,
            new_quantity: 0,
            difference: -stock,
            reason: AdjustmentReason.SPOILAGE,
            notes: `Stock written off to spoilage prior to item discontinuation`
          }]);
          setInventory(prev => prev.map(iv => iv.item_id === id ? { ...iv, quantity: 0 } : iv));
        }
        await updateItem(id, { isActive: false });
        showToast(`Stock written off to spoilage and "${item.name}" marked Inactive (Discontinued)!`, 'success');
        fetchData();
        return true;
      }

      if (action === 'deactivate') {
        await updateItem(id, { isActive: false });
        showToast(`Item "${item.name}" marked Inactive (Discontinued). Past sales bills preserved.`, 'info');
        fetchData();
        return true;
      }

      if (action === 'hard_delete') {
        const assessment = getDeleteAssessment('item', id);
        if (!assessment.canHardDelete) {
          showToast(`Cannot permanently delete: ${assessment.blockingReasons[0]}`, 'error');
          return false;
        }
        setItems(prev => prev.filter(i => i.id !== id));
        setInventory(prev => prev.filter(iv => iv.item_id !== id));
        const { error } = await supabase.from('items').delete().eq('id', id);
        if (error) {
          showToast("Failed to delete item: " + error.message, 'error');
          fetchData();
          return false;
        }
        showToast("Item permanently deleted successfully", 'success');
        fetchData();
        return true;
      }

      return false;
    } catch (e: any) {
      console.error("safeDeleteItem error:", e);
      showToast("Operation failed: " + getErrorMessage(e), 'error');
      return false;
    }
  };

  const safeDeleteExpense = async (id: string): Promise<boolean> => {
    const assessment = getDeleteAssessment('expense', id);
    if (assessment.isLocked) {
      showToast('Closed Period Lock: This expense belongs to a closed shift or locked day. Physical drawer cash was already reconciled. Please post an Expense Reversal entry.', 'error');
      return false;
    }
    return deleteExpense(id);
  };

  const safeDeleteAccount = async (
    id: string,
    action: 'hard_delete' | 'deactivate'
  ): Promise<boolean> => {
    try {
      const acc = accounts.find(a => a.id === id);
      if (!acc) return false;

      if (action === 'deactivate') {
        if (Number(acc.balance || 0) !== 0) {
          showToast(`Cannot archive account with non-zero balance (Rs ${acc.balance}). Transfer funds out first.`, 'error');
          return false;
        }
        await updateAccount(id, { isActive: false });
        showToast(`Account "${acc.name}" marked Inactive. Past statements preserved.`, 'info');
        fetchData();
        return true;
      }

      if (action === 'hard_delete') {
        const assessment = getDeleteAssessment('account', id);
        if (!assessment.canHardDelete) {
          showToast(`Cannot delete: ${assessment.blockingReasons[0]}`, 'error');
          return false;
        }
        setAccounts(prev => prev.filter(a => a.id !== id));
        const { error } = await supabase.from('financial_accounts').delete().eq('id', id);
        if (error) {
          showToast("Failed to delete account: " + error.message, 'error');
          fetchData();
          return false;
        }
        showToast("Account permanently deleted", 'success');
        fetchData();
        return true;
      }

      return false;
    } catch (e: any) {
      console.error("safeDeleteAccount error:", e);
      showToast("Operation failed: " + getErrorMessage(e), 'error');
      return false;
    }
  };

  const reactivateEntity = async (
    entityType: 'customer' | 'supplier' | 'item' | 'account' | 'vendor',
    id: string
  ): Promise<boolean> => {
    try {
      if (entityType === 'customer') {
        await updateCustomer(id, { isActive: true });
        showToast("Customer reactivated successfully!", 'success');
      } else if (entityType === 'supplier') {
        await updateSupplier(id, { isActive: true });
        showToast("Supplier reactivated successfully!", 'success');
      } else if (entityType === 'item') {
        await updateItem(id, { isActive: true });
        showToast("Item reactivated successfully!", 'success');
      } else if (entityType === 'account') {
        await updateAccount(id, { isActive: true });
        showToast("Account reactivated successfully!", 'success');
      } else if (entityType === 'vendor') {
        await updateExpenseVendor(id, { isActive: true });
        showToast("Vendor reactivated successfully!", 'success');
      }
      fetchData();
      return true;
    } catch (e: any) {
      console.error("reactivateEntity error:", e);
      showToast("Reactivation failed: " + getErrorMessage(e), 'error');
      return false;
    }
  };
  
  const updateSettings = async (newSettings: Partial<SystemSettings>) => { 
    try {
      const mergedSettings = {
        general: { ...settings.general, ...(newSettings.general || {}) },
        financial: { ...settings.financial, ...(newSettings.financial || {}) },
        sales: { ...settings.sales, ...(newSettings.sales || {}) },
        inventory: { ...settings.inventory, ...(newSettings.inventory || {}) },
        expenses: { ...(settings.expenses || {}), ...(newSettings.expenses || {}) }
      };

      setSettings(mergedSettings);

      const { error } = await supabase
        .from('app_settings')
        .update(mergedSettings)
        .eq('id', 'global_settings');

      if (error) throw error;
    } catch (err) {
      console.error("Failed to save settings:", err);
      showToast("Failed to save settings", "error");
    }
  };
  
  const resetSystem = async () => {
    try {
      showToast("Resetting system, please wait...", "info");
      const sentinel = '00000000-0000-0000-0000-000000000000';

      // 1. Delete cash control activity (leaf nodes first to preserve integrity)
      await Promise.all([
        supabase.from('shift_cash_events').delete().neq('id', sentinel),
        supabase.from('cash_variances').delete().neq('id', sentinel),
        supabase.from('cash_remittances').delete().neq('id', sentinel),
        supabase.from('drawer_handovers').delete().neq('id', sentinel),
        supabase.from('day_closings').delete().neq('id', sentinel),
      ]);
      await supabase.from('cash_shifts').delete().neq('id', sentinel);
      await supabase.from('business_days').delete().neq('id', sentinel);

      // 2. Delete all transaction/activity tables
      const txResults = await Promise.all([
        supabase.from('allocations').delete().neq('id', sentinel),
        supabase.from('inventory_logs').delete().neq('id', sentinel),
        supabase.from('journal_entries').delete().neq('id', sentinel),
        supabase.from('bank_transactions').delete().neq('id', sentinel),
        supabase.from('employee_transactions').delete().neq('id', sentinel),
        supabase.from('attendance').delete().neq('id', sentinel),
        supabase.from('retail_closings').delete().neq('id', sentinel),
        supabase.from('daily_supply').delete().neq('id', sentinel),
        supabase.from('customer_transactions').delete().neq('id', sentinel),
        supabase.from('supplier_transactions').delete().neq('id', sentinel),
        supabase.from('purchases').delete().neq('id', sentinel),
        supabase.from('material_purchases').delete().neq('id', sentinel),
        supabase.from('sales').delete().neq('id', sentinel),
        supabase.from('production_batches').delete().neq('id', sentinel),
        supabase.from('expenses').delete().neq('id', sentinel),
        supabase.from('recurring_expenses').delete().neq('id', sentinel),
        supabase.from('expense_vendor_transactions').delete().neq('id', sentinel),
      ]);

      // 3. Delete master records (KEEP locked system items & standard COA accounts, reset their balance/stock to 0)
      const masterResults = await Promise.all([
        supabase.from('suppliers').delete().neq('id', sentinel),
        supabase.from('customers').delete().neq('id', sentinel),
        supabase.from('items').delete().neq('is_system', true),
        supabase.from('items').update({ stock: 0, variant_stocks: {} }).eq('is_system', true),
        supabase.from('employees').delete().neq('id', sentinel),
        supabase.from('expense_vendors').delete().neq('id', sentinel),
        supabase.from('manual_accounts').delete().neq('id', sentinel).filter('id', 'not.in', '("ma_owner_capital","ma_owner_drawings","ma_bank_loan","ma_director_loan","ma_machinery_equipment","ma_furniture_fixtures","ma_other_income")'),
        supabase.from('manual_accounts').update({ balance: 0 }).neq('id', sentinel),
        supabase.from('financial_accounts').update({ balance: 0 }).neq('id', sentinel),
      ]);

      // Check failures
      const failures = [...txResults, ...masterResults].filter(r => r.error);
      if (failures.length > 0) {
        console.error("System reset partial failures:", failures.map(f => f.error));
        showToast(`Factory Reset failed: ${failures[0].error?.message || 'Database error'}`, "error");
        await fetchData();
        return;
      }

      // 4. Clear offline stores (Dexie)
      try {
        await db.transaction('rw', [db.orders, db.order_items, db.customers, db.catalog_cache], async () => {
          await Promise.all([
            db.orders.clear(),
            db.order_items.clear(),
            db.customers.clear(),
            db.catalog_cache.clear()
          ]);
        });
      } catch (dexieErr) {
        console.error("Failed to clear offline store during reset:", dexieErr);
      }

      // 5. Clear localStorage keys
      if (typeof window !== 'undefined') {
        localStorage.removeItem('mooco_shift_sessions');
        localStorage.removeItem('mooco_day_closings');
        localStorage.removeItem('mooco_active_shift_session');
        localStorage.removeItem('mooco_active_business_day');
        localStorage.removeItem('mooco_cashier_shift_state');
      }

      // 6. Reset in-memory states
      setShiftSessions([]);
      setDayClosings([]);
      setActiveShiftSession(null);
      setBusinessDays([]);
      setCashHandovers([]);
      setCashRemittances([]);
      setCashVariances([]);
      setShiftCashEvents([]);

      showToast("Factory Reset completed successfully! All data cleared (locked items preserved).", "success");
      await fetchData();
    } catch (err) {
      console.error("System reset failed:", err);
      showToast(`Factory Reset failed: ${(err as any)?.message || 'Unknown error'}`, "error");
    }
  };

  const clearData = async (moduleOrModules: string | string[]) => {
    const modules = Array.isArray(moduleOrModules) ? moduleOrModules : [moduleOrModules];
    if (modules.length === 0) return;

    try {
      showToast(`Clearing ${modules.length > 1 ? `${modules.length} selected modules` : modules[0]}...`, "info");
      
      for (const module of modules) {
        if (module === 'transactions') {
          // Clear all transaction tables but keep master records
          await Promise.all([
            supabase.from('shift_cash_events').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('cash_variances').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('cash_remittances').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('drawer_handovers').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('day_closings').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('allocations').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('inventory_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('journal_entries').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('bank_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('employee_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('attendance').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('retail_closings').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('daily_supply').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('customer_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('supplier_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('purchases').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('material_purchases').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('sales').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('production_batches').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('expenses').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('recurring_expenses').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('expense_vendor_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
          ]);
          await supabase.from('cash_shifts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('business_days').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          // Reset balances and stock to 0
          await Promise.all([
            supabase.from('suppliers').update({ balance: 0, pending_balance: 0 }).neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('customers').update({ balance: 0 }).neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('items').update({ stock: 0, variant_stocks: {} }).neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('employees').update({ balance: 0 }).neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('expense_vendors').update({ balance: 0, total_paid: 0 }).neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('inventory').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('financial_accounts').update({ balance: 0 }).neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('manual_accounts').update({ balance: 0 }).neq('id', '00000000-0000-0000-0000-000000000000'),
          ]);
          try {
            await db.orders.clear();
            await db.order_items.clear();
            await db.customers.clear();
          } catch (e) {
            console.warn('[Dexie cleanup]', e);
          }
        } else if (module === 'stock' || module === 'inventory') {
          // Reset all physical stock & counter inventory to 0
          await supabase.from('items').update({ stock: 0, variant_stocks: {} }).neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('inventory_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('allocations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('retail_closings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('inventory').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        } else if (module === 'purchases') {
          await supabase.from('allocations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('purchases').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('material_purchases').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        } else if (module === 'sales') {
          await supabase.from('sales').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('daily_supply').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          try {
            await db.orders.clear();
            await db.order_items.clear();
          } catch (e) {
            console.warn('[Dexie sales cleanup]', e);
          }
        } else if (module === 'production') {
          await supabase.from('production_batches').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        } else if (module === 'supplier_ledger') {
          // Reset only supplier financial balances and ledger history, keep profiles
          await supabase.from('supplier_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('purchases').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('material_purchases').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('allocations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('suppliers').update({ balance: 0, pending_balance: 0 }).neq('id', '00000000-0000-0000-0000-000000000000');
        } else if (module === 'customer_ledger') {
          // Reset only customer credit balances and ledger history, keep profiles
          await supabase.from('customer_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('sales').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('daily_supply').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('customers').update({ balance: 0 }).neq('id', '00000000-0000-0000-0000-000000000000');
          try {
            await db.orders.clear();
            await db.order_items.clear();
          } catch (e) {
            console.warn('[Dexie sales cleanup]', e);
          }
        } else if (module === 'suppliers') {
          await supabase.from('supplier_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('allocations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('purchases').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('material_purchases').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('suppliers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        } else if (module === 'customers') {
          await supabase.from('customer_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('sales').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('daily_supply').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('customers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          try {
            await db.customers.clear();
          } catch (e) {
            console.warn('[Dexie customers cleanup]', e);
          }
        } else if (module === 'items') {
          await supabase.from('inventory_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('items').delete().neq('is_system', true);
        } else if (module === 'expenses') {
          await supabase.from('expenses').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('recurring_expenses').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('expense_vendor_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('expense_vendors').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        } else if (module === 'bank_cash') {
          await supabase.from('bank_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('financial_accounts').update({ balance: 0 }).neq('id', '00000000-0000-0000-0000-000000000000');
        } else if (module === 'accounts_journal') {
          await supabase.from('journal_entries').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabase.from('manual_accounts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        } else if (module === 'retail_closings') {
          await supabase.from('retail_closings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        } else {
          await supabase.from(module).delete().neq('id', '00000000-0000-0000-0000-000000000000');
        }
      }
      
      showToast(`Selected data reset successfully!`, "success");
      await fetchData();
    } catch (err) {
      console.error(`Failed to clear data:`, err);
      showToast(`Failed to clear data: ${(err as any)?.message || 'Unknown error'}`, "error");
    }
  };
  // --- RBAC / User Management & Permissions Engine ---

  const currentRole = useMemo(() => {
    if (!currentUser) return roles.find(r => r.id === 'role_super_admin') || DEFAULT_SYSTEM_ROLES[0];
    return roles.find(r => r.id === currentUser.role_id) || null;
  }, [roles, currentUser]);

  const hasPermission = (moduleKey: PermissionModule | string): boolean => {
    if (!currentUser) return false;
    if (currentUser.role_id === 'role_super_admin') return true;
    // Per-user extra accesses (granted on the user, merged over the role).
    const userPerms = (currentUser.permissions || []) as string[];
    if (userPerms.includes(moduleKey as string)) return true;
    if (userPerms.some(p => typeof p === 'string' && p.startsWith(`${moduleKey}:`))) return true;
    if (moduleKey === 'cash_control' && userPerms.includes('retail_stock')) return true;
    if (!currentRole) return false;
    const perms = currentRole.permissions || [];
    if (perms.includes(moduleKey as any)) return true;
    if (moduleKey === 'cash_control' && perms.includes('retail_stock')) return true;
    return perms.some(p => typeof p === 'string' && (p === moduleKey || p.startsWith(`${moduleKey}:`)));
  };

  const canPerform = (moduleKey: string, action: string = 'view'): boolean => {
    if (!currentUser) return false;
    if (currentUser.role_id === 'role_super_admin') return true;
    // Per-user extra accesses take priority, then the role's permissions.
    const userPerms = (currentUser.permissions || []) as string[];
    if (userPerms.includes(moduleKey)) return true;
    if (userPerms.includes(`${moduleKey}:${action}`)) return true;
    if (action === 'view' && userPerms.some(p => typeof p === 'string' && p.startsWith(`${moduleKey}:`))) return true;
    if (moduleKey === 'cash_control' && userPerms.includes('retail_stock')) return action === 'view';
    if (!currentRole) return false;
    const perms = currentRole.permissions || [];
    if (moduleKey === 'cash_control' && perms.includes('retail_stock')) return action === 'view';
    // 1. Full module permission grants all actions
    if (perms.includes(moduleKey as any)) return true;
    // 2. Exact action match e.g. 'customers:edit'
    const actionKey = `${moduleKey}:${action}`;
    if (perms.includes(actionKey as any)) return true;
    // 3. View action is permitted if user has any action in that module
    if (action === 'view' && perms.some(p => typeof p === 'string' && p.startsWith(`${moduleKey}:`))) {
      return true;
    }
    return false;
  };

  // A user row as returned by the secure auth RPCs (no PIN / hash fields).
  const mapRpcUser = (u: any): AppUser => ({
    id: u.id,
    name: u.name,
    username: u.username,
    role_id: u.role_id,
    phone: u.phone,
    is_active: u.is_active !== false,
    permissions: Array.isArray(u.permissions) ? u.permissions.map(String) : [],
    avatar: u.avatar,
    last_login: u.last_login,
    created_at: u.created_at
  });

  const applyLogin = (matchedUser: AppUser) => {
    setUsers(prev => prev.some(u => u.id === matchedUser.id)
      ? prev.map(u => (u.id === matchedUser.id ? matchedUser : u))
      : [...prev, matchedUser]);
    setCurrentUser(matchedUser);
    if (typeof window !== 'undefined') {
      localStorage.setItem('mooco_active_user_id', matchedUser.id);
      localStorage.setItem('mooco_active_user_data', JSON.stringify(matchedUser));
    }
  };

  // PIN verification happens entirely inside the Postgres RPC (hashed, salted,
  // rate-limited). Plaintext PINs are never stored or compared client-side.
  const loginWithCredentials = async (username: string, pin: string): Promise<{ success: boolean; message?: string; user?: AppUser }> => {
    const cleanUser = username.trim().toLowerCase();
    const cleanPin = pin.trim();
    if (!cleanUser) {
      return { success: false, message: 'Enter the username' };
    }
    if (!cleanPin) {
      return { success: false, message: 'Enter the password / PIN code' };
    }

    const { data, error } = await supabase.rpc('app_login', { p_username: cleanUser, p_pin: cleanPin });
    if (error || !data) {
      return { success: false, message: error?.message || 'Ghalat Username ya PIN code!' };
    }

    const matchedUser = mapRpcUser(data);
    applyLogin(matchedUser);
    return { success: true, user: matchedUser };
  };

  const switchUserWithPin = async (pin: string): Promise<{ success: boolean; message?: string; user?: AppUser }> => {
    const cleanPin = pin.trim();
    if (!cleanPin) {
      return { success: false, message: 'Invalid 4-Digit PIN Code!' };
    }

    const { data, error } = await supabase.rpc('app_login_with_pin', { p_pin: cleanPin });
    if (error || !data) {
      return { success: false, message: error?.message || 'Invalid 4-Digit PIN Code!' };
    }

    const matchedUser = mapRpcUser(data);
    applyLogin(matchedUser);
    return { success: true, user: matchedUser };
  };

  const switchUserByIdAndPin = async (userId: string, pin: string): Promise<{ success: boolean; message?: string; user?: AppUser }> => {
    if (!pin.trim()) {
      return { success: false, message: 'Incorrect PIN Code' };
    }

    const { data, error } = await supabase.rpc('app_verify_pin', { p_user_id: userId, p_pin: pin.trim() });
    if (error || !data) {
      return { success: false, message: error?.message || 'Incorrect PIN Code' };
    }

    const targetUser = mapRpcUser(data);
    applyLogin(targetUser);
    return { success: true, user: targetUser };
  };

  const setCurrentUserDirectly = (user: AppUser) => {
    setCurrentUser(user);
    if (typeof window !== 'undefined') {
      localStorage.setItem('mooco_active_user_id', user.id);
      localStorage.setItem('mooco_active_user_data', JSON.stringify(user));
    }
  };

  const logoutUser = () => {
    setCurrentUser(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('mooco_active_user_id');
      localStorage.removeItem('mooco_active_user_data');
    }
    setIsUserSwitcherOpen(true);
  };

  const addUser = async (userData: Omit<AppUser, 'id'>): Promise<boolean> => {
    try {
      const pin = (userData.pin || '').trim();
      if (!/^\d{4,10}$/.test(pin)) {
        showToast('Enter a PIN of 4 to 10 digits.', 'error');
        return false;
      }

      const { data, error } = await supabase.rpc('app_create_user', {
        p_name: userData.name,
        p_username: userData.username,
        p_pin: pin,
        p_role_id: userData.role_id,
        p_phone: userData.phone || null,
        p_avatar: userData.avatar || null,
        p_permissions: userData.permissions?.length ? userData.permissions : []
      });
      if (error) throw error;

      const newUser = mapRpcUser(data);
      setUsers(prev => [...prev, newUser]);
      showToast(`User "${newUser.name}" added successfully!`, "success");
      return true;
    } catch (e: any) {
      console.error('Error adding user:', e);
      showToast(`Error creating user: ${e?.message || 'Failed'}`, "error");
      return false;
    }
  };

  const updateUser = async (id: string, updates: Partial<AppUser>): Promise<boolean> => {
    try {
      const payload: Record<string, any> = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.username !== undefined) payload.username = updates.username;
      if (updates.role_id !== undefined) payload.role_id = updates.role_id;
      if (updates.phone !== undefined) payload.phone = updates.phone;
      if (updates.avatar !== undefined) payload.avatar = updates.avatar;
      if (updates.is_active !== undefined) payload.is_active = updates.is_active;
      if (updates.permissions !== undefined) payload.permissions = updates.permissions;
      // Empty PIN = keep the existing credential (hash lives server-side only).
      const cleanPin = (updates.pin || '').trim();
      if (cleanPin) {
        if (!/^\d{4,10}$/.test(cleanPin)) {
          showToast('PIN 4 se 10 digits ka hona chahiye.', 'error');
          return false;
        }
        payload.pin = cleanPin;
      }

      const { data, error } = await supabase.rpc('app_update_user', { p_user_id: id, p_updates: payload });
      if (error) throw error;

      const updated = mapRpcUser(data);
      setUsers(prev => prev.map(u => (u.id === id ? { ...u, ...updated } : u)));
      if (currentUser?.id === id) {
        setCurrentUser(prev => (prev ? { ...prev, ...updated } : null));
      }
      showToast("User updated successfully", "success");
      return true;
    } catch (e: any) {
      console.error('Error updating user:', e);
      showToast(`Error updating user: ${e?.message || 'Failed'}`, "error");
      return false;
    }
  };

  const deleteUser = async (id: string): Promise<boolean> => {
    try {
      const { error } = await supabase.rpc('app_delete_user', { p_user_id: id });
      if (error) throw error;

      setUsers(prev => prev.filter(u => u.id !== id));
      if (currentUser?.id === id) {
        // No auto-login fallback: lock the terminal instead.
        setCurrentUser(null);
        if (typeof window !== 'undefined') localStorage.removeItem('mooco_active_user_id');
        setIsUserSwitcherOpen(true);
      }
      showToast("User deleted successfully", "info");
      return true;
    } catch (e: any) {
      console.error('Error deleting user:', e);
      showToast(`Error deleting user: ${e?.message || 'Failed'}`, "error");
      return false;
    }
  };

  const createRole = async (roleData: Omit<AppRole, 'id'>): Promise<boolean> => {
    try {
      const id = `role_${generateUUID()}`;
      const newRole: AppRole = {
        ...roleData,
        id,
        is_system: false,
        created_at: new Date().toISOString()
      };

      const { error } = await supabase.from('app_roles').insert([newRole]);
      if (error) throw error;

      setRoles(prev => [...prev, newRole]);
      showToast(`Role "${newRole.name}" created successfully!`, "success");
      return true;
    } catch (e: any) {
      console.error('Error creating role:', e);
      showToast(`Error creating role: ${e?.message || 'Failed'}`, "error");
      return false;
    }
  };

  const updateRole = async (id: string, updates: Partial<AppRole>): Promise<boolean> => {
    try {
      const { error } = await supabase.from('app_roles').update(updates).eq('id', id);
      if (error) throw error;

      setRoles(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
      showToast("Role updated successfully", "success");
      return true;
    } catch (e: any) {
      console.error('Error updating role:', e);
      showToast(`Error updating role: ${e?.message || 'Failed'}`, "error");
      return false;
    }
  };

  const deleteRole = async (id: string): Promise<boolean> => {
    try {
      const targetRole = roles.find(r => r.id === id);
      if (targetRole?.is_system) {
        showToast("System Built-in role cannot be deleted", "error");
        return false;
      }
      const hasAssignedUsers = users.some(u => u.role_id === id);
      if (hasAssignedUsers) {
        showToast("This role is currently assigned to users. Reassign them first.", "warning");
        return false;
      }

      const { error } = await supabase.from('app_roles').delete().eq('id', id);
      if (error) throw error;

      setRoles(prev => prev.filter(r => r.id !== id));
      showToast("Role deleted successfully", "info");
      return true;
    } catch (e: any) {
      console.error('Error deleting role:', e);
      showToast(`Error deleting role: ${e?.message || 'Failed'}`, "error");
      return false;
    }
  };

  const addCategory = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (categories.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
      showToast(`Category "${trimmed}" already exists`, "warning");
      return;
    }
    setCategories(prev => [...prev, trimmed]);
    showToast(`Category "${trimmed}" added`, "success");
  };

  const removeCategory = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCategories(prev => prev.filter(c => c.toLowerCase() !== trimmed.toLowerCase()));
    showToast(`Category "${trimmed}" removed`, "info");
  };

  return (
    <DairyContext.Provider value={{
      users, roles, currentUser, currentRole, isUserSwitcherOpen, setIsUserSwitcherOpen, isBooting, sessionError, isDataLoading, hasLoadedData, dataLoadError, retryLoading,
      loginWithCredentials, switchUserWithPin, switchUserByIdAndPin, setCurrentUserDirectly, logoutUser,
      addUser, updateUser, deleteUser, createRole, updateRole, deleteRole, hasPermission, canPerform,
      purchases, materialPurchases, suppliers, allocations, inventory, items, sales, customers, 
      productionBatches, expenses, recurringExpenses, expenseVendors, expenseVendorTransactions,
      accounts, bankTransactions, manualAccounts, journalEntries, settings, 
      categories, unitGroups, retailClosings, shiftSessions, dayClosings, activeShiftSession,
      businessDays, cashDrawers, cashHandovers, cashRemittances, cashVariances, shiftCashEvents, cashInTransit,
      refreshCashControl, getShiftTotals, startCashierShift, closeCashierShift, acceptHeadRemittance, resolveCashVariance,
      resolveCashHandover, closeBusinessDay, reopenBusinessDay, upsertCashDrawer, getBusinessDate, submitDayCloseStockCount, addDrawerOpeningCash, closeDayCash, closeDayStock,
      inventoryLogs, customerTransactions, supplierTransactions, dailySupplyEntries,
      openShiftSession, closeShiftSession, performDayClosing, reopenDayClosing, isDayLocked,
      addPurchase, returnPurchase, deletePurchase, returnMaterialPurchase, deleteMaterialPurchase, addBulkMaterialPurchase, recordSupplierPayment,
      addSupplier, updateSupplier, deleteSupplier, deleteSupplierTransaction,
      allocateBulkMilk, allocateFromRetailStock, setAllocations,
      addItem, updateItem, deleteItem, reorderItems, adjustStock, setInventory,
      setProductionBatches, createBatch, updateBatchStage, cancelBatch,
      addSale, processSalesReturn, updateSalePaymentMode, recordDailySupply, processCreditSaleTransaction, performRetailClosing, postClosingStockSale,
      addCustomer, updateCustomer, deleteCustomer, recordCustomerPayment, deleteCustomerTransaction,
      addExpense, deleteExpense, addRecurringExpense, deleteRecurringExpense, generateRecurringExpense, 
      addExpenseVendor, updateExpenseVendor, deleteExpenseVendor, recordExpenseVendorPayment, deleteExpenseVendorTransaction,
      addAccount, updateAccount, deleteAccount, recordBankTransaction, transferFunds, addManualAccount, deleteManualAccount, updateManualAccount, addJournalEntry,
      updateSettings, resetSystem, clearData, addCategory, removeCategory,
      addUnit, updateUnit, deleteUnit,
      // QuickBooks-Style Smart Deletion & Financial Protection
      getDeleteAssessment, safeDeleteCustomer, safeDeleteSupplier, safeDeleteItem,
      safeDeleteExpense, safeDeleteAccount, reactivateEntity
    }}>
      {children}
    </DairyContext.Provider>
  );
};

export const useDairy = () => {
  const context = useContext(DairyContext);
  if (context === undefined) {
    throw new Error('useDairy must be used within a DairyProvider');
  }
  return context;
};
