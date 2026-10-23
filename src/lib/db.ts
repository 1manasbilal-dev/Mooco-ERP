import Dexie, { Table } from 'dexie';

export type SyncStatus = 'pending' | 'synced' | 'failed';

export interface LocalOrderItem {
  id: string; // crypto.randomUUID()
  order_id: string; // references LocalOrder.id
  item_id?: string;
  name: string;
  qty: number;
  price: number;
  total: number;
  unit?: string;
  variant_id?: string;
  sync_status: SyncStatus;
  created_at: string;
}

export interface LocalOrder {
  id: string; // crypto.randomUUID()
  bill_number: string;
  date: string;
  customer_id?: string | null;
  customer_name: string;
  subtotal: number;
  discount: number;
  total: number;
  payment_mode: 'Cash' | 'Online' | 'Credit';
  status: 'Completed' | 'Returned';
  business_day_id?: string;
  shift_session_id?: string;
  shift_name?: string;
  drawer_id?: string;
  cashier_id?: string;
  cashier_name?: string;
  // Financial account chosen at sale time (settings-matched) so the offline
  // sync deposits the receipt into the same account the online path would.
  receipt_account_id?: string | null;
  items: any[];
  details?: {
    paid_amount: number;
    due_amount: number;
    cash_given?: number;
    change_return?: number;
    customer_phone?: string;
    notes?: string;
  };
  sync_status: SyncStatus;
  sync_error?: string;
  retry_count?: number;
  last_retry_at?: string;
  created_at: string;
  synced_at?: string;
}

export interface LocalCustomer {
  id: string; // crypto.randomUUID()
  name: string;
  phone?: string;
  address?: string;
  route?: string;
  type?: string;
  balance: number;
  is_active: boolean;
  data?: Record<string, any>;
  sync_status: SyncStatus;
  sync_error?: string;
  retry_count?: number;
  last_retry_at?: string;
  created_at: string;
  synced_at?: string;
}

export interface LocalCatalogItem {
  id: string;
  name: string;
  category: string[];
  item_type: string[];
  unit: string;
  cost_price: number;
  selling_price: number;
  stock: number;
  variant_stocks?: Record<string, number>;
  variants?: any[];
  is_active: boolean;
  quick_amounts?: number[];
  pos_primary_mode?: 'amount' | 'qty';
  allow_loose_sale?: boolean;
  updated_at: string;
}

export const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = (c === 'x') ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// Bill numbers embed the local date plus 6 crypto-random hex chars (~16.7M
// possibilities per day, per prefix), so offline-generated bills stay unique
// when they sync. A random 4-digit suffix collided within tens of bills.
export const generateInvoiceNumber = (prefix: string): string => {
  const now = new Date();
  const ymd = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  let rand = '';
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint8Array(3);
    crypto.getRandomValues(buf);
    rand = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  } else {
    rand = Math.random().toString(16).slice(2, 8).toUpperCase().padEnd(6, '0');
  }
  return `${prefix}${ymd}-${rand}`;
};

/**
 * Halves round away from zero on the decimal value people see (10.075 -> 10.08, -10.075 -> -10.08),
 * the same rule as cleanNumber in formatters.ts. Binary floats store 10.075 as 10.07499..., and
 * adding Number.EPSILON only helps below 2, so the old rounding stored Rs 10.07 for a bill the
 * screen showed as Rs 10.08. Never returns -0.
 */
const roundHalfAway = (value: number, decimals: number): number => {
  if (isNaN(value) || !isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  // 15 significant digits drop the binary noise (1007.4999999999999 -> 1007.5) before rounding.
  const scaled = Number((Math.abs(value) * factor).toPrecision(15));
  const rounded = (Math.sign(value) * Math.round(scaled)) / factor;
  return rounded === 0 ? 0 : rounded;
};

/**
 * Rounds money to 2 decimal places without floating-point drift.
 */
export const roundCurrency = (num: number): number => roundHalfAway(num, 2);

/**
 * Rounds weights and volume quantities (liters, kilograms) to 3 decimal places.
 */
export const roundQuantity = (qty: number): number => roundHalfAway(qty, 3);

/**
 * Requests persistent storage from the browser to prevent IndexedDB eviction under disk pressure.
 */
const requestPersistentStorage = async (): Promise<boolean> => {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      const isPersisted = await navigator.storage.persisted();
      if (!isPersisted) {
        const granted = await navigator.storage.persist();
        return granted;
      }
      return true;
    }
  } catch (err) {
    console.warn('[Storage] Could not request persistent storage:', err);
  }
  return false;
};

if (typeof window !== 'undefined') {
  requestPersistentStorage().catch(() => {});
}

export type OutboxActionType = 'order' | 'milk_purchase' | 'supplier_payment' | 'expense' | 'customer_payment' | 'retail_closing';

export interface LocalOutboxItem {
  id: string; // crypto.randomUUID()
  action_type: OutboxActionType;
  idempotency_key: string;
  payload: any;
  sync_status: SyncStatus;
  sync_error?: string;
  retry_count?: number;
  last_retry_at?: string;
  created_at: string;
  synced_at?: string;
}

class MoocoOfflineDB extends Dexie {
  orders!: Table<LocalOrder, string>;
  order_items!: Table<LocalOrderItem, string>;
  customers!: Table<LocalCustomer, string>;
  catalog_cache!: Table<LocalCatalogItem, string>;
  outbox!: Table<LocalOutboxItem, string>;

  constructor() {
    super('MoocoPOSOfflineDB');

    this.version(1).stores({
      orders: 'id, bill_number, customer_id, date, sync_status, retry_count, created_at',
      order_items: 'id, order_id, item_id, sync_status, created_at',
      customers: 'id, name, phone, sync_status, retry_count, created_at',
      catalog_cache: 'id, name, unit, is_active, updated_at'
    });

    // Version 2 adds the outbox for offline data entry.
    this.version(2).stores({
      outbox: 'id, action_type, idempotency_key, sync_status, retry_count, created_at'
    });
  }
}

export const db = new MoocoOfflineDB();
