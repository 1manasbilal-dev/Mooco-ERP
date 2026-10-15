import Dexie, { Table } from 'dexie';

// --- Type Definitions for Offline Store ---

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

// --- UUID Generator Helper ---
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

// --- Collision-Resistant Invoice / Bill Number Generator ---
// Old scheme was a random 4-digit suffix (~9k possibilities EVER), which
// duplicates within tens of bills. New scheme embeds the local date plus 6
// crypto-random hex chars (~16.7M possibilities per day, per prefix), so
// offline-generated bills stay unique when they sync.
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

// --- Precision Calculation Helpers (Dairy & Financial) ---

/**
 * Rounds monetary amounts to 2 decimal places with zero IEEE floating point drift.
 */
export const roundCurrency = (num: number): number => {
  if (isNaN(num) || !isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

/**
 * Rounds weights and volume quantities (liters, kilograms) to 3 decimal places.
 */
export const roundQuantity = (qty: number): number => {
  if (isNaN(qty) || !isFinite(qty)) return 0;
  return Math.round((qty + Number.EPSILON) * 1000) / 1000;
};

// --- Persistent Storage Eviction Protection ---

/**
 * Requests persistent storage from the browser to prevent IndexedDB eviction under disk pressure.
 */
export const requestPersistentStorage = async (): Promise<boolean> => {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      const isPersisted = await navigator.storage.persisted();
      if (!isPersisted) {
        const granted = await navigator.storage.persist();
        console.log(`[Storage] Persistent IndexedDB Storage requested: ${granted ? 'GRANTED' : 'DENIED'}`);
        return granted;
      }
      return true;
    }
  } catch (err) {
    console.warn('[Storage] Could not request persistent storage:', err);
  }
  return false;
};

// Auto-request persistence in browser environment
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

// --- Dexie Database Class ---
export class MoocoOfflineDB extends Dexie {
  orders!: Table<LocalOrder, string>;
  order_items!: Table<LocalOrderItem, string>;
  customers!: Table<LocalCustomer, string>;
  catalog_cache!: Table<LocalCatalogItem, string>;
  outbox!: Table<LocalOutboxItem, string>;

  constructor() {
    super('MoocoPOSOfflineDB');

    // Schema Version 1 (Baseline)
    this.version(1).stores({
      orders: 'id, bill_number, customer_id, date, sync_status, retry_count, created_at',
      order_items: 'id, order_id, item_id, sync_status, created_at',
      customers: 'id, name, phone, sync_status, retry_count, created_at',
      catalog_cache: 'id, name, unit, is_active, updated_at'
    });

    // Schema Version 2: Universal Accounting Outbox for Offline-First Data Entry
    this.version(2).stores({
      outbox: 'id, action_type, idempotency_key, sync_status, retry_count, created_at'
    });
  }
}

// Singleton Dexie Instance
export const db = new MoocoOfflineDB();
