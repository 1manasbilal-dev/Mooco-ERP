import { db, LocalCatalogItem, LocalCustomer, LocalOrder, LocalOutboxItem, roundCurrency, roundQuantity } from './db';

/**
 * Server snapshot + local journal.
 * Atomic vouchers (milk, supplier payment, expense, customer receipt) are
 * replayed only when their document is not already on the server.
 * A POS sale is two steps (sale row, then stock/cash/khata), so its effects
 * stay on screen until the local order is marked synced.
 */

let epoch = 0;

export function noteLocalWrite(): void {
  epoch += 1;
}

export function currentEpoch(): number {
  return epoch;
}

export interface LedgerBases {
  sales: any[] | null;
  customers: any[] | null;
  inventory: any[] | null;
  items: any[] | null;
  accounts: any[] | null;
  suppliers: any[] | null;
  expenses: any[] | null;
  expenseVendors: any[] | null;
  purchases: any[] | null;
  allocations: any[] | null;
  customerTransactions: any[] | null;
  supplierTransactions: any[] | null;
  bankTransactions: any[] | null;
  retailClosings: any[] | null;
}

export function emptyBases(): LedgerBases {
  return {
    sales: null,
    customers: null,
    inventory: null,
    items: null,
    accounts: null,
    suppliers: null,
    expenses: null,
    expenseVendors: null,
    purchases: null,
    allocations: null,
    customerTransactions: null,
    supplierTransactions: null,
    bankTransactions: null,
    retailClosings: null
  };
}

export interface UnsyncedWork {
  orders: LocalOrder[];
  customers: LocalCustomer[];
  outbox: LocalOutboxItem[];
}

export async function readUnsyncedWork(): Promise<UnsyncedWork> {
  const [orders, customers, outbox] = await Promise.all([
    db.orders.where('sync_status').anyOf('pending', 'failed').toArray(),
    db.customers.where('sync_status').anyOf('pending', 'failed').toArray(),
    db.outbox.where('sync_status').anyOf('pending', 'failed').toArray()
  ]);
  return { orders, customers, outbox };
}

export function toPosBill(order: LocalOrder): any {
  const paid = order.details?.paid_amount !== undefined
    ? roundCurrency(order.details.paid_amount)
    : (order.payment_mode === 'Credit' ? 0 : roundCurrency(order.total));
  const due = order.details?.due_amount !== undefined
    ? roundCurrency(order.details.due_amount)
    : roundCurrency(order.customer_id ? Math.max(0, order.total - paid) : 0);
  return {
    id: order.id,
    bill_number: order.bill_number,
    date: order.date,
    customer_id: order.customer_id,
    customer_name: order.customer_name,
    subtotal: order.subtotal,
    discount: order.discount,
    total: order.total,
    payment_mode: order.payment_mode,
    status: order.status,
    business_day_id: order.business_day_id,
    shift_session_id: order.shift_session_id,
    shift_name: order.shift_name,
    drawer_id: order.drawer_id,
    cashier_id: order.cashier_id,
    cashier_name: order.cashier_name,
    items: order.items,
    paid_amount: paid,
    due_amount: due,
    details: order.details,
    sync_status: order.sync_status,
    sync_error: order.sync_error
  };
}

export function toCustomer(c: LocalCustomer): any {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone || '',
    address: c.address || '',
    route: c.route || '',
    type: c.type || 'Retail Counter',
    balance: roundCurrency(c.balance || 0),
    isActive: c.is_active !== false,
    ...(c.data || {})
  };
}

export function mapCatalogCache(cached: LocalCatalogItem[]): { items: any[]; inventory: any[] } {
  const items = cached.map(i => ({
    id: i.id,
    name: i.name,
    category: i.category,
    item_type: i.item_type,
    unit: i.unit,
    cost_price: i.cost_price,
    selling_price: i.selling_price,
    stock: i.stock,
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
    image_url: (i as any).image_url
  }));
  const inventory = cached.map(i => ({
    id: `inv_${i.id}`,
    item_id: i.id,
    name: i.name,
    category: Array.isArray(i.category) ? (i.category[0] || 'Dairy products') : i.category,
    stock_type: 'Retail Stock',
    quantity: i.stock,
    unit: i.unit,
    price: i.selling_price,
    variant_stocks: i.variant_stocks || {}
  }));
  return { items, inventory };
}

