/**
 * DairyContext: the workspace's records and every action that changes them.
 *
 * Reading it (for page code)
 * - `useDairy()` keeps its old shape, but a component now re-renders only when a field it read
 *   changes. Reads are tracked per component (destructuring at the top is the usual way), so a
 *   page that reads `items` does not re-render when a bill syncs or the bank history arrives.
 *   Fields read only inside handlers or effects still return current values.
 * - Actions (`addSale`, `recordCustomerPayment`, ...) keep one identity for the session and always
 *   run with current state, so they are safe in effect deps and memoized children.
 * - Read helpers: `hasPermission` / `canPerform` change only with the operator or role,
 *   `isPeriodLocked` / `isDayLocked` with the lock date and business days; `getBusinessDate` never
 *   changes. `getShiftTotals`, `getDeleteAssessment` and `buildBackup` change with any record.
 * - `useDairySelector(d => d.sales.length)` subscribes to a derived value only; pass an `isEqual`
 *   (e.g. shallow) when the selector builds a new object or array.
 * - Hidden kept-alive pages sit inside `DairyFreeze` and stay on the records they last showed
 *   until they are opened again (an operator change always reaches them).
 *
 * Loading (inside this file)
 * - `fetchData()` reads every table; `fetchData(['items'])` only the listed ones (see LoadKey).
 *   A write reloads just what it changed; optimistic updates cover the rest.
 */
