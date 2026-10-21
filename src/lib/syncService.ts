import { supabase } from './supabase';
import { getOperatorSession } from './operatorAuth';
import { saleItemSnapshot } from './saleSnapshot';
import { db, OutboxActionType, generateUUID, roundCurrency, roundQuantity } from './db';
import { loadRead, withDeadline } from './loadRequest';
import { isPermanentSyncError, readyToRetry } from './syncErrors';

export interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  failedCount: number;
  lastSyncTime: Date | null;
  lastError: string | null;
}

type SyncListener = (state: SyncState) => void;

const SYNC_TIMEOUT_MS = 20000;

class SyncService {
  private isOnline: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private isSyncing: boolean = false;
  private pendingCount: number = 0;
  private failedCount: number = 0;
  private lastSyncTime: Date | null = null;
  private lastError: string | null = null;
  private listeners: Set<SyncListener> = new Set();
  private syncTimer: any = null;
  private syncInFlight: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.isOnline = navigator.onLine;

      window.addEventListener('online', () => {
        this.isOnline = true;
        this.notifyListeners();
        this.syncPending();
      });

      window.addEventListener('offline', () => {
        this.isOnline = false;
        this.notifyListeners();
      });

      // Initial pending & failed count, then push anything left from the last session.
      this.updateCounts().then(() => {
        if (this.isOnline) this.syncPending();
      }).catch(() => {});