function idsOf(rows: any[] | null | undefined): Set<string> {
  return new Set((rows || []).map(row => row?.id).filter(Boolean));
}

/**
 * Every value a ledger row can be linked by. One pass over the rows, so each lookup is O(1):
 * scanning the whole bank history per pending bill and per stock row made a projection with a
 * few offline bills cost millions of comparisons.
 */
function refIndex(rows: any[] | null | undefined): Set<unknown> {
  const refs = new Set<unknown>();
  for (const row of rows || []) {
    refs.add(row?.id);
    refs.add(row?.reference_id);
    refs.add(row?.related_expense_id);
    refs.add(row?.details?.reference_id);
    refs.add(row?.details?.purchase_id);
  }
  return refs;
}

function appendMissing(base: any[] | null, extras: any[]): any[] | null {
  if (!base && extras.length === 0) return null;
  const rows = [...(base || [])];
  const seen = idsOf(rows);
  const front: any[] = [];
  for (const row of extras) {
    if (row?.id && !seen.has(row.id)) {
      front.push(row);
      seen.add(row.id);
    }
  }
  return [...front, ...rows];
}

function paidOf(order: LocalOrder): number {
  if (order.details?.paid_amount !== undefined) return roundCurrency(order.details.paid_amount);
  if (order.payment_mode === 'Credit') return 0;
  return roundCurrency(order.total || 0);
}

function dueOf(order: LocalOrder): number {
  if (order.details?.due_amount !== undefined) return roundCurrency(order.details.due_amount);
  if (!order.customer_id) return 0;
  return roundCurrency(Math.max(0, (order.total || 0) - paidOf(order)));
}

function outboxOf(work: UnsyncedWork, type: string): LocalOutboxItem[] {
  return work.outbox.filter(item => item.action_type === type);
}