import React, { createContext, useCallback, useContext, useLayoutEffect, useState, useEffect, useMemo, useRef, useSyncExternalStore, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { db, generateUUID, generateInvoiceNumber, LocalOrder, LocalOrderItem, LocalCustomer, OutboxActionType, roundCurrency, roundQuantity } from '../lib/db';
import { actionLock } from '../lib/actionLock';
import { loadRead, withDeadline } from '../lib/loadRequest';
import { saleItemSnapshot } from '../lib/saleSnapshot';
import { averageCostAfterIntake, saleLineStock, stockOnHandBase } from '../lib/sellUnits';
import { syncService } from '../lib/syncService';
import { getOperatorSession, hasStoredOperatorSession, operatorSignIn, operatorSignOut, sessionOperatorId, type OperatorLoginRequest } from '../lib/operatorAuth';
import { isPermanentSyncError } from '../lib/syncErrors';
import { moneyRpcMessage, requestIdFor, settleRequest } from '../lib/moneyRpc';
import { currentEpoch, emptyBases, mapCatalogCache, noteLocalWrite, projectLedger, readUnsyncedWork, toCustomer, toPosBill } from '../lib/unsyncedProjection';
import {
  adjustAccountBalance, adjustSupplierBalance,
  adjustItemStock, adjustExpenseVendorStats, transferBetweenAccounts,
  procureMilkIntake, recordSupplierPaymentEffects, recordExpenseEffects
} from '../lib/atomic';
import { useToast } from './ToastContext';
import { normalizeTransactionTimestamp, getTodayLocalDate } from '../lib/formatters';
import { netPurchaseReturnRefunds, proportionalRefund, salePaidAmount, splitRefund } from '../lib/moneyFlow';
import { buildStandardUnitGroups, convertQuantity, getAllAvailableUnits } from '../lib/unitConversion';
import { 
  PriorityLevel, MilkType, StockType, AllocationStatus, ProductionStage, DestinationType,
  AdjustmentReason, SystemSettings, PurchaseEntry, MaterialPurchaseEntry, Supplier, InventoryItem,
  AllocationEntry, ProductionBatch, POSBill, Customer, DailySupplyEntry, RetailClosingEntry,
  CustomerTransaction, SupplierTransaction, UnitDefinition, UnitGroup, ItemVariant,
  ItemDefinition, ExpenseEntry, RecurringExpense, ExpenseVendor, ExpenseVendorTransaction,
  InventoryLog, OpeningStockPiles, FinancialAccount, BankTransaction, ManualAccount, JournalEntry,
  AppUser, AppRole, PermissionModule, ShiftSession, DayClosingEntry,
  BusinessDay, CashDrawer, CashHandover, CashHandoverStatus, CashRemittance, CashVariance, ShiftCashEvent
} from '../types';

const isTerminalLockedAtBoot = (): boolean => {
  try { return localStorage.getItem('mooco_terminal_locked') === '1'; } catch { return false; }
};

const DEFAULT_SYSTEM_ROLES: AppRole[] = [
  {
    id: 'role_super_admin',
    name: 'Super Admin / Owner',
    description: 'Full unrestricted access to all modules, settings, and user administration.',
    is_system: true,
    permissions: ['dashboard', 'purchase', 'allocation', 'pos', 'sales_history', 'customer_orders', 'retail_stock', 'cash_control', 'production', 'items', 'inventory', 'customers', 'suppliers', 'expenses', 'bank_cash', 'accounts', 'reports', 'settings', 'user_management']
  },
  {
    id: 'role_manager',
    name: 'Manager / Accountant',
    description: 'Access to financial management, bills, and khata ledgers.',
    is_system: true,
    permissions: ['dashboard', 'purchase', 'allocation', 'pos', 'sales_history', 'customer_orders', 'retail_stock', 'cash_control', 'production', 'items', 'inventory', 'customers', 'suppliers', 'expenses', 'bank_cash', 'accounts', 'reports', 'approvals']
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

const DEFAULT_SYSTEM_MANUAL_ACCOUNTS: Array<{
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



/** Note counts at shift close: all counted cash, the part left in the drawer and the part sent to the head. */
interface ShiftCloseDenominations {
  closing?: Record<string | number, number>;
  leave_in_drawer?: Record<string | number, number>;
  remit_to_head?: Record<string | number, number>;
}

interface DairyContextType {
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
  /** Idle auto-lock: the login screen stays up until someone enters a PIN. */
  isTerminalLocked: boolean;
  lockTerminalNow: () => void;
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
  /** receiveIntoAccountId: a head closing the shift receives the remitted cash straight into that account (no Head Inbox step). */
  /** approveDifferenceNow: the Owner closing their own shift approves its cash difference in the same step. */
  closeCashierShift: (data: { countedCash: number; leaveInDrawer: number; remitToHead: number; denominations?: ShiftCloseDenominations; differenceReason?: string; notes?: string; receiveIntoAccountId?: string; approveDifferenceNow?: boolean }) => Promise<boolean>;
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
  /** refundAs 'khata': supplier keeps the money and lowers the payable instead of refunding cash. */
  returnPurchase: (purchaseId: string, returnQty?: number, reason?: string, refundAs?: 'cash' | 'khata') => Promise<boolean>;
  deletePurchase: (id: string) => Promise<boolean>;
  returnMaterialPurchase: (purchaseId: string, returnQty?: number, reason?: string, refundAs?: 'cash' | 'khata') => Promise<boolean>;
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
  /** Opening stock for a catalog item (`items.id`): sets each given pile to the target count. See docs/stock-model.md. */
  setOpeningStock: (itemId: string, piles: OpeningStockPiles, notes?: string) => Promise<boolean>;
  syncItemAndInventoryStock: (itemId: string, newStock: number, newVariantStocks?: Record<string, number>) => void;
  setInventory: React.Dispatch<React.SetStateAction<InventoryItem[]>>;

  setProductionBatches: React.Dispatch<React.SetStateAction<ProductionBatch[]>>;
  createBatch: (productName: string, quantity: number, notes?: string, priority?: PriorityLevel, inputCostPerUnit?: number, estimatedOutput?: number, details?: any) => Promise<string | false>;
  discardBatch: (batchId: string) => Promise<boolean>;
  trimBatchToSource: (batchId: string, keepSource: 'fresh' | 'retail') => Promise<boolean>;
  updateBatchStage: (batchId: string, newStage: ProductionStage, logMessage?: string, outputData?: { variants: { variantId: string, count: number }[], looseQty: number }) => Promise<boolean>;
  cancelBatch: (batchId: string, reason: string) => Promise<boolean>;

  /** Resolves to the saved bill number, or false when nothing was queued. */
  addSale: (cart: any[], customer: any, subtotal: number, discount: number, total: number, paymentMode: 'Cash' | 'Online' | 'Credit', paidAmount?: number) => Promise<string | false>;
  processSalesReturn: (saleId: string, returnReason: string, refundAccountId?: string, returnAction?: 'refund' | 'replace', restockOption?: 'restock' | 'scrap_spoilage', returnedItemsList?: Array<{ itemId?: string; name: string; qty: number; price: number; variantId?: string; unit?: string }>, refundPaymentMode?: 'Cash' | 'Online', correctOriginalSaleMode?: boolean) => Promise<boolean>;
  updateSalePaymentMode: (saleId: string, newPaymentMode: 'Cash' | 'Online', targetAccountId?: string) => Promise<boolean>;
  recordDailySupply: (entries: any[]) => Promise<boolean>;
  performRetailClosing: (data: any) => Promise<boolean>;
  postClosingStockSale: (data: any) => Promise<boolean>;

  addCustomer: (customer: Omit<Customer, 'id'>) => Promise<string | boolean>;
  updateCustomer: (id: string, updates: Partial<Customer>) => Promise<boolean>;
  deleteCustomer: (id: string) => Promise<boolean>;
  recordCustomerPayment: (customerId: string, amount: number, date: string, mode: string, note?: string, type?: 'Payment' | 'Charge', accountId?: string) => Promise<boolean>;
  deleteCustomerTransaction: (id: string) => Promise<boolean>;
  recordSupplierPayment: (supplierId: string, amount: number, date: string, mode: string, type: any, note?: string, accountId?: string) => Promise<boolean>;

  addExpense: (expense: Omit<ExpenseEntry, 'id'>) => Promise<boolean>;
  updateExpense: (id: string, updates: Partial<ExpenseEntry>) => Promise<boolean>;
  deleteExpense: (id: string) => Promise<boolean>;
  addRecurringExpense: (expense: Omit<RecurringExpense, 'id'>) => Promise<boolean>;
  deleteRecurringExpense: (id: string) => Promise<boolean>;
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

  updateSettings: (newSettings: Partial<SystemSettings>) => Promise<boolean>;
  resetSystem: () => Promise<void>;
  clearData: (module: string | string[]) => Promise<void>;
  /** True when the date is on or before the books lock date. */
  isPeriodLocked: (dateStr: string) => boolean;
  /** Asks the server to check another operator's PIN for a manager-only action. */
  requestManagerApproval: (approverId: string, pin: string, permission: string) => Promise<{ approved: boolean; approverName?: string; message?: string }>;
  /** Every record this terminal holds, as one JSON-ready object (owner backup). */
  buildBackup: () => Record<string, unknown>;
  addCategory: (name: string) => void;
  removeCategory: (name: string) => void;
  
  addUnit: (unit: any) => Promise<boolean>;
  updateUnit: (unitId: string, updatedUnit: Partial<UnitDefinition>) => Promise<boolean>;
  deleteUnit: (unitId: string) => Promise<boolean>;

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

// The provider publishes each new context value to a store; useDairy subscribes per component and
// re-renders only for the fields that component reads (one React context re-rendered every consumer
// on every change: a synced bill re-rendered the sidebar, the header and the open page).
interface DairySource {
  get: () => DairyContextType;
  subscribe: (listener: () => void) => () => void;
}

interface DairyStore extends DairySource {
  set: (value: DairyContextType) => void;
}

const createDairyStore = (initial: DairyContextType): DairyStore => {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: listener => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set: next => {
      if (next === value) return;
      value = next;
      listeners.forEach(listener => listener());
    }
  };
};

const DairyStoreContext = createContext<DairySource | null>(null);

// Sign-out / user switch always reaches hidden pages, so they lock instead of keeping old data.
const sameOperator = (a: DairyContextType, b: DairyContextType) =>
  a.currentUser?.id === b.currentUser?.id && a.currentRole?.id === b.currentRole?.id;

// What a kept-alive page reads through (see DairyFreeze): while frozen it keeps the value it last
// handed out, except for an operator change; once thawed it follows the parent again.
const createFrozenView = (parent: DairySource) => {
  let frozen = false;
  let value = parent.get();
  const listeners = new Set<() => void>();
  let detach: (() => void) | null = null;
  const notify = () => listeners.forEach(listener => listener());
  return {
    get: () => {
      const next = parent.get();
      if (next !== value && (!frozen || !sameOperator(value, next))) value = next;
      return value;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      // Subscribed to the parent only while someone listens, so a page that unmounts leaves nothing behind.
      if (!detach) {
        detach = parent.subscribe(() => {
          if (!frozen || !sameOperator(value, parent.get())) notify();
        });
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && detach) {
          detach();
          detach = null;
        }
      };
    },
    setFrozen: (next: boolean) => { frozen = next; },
    notify
  };
};

// A view of the context value that records every field read through it. Values come from `current`
// (the newest value, or the frozen one on a hidden page), so a handler running after the render
// still sees current records, as it did when every consumer re-rendered on every change.
const trackReads = (snapshot: DairyContextType, tracked: Set<PropertyKey>, current: () => DairyContextType): DairyContextType =>
  new Proxy(snapshot, {
    get(_target, key) {
      tracked.add(key);
      return (current() as any)[key];
    },
    has(target, key) {
      tracked.add(key);
      return key in target;
    },
    ownKeys(target) {
      const keys = Reflect.ownKeys(target);
      keys.forEach(key => tracked.add(key));
      return keys;
    }
  });

// Wrappers that always call the newest render's implementation, created once.
const bindLatest = <T extends Record<string, (...args: any[]) => any>>(ref: { current: T }): T => {
  const bound = {} as T;
  for (const key of Object.keys(ref.current) as Array<keyof T>) {
    bound[key] = ((...args: any[]) => ref.current[key](...args)) as T[keyof T];
  }
  return bound;
};

// The catalog item a bill / cart line belongs to. Matched by id only: "id or name" took the first
// item matching either, so a line could get another item's cost or stock move. The name is used
// only for an old line saved without an id, and that is logged.
const lineItemId = (line: any): string | undefined => line?.itemId || line?.id || undefined;
const findLineItem = <T extends { id: string; name: string }>(list: T[], line: any): T | undefined => {
  const id = lineItemId(line);
  if (id) return list.find(entry => entry.id === id);
  const name = String(line?.name || '').trim().toLowerCase();
  const byName = name ? list.find(entry => String(entry.name || '').trim().toLowerCase() === name) : undefined;
  if (byName) console.warn('[Stock] Line without an item id matched by name:', line?.name);
  return byName;
};

// A timestamp belongs to the Pakistan business day it happened on, not its UTC date.
const businessDayOf = (dateStr: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : new Date(dateStr).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

// Today's business date in Pakistan (YYYY-MM-DD).
const getBusinessDate = (): string => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(p => p.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

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

const OPEN_SHIFT_STATUSES = ['Pending Acceptance', 'Active', 'Closing'];

// The shift a user sells on: their own open shift (today's first, then an older one that the
// overnight rollover will carry forward). Only the Owner may sell on another cashier's shift
// that is open today, so one cashier's bills never land in a colleague's drawer.
const findUsableShift = (
  sessions: ShiftSession[],
  user: { id: string; role_id?: string } | null | undefined,
  businessDate: string
): ShiftSession | null => {
  if (!user) return null;
  const open = sessions.filter(shift => Boolean(shift.drawer_id) && OPEN_SHIFT_STATUSES.includes(shift.status));
  const isToday = (shift: ShiftSession) => !shift.business_date || shift.business_date === businessDate;
  const own = open.filter(shift => shift.user_id === user.id);
  return own.find(isToday)
    || own[0]
    || (user.role_id === 'role_super_admin' ? open.find(isToday) : undefined)
    || null;
};

/**
 * Server tables the workspace holds. fetchData(keys) reloads only those tables after a write;
 * fetchData() with no keys reloads everything (startup, Retry, the reconcile after a sync).
 * 'recentBank' reads only the bank rows created since the newest one already held: enough after a
 * move that only adds rows (receipt, transfer, shift close), where a full read is ~2.7 MB.
 */
type LoadKey =
  | 'suppliers' | 'customers' | 'items' | 'sales' | 'purchases' | 'materialPurchases' | 'allocations'
  | 'productionBatches' | 'dailySupply' | 'retailClosings' | 'expenses' | 'recurringExpenses'
  | 'expenseVendors' | 'expenseVendorTransactions' | 'accounts' | 'bankTransactions' | 'recentBank'
  | 'manualAccounts' | 'journalEntries' | 'inventoryLogs' | 'customerTransactions' | 'supplierTransactions'
  | 'settings' | 'businessDays' | 'cashDrawers' | 'cashShifts' | 'handovers' | 'remittances' | 'variances'
  | 'cashEvents' | 'dayClosings';
/** null = every table. */
type LoadScope = ReadonlySet<LoadKey> | null;

// The slices reapplyLedger projects unsynced work onto (items covers items and inventory).
const LEDGER_KEYS: LoadKey[] = [
  'sales', 'customers', 'items', 'accounts', 'suppliers', 'expenses', 'expenseVendors', 'purchases',
  'allocations', 'customerTransactions', 'supplierTransactions', 'bankTransactions', 'retailClosings'
];
/** A money move that only inserts bank rows. */
const MONEY_ADDED: LoadKey[] = ['accounts', 'recentBank', 'cashEvents'];
/** A move that edits or deletes existing bank rows, so the whole bank history is read again. */
const MONEY_CHANGED: LoadKey[] = ['accounts', 'bankTransactions', 'cashEvents'];
const STOCK: LoadKey[] = ['items', 'inventoryLogs'];
const CASH_CONTROL: LoadKey[] = ['businessDays', 'cashDrawers', 'cashShifts', 'handovers', 'remittances', 'variances', ...MONEY_ADDED];
// What each offline voucher touches, to take back an optimistic update the server refused.
const OUTBOX_TABLES: Record<OutboxActionType, LoadKey[]> = {
  order: ['sales', ...STOCK, 'customers', 'customerTransactions', ...MONEY_ADDED],
  milk_purchase: ['purchases', 'allocations', 'suppliers', 'supplierTransactions', ...MONEY_ADDED],
  supplier_payment: ['suppliers', 'supplierTransactions', ...MONEY_ADDED],
  expense: ['expenses', 'expenseVendors', ...MONEY_ADDED],
  customer_payment: ['customers', 'customerTransactions', ...MONEY_ADDED],
  retail_closing: ['retailClosings']
};

// Balances below half a paisa are float dust (0.1 + 0.2 - 0.3), not money owed.
const BALANCE_EPSILON = 0.005;
const isZeroBalance = (value: unknown) => Math.abs(Number(value) || 0) < BALANCE_EPSILON;

// 100 pages of 1,000 rows. The old cap of 20 would have cut bill and stock-log history silently
// within a year at the current rate; a capped read now logs a warning.
const MAX_HISTORY_PAGES = 100;
// Bank rows created up to ten minutes before the newest one held are read again: a row committed
// late by a slow transaction can carry an older created_at.
const BANK_WINDOW_MARGIN_MS = 10 * 60 * 1000;

const newestCreatedAt = (rows: any[]): number => rows.reduce((newest: number, row: any) => {
  const time = Date.parse(row?.created_at);
  return Number.isFinite(time) && time > newest ? time : newest;
}, -Infinity);

// Rows created since sinceMs come from the server; older ones stay as held. Newest first by date,
// like a full read (the sort is stable, so ties keep their order).
const mergeRecentRows = (held: any[], recent: any[], sinceMs: number): any[] => {
  const recentIds = new Set(recent.map(row => row?.id));
  const older = held.filter(row => !(Date.parse(row?.created_at) >= sinceMs) && !recentIds.has(row?.id));
  return [...recent, ...older].sort((a, b) => (Date.parse(b?.date) || 0) - (Date.parse(a?.date) || 0));
};

// A newest-first page followed by the older rows it does not already hold.
const withOlderRows = <T extends { id?: any }>(firstPage: T[], older: T[]): T[] => {
  const ids = new Set(firstPage.map(row => row?.id));
  return [...firstPage, ...older.filter(row => !ids.has(row?.id))];
};

const mapCashShiftRow = (row: any, accounts: FinancialAccount[], drawers: CashDrawer[]): ShiftSession => {
  const drawer = drawers.find(d => d.id === row.drawer_id);
  const acc = accounts.find(a => a.id === row.drawer_id)
    || accounts.find(a => a.id === drawer?.account_id);
  const drawerName = acc?.name || drawer?.name || row.drawer_name || 'Cash Drawer';
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
    general: { companyName: 'My Dairy', address: '', phone: '', email: '', taxId: '', shifts: ['Morning', 'Evening'] },
    financial: { defaultCashAccountId: '', defaultDigitalAccountId: '' },
    sales: { invoicePrefix: 'INV-', invoiceFooter: '' },
    inventory: { allowNegativeStock: true, customUnits: [] },
    expenses: { inactiveCategories: [], inactiveSubcategories: [] },
    security: {}
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
  const [isTerminalLocked, setIsTerminalLocked] = useState<boolean>(() => {
    try { return typeof window !== 'undefined' && localStorage.getItem('mooco_terminal_locked') === '1'; } catch { return false; }
  });
  const [isUserSwitcherOpen, setIsUserSwitcherOpen] = useState<boolean>(
    () => typeof window !== 'undefined' && (!localStorage.getItem('mooco_active_user_id') || isTerminalLockedAtBoot())
  );
  const setTerminalLocked = (locked: boolean) => {
    setIsTerminalLocked(locked);
    try {
      if (locked) localStorage.setItem('mooco_terminal_locked', '1');
      else localStorage.removeItem('mooco_terminal_locked');
    } catch (_) {}
  };
  const lockTerminalNow = () => {
    setTerminalLocked(true);
    setIsUserSwitcherOpen(true);
  };

  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const [dataLoadError, setDataLoadError] = useState<string | null>(null);
  const sessionReady = useRef(false);
  // True while the workspace load was skipped because nobody is signed in yet.
  const awaitingLogin = useRef(false);
  const initialFetchStarted = useRef(false);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const ledgerBases = useRef(emptyBases());
  // The newest render's state and functions, for loads, listeners and timers that outlive the
  // render they were started from (assigned just before the context value is built).
  const latest = useRef<any>(null);

  const restoreOperator = async () => {
    setSessionError(null);
    if (!sessionReady.current && !currentUser) setIsBooting(true);

    const lockTerminal = () => {
      setCurrentUser(null);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('mooco_active_user_id');
        localStorage.removeItem('mooco_active_user_data');
      }
      setIsUserSwitcherOpen(true);
    };

    const storeUsers = (list: AppUser[]) => {
      setUsers(list);
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('mooco_cached_users', JSON.stringify(list)); } catch (_) {}
      }
    };

    const readSavedUser = (): AppUser | null => {
      if (typeof window === 'undefined') return null;
      try {
        const raw = localStorage.getItem('mooco_active_user_data');
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && parsed.id ? parsed : null;
      } catch (_) {
        return null;
      }
    };

    const attemptFetch = async (timeoutMs: number) => {
      return await Promise.allSettled([
        loadRead(supabase.from('app_roles').select('*'), timeoutMs),
        loadRead(supabase.rpc('app_list_users'), timeoutMs)
      ]);
    };

    try {
      // The database only answers an operator session minted by the operator-login Edge Function.
      const session = await getOperatorSession();
      const sessionUserId = sessionOperatorId(session);

      if (!session) {
        // Offline with a saved session: keep working on the cached operator; the token refreshes
        // (and queued work syncs) once the device is back online.
        const savedUser = readSavedUser();
        if (hasStoredOperatorSession() && savedUser) {
          setCurrentUser(savedUser);
          sessionReady.current = true;
          return;
        }

        // Signed out: the login tiles are the only thing readable before a PIN.
        try {
          const { data } = await loadRead(supabase.rpc('app_login_directory'), 20000);
          if (Array.isArray(data)) storeUsers((data as any[]).map(mapRpcUser));
        } catch (_) {
          // Offline login screen falls back to the cached tiles and the username form.
        }
        lockTerminal();
        sessionReady.current = true;
        return;
      }

      // A 20s timeout survives high mobile network latency.
      let [rolesRes, usersRes] = await attemptFetch(20000);

      const needsRetry = (rolesRes.status !== 'fulfilled' || rolesRes.value.error || !rolesRes.value.data?.length) ||
                         (usersRes.status !== 'fulfilled' || usersRes.value.error || !usersRes.value.data);
      if (needsRetry) {
        await new Promise(r => setTimeout(r, 600));
        const [r2, u2] = await attemptFetch(25000);
        if (r2.status === 'fulfilled' && !r2.value.error && r2.value.data?.length) rolesRes = r2;
        if (u2.status === 'fulfilled' && !u2.value.error && u2.value.data) usersRes = u2;
      }

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

      if (usersRes.status === 'fulfilled' && usersRes.value.data && !usersRes.value.error) {
        const dbUsers: AppUser[] = (usersRes.value.data as any[]).map(mapRpcUser);
        storeUsers(dbUsers);

        // The signed-in operator is whoever the session belongs to — never a guess from the list.
        const matched = dbUsers.find(u => u.id === sessionUserId && u.is_active);
        if (matched) {
          setCurrentUser(matched);
          if (typeof window !== 'undefined') {
            localStorage.setItem('mooco_active_user_id', matched.id);
            localStorage.setItem('mooco_active_user_data', JSON.stringify(matched));
          }
        } else {
          // Operator deactivated or deleted since the session was issued — lock the terminal.
          await operatorSignOut();
          lockTerminal();
        }

        sessionReady.current = true;
        setSessionError(null);
        return;
      }

      // Server could not be reached: keep the cached operator if it is the session's operator.
      const savedUser = readSavedUser();
      if (savedUser && (!sessionUserId || savedUser.id === sessionUserId)) {
        setCurrentUser(savedUser);
        sessionReady.current = true;
        setSessionError(null);
        return;
      }

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

  const lastWorkCountRef = useRef<number>(-1);
  // Local work that was still unsynced when the current server snapshot was requested. A bill that
  // syncs while the snapshot is in flight is no longer "unsynced", yet parts of the snapshot can
  // predate its effects; reapplyLedger spots that and queues one more load of the same tables
  // instead of showing pre-sale stock/cash/khata until the next reload.
  // Only set while loadData runs.
  const preLoadWork = useRef<Awaited<ReturnType<typeof readUnsyncedWork>> | null>(null);

  // Loads waiting to run: undefined = none, null = everything, a set = just those tables.
  const queuedLoad = useRef<LoadScope | undefined>(undefined);
  const queueLoad = (scope: LoadScope) => {
    const queued = queuedLoad.current;
    queuedLoad.current = scope === null || queued === null ? null : new Set([...(queued || []), ...scope]);
  };

  // scope: the tables this load asked for (queued again when the snapshot turns out stale).
  // reloaded: the slices it actually replaced, null for all of them.
  const reapplyLedger = async (scope: LoadScope = null, reloaded: LoadScope = null) => {
    let seen = currentEpoch();
    let work: Awaited<ReturnType<typeof readUnsyncedWork>> | undefined;
    // A sale or payment saved while the journal is read may be missing from it: read it once more
    // (local only) instead of skipping the projection and leaving its effects off the screen.
    for (let attempt = 0; attempt < 3; attempt++) {
      seen = currentEpoch();
      try {
        work = await readUnsyncedWork();
      } catch (err) {
        console.warn('[Ledger] Could not read the local journal', err);
        return;
      }
      if (currentEpoch() === seen) break;
    }
    if (!work || currentEpoch() !== seen) return;
    const early = preLoadWork.current;
    if (early) {
      // Something synced while this snapshot was loading. Its effects may be in some tables and not
      // others, so neither projecting it nor dropping it is reliably right: project only what is still
      // unsynced and read the tables it touches once more, after that sync.
      const ids = <T extends { id: any }>(rows: T[]) => new Set(rows.map(row => row.id));
      const workOrderIds = ids(work.orders);
      const workCustomerIds = ids(work.customers);
      const workOutboxIds = ids(work.outbox);
      const syncedOrderIds = early.orders.filter(order => !workOrderIds.has(order.id)).map(order => order.id);
      const customerSynced = early.customers.some(customer => !workCustomerIds.has(customer.id));
      const syncedVouchers = early.outbox.filter(item => !workOutboxIds.has(item.id));
      if (syncedOrderIds.length || customerSynced || syncedVouchers.length) {
        const again = new Set<LoadKey>();
        // Not the bill list (~8 MB): a synced bill missing from it keeps its local copy below.
        if (syncedOrderIds.length) OUTBOX_TABLES.order.forEach(key => { if (key !== 'sales') again.add(key); });
        if (customerSynced) ['customers', 'customerTransactions'].forEach(key => again.add(key as LoadKey));
        syncedVouchers.forEach(item => (OUTBOX_TABLES[item.action_type] || []).forEach(key => again.add(key)));
        // Only tables this load read can hold a half-old snapshot; the rest keep their own state.
        const readNow = (key: LoadKey) => !scope || scope.has(key) || (key === 'recentBank' && scope.has('bankTransactions'));
        const reread = [...again].filter(readNow);
        if (reread.length) queueLoad(new Set(reread));

        if (syncedOrderIds.length && ledgerBases.current.sales) {
          const held = ids(ledgerBases.current.sales);
          const missingIds = syncedOrderIds.filter(id => !held.has(id));
          if (missingIds.length) {
            // The bill list was read before these bills synced: show their local copies until the
            // next read of the list includes them, rather than drop them from the screen.
            try {
              const local = (await db.orders.bulkGet(missingIds)).filter(Boolean).map(order => toPosBill(order!));
              ledgerBases.current.sales = [...local, ...ledgerBases.current.sales];
            } catch (err) {
              console.warn('[Ledger] Could not read synced bills', err);
            }
          }
        }
      }
    }
    const workTotal = work.orders.length + work.customers.length + work.outbox.length;
    if (workTotal === 0 && lastWorkCountRef.current === 0) {
      return;
    }
    lastWorkCountRef.current = workTotal;

    const view = projectLedger(ledgerBases.current, work);
    const publish = (setter: (value: any) => void, next: any[] | null, key: LoadKey) => {
      // A partial reload republishes only what it read again. Every other slice still carries the
      // optimistic updates made since its own load, which its older base does not have.
      if (!next || (reloaded && !reloaded.has(key))) return;
      setter((prev: any[]) => {
        if (currentEpoch() !== seen) return prev;
        const ids = new Set(next.map(row => row?.id).filter(Boolean));
        const extras = (prev || []).filter(row => row?.id && !ids.has(row.id));
        const nextCombined = [...next, ...extras];
        if (prev && prev.length === nextCombined.length) {
          const unchanged = prev.every((item, idx) => item === nextCombined[idx]);
          if (unchanged) return prev;
        }
        return nextCombined;
      });
    };
    publish(setSales, view.sales, 'sales');
    publish(setCustomers, view.customers, 'customers');
    publish(setInventory, view.inventory, 'items');
    publish(setItems, view.items, 'items');
    publish(setAccounts, view.accounts, 'accounts');
    publish(setSuppliers, view.suppliers, 'suppliers');
    publish(setExpenses, view.expenses, 'expenses');
    publish(setExpenseVendors, view.expenseVendors, 'expenseVendors');
    publish(setPurchases, view.purchases, 'purchases');
    publish(setAllocations, view.allocations, 'allocations');
    publish(setCustomerTransactions, view.customerTransactions, 'customerTransactions');
    publish(setSupplierTransactions, view.supplierTransactions, 'supplierTransactions');
    publish(setBankTransactions, view.bankTransactions, 'bankTransactions');
    publish(setRetailClosings, view.retailClosings, 'retailClosings');
  };

  // ascending: name-ordered masters (customers, suppliers) list A->Z; dated history stays newest first.
  // startPage skips pages already held; since limits the read to rows at or after a value.
  const fetchFullTable = async (
    tableName: string,
    orderCol = 'date',
    maxPages = MAX_HISTORY_PAGES,
    ascending = false,
    options: { startPage?: number; since?: { column: string; value: string } } = {}
  ): Promise<{ data: any[] | null; error: any }> => {
    try {
      const pageSize = 1000;
      const readPage = (page: number) => {
        let query = supabase.from(tableName).select('*');
        if (options.since) query = query.gte(options.since.column, options.since.value);
        return loadRead(
          // id breaks ties: rows sharing a timestamp (one sale's stock logs) could repeat or vanish across pages.
          query.order(orderCol, { ascending }).order('id', { ascending }).range(page * pageSize, (page + 1) * pageSize - 1),
          35000
        );
      };
      const rows: any[] = [];
      const seenIds = new Set<unknown>();
      // A row inserted while the pages load shifts the offsets by one; never keep the same row twice.
      const keep = (data: any[] | null) => {
        for (const row of data || []) {
          const id = row?.id;
          if (id != null) {
            if (seenIds.has(id)) continue;
            seenIds.add(id);
          }
          rows.push(row);
        }
      };

      let page = options.startPage || 0;
      if (page === 0) {
        const firstPage = await readPage(0);
        // null, not []: callers treat [] as "the table is empty" and would wipe the loaded records.
        if (firstPage.error) return { data: null, error: firstPage.error };
        keep(firstPage.data);
        if (!firstPage.data || firstPage.data.length < pageSize || maxPages <= 1) return { data: rows, error: null };
        page = 1;
      }
      while (page < maxPages) {
        const chunkPages: number[] = [];
        for (let p = page; p < Math.min(page + 5, maxPages); p++) {
          chunkPages.push(p);
        }
        const chunkResults = await Promise.all(chunkPages.map(readPage));
        // A failed page must not pass as the end of the table: that silently dropped older history.
        const failedPage = chunkResults.find(res => res.error);
        if (failedPage) return { data: null, error: failedPage.error };
        for (const res of chunkResults) {
          keep(res.data);
          if (!res.data || res.data.length < pageSize) return { data: rows, error: null };
        }
        page += 5;
      }
      console.warn(`[Workspace load] ${tableName}: stopped at ${maxPages * pageSize} rows; older history was not loaded.`);
      return { data: rows, error: null };
    } catch (err) {
      console.warn(`[Workspace load] fetchFullTable for ${tableName} error:`, err);
      return { data: null, error: err };
    }
  };

  const loadData = async (scope: LoadScope = null) => {
      const full = scope === null;
      const want = (key: LoadKey) => full || scope.has(key);
      // A partial reload follows a write: no banner, no operator re-check, no first-paint shortcuts.
      if (full) {
        setIsDataLoading(true);
        setDataLoadError(null);
      }
      // Start access checks immediately, independently of business history/cache reads.
      const operatorRequest = full ? restoreOperator() : null;
      // Signed out (and no saved session to resume offline): the database would refuse every read,
      // so keep the cached figures and load once the operator logs in.
      if (!hasStoredOperatorSession()) {
        if (full) {
          awaitingLogin.current = true;
          await operatorRequest;
          setIsDataLoading(false);
        }
        return;
      }
      if (full) awaitingLogin.current = false;

      // Bank history: everything on a full load or after an edit/delete of bank rows; after a move that
      // only adds rows, just the rows created since the newest one already held.
      const bankBase = ledgerBases.current.bankTransactions;
      const newestBankRow = bankBase?.length ? newestCreatedAt(bankBase) : -Infinity;
      const bankMode: 'full' | 'recent' | null = want('bankTransactions')
        ? 'full'
        : (scope?.has('recentBank') ? (Number.isFinite(newestBankRow) ? 'recent' : 'full') : null);
      const bankSince = bankMode === 'recent' ? new Date(newestBankRow - BANK_WINDOW_MARGIN_MS).toISOString() : '';
      const reloaded: LoadScope = full ? null : new Set<LoadKey>([...scope, ...(bankMode ? ['bankTransactions' as LoadKey] : [])]);
      // First load only: today's bills paint the counter while the full bill list downloads.
      const quickSales = full && !ledgerBases.current.sales;
      // The full bill list arrives in the second stage. Until then the bills on screen stay as they
      // are: republishing the previous base would hide every bill synced since it was read.
      const coreReloaded: LoadScope = full
        ? (quickSales ? null : new Set(LEDGER_KEYS.filter(key => key !== 'sales')))
        : new Set([...reloaded].filter(key => key !== 'sales'));
      // A full load reads the newest 1,000 bank and stock-log rows with the core tables and the older
      // pages (and every bill) after the workspace opens, so history never competes with them.
      const firstPageOnly = full ? 1 : MAX_HISTORY_PAGES;

      try {
        const businessDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
        // Taken BEFORE the server reads start (see preLoadWork).
        try {
          preLoadWork.current = await withDeadline(() => readUnsyncedWork(), 3000);
        } catch {
          preLoadWork.current = null;
        }
        const SKIP = Promise.resolve({ data: null, error: null });
        const results = await Promise.allSettled([
          want('suppliers') ? fetchFullTable('suppliers', 'name', MAX_HISTORY_PAGES, true) : SKIP,
          want('customers') ? fetchFullTable('customers', 'name', MAX_HISTORY_PAGES, true) : SKIP,
          want('items') ? supabase.from('items').select('*').order('sort_order', { ascending: true, nullsFirst: false }).order('name', { ascending: true }) : SKIP,
          // Midnight in Pakistan, not UTC: a bare date meant 05:00 PKT and dropped the early-morning bills.
          quickSales ? supabase.from('sales').select('*').gte('date', `${businessDate}T00:00:00+05:00`).order('date', { ascending: false }).limit(300) : SKIP,
          want('purchases') ? fetchFullTable('purchases', 'date') : SKIP,
          want('materialPurchases') ? fetchFullTable('material_purchases', 'date') : SKIP,
          want('allocations') ? fetchFullTable('allocations', 'date') : SKIP,
          want('productionBatches') ? fetchFullTable('production_batches', 'start_date') : SKIP,
          want('dailySupply') ? fetchFullTable('daily_supply', 'date') : SKIP,
          want('retailClosings') ? fetchFullTable('retail_closings', 'date') : SKIP,
          want('expenses') ? fetchFullTable('expenses', 'date') : SKIP,
          want('recurringExpenses') ? supabase.from('recurring_expenses').select('*') : SKIP,
          want('expenseVendors') ? supabase.from('expense_vendors').select('*') : SKIP,
          want('accounts') ? supabase.from('financial_accounts').select('*') : SKIP,
          bankMode === 'full'
            ? fetchFullTable('bank_transactions', 'date', firstPageOnly)
            : bankMode === 'recent'
              ? fetchFullTable('bank_transactions', 'date', MAX_HISTORY_PAGES, false, { since: { column: 'created_at', value: bankSince } })
              : SKIP,
          want('manualAccounts') ? supabase.from('manual_accounts').select('*') : SKIP,
          // Paged: PostgREST returns at most 1000 rows per request, which silently cut long histories.
          want('journalEntries') ? fetchFullTable('journal_entries', 'date') : SKIP,
          want('inventoryLogs') ? fetchFullTable('inventory_logs', 'date', firstPageOnly) : SKIP,
          want('customerTransactions') ? fetchFullTable('customer_transactions', 'date') : SKIP,
          want('supplierTransactions') ? fetchFullTable('supplier_transactions', 'date') : SKIP,
          want('settings') ? supabase.from('app_settings').select('*').eq('id', 'global_settings').single() : SKIP,
          want('expenseVendorTransactions') ? fetchFullTable('expense_vendor_transactions', 'date') : SKIP,
          want('businessDays') ? fetchFullTable('business_days', 'business_date') : SKIP,
          want('cashDrawers') ? supabase.from('cash_drawers').select('*').order('name') : SKIP,
          want('cashShifts') ? fetchFullTable('cash_shifts', 'started_at') : SKIP,
          want('handovers') ? fetchFullTable('drawer_handovers', 'declared_at') : SKIP,
          want('remittances') ? fetchFullTable('cash_remittances', 'declared_at') : SKIP,
          want('variances') ? fetchFullTable('cash_variances', 'created_at') : SKIP,
          want('cashEvents') ? fetchFullTable('shift_cash_events', 'occurred_at') : SKIP,
          want('dayClosings') ? supabase.from('day_closings').select('*').order('date', { ascending: false }) : SKIP,
        ].map(query => loadRead<any>(query as any, 35000)));
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
          ilRes, ctRes, stRes, setRes, evtRes,
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
              security: { ...prev.security, ...(dbSettings.security || {}) },
           }));
           if (Array.isArray(dbSettings.inventory?.categories) && dbSettings.inventory.categories.length) {
             setCategories(dbSettings.inventory.categories.map(String));
           }
        }

        // Pending local Dexie records, so unsynced work is not lost on re-fetch.
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
        } else if (want('customers') && !ledgerBases.current.customers) {
          // The offline copy only stands in when nothing was loaded yet: after a failed refresh the
          // figures on screen are newer than that copy.
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
              unit: i.unit || 'units', cost_price: Math.round((Number(i.cost_price) || 0) * 10000) / 10000, // per-g / per-ml costs need more than 2 decimals
              selling_price: roundCurrency(i.selling_price || 0),
              isActive: i.is_active, isSystem: i.is_system, source: i.source || 'Both', reorder_level: i.reorder_level ?? 10, // 0 (no alert) is a real setting
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
        } else if (want('items') && !ledgerBases.current.items) {
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

        const applyServerSales = (rows: any[]) => {
          const serverSales = rows.map((s: any) => ({
            ...s,
            paid_amount: s.paid_amount !== undefined ? roundCurrency(s.paid_amount) : (s.details?.paid_amount !== undefined ? roundCurrency(s.details.paid_amount) : roundCurrency(s.total)),
            due_amount: s.due_amount !== undefined ? roundCurrency(s.due_amount) : roundCurrency(s.details?.due_amount || 0),
            // Returns are stored inside details; screens read them from the bill itself.
            returned_items: s.returned_items || s.details?.returned_items || undefined,
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
        if (quickSales) {
          const quickRows = saleRes.status === 'fulfilled' ? saleRes.value?.data : null;
          if (quickRows) applyServerSales(quickRows);
          else {
            // The full bill list still loads below; until then the counter shows this device's bills.
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
        }
        if (purRes.status === 'fulfilled' && purRes.value.data) {
          // details first: spread last, its raw paid/due overwrote the rounded figures computed here.
          const serverPurchases = purRes.value.data.map((p: any) => ({
            ...p,
            ...p.details,
            details: p.details,
            quantity: roundQuantity(p.quantity || 0),
            rate: roundCurrency(p.rate || 0),
            total_amount: roundCurrency(p.total_amount || 0),
            paid_amount: p.paid_amount !== undefined ? roundCurrency(p.paid_amount) : roundCurrency(p.details?.paid_amount || 0),
            due_amount: p.due_amount !== undefined ? roundCurrency(p.due_amount) : (p.details?.due_amount !== undefined ? roundCurrency(p.details.due_amount) : roundCurrency(Math.max(0, (p.total_amount || 0) - (p.details?.paid_amount || 0)))),
            payment_mode: p.payment_mode || p.details?.payment_mode || 'Cash'
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

            const rawStatus = (ex.payment_status || d.payment_status || d.paymentStatus || '').toString();
            const isUnpaid = rawStatus.toLowerCase() === 'unpaid';

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

            // The amounts decide: a bill saved as "Partial" and then paid in full is Paid.
            const fullyPaid = paidAmt >= totalAmt - 0.005;
            const status = isUnpaid ? 'Unpaid' : fullyPaid ? 'Paid' : ((paidAmt > 0 || rawStatus === 'Partial') ? 'Partial' : 'Paid');

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
        let loadedAccounts: FinancialAccount[] | null = null;
        if (faRes.status === 'fulfilled' && faRes.value.data && !faRes.value.error) {
          const serverAccounts = faRes.value.data.map((a: any) => ({ id: a.id, name: a.name, type: a.type, balance: a.balance || 0, isActive: a.is_active, ...a.details }));
          loadedAccounts = serverAccounts;
          ledgerBases.current.accounts = serverAccounts;
          setAccounts(serverAccounts);
          try { localStorage.setItem('mooco_accounts_snapshot', JSON.stringify(serverAccounts)); } catch { /* ignore quota */ }
        } else if (want('accounts') && !ledgerBases.current.accounts) {
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
        let bankFirstPage: any[] | null = null;
        if (btRes.status === 'fulfilled' && btRes.value.data) {
          let rows = btRes.value.data;
          if (bankMode === 'recent' && bankBase) {
            rows = mergeRecentRows(bankBase, rows, newestBankRow - BANK_WINDOW_MARGIN_MS);
          } else if (full) {
            bankFirstPage = rows;
            // Older pages follow in the second stage; until then keep the older rows already held,
            // so a statement on screen does not lose its history for a few seconds.
            if (rows.length >= 1000 && bankBase) rows = withOlderRows(rows, bankBase);
          }
          ledgerBases.current.bankTransactions = rows;
          setBankTransactions(rows);
        }
        if (maRes.status === 'fulfilled' && maRes.value.data) {
          const rawAccounts = maRes.value.data;
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
        let logsFirstPage: any[] | null = null;
        if (ilRes.status === 'fulfilled' && ilRes.value.data) {
          const rows = ilRes.value.data;
          if (full) logsFirstPage = rows;
          const previousLogs: InventoryLog[] = latest.current.inventoryLogs;
          setInventoryLogs(full && rows.length >= 1000 && previousLogs?.length ? withOlderRows(rows, previousLogs) : rows);
        }
        if (ctRes.status === 'fulfilled' && ctRes.value.data) {
          // Keep `details` itself too: statements read details.account_id / details.source.
          const serverCustomerTx = ctRes.value.data.map((ct: any) => ({ id: ct.id, customer_id: ct.customer_id, date: ct.date, type: ct.type, amount: ct.amount || 0, mode: ct.mode || ct.details?.mode, note: ct.note || ct.details?.note, ...ct.details, details: ct.details || {}, shift_session_id: ct.shift_session_id ?? ct.details?.shift_session_id, business_day_id: ct.business_day_id ?? ct.details?.business_day_id }));
          ledgerBases.current.customerTransactions = serverCustomerTx;
          setCustomerTransactions(serverCustomerTx);
        }
        if (stRes.status === 'fulfilled' && stRes.value.data) {
          // Keep `details` itself too: the supplier statement links returns and refunds through
          // details.purchase_id / details.cash_refund; without it every return looked unlinked.
          const serverSupplierTx = stRes.value.data.map((st: any) => ({ id: st.id, supplier_id: st.supplier_id, date: st.date, type: st.type, amount: st.amount || 0, mode: st.mode || st.details?.mode, note: st.note || st.details?.note, ...st.details, details: st.details || {} }));
          const serverStxIds = new Set(serverSupplierTx.map((s: any) => s.id));
          const unmergedStx = pendingSupplierTx.filter(s => !serverStxIds.has(s.id));
          ledgerBases.current.supplierTransactions = serverSupplierTx;
          setSupplierTransactions([...unmergedStx, ...serverSupplierTx]);
        }

        if (bdRes.status === 'fulfilled' && bdRes.value.data) setBusinessDays(bdRes.value.data as BusinessDay[]);
        const loadedDrawers = drawersRes.status === 'fulfilled' && drawersRes.value.data ? drawersRes.value.data as CashDrawer[] : null;
        if (loadedDrawers) setCashDrawers(loadedDrawers);
        if (shiftsRes.status === 'fulfilled' && shiftsRes.value.data) {
          // Same mapping as a shift started or closed here (drawer account and name included), so the
          // receipt account of a bill does not depend on which refresh ran last.
          const shiftAccounts = loadedAccounts || latest.current.accounts;
          const shiftDrawers = loadedDrawers || latest.current.cashDrawers;
          setShiftSessions(shiftsRes.value.data.map((row: any) => mapCashShiftRow(row, shiftAccounts, shiftDrawers)));
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

        await reapplyLedger(scope, coreReloaded);

        if (want('items') || want('customers')) {
          syncService.cacheCatalogFromSupabase({
            items: iRes.status === 'fulfilled' ? iRes.value.data : undefined,
            customers: cRes.status === 'fulfilled' ? cRes.value.data : undefined
          });
        }

        if (full) {
          // Allow workspace to render as long as core tables (suppliers, customers, items, accounts) loaded
          const coreFailed = [results[0], results[1], results[2], results[13]].some(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error));
          if (!coreFailed) {
            setHasLoadedData(true);
          } else if (!failedReads.length) {
            setHasLoadedData(true);
          }
        }

        // History, read after the workspace is open: every bill, plus the bank and stock-log pages
        // older than the newest 1,000 (a full first page means there may be more).
        const [salesHistory, bankHistory, logsHistory] = await Promise.all([
          want('sales') ? fetchFullTable('sales', 'date') : null,
          bankFirstPage && bankFirstPage.length >= 1000 ? fetchFullTable('bank_transactions', 'date', MAX_HISTORY_PAGES, false, { startPage: 1 }) : null,
          logsFirstPage && logsFirstPage.length >= 1000 ? fetchFullTable('inventory_logs', 'date', MAX_HISTORY_PAGES, false, { startPage: 1 }) : null
        ]);
        if (salesHistory?.data) applyServerSales(salesHistory.data);
        if (bankHistory?.data && bankFirstPage) {
          const rows = withOlderRows(bankFirstPage, bankHistory.data);
          ledgerBases.current.bankTransactions = rows;
          setBankTransactions(rows);
        }
        if (logsHistory?.data && logsFirstPage) setInventoryLogs(withOlderRows(logsFirstPage, logsHistory.data));
        if (salesHistory?.data || bankHistory?.data) await reapplyLedger(scope, salesHistory?.data ? reloaded : coreReloaded);
        if ((salesHistory && !salesHistory.data) || (bankHistory && !bankHistory.data) || (logsHistory && !logsHistory.data)) {
          console.warn('[Workspace load] History pages failed:', salesHistory?.error || bankHistory?.error || logsHistory?.error);
          setDataLoadError('Some records could not be loaded. Figures may be incomplete; retry before making changes.');
        }

      } catch (error) {
        console.warn("Supabase fetch notice (operating offline):", error);
        setDataLoadError(error instanceof Error ? error.message : 'Records could not be loaded. Please retry.');
        // Offline copies stand in only for what was never loaded; anything already on screen is newer.
        try {
          if (!ledgerBases.current.items) {
            const cached = mapCatalogCache(await withDeadline(() => db.catalog_cache.toArray(), 3000));
            if (cached.items.length) {
              ledgerBases.current.items = cached.items;
              ledgerBases.current.inventory = cached.inventory;
              setItems(cached.items);
              setInventory(cached.inventory);
            }
          }
          if (!ledgerBases.current.customers) {
            const cachedCustomers = await withDeadline(() => db.customers.toArray(), 3000);
            if (cachedCustomers.length) {
              ledgerBases.current.customers = cachedCustomers.map(toCustomer);
              setCustomers(ledgerBases.current.customers);
            }
          }
          if (!ledgerBases.current.sales) {
            const cachedOrders = await withDeadline(() => db.orders.toArray(), 3000);
            if (cachedOrders.length) {
              ledgerBases.current.sales = cachedOrders.map(toPosBill);
              setSales(ledgerBases.current.sales);
            }
          }
          await reapplyLedger(scope, coreReloaded);
        } catch (dexieErr) {
          console.error("Dexie offline fallback error:", dexieErr);
        }
      } finally {
        preLoadWork.current = null;
        if (full) {
          setIsDataLoading(false);
          await operatorRequest;
        }
      }
    };

  /**
   * Reloads records from the server. tables: just those tables (see LoadKey); none = everything.
   * Requests made while a load runs are merged into one more load that starts when it ends, and the
   * promise resolves once every requested table has been read.
   */
  const fetchData = (tables?: readonly LoadKey[]): Promise<void> => {
    queueLoad(tables ? new Set(tables) : null);
    if (refreshInFlight.current) return refreshInFlight.current;
    const request = (async () => {
      try {
        while (queuedLoad.current !== undefined) {
          const scope = queuedLoad.current;
          queuedLoad.current = undefined;
          try {
            await latest.current.loadData(scope);
          } catch (err) {
            console.warn('[Workspace load]', err);
          }
        }
      } finally {
        // Cleared in the same turn as the last queue check, so a request can never land in between.
        refreshInFlight.current = null;
      }
    })();
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
        // Nothing was saved: reload the tables the optimistic update touched, so it is taken back.
        void fetchData(OUTBOX_TABLES[action]);
        throw err;
      }
      await queue();
    }
  };

  useEffect(() => {
    // StrictMode replays effects; do not send a second full startup batch.
    // Synced bills are already in local state (optimistic update), so the post-sync reload is only a
    // reconciliation. A full reload re-downloads every table, so coalesce it to one per 10 minutes.
    const LEDGER_RECONCILE_MS = 10 * 60 * 1000;
    let lastReconcileAt = Date.now();
    let reconcileTimer: number | undefined;
    const onLedgerSynced = () => {
      if (reconcileTimer !== undefined) return;
      const wait = Math.max(0, lastReconcileAt + LEDGER_RECONCILE_MS - Date.now());
      reconcileTimer = window.setTimeout(() => {
        reconcileTimer = undefined;
        lastReconcileAt = Date.now();
        void fetchData();
      }, wait);
    };
    window.addEventListener('mooco-ledger-synced', onLedgerSynced);
    if (!initialFetchStarted.current) {
      initialFetchStarted.current = true;
      void fetchData();
    }
    return () => {
      window.removeEventListener('mooco-ledger-synced', onLedgerSynced);
      if (reconcileTimer !== undefined) window.clearTimeout(reconcileTimer);
    };
  }, []);

  // The refresh token was revoked or expired for good (or another tab logged out): lock the
  // terminal instead of letting every request fail with "Login zaroori hai".
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event !== 'SIGNED_OUT') return;
      setCurrentUser(null);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('mooco_active_user_id');
        localStorage.removeItem('mooco_active_user_data');
      }
      awaitingLogin.current = true;
      setIsUserSwitcherOpen(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Keep shift state in step across tabs and devices (BroadcastChannel + storage event).
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
    const active = findUsableShift(shiftSessions, currentUser, getBusinessDate());
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
      // Built-in units count too: a custom "kg" or "L" shadowed the standard one in every conversion.
      const isDuplicate = getAllAvailableUnits(existing).some(
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

  const deleteUnit = async (id: string): Promise<boolean> => {
    try {
      const existing = settings.inventory?.customUnits || [];
      const target = existing.find((u: any) => u.id === id);
      if (!target) {
        showToast("System standard units are protected and cannot be deleted", "warning");
        return false;
      }

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

  const addPurchase = async (
    entry: any, 
    paid_amount_arg?: number, 
    due_amount_arg?: number, 
    payment_mode_arg?: string, 
    account_id_arg?: string
  ): Promise<boolean> => {
    if (!guardOpenPeriod(entry.date)) return false;
    if (!(Number(entry.quantity) > 0) || !(Number(entry.rate) > 0)) {
      showToast('Doodh ki miqdar aur rate 0 se zyada hone chahiye.', 'warning');
      return false;
    }
    // Keyed by the business day, not the full timestamp: the timestamp differs on every click, so
    // the lock never stopped a double tap from saving the intake twice.
    const lockKey = `add_purchase_${entry.supplier_id}_${entry.date ? businessDayOf(String(entry.date)) : ''}_${entry.shift}`;
    const lockResult = await actionLock.runExclusive(lockKey, async () => {
      try {
        const id = generateUUID();
        const total_amount = roundCurrency((Number(entry.quantity) || 0) * (Number(entry.rate) || 0));
        
        // paid_amount / due_amount may arrive on the entry object or as positional arguments.
        const rawPaid = entry.paid_amount !== undefined 
          ? entry.paid_amount 
          : (paid_amount_arg !== undefined ? paid_amount_arg : 0);
        const requestedPaid = roundCurrency(Math.max(0, Number(rawPaid) || 0));
        // Paying more than the bill would take the extra out of the drawer with no supplier advance recorded.
        if (requestedPaid > total_amount + 0.01) {
          showToast(`Paid (Rs ${requestedPaid.toLocaleString()}) bill (Rs ${total_amount.toLocaleString()}) se zyada hai. Zyada raqam supplier ko alag Advance payment ke taur par dein.`, 'warning');
          return false;
        }
        const paid_amount = roundCurrency(Math.min(requestedPaid, total_amount));
        // Due always follows the bill, so paid + due can never exceed the bill total.
        const due_amount = roundCurrency(Math.max(0, total_amount - paid_amount));

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

        const matchedDrawerShift = (
          activeShiftSession?.status === 'Active' &&
          (!targetAccId || targetAccId === activeShiftSession.drawer_id || targetAccId === resolveDrawerAccountId(activeShiftSession.drawer_id))
            ? activeShiftSession
            : null
        ) || (
          targetAccId
            ? shiftSessions.find(s =>
                s.status === 'Active' &&
                (s.drawer_id === targetAccId || resolveDrawerAccountId(s.drawer_id) === targetAccId)
              ) || null
            : activeShiftSession
        );

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
          business_day_id: matchedDrawerShift?.business_day_id,
          shift_session_id: matchedDrawerShift?.id,
          drawer_id: matchedDrawerShift?.drawer_id,
          cashier_id: matchedDrawerShift?.user_id,
          details: {
            paid_amount,
            due_amount,
            payment_mode: paid_amount > 0 ? payment_mode : undefined,
            account_id: targetAccId || account_id,
            business_day_id: matchedDrawerShift?.business_day_id,
            shift_session_id: matchedDrawerShift?.id,
            drawer_id: matchedDrawerShift?.drawer_id,
            cashier_id: matchedDrawerShift?.user_id
          }
        };

        const purchaseData: PurchaseEntry = {
          ...dbPurchase,
          supplier_name: supplierName,
          shift: entry.shift,
          paid_amount,
          due_amount,
          payment_mode: paid_amount > 0 ? payment_mode : undefined,
          account_id: targetAccId || account_id
        };

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
          business_day_id: matchedDrawerShift?.business_day_id,
          shift_session_id: matchedDrawerShift?.id,
          drawer_id: matchedDrawerShift?.drawer_id,
          cashier_id: matchedDrawerShift?.user_id
        };

        noteLocalWrite();
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
          const stxDetails = {
            mode: payment_mode,
            note: `Spot Payment for Milk Intake (${entry.quantity}L ${entry.milk_type})`,
            purchase_id: id
          };
          // Same shape as a loaded row (details spread on top), so the ledger shows its mode and note before a reload.
          setSupplierTransactions(prev => [{
            id: `stx_pur_${id}`,
            supplier_id: entry.supplier_id,
            date: normalizedPurchaseDate,
            type: 'Payment',
            amount: paid_amount,
            ...stxDetails,
            details: stxDetails
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
              business_day_id: matchedDrawerShift?.business_day_id,
              shift_session_id: matchedDrawerShift?.id,
              drawer_id: matchedDrawerShift?.drawer_id,
              cashier_id: matchedDrawerShift?.user_id
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

    if (lockResult === null) {
      showToast('Is supplier ki pichli entry abhi save ho rahi hai.', 'warning');
      return false;
    }
    return lockResult;
  };

  const addSale = async (cart: any[], customer: any, subtotal: number, discount: number, total: number, paymentMode: 'Cash' | 'Online' | 'Credit', paidAmount?: number): Promise<string | false> => {
    try {
      const currentBusinessDate = getBusinessDate();
      if (!guardOpenPeriod(currentBusinessDate)) return false;
      if (businessDays.some(day => day.business_date === currentBusinessDate && day.status === 'Closed')) {
        showToast("Business Day has been closed & locked! Reopen day or contact Owner to punch bills.", "error");
        return false;
      }
      let shiftToUse = activeShiftSession;

      const isShiftStale = !shiftToUse ||
        shiftToUse.status !== 'Active' ||
        (shiftToUse.date && shiftToUse.date !== currentBusinessDate) ||
        (shiftToUse.business_date && shiftToUse.business_date !== currentBusinessDate);

      // Resolve the seller's own shift from live state (same rule as the shift shown in POS).
      const usableShift = findUsableShift(shiftSessions, currentUser, currentBusinessDate);
      const liveActiveShift = usableShift && (!usableShift.business_date || usableShift.business_date === currentBusinessDate)
        ? usableShift
        : null;

      if (liveActiveShift) {
        shiftToUse = liveActiveShift;
        if (activeShiftSession?.id !== liveActiveShift.id) {
          setActiveShiftSession(liveActiveShift);
          if (typeof window !== 'undefined') {
            localStorage.setItem('mooco_active_shift_session', JSON.stringify(liveActiveShift));
          }
        }
      } else if (isShiftStale) {
        // If a shift was left unclosed overnight, automatically roll it over to today's business day
        const staleActiveShift = usableShift
          || (shiftToUse && shiftToUse.status === 'Active' && Boolean(shiftToUse.drawer_id) && shiftToUse.user_id === currentUser?.id ? shiftToUse : null);

        if (staleActiveShift) {
          const rolledShift = await rolloverStaleShift(staleActiveShift);
          shiftToUse = rolledShift || staleActiveShift;
        } else {
          showToast("Shift active nahi hai! Sale karne se pehle active shift start karein.", "warning");
          return false;
        }
      }

      if (!shiftToUse || shiftToUse.status !== 'Active') {
        showToast("Start your shift in Cash Control before making a sale.", "warning");
        return false;
      }

      const emptyLine = cart.find((line: any) => !(Number(line.qty) > 0));
      if (emptyLine) {
        showToast(`"${emptyLine.name}" ki qty 0 hai. Qty likhein ya line hata dein.`, "warning");
        return false;
      }

      const saleId = generateUUID();
      const roundedSubtotal = roundCurrency(subtotal);
      const roundedDiscount = roundCurrency(discount);
      const roundedTotal = roundCurrency(total);
      // Money kept on the bill never exceeds its total; anything over is change handed back (cash_given / change_return).
      const actualPaid = roundCurrency(Math.min(roundedTotal, paidAmount !== undefined ? Math.max(0, paidAmount) : (paymentMode === 'Credit' ? 0 : roundedTotal)));
      // A walk-in has no khata: any unpaid part would be saved as paid < total with due 0 and simply vanish.
      if (!customer.id && (paymentMode === 'Credit' || actualPaid < roundedTotal - 0.01)) {
        showToast('Walk-in customer ka udhaar nahi ho sakta. Poori raqam lein ya customer select karein.', 'warning');
        return false;
      }
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

      const snapshotCart = cart.map((line: any) => {
        const catalogItem = findLineItem<ItemDefinition>(items, line);
        const baseCost = Number(line.cost_price || catalogItem?.cost_price || 0);
        const vId = line.variantId;
        const variant = vId && catalogItem ? (catalogItem.variants || []).find(v => v.id === vId) : undefined;
        const factor = variant ? (Number(variant.quantity_in_base_unit) || 1) : (Number(line.stockDeduction) || 1);
        // 4 decimals: a per-gram or per-ml cost rounded to paisa would turn into 0 or drift several percent.
        const unitCost = Math.round((vId && vId !== 'loose' ? baseCost * factor : baseCost) * 10000) / 10000;
        return { ...line, cost_price: unitCost > 0 ? unitCost : undefined };
      });

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
        items: saleItemSnapshot(snapshotCart),
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

      const orderRecord: LocalOrder = {
        ...saleData,
        receipt_account_id: receiptAccountId,
        sync_status: 'pending',
        created_at: saleDate
      };

      const orderItems: LocalOrderItem[] = cart.map((item: any) => ({
        id: generateUUID(),
        order_id: saleId,
        item_id: item.itemId || item.id,
        name: item.name,
        qty: item.qty,
        price: item.price,
        // A typed amount ("Rs 100 of milk") is the line total; qty × price would store e.g. 100.08.
        total: item.total || (item.customTotal != null && Number.isFinite(Number(item.customTotal)) ? roundCurrency(Number(item.customTotal)) : roundCurrency(item.qty * item.price)),
        variant_id: item.variantId,
        unit: item.unit || (item.variantId ? (item.variantName || 'Pack') : 'Unit'),
        sync_status: 'pending',
        created_at: saleDate
      }));
      // Bill and its lines are queued together, so the sync never sees a bill without lines.
      await db.transaction('rw', db.orders, db.order_items, async () => {
        await db.orders.put(orderRecord);
        if (orderItems.length > 0) await db.order_items.bulkPut(orderItems);
      });
      noteLocalWrite();

      // From here the bill is queued and WILL sync. A UI-state hiccup below must not report
      // 'Sale Failed', or the cashier punches the same bill again.
      try {
      setSales(prev => [saleData, ...prev]);

      const updatesMap: Record<string, { looseDeduction: number, variantDeductions: Record<string, number>, logDetails: string[], name: string }> = {};
      for (const item of cart) {
         const lineId = lineItemId(item);
         const inventoryItem = lineId ? inventory.find(i => i.item_id === lineId) : inventory.find(i => i.name === item.name);
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

      if (customer.id && dueAmount > 0) {
        const saleShift = shiftToUse;
        setCustomers(prev => prev.map(c => c.id === customer.id ? { ...c, balance: (c.balance || 0) + dueAmount } : c));
        setCustomerTransactions(prev => [{
          id: `ctx_${saleId}`,
          customer_id: customer.id,
          date: saleDate.split('T')[0],
          type: 'Charge',
          amount: dueAmount,
          note: `Sale #${invoiceNumber}`,
          // The shift this bill was saved on (activeShiftSession can still be null or stale here).
          business_day_id: saleShift.business_day_id,
          shift_session_id: saleShift.id,
          drawer_id: saleShift.drawer_id,
          cashier_id: currentUser?.id
        }, ...prev]);
      }

      // Same account the sync will credit, so the till balance matches the drawer before reload.
      if (receiptAccountId && receivedToPost > 0) {
        setAccounts(prev => prev.map(a => a.id === receiptAccountId ? { ...a, balance: (a.balance || 0) + receivedToPost } : a));
      }

      } catch (uiErr) {
        console.warn('[POS] Sale queued; local display update failed:', uiErr);
      }

      syncService.notifyPendingChange().catch(err => console.warn('[POS Sync] Background sync notice:', err));

      return invoiceNumber;
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
      const { item_type, isActive, isSystem, category, sort_order, stock: _stock, variant_stocks: _variantStocks, ...rest } = item as any;
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
      fetchData(['items']);
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

      // Stock only moves through adjust_item_stock. A catalog form holds a copy taken when it opened,
      // so writing it back would erase every sale made since then.
      const { item_type, isActive, isSystem, category, sort_order, stock: _stock, variant_stocks: _variantStocks, ...rest } = updates;
      const current = items.find(i => i.id === id);
      if (current && rest.unit !== undefined && String(rest.unit).trim() !== String(current.unit || '').trim()) {
        const looseStock = Number((inventory.find(inv => inv.item_id === id)?.quantity) ?? (current as any).stock ?? 0);
        const packedStock = Object.values(current.variant_stocks || {}).some(v => Math.abs(Number(v) || 0) > 0.0001);
        if (Math.abs(looseStock) > 0.0001 || packedStock) {
          showToast(`"${current.name}" ka stock abhi ${current.unit} mein hai. Base unit badalne se pehle stock 0 karein, warna purana stock naye unit mein ghalat parha jayega.`, "warning");
          return false;
        }
      }
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
      fetchData(['items']);
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
      fetchData(['items']);
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
      // supabase-js resolves with { error } instead of throwing: a refused row used to pass as saved.
      const failed = (await Promise.all(updatePromises)).find(result => result.error);
      if (failed) throw failed.error;
      showToast("Catalog order updated", "success");
      return true;
    } catch (err: any) {
      console.error("Error reordering items:", err);
      showToast("Failed to save product order", "error");
      fetchData(['items']);
      return false;
    }
  };
  
  const allocateBulkMilk = async (itemsList: { allocationId: string, quantity: number }[], destination: string, details: any) => {
    const lockResult = await actionLock.runExclusive(`allocate_bulk_${destination}`, async () => {
      try {
        const updatedAllocations = [...allocations];

        // Milk that is not in the pool cannot be allocated: it would appear in counter stock from nowhere.
        for (const item of itemsList) {
          const pool = allocations.find(a => a.id === item.allocationId || a.purchase_id === item.allocationId);
          if (!pool) continue;
          const left = pool.remaining_quantity !== null && pool.remaining_quantity !== undefined
            ? Number(pool.remaining_quantity)
            : Number(pool.original_quantity || 0) - Number(pool.allocated_quantity || 0);
          if (roundQuantity(Number(item.quantity) || 0) > roundQuantity(Math.max(0, left)) + 0.001) {
            showToast(`Sirf ${roundQuantity(Math.max(0, left))} L doodh baqi hai, ${roundQuantity(Number(item.quantity) || 0)} L allocate nahi ho sakta.`, 'error');
            return false;
          }
        }

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

          const { error: updateError } = await supabase.from('allocations').update({ 
              remaining_quantity: finalRemaining,
              allocated_quantity: newAllocated,
              status: status,
              destination: destinationToSave,
              details: updatedDetails
          }).eq('id', allocRecord.id);

          if (updateError) throw updateError;

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
              // Counter milk is the litre-based system item for this milk type, never "Milk Cake" or a kg product.
              const isLitreItem = (i: ItemDefinition) => ['l', 'ltr', 'liter', 'liters', 'litre', 'litres'].includes(String(i.unit || '').trim().toLowerCase());
              const itemDef = items.find(i => i.id === `item_${typeLower}_milk`)
                || items.find(i => isLitreItem(i) && i.name.toLowerCase().includes(typeLower) && i.name.toLowerCase().includes('milk'))
                || items.find(i => i.id === 'item_mixed_milk')
                || items.find(i => isLitreItem(i) && /\bmilk\b/i.test(i.name) && !/(powder|shake|flavou?red|condensed|cake)/i.test(i.name));

              if (itemDef) {
                  const { data: currItem } = await supabase.from('items').select('stock, cost_price, variant_stocks, variants').eq('id', itemDef.id).single();
                  const currentStock = currItem ? (Number(currItem.stock) || 0) : 0;
                  const currentCost = currItem ? (Number(currItem.cost_price) || Number(itemDef.cost_price) || 0) : (Number(itemDef.cost_price) || 0);
                  const newStock = roundQuantity(currentStock + item.quantity);
                  const incomingRate = Number(allocRecord.average_rate || details?.rate || currentCost) || 0;
                  const weightedCost = averageCostAfterIntake(stockOnHandBase(currentStock, currItem?.variant_stocks, currItem?.variants), currentCost, item.quantity, item.quantity * incomingRate);

                  // Add the litres as a delta so a counter sale syncing meanwhile is not overwritten.
                  const { error: counterStockError } = await adjustItemStock(itemDef.id, roundQuantity(item.quantity));
                  if (counterStockError) throw counterStockError;
                  if ((weightedCost || currentCost) > 0) {
                    await supabase.from('items').update({ cost_price: weightedCost || currentCost }).eq('id', itemDef.id);
                  }

                  setItems(prev => prev.map(i => i.id === itemDef.id ? { ...i, stock: newStock, cost_price: weightedCost || currentCost } : i));

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
        fetchData(['allocations', ...STOCK]);
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

          // Estimate output from the recipe yield when none is passed.
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

          setProductionBatches(prev => [dbBatch as ProductionBatch, ...prev]);

          const { error } = await supabase.from('production_batches').insert([dbBatch]);
          if (error) {
              console.error("Failed to create batch in Supabase:", error);
              showToast(`Failed to create batch in DB: ${error.message || 'Error'}`, "error");
              setProductionBatches(prev => prev.filter(b => b.id !== id));
              return false;
          }
          
          showToast(`Production batch ${dbBatch.batch_number} for ${safeProductName} created!`, "success");
          fetchData(['productionBatches']);
          return id;
      } catch (e: any) {
          console.error(e);
          showToast(`Batch creation error: ${e.message || 'Error'}`, "error");
          return false;
      }
    });

    return lockResult !== null ? lockResult : false;
  };

  // Removes a batch whose milk was never deducted (allocation failed right after createBatch).
  // Not a cancel: cancelling would return milk to stock that never left it.
  const discardBatch = async (batchId: string) => {
    const { error } = await supabase.from('production_batches').delete().eq('id', batchId);
    if (error) {
      console.error('Failed to discard batch:', error);
      showToast(`Batch remove nahi hua: ${error.message || 'Error'}`, 'error');
      return false;
    }
    setProductionBatches(prev => prev.filter(b => b.id !== batchId));
    // createBatch's own refresh may still be in flight with the batch in it: load again after the delete.
    fetchData(['productionBatches']);
    return true;
  };

  // Only one source's allocation went through (fresh pool or counter stock): the batch keeps just the
  // milk lines that actually left stock, so a later cancel returns only what was taken.
  const trimBatchToSource = async (batchId: string, keepSource: 'fresh' | 'retail') => {
    const { data: row, error: readError } = await supabase.from('production_batches').select('*').eq('id', batchId).single();
    if (readError || !row) {
      console.error('Failed to read batch for trim:', readError);
      showToast(`Batch update nahi hua: ${readError?.message || 'Batch not found'}`, 'error');
      return false;
    }
    const details: any = row.details || {};
    const breakdown: any[] = Array.isArray(details.milk_breakdown) ? details.milk_breakdown : [];
    const kept = breakdown.filter((m: any) => (m?.source === 'retail' ? 'retail' : 'fresh') === keepSource);
    const quantity = roundQuantity(kept.reduce((sum: number, m: any) => sum + (Number(m.quantity) || 0), 0));
    const value = kept.reduce((sum: number, m: any) => sum + (Number(m.quantity) || 0) * (Number(m.rate) || 0), 0);
    const rate = quantity > 0 ? value / quantity : Number(row.input_cost_per_unit) || 0;
    const oldQuantity = Number(row.quantity_input) || 0;
    const types = Array.from(new Set(kept.map((m: any) => String(m.milkType || 'Mixed').toLowerCase())));
    const milkType = types.length === 1 ? (types[0].includes('buffalo') ? 'Buffalo' : types[0].includes('cow') ? 'Cow' : 'Mixed') : 'Mixed';
    const update = {
      quantity_input: quantity,
      input_cost_per_unit: rate,
      quantity_output_estimated: roundQuantity(oldQuantity > 0 ? (Number(row.quantity_output_estimated) || 0) * quantity / oldQuantity : 0),
      details: { ...details, milk_breakdown: kept, milk_type: milkType, input_cost_per_unit: rate }
    };
    const { error } = await supabase.from('production_batches').update(update).eq('id', batchId);
    if (error) {
      console.error('Failed to trim batch:', error);
      showToast(`Batch update nahi hua: ${error.message || 'Error'}`, 'error');
      return false;
    }
    setProductionBatches(prev => prev.map(b => b.id === batchId ? { ...b, ...update } as any : b));
    fetchData(['productionBatches']);
    return true;
  };

  // Lines carry litres (production batches are in litres) unless they name another `unit`; each is
  // converted to the item's own stock unit, so 2 L taken from milk stocked in ml moves 2000 ml, not 2.
  const allocateFromRetailStock = async (itemsList: any[], destination: string, _details: any) => {
    const lockResult = await actionLock.runExclusive(`alloc_retail_${destination}`, async () => {
      try {
          const updatedInventory = [...inventory];
          const updatedItems = [...items];
          const customUnits = settings.inventory?.customUnits || [];

          const lines: Array<{ def: ItemDefinition; stockQty: number }> = [];
          for (const item of itemsList) {
            const rawId = String(item.itemId || item.id || '');
            const def = findLineItem<ItemDefinition>(items, { ...item, itemId: rawId.startsWith('inv_') ? rawId.slice(4) : rawId || undefined, id: undefined });
            if (!def) continue;
            const fromUnit = String(item.unit || 'L');
            const stockQty = convertQuantity(Number(item.quantity) || 0, fromUnit, def.unit || fromUnit, customUnits);
            if (stockQty === null) {
              showToast(`${def.name}: ${fromUnit} ko ${def.unit} mein badla nahi ja sakta. Ye item yahan allocate nahi ho sakta.`, 'error');
              return false;
            }
            lines.push({ def, stockQty: roundQuantity(stockQty) });
          }

          // Counter stock cannot be sent out beyond what is on hand (it went negative). Checked for
          // every line before anything moves, so a short line never leaves earlier lines deducted.
          const wanted = new Map<string, { name: string; unit: string; qty: number }>();
          for (const { def, stockQty } of lines) {
            const prev = wanted.get(def.id);
            wanted.set(def.id, { name: def.name, unit: def.unit || '', qty: roundQuantity((prev?.qty || 0) + stockQty) });
          }
          for (const [itemId, need] of wanted) {
            const { data: stockRow, error: stockError } = await supabase.from('items').select('stock').eq('id', itemId).single();
            if (stockError) throw stockError;
            const onHand = roundQuantity(Number(stockRow?.stock) || 0);
            if (need.qty > onHand + 0.001) {
              showToast(`${need.name}: sirf ${onHand} ${need.unit} stock hai, ${need.qty} allocate nahi ho sakta.`, 'error');
              return false;
            }
          }

          let logFailed = false;
          for (const { def: itemDef, stockQty } of lines) {
              const targetId = itemDef.id;
              const { data: currItem } = await supabase.from('items').select('stock, name').eq('id', targetId).single();

              const currentStock = currItem ? roundQuantity(currItem.stock || 0) : roundQuantity((itemDef as any).stock || 0);
              const deductQty = stockQty;
              const newStock = roundQuantity(currentStock - deductQty);

              const { error: allocStockError } = await adjustItemStock(targetId, -deductQty);
              if (allocStockError) throw allocStockError;
              
              const idxInv = updatedInventory.findIndex(i => i.item_id === targetId || i.id === `inv_${targetId}`);
              if (idxInv >= 0) {
                 updatedInventory[idxInv] = { ...updatedInventory[idxInv], quantity: newStock };
              }

              const idxItem = updatedItems.findIndex(i => i.id === targetId);
              if (idxItem >= 0) {
                 updatedItems[idxItem] = { ...updatedItems[idxItem], stock: newStock };
              }

              const { error: logError } = await supabase.from('inventory_logs').insert([{
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
              if (logError) {
                console.error('[allocateFromRetailStock] Stock log not saved:', logError);
                logFailed = true;
              }
          }
          setInventory(updatedInventory);
          setItems(updatedItems);
          if (logFailed) showToast('Stock nikal gaya, lekin stock history mein entry save nahi hui.', 'warning');
          fetchData(['allocations', ...STOCK]);
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

        // Idempotency: skip if the batch is already in the requested terminal stage.
        if (batch.status === newStage) {
          console.warn(`[Batch Idempotency] Batch ${batchId} is already in stage ${newStage}. Skipping duplicate.`);
          return true;
        }

        // Re-check the database as well, so a concurrent update cannot apply the stage twice.
        const { data: dbBatch } = await supabase.from('production_batches').select('status').eq('id', batchId).maybeSingle();
        if (dbBatch && dbBatch.status === newStage) {
          console.warn(`[Batch DB Idempotency] Batch ${batchId} is already ${newStage} in database. Skipping duplicate.`);
          return true;
        }

        // Completed stock is already on the shelf and may be sold; cancelling would return the milk a second time.
        if (newStage === ProductionStage.CANCELLED && (batch.status === ProductionStage.COMPLETED || dbBatch?.status === ProductionStage.COMPLETED)) {
          showToast("Completed batch cancel nahi ho sakta. Stock adjustment se correction karein.", "warning");
          return false;
        }

        const newLogs = [...(batch.logs || []), { stage: newStage, message: logMessage || `Moved to ${newStage}`, timestamp: new Date().toISOString() }];
        const updatePayload: any = { status: newStage, logs: newLogs };

        if (newStage === ProductionStage.COMPLETED) {
            updatePayload.completed_date = new Date().toISOString();
            
            const variantsList: any[] = outputData?.variants || [];
            const hasVariants = variantsList.length > 0;

            const variantBaseKg = variantsList.reduce((sum, v) => {
              const qtyEach = v.base_qty_each !== undefined ? Number(v.base_qty_each) || 0 : (v.total_base_qty ? (Number(v.total_base_qty) || 0) / (Number(v.count) || 1) : 0);
              const totalBase = v.total_base_qty !== undefined ? Number(v.total_base_qty) || 0 : (qtyEach * (Number(v.count) || 0));
              return sum + totalBase;
            }, 0);

            const looseQty = outputData?.looseQty !== undefined 
              ? (Number(outputData.looseQty) || 0) 
              : (hasVariants ? 0 : (batch.quantity_output_estimated || (batch.quantity_input ? batch.quantity_input * 0.85 : 0)));

            // Total production output in base units (e.g. 11.5 kg = 0.5 kg loose + 11 kg packaged).
            let actualTotalOutput = roundQuantity(looseQty + variantBaseKg);
            // An entered output of zero is a real result (spoilt batch); only a missing entry falls back to the estimate.
            if (actualTotalOutput <= 0 && !outputData) {
               actualTotalOutput = roundQuantity(batch.quantity_output_estimated || (batch.quantity_input ? batch.quantity_input * 0.85 : 0));
            }

            updatePayload.quantity_output_actual = actualTotalOutput;
            // Keep pack sizes/counts as they were at completion. A later catalog edit
            // must not change the historical stock-profit report.
            const costProduct = items.find(i => i.name.trim().toLowerCase() === String(batch.product_name || '').trim().toLowerCase());
            const recipeInputs = (costProduct?.recipe || []).map(ingredient => {
              const material = items.find(i => i.id === ingredient.item_id);
              const scale = costProduct?.recipe_base_quantity ? (batch.quantity_input || 0) / costProduct.recipe_base_quantity : 0;
              // Recipe amounts may be written in g/ml while the material is stocked in kg/L: deduct in the stock unit.
              const recipeQty = (Number(ingredient.quantity) || 0) * scale;
              const stockUnit = material?.unit || ingredient.unit;
              const inStockUnit = ingredient.unit && stockUnit ? convertQuantity(recipeQty, ingredient.unit, stockUnit, settings.inventory?.customUnits || []) : recipeQty;
              return { item_id: ingredient.item_id, name: material?.name || ingredient.item_name, quantity: roundQuantity(inStockUnit ?? recipeQty), unit: stockUnit, unit_cost: material?.cost_price || 0 };
            });
            const packagingInputs = variantsList.flatMap(v => {
              const variant = costProduct?.variants?.find(def => def.id === v.variantId);
              const material = items.find(i => i.id === variant?.packaging_item_id);
              return variant?.packaging_item_id ? [{ item_id: variant.packaging_item_id, name: material?.name || variant.packaging_item_name, quantity: roundQuantity((Number(v.count) || 0) * (variant.packaging_qty || 0)), unit: material?.unit, unit_cost: material?.cost_price || 0 }] : [];
            });

            const milkCostTotal = roundCurrency((batch.quantity_input || 0) * (batch.input_cost_per_unit || batch.details?.input_cost_per_unit || 0));
            const ingredientsCostTotal = roundCurrency(recipeInputs.reduce((s, r) => s + (r.quantity * (r.unit_cost || 0)), 0));
            const packagingCostTotal = roundCurrency(packagingInputs.reduce((s, p) => s + (p.quantity * (p.unit_cost || 0)), 0));
            const totalBatchCost = roundCurrency(milkCostTotal + ingredientsCostTotal + packagingCostTotal);
            const producedUnitCost = actualTotalOutput > 0 ? roundCurrency(totalBatchCost / actualTotalOutput) : (costProduct?.cost_price || 180);

            updatePayload.details = {
              ...(batch.details || {}),
              output_breakdown: { loose_qty: hasVariants ? looseQty : actualTotalOutput, variants: variantsList },
              cost_snapshot: {
                saved_at: updatePayload.completed_date,
                milk_cost: milkCostTotal,
                ingredients: recipeInputs,
                packaging: packagingInputs,
                recipe_inputs: recipeInputs,
                packaging_inputs: packagingInputs,
                materials_posted: true,
                external_conversion_cost: 0
              }
            };
            
            // Deterministic log ID for this batch completion to prevent double-increment
            const deterministicLogId = `log_prod_${batch.id}`;
            
            // Check if log already exists in Supabase (idempotency guard)
            const { data: existingLog } = await supabase.from('inventory_logs').select('id').eq('id', deterministicLogId).maybeSingle();
            
            if (!existingLog) {
                const allMaterialInputs = [...recipeInputs, ...packagingInputs].filter(inp => inp.item_id && inp.quantity > 0);
                const matTotalsById = new Map<string, { item_id: string; name: string; quantity: number }>();
                for (const inp of allMaterialInputs) {
                  const prev = matTotalsById.get(inp.item_id);
                  if (prev) {
                    prev.quantity = roundQuantity(prev.quantity + inp.quantity);
                  } else {
                    matTotalsById.set(inp.item_id, { item_id: inp.item_id, name: inp.name, quantity: roundQuantity(inp.quantity) });
                  }
                }
                for (const mat of matTotalsById.values()) {
                  const { data: matRow } = await supabase.from('items').select('stock, name').eq('id', mat.item_id).maybeSingle();
                  if (matRow) {
                    const oldMatStock = Number(matRow.stock) || 0;
                    const newMatStock = roundQuantity(oldMatStock - mat.quantity);
                    await adjustItemStock(mat.item_id, -mat.quantity);
                    setInventory(prev => prev.map(i => i.item_id === mat.item_id ? { ...i, quantity: newMatStock } : i));
                    setItems(prev => prev.map(i => i.id === mat.item_id ? { ...i, stock: newMatStock } : i));
                    await supabase.from('inventory_logs').insert([{
                      id: `log_prod_mat_${batch.id}_${mat.item_id}`,
                      date: updatePayload.completed_date,
                      item_id: mat.item_id,
                      item_name: matRow.name || mat.name,
                      old_quantity: oldMatStock,
                      new_quantity: newMatStock,
                      difference: -mat.quantity,
                      reason: 'Production Usage',
                      notes: `Consumed in Batch #${batch.batch_number} (${batch.product_name})`
                    }]);
                  }
                }

                const batchProdName = (batch.product_name || '').trim().toLowerCase();
                const item = items.find(i => i.name.trim().toLowerCase() === batchProdName) 
                        || items.find(i => i.name.toLowerCase().includes(batchProdName) || batchProdName.includes(i.name.toLowerCase()));

                if (item) {
                    const { data: currentItem } = await supabase.from('items').select('stock, variant_stocks, cost_price').eq('id', item.id).single();
                    const currentStock = currentItem ? (currentItem.stock || 0) : 0;
                    const currentCostPrice = currentItem ? (Number(currentItem.cost_price) || Number(item.cost_price) || 0) : (Number(item.cost_price) || 0);

                    // Same averaging pool as purchases: loose + packed piles, negatives count as zero.
                    const existingTotalBase = stockOnHandBase(currentStock, currentItem?.variant_stocks, item?.variants);
                    const newWacCost = (actualTotalOutput > 0 && totalBatchCost > 0)
                      ? averageCostAfterIntake(existingTotalBase, currentCostPrice, actualTotalOutput, totalBatchCost)
                      : currentCostPrice;

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
                    if (newWacCost > 0) {
                      await supabase.from('items').update({ cost_price: newWacCost }).eq('id', item.id);
                    }
                    const newVariantStocks = currentItem?.variant_stocks ? { ...currentItem.variant_stocks } : {};
                    Object.entries(variantDeltas).forEach(([vId, qty]) => {
                      newVariantStocks[vId] = roundQuantity((newVariantStocks[vId] || 0) + qty);
                    });
                    
                    setInventory(prev => prev.map(i => i.item_id === item!.id ? { ...i, quantity: newLooseStock, variant_stocks: newVariantStocks } : i));
                    setItems(prev => prev.map(i => i.id === item!.id ? { ...i, stock: newLooseStock, variant_stocks: newVariantStocks, cost_price: newWacCost || i.cost_price } : i));

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
                        notes: logNote.trim(),
                        details: { loose_delta: looseToAdd, variant_deltas: variantDeltas, batch_id: batch.id }
                    }]);
                } else {
                    // Create the item in the items master if it does not exist yet.
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
                        cost_price: producedUnitCost > 0 ? producedUnitCost : 180,
                        selling_price: producedUnitCost > 0 ? roundCurrency(producedUnitCost * 1.25) : 240,
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

            // Return the input milk to the unallocated pool unless the batch was already cancelled.
            if (batch.status !== ProductionStage.CANCELLED && batch.quantity_input && batch.quantity_input > 0) {
                const returnAllocId = `alloc_ret_batch_${batch.id}`;

                // Milk taken from counter stock goes back to counter stock, not into the bulk pool
                // (that turned retail litres into fresh unallocated milk a second time).
                const cancelDetails: any = batch.details || {};
                const retailParts: any[] = Array.isArray(cancelDetails.milk_breakdown)
                  ? cancelDetails.milk_breakdown.filter((m: any) => m?.source === 'retail' && Number(m.quantity) > 0)
                  : [];
                let retailReturned = 0;
                for (const part of retailParts) {
                  const rawId = String(part.allocationId || '');
                  const retailItemId = rawId.startsWith('inv_') ? rawId.slice(4) : rawId;
                  const retailDef = items.find(i => i.id === retailItemId);
                  if (!retailDef) continue;
                  const partQty = roundQuantity(Number(part.quantity) || 0);
                  // The batch counts litres; the item may be stocked in ml.
                  const stockQty = roundQuantity(convertQuantity(partQty, 'L', retailDef.unit || 'L', settings.inventory?.customUnits || []) ?? partQty);
                  // Deterministic log id first: a retry finds it and does not add the litres twice.
                  const { error: retailLogError } = await supabase.from('inventory_logs').insert([{
                    id: `log_batch_cancel_${batch.id}_${retailItemId}`,
                    date: new Date().toISOString(),
                    item_id: retailItemId,
                    item_name: retailDef.name,
                    old_quantity: roundQuantity(Number((retailDef as any).stock) || 0),
                    new_quantity: roundQuantity((Number((retailDef as any).stock) || 0) + stockQty),
                    difference: stockQty,
                    reason: 'Allocation',
                    notes: `Batch #${batch.batch_number} cancelled: counter milk returned`,
                    details: { loose_delta: stockQty, batch_id: batch.id }
                  }]);
                  if (retailLogError && retailLogError.code !== '23505') throw retailLogError;
                  if (!retailLogError) {
                    const { error: retailStockError } = await adjustItemStock(retailItemId, stockQty);
                    if (retailStockError) {
                      await supabase.from('inventory_logs').delete().eq('id', `log_batch_cancel_${batch.id}_${retailItemId}`);
                      throw retailStockError;
                    }
                    setItems(prev => prev.map(i => i.id === retailItemId ? { ...i, stock: roundQuantity((Number((i as any).stock) || 0) + stockQty) } as any : i));
                    setInventory(prev => prev.map(inv => inv.item_id === retailItemId ? { ...inv, quantity: roundQuantity((inv.quantity || 0) + stockQty) } : inv));
                  }
                  retailReturned = roundQuantity(retailReturned + partQty);
                }
                const poolReturnQty = roundQuantity(Math.max(0, batch.quantity_input - retailReturned));

                // Idempotency check on allocation return
                const { data: existingAlloc } = await supabase.from('allocations').select('id').eq('id', returnAllocId).maybeSingle();
                if (!existingAlloc && poolReturnQty > 0) {
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
                        original_quantity: poolReturnQty,
                        allocated_quantity: 0,
                        remaining_quantity: poolReturnQty,
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
                    // A lost return must not be reported as success: the milk would vanish from the pool.
                    if (allocErr) throw allocErr;

                    setAllocations(prev => [returnRecord, ...prev]);
                }
                showToast(`Batch #${batch.batch_number} cancelled. ${batch.quantity_input} L returned${retailReturned > 0 ? ` (${retailReturned} L to counter stock)` : ''}.`, "success");
            }
        }

        const updatedBatch = { ...batch, ...updatePayload };
        setProductionBatches(prev => {
            const newList = [...prev];
            newList[batchIndex] = updatedBatch;
            return newList;
        });

        const { error: batchUpdateError } = await supabase.from('production_batches').update(updatePayload).eq('id', batchId);
        if (batchUpdateError) throw batchUpdateError;
        // No success toast here: the Production screen announces each move and completion itself
        // (two toasts appeared for every stage move).
        fetchData(['productionBatches', 'allocations', ...STOCK]);
        return true;
      } catch (e) {
        console.error(e);
        showToast('Batch update nahi hua: ' + getErrorMessage(e), 'error');
        fetchData(['productionBatches', 'allocations', ...STOCK]);
        return false;
      }
    });

    return lockResult !== null ? lockResult : false;
  };

  const cancelBatch = async (id: string, reason: string) => {
      return updateBatchStage(id, ProductionStage.CANCELLED, `Cancelled: ${reason}`);
  };
  
  // True when an account is the till of the shift that is open right now.
  const isActiveDrawerAccount = (accountId?: string | null) => {
    if (!accountId || activeShiftSession?.status !== 'Active') return false;
    return accountId === activeShiftSession.account_id
      || accountId === activeShiftSession.drawer_id
      || accountId === resolveDrawerAccountId(activeShiftSession.drawer_id);
  };

  // The open drawer's account ids: the money RPCs tag a cash row with the shift only when it moves one of these.
  const activeDrawerAccountIds = (): string[] => {
    if (activeShiftSession?.status !== 'Active') return [];
    return [activeShiftSession.account_id, activeShiftSession.drawer_id, resolveDrawerAccountId(activeShiftSession.drawer_id)]
      .filter((id): id is string => Boolean(id));
  };

  // One all-or-nothing money RPC. The request id is reused until the server answers for sure, so a
  // Save pressed again after a lost response cannot post twice (see lib/moneyRpc.ts).
  const callMoneyRpc = async (fn: string, key: string, args: (requestId: string) => Record<string, unknown>): Promise<any> => {
    const requestId = requestIdFor(key, generateUUID);
    const { data, error } = await supabase.rpc(fn, args(requestId));
    settleRequest(key, error);
    if (error) throw error;
    return data;
  };

  // One return per intake at a time, also across tabs: a double tap returned the milk (and refunded) twice.
  const returnPurchase = async (...args: Parameters<typeof returnPurchaseUnlocked>): Promise<boolean> => {
    const result = await actionLock.runExclusiveAcrossTabs(`return_purchase_${args[0]}`, () => returnPurchaseUnlocked(...args));
    if (result === null) {
      showToast('Is entry ka return pehle se chal raha hai.', 'warning');
      return false;
    }
    return result;
  };

  const returnPurchaseUnlocked = async (purchaseId: string, returnQty?: number, reason: string = 'Milk Return to Supplier', refundAs: 'cash' | 'khata' = 'cash'): Promise<boolean> => {
    try {
      const purchase = purchases.find(p => p.id === purchaseId);
      if (!purchase) {
        showToast("Purchase record not found", "error");
        return false;
      }
      if (reason === 'Deleted by user' && !guardOpenPeriod(purchase.date)) return false;

      if (purchase.status === 'Returned') {
        showToast("This purchase entry is already fully returned", "warning");
        return false;
      }

      const totalPurchaseQty = purchase.quantity || 0;
      const actualReturnQty = (returnQty !== undefined && returnQty > 0 && returnQty <= totalPurchaseQty) 
        ? returnQty 
        : totalPurchaseQty;
      
      // Enough unallocated milk must still be in the pool to return it.
      const alloc = allocations.find(a => a.purchase_id === purchaseId || a.id === `alloc_${purchaseId}`);
      if (alloc) {
        const remainingUnallocated = alloc.remaining_quantity !== null && alloc.remaining_quantity !== undefined 
          ? alloc.remaining_quantity 
          : (alloc.status === AllocationStatus.FULLY_ALLOCATED ? 0 : alloc.original_quantity);
        
        if (remainingUnallocated < actualReturnQty) {
          showToast(`Cannot return ${actualReturnQty} L: Only ${remainingUnallocated} L remains unallocated. (${alloc.allocated_quantity || 0} L was already allocated to processing).`, "error");
          return false;
        }
      }

      // Intake, milk pool, cash refund, khata, supplier ledger and stock log move together in
      // return_milk_purchase, computed from the locked intake row; the screen follows its answer.
      const result = await callMoneyRpc('return_milk_purchase', `milk_return:${purchaseId}:${actualReturnQty}:${refundAs}:${reason}`, requestId => ({
        p_purchase_id: purchaseId,
        p_return_id: requestId,
        p_payload: {
          return_qty: actualReturnQty < totalPurchaseQty ? actualReturnQty : null,
          reason,
          refund_as: refundAs,
          business_day_id: activeShiftSession?.business_day_id || null,
          shift_session_id: activeShiftSession?.id || null,
          drawer_id: activeShiftSession?.drawer_id || null,
          cashier_id: activeShiftSession?.user_id || currentUser?.id || null,
          drawer_account_ids: activeDrawerAccountIds()
        }
      }));

      if (result?.already_applied) {
        showToast('Ye return pehle hi save ho chuka tha.', 'info');
        fetchData(['purchases', 'allocations', 'suppliers', 'supplierTransactions', 'inventoryLogs', ...MONEY_ADDED]);
        return true;
      }

      const returnedQty = Number(result?.return_qty) || actualReturnQty;
      const returnAmount = roundCurrency(Number(result?.return_amount) || 0);
      const cashRefundAmount = roundCurrency(Number(result?.cash_refund) || 0);
      const supplierCredit = roundCurrency(Number(result?.supplier_credit) || 0);
      const remainingAcceptedQty = roundQuantity(Number(result?.remaining_qty) || 0);
      if (result?.is_full) {
        setPurchases(prev => prev.map(p => p.id === purchaseId ? {
          ...p,
          status: 'Returned',
          return_reason: reason,
          returned_at: new Date().toISOString(),
          details: result.details
        } as any : p));
        if (alloc) setAllocations(prev => prev.filter(a => a.id !== alloc.id));
      } else {
        const remainingAmount = roundCurrency(Number(result?.remaining_amount) || 0);
        const remainingPaid = roundCurrency(Number(result?.remaining_paid) || 0);
        setPurchases(prev => prev.map(p => p.id === purchaseId ? {
          ...p,
          quantity: remainingAcceptedQty,
          total_amount: remainingAmount,
          paid_amount: remainingPaid,
          due_amount: roundCurrency(Math.max(0, remainingAmount - remainingPaid)),
          return_reason: `Partial Return: ${returnedQty}L returned (${reason})`,
          details: result?.details
        } as any : p));
        if (alloc) {
          setAllocations(prev => prev.map(a => a.id === alloc.id ? {
            ...a,
            original_quantity: roundQuantity(Math.max(0, a.original_quantity - returnedQty)),
            remaining_quantity: roundQuantity(Math.max(0, (a.remaining_quantity ?? a.original_quantity) - returnedQty))
          } : a));
        }
      }
      if (cashRefundAmount > 0 && result?.account_id) {
        setAccounts(prev => prev.map(a => a.id === result.account_id ? { ...a, balance: roundCurrency((a.balance || 0) + cashRefundAmount) } : a));
      }
      if (supplierCredit > 0) {
        setSuppliers(prev => prev.map(s => s.id === purchase.supplier_id ? {
          ...s,
          pending_balance: roundCurrency((s.pending_balance || 0) - supplierCredit),
          balance: roundCurrency((s.pending_balance || 0) - supplierCredit)
        } : s));
      }

      showToast(
        result?.is_full
          ? `Full milk purchase of ${returnedQty}L returned to supplier! Balance reduced by Rs ${returnAmount.toLocaleString()}.`
          : `Partial return of ${returnedQty}L processed! ${remainingAcceptedQty}L kept (Rs ${returnAmount.toLocaleString()} deducted from supplier).`,
        "success"
      );
      fetchData(['purchases', 'allocations', 'suppliers', 'supplierTransactions', 'inventoryLogs', ...MONEY_ADDED]);
      return true;
    } catch (err: any) {
      console.error("returnPurchase error:", err);
      showToast(`Doodh wapas nahi hua: ${moneyRpcMessage(err)}`, "error");
      return false;
    }
  };

  const returnMaterialPurchase = async (purchaseId: string, returnQty?: number, reason: string = 'Material Return to Supplier', refundAs: 'cash' | 'khata' = 'cash'): Promise<boolean> => {
    try {
      const mp = materialPurchases.find(p => p.id === purchaseId);
      if (!mp) {
        showToast("Material purchase record not found", "error");
        return false;
      }
      if (reason === 'Deleted by user' && !guardOpenPeriod(mp.date)) return false;

      if (mp.status === 'Returned') {
        showToast("This material purchase is already returned", "warning");
        return false;
      }

      const totalPurchaseQty = mp.quantity || 0;
      const actualReturnQty = (returnQty !== undefined && returnQty > 0 && returnQty <= totalPurchaseQty) 
        ? returnQty 
        : totalPurchaseQty;
      
      const isFullReturn = actualReturnQty >= totalPurchaseQty;
      const returnAmount = roundCurrency(actualReturnQty * (mp.rate || 0));
      const remainingAcceptedQty = Number((totalPurchaseQty - actualReturnQty).toFixed(3));
      const remainingAcceptedAmount = roundCurrency(remainingAcceptedQty * (mp.rate || 0));

      const returnTimestamp = new Date().toISOString();
      const prevDetails = ((mp as any).details || {}) as any;
      const origPaidAmount = Number((mp as any).paid_amount || prevDetails.paid_amount || 0);
      const paymentAccountId = prevDetails.account_id || (mp as any).account_id;
      const totalAmount = Number(mp.total_amount || 0) || (totalPurchaseQty * (mp.rate || 0));
      const paidRatio = totalAmount > 0 ? (origPaidAmount / totalAmount) : 0;
      // 'khata': the supplier keeps the money and lowers what we owe (or it becomes our advance).
      const cashRefundAmount = refundAs !== 'khata' && origPaidAmount > 0 && paymentAccountId
        ? roundCurrency(Math.min(origPaidAmount, returnAmount * paidRatio))
        : 0;
      const remainingPaid = roundCurrency(Math.max(0, origPaidAmount - cashRefundAmount));

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
          returned_quantity: (Number(prevDetails.returned_quantity) || 0) + actualReturnQty,
          original_quantity: prevDetails.original_intake_quantity || prevDetails.original_quantity || totalPurchaseQty,
          original_intake_quantity: prevDetails.original_intake_quantity || prevDetails.original_quantity || totalPurchaseQty,
          original_paid_amount: prevDetails.original_paid_amount ?? origPaidAmount,
          paid_amount: remainingPaid,
          account_id: paymentAccountId,
          cash_refund: roundCurrency((Number(prevDetails.cash_refund) || 0) + cashRefundAmount)
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
          original_quantity: prevDetails.original_intake_quantity || prevDetails.original_quantity || totalPurchaseQty,
          original_intake_quantity: prevDetails.original_intake_quantity || prevDetails.original_quantity || totalPurchaseQty,
          return_reason: reason,
          base_quantity: roundQuantity(remainingAcceptedQty * (Number(prevDetails.conversion_factor) || 1)),
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

      if (itemDef) {
        const returnConversion = Number(prevDetails.conversion_factor) || 1;
        const actualReturnBaseQty = roundQuantity(actualReturnQty * returnConversion);
        // Goods leave the pile they were stocked into: ready-made packs go back as packs.
        const packId: string | undefined = prevDetails.variant_id && (itemDef.variants || []).some(v => v.id === prevDetails.variant_id) ? prevDetails.variant_id : undefined;
        const invRow = inventory.find(inv => inv.item_id === itemDef.id);
        const oldLoose = roundQuantity(invRow?.quantity ?? (itemDef as any).stock ?? 0);
        const oldPack = packId ? roundQuantity((invRow?.variant_stocks || itemDef.variant_stocks || {})[packId] || 0) : 0;
        const { error: mpStockError } = packId
          ? await adjustItemStock(itemDef.id, 0, { [packId]: -actualReturnQty })
          : await adjustItemStock(itemDef.id, -actualReturnBaseQty);
        if (mpStockError) throw mpStockError;
        setInventory(prev => prev.map(inv => inv.item_id !== itemDef.id ? inv : packId
          ? { ...inv, variant_stocks: { ...(inv.variant_stocks || {}), [packId]: roundQuantity((inv.variant_stocks?.[packId] || 0) - actualReturnQty) } }
          : { ...inv, quantity: roundQuantity((inv.quantity || 0) - actualReturnBaseQty) }));
        setItems(prev => prev.map(i => i.id !== itemDef.id ? i : packId
          ? { ...i, variant_stocks: { ...(i.variant_stocks || {}), [packId]: roundQuantity((Number(i.variant_stocks?.[packId]) || 0) - actualReturnQty) } }
          : { ...i, stock: roundQuantity((Number((i as any).stock) || 0) - actualReturnBaseQty) } as any));

        // Take the returned goods out of the average at the rate they came in at.
        const onHandBase = stockOnHandBase(oldLoose, invRow?.variant_stocks || itemDef.variant_stocks, itemDef.variants);
        const returnedBaseRate = returnConversion > 0 ? (Number(mp.rate) || 0) / returnConversion : 0;
        const leftBase = onHandBase - actualReturnBaseQty;
        if (leftBase > 0.0005 && returnedBaseRate > 0 && Number(itemDef.cost_price) > 0) {
          const revisedCost = Math.round(((onHandBase * Number(itemDef.cost_price) - actualReturnBaseQty * returnedBaseRate) / leftBase) * 10000) / 10000;
          if (revisedCost > 0) {
            await supabase.from('items').update({ cost_price: revisedCost }).eq('id', itemDef.id);
            setItems(prev => prev.map(i => i.id === itemDef.id ? { ...i, cost_price: revisedCost } : i));
          }
        }

        await supabase.from('inventory_logs').insert([{
          id: `log_mp_ret_${generateUUID()}`,
          date: returnTimestamp,
          item_id: itemDef.id,
          item_name: itemDef.name,
          old_quantity: packId ? oldPack : oldLoose,
          new_quantity: packId ? roundQuantity(oldPack - actualReturnQty) : roundQuantity(oldLoose - actualReturnBaseQty),
          difference: packId ? 0 : -actualReturnBaseQty,
          reason: AdjustmentReason.SUPPLY_RETURN,
          notes: `${isFullReturn ? 'Full' : 'Partial'} Material Return to Supplier: ${actualReturnQty} ${mp.unit} (${reason})`,
          details: packId
            ? { variant_id: packId, variant_delta: -actualReturnQty, loose_delta: 0, purchase_id: mp.id }
            : { loose_delta: -actualReturnBaseQty, purchase_id: mp.id }
        }]);
      }

      // A material purchase paid on the spot (cash/bank) refunds the paid amount back to that account.
      if (cashRefundAmount > 0 && paymentAccountId) {
          // A failed refund must stop here: continuing would lower the khata by less than the return.
          const { error: accRefundErr } = await adjustAccountBalance(paymentAccountId, cashRefundAmount);
          if (accRefundErr) throw accRefundErr;
          setAccounts(prev => prev.map(a => a.id === paymentAccountId ? { ...a, balance: (a.balance || 0) + cashRefundAmount } : a));

          // Only cash received into the open drawer belongs to this shift's count.
          const intoActiveDrawer = isActiveDrawerAccount(paymentAccountId);
          const btxRecord = {
            id: `btx_mpret_${generateUUID()}`,
            account_id: paymentAccountId,
            amount: cashRefundAmount,
            date: returnTimestamp,
            type: 'Income',
            category: 'Purchase Return',
            description: `Material Return Cash Refund: ${mp.item_name} (${actualReturnQty} ${mp.unit})`,
            reference_id: mp.id,
            business_day_id: activeShiftSession?.business_day_id,
            shift_session_id: intoActiveDrawer ? activeShiftSession?.id : null,
            drawer_id: intoActiveDrawer ? activeShiftSession?.drawer_id : null,
            cashier_id: activeShiftSession?.user_id
          };
          const { error: mpRefundBtxError } = await supabase.from('bank_transactions').insert([btxRecord]);
          if (mpRefundBtxError) throw mpRefundBtxError;
          setBankTransactions(prev => [btxRecord as any, ...prev]);
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
        const { error: mpReturnTxError } = await supabase.from('supplier_transactions').insert([{
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
        if (mpReturnTxError) throw mpReturnTxError;
      }

      showToast(
        isFullReturn 
          ? `Full material purchase of ${actualReturnQty} ${mp.unit} returned to supplier!` 
          : `Partial return of ${actualReturnQty} ${mp.unit} returned! ${remainingAcceptedQty} ${mp.unit} kept.`,
        "success"
      );

      fetchData(['materialPurchases', 'suppliers', 'supplierTransactions', ...STOCK, ...MONEY_ADDED]);
      return true;
    } catch (err: any) {
      console.error("returnMaterialPurchase error:", err);
      showToast(`Failed to return material purchase: ${err?.message || 'Error'}`, "error");
      return false;
    }
  };

  const deletePurchase = async (id: string) => { return returnPurchase(id, undefined, 'Deleted by user'); };
  const deleteMaterialPurchase = async (id: string) => { return returnMaterialPurchase(id, undefined, 'Deleted by user'); };
  
  // One bill per supplier at a time: a double click used to save the whole bill (stock, khata, cash) twice.
  const addBulkMaterialPurchase = async (data: any) => {
    const lockResult = await actionLock.runExclusive(`add_material_purchase_${data?.supplier_id || 'spot'}`, () => addBulkMaterialPurchaseUnlocked(data), 60000);
    return lockResult !== null ? lockResult : false;
  };

  const addBulkMaterialPurchaseUnlocked = async (data: any) => {
      try {
          const { supplier_id, date, items: cartItems, purchase_type, paid_amount, payment_mode, account_id } = data;
          if (!guardOpenPeriod(date)) return false;
          const totalBill = roundCurrency(cartItems.reduce((sum: number, item: any) => sum + (Number(item.quantity) || 0) * (Number(item.rate) || 0), 0));
          const requestedPaid = roundCurrency(paid_amount !== undefined ? Math.max(0, Number(paid_amount) || 0) : (!supplier_id ? totalBill : 0));
          if (requestedPaid > totalBill + 0.01) {
            throw new Error(`Paid (Rs ${requestedPaid.toLocaleString()}) bill (Rs ${totalBill.toLocaleString()}) se zyada hai. Zyada raqam supplier ko alag Advance payment ke taur par dein.`);
          }
          const effectivePaid = roundCurrency(Math.min(requestedPaid, totalBill));

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

          // A purchase line bought in a ready-made pack unit (not a dozen/tray view of loose stock).
          const packVariants: (ItemVariant | undefined)[] = cartItems.map((item: any) => {
            const def = items.find(i => i.id === item.item_id);
            const unitName = String(item.unit || '').trim().toLowerCase();
            if (!def || !unitName || unitName === String(def.unit || '').trim().toLowerCase()) return undefined;
            return (def.variants || []).find(v => v.isActive !== false && v.deduct_from_base !== true && String(v.name || '').trim().toLowerCase() === unitName);
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
                    base_unit: item.base_unit || item.unit,
                    variant_id: packVariants[index]?.id,
                    stocked_as: packVariants[index] ? 'packs' : 'loose'
                  }
              };

              const { paid_amount: _linePaid, due_amount: _lineDue, ...materialRow } = mpEntry;
              // Read the item first: if it cannot be read, nothing for this line is written yet, and a
              // failed read must never be treated as "0 stock, 0 cost" (that overwrote the average cost).
              const { data: currItem, error: currItemError } = await supabase.from('items').select('stock, cost_price, variant_stocks, variants').eq('id', item.item_id).single();
              if (currItemError || !currItem) throw new Error(`${item.item_name}: item ka stock nahi parha ja saka. Bill save nahi hua.`);

              const { error: mpInsertError } = await supabase.from('material_purchases').insert([materialRow]);
              if (mpInsertError) throw mpInsertError;
              setMaterialPurchases(prev => [mpEntry as any, ...prev]);

              const currentStock = roundQuantity(currItem.stock);
              const currentCostPrice = Number(currItem.cost_price) || 0;
              const conversion = Number(item.conversion_factor) || 1;
              const stockIncrease = roundQuantity((Number(item.quantity) || 0) * conversion);
              // Cost is averaged over everything on hand (loose + packed piles), the same pool production uses.
              const onHandBase = stockOnHandBase(currentStock, currItem?.variant_stocks, currItem?.variants);
              const newWacCost = averageCostAfterIntake(onHandBase, currentCostPrice, stockIncrease, lineTotal);
              const packVariantId: string | undefined = packVariants[index]?.id;
              const packQty = roundQuantity(Number(item.quantity) || 0);
              const currentPackStock = packVariantId ? roundQuantity(Number(currItem?.variant_stocks?.[packVariantId]) || 0) : 0;
              const newStock = packVariantId ? currentStock : roundQuantity(currentStock + stockIncrease);

              // A ready-made pack (e.g. Rusk 500g) is stocked as packs, because that is the pile the POS sells from.
              const { error: mpInStockError } = packVariantId
                ? await adjustItemStock(item.item_id, 0, { [packVariantId]: packQty })
                : await adjustItemStock(item.item_id, stockIncrease);
              if (mpInStockError) throw mpInStockError;
              if (newWacCost > 0) {
                await supabase.from('items').update({ cost_price: newWacCost }).eq('id', item.item_id);
              }
              setInventory(prev => prev.map(i => i.item_id !== item.item_id ? i : packVariantId
                ? { ...i, variant_stocks: { ...(i.variant_stocks || {}), [packVariantId]: roundQuantity(currentPackStock + packQty) } }
                : { ...i, quantity: newStock }));
              setItems(prev => prev.map(i => i.id !== item.item_id ? i : {
                ...i,
                ...(packVariantId
                  ? { variant_stocks: { ...(i.variant_stocks || {}), [packVariantId]: roundQuantity(currentPackStock + packQty) } }
                  : { stock: newStock }),
                cost_price: newWacCost || i.cost_price
              }));

              const unitNote = conversion !== 1 ? ` (${item.quantity} ${item.unit} = ${stockIncrease} base units${packVariantId ? ', stocked as packs' : ''})` : '';
              await supabase.from('inventory_logs').insert([{
                  id: `log_purch_${generateUUID()}`,
                  date: new Date().toISOString(),
                  item_id: item.item_id, 
                  item_name: item.item_name, 
                  old_quantity: packVariantId ? currentPackStock : currentStock,
                  new_quantity: packVariantId ? roundQuantity(currentPackStock + packQty) : newStock, 
                  difference: packVariantId ? 0 : stockIncrease, 
                  reason: 'Purchase', 
                  notes: supplier_id 
                    ? `Vendor: ${supplier_id}${unitNote}`
                    : `Spot Cash Purchase${unitNote}`,
                  details: packVariantId
                    ? { variant_id: packVariantId, variant_delta: packQty, loose_delta: 0, purchase_id: materialId }
                    : { loose_delta: stockIncrease, purchase_id: materialId }
              }]);
          }

          const unpaid = roundCurrency(Math.max(0, totalBill - effectivePaid));

          if (supplier_id && unpaid > 0) {
              const { data: newSupplierBalance, error: supUnpaidError } = await adjustSupplierBalance(supplier_id, unpaid);
              if (supUnpaidError) throw supUnpaidError;
              const newBal = roundCurrency(Number(newSupplierBalance ?? 0));
              setSuppliers(prev => prev.map(s => s.id === supplier_id ? { ...s, pending_balance: newBal, balance: newBal } : s));
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
              const { error: mpBtxError } = await supabase.from('bank_transactions').insert([btxRecord]);
              if (mpBtxError) throw mpBtxError;
              setBankTransactions(prev => [btxRecord as any, ...prev]);
            }
          }

          // If payment was made on the spot for a linked supplier, record payment in supplier_transactions.
          // supplier_transactions keeps mode/note/account in `details` (the table has no such columns,
          // so the old top-level insert was rejected). purchase_ids links the one bill payment to every
          // line, so the statement does not invent a second spot payment per line.
          if (supplier_id && effectivePaid > 0) {
            const stxId = `stx_mp_${generateUUID()}`;
            const normalizedMpDate = normalizeTransactionTimestamp(date);
            const stxDetails = {
              mode: payment_mode || 'Cash',
              note: `Spot Payment for Material Purchase (${cartItems.map((i: any) => `${i.quantity} ${i.unit || ''} ${i.item_name}`).join(', ')})`,
              account_id: resolvedTargetAccId,
              purchase_ids: createdMaterialIds,
              line_paid: Object.fromEntries(createdMaterialIds.map((id, index) => [id, linePaids[index]]))
            };
            const { error: stxError } = await supabase.from('supplier_transactions').insert([{
              id: stxId,
              supplier_id,
              date: normalizedMpDate,
              type: 'Payment',
              amount: effectivePaid,
              details: stxDetails
            }]);
            if (stxError) throw stxError;
            setSupplierTransactions(prev => [{ id: stxId, supplier_id, date: normalizedMpDate, type: 'Payment', amount: effectivePaid, ...stxDetails, details: stxDetails } as any, ...prev]);
          }

          fetchData(['materialPurchases', 'suppliers', 'supplierTransactions', ...STOCK, ...MONEY_ADDED]);
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
        if (date && isDayLocked(date)) {
          showToast('Ye din band (locked) hai. Payment aaj ki tareekh par darj karein.', 'error');
          return false;
        }
        if (!(Number(amount) > 0)) {
          showToast('Amount 0 se zyada honi chahiye.', 'warning');
          return false;
        }
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
         data: { ...extraData, opening_balance: pending_balance || 0 }
      };
      const { error } = await supabase.from('suppliers').insert([dbSupplier]);
      if (error) {
         showToast("Failed to save supplier: " + error.message, 'error');
         return false;
      }
      showToast("Supplier added successfully", 'success');
      fetchData(['suppliers']);
      return true;
    } catch(e: any) {
      showToast("Failed to save supplier", "error");
      return false;
    }
  };

  const updateSupplier = async (id: string, u: Partial<Supplier>) => {
    try {
      // The balance is a running ledger total moved only by delta RPCs; a profile edit never writes it.
      // Row columns and fields the loader computes are not profile data: a screen passing the whole
      // supplier object copied id, data, timestamps and totals into the data JSON on every save.
      const {
        name, phone, pending_balance: _balance, balance: _rawBalance, isActive,
        id: _id, data: _data, is_active: _isActive, created_at: _createdAt, updated_at: _updatedAt,
        total_due: _totalDue, ...extraData
      } = u as any;
      setSuppliers(prev => prev.map(s => s.id === id ? { ...s, ...extraData, ...(name !== undefined ? { name } : {}), ...(phone !== undefined ? { phone } : {}), ...(isActive !== undefined ? { isActive } : {}) } : s));

      const dbUpdates: any = {};
      if (name !== undefined) dbUpdates.name = name;
      if (phone !== undefined) dbUpdates.phone = phone || '';
      if (isActive !== undefined) dbUpdates.is_active = isActive;

      if (Object.keys(extraData).length > 0) {
         const { data: existing, error: readError } = await supabase.from('suppliers').select('data').eq('id', id).maybeSingle();
         if (readError) throw readError;
         dbUpdates.data = { ...(existing?.data || {}), ...extraData };
      }
      
      const { error } = await supabase.from('suppliers').update(dbUpdates).eq('id', id);
      if (error) {
         showToast("Failed to update supplier: " + error.message, 'error');
         fetchData(['suppliers']);
         return false;
      }
      fetchData(['suppliers']);
      return true;
    } catch(e: any) {
      console.error("updateSupplier error:", e);
      showToast("Failed to update supplier: " + (e?.message || "Error"), 'error');
      fetchData(['suppliers']);
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

      const { error: supplierErr } = await supabase.from('suppliers').delete().eq('id', id);
      if (supplierErr) {
        showToast(
          supplierErr.code === '23503'
            ? 'Cannot delete: this supplier has purchase/ledger history. Set them inactive instead.'
            : "Failed to delete supplier: " + supplierErr.message,
          'error'
        );
        fetchData(['suppliers']);
        return false;
      }

      setSuppliers(prev => prev.filter(s => s.id !== id));
      showToast("Supplier deleted successfully", "success");
      fetchData(['suppliers']);
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
      if (tx && tx.date && isDayLocked(tx.date)) {
        showToast('Ye entry band (locked) din ki hai. Delete ki jagah ulti (reverse) entry karein.', 'error');
        return false;
      }

      // Supplier balance, the paying account and the bank row are reversed together on the server, and
      // only into the account the money actually left (a waiver/discount touches no account).
      const { data: result, error: delError } = await supabase.rpc('delete_supplier_transaction_effects', { p_tx_id: id });
      if (delError) throw delError;

      if (tx) {
        const reversedAccountId = (result as any)?.account_id as string | undefined;
        setSuppliers(prev => prev.map(s => {
          if (s.id !== tx.supplier_id) return s;
          const next = roundCurrency((s.pending_balance || 0) + Number(tx.amount || 0));
          return { ...s, pending_balance: next, balance: next };
        }));
        if (reversedAccountId) {
          setAccounts(prev => prev.map(a => a.id === reversedAccountId ? { ...a, balance: roundCurrency((a.balance || 0) + Number(tx.amount || 0)) } : a));
        }
      }
      setBankTransactions(prev => prev.filter(b => b.reference_id !== id && b.id !== `btx_${id}`));
      setSupplierTransactions(prev => prev.filter(t => t.id !== id));
      fetchData(['suppliers', 'supplierTransactions', 'purchases', 'materialPurchases', ...MONEY_CHANGED]);
      return true;
    } catch (e) {
      console.error("deleteSupplierTransaction error:", e);
      showToast('Entry delete nahi hui: ' + getErrorMessage(e), 'error');
      fetchData(['suppliers', 'supplierTransactions', 'purchases', 'materialPurchases', ...MONEY_CHANGED]);
      return false;
    }
  };
  
  const adjustStock = async (itemId: string, newQty: number, reason: AdjustmentReason | string, notes?: string, variantId: string = 'loose') => {
     try {
        const invItem = inventory.find(i => i.id === itemId);
        if (!invItem || !invItem.item_id) return false;

        const { data: currentItem, error } = await supabase.from('items').select('*').eq('id', invItem.item_id).single();
        if (error || !currentItem) return false;

        const variantDef = variantId && variantId !== 'loose' ? (currentItem.variants || []).find((v: any) => v.id === variantId) : undefined;
        if (variantId && variantId !== 'loose' && variantDef?.deduct_from_base === true) {
          showToast(`${variantDef.name} main stock ka hissa hai, iska alag count nahi hota. ${currentItem.unit || 'base unit'} mein loose stock count karein.`, "warning");
          return false;
        }
        const isPack = Boolean(variantId && variantId !== 'loose');
        const oldLoose = roundQuantity(Number(currentItem.stock) || 0);
        const oldQty = isPack ? roundQuantity(Number((currentItem.variant_stocks || {})[variantId]) || 0) : oldLoose;
        const diff = roundQuantity((Number(newQty) || 0) - oldQty);
        if (diff === 0) return true;

        // Move by the difference so a sale syncing at the same moment is not overwritten.
        const { error: updateError } = isPack
          ? await adjustItemStock(invItem.item_id, 0, { [variantId]: diff })
          : await adjustItemStock(invItem.item_id, diff);
        if (updateError) throw updateError;

        setInventory(prev => prev.map(i => i.item_id !== invItem.item_id ? i : isPack
          ? { ...i, variant_stocks: { ...(i.variant_stocks || {}), [variantId]: roundQuantity((i.variant_stocks?.[variantId] || 0) + diff) } }
          : { ...i, quantity: roundQuantity((i.quantity || 0) + diff) }));

        const auditNote = isPack
          ? `Variant Audit: ${variantDef?.name || variantId} ${oldQty} → ${roundQuantity(oldQty + diff)} packs`
          : 'Loose Stock Audit';
        // Loose columns stay loose; a pack count change rides in details so reports post it to the pack pile.
        await supabase.from('inventory_logs').insert([{ 
            id: `log_${generateUUID()}`, date: new Date().toISOString(), item_id: invItem.item_id, 
            item_name: invItem.name,
            old_quantity: oldLoose,
            new_quantity: isPack ? oldLoose : roundQuantity(oldLoose + diff),
            difference: isPack ? 0 : diff, 
            reason, notes: notes ? `${notes} (${auditNote})` : auditNote,
            details: isPack ? { variant_id: variantId, variant_delta: diff, loose_delta: 0 } : { loose_delta: diff }
        }]);
        
        fetchData(STOCK);
        return true;
     } catch(err) { console.error(err); return false; }
  };

  // Opening stock: the way to put stock on a product without a purchase (new product, first count).
  // Each given pile moves by the difference to its target, like a stock count, in one adjust_item_stock
  // call, and one log with reason Opening Stock records all piles so reports treat it as an intake.
  const setOpeningStock = async (itemId: string, piles: OpeningStockPiles, notes?: string): Promise<boolean> => {
    try {
      const { data: currentItem, error } = await supabase.from('items').select('*').eq('id', itemId).single();
      if (error || !currentItem) { showToast('Product nahi mila.', 'error'); return false; }
      const variants: any[] = currentItem.variants || [];
      const oldLoose = roundQuantity(Number(currentItem.stock) || 0);
      const looseDelta = piles.loose === undefined ? 0 : roundQuantity((Number(piles.loose) || 0) - oldLoose);
      const packDeltas: Record<string, number> = {};
      for (const [variantId, target] of Object.entries(piles.packs || {})) {
        const variant = variants.find(v => v.id === variantId);
        if (!variant || variant.deduct_from_base === true) {
          showToast(`${variant?.name || variantId} ka alag stock nahi hota; loose ${currentItem.unit || ''} mein likhein.`, 'warning');
          return false;
        }
        const delta = roundQuantity((Number(target) || 0) - (Number((currentItem.variant_stocks || {})[variantId]) || 0));
        if (delta !== 0) packDeltas[variantId] = delta;
      }
      if (looseDelta === 0 && Object.keys(packDeltas).length === 0) return true;
      const { error: updateError } = await adjustItemStock(itemId, looseDelta, Object.keys(packDeltas).length ? packDeltas : undefined);
      if (updateError) throw updateError;
      setInventory(prev => prev.map(i => i.item_id !== itemId ? i : {
        ...i,
        quantity: roundQuantity((i.quantity || 0) + looseDelta),
        variant_stocks: Object.entries(packDeltas).reduce((acc, [id, d]) => ({ ...acc, [id]: roundQuantity((acc[id] || 0) + d) }), { ...(i.variant_stocks || {}) } as Record<string, number>),
      }));
      const { error: logError } = await supabase.from('inventory_logs').insert([{
        id: `log_${generateUUID()}`, date: new Date().toISOString(), item_id: itemId, item_name: currentItem.name,
        old_quantity: oldLoose, new_quantity: roundQuantity(oldLoose + looseDelta), difference: looseDelta,
        reason: AdjustmentReason.OPENING_STOCK, notes: notes || 'Opening stock',
        details: { loose_delta: looseDelta, variant_deltas: packDeltas },
      }]);
      if (logError) showToast('Stock set ho gaya, lekin log save nahi hua.', 'warning');
      fetchData(STOCK);
      return true;
    } catch (err) {
      console.error(err);
      showToast('Opening stock save nahi hua. Dobara koshish karein.', 'error');
      return false;
    }
  };

  // One return per bill at a time, also across tabs: two clicks or two tabs could post the same
  // return (stock, khata and refund) twice.
  const processSalesReturn = async (...args: Parameters<typeof processSalesReturnUnlocked>): Promise<boolean> => {
    const result = await actionLock.runExclusiveAcrossTabs(`sales_return_${args[0]}`, () => processSalesReturnUnlocked(...args));
    if (result === null) {
      showToast('Is bill ka return pehle se chal raha hai. Thori der baad dekhein.', 'warning');
      return false;
    }
    return result;
  };

  const processSalesReturnUnlocked = async (
    saleId: string,
    returnReason: string,
    refundAccountId?: string,
    returnAction: 'refund' | 'replace' = 'refund',
    restockOption: 'restock' | 'scrap_spoilage' = 'restock',
    returnedItemsList?: Array<{ itemId?: string; name: string; qty: number; price: number; variantId?: string; unit?: string }>,
    refundPaymentMode?: 'Cash' | 'Online',
    correctOriginalSaleMode?: boolean
  ): Promise<boolean> => {
    try {
      const localSale = sales.find(s => s.id === saleId);
      if (!localSale) {
        showToast("Sale record not found", "error");
        return false;
      }
      if (await isSaleUnsynced(localSale.id)) {
        showToast('Ye bill abhi sync ho raha hai. Sync mukammal hone ke baad return karein.', 'error');
        return false;
      }
      // Another device may have returned (part of) this bill or changed its mode since it was loaded:
      // what was already returned comes from the server copy, not the one on screen.
      const { data: serverSale, error: serverSaleError } = await supabase.from('sales').select('*').eq('id', saleId).maybeSingle();
      if (serverSaleError) throw serverSaleError;
      if (!serverSale) {
        showToast('Ye bill server par nahi mila. Records refresh kar ke dobara koshish karein.', 'error');
        return false;
      }
      const sale: POSBill = {
        ...localSale,
        status: serverSale.status ?? localSale.status,
        payment_mode: serverSale.payment_mode ?? localSale.payment_mode,
        refund_amount: serverSale.refund_amount ?? serverSale.details?.refund_amount ?? localSale.refund_amount,
        returned_items: serverSale.returned_items || serverSale.details?.returned_items || undefined,
        details: serverSale.details ?? (localSale as any).details
      } as POSBill;

      if (sale.status === 'Returned') {
        showToast("This sale has already been fully returned", "warning");
        return false;
      }

      // The bill was really paid online: fix its mode first, so the refund leaves the right account.
      if (correctOriginalSaleMode && sale.payment_mode === 'Cash') {
        const corrected = await updateSalePaymentMode(sale.id, 'Online');
        if (!corrected) return false;
      }

      const returnTimestamp = new Date().toISOString();
      const isReplacement = returnAction === 'replace';
      const isSpoiledScrap = restockOption === 'scrap_spoilage' || returnReason.toLowerCase().includes('spoil') || returnReason.toLowerCase().includes('defect') || returnReason.toLowerCase().includes('kharab');

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

      // Full return = every sold line came back. Lines are compared one by one in their own sold unit,
      // so 6 pcs back from a 1 Dozen bill never count as the dozen. A replacement is not a return.
      const existingReturnedItems: any[] = (sale as any).returned_items || (sale as any).details?.returned_items || [];
      const lineKey = (it: any) => `${it.itemId || it.id || it.name}|${it.variantId || ''}`;
      const soldByLine = new Map<string, number>();
      (sale.items || []).forEach((it: any) => soldByLine.set(lineKey(it), (soldByLine.get(lineKey(it)) || 0) + (Number(it.qty) || 0)));
      const backByLine = new Map<string, number>();
      [...existingReturnedItems.filter(it => it.action !== 'replace'), ...(isReplacement ? [] : itemsToReturn)]
        .forEach((it: any) => backByLine.set(lineKey(it), (backByLine.get(lineKey(it)) || 0) + (Number(it.qty) || 0)));
      const isFullReturn = soldByLine.size > 0 && [...soldByLine.entries()].every(([key, sold]) => (backByLine.get(key) || 0) >= sold - 0.0005);

      // A replacement on its own leaves the bill as it was: nothing came back as money or stock.
      const anyRefunded = [...backByLine.values()].some(q => q > 0);
      const newStatus = isFullReturn ? 'Returned' : (anyRefunded ? 'Partially Returned' : (sale.status || 'Completed'));
      const accumulatedRefundAmount = ((sale.refund_amount || 0) + calculatedRefundAmount);

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

      const returnReasonText = `${returnReason} (${isReplacement ? 'Replacement' : (isSpoiledScrap ? 'Spoiled' : 'Restocked')})`;
      const newReturnedItems = itemsToReturn.map(it => ({
        ...it,
        returnDate: returnTimestamp,
        reason: returnReason,
        action: returnAction,
        restock: restockOption
      }));

      // Everything below is collected first and applied by process_sales_return in ONE locked server
      // transaction (bill, stock, logs, khata, refund, drawer event). Local state follows on success.
      const stockMoves: Array<{ item_id: string; variant_id: string | null; delta: number }> = [];
      const inventoryLogRows: any[] = [];
      const localStockMoves: Array<() => void> = [];

      // Each line goes back to the pile it left, sized as it was sold: the bill's own snapshot wins over today's catalog.
      for (const item of itemsToReturn) {
        const qty = Number(item.qty) || 0;
        if (qty <= 0) continue;
        const variantId = item.variantId;
        const itemDef = findLineItem<ItemDefinition>(items, item);

        if (itemDef) {
          const soldLine: any = (sale.items || []).find((l: any) => (l.itemId || l.id) === itemDef.id && (l.variantId || undefined) === (variantId || undefined)) || {};
          const given: any = item;
          const move = saleLineStock({
            qty,
            variantId,
            isLoose: given.isLoose ?? soldLine.isLoose,
            stockDeduction: given.stockDeduction ?? soldLine.stockDeduction,
            deductFromBase: given.deductFromBase ?? soldLine.deductFromBase
          }, itemDef);
          const packId = move.variantId;
          const returnQty = move.stockQty;
          const invRow = inventory.find(inv => inv.item_id === itemDef.id);
          const currentStock = roundQuantity(invRow?.quantity ?? (itemDef as any).stock ?? 0);
          const currentVarStock = packId ? roundQuantity((invRow?.variant_stocks || itemDef.variant_stocks || {})[packId] || 0) : 0;
          const packDetails = (delta: number) => packId ? { variant_id: packId, variant_delta: delta, loose_delta: 0 } : { loose_delta: delta };
          const applyLocal = (delta: number) => {
            setInventory(prev => prev.map(inv => {
              if (inv.item_id !== itemDef.id) return inv;
              if (packId) return { ...inv, variant_stocks: { ...(inv.variant_stocks || {}), [packId]: roundQuantity((inv.variant_stocks?.[packId] || 0) + delta) } };
              return { ...inv, quantity: roundQuantity((inv.quantity || 0) + delta) };
            }));
            // POS and Items read the catalog row, so mirror the move there too.
            setItems(prev => prev.map(i => {
              if (i.id !== itemDef.id) return i;
              if (packId) return { ...i, variant_stocks: { ...(i.variant_stocks || {}), [packId]: roundQuantity((Number(i.variant_stocks?.[packId]) || 0) + delta) } };
              return { ...i, stock: roundQuantity((Number((i as any).stock) || 0) + delta) } as any;
            }));
          };
          const lineLabel = packId ? `${qty} x ${item.name}` : `${returnQty} ${itemDef.unit || ''}`.trim();

          if (isReplacement) {
            // Exchange / replacement: the fresh unit leaves the same pile the sale used.
            stockMoves.push({ item_id: itemDef.id, variant_id: packId || null, delta: -returnQty });
            localStockMoves.push(() => applyLocal(-returnQty));

            inventoryLogRows.push(...[{
              id: `log_rep_${generateUUID()}`,
              date: returnTimestamp,
              item_id: itemDef.id,
              item_name: itemDef.name,
              old_quantity: packId ? currentVarStock : currentStock,
              new_quantity: roundQuantity((packId ? currentVarStock : currentStock) - returnQty),
              difference: packId ? 0 : -returnQty,
              reason: AdjustmentReason.SPOILAGE,
              notes: `Customer Replacement: ${lineLabel} spoiled item returned and a fresh one issued for Invoice #${sale.bill_number}`,
              details: packDetails(-returnQty)
            }]);
          } else if (isSpoiledScrap) {
            // Spoiled / defective item discarded (log only, stock already left at sale).
            inventoryLogRows.push(...[{
              id: `log_spoil_${generateUUID()}`,
              date: returnTimestamp,
              item_id: itemDef.id,
              item_name: itemDef.name,
              old_quantity: currentStock,
              new_quantity: currentStock,
              difference: 0,
              reason: AdjustmentReason.SPOILAGE,
              notes: `Customer Return (Scrapped Spoilage): ${lineLabel} from #${sale.bill_number} discarded`,
              details: { ...packDetails(0), scrapped_qty: returnQty }
            }]);
          } else {
            // Good item restocked to the pile it came from.
            stockMoves.push({ item_id: itemDef.id, variant_id: packId || null, delta: returnQty });
            localStockMoves.push(() => applyLocal(returnQty));

            inventoryLogRows.push(...[{
              id: `log_ret_${generateUUID()}`,
              date: returnTimestamp,
              item_id: itemDef.id,
              item_name: itemDef.name,
              old_quantity: packId ? currentVarStock : currentStock,
              new_quantity: roundQuantity((packId ? currentVarStock : currentStock) + returnQty),
              difference: packId ? 0 : returnQty,
              reason: AdjustmentReason.SALES_RETURN,
              notes: `Returned to counter stock from Invoice #${sale.bill_number}: ${lineLabel} (${returnReason})`,
              details: packDetails(returnQty)
            }]);
          }
        }
      }

      // Khata absorbs the unpaid part; only money that
      // was collected leaves the drawer or bank that received it.
      const itemsLabel = itemsToReturn.map(i => `${i.qty}x ${i.name}`).join(', ');
      const activeShift = activeShiftSession?.status === 'Active' ? activeShiftSession : null;
      let khataPart: any = null;
      let cashPart: any = null;
      let refundTargetAccountId: string | null = null;

      if (!isReplacement && calculatedRefundAmount > 0) {
        if (refundSplit.khata > 0 && sale.customer_id) {
          khataPart = {
            amount: refundSplit.khata,
            tx_id: `ctx_ret_${generateUUID()}`,
            details: {
              mode: 'Credit',
              note: `Return (${itemsLabel}) for Invoice #${sale.bill_number}: ${returnReason}`,
              sale_id: sale.id
            }
          };
        }

        if (refundSplit.cash > 0) {
          const saleMode = correctOriginalSaleMode ? 'Online' : String(sale.payment_mode || '');
          const effectiveRefundMode = refundPaymentMode || (saleMode.toLowerCase() === 'online' ? 'Online' : 'Cash');
          const isOnlineRefund = effectiveRefundMode === 'Online';
          // Cash physically leaves the drawer that is open now, so the refund comes out of that drawer's account.
          const activeDrawerAccountId = activeShift ? (activeShift.account_id || resolveDrawerAccountId(activeShift.drawer_id) || activeShift.drawer_id) : null;
          if (!isOnlineRefund && !refundAccountId && !activeDrawerAccountId) {
            showToast('Cash refund ke liye pehle shift start karein, taake refund drawer se nikle.', 'warning');
            return false;
          }
          const targetAccId = refundAccountId || (
            isOnlineRefund
              ? (settings.financial?.defaultDigitalAccountId || accounts.find(a => a.type === 'Bank' || a.type === 'Wallet')?.id)
              : activeDrawerAccountId
          );
          if (!targetAccId || !accounts.some(a => a.id === targetAccId)) {
            showToast('Refund ka account nahi mila. Account select karein.', 'error');
            return false;
          }
          refundTargetAccountId = targetAccId;
          const fromActiveDrawer = !!activeShift && !isOnlineRefund && targetAccId === activeDrawerAccountId;
          cashPart = {
            amount: refundSplit.cash,
            account_id: targetAccId,
            btx_id: `btx_ret_${generateUUID()}`,
            category: isOnlineRefund ? 'Online Sales Return' : 'Sales Return',
            description: `Sales Refund (${effectiveRefundMode}) for #${sale.bill_number} (${itemsLabel})`,
            drawer_id: fromActiveDrawer ? activeShift!.drawer_id : null,
            // Only cash taken out of the open drawer is a drawer event; head cash or bank is not.
            event: fromActiveDrawer && activeShift!.business_day_id ? {
              id: `sce_refund_${generateUUID()}`,
              business_day_id: activeShift!.business_day_id,
              shift_id: activeShift!.id,
              drawer_id: activeShift!.drawer_id,
              source_id: `${sale.id}_${generateUUID().slice(0, 8)}`,
              description: `Refund for invoice ${sale.bill_number}`,
              created_by: currentUser?.id
            } : null
          };
        }
      }

      // Same lines again after a lost response reuse the return id, so the server applies it once.
      const returnKey = `sales_return:${saleId}:${returnAction}:${restockOption}:${JSON.stringify(itemsToReturn.map(i => [i.itemId || i.name, i.variantId || '', Number(i.qty) || 0]))}`;
      const returnResult = await callMoneyRpc('process_sales_return', returnKey, requestId => ({
        p_sale_id: saleId,
        p_return_id: requestId,
        p_payload: {
          status: newStatus,
          return_reason: returnReasonText,
          return_type: returnAction,
          restock_action: restockOption,
          refund_amount: calculatedRefundAmount,
          returned_items: newReturnedItems,
          stock_moves: stockMoves,
          logs: inventoryLogRows,
          khata: khataPart,
          cash: cashPart,
          business_day_id: activeShift?.business_day_id || null,
          shift_session_id: activeShift?.id || null,
          drawer_id: activeShift?.drawer_id || null,
          cashier_id: currentUser?.id || activeShift?.user_id || null
        }
      }));
      if (returnResult?.already_applied) {
        showToast('Ye return pehle hi save ho chuka tha.', 'info');
        fetchData(['sales', 'customers', 'customerTransactions', ...STOCK, ...MONEY_CHANGED]);
        return true;
      }

      // Server committed everything; mirror it locally until the refresh lands. The status is the
      // server's, worked out from the bill's lines.
      setSales(prev => prev.map(s => s.id === saleId ? {
        ...s,
        status: (returnResult?.status || newStatus) as any,
        return_reason: returnReasonText,
        returned_at: returnTimestamp,
        refund_amount: accumulatedRefundAmount,
        return_type: returnAction,
        restock_action: restockOption,
        returned_items: updatedReturnedItems
      } : s));
      localStockMoves.forEach(apply => apply());
      if (khataPart) {
        setCustomers(prev => prev.map(c => c.id === sale.customer_id ? { ...c, balance: roundCurrency((c.balance || 0) - khataPart.amount) } : c));
      }
      if (cashPart && refundTargetAccountId) {
        setAccounts(prev => prev.map(a => a.id === refundTargetAccountId ? { ...a, balance: roundCurrency((a.balance || 0) - cashPart.amount) } : a));
      }

      const refundMessage = cashPart && khataPart
        ? `Rs ${cashPart.amount.toLocaleString()} wapas diye, Rs ${khataPart.amount.toLocaleString()} khaate se kam hue`
        : cashPart
          ? `Rs ${cashPart.amount.toLocaleString()} refund diya gaya`
          : khataPart
            ? `Rs ${khataPart.amount.toLocaleString()} customer ke khaate se kam hue (cash nahi diya)`
            : 'Koi raqam wapas nahi hui';
      showToast(
        isReplacement
          ? `Replacement processed for ${itemsToReturn.length} item(s) on #${sale.bill_number}!`
          : `Return ho gaya: ${refundMessage}.`,
        "success"
      );

      fetchData(['sales', 'customers', 'customerTransactions', ...STOCK, ...MONEY_CHANGED]);
      return true;
    } catch (err: any) {
      console.error("processSalesReturn error:", err);
      showToast(`Return nahi hua: ${moneyRpcMessage(err)}`, "error");
      return false;
    }
  };

  // A bill still in the local outbox has no server row (or its effects are still retrying), so
  // editing it now would be overwritten when the sync lands.
  const isSaleUnsynced = async (saleId: string): Promise<boolean> => {
    try {
      const order = await db.orders.get(saleId);
      return !!order && order.sync_status !== 'synced';
    } catch {
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

        if (!canPerform('sales_history', 'edit')) {
          showToast('Aap ko bill ka payment mode badalne ki ijazat nahi hai.', 'error');
          return false;
        }
        if (sale.status === 'Returned' || sale.status === 'Partially Returned' || Number(sale.refund_amount || 0) > 0) {
          showToast('Returned bill ka payment mode nahi badla ja sakta.', 'error');
          return false;
        }
        if (await isSaleUnsynced(sale.id)) {
          showToast('Ye bill abhi sync ho raha hai. Sync mukammal hone ke baad mode badlein.', 'error');
          return false;
        }
        const saleShift = sale.shift_session_id ? shiftSessions.find(s => s.id === sale.shift_session_id) : undefined;
        if ((sale.date && isDayLocked(sale.date)) || (saleShift && saleShift.status !== 'Active' && saleShift.status !== 'Closing')) {
          showToast('Ye bill band shift / band din ka hai. Drawer ka hisaab ho chuka hai, is liye mode nahi badla ja sakta.', 'error');
          return false;
        }

        const paidAmount = roundCurrency(salePaidAmount(sale));

        let oldAccountId: string | null = null;
        let newAccountId: string | null = targetAccountId || null;

        // Only the bill's own receipt row; refund rows (btx_ret_*) also carry reference_id = sale.id.
        const existingBtx = bankTransactions.find(b => b.id === `btx_${sale.id}`)
          || bankTransactions.find(b => b.reference_id === sale.id && b.type === 'Income' && !String(b.id).startsWith('btx_ret'));
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

        // Move the money, the bill's receipt row, the drawer audit event and the bill itself in one
        // server transaction (change_sale_payment_mode).
        const newCategory = newPaymentMode === 'Online' ? 'Online Sale' : 'POS Sale';
        const newDescription = `POS ${newPaymentMode} Sale #${sale.bill_number}`;
        const effectiveDayId = sale.business_day_id || activeShiftSession?.business_day_id;
        const effectiveShiftId = sale.shift_session_id || activeShiftSession?.id;
        const effectiveDrawerId = sale.drawer_id || activeShiftSession?.drawer_id;

        const updatedDetails = {
          ...((sale as any).details || {}),
          previous_payment_mode: oldPaymentMode,
          payment_mode: newPaymentMode,
          payment_mode_changed_at: new Date().toISOString(),
          account_id: newAccountId
        };

        const correctionEvent = paidAmount > 0 && effectiveDayId && effectiveDrawerId ? {
          id: `sce_corr_${generateUUID()}`,
          business_day_id: effectiveDayId,
          shift_id: effectiveShiftId,
          drawer_id: effectiveDrawerId,
          direction: oldPaymentMode === 'Cash' ? 'Out' : 'In',
          description: `Correction: Invoice #${sale.bill_number} changed from ${oldPaymentMode} to ${newPaymentMode}`,
          created_by: currentUser?.id
        } : null;

        const { error: modeError } = await supabase.rpc('change_sale_payment_mode', {
          p_sale_id: sale.id,
          p_new_mode: newPaymentMode,
          p_old_account_id: oldAccountId,
          p_new_account_id: newAccountId,
          p_amount: paidAmount,
          p_btx_id: existingBtx?.id || null,
          p_btx: {
            category: newCategory,
            description: newDescription,
            business_day_id: effectiveDayId,
            shift_session_id: effectiveShiftId,
            drawer_id: newPaymentMode === 'Cash' ? effectiveDrawerId : null,
            cashier_id: sale.cashier_id || activeShiftSession?.user_id
          },
          p_event: correctionEvent,
          p_details: updatedDetails
        });
        if (modeError) throw modeError;

        if (paidAmount > 0 && oldAccountId && newAccountId && oldAccountId !== newAccountId) {
          setAccounts(prev => prev.map(acc => {
            if (acc.id === oldAccountId) return { ...acc, balance: roundCurrency((acc.balance || 0) - paidAmount) };
            if (acc.id === newAccountId) return { ...acc, balance: roundCurrency((acc.balance || 0) + paidAmount) };
            return acc;
          }));
        }

        try {
          await db.orders.update(sale.id, {
            payment_mode: newPaymentMode,
            receipt_account_id: newAccountId
          });
        } catch (dexErr) {
          console.warn('[Dexie] Order payment mode update notice:', dexErr);
        }

        setSales(prev => prev.map(s => s.id === sale.id ? {
          ...s,
          payment_mode: newPaymentMode,
          details: updatedDetails
        } : s));

        showToast(`Invoice #${sale.bill_number} payment mode updated to ${newPaymentMode}!`, "success");
        fetchData(['sales', ...MONEY_CHANGED]);
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
          if (!entries.every(entry => guardOpenPeriod(entry.date))) return false;
          // record_daily_supply_effects saves the whole batch with each entry's khata charge and cash
          // receipt in one transaction: all of it or none. Saved entry ids are skipped on a resend.
          const batchKey = `daily_supply:${JSON.stringify(entries)}`;
          const batchId = requestIdFor(batchKey, generateUUID);
          const dbEntries = entries.map((entry: any, index: number) => {
              const { id, date, customer_id, total_amount, ...extraDetails } = entry;
              return {
                  id: id || `ds_${batchId}_${index}`,
                  date: normalizeTransactionTimestamp(date),
                  customer_id,
                  total_amount: total_amount || 0,
                  details: extraDetails
              };
          });
          const targetAccId = activeShiftSession?.account_id || resolveDrawerAccountId(activeShiftSession?.drawer_id) || activeShiftSession?.drawer_id || settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash' && a.isActive !== false)?.id || null;
          await callMoneyRpc('record_daily_supply_effects', batchKey, () => ({
            p_payload: {
              entries: dbEntries,
              account_id: targetAccId,
              drawer_account_ids: activeDrawerAccountIds(),
              business_day_id: activeShiftSession?.business_day_id || null,
              shift_session_id: activeShiftSession?.id || null,
              drawer_id: activeShiftSession?.drawer_id || null,
              cashier_id: activeShiftSession?.user_id || currentUser?.id || null
            }
          }));

          fetchData(['dailySupply', 'customers', 'customerTransactions', ...MONEY_ADDED]);
          return true;
      } catch (e) {
        console.error(e);
        showToast('Delivery ka hisaab save nahi hua (kuch bhi post nahi hua): ' + moneyRpcMessage(e), 'error');
        return false;
      }
  };
  const performRetailClosing = async (data: any) => { 
      try {
          const closingId = generateUUID();
          const shiftName = data.shift || 'General';

          // If Auto-Post Unrecorded Sales is enabled, post a balancing sale.
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

          // Adjust live loose and variant stock to the count without double-logging explicit spoilage/wastage.
          for (const item of (data.items || [])) {
              const itemDef = items.find(i => i.name.toLowerCase() === item.product_name.toLowerCase() || i.id === item.product_id);
              if (itemDef) {
                  const targetVariant = item.variant_id && item.variant_id !== 'loose' ? item.variant_id : 'loose';
                  const spoilageQty = roundQuantity(Number(item.spoilage_qty) || 0);
                  const wastageQty = roundQuantity(Number(item.wastage_qty) || 0);
                  const internalUseQty = roundQuantity(Number(item.internal_use_qty) || 0);
                  const explicitLossTotal = roundQuantity(spoilageQty + wastageQty + internalUseQty);
                  const physicalQty = roundQuantity(Number(item.physical_qty) || 0);

                  const { data: currentItem } = await supabase.from('items').select('*').eq('id', itemDef.id).maybeSingle();
                  if (currentItem) {
                      const oldQty = targetVariant !== 'loose'
                        ? roundQuantity((currentItem.variant_stocks || {})[targetVariant] || 0)
                        : roundQuantity(currentItem.stock || 0);
                      const totalDiff = roundQuantity(physicalQty - oldQty);
                      if (targetVariant !== 'loose') {
                          const newVariantStocks = { ...(currentItem.variant_stocks || {}), [targetVariant]: physicalQty };
                          await supabase.from('items').update({ variant_stocks: newVariantStocks }).eq('id', itemDef.id);
                          setInventory(prev => prev.map(i => i.item_id === itemDef.id ? { ...i, variant_stocks: newVariantStocks } : i));
                      } else {
                          await supabase.from('items').update({ stock: physicalQty }).eq('id', itemDef.id);
                          setInventory(prev => prev.map(i => i.item_id === itemDef.id ? { ...i, quantity: physicalQty } : i));
                      }

                      // Log only the residual unexplained count difference as Stock Count Correction so explicit spoilage/wastage is not double-counted
                      const residualDiff = roundQuantity(totalDiff + explicitLossTotal);
                      if (Math.abs(residualDiff) > 0.0001) {
                          await supabase.from('inventory_logs').insert([{ 
                              id: `log_cnt_${closingId}_${itemDef.id}_${targetVariant}`, 
                              date: new Date().toISOString(), 
                              item_id: itemDef.id, 
                              item_name: item.variant_name ? `${item.product_name} (${item.variant_name})` : item.product_name, 
                              old_quantity: oldQty, 
                              new_quantity: roundQuantity(oldQty + residualDiff), 
                              difference: residualDiff, 
                              reason: 'Stock Count Correction', 
                              notes: `Shift Closing (${shiftName}) on ${data.date}`
                          }]);
                      }
                  }

                  // Log dedicated Loss/Wastage inventory entries for reporting
                  if (spoilageQty > 0) {
                      await supabase.from('inventory_logs').insert([{ 
                          id: `log_spoil_${closingId}_${itemDef.id}_${targetVariant}`, 
                          date: new Date().toISOString(), 
                          item_id: itemDef.id, 
                          item_name: item.variant_name ? `${item.product_name} (${item.variant_name})` : item.product_name, 
                          old_quantity: item.system_qty, 
                          new_quantity: item.physical_qty, 
                          difference: -spoilageQty, 
                          reason: 'Spoilage / Wastage', 
                          notes: `Kharab/Sour Milk - Shift Closing (${shiftName}) on ${data.date}`
                      }]);
                  }

                  if (wastageQty > 0) {
                      await supabase.from('inventory_logs').insert([{ 
                          id: `log_waste_${closingId}_${itemDef.id}_${targetVariant}`, 
                          date: new Date().toISOString(), 
                          item_id: itemDef.id, 
                          item_name: item.variant_name ? `${item.product_name} (${item.variant_name})` : item.product_name, 
                          old_quantity: item.system_qty, 
                          new_quantity: item.physical_qty, 
                          difference: -wastageQty, 
                          reason: 'Spoilage / Wastage', 
                          notes: `Boiling/Measurement Loss - Shift Closing (${shiftName}) on ${data.date}`
                      }]);
                  }

                  if (internalUseQty > 0) {
                      await supabase.from('inventory_logs').insert([{ 
                          id: `log_tea_${closingId}_${itemDef.id}_${targetVariant}`, 
                          date: new Date().toISOString(), 
                          item_id: itemDef.id, 
                          item_name: item.variant_name ? `${item.product_name} (${item.variant_name})` : item.product_name, 
                          old_quantity: item.system_qty, 
                          new_quantity: item.physical_qty, 
                          difference: -internalUseQty, 
                          reason: 'Internal Consumption', 
                          notes: `Staff Tea / Internal Usage - Shift Closing (${shiftName}) on ${data.date}`
                      }]);
                  }
              }
          }

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

          fetchData(['retailClosings', ...STOCK]);
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
      // A bare "date T time" has no zone and is read as UTC on the server (5 hours off, often the next PKT day).
      const saleDate = normalizeTransactionTimestamp(data.date || nowIso);
      const shiftLabel = data.shiftName || activeShiftSession?.shift_name || 'Counter Closing';
      const paymentMode = data.paymentMode || 'Cash';

      const cart = validItems.map(item => {
        const itemDef = items.find(i => i.id === item.itemId || i.name.toLowerCase() === item.name.toLowerCase());
        const variantDef = itemDef?.variants?.find(v => v.id === item.variantId);
        const deductFromBase = !variantDef || variantDef.deduct_from_base === true;
        const baseFactor = Number(variantDef?.quantity_in_base_unit) || 1;
        // stockDeduction means base units in ONE sold unit everywhere (sync, projection, reports).
        const stockDeduction = roundQuantity(baseFactor);

        return {
          id: item.itemId,
          itemId: item.itemId,
          name: item.variantName ? `${item.name} (${item.variantName})` : item.name,
          qty: roundQuantity(item.autoSaleQty),
          price: roundCurrency(item.price),
          total: roundCurrency(item.totalAmount || (item.autoSaleQty * item.price)),
          variantId: item.variantId,
          unit: item.unit || 'Unit',
          deductFromBase,
          stockDeduction
        };
      });

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
      // Bill and lines in one Dexie transaction (as the POS does), so the sync never sees a bill without lines.
      await db.transaction('rw', db.orders, db.order_items, async () => {
        await db.orders.put({
          ...saleData,
          receipt_account_id: receiptAccountId,
          sync_status: 'pending',
          created_at: nowIso
        } as any);
        if (orderItems.length > 0) {
          await db.order_items.bulkPut(orderItems as any);
        }
      });
      noteLocalWrite();

      setSales(prev => [saleData, ...prev]);
      setInventory(prev => prev.map(inv => {
        let quantity = roundQuantity(inv.quantity || 0);
        const variant_stocks = { ...(inv.variant_stocks || {}) };
        for (const line of cart) {
          const lineId = lineItemId(line);
          if (lineId ? inv.item_id !== lineId : inv.name !== line.name) continue;
          if (line.variantId && !line.deductFromBase) {
            variant_stocks[line.variantId] = roundQuantity((Number(variant_stocks[line.variantId]) || 0) - line.qty);
          } else {
            quantity = roundQuantity(quantity - (Number(line.qty) || 0) * (Number(line.stockDeduction) || 1));
          }
        }
        return { ...inv, quantity, variant_stocks };
      }));
      setItems(prev => prev.map(item => {
        let next = item;
        for (const line of cart) {
          const lineId = lineItemId(line);
          if (lineId ? item.id !== lineId : item.name !== line.name) continue;
          const variant_stocks = { ...(next.variant_stocks || {}) };
          let stock = roundQuantity(next.stock || 0);
          if (line.variantId && !line.deductFromBase) {
            variant_stocks[line.variantId] = roundQuantity((Number(variant_stocks[line.variantId]) || 0) - line.qty);
          } else {
            stock = roundQuantity(stock - (Number(line.qty) || 0) * (Number(line.stockDeduction) || 1));
          }
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

  const mapCashShift = (row: any): ShiftSession => mapCashShiftRow(row, accounts, cashDrawers);

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

  // Goes through the shared loader, so the accounts and bank rows it reads keep the unsynced bills
  // projected on top (setting them directly dropped every pending sale's cash until the next load)
  // and only bank rows created since the last read are downloaded.
  const refreshCashControl = async (): Promise<void> => {
    await fetchData(CASH_CONTROL);
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
    const businessDate = getBusinessDate();
    let effectiveHandoverId = data.handoverId || null;

    if (activeShiftSession) {
      if (activeShiftSession.business_date && activeShiftSession.business_date < businessDate) {
        const totals = getShiftTotals(activeShiftSession.id);
        const expectedCash = Math.max(0, roundCurrency(Number(totals.expectedCash || activeShiftSession.opening_counted || activeShiftSession.opening_float || 0)));
        const autoHandoverId = `handover_${generateUUID()}`;
        const { error: autoCloseError } = await supabase.rpc('cash_control_close_shift', {
          p_shift_id: activeShiftSession.id,
          p_expected_cash: expectedCash,
          p_counted_cash: expectedCash,
          p_leave_in_drawer: expectedCash,
          p_remit_to_head: 0,
          p_denominations: { closing: {}, leave_in_drawer: {}, remit_to_head: {} },
          p_difference_reason: '',
          p_notes: `Auto-closed overnight before starting ${businessDate} shift`,
          p_totals: totals,
          p_handover_id: autoHandoverId,
          p_remittance_id: `remit_${generateUUID()}`
        });
        if (autoCloseError) {
          showToast(`Pichli shift (${activeShiftSession.business_date}) close nahi hui: ${autoCloseError.message}`, 'error');
          return false;
        }
        if (!effectiveHandoverId && expectedCash > 0 && activeShiftSession.drawer_id === data.drawerId) {
          effectiveHandoverId = autoHandoverId;
        }
      } else {
        showToast('You already have an active shift.', 'warning');
        return false;
      }
    }

    const conflictingShifts = shiftSessions.filter(
      s => s.drawer_id === data.drawerId && s.id !== activeShiftSession?.id && ['Active', 'Closing', 'Pending Acceptance'].includes(s.status)
    );
    for (const conflictingShift of conflictingShifts) {
      if (conflictingShift.business_date && conflictingShift.business_date < businessDate) {
        const totals = getShiftTotals(conflictingShift.id);
        const expectedCash = Math.max(0, roundCurrency(Number(totals.expectedCash || conflictingShift.opening_counted || conflictingShift.opening_float || 0)));
        const autoHandoverId = `handover_${generateUUID()}`;
        const { error: autoCloseError } = await supabase.rpc('cash_control_close_shift', {
          p_shift_id: conflictingShift.id,
          p_expected_cash: expectedCash,
          p_counted_cash: expectedCash,
          p_leave_in_drawer: expectedCash,
          p_remit_to_head: 0,
          p_denominations: { closing: {}, leave_in_drawer: {}, remit_to_head: {} },
          p_difference_reason: '',
          p_notes: `Auto-closed overnight before starting ${businessDate} shift`,
          p_totals: totals,
          p_handover_id: autoHandoverId,
          p_remittance_id: `remit_${generateUUID()}`
        });
        if (autoCloseError) {
          showToast(`Is drawer ki pichli shift (${conflictingShift.business_date}) close nahi hui: ${autoCloseError.message}`, 'error');
          return false;
        }
        if (!effectiveHandoverId && expectedCash > 0) {
          effectiveHandoverId = autoHandoverId;
        }
      } else {
        if (conflictingShift.user_id === currentUser.id || currentUser.role_id === 'role_super_admin' || currentRole?.name === 'Super Admin') {
          showToast('Your shift is already active on this drawer.', 'warning');
        } else {
          showToast(`Another cashier’s shift (${conflictingShift.user_name || 'Cashier'}) is active on this drawer. Please close or hand it over first.`, 'warning');
        }
        return false;
      }
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
      p_handover_id: effectiveHandoverId
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

  function getShiftTotals(shiftId: string) {
    const shift = shiftSessions.find(s => s.id === shiftId) || activeShiftSession;
    const drawerAccountId = resolveDrawerAccountId(shift?.drawer_id) || shift?.drawer_id;

    const shiftStartTime = shift?.started_at ? new Date(shift.started_at).getTime() : 0;
    const shiftEndTime = shift?.closed_at ? new Date(shift.closed_at).getTime() : Infinity;
    const shiftDate = shift?.business_date || (shift?.started_at ? shift.started_at.split('T')[0] : '');

    const allShiftSales = sales.filter(s => {
      if (s.shift_session_id === shiftId) return true;

      // Also take an orphaned or misplaced bill from the same drawer and timeframe.
      if (!s.date) return false;
      const saleTime = new Date(s.date).getTime();
      // Pakistan business day, not the UTC date (00:00–05:00 PKT bills carry the previous UTC date).
      const saleDate = businessDayOf(s.date);

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

    const isDrawerTxInShiftWindow = (row: any, rowAccountId?: string | null) => {
      if (row.shift_session_id === shiftId) {
        return !rowAccountId || !drawerAccountId || rowAccountId === drawerAccountId || rowAccountId === shift?.drawer_id;
      }
      if (row.shift_session_id) return false;
      if (!drawerAccountId || !rowAccountId || (rowAccountId !== drawerAccountId && rowAccountId !== shift?.drawer_id)) {
        return false;
      }
      const rawTime = row.created_at || row.date;
      if (!rawTime || shiftStartTime <= 0) return false;
      const t = new Date(rawTime).getTime();
      return Number.isFinite(t) && t >= (shiftStartTime - 60000) && t <= (shiftEndTime + 60000);
    };

    const validLedgerCollections = customerTransactions
      .filter(t => t.type === 'Payment' && String(t.mode || '').toLowerCase().includes('cash'))
      .filter(t => isDrawerTxInShiftWindow(t, t.account_id || (t.details as any)?.account_id));

    const ledgerCashCollections = roundCurrency(validLedgerCollections.reduce((sum, t) => sum + Number(t.amount || 0), 0));

    const deliveryCashCollections = roundCurrency(dailySupplyEntries
      .filter(entry => entry.shift_session_id === shiftId && String(entry.payment_mode || '').toLowerCase().includes('cash'))
      .reduce((sum, entry) => sum + Number(entry.payment_received || 0), 0));

    // Material, Supplier, and Expense Vendor Cash In (Refunds / Returns / Advance Returns) received specifically into THIS drawer
    const validMaterialAndSupplierRefundBtx = bankTransactions
      .filter((t: any) =>
        isDrawerTxInShiftWindow(t, t.account_id) &&
        (t.type === 'Income' || t.type === 'Deposit') &&
        ['Vendor / Staff Refund', 'Supplier Refund', 'Vendor Refund'].includes(t.category)
      );

    const vendorAndSupplierRefundCashIn = roundCurrency(validMaterialAndSupplierRefundBtx.reduce((sum, t: any) => sum + Number(t.amount || 0), 0));

    const cashCollections = roundCurrency(ledgerCashCollections + deliveryCashCollections + vendorAndSupplierRefundCashIn);

    // Cash expenses paid specifically from THIS drawer
    const validShiftExpenses = expenses
      .filter(e => String(e.paymentMode || '').toLowerCase().includes('cash'))
      .filter(e => isDrawerTxInShiftWindow(e, e.account_id || (e as any).details?.account_id));
    const cashExpenses = roundCurrency(validShiftExpenses.reduce((sum, e) => sum + Number(e.paidAmount || 0), 0));

    // Direct Cash Purchases (Milk Purchases) paid specifically from THIS drawer.
    // Cash that left at intake: a partial return lowers paid_amount, but its refund is netted
    // separately below, so the live paid_amount would count the returned cash twice.
    const milkCashPaid = (p: any) => {
      const original = p.original_paid_amount ?? p.details?.original_paid_amount;
      if (original !== undefined && original !== null && original !== '') return Number(original) || 0;
      return Number(p.paid_amount ?? p.amount_paid ?? p.total_amount ?? 0);
    };
    const validMilkPurchases = purchases
      .filter(p => String(p.payment_mode || '').toLowerCase().includes('cash'))
      .filter(p => isDrawerTxInShiftWindow(p, p.account_id || (p as any).details?.account_id))
      .filter(p => milkCashPaid(p) > 0);
    const directCashPurchases = roundCurrency(validMilkPurchases.reduce((sum, p: any) => sum + milkCashPaid(p), 0));

    const countedPurchaseIds = new Set(validMilkPurchases.map(p => p.id));
    const countedExpenseIds = new Set(validShiftExpenses.map(e => e.id));

    // Material, Supplier, and Expense Vendor Cash Out paid specifically out of THIS drawer
    const validMaterialAndSupplierBtx = bankTransactions
      .filter((t: any) =>
        isDrawerTxInShiftWindow(t, t.account_id) &&
        t.type === 'Expense' &&
        ['Purchase', 'Supplier Payment', 'Vendor / Staff Payment', 'Milk Purchase'].includes(t.category)
      )
      .filter((t: any) => !t.reference_id || (!countedPurchaseIds.has(t.reference_id) && !countedExpenseIds.has(t.reference_id)));

    const materialAndSupplierCashOut = roundCurrency(validMaterialAndSupplierBtx.reduce((sum, t: any) => sum + Number(t.amount || 0), 0));

    const cashPurchases = roundCurrency(directCashPurchases + materialAndSupplierCashOut);

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
        amount: milkCashPaid(p),
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

    const validDeliveryCollections = dailySupplyEntries
      .filter(entry => entry.shift_session_id === shiftId && String(entry.payment_mode || '').toLowerCase().includes('cash') && Number(entry.payment_received || 0) > 0);

    const validRefundEvents = shiftCashEvents
      .filter(e => e.shift_id === shiftId && e.direction === 'In' && e.source_type !== 'payment_correction' && !e.event_type.toLowerCase().includes('sale') && !e.event_type.toLowerCase().includes('collection') && !e.event_type.toLowerCase().includes('vendor') && e.source_type !== 'expense_vendor_transaction' && Number(e.amount || 0) > 0);

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
          invoice_no: s.bill_number || s.id.slice(0, 10),
          customer_name: s.customer_name || 'Walk-in Customer',
          total: Number(s.total || 0),
          cash_paid: paid,
          refund_amount: refund,
          net_cash: Math.max(0, paid - refund),
          status: s.status || 'Completed',
          time: s.date
        };
      });

    const all_bills_list = allShiftSales.map(s => ({
      id: s.id,
      invoice_no: s.bill_number || s.id.slice(0, 10),
      customer_name: s.customer_name || 'Walk-in Customer',
      total: Number(s.total || 0),
      payment_mode: s.payment_mode || 'Cash',
      status: s.status || 'Completed',
      time: s.date
    }));

    const cashRefunds = roundCurrency(shiftCashEvents
      .filter(e => e.shift_id === shiftId && e.direction === 'Out' && e.event_type.toLowerCase().includes('refund') && !e.event_type.toLowerCase().includes('vendor') && e.source_type !== 'expense_vendor_transaction')
      .reduce((sum, e) => sum + Number(e.amount || 0), 0));

    // Refunds for sales originating in PRIOR shifts or external returns.
    // (Returns on this shift's cash sales are already net-zeroed in cashSales above to prevent double-deduction).
    // Sale ids contain underscores (sale_*, co_sale_*), so match the refund source by prefix, not by split('_').
    const isThisShiftSaleRefund = (sourceId?: string | null) => {
      const source = String(sourceId || '');
      return !!source && allShiftSales.some(s => source === s.id || source.startsWith(`${s.id}_`));
    };
    const priorShiftCashRefunds = roundCurrency(shiftCashEvents
      .filter(e => {
        if (e.shift_id !== shiftId || e.direction !== 'Out' || !e.event_type.toLowerCase().includes('refund')) return false;
        if (e.source_type === 'expense_vendor_transaction' || e.event_type.toLowerCase().includes('vendor')) return false;
        return !isThisShiftSaleRefund(e.source_id);
      })
      .reduce((sum, e) => sum + Number(e.amount || 0), 0));

    // Owner deposits / withdrawals and account transfers made straight on the drawer account during
    // this shift. System rows (float sync, remittance, over/short, opening balance, delivery API) are
    // accounted for elsewhere.
    const isInShiftWindow = (t: any) => t.shift_session_id === shiftId || (
      !t.shift_session_id && shiftStartTime > 0 &&
      new Date(t.created_at || t.date).getTime() >= shiftStartTime &&
      new Date(t.created_at || t.date).getTime() <= shiftEndTime
    );
    const SYSTEM_DRAWER_CATEGORIES = ['Opening Float', 'Cash Remittance', 'Cash Over / Short', 'Opening Balance'];
    const manualDrawerMoves = bankTransactions.filter((t: any) =>
      !!drawerAccountId && t.account_id === drawerAccountId &&
      ['Deposit', 'Withdrawal', 'Transfer_In', 'Transfer_Out'].includes(t.type) &&
      !SYSTEM_DRAWER_CATEGORIES.includes(t.category) &&
      !String(t.category || '').startsWith('Delivery') &&
      !/^btx_(float|remit|var|op|api)_/.test(String(t.id || '')) &&
      // Head's opening cash for the NEXT shift (addDrawerOpeningCash) is that shift's opening float.
      !/^Opening Float/i.test(String(t.description || '')) &&
      isInShiftWindow(t)
    );
    const manualDrawerIn = roundCurrency(manualDrawerMoves
      .filter((t: any) => t.type === 'Deposit' || t.type === 'Transfer_In')
      .reduce((sum, t: any) => sum + Number(t.amount || 0), 0));
    const manualDrawerOut = roundCurrency(manualDrawerMoves
      .filter((t: any) => t.type === 'Withdrawal' || t.type === 'Transfer_Out')
      .reduce((sum, t: any) => sum + Number(t.amount || 0), 0));

    // A payment-mode correction is an audit trail only: cashSales already follows the bill's current mode.
    const otherCashIn = roundCurrency(shiftCashEvents
      .filter(e => e.shift_id === shiftId && e.direction === 'In' && e.source_type !== 'payment_correction' && !e.event_type.toLowerCase().includes('sale') && !e.event_type.toLowerCase().includes('collection') && !e.event_type.toLowerCase().includes('vendor') && e.source_type !== 'expense_vendor_transaction')
      .reduce((sum, e) => sum + Number(e.amount || 0), 0)
      + purchaseReturnNet.cashIn.reduce((sum, item) => sum + Number(item.amount || 0), 0)
      + manualDrawerIn);

    const otherCashOut = roundCurrency(shiftCashEvents
      .filter(e => e.shift_id === shiftId && e.direction === 'Out' && e.source_type !== 'payment_correction' && !e.event_type.toLowerCase().includes('refund') && !e.event_type.toLowerCase().includes('expense') && !e.event_type.toLowerCase().includes('purchase') && !e.event_type.toLowerCase().includes('vendor') && e.source_type !== 'expense_vendor_transaction')
      .reduce((sum, e) => sum + Number(e.amount || 0), 0)
      + manualDrawerOut);

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
  }

  const isRollingOverShiftRef = useRef(false);

  async function rolloverStaleShift(staleShift: ShiftSession): Promise<ShiftSession | null> {
    if (isRollingOverShiftRef.current) return null;
    const currentBizDate = getBusinessDate();
    if (!staleShift || staleShift.status !== 'Active' || !staleShift.business_date || staleShift.business_date >= currentBizDate) {
      return staleShift;
    }
    if (businessDays.some(day => day.business_date === currentBizDate && day.status === 'Closed')) {
      return null;
    }

    isRollingOverShiftRef.current = true;
    try {
      const totals = getShiftTotals(staleShift.id);
      const expectedCash = Math.max(0, roundCurrency(Number(totals.expectedCash ?? staleShift.opening_counted ?? staleShift.opening_float ?? 0)));
      const handoverId = `handover_${generateUUID()}`;
      const remittanceId = `remit_${generateUUID()}`;

      // Close the previous day's unclosed shift with its full expected cash left in the drawer.
      const { error: closeErr } = await supabase.rpc('cash_control_close_shift', {
        p_shift_id: staleShift.id,
        p_expected_cash: expectedCash,
        p_counted_cash: expectedCash,
        p_leave_in_drawer: expectedCash,
        p_remit_to_head: 0,
        p_denominations: { closing: {}, leave_in_drawer: {}, remit_to_head: {} },
        p_difference_reason: '',
        p_notes: `Auto-closed overnight & carried forward to ${currentBizDate}`,
        p_totals: totals,
        p_handover_id: handoverId,
        p_remittance_id: remittanceId
      });

      if (closeErr) {
        console.warn('[ShiftRollover] Failed to close stale shift:', closeErr.message);
        return null;
      }

      // Start today's shift on the same drawer with the carried-forward float.
      const newShiftId = `shift_${currentBizDate}_${generateUUID().slice(0, 12)}`;
      const { data: started, error: startErr } = await supabase.rpc('cash_control_start_shift', {
        p_shift_id: newShiftId,
        p_business_day_id: `bd_${currentBizDate}`,
        p_business_date: currentBizDate,
        p_drawer_id: staleShift.drawer_id,
        p_user_id: currentUser?.id || staleShift.user_id,
        p_user_name: currentUser?.name || staleShift.user_name || 'Cashier',
        p_role_name: currentRole?.name || staleShift.role_name || 'Cashier',
        p_opening_counted: expectedCash,
        p_denominations: {},
        p_handover_id: expectedCash > 0 ? handoverId : null
      });

      if (startErr) {
        console.warn('[ShiftRollover] Closed stale shift but failed to start new shift:', startErr.message);
        await refreshCashControl();
        return null;
      }

      const startedRow = Array.isArray(started) ? started[0] : started;
      if (!startedRow) {
        await refreshCashControl();
        return null;
      }

      const newShift = mapCashShift(startedRow);
      setShiftSessions(prev => [
        newShift,
        ...prev.map(s => s.id === staleShift.id ? { ...s, status: 'Closed' as const, closed_at: new Date().toISOString() } : s)
      ]);
      setActiveShiftSession(newShift);
      if (typeof window !== 'undefined') {
        localStorage.setItem('mooco_active_shift_session', JSON.stringify(newShift));
        if ('BroadcastChannel' in window) {
          try {
            const bc = new BroadcastChannel('mooco_shift_channel');
            bc.postMessage({ type: 'SHIFT_STARTED', shiftId: newShift.id });
            bc.close();
          } catch {}
        }
      }

      void refreshCashControl().catch(() => {});
      showToast(`Pichli shift (${staleShift.business_date}) auto-close kar ke aaj ki shift (Rs ${expectedCash.toLocaleString()}) start kar di gayi hai.`, 'info');
      return newShift;
    } catch (err) {
      console.warn('[ShiftRollover] Unexpected error:', err);
      return null;
    } finally {
      isRollingOverShiftRef.current = false;
    }
  }

  useEffect(() => {
    if (!hasLoadedData || !currentUser || !activeShiftSession) return;
    const checkAndRollover = () => {
      // The newest render's shift and totals: this interval outlives the render that set it up, and
      // its old closure auto-closed last night's shift with the expected cash of the sales made up to
      // that render (often the morning), not the whole day's.
      const { activeShiftSession: shift, rolloverStaleShift: rollover } = latest.current;
      const currentBizDate = getBusinessDate();
      if (
        shift &&
        shift.status === 'Active' &&
        shift.business_date &&
        shift.business_date < currentBizDate
      ) {
        void rollover(shift);
      }
    };
    checkAndRollover();
    const timer = window.setInterval(checkAndRollover, 60000);
    return () => window.clearInterval(timer);
  }, [hasLoadedData, currentUser?.id, activeShiftSession?.id, activeShiftSession?.business_date]);

  const closeCashierShift = async (data: {
    countedCash: number;
    leaveInDrawer: number;
    remitToHead: number;
    denominations?: ShiftCloseDenominations;
    differenceReason?: string;
    notes?: string;
    receiveIntoAccountId?: string;
    approveDifferenceNow?: boolean;
  }): Promise<boolean> => {
    if (!activeShiftSession || activeShiftSession.status !== 'Active') {
      showToast('No active shift found.', 'warning');
      return false;
    }
    const canReceiveAsHead = canApproveCashControl();
    const receiveIntoAccountId = canReceiveAsHead && data.receiveIntoAccountId && data.receiveIntoAccountId !== resolveDrawerAccountId(activeShiftSession.drawer_id)
      ? data.receiveIntoAccountId
      : undefined;
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

    // The Owner reviews differences anyway; on their own shift they can approve it right here,
    // so the business day is not left blocked by a difference nobody else will review.
    if (Math.abs(variance) >= 0.01 && data.approveDifferenceNow && currentUser?.role_id === 'role_super_admin' && activeShiftSession.user_id === currentUser.id) {
      const resolvedAt = new Date().toISOString();
      const { error: approveError } = await supabase.from('cash_variances').update({
        status: 'Approved',
        resolution_notes: `Approved by owner at shift close: ${data.differenceReason || ''}`.trim(),
        resolved_by: currentUser.id,
        resolved_at: resolvedAt
      }).eq('id', `var_close_${closingShiftId}`).eq('status', 'Open');
      if (!approveError) {
        await supabase.from('cash_shifts').update({ status: 'Closed' }).eq('id', closingShiftId).eq('status', 'Pending Review');
      } else {
        console.warn('[closeCashierShift] Difference could not be approved:', approveError.message);
      }
    }

    // A head closing the shift already holds the cash: receive it into the chosen account now,
    // so it never sits "in transit" waiting for the same person to accept it in Head Inbox.
    let receivedNow = false;
    if (remit > 0 && receiveIntoAccountId) {
      const remitDenominations = data.denominations?.remit_to_head || {};
      receivedNow = await acceptHeadRemittance(remittanceId, remit, remitDenominations, receiveIntoAccountId, 'Received by head at shift close', { silent: true });
    }

    if (!receivedNow) await refreshCashControl();
    const receivedAccountName = accounts.find(a => a.id === receiveIntoAccountId)?.name || 'account';
    showToast(
      remit <= 0
        ? 'Shift closed. Drawer cash and records updated successfully.'
        : receivedNow
          ? `Shift closed. Rs ${remit.toLocaleString()} received into ${receivedAccountName}.`
          : receiveIntoAccountId
            ? `Shift closed, lekin Rs ${remit.toLocaleString()} abhi receive nahi hua — Cash Control → Head Inbox se accept karein.`
            : `Shift closed. Rs ${remit.toLocaleString()} sent to Head Inbox (pending until accepted).`,
      remit > 0 && receiveIntoAccountId && !receivedNow ? 'warning' : 'success'
    );
    return true;
  };

  const acceptHeadRemittance = async (
    remittanceId: string,
    countedAmount: number,
    denominations: Record<string | number, number> = {},
    destinationAccountId?: string,
    notes: string = '',
    opts: { silent?: boolean } = {}
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
    if (!opts.silent) showToast('Remittance received — darmiyan cash ab account mein aa gaya.', 'success');
    return true;
  };

  const resolveCashVariance = async (varianceId: string, status: 'Approved' | 'Adjusted' | 'Rejected', notes: string): Promise<boolean> => {
    const canApproveCash = canApproveCashControl();
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
    const canApprove = canApproveCashControl();
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
      // The replaced handover's cash stays in the drawer; a smaller declaration would hide the difference.
      if (netCredit < 0) {
        showToast(`Drawer mein pehle se Rs ${replacedSum.toLocaleString()} pending hain. Opening cash is se kam declare nahi ho sakti.`, 'warning');
        return false;
      }
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
          new Date().toISOString(),
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
    const canApprove = canApproveCashControl();
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
    // The handover's count difference is settled with it: left Open, it kept the business day from
    // closing although nothing was left to review.
    const resolvedAt = new Date().toISOString();
    const { data: settled, error: varianceError } = await supabase.from('cash_variances').update({
      status: action === 'Cancel' ? 'Rejected' : 'Approved',
      resolution_notes: notes || `Settled with handover (${newStatus}) by ${currentUser.name}`,
      resolved_by: currentUser.id,
      resolved_at: resolvedAt
    }).eq('handover_id', handoverId).eq('status', 'Open').select('shift_id');
    if (varianceError) {
      console.error('[resolveCashHandover] Handover difference left open:', varianceError);
      showToast('Handover update ho gaya, lekin uska cash difference open reh gaya. Differences mein resolve karein.', 'warning');
    }
    for (const shiftId of new Set((settled || []).map((row: any) => row.shift_id).filter(Boolean))) {
      const { count } = await supabase.from('cash_variances').select('id', { count: 'exact', head: true }).eq('shift_id', shiftId).eq('status', 'Open');
      if (!count) await supabase.from('cash_shifts').update({ status: 'Closed' }).eq('id', shiftId).eq('status', 'Pending Review');
    }
    await refreshCashControl();
    showToast(`Handover marked as ${newStatus}.`, 'success');
    return true;
  };

  const upsertCashDrawer = async (drawer: { id?: string; name: string; code: string; location?: string; account_id?: string | null; default_float: number; is_active: boolean }): Promise<boolean> => {
    const canManage = canApproveCashControl();
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
    const canCloseDay = canApproveCashControl();
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
      await fetchData([...STOCK, 'businessDays']);
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
    const canCloseDay = canApproveCashControl();
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
    const canCloseDay = canApproveCashControl();
    if (!currentUser || !canCloseDay) {
      showToast('Only a manager/owner can close the day.', 'error');
      return false;
    }
    const day = businessDays.find(d => d.id === businessDayId);
    if (!day) return false;
    const activeCount = shiftSessions.filter(s => s.business_day_id === businessDayId && ['Pending Acceptance', 'Active', 'Closing', 'Pending Review'].includes(s.status)).length;
    const pendingRemits = cashRemittances.filter(r => r.business_day_id === businessDayId && ['Pending', 'Disputed'].includes(r.status)).length;
    // Pending handovers = cash physically left in the drawer (or head-loaded
    // opening cash). They never block the close — the server accepts them once
    // the day is closed. Only DISPUTED handovers (real count mismatch) block, and those
    // already surface as an Open variance.
    const disputedHandovers = cashHandovers.filter(h => h.business_day_id === businessDayId && h.status === 'Disputed').length;
    const openVariances = cashVariances.filter(v => v.business_day_id === businessDayId && v.status === 'Open').length;
    if (activeCount || pendingRemits || disputedHandovers || openVariances) {
      showToast(`Day is not ready to close: ${activeCount} shift, ${pendingRemits} remittance, ${disputedHandovers} disputed handover, ${openVariances} difference pending.`, 'warning');
      return false;
    }
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
    // close_business_day re-checks readiness on the server, locks the day and only then accepts the
    // pending handovers and writes the Z-report, all in one transaction. It keeps a cash closing
    // recorded earlier when none comes with the lock.
    const { data: closeResult, error } = await supabase.rpc('close_business_day', {
      p_business_day_id: businessDayId,
      p_payload: { notes, summary, cash_close: cashClose || null, user_name: currentUser.name }
    });
    if (error) {
      showToast(`Day close nahi hua: ${moneyRpcMessage(error)}`, 'error');
      return false;
    }
    await refreshCashControl();
    showToast(
      (closeResult as any)?.already_closed ? `${day.business_date} ka din pehle hi band ho chuka tha.` : `${day.business_date} ka business day close ho gaya.`,
      (closeResult as any)?.already_closed ? 'info' : 'success'
    );
    return true;
  };

  const reopenBusinessDay = async (businessDayId: string, reason: string): Promise<boolean> => {
    // The same right the Reopen button checks (the Owner, or a cash_control:reopen grant); owner-only
    // here refused a reopen the screen offered.
    if (!currentUser || !canPerform('cash_control', 'reopen')) {
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
    const today = getTodayLocalDate();
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

      setShiftSessions(prev => prev.map(s => s.id === shiftId ? updatedShift : s));
      if (activeShiftSession?.id === shiftId) {
        setActiveShiftSession(null);
        localStorage.removeItem('mooco_active_shift_session');
      }
      localStorage.setItem('mooco_shift_sessions', JSON.stringify(
        shiftSessions.map(s => s.id === shiftId ? updatedShift : s)
      ));

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

      // The shared day lock MUST persist, otherwise other
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

  const lockDate = settings.security?.lockDate;
  const isPeriodLocked = useCallback((dateStr: string): boolean => {
    if (!lockDate || !dateStr) return false;
    return businessDayOf(dateStr) <= lockDate;
  }, [lockDate]);

  // Head / approver rights in Cash Control (receive remittances, resolve differences and handovers,
  // drawers, day closing): the Owner, the Manager role, or whoever canPerform lets approve, i.e. an
  // explicit cash_control:approve or the full module outside the cashier profile (see canPerform).
  const canApproveCashControl = () => currentUser?.role_id === 'role_manager' || canPerform('cash_control', 'approve');

  // The same rights the screens check, enforced here as well: a hidden button is not a permission,
  // and any caller (another screen, a shortcut, the console) reaches these actions.
  const requireRight = (moduleKey: string, action: string, what: string): boolean => {
    if (canPerform(moduleKey, action)) return true;
    showToast(`Aap ko ${what} ki ijazat nahi hai.`, 'error');
    return false;
  };

  // Shared guard for anything that writes a dated entry: refuses dates inside the closed books.
  const guardOpenPeriod = (dateStr?: string): boolean => {
    if (!dateStr || !isPeriodLocked(dateStr)) return true;
    showToast(`Books ${settings.security?.lockDate} tak band hain. Is tareekh ki entry add, edit ya delete nahi ho sakti.`, 'error');
    return false;
  };

  const isDayLocked = useCallback((dateStr: string): boolean => {
    if (isPeriodLocked(dateStr)) return true;
    const d = businessDayOf(dateStr);
    return businessDays.some(day => day.business_date === d && day.status === 'Closed');
  }, [isPeriodLocked, businessDays]);

  const reopenDayClosing = async (dayClosingId: string): Promise<boolean> => {
    if (!canPerform('cash_control', 'reopen')) {
      showToast('Only Owner / Super Admin can reopen a locked business day!', 'error');
      return false;
    }

    setDayClosings(prev => prev.filter(c => c.id !== dayClosingId));
    localStorage.setItem('mooco_day_closings', JSON.stringify(dayClosings.filter(c => c.id !== dayClosingId)));
    const { error: dcDelError } = await supabase.from('day_closings').delete().eq('id', dayClosingId);
    if (dcDelError) {
      console.error('[Supabase Day Reopen Error]', dcDelError);
      showToast('Warning: cloud day lock could not be removed — other devices may still see this day as locked.', 'error');
      fetchData(['dayClosings']);
      return false;
    }
    showToast('Day closing unlocked & reopened successfully', 'info');
    return true;
  };
  
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

      const customerDataPayload = { ...extraData, opening_balance: initialBalance };
      const localCust: LocalCustomer = {
        id,
        name,
        phone: phone || '',
        address: address || '',
        route: route || '',
        type: type || 'Retail Counter',
        balance: initialBalance,
        is_active: isActive !== undefined ? isActive : true,
        data: customerDataPayload,
        sync_status: 'pending',
        created_at: createdDate
      };
      await db.customers.put(localCust);
      noteLocalWrite();

      setCustomers(prev => [...prev, { ...newCustObj, data: customerDataPayload }]);

      if (initialBalance !== 0) {
        const opTxRecord = {
          id: `ctx_op_${id}`,
          customer_id: id,
          // Pakistan date: the UTC date is yesterday for customers added 00:00–05:00 PKT.
          date: getTodayLocalDate(),
          type: (initialBalance > 0 ? 'Charge' : 'Payment') as any,
          amount: Math.abs(initialBalance),
          mode: 'Opening Balance',
          note: initialBalance > 0 ? 'Opening Balance (Initial Receivable)' : 'Opening Balance (Initial Advance/Credit)'
        };
        setCustomerTransactions(prev => [opTxRecord as any, ...prev]);
        // The ledger row itself is written by the sync right after the customer row (same fixed id,
        // errors retried). Inserting it here as well raced the customer insert, usually failed on the
        // missing customer, and that failure was only a console warning.
      }

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
    if (!requireRight('customers', 'edit', 'customer ki tafseel badalne')) return false;
    return updateCustomerRecord(id, u);
  };

  // Internal: archive / reactivate check their own (delete / edit) right before calling this.
  const updateCustomerRecord = async (id: string, u: Partial<Customer>) => {
    try {
      // The khata balance moves only through ledger entries (sale, payment, charge, return). A profile
      // edit that sets it would change the balance with no customer_transactions row behind it.
      const { name, phone, address, route, type, balance: _ignoredBalance, isActive, ...extraData } = u;
      setCustomers(prev => prev.map(c => c.id === id ? { ...c, ...extraData, ...(name !== undefined ? { name } : {}), ...(phone !== undefined ? { phone } : {}), ...(address !== undefined ? { address } : {}), ...(route !== undefined ? { route } : {}), ...(type !== undefined ? { type } : {}), ...(isActive !== undefined ? { isActive } : {}) } : c));
      const dbUpdates: any = {};
      if (name !== undefined) dbUpdates.name = name;
      if (phone !== undefined) dbUpdates.phone = phone;
      if (address !== undefined) dbUpdates.address = address;
      if (route !== undefined) dbUpdates.route = route;
      if (type !== undefined) dbUpdates.type = type;
      if (isActive !== undefined) dbUpdates.is_active = isActive;

      if (Object.keys(extraData).length > 0) {
        const { data: existing } = await supabase.from('customers').select('data').eq('id', id).single();
        dbUpdates.data = { ...(existing?.data || {}), ...extraData };
      }

      if (Object.keys(dbUpdates).length > 0) {
        const { error } = await supabase.from('customers').update(dbUpdates).eq('id', id);
        if (error) {
          showToast("Failed to update customer: " + error.message, 'error');
          fetchData(['customers']);
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
        fetchData(['customers']);
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
          if (date && isDayLocked(date)) {
            showToast('Ye din band (locked) hai. Entry aaj ki tareekh par darj karein.', 'error');
            return false;
          }
          if (!canPerform('customers', type === 'Payment' ? 'payment' : 'edit')) {
            showToast('Aap ko customer khata mein entry karne ki ijazat nahi hai.', 'error');
            return false;
          }
          if (!(Number(amount) > 0)) {
            showToast('Amount 0 se zyada honi chahiye.', 'warning');
            return false;
          }
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

              showToast(type === 'Charge' ? 'Customer khata mein charge darj ho gaya' : 'Customer Payment Recorded Successfully', "success");
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
      if (!canPerform('customers', 'delete')) {
        showToast('Aap ko khata entry delete karne ki ijazat nahi hai.', 'error');
        return false;
      }
      const tx = customerTransactions.find(t => t.id === id);
      if (tx && tx.date && isDayLocked(tx.date)) {
        showToast('Ye entry band (locked) din ki hai. Delete ki jagah ulti (reverse) entry karein.', 'error');
        return false;
      }
      const txShift = (tx as any)?.shift_session_id ? shiftSessions.find(s => s.id === (tx as any).shift_session_id) : undefined;
      if (tx?.type === 'Payment' && txShift && txShift.status !== 'Active' && txShift.status !== 'Closing') {
        showToast('Ye payment band shift ki hai, drawer ka hisaab ho chuka hai. Delete ki jagah ulti (reverse) entry karein.', 'error');
        return false;
      }

      // Balance reversal (khata + account + linked bank tx) happens in ONE atomic Postgres
      // transaction, keyed off the stored ledger row. No fallback account: money is only taken back
      // from the account the payment actually went into (opening advances / write-offs had none).
      const { error: delError } = await supabase.rpc('delete_customer_transaction_effects', {
        p_tx_id: id,
        p_fallback_account_id: null
      });
      if (delError) throw delError;

      if (tx) {
        const cust = customers.find(c => c.id === tx.customer_id);
        if (cust) {
          // Payment and Return both lowered the khata when posted, so deleting them raises it back.
          const balanceReversal = (tx.type === 'Payment' || (tx.type as string) === 'Return') ? tx.amount : -tx.amount;
          setCustomers(prev => prev.map(c => c.id === tx.customer_id ? { ...c, balance: roundCurrency(cust.balance + balanceReversal) } : c));
        }
      }
      setCustomerTransactions(prev => prev.filter(t => t.id !== id));
      fetchData(['customers', 'customerTransactions', ...MONEY_CHANGED]);
      return true;
    } catch (e) {
      console.error("deleteCustomerTransaction error:", e);
      showToast("Transaction delete failed: " + getErrorMessage(e), "error");
      fetchData(['customers', 'customerTransactions', ...MONEY_CHANGED]);
      return false;
    }
  };
  
  const addExpense = async (e: Omit<ExpenseEntry, 'id'>) => {
    if (!requireRight('expenses', 'create', 'kharcha darj karne')) return false;
    try {
      const id = `exp_${generateUUID()}`;
      const { date, category, amount, paidAmount, paymentStatus, description, account_id, account_name, vendor_id, vendor_name, ...extraDetails } = e as any;
      if (!guardOpenPeriod(date)) return false;
      if (date && isDayLocked(date)) {
        showToast('Ye din band (locked) hai. Kharcha aaj ki tareekh par darj karein.', 'error');
        return false;
      }
      
      const totalAmt = amount || 0;
      const actualPaidAmount = paymentStatus === 'Unpaid' 
        ? 0 
        : (paymentStatus === 'Partial' ? (paidAmount || 0) : (paidAmount !== undefined ? paidAmount : totalAmt));
      const status = paymentStatus || (actualPaidAmount >= totalAmt ? 'Paid' : (actualPaidAmount > 0 ? 'Partial' : 'Unpaid'));
      const unpaidPortion = Math.max(0, totalAmt - actualPaidAmount);

      const matchedExpenseShift = account_id ? (
        (activeShiftSession?.status === 'Active' &&
          activeShiftSession?.drawer_id &&
          (account_id === activeShiftSession.drawer_id || account_id === resolveDrawerAccountId(activeShiftSession.drawer_id))
          ? activeShiftSession
          : null) ||
        shiftSessions.find(s =>
          s.status === 'Active' &&
          Boolean(s.drawer_id) &&
          (account_id === s.drawer_id || account_id === resolveDrawerAccountId(s.drawer_id))
        ) || null
      ) : null;
      const activeDrawerId = matchedExpenseShift ? matchedExpenseShift.drawer_id : null;
      const shiftSessionId = matchedExpenseShift ? (matchedExpenseShift.id || null) : null;
      const businessDayId = matchedExpenseShift ? (matchedExpenseShift.business_day_id || null) : null;
      const cashierId = matchedExpenseShift ? matchedExpenseShift.user_id : (currentUser?.id || null);
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
    if (!requireRight('expenses', 'delete', 'kharcha delete karne')) return false;
    try {
      const exp = expenses.find(e => e.id === id);
      if (exp) {
        // Period lock: closed shifts or locked business days cannot be altered.
        const dayLocked = exp.date ? isDayLocked(exp.date) : false;
        const shiftLocked = exp.shift_session_id ? shiftSessions.some(s => s.id === exp.shift_session_id && (s.status === 'Closed' || s.status === 'Force Closed')) : false;
        if (dayLocked || shiftLocked) {
          showToast('Closed Period Lock: This expense belongs to a closed shift or locked business day. Physical drawer cash was already reconciled. Please post an Expense Reversal.', 'error');
          return false;
        }

        const paid = exp.paidAmount !== undefined ? exp.paidAmount : exp.amount;
        const accountId = exp.account_id || (exp as any)?.details?.account_id;

        // The voucher is deleted LAST, so a failed step leaves it on screen and the delete can be retried.
        // Each money step is recorded on the voucher (details.delete_reversal) as soon as it succeeds;
        // a retry skips what was already put back instead of restoring it twice.
        const { data: expRow, error: expReadError } = await supabase.from('expenses').select('details').eq('id', id).maybeSingle();
        if (expReadError) throw expReadError;
        let reversal: Record<string, boolean> = { ...(expRow?.details?.delete_reversal || {}) };
        const markStep = async (step: string) => {
          const nextReversal = { ...reversal, [step]: true };
          const { error } = await supabase.from('expenses').update({ details: { ...(expRow?.details || {}), delete_reversal: nextReversal } }).eq('id', id);
          if (!error) reversal = nextReversal;
          return error;
        };

        if (accountId && paid > 0) {
          const acc = accounts.find(a => a.id === accountId);
          if (acc && !reversal.account_restored) {
            const { error: expAccError } = await adjustAccountBalance(accountId, paid);
            if (expAccError) throw expAccError;
            const markError = await markStep('account_restored');
            if (markError) {
              // Not recorded: take the money back out so a retry does not restore it twice.
              await adjustAccountBalance(accountId, -paid);
              throw markError;
            }
            setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, balance: roundCurrency((a.balance || 0) + paid) } : a));
          }
          // bank_transactions has no related_expense_id column: filtering on it failed the whole
          // delete, so the expense's bank row stayed behind after the money was put back.
          // Deleting it is safe to repeat.
          const { error: btxDelError } = await supabase.from('bank_transactions').delete().or(`reference_id.eq.${id},id.eq.btx_${id}`);
          if (btxDelError) throw btxDelError;
          setBankTransactions(prev => prev.filter(b => b.related_expense_id !== id && b.reference_id !== id && b.id !== `btx_${id}`));
        }

        if (exp.vendor_id) {
          const vendor = expenseVendors.find(v => v.id === exp.vendor_id);
          if (vendor && !reversal.vendor_restored) {
            const unpaidPortion = Math.max(0, (exp.amount || 0) - paid);
            const newPending = (vendor.pending_balance || 0) - unpaidPortion; // same delta the server applies
            const newPaid = Math.max(0, (vendor.total_paid || 0) - paid);
            const newBilled = Math.max(0, (vendor.total_billed || 0) - (exp.amount || 0));

            const { error: vendorRevError } = await adjustExpenseVendorStats(vendor.id, -unpaidPortion, -(exp.amount || 0), -paid);
            if (vendorRevError) throw vendorRevError;
            const markError = await markStep('vendor_restored');
            if (markError) {
              await adjustExpenseVendorStats(vendor.id, unpaidPortion, exp.amount || 0, paid);
              throw markError;
            }

            setExpenseVendors(prev => prev.map(v => v.id === exp.vendor_id ? {
              ...v,
              pending_balance: newPending,
              total_paid: newPaid,
              total_billed: newBilled
            } : v));
          }
        }

        // The voucher itself, only after its money is fully reversed.
        const { error: expDelError } = await supabase.from('expenses').delete().eq('id', id);
        if (expDelError) throw expDelError;
      } else {
        const { error: expDelError } = await supabase.from('expenses').delete().eq('id', id);
        if (expDelError) throw expDelError;
      }
      setExpenses(prev => prev.filter(e => e.id !== id));
      fetchData(['expenses', 'expenseVendors', ...MONEY_CHANGED]);
      return true;
    } catch(e) {
      console.error("deleteExpense error:", e);
      showToast('Expense delete nahi hua: ' + getErrorMessage(e), 'error');
      fetchData(['expenses', 'expenseVendors', ...MONEY_CHANGED]);
      return false;
    }
  };

  // One edit per expense at a time (also across tabs): two saves moved the money twice.
  const updateExpense = async (id: string, updates: Partial<ExpenseEntry>): Promise<boolean> => {
    if (!requireRight('expenses', 'edit', 'kharcha badalne')) return false;
    const result = await actionLock.runExclusiveAcrossTabs(`update_expense_${id}`, () => updateExpenseUnlocked(id, updates));
    if (result === null) {
      showToast('Is kharche ki pichli tabdeeli abhi save ho rahi hai.', 'warning');
      return false;
    }
    return result;
  };

  const updateExpenseUnlocked = async (id: string, updates: Partial<ExpenseEntry>): Promise<boolean> => {
    try {
      const exp = expenses.find(e => e.id === id);
      if (!exp) return false;

      const dayLocked = exp.date ? isDayLocked(exp.date) : false;
      const shiftLocked = exp.shift_session_id ? shiftSessions.some(s => s.id === exp.shift_session_id && (s.status === 'Closed' || s.status === 'Force Closed')) : false;
      if (dayLocked || shiftLocked) {
        showToast('Closed Period Lock: This expense belongs to a closed shift or locked business day.', 'error');
        return false;
      }
      // Moving an expense INTO a locked day would change that day's closed figures too.
      if (updates.date && updates.date !== exp.date && isDayLocked(updates.date)) {
        showToast('Closed Period Lock: Expense ko band (locked) din par nahi le ja sakte.', 'error');
        return false;
      }

      const oldPaid = exp.paidAmount !== undefined ? exp.paidAmount : exp.amount;
      const oldAccountId = exp.account_id || (exp as any)?.details?.account_id;
      const merged = { ...exp, ...updates };
      const newTotal = Number(merged.amount) || 0;
      const newPaid = merged.paymentStatus === 'Unpaid'
        ? 0
        : (merged.paymentStatus === 'Partial' ? (Number(merged.paidAmount) || 0) : (merged.paidAmount !== undefined ? Number(merged.paidAmount) : newTotal));
      const newAccountId = merged.account_id || null;
      const newDate = normalizeTransactionTimestamp(merged.date || new Date().toISOString());

      // update_expense undoes the old payment and vendor figures, saves the voucher and posts the new
      // ones in one transaction; payment fields live in details (expenses has no such columns).
      const { id: _id, paidAmount: _paidAmount, paymentStatus: _paymentStatus, ...rest } = merged as any;
      const result = await callMoneyRpc('update_expense', `update_expense:${id}:${JSON.stringify(updates)}`, requestId => ({
        p_expense_id: id,
        p_edit_id: requestId,
        p_payload: {
          ...rest,
          date: newDate,
          category: merged.category,
          amount: newTotal,
          paid_amount: newPaid,
          payment_status: merged.paymentStatus || null,
          description: merged.description || '',
          account_id: newAccountId,
          account_name: merged.account_name || null,
          vendor_id: merged.vendor_id || null,
          vendor_name: merged.vendor_name || null
        }
      }));
      if (result?.already_applied) {
        showToast('Ye tabdeeli pehle hi save ho chuki thi.', 'info');
        fetchData(['expenses', 'expenseVendors', ...MONEY_CHANGED]);
        return true;
      }

      const savedPaid = roundCurrency(Number(result?.paid_amount) || 0);
      const updatedExpense: ExpenseEntry = {
        ...merged,
        amount: roundCurrency(Number(result?.amount) || 0),
        paidAmount: savedPaid,
        paymentStatus: result?.payment_status || merged.paymentStatus,
        date: newDate
      };
      const newBankRow = newAccountId && savedPaid > 0 ? {
        id: `btx_${id}`,
        account_id: newAccountId,
        amount: savedPaid,
        date: newDate,
        type: 'Expense',
        category: merged.category || 'Expense',
        description: `Expense: ${merged.description || ''}${merged.vendor_name ? ` (${merged.vendor_name})` : ''}`,
        reference_id: id,
        business_day_id: exp.business_day_id,
        shift_session_id: exp.shift_session_id,
        drawer_id: exp.drawer_id,
        cashier_id: exp.cashier_id
      } : null;

      // The screen follows the server's answer until the refresh lands.
      setBankTransactions(prev => [
        ...(newBankRow ? [newBankRow as any] : []),
        ...prev.filter(b => b.related_expense_id !== id && b.reference_id !== id && b.id !== `btx_${id}`)
      ]);
      setAccounts(prev => prev.map(a => {
        let balance = a.balance || 0;
        if (oldAccountId && oldPaid > 0 && a.id === oldAccountId) balance += oldPaid;
        if (newBankRow && a.id === newAccountId) balance -= savedPaid;
        return balance === (a.balance || 0) ? a : { ...a, balance: roundCurrency(balance) };
      }));
      setExpenses(prev => prev.map(e => e.id === id ? updatedExpense : e));
      showToast("Expense updated successfully", "success");
      fetchData(['expenses', 'expenseVendors', ...MONEY_CHANGED]);
      return true;
    } catch (err) {
      console.error("updateExpense error:", err);
      showToast("Kharcha update nahi hua: " + moneyRpcMessage(err), "error");
      return false;
    }
  };

  // Both used to report success whatever the database said.
  const addRecurringExpense = async (e: Omit<RecurringExpense, 'id'>) => {
    if (!requireRight('expenses', 'create', 'recurring kharcha banane')) return false;
    try {
      const id = `re_${generateUUID()}`;
      const { name, amount, ...extraDetails } = e;
      const dbRecurring = {
        id,
        name,
        amount: amount || 0,
        details: extraDetails
      };
      const { error } = await supabase.from('recurring_expenses').insert([dbRecurring]);
      if (error) throw error;
      fetchData(['recurringExpenses']);
      return true;
    } catch (err) {
      showToast('Recurring kharcha save nahi hua: ' + getErrorMessage(err), 'error');
      return false;
    }
  };

  const deleteRecurringExpense = async (id: string) => {
    if (!requireRight('expenses', 'delete', 'recurring kharcha delete karne')) return false;
    const { error } = await supabase.from('recurring_expenses').delete().eq('id', id);
    if (error) {
      showToast('Recurring kharcha delete nahi hua: ' + error.message, 'error');
      return false;
    }
    fetchData(['recurringExpenses']);
    return true;
  };
  
  const addExpenseVendor = async (v: Omit<ExpenseVendor, 'id' | 'total_paid'> & { id?: string }): Promise<string | false> => {
    if (!requireRight('expenses', 'create', 'vendor banane')) return false;
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
      fetchData(['expenseVendors']);
      return id;
    } catch (e: any) { 
      console.error("addExpenseVendor error:", e);
      showToast(`Failed to add vendor: ${e?.message || 'Error'}`, "error");
      return false; 
    }
  };

  const updateExpenseVendor = async (id: string, updates: Partial<ExpenseVendor>) => {
    if (!requireRight('expenses', 'edit', 'vendor badalne')) return false;
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

      if (updates.name && updates.name !== existing.name) {
        setExpenses(prev => prev.map(exp => exp.vendor_id === id ? { ...exp, vendor_name: updates.name } : exp));
      }

      showToast(`Vendor "${name || existing.name}" updated successfully!`, "success");
      fetchData(['expenseVendors']);
      return true;
    } catch (e: any) {
      console.error("updateExpenseVendor error:", e);
      showToast(`Failed to update vendor: ${e?.message || 'Error'}`, "error");
      return false;
    }
  };

  const deleteExpenseVendor = async (id: string) => {
    if (!requireRight('expenses', 'delete', 'vendor delete karne')) return false;
    try {
      const vendor = expenseVendors.find(v => v.id === id);
      // A vendor with bills, payments or a balance keeps its history: archive it instead.
      const assessment = getDeleteAssessment('vendor', id);
      if (!assessment.canHardDelete) {
        showToast(`Vendor delete nahi ho sakta: ${assessment.blockingReasons[0] || 'history maujood hai'} Inactive kar dein.`, 'warning');
        return false;
      }
      const { error } = await supabase.from('expense_vendors').delete().eq('id', id);
      if (error) throw error;
      setExpenseVendors(prev => prev.filter(v => v.id !== id));

      showToast(`Vendor "${vendor?.name || ''}" deleted successfully`, "info");
      fetchData(['expenseVendors']);
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
    if (!requireRight('expenses', 'create', 'vendor payment darj karne')) return false;
    try {
      if (!guardOpenPeriod(date)) return false;
      if (date && isDayLocked(date)) {
        showToast('Ye din band (locked) hai. Entry aaj ki tareekh par darj karein.', 'error');
        return false;
      }
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

      setExpenseVendors(prev => prev.map(v => v.id === vendorId ? {
        ...v,
        pending_balance: newPending,
        total_paid: newTotalPaid
      } : v));

      const pendingDelta = isRefund ? amount : -amount;
      const paidDelta = isRefund ? -amount : amount;
      const { error: statsError } = await adjustExpenseVendorStats(vendorId, pendingDelta, 0, paidDelta);
      if (statsError) throw statsError;

      const isCashMode = !mode || mode.toLowerCase().includes('cash');
      const targetAccountId = accountId || (
        isCashMode
          ? (activeShiftSession?.account_id || activeShiftSession?.drawer_id || settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash' && a.isActive !== false)?.id || accounts.find(a => a.isActive !== false)?.id)
          : (settings.financial?.defaultDigitalAccountId || accounts.find(a => (a.type === 'Bank' || a.type === 'Wallet') && a.isActive !== false)?.id || accounts.find(a => a.isActive !== false)?.id)
      );
      const chosenAccount = accounts.find(a => a.id === targetAccountId);
      if (chosenAccount) {
        const newAccBal = isRefund
          ? (chosenAccount.balance + amount)
          : (chosenAccount.balance - amount);

        setAccounts(prev => prev.map(a => a.id === targetAccountId ? { ...a, balance: newAccBal } : a));
        const { error: evtAccError } = await adjustAccountBalance(targetAccountId, isRefund ? amount : -amount);
        if (evtAccError) throw evtAccError;

        const btxId = `btx_${txId}`;
        const btxType = isRefund ? 'Income' : 'Expense';
        const btxCategory = isRefund ? 'Vendor / Staff Refund' : 'Vendor / Staff Payment';
        const btxDesc = isRefund
          ? `Refund / Return from: ${vendor.name}${note ? ` (${note})` : ''}`
          : `Payment to: ${vendor.name}${note ? ` (${note})` : ''}`;

        // Only money that left THIS shift's drawer belongs to the shift. Any Cash account (head cash,
        // another till) used to be stamped with this drawer and shift as well.
        const isDrawerAccount = Boolean(
          activeShiftSession?.status === 'Active' && (
            chosenAccount.id === activeShiftSession?.drawer_id ||
            chosenAccount.id === resolveDrawerAccountId(activeShiftSession?.drawer_id)
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
      fetchData(['expenseVendors', 'expenseVendorTransactions', ...MONEY_ADDED]);
      return true;
    } catch (err: any) {
      console.error("recordExpenseVendorPayment error:", err);
      showToast(`Failed to record transaction: ${err?.message || 'Error'}`, "error");
      return false;
    }
  };

  const deleteExpenseVendorTransaction = async (id: string): Promise<boolean> => {
    if (!requireRight('expenses', 'delete', 'vendor entry delete karne')) return false;
    try {
      const tx = expenseVendorTransactions.find(t => t.id === id);
      if (tx && !guardOpenPeriod(tx.date)) return false;
      if (tx?.date && isDayLocked(tx.date)) {
        showToast('Ye entry band (locked) din ki hai. Delete ki jagah ulti (reverse) entry karein.', 'error');
        return false;
      }
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

          const { error: btxDelError } = await supabase.from('bank_transactions').delete().eq('reference_id', id);
          if (btxDelError) console.warn('[deleteExpenseVendorTransaction] bank_transaction delete notice:', btxDelError);
          setBankTransactions(prev => prev.filter(b => b.reference_id !== id));

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
      fetchData(['expenseVendors', 'expenseVendorTransactions', ...MONEY_CHANGED]);
      return true;
    } catch (e) {
      console.error("deleteExpenseVendorTransaction error:", e);
      return false;
    }
  };
  
  const addAccount = async (a: any) => {
    const { id: givenId, name, type, balance, isActive, ...extraDetails } = a;
    const accountKey = `create_account:${JSON.stringify(a)}`;
    const id = givenId || `acc_${requestIdFor(accountKey, generateUUID)}`;
    try {
      const opening = roundCurrency(Number(balance) || 0);
      setAccounts(prev => [{ id, name, type, balance: opening, isActive: isActive !== undefined ? isActive : true, ...extraDetails } as FinancialAccount, ...prev.filter(acc => acc.id !== id)]);
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
      // create_financial_account opens the account at 0 and posts the opening balance through its
      // ledger row in the same transaction, so balance and ledger always agree.
      await callMoneyRpc('create_financial_account', accountKey, () => ({
        p_payload: {
          id,
          name,
          type,
          opening_balance: opening,
          is_active: isActive !== undefined ? isActive : true,
          details: extraDetails
        }
      }));
      fetchData(['cashDrawers', ...MONEY_ADDED]);
      return true;
    } catch (e) {
      console.error("addAccount error:", e);
      setAccounts(prev => prev.filter(acc => acc.id !== id));
      if (type === 'Cash') setCashDrawers(prev => prev.filter(d => d.id !== id));
      showToast('Account nahi bana: ' + moneyRpcMessage(e), 'error');
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
      fetchData(['accounts', 'cashDrawers']);
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
      fetchData(['accounts', 'cashDrawers']);
      return true;
    } catch (e) {
      console.error("deleteAccount error:", e);
      return false;
    }
  };
  const recordBankTransaction = async (data: any) => {
      try {
          if (!guardOpenPeriod(data.date)) return false;
          // record_bank_transaction_effects posts the cash/bank side and the contra Chart of Accounts
          // line (related_account_id) together, each as a delta on its locked row.
          const { related_account_id, ...rowData } = data;
          await callMoneyRpc('record_bank_transaction_effects', `bank_tx:${JSON.stringify(data)}`, requestId => ({
            p_payload: {
              ...rowData,
              id: `btx_${requestId}`,
              related_account_id: related_account_id || null,
              date: normalizeTransactionTimestamp(data.date),
              business_day_id: data.business_day_id || activeShiftSession?.business_day_id || null,
              shift_session_id: data.shift_session_id || activeShiftSession?.id || null,
              drawer_id: data.drawer_id || activeShiftSession?.drawer_id || null,
              cashier_id: data.cashier_id || activeShiftSession?.user_id || currentUser?.id || null
            }
          }));
          fetchData(related_account_id ? ['manualAccounts', ...MONEY_ADDED] : MONEY_ADDED);
          return true;
      } catch(e) {
        console.error('recordBankTransaction error:', e);
        showToast(`${data?.type || 'Entry'} record nahi hui: ${moneyRpcMessage(e)}`, 'error');
        return false;
      }
  };
  const transferFunds = async (fromId: string, toId: string, amount: number, date: string, description: string) => {
      try {
          if (!guardOpenPeriod(date)) return false;
          // Single atomic RPC: locks both rows, moves the money, writes both
          // bank_transactions in one transaction.
          const normalizedDate = normalizeTransactionTimestamp(date);
          const { error } = await transferBetweenAccounts(fromId, toId, amount, normalizedDate, description);
          if (error) throw error;
          fetchData(MONEY_ADDED);
          return true;
      } catch(e: any) { 
          showToast("Transfer failed: " + getErrorMessage(e), "error");
          return false; 
      }
  };
  // Chart of Accounts edits: each used to report success (or keep its optimistic change) whatever
  // the database answered.
  const addManualAccount = async (a: any) => {
    const id = a.id || `ma_${generateUUID()}`;
    try {
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
      fetchData(['manualAccounts']);
      return true;
    } catch(e) { 
      console.error(e);
      setManualAccounts(prev => prev.filter(m => m.id !== id));
      showToast('Account save nahi hua: ' + getErrorMessage(e), 'error');
      return false; 
    }
  };
  const deleteManualAccount = async (id: string) => { 
    try {
      const { error } = await supabase.from('manual_accounts').delete().eq('id', id);
      if (error) throw error;
      setManualAccounts(prev => prev.filter(a => a.id !== id));
      fetchData(['manualAccounts']); 
      return true; 
    } catch(e) {
      console.error(e);
      showToast('Account delete nahi hua: ' + getErrorMessage(e), 'error');
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
        const { data: existing, error: readError } = await supabase.from('manual_accounts').select('details').eq('id', id).single();
        if (readError) throw readError;
        dbUpdates.details = { ...(existing?.details || {}), ...extraDetails };
      }
      const { error } = await supabase.from('manual_accounts').update(dbUpdates).eq('id', id);
      if (error) throw error;
      fetchData(['manualAccounts']);
      return true;
    } catch(e) {
      console.error(e);
      showToast('Account update nahi hua: ' + getErrorMessage(e), 'error');
      return false;
    }
  };
  const addJournalEntry = async (entry: any) => {
    try {
      const { date, totalAmount: _totalAmount, lines, id: givenId, ...extraDetails } = entry;
      if (!guardOpenPeriod(date)) return false;
      const entryLines: Array<{ account_id: string; debit: number; credit: number; description?: string }> = lines || [];

      const totalDebit = roundCurrency(entryLines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
      const totalCredit = roundCurrency(entryLines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        showToast(`Double-entry unbalance! Debit (Rs ${totalDebit}) != Credit (Rs ${totalCredit})`, "error");
        return false;
      }

      // Every line must post somewhere; a line on an unknown account would leave the entry unbalanced.
      const unknownLine = entryLines.find(l => !manualAccounts.some(m => m.id === l.account_id) && !accounts.some(a => a.id === l.account_id));
      if (unknownLine) {
        showToast('Journal mein sirf Chart of Accounts aur Bank/Cash accounts chun sakte hain. Customer/Supplier khata ke liye payment ya charge use karein.', 'error');
        return false;
      }

      // post_journal_entry posts every line (Chart of Accounts by its normal balance, cash/bank with its
      // own ledger row) and saves the voucher in one transaction: a failed line leaves nothing posted.
      const entryDate = normalizeTransactionTimestamp(date || new Date().toISOString());
      const voucherKey = `journal:${JSON.stringify(entry)}`;
      const id = givenId || `je_${requestIdFor(voucherKey, generateUUID)}`;
      const result = await callMoneyRpc('post_journal_entry', voucherKey, () => ({
        p_entry_id: id,
        p_payload: {
          ...extraDetails,
          date: entryDate,
          lines: entryLines,
          business_day_id: activeShiftSession?.business_day_id || null,
          shift_session_id: activeShiftSession?.id || null,
          drawer_id: activeShiftSession?.drawer_id || null,
          cashier_id: currentUser?.id || null,
          drawer_account_ids: activeDrawerAccountIds()
        }
      }));
      if (result?.already_applied) showToast('Ye journal entry pehle hi post ho chuki thi.', 'info');

      fetchData(['journalEntries', 'manualAccounts', ...MONEY_ADDED]);
      return true;
    } catch(e) {
      console.error(e);
      showToast('Journal entry post nahi hui: ' + moneyRpcMessage(e), 'error');
      return false;
    }
  };

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

      if (!isZeroBalance(bal)) {
        blockingReasons.push(`Customer has an open balance of Rs ${Math.abs(bal).toLocaleString()} (${bal > 0 ? 'Receivable Khata' : 'Advance Credit'}).`);
      }
      if (hasHistory) {
        blockingReasons.push(`Customer has ${salesCount} sales bills, ${supplyCount} deliveries, and ${txCount} khata transactions.`);
      }

      return {
        canHardDelete: !hasHistory && isZeroBalance(bal),
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

      if (!isZeroBalance(bal)) {
        blockingReasons.push(`Supplier has a pending payable balance of Rs ${bal.toLocaleString()}.`);
      }
      if (hasHistory) {
        blockingReasons.push(`Supplier has ${purCount} milk intake records, ${matCount} material purchases, and ${txCount} payment transactions.`);
      }

      return {
        canHardDelete: !hasHistory && isZeroBalance(bal),
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
      // Ready-made packs are stock too: 0 kg loose with 40 jars on the shelf is not an empty item.
      const stock = stockOnHandBase(Number(inv?.quantity ?? (item as any)?.stock ?? 0), inv?.variant_stocks || item?.variant_stocks, item?.variants);
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
        blockingReasons.push(`Item has ${stock} ${item?.unit || 'units'} in current stock, packs included (Valuation at cost: Rs ${(stock * (item?.cost_price || 0)).toLocaleString()}).`);
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
      const txCount = bankTransactions.filter(t => t.account_id === id || t.related_account_id === id || (t as any).details?.related_account_id === id).length;
      const hasHistory = txCount > 0;

      if (isSystem) {
        blockingReasons.push('Default system financial account cannot be deleted or archived.');
      }
      if (!isZeroBalance(bal)) {
        blockingReasons.push(`Account currently has a balance of Rs ${bal.toLocaleString()}. You must transfer this balance to another account first.`);
      }
      if (hasHistory) {
        blockingReasons.push(`Account has ${txCount} historical bank and cash transactions.`);
      }

      return {
        canHardDelete: !isSystem && !hasHistory && isZeroBalance(bal),
        canDeactivate: !isSystem && isZeroBalance(bal),
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

      if (!isZeroBalance(bal)) {
        blockingReasons.push(`Vendor has an unpaid balance of Rs ${bal.toLocaleString()}.`);
      }
      if (hasHistory) {
        blockingReasons.push(`Vendor has ${expCount} linked expense bills and ${txCount} transactions.`);
      }

      return {
        canHardDelete: !hasHistory && isZeroBalance(bal),
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
    if (!requireRight('customers', 'delete', 'customer archive / delete karne')) return false;
    try {
      const cust = customers.find(c => c.id === id);
      if (!cust) return false;

      if (action === 'write_off_bad_debt') {
        // One write-off per customer at a time (also across tabs): a double click used to post it twice.
        // write_off_customer_balance writes off the server's balance (khata row, bad-debt expense,
        // balance move) and archives the customer in one transaction.
        const writeOffResult = await actionLock.runExclusiveAcrossTabs(`write_off_customer_${id}`, () =>
          callMoneyRpc('write_off_customer_balance', `write_off_customer:${id}`, requestId => ({
            p_customer_id: id,
            p_write_off_id: requestId,
            p_deactivate: true
          })));
        if (writeOffResult === null) {
          showToast('Is customer ka write-off pehle se chal raha hai.', 'warning');
          return false;
        }
        setCustomers(prev => prev.map(c => c.id === id ? { ...c, balance: 0, isActive: false } : c));
        showToast(`Customer "${cust.name}" balance written off and marked Inactive!`, 'success');
        fetchData(['customers', 'customerTransactions', 'expenses']);
        return true;
      }

      if (action === 'deactivate') {
        if (!(await updateCustomerRecord(id, { isActive: false }))) { showToast('Inactive karna save nahi hua. Dobara koshish karein.', 'error'); return false; }
        showToast(`Customer "${cust.name}" marked Inactive (Archived). Ledger and balance sheet preserved.`, 'info');
        fetchData(['customers']);
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
          fetchData(['customers']);
          return false;
        }
        showToast("Customer permanently deleted successfully", 'success');
        fetchData(['customers']);
        return true;
      }

      return false;
    } catch (e: any) {
      console.error("safeDeleteCustomer error:", e);
      showToast("Operation failed: " + moneyRpcMessage(e), 'error');
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
        // One settlement per supplier at a time (also across tabs). settle_supplier_balance settles the
        // server's balance (waiver for a payable, write-off for an advance) and archives the supplier
        // in one transaction.
        const settled = await actionLock.runExclusiveAcrossTabs(`settle_supplier_${id}`, () =>
          callMoneyRpc('settle_supplier_balance', `settle_supplier:${id}`, requestId => ({
            p_supplier_id: id,
            p_settle_id: requestId,
            p_deactivate: true
          })));
        if (settled === null) {
          showToast('Is supplier ka hisaab pehle se settle ho raha hai.', 'warning');
          return false;
        }
        setSuppliers(prev => prev.map(s => s.id === id ? { ...s, balance: 0, pending_balance: 0, isActive: false } : s));
        showToast(`Supplier "${supp.name}" balance settled via waiver and marked Inactive!`, 'success');
        fetchData(['suppliers', 'supplierTransactions']);
        return true;
      }

      if (action === 'deactivate') {
        if (!(await updateSupplier(id, { isActive: false }))) return false;
        showToast(`Supplier "${supp.name}" marked Inactive (Archived). Historical records preserved.`, 'info');
        fetchData(['suppliers']);
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
          fetchData(['suppliers']);
          return false;
        }
        showToast("Supplier permanently deleted successfully", 'success');
        fetchData(['suppliers']);
        return true;
      }

      return false;
    } catch (e: any) {
      console.error("safeDeleteSupplier error:", e);
      showToast("Operation failed: " + moneyRpcMessage(e), 'error');
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
        // Loose stock AND ready packs leave the shelf: writing off only the loose pile left the packs
        // sellable (and counted) on a discontinued item. Read from the server, not the screen copy.
        const { data: stockRow, error: stockReadError } = await supabase.from('items').select('stock, variant_stocks').eq('id', id).single();
        if (stockReadError) throw stockReadError;
        const loose = roundQuantity(Number(stockRow?.stock) || 0);
        const packDeltas: Record<string, number> = {};
        for (const [variantId, count] of Object.entries((stockRow?.variant_stocks || {}) as Record<string, number>)) {
          const packs = roundQuantity(Number(count) || 0);
          if (packs > 0) packDeltas[variantId] = -packs;
        }
        const looseOff = loose > 0 ? loose : 0;
        if (looseOff > 0 || Object.keys(packDeltas).length > 0) {
          const { error: writeOffError } = await adjustItemStock(id, -looseOff, Object.keys(packDeltas).length ? packDeltas : undefined);
          if (writeOffError) throw writeOffError;
          const now = new Date().toISOString();
          const logRows = [
            ...(looseOff > 0 ? [{
              id: `log_sp_${generateUUID()}`, date: now, item_id: id, item_name: item.name,
              old_quantity: loose, new_quantity: 0, difference: -looseOff, reason: AdjustmentReason.SPOILAGE,
              notes: 'Stock written off to spoilage prior to item discontinuation',
              details: { loose_delta: -looseOff }
            }] : []),
            ...Object.entries(packDeltas).map(([variantId, delta]) => ({
              id: `log_sp_${generateUUID()}`, date: now, item_id: id,
              item_name: `${item.name} (${(item.variants || []).find(v => v.id === variantId)?.name || 'Pack'})`,
              old_quantity: loose, new_quantity: loose, difference: 0, reason: AdjustmentReason.SPOILAGE,
              notes: `${-delta} pack(s) written off to spoilage prior to item discontinuation`,
              details: { variant_id: variantId, variant_delta: delta, loose_delta: 0 }
            }))
          ];
          const { error: logError } = await supabase.from('inventory_logs').insert(logRows);
          if (logError) console.error('[safeDeleteItem] Write-off log not saved:', logError);
          const clearPacks = (stocks: Record<string, number> | undefined) => {
            const next = { ...(stocks || {}) };
            Object.keys(packDeltas).forEach(variantId => { next[variantId] = 0; });
            return next;
          };
          setInventory(prev => prev.map(iv => iv.item_id === id ? { ...iv, quantity: looseOff > 0 ? 0 : iv.quantity, variant_stocks: clearPacks(iv.variant_stocks) } : iv));
          setItems(prev => prev.map(i => i.id === id ? { ...i, stock: looseOff > 0 ? 0 : (i as any).stock, variant_stocks: clearPacks(i.variant_stocks) } as any : i));
        }
        if (!(await updateItem(id, { isActive: false }))) { showToast('Inactive karna save nahi hua. Dobara koshish karein.', 'error'); return false; }
        showToast(`Stock written off to spoilage and "${item.name}" marked Inactive (Discontinued)!`, 'success');
        fetchData(STOCK);
        return true;
      }

      if (action === 'deactivate') {
        if (!(await updateItem(id, { isActive: false }))) { showToast('Inactive karna save nahi hua. Dobara koshish karein.', 'error'); return false; }
        showToast(`Item "${item.name}" marked Inactive (Discontinued). Past sales bills preserved.`, 'info');
        fetchData(['items']);
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
          fetchData(['items']);
          return false;
        }
        showToast("Item permanently deleted successfully", 'success');
        fetchData(['items']);
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
        // Same rule as the delete assessment: the default cash / digital account receives every
        // POS receipt, so archiving it left receipts with nowhere to go.
        if (!getDeleteAssessment('account', id).canDeactivate) {
          showToast('Default system account ya balance wala account archive nahi ho sakta.', 'error');
          return false;
        }
        if (!isZeroBalance(acc.balance)) {
          showToast(`Cannot archive account with non-zero balance (Rs ${acc.balance}). Transfer funds out first.`, 'error');
          return false;
        }
        if (!(await updateAccount(id, { isActive: false }))) { showToast('Inactive karna save nahi hua. Dobara koshish karein.', 'error'); return false; }
        showToast(`Account "${acc.name}" marked Inactive. Past statements preserved.`, 'info');
        fetchData(['accounts', 'cashDrawers']);
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
          fetchData(['accounts', 'cashDrawers']);
          return false;
        }
        showToast("Account permanently deleted", 'success');
        fetchData(['accounts', 'cashDrawers']);
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
    const right: Record<typeof entityType, [string, string]> = {
      customer: ['customers', 'edit'], supplier: ['suppliers', 'edit'], item: ['items', 'edit'],
      account: ['bank_cash', 'create'], vendor: ['expenses', 'edit']
    };
    if (!requireRight(right[entityType][0], right[entityType][1], 'dobara active karne')) return false;
    try {
      if (entityType === 'customer') {
        if (!(await updateCustomerRecord(id, { isActive: true }))) { showToast('Dobara active karna save nahi hua.', 'error'); return false; }
        showToast("Customer reactivated successfully!", 'success');
      } else if (entityType === 'supplier') {
        if (!(await updateSupplier(id, { isActive: true }))) { showToast('Dobara active karna save nahi hua.', 'error'); return false; }
        showToast("Supplier reactivated successfully!", 'success');
      } else if (entityType === 'item') {
        if (!(await updateItem(id, { isActive: true }))) { showToast('Dobara active karna save nahi hua.', 'error'); return false; }
        showToast("Item reactivated successfully!", 'success');
      } else if (entityType === 'account') {
        if (!(await updateAccount(id, { isActive: true }))) { showToast('Dobara active karna save nahi hua.', 'error'); return false; }
        showToast("Account reactivated successfully!", 'success');
      } else if (entityType === 'vendor') {
        if (!(await updateExpenseVendor(id, { isActive: true }))) { showToast('Dobara active karna save nahi hua.', 'error'); return false; }
        showToast("Vendor reactivated successfully!", 'success');
      }
      fetchData(entityType === 'customer' ? ['customers'] : entityType === 'supplier' ? ['suppliers'] : entityType === 'item' ? ['items'] : entityType === 'account' ? ['accounts', 'cashDrawers'] : ['expenseVendors']);
      return true;
    } catch (e: any) {
      console.error("reactivateEntity error:", e);
      showToast("Reactivation failed: " + getErrorMessage(e), 'error');
      return false;
    }
  };
  
  const updateSettings = async (newSettings: Partial<SystemSettings>): Promise<boolean> => {
    const previous = settings;
    try {
      const mergedSettings: any = {
        general: { ...settings.general, ...(newSettings.general || {}) },
        financial: { ...settings.financial, ...(newSettings.financial || {}) },
        sales: { ...settings.sales, ...(newSettings.sales || {}) },
        inventory: { ...settings.inventory, ...(newSettings.inventory || {}) },
        expenses: { ...(settings.expenses || {}), ...(newSettings.expenses || {}) }
      };
      // security is written only when this save is about it: re-sending this device's copy from
      // another tab's save could undo the Owner's newer lock date / discount limit.
      if ('security' in newSettings && newSettings.security != null) {
        mergedSettings.security = { ...(settings.security || {}), ...(newSettings.security || {}) };
      }

      setSettings(prev => ({ ...mergedSettings, security: mergedSettings.security ?? prev.security }));

      const { error } = await supabase
        .from('app_settings')
        .update(mergedSettings)
        .eq('id', 'global_settings');

      if (error) throw error;
      return true;
    } catch (err) {
      console.error("Failed to save settings:", err);
      setSettings(previous);
      showToast("Settings save nahi huin. Internet check karke dobara koshish karein.", "error");
      return false;
    }
  };

  const requestManagerApproval = async (approverId: string, pin: string, permission: string) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { approved: false, message: 'Manager PIN check karne ke liye internet zaroori hai.' };
    }
    const { data, error } = await supabase.rpc('app_approve_override', {
      p_user_id: approverId,
      p_pin: pin,
      p_permission: permission
    });
    if (error || !data?.approved) {
      return { approved: false, message: error?.message || 'Ghalat PIN code!' };
    }
    return { approved: true, approverName: String(data.name || '') };
  };

  const buildBackup = (): Record<string, unknown> => ({
    app: 'mooco-erp',
    exportedAt: new Date().toISOString(),
    exportedBy: currentUser?.name || '',
    settings,
    roles,
    users,
    customers, suppliers, items, inventory, inventoryLogs, categories,
    sales, dailySupplyEntries, customerTransactions,
    purchases, materialPurchases, supplierTransactions, allocations, productionBatches,
    expenses, recurringExpenses, expenseVendors, expenseVendorTransactions,
    accounts, bankTransactions, manualAccounts, journalEntries,
    retailClosings, shiftSessions, dayClosings, businessDays, cashDrawers, cashHandovers,
    cashRemittances, cashVariances, shiftCashEvents
  });
  
  // customer_orders.sale_id -> sales and customer_orders.customer_id -> customers have no ON DELETE,
  // so bookings pointing at the rows being wiped must go first (allOrders: every booking, for a
  // customers wipe; otherwise only billed ones linked to a sale). Completed bookings cannot be
  // updated (trigger) and the table may not allow client deletes (RLS), in which case the delete
  // removes nothing: what is left is counted and the reset stops BEFORE anything else is deleted,
  // instead of failing halfway on the foreign key.
  const clearCustomerOrderLinks = async (allOrders: boolean) => {
    const ALL = '00000000-0000-0000-0000-000000000000';
    // Deployments without the Customer Orders migration have no table and no foreign key.
    const missingTable = (error: any) => error?.code === '42P01' || error?.code === 'PGRST205';
    const deleteQuery = supabase.from('customer_orders').delete();
    const { error: delError } = await (allOrders ? deleteQuery.neq('id', ALL) : deleteQuery.not('sale_id', 'is', null));
    if (delError && !missingTable(delError)) throw delError;
    const countQuery = supabase.from('customer_orders').select('id', { count: 'exact', head: true });
    const { count, error: countError } = await (allOrders ? countQuery : countQuery.not('sale_id', 'is', null));
    if (countError) {
      if (missingTable(countError)) return;
      throw countError;
    }
    if ((count || 0) > 0) {
      throw new Error(`${count} Customer Order booking(s) in records se linked hain aur app unhe delete nahi kar sakti. Pehle database se customer_orders saaf karwayein; kuch bhi delete nahi hua.`);
    }
  };

  const resetSystem = async () => {
    if (currentUser?.role_id !== 'role_super_admin') {
      showToast('Sirf Owner / Super Admin data delete kar sakta hai.', 'error');
      return;
    }
    try {
      showToast("Resetting system, please wait...", "info");
      const sentinel = '00000000-0000-0000-0000-000000000000';

      // Bookings reference sales and customers (no ON DELETE): cleared or the reset stops here.
      await clearCustomerOrderLinks(true);

      // Delete cash control activity one level at a time, children before parents:
      // cash_variances -> remittances/handovers/shifts/days, shift_cash_events -> shifts/days,
      // remittances/handovers -> shifts/days, cash_shifts -> business_days. Run in parallel they raced
      // the foreign keys and the reset stopped with half the cash records gone.
      const cashSteps: string[][] = [
        ['cash_variances'],
        ['shift_cash_events'],
        ['cash_remittances', 'drawer_handovers', 'day_closings'],
        ['cash_shifts'],
        ['business_days'],
      ];
      for (const step of cashSteps) {
        const cashResults = await Promise.all(step.map(table => supabase.from(table).delete().neq('id', sentinel)));
        const cashFailure = cashResults.find(r => r.error);
        if (cashFailure) {
          showToast(`Factory Reset failed: ${cashFailure.error?.message || 'Database error'}`, "error");
          await fetchData();
          return;
        }
      }

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
      // Masters are referenced by these rows (sales/khata -> customers, attendance -> employees):
      // stop here rather than delete some masters while their history is still in place.
      const txFailure = txResults.find(r => r.error);
      if (txFailure) {
        console.error("System reset partial failures:", txResults.filter(r => r.error).map(f => f.error));
        showToast(`Factory Reset failed: ${txFailure.error?.message || 'Database error'}`, "error");
        await fetchData();
        return;
      }

      // Delete master records; locked system items and standard COA accounts stay, reset to zero.
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

      const failures = masterResults.filter(r => r.error);
      if (failures.length > 0) {
        console.error("System reset partial failures:", failures.map(f => f.error));
        showToast(`Factory Reset failed: ${failures[0].error?.message || 'Database error'}`, "error");
        await fetchData();
        return;
      }

      try {
        // The outbox too: queued milk purchases / expenses / payments would re-post into the wiped tables.
        await db.transaction('rw', [db.orders, db.order_items, db.customers, db.catalog_cache, db.outbox], async () => {
          await Promise.all([
            db.orders.clear(),
            db.order_items.clear(),
            db.customers.clear(),
            db.catalog_cache.clear(),
            db.outbox.clear()
          ]);
        });
      } catch (dexieErr) {
        console.error("Failed to clear offline store during reset:", dexieErr);
      }

      if (typeof window !== 'undefined') {
        localStorage.removeItem('mooco_shift_sessions');
        localStorage.removeItem('mooco_day_closings');
        localStorage.removeItem('mooco_active_shift_session');
        localStorage.removeItem('mooco_active_business_day');
        localStorage.removeItem('mooco_cashier_shift_state');
      }

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
    if (currentUser?.role_id !== 'role_super_admin') {
      showToast('Sirf Owner / Super Admin data delete kar sakta hai.', 'error');
      return;
    }

    const ALL = '00000000-0000-0000-0000-000000000000';
    // supabase-js resolves with { error } instead of throwing: every call is checked, or a failed
    // delete/update was reported as "reset successfully".
    const check = async (query: PromiseLike<{ error: any }>) => {
      const { error } = await query;
      if (error) throw error;
    };
    const checkAll = async (queries: PromiseLike<{ error: any }>[]) => {
      const results = await Promise.all(queries);
      const failed = results.find(r => r.error);
      if (failed) throw failed.error;
    };
    const wipe = (table: string) => supabase.from(table).delete().neq('id', ALL);
    // expense_vendors keeps its totals in details (there are no balance / total_paid columns).
    const zeroVendorStats = async () => {
      const { data, error } = await supabase.from('expense_vendors').select('id, details');
      if (error) throw error;
      await checkAll((data || []).map((v: any) => supabase.from('expense_vendors').update({
        details: { ...(v.details || {}), pending_balance: 0, total_paid: 0, total_billed: 0, opening_balance: 0 }
      }).eq('id', v.id)));
    };
    // Queued offline vouchers would re-post into the wiped tables on the next sync.
    const clearOutbox = async (types?: string[]) => {
      try {
        if (!types) await db.outbox.clear();
        else await db.outbox.where('action_type').anyOf(types).delete();
      } catch (e) {
        console.warn('[Dexie outbox cleanup]', e);
      }
    };

    try {
      showToast(`Clearing ${modules.length > 1 ? `${modules.length} selected modules` : modules[0]}...`, "info");

      // Bookings that point at sales / customers about to be wiped (no ON DELETE). Done once, before
      // any module runs, so a blocked booking stops the reset before anything is deleted.
      if (modules.includes('customers')) await clearCustomerOrderLinks(true);
      else if (modules.some(m => m === 'transactions' || m === 'sales' || m === 'customer_ledger')) await clearCustomerOrderLinks(false);

      for (const module of modules) {
        if (module === 'transactions') {
          // Clear all transaction tables but keep master records.
          // Cash records reference each other: children before parents, one level at a time
          // (in parallel they raced the foreign keys and stopped the reset halfway).
          await check(wipe('cash_variances'));
          await check(wipe('shift_cash_events'));
          await checkAll([
            wipe('cash_remittances'),
            wipe('drawer_handovers'),
            wipe('day_closings'),
          ]);
          await check(wipe('cash_shifts'));
          await check(wipe('business_days'));
          await checkAll([
            wipe('allocations'),
            wipe('inventory_logs'),
            wipe('journal_entries'),
            wipe('bank_transactions'),
            wipe('employee_transactions'),
            wipe('attendance'),
            wipe('retail_closings'),
            wipe('daily_supply'),
            wipe('customer_transactions'),
            wipe('supplier_transactions'),
            wipe('purchases'),
            wipe('material_purchases'),
            wipe('sales'),
            wipe('production_batches'),
            wipe('expenses'),
            wipe('recurring_expenses'),
            wipe('expense_vendor_transactions'),
          ]);
          // Reset balances and stock to 0 (suppliers has no pending_balance column; there is no inventory table).
          await checkAll([
            supabase.from('suppliers').update({ balance: 0 }).neq('id', ALL),
            supabase.from('customers').update({ balance: 0 }).neq('id', ALL),
            supabase.from('items').update({ stock: 0, variant_stocks: {} }).neq('id', ALL),
            supabase.from('employees').update({ balance: 0 }).neq('id', ALL),
            supabase.from('financial_accounts').update({ balance: 0 }).neq('id', ALL),
            supabase.from('manual_accounts').update({ balance: 0 }).neq('id', ALL),
          ]);
          await zeroVendorStats();
          try {
            await db.orders.clear();
            await db.order_items.clear();
            await db.customers.clear();
          } catch (e) {
            console.warn('[Dexie cleanup]', e);
          }
          await clearOutbox();
        } else if (module === 'stock' || module === 'inventory') {
          // Reset all physical stock & counter inventory to 0
          await check(supabase.from('items').update({ stock: 0, variant_stocks: {} }).neq('id', ALL));
          await check(wipe('inventory_logs'));
          await check(wipe('allocations'));
          await check(wipe('retail_closings'));
        } else if (module === 'purchases') {
          await check(wipe('allocations'));
          await check(wipe('purchases'));
          await check(wipe('material_purchases'));
          await clearOutbox(['milk_purchase']);
        } else if (module === 'sales') {
          await check(wipe('sales'));
          await check(wipe('daily_supply'));
          try {
            await db.orders.clear();
            await db.order_items.clear();
          } catch (e) {
            console.warn('[Dexie sales cleanup]', e);
          }
        } else if (module === 'production') {
          await check(wipe('production_batches'));
        } else if (module === 'supplier_ledger') {
          // Reset only supplier financial balances and ledger history, keep profiles
          await check(wipe('supplier_transactions'));
          await check(wipe('purchases'));
          await check(wipe('material_purchases'));
          await check(wipe('allocations'));
          await check(supabase.from('suppliers').update({ balance: 0 }).neq('id', ALL));
          await clearOutbox(['milk_purchase', 'supplier_payment']);
        } else if (module === 'customer_ledger') {
          // Reset only customer credit balances and ledger history, keep profiles
          await check(wipe('customer_transactions'));
          // Zeroed straight after the khata is gone: a later failure must not leave balances with no ledger behind them.
          await check(supabase.from('customers').update({ balance: 0 }).neq('id', ALL));
          await check(wipe('sales'));
          await check(wipe('daily_supply'));
          try {
            await db.orders.clear();
            await db.order_items.clear();
          } catch (e) {
            console.warn('[Dexie sales cleanup]', e);
          }
          await clearOutbox(['customer_payment']);
        } else if (module === 'suppliers') {
          await check(wipe('supplier_transactions'));
          await check(wipe('allocations'));
          await check(wipe('purchases'));
          await check(wipe('material_purchases'));
          await check(wipe('suppliers'));
          await clearOutbox(['milk_purchase', 'supplier_payment']);
        } else if (module === 'customers') {
          await check(wipe('customer_transactions'));
          await check(wipe('sales'));
          await check(wipe('daily_supply'));
          await check(wipe('customers'));
          try {
            await db.customers.clear();
          } catch (e) {
            console.warn('[Dexie customers cleanup]', e);
          }
          await clearOutbox(['customer_payment']);
        } else if (module === 'items') {
          await check(wipe('inventory_logs'));
          await check(supabase.from('items').delete().neq('is_system', true));
        } else if (module === 'expenses') {
          await check(wipe('expenses'));
          await check(wipe('recurring_expenses'));
          await check(wipe('expense_vendor_transactions'));
          await check(wipe('expense_vendors'));
          await clearOutbox(['expense']);
        } else if (module === 'bank_cash') {
          await check(wipe('bank_transactions'));
          await check(supabase.from('financial_accounts').update({ balance: 0 }).neq('id', ALL));
        } else if (module === 'accounts_journal') {
          // Journal vouchers only: the chart of accounts (Owner Capital etc.) stays, at zero.
          await check(wipe('journal_entries'));
          await check(supabase.from('manual_accounts').update({ balance: 0 }).neq('id', ALL));
        } else if (module === 'retail_closings') {
          await check(wipe('retail_closings'));
        } else {
          await check(wipe(module));
        }
      }

      showToast(`Selected data reset successfully!`, "success");
      await fetchData();
    } catch (err) {
      console.error(`Failed to clear data:`, err);
      showToast(`Failed to clear data: ${(err as any)?.message || 'Unknown error'}`, "error");
      await fetchData();
    }
  };

  const currentRole = useMemo(() => {
    if (!currentUser) return roles.find(r => r.id === 'role_super_admin') || DEFAULT_SYSTEM_ROLES[0];
    return roles.find(r => r.id === currentUser.role_id) || null;
  }, [roles, currentUser]);

  const hasPermission = useCallback((moduleKey: PermissionModule | string): boolean => {
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
  }, [currentUser, currentRole]);

  const canPerform = useCallback((moduleKey: string, action: string = 'view'): boolean => {
    if (!currentUser) return false;
    if (currentUser.role_id === 'role_super_admin') return true;
    // Per-user extra accesses and the role's permissions both count.
    const userPerms = (currentUser.permissions || []) as string[];
    const rolePerms = (currentRole?.permissions || []) as string[];
    const actionKey = `${moduleKey}:${action}`;
    // An exact action grant (e.g. 'cash_control:approve') always counts. It used to be refused for a
    // role that also carried the legacy 'retail_stock' (checked first), which took rights away.
    if (userPerms.includes(actionKey) || rolePerms.includes(actionKey)) return true;
    // A module granted to the user personally grants all its actions (as before).
    if (userPerms.includes(moduleKey)) return true;
    // View is permitted with any action in the module.
    const anyAction = (list: string[]) => list.some(p => typeof p === 'string' && p.startsWith(`${moduleKey}:`));
    if (action === 'view' && (anyAction(userPerms) || anyAction(rolePerms))) return true;
    // The counter (cashier) profile: 'retail_stock' with Cash Control runs shifts and sees Cash Control,
    // but approving, reopening and drawer setup need an explicit grant above. Production cashier roles
    // carry both 'cash_control' and 'retail_stock', so the role's full module must not hand them those.
    if (moduleKey === 'cash_control' && (userPerms.includes('retail_stock') || rolePerms.includes('retail_stock'))) return action === 'view';
    // A full module permission on the role grants all actions.
    return rolePerms.includes(moduleKey);
  }, [currentUser, currentRole]);

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
    setTerminalLocked(false);
    setUsers(prev => prev.some(u => u.id === matchedUser.id)
      ? prev.map(u => (u.id === matchedUser.id ? matchedUser : u))
      : [...prev, matchedUser]);
    setCurrentUser(matchedUser);
    if (typeof window !== 'undefined') {
      localStorage.setItem('mooco_active_user_id', matchedUser.id);
      localStorage.setItem('mooco_active_user_data', JSON.stringify(matchedUser));
    }
    // The first sign-in on this device unlocks the database: load the workspace and push any
    // work that was queued while nobody was signed in.
    if (awaitingLogin.current) {
      awaitingLogin.current = false;
      void fetchData();
    }
    syncService.syncPending().catch(err => console.warn('[Login] Background sync notice:', err));
  };

  // The PIN is checked by the operator-login Edge Function (hashed, salted, rate-limited RPCs),
  // which also returns the Supabase session every later request needs.
  const signInOperator = async (request: OperatorLoginRequest, fallback: string): Promise<{ success: boolean; message?: string; user?: AppUser }> => {
    const { user, message } = await operatorSignIn(request);
    if (!user) return { success: false, message: message || fallback };
    const matchedUser = mapRpcUser(user);
    applyLogin(matchedUser);
    return { success: true, user: matchedUser };
  };

  const loginWithCredentials = async (username: string, pin: string): Promise<{ success: boolean; message?: string; user?: AppUser }> => {
    const cleanUser = username.trim().toLowerCase();
    const cleanPin = pin.trim();
    if (!cleanUser) {
      return { success: false, message: 'Enter the username' };
    }
    if (!cleanPin) {
      return { success: false, message: 'Enter the password / PIN code' };
    }
    return signInOperator({ mode: 'username', username: cleanUser, pin: cleanPin }, 'Ghalat Username ya PIN code!');
  };

  const switchUserWithPin = async (pin: string): Promise<{ success: boolean; message?: string; user?: AppUser }> => {
    const cleanPin = pin.trim();
    if (!cleanPin) {
      return { success: false, message: 'Invalid 4-Digit PIN Code!' };
    }
    return signInOperator({ mode: 'pin', pin: cleanPin }, 'Invalid 4-Digit PIN Code!');
  };

  const switchUserByIdAndPin = async (userId: string, pin: string): Promise<{ success: boolean; message?: string; user?: AppUser }> => {
    if (!pin.trim()) {
      return { success: false, message: 'Incorrect PIN Code' };
    }
    return signInOperator({ mode: 'user', user_id: userId, pin: pin.trim() }, 'Incorrect PIN Code');
  };

  const setCurrentUserDirectly = (user: AppUser) => {
    setCurrentUser(user);
    if (typeof window !== 'undefined') {
      localStorage.setItem('mooco_active_user_id', user.id);
      localStorage.setItem('mooco_active_user_data', JSON.stringify(user));
    }
  };

  const logoutUser = () => {
    setTerminalLocked(false);
    setCurrentUser(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('mooco_active_user_id');
      localStorage.removeItem('mooco_active_user_data');
    }
    void operatorSignOut();
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

  // Roles are the business's access policy: the database lets only the Owner (Super Admin) write
  // them (20261023119000). RLS skips a refused UPDATE / DELETE silently, so the rows are checked.
  const ROLE_OWNER_ONLY = 'Roles sirf Owner (Super Admin) bana, badal ya delete kar sakta hai.';
  const createRole = async (roleData: Omit<AppRole, 'id'>): Promise<boolean> => {
    if (currentUser?.role_id !== 'role_super_admin') {
      showToast(ROLE_OWNER_ONLY, 'error');
      return false;
    }
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
      showToast(`Role nahi bana: ${moneyRpcMessage(e)}`, "error");
      return false;
    }
  };

  const updateRole = async (id: string, updates: Partial<AppRole>): Promise<boolean> => {
    if (id === 'role_super_admin') {
      showToast('Owner role hamesha full access rakhta hai.', 'warning');
      return false;
    }
    if (currentUser?.role_id !== 'role_super_admin') {
      showToast(ROLE_OWNER_ONLY, 'error');
      return false;
    }
    try {
      const { data, error } = await supabase.from('app_roles').update(updates).eq('id', id).select('id');
      if (error) throw error;
      if (!data?.length) {
        showToast(ROLE_OWNER_ONLY, 'error');
        return false;
      }

      setRoles(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
      showToast("Role updated successfully", "success");
      return true;
    } catch (e: any) {
      console.error('Error updating role:', e);
      showToast(`Role update nahi hua: ${moneyRpcMessage(e)}`, "error");
      return false;
    }
  };

  const deleteRole = async (id: string): Promise<boolean> => {
    if (currentUser?.role_id !== 'role_super_admin') {
      showToast(ROLE_OWNER_ONLY, 'error');
      return false;
    }
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

      const { data, error } = await supabase.from('app_roles').delete().eq('id', id).select('id');
      if (error) throw error;
      if (!data?.length) {
        showToast(ROLE_OWNER_ONLY, 'error');
        return false;
      }

      setRoles(prev => prev.filter(r => r.id !== id));
      showToast("Role deleted successfully", "info");
      return true;
    } catch (e: any) {
      console.error('Error deleting role:', e);
      showToast(`Role delete nahi hua: ${moneyRpcMessage(e)}`, "error");
      return false;
    }
  };

  // Product categories are saved with the inventory settings, so every device keeps them; they used
  // to live only in this tab's memory and were gone after a reload.
  const saveCategories = async (next: string[], previous: string[]) => {
    setCategories(next);
    const saved = await updateSettings({ inventory: { ...settings.inventory, categories: next } as any });
    if (!saved) setCategories(previous);
    return saved;
  };

  const addCategory = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (categories.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
      showToast(`Category "${trimmed}" already exists`, "warning");
      return;
    }
    void saveCategories([...categories, trimmed], categories).then(saved => {
      if (saved) showToast(`Category "${trimmed}" added`, "success");
    });
  };

  const removeCategory = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    void saveCategories(categories.filter(c => c.toLowerCase() !== trimmed.toLowerCase()), categories).then(saved => {
      if (saved) showToast(`Category "${trimmed}" removed`, "info");
    });
  };

  latest.current = { loadData, rolloverStaleShift, accounts, cashDrawers, inventoryLogs, shiftSessions, activeShiftSession };

  // Every action runs the newest render's implementation through a wrapper created once: a screen
  // that only uses actions never re-renders for data, a handler kept from an older render still
  // sees current state, and effects that list an action as a dependency no longer re-run on every
  // change (refreshCashControl as a dependency re-downloaded the cash tables after each sale).
  const actionImpls = {
    retryLoading, lockTerminalNow, loginWithCredentials, switchUserWithPin, switchUserByIdAndPin, setCurrentUserDirectly, logoutUser,
    addUser, updateUser, deleteUser, createRole, updateRole, deleteRole,
    refreshCashControl, startCashierShift, closeCashierShift, acceptHeadRemittance, resolveCashVariance,
    resolveCashHandover, closeBusinessDay, reopenBusinessDay, upsertCashDrawer, submitDayCloseStockCount, addDrawerOpeningCash, closeDayCash, closeDayStock,
    openShiftSession, closeShiftSession, performDayClosing, reopenDayClosing, requestManagerApproval,
    addPurchase, returnPurchase, deletePurchase, returnMaterialPurchase, deleteMaterialPurchase, addBulkMaterialPurchase, recordSupplierPayment,
    addSupplier, updateSupplier, deleteSupplier, deleteSupplierTransaction,
    allocateBulkMilk, allocateFromRetailStock,
    addItem, updateItem, deleteItem, reorderItems, adjustStock, setOpeningStock, syncItemAndInventoryStock,
    createBatch, discardBatch, trimBatchToSource, updateBatchStage, cancelBatch,
    addSale, processSalesReturn, updateSalePaymentMode, recordDailySupply, performRetailClosing, postClosingStockSale,
    addCustomer, updateCustomer, deleteCustomer, recordCustomerPayment, deleteCustomerTransaction,
    addExpense, updateExpense, deleteExpense, addRecurringExpense, deleteRecurringExpense,
    addExpenseVendor, updateExpenseVendor, deleteExpenseVendor, recordExpenseVendorPayment, deleteExpenseVendorTransaction,
    addAccount, updateAccount, deleteAccount, recordBankTransaction, transferFunds, addManualAccount, deleteManualAccount, updateManualAccount, addJournalEntry,
    updateSettings, resetSystem, clearData, addCategory, removeCategory,
    addUnit, updateUnit, deleteUnit,
    safeDeleteCustomer, safeDeleteSupplier, safeDeleteItem, safeDeleteExpense, safeDeleteAccount, reactivateEntity
  };
  const actionsRef = useRef(actionImpls);
  actionsRef.current = actionImpls;
  const [actions] = useState(() => bindLatest(actionsRef));

  // getShiftTotals, getDeleteAssessment and buildBackup read many records; they are taken from the
  // render that rebuilt the value, i.e. whenever any record below changed (as before).
  const contextValue = useMemo(() => {
    const value: DairyContextType = {
      ...actions,
      setIsUserSwitcherOpen, setAllocations, setInventory, setProductionBatches,
      hasPermission, canPerform, getBusinessDate, isDayLocked, isPeriodLocked,
      getShiftTotals, getDeleteAssessment, buildBackup,
      users, roles, currentUser, currentRole, isUserSwitcherOpen, isTerminalLocked, isBooting, sessionError, isDataLoading, hasLoadedData, dataLoadError,
      purchases, materialPurchases, suppliers, allocations, inventory, items, sales, customers,
      productionBatches, expenses, recurringExpenses, expenseVendors, expenseVendorTransactions,
      accounts, bankTransactions, manualAccounts, journalEntries, settings,
      categories, unitGroups, retailClosings, shiftSessions, dayClosings, activeShiftSession,
      businessDays, cashDrawers, cashHandovers, cashRemittances, cashVariances, shiftCashEvents, cashInTransit,
      inventoryLogs, customerTransactions, supplierTransactions, dailySupplyEntries
    };
    return value;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the three record-wide getters follow the records listed here
  }, [
    actions, hasPermission, canPerform, isDayLocked, isPeriodLocked,
    users, roles, currentUser, currentRole, isUserSwitcherOpen, isTerminalLocked, isBooting, sessionError, isDataLoading, hasLoadedData, dataLoadError,
    purchases, materialPurchases, suppliers, allocations, inventory, items, sales, customers,
    productionBatches, expenses, recurringExpenses, expenseVendors, expenseVendorTransactions,
    accounts, bankTransactions, manualAccounts, journalEntries, settings,
    categories, unitGroups, retailClosings, shiftSessions, dayClosings, activeShiftSession,
    businessDays, cashDrawers, cashHandovers, cashRemittances, cashVariances, shiftCashEvents, cashInTransit,
    inventoryLogs, customerTransactions, supplierTransactions, dailySupplyEntries
  ]);

  const [store] = useState(() => createDairyStore(contextValue));
  // Published after commit; each subscribed component re-renders (before paint) only if a field it
  // reads changed.
  useLayoutEffect(() => {
    store.set(contextValue);
  }, [store, contextValue]);

  return (
    <DairyStoreContext.Provider value={store}>
      {children}
    </DairyStoreContext.Provider>
  );
};

/**
 * Keeps a hidden (kept-alive) page on the records it last showed, so sales and syncs do not
 * re-render screens nobody is looking at. When `frozen` turns false the page catches up at once.
 */
export const DairyFreeze: React.FC<{ frozen: boolean; children: ReactNode }> = ({ frozen, children }) => {
  const parent = useDairyStore();
  const [view] = useState(() => createFrozenView(parent));
  // Set while rendering, so hiding a page re-renders nothing below it; thawing tells its readers to
  // check for what they missed.
  view.setFrozen(frozen);
  useLayoutEffect(() => {
    if (!frozen) view.notify();
  }, [frozen, view]);
  return (
    <DairyStoreContext.Provider value={view}>
      {children}
    </DairyStoreContext.Provider>
  );
};

const useDairyStore = (): DairySource => {
  const store = useContext(DairyStoreContext);
  if (!store) {
    throw new Error('useDairy must be used within a DairyProvider');
  }
  return store;
};

/** The workspace records and actions. Re-renders only when a field this component read changes. */
export const useDairy = (): DairyContextType => {
  const store = useDairyStore();
  // Every field this component has read, kept for its lifetime: a field read only on some renders
  // (or only in an effect) still re-renders it when it changes.
  const trackedRef = useRef<Set<PropertyKey> | null>(null);
  if (!trackedRef.current) trackedRef.current = new Set();
  const renderedRef = useRef<DairyContextType | null>(null);

  const getSnapshot = useCallback(() => {
    const next = store.get();
    const rendered = renderedRef.current;
    if (!rendered || rendered === next) return next;
    for (const key of trackedRef.current!) {
      if (!Object.is((rendered as any)[key], (next as any)[key])) return next;
    }
    return rendered;
  }, [store]);

  const snapshot = useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
  renderedRef.current = snapshot;
  return useMemo(() => trackReads(snapshot, trackedRef.current!, store.get), [snapshot, store]);
};

/**
 * Subscribes to one derived value: the component re-renders only when the selected value changes
 * (by `isEqual`, default Object.is). Return primitives or existing records; for a new object or
 * array per call pass a shallow `isEqual`, or the component re-renders on every change.
 *
 *   const billCount = useDairySelector(d => d.sales.length);
 */
export const useDairySelector = <T,>(selector: (dairy: DairyContextType) => T, isEqual: (a: T, b: T) => boolean = Object.is): T => {
  const store = useDairyStore();
  const lastRef = useRef<{ source: DairyContextType; selector: (dairy: DairyContextType) => T; selected: T } | null>(null);

  const getSnapshot = () => {
    const source = store.get();
    const last = lastRef.current;
    if (last && last.source === source && last.selector === selector) return last.selected;
    const selected = selector(source);
    if (last && isEqual(last.selected, selected)) {
      lastRef.current = { source, selector, selected: last.selected };
      return last.selected;
    }
    lastRef.current = { source, selector, selected };
    return selected;
  };

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
};