      this.syncTimer = setInterval(() => {
        if (this.isOnline && !this.isSyncing) {
          this.syncPending();
        }
      }, 25000);
    }
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  public getState(): SyncState {
    return {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      pendingCount: this.pendingCount,
      failedCount: this.failedCount,
      lastSyncTime: this.lastSyncTime,
      lastError: this.lastError
    };
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (err) {
        console.error('[SyncService] Error in sync listener callback:', err);
      }
    });
  }

  public async updateCounts(): Promise<{ pending: number; failed: number }> {
    try {
      const pendingOrders = await db.orders.where('sync_status').equals('pending').count();
      const pendingCustomers = await db.customers.where('sync_status').equals('pending').count();
      const pendingOutbox = await db.outbox.where('sync_status').equals('pending').count();

      const failedOrders = await db.orders.where('sync_status').equals('failed').count();
      const failedCustomers = await db.customers.where('sync_status').equals('failed').count();
      const failedOutbox = await db.outbox.where('sync_status').equals('failed').count();

      this.pendingCount = pendingOrders + pendingCustomers + pendingOutbox;
      this.failedCount = failedOrders + failedCustomers + failedOutbox;
      this.notifyListeners();
      return { pending: this.pendingCount, failed: this.failedCount };
    } catch (e) {
      console.warn('[SyncService] Could not count pending/failed records:', e);
      return { pending: 0, failed: 0 };
    }
  }

  public async updatePendingCount(): Promise<number> {
    const { pending } = await this.updateCounts();
    return pending;
  }

  public async notifyPendingChange(): Promise<void> {
    await this.updateCounts();
    if (this.isOnline) {
      this.syncPending();
    }
  }

  // Manual release of the dead-letter queue.
  public async retryFailedRecords(): Promise<void> {
    try {
      await db.orders.where('sync_status').equals('failed').modify({
        sync_status: 'pending',
        retry_count: 0,
        sync_error: undefined
      });
      await db.customers.where('sync_status').equals('failed').modify({
        sync_status: 'pending',
        retry_count: 0,
        sync_error: undefined
      });
      await db.outbox.where('sync_status').equals('failed').modify({
        sync_status: 'pending',
        retry_count: 0,
        sync_error: undefined
      });
      await this.updateCounts();
      if (this.isOnline) {
        await this.syncPending();
      }
    } catch (err) {
      console.error('[SyncService] Failed to reset failed records:', err);
    }
  }

  public async queueAction(
    actionType: OutboxActionType,
    payload: any,
    idempotencyKey?: string
  ): Promise<string> {
    const key = idempotencyKey || generateUUID();
    const existing = await db.outbox.where('idempotency_key').equals(key).first();
    if (existing) {
      if (existing.sync_status !== 'synced') {
        await db.outbox.update(existing.id, {
          payload,
          sync_status: 'pending',
          retry_count: 0,
          sync_error: undefined
        });
        this.notifyPendingChange().catch(err => console.warn('[SyncService] queueAction background sync:', err));
      }
      return existing.id;
    }
    const id = generateUUID();
    await db.outbox.put({
      id,
      action_type: actionType,
      idempotency_key: key,
      payload,
      sync_status: 'pending',
      retry_count: 0,
      created_at: new Date().toISOString()
    });
    this.notifyPendingChange().catch(err => console.warn('[SyncService] queueAction background sync:', err));
    return id;
  }

  private async markFailure(table: 'orders' | 'customers' | 'outbox', id: string, err: any, retryCount = 0): Promise<void> {
    const permanent = isPermanentSyncError(err);
    await db[table].update(id, {
      sync_status: permanent ? 'failed' : 'pending',
      sync_error: err?.message || 'Sync failed',
      retry_count: (retryCount || 0) + 1,
      last_retry_at: new Date().toISOString()
    });
  }

  public async syncPending(): Promise<{ success: boolean; syncedOrders: number; syncedCustomers: number; syncedOutbox: number }> {
    // syncInFlight is set before the first await, so two calls in the same tab (online event,
    // timer, a new sale) can never both reach executeSyncRoutine — Web Locks is not there to
    // stop them on plain-http LAN addresses or older browsers.
    if (this.isSyncing || this.syncInFlight || !this.isOnline) {
      await this.updateCounts();
      return { success: false, syncedOrders: 0, syncedCustomers: 0, syncedOutbox: 0 };
    }
    this.syncInFlight = true;

    try {
      // Without an operator session the database refuses every write; leave the queue untouched
      // (no retry counts, no dead-letters) until someone signs in.
      const session = await withDeadline(() => getOperatorSession(), SYNC_TIMEOUT_MS).catch(() => null);
      if (!session) {
        await this.updateCounts();
        return { success: false, syncedOrders: 0, syncedCustomers: 0, syncedOutbox: 0 };
      }

      // Use Web Locks API if supported to prevent multi-tab concurrency
      if (typeof navigator !== 'undefined' && 'locks' in navigator) {
        return await (navigator as any).locks.request('mooco_pos_sync_lock', { ifAvailable: true }, async (lock: any) => {
          if (!lock) {
            return { success: false, syncedOrders: 0, syncedCustomers: 0, syncedOutbox: 0 };
          }
          return await this.executeSyncRoutine();
        });
      }

      // Fallback if Web Locks not supported
      return await this.executeSyncRoutine();
    } finally {
      this.syncInFlight = false;
    }
  }

  private async executeSyncRoutine(): Promise<{ success: boolean; syncedOrders: number; syncedCustomers: number; syncedOutbox: number }> {
    this.isSyncing = true;
    this.lastError = null;
    this.notifyListeners();

    let syncedOrdersCount = 0;
    let syncedCustomersCount = 0;
    let syncedOutboxCount = 0;

    try {
      // Customers first
      const pendingCustomers = await db.customers.where('sync_status').equals('pending').toArray();

      for (const cust of pendingCustomers) {
        if (!readyToRetry(cust)) continue;
        try {
          const custPayload = {
            id: cust.id,
            name: cust.name,
            phone: cust.phone || null,
            address: cust.address || null,
            route: cust.route || null,
            type: cust.type || 'Retail Counter',
            balance: roundCurrency(cust.balance || 0),
            is_active: cust.is_active,
            data: cust.data || {}
          };

          // Idempotent by PK. A customer is only queued when it is created, so a
          // row already on the server came from an earlier attempt of this same sync. It is never
          // overwritten: by now synced bills/receipts may have moved its balance, and re-sending the
          // opening balance would wipe those khata entries out of the balance.
          const { error: custError } = await loadRead(
            supabase.from('customers').upsert([custPayload], { onConflict: 'id', ignoreDuplicates: true }),
            SYNC_TIMEOUT_MS
          );
          if (custError) {
            throw custError;
          }

          // Opening-balance ledger row; its fixed id keeps it idempotent.
          if (cust.balance !== 0) {
            const opTxId = `ctx_op_${cust.id}`;
            const { data: existingOpTx, error: existingOpTxError } = await loadRead(
              supabase.from('customer_transactions').select('id').eq('id', opTxId).maybeSingle(),
              SYNC_TIMEOUT_MS
            );
            if (existingOpTxError) throw existingOpTxError;

            if (!existingOpTx) {
              // The customer row upsert above already carries the opening
              // balance — this is just its ledger row. It must not be skipped
              // silently, so its error is checked.
              const { error: opTxError } = await loadRead(supabase.from('customer_transactions').insert([{
                id: opTxId,
                customer_id: cust.id,
                date: (cust.created_at || new Date().toISOString()).split('T')[0],
                type: cust.balance > 0 ? 'Charge' : 'Payment',
                amount: roundCurrency(Math.abs(cust.balance)),
                details: {
                  mode: 'Opening Balance',
                  note: cust.balance > 0 ? 'Opening Balance (Initial Receivable)' : 'Opening Balance (Initial Advance/Credit)'
                }
              }]), SYNC_TIMEOUT_MS);
              // 23505: the same ctx_op_ row landed in between (addCustomer also inserts it
              // directly), so the ledger row is in place — not a reason to dead-letter the customer.
              if (opTxError && String(opTxError.code) !== '23505') throw opTxError;
            }
          }

          await db.customers.update(cust.id, {
            sync_status: 'synced',
            synced_at: new Date().toISOString(),
            sync_error: undefined,
            retry_count: 0
          });
          syncedCustomersCount++;
        } catch (err: any) {
          console.error('[SyncService] Customer sync item error:', cust.id, err);
          await this.markFailure('customers', cust.id, err, cust.retry_count);
        }
      }

      // Then orders and their items
      const pendingOrders = await db.orders.where('sync_status').equals('pending').toArray();

      for (const order of pendingOrders) {
        if (!readyToRetry(order)) continue;
        try {
          // Attach an offline order to the active shift of its own date when its saved shift is missing or stale.
          let effectiveShiftId = order.shift_session_id || null;
          let effectiveDayId = order.business_day_id || null;
          try {
            if (typeof window !== 'undefined') {
              const activeShiftStr = localStorage.getItem('mooco_active_shift_session');
              if (activeShiftStr) {
                const activeShift = JSON.parse(activeShiftStr);
                const orderDate = order.date ? order.date.split('T')[0] : '';
                const shiftDate = activeShift.business_date || (activeShift.started_at ? activeShift.started_at.split('T')[0] : '');
                if (activeShift.status === 'Active' && orderDate === shiftDate) {
                  if (!effectiveShiftId || (effectiveDayId && effectiveDayId !== activeShift.business_day_id)) {
                    effectiveShiftId = activeShift.id;
                    effectiveDayId = activeShift.business_day_id;
                  }
                }
              }
            }
          } catch (healErr) {
            // Keep the order's own shift if the saved shift cannot be read.
          }

          if (effectiveShiftId !== (order.shift_session_id || null) || effectiveDayId !== (order.business_day_id || null)) {
            order.shift_session_id = effectiveShiftId || undefined;
            order.business_day_id = effectiveDayId || undefined;
            await db.orders.update(order.id, {
              shift_session_id: effectiveShiftId || undefined,
              business_day_id: effectiveDayId || undefined
            });
          }

          const saleData = {
            id: order.id,
            bill_number: order.bill_number,
            date: order.date,
            customer_id: order.customer_id || null,
            customer_name: order.customer_name,
            subtotal: roundCurrency(order.subtotal),
            discount: roundCurrency(order.discount),
            total: roundCurrency(order.total),
            payment_mode: order.payment_mode,
            status: order.status || 'Completed',
            business_day_id: effectiveDayId,
            shift_session_id: effectiveShiftId,
            drawer_id: order.drawer_id || null,
            cashier_id: order.cashier_id || null,
            cashier_name: order.cashier_name || null,
            items: saleItemSnapshot(order.items),
            details: order.details || {}
          };

          // Idempotent by PK.
          const { error: saleError } = await loadRead(supabase.from('sales').upsert([saleData]), SYNC_TIMEOUT_MS);
          if (saleError) {
            throw saleError;
          }

          // One Postgres transaction applies every downstream effect with its
          // idempotency guards inside. If anything fails, the order is NOT
          // marked synced — it retries with a descriptive sync_error instead
          // of silently diverging stock and balances.
          const actualPaid = roundCurrency(order.details?.paid_amount !== undefined ? order.details.paid_amount : (order.payment_mode === 'Credit' ? 0 : order.total));
          const dueAmount = roundCurrency(order.details?.due_amount || (order.customer_id ? Math.max(0, order.total - actualPaid) : 0));

          // Prefer the account chosen at sale time (settings-matched on the
          // POS device). Fall back to a type-based heuristic for orders that
          // were recorded before receipt_account_id existed.
          let receiptAccountId: string | null = order.receipt_account_id || null;
          if (!receiptAccountId && actualPaid > 0) {
            const { data: accounts, error: accountsError } = await loadRead(supabase.from('financial_accounts').select('id, type'), SYNC_TIMEOUT_MS);
            // Without an account the RPC skips the receipt, and the order would still be marked
            // synced — the cash would never reach any account. Retry instead.
            if (accountsError) throw accountsError;
            if (accounts && accounts.length > 0) {
              const targetAcc = order.payment_mode === 'Online'
                ? accounts.find((a: any) => a.type === 'Bank' || a.type === 'Wallet') || accounts[0]
                : accounts.find((a: any) => a.id === order.drawer_id) || accounts.find((a: any) => a.type === 'Cash') || accounts[0];
              receiptAccountId = targetAcc?.id || null;
            }
          }

          const { error: effectsError } = await loadRead(supabase.rpc('pos_sync_order_effects', {
            p_payload: {
              order_id: order.id,
              bill_number: order.bill_number,
              date: order.date,
              payment_mode: order.payment_mode,
              customer_id: order.customer_id || null,
              paid_amount: actualPaid,
              total: roundCurrency(order.total),
              due_amount: dueAmount,
              account_id: receiptAccountId,
              business_day_id: effectiveDayId,
              shift_session_id: effectiveShiftId,
              drawer_id: order.drawer_id || null,
              cashier_id: order.cashier_id || null,
              items: (order.items || []).map((item: any) => {
                const fromBase = item.deductFromBase === true;
                const contains = Number(item.stockDeduction) > 0 ? Number(item.stockDeduction) : 1;
                return {
                  item_id: item.itemId || item.id,
                  name: item.name,
                  qty: roundQuantity(fromBase ? (Number(item.qty) || 0) * contains : (item.qty || 0)),
                  variant_id: fromBase ? null : (item.variantId || null)
                };
              })
            }
          }), SYNC_TIMEOUT_MS);

          if (effectsError) {
            const wrapped = new Error(`Side-effects (stock/khata/cash) pending: ${effectsError.message}`);
            (wrapped as any).code = effectsError.code;
            throw wrapped;
          }

          await db.transaction('rw', [db.orders, db.order_items], async () => {
            await db.orders.update(order.id, {
              sync_status: 'synced',
              synced_at: new Date().toISOString(),
              sync_error: undefined,
              retry_count: 0
            });
            await db.order_items.where('order_id').equals(order.id).modify({
              sync_status: 'synced'
            });
          });

          syncedOrdersCount++;
        } catch (orderErr: any) {
          console.error('[SyncService] Order sync item error:', order.id, orderErr);
          await this.markFailure('orders', order.id, orderErr, order.retry_count);
        }
      }

      // Outbox items: milk purchases, supplier payments, expenses, customer payments
      const pendingOutbox = await db.outbox.where('sync_status').equals('pending').toArray();

      for (const item of pendingOutbox) {
        if (!readyToRetry(item)) continue;
        try {
          let rpcError: any = null;
          if (item.action_type === 'milk_purchase') {
            const { error } = await loadRead(supabase.rpc('procure_milk_intake_effects', { p_payload: item.payload }), SYNC_TIMEOUT_MS);
            rpcError = error;
          } else if (item.action_type === 'supplier_payment') {
            const { error } = await loadRead(supabase.rpc('record_supplier_payment_effects', { p_payload: item.payload }), SYNC_TIMEOUT_MS);
            rpcError = error;
          } else if (item.action_type === 'expense') {
            const { error } = await loadRead(supabase.rpc('record_expense_effects', { p_payload: item.payload }), SYNC_TIMEOUT_MS);
            rpcError = error;
          } else if (item.action_type === 'customer_payment') {
            const { error } = await loadRead(supabase.rpc('record_customer_payment_effects', item.payload), SYNC_TIMEOUT_MS);
            rpcError = error;
          } else if (item.action_type === 'retail_closing') {
            const snap = item.payload || {};
            const { error } = await loadRead(supabase.from('retail_closings').upsert([{
              id: snap.id,
              date: snap.date,
              status: snap.status || 'Closed',
              details: snap
            }]), SYNC_TIMEOUT_MS);
            rpcError = error;
          } else {
            throw new Error(`Unsupported offline action: ${item.action_type}`);
          }

          if (rpcError) throw rpcError;

          await db.outbox.update(item.id, {
            sync_status: 'synced',
            synced_at: new Date().toISOString(),
            sync_error: undefined,
            retry_count: 0
          });
          syncedOutboxCount++;
        } catch (outboxErr: any) {
          console.error('[SyncService] Outbox sync error for item:', item.id, outboxErr);
          await this.markFailure('outbox', item.id, outboxErr, item.retry_count);
        }
      }

      this.lastSyncTime = new Date();
      await this.updateCounts();

      return {
        success: true,
        syncedOrders: syncedOrdersCount,
        syncedCustomers: syncedCustomersCount,
        syncedOutbox: syncedOutboxCount
      };
    } catch (globalErr: any) {
      console.error('[SyncService] Global sync error:', globalErr);
      this.lastError = globalErr?.message || 'Failed to sync with Supabase';
      await this.updateCounts();
      return {
        success: false,
        syncedOrders: syncedOrdersCount,
        syncedCustomers: syncedCustomersCount,
        syncedOutbox: syncedOutboxCount
      };
    } finally {
      this.isSyncing = false;
      this.notifyListeners();
      if (
        syncedOrdersCount + syncedCustomersCount + syncedOutboxCount > 0 &&
        typeof window !== 'undefined'
      ) {
        window.dispatchEvent(new CustomEvent('mooco-ledger-synced'));
      }
    }
  }

  // Keep a local copy of the catalog so the POS works offline.
  public async cacheCatalogFromSupabase(snapshot?: { items?: any[] | null; customers?: any[] | null }): Promise<void> {
    if (!this.isOnline) return;
    try {
      const [itemsRes, customersRes] = snapshot ? [
        { status: 'fulfilled' as const, value: { data: snapshot.items } },
        { status: 'fulfilled' as const, value: { data: snapshot.customers } }
      ] : await Promise.allSettled([
        supabase.from('items').select('*'),
        supabase.from('customers').select('*')
      ]);

      if (itemsRes.status === 'fulfilled' && itemsRes.value.data) {
        const items = itemsRes.value.data;
        const catalogItems = items.map((i: any) => ({
          id: i.id,
          name: i.name || 'Unknown',
          category: Array.isArray(i.category) ? i.category : [i.category || 'Uncategorized'],
          item_type: Array.isArray(i.type) ? i.type : [i.type || 'Dairy products'],
          unit: i.unit || 'units',
          cost_price: roundCurrency(i.cost_price || 0),
          selling_price: roundCurrency(i.selling_price || 0),
          stock: roundQuantity(i.stock || 0),
          variant_stocks: i.variant_stocks || {},
          variants: i.variants || [],
          is_active: i.is_active !== false,
          quick_amounts: i.quick_amounts || [],
          pos_primary_mode: i.pos_primary_mode || 'amount',
          allow_loose_sale: i.allow_loose_sale !== false,
          updated_at: new Date().toISOString()
        }));

        await db.catalog_cache.bulkPut(catalogItems);
      }

      if (customersRes.status === 'fulfilled' && customersRes.value.data) {
        const customers = customersRes.value.data;
        for (const c of customers) {
          const existing = await db.customers.get(c.id);
          // Only update if not currently pending offline changes
          if (!existing || existing.sync_status === 'synced') {
            await db.customers.put({
              id: c.id,
              name: c.name || 'Unknown',
              phone: c.phone || '',
              address: c.address || '',
              route: c.route || '',
              type: c.type || 'Retail Counter',
              balance: roundCurrency(c.balance || 0),
              is_active: c.is_active !== false,
              data: c.data || {},
              sync_status: 'synced',
              created_at: existing?.created_at || new Date().toISOString(),
              synced_at: new Date().toISOString()
            });
          }
        }
      }
    } catch (e) {
      console.warn('[SyncService] Failed to cache catalog from Supabase:', e);
    }
  }

  public destroy(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
    this.listeners.clear();
  }
}

export const syncService = new SyncService();