export function projectLedger(bases: LedgerBases, work: UnsyncedWork): LedgerBases {
  const saleIds = idsOf(bases.sales);
  const purchaseIds = idsOf(bases.purchases);
  const expenseIds = idsOf(bases.expenses);
  const customerTxIds = idsOf(bases.customerTransactions);
  const supplierTxIds = idsOf(bases.supplierTransactions);
  const customerIds = idsOf(bases.customers);
  const closingIds = idsOf(bases.retailClosings);
  const bankRefs = refIndex(bases.bankTransactions);
  const hasBankRef = (ref: unknown) => bankRefs.has(ref);

  const localSales = work.orders.filter(order => !saleIds.has(order.id)).map(toPosBill);
  const localCustomers = work.customers.filter(c => !customerIds.has(c.id)).map(toCustomer);

  const milk = outboxOf(work, 'milk_purchase').filter(item => !purchaseIds.has(item.payload?.purchase_id));
  const supplierPays = outboxOf(work, 'supplier_payment').filter(item => !supplierTxIds.has(item.payload?.tx_id));
  const expenses = outboxOf(work, 'expense').filter(item => !expenseIds.has(item.payload?.expense_id));
  const customerPays = outboxOf(work, 'customer_payment').filter(item => !customerTxIds.has(item.payload?.p_tx_id));
  const closings = outboxOf(work, 'retail_closing');

  const localPurchases = milk.map(item => ({
    id: item.payload.purchase_id,
    supplier_id: item.payload.supplier_id,
    supplier_name: item.payload.supplier_name,
    date: item.payload.date,
    shift: item.payload.shift,
    milk_type: item.payload.milk_type,
    quantity: item.payload.quantity,
    rate: item.payload.rate,
    fat: item.payload.fat,
    snf: item.payload.snf,
    total_amount: item.payload.total_amount,
    paid_amount: item.payload.paid_amount,
    due_amount: item.payload.due_amount,
    payment_mode: item.payload.payment_mode || 'Cash',
    status: 'Completed',
    details: item.payload,
    sync_status: item.sync_status
  }));

  const localAllocations = milk.map(item => ({
    id: `alloc_${item.payload.purchase_id}`,
    purchase_id: item.payload.purchase_id,
    date: item.payload.date,
    supplier_name: item.payload.supplier_name,
    milk_type: item.payload.milk_type,
    original_quantity: roundQuantity(Number(item.payload.quantity) || 0),
    remaining_quantity: roundQuantity(Number(item.payload.quantity) || 0),
    allocated_quantity: 0,
    status: 'Unallocated',
    average_rate: roundCurrency(Number(item.payload.rate) || 0)
  }));

  const localSupplierTx = [
    ...supplierPays.map(item => ({
      id: item.payload.tx_id,
      supplier_id: item.payload.supplier_id,
      date: item.payload.date,
      type: item.payload.type || 'Payment',
      amount: item.payload.amount,
      mode: item.payload.mode,
      note: item.payload.note,
      account_id: item.payload.account_id,
      sync_status: item.sync_status
    })),
    ...milk.filter(item => Number(item.payload.paid_amount) > 0).map(item => ({
      id: `stx_pur_${item.payload.purchase_id}`,
      supplier_id: item.payload.supplier_id,
      date: item.payload.date,
      type: 'Payment',
      amount: item.payload.paid_amount,
      mode: item.payload.payment_mode,
      note: `Spot Payment for Milk Intake (${item.payload.quantity}L ${item.payload.milk_type})`,
      account_id: item.payload.account_id
    }))
  ];

  const effectsSeen = new Map<string, boolean>();
  const effectsOnServer = (order: LocalOrder): boolean => {
    let seen = effectsSeen.get(order.id);
    if (seen === undefined) {
      seen = customerTxIds.has(`ctx_${order.id}`) || hasBankRef(order.id);
      effectsSeen.set(order.id, seen);
    }
    return seen;
  };

  const localExpenses = expenses.map(item => ({
    id: item.payload.expense_id,
    date: item.payload.date,
    category: item.payload.category,
    amount: item.payload.amount || 0,
    paidAmount: item.payload.paid_amount || 0,
    paymentStatus: item.payload.payment_status || 'Paid',
    description: item.payload.description || '',
    account_id: item.payload.account_id,
    account_name: item.payload.account_name,
    vendor_id: item.payload.vendor_id,
    vendor_name: item.payload.vendor_name,
    details: item.payload,
    sync_status: item.sync_status
  }));

  const localCustomerTx = [
    ...customerPays.map(item => ({
      id: item.payload.p_tx_id,
      customer_id: item.payload.p_customer_id,
      date: item.payload.p_date,
      type: item.payload.p_type || 'Payment',
      amount: roundCurrency(item.payload.p_amount || 0),
      mode: item.payload.p_details?.mode,
      note: item.payload.p_details?.note,
      account_id: item.payload.p_account_id,
      details: item.payload.p_details,
      sync_status: item.sync_status
    })),
    ...work.orders.filter(order => order.customer_id && dueOf(order) > 0 && !effectsOnServer(order)).map(order => ({
      id: `ctx_${order.id}`,
      customer_id: order.customer_id,
      date: (order.date || '').split('T')[0],
      type: 'Charge',
      amount: dueOf(order),
      note: `Sale #${order.bill_number}`,
      business_day_id: order.business_day_id,
      shift_session_id: order.shift_session_id
    })),
    ...work.customers
      .filter(c => !customerIds.has(c.id) && c.balance !== 0 && !customerTxIds.has(`ctx_op_${c.id}`))
      .map(c => ({
        id: `ctx_op_${c.id}`,
        customer_id: c.id,
        date: new Date(c.created_at || Date.now()).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
        type: c.balance > 0 ? 'Charge' : 'Payment',
        amount: roundCurrency(Math.abs(c.balance)),
        mode: 'Opening Balance',
        note: c.balance > 0 ? 'Opening Balance (Initial Receivable)' : 'Opening Balance (Initial Advance/Credit)'
      }))
  ];

  const localClosings = closings
    .filter(item => !closingIds.has(item.payload?.id))
    .map(item => ({ ...(item.payload || {}), sync_status: item.sync_status }));

  const accountDelta: Record<string, number> = {};
  const addDelta = (accountId: string | null | undefined, delta: number) => {
    if (!accountId || !delta) return;
    accountDelta[accountId] = roundCurrency((accountDelta[accountId] || 0) + delta);
  };

  for (const order of work.orders) {
    if (order.status === 'Returned' || effectsOnServer(order)) continue;
    addDelta(order.receipt_account_id, paidOf(order));
  }
  for (const item of customerPays) {
    if ((item.payload.p_type || 'Payment') === 'Payment') addDelta(item.payload.p_account_id, Number(item.payload.p_amount) || 0);
  }
  for (const item of supplierPays) addDelta(item.payload.account_id, -(Number(item.payload.amount) || 0));
  for (const item of expenses) addDelta(item.payload.account_id, -(Number(item.payload.paid_amount) || 0));
  for (const item of milk) addDelta(item.payload.account_id, -(Number(item.payload.paid_amount) || 0));

  const customerDelta: Record<string, number> = {};
  for (const order of work.orders) {
    if (!order.customer_id || order.status === 'Returned' || effectsOnServer(order)) continue;
    const due = dueOf(order);
    if (due > 0) {
      customerDelta[order.customer_id] = roundCurrency((customerDelta[order.customer_id] || 0) + due);
    }
  }
  for (const item of customerPays) {
    const amount = roundCurrency(Number(item.payload.p_amount) || 0);
    const sign = (item.payload.p_type || 'Payment') === 'Payment' ? -1 : 1;
    const id = item.payload.p_customer_id;
    if (id) customerDelta[id] = roundCurrency((customerDelta[id] || 0) + sign * amount);
  }

  const supplierDelta: Record<string, number> = {};
  for (const item of milk) {
    const due = roundCurrency(Number(item.payload.due_amount) || 0);
    const id = item.payload.supplier_id;
    if (id && due) supplierDelta[id] = roundCurrency((supplierDelta[id] || 0) + due);
  }
  for (const item of supplierPays) {
    const id = item.payload.supplier_id;
    const amount = roundCurrency(Number(item.payload.amount) || 0);
    if (id && amount) supplierDelta[id] = roundCurrency((supplierDelta[id] || 0) - amount);
  }

  const vendorDelta: Record<string, { pending: number; billed: number; paid: number }> = {};
  for (const item of expenses) {
    const id = item.payload.vendor_id;
    if (!id) continue;
    const amount = roundCurrency(Number(item.payload.amount) || 0);
    const paid = roundCurrency(Number(item.payload.paid_amount) || 0);
    const bucket = vendorDelta[id] || { pending: 0, billed: 0, paid: 0 };
    bucket.pending = roundCurrency(bucket.pending + Math.max(0, amount - paid));
    bucket.billed = roundCurrency(bucket.billed + amount);
    bucket.paid = roundCurrency(bucket.paid + paid);
    vendorDelta[id] = bucket;
  }

  const localBankTx = [
    ...work.orders.filter(order => order.receipt_account_id && paidOf(order) > 0 && !effectsOnServer(order)).map(order => ({
      id: `btx_local_${order.id}`,
      account_id: order.receipt_account_id,
      amount: paidOf(order),
      date: order.date,
      type: 'Income',
      category: 'Sale',
      description: `Sale #${order.bill_number}`,
      reference_id: order.id
    })),
    ...customerPays.filter(item => item.payload.p_account_id && (item.payload.p_type || 'Payment') === 'Payment' && !hasBankRef(item.payload.p_tx_id)).map(item => ({
      id: `btx_${item.payload.p_tx_id}`,
      account_id: item.payload.p_account_id,
      amount: roundCurrency(Number(item.payload.p_amount) || 0),
      date: item.payload.p_date,
      type: 'Income',
      category: 'Customer Receipt',
      description: item.payload.p_details?.description || 'Customer Receipt',
      reference_id: item.payload.p_tx_id
    })),
    ...supplierPays.filter(item => item.payload.account_id && !hasBankRef(item.payload.tx_id)).map(item => ({
      id: `btx_${item.payload.tx_id}`,
      account_id: item.payload.account_id,
      amount: roundCurrency(Number(item.payload.amount) || 0),
      date: item.payload.date,
      type: 'Expense',
      category: 'Supplier Payment',
      description: `Supplier Payment: ${item.payload.supplier_name || ''}`.trim(),
      reference_id: item.payload.tx_id
    })),
    ...expenses.filter(item => item.payload.account_id && Number(item.payload.paid_amount) > 0 && !hasBankRef(item.payload.expense_id)).map(item => ({
      id: `btx_${item.payload.expense_id}`,
      account_id: item.payload.account_id,
      amount: roundCurrency(Number(item.payload.paid_amount) || 0),
      date: item.payload.date,
      type: 'Expense',
      category: item.payload.category || 'Expense',
      description: `Expense: ${item.payload.description || ''}`,
      reference_id: item.payload.expense_id,
      related_expense_id: item.payload.expense_id
    })),
    ...milk.filter(item => item.payload.account_id && Number(item.payload.paid_amount) > 0 && !hasBankRef(item.payload.purchase_id)).map(item => ({
      id: `btx_pur_${item.payload.purchase_id}`,
      account_id: item.payload.account_id,
      amount: roundCurrency(Number(item.payload.paid_amount) || 0),
      date: item.payload.date,
      type: 'Expense',
      category: 'Milk Purchase',
      description: `Milk Intake Payment: ${item.payload.supplier_name || ''}`,
      reference_id: item.payload.purchase_id
    }))
  ];

  const inventory = bases.inventory
    ? bases.inventory.map(inv => {
        let quantity = roundQuantity(Number(inv.quantity) || 0);
        const variant_stocks = { ...(inv.variant_stocks || {}) };
        for (const order of work.orders) {
          if (order.status === 'Returned' || effectsOnServer(order)) continue;
          for (const line of order.items || []) {
            const lineId = line.itemId || line.id;
            // By id only; "id or name" could also move a second row that shares the name.
            const matches = lineId ? (inv.item_id === lineId || inv.id === lineId) : inv.name === line.name;
            if (!matches) continue;
            const qty = roundQuantity(Number(line.qty) || 0);
            if (line.variantId && line.deductFromBase !== true) {
              variant_stocks[line.variantId] = roundQuantity((Number(variant_stocks[line.variantId]) || 0) - qty);
            } else {
              const contains = line.deductFromBase === true ? (Number(line.stockDeduction) || 1) : 1;
              quantity = roundQuantity(quantity - (qty * contains));
            }
          }
        }
        return { ...inv, quantity, variant_stocks };
      })
    : null;

  // First stock row per item_id / row id, so each catalog item finds its row without a scan.
  const firstRow = new Map<string, number>();
  (inventory || []).forEach((row, index) => {
    if (!firstRow.has(`item:${row.item_id}`)) firstRow.set(`item:${row.item_id}`, index);
    if (!firstRow.has(`row:${row.id}`)) firstRow.set(`row:${row.id}`, index);
  });
  const items = bases.items
    ? bases.items.map(item => {
        const byItem = firstRow.get(`item:${item.id}`);
        const byRow = firstRow.get(`row:inv_${item.id}`);
        const index = byItem === undefined ? byRow : byRow === undefined ? byItem : Math.min(byItem, byRow);
        const inv = index === undefined ? undefined : inventory?.[index];
        if (!inv) return item;
        return { ...item, stock: inv.quantity, variant_stocks: inv.variant_stocks };
      })
    : null;

  const customers = bases.customers || localCustomers.length
    ? [...(bases.customers || []), ...localCustomers].map(c => (
        customerDelta[c.id] !== undefined
          ? { ...c, balance: roundCurrency((c.balance || 0) + customerDelta[c.id]) }
          : c
      ))
    : null;

  const suppliers = bases.suppliers
    ? bases.suppliers.map(s => {
        const delta = supplierDelta[s.id];
        if (!delta) return s;
        return {
          ...s,
          balance: roundCurrency((s.balance || 0) + delta),
          pending_balance: roundCurrency((s.pending_balance || 0) + delta)
        };
      })
    : null;

  const accounts = bases.accounts
    ? bases.accounts.map(a => accountDelta[a.id] ? { ...a, balance: roundCurrency((a.balance || 0) + accountDelta[a.id]) } : a)
    : null;

  const expenseVendors = bases.expenseVendors
    ? bases.expenseVendors.map(v => {
        const delta = vendorDelta[v.id];
        if (!delta) return v;
        return {
          ...v,
          pending_balance: roundCurrency((v.pending_balance || 0) + delta.pending),
          total_billed: roundCurrency((v.total_billed || 0) + delta.billed),
          total_paid: roundCurrency((v.total_paid || 0) + delta.paid)
        };
      })
    : null;

  return {
    sales: appendMissing(bases.sales, localSales),
    customers,
    inventory,
    items,
    accounts,
    suppliers,
    expenses: appendMissing(bases.expenses, localExpenses),
    expenseVendors,
    purchases: appendMissing(bases.purchases, localPurchases),
    allocations: appendMissing(bases.allocations, localAllocations),
    customerTransactions: appendMissing(bases.customerTransactions, localCustomerTx),
    supplierTransactions: appendMissing(bases.supplierTransactions, localSupplierTx),
    bankTransactions: appendMissing(bases.bankTransactions, localBankTx),
    retailClosings: appendMissing(bases.retailClosings, localClosings)
  };
}
